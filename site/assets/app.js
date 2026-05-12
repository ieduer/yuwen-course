const FORUM_BASE = "https://forum.rdfzer.com";
const FONT_SCALE_KEY = "yw-reader-font-scale";
const WY_BOOK_KEYS = {
  "bixiu-shang": "高中_语文_普通高中教科书_语文必修_上册",
  "bixiu-xia": "高中_语文_普通高中教科书_语文必修_下册",
  "xuanbi-shang": "高中_语文_普通高中教科书_语文选择性必修_上册",
  "xuanbi-zhong": "高中_语文_普通高中教科书_语文选择性必修_中册",
  "xuanbi-xia": "高中_语文_普通高中教科书_语文选择性必修_下册",
};
const DEFAULT_WEB_EMBED_HOSTS = [
  "ctext.org",
  "matters.news",
  "matters.town",
  "old.shuge.org",
  "shuge.org",
  "wikisource.org",
  "twitter.com",
  "x.com",
  "zh.wikisource.org",
];

const state = {
  manifest: null,
  classResources: { books: [], items: [] },
  resourceRedirects: {},
  wyArticles: [],
  lessons: new Map(),
  currentLesson: null,
  block: "",
  tab: "posts",
  query: "",
  chat: new Map(),
  fontScale: loadFontScale(),
};

const els = {
  body: document.body,
  dataStatus: document.getElementById("data-status"),
  blockTabs: document.getElementById("block-tabs"),
  lessonList: document.getElementById("lesson-list"),
  search: document.getElementById("lesson-search"),
  sidebarButton: document.getElementById("sidebar-button"),
  title: document.getElementById("lesson-title"),
  postsPanel: document.getElementById("posts-panel"),
  imagesPanel: document.getElementById("images-panel"),
  resourcesPanel: document.getElementById("resources-panel"),
  exercisesPanel: document.getElementById("exercises-panel"),
  fontDecrease: document.getElementById("font-decrease"),
  fontIncrease: document.getElementById("font-increase"),
  fontReset: document.getElementById("font-reset"),
  fontValue: document.getElementById("font-value"),
  copyChat: document.getElementById("copy-chat"),
  chatLog: document.getElementById("chat-log"),
  chatForm: document.getElementById("chat-form"),
  chatInput: document.getElementById("chat-input"),
  discussionLog: document.getElementById("discussion-log"),
  discussionForm: document.getElementById("discussion-form"),
  discussionName: document.getElementById("discussion-name"),
  discussionBody: document.getElementById("discussion-body"),
  discussionTrap: document.getElementById("discussion-trap"),
  reloadDiscussion: document.getElementById("reload-discussion"),
  viewer: document.getElementById("image-viewer"),
  viewerImage: document.getElementById("viewer-image"),
  viewerCaption: document.getElementById("viewer-caption"),
  viewerClose: document.getElementById("viewer-close"),
};

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[ch]));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function loadFontScale() {
  const stored = Number(localStorage.getItem(FONT_SCALE_KEY) || "1");
  return Number.isFinite(stored) ? clamp(stored, 0.82, 1.58) : 1;
}

function applyFontScale() {
  document.documentElement.style.setProperty("--reader-scale", state.fontScale.toFixed(2));
  if (els.fontValue) els.fontValue.textContent = `${Math.round(state.fontScale * 100)}%`;
}

function setFontScale(value) {
  state.fontScale = clamp(Math.round(value * 100) / 100, 0.82, 1.58);
  localStorage.setItem(FONT_SCALE_KEY, String(state.fontScale));
  applyFontScale();
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[語選擇論記復萬勝國歷紀實檢驗證學習務單臺別詩經禮莊為]/g, (ch) => ({
      "語": "语",
      "選": "选",
      "擇": "择",
      "論": "论",
      "記": "记",
      "復": "复",
      "萬": "万",
      "勝": "胜",
      "國": "国",
      "歷": "历",
      "紀": "纪",
      "實": "实",
      "檢": "检",
      "驗": "验",
      "證": "证",
      "學": "学",
      "習": "习",
      "務": "务",
      "單": "单",
      "臺": "台",
      "別": "别",
      "詩": "诗",
      "經": "经",
      "禮": "礼",
      "莊": "庄",
      "為": "为",
    }[ch] || ch))
    .replace(/\s+/g, "");
}

function keyText(value) {
  return normalize(value)
    .replace(/選必/g, "选必")
    .replace(/选择性必修/g, "选必")
    .replace(/普通高中教科书|高中语文|语文|人教版|部编版/g, "")
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/[/／].*$/g, "")
    .replace(/^[*＊]*(\d+|[一二三四五六七八九十]+)[、.．-]*/g, "")
    .replace(/^[*＊]*(\d+|[一二三四五六七八九十]+)/g, "")
    .replace(/[^0-9a-z\u4e00-\u9fff]/g, "")
    .replace(/[a-z]$/g, "");
}

function lessonKeys(lesson) {
  const raw = [
    lesson.title,
    lesson.sourceTitle,
    lesson.textbook?.tocLabel,
    lesson.tocLabel,
  ].filter(Boolean);
  const keys = new Set();
  raw.forEach((value) => {
    const main = keyText(value);
    if (main.length >= 1) keys.add(main);
    String(value).split(/[、,，;；/／\s]+/).forEach((piece) => {
      const key = keyText(piece);
      if (key.length >= 1) keys.add(key);
    });
  });
  return [...keys];
}

