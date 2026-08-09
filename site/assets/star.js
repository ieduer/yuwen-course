// 我的閱讀星圖 — 渲染與交互直接復刻 xt.bdfz.net（jc-atlas public/assets/app.js，Canvas 2D marble 語言）。
// 只有「數據裝配」段是 yw 專用：星點一律由 /api/reading/constellation 的真實提交生成，
// 佈局規則見 docs/READING_CONSTELLATION.md（星位只由 冊別/教材篇序/詞形哈希 推導，舊星永不移位）。
const KINDS = ["冊別", "課文星", "詞星"];
const VOL_COLORS = ["#ef6a5b", "#6888f6", "#e4b651", "#7d69df", "#4fc7b5"];
const WORD_COLOR = "#c9d3ec";
const WORD_GROUP_COLOR = "#e8c579";
const HUB_LIT_MIN = 3; // 解鎖規則：一冊內 ≥3 篇有效三詞 → 該冊樞紐增亮
const FORMATIVE_SCHEMA = "bdfz-yw-formative-mastery-v1";
const FORMATIVE_DIMENSIONS = Object.freeze([
  { tag: "first_read_process", label: "無標點初讀" },
  { tag: "vocabulary", label: "實詞疏通" },
  { tag: "syntax", label: "虛詞句法" },
  { tag: "comprehension", label: "理解考辨" },
]);
const $ = (id) => document.getElementById(id);
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ---------- 數據裝配（yw 專用） ----------
function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (response.status === 401) return { __auth: true };
  if (!response.ok) throw new Error(`${response.status}`);
  return response.json();
}

async function fetchFormativeMastery() {
  try {
    const response = await fetch("/api/reading/formative-mastery", {
      headers: { accept: "application/json" },
      credentials: "same-origin",
    });
    if (response.status === 401) return { __auth: true };
    if (!response.ok) return { __error: true, status: response.status };
    return await response.json();
  } catch {
    return { __error: true, status: 0 };
  }
}

const formativeMasteryPromise = fetchFormativeMastery();

function normalizeDimension(raw, tag) {
  const completed = raw?.completedItems;
  const total = raw?.totalItems;
  const rate = raw?.masteryRate;
  const countsValid = Number.isInteger(completed)
    && Number.isInteger(total)
    && completed >= 0
    && total > 0
    && completed <= total;
  const rateValid = typeof rate === "number" && Number.isFinite(rate) && rate >= 0 && rate <= 100;
  const expectedRate = countsValid ? Math.round((completed / total) * 10000) / 100 : null;
  const available = raw?.competencyTag === tag
    && raw?.status === "available"
    && countsValid
    && rateValid
    && Math.abs(rate - expectedRate) < 0.001;
  return {
    tag,
    status: available ? "available" : "unavailable",
    completed: available ? completed : null,
    total: available ? total : null,
    rate: available ? rate : null,
  };
}

