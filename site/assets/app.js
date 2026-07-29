const FORUM_ORIGIN = "https://forum.rdfzer.com";
const PROGRESS_KEY = "yw-matrix-progress-v2";
const LEGACY_PROGRESS_KEY = "yw-matrix-progress-v1";
const FONT_KEY = "yw-matrix-font-v1";
const LAST_LESSON_KEY = "yw-matrix-last-lesson-v1";
const MASTERY_COLLAPSED_KEY = "yw-matrix-mastery-collapsed-v1";
const FONT_STEPS = [0.92, 1, 1.12, 1.26, 1.42, 1.6];
const STAGE_MARKS = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"];

const state = {
  manifest: null,
  taxonomy: null,
  taxonomyLessons: new Map(),
  taxonomyGenres: new Map(),
  blockId: "",
  query: "",
  lessons: new Map(),
  current: null,
  pages: [],
  pageIndex: 0,
  selectedText: "",
  lexicon: "dict",
  blueprints: new Map(),
  blueprintLoading: new Set(),
  vocabBanks: new Map(),
  vocabBankLoading: new Set(),
  lessonMedia: new Map(),
  progress: loadStoredProgress(),
  fontIndex: Number(localStorage.getItem(FONT_KEY) || 1),
  activeAuthorId: "",
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const els = {
  body: document.body,
  atlas: $("#atlas"),
  atlasOpen: $("#atlas-open"),
  atlasClose: $("#atlas-close"),
  atlasScrim: $("#atlas-scrim"),
  atlasStatus: $("#atlas-status"),
  atlasProgress: $("#atlas-progress"),
  search: $("#lesson-search"),
  bookSwitcher: $("#book-switcher"),
  lessonIndex: $("#lesson-index"),
  studyLayout: $(".study-layout"),
  readingColumn: $("#reading-column"),
  topbarContext: $("#topbar-context"),
  mobileToolsToggle: $("#mobile-tools-toggle"),
  title: $("#lesson-title"),
  mastheadVolume: $("#masthead-volume"),
  mastheadPosition: $("#masthead-position"),
  lessonPortraits: $("#lesson-portraits"),
  orientation: $("#orientation-content"),
  textFlow: $("#text-flow"),
  materialStream: $("#material-stream"),
  materialsCount: $("#materials-count"),
  lessonMediaContent: $("#lesson-media-content"),
  lessonMediaStatus: $("#lesson-media-status"),
  checkStage: $("#check-stage"),
  matrixLinks: $("#matrix-links"),
  checkpointList: $("#checkpoint-list"),
  learningRail: $("#learning-rail"),
  mobileMasteryAnchor: $("#mobile-mastery-anchor"),
  masteryToggle: $("#mastery-toggle"),
  masteryPanel: $("#mastery-panel"),
  masterySpectrum: $("#mastery-spectrum"),
  masteryValue: $("#mastery-value"),
  readProgress: $("#read-progress-bar"),
  lessonChatTitle: $("#lesson-chat-title"),
  lessonChatFrame: $("#lesson-chat-frame"),
  pageOpen: $("#page-open"),
  resourcesOpen: $("#resources-open"),
  fontDown: $("#font-down"),
  fontUp: $("#font-up"),
  fontLabel: $("#font-label"),
  focusButton: $("#focus-button"),
  lexiconDock: $("#lexicon-dock"),
  lexiconFrame: $("#lexicon-frame"),
  lexiconScrim: $("#lexicon-scrim"),
  selectionWord: $("#selection-word"),
  lexiconClose: $("#lexicon-close"),
  moeExternal: $("#moe-external"),
  pageDialog: $("#page-dialog"),
  pageDialogTitle: $("#page-dialog-title"),
  pageImage: $("#page-image"),
  pageCaption: $("#page-caption"),
  pageStrip: $("#page-strip"),
  pagePrev: $("#page-prev"),
  pageNext: $("#page-next"),
  resourceDialog: $("#resource-dialog"),
  resourceDialogTitle: $("#resource-dialog-title"),
  resourceFrame: $("#resource-frame"),
  resourceExternal: $("#resource-external"),
  toast: $("#toast"),
};

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  }[char]));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function loadStoredProgress() {
  try {
    const current = localStorage.getItem(PROGRESS_KEY);
    const parsed = JSON.parse(current || localStorage.getItem(LEGACY_PROGRESS_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveStoredProgress() {
  localStorage.setItem(PROGRESS_KEY, JSON.stringify(state.progress));
}

function enforceNewTabLinks(root = document) {
  const links = root.matches?.("a[href]") ? [root] : $$("a[href]", root);
  links.forEach((link) => {
    if (link.hasAttribute("data-same-tab")) {
      link.removeAttribute("target");
      link.removeAttribute("rel");
      return;
    }
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  });
}

function lessonProgress(id = state.current?.id) {
  if (!id) return {};
  state.progress[id] ||= {};
  return state.progress[id];
}

const MODE_TRACKS = {
  classical: [
    ["context", "初讀評議", "", 10],
    ["vocabulary", "詞級疏通", "", 30],
    ["read", "通讀正文", "", 10],
    ["revision", "字句之改", "", 15],
    ["structure", "章法機關", "", 20],
    ["evaluation", "篇目評價", "", 5],
    ["authorQuestion", "叩問作者", "", 10],
  ],
  poetry: [
    ["context", "初讀評議", "", 10], ["vocabulary", "詞級疏通", "", 25],
    ["read", "通讀正文", "", 10],
    ["revision", "字句之改", "", 15],
    ["structure", "詩脈轉折", "", 20], ["evaluation", "篇目評價", "", 10], ["authorQuestion", "叩問作者", "", 10],
  ],
  fiction: [
    ["context", "初讀評議", "", 10], ["vocabulary", "詞級疏通", "", 25],
    ["read", "通讀正文", "", 10],
    ["revision", "字句之改", "", 15],
    ["structure", "敘事機關", "", 20], ["evaluation", "篇目評價", "", 10], ["authorQuestion", "叩問作者", "", 10],
  ],
  drama: [
    ["context", "初讀評議", "", 10], ["vocabulary", "詞級疏通", "", 25],
    ["read", "通讀正文", "", 10],
    ["revision", "字句之改", "", 15],
    ["structure", "場面調度", "", 20], ["evaluation", "篇目評價", "", 10], ["authorQuestion", "叩問作者", "", 10],
  ],
  journalism: [
    ["context", "初讀評議", "", 10], ["vocabulary", "詞級疏通", "", 25],
    ["read", "通讀正文", "", 10],
    ["revision", "字句之改", "", 15],
    ["structure", "材料編排", "", 20], ["evaluation", "報道評價", "", 10], ["authorQuestion", "叩問作者", "", 10],
  ],
  argument: [
    ["context", "初讀評議", "", 10], ["vocabulary", "詞級疏通", "", 25],
    ["read", "通讀正文", "", 10],
    ["revision", "字句之改", "", 15],
    ["structure", "論證骨架", "", 20], ["evaluation", "觀點評價", "", 10], ["authorQuestion", "叩問作者", "", 10],
  ],
  science: [
    ["context", "初讀評議", "", 10], ["vocabulary", "詞級疏通", "", 25],
    ["read", "通讀正文", "", 10],
    ["revision", "字句之改", "", 15],
    ["structure", "說明次序", "", 20], ["evaluation", "文本評價", "", 10], ["authorQuestion", "叩問作者", "", 10],
  ],
  "unit-intro": [
    ["context", "單元定位", "", 20], ["read", "讀清說明", "", 20],
    ["structure", "繪製路徑", "", 25], ["evaluation", "單元預判", "", 15],
    ["authorQuestion", "提出總問題", "", 20],
  ],
  "unit-task": [
    ["context", "單元定位", "", 15], ["read", "拆解要求", "", 15],
    ["revision", "改造任務", "", 15], ["structure", "成果路徑", "", 25],
    ["evaluation", "任務評價", "", 10], ["authorQuestion", "提出問題", "", 20],
  ],
};

function modeFor(lesson = state.current) {
  const mode = state.taxonomyLessons.get(lesson?.id)?.mode || genreFor(lesson);
  if (["whole-book", "language-activity", "review"].includes(mode)) return "unit-task";
  if (mode === "speech-letter" || mode === "modern-prose") return "argument";
  return MODE_TRACKS[mode] ? mode : "argument";
}

function trackFor(lesson = state.current) {
  return MODE_TRACKS[modeFor(lesson)];
}

function checkpointDone(progress, key, lesson = state.current) {
  if (key === "read" || key === "context") return progress[key] === true || Boolean(progress[key]?.done);
  if (key === "vocabulary") return Boolean(progress.vocabulary?.done && (modeFor(lesson) === "classical" || progress.wordCreation?.done));
  return Boolean(progress[key]?.done);
}

function progressPercent(progress = lessonProgress(), lesson = state.current) {
  return trackFor(lesson).reduce((sum, [key, _label, _detail, weight]) => sum + (checkpointDone(progress, key, lesson) ? weight : 0), 0);
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => els.toast.classList.remove("show"), 2400);
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[，。！？、；：“”‘’（）《》\s·—…]/g, "")
    .replace(/課/g, "课")
    .replace(/學/g, "学")
    .replace(/習/g, "习")
    .replace(/選/g, "选")
    .replace(/單/g, "单");
}

function lessonTitle(lesson) {
  const raw = [lesson?.title, lesson?.sourceTitle, lesson?.tocLabel, lesson?.textbook?.tocLabel].filter(Boolean).join(" ");
  if (/单元(研习|学习)任务|單元(研習|學習)任務/.test(raw)) {
    return lesson.tocLabel || lesson.textbook?.tocLabel || lesson.title || "單元研習任務";
  }
  return String(lesson.title || lesson.tocLabel || lesson.textbook?.tocLabel || "未命名課文")
    .replace(/^\s*\d+\s*[.．、]?\s*/, "")
    .replace(/\s*\/\s*[\p{L}·、，,\s]{2,30}$/u, "")
    .trim();
}

function isUnitTask(lesson) {
  return /单元(研习|学习)任务|單元(研習|學習)任務/.test([
    lesson?.title, lesson?.sourceTitle, lesson?.tocLabel, lesson?.textbook?.tocLabel,
  ].filter(Boolean).join(" "));
}

function isUnitHeading(lesson) {
  return !isUnitTask(lesson) && /第[一二三四五六七八九十0-9]+[单單]元/.test(lessonTitle(lesson));
}

function isRetiredMirror(lesson) {
  return /Google\s*site|Google\s*Sites|課堂進度記錄|课堂进度记录|語雀|语雀/i.test(lessonTitle(lesson));
}

function genreFor(lesson) {
  const taxonomyMode = state.taxonomyLessons.get(lesson?.id)?.mode;
  if (taxonomyMode) return taxonomyMode;
  const title = lessonTitle(lesson);
  const excerpt = lesson.excerpt || "";
  if (isUnitHeading(lesson) || isUnitTask(lesson)) return "unit";
  if (/诗|詩|词|詞|歌|赋|賦|离骚|離騷|蜀道难|蜀道難|短歌行|琵琶行|兰亭|蘭亭|赤壁|登高|锦瑟|錦瑟|氓/.test(title)) return "poetry";
  if (/记|記|传|傳|表|序|论|論|说|說|书|書|孟子|庄子|莊子|论语|論語|史记|史記/.test(title)
    || (excerpt.match(/[之其者也矣焉兮曰]/g) || []).length > 16) return "classical";
  if (/新闻|消息|通讯|演讲|讲话|报告|宣言|社会|实践|改造/.test(title)) return "argument";
  return "narrative";
}

const genreCopy = {
  unit: {
    label: "單元統整",
    lenses: ["核心任務", "篇目關係", "能力遷移"],
    question: "用一條清晰的學習路徑說明：這個單元要求你從哪些文本證據走向哪一種語文能力？",
  },
  poetry: {
    label: "詩歌細讀",
    lenses: ["意象與鍊字", "節奏與轉折", "情感與詩史"],
    question: "選用你收集的原句，說明一個字詞或意象如何推動情感、結構與全詩立意。",
  },
  classical: {
    label: "古文細讀",
    lenses: ["實虛詞與句法", "行文與章法", "知人論世"],
    question: "以原文為證據，說明一處字句安排如何同時服務人物、結構或作者立意。",
  },
  argument: {
    label: "論述細讀",
    lenses: ["概念與判斷", "論證與推進", "時代與立場"],
    question: "指出文中的核心判斷，並用一處原文說明作者如何把材料推進為觀點。",
  },
  narrative: {
    label: "敘事細讀",
    lenses: ["字句與語氣", "敘事與結構", "人物與立意"],
    question: "選用你收集的原句，說明敘述視角、反覆、對比或細節如何導向作品立意。",
  },
};

function taxonomyFor(lesson = state.current) {
  return state.taxonomyLessons.get(lesson?.id) || { genres: [], authors: [], sourceBooks: [], mode: genreFor(lesson) };
}

function activeAuthorFor(lesson = state.current) {
  const authors = taxonomyFor(lesson).authors || [];
  return authors.find((author) => author.id === state.activeAuthorId) || authors[0] || null;
}

function authorNameFor(lesson = state.current) {
  return activeAuthorFor(lesson)?.name || (modeFor(lesson).startsWith("unit") ? "編者" : "作者");
}

function blueprintKey(lesson = state.current) {
  return `${lesson?.id || "lesson"}:${activeAuthorFor(lesson)?.id || "editor"}`;
}

function genreNodesFor(lesson = state.current) {
  return taxonomyFor(lesson).genres.map((id) => state.taxonomyGenres.get(id)).filter(Boolean);
}

function primaryGenreLabel(lesson = state.current) {
  return genreNodesFor(lesson)[0]?.label || genreCopy[genreFor(lesson)]?.label || "語文學習";
}

function currentMeta() {
  return state.manifest?.lessons?.find((lesson) => lesson.id === state.current?.id) || state.current || {};
}

function openAtlas() {
  els.body.classList.add("atlas-open");
  els.atlas.setAttribute("aria-hidden", "false");
  els.atlasOpen.setAttribute("aria-expanded", "true");
}

function closeAtlas() {
  els.body.classList.remove("atlas-open");
  els.atlas.setAttribute("aria-hidden", "true");
  els.atlasOpen.setAttribute("aria-expanded", "false");
}

function renderBooks() {
  els.bookSwitcher.innerHTML = state.manifest.blocks.map((block) => `
    <button type="button" data-block="${esc(block.id)}" class="${block.id === state.blockId ? "active" : ""}">
      ${esc(block.title)}
    </button>
  `).join("");
}

function visibleLessons() {
  const block = state.manifest.blocks.find((item) => item.id === state.blockId) || state.manifest.blocks[0];
  const query = normalizeText(state.query);
  return (block?.lessons || []).filter((lesson) => {
    if (isRetiredMirror(lesson)) return false;
    if (!query) return true;
    return normalizeText([lesson.title, lesson.sourceTitle, lesson.tocLabel, lesson.excerpt].join(" ")).includes(query);
  });
}

function renderLessonIndex() {
  const lessons = visibleLessons();
  let sequence = 0;
  els.lessonIndex.innerHTML = lessons.map((lesson) => {
    const heading = isUnitHeading(lesson);
    if (!heading) sequence += 1;
    const done = progressPercent(state.progress[lesson.id] || {}, lesson) === 100;
    const page = lesson.textbookStartPage || lesson.textbook?.startPage;
    return `
      ${heading ? `<div class="unit-marker">${esc(lessonTitle(lesson))}</div>` : ""}
      <button type="button" class="lesson-link ${state.current?.id === lesson.id ? "active" : ""} ${heading ? "overview" : ""}" data-lesson="${esc(lesson.id)}">
        <span>${heading ? "導" : String(sequence).padStart(2, "0")}</span>
        <strong>${esc(lessonTitle(lesson))}</strong>
        <small>${done ? "已掌握" : page ? `p${page}` : isUnitTask(lesson) ? "任務" : ""}</small>
      </button>
    `;
  }).join("") || `<p class="index-empty">沒有匹配的課文。</p>`;
  const allIds = state.manifest.lessons.map((lesson) => lesson.id);
  const mastered = allIds.filter((id) => progressPercent(state.progress[id] || {}, { id }) === 100).length;
  els.atlasProgress.textContent = `${mastered} / ${allIds.length}`;
}

function removeUnwantedSourceNodes(root) {
  $$('script, style, iframe, form', root).forEach((node) => node.remove());
  $$('small', root).forEach((node) => {
    if (/companion discussion|sites\.google|yuque|語雀/i.test(node.textContent || "")) node.remove();
  });
  const notes = new Map();
  $$('.footnotes-list .footnote-item, li[id^="footnote-"]', root).forEach((item) => {
    const clone = item.cloneNode(true);
    $$('.footnote-backref', clone).forEach((node) => node.remove());
    const raw = cleanAnnotationText((clone.textContent || "").replace(/^\s*\[[^\]]+\]\s*/, ""));
    const parsed = annotationParts(raw);
    notes.set(item.id, {
      word: parsed.word,
      text: parsed.note || raw,
    });
  });
  $$('.footnote-ref', root).forEach((reference) => {
    const link = reference.querySelector('a[href^="#"]');
    const id = link?.getAttribute("href")?.slice(1) || "";
    const note = notes.get(id);
    if (!note?.text) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "inline-note";
    button.dataset.note = note.text;
    button.dataset.word = /^[\p{Script=Han}·]{1,10}$/u.test(note.word)
      ? note.word
      : precedingAnnotationWord(reference);
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-label", `查看註釋 ${link.textContent || ""}`);
    button.textContent = link.textContent || "註";
    reference.replaceWith(button);
  });
  $$('.footnotes-list, .footnotes-sep', root).forEach((node) => node.remove());
  $$('a', root).forEach((link) => {
    const raw = link.getAttribute("href") || "";
    if (raw.startsWith("#")) return;
    let url;
    try { url = new URL(raw, FORUM_ORIGIN); } catch { return; }
    if (/sites\.google\.com|yuque\.com/i.test(url.hostname)) {
      link.replaceWith(document.createTextNode(link.textContent || ""));
      return;
    }
    if (url.origin === FORUM_ORIGIN || raw.startsWith("/")) link.href = url.toString();
    if (!url.hash || url.origin !== location.origin) {
      link.target = "_blank";
      link.rel = "noreferrer";
    }
  });
  $$('img', root).forEach((image) => {
    try { image.src = new URL(image.getAttribute("src") || "", FORUM_ORIGIN).toString(); } catch { /* noop */ }
    image.loading = "lazy";
    image.decoding = "async";
  });
  root.innerHTML = root.innerHTML
    .replace(/\[color=([^\]]+)\]/gi, '<span class="source-emphasis">')
    .replace(/\[\/color\]/gi, "</span>")
    .replace(/\[right\]|\[center\]|\[left\]|\[\/right\]|\[\/center\]|\[\/left\]/gi, "");
}

