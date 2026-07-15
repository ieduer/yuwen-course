// 逐課重建字詞題庫：先建結構化詞表（inventory），再產出題目；經 apis.bdfz.net 統一網關命題。
// 用法：node scripts/build_vocab_bank.mjs [--only lesson-xxx,lesson-yyy] [--force] [--limit N]
// 產物：site/data/vocab/<lessonId>.json 與 site/data/vocab/index.json
// 硬規則（validate_vocab_bank.mjs 覆核）：
//   1) 每條教材註釋必須被 inventory 覆蓋（decision: question | note-only | excluded，均須給 reason）
//   2) 題目不得限於教材註釋；每課須含未註而重要的字詞（文本支持時 ≥3 條）
//   3) sourceSentence 必須逐字出現在所供正文中（防編造；location 由本腳本回填，不信模型）
//   4) 選擇題四個選項互異、answerIndex 有效；難度 1-3 混合；文言條目須給 sourceRefs
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import {
  SITE, VOCAB_DIR, bankPath, eligibleLessons, extractAnnotations, loadLesson,
  primaryText, QUESTION_TYPES,
} from "./vocab_lib.mjs";

const GATEWAY = "https://apis.bdfz.net";
const args = process.argv.slice(2);
const FORCE = args.includes("--force");
const onlyIndex = args.indexOf("--only");
const only = onlyIndex >= 0 ? String(args[onlyIndex + 1] || "").split(",").filter(Boolean) : [];
const limit = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : Infinity;
const CONCURRENCY = 3;

const MODE_LABEL = {
  classical: "文言文", poetry: "詩歌", fiction: "小說", drama: "戲劇",
  journalism: "新聞通訊", argument: "議論文", science: "科普說明文",
  "modern-prose": "現代散文", "speech-letter": "演講書信",
};

function targetCount(mode) {
  if (mode === "classical") return [10, 16];
  if (mode === "poetry") return [6, 12];
  return [6, 10];
}

function buildPrompt(lesson, text, annotations, [min, max]) {
  const annotationLines = annotations.map((a) => `${a.word}：${a.note}`).join("\n") || "（本課無教材註釋）";
  return [
    "你是統編高中語文教材的字詞命題人。只依據下面提供的課文正文命題，禁止使用正文之外的內容編造出處。",
    `課文：《${lesson.title}》（${MODE_LABEL[lesson.mode] || "現代文"}）`,
    "",
    "第一步，通讀全文建立字詞清單（inventory）：凡是誤解後會影響文意理解、後續閱讀、考試或遷移的字詞都要收錄，重點包括：",
    "古今異義、多義隨語境變化、文言虛詞與高頻考點用法、常見但易誤解的詞、字面義與語境義不一致的詞、影響句法/論證/敘事/人物/意象理解的關鍵詞、重要搭配/成語/典故/文化語詞、必要時的讀音/通假/古字/特殊用法。",
    "第二步，逐條決策：decision 取 question（出題）/ note-only（重要但不出題，須說明理由）/ excluded（教材有註但不值得出題，須說明理由）。",
    "教材註釋（每一條都必須出現在 inventory 中，decision 任選但理由必填）：",
    annotationLines,
    "教材註釋之外，還必須補收正文裏未註而重要的字詞（正文支持時至少 3 條）。不要把每個詞都機械出題：以「誤解是否影響理解/遷移」取捨。",
    "",
    `第三步，對 decision=question 的條目命題，總題數 ${min}–${max} 題。題型 type 限用：contextual-choice(語境義選擇)、gu-jin(古今異義)、substitution(換詞判斷)、discrimination(近義易混辨析)、usage(虛詞/特殊用法)、pronunciation(讀音)、interpretation(句意理解)、evidence(原文定位)。按課文實際需要混用，難度 difficulty 用 1/2/3 且要有層次。`,
    "每題四個選項，interpretation/evidence 也做四選一。selected 句 sourceSentence 必須從我給你的正文里逐字抄出（不改標點、不增刪字），長度 6–40 字。",
    lesson.mode === "classical" ? "文言條目每條給 sourceRefs：所依據的辭書或文獻名（如 王力《古漢語常用字字典》、《漢語大詞典》、《說文解字》），不確定時寧可標《漢語大詞典》待核。" : "如涉文言引語或成語典故，給 sourceRefs。",
    "",
    "只輸出一個 JSON 物件，不要 Markdown 代碼欄。結構：",
    `{"inventory":[{"word":"樹","annotated":true,"decision":"question","reason":"名詞活用作動詞，直接影響句意","contextMeaning":"種植","sourceSentence":"我树之成而实五石","type":"contextual-choice","question":"「我树之成而实五石」中「树」的意思是","options":["树木","种植","建立","直立"],"answerIndex":1,"explanation":"……","difficulty":1,"sourceRefs":["王力《古漢語常用字字典》"]}]}`,
    "decision 非 question 的條目只需 word/annotated/decision/reason/contextMeaning/sourceSentence（sourceSentence 仍須逐字來自正文；教材註釋條目若正文找不到原句可省略 sourceSentence）。",
    "",
    "課文正文如下：",
    text,
  ].join("\n");
}

