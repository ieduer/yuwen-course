import { readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SITE = path.join(ROOT, "site");
const manifest = JSON.parse(await readFile(path.join(SITE, "data/manifest.json"), "utf8"));
const taxonomy = JSON.parse(await readFile(path.join(SITE, "data/literary-taxonomy.json"), "utf8"));
const metaById = new Map(manifest.blocks.flatMap((block) => block.lessons).map((lesson) => [lesson.id, lesson]));
const lessonIds = new Set(taxonomy.lessons.map((lesson) => lesson.id));
const failures = [];
const learningModes = new Set(["unit-intro", "unit-task", "whole-book", "language-activity", "review"]);
const compact = (value) => String(value || "").replace(/\[\d+(?::\d+)*\]/g, "").replace(/并序/g, "").replace(/[^\p{L}\p{N}]/gu, "");

function headingEvidence(meta, body, name) {
  const title = compact(meta.title).replace(/^\d+/, "");
  const text = compact(body);
  const author = compact(name);
  let position = text.indexOf(author);
  while (position >= 0) {
    const before = text.slice(Math.max(0, position - 28), position);
    for (let length = Math.min(18, before.length); length >= 2; length -= 1) {
      if (title.includes(before.slice(-length))) return true;
    }
    position = text.indexOf(author, position + author.length);
  }
  return false;
}

for (const lesson of taxonomy.lessons) {
  const meta = metaById.get(lesson.id);
  if (!meta) { failures.push(`${lesson.id}: manifest 缺失`); continue; }
  if (learningModes.has(lesson.mode) && lesson.authors.length) failures.push(`${lesson.id}: 學習活動不應推測作者`);
  const names = lesson.authors.map((author) => author.name);
  if (new Set(names).size !== names.length) failures.push(`${lesson.id}: 作者重複`);
  if (lesson.visual) failures.push(`${lesson.id}: 不應再使用書封或教材頁視覺`);
  if (!lesson.authors.length) {
    const representative = lesson.representativeFigure;
    if (!representative?.id || !representative?.name || !representative?.url || !representative?.role || !representative?.reason) failures.push(`${lesson.id}: 無署名篇目缺代表人物契約`);
    if (!Array.isArray(representative?.evidenceLessonIds) || !representative.evidenceLessonIds.length || representative.evidenceLessonIds.some((id) => !lessonIds.has(id))) failures.push(`${lesson.id}: 代表人物證據篇目無效`);
    if (!representative?.portraitKind) failures.push(`${lesson.id}: 代表人物缺肖像來源類型`);
    if (representative?.id && !representative.url.endsWith(`#${representative.id}`)) failures.push(`${lesson.id}: 代表人物群賢鏈接錯誤`);
  } else if (lesson.representativeFigure) {
    failures.push(`${lesson.id}: 作者與代表人物不可混用`);
  }
  const source = JSON.parse(await readFile(path.join(SITE, meta.dataUrl), "utf8"));
  const body = (source.posts || []).map((post) => post.plain_text || "").join("\n");
  for (const author of lesson.authors) {
    if (author.evidence === "toc" && !compact(meta.tocLabel || meta.title).includes(compact(author.name))) failures.push(`${lesson.id}: ${author.name} 無目錄題署`);
    if (author.evidence === "heading" && !headingEvidence(meta, body, author.name)) failures.push(`${lesson.id}: ${author.name} 無篇名題署`);
    if (!["toc", "heading"].includes(author.evidence)) failures.push(`${lesson.id}: ${author.name} 證據類型錯誤`);
    if (!author.portraitKind) failures.push(`${lesson.id}: ${author.name} 缺肖像來源類型`);
  }
}

const representativeLessons = taxonomy.lessons.filter((lesson) => !lesson.authors.length && lesson.representativeFigure);
for (const person of [...taxonomy.lessons.flatMap((lesson) => [...lesson.authors, ...(lesson.representativeFigure ? [lesson.representativeFigure] : [])])]) {
  if (!person.id || !person.url) continue;
  try {
    await readFile(`/Users/ylsuen/CF/qunxian/public/img/figures/${person.id}.webp`);
  } catch {
    failures.push(`${person.id}: 群賢肖像資產缺失`);
  }
}
if (representativeLessons.length !== 65) failures.push(`代表人物覆蓋 ${representativeLessons.length} != 65`);

const exact = (id, expected) => {
  const actual = taxonomy.lessons.find((lesson) => lesson.id === id)?.authors.map((author) => author.name) || [];
  if (JSON.stringify(actual) !== JSON.stringify(expected)) failures.push(`${id}: ${actual.join("、")} != ${expected.join("、")}`);
};
exact("lesson-1697", ["沈英甲"]);
exact("lesson-1498", ["张若虚"]);

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`author audit: ${taxonomy.lessons.length} lessons, ${taxonomy.authors.length} authors, ${representativeLessons.length} representative lessons, 0 unsupported attributions`);
