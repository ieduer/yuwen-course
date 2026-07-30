#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolve } from "node:path";

import {
  LearningSubmissionRateLimitError,
  learningEvidenceContract,
  recordLearningInteraction,
} from "../site/learning-evidence-source.js";
import {
  LEARNING_EVIDENCE_SOURCES,
  LearningEvidenceValidationError,
  validateLearningEvidenceEnvelope,
} from "../../bdfz-user-center/src/learning-evidence-sources.js";

const ROOT = resolve(import.meta.dirname, "..");
const QUEUE = "bdfz-learning-evidence-yw-v1";
const registry = JSON.parse(readFileSync(resolve(ROOT, "site/data/interaction-definitions.json"), "utf8"));
const manifest = JSON.parse(readFileSync(resolve(ROOT, "site/data/learning-manifest.json"), "utf8"));
const workerSource = readFileSync(resolve(ROOT, "site/_worker.js"), "utf8");
const lesson = {
  id: "lesson-1458",
  title: "中国人民站起来了",
  blockId: "selected-compulsory-1",
  blockTitle: "选择性必修上册",
};
const wordCreationLesson = {
  id: "lesson-1497",
  title: "无衣/《诗经·秦风》",
  blockId: "xuanbi-shang",
  blockTitle: "選必上",
};
const vocabLesson = {
  id: "lesson-1474",
  title: "5、《论语》十二章",
  blockId: "xuanbi-shang",
  blockTitle: "選必上",
};

function mockStatement(sql, writes, state) {
  return {
    sql,
    values: [],
    bind(...values) {
      this.values = values;
      return this;
    },
    async first() {
      if (sql.includes("WHERE i.student_id = ? AND i.client_mutation_id = ?")) {
        return state.existingInteraction;
      }
      if (sql.includes("COUNT(*) AS n, MIN(occurred_at) AS oldest_at")) {
        return {
          n: state.recentSubmissionCount,
          oldest_at: state.recentOldestAt,
        };
      }
      if (sql.includes("COALESCE(MAX(attempt_no)")) return { n: state.nextAttemptNo };
      return null;
    },
    async run() {
      writes.push({ sql, values: this.values });
      return { success: true };
    },
  };
}

function sourceEnvironment({
  recentSubmissionCount = 0,
  recentOldestAt = "2026-07-01T00:05:00.000Z",
  nextAttemptNo = 1,
  existingInteraction = null,
} = {}) {
  const writes = [];
  const queued = [];
  const state = {
    recentSubmissionCount,
    recentOldestAt,
    nextAttemptNo,
    existingInteraction,
  };
  return {
    writes,
    queued,
    env: {
      ASSETS: {
        async fetch(request) {
          const pathname = new URL(request.url).pathname;
          const value = pathname === "/data/interaction-definitions.json"
            ? registry
            : pathname === "/data/learning-manifest.json"
              ? manifest
              : null;
          return value
            ? Response.json(value)
            : new Response("not found", { status: 404 });
        },
      },
      READING_DB: {
        prepare(sql) {
          return mockStatement(sql, writes, state);
        },
        async batch(statements) {
          writes.push(...statements.map((statement) => ({
            sql: statement.sql,
            values: statement.values,
          })));
          return statements.map(() => ({ success: true }));
        },
      },
      LEARNING_EVIDENCE_QUEUE: {
        async send(envelope, options) {
          queued.push({ envelope, options });
        },
      },
    },
  };
}

function writeStartingWith(writes, sqlPrefix) {
  return writes.find((write) => write.sql.trimStart().startsWith(sqlPrefix));
}

function assertSynchronizedIneligibleAttempt(result, queued, writes) {
  assert.equal(result.eligibilityStatus, "ineligible");
  assert.equal(result.delivery, "enqueued_ineligible");
  assert.equal(queued.length, 1);
  assert.ok(writeStartingWith(writes, "INSERT INTO learning_interactions"));
  const evaluationWrite = writeStartingWith(writes, "INSERT INTO learning_evaluations");
  assert.equal(evaluationWrite?.values?.[2], "ineligible");
  assert.ok(writeStartingWith(writes, "INSERT INTO evidence_outbox"));
  assert.equal(
    validateLearningEvidenceEnvelope(queued[0].envelope, QUEUE).eligibilityStatus,
    "ineligible",
  );
}

