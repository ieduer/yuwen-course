#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const POLICY_PATH = resolve(ROOT, "scripts/classical_learning_tip_policy.v1.json");
const CLASSICAL_POLICY_PATH = resolve(ROOT, "scripts/classical_first_read_policy.v1.json");
const OUTPUT_PATH = resolve(ROOT, "site/data/classical-learning-tips.json");

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const normalizedText = (value) => String(value || "")
  .replace(/\*\*/g, "")
  .replace(/\s+/g, " ")
  .trim();

function readerVisibleText(value) {
  if (Array.isArray(value)) return normalizedText(value.map(readerVisibleText).join(" "));
  if (!value || typeof value !== "object") return "";
  if (typeof value.text === "string") return normalizedText(value.text);
  if (Array.isArray(value.runs)) return readerVisibleText(value.runs);
  if (Array.isArray(value.blocks)) return readerVisibleText(value.blocks);
  if (Array.isArray(value.items)) return readerVisibleText(value.items);
  if (Array.isArray(value.rows)) return readerVisibleText(value.rows);
  return "";
}

function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function sourceParagraphs(source) {
  if (source.kind === "reader-blocks") {
    const document = loadJson(resolve(ROOT, `site/data/reader-documents/${source.lessonId}.json`));
    return source.blockIndexes.map((blockIndex) => {
      const block = document.main?.blocks?.[blockIndex];
      if (!block) throw new Error(`${source.sourceId}: missing reader block ${blockIndex}`);
      const text = readerVisibleText(block);
      if (text.length < 10) throw new Error(`${source.sourceId}: reader block ${blockIndex} is not a learning tip`);
      return text;
    });
  }
  if (source.kind === "lesson-post-slice") {
    const lesson = loadJson(resolve(ROOT, `site/data/lessons/${source.lessonId}.json`));
    const post = lesson.posts?.find((entry) => Number(entry.post_number) === Number(source.postNumber));
    if (!post) throw new Error(`${source.sourceId}: missing source post ${source.postNumber}`);
    const text = normalizedText(post.plain_text);
    const start = text.indexOf(source.start);
    const endStart = text.indexOf(source.end, start + source.start.length);
    if (start < 0 || endStart < 0) throw new Error(`${source.sourceId}: source slice drifted`);
    const paragraph = normalizedText(text.slice(start, endStart + source.end.length));
    if (paragraph.length < 80) throw new Error(`${source.sourceId}: source slice is too short`);
    return [paragraph];
  }
  throw new Error(`${source.sourceId}: unsupported source kind ${source.kind}`);
}

export function buildClassicalLearningTips() {
  const policyBytes = readFileSync(POLICY_PATH);
  const policy = JSON.parse(policyBytes);
  const classicalPolicy = loadJson(CLASSICAL_POLICY_PATH);
  if (policy.schemaVersion !== "yw-classical-learning-tip-policy-v1" || !Array.isArray(policy.sources)) {
    throw new Error("invalid classical learning-tip policy");
  }
  const expectedLessons = classicalPolicy.lessons.map((entry) => entry.lessonId).sort();
  const seen = new Set();
  const lessons = [];
  for (const source of policy.sources) {
    const paragraphs = sourceParagraphs(source);
    const sourceSha256 = sha256(JSON.stringify({
      sourceId: source.sourceId,
      kind: source.kind,
      lessonId: source.lessonId,
      postNumber: source.postNumber || null,
      blockIndexes: source.blockIndexes || null,
      paragraphs,
    }));
    for (const lessonId of source.targets || []) {
      if (seen.has(lessonId)) throw new Error(`duplicate learning tip target: ${lessonId}`);
      seen.add(lessonId);
      lessons.push({
        lessonId,
        sourceId: source.sourceId,
        sourceLessonId: source.lessonId,
        sourceKind: source.kind,
        sourceSha256,
        paragraphs,
      });
    }
  }
  const actualLessons = [...seen].sort();
  if (JSON.stringify(actualLessons) !== JSON.stringify(expectedLessons)) {
    throw new Error(`learning-tip coverage drifted: expected ${expectedLessons.length}, got ${actualLessons.length}`);
  }
  lessons.sort((left, right) => left.lessonId.localeCompare(right.lessonId));
  const contentDigest = `sha256:${sha256(JSON.stringify(lessons))}`;
  return {
    schemaVersion: "yw-classical-learning-tips-v1",
    policySha256: sha256(policyBytes),
    contentDigest,
    lessonCount: lessons.length,
    sourceCount: policy.sources.length,
    lessons,
  };
}

const output = `${JSON.stringify(buildClassicalLearningTips())}\n`;
if (process.argv.includes("--check")) {
  if (readFileSync(OUTPUT_PATH, "utf8") !== output) throw new Error("classical learning tips are stale");
  console.log("classical learning tips are current");
} else {
  writeFileSync(OUTPUT_PATH, output);
  console.log(`wrote ${OUTPUT_PATH}`);
}
