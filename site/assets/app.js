const state = {
  manifest: null,
  lessons: new Map(),
  currentLesson: null,
  block: "all",
  mode: "study",
  tab: "posts",
  query: "",
  chat: new Map(),
};

const els = {
  body: document.body,
  dataStatus: document.getElementById("data-status"),
  blockTabs: document.getElementById("block-tabs"),
  lessonList: document.getElementById("lesson-list"),
  search: document.getElementById("lesson-search"),
  sidebarButton: document.getElementById("sidebar-button"),
  title: document.getElementById("lesson-title"),
  kicker: document.getElementById("lesson-kicker"),
  metaPosts: document.getElementById("meta-posts"),
  metaImages: document.getElementById("meta-images"),
  metaResources: document.getElementById("meta-resources"),
  forumLink: document.getElementById("forum-link"),
  annotationStrip: document.getElementById("annotation-strip"),
  postsPanel: document.getElementById("posts-panel"),
  imagesPanel: document.getElementById("images-panel"),
  resourcesPanel: document.getElementById("resources-panel"),
  learningTasks: document.getElementById("learning-tasks"),
  copyTasks: document.getElementById("copy-tasks"),
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

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[語選擇論記復萬勝國歷紀實檢驗證學習務單臺]/g, (ch) => ({
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
    }[ch] || ch))
    .replace(/\s+/g, "");
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

function filteredLessons() {
  const q = normalize(state.query);
  return state.manifest.lessons.filter((lesson) => {
    if (state.block !== "all" && lesson.blockId !== state.block) return false;
    if (q && !lessonText(lesson).includes(q)) return false;
    return true;
  });
}

function renderBlocks() {
  const buttons = [
    `<button type="button" data-block="all" class="${state.block === "all" ? "active" : ""}">全部</button>`,
    ...state.manifest.blocks.map((block) => (
      `<button type="button" data-block="${esc(block.id)}" class="${state.block === block.id ? "active" : ""}">${esc(block.title)}</button>`
    )),
  ];
  els.blockTabs.innerHTML = buttons.join("");
}

function renderLessonList() {
  const lessons = filteredLessons();
  els.lessonList.innerHTML = lessons.map((lesson) => `
    <button type="button" class="lesson-item ${state.currentLesson?.id === lesson.id ? "active" : ""}" data-lesson="${esc(lesson.id)}">
      <strong>${esc(lesson.title)}</strong>
      <span>${esc(lesson.blockTitle)} · ${lesson.postCount} 樓 · ${lesson.imageCount} 圖 · ${lesson.resourceCount} 資源</span>
    </button>
  `).join("") || `<p class="empty">未找到匹配課文。</p>`;
  els.dataStatus.textContent = `${lessons.length}/${state.manifest.totals.lessons} 課`;
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

function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll(".mode-switch button").forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === mode);
  });
  els.body.classList.toggle("mode-clean", mode === "clean");
  els.body.classList.toggle("mode-notes", mode === "notes");
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

function renderAnnotations(lesson) {
  els.annotationStrip.innerHTML = lesson.annotations.map((item) => `
    <article>
      <h3>${esc(item.title)}</h3>
      <p>${esc(item.body)}</p>
    </article>
  `).join("");
}

function enhanceCooked(container) {
  container.querySelectorAll("a[href]").forEach((link) => {
    const href = link.getAttribute("href") || "";
    if (href.startsWith("/")) link.href = `https://forum.rdfzer.com${href}`;
    link.target = "_blank";
    link.rel = "noreferrer";
  });
  container.querySelectorAll("img").forEach((img) => {
    const src = img.getAttribute("src") || "";
    if (src.startsWith("/")) img.src = `https://forum.rdfzer.com${src}`;
    if (src.startsWith("//")) img.src = `https:${src}`;
    img.loading = "lazy";
    img.decoding = "async";
    img.addEventListener("click", () => openViewer(img.src, img.alt || state.currentLesson.title));
  });
}

