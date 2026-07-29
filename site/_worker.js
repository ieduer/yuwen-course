import {
  assertLearningSubmissionAllowed,
  LearningSubmissionRateLimitError,
  recordLearningInteraction,
  retryPendingEvidence,
} from "./learning-evidence-source.js";

const OWNER = "ieduer";
const REPO = "yuwen-course";
const DISCUSSION_MARKER_PREFIX = "yuwen-course-lesson:";
let ctextSession = { cookie: "", expiresAt: 0 };
let shugeSession = { cookie: "", expiresAt: 0 };
const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/chat" && request.method === "POST") {
      return handleChat(request, env);
    }
    if (url.pathname === "/api/learning-check" && request.method === "POST") {
      return handleLearningCheck(request, env);
    }
    if (url.pathname === "/api/lesson-blueprint" && request.method === "POST") {
      return handleLessonBlueprint(request, env, ctx);
    }
    if (url.pathname === "/api/interaction-check" && request.method === "POST") {
      return handleInteractionCheck(request, env);
    }
    if (url.pathname === "/api/learning/interactions" && request.method === "POST") {
      return handleLearningInteraction(request, env, ctx);
    }
    if (url.pathname === "/api/learning/health" && request.method === "GET") {
      return handleLearningEvidenceHealth(env);
    }
    if (url.pathname === "/api/wy-articles" && request.method === "GET") {
      return handleWyArticles(request, env);
    }
    if (url.pathname.startsWith("/api/reading/")) {
      return handleReading(request, env, url);
    }
    if (url.pathname === "/api/preview" && (request.method === "GET" || request.method === "HEAD")) {
      return handlePreview(request, env);
    }
    if (url.pathname.startsWith("/static/") && (request.method === "GET" || request.method === "HEAD")) {
      return handleCtextStatic(request);
    }
    const discussionMatch = url.pathname.match(/^\/api\/discussions\/([^/]+)$/);
    if (discussionMatch) {
      if (request.method === "GET") return handleDiscussionGet(request, env, discussionMatch[1]);
      if (request.method === "POST") return handleDiscussionPost(request, env, discussionMatch[1]);
    }
    if ((request.method === "GET" || request.method === "HEAD")
      && isNativeContentAssetPath(url.pathname)) {
      return handleNativeContentAsset(request, env, url.pathname);
    }
    return env.ASSETS.fetch(request);
  },
};

function isNativeContentAssetPath(pathname) {
  return pathname === "/app-content/latest-stable.json"
    || pathname.startsWith("/app-content/releases/")
    || /^\/media\/lesson-media\/lesson-[^/]+\/sha256-[a-f0-9]{64}\.pdf$/.test(pathname);
}

async function handleNativeContentAsset(request, env, pathname) {
  const response = await env.ASSETS.fetch(request);
  if (!response.ok) return response;
  const headers = new Headers(response.headers);
  headers.set("x-content-type-options", "nosniff");
  headers.set(
    "cache-control",
    pathname === "/app-content/latest-stable.json"
      ? "no-store, no-transform"
      : "public, max-age=31536000, immutable, no-transform",
  );
  return new Response(request.method === "HEAD" ? null : response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(init.headers || {}),
    },
  });
}

function learningRateLimitResponse(error) {
  const retryAfterSeconds = Math.max(1, Number(error?.retryAfterSeconds) || 600);
  return json({
    ok: false,
    error: "提交过于频繁，请稍后继续修改",
    code: "learning_submission_rate_limited",
    retryAfterSeconds,
  }, {
    status: 429,
    headers: { "retry-after": String(retryAfterSeconds) },
  });
}

function learningMutationConflictResponse() {
  return json({
    ok: false,
    error: "本次提交标识已用于另一学习项目，请刷新后重试",
    code: "learning_mutation_conflict",
  }, { status: 409 });
}

function cleanText(value, max = 4000) {
  return String(value || "").replace(/\r/g, "").trim().slice(0, max);
}

async function handleLearningEvidenceHealth(env) {
  if (!env.USER_CENTER_EVIDENCE
    || typeof env.USER_CENTER_EVIDENCE.getSourceReceipt !== "function"
    || !env.ASSETS
    || typeof env.ASSETS.fetch !== "function") {
    return json({ error: "learning evidence unavailable" }, { status: 503 });
  }
  try {
    const manifestResponse = await env.ASSETS.fetch(
      new Request("https://yw.bdfz.net/data/learning-manifest.json"),
    );
    if (!manifestResponse.ok) throw new Error("learning manifest unavailable");
    const manifest = await manifestResponse.json();
    const descriptor = {
      sourceSiteKey: "yw",
      manifestVersion: manifest?.manifestVersion,
      manifestDigest: manifest?.resourceKeyHash,
      itemCount: Number(manifest?.itemCount),
      loaderContractVersion: "yuwen-queue-ledger-v1",
    };
    const receipt = await env.USER_CENTER_EVIDENCE.getSourceReceipt(descriptor);
    if (receipt?.ok !== true
      || receipt?.status !== "active"
      || receipt?.sourceSiteKey !== "yw"
      || receipt?.loaderContractVersion !== "yuwen-queue-ledger-v1"
      || receipt?.manifestVersion !== manifest?.manifestVersion
      || receipt?.manifestDigest !== manifest?.resourceKeyHash
      || Number(receipt?.itemCount) !== Number(manifest?.itemCount)) {
      return json({ error: "learning evidence contract mismatch" }, { status: 503 });
    }
    return json({ ok: true, receipt });
  } catch {
    return json({ error: "learning evidence unavailable" }, { status: 503 });
  }
}