function matchScore(lesson, candidate) {
  const keys = lessonKeys(lesson);
  const candidateKeys = [
    candidate.key,
    keyText(candidate.title),
    keyText(candidate.manifest_title),
    keyText(candidate.book_title),
  ].filter((item) => item && item.length >= 1);
  let score = 0;
  for (const left of keys) {
    for (const right of candidateKeys) {
      if (left === right) score = Math.max(score, 1);
      else if (left.length >= 3 && right.includes(left)) score = Math.max(score, 0.86);
      else if (right.length >= 3 && left.includes(right)) score = Math.max(score, 0.82);
    }
  }
  return score;
}

function lessonText(meta) {
  return normalize([
    meta.title,
    meta.sourceTitle,
    meta.blockTitle,
    meta.excerpt,
    meta.textbookBookTitle,
    meta.tocLabel,
  ].join(" "));
}

function currentMessages() {
  const id = state.currentLesson?.id;
  if (!id) return [];
  return state.chat.get(id) || [];
}

function setMessages(messages) {
  const id = state.currentLesson?.id;
  if (!id) return;
  state.chat.set(id, messages);
  localStorage.setItem(`yw-chat:${id}`, JSON.stringify(messages.slice(-24)));
}

function loadStoredMessages(id) {
  if (state.chat.has(id)) return;
  try {
    state.chat.set(id, JSON.parse(localStorage.getItem(`yw-chat:${id}`) || "[]"));
  } catch {
    state.chat.set(id, []);
  }
}

function currentBlock() {
  return state.manifest.blocks.find((block) => block.id === state.block) || state.manifest.blocks[0];
}

function renderBlocks() {
  const buttons = state.manifest.blocks.map((block) => (
    `<button type="button" data-block="${esc(block.id)}" class="${state.block === block.id ? "active" : ""}">${esc(block.title)}</button>`
  ));
  els.blockTabs.innerHTML = buttons.join("");
}

function unitTitleFor(lesson) {
  const title = lesson.title || "";
  const match = title.match(/第[一二三四五六七八九十0-9]+[单單]元/);
  if (match) return match[0].replace("单", "單");
  if (/古诗词诵读|古詩詞誦讀/.test(title)) return "古詩詞誦讀";
  if (/整本书阅读|整本書閱讀/.test(title)) return "整本書閱讀";
  if (/单元研习任务|單元研習任務|单元学习任务|單元學習任務/.test(title)) return "單元研習任務";
  return "";
}

function isUnitHeading(lesson) {
  return Boolean(unitTitleFor(lesson));
}

function lessonMatchesQuery(lesson, q) {
  return !q || lessonText(lesson).includes(q);
}

function groupedVisibleLessons() {
  const block = currentBlock();
  const q = normalize(state.query);
  const allLessons = block?.lessons || [];
  const groups = [];
  let group = { title: "導讀", overview: null, items: [] };

  allLessons.forEach((lesson) => {
    if (isUnitHeading(lesson)) {
      if (group.overview || group.items.length) groups.push(group);
      group = { title: unitTitleFor(lesson), overview: lesson, items: [] };
      return;
    }
    if (lessonMatchesQuery(lesson, q)) group.items.push(lesson);
  });
  if (group.overview || group.items.length) groups.push(group);

  return groups
    .map((item) => ({
      ...item,
      showOverview: Boolean(q && item.overview && lessonMatchesQuery(item.overview, q)),
    }))
    .filter((item) => item.showOverview || item.items.length);
}

function lessonButtonMarkup(lesson, extraClass = "") {
    const page = lesson.textbookStartPage ? ` · p${lesson.textbookStartPage}` : "";
    return `
      <button type="button" class="lesson-item ${extraClass} ${state.currentLesson?.id === lesson.id ? "active" : ""}" data-lesson="${esc(lesson.id)}">
        <strong>${esc(lesson.title)}</strong>
        <span>${esc(lesson.blockTitle)}${esc(page)}</span>
      </button>
    `;
}

function renderLessonList() {
  const groups = groupedVisibleLessons();
  const block = currentBlock();
  const visibleCount = groups.reduce((sum, group) => sum + group.items.length + (group.showOverview ? 1 : 0), 0);
  els.lessonList.innerHTML = groups.map((group) => `
    <section class="lesson-unit">
      ${group.overview ? `
        <button type="button" class="unit-heading ${state.currentLesson?.id === group.overview.id ? "active" : ""}" data-lesson="${esc(group.overview.id)}">
          <span>${esc(group.title)}</span>
        </button>
      ` : `<div class="unit-heading is-label"><span>${esc(group.title)}</span></div>`}
      <div class="unit-lessons">
        ${group.showOverview ? lessonButtonMarkup(group.overview, "unit-overview") : ""}
        ${group.items.map((lesson) => lessonButtonMarkup(lesson)).join("")}
      </div>
    </section>
  `).join("") || `<p class="empty">未找到匹配課文。</p>`;
  els.dataStatus.textContent = `${visibleCount}/${block?.lessons?.length || 0} 課`;
}

