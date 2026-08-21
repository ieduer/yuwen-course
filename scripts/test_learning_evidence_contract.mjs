#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { resolve } from "node:path";

import {
  acquireLearningSubmissionReservation,
  drainEvidenceOutbox,
  LearningSubmissionInProgressError,
  LearningSubmissionRateLimitError,
  learningEvidenceContract,
  OUTBOX_RECONCILE_SELECTION_SQL,
  OUTBOX_RETRY_SELECTION_SQL,
  releaseLearningSubmissionReservation,
  assertLearningSubmissionAllowed,
  invalidateFormativeManifestCache,
  reconcileEvidenceOutbox,
  recordLearningInteraction,
} from "../site/learning-evidence-source.js";
import worker, {
  authoritativeReadingAssessmentForSubmission,
  learningEvaluatorUnavailableResponse,
  preActivationTransportLessonPhase,
} from "../site/_worker.js";

const ROOT = resolve(import.meta.dirname, "..");
const registry = JSON.parse(readFileSync(resolve(ROOT, "site/data/interaction-definitions.json"), "utf8"));
const manifest = JSON.parse(readFileSync(resolve(ROOT, "site/data/learning-manifest.json"), "utf8"));
const courseManifest = JSON.parse(readFileSync(resolve(ROOT, "site/data/manifest.json"), "utf8"));
const literaryTaxonomy = JSON.parse(readFileSync(resolve(ROOT, "site/data/literary-taxonomy.json"), "utf8"));
const formativeManifest = JSON.parse(readFileSync(resolve(ROOT, "site/data/lesson-competency-manifest.json"), "utf8"));
const studyGuideCatalog = JSON.parse(readFileSync(resolve(ROOT, "site/data/study-guide-catalog.json"), "utf8"));
const vocabFirstRead = JSON.parse(readFileSync(resolve(ROOT, "site/data/classical-first-read/lesson-1474.json"), "utf8"));
const workerSource = readFileSync(resolve(ROOT, "site/_worker.js"), "utf8");
const YW_WEB_JSON_HEADERS = {
  "content-type": "application/json",
  origin: "https://yw.bdfz.net",
};
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
      if (sql.includes("SELECT id, uc_user_id, uc_slug, display_name, class_name FROM students")) {
        return {
          id: 7,
          uc_user_id: 42,
          uc_slug: "gap-test-student",
          display_name: "Gap Test Student",
          class_name: "",
        };
      }
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
      if (sql.includes("SELECT id, is_active, version FROM submissions")) {
        return state.existingReadingSubmission;
      }
      if (sql.includes("WHERE slot.source_event_id = ?")) {
        return state.existingSubmissionSlot || null;
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
      if (sql.includes("central_pending_mapping") && sql.includes("FROM evidence_outbox")) {
        return {
          transport_pending: 0,
          transport_enqueued: 2,
          central_accepted: 7,
          central_pending_mapping: 1,
          central_quarantined: 0,
        };
      }
      return null;
    },
    async all() {
      if (sql.includes("FROM evidence_outbox") && sql.includes("delivery_status IN")) {
        const statuses = new Set(["pending", "enqueued"]);
        const includePendingMapping = sql.includes("central_disposition IS NULL OR central_disposition = 'pending_mapping'");
        return { results: structuredClone((state.outboxRows || []).filter((row) => (
          statuses.has(row.delivery_status)
          && (!row.central_disposition || (includePendingMapping && row.central_disposition === "pending_mapping"))
          && JSON.parse(row.envelope_json || "{}").schema === "bdfz-learning-evidence-event-v2"
          && JSON.parse(row.envelope_json || "{}").contractVersion === "yw-aplus-e310-v2"
        ))) };
      }
      return { results: [] };
    },
    async run() {
      writes.push({ sql, values: this.values });
      if (sql.includes("SET central_disposition = ?") && sql.includes("central_receipted_at")) {
        const row = (state.outboxRows || []).find((candidate) => candidate.source_event_id === this.values[3]);
        const expectedDisposition = this.values[4];
        const matchesExpected = expectedDisposition === null
          ? row?.central_disposition == null
          : row?.central_disposition === expectedDisposition;
        if (row && matchesExpected && ["pending", "enqueued"].includes(row.delivery_status)) {
          row.central_disposition = this.values[0];
          return { success: true, meta: { changes: 1 } };
        }
        return { success: true, meta: { changes: 0 } };
      }
      return { success: true, meta: { changes: 1 } };
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
  existingReadingSubmission = null,
  existingSubmissionSlot = null,
  firstReadSubmitted = true,
  annotatedReadAcknowledged = true,
  vocabEvidenceExists = false,
  outboxRows = [],
  centralReceipts = [],
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
    existingReadingSubmission,
    existingSubmissionSlot,
    firstReadSubmitted,
    annotatedReadAcknowledged,
    vocabEvidenceExists,
    outboxRows,
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
            : pathname === "/data/manifest.json"
              ? courseManifest
              : pathname === "/data/literary-taxonomy.json"
                ? literaryTaxonomy
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
          return statements.map(() => ({ success: true, meta: { changes: 1 } }));
        },
      },
      LEARNING_EVIDENCE_QUEUE: {
        async send(envelope, options) {
          queued.push({ envelope, options });
        },
      },
      USER_CENTER_EVIDENCE: {
        async getLearningEvidenceDeliveryReceipts(sourceAttemptIds) {
          return {
            schemaVersion: "bdfz-learning-evidence-delivery-receipts-v1",
            sourceSiteKey: "yw",
            contractVersion: "yw-aplus-e310-v2",
            receipts: centralReceipts.filter((receipt) => sourceAttemptIds.includes(receipt.sourceAttemptId)),
          };
        },
      },
    },
  };
}

function writeStartingWith(writes, sqlPrefix) {
  return writes.find((write) => write.sql.trimStart().startsWith(sqlPrefix));
}

