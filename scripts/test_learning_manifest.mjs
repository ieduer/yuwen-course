#!/usr/bin/env node

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { resolve } from "node:path";
import {
  BOOK_IDS,
  EXCLUDED_LESSONS,
  buildLearningManifest,
  interactionResourceKey,
  renderLearningManifest,
  vocabResourceKey,
} from "./build_learning_manifest.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const OUTPUT = resolve(ROOT, "site/data/learning-manifest.json");
const EVIDENCE_MODULE = resolve(ROOT, "site/assets/learning-evidence.js");
const REMOVED_LESSONS = ["lesson-2177", "lesson-9140", "lesson-10653"];
const REMOVED_TOPIC_IDS = new Set([2177, 9140, 10653]);

test("manifest is deterministic and byte-current", () => {
  const first = renderLearningManifest();
  const second = renderLearningManifest();
  assert.equal(first, second);
  assert.equal(readFileSync(OUTPUT, "utf8"), first);
});

test("manifest contains only the three exact textbook books", () => {
  const manifest = buildLearningManifest();
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.siteKey, "yw");
  assert.equal(manifest.completionKind, "answer_submitted");
  assert.equal(manifest.thresholdPercent, 90);
  assert.equal(manifest.lessonCount, 101);
  assert.equal(manifest.itemCount, 1156);
  assert.equal(manifest.manifestVersion, "yw-b530d57cb873ed49");
  assert.equal(manifest.resourceKeyHash, "sha256:b530d57cb873ed49340bcc606ec8a70fd9970a59d911fd1001d63ce85a86c2ba");
  assert.deepEqual(manifest.sources.map((source) => source.blockId), BOOK_IDS);
  assert.deepEqual(manifest.sources.map((source) => source.lessonCount), [28, 36, 37]);
  assert.deepEqual(manifest.exclusions.map((entry) => entry.lessonId).sort(), Object.keys(EXCLUDED_LESSONS).sort());
  assert.equal(manifest.items.some((item) => EXCLUDED_LESSONS[item.sourceId]), false);
});

test("removed lessons are absent from source data and every shipped index", () => {
  const contentManifest = JSON.parse(readFileSync(resolve(ROOT, "site/data/manifest.json"), "utf8"));
  const taxonomy = JSON.parse(readFileSync(resolve(ROOT, "site/data/literary-taxonomy.json"), "utf8"));
  const learningManifest = JSON.parse(readFileSync(OUTPUT, "utf8"));
  const vocabIndex = JSON.parse(readFileSync(resolve(ROOT, "site/data/vocab/index.json"), "utf8"));
  const pageCacheIndex = readFileSync(resolve(ROOT, "site/data/cache/index.json"), "utf8");
  const sourceExports = [
    resolve(ROOT, ".cache/discourse-course-export.json"),
    resolve(ROOT, ".cache/discourse-course-export.live.json"),
  ].map((path) => JSON.parse(readFileSync(path, "utf8")));

  for (const lessonId of REMOVED_LESSONS) {
    assert.equal(contentManifest.lessons.some((lesson) => lesson.id === lessonId), false);
    assert.equal(contentManifest.blocks.some((block) => block.lessons.some((lesson) => lesson.id === lessonId)), false);
    assert.equal(taxonomy.lessons.some((lesson) => lesson.id === lessonId), false);
    assert.equal(learningManifest.items.some((item) => item.sourceId === lessonId || item.sourcePath.includes(lessonId)), false);
    assert.equal(learningManifest.exclusions.some((item) => item.lessonId === lessonId), false);
    assert.equal(Object.hasOwn(vocabIndex.lessons, lessonId), false);
    assert.equal(pageCacheIndex.includes(lessonId), false);
    assert.equal(existsSync(resolve(ROOT, `site/data/lessons/${lessonId}.json`)), false);
  }
  for (const source of sourceExports) {
    assert.equal(source.topics.some((topic) => REMOVED_TOPIC_IDS.has(Number(topic.id))), false);
  }
});

