#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadLesson } from "./vocab_lib.mjs";
import {
  PILOT_LESSON_IDS,
  PILOT_SHARED_LEARNING_GUIDANCE,
} from "./notebooklm_config.mjs";

const ROOT = new URL("../notebooklm/selected-compulsory/", import.meta.url).pathname;
const UNIT_SOURCES = {
  "lesson-1458": ["lesson-1460", "lesson-1472"],
  "lesson-1493": ["lesson-1487", "lesson-1495"],
  "lesson-1526": ["lesson-1525", "lesson-1532"],
  "lesson-1534": ["lesson-1533", "lesson-1538"],
  "lesson-1559": ["lesson-1554", "lesson-1563"],
};

function pageUrls(lesson) {
  return (lesson.textbook?.pageImages || []).map((page) => page.src).filter(Boolean);
}

function download(url, file) {
  execFileSync("curl", ["-fLsS", url, "-o", file], { stdio: "pipe" });
}

function buildPdf(urls, output, tempRoot) {
  if (!urls.length) throw new Error(`no pages for ${output}`);
  mkdirSync(tempRoot, { recursive: true });
  const files = urls.map((url, index) => {
    const file = path.join(tempRoot, `${String(index + 1).padStart(3, "0")}.webp`);
    download(url, file);
    return file;
  });
  mkdirSync(path.dirname(output), { recursive: true });
  execFileSync("img2pdf", [...files, "-o", output], { stdio: "pipe" });
}

for (const lessonId of PILOT_LESSON_IDS) {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), `yw-nlm-${lessonId}-`));
  try {
    const lesson = loadLesson(lessonId);
    const sharedPages = PILOT_SHARED_LEARNING_GUIDANCE[lessonId]?.sourcePages || [];
    const lessonPages = [...new Set([...pageUrls(lesson), ...sharedPages])];
    const unitPages = [...new Set((UNIT_SOURCES[lessonId] || []).flatMap((id) => pageUrls(loadLesson(id))))];
    const sourceDir = path.join(ROOT, lessonId, "sources");
    buildPdf(lessonPages, path.join(sourceDir, "05-textbook-facsimile.pdf"), path.join(tempRoot, "lesson"));
    buildPdf(unitPages, path.join(sourceDir, "06-unit-facsimile.pdf"), path.join(tempRoot, "unit"));
    process.stdout.write(`${lessonId}: lesson=${lessonPages.length} unit=${unitPages.length}\n`);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}