function sqliteD1(db) {
  const d1 = {
    prepare(sql) {
      return {
        sql,
        values: [],
        bind(...values) {
          this.values = values;
          return this;
        },
        async all() {
          return { results: db.prepare(sql).all(...this.values) };
        },
        async first() {
          return db.prepare(sql).get(...this.values) || null;
        },
        async run() {
          const result = db.prepare(sql).run(...this.values);
          return { success: true, meta: { changes: Number(result.changes || 0) } };
        },
      };
    },
    async batch(statements) {
      db.exec("BEGIN IMMEDIATE");
      try {
        const results = statements.map((statement) => {
          const result = db.prepare(statement.sql).run(...statement.values);
          return { success: true, meta: { changes: Number(result.changes || 0) } };
        });
        db.exec("COMMIT");
        return results;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return d1;
}

function initializeLearningContractDb(db) {
  for (const migration of [
    "migrations/0001_reading_constellation.sql",
    "migrations/0003_learning_evidence_loop_v1.sql",
    "migrations/0004_classical_first_read_and_outbox_index.sql",
    "migrations/0005_learning_evidence_central_receipts.sql",
  ]) {
    db.exec(readFileSync(resolve(ROOT, migration), "utf8"));
  }
  db.prepare(
    "INSERT INTO students (id, uc_slug, display_name, uc_user_id, identity_verified_at) VALUES (?, ?, ?, ?, ?)"
  ).run(7, "lease-test-student", "Lease Test Student", 42, "2026-08-13T22:00:00.000Z");
}

function assertSynchronizedIneligibleAttempt(result, queued, writes) {
  assert.equal(result.eligibilityStatus, "ineligible");
  assert.equal(result.delivery, "enqueued_ineligible");
  assert.equal(queued.length, 1);
  assert.ok(writeStartingWith(writes, "INSERT INTO learning_interactions"));
  const evaluationWrite = writeStartingWith(writes, "INSERT INTO learning_evaluations");
  assert.equal(evaluationWrite?.values?.[2], "ineligible");
  assert.ok(writeStartingWith(writes, "INSERT INTO evidence_outbox"));
  assert.equal(queued[0].envelope.schema, "bdfz-learning-evidence-event-v2");
  assert.equal(queued[0].envelope.schemaVersion, 2);
  assert.equal(Object.hasOwn(queued[0].envelope, "sourceContractVersion"), false);
  assert.equal(queued[0].envelope.sourceVersion, registry.compatibilityContracts.aPlusGate.sourceVersion);
  assert.equal(queued[0].envelope.contractVersion, registry.compatibilityContracts.aPlusGate.contractVersion);
  assert.equal(queued[0].envelope.sourceReleaseId, registry.compatibilityContracts.aPlusGate.sourceReleaseId);
  assert.equal(queued[0].envelope.mappingVersion, registry.compatibilityContracts.aPlusGate.mappingVersion);
  assert.equal(queued[0].envelope.sourceAttemptId, queued[0].envelope.sourceEventId);
  assert.match(queued[0].envelope.canonicalUnitId, /^yw:lesson-/);
  assert.match(queued[0].envelope.resourceVersion, /^sha256:[a-f0-9]{64}$/);
  assert.equal(queued[0].envelope.registryVersion, registry.compatibilityContracts.aPlusGate.registryVersion);
  assert.equal(queued[0].envelope.eligibilityStatus, "ineligible");
}

test("submission rate responses distinguish capacity from evaluator retry exhaustion", () => {
  const capacity = new LearningSubmissionRateLimitError(17, "window_capacity");
  const exhausted = new LearningSubmissionRateLimitError(29, "evaluator_retry_exhausted");
  assert.equal(capacity.code, "learning_submission_rate_limited");
  assert.equal(capacity.limitReason, "window_capacity");
  assert.equal(capacity.retryAfterSeconds, 17);
  assert.match(capacity.message, /提交过于频繁/);
  assert.equal(exhausted.code, "learning_submission_rate_limited");
  assert.equal(exhausted.limitReason, "evaluator_retry_exhausted");
  assert.equal(exhausted.retryAfterSeconds, 29);
  assert.match(exhausted.message, /两次评阅/);
  assert.match(workerSource, /limitReason: error\?\.limitReason \|\| "window_capacity"/);
  assert.match(workerSource, /releaseAfterEvaluatorFailure/);
});

test("current formal resources publish one exact e310/v2 source contract with complete lineage", () => {
  const compatibility = registry.compatibilityContracts.aPlusGate;
  assert.equal(compatibility.contractVersion, "yw-aplus-e310-v2");
  assert.match(compatibility.sourceVersion, /^yw-[a-f0-9]{16}$/);
  assert.match(compatibility.resourceKeyHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(compatibility.sourceVersion, manifest.manifestVersion);
  assert.equal(compatibility.resourceKeyHash, manifest.resourceKeyHash);
  assert.equal(Number(compatibility.itemCount), manifest.itemCount);
  assert.equal(Number(compatibility.eligibleItemCount), 768);
  assert.equal(Number(compatibility.thresholdCount), 692);
  assert.equal(Number(compatibility.mappingCoveragePercent), 100);
  assert.equal(compatibility.academicYearPolicy.status, "active");
  assert.equal(compatibility.academicYearPolicy.academicYear, "2026-2027");
  assert.equal(
    compatibility.academicYearPolicy.scoringMode,
    "fixed_distinct_credit_unit_a_plus_gate",
  );
  assert.equal(compatibility.academicYearPolicy.requiredDistinctCreditUnits, 692);
  assert.ok(manifest.items.every((item) => (
    item.sourceReleaseId === compatibility.sourceReleaseId
    && item.mappingVersion === compatibility.mappingVersion
    && item.canonicalUnitId
    && /^sha256:[a-f0-9]{64}$/.test(item.resourceVersion)
  )));
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
  assert.match(workerSource, /activationScope: "registered_source_contract_health_only"/);
  assert.match(workerSource, /runtimeScoringActivation: false/);
  assert.match(workerSource, /affectsAPlus: false/);

  const calls = [];
  const env = sourceEnvironment().env;
  env.USER_CENTER_EVIDENCE = {
    async getLearningHealthReceipt(descriptor) {
      calls.push({ method: "health", descriptor });
      return {
        ok: true,
        schemaVersion: "bdfz-learning-source-health-receipt-v2",
        status: "healthy",
        sources: structuredClone(descriptor.sources),
        capabilities: structuredClone(descriptor.capabilities),
        activationScope: "registered_source_contract_health_only",
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
  assert.deepEqual(body.deliveryRecovery, {
    schemaVersion: "yw-evidence-outbox-recovery-v1",
    transportPending: 0,
    transportEnqueued: 2,
    centralAccepted: 7,
    centralPendingMapping: 1,
    centralQuarantined: 0,
    containsIdentityData: false,
  });
  assert.deepEqual(calls.map(({ method }) => method), ["health", "source"]);
  assert.deepEqual(calls[0].descriptor, {
    schemaVersion: "bdfz-learning-source-health-descriptor-v1",
    sources: [{
      sourceSiteKey: "yw",
      sourceSystem: "yuwen-course",
      contractVersion: "yw-aplus-e310-v2",
      registryVersion: "yw-interactions-2026-08-09-v2",
      resourceCatalog: {
        catalogVersion: registry.compatibilityContracts.aPlusGate.sourceReleaseId,
        manifestVersion: manifest.manifestVersion,
        manifestDigest: manifest.resourceKeyHash,
        sourceReleaseId: registry.compatibilityContracts.aPlusGate.sourceReleaseId,
        mappingVersion: "yw-canonical-learning-mapping-v1",
        publishedItemCount: manifest.itemCount,
      },
      activeAPlusProjection: {
        assessmentKind: "performance",
        scoringRole: "a_plus_gate",
        excludedQuestionKinds: ["evaluation"],
        excludedItemCount: 101,
        eligibleItemCount: 768,
        thresholdPolicy: {
          percent: 90,
          activationBaselineEligibleUnits: 768,
          requiredDistinctCreditUnits: 692,
          annualStabilityRule: "fixed_for_academic_year_task_pool_append_does_not_raise_requirement",
        },
        academicYearPolicy: {
          status: "active",
          policyVersion: "yw-aplus-2026-2027-v1",
          academicYear: "2026-2027",
          scoringMode: "fixed_distinct_credit_unit_a_plus_gate",
        },
      },
      preActivationTransportCanaryPolicy: {
        status: "active",
        startsAt: "2026-08-11T16:00:00.000Z",
        expiresAt: "2026-08-31T16:00:00.000Z",
        acceptedAcademicYear: "2025-2026",
        interactionKey: "lessonOpened",
        eventType: "lesson_opened",
        assessmentKind: "trace",
        scoringRole: "none",
        eligibilityStatus: "non_scoring",
        verificationMethod: "source_route",
        lessonPhase: "release_canary",
        numericResultPolicy: "all_null",
        effect: "audit_only_no_credit_no_grade",
      },
    }],
    capabilities: [{
      sourceSiteKey: "yw",
      capabilityKey: "formative_mastery",
      registryVersion: registry.registryVersion,
      formal: {
        manifestVersion: manifest.manifestVersion,
        manifestDigest: manifest.resourceKeyHash,
        itemCount: manifest.itemCount,
      },
      manifestVersion: formativeManifest.manifestVersion,
      manifestDigest: formativeManifest.manifestDigest,
      itemCount: formativeManifest.itemCount,
    }],
  });
  assert.deepEqual(calls[1].descriptor, {
    sourceSiteKey: "yw",
    manifestVersion: registry.compatibilityContracts.aPlusGate.sourceVersion,
    manifestDigest: registry.compatibilityContracts.aPlusGate.resourceKeyHash,
    itemCount: registry.compatibilityContracts.aPlusGate.itemCount,
    loaderContractVersion: "yuwen-queue-ledger-v1",
  });
});

test("native formative mastery cannot fall back to the Web session RPC", async () => {
  assert.match(workerSource, /readingFormativeMasteryRpcDecision\(/);
  assert.match(workerSource, /typeof env\.USER_CENTER_EVIDENCE\?\.\[rpc\.rpcName\] !== "function"/);
  assert.match(workerSource, /env\.USER_CENTER_EVIDENCE\[rpc\.rpcName\]\(rpc\.credential\)/);
  assert.doesNotMatch(
    workerSource,
    /getFormativeMastery\(userCenterSessionCookieHeader\(request\)\)/,
  );

  let totalItems = 0;
  let competencyUnitCount = 0;
  const lessons = formativeManifest.lessons.map((lessonItem) => ({
    lessonId: lessonItem.lessonId,
    lessonTitle: lessonItem.lessonTitle || lessonItem.lessonId,
    competencies: lessonItem.competencies.map((competency) => {
      const total = Number(competency.activeItemCount);
      totalItems += total;
      if (total > 0) competencyUnitCount += 1;
      return {
        competencyTag: competency.competencyTag,
        status: total > 0 ? "available" : "unavailable",
        completedItems: 0,
        totalItems: total,
        masteryRate: total > 0 ? 0 : null,
      };
    }),
  }));
  const rpcResult = {
    ok: true,
    schemaVersion: "bdfz-yw-formative-mastery-rpc-v1",
    status: "available",
    httpStatus: 200,
    nonScoring: true,
    affectsGrowthScore: false,
    affectsAPlus: false,
    projection: {
      schemaVersion: "bdfz-yw-formative-mastery-v1",
      status: "available",
      unit: "lesson_competency",
      manifestVersion: formativeManifest.manifestVersion,
      nonScoring: true,
      affectsGrowthScore: false,
      affectsAPlus: false,
      summary: {
        lessonCount: lessons.length,
        competencyUnitCount,
        completedItems: 0,
        totalItems,
        masteryRate: totalItems > 0 ? 0 : null,
      },
      lessons,
    },
  };
  const nativeAuthorization = `Bearer ywat_${"n".repeat(43)}`;
  const nativeCalls = [];
  const nativeEnv = sourceEnvironment().env;
  nativeEnv.USER_CENTER_EVIDENCE = {
    async resolveNativeSession(authorization) {
      nativeCalls.push(["resolveNativeSession", authorization]);
      return {
        schemaVersion: "bdfz-native-auth/1",
        status: 200,
        authenticated: true,
        sourceSiteKey: "yw",
        clientId: "yuwen-native-android",
        capability: "data",
        userId: 42,
        slug: "native-formative-student",
        displayName: "Native Formative Student",
      };
    },
    async resolveSession(cookie) {
      nativeCalls.push(["resolveSession", cookie]);
      return {
        authenticated: true,
        sourceSiteKey: "yw",
        userId: 42,
        slug: "native-formative-student",
        displayName: "Native Formative Student",
      };
    },
    async getNativeFormativeMastery(authorization) {
      nativeCalls.push(["getNativeFormativeMastery", authorization]);
      return rpcResult;
    },
    async getFormativeMastery(cookie) {
      nativeCalls.push(["getFormativeMastery", cookie]);
      return rpcResult;
    },
  };
  const nativeResponse = await worker.fetch(new Request(
    "https://yw.bdfz.net/api/reading/formative-mastery",
    {
      headers: {
        authorization: nativeAuthorization,
        cookie: "bdfz_uc_session=native-formative-web-peer",
      },
    },
  ), nativeEnv, {});
  assert.equal(nativeResponse.status, 200);
  assert.deepEqual(nativeCalls.map(([method]) => method), [
    "resolveNativeSession",
    "resolveSession",
    "getNativeFormativeMastery",
  ]);
  assert.equal(nativeCalls[2][1], nativeAuthorization);
  assert.doesNotMatch(await nativeResponse.text(), /ywat_/);

  const webCalls = [];
  const webEnv = sourceEnvironment().env;
  webEnv.USER_CENTER_EVIDENCE = {
    async resolveSession(cookie) {
      webCalls.push(["resolveSession", cookie]);
      return {
        authenticated: true,
        sourceSiteKey: "yw",
        userId: 42,
        slug: "web-formative-student",
        displayName: "Web Formative Student",
      };
    },
    async getFormativeMastery(cookie) {
      webCalls.push(["getFormativeMastery", cookie]);
      return rpcResult;
    },
  };
  const webResponse = await worker.fetch(new Request(
    "https://yw.bdfz.net/api/reading/formative-mastery",
    { headers: { cookie: "bdfz_uc_session=web-formative-only" } },
  ), webEnv, {});
  assert.equal(webResponse.status, 200);
  assert.deepEqual(webCalls, [
    ["resolveSession", "bdfz_uc_session=web-formative-only"],
    ["getFormativeMastery", "bdfz_uc_session=web-formative-only"],
  ]);

  const nonNativeCalls = [];
  const nonNativeEnv = sourceEnvironment().env;
  nonNativeEnv.USER_CENTER_EVIDENCE = {
    async resolveSession(cookie) {
      nonNativeCalls.push(["resolveSession", cookie]);
      return {
        authenticated: true,
        sourceSiteKey: "yw",
        userId: 42,
        slug: "non-native-formative-student",
        displayName: "Non-native Formative Student",
      };
    },
    async getFormativeMastery(cookie) {
      nonNativeCalls.push(["getFormativeMastery", cookie]);
      return rpcResult;
    },
  };
  const nonNativeResponse = await worker.fetch(new Request(
    "https://yw.bdfz.net/api/reading/formative-mastery",
    {
      headers: {
        authorization: "Bearer unrelated",
        cookie: "bdfz_uc_session=non-native-web-session",
      },
    },
  ), nonNativeEnv, {});
  assert.equal(nonNativeResponse.status, 200);
  assert.deepEqual(nonNativeCalls, [
    ["resolveSession", "bdfz_uc_session=non-native-web-session"],
    ["getFormativeMastery", "bdfz_uc_session=non-native-web-session"],
  ]);

  const malformedNativeCalls = [];
  const malformedNativeEnv = sourceEnvironment().env;
  malformedNativeEnv.USER_CENTER_EVIDENCE = {
    async resolveNativeSession() {
      malformedNativeCalls.push("resolveNativeSession");
      throw new Error("malformed native authorization must be rejected before RPC");
    },
    async resolveSession() {
      malformedNativeCalls.push("resolveSession");
      throw new Error("malformed native authorization must not downgrade to Web auth");
    },
    async getNativeFormativeMastery() {
      malformedNativeCalls.push("getNativeFormativeMastery");
      throw new Error("malformed native authorization must not reach mastery RPC");
    },
    async getFormativeMastery() {
      malformedNativeCalls.push("getFormativeMastery");
      throw new Error("malformed native authorization must not reach mastery RPC");
    },
  };
  const malformedNativeResponse = await worker.fetch(new Request(
    "https://yw.bdfz.net/api/reading/formative-mastery",
    {
      headers: {
        authorization: `Bearer ywat_${"m".repeat(42)}`,
        cookie: "bdfz_uc_session=must-not-authorize-malformed-native",
      },
    },
  ), malformedNativeEnv, {});
  assert.equal(malformedNativeResponse.status, 401);
  assert.deepEqual(malformedNativeCalls, []);

  const conflictingIdentityCalls = [];
  const conflictingIdentityEnv = sourceEnvironment().env;
  conflictingIdentityEnv.USER_CENTER_EVIDENCE = {
    async resolveNativeSession(authorization) {
      conflictingIdentityCalls.push(["resolveNativeSession", authorization]);
      return {
        schemaVersion: "bdfz-native-auth/1",
        status: 200,
        authenticated: true,
        sourceSiteKey: "yw",
        clientId: "yuwen-native-android",
        capability: "data",
        userId: 42,
        slug: "native-conflict-student",
        displayName: "Native Conflict Student",
      };
    },
    async resolveSession(cookie) {
      conflictingIdentityCalls.push(["resolveSession", cookie]);
      return {
        authenticated: true,
        sourceSiteKey: "yw",
        userId: 41,
        slug: "web-conflict-student",
        displayName: "Web Conflict Student",
      };
    },
    async getNativeFormativeMastery(authorization) {
      conflictingIdentityCalls.push(["getNativeFormativeMastery", authorization]);
      return rpcResult;
    },
    async getFormativeMastery(cookie) {
      conflictingIdentityCalls.push(["getFormativeMastery", cookie]);
      return rpcResult;
    },
  };
  const conflictingIdentityResponse = await worker.fetch(new Request(
    "https://yw.bdfz.net/api/reading/formative-mastery",
    {
      headers: {
        authorization: nativeAuthorization,
        cookie: "bdfz_uc_session=conflicting-web-session",
      },
    },
  ), conflictingIdentityEnv, {});
  assert.equal(conflictingIdentityResponse.status, 401);
  assert.deepEqual(conflictingIdentityCalls.map(([method]) => method), [
    "resolveNativeSession",
    "resolveSession",
  ]);

  const unavailableCalls = [];
  const unavailableEnv = sourceEnvironment().env;
  unavailableEnv.USER_CENTER_EVIDENCE = {
    async resolveNativeSession() {
      return {
        schemaVersion: "bdfz-native-auth/1",
        status: 200,
        authenticated: true,
        sourceSiteKey: "yw",
        clientId: "yuwen-native-android",
        capability: "data",
        userId: 42,
        slug: "native-formative-student",
        displayName: "Native Formative Student",
      };
    },
    async resolveSession() {
      return {
        authenticated: true,
        sourceSiteKey: "yw",
        userId: 42,
        slug: "native-formative-student",
        displayName: "Native Formative Student",
      };
    },
    async getFormativeMastery(cookie) {
      unavailableCalls.push(cookie);
      return rpcResult;
    },
  };
  const unavailableResponse = await worker.fetch(new Request(
    "https://yw.bdfz.net/api/reading/formative-mastery",
    {
      headers: {
        authorization: nativeAuthorization,
        cookie: "bdfz_uc_session=native-method-absent",
      },
    },
  ), unavailableEnv, {});
  assert.equal(unavailableResponse.status, 503);
  assert.deepEqual(unavailableCalls, []);
});

test("generic learning route preserves the classical prerequisite code and retry shape", async () => {
  invalidateFormativeManifestCache();
  const source = sourceEnvironment({ firstReadSubmitted: false });
  source.env.READING_TEST_SLUG = "gap-test-student";
  const response = await worker.fetch(new Request("https://yw.bdfz.net/api/learning/interactions", {
    method: "POST",
    headers: YW_WEB_JSON_HEADERS,
    body: JSON.stringify({
      lessonId: vocabLesson.id,
      interactionKey: "noteOpened",
      clientMutationId: "classical-gate-generic-route",
      data: { noteRef: "1" },
    }),
  }), source.env, {});
  const body = await response.json();
  assert.equal(response.status, 422);
  assert.deepEqual(body, {
    ok: false,
    error: "請先完成無標點初讀再進入本課後續關卡",
    code: "classical_first_read_required",
    retryable: false,
    retryAfterSeconds: null,
  });
  assert.equal(source.queued.length, 0);
  assert.equal(source.writes.some((write) => (
    /learning_interactions|learning_evaluations|evidence_outbox|learning_submission_slots/.test(write.sql)
  )), false);
});

test("cookie-auth mutation routes reject non-JSON and non-exact Web origins before every side effect", async () => {
  const mutationCases = [
    ["/api/interaction-check", {
      lessonId: "lesson-1488",
      interaction: "authorQuestion",
      input: { answer: "我想追問童工處境如何改變敘述者的自我理解。" },
    }],
    ["/api/learning/interactions", {
      lessonId: lesson.id,
      interactionKey: "lessonOpened",
      clientMutationId: "csrf-hostile-learning-open",
    }],
    ["/api/reading/submission", { lessonId: "lesson-1484", words: ["逍遙", "質樸", "蓬之心"] }],
    ["/api/reading/vocab-attempt", { lessonId: "lesson-1474", itemId: "lesson-1474:v01", selectedIndex: 0 }],
    ["/api/reading/study-guide-attempt", { lessonId: "lesson-1474", itemKey: "hostile" }],
    ["/api/reading/first-read/mark", { lessonId: "lesson-1474" }],
    ["/api/reading/first-read/mark/delete", { lessonId: "lesson-1474" }],
    ["/api/reading/first-read/submit", { lessonId: "lesson-1474" }],
    ["/api/reading/first-read/resolve", { lessonId: "lesson-1474" }],
    ["/api/reading/first-read/reconcile", { lessonId: "lesson-1474" }],
  ];
  const hostileHeaders = [
    [{ "content-type": "application/json" }, 403, "web_origin_required"],
    [{ "content-type": "application/json", origin: "https://evil.bdfz.net" }, 403, "web_origin_required"],
    [{ "content-type": "application/json", origin: "null" }, 403, "web_origin_required"],
    [{ origin: "https://yw.bdfz.net", "content-type": "text/plain" }, 415, "json_content_type_required"],
    [{ origin: "https://yw.bdfz.net" }, 415, "json_content_type_required"],
  ];
  const originalFetch = globalThis.fetch;
  let outboundCalls = 0;
  globalThis.fetch = async () => {
    outboundCalls += 1;
    throw new Error("rejected Web mutation must not call APIS");
  };
  try {
    for (const [path, payload] of mutationCases) {
      for (const [headers, status, code] of hostileHeaders) {
        let environmentTouches = 0;
        const forbiddenEnv = new Proxy({}, {
          get() {
            environmentTouches += 1;
            throw new Error("rejected Web mutation must not read a binding");
          },
        });
        const response = await worker.fetch(new Request(`https://yw.bdfz.net${path}`, {
          method: "POST",
          headers: { ...headers, cookie: "bdfz_uc_session=synthetic-csrf-cookie" },
          body: JSON.stringify(payload),
        }), forbiddenEnv, {});
        assert.equal(response.status, status, `${path} ${JSON.stringify(headers)}`);
        assert.equal((await response.json()).code, code, path);
        assert.equal(environmentTouches, 0, path);
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(outboundCalls, 0);

  const seam = sourceEnvironment();
  seam.env.READING_TEST_SLUG = "csrf-test-seam-must-not-bypass";
  const seamResponse = await worker.fetch(new Request("https://yw.bdfz.net/api/reading/submission", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://evil.bdfz.net",
    },
    body: JSON.stringify({ lessonId: "lesson-1484", words: ["逍遙", "質樸", "蓬之心"] }),
  }), seam.env, {});
  assert.equal(seamResponse.status, 403);
  assert.equal(seam.writes.length, 0);
  assert.equal(seam.queued.length, 0);
});

test("same-origin Web JSON and validated native JSON remain authenticated mutation paths", async () => {
  const web = sourceEnvironment();
  let webResolutions = 0;
  web.env.USER_CENTER_EVIDENCE.resolveSession = async () => {
    webResolutions += 1;
    return {
      authenticated: true,
      sourceSiteKey: "yw",
      userId: 42,
      slug: "gap-test-student",
      displayName: "Gap Test Student",
    };
  };
  const webResponse = await worker.fetch(new Request("https://yw.bdfz.net/api/learning/interactions", {
    method: "POST",
    headers: {
      ...YW_WEB_JSON_HEADERS,
      "content-type": "application/json; charset=utf-8",
      cookie: "bdfz_uc_session=web-origin-positive-path",
    },
    body: JSON.stringify({
      lessonId: lesson.id,
      interactionKey: "lessonOpened",
      clientMutationId: "web-origin-positive-path",
    }),
  }), web.env, {});
  assert.equal(webResponse.status, 200);
  assert.equal(webResolutions, 1);
  assert.ok(web.writes.some((write) => write.sql.includes("INSERT INTO learning_interactions")));

  const native = sourceEnvironment();
  let nativeResolutions = 0;
  native.env.USER_CENTER_EVIDENCE.resolveNativeSession = async () => {
    nativeResolutions += 1;
    return {
      schemaVersion: "bdfz-native-auth/1",
      status: 200,
      authenticated: true,
      sourceSiteKey: "yw",
      clientId: "yuwen-native-android",
      capability: "data",
      userId: 42,
      slug: "gap-test-student",
      displayName: "Gap Test Student",
    };
  };
  const nativeResponse = await worker.fetch(new Request("https://yw.bdfz.net/api/learning/interactions", {
    method: "POST",
    headers: {
      authorization: `Bearer ywat_${"a".repeat(43)}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      lessonId: lesson.id,
      interactionKey: "lessonOpened",
      clientMutationId: "native-origin-independent-path",
    }),
  }), native.env, {});
  assert.equal(nativeResponse.status, 200);
  assert.equal(nativeResolutions, 1);
  assert.ok(native.writes.some((write) => write.sql.includes("INSERT INTO learning_interactions")));

  const nativePlain = sourceEnvironment();
  nativePlain.env.USER_CENTER_EVIDENCE.resolveNativeSession = async () => {
    throw new Error("non-JSON native request must fail before identity resolution");
  };
  const nativePlainResponse = await worker.fetch(new Request("https://yw.bdfz.net/api/learning/interactions", {
    method: "POST",
    headers: {
      authorization: `Bearer ywat_${"b".repeat(43)}`,
      "content-type": "text/plain",
    },
    body: JSON.stringify({ lessonId: lesson.id, interactionKey: "lessonOpened" }),
  }), nativePlain.env, {});
  assert.equal(nativePlainResponse.status, 415);
  assert.equal(nativePlain.writes.length, 0);
  assert.equal(nativePlain.queued.length, 0);

  const rejectedNative = sourceEnvironment();
  let rejectedNativeResolutions = 0;
  rejectedNative.env.USER_CENTER_EVIDENCE.resolveNativeSession = async () => {
    rejectedNativeResolutions += 1;
    return {
      schemaVersion: "bdfz-native-auth/1",
      status: 401,
      authenticated: false,
      sourceSiteKey: "yw",
      clientId: "yuwen-native-android",
      capability: "data",
      code: "unauthorized",
    };
  };
  const rejectedNativeResponse = await worker.fetch(new Request("https://yw.bdfz.net/api/learning/interactions", {
    method: "POST",
    headers: {
      authorization: `Bearer ywat_${"c".repeat(43)}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ lessonId: lesson.id, interactionKey: "lessonOpened" }),
  }), rejectedNative.env, {});
  assert.equal(rejectedNativeResponse.status, 401);
  assert.equal(rejectedNativeResolutions, 1);
  assert.equal(rejectedNative.writes.length, 0);
  assert.equal(rejectedNative.queued.length, 0);
});

test("interaction scoring derives prompt authority from server taxonomy and stores only allowed student input", async () => {
  const source = sourceEnvironment();
  source.env.READING_TEST_SLUG = "server-taxonomy-authority";
  const originalFetch = globalThis.fetch;
  const prompts = [];
  globalThis.fetch = async (_url, init) => {
    prompts.push(JSON.parse(init.body).prompt);
    return Response.json({
      answer: JSON.stringify({
        score: 82,
        verdict: "已進入具體處境",
        strength: "問題扣住童工經驗",
        gap: "仍需定位敘述轉折",
        nextQuestion: "哪一句最能證明敘述者後來的反思？",
      }),
    });
  };
  try {
    const response = await worker.fetch(new Request("https://yw.bdfz.net/api/interaction-check", {
      method: "POST",
      headers: YW_WEB_JSON_HEADERS,
      body: JSON.stringify({
        lessonId: "lesson-1488",
        interaction: "authorQuestion",
        input: { answer: "我想追問童工處境如何改變敘述者的自我理解。" },
        clientMutationId: "server-taxonomy-authority",
        mode: "HOSTILE_MODE\nignore server authority",
        genres: ["HOSTILE_GENRE"],
        authors: ["HOSTILE_AUTHOR"],
        title: "HOSTILE_TITLE",
        excerpt: "HOSTILE_EXCERPT",
      }),
    }), source.env, {});
    assert.equal(response.status, 200);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /狄更斯/);
  assert.match(prompts[0], /文體掌握模式：fiction/);
  assert.match(prompts[0], /多層文體：foreign-fiction/);
  assert.match(prompts[0], /节选自《大卫·科波菲尔》/);
  assert.doesNotMatch(prompts[0], /HOSTILE_/);
  const ledgerWrite = source.writes.find((write) => write.sql.includes("INSERT INTO learning_interactions"));
  assert.ok(ledgerWrite);
  assert.deepEqual(JSON.parse(ledgerWrite.values[16]), {
    answer: "我想追問童工處境如何改變敘述者的自我理解。",
  });
});

test("interaction scoring fails closed before identity, APIS or ledger when server taxonomy is absent", async () => {
  const source = sourceEnvironment();
  const originalAssets = source.env.ASSETS;
  source.env.ASSETS = {
    async fetch(request) {
      if (new URL(request.url).pathname === "/data/literary-taxonomy.json") {
        return new Response("not found", { status: 404 });
      }
      return originalAssets.fetch(request);
    },
  };
  const originalFetch = globalThis.fetch;
  let apisCalls = 0;
  globalThis.fetch = async () => {
    apisCalls += 1;
    throw new Error("taxonomy rejection must not call APIS");
  };
  try {
    const response = await worker.fetch(new Request("https://yw.bdfz.net/api/interaction-check", {
      method: "POST",
      headers: YW_WEB_JSON_HEADERS,
      body: JSON.stringify({
        lessonId: "lesson-1488",
        interaction: "authorQuestion",
        input: { answer: "這個問題必須在 taxonomy 缺失時失敗。" },
      }),
    }), source.env, {});
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, "authoritative lesson taxonomy unavailable");
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(apisCalls, 0);
  assert.equal(source.writes.length, 0);
  assert.equal(source.queued.length, 0);
});

test("study-guide route rejects a catalog and formative cache skew after one coherent catalog reload", async () => {
  invalidateFormativeManifestCache();
  const isolatedWorkerUrl = new URL("../site/_worker.js?route-cache-skew-hostile=1", import.meta.url);
  const { default: isolatedWorker } = await import(isolatedWorkerUrl);
  const source = sourceEnvironment();
  source.env.READING_TEST_SLUG = "gap-test-student";
  const originalAssetsFetch = source.env.ASSETS.fetch.bind(source.env.ASSETS);
  const nextCatalogDigest = `sha256:${"a".repeat(64)}`;
  const nextCatalog = structuredClone(studyGuideCatalog);
  nextCatalog.catalogDigest = nextCatalogDigest;
  const nextFormative = structuredClone(formativeManifest);
  nextFormative.studyGuideCatalogDigest = nextCatalogDigest;
  const catalogReads = [];
  let skewed = false;
  source.env.ASSETS.fetch = async (request) => {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/data/study-guide-catalog.json") {
      const value = skewed ? nextCatalog : studyGuideCatalog;
      catalogReads.push(value.catalogDigest);
      skewed = true;
      return Response.json(value);
    }
    if (pathname === "/data/lesson-competency-manifest.json" && skewed) {
      return Response.json(nextFormative);
    }
    return originalAssetsFetch(request);
  };
  const item = studyGuideCatalog.lessons
    .find((entry) => entry.lessonId === vocabLesson.id)
    .items.find((entry) => entry.activeForSelfTest);
  assert.ok(item);
  const originalFetch = globalThis.fetch;
  let apisCalls = 0;
  globalThis.fetch = async () => {
    apisCalls += 1;
    throw new Error("APIS must not run during catalog skew rejection");
  };
  try {
    const response = await isolatedWorker.fetch(new Request("https://yw.bdfz.net/api/reading/study-guide-attempt", {
      method: "POST",
      headers: YW_WEB_JSON_HEADERS,
      body: JSON.stringify({
        lessonId: vocabLesson.id,
        itemKey: item.itemKey,
        response: "我先依原句語境作答，再核對來源答案。",
        referenceRevealedAt: "2026-08-14T00:00:00.000Z",
        clientMutationId: "catalog-formative-cache-skew",
      }),
    }), source.env, {});
    const body = await response.json();
    assert.equal(response.status, 409);
    assert.equal(body.code, "study_guide_catalog_changed");
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.deepEqual(catalogReads, [studyGuideCatalog.catalogDigest, nextCatalogDigest]);
  assert.equal(apisCalls, 0);
  assert.equal(source.queued.length, 0);
  assert.equal(source.writes.some((write) => (
    /learning_interactions|learning_evaluations|evidence_outbox|learning_submission_slots/.test(write.sql)
  )), false);
});

test("learning-health request context completes the durable outbox drain through waitUntil", async () => {
  const sourceAttemptId = "018f1234-5678-7abc-9def-012345678910";
  const source = sourceEnvironment({
    outboxRows: [{
      source_event_id: sourceAttemptId,
      delivery_status: "enqueued",
      central_disposition: "pending_mapping",
      envelope_json: JSON.stringify({
        schema: "bdfz-learning-evidence-event-v2",
        contractVersion: "yw-aplus-e310-v2",
      }),
    }],
    centralReceipts: [{ sourceAttemptId, disposition: "accepted" }],
  });
  source.env.USER_CENTER_EVIDENCE.getLearningHealthReceipt = async (descriptor) => ({
    ok: true,
    schemaVersion: "bdfz-learning-source-health-receipt-v2",
    status: "healthy",
    sources: structuredClone(descriptor.sources),
    capabilities: structuredClone(descriptor.capabilities),
    activationScope: "registered_source_contract_health_only",
    persistence: "none",
    runtimeScoringActivation: false,
    affectsGrowthScore: false,
    affectsAPlus: false,
  });
  source.env.USER_CENTER_EVIDENCE.getSourceReceipt = async (descriptor) => ({
    ok: true,
    schemaVersion: 1,
    ...descriptor,
    entrypointVersion: "bdfz-growth-source-rpc-v1",
    status: "active",
  });
  const background = [];
  const response = await worker.fetch(
    new Request("https://yw.bdfz.net/api/learning/health"),
    source.env,
    { waitUntil(promise) { background.push(promise); } },
  );
  assert.equal(response.status, 200);
  assert.equal(background.length, 1);
  const [drained] = await Promise.all(background);
  assert.deepEqual(drained, {
    reconciled: { checked: 1, receipted: 1 },
    retried: { attempted: 0, enqueued: 0 },
  });
  assert.equal(source.state.outboxRows[0].central_disposition, "accepted");
  assert.equal(source.queued.length, 0);
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
  assert.match(interactionHandler, /if \(!student\) return authenticatedEvaluationRequiredResponse\(\)/);
  assert.match(interactionHandler, /submissionReservation: submissionGuard\.submissionReservation/);

  const retiredLearningCheck = workerSource.slice(
    workerSource.indexOf("async function handleLearningCheck"),
    workerSource.indexOf("async function callApisPrompt"),
  );
  assert.match(retiredLearningCheck, /untracked_learning_check_retired/);
  assert.match(retiredLearningCheck, /status: 410/);
  assert.doesNotMatch(retiredLearningCheck, /callApisPrompt/);

  const apisPrompt = workerSource.slice(
    workerSource.indexOf("async function callApisPrompt"),
    workerSource.indexOf("// ---------------- 閱讀星圖"),
  );
  assert.match(apisPrompt, /AbortController/);
  assert.match(apisPrompt, /20_000/);
  assert.match(apisPrompt, /signal: controller\.signal/);
  assert.match(apisPrompt, /clearTimeout\(timeout\)/);

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
  assert.match(studyGuideHandler, /submissionReservation: submissionGuard\.submissionReservation/);
  assert.match(studyGuideHandler, /catalog\.catalogDigest !== submittedCatalogDigest/);
  assert.match(studyGuideHandler, /item\.semanticRevision !== submittedSemanticRevision/);
  assert.ok(
    studyGuideHandler.indexOf("authoritativeStudyGuideAssessment(assessment, recorded)") >= 0,
  );
  assert.match(workerSource, /status:\s*429/);
  assert.match(workerSource, /"retry-after"/);
});

test("normal lesson opening is server-tagged only during the pre-activation transport window", () => {
  assert.equal(
    preActivationTransportLessonPhase("lessonOpened", "browser-supplied", Date.parse("2026-08-11T16:00:00.000Z")),
    "release_canary",
  );
  assert.equal(
    preActivationTransportLessonPhase("lessonOpened", "browser-supplied", Date.parse("2026-08-31T15:59:59.999Z")),
    "release_canary",
  );
  assert.equal(
    preActivationTransportLessonPhase("lessonOpened", "browser-supplied", Date.parse("2026-08-31T16:00:00.000Z")),
    "",
  );
  assert.equal(
    preActivationTransportLessonPhase("readAcknowledged", "annotated_reading", Date.parse("2026-08-20T12:00:00.000Z")),
    "annotated_reading",
  );
  const directHandler = workerSource.slice(
    workerSource.indexOf("async function handleLearningInteraction"),
    workerSource.indexOf("async function loadWordGroups"),
  );
  assert.match(
    directHandler,
    /lessonPhase: preActivationTransportLessonPhase\(interactionKey, payload\.lessonPhase\)/,
  );
});

test("an APIS evaluator outage is a retryable friendly 503 with no false receipt", async () => {
  const response = learningEvaluatorUnavailableResponse();
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("retry-after"), "15");
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "評閱服務暫時繁忙，本次答案尚未記錄，請稍後重試",
    code: "learning_evaluator_unavailable",
    retryable: true,
    retryAfterSeconds: 15,
  });
  const interactionHandler = workerSource.slice(
    workerSource.indexOf("async function handleInteractionCheck"),
    workerSource.indexOf("async function handleLearningCheck"),
  );
  assert.ok(
    interactionHandler.indexOf("releaseAfterEvaluatorFailure")
      < interactionHandler.indexOf("return learningEvaluatorUnavailableResponse()"),
  );
  assert.ok(
    interactionHandler.indexOf("return learningEvaluatorUnavailableResponse()")
      < interactionHandler.indexOf("recordLearningInteraction"),
  );
});

test("retired public evaluators spend no APIS calls and learning-check keeps My authentication", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("retired public evaluator must not call APIS");
  };
  try {
    const chat = await worker.fetch(new Request("https://yw.bdfz.net/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "請解釋" }] }),
    }), {});
    assert.equal(chat.status, 410);
    assert.equal((await chat.json()).code, "legacy_chat_retired");

    const anonymous = await worker.fetch(new Request("https://yw.bdfz.net/api/learning-check", {
      method: "POST",
    }), {});
    assert.equal(anonymous.status, 401);
    assert.equal((await anonymous.json()).code, "authenticated_evaluation_required");

    const authenticatedSource = sourceEnvironment();
    authenticatedSource.env.READING_TEST_SLUG = "retired-learning-check-test";
    const authenticated = await worker.fetch(new Request("https://yw.bdfz.net/api/learning-check", {
      method: "POST",
    }), authenticatedSource.env);
    assert.equal(authenticated.status, 410);
    assert.equal((await authenticated.json()).code, "untracked_learning_check_retired");
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("an evaluator outage permits one immediate same-answer route retry without another slot", async () => {
  const db = new DatabaseSync(":memory:");
  const originalFetch = globalThis.fetch;
  try {
    initializeLearningContractDb(db);
    const siteManifest = JSON.parse(readFileSync(resolve(ROOT, "site/data/manifest.json"), "utf8"));
    const lessonData = JSON.parse(readFileSync(resolve(ROOT, "site/data/lessons/lesson-1497.json"), "utf8"));
    const queued = [];
    const env = {
      READING_TEST_SLUG: "route-evaluator-retry",
      READING_DB: sqliteD1(db),
      LEARNING_EVIDENCE_QUEUE: {
        async send(envelope, options) { queued.push({ envelope, options }); },
      },
      ASSETS: {
        async fetch(request) {
          const pathname = new URL(request.url).pathname;
          if (pathname === "/data/manifest.json") return Response.json(siteManifest);
          if (pathname === "/data/lessons/lesson-1497.json") return Response.json(lessonData);
          if (pathname === "/data/literary-taxonomy.json") return Response.json(literaryTaxonomy);
          if (pathname === "/data/interaction-definitions.json") return Response.json(registry);
          if (pathname === "/data/learning-manifest.json") return Response.json(manifest);
          if (pathname === "/data/lesson-competency-manifest.json") return Response.json(formativeManifest);
          return new Response("not found", { status: 404 });
        },
      },
    };
    let evaluatorCalls = 0;
    let evaluatorMode = "outage-once";
    globalThis.fetch = async () => {
      evaluatorCalls += 1;
      if (evaluatorMode === "outage-once" && evaluatorCalls === 1) {
        throw new Error("simulated evaluator outage");
      }
      if (evaluatorMode === "non-json") return Response.json({ answer: "not-json" });
      if (evaluatorMode === "invalid-normalized") {
        return Response.json({ answer: JSON.stringify({
          score: "82",
          verdict: "格式錯誤",
          strength: "格式錯誤",
          gap: "格式錯誤",
          nextQuestion: "格式錯誤",
        }) });
      }
      return Response.json({
        answer: JSON.stringify({
          score: 82,
          verdict: "已完成評閱。",
          strength: "能用新學詞造句。",
          gap: "還可補充語境。",
          nextQuestion: "這個詞在原句中有何語氣？",
        }),
      });
    };
    const request = (clientMutationId = "route-immediate-evaluator-retry") => new Request("https://yw.bdfz.net/api/interaction-check", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://yw.bdfz.net",
      },
      body: JSON.stringify({
        lessonId: "lesson-1497",
        interaction: "wordCreation",
        mode: "poetry",
        input: {
          word: "同袍",
          creation: "風雪同行，彼此如同袍般守望。",
        },
        clientMutationId,
      }),
    });

    const failed = await worker.fetch(request(), env, {});
    assert.equal(failed.status, 503);
    assert.equal(failed.headers.get("retry-after"), "15");
    assert.deepEqual(await failed.json(), {
      ok: false,
      error: "評閱服務暫時繁忙，本次答案尚未記錄，請稍後重試",
      code: "learning_evaluator_unavailable",
      retryable: true,
      retryAfterSeconds: 15,
    });
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM learning_submission_slots").get().n, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM learning_interactions").get().n, 0);

    const retried = await worker.fetch(request(), env, {});
    const retriedBody = await retried.json();
    assert.equal(retried.status, 200);
    assert.equal(retriedBody.assessment.score, 82);
    assert.equal(evaluatorCalls, 2);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM learning_submission_slots").get().n, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM learning_interactions").get().n, 1);
    assert.ok(queued.length <= 1, "the retry cannot enqueue more than one evidence envelope");

    const replay = await worker.fetch(request(), env, {});
    assert.equal(replay.status, 200);
    assert.equal((await replay.json()).deduped, true);
    assert.equal(evaluatorCalls, 2);

    evaluatorMode = "non-json";
    const nonJson = await worker.fetch(request("route-non-json-evaluator-retry"), env, {});
    assert.equal(nonJson.status, 503);
    assert.equal((await nonJson.json()).code, "learning_evaluator_unavailable");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM learning_submission_slots").get().n, 2);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM learning_interactions").get().n, 1);

    evaluatorMode = "invalid-normalized";
    const invalidNormalized = await worker.fetch(request("route-invalid-normalized-evaluator-retry"), env, {});
    assert.equal(invalidNormalized.status, 503);
    assert.equal((await invalidNormalized.json()).code, "learning_evaluator_unavailable");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM learning_submission_slots").get().n, 3);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM learning_interactions").get().n, 1);
  } finally {
    globalThis.fetch = originalFetch;
    db.close();
  }
});