async function loadLesson(id) {
  if (state.lessons.has(id)) return state.lessons.get(id);
  const meta = state.manifest.lessons.find((item) => item.id === id);
  if (!meta) throw new Error(`lesson not found: ${id}`);
  const response = await fetch(meta.dataUrl);
  if (!response.ok) throw new Error(`lesson ${id} ${response.status}`);
  const lesson = await response.json();
  state.lessons.set(id, lesson);
  return lesson;
}

async function loadJson(path, fallback = null) {
  try {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`${path} ${response.status}`);
    return response.json();
  } catch (error) {
    if (!fallback) throw error;
    const response = await fetch(fallback);
    if (!response.ok) throw new Error(`${fallback} ${response.status}`);
    return response.json();
  }
}

async function loadSupportData() {
  const [classResources, wyArticles, resourceRedirects] = await Promise.all([
    loadJson("data/class_resources.json").catch(() => ({ books: [], items: [] })),
    loadJson("/api/wy-articles", "data/wy_articles.json").catch(() => ({ articles: [] })),
    loadJson("data/resource_redirects.json").catch(() => ({ redirects: {} })),
  ]);
  state.classResources = classResources || { books: [], items: [] };
  state.wyArticles = Array.isArray(wyArticles?.articles) ? wyArticles.articles : [];
  state.resourceRedirects = resourceRedirects?.redirects || {};
}

function classResourcesForLesson(lesson) {
  const items = Array.isArray(state.classResources?.items) ? state.classResources.items : [];
  return items
    .filter((item) => item.blockId === lesson.blockId && item.kind !== "unit")
    .map((item) => ({ ...item, score: matchScore(lesson, item) }))
    .filter((item) => item.score >= 0.82)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, 8);
}

function exerciseArticlesForLesson(lesson) {
  const bookKey = WY_BOOK_KEYS[lesson.blockId] || "";
  return state.wyArticles
    .filter((article) => !bookKey || article.book_key === bookKey)
    .map((article) => ({ ...article, score: matchScore(lesson, article) }))
    .filter((article) => article.score >= 0.8)
    .sort((a, b) => b.score - a.score || Number(b.challenge_count || 0) - Number(a.challenge_count || 0))
    .slice(0, 8);
}

function setTab(tab) {
  state.tab = tab;
  document.querySelectorAll(".pane-tabs button").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tab);
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `${tab}-panel`);
  });
}

function normalizeHref(href) {
  const value = String(href || "").trim();
  if (!value || value.startsWith("#")) return value;
  if (value.startsWith("//")) return `https:${value}`;
  try {
    const maybePreview = new URL(value, window.location.href);
    if (maybePreview.pathname === "/api/preview" && maybePreview.searchParams.get("url")) {
      return maybePreview.searchParams.get("url");
    }
  } catch {
    // Fall through to the ordinary forum-relative handling below.
  }
  if (value.startsWith("/")) return `${FORUM_BASE}${value}`;
  return value;
}

function withoutHash(value) {
  try {
    const url = new URL(value, window.location.href);
    url.hash = "";
    return url.toString();
  } catch {
    return value;
  }
}

function resolvedHref(href) {
  const value = normalizeHref(href);
  if (!value || value.startsWith("#")) return value;
  const redirects = state.resourceRedirects || {};
  return redirects[value] || redirects[withoutHash(value)] || value;
}

function httpUrl(value) {
  try {
    const url = new URL(resolvedHref(value), window.location.href);
    if (url.protocol === "http:" || url.protocol === "https:") return url;
  } catch {
    return null;
  }
  return null;
}

