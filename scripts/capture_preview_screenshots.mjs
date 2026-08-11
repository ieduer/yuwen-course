#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { chromium } from "playwright";
import sharp from "sharp";
import { previewUrlHasPublicHostname } from "../site/preview-network-policy.js";
import { isRemovedWebResource } from "./web_resource_policy.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const REGISTRY_PATH = resolve(ROOT, "site/data/preview-targets.json");
const OUTPUT_DIR = resolve(ROOT, "site/assets/preview-screenshots");
const MANIFEST_PATH = resolve(ROOT, "site/data/preview-screenshots.json");
const DOCUMENTS_DIR = resolve(ROOT, "site/data/reader-documents");
const WECHAT_MAP_PATH = resolve(ROOT, "site/data/wechat-archive-map.json");
const MEDIA_PATH = /\.(?:pdf|png|jpe?g|gif|webp|svg|avif|wav|mp3|m4a|ogg|flac|mp4|webm|mov)(?:$|[?#])/i;
const REJECT_HOSTS = new Set(["accounts.google.com", "passport.seiue.com"]);
const ERROR_COPY = /(?:url is not registered|preview upstream unavailable|access denied|error\s+(?:4\d\d|5\d\d)|page not found|頁面不存在|页面不存在|找不到网页|無法訪問|无法访问|just a moment|checking your browser|verify you are human)/i;
const LOGIN_COPY = /(?:sign in|log in|登\s*[录錄入]|扫码登录|掃碼登錄|請先登入|请先登录)/i;
const CONCURRENCY = 6;
const PROBE_CONCURRENCY = 12;
const SYSTEM_BROWSER = "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";
const MAX_SCREENSHOT_BYTES = 250_000;
const MAX_TOTAL_BYTES = 80 * 1024 * 1024;
const AUTH_FINAL_URL_HOSTS = new Set(["accounts.google.com", "passport.seiue.com"]);
const FINAL_URL_SEMANTIC_QUERY_KEYS = new Set([
  "action", "bid", "chapter", "dep", "file", "id", "if", "imagename",
  "lang", "page", "redlink", "searchmode", "searchu", "title", "type",
]);
const PRIVATE_OR_TRANSIENT_QUERY_KEY = /(?:auth|client|code|continue|dsh|flow|followup|ifkv|nonce|passive|prompt|redirect|secret|service|session|state|token)/i;
function parseArgs() {
  const value = (name, fallback = "") => {
    const match = process.argv.find((entry) => entry.startsWith(`--${name}=`));
    return match ? match.slice(name.length + 3) : fallback;
  };
  return {
    probeBase: value("probe-base", "http://127.0.0.1:8798"),
    limit: Number(value("limit", "0")) || 0,
    clean: process.argv.includes("--clean"),
    allPages: process.argv.includes("--all-pages"),
    enrichOnly: process.argv.includes("--enrich-only"),
    recoveryAudit: value("recovery-audit"),
  };
}

function sourceAttributions() {
  const wechat = JSON.parse(readFileSync(WECHAT_MAP_PATH, "utf8"));
  const archiveBySource = new Map(wechat.entries.map((entry) => [normalizedTarget(entry.sourceUrl), normalizedTarget(entry.archiveUrl)]));
  const output = new Map();
  const add = (target, attribution) => {
    const values = output.get(target) || new Map();
    values.set(JSON.stringify(attribution), attribution);
    output.set(target, values);
  };
  const visit = (value, context, path = "") => {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => visit(entry, context, `${path}[${index}]`));
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const field of ["href", "sourceUrl"]) {
      if (!value[field]) continue;
      try {
        const normalized = normalizedTarget(value[field]);
        const target = archiveBySource.get(normalized) || normalized;
        add(target, { ...context, sourcePath: `${path || "$"}.${field}` });
      } catch {
        // Invalid source URLs are excluded by the authoritative preview registry.
      }
    }
    for (const [key, entry] of Object.entries(value)) {
      if (key === "href" || key === "sourceUrl") continue;
      visit(entry, context, path ? `${path}.${key}` : key);
    }
  };
  for (const file of readdirSync(DOCUMENTS_DIR).filter((entry) => entry.endsWith(".json")).sort()) {
    const document = JSON.parse(readFileSync(resolve(DOCUMENTS_DIR, file), "utf8"));
    visit(document, {
      lessonId: String(document.lessonId || file.replace(/\.json$/, "")),
      lessonTitle: String(document.title || "").slice(0, 160),
      sourceDocument: `data/reader-documents/${file}`,
    });
  }
  return new Map([...output].map(([target, values]) => [target, [...values.values()]]));
}