test("a ledger recording failure keeps the evaluator lease live and blocks another APIS call", async () => {
  const db = new DatabaseSync(":memory:");
  const originalFetch = globalThis.fetch;
  try {
    initializeLearningContractDb(db);
    const siteManifest = JSON.parse(readFileSync(resolve(ROOT, "site/data/manifest.json"), "utf8"));
    const lessonData = JSON.parse(readFileSync(resolve(ROOT, "site/data/lessons/lesson-1497.json"), "utf8"));
    const d1 = sqliteD1(db);
    const env = {
      READING_TEST_SLUG: "route-recording-failure",
      READING_DB: {
        prepare: d1.prepare.bind(d1),
        async batch() {
          throw new Error("simulated ledger record failure");
        },
      },
      LEARNING_EVIDENCE_QUEUE: {
        async send() {
          throw new Error("record failure must occur before queue delivery");
        },
      },
      ASSETS: {
        async fetch(request) {
          const pathname = new URL(request.url).pathname;
          if (pathname === "/data/manifest.json") return Response.json(siteManifest);
          if (pathname === "/data/lessons/lesson-1497.json") return Response.json(lessonData);
          if (pathname === "/data/literary-taxonomy.json") return Response.json(literaryTaxonomy);
          if (pathname === "/data/interaction-definitions.json") return Response.json(registry);
          if (pathname === "/data/learning-manifest.json") return Response.json(manifest);
          if (pathname === "/data/lesson-competency-manifest.json") return Response.json(formativeManifest);
          return new Response("not found", { status: 404 });
        },
      },
    };
    let evaluatorCalls = 0;
    globalThis.fetch = async () => {
      evaluatorCalls += 1;
      return Response.json({
        answer: JSON.stringify({
          score: 82,
          verdict: "已完成評閱。",
          strength: "能用新學詞造句。",
          gap: "還可補充語境。",
          nextQuestion: "這個詞在原句中有何語氣？",
        }),
      });
    };
    const request = () => new Request("https://yw.bdfz.net/api/interaction-check", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://yw.bdfz.net",
      },
      body: JSON.stringify({
        lessonId: "lesson-1497",
        interaction: "wordCreation",
        mode: "poetry",
        input: {
          word: "同袍",
          creation: "風雪同行，彼此如同袍般守望。",
        },
        clientMutationId: "route-ledger-recording-failure",
      }),
    });

    const failed = await worker.fetch(request(), env, {});
    assert.equal(failed.status, 502);
    assert.match((await failed.json()).error, /simulated ledger record failure/);
    assert.equal(evaluatorCalls, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM learning_submission_slots").get().n, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM learning_interactions").get().n, 0);
    assert.match(
      db.prepare("SELECT created_at FROM learning_submission_slots").get().created_at,
      /\.000Z$/,
    );

    const immediateRetry = await worker.fetch(request(), env, {});
    const retryBody = await immediateRetry.json();
    assert.equal(immediateRetry.status, 409);
    assert.equal(retryBody.code, "learning_submission_in_progress");
    assert.equal(evaluatorCalls, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM learning_interactions").get().n, 0);
  } finally {
    globalThis.fetch = originalFetch;
    db.close();
  }
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