function cleanAnnotationText(value) {
  return String(value || "")
    .replace(/\[color=[^\]]+\]|\[\/color\]/gi, "")
    .replace(/(?:<|&lt;)\/?span(?:\s[^>]*?)?(?:>|&gt;)/gi, "")
    .replace(/↩︎/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function annotationParts(value) {
  const text = cleanAnnotationText(value);
  const bracketed = text.match(/^〔([^〕]+)〕\s*(.*)$/s);
  const colon = !bracketed ? text.match(/^(.{1,28}?)[：:]\s*(.*)$/s) : null;
  const rawWord = bracketed?.[1] || colon?.[1] || text.slice(0, 12);
  const word = rawWord
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/[A-Za-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüɡ]+/g, "")
    .replace(/[「」『』“”‘’《》〈〉（）()〔〕［］【】\[\]，。；;、？！!?：:\s]/g, "")
    .trim();
  return { word, note: (bracketed?.[2] || colon?.[2] || text).trim() };
}

function precedingAnnotationWord(reference) {
  const text = reference?.previousSibling?.textContent || "";
  return text.match(/([\p{Script=Han}·]{1,8})$/u)?.[1] || "";
}

function cleanedCooked(html) {
  const doc = new DOMParser().parseFromString(`<div id="clean-root">${html || ""}</div>`, "text/html");
  const root = doc.querySelector("#clean-root");
  removeUnwantedSourceNodes(root);
  return root.innerHTML;
}