function isInternalResource(item) {
  const href = String(item?.href || "").trim();
  const text = String(item?.text || "").trim();
  if (!href || href.startsWith("#")) return true;
  if (/^#?(p|footnote|footnote-ref)-[\w-]+$/i.test(text)) return true;
  return false;
}

function visibleResources(lesson) {
  const seen = new Set();
  return (lesson.resources || []).filter((item) => {
    if (isInternalResource(item)) return false;
    const href = resolvedHref(item.href);
    const key = href.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isImageUrl(value) {
  const url = httpUrl(value);
  if (!url) return false;
  return /\.(avif|gif|jpe?g|png|svg|webp)$/i.test(url.pathname);
}

function isPdfUrl(value) {
  const url = httpUrl(value);
  if (!url) return false;
  return /\.pdf$/i.test(url.pathname);
}

function isDocumentUrl(value) {
  const url = httpUrl(value);
  if (!url) return false;
  return /\.(pdf|docx?|pptx?|xlsx?)$/i.test(url.pathname);
}

function previewUrl(value, download = false) {
  const url = resolvedHref(value);
  return `/api/preview?url=${encodeURIComponent(url)}${download ? "&download=1" : ""}`;
}

function isForumUploadUrl(value) {
  const url = httpUrl(value);
  return Boolean(url && url.hostname === "forum.rdfzer.com" && url.pathname.startsWith("/uploads/short-url/"));
}

function publicHref(value) {
  const href = resolvedHref(value);
  return isForumUploadUrl(href) ? previewUrl(href) : href;
}

function youtubeEmbedUrl(value) {
  const url = httpUrl(value);
  if (!url) return "";
  const host = url.hostname.replace(/^www\./, "");
  let id = "";
  if (host === "youtu.be") id = url.pathname.split("/").filter(Boolean)[0] || "";
  if (host.endsWith("youtube.com")) {
    id = url.searchParams.get("v") || "";
    const embedMatch = url.pathname.match(/\/embed\/([^/?]+)/);
    if (!id && embedMatch) id = embedMatch[1];
  }
  return id ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}` : "";
}

function xEmbedUrl(value) {
  const url = httpUrl(value);
  if (!url) return "";
  const host = url.hostname.replace(/^www\./, "");
  if (!["x.com", "twitter.com"].includes(host)) return "";
  const match = url.pathname.match(/\/status\/(\d+)/);
  return match ? `https://platform.twitter.com/embed/Tweet.html?id=${encodeURIComponent(match[1])}` : "";
}

function bilibiliEmbedUrl(value) {
  const url = httpUrl(value);
  if (!url || !/bilibili\.com$/i.test(url.hostname.replace(/^www\./, ""))) return "";
  const match = url.pathname.match(/\/video\/(BV[0-9A-Za-z]+)/);
  return match ? `https://player.bilibili.com/player.html?bvid=${encodeURIComponent(match[1])}&autoplay=0` : "";
}

function isYuqueUrl(value) {
  const url = httpUrl(value);
  return Boolean(url && /(^|\.)yuque\.com$/i.test(url.hostname));
}

function hostMatches(host, targets) {
  const value = String(host || "").toLowerCase();
  return targets.some((target) => value === target || value.endsWith(`.${target}`));
}

function shouldDefaultWebEmbed(value) {
  const url = httpUrl(value);
  if (!url || isDocumentUrl(url.href) || isImageUrl(url.href)) return false;
  if (isYuqueUrl(url.href)) return false;
  return url.protocol === "https:" && hostMatches(url.hostname, DEFAULT_WEB_EMBED_HOSTS);
}

function shouldInlineEmbed(value) {
  const url = httpUrl(value);
  if (!url) return false;
  if (isPdfUrl(url.href)) return true;
  return Boolean(youtubeEmbedUrl(url.href) || xEmbedUrl(url.href) || bilibiliEmbedUrl(url.href) || shouldDefaultWebEmbed(url.href));
}

function frameMarkup(src, title, kind = "web", extraActions = "") {
  const proxiedWeb = kind === "web" && /\/api\/preview\?/.test(src);
  const sandbox = kind === "pdf"
    ? ""
    : proxiedWeb
      ? ` sandbox="allow-same-origin allow-forms allow-popups"`
      : ` sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"`;
  return `
    <div class="preview-shell is-open" data-preview-kind="${esc(kind)}">
      ${extraActions ? `<div class="preview-actions">${extraActions}</div>` : ""}
      <div class="preview-frame">
        <iframe src="${esc(src)}" title="${esc(title)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade"${sandbox}></iframe>
      </div>
    </div>
  `;
}

function embedMarkupForUrl(rawUrl, title, variant = "resource") {
  const url = resolvedHref(rawUrl);
  const label = title || url;
  const youtube = youtubeEmbedUrl(url);
  const xEmbed = xEmbedUrl(url);
  const bilibili = bilibiliEmbedUrl(url);
  const embedUrl = youtube || xEmbed || bilibili;
  if (embedUrl) {
    return `
      <div class="${variant}-embed video-embed">
        <iframe src="${esc(embedUrl)}" title="${esc(label)}" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>
      </div>
    `;
  }
  if (isImageUrl(url)) {
    const imageSrc = publicHref(url);
    return `
      <div class="${variant}-embed image-embed">
        <button type="button" class="embed-image-button" data-src="${esc(imageSrc)}" data-caption="${esc(label)}">
          <img src="${esc(imageSrc)}" alt="${esc(label)}" loading="lazy" decoding="async">
        </button>
      </div>
    `;
  }
  if (isPdfUrl(url)) {
    const source = previewUrl(url);
    const download = previewUrl(url, true);
    return `
      <div class="${variant}-embed document-embed">
        ${frameMarkup(source, label, "pdf", `<a class="preview-link" href="${esc(download)}" target="_blank" rel="noreferrer">下載</a>`)}
      </div>
    `;
  }
  if (shouldDefaultWebEmbed(url)) {
    return `
      <div class="${variant}-embed web-embed">
        ${frameMarkup(previewUrl(url), label, "web")}
      </div>
    `;
  }
  return "";
}

function safeColorValue(raw) {
  const value = String(raw || "").trim().toLowerCase();
  const named = {
    red: "#b44636",
    blue: "#2f6fab",
    green: "#4f7f50",
    orange: "#b86c2c",
    purple: "#7458a8",
  };
  if (named[value]) return named[value];
  if (/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(value)) return value;
  return "";
}

function safeBbcodeImageSrc(raw) {
  const url = httpUrl(raw);
  if (!url || !isImageUrl(url.href)) return "";
  return publicHref(url.href);
}

function normalizeCookedHtml(html) {
  return String(html || "")
    .replace(/\[image\]([\s\S]*?)\[\/image\]/gi, (_match, src) => {
      const safe = safeBbcodeImageSrc(src.trim());
      return safe ? `<img class="bbcode-image" src="${esc(safe)}" alt="" loading="lazy" decoding="async">` : "";
    })
    .replace(/\[color=([^\]]+)\]/gi, (_match, color) => {
      const safe = safeColorValue(color);
      return safe ? `<span class="bbcode-color" style="--bbcode-color:${safe}">` : "";
    })
    .replace(/\[\/color\]/gi, "</span>")
    .replace(/\[right\]/gi, `<span class="bbcode-align bbcode-right">`)
    .replace(/\[\/right\]/gi, "</span>")
    .replace(/\[center\]/gi, `<span class="bbcode-align bbcode-center">`)
    .replace(/\[\/center\]/gi, "</span>")
    .replace(/\[left\]/gi, `<span class="bbcode-align bbcode-left">`)
    .replace(/\[\/left\]/gi, "</span>")
    .replace(/\[size=[^\]]+\]/gi, `<span class="bbcode-size">`)
    .replace(/\[\/size\]/gi, "</span>");
}

function findLocalAnchor(root, id) {
  return Array.from(root.querySelectorAll("[id], a[name]"))
    .find((node) => node.id === id || node.getAttribute("name") === id);
}

function bindLocalAnchor(link, root, href) {
  link.removeAttribute("target");
  link.removeAttribute("rel");
  link.addEventListener("click", (event) => {
    const id = decodeURIComponent(href.slice(1));
    const target = findLocalAnchor(root, id);
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.classList.add("anchor-focus");
    window.setTimeout(() => target.classList.remove("anchor-focus"), 1300);
    if (state.currentLesson) history.replaceState(null, "", `#${state.currentLesson.id}`);
  });
}

function attachImageButtons(container) {
  container.querySelectorAll(".embed-image-button").forEach((button) => {
    button.addEventListener("click", () => openViewer(button.dataset.src, button.dataset.caption));
  });
}

function normalizeMarkdownQuotes(container) {
  container.querySelectorAll(".cooked p").forEach((paragraph) => {
    const text = paragraph.textContent.trim();
    if (!/^>\s*\S/.test(text)) return;
    const quote = document.createElement("blockquote");
    quote.className = "md-quote";
    const p = document.createElement("p");
    p.textContent = text.replace(/^>\s?/, "");
    quote.appendChild(p);
    paragraph.replaceWith(quote);
  });
}

function deferExistingFrames(container) {
  container.querySelectorAll(".cooked iframe[src]").forEach((frame) => {
    if (frame.closest(".inline-embed, .resource-embed, .preview-shell")) return;
    const src = resolvedHref(frame.getAttribute("src") || "");
    if (!src || youtubeEmbedUrl(src) || bilibiliEmbedUrl(src) || /platform\.twitter\.com\/embed\/Tweet\.html/i.test(src)) {
      frame.loading = "lazy";
      return;
    }
    const title = frame.getAttribute("title") || src;
    const wrapper = document.createElement("div");
    wrapper.className = "inline-embed web-embed";
    wrapper.innerHTML = frameMarkup(previewUrl(src), title, "web");
    frame.replaceWith(wrapper);
  });
}

function enhanceInlineEmbeds(container) {
  const embedded = new Set();
  container.querySelectorAll("a[href]").forEach((link) => {
    if (link.closest(".lightbox-wrapper, aside.onebox, .inline-embed, .footnotes-list, .footnote-ref, sup")) return;
    if (link.querySelector("img")) return;
    const raw = link.getAttribute("href") || "";
    if (raw.startsWith("#")) return;
    const url = resolvedHref(raw);
    if (!url || embedded.has(url)) return;
    if (!shouldInlineEmbed(url)) return;
    const markup = embedMarkupForUrl(url, link.textContent.trim() || url, "inline");
    if (!markup) return;
    embedded.add(url);
    link.insertAdjacentHTML("afterend", markup);
  });
}

function enhanceOneboxEmbeds(container) {
  container.querySelectorAll(".onebox[data-onebox-src]").forEach((box) => {
    const url = resolvedHref(box.getAttribute("data-onebox-src") || "");
    if (!url || !shouldInlineEmbed(url)) return;
    if (box.nextElementSibling?.classList?.contains("inline-embed")) return;
    const title = box.textContent.trim().replace(/\s+/g, " ").slice(0, 120) || url;
    const markup = embedMarkupForUrl(url, title, "inline");
    if (markup) box.insertAdjacentHTML("afterend", markup);
  });
}

function enhanceCooked(container) {
  container.querySelectorAll("a[href]").forEach((link) => {
    const raw = link.getAttribute("href") || "";
    if (raw.startsWith("#")) {
      bindLocalAnchor(link, container, raw);
      return;
    }
    const href = resolvedHref(raw);
    link.href = publicHref(href);
    if (link.querySelector("img")) {
      link.addEventListener("click", (event) => {
        event.preventDefault();
        const image = link.querySelector("img");
        openViewer(image?.src || href, image?.alt || link.getAttribute("title") || state.currentLesson.title);
      });
      return;
    }
    if (link.classList.contains("lightbox")) {
      link.addEventListener("click", (event) => {
        event.preventDefault();
        const image = link.querySelector("img");
        openViewer(image?.src || href, image?.alt || link.getAttribute("title") || state.currentLesson.title);
      });
      return;
    }
    link.target = "_blank";
    link.rel = "noreferrer";
  });

  container.querySelectorAll("img").forEach((img) => {
    const src = publicHref(img.getAttribute("src") || "");
    if (src) img.src = src;
    img.loading = "lazy";
    img.decoding = "async";
    img.addEventListener("click", () => openViewer(img.src, img.alt || state.currentLesson.title));
  });

  enhanceOneboxEmbeds(container);
  enhanceInlineEmbeds(container);
  deferExistingFrames(container);
  normalizeMarkdownQuotes(container);
  attachImageButtons(container);
}

function postFingerprint(post) {
  const raw = post?.plain_text || post?.cooked || "";
  return String(raw)
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, "")
    .slice(0, 6000);
}

