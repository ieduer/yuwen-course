// 字詞題庫共用庫：課文文本裝配、教材註釋抽取、規範化。
// 與 site/assets/app.js 的 lessonVocabulary()/annotationParts() 保持同一套抽取規則，
// 保證「教材註釋全覆蓋核查」對得上前端實際可見的註詞。
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

export const SITE = new URL("../site", import.meta.url).pathname;
export const VOCAB_DIR = path.join(SITE, "data", "vocab");

export function loadManifest() {
  return JSON.parse(readFileSync(path.join(SITE, "data", "manifest.json"), "utf8"));
}
export function loadTaxonomy() {
  return JSON.parse(readFileSync(path.join(SITE, "data", "literary-taxonomy.json"), "utf8"));
}
export function loadLesson(id) {
  return JSON.parse(readFileSync(path.join(SITE, "data", "lessons", `${id}.json`), "utf8"));
}

const QUIZ_MODES = new Set(["classical", "poetry", "fiction", "drama", "journalism", "argument", "science", "modern-prose", "speech-letter"]);

export function eligibleLessons() {
  const taxonomy = loadTaxonomy();
  return taxonomy.lessons.filter((lesson) => QUIZ_MODES.has(lesson.mode));
}

export function cleanAnnotationText(value) {
  return String(value || "")
    .replace(/\[color=[^\]]+\]|\[\/color\]/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/↩︎/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export function annotationParts(value) {
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

export function extractAnnotations(lesson) {
  const seen = new Set();
  const items = [];
  for (const post of lesson.posts || []) {
    const cooked = String(post.cooked || "");
    const matches = cooked.matchAll(/<li id="(footnote-[\w-]+)" class="footnote-item">(.*?)<\/li>/gs);
    for (const match of matches) {
      const parsed = annotationParts(match[2]);
      if (!parsed.word || !/^[\p{Script=Han}·]{1,10}$/u.test(parsed.word)) continue;
      if (seen.has(parsed.word)) continue;
      seen.add(parsed.word);
      items.push({ word: parsed.word, note: parsed.note });
    }
  }
  return items;
}

export function primaryText(lesson) {
  const posts = (lesson.posts || []).filter((post) => String(post.plain_text || "").trim().length > 20);
  const primary = posts.find((post) => (post.plain_text || "").length > 350 && !/^https?:\/\//.test((post.plain_text || "").trim())) || posts[0];
  const extras = posts
    .filter((post) => post !== primary && (post.plain_text || "").length > 180 && !(post.attachments || []).length)
    .slice(0, 4);
  const chunks = [primary, ...extras].filter(Boolean).map((post) => String(post.plain_text || "")
    .replace(/\[\d{1,3}\]/g, "") // 剝掉行內註釋標號 [1]，讓引句與學生所見正文一致
    .replace(/\s+/g, " ")
    .trim());
  return chunks.join("\n\n").slice(0, 16000);
}

export const QUESTION_TYPES = new Set([
  "contextual-choice",   // 語境義選擇
  "gu-jin",              // 古今異義比較
  "substitution",        // 換詞/替換判斷
  "discrimination",      // 近義/易混辨析
  "usage",               // 虛詞或特殊用法
  "pronunciation",       // 讀音
  "interpretation",      // 句意理解
  "evidence",            // 原文定位/文本證據
]);

export function lessonVersion(items) {
  return `vocab-v1-${items.length}`;
}

export function bankPath(lessonId) {
  return path.join(VOCAB_DIR, `${lessonId}.json`);
}

export function listBankFiles() {
  try {
    return readdirSync(VOCAB_DIR).filter((name) => /^lesson-.*\.json$/.test(name));
  } catch {
    return [];
  }
}