function primaryContentParts(lesson) {
  const primary = primaryPost(lesson);
  if (!primary) return { html: "", examPrompts: [], frontMatter: "" };
  const doc = new DOMParser().parseFromString(`<div id="primary-root">${cleanedCooked(primary.cooked)}</div>`, "text/html");
  const root = doc.querySelector("#primary-root");
  const firstQuote = root.querySelector("blockquote");
  const examPrompts = firstQuote && /(20\d{2}|高考|真题|真題)/.test(firstQuote.textContent || "")
    ? $$('p', firstQuote).map((node) => (node.textContent || "").replace(/\s+/g, " ").trim()).filter(Boolean)
    : [];
  let frontMatter = "";
  if (examPrompts.length) {
    firstQuote.remove();
  } else if (firstQuote && /(选自|選自|作者|写了|寫了|人\（|人\(|生卒|原题|原題)/.test(firstQuote.textContent || "")) {
    frontMatter = firstQuote.innerHTML;
    firstQuote.remove();
  }
  const firstHeading = root.querySelector("h1, h2, h3");
  if (firstHeading) {
    const heading = normalizeText(firstHeading.textContent || "");
    const title = normalizeText(lessonTitle(lesson)).replace(/^\d+/, "");
    if (heading.length > 1 && (title.includes(heading) || heading.includes(title.slice(0, Math.min(12, title.length))))) firstHeading.remove();
  }
  return { html: root.innerHTML, examPrompts, frontMatter };
}

function meaningfulPosts(lesson) {
  const seen = new Set();
  return (lesson.posts || []).filter((post) => {
    const text = String(post.plain_text || "").replace(/\s+/g, " ").trim();
    const key = normalizeText(text).slice(0, 1000);
    if (key.length < 20 && !(post.images || []).length) return false;
    if (key.length > 80 && seen.has(key)) return false;
    if (key.length > 80) seen.add(key);
    return true;
  });
}

function primaryPost(lesson) {
  const posts = meaningfulPosts(lesson);
  return posts.find((post) => (post.plain_text || "").length > 350 && !/^https?:\/\//.test((post.plain_text || "").trim())) || posts[0];
}

function renderOrientation(lesson) {
  const taxonomy = taxonomyFor(lesson);
  const activeAuthorId = taxonomy.authors.some((author) => author.id === state.activeAuthorId)
    ? state.activeAuthorId
    : taxonomy.authors[0]?.id || "";
  const orderedAuthors = [...taxonomy.authors].sort((a, b) => {
    if (a.id === activeAuthorId) return -1;
    if (b.id === activeAuthorId) return 1;
    return 0;
  });
  const genres = genreNodesFor(lesson);
  const unitMode = modeFor(lesson).startsWith("unit");
  const authorText = taxonomy.authors.map((author) => author.url
    ? `<a href="${esc(author.url)}" target="_blank" rel="noreferrer">${esc(author.name)}</a>`
    : `<span>${esc(author.name)}</span>`).join("、");
  const representativeText = taxonomy.representativeFigure
    ? `本頁人物視覺為 <a href="${esc(taxonomy.representativeFigure.url)}" target="_blank" rel="noreferrer">${esc(taxonomy.representativeFigure.name)}</a>（${esc(taxonomy.representativeFigure.role)}），不作課文作者歸屬。`
    : "";
  const bookText = taxonomy.sourceBooks.map((book) => `<a href="books.html?q=${encodeURIComponent(book)}" target="_blank" rel="noopener noreferrer">《${esc(book)}》</a>`).join("、");
  const relation = unitMode ? "先讀清篇目關係、學習動詞與成果標準。" : [
    `這是一篇 <a href="genres.html#${esc(genres[genres.length - 1]?.id || genres[0]?.id || "root")}" target="_blank" rel="noopener noreferrer">${esc(primaryGenreLabel(lesson))}</a>。`,
    authorText ? `作者 ${authorText}。` : "",
    bookText ? `課文選自 ${bookText}。` : "",
  ].filter(Boolean).join("");
  els.orientation.innerHTML = `<p class="orientation-line">${[relation, representativeText].filter(Boolean).join(" ")}</p>`;
  els.lessonPortraits.setAttribute("aria-label", taxonomy.authors.length ? "作者肖像" : taxonomy.representativeFigure ? taxonomy.representativeFigure.role : "人物視覺");
  els.lessonPortraits.innerHTML = taxonomy.authors.length ? orderedAuthors.map((author, index) => {
    const isNameCard = author.portraitKind === "documented-no-reliable-portrait";
    return `
    <button type="button" class="portrait-choice${isNameCard ? " name-card" : ""}" data-author-id="${esc(author.id)}" style="--portrait-index:${index}" aria-label="${isNameCard ? `${esc(author.name)}無可靠肖像姓名卡` : `切換至${esc(author.name)}`}" aria-pressed="${author.id === activeAuthorId ? "true" : "false"}">
      <span>${esc(author.name.slice(0, 1))}</span>
      ${author.url ? `<img src="https://qx.bdfz.net/img/figures/${encodeURIComponent(author.id)}.webp" alt="${isNameCard ? `${esc(author.name)}無可靠肖像姓名卡` : esc(author.name)}" loading="eager" onerror="this.remove()">` : ""}
      ${isNameCard ? "<small>無可靠肖像 · 姓名卡</small>" : ""}
      <b>${esc(author.name)}</b>
    </button>
  `; }).join("") : taxonomy.representativeFigure ? `
    <a class="portrait-choice representative-choice${taxonomy.representativeFigure.portraitKind === "documented-no-reliable-portrait" ? " name-card" : ""}" href="${esc(taxonomy.representativeFigure.url)}" target="_blank" rel="noopener noreferrer" aria-label="查看${esc(taxonomy.representativeFigure.name)}：${esc(taxonomy.representativeFigure.role)}">
      <span>${esc(taxonomy.representativeFigure.name.slice(0, 1))}</span>
      <img src="https://qx.bdfz.net/img/figures/${encodeURIComponent(taxonomy.representativeFigure.id)}.webp" alt="${esc(taxonomy.representativeFigure.name)}，${esc(taxonomy.representativeFigure.role)}" loading="eager" onerror="this.remove()">
      <small>${esc(taxonomy.representativeFigure.role)}</small>
      <b>${esc(taxonomy.representativeFigure.name)}</b>
    </a>
  ` : `<div class="portrait-constellation" aria-hidden="true"><i></i><i></i><i></i><span>${esc(primaryGenreLabel(lesson))}</span></div>`;
  $$('[data-author-id]', els.lessonPortraits).forEach((portrait) => portrait.addEventListener("click", () => {
    state.activeAuthorId = portrait.dataset.authorId || state.activeAuthorId;
    if (portrait !== els.lessonPortraits.firstElementChild) els.lessonPortraits.prepend(portrait);
    $$(".portrait-choice", els.lessonPortraits).forEach((item, index) => {
      item.style.setProperty("--portrait-index", index);
      item.setAttribute("aria-pressed", String(index === 0));
    });
    renderCheckStage(lesson);
  }));
}

function renderLessonMedia(lesson) {
  const media = state.lessonMedia.get(lesson.id);
  if (!media) {
    els.lessonMediaStatus.textContent = "本課尚未列入選修教材視覺資源計畫";
    els.lessonMediaContent.innerHTML = `<p class="empty-state">目前先完成選擇性必修上、中、下的課文來源核查。</p>`;
    return;
  }
  const ready = Boolean(media.slideDeck);
  els.lessonMediaStatus.textContent = ready
    ? `來源 ${media.sourceVersion} · ${media.generatedAt ? new Date(media.generatedAt).toLocaleDateString("zh-CN") : "日期待記錄"} · 已人工審核`
    : media.pilot
      ? "試點來源包已核查，視覺資源正在生成與審核"
      : "來源目錄與課程標準映射已登記；本課未生成 Slide";
  if (!ready) {
    els.lessonMediaContent.innerHTML = `
      <article class="media-pending">
        <span>${media.pilot ? "PILOT" : "PLANNED"}</span>
        <div>
          <h3>${media.pilot ? "試點資源製作中" : "來源目錄已登記"}</h3>
          <p>來源版本：${esc(media.sourceVersion)}；Slide Deck 指令：${esc(media.promptVersions.slideDeck)}。</p>
        </div>
      </article>`;
    return;
  }
  els.lessonMediaContent.innerHTML = `
    <div class="lesson-media-grid">
      <article class="slide-deck-card">
        <div class="media-card-kicker">SLIDE DECK · PDF</div>
        <h3>課堂演示</h3>
        <p>按課文結構組織關鍵問題、文本證據、閱讀方法與學習任務。</p>
        <div class="media-card-actions">
          <button type="button" data-slide-open="${esc(media.slideDeck.href)}" data-slide-title="${esc(media.slideDeck.title)}">頁內閱讀</button>
          <a href="${esc(media.slideDeck.href)}" target="_blank" rel="noopener noreferrer">另頁打開 ↗</a>
        </div>
      </article>
    </div>
    <dl class="media-provenance">
      <div><dt>來源版本</dt><dd>${esc(media.sourceVersion)}</dd></div>
      <div><dt>生成指令</dt><dd>${esc(media.promptVersions.slideDeck)}</dd></div>
      <div><dt>生成日期</dt><dd>${esc(media.generatedAt ? new Date(media.generatedAt).toLocaleDateString("zh-CN") : "待記錄")}</dd></div>
      <div><dt>審核狀態</dt><dd>${esc(media.reviewStatus.slideDeck)}</dd></div>
    </dl>`;
}

function renderText(lesson) {
  const posts = meaningfulPosts(lesson);
  const primary = primaryPost(lesson);
  if (!primary) {
    els.textFlow.innerHTML = `<p class="empty-state">本課正文仍在整理，可先核對教材原圖。</p>`;
    return;
  }
  const primaryParts = primaryContentParts(lesson);
  els.textFlow.innerHTML = `
    <div class="primary-text" data-post="${esc(primary.post_number || primary.id)}">
      ${primaryParts.html}
    </div>
    ${posts.filter((post) => post !== primary && (post.plain_text || "").length > 180 && !(post.attachments || []).length).slice(0, 8).map((post, index) => `
      <details class="extension-reading">
        <summary><span>延伸 ${String(index + 1).padStart(2, "0")}</span>${esc(String(post.plain_text || "").replace(/\s+/g, " ").slice(0, 46))}</summary>
        <div class="extension-body">${cleanedCooked(post.cooked)}</div>
      </details>
    `).join("")}
  `;
}

function absoluteResourceUrl(raw) {
  try { return new URL(raw, FORUM_ORIGIN).toString(); } catch { return raw || ""; }
}

function resourceTitle(resource, url) {
  const text = String(resource.text || resource.title || "").trim();
  if (text && !/^https?:\/\//i.test(text)) return text.replace(/\s*\([^)]*(KB|MB|GB)\)\s*$/i, "");
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() || new URL(url).hostname);
  } catch {
    return "學習資料";
  }
}

function resourcesFor(lesson) {
  const seen = new Set();
  return (lesson.resources || []).reduce((items, resource) => {
    const href = absoluteResourceUrl(resource.href);
    if (!href || /sites\.google\.com|yuque\.com|\/u\//i.test(href)) return items;
    const key = href.replace(/[?#].*$/, "").replace(/\/$/, "").toLowerCase();
    if (seen.has(key)) return items;
    seen.add(key);
    items.push({
      href,
      title: resourceTitle(resource, href),
      kind: resource.kind || (/\.pdf(?:$|\?)/i.test(href) ? "document" : "link"),
      postNumber: resource.postNumber,
    });
    return items;
  }, []);
}

function renderMaterials(lesson) {
  const resources = resourcesFor(lesson);
  els.materialsCount.textContent = resources.length ? `${resources.length} 項已去重資料，可直接投影` : "本課暫無獨立附件";
  els.materialStream.innerHTML = resources.length ? `
    <div class="material-list">
      ${resources.map((resource, index) => `
        <button type="button" class="material-row" data-resource-index="${index}">
          <span>${String(index + 1).padStart(2, "0")}</span>
          <strong>${esc(resource.title)}</strong>
          <small>${esc(resource.kind === "document" ? "文檔" : "網頁")}${resource.postNumber ? ` · 原帖 #${esc(resource.postNumber)}` : ""}</small>
          <em>投影 ↗</em>
        </button>
      `).join("")}
    </div>
  ` : `<p class="empty-state">本課內容已集中在正文與教材原圖，不再重複列出 Google Sites 或語雀鏡像。</p>`;
}

function lessonVocabulary(lesson) {
  const posts = meaningfulPosts(lesson);
  const primary = primaryPost(lesson);
  if (!primary) return [];
  const sources = [
    primary,
    ...posts.filter((post) => (
      post !== primary &&
      (post.plain_text || "").length > 180 &&
      !(post.attachments || []).length
    )).slice(0, 8),
  ];
  const items = [];
  sources.forEach((post) => {
    const doc = new DOMParser().parseFromString(`<div>${post.cooked || ""}</div>`, "text/html");
    $$('.footnote-ref', doc).forEach((reference) => {
      const link = reference.querySelector('a[href^="#"]');
      const id = link?.getAttribute("href")?.slice(1) || "";
      const item = id ? doc.getElementById(id) : null;
      if (!item) return;
      const clone = item.cloneNode(true);
      $$('.footnote-backref', clone).forEach((node) => node.remove());
      const parsed = annotationParts(clone.textContent || "");
      const word = /^[\p{Script=Han}·]{1,10}$/u.test(parsed.word)
        ? parsed.word
        : precedingAnnotationWord(reference);
      if (!word) return;
      items.push({ id, word, note: parsed.note || cleanAnnotationText(clone.textContent || "") });
    });
  });
  return items.filter((item) => /^[\p{Script=Han}·]{1,10}$/u.test(item.word))
    .filter((item, index, all) => all.findIndex((other) => other.word === item.word) === index);
}

function blueprintFallback(lesson) {
  const mode = modeFor(lesson);
  const speaker = authorNameFor(lesson);
  const focus = {
    classical: "我先陳情、再轉折、最後落到現實請求；你能說清這個次序為何既合情又能達成目的嗎？",
    poetry: "我讓意象、節奏與情感在一個關鍵處同時轉向；你找到那裡了嗎？",
    fiction: "我把一個細節、視角或延宕放在最關鍵的位置；你能說清它如何改變人物命運嗎？",
    drama: "我用出場、對話和潛台詞把衝突推到不能迴避的時刻；你找到那一步了嗎？",
    journalism: "我刻意排列事實、引語與典型材料；你能說清這個報道角度如何成立嗎？",
    science: "我從問題走向證據，又限制結論的邊界；你能指出這條推理鏈嗎？",
    argument: "我由核心概念推進到判斷，並預先處理反駁；你能指出最關鍵的一步嗎？",
    "unit-intro": "我把人文主題、篇目關係與語文能力組成一條路；你能依次走出來嗎？",
    "unit-task": "我把材料、行動、合作方式和成果標準連成一路；你能找到最容易斷裂的一環嗎？",
  }[mode];
  return {
    structureFocus: `我是${speaker}。安排《${lessonTitle(lesson)}》時，我最在意這件事：${focus}`,
  };
}

async function ensureBlueprint(lesson) {
  const key = blueprintKey(lesson);
  if (state.blueprints.has(key) || state.blueprintLoading.has(key)) return;
  state.blueprintLoading.add(key);
  try {
    const response = await fetch("/api/lesson-blueprint", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        lessonId: lesson.id,
        lessonTitle: lessonTitle(lesson),
        mode: modeFor(lesson),
        genres: genreNodesFor(lesson).map((genre) => genre.label),
        authors: [authorNameFor(lesson)],
        excerpt: String(primaryPost(lesson)?.plain_text || lesson.excerpt || "").slice(0, 3600),
      }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "blueprint unavailable");
    state.blueprints.set(key, payload.blueprint || blueprintFallback(lesson));
  } catch {
    state.blueprints.set(key, blueprintFallback(lesson));
  } finally {
    state.blueprintLoading.delete(key);
    if (state.current?.id === lesson.id) renderCheckStage(lesson);
  }
}

function interactionResult(progress, key) {
  const result = progress[key]?.result;
  if (!result) return "";
  return `<div class="interaction-result"><header><strong>${esc(result.verdict)}</strong><span>${esc(result.score)} / 100</span></header><p>${esc(result.strength)}</p><p><b>還差一步：</b>${esc(result.gap)}</p><p><b>追問：</b>${esc(result.nextQuestion)}</p></div>`;
}

function authorDialogue(lesson, body, result = "", action = "") {
  const author = activeAuthorFor(lesson);
  const name = authorNameFor(lesson);
  return `<div class="author-dialog" data-author-dialog="${esc(name)}">
    <div class="author-dialog-head">
      <span class="author-dialog-avatar">${author?.url ? `<img src="https://qx.bdfz.net/img/figures/${encodeURIComponent(author.id)}.webp" alt="" onerror="this.remove()">` : ""}<b>${esc(name.slice(0, 1))}</b></span>
      <strong>${esc(name)}</strong>
    </div>
    <div class="author-dialog-body">${body}${result}</div>
    ${action ? `<div class="dialog-action-row">${action}</div>` : ""}
  </div>`;
}

// ---------- 字詞題庫（結構化詞級疏通；無題庫課文回退註詞逐查） ----------
async function ensureVocabBank(lesson) {
  const id = lesson?.id;
  if (!id || state.vocabBanks.has(id) || state.vocabBankLoading.has(id)) return;
  state.vocabBankLoading.add(id);
  try {
    const response = await fetch(`data/vocab/${encodeURIComponent(id)}.json`);
    if (!response.ok) throw new Error(String(response.status));
    const bank = await response.json();
    const questions = (bank.inventory || []).filter((item) => item.decision === "question");
    state.vocabBanks.set(id, questions.length ? { ...bank, questions } : null);
  } catch {
    state.vocabBanks.set(id, null);
  } finally {
    state.vocabBankLoading.delete(id);
    if (state.current?.id === id) renderCheckStage(state.current);
  }
}

function quizRecord(progress) {
  progress.vocabularyQuiz ||= { answers: {} };
  progress.vocabularyQuiz.answers ||= {};
  return progress.vocabularyQuiz;
}

function quizItemState(quiz, itemId) {
  return quiz.answers[itemId] || { attempts: 0, correct: false, mastered: false };
}

function quizSolvedCount(quiz, questions) {
  return questions.filter((item) => quizItemState(quiz, item.id).correct).length;
}

function markSentence(sentence, word) {
  const escaped = esc(sentence);
  const target = esc(word || "");
  if (!target || !escaped.includes(target)) return escaped;
  return escaped.replace(target, `<mark>${target}</mark>`);
}

const QUIZ_TYPE_LABEL = {
  "contextual-choice": "語境義", "gu-jin": "古今異義", substitution: "換詞判斷",
  discrimination: "近義辨析", usage: "用法", pronunciation: "讀音",
  interpretation: "句意", evidence: "原文定位",
};

function renderVocabularyQuiz(lesson, progress, bank) {
  const quiz = quizRecord(progress);
  const questions = bank.questions;
  const solved = quizSolvedCount(quiz, questions);
  let current = questions.find((item) => item.id === quiz.cursorId) || null;
  if (!current) current = questions.find((item) => !quizItemState(quiz, item.id).correct) || null;
  const percent = Math.round(solved / questions.length * 100);
  const header = `<div class="vocabulary-progress" aria-label="字詞題 ${solved} / ${questions.length}"><span></span><b>${solved} / ${questions.length}</b></div>`;
  if (!current) {
    const firstTry = questions.filter((item) => quizItemState(quiz, item.id).mastered).length;
    return `<div class="vocabulary-step vocab-quiz" style="--vocabulary-progress:${percent}%">${header}
      <p class="vocabulary-complete">字詞題全部過關：${questions.length} 題，其中 ${firstTry} 題一次答對。</p>
    </div>${modeFor(lesson) !== "classical" ? renderWordCreation(lesson, progress) : ""}`;
  }
  const itemState = quizItemState(quiz, current.id);
  const answered = itemState.lastPick;
  const showExplain = itemState.attempts > 0;
  return `<div class="vocabulary-step vocab-quiz" style="--vocabulary-progress:${percent}%">${header}
    <div class="quiz-item" data-quiz-item="${esc(current.id)}">
      <p class="quiz-kicker"><b>${esc(QUIZ_TYPE_LABEL[current.type] || "字詞")}</b><i>難度 ${"◆".repeat(current.difficulty || 1)}</i><button type="button" class="quiz-lookup" data-quiz-lookup="${esc(current.word)}">查「${esc(current.word)}」</button></p>
      ${current.sourceSentence ? `<p class="quiz-sentence">${markSentence(current.sourceSentence, current.word)}</p>` : ""}
      <p class="quiz-question">${esc(current.question)}</p>
      <div class="quiz-options">${current.options.map((option, index) => {
        const picked = answered === index;
        const isAnswer = index === current.answerIndex;
        const tone = picked ? (isAnswer ? "correct" : "wrong") : (showExplain && isAnswer && itemState.revealed ? "correct" : "");
        return `<button type="button" data-quiz-option="${index}" class="${tone}">${esc(option)}</button>`;
      }).join("")}</div>
      ${itemState.correct || itemState.revealed
        ? `<div class="quiz-explain ${itemState.correct ? "good" : ""}">${itemState.correct ? "✓ " : ""}${esc(current.explanation)}${current.sourceRefs?.length ? `<small>依據：${current.sourceRefs.map(esc).join("、")}</small>` : ""}</div>`
        : (showExplain ? `<div class="quiz-explain">還不對。回到原句想一想：這個詞在句中的實際功能與搭配是什麼？</div>` : "")}
    </div>
  </div>`;
}

function recordLearning(interactionKey, data = {}, options = {}) {
  if (!state.current?.id) return Promise.resolve({ ok: false, reason: "no-lesson" });
  const pending = window.YwLearningEvidence?.record?.(interactionKey, state.current.id, data, options);
  return pending
    ? pending.catch(() => ({ ok: false, reason: "unavailable" }))
    : Promise.resolve({ ok: false, reason: "identity-unavailable" });
}

async function recordVocabAttempt(itemId, selectedIndex) {
  try {
    await fetch("/api/reading/vocab-attempt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        lessonId: state.current.id,
        itemId,
        selectedIndex,
        clientMutationId: window.YwLearningEvidence?.mutationId?.("vocabAnswer", state.current.id),
      }),
    });
  } catch { /* 離線/未登入時僅記本地 */ }
}