function visiblePosts(lesson) {
  const seen = new Set();
  return (lesson.posts || []).filter((post) => {
    const key = postFingerprint(post);
    if (key.length < 80) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function renderPosts(lesson) {
  els.postsPanel.innerHTML = visiblePosts(lesson).map((post) => `
    <section class="forum-post" id="post-${esc(post.id || post.post_number)}">
      <aside>
        <div class="post-number">#${post.post_number}</div>
        <div class="post-date">${esc((post.created_at || "").slice(0, 10))}</div>
      </aside>
      <div class="cooked">${normalizeCookedHtml(post.cooked)}</div>
    </section>
  `).join("");
  enhanceCooked(els.postsPanel);
}

function renderImages(lesson) {
  const textbook = lesson.textbook.pageImages || [];
  const forumImages = lesson.forumImages || [];
  const textbookHtml = textbook.length ? `
    <h2>教材圖頁</h2>
    <div class="image-grid">${textbook.map((image) => `
      <button type="button" class="image-tile" data-src="${esc(image.src)}" data-caption="${esc(`${lesson.textbook.bookTitle} · ${image.label}`)}">
        <img src="${esc(image.src)}" alt="${esc(`${lesson.title} ${image.label}`)}" loading="lazy" decoding="async">
      </button>
    `).join("")}</div>
  ` : `<p class="empty">本課未自動匹配到教材圖片；仍保留論壇圖片和資源。</p>`;
  const forumHtml = forumImages.length ? `
    <h2>論壇圖片</h2>
    <div class="image-grid">${forumImages.map((image) => `
      <button type="button" class="image-tile" data-src="${esc(image.src)}" data-caption="${esc(`#${image.postNumber} · ${image.alt || lesson.title}`)}">
        <img src="${esc(image.src)}" alt="${esc(image.alt || lesson.title)}" loading="lazy" decoding="async">
      </button>
    `).join("")}</div>
  ` : `<p class="empty">本課論壇回覆中未抽取到圖片。</p>`;
  els.imagesPanel.innerHTML = textbookHtml + forumHtml;
  els.imagesPanel.querySelectorAll(".image-tile").forEach((tile) => {
    tile.addEventListener("click", () => openViewer(tile.dataset.src, tile.dataset.caption));
  });
}

function hrefKey(value) {
  const url = httpUrl(value);
  if (!url) return resolvedHref(value).toLowerCase();
  url.hash = "";
  return url.toString().replace(/\/$/, "").toLowerCase();
}

function resourceCard({ href, title, meta, kind = "link", source = "" }) {
  const target = resolvedHref(href);
  const openTarget = publicHref(target);
  return `
    <article class="resource-item" data-kind="${esc(kind)}">
      <div class="resource-link">
        <strong>${esc(title || target)}</strong>
        <span>${esc([meta, source].filter(Boolean).join(" · "))}</span>
      </div>
      <div class="resource-actions">
        <a href="${esc(openTarget)}" target="_blank" rel="noreferrer">打開</a>
      </div>
      ${embedMarkupForUrl(target, title || target, "resource")}
    </article>
  `;
}

function renderClassResourceSection(lesson, seen) {
  const matches = classResourcesForLesson(lesson)
    .filter((item) => !seen.has(hrefKey(item.url)));
  if (!matches.length) return "";
  matches.forEach((item) => seen.add(hrefKey(item.url)));
  return `
    <section class="resource-section class-resource-section">
      <header class="resource-section-head">
        <h2>課程資源</h2>
        <p>按課題拆分自 class.bdfz.net 的三本語雀資源，只補本站未列出的課級入口。</p>
      </header>
      <div class="resource-list">${matches.map((item) => resourceCard({
        href: item.url,
        title: item.title,
        meta: `${item.blockTitle} · 語雀課文資源`,
        kind: item.kind,
        source: item.score >= 1 ? "精確匹配" : "標題匹配",
      })).join("")}</div>
    </section>
  `;
}

function renderResources(lesson) {
  const resources = visibleResources(lesson);
  const seen = new Set(resources.map((item) => hrefKey(item.href)));
  const forumHtml = resources.length ? `
    <section class="resource-section">
      <header class="resource-section-head">
        <h2>論壇資源</h2>
      </header>
      <div class="resource-list">${resources.map((item) => {
        const href = normalizeHref(item.href);
        const title = item.text || href;
        return resourceCard({
          href,
          title,
          meta: `#${item.postNumber} · ${item.kind}`,
          kind: item.kind,
        });
      }).join("")}</div>
    </section>
  ` : "";
  const classHtml = renderClassResourceSection(lesson, seen);
  els.resourcesPanel.innerHTML = forumHtml + classHtml || `<p class="empty">本課暫無可抽取連結或附件。</p>`;
  attachImageButtons(els.resourcesPanel);
}

function wyEmbedUrl(articleId) {
  const url = new URL("https://wy.bdfz.net/");
  url.searchParams.set("kind", "textbook_word");
  url.searchParams.set("articleId", articleId);
  url.searchParams.set("embed", "1");
  return url.toString();
}

function renderExercises(lesson) {
  const matches = exerciseArticlesForLesson(lesson);
  if (!matches.length) {
    els.exercisesPanel.innerHTML = `
      <section class="exercise-empty">
        <p class="empty">本課暫未匹配到 wy.bdfz.net 的課文練習；可先進入總練習頁選篇。</p>
        <div class="resource-embed web-embed">${frameMarkup("https://wy.bdfz.net/?embed=1", "AI 字詞", "web", `<a class="preview-link" href="https://wy.bdfz.net/" target="_blank" rel="noreferrer">打開練習</a>`)}</div>
      </section>
    `;
    return;
  }
  const first = matches[0];
  els.exercisesPanel.innerHTML = `
    <section class="exercise-section">
      <header class="resource-section-head">
        <h2>習題</h2>
        <p>已按本課標題對接 wy.bdfz.net 的選篇掌握練習。</p>
      </header>
      <div class="exercise-list">
        ${matches.map((article, index) => `
          <button type="button" class="exercise-entry ${index === 0 ? "active" : ""}" data-wy-article="${esc(article.article_id)}">
            <strong>${esc(article.title || article.manifest_title || "課文練習")}</strong>
            <span>${Number(article.challenge_count || 0)} 題 · p${esc(article.page_start || "?")}${article.page_end && article.page_end !== article.page_start ? `-p${esc(article.page_end)}` : ""}</span>
          </button>
        `).join("")}
      </div>
      <div class="wy-frame-wrap">
        <iframe id="wy-frame" src="${esc(wyEmbedUrl(first.article_id))}" title="${esc(`${first.title || lesson.title} 練習`)}" loading="lazy" allow="clipboard-write"></iframe>
      </div>
      <div class="resource-actions exercise-actions">
        <a id="wy-open-link" href="${esc(wyEmbedUrl(first.article_id))}" target="_blank" rel="noreferrer">新頁練習</a>
      </div>
    </section>
  `;
  const frame = els.exercisesPanel.querySelector("#wy-frame");
  const openLink = els.exercisesPanel.querySelector("#wy-open-link");
  els.exercisesPanel.querySelectorAll(".exercise-entry").forEach((button) => {
    button.addEventListener("click", () => {
      els.exercisesPanel.querySelectorAll(".exercise-entry").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      const next = wyEmbedUrl(button.dataset.wyArticle || "");
      if (frame) frame.src = next;
      if (openLink) openLink.href = next;
    });
  });
}

function renderChat() {
  const messages = currentMessages();
  els.chatLog.innerHTML = messages.map((message) => `
    <article class="message ${esc(message.role)}">
      <div class="role">${message.role === "user" ? "你" : "AI"}</div>
      <p>${esc(message.content)}</p>
    </article>
  `).join("") || `<p class="empty">可直接追問本課文本、資源、考點或自己的理解。</p>`;
  els.chatLog.scrollTop = els.chatLog.scrollHeight;
}

async function loadDiscussion() {
  const lesson = state.currentLesson;
  if (!lesson) return;
  els.discussionLog.innerHTML = `<p class="empty">讀取討論中。</p>`;
  try {
    const response = await fetch(`/api/discussions/${encodeURIComponent(lesson.id)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || response.statusText);
    const issueLink = data.issueUrl ? `<p><a href="${esc(data.issueUrl)}" target="_blank" rel="noreferrer">GitHub Issue 原頁</a></p>` : "";
    const comments = data.comments || [];
    els.discussionLog.innerHTML = issueLink + (comments.length ? comments.map((comment) => `
      <article class="discussion-comment">
        <div class="comment-meta">${esc(comment.author || "討論")} · ${esc((comment.createdAt || "").slice(0, 10))}</div>
        <p>${esc(comment.body || "")}</p>
      </article>
    `).join("") : `<p class="empty">本課還沒有討論。</p>`);
  } catch (error) {
    els.discussionLog.innerHTML = `<p class="empty">討論載入失敗：${esc(error.message)}</p>`;
  }
}