function renderPosts(lesson) {
  els.postsPanel.innerHTML = lesson.posts.map((post) => `
    <section class="forum-post" id="p${post.post_number}">
      <aside>
        <div class="post-number">#${post.post_number}</div>
        <div class="post-date">${esc((post.created_at || "").slice(0, 10))}</div>
      </aside>
      <div class="cooked">${post.cooked}</div>
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
        <p>${esc(image.label)} · ${esc(lesson.textbook.tocLabel || lesson.title)}</p>
      </button>
    `).join("")}</div>
  ` : `<p class="empty">本課未自動匹配到教材圖片；仍保留論壇圖片和資源。</p>`;
  const forumHtml = forumImages.length ? `
    <h2>論壇圖片</h2>
    <div class="image-grid">${forumImages.map((image) => `
      <button type="button" class="image-tile" data-src="${esc(image.src)}" data-caption="${esc(`#${image.postNumber} · ${image.alt || lesson.title}`)}">
        <img src="${esc(image.src)}" alt="${esc(image.alt || lesson.title)}" loading="lazy" decoding="async">
        <p>#${image.postNumber} · ${esc(image.alt || "圖片")}</p>
      </button>
    `).join("")}</div>
  ` : `<p class="empty">本課論壇回覆中未抽取到圖片。</p>`;
  els.imagesPanel.innerHTML = textbookHtml + forumHtml;
  els.imagesPanel.querySelectorAll(".image-tile").forEach((tile) => {
    tile.addEventListener("click", () => openViewer(tile.dataset.src, tile.dataset.caption));
  });
}

function renderResources(lesson) {
  const resources = lesson.resources || [];
  els.resourcesPanel.innerHTML = resources.length ? `
    <div class="resource-list">${resources.map((item) => `
      <a class="resource-item" href="${esc(item.href)}" target="_blank" rel="noreferrer">
        <strong>${esc(item.text || item.href)}</strong>
        <span>#${item.postNumber} · ${esc(item.kind)}</span>
      </a>
    `).join("")}</div>
  ` : `<p class="empty">本課暫無可抽取連結或附件。</p>`;
}

function taskKey(taskId) {
  return `yw-task:${state.currentLesson.id}:${taskId}`;
}

function renderTasks(lesson) {
  els.learningTasks.innerHTML = lesson.learningTasks.map((task) => {
    const checked = localStorage.getItem(taskKey(task.id)) === "1";
    return `
      <label class="task-item">
        <input type="checkbox" data-task="${esc(task.id)}" ${checked ? "checked" : ""}>
        <span>
          <strong>${esc(task.title)}</strong>
          <p>${esc(task.prompt)}</p>
        </span>
      </label>
    `;
  }).join("");
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
  els.kicker.textContent = `${lesson.blockTitle} · ${lesson.textbook.bookTitle || "論壇課文"}`;
  els.metaPosts.textContent = `${lesson.postCount} 樓`;
  els.metaImages.textContent = `${lesson.forumImages.length + (lesson.textbook.pageImages || []).length} 圖`;
  els.metaResources.textContent = `${lesson.resources.length} 資源`;
  els.forumLink.href = lesson.forumUrl;
  renderAnnotations(lesson);
  renderPosts(lesson);
  renderImages(lesson);
  renderResources(lesson);
  renderTasks(lesson);
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

function taskText() {
  const lesson = state.currentLesson;
  return lesson.learningTasks.map((task, index) => `${index + 1}. ${task.title}\n${task.prompt}`).join("\n\n");
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
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lessonId: state.currentLesson.id,
        lessonTitle: state.currentLesson.title,
        blockTitle: state.currentLesson.blockTitle,
        excerpt: state.currentLesson.excerpt,
        annotations: state.currentLesson.annotations,
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

function bindEvents() {
  els.blockTabs.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-block]");
    if (!button) return;
    state.block = button.dataset.block;
    renderBlocks();
    renderLessonList();
  });
  els.lessonList.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-lesson]");
    if (button) showLesson(button.dataset.lesson);
  });
  els.search.addEventListener("input", () => {
    state.query = els.search.value;
    renderLessonList();
  });
  document.querySelector(".mode-switch").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-mode]");
    if (button) setMode(button.dataset.mode);
  });
  document.querySelector(".pane-tabs").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-tab]");
    if (button) setTab(button.dataset.tab);
  });
  els.sidebarButton.addEventListener("click", () => els.body.classList.toggle("sidebar-open"));
  els.learningTasks.addEventListener("change", (event) => {
    const input = event.target.closest("input[data-task]");
    if (input) localStorage.setItem(taskKey(input.dataset.task), input.checked ? "1" : "0");
  });
  els.copyTasks.addEventListener("click", () => copyText(taskText()));
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
  els.viewer.addEventListener("click", (event) => {
    if (event.target === els.viewer) closeViewer();
  });
  window.addEventListener("hashchange", () => {
    const id = location.hash.replace(/^#/, "");
    if (id && id !== state.currentLesson?.id) showLesson(id, { push: false });
  });
}

async function init() {
  bindEvents();
  setMode("study");
  setTab("posts");
  const response = await fetch("data/manifest.json");
  state.manifest = await response.json();
  renderBlocks();
  renderLessonList();
  const requested = location.hash.replace(/^#/, "");
  const first = state.manifest.lessons.find((lesson) => lesson.id === requested) || state.manifest.lessons[0];
  if (first) await showLesson(first.id, { push: !requested });
}

init().catch((error) => {
  els.dataStatus.textContent = "載入失敗";
  els.postsPanel.innerHTML = `<p class="empty">${esc(error.message)}</p>`;
});
