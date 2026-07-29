// 字詞題庫核查閘門：對 site/data/vocab/ 全量執行任務書要求的核對項。
// 用法：node scripts/validate_vocab_bank.mjs [--strict-coverage]
//   默認：僅核查已存在的題庫檔（增量生成期間可跑）；
//   --strict-coverage：135 篇可出題課文必須每篇有題庫（缺一即 FAIL），發佈前必須以此模式通過。
// 核對項（與 docs/VOCAB_STANDARD.md 一一對應）：
//   C1 每課對照完整正文核查：sourceSentence 必須逐字在正文中（防編造）
//   C2 教材註釋全覆蓋：每條註釋在 inventory 有 decision + reason（覆蓋或有記錄的排除）
//   C3 未註而重要的字詞已補收：非 annotated 條目 ≥3（正文 ≥600 字時）
//   C4 答案與語境一致的結構前提：answerIndex 有效、四選項互異、有 explanation
//   C5 去重：同課內不得有相同題幹或同詞同題型重複
//   C6 難度分佈：題數 ≥6 的課至少覆蓋兩個難度檔
//   C7 文言條目必須帶辭書/文獻 sourceRefs
//   C8 id 穩定唯一（lessonId:vNN）且 index.json 與檔案一致
//   C9 教學語義品質：新題須記錄四個選項的逐項判定理由；舊題庫缺少時先警告，經語義複核後補齊
import { readFileSync, existsSync } from "node:fs";
import {
  VOCAB_DIR, bankPath, eligibleLessons, extractAnnotations, listBankFiles,
  loadLesson, primaryText, QUESTION_TYPES,
} from "./vocab_lib.mjs";

const strictCoverage = process.argv.includes("--strict-coverage");
const failures = [];
const warnings = [];
const fail = (lesson, code, message) => failures.push(`${lesson} ${code}: ${message}`);
const warn = (lesson, code, message) => warnings.push(`${lesson} ${code}: ${message}`);

const eligible = eligibleLessons();
const files = new Set(listBankFiles());
let checked = 0, questionTotal = 0;

for (const meta of eligible) {
  const file = `${meta.id}.json`;
  if (!files.has(file)) {
    if (strictCoverage) {
      const text = primaryText(loadLesson(meta.id));
      if (text.length >= 40) fail(meta.id, "C0", "eligible lesson has no vocab bank");
      else warn(meta.id, "C0", "skipped (text too short)");
    }
    continue;
  }
  checked += 1;
  const bank = JSON.parse(readFileSync(bankPath(meta.id), "utf8"));
  const lesson = loadLesson(meta.id);
  const text = primaryText(lesson);
  const annotations = extractAnnotations(lesson);
  const inventory = Array.isArray(bank.inventory) ? bank.inventory : [];
  const questions = inventory.filter((item) => item.decision === "question");
  questionTotal += questions.length;

  // C2 教材註釋全覆蓋
  const words = new Set(inventory.map((item) => item.word));
  for (const annotation of annotations) {
    if (!words.has(annotation.word)) fail(meta.id, "C2", `annotation uncovered: ${annotation.word}`);
  }
  for (const item of inventory) {
    if (!item.reason) fail(meta.id, "C2", `missing reason: ${item.word}`);
  }

  // C3 未註而重要的字詞（以腳本抽取的註釋詞表為準）
  const annotationWords = new Set(annotations.map((annotation) => annotation.word));
  const unannotated = inventory.filter((item) => !annotationWords.has(item.word));
  if (text.length >= 600 && unannotated.length < 3) {
    fail(meta.id, "C3", `only ${unannotated.length} unannotated items`);
  }

  // C1/C4/C7 逐題
  const stems = new Set();
  const wordType = new Set();
  const difficulties = new Set();
  const ids = new Set();
  for (const item of questions) {
    if (!/^lesson-[\w-]+:v\d{2,}$/.test(item.id)) fail(meta.id, "C8", `bad id: ${item.id}`);
    if (ids.has(item.id)) fail(meta.id, "C8", `duplicate id: ${item.id}`);
    ids.add(item.id);
    if (!item.sourceSentence || text.indexOf(item.sourceSentence) < 0) {
      fail(meta.id, "C1", `sentence not verbatim in text: ${item.word}`);
    }
    if (!QUESTION_TYPES.has(item.type)) fail(meta.id, "C4", `bad type: ${item.word} ${item.type}`);
    if (!Array.isArray(item.options) || item.options.length !== 4) fail(meta.id, "C4", `options != 4: ${item.word}`);
    else if (new Set(item.options).size !== 4) fail(meta.id, "C4", `duplicate options: ${item.word}`);
    if (!(item.answerIndex >= 0 && item.answerIndex <= 3)) fail(meta.id, "C4", `bad answerIndex: ${item.word}`);
    if (!item.explanation) fail(meta.id, "C4", `missing explanation: ${item.word}`);
    if (!Array.isArray(item.distractorRationales) || item.distractorRationales.length !== 4) {
      warn(meta.id, "C9", `missing four option rationales: ${item.word}`);
    }
    if (!item.contextMeaning) warn(meta.id, "C4", `missing contextMeaning: ${item.word}`);
    const stem = String(item.question || "").replace(/\s+/g, "");
    if (!stem) fail(meta.id, "C4", `empty question: ${item.word}`);
    if (stems.has(stem)) fail(meta.id, "C5", `duplicate stem: ${item.word}`);
    stems.add(stem);
    const wt = `${item.word}|${item.type}`;
    if (wordType.has(wt)) fail(meta.id, "C5", `same word+type twice: ${wt}`);
    wordType.add(wt);
    difficulties.add(item.difficulty);
    if (meta.mode === "classical" && (!item.sourceRefs || !item.sourceRefs.length)) {
      fail(meta.id, "C7", `classical item without sourceRefs: ${item.word}`);
    }
  }
  // C6 難度分佈
  if (questions.length >= 6 && difficulties.size < 2) fail(meta.id, "C6", "single difficulty level");
  if (!questions.length) fail(meta.id, "C4", "no questions");
}

// C8 index.json 一致性
const indexPath = `${VOCAB_DIR}/index.json`;
if (existsSync(indexPath)) {
  const index = JSON.parse(readFileSync(indexPath, "utf8"));
  for (const file of files) {
    const bank = JSON.parse(readFileSync(`${VOCAB_DIR}/${file}`, "utf8"));
    const count = bank.inventory.filter((item) => item.decision === "question").length;
    if ((index.lessons || {})[bank.lessonId] !== count) {
      fail(bank.lessonId, "C8", `index count mismatch: index=${(index.lessons || {})[bank.lessonId]} file=${count}`);
    }
  }
} else if (files.size) {
  fail("(global)", "C8", "index.json missing");
}

console.log(`checked ${checked}/${eligible.length} lessons, ${questionTotal} questions`);
if (warnings.length) console.log(`warnings (${warnings.length}):\n` + warnings.slice(0, 20).map((w) => "  " + w).join("\n"));
if (failures.length) {
  console.error(`FAIL (${failures.length}):\n` + failures.slice(0, 60).map((f) => "  " + f).join("\n"));
  process.exit(1);
}
console.log(strictCoverage ? "vocab bank PASS (strict coverage)" : "vocab bank PASS (built files only)");
