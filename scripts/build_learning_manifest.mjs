#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST_PATH = resolve(ROOT, "site/data/manifest.json");
const TAXONOMY_PATH = resolve(ROOT, "site/data/literary-taxonomy.json");
const VOCAB_DIR = resolve(ROOT, "site/data/vocab");
const OUTPUT_PATH = resolve(ROOT, "site/data/learning-manifest.json");

export const SITE_KEY = "yw";
export const BOOK_IDS = Object.freeze(["xuanbi-shang", "xuanbi-zhong", "xuanbi-xia"]);
export const EXCLUDED_LESSONS = Object.freeze({
  "lesson-11637": "retired_google_sites_mirror",
  "lesson-11705": "teacher_course_progress_record",
});

const STANDARD_MODES = new Set([
  "classical", "poetry", "fiction", "drama", "journalism", "argument", "science",
]);

const INTERACTIONS_BY_MODE = Object.freeze({
  standard: ["contextWords", "revision", "structure", "evaluation", "authorQuestion"],
  "unit-intro": ["contextWords", "structure", "evaluation", "authorQuestion"],
  "unit-task": ["contextWords", "revision", "structure", "evaluation", "authorQuestion"],
});

const INTERACTION_LABELS = Object.freeze({
  contextWords: "初讀評議",
  revision: "字句之改",
  structure: "結構回應",
  evaluation: "篇目評價",
  authorQuestion: "叩問作者",
  wordCreation: "新詞活用",
});

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function cleanTitle(value) {
  return String(value || "未命名課文")
    .replace(/^\s*\d+\s*[.．、]?\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function appMode(sourceMode) {
  if (["whole-book", "language-activity", "review"].includes(sourceMode)) return "unit-task";
  if (["speech-letter", "modern-prose"].includes(sourceMode)) return "argument";
  return STANDARD_MODES.has(sourceMode) || sourceMode === "unit-intro" || sourceMode === "unit-task"
    ? sourceMode
    : "argument";
}

export function interactionResourceKey(lessonId, interaction) {
  return `effect:${lessonId}:interaction:${interaction}`;
}

export function vocabResourceKey(lessonId, questionId) {
  return `effect:${lessonId}:vocab:${questionId}`;
}

function interactionItem(lesson, mode, interaction) {
  return {
    resourceKey: interactionResourceKey(lesson.id, interaction),
    itemTitle: `${cleanTitle(lesson.title)} · ${INTERACTION_LABELS[interaction]}`,
    itemGroup: lesson.blockTitle,
    itemType: "effect-question",
    sourceKind: "lesson-interaction",
    sourceId: lesson.id,
    sourcePath: lesson.dataUrl,
    questionKind: interaction,
    mode,
  };
}

function vocabItems(lesson) {
  const relativePath = `site/data/vocab/${lesson.id}.json`;
  const sourcePath = resolve(ROOT, relativePath);
  if (!existsSync(sourcePath)) return [];
  const bank = JSON.parse(readFileSync(sourcePath, "utf8"));
  return (Array.isArray(bank.inventory) ? bank.inventory : [])
    .filter((item) => item?.decision === "question")
    .map((item, index) => ({
      resourceKey: vocabResourceKey(lesson.id, String(item.id || "")),
      itemTitle: `${cleanTitle(lesson.title)} · 字詞題 ${index + 1}`,
      itemGroup: lesson.blockTitle,
      itemType: "effect-question",
      sourceKind: "vocabulary-question",
      sourceId: lesson.id,
      sourcePath: relativePath.replace(/^site\//, ""),
      questionKind: "vocabulary",
      questionId: String(item.id || ""),
      questionType: String(item.type || ""),
      questionIndex: index + 1,
    }));
}

function officialLessons(manifest) {
  const selected = manifest.lessons.filter((lesson) => BOOK_IDS.includes(lesson.blockId));
  for (const lessonId of Object.keys(EXCLUDED_LESSONS)) {
    if (!selected.some((lesson) => lesson.id === lessonId)) {
      throw new Error(`declared exclusion is absent from selected books: ${lessonId}`);
    }
  }
  const lessons = selected.filter((lesson) => !EXCLUDED_LESSONS[lesson.id]);
  for (const lesson of lessons) {
    const officialPage = Number(lesson.textbookStartPage || 0) > 0;
    const officialBackMatter = /后\s*记|後\s*記/.test(lesson.title || "");
    if (!officialPage && !officialBackMatter) {
      throw new Error(`selected lesson lacks exact textbook TOC evidence: ${lesson.id}`);
    }
  }
  return lessons;
}

export function buildLearningManifest() {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  const taxonomy = JSON.parse(readFileSync(TAXONOMY_PATH, "utf8"));
  const taxonomyById = new Map(taxonomy.lessons.map((lesson) => [lesson.id, lesson]));
  const lessons = officialLessons(manifest);
  const items = [];

  for (const lesson of lessons) {
    const taxonomyLesson = taxonomyById.get(lesson.id);
    if (!taxonomyLesson) throw new Error(`taxonomy missing selected lesson: ${lesson.id}`);
    const mode = appMode(taxonomyLesson.mode);
    const interactionGroup = mode === "unit-intro" || mode === "unit-task" ? mode : "standard";
    for (const interaction of INTERACTIONS_BY_MODE[interactionGroup]) {
      items.push(interactionItem(lesson, mode, interaction));
    }
    if (STANDARD_MODES.has(mode)) {
      items.push(...vocabItems(lesson));
      if (mode !== "classical") items.push(interactionItem(lesson, mode, "wordCreation"));
    }
  }

  const keys = items.map((item) => item.resourceKey);
  const uniqueKeys = [...new Set(keys)];
  if (uniqueKeys.length !== keys.length) throw new Error("duplicate learning resource keys");
  if (items.some((item) => !item.resourceKey || !item.sourceId || !item.questionKind)) {
    throw new Error("manifest contains incomplete evidence identity");
  }

  const keyHash = sha256([...keys].sort().join("\n"));
  const sources = BOOK_IDS.map((blockId) => {
    const block = manifest.blocks.find((entry) => entry.id === blockId);
    const lessonIds = new Set(lessons.filter((lesson) => lesson.blockId === blockId).map((lesson) => lesson.id));
    return {
      sourceKind: "textbook",
      blockId,
      title: block?.title || blockId,
      path: "/data/manifest.json",
      lessonCount: lessonIds.size,
      itemCount: items.filter((item) => lessonIds.has(item.sourceId)).length,
    };
  });

  return {
    schemaVersion: 1,
    siteKey: SITE_KEY,
    title: "語文課 · 選擇性必修見效題目",
    manifestVersion: `${SITE_KEY}-${keyHash.slice(0, 16)}`,
    resourceKeyHash: `sha256:${keyHash}`,
    itemCount: items.length,
    completionKind: "answer_submitted",
    thresholdPercent: 90,
    lessonCount: lessons.length,
    sources,
    exclusions: Object.entries(EXCLUDED_LESSONS).map(([lessonId, reason]) => ({ lessonId, reason })),
    items,
  };
}

export function renderLearningManifest() {
  return `${JSON.stringify(buildLearningManifest(), null, 2)}\n`;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const rendered = renderLearningManifest();
  if (process.argv.includes("--check")) {
    if (!existsSync(OUTPUT_PATH) || readFileSync(OUTPUT_PATH, "utf8") !== rendered) {
      throw new Error("site/data/learning-manifest.json is stale; run npm run build:learning-manifest");
    }
    process.stdout.write("learning manifest is current\n");
  } else {
    writeFileSync(OUTPUT_PATH, rendered, "utf8");
    const manifest = JSON.parse(rendered);
    process.stdout.write(`generated ${manifest.itemCount} resources as ${manifest.manifestVersion}\n`);
  }
}