test("YW exposes the named-entrypoint health receipt without browser evidence writes", () => {
  assert.match(workerSource, /\/api\/learning\/health/);
  assert.match(workerSource, /USER_CENTER_EVIDENCE\.getSourceReceipt/);
  assert.match(workerSource, /yuwen-queue-ledger-v1/);
  assert.match(workerSource, /receipt\?\.manifestVersion !== manifest\?\.manifestVersion/);
  assert.match(workerSource, /receipt\?\.manifestDigest !== manifest\?\.resourceKeyHash/);
  assert.match(workerSource, /receipt\?\.itemCount/);
  assert.match(workerSource, /getSourceReceipt\(descriptor\)/);
});

test("the Worker checks the per-user resource bound before AI work and vocabulary mutation", () => {
  const interactionHandler = workerSource.slice(
    workerSource.indexOf("async function handleInteractionCheck"),
    workerSource.indexOf("async function handleLearningCheck"),
  );
  assert.ok(
    interactionHandler.indexOf("assertLearningSubmissionAllowed") <
      interactionHandler.indexOf('callApisPrompt(env, prompt, "feedback"'),
  );

  const vocabHandler = workerSource.slice(
    workerSource.indexOf("async function handleReadingVocabAttempt"),
    workerSource.indexOf("async function handleReadingVocabState"),
  );
  assert.ok(
    vocabHandler.indexOf("assertLearningSubmissionAllowed") <
      vocabHandler.indexOf("INSERT INTO vocab_attempts"),
  );
  assert.match(workerSource, /status:\s*429/);
  assert.match(workerSource, /"retry-after"/);
});

test("YW evaluation self-report is enqueued as non-scoring and accepted by the current consumer contract", async () => {
  const { env, queued, writes } = sourceEnvironment();
  const result = await recordLearningInteraction({
    request: new Request("https://yw.bdfz.net/api/learning/interactions"),
    env,
    student: { id: 7, ucUserId: 42 },
    lesson,
    interactionKey: "evaluation",
    payload: { rating: 5, reason: "值得重读" },
    occurredAt: "2026-07-01T00:00:00.000Z",
  });

  assert.equal(result.delivery, "enqueued");
  assert.equal(queued.length, 1);
  assert.deepEqual(queued[0].options, { contentType: "json" });

  const envelope = queued[0].envelope;
  assert.equal(envelope.assessmentKind, "self_report");
  assert.equal(envelope.scoringRole, "none");
  assert.equal(envelope.eligibilityStatus, "non_scoring");
  assert.equal(envelope.rawValue, null);
  assert.equal(envelope.maxValue, null);
  assert.equal(envelope.normalizedValue, null);

  const accepted = validateLearningEvidenceEnvelope(envelope, QUEUE);
  assert.equal(accepted.interactionKey, "evaluation");
  assert.equal(accepted.scoringRole, "none");
  assert.equal(accepted.eligibilityStatus, "non_scoring");
  assert.equal(LEARNING_EVIDENCE_SOURCES[QUEUE].allowedInteractions.evaluation[2], "none");

  const enqueueReceipt = writes.find((write) => write.sql.startsWith("UPDATE evidence_outbox SET"));
  assert.match(enqueueReceipt?.sql || "", /delivery_status = 'enqueued'/);
  assert.doesNotMatch(enqueueReceipt?.sql || "", /delivery_status = 'delivered'/);
});

test("AI performance is eligible only when the server score is at least 60 and correctness passed", async () => {
  for (const evaluation of [
    { score: 59, correctness: "passed", provider: "apis", verdict: "revise" },
    { score: 100, correctness: "needs_revision", provider: "apis", verdict: "revise" },
    { score: 100, provider: "apis", verdict: "missing correctness" },
  ]) {
    const { env, queued, writes } = sourceEnvironment();
    const result = await recordLearningInteraction({
      request: new Request("https://yw.bdfz.net/api/interaction-check"),
      env,
      student: { id: 7, ucUserId: 42 },
      lesson: wordCreationLesson,
      interactionKey: "wordCreation",
      payload: {
        word: "站立",
        creation: "一句经服务器评价的练习。",
        score: 100,
        correctness: "passed",
        eligibilityStatus: "eligible",
      },
      evaluation,
      occurredAt: "2026-07-01T00:10:00.000Z",
    });
    assertSynchronizedIneligibleAttempt(result, queued, writes);
  }

  for (const [interactionKey, payload] of [
    ["wordCreation", { word: "站立", creation: "一句经服务器评价的练习。" }],
    ["contextWords", { words: ["人民", "站立", "新生"] }],
  ]) {
    const { env, queued } = sourceEnvironment();
    const interactionLesson = interactionKey === "wordCreation" ? wordCreationLesson : lesson;
    const result = await recordLearningInteraction({
      request: new Request("https://yw.bdfz.net/api/interaction-check"),
      env,
      student: { id: 7, ucUserId: 42 },
      lesson: interactionLesson,
      interactionKey,
      payload,
      evaluation: {
        score: 60,
        correctness: "passed",
        provider: "apis",
        verdict: "passed",
      },
      occurredAt: "2026-07-01T00:10:00.000Z",
    });
    assert.equal(result.eligibilityStatus, "eligible");
    assert.equal(result.delivery, "enqueued");
    assert.equal(queued.length, 1);
    assert.equal(queued[0].envelope.eligibilityStatus, "eligible");
    assert.equal(validateLearningEvidenceEnvelope(queued[0].envelope, QUEUE).eligibilityStatus, "eligible");
  }
});