async function handleWyArticles() {
  const response = await fetch("https://wy.bdfz.net/api/bootstrap", {
    headers: {
      "accept": "application/json",
      "user-agent": "bdfz-yuwen-course",
    },
    cf: { cacheTtl: 300, cacheEverything: true },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return json({ error: data?.error || `wy ${response.status}` }, { status: 502 });
  const articles = Array.isArray(data.articles) ? data.articles.map((article) => ({
    article_id: article.article_id,
    book_key: article.book_key,
    book_title: article.book_title,
    title: article.title,
    manifest_title: article.manifest_title,
    author: article.author,
    page_start: article.page_start,
    page_end: article.page_end,
    challenge_count: article.challenge_count,
    content_count: article.content_count,
    function_count: article.function_count,
    note_count: article.note_count,
  })) : [];
  return json({ source: "https://wy.bdfz.net/api/bootstrap", articles }, {
    headers: { "cache-control": "public, max-age=300" },
  });
}

function previewAllowed(url) {
  if (!["http:", "https:"].includes(url.protocol)) return false;
  const host = url.hostname.toLowerCase();
  if (/^(localhost|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(host)) return false;
  return true;
}

function filenameFromUrl(url) {
  const last = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() || "preview.pdf");
  return last.replace(/[^\w.\-\u4e00-\u9fff]+/g, "_") || "preview.pdf";
}

function asciiHeaderFilename(value) {
  const safe = String(value || "preview")
    .replace(/[^\x20-\x7e]+/g, "_")
    .replace(/["\\;]+/g, "_")
    .trim();
  return safe || "preview";
}

function encodeHeaderFilename(value) {
  return encodeURIComponent(String(value || "preview"))
    .replace(/['()]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/\*/g, "%2A");
}

function contentDispositionValue(disposition, filename) {
  return `${disposition}; filename="${asciiHeaderFilename(filename)}"; filename*=UTF-8''${encodeHeaderFilename(filename)}`;
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[ch]));
}

function clearFrameBlockingHeaders(headers) {
  headers.delete("content-security-policy");
  headers.delete("content-security-policy-report-only");
  headers.delete("x-frame-options");
  headers.delete("set-cookie");
  headers.delete("content-length");
  headers.delete("content-encoding");
}

function isCtextUrl(url) {
  const host = url.hostname.toLowerCase();
  return host === "ctext.org" || host.endsWith(".ctext.org");
}

function isYuqueUrl(url) {
  const host = url.hostname.toLowerCase();
  return host === "yuque.com" || host.endsWith(".yuque.com");
}

function extractYuqueAppData(html) {
  const match = String(html || "").match(/window\.appData\s*=\s*JSON\.parse\(decodeURIComponent\("(.+?)"\)\)/s);
  if (!match) return null;
  try {
    return JSON.parse(decodeURIComponent(match[1]));
  } catch {
    return null;
  }
}

function yuqueNodeHref(target, book, node) {
  const raw = String(node?.url || "").trim();
  if (!raw) return target.href;
  if (/^https?:\/\//i.test(raw)) return raw;
  const parts = target.pathname.split("/").filter(Boolean);
  const namespace = parts[0] || "";
  const bookSlug = book?.slug || parts[1] || "";
  if (!namespace || !bookSlug) return target.href;
  return `${target.origin}/${namespace}/${bookSlug}/${encodeURIComponent(raw)}`;
}

function yuqueStaticPreviewHtml(html, target) {
  if (!isYuqueUrl(target)) return "";
  const data = extractYuqueAppData(html);
  const book = data?.book || null;
  const doc = data?.doc || null;
  if (!book && !doc) return "";
  const title = doc?.title || book?.name || "語雀";
  const toc = Array.isArray(book?.toc) ? book.toc : [];
  const tocHtml = toc.length ? `
    <ol class="yuque-toc">
      ${toc.map((node) => {
        const level = Math.max(0, Math.min(4, Number(node?.level || 0)));
        const text = node?.title || node?.label || node?.url || "未命名";
        const href = yuqueNodeHref(target, book, node);
        return `<li style="--level:${level}"><a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${escapeHtml(text)}</a></li>`;
      }).join("")}
    </ol>
  ` : `<p class="empty">此語雀頁未公開目錄內容，可點右上角打開源頁。</p>`;
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <base href="${escapeHtml(target.href)}">
  <style>
    :root{color-scheme:light}
    body{margin:0;padding:24px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.7;color:#243a40;background:#fff}
    header{margin:0 0 18px;padding-bottom:14px;border-bottom:1px solid #dbe4df}
    h1{margin:0;font-size:1.55rem;line-height:1.25;color:#20383f}
    .meta{margin:8px 0 0;color:#667a75;font-size:.92rem}
    .yuque-toc{list-style:none;margin:0;padding:0;display:grid;gap:8px}
    .yuque-toc li{margin-left:calc(var(--level) * 18px)}
    .yuque-toc a{display:block;padding:10px 12px;border:1px solid #dbe4df;border-radius:8px;color:#294f49;text-decoration:none;background:#fbfbf6}
    .yuque-toc a:hover{border-color:#7b9d93;background:#f3f8f4}
    .empty{color:#667a75}
  </style>
</head>
<body>
  <header>
    <h1>${escapeHtml(title)}</h1>
    <p class="meta">語雀嵌入預覽 · ${toc.length ? `${toc.length} 個條目` : "源頁"}</p>
  </header>
  ${tocHtml}
</body>
</html>`;
}

function shouldUseCtextAuth(url) {
  if (!isCtextUrl(url)) return false;
  const path = url.pathname.toLowerCase();
  if (/\/(account|password|logout|login|user|users|admin|discuss|message|mail|inbox|settings)\.pl$/.test(path)) {
    return false;
  }
  return true;
}

async function handleCtextStatic(request) {
  const requestUrl = new URL(request.url);
  const target = new URL(`${requestUrl.pathname}${requestUrl.search}`, "https://ctext.org");
  const upstream = await fetch(target.toString(), {
    method: request.method,
    headers: {
      "user-agent": BROWSER_UA,
      "accept": request.headers.get("accept") || "*/*",
      "referer": "https://ctext.org/",
    },
    cf: { cacheTtl: 3600, cacheEverything: true },
  });
  const headers = new Headers(upstream.headers);
  clearFrameBlockingHeaders(headers);
  headers.delete("set-cookie");
  headers.set("access-control-allow-origin", "*");
  headers.set("cache-control", "public, max-age=3600");
  return new Response(request.method === "HEAD" ? null : upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

function isShugeUrl(url) {
  const host = url.hostname.toLowerCase();
  return host === "shuge.org" || host.endsWith(".shuge.org");
}

function splitSetCookieHeader(value) {
  if (!value) return [];
  return String(value).split(/,(?=\s*[^;,\s]+=)/g).map((item) => item.trim()).filter(Boolean);
}

function setCookieHeaders(headers) {
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  return splitSetCookieHeader(headers.get("set-cookie") || "");
}

function cookieHeaderFromSetCookies(values) {
  return values
    .map((value) => String(value).split(";")[0].trim())
    .filter((value) => value && !/^deleted=/i.test(value))
    .join("; ");
}

function mergeCookieHeaders(left, right) {
  const cookies = new Map();
  `${left || ""}; ${right || ""}`.split(";").forEach((part) => {
    const item = part.trim();
    const index = item.indexOf("=");
    if (index <= 0) return;
    cookies.set(item.slice(0, index), item.slice(index + 1));
  });
  return [...cookies].map(([key, value]) => `${key}=${value}`).join("; ");
}

function scrubCtextPreviewHtml(html) {
  return html
    .replace(/<div id=["']logininfo["'][\s\S]*?<\/div>/i, `<div id="logininfo">課程嵌入預覽</div>`)
    .replace(/,\s*target-densitydpi\s*=\s*[^,"']+/gi, "")
    .replace(/<span style=["']opacity:\s*0\.0;[^>]*>[\s\S]*?<\/span>/gi, "");
}

function rewritePreviewHtml(html, target) {
  const yuqueHtml = yuqueStaticPreviewHtml(html, target);
  if (yuqueHtml) return yuqueHtml;
  const origin = target.origin;
  let staticHtml = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<script\b[^>]*\/?>/gi, "")
    .replace(/<meta\b[^>]+http-equiv=["']?refresh["']?[^>]*>/gi, "")
    .replace(/\s+on[a-z]+=(["']).*?\1/gi, "")
    .replace(/\s+on[a-z]+=[^\s>]+/gi, "")
    .replace(/\b(href|src|action)=(["'])\s*javascript:[\s\S]*?\2/gi, (_match, attr, quote) => `${attr}=${quote}#${quote}`)
    .replace(/\b(href|src|action)=javascript:[^\s>]+/gi, (_match, attr) => `${attr}="#"`)
    .replace(/\b(href|src|action)=(["'])\/(?!\/)/gi, (_match, attr, quote) => `${attr}=${quote}${origin}/`)
    .replace(/\b(href|src|action)=(["'])\/\//gi, (_match, attr, quote) => `${attr}=${quote}${target.protocol}//`);
  if (isCtextUrl(target)) staticHtml = scrubCtextPreviewHtml(staticHtml);
  const base = `<base href="${escapeHtml(target.href)}">`;
  const style = `<style>html{background:#fff}body{max-width:980px;margin:0 auto;padding:20px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.7}img,video,iframe{max-width:100%;height:auto}</style>`;
  if (/<head[^>]*>/i.test(staticHtml)) {
    return staticHtml.replace(/<head([^>]*)>/i, `<head$1>${base}${style}`);
  }
  return `<!doctype html><html><head>${base}${style}</head><body>${staticHtml}</body></html>`;
}

function unavailablePdfHtml(target) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;padding:24px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.7;color:#31444b;background:#fff}a{color:#426d65}</style></head><body><h2>PDF 暫不可預覽</h2><p>源站返回的是登錄頁或 HTML，不是公開 PDF。已保留外部打開入口；若源站恢復公開文件，這裏會自動恢復預覽。</p><p><a href="${escapeHtml(target.href)}" target="_blank" rel="noreferrer">打開源鏈接</a></p></body></html>`;
}

function redirectLookupKeys(url) {
  const keys = [url.toString()];
  const noHash = new URL(url.toString());
  noHash.hash = "";
  keys.push(noHash.toString());
  return [...new Set(keys)];
}

async function getResourceRedirects(request, env) {
  try {
    const assetUrl = new URL("/data/resource_redirects.json", request.url);
    const response = await env.ASSETS.fetch(new Request(assetUrl.toString(), { method: "GET" }));
    if (!response.ok) return {};
    const data = await response.json();
    return data?.redirects || {};
  } catch {
    return {};
  }
}

async function resolvePreviewTarget(request, env, target) {
  if (
    target.hostname.toLowerCase() !== "forum.rdfzer.com"
    || !target.pathname.startsWith("/uploads/short-url/")
  ) {
    return target;
  }
  const redirects = await getResourceRedirects(request, env);
  for (const key of redirectLookupKeys(target)) {
    if (redirects[key]) return new URL(redirects[key]);
  }
  return target;
}

async function getCtextCookie(env) {
  const username = env.CTEXT_USERNAME || env.CTEXT_USER || "";
  const password = env.CTEXT_PASSWORD || env.CTEXT_PASS || "";
  if (!username || !password) return "";
  if (ctextSession.cookie && Date.now() < ctextSession.expiresAt) return ctextSession.cookie;

  const body = new URLSearchParams();
  body.set("un", username);
  body.set("pw", password);
  body.set("if", "gb");
  body.set("redirect", "/pre-qin-and-han/zh");
  body.set("nologout", "on");

  const response = await fetch("https://ctext.org/account.pl", {
    method: "POST",
    headers: {
      "user-agent": "bdfz-yuwen-course-preview",
      "accept": "text/html,application/xhtml+xml",
      "content-type": "application/x-www-form-urlencoded",
      "origin": "https://ctext.org",
      "referer": "https://ctext.org/account.pl?if=gb",
    },
    body,
    redirect: "manual",
  });
  const cookie = cookieHeaderFromSetCookies(setCookieHeaders(response.headers));
  if (!cookie) return "";
  ctextSession = {
    cookie,
    expiresAt: Date.now() + 6 * 60 * 60 * 1000,
  };
  return cookie;
}

async function fetchPreviewUpstream(request, target, headers, env) {
  if (shouldUseCtextAuth(target)) {
    const cookie = await getCtextCookie(env);
    if (cookie) headers.set("cookie", cookie);
    headers.set("accept", "text/html,application/xhtml+xml");
    headers.set("referer", "https://ctext.org/");
  }
  if (isShugeUrl(target)) {
    headers.set("user-agent", BROWSER_UA);
    headers.set("accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
    headers.set("accept-language", "zh-CN,zh;q=0.9,en;q=0.8");
    headers.set("referer", "https://www.shuge.org/");
    if (shugeSession.cookie && Date.now() < shugeSession.expiresAt) headers.set("cookie", shugeSession.cookie);
  }
  let response = await fetch(target.toString(), {
    method: request.method,
    headers,
    redirect: "follow",
  });
  if (isShugeUrl(target)) {
    const freshCookie = cookieHeaderFromSetCookies(setCookieHeaders(response.headers));
    if (freshCookie) {
      shugeSession = {
        cookie: mergeCookieHeaders(shugeSession.cookie, freshCookie),
        expiresAt: Date.now() + 60 * 60 * 1000,
      };
    }
    if (response.status === 403 && shugeSession.cookie) {
      headers.set("cookie", shugeSession.cookie);
      response = await fetch(target.toString(), {
        method: request.method,
        headers,
        redirect: "follow",
      });
    }
  }
  return response;
}

async function handlePreview(request, env) {
  const requestUrl = new URL(request.url);
  const targetRaw = requestUrl.searchParams.get("url") || "";
  let target;
  try {
    target = new URL(targetRaw);
  } catch {
    return new Response("bad url", { status: 400 });
  }
  target = await resolvePreviewTarget(request, env, target);
  if (!previewAllowed(target)) return new Response("url is not allowed", { status: 400 });
  const headers = new Headers({
    "user-agent": "bdfz-yuwen-course-preview",
    "accept": request.headers.get("accept") || "*/*",
  });
  const range = request.headers.get("range");
  if (range) headers.set("range", range);
  const upstream = await fetchPreviewUpstream(request, target, headers, env);
  const responseHeaders = new Headers(upstream.headers);
  const type = responseHeaders.get("content-type") || "";
  const isPdf = /\.pdf$/i.test(target.pathname) || /application\/pdf/i.test(type);
  const isHtml = /text\/html|application\/xhtml\+xml/i.test(type);
  clearFrameBlockingHeaders(responseHeaders);
  responseHeaders.set("access-control-allow-origin", "*");
  responseHeaders.set("x-content-type-options", "nosniff");
  responseHeaders.set(
    "content-disposition",
    contentDispositionValue(requestUrl.searchParams.get("download") ? "attachment" : "inline", filenameFromUrl(target))
  );
  if (isPdf && !type) responseHeaders.set("content-type", "application/pdf");
  if (isPdf && isHtml && request.method !== "HEAD") {
    responseHeaders.set("content-type", "text/html; charset=utf-8");
    responseHeaders.set("cache-control", "public, max-age=120");
    return new Response(unavailablePdfHtml(target), {
      status: 200,
      headers: responseHeaders,
    });
  }
  if (isHtml && request.method !== "HEAD") {
    const html = await upstream.text();
    responseHeaders.set("content-type", "text/html; charset=utf-8");
    responseHeaders.set("cache-control", "no-store, no-transform");
    return new Response(rewritePreviewHtml(html, target), {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  }
  return new Response(request.method === "HEAD" ? null : upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

async function getManifest(request, env) {
  const url = new URL("/data/manifest.json", request.url);
  const response = await env.ASSETS.fetch(new Request(url.toString(), { method: "GET" }));
  if (!response.ok) return null;
  return response.json();
}

async function getLessonMeta(request, env, lessonId) {
  const manifest = await getManifest(request, env);
  return manifest?.lessons?.find((item) => item.id === lessonId) || { id: lessonId, title: lessonId, blockTitle: "課文" };
}

async function getLessonData(request, env, lessonId) {
  const meta = await getLessonMeta(request, env, lessonId);
  if (!meta?.dataUrl || meta.id !== lessonId) return meta;
  const url = new URL(`/${String(meta.dataUrl).replace(/^\/+/, "")}`, request.url);
  const response = await env.ASSETS.fetch(new Request(url.toString(), { method: "GET" }));
  if (!response.ok) return meta;
  const lesson = await response.json().catch(() => null);
  return lesson?.id === lessonId ? { ...meta, ...lesson } : meta;
}

function githubHeaders(env) {
  const headers = {
    "accept": "application/vnd.github+json",
    "user-agent": "bdfz-yuwen-course",
    "x-github-api-version": "2022-11-28",
  };
  if (env.GITHUB_TOKEN) headers.authorization = `Bearer ${env.GITHUB_TOKEN}`;
  return headers;
}

async function githubFetch(env, path, init = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      ...githubHeaders(env),
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    throw new Error(data?.message || `GitHub ${response.status}`);
  }
  return data;
}

async function findIssue(env, lessonId) {
  const marker = `${DISCUSSION_MARKER_PREFIX}${lessonId}`;
  const q = encodeURIComponent(`repo:${OWNER}/${REPO} is:issue "${marker}" in:body`);
  const result = await githubFetch(env, `/search/issues?q=${q}&per_page=1`);
  return result.items?.[0] || null;
}

async function createIssue(env, lesson) {
  const marker = `${DISCUSSION_MARKER_PREFIX}${lesson.id}`;
  const body = [
    `<!-- ${marker} -->`,
    `本 Issue 對應 yw.bdfz.net 課文討論。`,
    ``,
    `- 課文：${lesson.blockTitle} / ${lesson.title}`,
    `- Topic：${lesson.topicId || lesson.id}`,
    `- 站內：https://yw.bdfz.net/#${lesson.id}`,
    lesson.forumUrl ? `- 論壇原帖：${lesson.forumUrl}` : null,
  ].filter(Boolean).join("\n");
  const payload = {
    title: `[課文討論] ${lesson.blockTitle} / ${lesson.title}`,
    body,
    labels: ["lesson-discussion"],
  };
  try {
    return await githubFetch(env, `/repos/${OWNER}/${REPO}/issues`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  } catch (error) {
    delete payload.labels;
    return githubFetch(env, `/repos/${OWNER}/${REPO}/issues`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }
}

async function handleDiscussionGet(request, env, lessonId) {
  try {
    const issue = await findIssue(env, lessonId);
    if (!issue) return json({ issueUrl: null, comments: [] });
    const comments = await githubFetch(env, `/repos/${OWNER}/${REPO}/issues/${issue.number}/comments?per_page=100`);
    return json({
      issueUrl: issue.html_url,
      issueNumber: issue.number,
      comments: comments.map((item) => ({
        id: item.id,
        author: item.user?.login,
        body: stripMarker(item.body || ""),
        createdAt: item.created_at,
        url: item.html_url,
      })),
    });
  } catch (error) {
    if (/Not Found|Validation Failed/i.test(error.message)) {
      return json({ issueUrl: null, comments: [] });
    }
    return json({ error: error.message }, { status: 502 });
  }
}

async function handleDiscussionPost(request, env, lessonId) {
  if (!env.GITHUB_TOKEN) return json({ error: "GITHUB_TOKEN is not configured" }, { status: 503 });
  const payload = await request.json().catch(() => ({}));
  if (payload.website) return json({ ok: true, ignored: true });
  const body = cleanText(payload.body, 4000);
  const name = cleanText(payload.name, 40).replace(/[\n\r]/g, " ") || "匿名同學";
  if (body.length < 2) return json({ error: "body is required" }, { status: 400 });
  try {
    const lesson = await getLessonMeta(request, env, lessonId);
    let issue = await findIssue(env, lessonId);
    if (!issue) issue = await createIssue(env, lesson);
    const comment = await githubFetch(env, `/repos/${OWNER}/${REPO}/issues/${issue.number}/comments`, {
      method: "POST",
      body: JSON.stringify({
        body: `**${name}**\n\n${body}`,
      }),
    });
    return json({ ok: true, issueUrl: issue.html_url, commentUrl: comment.html_url });
  } catch (error) {
    return json({ error: error.message }, { status: 502 });
  }
}

function stripMarker(value) {
  return value.replace(/<!--[\s\S]*?-->/g, "").trim();
}

async function handleChat(request, env) {
  const payload = await request.json().catch(() => ({}));
  const messages = Array.isArray(payload.messages) ? payload.messages.slice(-12) : [];
  const lessonTitle = cleanText(payload.lessonTitle, 120);
  const blockTitle = cleanText(payload.blockTitle, 40);
  const excerpt = cleanText(payload.excerpt, 900);
  const resourceLines = Array.isArray(payload.resources)
    ? payload.resources.slice(0, 16).map((item) => {
      const text = cleanText(item.text || item.href, 120);
      const href = cleanText(item.href, 220);
      const kind = cleanText(item.kind, 24);
      const postNumber = cleanText(item.postNumber, 12);
      return `#${postNumber || "?"} ${kind || "resource"} ${text} ${href}`.trim();
    }).join("\n").slice(0, 1800)
    : "";
  const pageLines = Array.isArray(payload.textbookPages)
    ? payload.textbookPages.slice(0, 12).map((item) => `${cleanText(item.label, 24)} ${cleanText(item.src, 180)}`.trim()).join("\n").slice(0, 1200)
    : "";

  if (!messages.length) return json({ error: "messages required" }, { status: 400 });

  const system = [
    "你是高中語文學習教練，不替學生完成作業，而是把問題拆成可學會的步驟。",
    "回答要緊扣課文、教材圖頁、論壇資源和學生已提出的問題。",
    "每次優先給：文本證據、思路拆解、下一個可操作問題。語氣直接、清楚、有啟發。",
    "用繁體中文回答；必要時引用簡短原文，但避免大段搬運。",
    "",
    `當前課文：${blockTitle} / ${lessonTitle}`,
    `課文摘錄：${excerpt}`,
    resourceLines ? `學習資源：\n${resourceLines}` : "",
    pageLines ? `教材圖頁：\n${pageLines}` : "",
  ].join("\n");

  const apiMessages = [
    { role: "system", content: system },
    ...messages.map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: cleanText(message.content, 2000),
    })),
  ];

  try {
    const reply = await callApisGateway(env, apiMessages);
    return json({ provider: "apis", reply });
  } catch {
    const last = cleanText(messages[messages.length - 1]?.content, 500);
    return json({
      provider: "local-fallback",
      reply: [
        `先把問題扣回《${lessonTitle}》。`,
        `你剛才問的是：「${last}」。`,
        "可先做三步：1. 找一句原文作證據；2. 說清這句的字面意思與語氣；3. 再問它和本課核心問題的關係。若要更精準，把你選中的原句貼進來，我再逐句拆。",
      ].join("\n"),
    });
  }
}

function extractJsonObject(value) {
  const text = String(value || "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function normalizeAssessment(value, fallbackText = "", speaker = "作者") {
  const score = Math.max(1, Math.min(100, Number(value?.score || 0) || 60));
  return {
    score,
    verdict: cleanText(value?.verdict || (score >= 80 ? "你已讀進我這篇文字" : "你已提出判斷，我還想看見更精確的證據"), 120),
    strength: cleanText(value?.strength || `我看見你能回到原文提出自己的理解。`, 500),
    gap: cleanText(value?.gap || `我還要你說清所引字句如何通向我的結構或立意。`, 500),
    nextQuestion: cleanText(value?.nextQuestion || `如果換用另一處原文，你對我這篇文字的判斷仍然成立嗎？`, 500),
    raw: cleanText(fallbackText, 2000),
  };
}

function normalizeBlueprint(value, fallbackTitle = "本文", speaker = "作者") {
  return {
    structureFocus: cleanText(value?.structureFocus || `我是${speaker}。我把最關鍵的材料放在這裡；你能說清若抽掉或換序，全文會失去什麼嗎？`, 300),
  };
}

async function handleLessonBlueprint(request, env, ctx) {
  const payload = await request.json().catch(() => ({}));
  const lessonId = cleanText(payload.lessonId, 80);
  const lessonTitle = cleanText(payload.lessonTitle, 160);
  const mode = cleanText(payload.mode, 40);
  const genres = Array.isArray(payload.genres) ? payload.genres.map((item) => cleanText(item, 40)).filter(Boolean).slice(0, 8) : [];
  const authors = Array.isArray(payload.authors) ? payload.authors.map((item) => cleanText(item, 40)).filter(Boolean).slice(0, 4) : [];
  const speaker = authors[0] || (mode.startsWith("unit") ? "編者" : "作者");
  const excerpt = cleanText(payload.excerpt, 4200);
  if (!lessonId || !lessonTitle || excerpt.length < 80) return json({ error: "lesson id, title and excerpt are required" }, { status: 400 });
  const cache = caches.default;
  const cacheUrl = new URL(`/api/lesson-blueprint-cache/${encodeURIComponent(lessonId)}`, request.url);
  cacheUrl.searchParams.set("v", "participation-matrix-v5");
  cacheUrl.searchParams.set("speaker", speaker);
  const cacheKey = new Request(cacheUrl.toString(), { method: "GET" });
  const cached = await cache.match(cacheKey);
  if (cached) {
    const payload = await cached.json();
    return json({ ...payload, cached: true }, {
      headers: { "cache-control": "public, max-age=604800", "x-yw-blueprint-cache": "HIT" },
    });
  }
  const prompt = [
    "你是高中語文教材的細讀任務設計員。只根據提供的正文，找出作者在結構文章時最用心、最值得學生體悟的一個具體安排。",
    "禁止使用放諸四海皆準的空話。必須能在摘錄中定位，並說明材料次序、轉折、視角、意象、聲律、論證、場面或收束中的一項。",
    `你必須完全使用${speaker}的第一人稱口吻，像作者本人正在向讀者發問；不要寫「作者如何」「向作者提問」等第三人稱模板。`,
    "structureFocus 由作者本人揭示最在意的具體章法，再反問學生若換序或抽掉會損失什麼。",
    "只輸出 JSON：structureFocus(作者口吻的一句具體結構追問)。不要 Markdown。",
    `篇目：${lessonTitle}`,
    `掌握模式：${mode}`,
    `多層文體：${genres.join(" / ")}`,
    `正文摘錄：${excerpt}`,
  ].join("\n");
  try {
    const raw = await callApisPrompt(env, prompt, "lesson-plan", "medium");
    const parsed = extractJsonObject(raw);
    const response = json({ provider: "apis", cached: false, blueprint: normalizeBlueprint(parsed, lessonTitle, speaker) }, {
      headers: { "cache-control": "public, max-age=604800", "x-yw-blueprint-cache": "MISS" },
    });
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  } catch (error) {
    return json({ error: error.message || "lesson blueprint unavailable" }, { status: 502 });
  }
}

async function handleInteractionCheck(request, env) {
  const payload = await request.json().catch(() => ({}));
  const lessonId = cleanText(payload.lessonId, 80);
  if (!/^lesson-[\w-]{1,60}$/.test(lessonId)) {
    return json({ error: "valid lesson id required" }, { status: 400 });
  }
  const lesson = await getLessonData(request, env, lessonId);
  const lessonTitle = cleanText(lesson.title || lesson.tocLabel, 160);
  const blockTitle = cleanText(lesson.blockTitle, 80);
  const mode = cleanText(payload.mode, 40);
  const authors = Array.isArray(payload.authors) ? payload.authors.map((item) => cleanText(item, 40)).filter(Boolean).slice(0, 4) : [];
  const speaker = authors[0] || (mode.startsWith("unit") ? "編者" : "作者");
  const interaction = cleanText(payload.interaction, 40);
  const excerpt = cleanText(
    lesson.posts?.find((post) => post.kind === "primary")?.plain_text
      || lesson.posts?.[0]?.plain_text
      || lesson.excerpt,
    5200
  );
  const input = payload.input && typeof payload.input === "object" ? payload.input : {};
  const inputText = Object.entries(input).map(([key, value]) => `${key}: ${cleanText(value, 1800)}`).join("\n");
  if (!lessonTitle || !["contextWords", "authorQuestion", "revision", "structure", "wordCreation"].includes(interaction) || inputText.length < 6) {
    return json({ error: "valid lesson, interaction and student input are required" }, { status: 400 });
  }
  const criteria = {
    contextWords: "核查學生給出的三個詞是否各有區分度，並能由作者、文體、字句或立意得到支持。泛泛的好、優美、感人不得超過59分；恰好三詞且能形成對作者與文章的整體判斷才可高分。",
    authorQuestion: "把自己放在作者或編者的位置，判斷這個問題能否證明提問者讀到了具體字句、結構選擇或價值矛盾。只問常識、感想或可脫離文本回答的問題不得超過59分。",
    revision: "判斷增、刪、調是否抵達文字底層。必須比較原文和改文在語義、語氣、節奏、意象、人物、論證或結構上的實際得失；只說更生動更好不得超過59分。",
    structure: "核查學生選出的章法機關是否能在正文定位，並能說清若抽掉或換序會損失什麼。只概括段意不得超過59分。",
    wordCreation: "核查新學字詞在三句小說、短詩、對白、微報道或微論證中的詞義、語境和搭配是否成立；創作短但準確可得高分。",
  }[interaction];
  const prompt = [
    `你就是《${lessonTitle}》的${speaker}。始終使用${speaker}本人的第一人稱身分與學生交談，不得退回「評估員」「作者認為」或第三人稱口吻。`,
    "你嚴格但可操作，不代寫，只判斷學生是否真正進入文本。",
    criteria,
    "所有判斷必須服從原文；摘錄不足時應指出需回到哪類原文，不要編造。",
    `只輸出 JSON：score(1-100整數)、verdict(一句話)、strength(我以${speaker}身分指出已掌握的一點)、gap(我指出最關鍵缺口)、nextQuestion(我只追問一個迫使學生回到文本的問題)。四個文字欄都必須是${speaker}的第一人稱口吻。不要 Markdown。`,
    `課文：${blockTitle} / ${lessonTitle}`,
    `文體掌握模式：${mode}`,
    `互動類型：${interaction}`,
    `正文摘錄：${excerpt}`,
    `學生輸入：\n${inputText}`,
  ].join("\n");
  const sourcePayload = {
    ...input,
    clientMutationId: cleanText(payload.clientMutationId, 100),
    classSessionId: cleanText(payload.classSessionId, 100),
    lessonPhase: cleanText(payload.lessonPhase, 60),
  };
  try {
    const student = await getReadingStudent(request, env);
    if (student) {
      const submissionGuard = await assertLearningSubmissionAllowed({
        request,
        env,
        student,
        lesson,
        interactionKey: interaction,
        payload: sourcePayload,
      });
      if (submissionGuard.deduped) {
        return json({
          provider: submissionGuard.evaluation?.provider || "source-ledger",
          assessment: normalizeAssessment(submissionGuard.evaluation, "", speaker),
          evidence: {
            status: submissionGuard.eligibilityStatus === "ineligible"
              ? "already_recorded_ineligible"
              : "already_recorded",
            sourceEventId: submissionGuard.sourceEventId,
            attemptNo: submissionGuard.attemptNo,
          },
          deduped: true,
        });
      }
    }
    const raw = await callApisPrompt(env, prompt, "feedback", "medium");
    const parsed = extractJsonObject(raw);
    const assessment = normalizeAssessment(parsed, parsed ? "" : raw, speaker);
    let evidence = { status: "anonymous" };
    if (student) {
      const recorded = await recordLearningInteraction({
        request,
        env,
        student,
        lesson,
        interactionKey: interaction,
        payload: sourcePayload,
        evaluation: {
          score: assessment.score,
          correctness: assessment.score >= 60 ? "passed" : "needs_revision",
          provider: "apis",
          verdict: assessment.verdict,
          strength: assessment.strength,
          gap: assessment.gap,
          nextQuestion: assessment.nextQuestion,
        },
      });
      evidence = { status: recorded.delivery || "recorded", sourceEventId: recorded.sourceEventId, attemptNo: recorded.attemptNo };
    }
    return json({ provider: "apis", assessment, evidence });
  } catch (error) {
    if (error instanceof LearningSubmissionRateLimitError) return learningRateLimitResponse(error);
    if (error?.code === "learning_mutation_conflict") return learningMutationConflictResponse();
    return json({ error: error.message || "interaction assessment unavailable" }, { status: 502 });
  }
}

async function handleLearningCheck(request, env) {
  const payload = await request.json().catch(() => ({}));
  const lessonId = cleanText(payload.lessonId, 80);
  const lessonTitle = cleanText(payload.lessonTitle, 160);
  const blockTitle = cleanText(payload.blockTitle, 60);
  const genre = cleanText(payload.genre, 30);
  const excerpt = cleanText(payload.excerpt, 2400);
  const evidence = cleanText(payload.evidence, 500);
  const question = cleanText(payload.question, 600);
  const answer = cleanText(payload.answer, 3000);
  if (!lessonId || !lessonTitle || !evidence || answer.length < 30) {
    return json({ error: "lesson, evidence and an answer of at least 30 characters are required" }, { status: 400 });
  }

  const prompt = [
    "你是高中語文細讀能力評估員。你的工作不是替學生改寫答案，而是確認他是否真正讀懂文本。",
    "評估順序必須是：原文證據是否準確 → 字句效果是否說清 → 結構關係是否成立 → 立意或知人論世是否有文本支撐。",
    "不要因篇幅、術語或價值立場給高分。沒有分析所引字句的具體作用，最高 69 分；只有主題概括而無結構推理，最高 59 分。",
    "只輸出一個 JSON 物件，不要 Markdown，不要答案示範。JSON 欄位固定為：score(1-100整數)、verdict(一句話)、strength(已掌握的一點)、gap(最關鍵缺口)、nextQuestion(只追問一個能迫使學生回到文本的問題)。",
    "",
    `課文：${blockTitle} / ${lessonTitle}`,
    `課文類型：${genre}`,
    `確認問題：${question}`,
    `課文摘錄：${excerpt}`,
    `學生選取的證據：${evidence}`,
    `學生答辯：${answer}`,
  ].join("\n");

  try {
    const raw = await callApisPrompt(env, prompt, "feedback", "medium");
    const parsed = extractJsonObject(raw);
    return json({ provider: "apis", assessment: normalizeAssessment(parsed, parsed ? "" : raw) });
  } catch (error) {
    return json({ error: error.message || "learning assessment unavailable" }, { status: 502 });
  }
}

async function callApisPrompt(env, prompt, taskType = "chat", thinkingLevel = "low") {
  const response = await fetch(env.APIS_ENDPOINT || "https://apis.bdfz.net", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "origin": "https://yw.bdfz.net",
      "x-project-name": "yw.bdfz.net",
      "x-task-type": taskType,
      "x-thinking-level": thinkingLevel,
    },
    body: JSON.stringify({ prompt, taskType, thinkingLevel }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `APIS ${response.status}`);
  const answer = cleanText(data.answer, 8000);
  if (!answer) throw new Error("APIS returned empty answer");
  return answer;
}

async function callApisGateway(env, apiMessages) {
  const prompt = apiMessages.map((message) => {
    const label = message.role === "system" ? "系統" : message.role === "assistant" ? "AI" : "學生";
    return `${label}：${message.content}`;
  }).join("\n\n");
  return callApisPrompt(env, prompt, "chat", env.APIS_THINKING_LEVEL || "low");
}

// ---------------- 閱讀星圖：三詞初讀評議持久層（D1: READING_DB） ----------------
// 契約文檔：docs/READING_CONSTELLATION.md。身分鏈：bdfz_uc_session cookie →
// 服務端轉發 my.bdfz.net/api/me 核驗 → students.uc_slug。前端自報身分一律不信。

const UC_ORIGIN = "https://my.bdfz.net";
const UC_SESSION_COOKIE = "bdfz_uc_session";
const identityCache = new Map(); // token -> { user, exp }
let wordGroupCache = { index: null, exp: 0 };
let vocabIndexCache = { data: null, exp: 0 };

// 常用繁→簡折算（覆蓋三詞評議高頻字；未覆蓋的字保持原樣，僅影響聚類不影響記錄）
const T2S_PAIRS = "愛爱蒼苍傷伤憂忧鬱郁懷怀舊旧憶忆戀恋靜静麗丽華华絢绚濃浓豔艳質质樸朴潔洁簡简練练煉炼縝缜嚴严謹谨轉转蘊蕴壯壮闊阔渾浑開开細细膩腻銳锐鋒锋潑泼諧谐風风謔谑誠诚摯挚懇恳熱热揚扬熾炽寧宁適适詳详謐谧閒闲沖冲遠远雋隽剛刚堅坚韌韧頑顽強强執执獨独遙遥飄飘達达灑洒脫脱羈羁縛缚諷讽貶贬擊击評评讚赞頌颂憫悯憐怜惻恻隱隐關关實实錄录觀观莊庄肅肃鄭郑暢畅曉晓順顺張张對对節节韻韵聲声鏗铿鏘锵徵征託托結结構构佈布鋪铺墊垫筆笔應应畫画點点負负國国報报濟济願愿夢梦靈灵動动傳传鮮鲜涼凉淒凄愴怆蕭萧邁迈曠旷淨净學学讀读書书語语詞词課课見见覺觉說说話话寫写體体為为這这們们裡里後后發发經经過过還还沒没來来時时間间長长門门問问聞闻氣气電电車车馬马鳥鸟魚鱼龍龙鳳凤廣广慶庆億亿儀仪價价優优傑杰稱称藝艺術术歷历樂乐藥药醫医難难嘆叹觸触顯显現现圖图詩诗賦赋";
const T2S = new Map();
for (let i = 0; i + 1 < T2S_PAIRS.length; i += 2) T2S.set(T2S_PAIRS[i], T2S_PAIRS[i + 1]);

function normalizeWord(value) {
  const cleaned = String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s，。！？、；：""''「」『』《》〈〉（）()\[\]【】·…—～~,.!?;:'"<>@#$%^&*+=/\\|-]+/g, "");
  let out = "";
  for (const ch of cleaned) out += T2S.get(ch) || ch;
  return out.slice(0, 12);
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function getReadingStudent(request, env) {
  const cookies = Object.fromEntries((request.headers.get("cookie") || "").split(";").map((part) => {
    const index = part.indexOf("=");
    return index > 0 ? [part.slice(0, index).trim(), part.slice(index + 1).trim()] : ["", ""];
  }));
  // 測試縫（僅本地 wrangler pages dev 可設 READING_TEST_SLUG；生產項目嚴禁配置此變量）：
  // 合成數據與真實數據走完全相同的寫入/聚合/讀取路徑，僅身分核驗來源不同。
  if (env.READING_TEST_SLUG) {
    const slug = String(env.READING_TEST_SLUG).slice(0, 80);
    const db = env.READING_DB;
    await db.prepare("INSERT OR IGNORE INTO students (uc_slug, display_name) VALUES (?, ?)").bind(slug, "合成測試學生").run();
    const row = await db.prepare("SELECT id, uc_user_id, uc_slug, display_name, class_name FROM students WHERE uc_slug = ?").bind(slug).first();
    return { id: row.id, ucUserId: row.uc_user_id || null, slug: row.uc_slug, displayName: row.display_name, className: row.class_name || "" };
  }
  const token = cookies[UC_SESSION_COOKIE];
  if (!token) return null;
  const cached = identityCache.get(token);
  let user = cached && cached.exp > Date.now() ? cached.user : null;
  if (!user) {
    const cookieHeader = `${UC_SESSION_COOKIE}=${token}`;
    if (env.USER_CENTER_EVIDENCE?.resolveSession) {
      const resolved = await env.USER_CENTER_EVIDENCE.resolveSession(cookieHeader).catch(() => null);
      if (resolved?.authenticated && resolved?.sourceSiteKey === "yw" && Number.isInteger(Number(resolved.userId))) {
        user = {
          userId: Number(resolved.userId),
          slug: String(resolved.slug || "").slice(0, 80),
          displayName: String(resolved.displayName || "").slice(0, 80),
        };
      }
    }
    if (!user) {
      const response = await fetch(`${UC_ORIGIN}/api/me`, {
        headers: { cookie: cookieHeader, accept: "application/json" },
      }).catch(() => null);
      if (!response?.ok) return null;
      const payload = await response.json().catch(() => null);
      if (!payload?.slug) return null;
      user = {
        userId: null,
        slug: String(payload.slug).slice(0, 80),
        displayName: String(payload.displayName || "").slice(0, 80),
      };
    }
    if (!user.slug) return null;
    if (identityCache.size > 500) identityCache.clear();
    identityCache.set(token, { user, exp: Date.now() + 5 * 60 * 1000 });
  }
  const db = env.READING_DB;
  let row = user.userId
    ? await db.prepare("SELECT id, uc_user_id, uc_slug, display_name, class_name FROM students WHERE uc_user_id = ? OR uc_slug = ? ORDER BY uc_user_id IS NOT NULL DESC LIMIT 1")
      .bind(user.userId, user.slug).first()
    : await db.prepare("SELECT id, uc_user_id, uc_slug, display_name, class_name FROM students WHERE uc_slug = ?").bind(user.slug).first();
  if (!row) {
    await db.prepare(
      "INSERT OR IGNORE INTO students (uc_user_id, uc_slug, display_name, identity_verified_at) VALUES (?, ?, ?, ?)"
    ).bind(user.userId || null, user.slug, user.displayName, user.userId ? new Date().toISOString() : null).run();
    row = await db.prepare("SELECT id, uc_user_id, uc_slug, display_name, class_name FROM students WHERE uc_slug = ?").bind(user.slug).first();
  } else {
    await db.prepare(
      "UPDATE students SET last_seen_at = datetime('now'), display_name = ?, uc_user_id = COALESCE(?, uc_user_id), identity_verified_at = CASE WHEN ? IS NOT NULL THEN ? ELSE identity_verified_at END WHERE id = ?"
    ).bind(user.displayName || row.display_name, user.userId || null, user.userId || null, new Date().toISOString(), row.id).run();
  }
  return row ? {
    id: row.id,
    ucUserId: user.userId || row.uc_user_id || null,
    slug: row.uc_slug,
    displayName: user.displayName || row.display_name,
    className: row.class_name || "",
  } : null;
}

const DIRECT_LEARNING_INTERACTIONS = new Set([
  "lessonOpened",
  "readAcknowledged",
  "noteOpened",
  "vocabularyLookup",
  "evaluation",
  "resourceOpened",
  "slideDeckOpened",
  "chatOpened",
  "lessonCompleted",
]);

async function handleLearningInteraction(request, env, ctx) {
  if (!env.READING_DB) return readingError("learning evidence store not configured", 503);
  const student = await getReadingStudent(request, env);
  if (!student) return json({ ok: false, error: "not authenticated", authRequired: true }, { status: 401 });
  const payload = await request.json().catch(() => ({}));
  const lessonId = cleanText(payload.lessonId, 80);
  const interactionKey = cleanText(payload.interactionKey, 40);
  if (!/^lesson-[\w-]{1,60}$/.test(lessonId) || !DIRECT_LEARNING_INTERACTIONS.has(interactionKey)) {
    return readingError("registered direct interaction required");
  }
  const lesson = await getLessonData(request, env, lessonId);
  if (lesson?.id !== lessonId) return readingError("lesson absent from authoritative catalog");
  try {
    const recorded = await recordLearningInteraction({
      request,
      env,
      student,
      lesson,
      interactionKey,
      payload: {
        ...(payload.data && typeof payload.data === "object" ? payload.data : {}),
        clientMutationId: cleanText(payload.clientMutationId, 100),
        classSessionId: cleanText(payload.classSessionId, 100),
        lessonPhase: cleanText(payload.lessonPhase, 60),
      },
    });
    if (ctx?.waitUntil) ctx.waitUntil(retryPendingEvidence(env, 5));
    return json({
      ok: true,
      sourceEventId: recorded.sourceEventId,
      attemptNo: recorded.attemptNo,
      deduped: recorded.deduped,
      delivery: recorded.delivery || "already_recorded",
    });
  } catch (error) {
    if (error instanceof LearningSubmissionRateLimitError) return learningRateLimitResponse(error);
    if (error?.code === "learning_mutation_conflict") return learningMutationConflictResponse();
    return readingError(error?.message || "interaction recording failed", 422);
  }
}

async function loadWordGroups(env) {
  if (wordGroupCache.index && wordGroupCache.exp > Date.now()) return wordGroupCache;
  const index = new Map();
  const labels = {};
  const rows = await env.READING_DB.prepare("SELECT group_key, label, members FROM word_groups").all();
  for (const row of rows.results || []) {
    labels[row.group_key] = row.label;
    try {
      for (const member of JSON.parse(row.members)) index.set(member, row.group_key);
    } catch { /* 忽略壞行 */ }
  }
  wordGroupCache = { index, labels, exp: Date.now() + 10 * 60 * 1000 };
  return wordGroupCache;
}

async function loadVocabIndex(request, env) {
  if (vocabIndexCache.data && vocabIndexCache.exp > Date.now()) return vocabIndexCache.data;
  let data = {};
  try {
    const assetUrl = new URL("/data/vocab/index.json", request.url);
    const response = await env.ASSETS.fetch(new Request(assetUrl.toString(), { method: "GET" }));
    if (response.ok) data = (await response.json())?.lessons || {};
  } catch { /* 題庫索引缺席時亮度公式退化為作答比 */ }
  vocabIndexCache = { data, exp: Date.now() + 10 * 60 * 1000 };
  return data;
}

async function loadVocabBank(request, env, lessonId) {
  const url = new URL(`/data/vocab/${encodeURIComponent(lessonId)}.json`, request.url);
  const response = await env.ASSETS.fetch(new Request(url.toString(), { method: "GET" }));
  if (!response.ok) throw new Error("authoritative vocabulary bank unavailable");
  const bank = await response.json();
  if (bank?.lessonId !== lessonId || !Array.isArray(bank?.inventory)) {
    throw new Error("vocabulary bank contract invalid");
  }
  return bank;
}

function readingError(message, status = 400) {
  return json({ ok: false, error: message }, { status });
}

async function nextNodeSeq(db, studentId) {
  const row = await db.prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM star_nodes WHERE student_id = ?").bind(studentId).first();
  return Number(row?.seq || 1);
}

async function ensureStarNode(db, studentId, nodeId, kind, ref) {
  const existing = await db.prepare("SELECT seq FROM star_nodes WHERE student_id = ? AND node_id = ?").bind(studentId, nodeId).first();
  if (existing) return { seq: Number(existing.seq), born: false };
  const seq = await nextNodeSeq(db, studentId);
  await db.prepare("INSERT OR IGNORE INTO star_nodes (student_id, node_id, kind, ref, seq) VALUES (?, ?, ?, ?, ?)")
    .bind(studentId, nodeId, kind, ref, seq).run();
  return { seq, born: true };
}

function bumpFreqStatements(db, scopes, wordNorms) {
  const statements = [];
  for (const [scope, scopeKey] of scopes) {
    if (!scopeKey && scope !== "site") continue;
    for (const word of wordNorms) {
      statements.push(db.prepare(
        "INSERT INTO agg_word_freq (scope, scope_key, word_norm, freq) VALUES (?, ?, ?, 1) " +
        "ON CONFLICT(scope, scope_key, word_norm) DO UPDATE SET freq = freq + 1, updated_at = datetime('now')"
      ).bind(scope, scopeKey || "all", word));
    }
  }
  return statements;
}

async function handleReadingSubmission(request, env, student) {
  const payload = await request.json().catch(() => ({}));
  const lessonId = String(payload.lessonId || "").trim();
  if (!/^lesson-[\w-]{1,60}$/.test(lessonId)) return readingError("lessonId invalid");
  const rawWords = Array.isArray(payload.words) ? payload.words.map((w) => String(w || "").trim()).filter(Boolean) : [];
  if (rawWords.length !== 3) return readingError("exactly three words required");
  const normWords = rawWords.map(normalizeWord);
  if (normWords.some((w) => !w || w.length > 12)) return readingError("word out of range");
  if (new Set(normWords).size !== 3) return readingError("words must be distinct");
  const meta = await getLessonMeta(request, env, lessonId);
  const aiScore = Number.isFinite(Number(payload.aiScore)) ? Math.max(0, Math.min(100, Math.round(Number(payload.aiScore)))) : null;
  const aiVerdict = cleanText(payload.aiVerdict, 160);
  const source = payload.source === "synthetic" ? "synthetic" : "live";
  const contentHash = await sha256Hex(`${lessonId}\n${[...normWords].sort().join("\n")}`);
  const db = env.READING_DB;

  const existing = await db.prepare(
    "SELECT id, is_active, version FROM submissions WHERE student_id = ? AND lesson_id = ? AND content_hash = ?"
  ).bind(student.id, lessonId, contentHash).first();
  if (existing) {
    if (!existing.is_active) {
      await db.batch([
        db.prepare("UPDATE submissions SET is_active = 0 WHERE student_id = ? AND lesson_id = ?").bind(student.id, lessonId),
        db.prepare("UPDATE submissions SET is_active = 1, ai_score = COALESCE(?, ai_score), ai_verdict = CASE WHEN ? != '' THEN ? ELSE ai_verdict END WHERE id = ?")
          .bind(aiScore, aiVerdict, aiVerdict, existing.id),
      ]);
    } else if (aiScore !== null || aiVerdict) {
      await db.prepare("UPDATE submissions SET ai_score = COALESCE(?, ai_score), ai_verdict = CASE WHEN ? != '' THEN ? ELSE ai_verdict END WHERE id = ?")
        .bind(aiScore, aiVerdict, aiVerdict, existing.id).run();
    }
    return json({ ok: true, deduped: true, version: existing.version });
  }

  const versionRow = await db.prepare("SELECT COALESCE(MAX(version), 0) + 1 AS v FROM submissions WHERE student_id = ? AND lesson_id = ?")
    .bind(student.id, lessonId).first();
  const version = Number(versionRow?.v || 1);
  await db.prepare("UPDATE submissions SET is_active = 0 WHERE student_id = ? AND lesson_id = ?").bind(student.id, lessonId).run();
  await db.prepare(
    "INSERT INTO submissions (student_id, lesson_id, block_id, block_title, lesson_title, words_raw, words_norm, content_hash, ai_score, ai_verdict, version, is_active, source) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)"
  ).bind(
    student.id, lessonId, String(meta.blockId || ""), String(meta.blockTitle || ""), lessonTitleForMeta(meta),
    JSON.stringify(rawWords), JSON.stringify(normWords), contentHash, aiScore, aiVerdict, version, source
  ).run();
  const submission = await db.prepare("SELECT id FROM submissions WHERE student_id = ? AND lesson_id = ? AND content_hash = ?")
    .bind(student.id, lessonId, contentHash).first();

  const groupIndex = (await loadWordGroups(env)).index;
  const wordStatements = rawWords.map((raw, index) => db.prepare(
    "INSERT INTO submission_words (submission_id, student_id, lesson_id, position, word_raw, word_norm, group_key) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).bind(submission.id, student.id, lessonId, index + 1, raw.slice(0, 24), normWords[index], groupIndex.get(normWords[index]) || ""));
  const freqStatements = bumpFreqStatements(db, [
    ["student", student.slug],
    ["lesson", lessonId],
    ["class", student.className],
    ["block", String(meta.blockId || "")],
    ["site", "all"],
  ], normWords);
  await db.batch([...wordStatements, ...freqStatements]);

  const born = [];
  const lessonNode = await ensureStarNode(db, student.id, `lesson:${lessonId}`, "lesson", lessonId);
  if (lessonNode.born) born.push(`lesson:${lessonId}`);
  for (const word of normWords) {
    const node = await ensureStarNode(db, student.id, `word:${word}`, "word", word);
    if (node.born) born.push(`word:${word}`);
  }
  return json({ ok: true, deduped: false, version, born });
}

function lessonTitleForMeta(meta) {
  return String(meta.title || meta.tocLabel || meta.id || "").slice(0, 120);
}

function lessonBrightness(versionCount, bestScore, mastered, bankTotal) {
  const scoreBonus = bestScore >= 80 ? 0.5 : bestScore >= 60 ? 0.25 : 0;
  const masteryRatio = bankTotal > 0 ? Math.min(1, mastered / bankTotal) : 0;
  return Number((1 + 0.5 * Math.log2(1 + versionCount) + scoreBonus + 1.5 * masteryRatio).toFixed(3));
}

function wordBrightness(lessonCount, hasGroupPeer) {
  return Number((0.6 + 0.5 * Math.log2(1 + lessonCount) + (hasGroupPeer ? 0.2 : 0)).toFixed(3));
}

async function handleReadingConstellation(request, env, student) {
  const db = env.READING_DB;
  const [nodes, activeSubs, activeWords, masteryRows, vocabIndex] = await Promise.all([
    db.prepare("SELECT node_id, kind, ref, seq, born_at FROM star_nodes WHERE student_id = ? ORDER BY seq").bind(student.id).all(),
    db.prepare(
      "SELECT s.lesson_id, s.block_id, s.block_title, s.lesson_title, s.words_raw, s.words_norm, s.ai_score, s.created_at, " +
      "(SELECT COUNT(*) FROM submissions v WHERE v.student_id = s.student_id AND v.lesson_id = s.lesson_id) AS version_count, " +
      "(SELECT MAX(COALESCE(ai_score, 0)) FROM submissions v WHERE v.student_id = s.student_id AND v.lesson_id = s.lesson_id) AS best_score " +
      "FROM submissions s WHERE s.student_id = ? AND s.is_active = 1"
    ).bind(student.id).all(),
    db.prepare(
      "SELECT w.lesson_id, w.word_raw, w.word_norm, w.group_key FROM submission_words w " +
      "JOIN submissions s ON s.id = w.submission_id WHERE s.student_id = ? AND s.is_active = 1"
    ).bind(student.id).all(),
    db.prepare(
      "SELECT lesson_id, COUNT(*) AS attempted, SUM(CASE WHEN status = 'mastered' THEN 1 ELSE 0 END) AS mastered " +
      "FROM vocab_mastery WHERE student_id = ? GROUP BY lesson_id"
    ).bind(student.id).all(),
    loadVocabIndex(request, env),
  ]);
  const siteTop = await db.prepare(
    "SELECT word_norm, freq FROM agg_word_freq WHERE scope = 'site' AND scope_key = 'all' ORDER BY freq DESC, word_norm LIMIT 16"
  ).all();
  // 詞星錨點：該詞最早一次出現的課文（取歷史全部行的 MIN(id)，一經產生永不改變 → 星位穩定）
  const firstRows = await db.prepare(
    "SELECT w.word_norm, w.lesson_id FROM submission_words w " +
    "JOIN (SELECT word_norm AS wn, MIN(id) AS mid FROM submission_words WHERE student_id = ? GROUP BY word_norm) f " +
    "ON f.mid = w.id"
  ).bind(student.id).all();
  const firstLessonByWord = new Map((firstRows.results || []).map((row) => [row.word_norm, row.lesson_id]));

  const subByLesson = new Map((activeSubs.results || []).map((row) => [row.lesson_id, row]));
  const masteryByLesson = new Map((masteryRows.results || []).map((row) => [row.lesson_id, row]));
  const wordRows = activeWords.results || [];
  const lessonsByWord = new Map();
  const rawByWord = new Map();
  const groupByWord = new Map();
  for (const row of wordRows) {
    if (!lessonsByWord.has(row.word_norm)) lessonsByWord.set(row.word_norm, new Set());
    lessonsByWord.get(row.word_norm).add(row.lesson_id);
    if (!rawByWord.has(row.word_norm)) rawByWord.set(row.word_norm, row.word_raw);
    if (row.group_key) groupByWord.set(row.word_norm, row.group_key);
  }
  const groupMembers = new Map();
  for (const [word, group] of groupByWord) {
    if (!lessonsByWord.has(word)) continue;
    if (!groupMembers.has(group)) groupMembers.set(group, []);
    groupMembers.get(group).push(word);
  }
  const groupLabels = (await loadWordGroups(env)).labels || {};

  const outNodes = [];
  const links = [];
  for (const node of nodes.results || []) {
    if (node.kind === "lesson") {
      const sub = subByLesson.get(node.ref);
      if (!sub) continue; // 全部版本被清時，星點保留 seq 但不出圖
      const mastery = masteryByLesson.get(node.ref) || { attempted: 0, mastered: 0 };
      const bankTotal = Number(vocabIndex[node.ref] || 0);
      outNodes.push({
        id: node.node_id, kind: "lesson", ref: node.ref, seq: node.seq,
        label: sub.lesson_title || node.ref,
        blockId: sub.block_id, blockTitle: sub.block_title,
        c: lessonBrightness(Number(sub.version_count || 1), Number(sub.best_score || 0), Number(mastery.mastered || 0), bankTotal),
        meta: {
          versions: Number(sub.version_count || 1),
          bestScore: Number(sub.best_score || 0),
          vocabMastered: Number(mastery.mastered || 0),
          vocabAttempted: Number(mastery.attempted || 0),
          vocabTotal: bankTotal,
          words: JSON.parse(sub.words_raw || "[]"),
          updatedAt: sub.created_at,
        },
      });
    } else if (node.kind === "word") {
      const lessons = lessonsByWord.get(node.ref);
      if (!lessons || !lessons.size) continue;
      outNodes.push({
        id: node.node_id, kind: "word", ref: node.ref, seq: node.seq,
        label: rawByWord.get(node.ref) || node.ref,
        c: wordBrightness(lessons.size, (groupMembers.get(groupByWord.get(node.ref)) || []).length >= 2),
        group: groupByWord.get(node.ref) || "",
        meta: { lessons: [...lessons], firstLessonId: firstLessonByWord.get(node.ref) || [...lessons][0] },
      });
      for (const lessonId of lessons) links.push([`lesson:${lessonId}`, node.node_id, "use"]);
    }
  }
  for (const [group, members] of groupMembers) {
    if (members.length < 2) continue;
    const sorted = [...members].sort();
    for (let i = 0; i < sorted.length - 1 && i < 6; i += 1) {
      links.push([`word:${sorted[i]}`, `word:${sorted[i + 1]}`, `group:${group}`]);
    }
  }

  const volumeCounts = {};
  for (const row of activeSubs.results || []) {
    volumeCounts[row.block_id] = (volumeCounts[row.block_id] || 0) + 1;
  }

  return json({
    ok: true,
    student: { slug: student.slug, displayName: student.displayName },
    nodes: outNodes,
    links,
    stats: {
      lessons: (activeSubs.results || []).length,
      words: [...lessonsByWord.keys()].length,
      volumes: volumeCounts,
      siteTopWords: (siteTop.results || []).map((row) => [row.word_norm, row.freq]),
    },
    groupLabels: Object.fromEntries([...groupMembers.keys()].map((key) => [key, groupLabels[key] || key])),
    rulesVersion: "constellation-rules-v1",
  }, { headers: { "cache-control": "no-store" } });
}

async function handleReadingLesson(request, env, student, lessonId) {
  if (!/^lesson-[\w-]{1,60}$/.test(lessonId)) return readingError("lessonId invalid");
  const db = env.READING_DB;
  const [history, mastery, lessonTop] = await Promise.all([
    db.prepare(
      "SELECT version, words_raw, words_norm, ai_score, ai_verdict, is_active, source, created_at " +
      "FROM submissions WHERE student_id = ? AND lesson_id = ? ORDER BY version DESC"
    ).bind(student.id, lessonId).all(),
    db.prepare(
      "SELECT item_id, status, correct_count, wrong_count, last_at FROM vocab_mastery WHERE student_id = ? AND lesson_id = ?"
    ).bind(student.id, lessonId).all(),
    db.prepare(
      "SELECT word_norm, freq FROM agg_word_freq WHERE scope = 'lesson' AND scope_key = ? ORDER BY freq DESC, word_norm LIMIT 12"
    ).bind(lessonId).all(),
  ]);
  return json({
    ok: true,
    lessonId,
    history: (history.results || []).map((row) => ({
      version: row.version,
      words: JSON.parse(row.words_raw || "[]"),
      wordsNorm: JSON.parse(row.words_norm || "[]"),
      aiScore: row.ai_score,
      aiVerdict: row.ai_verdict,
      active: !!row.is_active,
      source: row.source,
      createdAt: row.created_at,
    })),
    vocab: mastery.results || [],
    lessonTopWords: (lessonTop.results || []).map((row) => [row.word_norm, row.freq]),
  }, { headers: { "cache-control": "no-store" } });
}

async function handleReadingHistory(request, env, student) {
  const rows = await env.READING_DB.prepare(
    "SELECT lesson_id, lesson_title, block_title, version, words_raw, ai_score, is_active, created_at " +
    "FROM submissions WHERE student_id = ? ORDER BY created_at DESC, id DESC LIMIT 200"
  ).bind(student.id).all();
  return json({
    ok: true,
    items: (rows.results || []).map((row) => ({
      lessonId: row.lesson_id,
      lessonTitle: row.lesson_title,
      blockTitle: row.block_title,
      version: row.version,
      words: JSON.parse(row.words_raw || "[]"),
      aiScore: row.ai_score,
      active: !!row.is_active,
      createdAt: row.created_at,
    })),
  }, { headers: { "cache-control": "no-store" } });
}

async function handleReadingVocabAttempt(request, env, student) {
  const payload = await request.json().catch(() => ({}));
  const lessonId = String(payload.lessonId || "").trim();
  const itemId = String(payload.itemId || "").trim().slice(0, 80);
  if (!/^lesson-[\w-]{1,60}$/.test(lessonId) || !itemId) return readingError("lessonId and itemId required");
  const selectedIndex = Number(payload.selectedIndex);
  if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex > 20) {
    return readingError("selectedIndex required");
  }
  const bank = await loadVocabBank(request, env, lessonId);
  const authoritativeItem = bank.inventory.find((item) => item?.id === itemId && item?.decision === "question");
  if (!authoritativeItem || !Array.isArray(authoritativeItem.options) || selectedIndex >= authoritativeItem.options.length) {
    return readingError("vocabulary item absent from authoritative bank");
  }
  const lesson = await getLessonData(request, env, lessonId);
  const db = env.READING_DB;
  const submissionGuard = await assertLearningSubmissionAllowed({
    request,
    env,
    student,
    lesson,
    interactionKey: "vocabAnswer",
    payload: {
      itemId,
      selectedIndex,
      clientMutationId: cleanText(payload.clientMutationId, 100),
      classSessionId: cleanText(payload.classSessionId, 100),
      lessonPhase: cleanText(payload.lessonPhase, 60),
    },
  });
  if (submissionGuard.deduped) {
    const current = await db.prepare(
      "SELECT status, correct_count, wrong_count FROM vocab_mastery WHERE student_id = ? AND lesson_id = ? AND item_id = ?"
    ).bind(student.id, lessonId, itemId).first();
    const priorCorrectness = cleanText(submissionGuard.evaluation?.correctness, 32).toLowerCase();
    return json({
      ok: true,
      deduped: true,
      attemptNo: submissionGuard.attemptNo,
      correct: priorCorrectness === "correct" || priorCorrectness === "passed",
      status: submissionGuard.evaluation?.verdict || current?.status || "learning",
      correctCount: Number(current?.correct_count || 0),
      wrongCount: Number(current?.wrong_count || 0),
      evidence: {
        sourceEventId: submissionGuard.sourceEventId,
        delivery: submissionGuard.eligibilityStatus === "ineligible"
          ? "already_recorded_ineligible"
          : "already_recorded",
      },
      completionEvidence: null,
    });
  }
  const correct = selectedIndex === Number(authoritativeItem.answerIndex) ? 1 : 0;
  const answer = cleanText(authoritativeItem.options[selectedIndex], 200);
  const attemptRow = await db.prepare(
    "SELECT COALESCE(MAX(attempt_no), 0) + 1 AS n FROM vocab_attempts WHERE student_id = ? AND lesson_id = ? AND item_id = ?"
  ).bind(student.id, lessonId, itemId).first();
  const attemptNo = Number(attemptRow?.n || 1);
  const current = await db.prepare(
    "SELECT status, correct_count, wrong_count FROM vocab_mastery WHERE student_id = ? AND lesson_id = ? AND item_id = ?"
  ).bind(student.id, lessonId, itemId).first();
  const correctCount = Number(current?.correct_count || 0) + (correct ? 1 : 0);
  const wrongCount = Number(current?.wrong_count || 0) + (correct ? 0 : 1);
  // 掌握規則（可測）：首答即對 → mastered；否則需累計兩次答對且末次為對。
  const mastered = correct && (attemptNo === 1 || correctCount >= 2);
  const status = mastered ? "mastered" : "learning";
  await db.batch([
    db.prepare(
      "INSERT INTO vocab_attempts (student_id, lesson_id, item_id, attempt_no, correct, answer) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(student.id, lessonId, itemId, attemptNo, correct, answer),
    db.prepare(
      "INSERT INTO vocab_mastery (student_id, lesson_id, item_id, status, correct_count, wrong_count, last_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now')) " +
      "ON CONFLICT(student_id, lesson_id, item_id) DO UPDATE SET status = ?, correct_count = ?, wrong_count = ?, last_at = datetime('now')"
    ).bind(student.id, lessonId, itemId, status, correctCount, wrongCount, status, correctCount, wrongCount),
  ]);
  const recorded = await recordLearningInteraction({
    request,
    env,
    student,
    lesson,
    interactionKey: "vocabAnswer",
    payload: {
      itemId,
      selectedIndex,
      clientMutationId: cleanText(payload.clientMutationId, 100),
      classSessionId: cleanText(payload.classSessionId, 100),
      lessonPhase: cleanText(payload.lessonPhase, 60),
    },
    evaluation: {
      score: correct ? 100 : 0,
      correctness: correct ? "correct" : "incorrect",
      provider: "answer-key",
      verdict: status,
    },
  });
  let completionEvidence = null;
  const questionCount = bank.inventory.filter((item) => item?.decision === "question").length;
  const masteryAggregate = await db.prepare(
    `SELECT COUNT(*) AS mastered,
            SUM(CASE WHEN wrong_count = 0 AND correct_count > 0 THEN 1 ELSE 0 END) AS first_try
       FROM vocab_mastery
      WHERE student_id = ? AND lesson_id = ? AND status = 'mastered'`
  ).bind(student.id, lessonId).first();
  if (questionCount > 0 && Number(masteryAggregate?.mastered || 0) >= questionCount) {
    completionEvidence = await recordLearningInteraction({
      request,
      env,
      student,
      lesson,
      interactionKey: "vocabQuizCompleted",
      payload: {
        questionCount,
        firstTryCount: Number(masteryAggregate?.first_try || 0),
        clientMutationId: `vocab-complete:${lessonId}:${student.id}:${String(bank.builtAt || "v1")}`.slice(0, 100),
      },
    });
  }
  return json({
    ok: true,
    attemptNo,
    correct: !!correct,
    status,
    correctCount,
    wrongCount,
    evidence: {
      sourceEventId: recorded.sourceEventId,
      delivery: recorded.delivery || "already_recorded",
    },
    completionEvidence: completionEvidence ? {
      sourceEventId: completionEvidence.sourceEventId,
      delivery: completionEvidence.delivery || "already_recorded",
    } : null,
  });
}

async function handleReadingVocabState(request, env, student, lessonId) {
  if (!/^lesson-[\w-]{1,60}$/.test(lessonId)) return readingError("lessonId invalid");
  const rows = await env.READING_DB.prepare(
    "SELECT item_id, status, correct_count, wrong_count, last_at FROM vocab_mastery WHERE student_id = ? AND lesson_id = ?"
  ).bind(student.id, lessonId).all();
  return json({ ok: true, lessonId, items: rows.results || [] }, { headers: { "cache-control": "no-store" } });
}

async function handleReadingHealth(env) {
  const db = env.READING_DB;
  const [students, submissions, nodes, interactions, pending] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS n FROM students").first(),
    db.prepare("SELECT COUNT(*) AS n FROM submissions").first(),
    db.prepare("SELECT COUNT(*) AS n FROM star_nodes").first(),
    db.prepare("SELECT COUNT(*) AS n FROM learning_interactions").first(),
    db.prepare("SELECT COUNT(*) AS n FROM evidence_outbox WHERE delivery_status = 'pending'").first(),
  ]);
  return json({
    ok: true,
    students: Number(students?.n || 0),
    submissions: Number(submissions?.n || 0),
    nodes: Number(nodes?.n || 0),
    learningInteractions: Number(interactions?.n || 0),
    evidenceOutboxPending: Number(pending?.n || 0),
    rulesVersion: "constellation-rules-v1",
    evidenceContractVersion: "bdfz-learning-evidence-v1",
  });
}

async function handleReading(request, env, url) {
  if (!env.READING_DB) return readingError("reading store not configured", 503);
  const path = url.pathname.replace(/\/+$/, "");
  try {
    if (path === "/api/reading/health" && request.method === "GET") return await handleReadingHealth(env);
    const student = await getReadingStudent(request, env);
    if (!student) return json({ ok: false, error: "not authenticated", authRequired: true }, { status: 401 });
    if (path === "/api/reading/submission" && request.method === "POST") return await handleReadingSubmission(request, env, student);
    if (path === "/api/reading/constellation" && request.method === "GET") return await handleReadingConstellation(request, env, student);
    if (path === "/api/reading/history" && request.method === "GET") return await handleReadingHistory(request, env, student);
    if (path === "/api/reading/vocab-attempt" && request.method === "POST") return await handleReadingVocabAttempt(request, env, student);
    const lessonMatch = path.match(/^\/api\/reading\/lesson\/([\w-]+)$/);
    if (lessonMatch && request.method === "GET") return await handleReadingLesson(request, env, student, lessonMatch[1]);
    const vocabMatch = path.match(/^\/api\/reading\/vocab-state\/([\w-]+)$/);
    if (vocabMatch && request.method === "GET") return await handleReadingVocabState(request, env, student, vocabMatch[1]);
    return readingError("not found", 404);
  } catch (error) {
    if (error instanceof LearningSubmissionRateLimitError) return learningRateLimitResponse(error);
    if (error?.code === "learning_mutation_conflict") return learningMutationConflictResponse();
    return readingError(error?.message || "reading api failure", 500);
  }
}
