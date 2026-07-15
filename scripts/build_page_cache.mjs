#!/usr/bin/env node
/**
 * Snapshot Google Sites and Yuque pages into fully self-contained static HTML
 * so the site can iframe a local cached copy instead of the live page.
 *
 * Every sub-resource (CSS, images, fonts) is downloaded into
 * site/data/cache/assets/ and all references rewritten to local paths, so a
 * snapshot has ZERO dependency on Google / Yuque CDNs — it loads entirely from
 * Cloudflare (fast and reliable from mainland China). The live embed remains
 * the fallback for any URL without a snapshot.
 *
 * Usage:
 *   node scripts/build_page_cache.mjs [--clean] [--only=google|yuque]
 *                                     [--limit=N] [--url=<single url>]
 */

import { chromium } from "playwright";
import { createHash } from "node:crypto";
import {
  readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync, existsSync,
} from "node:fs";
import path from "node:path";

const OUT_DIR = "site/data";
const CACHE_DIR = path.join(OUT_DIR, "cache");
const ASSETS_DIR = path.join(CACHE_DIR, "assets");
const ASSETS_URL_BASE = "/data/cache/assets"; // root-relative path used inside snapshots
const LESSONS_DIR = path.join(OUT_DIR, "lessons");
const CONCURRENCY = 4;
const NAV_TIMEOUT = 45000;
const SETTLE_MS = 2400;
const ASSET_TIMEOUT = 30000;
const ASSET_MAX_BYTES = 5 * 1024 * 1024;
// Fonts are left remote: CJK web fonts fan out into 100+ subset files (many MB)
// and are not layout-critical — the browser falls back to a system font.
const FONT_EXT = /\.(woff2?|ttf|otf|eot)(?:[?#]|$)/i;

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/* --------------------------------------------------------------------- *
 * URL collection
 * --------------------------------------------------------------------- */

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (name) => {
    const hit = args.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : "";
  };
  return {
    clean: args.includes("--clean"),
    injectOnly: args.includes("--inject-only"),
    only: get("only"),
    limit: Number(get("limit") || 0),
    url: get("url"),
  };
}

function hostOf(rawUrl) {
  try {
    return new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function isGoogleSites(rawUrl) {
  return hostOf(rawUrl) === "sites.google.com";
}

function isYuque(rawUrl) {
  return /(^|\.)yuque\.com$/i.test(hostOf(rawUrl));
}

/** A direct file link (PDF / image / office doc) — not a snapshot-able page. */
function isFileUrl(rawUrl) {
  return /\.(pdf|docx?|pptx?|xlsx?|avif|gif|jpe?g|png|svg|webp|mp4|zip)(?:$|[?#])/i.test(rawUrl);
}

/** Normalised lookup key shared with the site runtime (origin + path). */
function cacheKey(rawUrl) {
  try {
    const u = new URL(rawUrl);
    const p = u.pathname.replace(/\/+$/, "") || "/";
    return `${u.protocol}//${u.hostname.toLowerCase()}${p}`;
  } catch {
    return "";
  }
}

function fileNameFor(kind, key) {
  const hash = createHash("sha1").update(key).digest("hex").slice(0, 16);
  return `${kind}/${hash}.html`;
}

function considerUrl(map, rawUrl) {
  if (!rawUrl) return;
  const google = isGoogleSites(rawUrl);
  const yuque = isYuque(rawUrl);
  if (!google && !yuque) return;
  if (isFileUrl(rawUrl)) return; // PDFs / images embed via the site's own viewers
  const key = cacheKey(rawUrl);
  if (!key || map.has(key)) return;
  let renderUrl = rawUrl;
  const kind = google ? "google" : "yuque";
  if (yuque) {
    try {
      const u = new URL(rawUrl);
      if (u.pathname.startsWith("/login")) return; // login redirector — never snapshot
      u.hash = "";
      u.searchParams.set("view", "doc_embed"); // clean embed view, no Yuque chrome
      renderUrl = u.toString();
    } catch {
      return;
    }
  }
  map.set(key, { key, kind, rawUrl, renderUrl });
}

function collectEntries() {
  const map = new Map();
  if (existsSync(LESSONS_DIR)) {
    for (const file of readdirSync(LESSONS_DIR)) {
      if (!file.endsWith(".json")) continue;
      const lesson = JSON.parse(readFileSync(path.join(LESSONS_DIR, file), "utf8"));
      for (const resource of lesson.resources || []) considerUrl(map, resource.href);
    }
  }
  const classResourcesPath = path.join(OUT_DIR, "class_resources.json");
  if (existsSync(classResourcesPath)) {
    const data = JSON.parse(readFileSync(classResourcesPath, "utf8"));
    for (const item of data.items || []) considerUrl(map, item.url);
  }
  return [...map.values()];
}

/* --------------------------------------------------------------------- *
 * Asset localisation — download every sub-resource into cache/assets/
 * --------------------------------------------------------------------- */

const assetJobs = new Map(); // absUrl -> Promise<localPath|null>
const assetStats = { ok: 0, failed: 0, bytes: 0 };

function extensionFor(url, contentType) {
  const ct = (contentType || "").split(";")[0].trim().toLowerCase();
  const byType = {
    "text/css": "css",
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/avif": "avif",
    "image/svg+xml": "svg",
    "image/x-icon": "ico",
    "image/vnd.microsoft.icon": "ico",
    "font/woff2": "woff2",
    "font/woff": "woff",
    "font/ttf": "ttf",
    "font/otf": "otf",
    "application/font-woff2": "woff2",
    "application/font-woff": "woff",
    "application/x-font-ttf": "ttf",
  };
  if (byType[ct]) return byType[ct];
  const m = String(url).split(/[?#]/)[0].match(/\.([a-z0-9]{2,5})$/i);
  if (m) return m[1].toLowerCase();
  if (ct.startsWith("image/")) return ct.slice(6).replace(/[^a-z0-9]/g, "") || "img";
  if (ct.startsWith("font/")) return ct.slice(5).replace(/[^a-z0-9]/g, "") || "font";
  return "bin";
}

/**
 * Google user-content images are referenced at the 16383px max-resolution
 * variant; fetch a sensible 1600px variant instead so it localises small.
 */
function fetchTargetUrl(url) {
  if (/(?:googleusercontent|ggpht)\.com\//i.test(url)) {
    return url.replace(/=(?:w|h|s)\d+(?:-(?:w|h)\d+)*(?:-[a-z]+)*$/i, "=w1280");
  }
  return url;
}

async function fetchBuffer(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ASSET_TIMEOUT);
  try {
    const response = await fetch(fetchTargetUrl(url), {
      signal: controller.signal,
      headers: { "user-agent": BROWSER_UA, "accept": "*/*" },
      redirect: "follow",
    });
    if (!response.ok) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length || buffer.length > ASSET_MAX_BYTES) return null;
    return { buffer, contentType: response.headers.get("content-type") || "" };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Rewrite url(...) and @import targets inside CSS to local asset paths. */
async function localizeCssText(cssText, cssBaseUrl, depth) {
  const tasks = [];
  const seen = new Map();
  const queue = (raw) => {
    const value = String(raw).trim().replace(/^['"]|['"]$/g, "");
    if (!value || value.startsWith("data:") || value.startsWith("#")) return;
    if (FONT_EXT.test(value)) return; // leave font files remote
    if (seen.has(value)) return;
    let abs;
    try {
      abs = new URL(value, cssBaseUrl).toString();
    } catch {
      return;
    }
    seen.set(value, abs);
    tasks.push(value);
  };
  for (const m of cssText.matchAll(/url\(\s*([^)]+?)\s*\)/gi)) queue(m[1]);
  for (const m of cssText.matchAll(/@import\s+(?:url\()?\s*['"]([^'"]+)['"]/gi)) queue(m[1]);

  const mapping = new Map();
  await Promise.all(
    tasks.map(async (value) => {
      const abs = seen.get(value);
      const isCssTarget = /\.css(?:[?#]|$)/i.test(abs);
      const local = await localizeAsset(abs, isCssTarget && depth < 3, depth + 1);
      if (local) mapping.set(value, local);
    }),
  );
  let out = cssText;
  for (const [value, local] of [...mapping].sort((a, b) => b[0].length - a[0].length)) {
    out = out.split(value).join(local);
  }
  return out;
}

/**
 * Download one asset (image / font / css) into cache/assets/, returning the
 * root-relative local path. Deduplicates by URL and by content hash.
 */
function localizeAsset(absUrl, asCss = false, depth = 0) {
  if (!/^https?:\/\//i.test(absUrl)) return Promise.resolve(null);
  if (assetJobs.has(absUrl)) return assetJobs.get(absUrl);
  const job = (async () => {
    const fetched = await fetchBuffer(absUrl);
    if (!fetched) {
      assetStats.failed += 1;
      return null;
    }
    let { buffer } = fetched;
    let ext = extensionFor(absUrl, fetched.contentType);
    if (asCss || ext === "css") {
      ext = "css";
      const processed = await localizeCssText(buffer.toString("utf8"), absUrl, depth);
      buffer = Buffer.from(processed, "utf8");
    }
    const hash = createHash("sha1").update(buffer).digest("hex").slice(0, 16);
    const rel = `assets/${hash}.${ext}`;
    const dest = path.join(CACHE_DIR, rel);
    if (!existsSync(dest)) writeFileSync(dest, buffer);
    assetStats.ok += 1;
    assetStats.bytes += buffer.length;
    return `${ASSETS_URL_BASE}/${hash}.${ext}`;
  })().catch(() => {
    assetStats.failed += 1;
    return null;
  });
  assetJobs.set(absUrl, job);
  return job;
}

/** Collect every external resource URL from a snapshot's HTML. */
function collectResourceUrls(html) {
  const css = new Set();
  const other = new Set();
  for (const tag of html.matchAll(/<link\b[^>]*>/gi)) {
    if (!/rel\s*=\s*["']?[^"'>]*stylesheet/i.test(tag[0])) continue;
    const href = tag[0].match(/href\s*=\s*["']([^"']+)["']/i);
    if (href && /^https?:\/\//i.test(href[1])) css.add(href[1]);
  }
  for (const m of html.matchAll(/<(?:img|source)\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) {
    if (/^https?:\/\//i.test(m[1])) other.add(m[1]);
  }
  for (const m of html.matchAll(/\bsrcset\s*=\s*["']([^"']+)["']/gi)) {
    for (const part of m[1].split(",")) {
      const url = part.trim().split(/\s+/)[0];
      if (/^https?:\/\//i.test(url)) other.add(url);
    }
  }
  for (const m of html.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi)) {
    if (/^https?:\/\//i.test(m[1]) && !FONT_EXT.test(m[1])) other.add(m[1]);
  }
  return { css: [...css], other: [...other] };
}

/** Replace every external resource URL in the HTML with its local copy. */
async function localizeHtml(html) {
  const { css, other } = collectResourceUrls(html);
  const mapping = new Map();
  await Promise.all([
    ...css.map(async (url) => {
      const local = await localizeAsset(url, true, 0);
      if (local) mapping.set(url, local);
    }),
    ...other.map(async (url) => {
      const local = await localizeAsset(url, false, 0);
      if (local) mapping.set(url, local);
    }),
  ]);
  let out = html;
  for (const [url, local] of [...mapping].sort((a, b) => b[0].length - a[0].length)) {
    out = out.split(url).join(local);
  }
  return { html: out, localized: mapping.size, total: css.length + other.length };
}

/* --------------------------------------------------------------------- *
 * Rendering
 * --------------------------------------------------------------------- */

/** Freeze the rendered DOM: absolutise every URL, strip scripts. */
function snapshotInPage() {
  const absolutize = (el, attr) => {
    try {
      const value = el[attr];
      if (value) el.setAttribute(attr, value);
    } catch {
      /* leave as-is */
    }
  };
  document.querySelectorAll('link[rel~="stylesheet"]').forEach((el) => absolutize(el, "href"));
  document.querySelectorAll("img").forEach((img) => {
    absolutize(img, "src");
    img.removeAttribute("srcset");
    img.setAttribute("loading", "lazy");
    img.setAttribute("decoding", "async");
  });
  document.querySelectorAll("source").forEach((el) => {
    absolutize(el, "src");
    el.removeAttribute("srcset");
  });
  document.querySelectorAll("iframe").forEach((el) => absolutize(el, "src"));
  document.querySelectorAll("a[href]").forEach((a) => {
    absolutize(a, "href");
    a.setAttribute("target", "_blank");
    a.setAttribute("rel", "noreferrer noopener");
  });
  document
    .querySelectorAll(
      'script,link[rel="preload"],link[rel="modulepreload"],link[rel="prefetch"],' +
        'link[rel="preconnect"],link[rel="dns-prefetch"],base,noscript',
    )
    .forEach((node) => node.remove());
  const text = (document.body ? document.body.innerText : "").replace(/\s+/g, " ").trim();
  return {
    text,
    title: (document.title || "").trim(),
    html: `<!doctype html>\n${document.documentElement.outerHTML}`,
  };
}

/** Scroll through the page so lazy-loaded images request their real source. */
async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let y = 0;
      const step = 700;
      const timer = setInterval(() => {
        window.scrollBy(0, step);
        y += step;
        if (y >= document.body.scrollHeight) {
          clearInterval(timer);
          window.scrollTo(0, 0);
          resolve();
        }
      }, 90);
    });
  }).catch(() => {});
}

function looksValid(result) {
  if (!result) return false;
  const text = result.text || "";
  const title = result.title || "";
  if (text.length < 80) return false;
  if (/^\s*(登[录錄入]|sign\s*in|log\s*in)\b/i.test(title)) return false;
  if (/^\s*登[录錄入]\s*[·•|]/.test(title)) return false;
  // Google Sites "404" page keeps the full site nav, so it clears the length
  // check — match its distinctive body text instead.
  if (/您输入的[网網]?[页頁]面?不存在|您输入的[网網]址不是|不是此[网網]站中的有效/.test(text)) {
    return false;
  }
  if (
    text.length < 700 &&
    /(登录后|登錄後|請先登入|请先登录|立即登录|扫码登录|密码登录|sign in to|log in to|page not found|找不到该网页|无法访问此页面)/i.test(text)
  ) {
    return false;
  }
  return true;
}

/*
 * The Google Sites nav is a fixed 250px-wide full-height overlay. Its
 * open/close JavaScript was stripped with the rest of the page scripts, so it
 * stays stuck open and covers the body text. Inject a CSS-only toggle (a
 * checkbox — no script needed, works in the sandboxed iframe): collapsed by
 * default, the ☰ button slides it in.
 */
const NAV_TOGGLE_HTML =
  '<input type="checkbox" id="yw-nav-cb" aria-label="目錄開關">' +
  '<label for="yw-nav-cb" id="yw-nav-btn" title="目錄"></label>';

const NAV_TOGGLE_STYLE = `<style id="yw-nav-toggle">
#yw-nav-cb{position:fixed;width:1px;height:1px;margin:0;opacity:0;pointer-events:none}
#yw-nav-btn{position:fixed;top:8px;left:8px;z-index:2147483000;display:flex;
align-items:center;justify-content:center;width:38px;height:38px;border-radius:9px;
background:rgba(42,61,68,.92);color:#fff;font:600 17px/1 system-ui,sans-serif;
cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.35);user-select:none;-webkit-user-select:none}
#yw-nav-btn::before{content:"\\2630"}
#yw-nav-cb:checked~#yw-nav-btn::before{content:"\\2715"}
[role="navigation"]{transition:transform .26s ease!important;transform:translateX(-100%)!important}
#yw-nav-cb:checked~[role="navigation"],
#yw-nav-cb:checked~* [role="navigation"]{transform:translateX(0)!important}
</style>`;

function injectNavToggle(html) {
  if (html.includes('id="yw-nav-cb"')) return html; // idempotent
  let out = html;
  if (/<\/head>/i.test(out)) {
    out = out.replace(/<\/head>/i, `${NAV_TOGGLE_STYLE}</head>`);
  } else {
    out = out.replace(/<body([^>]*)>/i, `<head>${NAV_TOGGLE_STYLE}</head><body$1>`);
  }
  return out.replace(/<body([^>]*)>/i, `<body$1>${NAV_TOGGLE_HTML}`);
}

async function snapshotEntry(context, entry) {
  const page = await context.newPage();
  try {
    await page.goto(entry.renderUrl, { waitUntil: "load", timeout: NAV_TIMEOUT });
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    await autoScroll(page);
    await page.waitForTimeout(SETTLE_MS);
    const result = await page.evaluate(snapshotInPage);
    if (!looksValid(result)) return { ok: false, reason: "thin-or-login" };
    if (entry.kind === "google") {
      // Google CDNs are slow/blocked in mainland China — pull every asset local.
      const localized = await localizeHtml(result.html);
      return {
        ok: true,
        title: result.title,
        html: injectNavToggle(localized.html),
        localized,
      };
    }
    // Yuque is served from Ant/Alibaba CDNs that are fast in mainland China;
    // the HTML-only snapshot already drops the heavy SPA, so keep assets remote.
    return { ok: true, title: result.title, html: result.html, localized: { localized: 0, total: 0 } };
  } catch (error) {
    return { ok: false, reason: (error.message || "error").split("\n")[0] };
  } finally {
    await page.close().catch(() => {});
  }
}

async function runPool(entries, worker) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(CONCURRENCY, entries.length) }, async () => {
    while (cursor < entries.length) {
      const index = cursor++;
      await worker(entries[index], index);
    }
  });
  await Promise.all(runners);
}

/* --------------------------------------------------------------------- *
 * Main
 * --------------------------------------------------------------------- */

async function main() {
  const opts = parseArgs();

  // --inject-only: re-apply the nav toggle to already-cached Google snapshots
  // without re-rendering (idempotent — safe to run repeatedly).
  if (opts.injectOnly) {
    const manifestPath = path.join(CACHE_DIR, "index.json");
    if (!existsSync(manifestPath)) {
      console.log("no cache manifest — run a build first");
      return;
    }
    const pages = JSON.parse(readFileSync(manifestPath, "utf8")).pages || {};
    let injected = 0;
    for (const meta of Object.values(pages)) {
      if (meta.kind !== "google") continue;
      const filePath = path.join(CACHE_DIR, meta.file);
      if (!existsSync(filePath)) continue;
      const html = readFileSync(filePath, "utf8");
      const next = injectNavToggle(html);
      if (next !== html) {
        writeFileSync(filePath, next, "utf8");
        injected += 1;
      }
    }
    console.log(`nav toggle injected into ${injected} google snapshot(s)`);
    return;
  }

  let entries = collectEntries();
  if (opts.only) entries = entries.filter((e) => e.kind === opts.only);
  if (opts.url) {
    const key = cacheKey(opts.url);
    entries = entries.filter((e) => e.key === key || e.rawUrl === opts.url);
  }
  if (opts.limit > 0) entries = entries.slice(0, opts.limit);

  if (!entries.length) {
    console.log("no Google Sites / Yuque URLs matched — nothing to snapshot");
    return;
  }

  const indexPath = path.join(CACHE_DIR, "index.json");
  let pages = {};
  if (opts.clean) {
    if (existsSync(CACHE_DIR)) rmSync(CACHE_DIR, { recursive: true, force: true });
  } else if (existsSync(indexPath)) {
    pages = JSON.parse(readFileSync(indexPath, "utf8")).pages || {};
  }
  mkdirSync(path.join(CACHE_DIR, "google"), { recursive: true });
  mkdirSync(path.join(CACHE_DIR, "yuque"), { recursive: true });
  mkdirSync(ASSETS_DIR, { recursive: true });

  console.log(`snapshotting ${entries.length} page(s) with ${CONCURRENCY} workers...`);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: BROWSER_UA,
    viewport: { width: 1280, height: 1600 },
    locale: "zh-CN",
    deviceScaleFactor: 1,
  });
  context.setDefaultTimeout(NAV_TIMEOUT);

  let ok = 0;
  let failed = 0;
  const failures = [];
  await runPool(entries, async (entry, index) => {
    const result = await snapshotEntry(context, entry);
    const label = `[${index + 1}/${entries.length}] ${entry.kind} ${entry.key}`;
    if (result.ok) {
      const file = fileNameFor(entry.kind, entry.key);
      const bytes = Buffer.byteLength(result.html, "utf8");
      writeFileSync(path.join(CACHE_DIR, file), result.html, "utf8");
      pages[entry.key] = {
        file,
        kind: entry.kind,
        title: result.title.slice(0, 200),
        sourceUrl: entry.rawUrl,
        bytes,
        capturedAt: new Date().toISOString(),
      };
      ok += 1;
      console.log(
        `  ok   ${label} (${(bytes / 1024).toFixed(0)} KB, ` +
          `${result.localized.localized}/${result.localized.total} assets local)`,
      );
    } else {
      failed += 1;
      failures.push(`${entry.kind} ${entry.key} — ${result.reason}`);
      delete pages[entry.key];
      console.log(`  skip ${label} — ${result.reason}`);
    }
  });

  await context.close();
  await browser.close();

  const manifest = {
    generatedAt: new Date().toISOString(),
    note: "Self-contained snapshot cache for Google Sites / Yuque embeds; live embed is the fallback.",
    pages,
  };
  writeFileSync(indexPath, `${JSON.stringify(manifest, null, 0)}\n`, "utf8");

  console.log(
    `\ndone: ${ok} cached, ${failed} skipped, ${Object.keys(pages).length} in manifest | ` +
      `assets: ${assetStats.ok} saved (${(assetStats.bytes / 1048576).toFixed(1)} MB), ${assetStats.failed} kept remote`,
  );
  if (failures.length) {
    console.log("skipped (fall back to live embed):");
    failures.forEach((line) => console.log(`  - ${line}`));
  }
}

main().catch((error) => {
  console.error("build_page_cache failed:", error);
  process.exit(1);
});
