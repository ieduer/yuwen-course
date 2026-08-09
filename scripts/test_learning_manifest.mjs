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
const INTERACTION_REGISTRY = resolve(ROOT, "site/data/interaction-definitions.json");
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
  assert.equal(manifest.itemCount, 869);
  assert.equal(manifest.manifestVersion, "yw-e310d45b1d81e9ad");
  assert.equal(manifest.resourceKeyHash, "sha256:e310d45b1d81e9adf6182bd50ea02842daf69a8981aa29ff03b2da30b0846aca");
  assert.deepEqual(manifest.vocabEligibility, {
    policyVersion: "yw-vocab-eligibility-20260730-v1",
    defaultEligibleModes: ["classical", "poetry"],
    exceptionCount: 0,
  });
  assert.deepEqual(manifest.sources.map((source) => source.blockId), BOOK_IDS);
  assert.deepEqual(manifest.sources.map((source) => source.lessonCount), [28, 36, 37]);
  assert.deepEqual(manifest.exclusions.map((entry) => entry.lessonId).sort(), Object.keys(EXCLUDED_LESSONS).sort());
  assert.equal(manifest.items.some((item) => EXCLUDED_LESSONS[item.sourceId]), false);
});

test("vocabulary stays classical-or-poetry and word creation stays poetry-only", () => {
  const manifest = buildLearningManifest();
  const taxonomy = JSON.parse(readFileSync(resolve(ROOT, "site/data/literary-taxonomy.json"), "utf8"));
  const modeByLesson = new Map(taxonomy.lessons.map((lesson) => [lesson.id, lesson.mode]));
  const vocabulary = manifest.items.filter((item) => item.questionKind === "vocabulary");
  const wordCreation = manifest.items.filter((item) => item.questionKind === "wordCreation");
  assert.equal(vocabulary.length, 382);
  assert.equal(wordCreation.length, 25);
  assert.equal(
    vocabulary.every((item) => ["classical", "poetry"].includes(modeByLesson.get(item.sourceId))),
    true,
  );
  assert.equal(
    wordCreation.every((item) => modeByLesson.get(item.sourceId) === "poetry"),
    true,
  );
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
  assert.equal(keys.includes(interactionResourceKey("lesson-1534", "contextWords")), false);
  assert.equal(keys.includes(interactionResourceKey("lesson-1534", "revision")), false);
  assert.equal(keys.includes(interactionResourceKey("lesson-1534", "structure")), true);
  assert.equal(keys.includes(vocabResourceKey("lesson-1474", "lesson-1474:v01")), true);
  assert.equal(keys.some((key) => key.includes(":interaction:read")), false);
  assert.equal(keys.some((key) => key.includes(":interaction:vocabulary")), false);
  assert.equal(manifest.items.every((item) => item.sourceId && item.sourcePath && item.questionKind), true);
});

test("vocabulary correctness is source-verified and cannot be claimed by the browser bridge", () => {
  const registry = JSON.parse(readFileSync(INTERACTION_REGISTRY, "utf8"));
  const vocabulary = registry.definitions.vocabAnswer;
  const browserBridge = readFileSync(EVIDENCE_MODULE, "utf8");
  assert.equal(vocabulary.assessmentKind, "performance");
  assert.equal(vocabulary.scoringRole, "a_plus_gate");
  assert.equal(vocabulary.verificationMethod, "source_answer_key");
  assert.deepEqual(vocabulary.allowedPayloadKeys, ["itemId", "selectedIndex"]);
  assert.equal(browserBridge.includes("scorePercent"), false);
  assert.equal(browserBridge.includes("correctness"), false);
  assert.equal(browserBridge.includes("syncProgress"), false);
  assert.equal(browserBridge.includes("recordEvent"), false);
});

test("lesson evaluation remains a recorded self-report and never a scoring or A+ event", () => {
  const registry = JSON.parse(readFileSync(INTERACTION_REGISTRY, "utf8"));
  const evaluation = registry.definitions.evaluation;
  assert.equal(evaluation.assessmentKind, "self_report");
  assert.equal(evaluation.scoringRole, "none");
  assert.equal(evaluation.verificationMethod, "source_form_submission");
  assert.deepEqual(evaluation.allowedPayloadKeys, ["rating", "reason"]);
});

test("anonymous activity is rejected by the source endpoint without a User Center write", async () => {
  delete globalThis.YwLearningEvidence;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return { ok: false, status: 401, json: async () => ({ error: "authentication required" }) };
  };
  await import(`${EVIDENCE_MODULE}?anonymous=${Date.now()}`);
  const result = await globalThis.YwLearningEvidence.record(
    "contextWords",
    "lesson-1458",
    { words: "风雪" },
    { clientMutationId: "test-anonymous-1" },
  );
  assert.deepEqual(result, { ok: false, reason: "anonymous" });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "/api/learning/interactions");
  assert.equal(requests[0].options.credentials, "include");
  assert.equal(globalThis.BdfzIdentity, undefined);
  delete globalThis.fetch;
});

test("authenticated browser bridge submits semantic source events without score or identity claims", async () => {
  delete globalThis.YwLearningEvidence;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, eventId: "source-event-1", delivery: "queued" }),
    };
  };
  await import(`${EVIDENCE_MODULE}?authenticated=${Date.now()}`);
  const result = await globalThis.YwLearningEvidence.record(
    "noteOpened",
    "lesson-1458",
    { noteRef: "note-1" },
    {
      clientMutationId: "test-authenticated-1",
      classSessionId: "class-session-1",
      lessonPhase: "close-reading",
    },
  );
  const body = JSON.parse(requests[0].options.body);
  assert.equal(result.ok, true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "/api/learning/interactions");
  assert.equal(requests[0].options.method, "POST");
  assert.deepEqual(body, {
    lessonId: "lesson-1458",
    interactionKey: "noteOpened",
    clientMutationId: "test-authenticated-1",
    classSessionId: "class-session-1",
    lessonPhase: "close-reading",
    data: { noteRef: "note-1" },
  });
  assert.equal("score" in body, false);
  assert.equal("correctness" in body, false);
  assert.equal("userId" in body, false);
  assert.equal("sourceVersion" in body, false);
  assert.equal(globalThis.BdfzIdentity, undefined);
  delete globalThis.fetch;
});
