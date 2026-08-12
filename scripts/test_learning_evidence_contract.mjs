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
import worker from "../site/_worker.js";

const ROOT = resolve(import.meta.dirname, "..");
const registry = JSON.parse(readFileSync(resolve(ROOT, "site/data/interaction-definitions.json"), "utf8"));
const manifest = JSON.parse(readFileSync(resolve(ROOT, "site/data/learning-manifest.json"), "utf8"));
const formativeManifest = JSON.parse(readFileSync(resolve(ROOT, "site/data/lesson-competency-manifest.json"), "utf8"));
const vocabFirstRead = JSON.parse(readFileSync(resolve(ROOT, "site/data/classical-first-read/lesson-1474.json"), "utf8"));
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
      if (sql.includes("FROM classical_first_read_sessions")) {
        return state.firstReadSubmitted ? { submitted_at: "2026-07-01T00:00:00.000Z" } : null;
      }
      if (sql.includes("AS acknowledged") && sql.includes("AS grandfathered")) {
        return {
          acknowledged: Number(state.annotatedReadAcknowledged),
          grandfathered: Number(state.vocabEvidenceExists),
        };
      }
      if (sql.includes("WHERE i.student_id = ? AND i.client_mutation_id = ?")) {
        return state.existingInteraction;
      }
      if (sql.includes("COALESCE(MAX(attempt_no)")) return { n: state.nextAttemptNo };
      if (sql.includes("FROM learning_interactions") && sql.includes("resource_key = ?")) {
        return { n: state.recentSubmissionCount };
      }
      if (sql.includes("FROM learning_interactions") && sql.includes("occurred_at >= ?")) {
        return { n: state.globalSubmissionCount };
      }
      if (sql.includes("FROM learning_submission_slots") && sql.includes("resource_key = ?")) {
        return { n: state.resourceSlotCount };
      }
      if (sql.includes("FROM learning_submission_slots")) {
        return { n: state.globalSlotCount };
      }
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
  globalSubmissionCount = 0,
  resourceSlotCount = recentSubmissionCount,
  globalSlotCount = globalSubmissionCount,
  nextAttemptNo = 1,
  existingInteraction = null,
  firstReadSubmitted = true,
  annotatedReadAcknowledged = true,
  vocabEvidenceExists = false,
} = {}) {
  const writes = [];
  const queued = [];
  const state = {
    recentSubmissionCount,
    globalSubmissionCount,
    resourceSlotCount,
    globalSlotCount,
    nextAttemptNo,
    existingInteraction,
    firstReadSubmitted,
    annotatedReadAcknowledged,
    vocabEvidenceExists,
  };
  return {
    writes,
    queued,
    state,
    env: {
      ASSETS: {
        async fetch(request) {
          const pathname = new URL(request.url).pathname;
          const value = pathname === "/data/interaction-definitions.json"
            ? registry
            : pathname === "/data/learning-manifest.json"
              ? manifest
              : pathname === "/data/lesson-competency-manifest.json"
                ? formativeManifest
                : pathname === "/data/classical-first-read/lesson-1474.json"
                  ? vocabFirstRead
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
  assert.equal(queued[0].envelope.sourceVersion, registry.compatibilityContracts.aPlusGate.sourceVersion);
  assert.equal(queued[0].envelope.registryVersion, registry.compatibilityContracts.aPlusGate.registryVersion);
  assert.equal(queued[0].envelope.eligibilityStatus, "ineligible");
}

test("current formal resources pin the separately reviewed frozen A+ contract", () => {
  const compatibility = registry.compatibilityContracts.aPlusGate;
  assert.match(compatibility.sourceVersion, /^yw-[a-f0-9]{16}$/);
  assert.match(compatibility.resourceKeyHash, /^sha256:[a-f0-9]{64}$/);
  assert.ok(Number(compatibility.itemCount) > manifest.itemCount);
  assert.equal(compatibility.reviewedProducerManifestVersion, manifest.manifestVersion);
  assert.equal(compatibility.reviewedProducerManifestDigest, manifest.resourceKeyHash);
  assert.equal(Number(compatibility.reviewedProducerItemCount), manifest.itemCount);
  assert.equal(compatibility.subsetDisposition, "all_current_a_plus_resources_verified_in_frozen_manifest");
});

test("YW exposes compound health and the exact existing A+ source activation receipt", async () => {
  assert.match(workerSource, /\/api\/learning\/health/);
  assert.match(workerSource, /USER_CENTER_EVIDENCE\.getLearningHealthReceipt/);
  assert.match(workerSource, /USER_CENTER_EVIDENCE\.getSourceReceipt/);
  assert.match(workerSource, /data\/learning-manifest\.json/);
  assert.match(workerSource, /data\/interaction-definitions\.json/);
  assert.match(workerSource, /data\/lesson-competency-manifest\.json/);
  assert.match(workerSource, /getLearningHealthReceipt\(descriptor\)/);
  assert.match(workerSource, /getSourceReceipt\(aPlusDescriptor\)/);
  assert.match(workerSource, /activationScope !== "transport_and_formative_health_only"/);
  assert.match(workerSource, /runtimeScoringActivation !== false/);
  assert.match(workerSource, /affectsAPlus !== false/);

  const calls = [];
  const env = sourceEnvironment().env;
  env.USER_CENTER_EVIDENCE = {
    async getLearningHealthReceipt(descriptor) {
      calls.push({ method: "health", descriptor });
      return {
        ok: true,
        schemaVersion: "bdfz-yw-learning-health-receipt-v1",
        status: "healthy",
        sourceSiteKey: "yw",
        formal: { ...descriptor.formal },
        registryVersion: descriptor.registryVersion,
        formative: { ...descriptor.formative },
        activationScope: "transport_and_formative_health_only",
        persistence: "none",
        runtimeScoringActivation: false,
        affectsGrowthScore: false,
        affectsAPlus: false,
      };
    },
    async getSourceReceipt(descriptor) {
      calls.push({ method: "source", descriptor });
      return {
        ok: true,
        schemaVersion: 1,
        ...descriptor,
        entrypointVersion: "bdfz-growth-source-rpc-v1",
        status: "active",
      };
    },
  };
  const response = await worker.fetch(new Request("https://yw.bdfz.net/api/learning/health"), env, {});
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.receipt.status, "healthy");
  assert.equal(body.aPlusSourceReceipt.status, "active");
  assert.deepEqual(calls.map(({ method }) => method), ["health", "source"]);
  assert.deepEqual(calls[1].descriptor, {
    sourceSiteKey: "yw",
    manifestVersion: registry.compatibilityContracts.aPlusGate.sourceVersion,
    manifestDigest: registry.compatibilityContracts.aPlusGate.resourceKeyHash,
    itemCount: registry.compatibilityContracts.aPlusGate.itemCount,
    loaderContractVersion: "yuwen-queue-ledger-v1",
  });
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
    vocabHandler.indexOf("recordLearningInteraction") >= 0
      && vocabHandler.indexOf("recordLearningInteraction") <
      vocabHandler.indexOf("INSERT INTO vocab_attempts"),
  );
  assert.match(vocabHandler, /sourceMutation:\s*async/);

  const studyGuideHandler = workerSource.slice(
    workerSource.indexOf("async function handleReadingStudyGuideAttempt"),
    workerSource.indexOf("async function handleClassicalFirstReadState"),
  );
  assert.ok(
    studyGuideHandler.indexOf("assertLearningSubmissionAllowed") >= 0
      && studyGuideHandler.indexOf("assertLearningSubmissionAllowed") <
        studyGuideHandler.indexOf("deterministicStudyGuideAssessment"),
  );
  assert.ok(
    studyGuideHandler.indexOf("authoritativeStudyGuideAssessment(assessment, recorded)") >= 0,
  );
  assert.match(workerSource, /status:\s*429/);
  assert.match(workerSource, /"retry-after"/);
});

test("YW evaluation self-report remains a v2 non-scoring event", async () => {
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

  assert.equal(envelope.registryVersion, "yw-interactions-2026-08-09-v2");
  assert.equal(envelope.sourceVersion, formativeManifest.manifestVersion);
  assert.equal(envelope.interactionKey, "evaluation");

  const enqueueReceipt = writes.find((write) => write.sql.startsWith("UPDATE evidence_outbox SET"));
  assert.match(enqueueReceipt?.sql || "", /delivery_status = 'enqueued'/);
  assert.doesNotMatch(enqueueReceipt?.sql || "", /delivery_status = 'delivered'/);
});

test("study-guide and initial-reading events bind to the current semantic formative manifest", async () => {
  const studyItem = formativeManifest.lessons
    .find((entry) => entry.lessonId === vocabLesson.id)
    .competencies.flatMap((entry) => entry.items)
    .find((entry) => entry.interactionKey === "studyGuideItemCompleted");
  assert.ok(studyItem);

  const study = sourceEnvironment();
  await recordLearningInteraction({
    request: new Request("https://yw.bdfz.net/api/learning/interactions"),
    env: study.env,
    student: { id: 7, ucUserId: 42 },
    lesson: vocabLesson,
    interactionKey: "studyGuideItemCompleted",
    payload: {
      itemKey: studyItem.itemKey,
      competencyTag: "wrong-client-claim",
      answerAuthority: "browser_self_claim",
      response: "我先依原句語境作答，再對照學案參考答案完成訂正。",
      referenceRevealedAt: "2026-07-01T00:00:00.000Z",
    },
    evaluation: {
      score: 80,
      correctness: "passed",
      provider: "apis",
      verdict: "passed",
    },
    occurredAt: "2026-07-01T00:00:00.000Z",
  });
  const studyEnvelope = study.queued[0].envelope;
  const studyInteraction = writeStartingWith(study.writes, "INSERT INTO learning_interactions");
  const storedStudyPayload = JSON.parse(studyInteraction.values[16]);
  assert.equal(storedStudyPayload.response, "我先依原句語境作答，再對照學案參考答案完成訂正。");
  assert.match(storedStudyPayload.responseDigest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(storedStudyPayload.responseLength, 24);
  assert.doesNotMatch(JSON.stringify(studyEnvelope), /我先依原句語境作答/);
  assert.equal(studyEnvelope.sourceVersion, formativeManifest.manifestVersion);
  assert.equal(studyEnvelope.registryVersion, formativeManifest.registryVersion);
  assert.equal(studyEnvelope.resourceKey, studyItem.resourceKey);
  assert.deepEqual(
    Object.fromEntries(studyEnvelope.facets.map((facet) => [facet.key, facet.value])),
    {
      lesson: vocabLesson.id,
      block: vocabLesson.blockId,
      assessment: "performance",
      competency: studyItem.competencyTag,
      formative_manifest: formativeManifest.manifestVersion,
      answer_authority: studyItem.answerAuthority,
    },
  );

  const process = sourceEnvironment();
  await recordLearningInteraction({
    request: new Request("https://yw.bdfz.net/api/reading/first-read/submit"),
    env: process.env,
    student: { id: 7, ucUserId: 42 },
    lesson: { id: "lesson-1534", title: "屈原列傳", blockId: "selected-compulsory-2", blockTitle: "選必中" },
    interactionKey: "initialReadingSubmitted",
    payload: { markCount: 3, elapsedMs: 60000, textVersionId: "cfr-lesson-1534-c332d4cede431f64" },
    occurredAt: "2026-07-01T00:00:00.000Z",
  });
  const processEnvelope = process.queued[0].envelope;
  assert.equal(processEnvelope.sourceVersion, formativeManifest.manifestVersion);
  assert.equal(processEnvelope.scoringRole, "none");
  assert.equal(processEnvelope.eligibilityStatus, "non_scoring");
  assert.equal(processEnvelope.facets.find((facet) => facet.key === "formative_manifest")?.value, formativeManifest.manifestVersion);

  await assert.rejects(
    recordLearningInteraction({
      request: new Request("https://yw.bdfz.net/api/learning/interactions"),
      env: sourceEnvironment().env,
      student: { id: 7, ucUserId: 42 },
      lesson: vocabLesson,
      interactionKey: "studyGuideItemCompleted",
      payload: { itemKey: "lesson-1534-not-in-this-lesson" },
    }),
    /absent from current active lesson set/,
  );
});

test("annotated classical reading receipt is idempotent for the stable mutation id", async () => {
  const receipt = sourceEnvironment();
  const payload = {
    threshold: 1,
    lessonPhase: "annotated_reading",
    clientMutationId: `annotated-read:${vocabLesson.id}:${vocabFirstRead.textVersionId}`.slice(0, 100),
  };
  const first = await recordLearningInteraction({
    request: new Request("https://yw.bdfz.net/api/learning/interactions"),
    env: receipt.env,
    student: { id: 7, ucUserId: 42 },
    lesson: vocabLesson,
    interactionKey: "readAcknowledged",
    payload,
    occurredAt: "2026-08-11T00:00:00.000Z",
  });
  assert.equal(first.deduped, false);

  receipt.state.existingInteraction = {
    source_event_id: first.sourceEventId,
    attempt_no: first.attemptNo,
    resource_key: `lesson:${vocabLesson.id}`,
    interaction_key: "readAcknowledged",
    eligibility_status: "non_scoring",
    raw_payload_json: JSON.stringify({ threshold: 1 }),
    delivery_status: "enqueued",
  };
  const replay = await recordLearningInteraction({
    request: new Request("https://yw.bdfz.net/api/learning/interactions"),
    env: receipt.env,
    student: { id: 7, ucUserId: 42 },
    lesson: vocabLesson,
    interactionKey: "readAcknowledged",
    payload,
    occurredAt: "2026-08-11T00:00:01.000Z",
  });
  assert.equal(replay.deduped, true);
  assert.equal(replay.sourceEventId, first.sourceEventId);
  assert.equal(
    receipt.writes.filter((write) => write.sql.trimStart().startsWith("INSERT INTO learning_interactions")).length,
    1,
  );
});

test("classical vocabulary and vocabulary or syntax study-guide work require the annotated-reading receipt", async () => {
  const assertAnnotatedGate = (promise) => assert.rejects(
    promise,
    (error) => error?.code === "classical_annotated_reading_required"
      && error.message === "請先讀完帶註釋正文再進入詞級疏通",
  );
  await assertAnnotatedGate(recordLearningInteraction({
    request: new Request("https://yw.bdfz.net/api/reading/vocab-attempt"),
    env: sourceEnvironment({ annotatedReadAcknowledged: false }).env,
    student: { id: 7, ucUserId: 42 },
    lesson: vocabLesson,
    interactionKey: "vocabAnswer",
    payload: { itemId: "lesson-1474:v01", selectedIndex: 1 },
    evaluation: { score: 100, correctness: "correct", provider: "answer-key", verdict: "mastered" },
  }));

  const lessonManifest = formativeManifest.lessons.find((entry) => entry.lessonId === vocabLesson.id);
  for (const competencyTag of ["vocabulary", "syntax"]) {
    const item = lessonManifest.competencies
      .find((competency) => competency.competencyTag === competencyTag)
      .items.find((candidate) => candidate.interactionKey === "studyGuideItemCompleted");
    assert.ok(item, `${competencyTag} study-guide fixture missing`);
    await assertAnnotatedGate(recordLearningInteraction({
      request: new Request("https://yw.bdfz.net/api/reading/study-guide-attempt"),
      env: sourceEnvironment({ annotatedReadAcknowledged: false }).env,
      student: { id: 7, ucUserId: 42 },
      lesson: vocabLesson,
      interactionKey: "studyGuideItemCompleted",
      payload: {
        itemKey: item.itemKey,
        response: "先依原句語境作答，再對照參考答案完成訂正。",
        referenceRevealedAt: "2026-08-11T00:00:00.000Z",
      },
      evaluation: { score: 80, correctness: "passed", provider: "deterministic", verdict: "passed" },
    }));
  }
});

test("existing vocabulary evidence grandfathers the annotated-reading gate", async () => {
  const grandfathered = sourceEnvironment({
    annotatedReadAcknowledged: false,
    vocabEvidenceExists: true,
  });
  const result = await recordLearningInteraction({
    request: new Request("https://yw.bdfz.net/api/reading/vocab-attempt"),
    env: grandfathered.env,
    student: { id: 7, ucUserId: 42 },
    lesson: vocabLesson,
    interactionKey: "vocabAnswer",
    payload: { itemId: "lesson-1474:v01", selectedIndex: 1 },
    evaluation: { score: 100, correctness: "correct", provider: "answer-key", verdict: "mastered" },
    occurredAt: "2026-08-11T00:00:00.000Z",
  });
  assert.equal(result.deduped, false);
  assert.equal(result.eligibilityStatus, "eligible");
  assert.equal(grandfathered.queued.length, 1);
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
      occurredAt: "2026-07-01T00:15:00.000Z",
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
      occurredAt: "2026-07-01T00:15:00.000Z",
    });
    assert.equal(result.eligibilityStatus, "eligible");
    assert.equal(result.delivery, "enqueued");
    assert.equal(queued.length, 1);
    assert.equal(queued[0].envelope.eligibilityStatus, "eligible");
    assert.equal(queued[0].envelope.eligibilityStatus, "eligible");
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
  assert.equal(queued[0].envelope.eligibilityStatus, "eligible");
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
      occurredAt: "2026-07-01T00:15:00.000Z",
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
      raw_payload_json: JSON.stringify({ word: "站立", creation: "网络重试不应成为新提交。" }),
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

test("non-scoring telemetry is bounded and rejected before any write", async () => {
  const flooded = sourceEnvironment({ recentSubmissionCount: 60 });
  await assert.rejects(
    () => recordLearningInteraction({
      request: new Request("https://yw.bdfz.net/api/learning/interactions"),
      env: flooded.env,
      student: { id: 7, ucUserId: 42 },
      lesson,
      interactionKey: "evaluation",
      payload: { rating: 80, reason: "短時間重複評價" },
      occurredAt: "2026-07-01T00:15:00.000Z",
    }),
    (error) => error instanceof LearningSubmissionRateLimitError
      && error.retryAfterSeconds === 300,
  );
  assert.equal(flooded.writes.length, 0);
  assert.equal(flooded.queued.length, 0);
});

test("the same mutation id cannot replay with a changed payload", async () => {
  const replay = sourceEnvironment({
    existingInteraction: {
      source_event_id: "existing-source-event",
      attempt_no: 1,
      resource_key: "effect:lesson-1458:interaction:evaluation",
      interaction_key: "evaluation",
      eligibility_status: "non_scoring",
      raw_payload_json: JSON.stringify({ rating: 80, reason: "原始理由" }),
    },
  });
  await assert.rejects(
    () => recordLearningInteraction({
      request: new Request("https://yw.bdfz.net/api/learning/interactions"),
      env: replay.env,
      student: { id: 7, ucUserId: 42 },
      lesson,
      interactionKey: "evaluation",
      payload: {
        rating: 80,
        reason: "篡改後理由",
        clientMutationId: "same-client-mutation",
      },
      occurredAt: "2026-07-01T00:15:00.000Z",
    }),
    (error) => error?.code === "learning_mutation_conflict",
  );
  assert.equal(replay.writes.length, 0);
  assert.equal(replay.queued.length, 0);
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

test("the producer registry cannot classify lesson interest as scoring evidence", () => {
  const current = registry.definitions.evaluation;
  assert.deepEqual(current, {
    eventType: "lesson_value_rated",
    assessmentKind: "self_report",
    scoringRole: "none",
    dimensionKey: "reflection",
    verificationMethod: "source_form_submission",
    resourceKind: "manifest_interaction",
    allowedPayloadKeys: ["rating", "reason"],
  });
});