test("normal interaction route rejects client-forged occurrence time or academic year", () => {
  const workerSource = readFileSync(new URL("../site/_worker.js", import.meta.url), "utf8");
  const handler = workerSource.slice(
    workerSource.indexOf("async function handleLearningInteraction"),
    workerSource.indexOf("async function handleReadingStudyGuideAttempt"),
  );
  assert.match(handler, /Object\.hasOwn\(payload, "occurredAt"\)/);
  assert.match(handler, /Object\.hasOwn\(payload, "academicYear"\)/);
  assert.match(handler, /server time authority required/);
  assert.match(handler, /422/);
});

test("reading submission score resolves only from the same student's matching context-words evidence", async () => {
  let capturedSql = "";
  let capturedValues = [];
  const db = {
    prepare(sql) {
      capturedSql = sql;
      return {
        bind(...values) {
          capturedValues = values;
          return {
            async first() {
              return {
                raw_payload_json: JSON.stringify({ words: "逍遙，質樸，蓬之心" }),
                raw_value: 87.6,
                evaluation_json: JSON.stringify({ verdict: "已由源端核對" }),
              };
            },
          };
        },
      };
    },
  };
  const assessment = await authoritativeReadingAssessmentForSubmission(
    db,
    7,
    "lesson-1484",
    "trusted-source-event",
    ["逍遥", "质朴", "蓬之心"],
  );
  assert.deepEqual(assessment, { score: 88, verdict: "已由源端核對" });
  assert.match(capturedSql, /i\.source_event_id = \?/);
  assert.match(capturedSql, /i\.student_id = \?/);
  assert.match(capturedSql, /i\.lesson_id = \?/);
  assert.match(capturedSql, /i\.interaction_key = 'contextWords'/);
  assert.match(capturedSql, /i\.scoring_role = 'a_plus_gate'/);
  assert.match(capturedSql, /e\.verification_method = 'source_ai_assessment'/);
  assert.deepEqual(capturedValues, ["trusted-source-event", 7, "lesson-1484"]);
});