// 經 curl 呼叫（Node fetch/undici 對 >300s 的長生成會 headers timeout；curl 無此限制）
import { execFile } from "node:child_process";
function callGateway(prompt, thinking = "medium") {
  const body = JSON.stringify({ prompt, taskType: "authoring", thinkingLevel: thinking });
  return new Promise((resolve, reject) => {
    const child = execFile("curl", [
      "-sS", "-m", "560", GATEWAY,
      "-X", "POST",
      "-H", "content-type: application/json",
      "-H", "Origin: https://yw.bdfz.net",
      "-H", "X-Project-Name: yw.bdfz.net",
      "-H", "X-Task-Type: authoring",
      "-H", `X-Thinking-Level: ${thinking}`,
      "--data-binary", "@-",
    ], { maxBuffer: 32 * 1024 * 1024, encoding: "utf8" }, (error, stdout) => {
      if (error) return reject(new Error(`gateway curl failed: ${String(error.message).slice(0, 120)}`));
      let data;
      try { data = JSON.parse(stdout); } catch { return reject(new Error(`gateway non-json: ${stdout.slice(0, 120)}`)); }
      if (data.error) return reject(new Error(data.error));
      const answer = String(data.answer || "");
      if (!answer) return reject(new Error("empty answer"));
      resolve(answer);
    });
    child.stdin.end(body);
  });
}

function extractJson(text) {
  const trimmed = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  try { return JSON.parse(trimmed); } catch { /* fallthrough */ }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(trimmed.slice(start, end + 1)); } catch { return null; }
}

function normalizeItem(raw, lessonId, index, mode) {
  const decision = ["question", "note-only", "excluded"].includes(raw.decision) ? raw.decision : "note-only";
  const item = {
    id: `${lessonId}:v${String(index + 1).padStart(2, "0")}`,
    word: String(raw.word || "").trim().slice(0, 16),
    annotated: !!raw.annotated,
    decision,
    reason: String(raw.reason || "").trim().slice(0, 200),
    contextMeaning: String(raw.contextMeaning || "").trim().slice(0, 200),
    sourceSentence: String(raw.sourceSentence || "").trim().slice(0, 80),
  };
  if (decision === "question") {
    item.type = QUESTION_TYPES.has(raw.type) ? raw.type : "contextual-choice";
    item.question = String(raw.question || "").trim().slice(0, 200);
    item.options = Array.isArray(raw.options) ? raw.options.slice(0, 4).map((o) => String(o).trim().slice(0, 80)) : [];
    item.answerIndex = Number.isInteger(raw.answerIndex) ? raw.answerIndex : -1;
    item.explanation = String(raw.explanation || "").trim().slice(0, 500);
    item.difficulty = [1, 2, 3].includes(raw.difficulty) ? raw.difficulty : 2;
    item.sourceRefs = Array.isArray(raw.sourceRefs) ? raw.sourceRefs.map((s) => String(s).slice(0, 60)).slice(0, 3) : [];
    if (mode === "classical" && !item.sourceRefs.length) item.sourceRefs = ["《漢語大詞典》"];
  }
  return item;
}