test("vocabulary evidence is countable only after source-owned mastery while every attempt remains in the source ledger", async () => {
  for (const evaluation of [
    { score: 0, correctness: "incorrect", provider: "answer-key", verdict: "learning" },
    { score: 100, correctness: "correct", provider: "answer-key", verdict: "learning" },
  ]) {
    const { env, queued, writes } = sourceEnvironment();
    const result = await recordLearningInteraction({
      request: new Request("https://yw.bdfz.net/api/reading/vocab-attempt"),
      env,
      student: { id: 7, ucUserId: 42 },
      lesson: vocabLesson,
      interactionKey: "vocabAnswer",
      payload: { itemId: "lesson-1474:v01", selectedIndex: 1 },
      evaluation,
      occurredAt: "2026-07-01T00:10:00.000Z",
    });
    assertSynchronizedIneligibleAttempt(result, queued, writes);
  }

  const { env, queued, writes } = sourceEnvironment();
  const mastered = await recordLearningInteraction({
    request: new Request("https://yw.bdfz.net/api/reading/vocab-attempt"),
    env,
    student: { id: 7, ucUserId: 42 },
    lesson: vocabLesson,
    interactionKey: "vocabAnswer",
    payload: { itemId: "lesson-1474:v01", selectedIndex: 1 },
    evaluation: {
      score: 100,
      correctness: "correct",
      provider: "answer-key",
      verdict: "mastered",
    },
    occurredAt: "2026-07-01T00:10:00.000Z",
  });
  assert.equal(mastered.eligibilityStatus, "eligible");
  assert.equal(mastered.delivery, "enqueued");
  assert.equal(queued.length, 1);
  assert.ok(writeStartingWith(writes, "INSERT INTO evidence_outbox"));
  assert.equal(validateLearningEvidenceEnvelope(queued[0].envelope, QUEUE).eligibilityStatus, "eligible");
});

test("the bounded scoring submission window permits ordinary revision and idempotent retry", async () => {
  assert.deepEqual(learningEvidenceContract.submissionRateLimit, {
    maxAttempts: 8,
    windowSeconds: 600,
  });

  const allowed = sourceEnvironment({ recentSubmissionCount: 7, nextAttemptNo: 8 });
  const eighth = await recordLearningInteraction({
    request: new Request("https://yw.bdfz.net/api/interaction-check"),
    env: allowed.env,
    student: { id: 7, ucUserId: 42 },
    lesson: wordCreationLesson,
    interactionKey: "wordCreation",
    payload: { word: "站立", creation: "第八次正常修订。" },
    evaluation: { score: 80, correctness: "passed", provider: "apis", verdict: "passed" },
    occurredAt: "2026-07-01T00:10:00.000Z",
  });
  assert.equal(eighth.attemptNo, 8);
  assert.equal(eighth.delivery, "enqueued");

  const blocked = sourceEnvironment({ recentSubmissionCount: 8 });
  await assert.rejects(
    () => recordLearningInteraction({
      request: new Request("https://yw.bdfz.net/api/interaction-check"),
      env: blocked.env,
      student: { id: 7, ucUserId: 42 },
      lesson: wordCreationLesson,
      interactionKey: "wordCreation",
      payload: { word: "站立", creation: "超出短时提交边界。" },
      evaluation: { score: 80, correctness: "passed", provider: "apis", verdict: "passed" },
      occurredAt: "2026-07-01T00:10:00.000Z",
    }),
    (error) => error instanceof LearningSubmissionRateLimitError
      && error.code === "learning_submission_rate_limited"
      && error.retryAfterSeconds === 300,
  );
  assert.equal(blocked.writes.length, 0);
  assert.equal(blocked.queued.length, 0);

  const retry = sourceEnvironment({
    recentSubmissionCount: 8,
    existingInteraction: {
      source_event_id: "existing-source-event",
      attempt_no: 3,
      resource_key: "effect:lesson-1497:interaction:wordCreation",
      interaction_key: "wordCreation",
      eligibility_status: "ineligible",
    },
  });
  const deduped = await recordLearningInteraction({
    request: new Request("https://yw.bdfz.net/api/interaction-check"),
    env: retry.env,
    student: { id: 7, ucUserId: 42 },
    lesson: wordCreationLesson,
    interactionKey: "wordCreation",
    payload: {
      word: "站立",
      creation: "网络重试不应成为新提交。",
      clientMutationId: "same-client-mutation",
    },
    evaluation: { score: 80, correctness: "passed", provider: "apis", verdict: "passed" },
    occurredAt: "2026-07-01T00:10:00.000Z",
  });
  assert.equal(deduped.deduped, true);
  assert.equal(deduped.sourceEventId, "existing-source-event");
  assert.equal(deduped.delivery, "already_recorded_ineligible");
  assert.equal(retry.writes.length, 0);
});