test("reading submission rejects an authoritative event whose assessed words do not match", async () => {
  const db = {
    prepare() {
      return {
        bind() {
          return {
            async first() {
              return {
                raw_payload_json: JSON.stringify({ words: "另外，三個，詞語" }),
                raw_value: 100,
                evaluation_json: JSON.stringify({ verdict: "不可挪用" }),
              };
            },
          };
        },
      };
    },
  };
  assert.equal(await authoritativeReadingAssessmentForSubmission(
    db,
    7,
    "lesson-1484",
    "other-source-event",
    ["逍遥", "质朴", "蓬之心"],
  ), null);
});

test("unassessed dedupe clears a legacy browser score instead of relabeling it live", async () => {
  const source = sourceEnvironment({
    existingReadingSubmission: { id: 91, is_active: 1, version: 4 },
  });
  source.env.READING_TEST_SLUG = "legacy-score-replay";
  const response = await worker.fetch(new Request("https://yw.bdfz.net/api/reading/submission", {
    method: "POST",
    headers: YW_WEB_JSON_HEADERS,
    body: JSON.stringify({
      lessonId: "lesson-1484",
      words: ["逍遙", "質樸", "蓬之心"],
    }),
  }), source.env, {});
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, deduped: true, version: 4 });
  const cleanup = source.writes.find((write) => write.sql.includes("UPDATE submissions SET is_active = 1"));
  assert.match(cleanup?.sql || "", /ai_score = NULL/);
  assert.match(cleanup?.sql || "", /ai_verdict = ''/);
  assert.deepEqual(cleanup?.values, ["synthetic", 91]);
});

test("only source evidence matching an actual submitted word set can brighten or appear", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    initializeLearningContractDb(db);
    db.prepare(
      `INSERT INTO submissions (
         student_id, lesson_id, block_id, block_title, lesson_title,
         words_raw, words_norm, content_hash, ai_score, ai_verdict, version, is_active, source
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?)`
    ).run(
      7,
      "lesson-1484",
      "xuanbi-shang",
      "選必上",
      "五石之瓠",
      JSON.stringify(["逍遙", "質樸", "蓬之心"]),
      JSON.stringify(["逍遥", "质朴", "蓬之心"]),
      "legacy-browser-forged-content-hash",
      100,
      "browser-forged-perfect",
      "synthetic",
    );
    db.prepare(
      `INSERT INTO learning_interactions (
         source_event_id, student_id, uc_user_id, academic_year, lesson_id,
         interaction_key, event_type, assessment_kind, scoring_role,
         resource_key, resource_version, registry_version, raw_payload_json, occurred_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "unsubmitted-perfect-source-event",
      7,
      42,
      "2026-2027",
      "lesson-1484",
      "contextWords",
      "context_words_assessed",
      "performance",
      "a_plus_gate",
      "lesson-1484:contextWords",
      "sha256:hostile-unsubmitted-word-set",
      "hostile-regression",
      JSON.stringify({ words: ["丁", "戊", "己"] }),
      "2026-08-20T00:00:00.000Z",
    );
    db.prepare(
      `INSERT INTO learning_evaluations (
         source_event_id, verification_method, eligibility_status, raw_value,
         max_value, normalized_value, correctness, evaluation_json, evaluated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "unsubmitted-perfect-source-event",
      "source_ai_assessment",
      "eligible",
      100,
      100,
      1,
      "passed",
      JSON.stringify({ verdict: "genuine but not submitted words" }),
      "2026-08-20T00:00:01.000Z",
    );
    db.prepare(
      "INSERT INTO star_nodes (student_id, node_id, kind, ref, seq) VALUES (?, ?, ?, ?, ?)"
    ).run(7, "lesson:lesson-1484", "lesson", "lesson-1484", 1);
    const source = sourceEnvironment();
    source.env.READING_DB = sqliteD1(db);
    source.env.USER_CENTER_EVIDENCE.resolveSession = async () => ({
      authenticated: true,
      sourceSiteKey: "yw",
      userId: 42,
      slug: "lease-test-student",
      displayName: "Lease Test Student",
    });
    const authenticatedRequest = (url) => new Request(url, {
      headers: { cookie: "bdfz_uc_session=hostile-source-projection" },
    });

    const constellationResponse = await worker.fetch(
      authenticatedRequest("https://yw.bdfz.net/api/reading/constellation"),
      source.env,
      {},
    );
    assert.equal(constellationResponse.status, 200);
    const constellation = await constellationResponse.json();
    const lessonNode = constellation.nodes.find((node) => node.ref === "lesson-1484");
    assert.equal(lessonNode.meta.bestScore, 0);
    assert.equal(lessonNode.c, 1.5);

    const detailResponse = await worker.fetch(
      authenticatedRequest("https://yw.bdfz.net/api/reading/lesson/lesson-1484"),
      source.env,
      {},
    );
    assert.equal(detailResponse.status, 200);
    const detail = await detailResponse.json();
    assert.equal(detail.history[0].aiScore, null);
    assert.equal(detail.history[0].aiVerdict, "");
    assert.equal(detail.history[0].source, "live");
  } finally {
    db.close();
  }
});