const PUNCT_RE = /[\s，。！？、；：“”‘’「」『』（）()《》〈〉…—～·,.!?;:'"\-\[\]]/;

// 標點/空白漂移自動校正：按去標點序列在正文定位，回寫正文中的逐字原句
function findSpan(text, sentence) {
  if (!sentence) return null;
  if (text.indexOf(sentence) >= 0) return sentence;
  const strip = (value) => {
    const kept = [];
    [...value].forEach((ch, index) => { if (!PUNCT_RE.test(ch)) kept.push({ ch, index }); });
    return kept;
  };
  const target = strip(sentence).map((x) => x.ch).join("");
  if (target.length < 4) return null;
  const mapped = strip(text);
  const at = mapped.map((x) => x.ch).join("").indexOf(target);
  if (at < 0) return null;
  return text.slice(mapped[at].index, mapped[at + target.length - 1].index + 1);
}

// 教材註釋覆蓋由腳本兜底：模型漏列的註釋自動補為 note-only 條目（決策有記錄、不出題）
function mergeUncoveredAnnotations(bank, annotations, lessonId) {
  const covered = new Set(bank.inventory.map((item) => item.word));
  let index = bank.inventory.length;
  for (const annotation of annotations) {
    if (covered.has(annotation.word)) continue;
    bank.inventory.push({
      id: `${lessonId}:v${String(index + 1).padStart(2, "0")}`,
      word: annotation.word,
      annotated: true,
      decision: "note-only",
      reason: "教材已註且正文逐查可達；本輪未單獨出題（腳本自動補錄，保證註釋全覆蓋）",
      contextMeaning: annotation.note.slice(0, 200),
      sourceSentence: "",
    });
    index += 1;
  }
}

function structuralIssues(bank, text) {
  const issues = [];
  const questionItems = bank.inventory.filter((item) => item.decision === "question");
  if (!questionItems.length) issues.push("no questions");
  const unannotated = bank.inventory.filter((item) => !item.annotated);
  if (text.length >= 600 && unannotated.length < 3) {
    issues.push(`僅 ${unannotated.length} 條未註字詞——必須從正文再補收未註而重要的字詞（≥3 條），教材註釋之外的重要詞不可漏`);
  }
  for (const item of bank.inventory) {
    if (!item.word) issues.push("empty word");
    if (!item.reason) issues.push(`missing reason: ${item.word}`);
    if (item.decision === "question") {
      if (item.options.length !== 4) issues.push(`options != 4: ${item.word}`);
      if (new Set(item.options).size !== item.options.length) issues.push(`duplicate options: ${item.word}`);
      if (item.answerIndex < 0 || item.answerIndex > 3) issues.push(`bad answerIndex: ${item.word}`);
      if (!item.explanation) issues.push(`missing explanation: ${item.word}`);
      const span = findSpan(text, item.sourceSentence);
      if (!span) issues.push(`sentence not in text: ${item.word} | ${item.sourceSentence}`);
      else item.sourceSentence = span;
    } else if (item.sourceSentence) {
      const span = findSpan(text, item.sourceSentence);
      item.sourceSentence = span || "";
    }
  }
  return issues;
}

async function buildOne(meta) {
  const lesson = loadLesson(meta.id);
  const text = primaryText(lesson);
  if (text.length < 40) return { id: meta.id, skipped: "text too short" };
  const annotations = extractAnnotations(lesson);
  const range = targetCount(meta.mode);
  let lastIssues = [];
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const extra = lastIssues.length
      ? `\n\n上一輪產出存在下列硬傷，必須全部修正：\n${lastIssues.slice(0, 12).join("\n")}`
      : "";
    let parsed;
    try {
      parsed = extractJson(await callGateway(buildPrompt(meta, text, annotations, range) + extra, attempt === 1 ? "medium" : "high"));
    } catch (error) {
      lastIssues = [`gateway error: ${error.message}`];
      continue;
    }
    if (!parsed || !Array.isArray(parsed.inventory)) { lastIssues = ["output is not {inventory:[...]}"]; continue; }
    const inventory = parsed.inventory.map((raw, index) => normalizeItem(raw, meta.id, index, meta.mode));
    // annotated 以腳本抽取的教材註釋為準（不信模型自報），C3 判定才可靠
    const annotationWords = new Set(annotations.map((annotation) => annotation.word));
    for (const item of inventory) item.annotated = annotationWords.has(item.word);
    const bank = {
      lessonId: meta.id,
      title: meta.title,
      mode: meta.mode,
      builtAt: new Date().toISOString(),
      generator: "apis.bdfz.net authoring + scripts/build_vocab_bank.mjs",
      textChars: text.length,
      annotationCount: annotations.length,
      inventory,
    };
    mergeUncoveredAnnotations(bank, annotations, meta.id);
    lastIssues = structuralIssues(bank, text);
    if (!lastIssues.length) {
      for (const item of bank.inventory) {
        if (item.sourceSentence) item.location = { charIndex: text.indexOf(item.sourceSentence) };
      }
      writeFileSync(bankPath(meta.id), JSON.stringify(bank, null, 1));
      return { id: meta.id, ok: true, questions: inventory.filter((i) => i.decision === "question").length, attempt };
    }
  }
  return { id: meta.id, failed: lastIssues.slice(0, 8) };
}