function blockedResolutionGroup(entry) {
  if (entry.auditCategory === "requires-suen-or-external-account") {
    return "external-condition-required";
  }
  if (entry.auditCategory === "permanent-dead-or-remove"
    || entry.auditCategory === "auto-fixable-retry-failed") {
    return "remove-from-embed";
  }
  if (/404|name_not_resolved|direct-thin|direct-error-page/i.test(entry.reason)) return "remove-from-embed";
  return "external-condition-required";
}

function builtInResolution(entry) {
  const hostname = new URL(entry.sourceUrl).hostname.toLowerCase();
  if (hostname === "www.youtube.com" || hostname === "youtube.com" || hostname === "youtu.be") {
    return "reviewed-video-thumbnail";
  }
  if (hostname === "blogger.googleusercontent.com") return "direct-image-content";
  return "";
}

function enrichManifest(manifest) {
  const attributions = sourceAttributions();
  const retained = (values = []) => values.filter((entry) => !isRemovedWebResource(entry?.sourceUrl));
  const withAttribution = (entry) => ({
    ...entry,
    ...(Object.hasOwn(entry, "finalUrl") ? { finalUrl: privacyBoundedFinalUrl(entry.finalUrl) } : {}),
    attribution: attributions.get(entry.sourceUrl) || [{ surface: "global-learning-matrix" }],
  });
  const entries = retained(manifest.entries)
    .map((entry) => ({ ...withAttribution(entry), disposition: "screenshot-provided" }));
  const blocked = [];
  const resolved = [];
  for (const entry of [...retained(manifest.blocked), ...retained(manifest.resolved)]) {
    const resolution = builtInResolution(entry);
    if (resolution) {
      resolved.push({
        ...withAttribution(entry),
        disposition: "already-fixed",
        resolution,
      });
      continue;
    }
    blocked.push({
      ...withAttribution(entry),
      disposition: "not-embedded",
      resolutionGroup: blockedResolutionGroup(entry),
    });
  }
  resolved.sort((left, right) => left.sourceUrl.localeCompare(right.sourceUrl));
  blocked.sort((left, right) => left.sourceUrl.localeCompare(right.sourceUrl));
  const totalBytes = entries.reduce((sum, entry) => sum + Number(entry.bytes || 0), 0);
  return {
    ...manifest,
    entries,
    resolved,
    blocked,
    candidateCount: entries.length + resolved.length + blocked.length,
    screenshotCount: entries.length,
    resolvedCount: resolved.length,
    blockedCount: blocked.length,
    totalBytes,
  };
}

function normalizedTarget(raw) {
  const url = new URL(raw);
  url.hash = "";
  return url.toString();
}

function privacyBoundedFinalUrl(raw) {
  if (!raw) return "";
  try {
    const url = new URL(raw);
    url.username = "";
    url.password = "";
    url.hash = "";
    const authSurface = AUTH_FINAL_URL_HOSTS.has(url.hostname.toLowerCase())
      || /\/(?:login|signin|oauth|authorize)(?:\/|$)/i.test(url.pathname);
    for (const key of [...url.searchParams.keys()]) {
      if (
        authSurface
        || PRIVATE_OR_TRANSIENT_QUERY_KEY.test(key)
        || !FINAL_URL_SEMANTIC_QUERY_KEYS.has(key.toLowerCase())
      ) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return url.toString();
  } catch {
    return "";
  }
}

async function responseSample(response, limit = 120_000) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let value = "";
  try {
    while (value.length < limit) {
      const chunk = await reader.read();
      if (chunk.done) break;
      value += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return value.replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/\s+/g, " ").trim();
}

async function needsScreenshot(probeBase, target) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(`${probeBase}/api/preview?url=${encodeURIComponent(target)}`, {
      headers: { accept: "text/html,application/xhtml+xml,*/*" },
      signal: controller.signal,
    });
    const sample = await responseSample(response);
    if (!response.ok) return { needed: true, reason: `proxy-${response.status}` };
    if (sample.length < 80) return { needed: true, reason: "proxy-thin" };
    if (ERROR_COPY.test(sample.slice(0, 5_000))) return { needed: true, reason: "proxy-error-page" };
    if (sample.length < 1_600 && LOGIN_COPY.test(sample.slice(0, 5_000))) {
      return { needed: true, reason: "proxy-login" };
    }
    return { needed: false, reason: "proxy-content" };
  } catch (error) {
    return { needed: true, reason: `proxy-${error?.name || "error"}` };
  } finally {
    clearTimeout(timer);
  }
}