test("unknown first-read lessons fail before every target-table mutation", async () => {
  const paragraph = vocabFirstRead.paragraphs[0];
  const selectedText = paragraph.text.slice(0, 1);
  const base = {
    lessonId: "lesson-1474",
    textVersionId: vocabFirstRead.textVersionId,
    textDigest: vocabFirstRead.textDigest,
  };
  const cases = [
    ["/api/reading/first-read/mark", {
      ...base,
      paragraphKey: paragraph.key,
      startOffset: 0,
      endOffset: 1,
      selectedText,
      guess: "hostile orphan asset mark",
      clientMutationId: "hostile-orphan-first-read-mark",
    }, false],
    ["/api/reading/first-read/mark/delete", { ...base, markId: "hostile-orphan-mark" }, false],
    ["/api/reading/first-read/submit", {
      ...base,
      summary: "hostile orphan asset summary must never be stored",
    }, false],
    ["/api/reading/first-read/resolve", {
      ...base,
      markId: "hostile-orphan-mark",
      correction: "hostile orphan correction",
    }, true],
  ];
  for (const [path, payload, firstReadSubmitted] of cases) {
    const source = sourceEnvironment({ firstReadSubmitted });
    source.env.READING_TEST_SLUG = `orphan-first-read-${path.split("/").at(-1)}`;
    const originalAssets = source.env.ASSETS;
    source.env.ASSETS = {
      async fetch(request) {
        if (new URL(request.url).pathname === "/data/manifest.json") {
          return Response.json({ ...courseManifest, lessons: [] });
        }
        return originalAssets.fetch(request);
      },
    };
    const response = await worker.fetch(new Request(`https://yw.bdfz.net${path}`, {
      method: "POST",
      headers: YW_WEB_JSON_HEADERS,
      body: JSON.stringify(payload),
    }), source.env, {});
    assert.equal(response.status, 400, path);
    assert.equal((await response.json()).error, "lesson absent from authoritative catalog", path);
    const targetWrites = source.writes.filter((write) => (
      /classical_first_read_|learning_interactions|learning_evaluations|evidence_outbox/.test(write.sql)
    ));
    assert.deepEqual(targetWrites, [], path);
    assert.equal(source.queued.length, 0, path);
  }
});

test("legacy public discussion writes are retired without touching GitHub", async () => {
  const source = sourceEnvironment();
  source.env.GITHUB_TOKEN = "synthetic-test-only";
  const originalFetch = globalThis.fetch;
  let outboundRequests = 0;
  globalThis.fetch = async () => {
    outboundRequests += 1;
    throw new Error("retired discussion writes must not make an outbound request");
  };
  try {
    const response = await worker.fetch(new Request("https://yw.bdfz.net/api/discussions/lesson-1484", {
      method: "POST",
      headers: YW_WEB_JSON_HEADERS,
      body: JSON.stringify({
        name: "hostile anonymous caller",
        body: "attempt to create an unbounded GitHub comment",
      }),
    }), source.env, {});
    assert.equal(response.status, 410);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), {
      error: "legacy discussion writes are retired",
      code: "discussion_write_retired",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(outboundRequests, 0);
  assert.equal(source.writes.length, 0);
  assert.equal(source.queued.length, 0);
});

test("health probes and interactions reconcile central receipts before bounded re-enqueue", () => {
  const workerSource = readFileSync(new URL("../site/_worker.js", import.meta.url), "utf8");
  const evidenceSource = readFileSync(new URL("../site/learning-evidence-source.js", import.meta.url), "utf8");
  assert.match(workerSource, /\/api\/learning\/health[\s\S]*ctx\?\.waitUntil\) ctx\.waitUntil\(drainEvidenceOutbox\(env, 50\)\)/);
  assert.match(workerSource, /handleLearningInteraction[\s\S]*drainEvidenceOutbox\(env, 5\)/);
  assert.match(evidenceSource, /delivery_status IN \('pending', 'enqueued'\)/);
  assert.match(evidenceSource, /datetime\(last_attempt_at\) < datetime\('now', '-15 minutes'\)/);
  assert.match(evidenceSource, /central_receipted_at IS NULL OR datetime\(central_receipted_at\) < datetime\('now', '-15 minutes'\)/);
});

test("reading health exposes schema v5 only with the central receipt recovery index", () => {
  assert.match(workerSource, /'idx_evidence_outbox_v2_recovery'/);
  assert.match(workerSource, /Number\(indexes\?\.n\) !== 9/);
  assert.match(workerSource, /schemaVersion: "reading-schema-v5"/);
});