function interestRatingFor(payloadValue, lesson) {
  const candidates = [
    lesson?.interestRating,
    lesson?.interestingRating,
    lesson?.evaluation?.interestRating,
    payloadValue?.interestRatings?.[lesson?.lessonId],
  ];
  const rating = candidates.find((value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100);
  return rating === undefined ? null : Math.round(rating * 100) / 100;
}

function normalizeFormativePayload(value) {
  const payloadValue = value?.schemaVersion === FORMATIVE_SCHEMA ? value : value?.formativeMastery;
  if (!payloadValue
    || payloadValue.schemaVersion !== FORMATIVE_SCHEMA
    || payloadValue.affectsGrowthScore !== false
    || payloadValue.affectsAPlus !== false
    || !Array.isArray(payloadValue.lessons)) return null;

  const seen = new Set();
  const lessons = [];
  for (const rawLesson of payloadValue.lessons) {
    const lessonId = String(rawLesson?.lessonId || "").trim();
    if (!/^lesson-[a-z0-9-]+$/i.test(lessonId) || seen.has(lessonId)) continue;
    seen.add(lessonId);
    const rawCompetencies = Array.isArray(rawLesson.competencies) ? rawLesson.competencies : [];
    const byTag = new Map(rawCompetencies.map((entry) => [entry?.competencyTag, entry]));
    lessons.push({
      lessonId,
      lessonTitle: String(rawLesson.lessonTitle || lessonId).trim().slice(0, 180),
      dimensions: FORMATIVE_DIMENSIONS.map(({ tag }) => normalizeDimension(byTag.get(tag), tag)),
      interestRating: interestRatingFor(payloadValue, rawLesson),
    });
  }
  return {
    status: payloadValue.status === "available" ? "available" : "unavailable",
    manifestVersion: String(payloadValue.manifestVersion || "").slice(0, 120),
    summary: payloadValue.summary || {},
    lessons,
  };
}

function radarPoint(index, rate, radius = 88) {
  const angle = -Math.PI / 2 + index * Math.PI / 2;
  const distance = radius * rate / 100;
  return {
    x: 160 + Math.cos(angle) * distance,
    y: 138 + Math.sin(angle) * distance,
  };
}

function gridPolygon(rate) {
  return FORMATIVE_DIMENSIONS.map((_, index) => {
    const point = radarPoint(index, rate);
    return `${point.x.toFixed(2)},${point.y.toFixed(2)}`;
  }).join(" ");
}

function formatRate(rate) {
  if (rate === null) return "未提供";
  return `${Number.isInteger(rate) ? rate : rate.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}%`;
}

function renderMasteryLesson(lesson) {
  const grid = $("mastery-radar-grid");
  const values = $("mastery-radar-values");
  const labels = $("mastery-radar-labels");
  grid.innerHTML = [25, 50, 75, 100].map((rate) => (
    `<polygon points="${gridPolygon(rate)}"></polygon>`
  )).join("") + FORMATIVE_DIMENSIONS.map((_, index) => {
    const edge = radarPoint(index, 100);
    return `<line x1="160" y1="138" x2="${edge.x}" y2="${edge.y}"></line>`;
  }).join("");

  const available = lesson.dimensions.filter((dimension) => dimension.rate !== null);
  const rays = lesson.dimensions.map((dimension, index) => {
    if (dimension.rate === null) return "";
    const point = radarPoint(index, dimension.rate);
    return `<line class="mastery-value-ray" x1="160" y1="138" x2="${point.x}" y2="${point.y}"></line>`
      + `<circle class="mastery-value-point" data-competency="${dimension.tag}" cx="${point.x}" cy="${point.y}" r="4"></circle>`;
  }).join("");
  const polygon = available.length === FORMATIVE_DIMENSIONS.length
    ? `<polygon class="mastery-value-shape" points="${lesson.dimensions.map((dimension, index) => {
      const point = radarPoint(index, dimension.rate);
      return `${point.x.toFixed(2)},${point.y.toFixed(2)}`;
    }).join(" ")}"></polygon>`
    : "";
  values.innerHTML = polygon + rays;

  const labelPositions = [
    { x: 160, y: 22, anchor: "middle" },
    { x: 306, y: 142, anchor: "end" },
    { x: 160, y: 278, anchor: "middle" },
    { x: 14, y: 142, anchor: "start" },
  ];
  labels.innerHTML = FORMATIVE_DIMENSIONS.map((dimension, index) => {
    const position = labelPositions[index];
    const status = lesson.dimensions[index].rate === null ? " · 未提供" : "";
    return `<text x="${position.x}" y="${position.y}" text-anchor="${position.anchor}">${dimension.label}${status}</text>`;
  }).join("");

  $("mastery-radar-title").textContent = `《${lesson.lessonTitle}》篇目四維能力雷達`;
  $("mastery-radar-desc").textContent = `《${lesson.lessonTitle}》：${lesson.dimensions.map((dimension, index) => {
    const label = FORMATIVE_DIMENSIONS[index].label;
    return dimension.rate === null
      ? `${label}未提供`
      : `${label}${formatRate(dimension.rate)}，已完成${dimension.completed}/${dimension.total}`;
  }).join("；")}。`;

  $("mastery-dimensions").innerHTML = lesson.dimensions.map((dimension, index) => {
    const label = FORMATIVE_DIMENSIONS[index].label;
    const count = dimension.rate === null ? "無有效分母" : `${dimension.completed} / ${dimension.total}`;
    return `<div class="mastery-dimension" data-competency="${dimension.tag}" data-status="${dimension.status}">
      <dt>${label}</dt>
      <dd><strong>${formatRate(dimension.rate)}</strong><span>${count}</span></dd>
    </div>`;
  }).join("");

  const interestValue = $("mastery-interest-value");
  const interestTrack = $("mastery-interest-track");
  if (lesson.interestRating === null) {
    interestValue.textContent = "尚無已同步評價";
    interestTrack.hidden = true;
    $("mastery-interest-fill").style.width = "0";
  } else {
    interestValue.textContent = `${lesson.interestRating} / 100`;
    interestTrack.hidden = false;
    $("mastery-interest-fill").style.width = `${lesson.interestRating}%`;
  }
}

function setMasteryUnavailable(statusText, detail) {
  $("mastery-toggle-status").textContent = statusText;
  $("mastery-state").textContent = detail;
  $("mastery-content").hidden = true;
}

async function hydrateMasteryPanel(promise) {
  const raw = await promise;
  if (raw?.__auth) {
    setMasteryUnavailable("需登入", "登入 User Center 後才能查看你的篇目能力；三詞星圖仍可照常使用。");
    return;
  }
  if (raw?.__error) {
    setMasteryUnavailable("暫不可用", "篇目能力資料暫時無法讀取；系統沒有把缺失資料當成 0，三詞星圖不受影響。");
    return;
  }
  const formative = normalizeFormativePayload(raw);
  if (!formative) {
    setMasteryUnavailable("未提供", "篇目能力資料契約未通過，已停止呈現；三詞星圖不受影響。");
    return;
  }
  if (!formative.lessons.length) {
    setMasteryUnavailable("未提供", "目前沒有可呈現的篇目能力資料；缺值不會被計為 0。");
    return;
  }

  const summaryCompleted = formative.summary?.completedItems;
  const summaryTotal = formative.summary?.totalItems;
  const summaryAvailable = formative.status === "available"
    && Number.isInteger(summaryCompleted)
    && Number.isInteger(summaryTotal)
    && summaryCompleted >= 0
    && summaryTotal > 0
    && summaryCompleted <= summaryTotal;
  $("mastery-toggle-status").textContent = summaryAvailable ? `${summaryCompleted}/${summaryTotal}` : "未提供";
  $("mastery-state").textContent = summaryAvailable
    ? `全部篇目已完成 ${summaryCompleted} / ${summaryTotal} 個目前啟用題組。`
    : "總體掌握度未提供；可逐篇查看有有效分母的能力維度。";

  const select = $("mastery-lesson");
  select.replaceChildren(...formative.lessons.map((lesson) => {
    const option = document.createElement("option");
    option.value = lesson.lessonId;
    option.textContent = lesson.lessonTitle;
    return option;
  }));
  const lessonById = new Map(formative.lessons.map((lesson) => [lesson.lessonId, lesson]));
  const renderSelected = () => renderMasteryLesson(lessonById.get(select.value) || formative.lessons[0]);
  select.addEventListener("change", renderSelected);
  select.value = formative.lessons.find((lesson) => lesson.dimensions.some((dimension) => dimension.rate !== null))?.lessonId
    || formative.lessons[0].lessonId;
  renderSelected();
  $("mastery-content").hidden = false;
}

const manifest = await fetchJson("data/manifest.json");
const constellation = await fetchJson("/api/reading/constellation").catch(() => ({ __error: true }));
const authRequired = !!constellation.__auth;
const apiFailed = !!constellation.__error;
const payload = authRequired || apiFailed ? { nodes: [], links: [], stats: { lessons: 0, words: 0, volumes: {} }, groupLabels: {} } : constellation;

const volumes = manifest.blocks.slice(0, 5);
const volIndexByBlock = new Map(volumes.map((block, index) => [block.id, index]));
const lessonSlot = new Map(); // lessonId -> { vol, ordinal }
volumes.forEach((block, vol) => {
  (block.lessons || []).forEach((lesson, ordinal) => lessonSlot.set(lesson.id, { vol, ordinal }));
});

// 佈局（全部由穩定輸入推導，與提交次序無關 → 星位穩定）
const HUB_R = 430;
function hubPos(vol) {
  const angle = vol / 5 * Math.PI * 2 - Math.PI / 2;
  return { x: Math.cos(angle) * HUB_R, y: (vol - 2) * 26, z: Math.sin(angle) * HUB_R, angle };
}
function lessonPos(vol, ordinal) {
  const hub = hubPos(vol);
  const t = ordinal * 2.399963;
  const r = 96 + 30 * Math.sqrt(ordinal);
  return {
    x: hub.x + Math.cos(hub.angle + t) * r * 0.92,
    y: hub.y + ((ordinal * 53 % 17) - 8) * 7,
    z: hub.z + Math.sin(hub.angle + t) * r * 0.92,
  };
}
function wordPos(anchor, wordNorm) {
  const h = fnv1a(wordNorm);
  const angle = (h % 6283) / 1000;
  const r = 36 + ((h >>> 6) % 28);
  return {
    x: anchor.x + Math.cos(angle) * r,
    y: anchor.y + (((h >>> 3) % 36) - 18),
    z: anchor.z + Math.sin(angle) * r,
  };
}

// N 行格式與 jc-atlas 相同：[kind,label,volIdx,-,-,x,y,z,c,col,appear]；META 保存 yw 業務欄位
const N = [];
const META = [];
const indexById = new Map();
function pushNode(row, meta) {
  indexById.set(meta.id, N.length);
  N.push(row);
  META.push(meta);
}

const volumeLit = payload.stats.volumes || {};
volumes.forEach((block, vol) => {
  const p = hubPos(vol);
  const litCount = Number(volumeLit[block.id] || 0);
  const lit = litCount >= HUB_LIT_MIN;
  pushNode(
    [0, block.title, vol, 0, 0, p.x, p.y, p.z, lit ? 2.1 : 1.15, VOL_COLORS[vol], 0],
    { id: `vol:${block.id}`, kind: "vol", ref: block.id, label: block.title, litCount, lit, total: (block.lessons || []).length }
  );
});

const apiNodes = (payload.nodes || []).slice().sort((a, b) => a.seq - b.seq);
const bornRank = new Map(apiNodes.map((node, index) => [node.id, index]));
const appearOf = (id) => apiNodes.length ? 0.06 + (bornRank.get(id) || 0) / apiNodes.length * 0.9 : 0;

for (const node of apiNodes) {
  if (node.kind !== "lesson") continue;
  const slot = lessonSlot.get(node.ref) || { vol: 0, ordinal: fnv1a(node.ref) % 40 };
  const p = lessonPos(slot.vol, slot.ordinal);
  pushNode(
    [1, node.label, slot.vol, 0, 0, p.x, p.y, p.z, node.c, VOL_COLORS[slot.vol], appearOf(node.id)],
    { id: node.id, kind: "lesson", ref: node.ref, label: node.label, meta: node.meta, blockTitle: node.blockTitle }
  );
}
for (const node of apiNodes) {
  if (node.kind !== "word") continue;
  const anchorId = `lesson:${node.meta.firstLessonId}`;
  const anchorIndex = indexById.get(anchorId);
  const anchor = anchorIndex === undefined
    ? hubPos(0)
    : { x: N[anchorIndex][5], y: N[anchorIndex][6], z: N[anchorIndex][7] };
  const p = wordPos(anchor, node.ref);
  const vol = anchorIndex === undefined ? 0 : N[anchorIndex][2];
  pushNode(
    [2, node.label, vol, 0, 0, p.x, p.y, p.z, node.c, node.group && (payload.groupLabels || {})[node.group] ? WORD_GROUP_COLOR : WORD_COLOR, appearOf(node.id)],
    { id: node.id, kind: "word", ref: node.ref, label: node.label, group: node.group || "", meta: node.meta }
  );
}

// E 行格式相同：[a,b,kind] a 在前（母體），b 在後。kind 0=課→詞 1=冊→課 2=語義簇
const E = [];
META.forEach((meta, index) => {
  // 冊別樞紐是最先入表的 5 個節點，其索引即冊序（vol == hub index）
  if (meta.kind === "lesson") E.push([N[index][2], index, 1]);
});
for (const [aId, bId, type] of payload.links || []) {
  const a = indexById.get(aId);
  const b = indexById.get(bId);
  if (a === undefined || b === undefined) continue;
  E.push([a, b, String(type).startsWith("group") ? 2 : 0]);
}

const NL = N.length;
const K = 0, LB = 1, SJ = 2, X = 5, Y = 6, Z = 7, C = 8, COL = 9, AP = 10;

$("stat-lessons").textContent = String(payload.stats.lessons || 0);
$("stat-words").textContent = String(payload.stats.words || 0);
$("stat-links").textContent = String(E.length);

// ---------- 空星空 / 未登入 ----------
if (authRequired || apiFailed || !apiNodes.length) {
  const empty = $("empty-state");
  empty.hidden = false;
  if (authRequired) {
    $("empty-title").textContent = "登入後開始點亮";
    $("empty-copy").textContent = "閱讀星圖跟著你的帳號走。登入 User Center 之後，你在課文寫下的每一組三詞都會在這裏長成星點。";
    const action = $("empty-action");
    action.textContent = "登入 User Center ↗";
    action.href = "https://my.bdfz.net/#/auth";
    action.removeAttribute("data-same-tab");
    action.target = "_blank";
    action.rel = "noopener noreferrer";
    const applyAuthUrl = () => { if (window.BdfzIdentity?.buildAuthUrl) action.href = window.BdfzIdentity.buildAuthUrl(location.href); };
    applyAuthUrl();
    setTimeout(applyAuthUrl, 1500);
  } else if (apiFailed) {
    $("empty-title").textContent = "星圖暫時離線";
    $("empty-copy").textContent = "讀取星圖數據失敗。骨架仍在，稍後刷新即可；你的提交不會丟失。";
    $("empty-action").textContent = "回到課文";
  }
}

// ---------- 邻接 ----------
const incident = Array.from({ length: NL }, () => []);
const directPre = Array.from({ length: NL }, () => []);
const directNext = Array.from({ length: NL }, () => []);
E.forEach((e, i) => {
  incident[e[1]].push(i);
  directPre[e[1]].push(e[0]);
  directNext[e[0]].push(e[1]);
});

function buildLineage(i) {
  const nodes = new Set([i]), edges = new Set(), q = [i], seq = [];
  while (q.length) {
    const u = q.shift();
    for (const idx of incident[u]) {
      const e = E[idx];
      edges.add(idx);
      if (!nodes.has(e[0])) { nodes.add(e[0]); seq.push(e[0]); q.push(e[0]); }
    }
  }
  // 詞星的去向（同簇詞、同詞它課）也納入脈絡
  for (const idx of E.keys()) {
    const e = E[idx];
    if (nodes.has(e[0]) && nodes.has(e[1])) edges.add(idx);
  }
  return { nodes, edges, seq };
}

const RGB = N.map((n) => {
  const v = parseInt(n[COL].slice(1), 16);
  return (v >> 16) + "," + ((v >> 8) & 255) + "," + (v & 255);
});

// ---------- 画布 ----------
const stage = $("stage"), cv = $("gl"), ctx = cv.getContext("2d");
let VW = 0, VH = 0, DPR = 1;
function resize() {
  VW = innerWidth; VH = innerHeight;
  DPR = Math.min(devicePixelRatio || 1, 2);
  cv.width = VW * DPR; cv.height = VH * DPR;
}
addEventListener("resize", resize);
resize();

// ---------- 相机 ----------
const FOV = 1400;
let rotY = 0.55, tilt = -0.24, zoom = 1, panX = 0, panY = 0;
let rotYTarget = null, tiltTarget = null, zoomTarget = null, panXT = null, panYT = null;
let spin = reduce ? 0 : 0.00016;
const P = new Float32Array(NL * 3);

function project() {
  const cy = Math.cos(rotY), sy = Math.sin(rotY);
  const ct = Math.cos(tilt), st = Math.sin(tilt);
  const cx = VW * (VW < 720 ? 0.5 : 0.55), cyy = VH * 0.52;
  const sc = Math.min(VW / 1620, VH / 2080) * zoom;
  for (let i = 0; i < NL; i++) {
    const n = N[i];
    const x = n[X] * cy + n[Z] * sy, z = -n[X] * sy + n[Z] * cy, y = n[Y];
    const y2 = y * ct - z * st, z2 = y * st + z * ct;
    const pf = FOV / (FOV + z2 * sc * 1.6);
    P[i * 3] = cx + panX + x * sc * pf;
    P[i * 3 + 1] = cyy + panY - y2 * sc * pf;
    P[i * 3 + 2] = pf;
  }
}

function nodeR(i) {
  return (2.2 + Math.sqrt(N[i][C]) * 7.6) * P[i * 3 + 2] * Math.min(1.6, Math.max(0.9, zoom));
}

// ---------- 状态 ----------
const active = new Set(volumes.map((_, i) => i));
let hover = -1, selected = -1, lineage = null;
const hist = [];
let grow = reduce ? 1.02 : 0;

// ---------- 绘制 ----------
const order = N.map((_, i) => i);
function draw() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0, 0, VW, VH);
  project();
  const hasSel = !!lineage;

  for (let k = 0; k < E.length; k++) {
    const e = E[k], a = e[0], b = e[1];
    if (!active.has(N[a][SJ]) || !active.has(N[b][SJ])) continue;
    if (N[a][AP] > grow || N[b][AP] > grow) continue;
    let alpha, col = null, lw = 1;
    if (hasSel) {
      if (lineage.edges.has(k)) { alpha = .72; col = RGB[b]; lw = 1.5; }
      else alpha = .035;
    } else {
      alpha = e[2] === 0 ? .12 : e[2] === 1 ? .07 : .05;
    }
    const depth = (P[a * 3 + 2] + P[b * 3 + 2]) / 2;
    ctx.strokeStyle = col ? "rgba(" + col + "," + alpha + ")" : "rgba(150,165,205," + (alpha * depth) + ")";
    ctx.lineWidth = lw;
    if (e[2] === 2) ctx.setLineDash([3, 5]);
    ctx.beginPath();
    ctx.moveTo(P[a * 3], P[a * 3 + 1]); ctx.lineTo(P[b * 3], P[b * 3 + 1]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  order.sort((a, b) => P[a * 3 + 2] - P[b * 3 + 2]);
  for (const i of order) {
    const n = N[i];
    if (!active.has(n[SJ])) continue;
    if (n[AP] > grow) continue;
    const inLin = hasSel ? lineage.nodes.has(i) : true;
    const isFocus = (i === selected) || (i === hover);
    const dim = (hasSel && !inLin) ? 0.10 : 1;
    const sx = P[i * 3], sy = P[i * 3 + 1], pf = P[i * 3 + 2];
    const born = Math.min(1, (grow - n[AP]) / 0.05);
    const r = nodeR(i) * (isFocus ? 1.55 : 1) * born;
    if (r < 0.3) continue;
    const rgb = RGB[i];
    const a = dim * (0.55 + 0.45 * Math.min(1, pf * pf));
    if (isFocus || (hasSel && inLin)) {
      ctx.shadowColor = "rgb(" + rgb + ")"; ctx.shadowBlur = isFocus ? 18 : 8;
    } else ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(" + rgb + "," + a + ")";
    ctx.beginPath(); ctx.arc(sx, sy, r, 0, 6.2832); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(8,10,18," + (0.5 * dim) + ")";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(sx, sy, r, 0, 6.2832); ctx.stroke();
    if (i === selected) {
      ctx.strokeStyle = "rgba(255,255,255,.95)"; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(sx, sy, r + 2.5, 0, 6.2832); ctx.stroke();
    } else if (i === hover) {
      ctx.strokeStyle = "rgba(255,255,255,.6)"; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(sx, sy, r + 2, 0, 6.2832); ctx.stroke();
    }
  }
}

// ---------- 帧循环（挂钟锚定） ----------
const START = performance.now();
let lastTs = START;
function frame(ts) {
  if (!reduce) grow = Math.min(1.02, (ts - START) / 2800 * 1.02);
  const dt = Math.min(64, ts - lastTs); lastTs = ts;
  rotY += spin * dt;
  if (rotYTarget !== null) {
    const d = ((rotYTarget - rotY + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    rotY += d * 0.12;
    if (Math.abs(d) < 0.008) rotYTarget = null;
  }
  if (tiltTarget !== null) { tilt += (tiltTarget - tilt) * 0.12; if (Math.abs(tiltTarget - tilt) < 0.004) tiltTarget = null; }
  if (zoomTarget !== null) { zoom += (zoomTarget - zoom) * 0.12; if (Math.abs(zoomTarget - zoom) < 0.01) zoomTarget = null; }
  if (panXT !== null) {
    panX += (panXT - panX) * 0.15; panY += (panYT - panY) * 0.15;
    if (Math.abs(panXT - panX) < 1 && Math.abs(panYT - panY) < 1) { panX = panXT; panY = panYT; panXT = null; panYT = null; }
  }
  draw();
  requestAnimationFrame(frame);
}

// ---------- 拾取 / 悬浮 ----------
function pick(mx, my) {
  let best = -1, bd = 20 * 20;
  for (let i = 0; i < NL; i++) {
    if (!active.has(N[i][SJ]) || N[i][AP] > grow) continue;
    const dx = P[i * 3] - mx, dy = P[i * 3 + 1] - my, d = dx * dx + dy * dy;
    const rr = Math.max(11, nodeR(i) + 6);
    if (d < rr * rr && d < bd) { bd = d; best = i; }
  }
  return best;
}

const tip = $("tooltip");
function tipContext(i) {
  const meta = META[i];
  if (meta.kind === "vol") return `${meta.litCount} / ${meta.total} 篇已點亮`;
  if (meta.kind === "lesson") return `${volumes[N[i][SJ]].title} · ${meta.meta.versions} 版三詞`;
  return `${meta.meta.lessons.length} 課使用`;
}
function showTip(i, e) {
  tip.innerHTML = esc(N[i][LB]) + '<span class="ctx">' + KINDS[N[i][K]] + " · " + esc(tipContext(i)) + "</span>";
  placeTip(e);
  tip.hidden = false;
}
function placeTip(e) {
  const x = Math.min(e.clientX, VW - 340);
  tip.style.left = x + "px"; tip.style.top = e.clientY + "px";
}
function hideTip() { tip.hidden = true; }

// ---------- 选择 / 脉络 ----------
function focusNode(i) {
  const n = N[i];
  let best = null, bestZ = Infinity;
  const cand0 = Math.atan2(-n[X], n[Z]);
  for (const cand of [cand0, cand0 + Math.PI]) {
    const z2 = -n[X] * Math.sin(cand) + n[Z] * Math.cos(cand);
    if (z2 < bestZ) { bestZ = z2; best = cand; }
  }
  rotYTarget = best; tiltTarget = -0.16; zoomTarget = Math.max(zoom, 1.18); panXT = 0; panYT = 0;
}

function selectNode(i, push) {
  if (push && selected >= 0 && selected !== i) hist.push(selected);
  selected = i;
  lineage = buildLineage(i);
  renderCard(i);
  focusNode(i);
  spin = 0;
  hideTip();
  history.replaceState(null, "", "#s=" + encodeURIComponent(META[i].id));
}
function clearSel() {
  selected = -1; lineage = null; hist.length = 0;
  $("card").hidden = true;
  if (!reduce) spin = 0.00016;
  history.replaceState(null, "", location.pathname);
}
function goBack() { if (hist.length) selectNode(hist.pop(), false); }

function rowsHTML(list, max) {
  const items = list.slice(0, max).map((j) => {
    const n = N[j];
    return `<li><button data-i="${j}">
      <span class="dot" style="background:${n[COL]}"></span>
      <span class="lb">${esc(n[LB])}</span>
      <span class="ctx">${esc(KINDS[n[K]])}</span>
    </button></li>`;
  }).join("");
  const extra = list.length > max ? `<li class="more">…共 ${list.length} 項，逐級點入可繼續追溯</li>` : "";
  return items + extra;
}

function factsHTML(i) {
  const meta = META[i];
  if (meta.kind === "vol") {
    return `<span class="fact"><b>${meta.litCount}</b> / ${meta.total} 篇已點亮</span>` +
      `<span class="fact">${meta.lit ? "本冊星座已解鎖（≥" + HUB_LIT_MIN + " 篇）" : "再點亮 " + Math.max(0, HUB_LIT_MIN - meta.litCount) + " 篇即可解鎖本冊星座"}</span>`;
  }
  if (meta.kind === "lesson") {
    const m = meta.meta;
    const pills = (m.words || []).map((word) => `<span class="word-pill">${esc(word)}</span>`).join("");
    const vocab = m.vocabTotal > 0
      ? `<span class="fact">字詞題 <b>${m.vocabMastered}</b> / ${m.vocabTotal} 已掌握</span>`
      : m.vocabAttempted > 0 ? `<span class="fact">字詞題已作答 <b>${m.vocabAttempted}</b> 項</span>` : "";
    return pills +
      `<span class="fact">三詞第 <b>${m.versions}</b> 版</span>` +
      (m.bestScore ? `<span class="fact">最佳評議 <b>${m.bestScore}</b> 分</span>` : "") +
      vocab;
  }
  const m = meta.meta;
  const group = meta.group && (payload.groupLabels || {})[meta.group];
  return `<span class="fact">出現於 <b>${m.lessons.length}</b> 篇課文</span>` +
    (group ? `<span class="fact">語義簇：<b>${esc(group)}</b></span>` : "");
}

async function loadLessonHistory(i) {
  const meta = META[i];
  const sect = $("sect-history");
  sect.hidden = true;
  if (meta.kind !== "lesson") return;
  try {
    const detail = await fetchJson(`/api/reading/lesson/${encodeURIComponent(meta.ref)}`);
    if (selected !== i || !Array.isArray(detail.history) || !detail.history.length) return;
    $("history-count").textContent = String(detail.history.length);
    $("rows-history").innerHTML = detail.history.map((entry) => `
      <li>
        <span class="h-words ${entry.active ? "" : "inactive"}">${entry.words.map(esc).join("、")}</span>
        <span class="h-meta">第 ${entry.version} 版 · ${esc(String(entry.createdAt || "").slice(0, 16))}${entry.aiScore ? ` · ${entry.aiScore} 分` : ""}${entry.active ? " · 現行" : ""}</span>
      </li>
    `).join("");
    sect.hidden = false;
  } catch { /* 歷史讀取失敗時只隱藏沿革段 */ }
}

function renderCard(i) {
  const n = N[i];
  const meta = META[i];
  const card = $("card");
  card.style.setProperty("--kc", n[COL]);
  $("card-back").hidden = !hist.length;
  $("card-kind").textContent = `${volumes[n[SJ]]?.title || ""} · ${KINDS[n[K]]}`;
  $("card-title").textContent = n[LB];
  $("card-facts").innerHTML = factsHTML(i);
  const pre = meta.kind === "word" ? directPre[i] : (lineage.seq.length ? lineage.seq : directPre[i]);
  const nxt = directNext[i];
  $("pre-label").textContent = meta.kind === "word" ? "生於這些課文" : "此前來路";
  $("next-label").textContent = meta.kind === "vol" ? "冊內已點亮" : meta.kind === "lesson" ? "留下的詞星" : "同簇詞星";
  const nextList = nxt;
  $("sect-pre").hidden = !pre.length;
  $("sect-next").hidden = !nextList.length;
  $("pre-count").textContent = pre.length || "";
  $("next-count").textContent = nextList.length || "";
  $("rows-pre").innerHTML = rowsHTML(pre, 8);
  $("rows-next").innerHTML = rowsHTML(nextList, 8);
  const open = $("card-open");
  if (meta.kind === "lesson") { open.href = `./#${encodeURIComponent(meta.ref)}`; open.textContent = "回到這篇課文 ↗"; }
  else if (meta.kind === "word") { open.href = `./#${encodeURIComponent(meta.meta.firstLessonId || "")}`; open.textContent = "回到它初次出現的課文 ↗"; }
  else { open.href = "./"; open.textContent = "回到這一冊課文 ↗"; }
  card.hidden = false;
  card.scrollTop = 0;
  void loadLessonHistory(i);
}

$("card").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-i]");
  if (b) selectNode(+b.dataset.i, true);
});
$("card-back").addEventListener("click", goBack);
$("card-close").addEventListener("click", clearSel);