function renderWordCreation(lesson, progress) {
  const value = progress.wordCreation && typeof progress.wordCreation === "object" ? progress.wordCreation : {};
  const mode = modeFor(lesson);
  const ending = mode === "poetry" ? "三行短詩" : mode === "drama" ? "三句對白" : mode === "fiction" ? "三句微型敘事" : "三句話";
  const body = `<p class="word-creation-prompt">選一個剛疏通的詞，用它寫${ending}。</p><input data-field="wordCreation.word" value="${esc(value.word || "")}" aria-label="本文新學到的一個字詞"><textarea data-field="wordCreation.creation" rows="5" aria-label="用這個字詞寫${ending}">${esc(value.creation || "")}</textarea>`;
  return authorDialogue(lesson, body, interactionResult(progress, "wordCreation"), `<button class="check-action" type="button" data-ai-check="wordCreation">核對</button>`);
}

function wadangMark(label) {
  return `<span class="stage-wadang" aria-hidden="true"><svg viewBox="0 0 48 48" focusable="false"><circle cx="24" cy="24" r="21"></circle><path d="M24 5v38M5 24h38M10.6 10.6l26.8 26.8M37.4 10.6 10.6 37.4"></path><circle cx="24" cy="24" r="8"></circle></svg><b>${esc(label)}</b></span>`;
}