async function showLesson(id, { push = true } = {}) {
  const lesson = await loadLesson(id);
  state.currentLesson = lesson;
  loadStoredMessages(id);
  els.title.textContent = lesson.title;
  document.title = `${lesson.title} · 課文`;
  renderPosts(lesson);
  renderImages(lesson);
  renderResources(lesson);
  renderExercises(lesson);
  renderChat();
  renderLessonList();
  loadDiscussion();
  if (push) history.replaceState(null, "", `#${lesson.id}`);
  if (window.matchMedia("(max-width: 820px)").matches) els.body.classList.remove("sidebar-open");
}

function openViewer(src, caption) {
  els.viewerImage.src = src;
  els.viewerImage.alt = caption || "";
  els.viewerCaption.textContent = caption || "";
  els.viewer.classList.remove("hidden");
  els.body.classList.add("viewer-open");
}

function closeViewer() {
  els.viewer.classList.add("hidden");
  els.viewerImage.removeAttribute("src");
  els.body.classList.remove("viewer-open");
}

async function copyText(text) {
  await navigator.clipboard.writeText(text);
}

async function sendChat(event) {
  event.preventDefault();
  const value = els.chatInput.value.trim();
  if (!value || !state.currentLesson) return;
  const messages = [...currentMessages(), { role: "user", content: value }];
  setMessages(messages);
  els.chatInput.value = "";
  renderChat();
  els.chatForm.querySelector("button").disabled = true;
  try {
    const resources = visibleResources(state.currentLesson).slice(0, 16).map((item) => ({
      href: resolvedHref(item.href),
      text: item.text || item.href,
      kind: item.kind,
      postNumber: item.postNumber,
    }));
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lessonId: state.currentLesson.id,
        lessonTitle: state.currentLesson.title,
        blockTitle: state.currentLesson.blockTitle,
        excerpt: state.currentLesson.excerpt,
        resources,
        textbookPages: state.currentLesson.textbook.pageImages || [],
        messages: messages.slice(-12),
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || response.statusText);
    setMessages([...messages, { role: "assistant", content: data.reply }]);
  } catch (error) {
    setMessages([...messages, { role: "assistant", content: `對話失敗：${error.message}` }]);
  } finally {
    els.chatForm.querySelector("button").disabled = false;
    renderChat();
  }
}

