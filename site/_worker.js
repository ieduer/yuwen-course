const OWNER = "ieduer";
const REPO = "yuwen-course";
const DISCUSSION_MARKER_PREFIX = "yuwen-course-lesson:";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/chat" && request.method === "POST") {
      return handleChat(request, env);
    }
    if (url.pathname === "/api/wy-articles" && request.method === "GET") {
      return handleWyArticles(request, env);
    }
    if (url.pathname === "/api/preview" && (request.method === "GET" || request.method === "HEAD")) {
      return handlePreview(request, env);
    }
    const discussionMatch = url.pathname.match(/^\/api\/discussions\/([^/]+)$/);
    if (discussionMatch) {
      if (request.method === "GET") return handleDiscussionGet(request, env, discussionMatch[1]);
      if (request.method === "POST") return handleDiscussionPost(request, env, discussionMatch[1]);
    }
    return env.ASSETS.fetch(request);
  },
};

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

function cleanText(value, max = 4000) {
  return String(value || "").replace(/\r/g, "").trim().slice(0, max);
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
  headers.delete("content-length");
  headers.delete("content-encoding");
}

function rewritePreviewHtml(html, target) {
  const base = `<base href="${escapeHtml(target.href)}">`;
  const style = `<style>html{background:#fff}body{max-width:980px;margin:0 auto;padding:20px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.7}img,video,iframe{max-width:100%;height:auto}</style>`;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${base}${style}`);
  }
  return `<!doctype html><html><head>${base}${style}</head><body>${html}</body></html>`;
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
  const upstream = await fetch(target.toString(), {
    method: request.method,
    headers,
    redirect: "follow",
  });
  const responseHeaders = new Headers(upstream.headers);
  const type = responseHeaders.get("content-type") || "";
  const isPdf = /\.pdf$/i.test(target.pathname) || /application\/pdf/i.test(type);
  const isHtml = /text\/html|application\/xhtml\+xml/i.test(type);
  clearFrameBlockingHeaders(responseHeaders);
  responseHeaders.set("access-control-allow-origin", "*");
  responseHeaders.set("x-content-type-options", "nosniff");
  responseHeaders.set(
    "content-disposition",
    `${requestUrl.searchParams.get("download") ? "attachment" : "inline"}; filename="${filenameFromUrl(target)}"`
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

  if (!env.OPENAI_API_KEY) {
    const apisReply = await callApisGateway(env, apiMessages).catch(() => null);
    if (apisReply) return json({ provider: "apis", reply: apisReply });

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

  try {
    const response = await fetch(env.OPENAI_ENDPOINT || "https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: env.OPENAI_MODEL || "gpt-4.1-mini",
        messages: apiMessages,
        temperature: 0.45,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || `OpenAI ${response.status}`);
    const reply = data.choices?.[0]?.message?.content || "";
    return json({ provider: "openai", reply });
  } catch (error) {
    return json({ error: error.message }, { status: 502 });
  }
}

async function callApisGateway(env, apiMessages) {
  const prompt = apiMessages.map((message) => {
    const label = message.role === "system" ? "系統" : message.role === "assistant" ? "AI" : "學生";
    return `${label}：${message.content}`;
  }).join("\n\n");
  const response = await fetch(env.APIS_ENDPOINT || "https://apis.bdfz.net", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "origin": "https://yw.bdfz.net",
      "x-project-name": "yw.bdfz.net",
      "x-task-type": "chat",
      "x-thinking-level": env.APIS_THINKING_LEVEL || "low",
    },
    body: JSON.stringify({ prompt, taskType: "chat", thinkingLevel: env.APIS_THINKING_LEVEL || "low" }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `APIS ${response.status}`);
  const answer = cleanText(data.answer, 8000);
  if (!answer) throw new Error("APIS returned empty answer");
  return answer;
}