test("every key is unique and traceable to an answer-bearing effect control", () => {
  const manifest = buildLearningManifest();
  const keys = manifest.items.map((item) => item.resourceKey);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(manifest.itemCount, keys.length);
  assert.equal(keys.includes(interactionResourceKey("lesson-1458", "contextWords")), true);
  assert.equal(keys.includes(interactionResourceKey("lesson-1458", "evaluation")), true);
  assert.equal(keys.includes(vocabResourceKey("lesson-1458", "lesson-1458:v01")), true);
  assert.equal(keys.some((key) => key.includes(":interaction:read")), false);
  assert.equal(keys.some((key) => key.includes(":interaction:vocabulary")), false);
  assert.equal(manifest.items.every((item) => item.sourceId && item.sourcePath && item.questionKind), true);
});

test("submitted wrong answers remain completed while correctness stays explicit", async () => {
  delete globalThis.YwLearningEvidence;
  await import(`${EVIDENCE_MODULE}?test=${Date.now()}`);
  const manifest = buildLearningManifest();
  const item = manifest.items.find((entry) => entry.questionKind === "vocabulary");
  const payloads = globalThis.YwLearningEvidence.buildEvidencePayloads(manifest, item, {
    scorePercent: 0,
    correctness: "incorrect",
    attemptCount: 1,
  });
  assert.equal(payloads.progress.state, "completed");
  assert.equal(payloads.progress.progressPercent, 100);
  assert.equal(payloads.progress.score, 0);
  assert.equal(payloads.progress.meta.correctness, "incorrect");
  assert.equal(payloads.progress.meta.completionKind, "answer_submitted");
  assert.equal(JSON.stringify(payloads).includes("answerText"), false);
});

test("anonymous activity cannot fetch the manifest or write evidence", async () => {
  delete globalThis.YwLearningEvidence;
  let fetched = false;
  let writes = 0;
  globalThis.fetch = async () => {
    fetched = true;
    throw new Error("anonymous code must not fetch");
  };
  globalThis.BdfzIdentity = {
    getSession: async () => ({ authenticated: false }),
    syncProgress: async () => { writes += 1; },
    recordEvent: async () => { writes += 1; },
  };
  await import(`${EVIDENCE_MODULE}?anonymous=${Date.now()}`);
  const result = await globalThis.YwLearningEvidence.complete("effect:lesson-1458:interaction:contextWords");
  assert.deepEqual(result, { ok: false, reason: "anonymous" });
  assert.equal(fetched, false);
  assert.equal(writes, 0);
  delete globalThis.fetch;
  delete globalThis.BdfzIdentity;
});

test("authenticated submitted answers write stable progress and drill-down events", async () => {
  delete globalThis.YwLearningEvidence;
  const manifest = buildLearningManifest();
  const item = manifest.items.find((entry) => entry.questionKind === "vocabulary");
  const progressWrites = [];
  const eventWrites = [];
  globalThis.fetch = async () => ({ ok: true, json: async () => manifest });
  globalThis.BdfzIdentity = {
    getSession: async () => ({ authenticated: true }),
    syncProgress: async (payload) => { progressWrites.push(payload); },
    recordEvent: async (payload) => { eventWrites.push(payload); },
  };
  await import(`${EVIDENCE_MODULE}?authenticated=${Date.now()}`);
  const result = await globalThis.YwLearningEvidence.complete(item.resourceKey, {
    scorePercent: 0,
    correctness: "incorrect",
    attemptCount: 1,
  });
  assert.equal(result.ok, true);
  assert.equal(result.manifestVersion, manifest.manifestVersion);
  assert.equal(progressWrites.length, 1);
  assert.equal(eventWrites.length, 1);
  assert.equal(progressWrites[0].itemKey, item.resourceKey);
  assert.equal(progressWrites[0].state, "completed");
  assert.equal(progressWrites[0].score, 0);
  assert.equal(progressWrites[0].meta.correctness, "incorrect");
  assert.equal(eventWrites[0].contentFormat, "yw-effect-question-completion-v1");
  assert.equal(eventWrites[0].payload.resourceKey, item.resourceKey);
  delete globalThis.fetch;
  delete globalThis.BdfzIdentity;
});