function renderInteractionBody(key, lesson, progress, blueprint) {
  const rawValue = progress[key];
  const value = rawValue && typeof rawValue === "object" ? rawValue : (rawValue === true ? { done: true } : {});
  if (key === "context") {
    const words = String(value.words || "").split(/[，,、\s]+/).filter(Boolean).slice(0, 3);
    const body = `<div class="three-word-check"><div class="three-word-fields">${[0, 1, 2].map((index) => `<input data-context-word data-field="context.word${index + 1}" value="${esc(words[index] || "")}" maxlength="12" aria-label="第${index + 1}個詞" autocomplete="off">`).join("")}</div><span class="auto-check-status" data-auto-status="contextWords" aria-live="polite">${words.length === 3 ? "已記下" : `${words.length}/3`}</span></div>`;
    return authorDialogue(lesson, body, interactionResult(progress, "context"));
  }
  if (key === "vocabulary") {
    const bank = state.vocabBanks.get(lesson.id);
    if (bank) return renderVocabularyQuiz(lesson, progress, bank);
    if (bank === undefined && state.vocabBankLoading.has(lesson.id)) {
      return `<div class="vocabulary-step"><p class="vocabulary-empty">正在準備本課字詞題…</p></div>`;
    }
    const words = lessonVocabulary(lesson);
    const reviewed = new Set(value.reviewed || []);
    const completed = words.length === 0 || reviewed.size >= words.length;
    const current = words.find((item) => !reviewed.has(item.word));
    const percent = words.length ? Math.round(reviewed.size / words.length * 100) : 0;
    return `<div class="vocabulary-step" style="--vocabulary-progress:${percent}%">
      <div class="vocabulary-progress" aria-label="詞級疏通 ${reviewed.size} / ${words.length}"><span></span><b>${reviewed.size} / ${words.length}</b></div>
      ${completed ? (words.length ? `<p class="vocabulary-complete">已逐詞核對。</p>` : `<p class="vocabulary-empty">正文沒有獨立註詞。</p>`) : `<button type="button" data-vocabulary="${esc(current.word)}" data-note="${esc(current.note)}"><span>下一詞</span><strong>${esc(current.word)}</strong><em>查</em></button>`}
    </div>${completed && modeFor(lesson) !== "classical" ? renderWordCreation(lesson, progress) : ""}`;
  }
  if (key === "read") return `<label class="read-check"><input type="checkbox" data-read-check ${value.checked || value.done ? "checked" : ""}><span>我已完成一次不中斷的正文通讀</span></label>`;
  if (key === "authorQuestion") return authorDialogue(lesson, `<textarea data-field="authorQuestion.answer" rows="4" aria-label="你想問作者的問題" placeholder="你最想我的問題是什麼，你問，我答。">${esc(value.answer || "")}</textarea>`, interactionResult(progress, key), `<button class="check-action" type="button" data-ai-check="authorQuestion">問</button>`);
  if (key === "revision") return authorDialogue(lesson, `<div class="revision-row"><input data-field="revision.original" value="${esc(value.original || "")}" aria-label="原文"><select data-field="revision.action" aria-label="增刪調"><option ${value.action === "調" ? "selected" : ""}>調</option><option ${value.action === "增" ? "selected" : ""}>增</option><option ${value.action === "刪" ? "selected" : ""}>刪</option></select><input data-field="revision.revised" value="${esc(value.revised || "")}" aria-label="改文"></div><textarea data-field="revision.reason" rows="4" aria-label="改動理由" placeholder="請說明如何修改的緣由">${esc(value.reason || "")}</textarea>`, interactionResult(progress, key), `<button class="check-action" type="button" data-ai-check="revision">核對</button>`);
  if (key === "structure") return authorDialogue(lesson, `<p class="structure-focus">${esc(blueprint.structureFocus)}</p><textarea data-field="structure.reason" rows="4" aria-label="回答作者的章法問題">${esc(value.reason || "")}</textarea>`, interactionResult(progress, key), `<button class="check-action" type="button" data-ai-check="structure">回應</button>`);
  if (key === "evaluation") return `<div class="rating-spectrum rating-numeric" style="--rating:${Number(value.rating || 0)}"><div class="rating-line"></div>${[1, 2, 3, 4, 5].map((rating) => `<button type="button" data-rating="${rating}" class="${Number(value.rating) === rating ? "active" : ""}" aria-label="${rating} 分"><i></i><strong>${rating}</strong></button>`).join("")}</div>`;
  return "";
}

function renderCheckStage(lesson) {
  const progress = lessonProgress();
  const blueprint = state.blueprints.get(blueprintKey(lesson)) || blueprintFallback(lesson);
  const track = trackFor(lesson);
  els.checkStage.innerHTML = track.map(([key, label, _detail, weight], index) => `
    <section class="check-round ${checkpointDone(progress, key) ? "complete" : ""}" data-round="${key}">
      <header>${wadangMark(STAGE_MARKS[index] || index + 1)}<h3>${esc(label)}</h3><b>${checkpointDone(progress, key) ? "本課完成" : `本課 ${weight}%`}</b></header>
      ${renderInteractionBody(key, lesson, progress, blueprint)}
    </section>
  `).join("");
  bindCheckStage();
  void ensureBlueprint(lesson);
  void ensureVocabBank(lesson);
}

function matrixItemsFor(lesson) {
  const mode = modeFor(lesson);
  const title = lessonTitle(lesson);
  const taxonomy = taxonomyFor(lesson);
  const items = [
    { label: "此刻同讀", title: `帶著《${title}》去時聊，和正在線上的讀者交換一句發現`, href: "https://chat.bdfz.net/", meta: "時聊 · 匿名整點聊天", kind: "together" },
    { label: "原帖共讀", title: "回到本課材料源，補充、追問或回應別人的讀法", href: lesson.forumUrl || "https://forum.rdfzer.com", meta: "彣彰 · 課文討論", kind: "together" },
    { label: "跨冊定位", title: "在完整教材中核對原頁，尋找同題互文", href: `https://jc.bdfz.net/?q=${encodeURIComponent(title)}`, meta: "教材 PDF", kind: "source" },
  ];
  const linkedAuthor = taxonomy.authors.find((author) => author.url);
  if (linkedAuthor) items.push({ label: "知人論世", title: `沿${linkedAuthor.name}的關係繼續讀`, href: linkedAuthor.url, meta: "群賢星圖", kind: "source" });
  if (taxonomy.sourceBooks.length) items.push({ label: "書目互文", title: `查看《${taxonomy.sourceBooks[0]}》與五冊篇目的連線`, href: `books.html?q=${encodeURIComponent(taxonomy.sourceBooks[0])}`, meta: "書目星圖", kind: "source" });
  const add = (label, text, href, meta) => items.push({ label, title: text, href, meta, kind: "ability" });
  if (mode === "classical") {
    add("文言遷移", "把本課實詞、句法與章法帶入高考文言", "https://gwyw.bdfz.net/", "AI 文言");
    add("字詞闖關", "把剛核對的古漢語字詞放進新的語境", "https://wygame.bdfz.net/", "AI 字詞");
    add("背誦默寫", "對需要積累的名句做誦讀、接龍與默寫", "https://recite.bdfz.net/", "高考背誦");
  } else if (mode === "poetry") {
    add("詩詞鑑賞", "把意象、聲律與鍊字判斷遷移到陌生詩歌", "https://shi.bdfz.net/", "AI 詩詞");
    add("聲音重讀", "換用耳朵核對節奏、停連與情感變奏", "https://voice.bdfz.net/", "人籟");
    add("默寫鞏固", "從理解走到可提取的古詩文積累", "https://mf.bdfz.net/", "高考默寫");
  } else if (["fiction", "drama"].includes(mode)) {
    add("敘事遷移", "把人物、細節與結尾判斷帶進高考散文", "https://gksw.bdfz.net/", "AI 散文");
    add("改寫成篇", "把本課的一字之改擴展為完整敘事寫作", "https://zw.bdfz.net/", "AI 作文");
    add("共讀書架", "從單篇人物走向整本書與共同閱讀", "https://coread.bdfz.net/", "披覽 · 共讀");
  } else if (["journalism", "science"].includes(mode)) {
    add("材料遷移", "把來源、圖表、證據與結論放進非連續文本", "https://flx.bdfz.net/", "AI 非連");
    add("真題核驗", "在高考真題中追蹤同一類信息處理能力", "https://gks.bdfz.net/", "高考真題");
    add("術語辨析", "核對本課使用的概念與語文術語", "https://sy.bdfz.net/", "語文術語圖譜");
  } else {
    add("語用遷移", "把概念、句式與語氣選擇轉成語用判斷", "https://yyjc.bdfz.net/", "AI 語用");
    add("觀點成篇", "把本課評價發展成有證據的議論文字", "https://zw.bdfz.net/", "AI 作文");
    add("真題坐標", "回到完整真題庫確認能力在高考中的位置", "https://gk.bdfz.net/", "AI 高考");
  }
  if (/論語|孔子|子路|顏淵/.test(title)) {
    add("論語互證", "讓本課語句與《論語》章句互相發問", "https://kz.bdfz.net/", "AI 論語");
    add("義戰辨章", "用章句辨析檢驗你的價值判斷", "https://ly.bdfz.net/", "義戰論語");
  }
  return items.slice(0, 9);
}