function setMasteryPanelOpen(open, restoreFocus = false) {
  $("mastery-panel").hidden = !open;
  $("mastery-toggle").setAttribute("aria-expanded", String(open));
  if (open) {
    $("mastery-panel").classList.remove("closing");
  } else if (restoreFocus) {
    $("mastery-toggle").focus();
  }
}

$("mastery-toggle").addEventListener("click", () => {
  setMasteryPanelOpen($("mastery-panel").hidden);
});
$("mastery-close").addEventListener("click", () => setMasteryPanelOpen(false, true));

// ---------- 交互 ----------
let dragging = false, panning = false, moved = 0, lx = 0, ly = 0;
const pts = new Map(); let pinchD = 0;

stage.addEventListener("pointerdown", (e) => {
  cv.setPointerCapture?.(e.pointerId);
  pts.set(e.pointerId, [e.clientX, e.clientY]);
  if (e.button === 2) { panning = true; panXT = null; panYT = null; }
  else dragging = true;
  moved = 0; lx = e.clientX; ly = e.clientY;
  cv.classList.add("drag");
});
stage.addEventListener("pointermove", (e) => {
  if (pts.has(e.pointerId)) pts.set(e.pointerId, [e.clientX, e.clientY]);
  if (pts.size === 2) {
    const [a, b] = [...pts.values()];
    const dd = Math.hypot(a[0] - b[0], a[1] - b[1]);
    if (pinchD) zoom = Math.max(.5, Math.min(4, zoom * dd / pinchD));
    pinchD = dd; dragging = false;
    return;
  }
  if (!dragging && !panning) { onHover(e); return; }
  const dx = e.clientX - lx, dy = e.clientY - ly;
  moved += Math.abs(dx) + Math.abs(dy);
  if (panning) { panX += dx; panY += dy; }
  else {
    rotY += dx * 0.005; rotYTarget = null;
    tilt = Math.max(-1.2, Math.min(1.2, tilt - dy * 0.004)); tiltTarget = null;
  }
  lx = e.clientX; ly = e.clientY;
});
const endPtr = (e) => {
  const wasTap = moved < 6 && pts.size === 1 && e.button !== 2;
  pts.delete(e.pointerId);
  if (pts.size < 2) pinchD = 0;
  if (!pts.size) { dragging = false; panning = false; cv.classList.remove("drag"); }
  if (wasTap) {
    const i = pick(e.clientX, e.clientY);
    if (i < 0) clearSel(); else selectNode(i, true);
  }
};
stage.addEventListener("pointerup", endPtr);
stage.addEventListener("pointercancel", (e) => { pts.delete(e.pointerId); if (pts.size < 2) pinchD = 0; dragging = false; panning = false; });
stage.addEventListener("pointerleave", () => { hideTip(); hover = -1; });
stage.addEventListener("contextmenu", (e) => e.preventDefault());
stage.addEventListener("wheel", (e) => {
  e.preventDefault();
  zoom = Math.max(.5, Math.min(4, zoom * Math.exp(-e.deltaY * 0.0016)));
  zoomTarget = null;
}, { passive: false });
stage.addEventListener("dblclick", () => {
  rotYTarget = 0.55; tiltTarget = -0.24; zoomTarget = 1; panXT = 0; panYT = 0;
  clearSel();
});
addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (!$("mastery-panel").hidden) { setMasteryPanelOpen(false, true); return; }
    if (!$("search-results").hidden) { $("search-results").hidden = true; return; }
    clearSel();
  }
});