function pageLooksPublic({ title, text, status, finalUrl }) {
  if (status < 200 || status >= 400) return `direct-${status || "no-status"}`;
  if (!text || text.length < 160) return "direct-thin";
  if (ERROR_COPY.test(`${title} ${text.slice(0, 5_000)}`)) return "direct-error-page";
  if (LOGIN_COPY.test(title) || (text.length < 1_600 && LOGIN_COPY.test(text.slice(0, 5_000)))) {
    return "direct-login";
  }
  try {
    if (REJECT_HOSTS.has(new URL(finalUrl).hostname.toLowerCase())) return "direct-login-host";
  } catch {
    return "direct-bad-final-url";
  }
  return "";
}

async function storeScreenshot(png, metadata) {
  const bytes = await sharp(png).webp({ quality: 45, effort: 5 }).toBuffer();
  if (bytes.length > MAX_SCREENSHOT_BYTES) return { ok: false, reason: "screenshot-over-250kb" };
  const digest = createHash("sha256").update(bytes).digest("hex");
  const file = `${digest.slice(0, 24)}.webp`;
  writeFileSync(resolve(OUTPUT_DIR, file), bytes);
  return {
    ok: true,
    entry: {
      sourceUrl: metadata.sourceUrl,
      screenshotUrl: `/assets/preview-screenshots/${file}`,
      title: metadata.title.slice(0, 200) || new URL(metadata.sourceUrl).hostname,
      width: 1024,
      height: 640,
      bytes: bytes.length,
      sha256: digest,
      reason: metadata.reason,
      ...(metadata.captureUrl ? { captureUrl: privacyBoundedFinalUrl(metadata.captureUrl) } : {}),
      ...(metadata.recoveryMethod ? { recoveryMethod: metadata.recoveryMethod } : {}),
    },
  };
}

async function capture(context, target, reason, metadata = {}) {
  const page = await context.newPage();
  try {
    const response = await page.goto(target, { waitUntil: "domcontentloaded", timeout: 40_000 });
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
    await page.waitForTimeout(1_200);
    const title = (await page.title()).replace(/\s+/g, " ").trim();
    const text = (await page.locator("body").innerText({ timeout: 5_000 }).catch(() => ""))
      .replace(/\s+/g, " ")
      .trim();
    const finalUrl = page.url();
    const rejected = pageLooksPublic({ title, text, status: response?.status() || 0, finalUrl });
    if (rejected) return { ok: false, reason: rejected, title, finalUrl };
    await page.addStyleTag({
      content: "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}",
    }).catch(() => {});
    await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
    const png = await page.screenshot({ type: "png", fullPage: false });
    return storeScreenshot(png, {
      sourceUrl: metadata.sourceUrl || target,
      title,
      reason,
      captureUrl: finalUrl,
      recoveryMethod: metadata.recoveryMethod,
    });
  } catch (error) {
    const detail = String(error?.message || "error").split("\n", 1)[0].slice(0, 160);
    return { ok: false, reason: `direct-${error?.name || "error"}:${detail}`, title: "", finalUrl: page.url() };
  } finally {
    await page.close().catch(() => {});
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function fetchJson(url) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(url, {
      headers: { accept: "application/json", "user-agent": "YW-public-preview-capture/1.0" },
      redirect: "follow",
      signal: AbortSignal.timeout(30_000),
    });
    if (response.ok) return response.json();
    if (response.status !== 429 || attempt === 2) throw new Error(`public-api-${response.status}`);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_000 * (attempt + 1)));
  }
  throw new Error("public-api-retry-exhausted");
}