function renderMatrix(lesson) {
  const examPrompts = primaryContentParts(lesson).examPrompts;
  els.matrixLinks.innerHTML = `
    ${examPrompts.length ? `
      <section class="exam-anchor">
        <header><span>本課真題錨點</span><strong>${examPrompts.length} 道／組</strong></header>
        ${examPrompts.map((prompt) => `<p>${esc(prompt)}</p>`).join("")}
        <a class="exam-more" href="https://gk.bdfz.net/" target="_blank" rel="noreferrer">進入完整高考真題庫 ↗</a>
      </section>
    ` : ""}
    <div class="matrix-route">
    ${matrixItemsFor(lesson).map((item, index) => `
    <a class="matrix-${esc(item.kind)}" href="${esc(item.href)}" target="_blank" rel="noreferrer">
      <span>${String(index + 1).padStart(2, "0")} · ${esc(item.label)}</span>
      <strong>${esc(item.title)}</strong>
      <small>${esc(item.meta)} ↗</small>
    </a>
    `).join("")}</div>
  `;
}

function renderMastery() {
  const progress = lessonProgress();
  const percent = progressPercent(progress);
  els.masterySpectrum.style.setProperty("--mastery", `${percent}%`);
  els.masteryValue.textContent = percent;
  els.checkpointList.innerHTML = trackFor().map(([key, label], index) => `
    <li data-checkpoint="${key}" class="${checkpointDone(progress, key) ? "complete" : ""}"><button type="button">${wadangMark(STAGE_MARKS[index] || index + 1)}<strong>${esc(label)}</strong><em>${checkpointDone(progress, key) ? "已見" : "未見"}</em></button></li>
  `).join("");
}

function renderLessonChat(lesson) {
  if (!els.lessonChatFrame || !els.lessonChatTitle) return;
  const title = lessonTitle(lesson);
  els.lessonChatTitle.textContent = `《${title}》同讀`;
  els.lessonChatFrame.title = `《${title}》實時聊天`;
  if (els.lessonChatFrame.src === "about:blank") els.lessonChatFrame.src = "https://chat.bdfz.net/#lobby";
}

function syncProgress({ event = false } = {}) {
  saveStoredProgress();
  if (!state.current || !state.manifest) return;
  renderMastery();
  renderLessonIndex();
  if (!state.current) return;
  const percent = progressPercent();
  const send = async () => {
    const progress = lessonProgress();
    if (event && percent === 100 && !progress.completionEventSent) {
      await recordLearning("lessonCompleted", {
        checkpointCount: trackFor().filter(([key]) => checkpointDone(progress, key)).length,
        checkpointTotal: trackFor().length,
      });
      progress.completionEventSent = true;
      saveStoredProgress();
    }
  };
  void send();
}

function renderLesson(lesson) {
  els.title.textContent = lessonTitle(lesson);
  els.topbarContext.textContent = `${lesson.blockTitle || "高中語文"} · ${lessonTitle(lesson)}`;
  els.mastheadVolume.textContent = lesson.blockTitle || "高中語文";
  const block = state.manifest.blocks.find((item) => item.id === (lesson.blockId || state.blockId));
  const readingLessons = (block?.lessons || []).filter((item) => !isUnitHeading(item) && !isUnitTask(item) && !isRetiredMirror(item));
  const position = readingLessons.findIndex((item) => item.id === lesson.id);
  els.mastheadPosition.textContent = position >= 0 ? `第 ${String(position + 1).padStart(2, "0")} 篇` : (isUnitTask(lesson) ? "研習任務" : "單元導讀");
  document.title = `${lessonTitle(lesson)} · 課文`;
  renderOrientation(lesson);
  renderText(lesson);
  renderMaterials(lesson);
  renderLessonMedia(lesson);
  renderCheckStage(lesson);
  renderLessonChat(lesson);
  renderMatrix(lesson);
  renderMastery();
  preparePages(lesson);
  renderLessonIndex();
  void ensureBlueprint(lesson);
  els.body.classList.remove("lesson-enter");
  requestAnimationFrame(() => {
    fitLessonTitle();
    els.body.classList.add("lesson-enter");
  });
}

function setToolsOpen(open) {
  els.body.classList.toggle("tools-open", open);
  els.mobileToolsToggle.setAttribute("aria-expanded", String(open));
  els.mobileToolsToggle.setAttribute("aria-label", open ? "關閉篇目工具" : "打開篇目工具");
}

function syncMasteryPlacement() {
  if (matchMedia("(max-width: 900px)").matches) {
    els.mobileMasteryAnchor.after(els.learningRail);
  } else {
    els.studyLayout.append(els.learningRail);
    setToolsOpen(false);
  }
}

function fitLessonTitle() {
  const title = els.title;
  if (!title) return;
  title.style.removeProperty("font-size");
  const available = title.parentElement?.clientWidth || title.clientWidth;
  let size = parseFloat(getComputedStyle(title).fontSize) || 92;
  while (title.scrollWidth > available && size > 16) {
    size -= 1;
    title.style.fontSize = `${size}px`;
  }
}

let lessonToken = 0;
async function showLesson(id, { push = true } = {}) {
  const token = ++lessonToken;
  try {
    const meta = state.manifest.lessons.find((lesson) => lesson.id === id);
    if (!meta) throw new Error("找不到課文");
    let lesson = state.lessons.get(id);
    if (!lesson) {
      lesson = await fetchJson(meta.dataUrl);
      state.lessons.set(id, lesson);
    }
    if (token !== lessonToken) return;
    state.current = lesson;
    state.activeAuthorId = taxonomyFor(lesson).authors?.[0]?.id || "";
    localStorage.setItem(LAST_LESSON_KEY, lesson.id);
    state.blockId = lesson.blockId || meta.blockId || state.blockId;
    renderBooks();
    renderLesson(lesson);
    void recordLearning("lessonOpened");
    if (push) history.replaceState(null, "", `#${lesson.id}`);
    if (matchMedia("(max-width: 900px)").matches) closeAtlas();
    scrollTo({ top: 0, behavior: "auto" });
  } catch (error) {
    els.title.textContent = "課文載入失敗";
    els.orientation.textContent = error.message;
    toast("無法載入這篇課文");
  }
}

function fieldValue(path) {
  return els.checkStage.querySelector(`[data-field="${path}"]`)?.value.trim() || "";
}

function interactionInput(key) {
  if (key === "contextWords") return { words: [1, 2, 3].map((index) => fieldValue(`context.word${index}`)).filter(Boolean).join("、") };
  if (key === "authorQuestion") return { answer: fieldValue("authorQuestion.answer") };
  if (key === "revision") return { original: fieldValue("revision.original"), action: fieldValue("revision.action"), revised: fieldValue("revision.revised"), reason: fieldValue("revision.reason") };
  if (key === "structure") return { reason: fieldValue("structure.reason") };
  if (key === "wordCreation") return { word: fieldValue("wordCreation.word"), creation: fieldValue("wordCreation.creation") };
  return {};
}

function interactionInputLength(input) {
  return Object.values(input).join("").replace(/\s+/g, "").length;
}

async function submitInteraction(key, button = null, { silent = false } = {}) {
  const input = interactionInput(key);
  const compactLength = interactionInputLength(input);
  const minimum = key === "contextWords" ? 3 : key === "authorQuestion" ? 12 : 24;
  if (compactLength < minimum) {
    if (!silent) toast(key === "contextWords" ? "請輸入三個詞" : key === "authorQuestion" ? "問題需要更具體，至少 12 字" : "先寫完整");
    return;
  }
  if (key === "contextWords" && input.words.split(/[，,、\s]+/).filter(Boolean).length !== 3) { if (!silent) toast("請恰好輸入三個詞"); return; }
  const autoStatus = els.checkStage.querySelector(`[data-auto-status="${key}"]`);
  if (button) {
    button.disabled = true;
    button.textContent = "核對中";
  }
  if (autoStatus) autoStatus.textContent = "核對中";
  try {
    const clientMutationId = window.YwLearningEvidence?.mutationId?.(key, state.current.id);
    const response = await fetch("/api/interaction-check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        lessonId: state.current.id,
        lessonTitle: lessonTitle(state.current),
        blockTitle: state.current.blockTitle,
        mode: modeFor(state.current),
        genres: genreNodesFor(state.current).map((genre) => genre.label),
        authors: [authorNameFor(state.current)],
        interaction: key,
        blueprint: state.blueprints.get(blueprintKey(state.current)) || blueprintFallback(state.current),
        excerpt: String(primaryPost(state.current)?.plain_text || state.current.excerpt || "").slice(0, 4200),
        input,
        clientMutationId,
      }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `評估失敗 ${response.status}`);
    const result = payload.assessment || {};
    const progressKey = key === "contextWords" ? "context" : key;
    const score = Number(result.score || 0);
    lessonProgress()[progressKey] = { ...lessonProgress()[progressKey], ...input, done: score >= 60, score, result };
    if (key === "wordCreation" && !lessonVocabulary(state.current).length) lessonProgress().vocabulary = { ...(lessonProgress().vocabulary || {}), done: true, reviewed: [] };
    if (key === "contextWords") void saveReadingSubmission(input, result);
    if (!silent) toast(`${trackFor().find((item) => item[0] === progressKey)?.[1] || "互動"} · ${result.score || 0} 分`);
    syncProgress({ event: true });
    renderCheckStage(state.current);
  } catch (error) {
    if (!silent) toast(error.message || "暫時無法完成評估");
    if (button) {
      button.disabled = false;
      button.textContent = "重試";
    }
    if (autoStatus) autoStatus.textContent = "未核對";
  }
}

async function saveReadingSubmission(input, result) {
  try {
    const words = String(input.words || "").split(/[，,、\s]+/).filter(Boolean).slice(0, 3);
    if (words.length !== 3 || !state.current) return;
    await fetch("/api/reading/submission", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        lessonId: state.current.id,
        words,
        aiScore: Number(result?.score || 0),
        aiVerdict: String(result?.verdict || ""),
      }),
    });
  } catch { /* 未登入或離線時僅保留本地進度，星圖等待下次有效提交 */ }
}

async function saveEvaluation(explicitRating = 0, { quiet = false } = {}) {
  const rating = Number(explicitRating || els.checkStage.querySelector("[data-rating].active")?.dataset.rating || lessonProgress().evaluation?.rating || 0);
  const reason = fieldValue("evaluation.reason");
  if (!rating) return;
  lessonProgress().evaluation = { rating, reason, done: true };
  syncProgress({ event: true });
  await recordLearning("evaluation", { rating, reason: reason.slice(0, 300) });
  if (!quiet) toast(`已自動保存 ${rating}/5`);
}