function onHover(e) {
  const i = pick(e.clientX, e.clientY);
  if (i !== hover) { hover = i; i >= 0 ? showTip(i, e) : hideTip(); }
  else if (i >= 0) placeTip(e);
  cv.style.cursor = i >= 0 ? "pointer" : "";
  spin = (hover >= 0 || selected >= 0 || reduce) ? 0 : 0.00016;
}

// ---------- 冊別开关 ----------
const chipHost = $("chips");
volumes.forEach((block, si) => {
  const el = document.createElement("button");
  el.className = "chip";
  el.style.setProperty("--c", VOL_COLORS[si]);
  el.setAttribute("aria-pressed", "true");
  el.innerHTML = `<span class="sw"></span>${esc(block.title)}<span class="ct">${Number(volumeLit[block.id] || 0)}</span>`;
  el.addEventListener("click", () => {
    if (active.has(si)) { active.delete(si); el.classList.add("off"); el.setAttribute("aria-pressed", "false"); }
    else { active.add(si); el.classList.remove("off"); el.setAttribute("aria-pressed", "true"); }
    if (selected >= 0 && !active.has(N[selected][SJ])) clearSel();
  });
  chipHost.appendChild(el);
});

// ---------- 搜索 ----------
const searchInput = $("search");
const results = $("search-results");
const lowLabels = N.map((n) => n[LB].toLowerCase());
let srList = [];
searchInput.addEventListener("input", () => {
  const q = searchInput.value.trim().toLowerCase();
  if (!q) { results.hidden = true; return; }
  srList = [];
  for (let i = 0; i < NL && srList.length < 14; i++) {
    if (active.has(N[i][SJ]) && lowLabels[i].includes(q)) srList.push(i);
  }
  if (!srList.length) { results.hidden = true; return; }
  results.innerHTML = srList.map((i) => {
    const n = N[i];
    return `<button class="sr" data-i="${i}">
      <span class="dot" style="background:${n[COL]}"></span>
      <span class="lb">${esc(n[LB])}</span>
      <span class="ctx">${esc(volumes[n[SJ]]?.title || "")}·${esc(KINDS[n[K]])}</span>
    </button>`;
  }).join("");
  results.hidden = false;
});
results.addEventListener("click", (e) => {
  const b = e.target.closest(".sr");
  if (!b) return;
  results.hidden = true; searchInput.blur();
  selectNode(+b.dataset.i, true);
});
searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && srList.length) {
    results.hidden = true; searchInput.blur();
    selectNode(srList[0], true);
  }
});
document.addEventListener("click", (e) => {
  if (!e.target.closest("#searchbox")) results.hidden = true;
});

// ---------- 深链 & 启动 ----------
{
  const m = location.hash.match(/s=([^&]+)/);
  if (m) {
    const i = indexById.get(decodeURIComponent(m[1]));
    if (i !== undefined) { grow = 1.02; selectNode(i, false); }
  }
}
if (matchMedia("(pointer: coarse)").matches) {
  $("hint").textContent = "單指旋轉 · 雙指縮放 · 點按星點看脈絡 · 雙擊復位";
}
requestAnimationFrame(frame);
$("loading").classList.add("done");
void hydrateMasteryPanel(formativeMasteryPromise);