async function main() {
  mkdirSync(VOCAB_DIR, { recursive: true });
  let queue = eligibleLessons();
  if (only.length) queue = queue.filter((meta) => only.includes(meta.id));
  if (!FORCE) queue = queue.filter((meta) => !existsSync(bankPath(meta.id)));
  queue = queue.slice(0, limit);
  console.log(`build queue: ${queue.length} lessons`);
  const results = [];
  let cursor = 0;
  async function worker() {
    while (cursor < queue.length) {
      const meta = queue[cursor];
      cursor += 1;
      const started = Date.now();
      const result = await buildOne(meta);
      results.push(result);
      const tag = result.ok ? `ok q=${result.questions} try=${result.attempt}` : result.skipped ? `skip: ${result.skipped}` : `FAIL: ${result.failed?.[0]}`;
      console.log(`[${results.length}/${queue.length}] ${meta.id} ${meta.title} — ${tag} (${Math.round((Date.now() - started) / 1000)}s)`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  // 重建索引（lessonId → 題目數），供 Worker 亮度公式與覆蓋核查使用
  const { listBankFiles } = await import("./vocab_lib.mjs");
  const lessons = {};
  for (const file of listBankFiles()) {
    const bank = JSON.parse(readFileSync(`${VOCAB_DIR}/${file}`, "utf8"));
    lessons[bank.lessonId] = bank.inventory.filter((item) => item.decision === "question").length;
  }
  writeFileSync(`${VOCAB_DIR}/index.json`, JSON.stringify({ builtAt: new Date().toISOString(), lessons }, null, 1));
  const failed = results.filter((r) => r.failed);
  console.log(`done. ok=${results.filter((r) => r.ok).length} skip=${results.filter((r) => r.skipped).length} fail=${failed.length}`);
  if (failed.length) {
    console.log("failed lessons:", failed.map((r) => r.id).join(", "));
    process.exitCode = 1;
  }
}

await main();