function bindCheckStage() {
  $$('[data-ai-check]', els.checkStage).forEach((button) => button.addEventListener("click", () => submitInteraction(button.dataset.aiCheck, button)));
  const contextWords = $$('[data-context-word]', els.checkStage);
  if (contextWords.length) contextWords.forEach((field) => field.addEventListener("input", () => {
    clearTimeout(submitInteraction.contextTimer);
    const parts = contextWords.map((item) => item.value.trim()).filter(Boolean);
    const words = parts.join("、");
    const status = els.checkStage.querySelector('[data-auto-status="contextWords"]');
    if (status) status.textContent = parts.length === 3 ? "待核對" : `${parts.length}/3`;
    if (parts.length !== 3) return;
    const saved = lessonProgress().context;
    if (saved?.words === words && saved?.result) {
      if (status) status.textContent = "已核對";
      return;
    }
    submitInteraction.contextTimer = setTimeout(() => void submitInteraction("contextWords", null, { silent: true }), 720);
  }));
  $$('[data-rating]', els.checkStage).forEach((button) => button.addEventListener("click", () => {
    $$('[data-rating]', els.checkStage).forEach((item) => item.classList.toggle("active", item === button));
    lessonProgress().evaluation = { ...(lessonProgress().evaluation || {}), rating: Number(button.dataset.rating), done: true };
    const spectrum = button.closest(".rating-spectrum");
    if (spectrum) spectrum.style.setProperty("--rating", button.dataset.rating);
    const status = button.closest(".check-round")?.querySelector(".auto-save-status");
    if (status) status.textContent = `正在保存 ${button.dataset.rating}/5…`;
    void saveEvaluation(Number(button.dataset.rating)).then(() => { if (status) status.textContent = `已自動保存 ${button.dataset.rating}/5`; });
  }));
  $$('[data-quiz-option]', els.checkStage).forEach((button) => button.addEventListener("click", () => {
    const bank = state.vocabBanks.get(state.current?.id);
    const itemHost = button.closest("[data-quiz-item]");
    if (!bank || !itemHost) return;
    const item = bank.questions.find((entry) => entry.id === itemHost.dataset.quizItem);
    if (!item) return;
    const progress = lessonProgress();
    const quiz = quizRecord(progress);
    const entry = quiz.answers[item.id] || { attempts: 0, correct: false, mastered: false };
    if (entry.correct) return;
    const pick = Number(button.dataset.quizOption);
    entry.attempts += 1;
    entry.lastPick = pick;
    const correct = pick === item.answerIndex;
    if (correct) {
      entry.correct = true;
      entry.mastered = entry.attempts === 1;
    } else {
      entry.revealed = entry.attempts >= 2; // 第二次答錯後亮出正解與解析
    }
    quiz.answers[item.id] = entry;
    quiz.cursorId = correct
      ? bank.questions.find((question) => !quizItemState(quiz, question.id).correct)?.id || null
      : item.id;
    const solvedAll = bank.questions.every((question) => quizRecord(progress).answers[question.id]?.correct);
    if (solvedAll) {
      progress.vocabulary = { ...(progress.vocabulary || {}), done: true, quiz: true };
      if (!quiz.completionSent) {
        quiz.completionSent = true;
      }
    }
    void recordVocabAttempt(item.id, pick);
    syncProgress({ event: true });
    if (!correct) {
      renderCheckStage(state.current);
      return;
    }
    const lessonId = state.current.id;
    $$('[data-quiz-option]', itemHost).forEach((option) => { option.disabled = true; });
    button.classList.add("correct");
    itemHost.classList.add("quiz-advancing");
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    setTimeout(() => {
      if (state.current?.id !== lessonId) return;
      renderCheckStage(state.current);
      const round = els.checkStage.querySelector('[data-round="vocabulary"]');
      round?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "center" });
    }, reducedMotion ? 0 : 220);
  }));
  $$('[data-quiz-lookup]', els.checkStage).forEach((button) => button.addEventListener("click", () => {
    openLexicon(button.dataset.quizLookup);
  }));
  $$('[data-vocabulary]', els.checkStage).forEach((button) => button.addEventListener("click", () => {
    const progress = lessonProgress();
    progress.vocabulary ||= { reviewed: [], done: false };
    const reviewed = new Set(progress.vocabulary.reviewed || []);
    reviewed.add(button.dataset.vocabulary);
    progress.vocabulary.reviewed = [...reviewed];
    const total = lessonVocabulary(state.current).length;
    progress.vocabulary.done = total > 0 && reviewed.size >= total;
    syncProgress();
    openLexicon(button.dataset.vocabulary);
    renderCheckStage(state.current);
  }));
  $$('[data-read-check]', els.checkStage).forEach((checkbox) => checkbox.addEventListener("change", () => {
    const previous = lessonProgress().read && typeof lessonProgress().read === "object" ? lessonProgress().read : {};
    lessonProgress().read = { ...previous, checked: checkbox.checked, done: checkbox.checked };
    syncProgress();
    if (checkbox.checked) void recordLearning("readAcknowledged", { threshold: "manual_confirmation" });
    renderCheckStage(state.current);
    if (checkbox.checked) toast("已記下");
  }));
  const reason = els.checkStage.querySelector("[data-evaluation-reason]");
  if (reason) {
    reason.addEventListener("input", () => {
      clearTimeout(saveEvaluation.timer);
      saveEvaluation.timer = setTimeout(() => void saveEvaluation(0, { quiet: true }), 700);
    });
    reason.addEventListener("blur", () => void saveEvaluation(0, { quiet: true }));
  }
}

function openLexicon(text) {
  const clean = String(text || "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (!clean) return;
  state.selectedText = clean;
  els.selectionWord.textContent = clean;
  els.lexiconDock.classList.add("open");
  els.body.classList.add("lexicon-open");
  els.lexiconDock.setAttribute("aria-hidden", "false");
  updateLexiconFrame();
  void recordLearning("vocabularyLookup", {
    lookupKind: state.lexicon,
    termLength: [...clean].length,
  });
}

function closeLexicon() {
  window.getSelection()?.removeAllRanges();
  els.lexiconDock.classList.remove("open");
  els.body.classList.remove("lexicon-open");
  els.lexiconDock.setAttribute("aria-hidden", "true");
  setTimeout(() => { if (!els.lexiconDock.classList.contains("open")) els.lexiconFrame.src = "about:blank"; }, 260);
}

function updateLexiconFrame() {
  const word = state.selectedText;
  const firstHan = (word.match(/[\u3400-\u9fff]/) || [word.charAt(0)])[0];
  const url = state.lexicon === "dict"
    ? `https://sun.bdfz.net/dict.html?q=${encodeURIComponent(word.slice(0, 16))}`
    : `https://zi.tools/zi/${encodeURIComponent(firstHan)}`;
  els.lexiconFrame.src = url;
  els.lexiconFrame.title = state.lexicon === "dict" ? `辭典：${word}` : `字統：${firstHan}`;
  els.moeExternal.href = `https://dict.revised.moe.edu.tw/search.jsp?md=1&word=${encodeURIComponent(word.slice(0, 20))}`;
}

function preparePages(lesson) {
  const direct = lesson.textbook?.pageImages || [];
  const context = (lesson.textbook?.contextPageImages || []).filter((page) => page.matched);
  state.pages = direct.length ? direct : context;
  state.pageIndex = 0;
  els.pageOpen.disabled = !state.pages.length;
}

function showPage(index) {
  if (!state.pages.length) return;
  state.pageIndex = clamp(index, 0, state.pages.length - 1);
  const page = state.pages[state.pageIndex];
  els.pageImage.src = page.src;
  els.pageImage.alt = `${lessonTitle(state.current)} ${page.label}`;
  els.pageCaption.textContent = `${state.current.textbook?.bookTitle || state.current.blockTitle} · ${page.label} · ${state.pageIndex + 1}/${state.pages.length}`;
  els.pagePrev.disabled = state.pageIndex === 0;
  els.pageNext.disabled = state.pageIndex === state.pages.length - 1;
  $$('.page-strip button', els.pageStrip).forEach((button, buttonIndex) => button.classList.toggle("active", buttonIndex === state.pageIndex));
}

function openPages(index = 0) {
  if (!state.pages.length) {
    toast("本課尚未匹配到教材原圖");
    return;
  }
  els.pageDialogTitle.textContent = lessonTitle(state.current);
  els.pageStrip.innerHTML = state.pages.map((page, pageIndex) => `
    <button type="button" data-page-index="${pageIndex}"><img src="${esc(page.src)}" alt="${esc(page.label)}"><span>${esc(page.label)}</span></button>
  `).join("");
  $$('.page-strip button', els.pageStrip).forEach((button) => button.addEventListener("click", () => showPage(Number(button.dataset.pageIndex))));
  showPage(index);
  if (!els.pageDialog.open) els.pageDialog.showModal();
  void recordLearning("resourceOpened", {
    resourceKind: "textbook_page",
    resourceRef: state.pages[index]?.label || String(index + 1),
  });
}

function resourcePreviewUrl(href) {
  if (/\.(png|jpe?g|gif|webp|svg)(?:$|\?)/i.test(href)) return href;
  try {
    const url = new URL(href, location.href);
    if (url.origin === location.origin && /\.pdf$/i.test(url.pathname)) return url.toString();
  } catch {}
  return `/api/preview?url=${encodeURIComponent(href)}`;
}

function openResource(resource) {
  if (!resource) return;
  els.resourceDialogTitle.textContent = resource.title;
  els.resourceExternal.href = resource.href;
  if (resource.kind === "document" || /\.pdf(?:$|\?)/i.test(resource.href)) {
    els.resourceFrame.removeAttribute("sandbox");
  } else {
    els.resourceFrame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox");
  }
  els.resourceFrame.src = resourcePreviewUrl(resource.href);
  if (!els.resourceDialog.open) els.resourceDialog.showModal();
  void recordLearning(resource.evidenceKind === "slideDeck" ? "slideDeckOpened" : "resourceOpened", {
    resourceKind: resource.evidenceKind === "slideDeck" ? "slide_deck_pdf" : (resource.kind || "resource"),
    resourceRef: String(resource.href || "").slice(0, 500),
  });
}

function onSelection() {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return;
  const text = selection.toString().trim();
  if (!text || text.length > 80) return;
  const anchor = selection.anchorNode?.parentElement;
  if (!anchor?.closest("#text-flow")) return;
  openLexicon(text);
}

function updateReadProgress() {
  if (!state.current || !state.manifest) return;
  const root = $("#textbook-text");
  const end = $("#learning-check");
  if (!root || !end) return;
  const startY = root.offsetTop;
  const endY = Math.max(startY + 1, end.offsetTop - innerHeight * 0.45);
  const ratio = clamp((scrollY - startY + innerHeight * 0.35) / (endY - startY), 0, 1);
  els.readProgress.style.width = `${ratio * 100}%`;
  if (ratio > 0.72 && !lessonProgress().readReached) {
    lessonProgress().readReached = true;
    syncProgress();
    void recordLearning("readAcknowledged", { threshold: 0.72 });
  }
}

function applyFont() {
  state.fontIndex = clamp(Number(state.fontIndex) || 0, 0, FONT_STEPS.length - 1);
  document.documentElement.style.setProperty("--reader-scale", FONT_STEPS[state.fontIndex]);
  const percent = Math.round(FONT_STEPS[state.fontIndex] * 100);
  els.fontLabel.textContent = `${percent}%`;
  els.fontDown.disabled = state.fontIndex === 0;
  els.fontUp.disabled = state.fontIndex === FONT_STEPS.length - 1;
}

function changeFont(delta) {
  state.fontIndex = clamp(state.fontIndex + delta, 0, FONT_STEPS.length - 1);
  localStorage.setItem(FONT_KEY, state.fontIndex);
  applyFont();
}

function closeInlineNotes(except = null) {
  $$('.note-popover.open', els.textFlow).forEach((popover) => {
    if (popover === except) return;
    clearTimeout(popover.typeTimer);
    popover.classList.remove("typing");
    popover.classList.remove("open");
    popover.previousElementSibling?.setAttribute("aria-expanded", "false");
  });
}

function toggleInlineNote(button) {
  let popover = button.nextElementSibling;
  if (!popover?.classList.contains("note-popover")) {
    popover = document.createElement("span");
    popover.className = "note-popover";
    button.insertAdjacentElement("afterend", popover);
  }
  const opening = !popover.classList.contains("open");
  closeInlineNotes(opening ? popover : null);
  popover.classList.toggle("open", opening);
  button.setAttribute("aria-expanded", opening ? "true" : "false");
  clearTimeout(popover.typeTimer);
  if (!opening) {
    popover.classList.remove("typing");
    return;
  }
  void recordLearning("noteOpened", {
    noteRef: String($$(".inline-note", els.textFlow).indexOf(button) + 1),
  });
  const characters = [...(button.dataset.note || "")];
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    popover.textContent = characters.join("");
    return;
  }
  popover.textContent = "";
  popover.classList.add("typing");
  let index = 0;
  const type = () => {
    popover.textContent += characters[index] || "";
    index += 1;
    if (index < characters.length && popover.classList.contains("open")) popover.typeTimer = setTimeout(type, 24);
    else popover.classList.remove("typing");
  };
  type();
}