async function captureStaticCard(context, item, { title, eyebrow, bodyHtml, imageUrl = "", method, captureUrl }) {
  const page = await context.newPage();
  try {
    const safeImage = imageUrl && /^https:\/\//i.test(imageUrl)
      ? `<img class="cover" src="${escapeHtml(imageUrl)}" alt="">`
      : "";
    await page.setContent(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>
      *{box-sizing:border-box}html,body{margin:0;width:1024px;height:640px;background:#f2eee5;color:#191816;font-family:-apple-system,BlinkMacSystemFont,"Noto Sans SC",sans-serif}
      main{height:100%;padding:54px 64px;display:grid;grid-template-columns:${safeImage ? "1.16fr .84fr" : "1fr"};gap:42px;align-items:center}
      article{min-width:0}.eyebrow{font:600 15px/1.4 ui-monospace,monospace;letter-spacing:.08em;color:#786b57;margin-bottom:20px}
      h1{font:700 38px/1.18 Georgia,"Noto Serif SC",serif;margin:0 0 24px;max-height:180px;overflow:hidden}
      .content{font:400 20px/1.62 Georgia,"Noto Serif SC",serif;max-height:270px;overflow:hidden;color:#34302b}.content p{margin:0 0 14px}.content a{color:#34302b;text-decoration:none}
      .cover{width:100%;height:360px;object-fit:cover;border:1px solid #d8cdbb;box-shadow:0 16px 40px #5f513326}
    </style><main><article><div class="eyebrow">${escapeHtml(eyebrow)}</div><h1>${escapeHtml(title)}</h1><div class="content">${bodyHtml}</div></article>${safeImage}</main></html>`, { waitUntil: "load" });
    if (safeImage) await page.locator(".cover").evaluate((image) => image.complete).catch(() => false);
    await page.waitForTimeout(500);
    const png = await page.screenshot({ type: "png", fullPage: false });
    return storeScreenshot(png, {
      sourceUrl: item.sourceUrl,
      title,
      reason: "reviewed-public-recovery",
      captureUrl,
      recoveryMethod: method,
    });
  } catch (error) {
    return { ok: false, reason: `recovery-${error?.name || "error"}:${String(error?.message || error).split("\n", 1)[0].slice(0, 140)}` };
  } finally {
    await page.close().catch(() => {});
  }
}

async function recoverX(context, item) {
  const apiUrl = `https://publish.twitter.com/oembed?omit_script=true&dnt=true&url=${encodeURIComponent(item.replacementUrl)}`;
  const data = await fetchJson(apiUrl);
  const html = String(data.html || "").replace(/<script[\s\S]*?<\/script>/gi, "");
  if (html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().length < 30) throw new Error("oembed-empty");
  return captureStaticCard(context, item, {
    title: data.author_name ? `@${String(data.author_name).replace(/^@/, "")}` : "X 公開貼文",
    eyebrow: "X · 公開 oEmbed 快照",
    bodyHtml: html,
    method: "x-public-oembed",
    captureUrl: item.replacementUrl,
  });
}

async function recoverBilibili(context, item) {
  const data = await fetchJson(item.replacementUrl);
  if (data.code !== 0 || !data.data?.title) throw new Error(`bilibili-api-${data.code ?? "invalid"}`);
  const video = data.data;
  return captureStaticCard(context, item, {
    title: video.title,
    eyebrow: `哔哩哔哩 · ${video.owner?.name || "公開影片"}`,
    bodyHtml: `<p>${escapeHtml(video.desc || "公開影片資料與封面快照")}</p>`,
    imageUrl: String(video.pic || "").replace(/^http:/, "https:"),
    method: "bilibili-public-view-api",
    captureUrl: item.replacementUrl,
  });
}

async function recoverWikidata(context, item) {
  const id = new URL(item.sourceUrl).pathname.split("/").pop();
  if (!/^Q\d+$/.test(id || "")) throw new Error("wikidata-invalid-id");
  const apiUrl = `https://www.wikidata.org/wiki/Special:EntityData/${id}.json`;
  const data = await fetchJson(apiUrl);
  const entity = data.entities?.[id];
  const label = entity?.labels?.zh?.value || entity?.labels?.en?.value;
  const description = entity?.descriptions?.zh?.value || entity?.descriptions?.en?.value || "Wikidata 公開條目";
  if (!label) throw new Error("wikidata-missing-label");
  return captureStaticCard(context, item, {
    title: label,
    eyebrow: `Wikidata · ${id}`,
    bodyHtml: `<p>${escapeHtml(description)}</p><p>公開結構化條目；聲明數 ${Object.keys(entity.claims || {}).length}</p>`,
    method: "wikidata-entitydata",
    captureUrl: apiUrl,
  });
}

function mediaWikiTitle(rawUrl) {
  const url = new URL(rawUrl);
  const marker = url.pathname.includes("/wiki/") ? "/wiki/" : "/zh-hant/";
  const encoded = url.pathname.split(marker)[1] || "";
  return decodeURIComponent(encoded).replaceAll("_", " ");
}

async function recoverMediaWiki(context, item) {
  const source = new URL(item.replacementUrl || item.sourceUrl);
  const host = source.hostname.replace(".m.wikipedia.org", ".wikipedia.org");
  const title = mediaWikiTitle(source.toString());
  if (!title) throw new Error("mediawiki-missing-title");
  const apiUrl = `https://${host}/w/api.php?action=query&format=json&formatversion=2&redirects=1&prop=extracts%7Cpageimages&exintro=1&explaintext=1&pithumbsize=640&titles=${encodeURIComponent(title)}&origin=*`;
  const data = await fetchJson(apiUrl);
  const page = data.query?.pages?.[0];
  if (!page || page.missing || !page.title) throw new Error("mediawiki-page-missing");
  let extract = String(page.extract || "").trim();
  if (!extract) {
    const parseUrl = `https://${host}/w/api.php?action=parse&format=json&prop=text%7Cdisplaytitle&page=${encodeURIComponent(title)}&origin=*`;
    const parsed = await fetchJson(parseUrl);
    extract = htmlText(parsed.parse?.text?.["*"] || "");
  }
  if (!extract) throw new Error("mediawiki-page-empty");
  return captureStaticCard(context, item, {
    title: page.title,
    eyebrow: host.endsWith("wikisource.org") ? "維基文庫 · 公開 API 快照" : "維基百科 · 公開 API 快照",
    bodyHtml: `<p>${escapeHtml(extract.slice(0, 1_200))}</p>`,
    imageUrl: page.thumbnail?.source || "",
    method: "mediawiki-public-api",
    captureUrl: apiUrl,
  });
}

function htmlText(raw) {
  return String(raw || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function htmlMeta(raw, name) {
  const tags = String(raw || "").match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const property = tag.match(/(?:name|property)=["']([^"']+)["']/i)?.[1]?.toLowerCase();
    if (property !== name.toLowerCase()) continue;
    return tag.match(/content=["']([^"']*)["']/i)?.[1] || "";
  }
  return "";
}

async function recoverPublicHtmlCard(context, item) {
  const target = item.replacementUrl || item.sourceUrl;
  const response = await fetch(target, {
    headers: { accept: "text/html,application/xhtml+xml", "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/136 Safari/537.36" },
    redirect: "follow",
    signal: AbortSignal.timeout(40_000),
  });
  if (response.status < 200 || response.status >= 400) throw new Error(`public-html-${response.status}`);
  const finalUrl = response.url;
  if (REJECT_HOSTS.has(new URL(finalUrl).hostname.toLowerCase())) throw new Error("public-html-login-redirect");
  const raw = await response.text();
  const title = htmlText(raw.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || htmlMeta(raw, "og:title"));
  const description = htmlText(htmlMeta(raw, "description") || htmlMeta(raw, "og:description"));
  const body = htmlText(raw.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] || raw);
  const excerpt = (description || body).slice(0, 1_200);
  if (!title || excerpt.length < 6 || ERROR_COPY.test(`${title} ${excerpt.slice(0, 600)}`)) throw new Error("public-html-insufficient-content");
  return captureStaticCard(context, item, {
    title,
    eyebrow: `${new URL(finalUrl).hostname} · 匿名公開頁快照`,
    bodyHtml: `<p>${escapeHtml(excerpt)}</p>`,
    imageUrl: htmlMeta(raw, "og:image"),
    method: "anonymous-public-html",
    captureUrl: finalUrl,
  });
}

async function recoverPublicHtmlViaCurl(context, item) {
  const target = item.replacementUrl || item.sourceUrl;
  const raw = execFileSync("curl", [
    "--compressed", "--fail", "--silent", "--show-error", "--location",
    "--max-time", "40", "--user-agent", "Mozilla/5.0", target,
  ], { encoding: "utf8", maxBuffer: 2 * 1024 * 1024, timeout: 45_000 });
  const title = htmlText(raw.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || htmlMeta(raw, "og:title"));
  const description = htmlText(htmlMeta(raw, "description") || htmlMeta(raw, "og:description"));
  if (!title || description.length < 6 || ERROR_COPY.test(`${title} ${description}`)) throw new Error("curl-public-html-insufficient-content");
  return captureStaticCard(context, item, {
    title,
    eyebrow: `${new URL(target).hostname} · 匿名公開頁快照`,
    bodyHtml: `<p>${escapeHtml(description)}</p>`,
    imageUrl: htmlMeta(raw, "og:image"),
    method: "anonymous-public-html-curl",
    captureUrl: target,
  });
}

async function captureReviewedDirect(context, item) {
  const evidence = item.liveProbe || {};
  if (!evidence.ok || evidence.notFoundMarker || !evidence.title || Number(evidence.bodyPrefixBytes || 0) < 3_000) {
    return { ok: false, reason: "reviewed-live-evidence-insufficient" };
  }
  const page = await context.newPage();
  try {
    const response = await page.goto(item.replacementUrl || item.sourceUrl, { waitUntil: "domcontentloaded", timeout: 40_000 });
    await page.waitForTimeout(1_500);
    const status = response?.status() || 0;
    const title = (await page.title()).replace(/\s+/g, " ").trim();
    const finalUrl = page.url();
    if (status < 200 || status >= 400 || REJECT_HOSTS.has(new URL(finalUrl).hostname.toLowerCase())) {
      return { ok: false, reason: `reviewed-direct-${status || "bad-final"}`, finalUrl };
    }
    if (!title || (!title.includes(evidence.title) && !evidence.title.includes(title))) {
      return { ok: false, reason: "reviewed-direct-title-mismatch", finalUrl };
    }
    await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}" }).catch(() => {});
    await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
    const png = await page.screenshot({ type: "png", fullPage: false });
    return storeScreenshot(png, {
      sourceUrl: item.sourceUrl,
      title,
      reason: "reviewed-public-recovery",
      captureUrl: finalUrl,
      recoveryMethod: "reviewed-anonymous-page",
    });
  } catch (error) {
    return { ok: false, reason: `reviewed-direct-${error?.name || "error"}:${String(error?.message || error).split("\n", 1)[0].slice(0, 120)}` };
  } finally {
    await page.close().catch(() => {});
  }
}

async function recoverAlipan(context, item) {
  const shareId = new URL(item.sourceUrl).pathname.split("/").filter(Boolean).pop();
  const apiUrl = `https://api.aliyundrive.com/adrive/v3/share_link/get_share_by_anonymous?share_id=${encodeURIComponent(shareId)}`;
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", "user-agent": "YW-public-preview-capture/1.0" },
    body: JSON.stringify({ share_id: shareId }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`alipan-public-api-${response.status}`);
  const data = await response.json();
  const title = data.share_title || data.share_name || data.display_name;
  const files = Array.isArray(data.file_infos) ? data.file_infos.map((file) => file.file_name).filter(Boolean).slice(0, 5) : [];
  if (!title || !files.length) throw new Error("alipan-public-api-empty");
  return captureStaticCard(context, item, {
    title,
    eyebrow: "阿里雲盤 · 匿名公開分享快照",
    bodyHtml: `<p>${escapeHtml(files.join(" · "))}</p><p>公開項目數：${Number(data.file_count) || files.length}</p>`,
    method: "alipan-anonymous-share-api",
    captureUrl: item.sourceUrl,
  });
}

async function recoverDrivePdf(item) {
  const temporary = mkdtempSync(resolve(tmpdir(), "yw-preview-pdf-"));
  try {
    const response = await fetch(item.replacementUrl, {
      headers: { accept: "application/pdf,application/octet-stream", "user-agent": "YW-public-preview-capture/1.0" },
      redirect: "follow",
      signal: AbortSignal.timeout(90_000),
    });
    if (!response.ok) throw new Error(`drive-download-${response.status}`);
    const pdf = Buffer.from(await response.arrayBuffer());
    if (pdf.length < 5 || pdf.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error("drive-download-not-pdf");
    const pdfPath = resolve(temporary, "source.pdf");
    const outputPrefix = resolve(temporary, "page");
    writeFileSync(pdfPath, pdf);
    execFileSync("pdftoppm", ["-f", "1", "-singlefile", "-scale-to-x", "1024", "-scale-to-y", "640", "-png", pdfPath, outputPrefix], {
      timeout: 90_000,
      stdio: "ignore",
    });
    const rendered = await sharp(readFileSync(`${outputPrefix}.png`))
      .resize(1024, 640, { fit: "contain", background: "#f2eee5" })
      .png()
      .toBuffer();
    return storeScreenshot(rendered, {
      sourceUrl: item.sourceUrl,
      title: "Google Drive 公開 PDF · 第一頁",
      reason: "reviewed-public-recovery",
      captureUrl: item.replacementUrl,
      recoveryMethod: "public-pdf-first-page",
    });
  } catch (error) {
    return { ok: false, reason: `recovery-${error?.name || "error"}:${String(error?.message || error).split("\n", 1)[0].slice(0, 140)}` };
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

async function recoverAutoItem(context, item) {
  const sourceHost = new URL(item.sourceUrl).hostname.toLowerCase();
  if (sourceHost === "t.co" || sourceHost === "twitter.com" || sourceHost === "x.com") return recoverX(context, item);
  if (sourceHost === "www.bilibili.com") return recoverBilibili(context, item);
  if (sourceHost === "www.wikidata.org") return recoverWikidata(context, item);
  if (sourceHost === "drive.google.com") return recoverDrivePdf(item);
  if (sourceHost.endsWith("wikipedia.org") || sourceHost.endsWith("wikisource.org")) return recoverMediaWiki(context, item);
  if (sourceHost === "www.alipan.com") return recoverAlipan(context, item);
  if (sourceHost === "matters.town") return recoverPublicHtmlViaCurl(context, item);
  const direct = await capture(context, item.replacementUrl || item.sourceUrl, "reviewed-public-recovery", {
    sourceUrl: item.sourceUrl,
    recoveryMethod: item.replacementUrl && item.replacementUrl !== item.sourceUrl ? "canonical-public-page" : "anonymous-public-page",
  });
  if (direct.ok) return direct;
  if (/direct-(?:thin|login|403|Error)/.test(direct.reason)) {
    const fallback = await recoverPublicHtmlCard(context, item).catch((error) => ({
      ok: false,
      reason: `recovery-${error?.name || "error"}:${String(error?.message || error).split("\n", 1)[0].slice(0, 140)}`,
    }));
    if (fallback.ok) return fallback;
    const reviewed = await captureReviewedDirect(context, item);
    if (reviewed.ok) return reviewed;
    return { ...direct, reason: `${direct.reason};${fallback.reason};${reviewed.reason}` };
  }
  return direct;
}

async function recoverFromAudit(options) {
  const audit = JSON.parse(readFileSync(resolve(options.recoveryAudit), "utf8"));
  const removedAuditItems = audit.items.filter((item) => isRemovedWebResource(item.sourceUrl));
  const auto = audit.items.filter((item) => item.category === "auto-fixable" && !isRemovedWebResource(item.sourceUrl));
  if (auto.length + removedAuditItems.filter((item) => item.category === "auto-fixable").length !== audit.summary?.categoryCounts?.["auto-fixable"]) {
    throw new Error("recovery audit auto-fixable count mismatch");
  }
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  const completedSources = new Set(manifest.entries.map((entry) => entry.sourceUrl));
  const pendingAuto = auto.filter((item) => !completedSources.has(item.sourceUrl));
  const known = new Map([
    ...manifest.entries.map((entry) => [entry.sourceUrl, "entry"]),
    ...(manifest.resolved || []).map((entry) => [entry.sourceUrl, "resolved"]),
    ...(manifest.blocked || []).map((entry) => [entry.sourceUrl, "blocked"]),
  ]);
  for (const item of audit.items) {
    if (!known.has(item.sourceUrl) && !isRemovedWebResource(item.sourceUrl)) {
      throw new Error(`audit source absent from manifest: ${item.sourceUrl}`);
    }
  }
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    ...(existsSync(SYSTEM_BROWSER) ? { executablePath: SYSTEM_BROWSER } : {}),
  });
  const context = await browser.newContext({
    viewport: { width: 1024, height: 640 },
    locale: "zh-CN",
    colorScheme: "light",
    deviceScaleFactor: 1,
  });
  const recovered = [];
  const failures = [];
  await runPool(pendingAuto, async (item, index) => {
    let result;
    try {
      result = await recoverAutoItem(context, item);
    } catch (error) {
      result = { ok: false, reason: `recovery-${error?.name || "error"}:${String(error?.message || error).split("\n", 1)[0].slice(0, 140)}` };
    }
    if (result.ok) recovered.push(result.entry);
    else failures.push({
      sourceUrl: item.sourceUrl,
      reason: result.reason || "recovery-unknown-failure",
      finalUrl: privacyBoundedFinalUrl(result.finalUrl || item.replacementUrl || ""),
      auditCategory: "auto-fixable-retry-failed",
    });
    process.stdout.write(`recover ${index + 1}/${pendingAuto.length} ${result.ok ? "ok" : `skip ${result.reason}`} ${item.sourceUrl}\n`);
  });
  await context.close();
  await browser.close();

  const autoSources = new Set(auto.map((item) => item.sourceUrl));
  const auditBySource = new Map(audit.items.map((item) => [item.sourceUrl, item]));
  const retainedBlocked = (manifest.blocked || [])
    .filter((entry) => !autoSources.has(entry.sourceUrl) && !isRemovedWebResource(entry.sourceUrl))
    .map((entry) => ({ ...entry, auditCategory: auditBySource.get(entry.sourceUrl)?.category || "unclassified" }));
  const entries = [...manifest.entries, ...recovered]
    .filter((entry) => !isRemovedWebResource(entry.sourceUrl))
    .sort((left, right) => left.sourceUrl.localeCompare(right.sourceUrl));
  const totalBytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  if (totalBytes > MAX_TOTAL_BYTES) throw new Error("recovery screenshots exceed 80 MB manifest limit");
  const output = enrichManifest({
    ...manifest,
    recoveredAt: new Date().toISOString(),
    recoveryAuditSchemaVersion: audit.schemaVersion,
    entries,
    blocked: [...retainedBlocked, ...failures],
    screenshotCount: entries.length,
    totalBytes,
    candidateCount: entries.length + (manifest.resolved || []).length + retainedBlocked.length + failures.length,
  });
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(`recovery done: ${recovered.length}/${pendingAuto.length} pending; ${failures.length} retry failures; ${output.blocked.length} blockers remain\n`);
}

async function runPool(entries, worker) {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, entries.length) }, async () => {
    while (cursor < entries.length) {
      const index = cursor++;
      await worker(entries[index], index);
    }
  }));
}

async function main() {
  const options = parseArgs();
  if (options.recoveryAudit) {
    await recoverFromAudit(options);
    return;
  }
  if (options.enrichOnly) {
    const manifest = enrichManifest(JSON.parse(readFileSync(MANIFEST_PATH, "utf8")));
    writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
    process.stdout.write(`enriched ${manifest.entries.length} screenshots and ${manifest.blocked.length} blockers\n`);
    return;
  }
  const registry = JSON.parse(readFileSync(REGISTRY_PATH, "utf8"));
  let targets = registry.targets
    .map(normalizedTarget)
    .filter((target) => !isRemovedWebResource(target))
    .filter((target) => !MEDIA_PATH.test(target))
    .filter((target) => {
      const url = new URL(target);
      return previewUrlHasPublicHostname(url) && !REJECT_HOSTS.has(url.hostname.toLowerCase());
    });
  if (options.limit > 0) targets = targets.slice(0, options.limit);
  const candidates = options.allPages
    ? targets.map((target) => ({ target, reason: "standby-for-runtime-failure" }))
    : [];
  let probed = 0;
  let probeCursor = 0;
  if (!options.allPages) await Promise.all(Array.from({ length: Math.min(PROBE_CONCURRENCY, targets.length) }, async () => {
    while (probeCursor < targets.length) {
      const target = targets[probeCursor++];
      const probe = await needsScreenshot(options.probeBase, target);
      if (probe.needed) candidates.push({ target, reason: probe.reason });
      probed += 1;
      if (probed % 25 === 0 || probed === targets.length) {
        process.stdout.write(`probe ${probed}/${targets.length}; fallback candidates ${candidates.length}\n`);
      }
    }
  }));
  candidates.sort((left, right) => left.target.localeCompare(right.target));

  if (options.clean) rmSync(OUTPUT_DIR, { recursive: true, force: true });
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    ...(existsSync(SYSTEM_BROWSER) ? { executablePath: SYSTEM_BROWSER } : {}),
  });
  const context = await browser.newContext({
    viewport: { width: 1024, height: 640 },
    locale: "zh-CN",
    colorScheme: "light",
    deviceScaleFactor: 1,
  });
  const accepted = [];
  const rejected = [];
  let totalBytes = 0;
  await runPool(candidates, async ({ target, reason }, index) => {
    const result = await capture(context, target, reason);
    if (result.ok) {
      if (totalBytes + result.entry.bytes > MAX_TOTAL_BYTES) {
        rmSync(resolve(ROOT, `site${result.entry.screenshotUrl}`), { force: true });
        rejected.push({ sourceUrl: target, reason: "screenshot-total-over-80mb", finalUrl: "" });
        process.stdout.write(`capture ${index + 1}/${candidates.length} skip screenshot-total-over-80mb ${target}\n`);
      } else {
        totalBytes += result.entry.bytes;
        accepted.push(result.entry);
        process.stdout.write(`capture ${index + 1}/${candidates.length} ok ${target}\n`);
      }
    } else {
      rejected.push({ sourceUrl: target, reason: result.reason, finalUrl: result.finalUrl || "" });
      process.stdout.write(`capture ${index + 1}/${candidates.length} skip ${result.reason} ${target}\n`);
    }
  });
  await context.close();
  await browser.close();

  accepted.sort((left, right) => left.sourceUrl.localeCompare(right.sourceUrl));
  rejected.sort((left, right) => left.sourceUrl.localeCompare(right.sourceUrl));
  const manifest = enrichManifest({
    schemaVersion: "yw-preview-screenshots-v1",
    capturedAt: new Date().toISOString(),
    viewport: { width: 1024, height: 640 },
    totalBytes,
    candidateCount: candidates.length,
    screenshotCount: accepted.length,
    blockedCount: rejected.length,
    entries: accepted,
    blocked: rejected,
  });
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`done: ${accepted.length} screenshots; ${rejected.length} honest blockers\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
