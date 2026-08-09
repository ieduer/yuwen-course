import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildClassicalFirstReadArtifacts,
  checkClassicalFirstReadArtifacts,
  extractCanonicalParagraphs,
  isUnpunctuatedText,
} from "./build_classical_first_read.mjs";
import { loadClassicalFirstRead } from "../site/classical-first-read-source.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const taxonomy = JSON.parse(readFileSync(resolve(ROOT, "site/data/literary-taxonomy.json"), "utf8"));
const policy = JSON.parse(readFileSync(resolve(ROOT, "scripts/classical_first_read_policy.v1.json"), "utf8"));
const expectedIds = taxonomy.lessons.filter((lesson) => lesson.mode === "classical").map((lesson) => lesson.id);
const artifacts = buildClassicalFirstReadArtifacts();

assert.equal(artifacts.lessons.length, 30);
assert.deepEqual(artifacts.lessons.map((lesson) => lesson.lessonId), expectedIds);
assert.equal(artifacts.index.lessonCount, 30);

const paragraphKeys = new Set();
for (const lesson of artifacts.lessons) {
  assert.equal(lesson.schema, "yw-classical-first-read-v1");
  assert.equal(lesson.schemaVersion, 1);
  assert.ok(lesson.text.length > 0, `${lesson.lessonId} text is empty`);
  assert.ok(isUnpunctuatedText(lesson.text), `${lesson.lessonId} text retains punctuation or whitespace`);
  assert.ok(lesson.paragraphs.length > 0, `${lesson.lessonId} paragraphs are empty`);
  assert.equal(lesson.paragraphCount, lesson.paragraphs.length);
  assert.equal(lesson.charCount, Array.from(lesson.text).length);
  assert.match(lesson.textDigest, /^sha256:[a-f0-9]{64}$/);
  assert.match(lesson.textVersionId, new RegExp(`^cfr-${lesson.lessonId}-[a-f0-9]{16}$`));
  for (const paragraph of lesson.paragraphs) {
    assert.ok(isUnpunctuatedText(paragraph.text), `${paragraph.key} retains punctuation or whitespace`);
    assert.match(paragraph.key, new RegExp(`^cfrp:${lesson.lessonId}:[a-f0-9]{16}:\\d{2}$`));
    assert.equal(paragraphKeys.has(paragraph.key), false, `duplicate paragraph key ${paragraph.key}`);
    paragraphKeys.add(paragraph.key);
  }
}

const serverLoaded = await loadClassicalFirstRead(
  new Request("https://yw.bdfz.net/api/reading/first-read/state/lesson-1534"),
  {
    ASSETS: {
      async fetch(request) {
        const id = new URL(request.url).pathname.split("/").pop().replace(/\.json$/, "");
        const lesson = artifacts.lessons.find((entry) => entry.lessonId === id);
        return lesson ? Response.json(lesson) : new Response("not found", { status: 404 });
      },
    },
  },
  "lesson-1534",
);
assert.equal(serverLoaded.textVersionId, "cfr-lesson-1534-c332d4cede431f64");
const browserContractSource = readFileSync(resolve(ROOT, "site/assets/classical-first-read.js"), "utf8");
assert.match(browserContractSource, /asset\.schema\s*!==\s*"yw-classical-first-read-v1"/);
assert.match(browserContractSource, /Number\(asset\.schemaVersion\)\s*!==\s*1/);
assert.match(browserContractSource, /data-first-read-keyboard-form/);
assert.match(browserContractSource, /tabindex="0" data-first-read-paragraph/);
assert.match(browserContractSource, /session\.authMode\s*!==\s*"authenticated"/);
assert.doesNotMatch(browserContractSource, /localStorage\.setItem/);
assert.match(browserContractSource, /localStorage\.removeItem\(localKey\(asset\)\)/);

const quyuan = artifacts.lessons.find((lesson) => lesson.lessonId === "lesson-1534");
assert.deepEqual(quyuan.source.segments, [{ startBlock: 0, endBlock: 13 }]);
assert.deepEqual(quyuan.paragraphs.map((paragraph) => paragraph.sourceBlockIndex), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
assert.equal(quyuan.paragraphCount, 14);
assert.equal(quyuan.charCount, 1366);
assert.equal(quyuan.canonicalPunctuatedDigest, "sha256:39fff1653aef7e89c9b720a9af8c1aec4cb8676fc856ead61a674291d7da9f44");
assert.equal(quyuan.textDigest, "sha256:c332d4cede431f640196a6a75dc1edab906a044eecaebdc04c7b8620b81fe264");
assert.equal(quyuan.textVersionId, "cfr-lesson-1534-c332d4cede431f64");
assert.ok(quyuan.text.startsWith("屈原者名平楚之同姓也为楚怀王左徒"));
assert.ok(quyuan.text.endsWith("同死生轻去就又爽然自失矣"));
assert.equal(quyuan.text.includes("史家之绝唱"), false);

const tamperedQuyuanReader = JSON.parse(readFileSync(resolve(ROOT, "site/data/reader-documents/lesson-1534.json"), "utf8"));
tamperedQuyuanReader.main.blocks[0].runs[0].text += "改";
assert.throws(
  () => extractCanonicalParagraphs(
    tamperedQuyuanReader,
    policy.lessons.find((lesson) => lesson.lessonId === "lesson-1534"),
  ),
  /canonical punctuated digest mismatch/,
  "source text drift must fail before unpunctuated text is generated",
);

const suwu = artifacts.lessons.find((lesson) => lesson.lessonId === "lesson-1535");
assert.deepEqual(suwu.source.segments, [{ startBlock: 28, endBlock: 31 }]);
assert.deepEqual(suwu.paragraphs.map((paragraph) => paragraph.sourceBlockIndex), [28, 29, 30, 31]);
assert.equal(suwu.paragraphCount, 4);
assert.equal(suwu.charCount, 1468);
assert.equal(suwu.canonicalPunctuatedDigest, "sha256:d11c7763a7067f304a6f4edfaa7c9d22934b847ca954b8170e2725be8749830a");
assert.equal(suwu.textDigest, "sha256:a6d3d69153bd010066e85998fc751ceabf615a446ffd34c801927deb14eadfa3");
assert.equal(suwu.textVersionId, "cfr-lesson-1535-a6d3d69153bd0100");
assert.ok(suwu.text.startsWith("武字子卿少以父任兄弟并为郎"));
assert.ok(suwu.text.endsWith("武留匈奴凡十九岁始以强壮出及还须发尽白"));
for (const excluded of ["Summary", "李廣隴西成紀人也", "使动用法", "甘露三年單于始入朝"]) {
  assert.equal(suwu.text.includes(excluded), false, `苏武传 leaked excluded content: ${excluded}`);
}

const staleArtifacts = structuredClone(artifacts);
staleArtifacts.index.lessonCount = 29;
assert.throws(
  () => checkClassicalFirstReadArtifacts(staleArtifacts),
  /index\.json is stale/,
  "--check must reject a generated artifact that no longer matches the reviewed build",
);
checkClassicalFirstReadArtifacts(artifacts);
console.log(`classical first-read tests passed: ${artifacts.lessons.length} lessons, ${paragraphKeys.size} paragraphs`);