function bindEvents() {
  els.atlasOpen.addEventListener("click", openAtlas);
  els.atlasClose.addEventListener("click", closeAtlas);
  els.atlasScrim.addEventListener("click", closeAtlas);
  els.mobileToolsToggle.addEventListener("click", () => setToolsOpen(!els.body.classList.contains("tools-open")));
  $("#topbar-actions").addEventListener("click", () => setToolsOpen(false));
  els.search.addEventListener("input", () => {
    state.query = els.search.value;
    renderLessonIndex();
  });
  els.bookSwitcher.addEventListener("click", (event) => {
    const button = event.target.closest("[data-block]");
    if (!button) return;
    state.blockId = button.dataset.block;
    state.query = "";
    els.search.value = "";
    renderBooks();
    renderLessonIndex();
  });
  els.lessonIndex.addEventListener("click", (event) => {
    const button = event.target.closest("[data-lesson]");
    if (button) showLesson(button.dataset.lesson);
  });
  els.materialStream.addEventListener("click", (event) => {
    const button = event.target.closest("[data-resource-index]");
    if (!button) return;
    openResource(resourcesFor(state.current)[Number(button.dataset.resourceIndex)]);
  });
  els.lessonMediaContent.addEventListener("click", (event) => {
    const button = event.target.closest("[data-slide-open]");
    if (!button) return;
    openResource({
      href: button.dataset.slideOpen,
      title: button.dataset.slideTitle,
      kind: "document",
      evidenceKind: "slideDeck",
    });
  });
  els.textFlow.addEventListener("click", (event) => {
    const note = event.target.closest(".inline-note");
    if (note) {
      event.preventDefault();
      event.stopPropagation();
      toggleInlineNote(note);
      return;
    }
    const image = event.target.closest("img");
    if (image) openResource({ href: image.currentSrc || image.src, title: image.alt || lessonTitle(state.current) });
  });
  document.addEventListener("mouseup", () => setTimeout(onSelection, 0));
  document.addEventListener("touchend", () => setTimeout(onSelection, 80));
  els.lexiconClose.addEventListener("click", closeLexicon);
  els.lexiconScrim.addEventListener("click", closeLexicon);
  $$('.lexicon-switch button').forEach((button) => button.addEventListener("click", () => {
    state.lexicon = button.dataset.lexicon;
    $$('.lexicon-switch button').forEach((item) => {
      item.classList.toggle("active", item === button);
      item.setAttribute("aria-selected", item === button ? "true" : "false");
    });
    updateLexiconFrame();
  }));
  els.pageOpen.addEventListener("click", () => openPages());
  els.pagePrev.addEventListener("click", () => showPage(state.pageIndex - 1));
  els.pageNext.addEventListener("click", () => showPage(state.pageIndex + 1));
  els.resourcesOpen.addEventListener("click", () => {
    const first = resourcesFor(state.current)[0];
    if (first) openResource(first); else document.querySelector("#classroom-materials")?.scrollIntoView({ behavior: "smooth" });
  });
  document.querySelector("#lesson-chat a")?.addEventListener("click", () => {
    void recordLearning("chatOpened");
  });
  els.resourceDialog.addEventListener("close", () => { els.resourceFrame.src = "about:blank"; });
  els.fontDown.addEventListener("click", () => changeFont(-1));
  els.fontUp.addEventListener("click", () => changeFont(1));
  els.focusButton.addEventListener("click", () => {
    els.body.classList.toggle("focus-mode");
    const active = els.body.classList.contains("focus-mode");
    els.focusButton.setAttribute("aria-pressed", active ? "true" : "false");
    els.focusButton.textContent = active ? "退出" : "專注";
    if (els.body.classList.contains("focus-mode")) closeAtlas();
  });
  els.checkpointList.addEventListener("click", (event) => {
    const item = event.target.closest("[data-checkpoint]");
    if (!item) return;
    const target = item.dataset.checkpoint === "read"
      ? document.querySelector("#textbook-text")
      : document.querySelector(`[data-round="${item.dataset.checkpoint}"]`);
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  els.masteryToggle.addEventListener("click", () => {
    const collapsed = !els.learningRail.classList.contains("collapsed");
    els.learningRail.classList.toggle("collapsed", collapsed);
    els.masteryToggle.setAttribute("aria-expanded", String(!collapsed));
    els.masteryToggle.querySelector("i").textContent = collapsed ? "展" : "收";
    localStorage.setItem(MASTERY_COLLAPSED_KEY, collapsed ? "1" : "0");
  });
  window.addEventListener("scroll", updateReadProgress, { passive: true });
  window.addEventListener("resize", () => requestAnimationFrame(() => {
    fitLessonTitle();
    syncMasteryPlacement();
  }), { passive: true });
  if (window.ResizeObserver && els.title?.parentElement) {
    const titleObserver = new ResizeObserver(() => requestAnimationFrame(fitLessonTitle));
    titleObserver.observe(els.title.parentElement);
  }
  window.addEventListener("hashchange", () => {
    const id = location.hash.slice(1);
    if (id && id !== state.current?.id) showLesson(id, { push: false });
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeLexicon();
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      openAtlas();
      els.search.focus();
    }
  });
}

function mergeRemoteProgress(item) {
  if (!item?.itemKey || !item?.meta?.checkpoints) return false;
  const local = state.progress[item.itemKey] || {};
  const localPercent = progressPercent(local, { id: item.itemKey });
  if (Number(item.progressPercent || 0) < localPercent) return false;
  state.progress[item.itemKey] = {
    ...local,
    ...item.meta.checkpoints,
    remoteProgressPercent: Number(item.progressPercent || 0),
  };
  return true;
}

async function hydrateUserProgress() {
  const deadline = Date.now() + 6000;
  while (!window.BdfzIdentity && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 120));
  const identity = window.BdfzIdentity;
  if (!identity) return;
  const session = await identity.getSession?.().catch(() => null);
  if (!session?.authenticated) return;
  const payload = await identity.api?.("/api/progress?site=yw").catch(() => null);
  const items = Array.isArray(payload?.items) ? payload.items : Array.isArray(payload) ? payload : [];
  if (items.some(mergeRemoteProgress)) {
    saveStoredProgress();
    if (state.current) renderLesson(state.current);
  }
}

async function init() {
  applyFont();
  bindEvents();
  syncMasteryPlacement();
  const masteryCollapsed = localStorage.getItem(MASTERY_COLLAPSED_KEY) === "1";
  els.learningRail.classList.toggle("collapsed", masteryCollapsed);
  els.masteryToggle.setAttribute("aria-expanded", String(!masteryCollapsed));
  els.masteryToggle.querySelector("i").textContent = masteryCollapsed ? "展" : "收";
  enforceNewTabLinks();
  new MutationObserver((mutations) => mutations.forEach((mutation) => mutation.addedNodes.forEach((node) => {
    if (node.nodeType === Node.ELEMENT_NODE) enforceNewTabLinks(node);
  }))).observe(document.body, { childList: true, subtree: true });
  if (matchMedia("(min-width: 901px)").matches) openAtlas(); else closeAtlas();
  try {
    const [manifest, taxonomy, lessonMedia] = await Promise.all([
      fetchJson("data/manifest.json"),
      fetchJson("data/literary-taxonomy.json"),
      fetchJson("data/lesson-media.json"),
    ]);
    state.manifest = manifest;
    state.taxonomy = taxonomy;
    state.lessonMedia = new Map((lessonMedia.lessons || []).map((lesson) => [lesson.lessonId, lesson]));
    state.taxonomyLessons = new Map(state.taxonomy.lessons.map((lesson) => [lesson.id, lesson]));
    state.taxonomyGenres = new Map(state.taxonomy.genres.map((genre) => [genre.id, genre]));
    const defaultBlock = state.manifest.blocks.find((block) => block.id === "xuanbi-shang" || block.title === "選必上") || state.manifest.blocks[0];
    state.blockId = defaultBlock?.id || "";
    els.atlasStatus.textContent = `${state.manifest.totals?.lessons || state.manifest.lessons.length} 篇 · 五冊教材`;
    renderBooks();
    renderLessonIndex();
    const hashId = location.hash.slice(1);
    const rememberedId = localStorage.getItem(LAST_LESSON_KEY) || "";
    const initial = state.manifest.lessons.find((lesson) => lesson.id === hashId)
      || state.manifest.lessons.find((lesson) => lesson.id === rememberedId)
      || defaultBlock?.lessons.find((lesson) => !isUnitHeading(lesson) && !isRetiredMirror(lesson) && (lesson.excerpt || "").length > 100)
      || state.manifest.lessons[0];
    if (initial) await showLesson(initial.id, { push: true });
    void hydrateUserProgress();
  } catch (error) {
    els.atlasStatus.textContent = "教材資料載入失敗";
    els.title.textContent = "暫時無法打開教材";
    els.orientation.textContent = error.message;
  }
}

init();