async function submitDiscussion(event) {
  event.preventDefault();
  const lesson = state.currentLesson;
  if (!lesson) return;
  const body = els.discussionBody.value.trim();
  if (!body) return;
  const button = els.discussionForm.querySelector("button");
  button.disabled = true;
  try {
    const response = await fetch(`/api/discussions/${encodeURIComponent(lesson.id)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: els.discussionName.value.trim(),
        body,
        website: els.discussionTrap.value,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || response.statusText);
    els.discussionBody.value = "";
    await loadDiscussion();
  } catch (error) {
    els.discussionLog.insertAdjacentHTML("afterbegin", `<p class="empty">送出失敗：${esc(error.message)}</p>`);
  } finally {
    button.disabled = false;
  }
}

function manifestHasLesson(id) {
  return Boolean(id && state.manifest?.lessons?.some((lesson) => lesson.id === id));
}

function bindEvents() {
  els.blockTabs.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-block]");
    if (!button) return;
    state.block = button.dataset.block;
    renderBlocks();
    renderLessonList();
    const first = groupedVisibleLessons()
      .flatMap((group) => [group.overview, ...group.items].filter(Boolean))
      .find(Boolean);
    if (first) showLesson(first.id);
  });
  els.lessonList.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-lesson]");
    if (button) showLesson(button.dataset.lesson);
  });
  els.search.addEventListener("input", () => {
    state.query = els.search.value;
    renderLessonList();
  });
  els.fontDecrease?.addEventListener("click", () => setFontScale(state.fontScale - 0.08));
  els.fontIncrease?.addEventListener("click", () => setFontScale(state.fontScale + 0.08));
  els.fontReset?.addEventListener("click", () => setFontScale(1));
  document.querySelector(".pane-tabs").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-tab]");
    if (button) setTab(button.dataset.tab);
  });
  els.sidebarButton.addEventListener("click", () => els.body.classList.toggle("sidebar-open"));
  els.copyChat.addEventListener("click", () => {
    const text = currentMessages().map((message) => `${message.role === "user" ? "我" : "AI"}：${message.content}`).join("\n\n");
    copyText(text);
  });
  els.chatForm.addEventListener("submit", sendChat);
  els.chatInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      els.chatForm.requestSubmit();
    }
  });
  els.discussionForm.addEventListener("submit", submitDiscussion);
  els.discussionBody.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      els.discussionForm.requestSubmit();
    }
  });
  els.reloadDiscussion.addEventListener("click", loadDiscussion);
  els.viewerClose.addEventListener("click", closeViewer);
  els.viewerImage.addEventListener("click", closeViewer);
  els.viewer.addEventListener("click", (event) => {
    if (event.target === els.viewer) closeViewer();
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !els.viewer.classList.contains("hidden")) closeViewer();
  });
  window.addEventListener("hashchange", () => {
    const id = location.hash.replace(/^#/, "");
    if (manifestHasLesson(id) && id !== state.currentLesson?.id) {
      showLesson(id, { push: false });
      return;
    }
    if (state.currentLesson && id && id !== state.currentLesson.id) {
      history.replaceState(null, "", `#${state.currentLesson.id}`);
    }
  });
}

async function init() {
  bindEvents();
  applyFontScale();
  setTab("posts");
  const response = await fetch("data/manifest.json");
  state.manifest = await response.json();
  state.block = state.manifest.blocks[0]?.id || "";
  await loadSupportData();
  const requested = location.hash.replace(/^#/, "");
  const first = state.manifest.lessons.find((lesson) => lesson.id === requested) || state.manifest.lessons[0];
  if (first?.blockId) state.block = first.blockId;
  renderBlocks();
  renderLessonList();
  if (first) await showLesson(first.id, { push: requested !== first.id });
}

init().catch((error) => {
  els.dataStatus.textContent = "載入失敗";
  els.postsPanel.innerHTML = `<p class="empty">${esc(error.message)}</p>`;
});