test("a client mutation id cannot be replayed onto another learning item", async () => {
  const replay = sourceEnvironment({
    existingInteraction: {
      source_event_id: "existing-source-event",
      attempt_no: 1,
      resource_key: "effect:lesson-1497:interaction:wordCreation",
      interaction_key: "wordCreation",
      eligibility_status: "eligible",
    },
  });
  await assert.rejects(
    () => recordLearningInteraction({
      request: new Request("https://yw.bdfz.net/api/interaction-check"),
      env: replay.env,
      student: { id: 7, ucUserId: 42 },
      lesson: vocabLesson,
      interactionKey: "vocabAnswer",
      payload: {
        itemId: "lesson-1474:v01",
        selectedIndex: 1,
        clientMutationId: "same-client-mutation",
      },
      evaluation: {
        score: 100,
        correctness: "correct",
        provider: "answer-key",
        verdict: "mastered",
      },
    }),
    /client mutation id already belongs to another learning item/,
  );
  assert.equal(replay.writes.length, 0);
  assert.equal(replay.queued.length, 0);
});

test("the stale scoring envelope is rejected instead of silently entering evaluation", () => {
  const current = LEARNING_EVIDENCE_SOURCES[QUEUE].allowedInteractions.evaluation;
  assert.deepEqual(current, [
    "lesson_value_rated",
    "self_report",
    "none",
    "source_form_submission",
  ]);

  const staleEnvelope = {
    schema: "bdfz-learning-evidence-v1",
    schemaVersion: 1,
    sourceSystem: "yuwen-course",
    sourceSiteKey: "yw",
    sourceEventId: "018f1234-5678-7abc-9def-0123456789ab",
    sourceVersion: manifest.manifestVersion,
    registryVersion: registry.registryVersion,
    userId: 42,
    academicYear: "2025-2026",
    dimensionKey: "reflection",
    eventType: "lesson_value_rated",
    interactionKey: "evaluation",
    assessmentKind: "self_report",
    scoringRole: "a_plus_gate",
    verificationMethod: "source_form_submission",
    eligibilityStatus: "eligible",
    resourceKey: "effect:lesson-1458:interaction:evaluation",
    classSessionId: "",
    lessonPhase: "",
    attemptNo: 1,
    rawValue: null,
    maxValue: null,
    normalizedValue: null,
    occurredAt: "2026-07-01T00:00:00.000Z",
    sourceUrl: "https://yw.bdfz.net/#lesson-1458",
    sourcePayloadRef: "learning_interactions:018f1234-5678-7abc-9def-0123456789ab",
    summary: {
      lessonTitle: "中国人民站起来了",
      itemTitle: "篇目评价",
      itemGroup: "选择性必修上册",
      eventType: "lesson_value_rated",
    },
    facets: [
      { key: "lesson", value: "lesson-1458" },
      { key: "assessment", value: "self_report" },
    ],
  };

  assert.throws(
    () => validateLearningEvidenceEnvelope(staleEnvelope, QUEUE),
    LearningEvidenceValidationError,
  );
});
