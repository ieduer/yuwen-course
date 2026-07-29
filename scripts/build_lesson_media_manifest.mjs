import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const root = path.resolve(import.meta.dirname, "..");
const catalogPath = path.join(root, "notebooklm", "selected-compulsory", "catalog.json");
const outputPath = path.join(root, "site", "data", "lesson-media.json");

const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));

function publicAsset(file) {
  if (!file) return null;
  const normalized = file.replaceAll("\\", "/");
  const marker = "/site/";
  const index = normalized.indexOf(marker);
  return index >= 0 ? normalized.slice(index + marker.length) : normalized.replace(/^site\//, "");
}

function fileSha256(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function immutablePublicAsset(file, sha256) {
  const relative = publicAsset(file);
  const expectedSha256 = String(sha256 || "").toLowerCase();
  if (!relative || !/^[a-f0-9]{64}$/.test(expectedSha256)) {
    throw new Error(`approved slide deck is missing a SHA-256 receipt: ${file}`);
  }
  const source = path.isAbsolute(file) ? file : path.resolve(root, file);
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
    throw new Error(`approved slide deck source is missing: ${file}`);
  }
  if (fileSha256(source) !== expectedSha256) {
    throw new Error(`approved slide deck source hash mismatch: ${file}`);
  }
  const extension = path.extname(relative) || ".pdf";
  const immutableRelative = path.posix.join(
    path.posix.dirname(relative),
    `sha256-${expectedSha256}${extension}`,
  );
  const destination = path.join(root, "site", immutableRelative);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (!fs.existsSync(destination)) fs.copyFileSync(source, destination);
  if (!fs.statSync(destination).isFile() || fileSha256(destination) !== expectedSha256) {
    throw new Error(`immutable slide deck hash mismatch: ${immutableRelative}`);
  }
  return immutableRelative;
}

const lessons = catalog.lessons.map((lesson) => {
  const recordPath = path.join(root, "notebooklm", "selected-compulsory", lesson.lessonId, "resource-record.json");
  const record = fs.existsSync(recordPath) ? JSON.parse(fs.readFileSync(recordPath, "utf8")) : null;
  const slide = record?.slideDeck || {};
  return {
    lessonId: lesson.lessonId,
    title: lesson.title,
    blockTitle: lesson.blockTitle,
    pilot: lesson.pilot,
    sourceVersion: record?.notebook?.sourcePackageVersion
      || lesson.sourceVersion?.package
      || catalog.sourcePackageVersion,
    promptVersions: {
      slideDeck: slide.promptVersion || "yw-slide-v1",
    },
    generatedAt: slide.generatedAt || null,
    reviewStatus: {
      slideDeck: slide.reviewStatus || (record ? "not-generated" : "cataloged"),
    },
    slideDeck: slide.file ? {
      title: `${lesson.title}｜课堂演示`,
      href: immutablePublicAsset(slide.file, slide.sha256),
      sha256: slide.sha256 || null,
    } : null,
  };
});

fs.writeFileSync(outputPath, `${JSON.stringify({
  schemaVersion: "yw-lesson-media-v2",
  generatedAt: new Date().toISOString(),
  sourceCatalog: "选择性必修上、中、下 75 篇课文",
  lessons,
}, null, 2)}\n`);

console.log(JSON.stringify({ output: path.relative(root, outputPath), lessons: lessons.length, ready: lessons.filter((lesson) => lesson.slideDeck).length }));