test("ISO outbox attempt timestamps become retryable at the exact SQLite stale boundary", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE evidence_outbox (
      id INTEGER PRIMARY KEY,
      source_event_id TEXT NOT NULL,
      envelope_json TEXT NOT NULL,
      delivery_status TEXT NOT NULL,
      central_disposition TEXT,
      last_attempt_at TEXT,
      created_at TEXT NOT NULL
    )`);
    db.exec(`INSERT INTO evidence_outbox VALUES
      (1, 'pending-old', '{"schema":"bdfz-learning-evidence-event-v2","contractVersion":"yw-aplus-e310-v2"}', 'pending', NULL, strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-16 minutes'), datetime('now', '-16 minutes')),
      (2, 'enqueued-old', '{"schema":"bdfz-learning-evidence-event-v2","contractVersion":"yw-aplus-e310-v2"}', 'enqueued', NULL, strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-16 minutes'), datetime('now', '-16 minutes')),
      (3, 'enqueued-fresh', '{"schema":"bdfz-learning-evidence-event-v2","contractVersion":"yw-aplus-e310-v2"}', 'enqueued', NULL, strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-14 minutes'), datetime('now', '-14 minutes')),
      (4, 'accepted-old', '{"schema":"bdfz-learning-evidence-event-v2","contractVersion":"yw-aplus-e310-v2"}', 'enqueued', 'accepted', strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-1 day'), datetime('now', '-1 day')),
      (5, 'legacy-v1', '{"schema":"bdfz-learning-evidence-v1"}', 'pending', NULL, strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-1 day'), datetime('now', '-1 day')),
      (6, 'mapping-old', '{"schema":"bdfz-learning-evidence-event-v2","contractVersion":"yw-aplus-e310-v2"}', 'enqueued', 'pending_mapping', strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-1 day'), datetime('now', '-1 day')),
      (7, 'quarantined-old', '{"schema":"bdfz-learning-evidence-event-v2","contractVersion":"yw-aplus-e310-v2"}', 'pending', 'quarantined', strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-1 day'), datetime('now', '-1 day'))`);
    const rows = db.prepare(OUTBOX_RETRY_SELECTION_SQL).all(50);
    assert.deepEqual(rows.map((row) => row.source_event_id), ["pending-old", "enqueued-old"]);
  } finally {
    db.close();
  }
});

test("central receipt reconciliation skips fresh health polls for fifteen minutes", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE evidence_outbox (
      id INTEGER PRIMARY KEY,
      source_event_id TEXT NOT NULL,
      envelope_json TEXT NOT NULL,
      delivery_status TEXT NOT NULL,
      central_disposition TEXT,
      central_receipted_at TEXT,
      last_attempt_at TEXT,
      created_at TEXT NOT NULL
    )`);
    db.exec(`INSERT INTO evidence_outbox VALUES
      (1, 'absent-old', '{"schema":"bdfz-learning-evidence-event-v2","contractVersion":"yw-aplus-e310-v2"}', 'enqueued', NULL, datetime('now', '-16 minutes'), datetime('now', '-16 minutes'), datetime('now', '-16 minutes')),
      (2, 'absent-fresh', '{"schema":"bdfz-learning-evidence-event-v2","contractVersion":"yw-aplus-e310-v2"}', 'enqueued', NULL, datetime('now', '-14 minutes'), datetime('now', '-14 minutes'), datetime('now', '-14 minutes')),
      (3, 'mapping-old', '{"schema":"bdfz-learning-evidence-event-v2","contractVersion":"yw-aplus-e310-v2"}', 'enqueued', 'pending_mapping', datetime('now', '-16 minutes'), datetime('now', '-1 day'), datetime('now', '-1 day')),
      (4, 'mapping-fresh', '{"schema":"bdfz-learning-evidence-event-v2","contractVersion":"yw-aplus-e310-v2"}', 'enqueued', 'pending_mapping', datetime('now', '-14 minutes'), datetime('now', '-1 day'), datetime('now', '-1 day'))`);
    const rows = db.prepare(OUTBOX_RECONCILE_SELECTION_SQL).all(50);
    assert.deepEqual(rows.map((row) => row.source_event_id), ["absent-old", "mapping-old"]);
  } finally {
    db.close();
  }
});

test("receipt reconciliation cooldown is D1-backed across concurrent isolates", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE evidence_outbox (
      id INTEGER PRIMARY KEY,
      source_event_id TEXT NOT NULL UNIQUE,
      envelope_json TEXT NOT NULL,
      delivery_status TEXT NOT NULL,
      central_disposition TEXT,
      central_receipted_at TEXT,
      last_attempt_at TEXT,
      created_at TEXT NOT NULL
    )`);
    db.exec(`INSERT INTO evidence_outbox VALUES
      (1, 'cross-isolate-poll', '{"schema":"bdfz-learning-evidence-event-v2","contractVersion":"yw-aplus-e310-v2"}', 'enqueued', NULL, NULL, datetime('now', '-16 minutes'), datetime('now', '-16 minutes'))`);
    let rpcCalls = 0;
    const environments = Array.from({ length: 20 }, () => ({
      READING_DB: sqliteD1(db),
      USER_CENTER_EVIDENCE: {
        async getLearningEvidenceDeliveryReceipts() {
          rpcCalls += 1;
          await Promise.resolve();
          return {
            schemaVersion: "bdfz-learning-evidence-delivery-receipts-v1",
            sourceSiteKey: "yw",
            contractVersion: "yw-aplus-e310-v2",
            receipts: [],
          };
        },
      },
    }));
    const firstWave = await Promise.all(environments.map((env) => reconcileEvidenceOutbox(env, 50)));
    assert.equal(rpcCalls, 1);
    assert.equal(firstWave.reduce((sum, result) => sum + result.checked, 0), 1);
    assert.deepEqual(await reconcileEvidenceOutbox(environments[0], 50), { checked: 0, receipted: 0 });
    assert.equal(rpcCalls, 1);

    db.exec("UPDATE evidence_outbox SET central_receipted_at = datetime('now', '-16 minutes')");
    assert.deepEqual(await reconcileEvidenceOutbox(environments[0], 50), { checked: 1, receipted: 0 });
    assert.equal(rpcCalls, 2);
  } finally {
    db.close();
  }
});

test("central durable receipt stops blind resend while pending mapping remains reconcilable", async () => {
  const acceptedId = "018f1234-5678-7abc-9def-012345678901";
  const pendingId = "018f1234-5678-7abc-9def-012345678902";
  const absentId = "018f1234-5678-7abc-9def-012345678903";
  const receipt = sourceEnvironment({
    outboxRows: [
      { source_event_id: acceptedId, delivery_status: "enqueued", envelope_json: JSON.stringify({ schema: "bdfz-learning-evidence-event-v2", contractVersion: "yw-aplus-e310-v2", userId: 42 }) },
      { source_event_id: pendingId, delivery_status: "enqueued", envelope_json: JSON.stringify({ schema: "bdfz-learning-evidence-event-v2", contractVersion: "yw-aplus-e310-v2", userId: 42 }) },
      { source_event_id: absentId, delivery_status: "enqueued", envelope_json: JSON.stringify({ schema: "bdfz-learning-evidence-event-v2", contractVersion: "yw-aplus-e310-v2", userId: 42 }) },
    ],
    centralReceipts: [
      { sourceAttemptId: acceptedId, disposition: "accepted" },
      { sourceAttemptId: pendingId, disposition: "pending_mapping" },
    ],
  });
  const result = await drainEvidenceOutbox(receipt.env, 50);
  assert.deepEqual(result.reconciled, { checked: 3, receipted: 2 });
  const terminalUpdates = receipt.writes.filter((write) => (
    write.sql.includes("SET central_disposition = ?") && write.sql.includes("central_receipted_at")
  ));
  assert.deepEqual(terminalUpdates.map((write) => [write.values[0], write.values[3]]), [
    ["accepted", acceptedId],
    ["pending_mapping", pendingId],
  ]);
  assert.equal(receipt.queued.length, 1);
  assert.equal(receipt.state.outboxRows.find((row) => row.source_event_id === acceptedId).central_disposition, "accepted");
  assert.equal(receipt.state.outboxRows.find((row) => row.source_event_id === pendingId).central_disposition, "pending_mapping");

  receipt.env.USER_CENTER_EVIDENCE.getLearningEvidenceDeliveryReceipts = async (sourceAttemptIds) => ({
    schemaVersion: "bdfz-learning-evidence-delivery-receipts-v1",
    sourceSiteKey: "yw",
    contractVersion: "yw-aplus-e310-v2",
    receipts: sourceAttemptIds.includes(pendingId)
      ? [{ sourceAttemptId: pendingId, disposition: "accepted" }]
      : [],
  });
  receipt.queued.length = 0;
  const completed = await drainEvidenceOutbox(receipt.env, 50);
  assert.deepEqual(completed.reconciled, { checked: 2, receipted: 1 });
  assert.equal(receipt.state.outboxRows.find((row) => row.source_event_id === pendingId).central_disposition, "accepted");
  assert.equal(receipt.queued.length, 1, "only the still-absent attempt remains transport-retryable");
});

test("malformed central receipt is ignored and cannot terminate a source outbox row", async () => {
  const id = "018f1234-5678-7abc-9def-012345678904";
  const receipt = sourceEnvironment({
    outboxRows: [{ source_event_id: id, delivery_status: "enqueued", envelope_json: JSON.stringify({ schema: "bdfz-learning-evidence-event-v2", contractVersion: "yw-aplus-e310-v2", userId: 42 }) }],
  });
  receipt.env.USER_CENTER_EVIDENCE.getLearningEvidenceDeliveryReceipts = async () => ({
    schemaVersion: "bdfz-learning-evidence-delivery-receipts-v1",
    sourceSiteKey: "forged",
    contractVersion: "yw-aplus-e310-v2",
    receipts: [{ sourceAttemptId: id, disposition: "accepted" }],
  });
  const result = await drainEvidenceOutbox(receipt.env, 50);
  assert.deepEqual(result.reconciled, { checked: 1, receipted: 0 });
  assert.equal(receipt.writes.some((write) => (
    write.sql.includes("SET central_disposition = ?") && write.sql.includes("central_receipted_at")
  )), false);
});

test("unchanged pending-mapping receipt refreshes only the bounded poll lease", async () => {
  const id = "018f1234-5678-7abc-9def-012345678905";
  const receipt = sourceEnvironment({
    outboxRows: [{
      source_event_id: id,
      delivery_status: "enqueued",
      central_disposition: "pending_mapping",
      envelope_json: JSON.stringify({
        schema: "bdfz-learning-evidence-event-v2",
        contractVersion: "yw-aplus-e310-v2",
        userId: 42,
      }),
    }],
    centralReceipts: [{ sourceAttemptId: id, disposition: "pending_mapping" }],
  });
  const result = await drainEvidenceOutbox(receipt.env, 50);
  assert.deepEqual(result.reconciled, { checked: 1, receipted: 0 });
  assert.equal(receipt.writes.some((write) => write.sql.includes("SET central_disposition = ?")), false);
  assert.equal(receipt.writes.some((write) => write.sql.includes("SET central_receipted_at = ?")), true);
  assert.equal(receipt.queued.length, 0);
});

test("pending mapping advances monotonically to quarantine without another queue send", async () => {
  const id = "018f1234-5678-7abc-9def-012345678906";
  const receipt = sourceEnvironment({
    outboxRows: [{
      source_event_id: id,
      delivery_status: "enqueued",
      central_disposition: "pending_mapping",
      envelope_json: JSON.stringify({
        schema: "bdfz-learning-evidence-event-v2",
        contractVersion: "yw-aplus-e310-v2",
        userId: 42,
      }),
    }],
    centralReceipts: [{ sourceAttemptId: id, disposition: "quarantined" }],
  });
  const result = await drainEvidenceOutbox(receipt.env, 50);
  assert.deepEqual(result, {
    reconciled: { checked: 1, receipted: 1 },
    retried: { attempted: 0, enqueued: 0 },
  });
  assert.equal(receipt.state.outboxRows[0].central_disposition, "quarantined");
  assert.equal(receipt.queued.length, 0);
});

test("accepted and quarantined terminal receipts are never polled, rewritten, or retried", async () => {
  const acceptedId = "018f1234-5678-7abc-9def-012345678907";
  const quarantinedId = "018f1234-5678-7abc-9def-012345678908";
  const receipt = sourceEnvironment({
    outboxRows: [
      {
        source_event_id: acceptedId,
        delivery_status: "enqueued",
        central_disposition: "accepted",
        envelope_json: JSON.stringify({ schema: "bdfz-learning-evidence-event-v2", contractVersion: "yw-aplus-e310-v2" }),
      },
      {
        source_event_id: quarantinedId,
        delivery_status: "pending",
        central_disposition: "quarantined",
        envelope_json: JSON.stringify({ schema: "bdfz-learning-evidence-event-v2", contractVersion: "yw-aplus-e310-v2" }),
      },
    ],
  });
  let receiptCalls = 0;
  receipt.env.USER_CENTER_EVIDENCE.getLearningEvidenceDeliveryReceipts = async () => {
    receiptCalls += 1;
    throw new Error("terminal dispositions must not be polled");
  };
  const result = await drainEvidenceOutbox(receipt.env, 50);
  assert.deepEqual(result, {
    reconciled: { checked: 0, receipted: 0 },
    retried: { attempted: 0, enqueued: 0 },
  });
  assert.equal(receiptCalls, 0);
  assert.deepEqual(receipt.state.outboxRows.map((row) => row.central_disposition), [
    "accepted",
    "quarantined",
  ]);
  assert.equal(receipt.writes.some((write) => write.sql.includes("SET central_disposition = ?")), false);
  assert.equal(receipt.queued.length, 0);
});

test("a stale pending-mapping poll cannot overwrite a concurrent terminal decision", async () => {
  const id = "018f1234-5678-7abc-9def-012345678909";
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE evidence_outbox (
      id INTEGER PRIMARY KEY,
      source_event_id TEXT NOT NULL UNIQUE,
      envelope_json TEXT NOT NULL,
      delivery_status TEXT NOT NULL,
      delivery_attempts INTEGER NOT NULL DEFAULT 0,
      last_error_class TEXT NOT NULL DEFAULT '',
      last_attempt_at TEXT,
      delivered_at TEXT,
      central_disposition TEXT,
      central_receipted_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    db.prepare(
      `INSERT INTO evidence_outbox (
        source_event_id, envelope_json, delivery_status, last_attempt_at, central_disposition
      ) VALUES (?, ?, 'enqueued', datetime('now', '-1 day'), 'pending_mapping')`
    ).run(id, JSON.stringify({
      schema: "bdfz-learning-evidence-event-v2",
      contractVersion: "yw-aplus-e310-v2",
    }));
    let queueCalls = 0;
    const env = {
      READING_DB: sqliteD1(db),
      LEARNING_EVIDENCE_QUEUE: {
        async send() {
          queueCalls += 1;
        },
      },
      USER_CENTER_EVIDENCE: {
        async getLearningEvidenceDeliveryReceipts() {
          db.prepare(
            "UPDATE evidence_outbox SET central_disposition = 'accepted' WHERE source_event_id = ?"
          ).run(id);
          return {
            schemaVersion: "bdfz-learning-evidence-delivery-receipts-v1",
            sourceSiteKey: "yw",
            contractVersion: "yw-aplus-e310-v2",
            receipts: [{ sourceAttemptId: id, disposition: "quarantined" }],
          };
        },
      },
    };
    const result = await drainEvidenceOutbox(env, 50);
    assert.deepEqual(result, {
      reconciled: { checked: 1, receipted: 0 },
      retried: { attempted: 0, enqueued: 0 },
    });
    assert.equal(
      db.prepare("SELECT central_disposition FROM evidence_outbox WHERE source_event_id = ?").get(id).central_disposition,
      "accepted",
    );
    assert.equal(queueCalls, 0);
  } finally {
    db.close();
  }
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

test("study-guide guard rejects a catalog digest that does not match the formative authority before reserving", async () => {
  const studyItem = formativeManifest.lessons
    .find((entry) => entry.lessonId === vocabLesson.id)
    .competencies.flatMap((entry) => entry.items)
    .find((entry) => entry.interactionKey === "studyGuideItemCompleted");
  const source = sourceEnvironment();
  await assert.rejects(
    assertLearningSubmissionAllowed({
      request: new Request("https://yw.bdfz.net/api/reading/study-guide-attempt"),
      env: source.env,
      student: { id: 7, ucUserId: 42 },
      lesson: vocabLesson,
      interactionKey: "studyGuideItemCompleted",
      payload: {
        itemKey: studyItem.itemKey,
        response: "我先完成自己的回答，再核对来源答案。",
        referenceRevealedAt: "2026-08-13T22:00:00.000Z",
        clientMutationId: "catalog-drift-mutation",
      },
      expectedStudyGuideCatalogDigest: "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    }),
    (error) => error?.code === "study_guide_catalog_drift",
  );
  assert.equal(source.writes.length, 0);
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
  assert.equal(learningEvidenceContract.submissionReservationLeaseSeconds, 60);

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

test("submission reservations count durable slots and the same mutation cannot trigger a second evaluator", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE learning_interactions (
      source_event_id TEXT PRIMARY KEY,
      student_id INTEGER NOT NULL,
      resource_key TEXT NOT NULL,
      occurred_at TEXT NOT NULL
    );
    CREATE TABLE learning_submission_slots (
      source_event_id TEXT PRIMARY KEY,
      student_id INTEGER NOT NULL,
      resource_key TEXT NOT NULL,
      window_start TEXT NOT NULL,
      resource_slot_no INTEGER NOT NULL,
      global_slot_no INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (student_id, resource_key, window_start, resource_slot_no),
      UNIQUE (student_id, window_start, global_slot_no)
    );`);
    const d1 = sqliteD1(db);
    const first = await acquireLearningSubmissionReservation({
      db: d1,
      studentId: 7,
      clientMutationId: "stable-evaluator-mutation",
      resourceKey: "formative:lesson-1:comprehension:revision",
      occurredAt: "2026-08-13T22:00:00.000Z",
    });
    assert.match(first.sourceEventId, /^[a-f0-9-]{36}$/);
    await assert.rejects(
      acquireLearningSubmissionReservation({
        db: d1,
        studentId: 7,
        clientMutationId: "stable-evaluator-mutation",
        resourceKey: "formative:lesson-1:comprehension:revision",
        occurredAt: "2026-08-13T22:00:01.000Z",
      }),
      (error) => error instanceof LearningSubmissionInProgressError
        && error.retryAfterSeconds === 59,
    );
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM learning_submission_slots").get().n, 1);

    const reclaimed = await acquireLearningSubmissionReservation({
      db: d1,
      studentId: 7,
      clientMutationId: "stable-evaluator-mutation",
      resourceKey: "formative:lesson-1:comprehension:revision",
      occurredAt: "2026-08-13T22:01:01.000Z",
    });
    assert.equal(reclaimed.sourceEventId, first.sourceEventId);
    assert.equal(reclaimed.reclaimed, true);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM learning_submission_slots").get().n, 1);
    await assert.rejects(
      acquireLearningSubmissionReservation({
        db: d1,
        studentId: 7,
        clientMutationId: "stable-evaluator-mutation",
        resourceKey: "formative:lesson-1:comprehension:revision",
        occurredAt: "2026-08-13T22:01:02.000Z",
      }),
      (error) => error instanceof LearningSubmissionInProgressError
        && error.retryAfterSeconds === 60,
    );

    await assert.rejects(
      acquireLearningSubmissionReservation({
        db: d1,
        studentId: 7,
        clientMutationId: "stable-evaluator-mutation",
        resourceKey: "formative:lesson-2:comprehension:revision",
        occurredAt: "2026-08-13T22:00:02.000Z",
      }),
      (error) => error?.code === "learning_mutation_conflict",
    );
  } finally {
    db.close();
  }
});

test("durable reservations alone exhaust the evaluator limit after failed evaluations", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE learning_interactions (
      source_event_id TEXT PRIMARY KEY,
      student_id INTEGER NOT NULL,
      resource_key TEXT NOT NULL,
      occurred_at TEXT NOT NULL
    );
    CREATE TABLE learning_submission_slots (
      source_event_id TEXT PRIMARY KEY,
      student_id INTEGER NOT NULL,
      resource_key TEXT NOT NULL,
      window_start TEXT NOT NULL,
      resource_slot_no INTEGER NOT NULL,
      global_slot_no INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (student_id, resource_key, window_start, resource_slot_no),
      UNIQUE (student_id, window_start, global_slot_no)
    );`);
    const d1 = sqliteD1(db);
    for (let index = 0; index < 8; index += 1) {
      const reservation = await acquireLearningSubmissionReservation({
        db: d1,
        studentId: 7,
        clientMutationId: `failed-evaluator-${index}`,
        resourceKey: "formative:lesson-1:comprehension:revision",
        occurredAt: "2026-08-13T22:00:00.000Z",
      });
      if (index === 0) assert.match(reservation.sourceEventId, /^[a-f0-9-]{36}$/);
    }
    const reusedAtCapacity = await acquireLearningSubmissionReservation({
      db: d1,
      studentId: 7,
      clientMutationId: "failed-evaluator-0",
      resourceKey: "formative:lesson-1:comprehension:revision",
      occurredAt: "2026-08-13T22:01:01.000Z",
    });
    assert.equal(reusedAtCapacity.reclaimed, true, "same answer reuses its stale slot even at quota");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM learning_submission_slots").get().n, 8);
    await assert.rejects(
      acquireLearningSubmissionReservation({
        db: d1,
        studentId: 7,
        clientMutationId: "ninth-evaluator",
        resourceKey: "formative:lesson-1:comprehension:revision",
        occurredAt: "2026-08-13T22:00:02.000Z",
      }),
      (error) => error instanceof LearningSubmissionRateLimitError,
    );
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM learning_submission_slots").get().n, 8);
  } finally {
    db.close();
  }
});

test("ten-way initial and abandoned-lease races admit only one evaluator each", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE learning_interactions (
      source_event_id TEXT PRIMARY KEY,
      student_id INTEGER NOT NULL,
      resource_key TEXT NOT NULL,
      occurred_at TEXT NOT NULL
    );
    CREATE TABLE learning_submission_slots (
      source_event_id TEXT PRIMARY KEY,
      student_id INTEGER NOT NULL,
      resource_key TEXT NOT NULL,
      window_start TEXT NOT NULL,
      resource_slot_no INTEGER NOT NULL,
      global_slot_no INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (student_id, resource_key, window_start, resource_slot_no),
      UNIQUE (student_id, window_start, global_slot_no)
    );`);
    const d1 = sqliteD1(db);
    const input = {
      db: d1,
      studentId: 7,
      clientMutationId: "concurrent-abandoned-evaluator",
      resourceKey: "formative:lesson-1:comprehension:revision",
    };
    let evaluatorCalls = 0;
    const enterEvaluator = async (occurredAt) => {
      const reservation = await acquireLearningSubmissionReservation({ ...input, occurredAt });
      evaluatorCalls += 1;
      return reservation;
    };
    const initial = await Promise.allSettled(Array.from(
      { length: 10 },
      () => enterEvaluator("2026-08-13T22:00:00.000Z"),
    ));
    assert.equal(initial.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(evaluatorCalls, 1);

    evaluatorCalls = 0;
    const contenders = await Promise.allSettled(Array.from(
      { length: 10 },
      () => enterEvaluator("2026-08-13T22:01:01.000Z"),
    ));
    assert.equal(contenders.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(evaluatorCalls, 1);
    assert.ok(contenders
      .filter((result) => result.status === "rejected")
      .every((result) => result.reason instanceof LearningSubmissionInProgressError));
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM learning_submission_slots").get().n, 1);

    await assert.rejects(
      enterEvaluator("2026-08-13T22:02:02.000Z"),
      (error) => error instanceof LearningSubmissionRateLimitError
        && error.retryAfterSeconds === 478,
    );
    assert.equal(evaluatorCalls, 1, "a second lease expiry cannot burn another evaluator call");
  } finally {
    db.close();
  }
});

test("an evaluator failure releases one slot for one immediate retry and then exhausts safely", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    initializeLearningContractDb(db);
    const source = sourceEnvironment();
    source.env.READING_DB = sqliteD1(db);
    const request = new Request("https://yw.bdfz.net/api/interaction-check");
    const student = { id: 7, ucUserId: 42 };
    const payload = {
      word: "站立",
      creation: "同一答案評閱失敗後只重用原有的提交槽。",
      clientMutationId: "immediate-evaluator-retry",
    };
    const initial = await assertLearningSubmissionAllowed({
      request,
      env: source.env,
      student,
      lesson: wordCreationLesson,
      interactionKey: "wordCreation",
      payload,
      occurredAt: "2026-08-13T22:00:00.000Z",
    });
    const releases = await Promise.all(Array.from(
      { length: 10 },
      () => releaseLearningSubmissionReservation({
        env: source.env,
        submissionReservation: initial.submissionReservation,
      }),
    ));
    assert.equal(releases.filter((result) => result.released).length, 1);
    assert.ok(releases.every((result) => result.evaluatorAttemptsExhausted === false));
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM learning_submission_slots").get().n, 1);
    assert.match(
      db.prepare("SELECT created_at FROM learning_submission_slots").get().created_at,
      /\.000Z$/,
    );

    const retryContenders = await Promise.allSettled(Array.from(
      { length: 10 },
      () => assertLearningSubmissionAllowed({
        request,
        env: source.env,
        student,
        lesson: wordCreationLesson,
        interactionKey: "wordCreation",
        payload,
        occurredAt: "2026-08-13T22:00:00.001Z",
      }),
    ));
    const admitted = retryContenders.find((result) => result.status === "fulfilled")?.value;
    assert.ok(admitted);
    assert.equal(retryContenders.filter((result) => result.status === "fulfilled").length, 1);
    assert.ok(retryContenders
      .filter((result) => result.status === "rejected")
      .every((result) => result.reason instanceof LearningSubmissionInProgressError));
    assert.equal(admitted.submissionReservation.reclaimed, true);
    assert.match(admitted.submissionReservation.leaseStartedAt, /\.001Z$/);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM learning_submission_slots").get().n, 1);

    const secondFailure = await releaseLearningSubmissionReservation({
      env: source.env,
      submissionReservation: admitted.submissionReservation,
    });
    assert.deepEqual(secondFailure, {
      released: true,
      evaluatorAttemptsExhausted: true,
      retryAfterSeconds: 600,
    });
    await assert.rejects(
      assertLearningSubmissionAllowed({
        request,
        env: source.env,
        student,
        lesson: wordCreationLesson,
        interactionKey: "wordCreation",
        payload,
        occurredAt: "2026-08-13T22:00:00.002Z",
      }),
      (error) => error instanceof LearningSubmissionRateLimitError
        && error.limitReason === "evaluator_retry_exhausted",
    );
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM learning_submission_slots").get().n, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM learning_interactions").get().n, 0);
    await assert.rejects(
      releaseLearningSubmissionReservation({
        env: source.env,
        submissionReservation: initial.submissionReservation,
      }),
      /release invalid/,
    );
    assert.match(
      db.prepare("SELECT created_at FROM learning_submission_slots").get().created_at,
      /\.001Z$/,
    );
  } finally {
    db.close();
  }
});

test("a late original and reclaimed evaluator commit one immutable ledger set", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    initializeLearningContractDb(db);
    const source = sourceEnvironment();
    source.env.READING_DB = sqliteD1(db);
    const request = new Request("https://yw.bdfz.net/api/interaction-check");
    const student = { id: 7, ucUserId: 42 };
    const payload = {
      word: "站立",
      creation: "同一答案的原請求與安全重試只能形成一組台賬。",
      clientMutationId: "late-original-reclaimed-final",
    };
    const original = await assertLearningSubmissionAllowed({
      request,
      env: source.env,
      student,
      lesson: wordCreationLesson,
      interactionKey: "wordCreation",
      payload,
      occurredAt: "2026-08-13T22:00:00.000Z",
    });
    const reclaimed = await assertLearningSubmissionAllowed({
      request,
      env: source.env,
      student,
      lesson: wordCreationLesson,
      interactionKey: "wordCreation",
      payload,
      occurredAt: "2026-08-13T22:01:01.000Z",
    });
    assert.equal(original.deduped, false);
    assert.equal(reclaimed.deduped, false);
    assert.equal(
      original.submissionReservation.sourceEventId,
      reclaimed.submissionReservation.sourceEventId,
    );

    const evaluation = {
      score: 80,
      correctness: "passed",
      provider: "apis",
      verdict: "passed",
    };
    const results = await Promise.all([
      recordLearningInteraction({
        request,
        env: source.env,
        student,
        lesson: wordCreationLesson,
        interactionKey: "wordCreation",
        payload,
        evaluation,
        submissionReservation: original.submissionReservation,
      }),
      recordLearningInteraction({
        request,
        env: source.env,
        student,
        lesson: wordCreationLesson,
        interactionKey: "wordCreation",
        payload,
        evaluation,
        submissionReservation: reclaimed.submissionReservation,
      }),
    ]);
    assert.deepEqual(results.map((result) => result.deduped).sort(), [false, true]);
    for (const table of ["learning_interactions", "learning_evaluations", "evidence_outbox"]) {
      assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 1, table);
    }
    assert.equal(source.queued.length, 1);
  } finally {
    db.close();
  }
});

test("a reclaimed evaluator failure does not claim exhaustion after the original commits", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    initializeLearningContractDb(db);
    const source = sourceEnvironment();
    source.env.READING_DB = sqliteD1(db);
    const request = new Request("https://yw.bdfz.net/api/interaction-check");
    const student = { id: 7, ucUserId: 42 };
    const payload = {
      word: "站立",
      creation: "原請求成功後，回收請求不可誤報兩次評閱都失敗。",
      clientMutationId: "late-original-before-reclaimed-failure",
    };
    const original = await assertLearningSubmissionAllowed({
      request,
      env: source.env,
      student,
      lesson: wordCreationLesson,
      interactionKey: "wordCreation",
      payload,
      occurredAt: "2026-08-13T22:00:00.000Z",
    });
    const reclaimed = await assertLearningSubmissionAllowed({
      request,
      env: source.env,
      student,
      lesson: wordCreationLesson,
      interactionKey: "wordCreation",
      payload,
      occurredAt: "2026-08-13T22:01:01.000Z",
    });

    await recordLearningInteraction({
      request,
      env: source.env,
      student,
      lesson: wordCreationLesson,
      interactionKey: "wordCreation",
      payload,
      evaluation: {
        score: 80,
        correctness: "passed",
        provider: "apis",
        verdict: "passed",
      },
      submissionReservation: original.submissionReservation,
    });
    const lateFailure = await releaseLearningSubmissionReservation({
      env: source.env,
      submissionReservation: reclaimed.submissionReservation,
    });
    assert.equal(lateFailure.released, false);
    assert.equal(lateFailure.evaluatorAttemptsExhausted, false);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM learning_interactions").get().n, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM learning_submission_slots").get().n, 1);
  } finally {
    db.close();
  }
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
