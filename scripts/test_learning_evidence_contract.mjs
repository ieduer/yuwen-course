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
  assertLearningSubmissionAllowed,
  invalidateFormativeManifestCache,
  reconcileEvidenceOutbox,
  recordLearningInteraction,
} from "../site/learning-evidence-source.js";
import worker from "../site/_worker.js";

const ROOT = resolve(import.meta.dirname, "..");
const registry = JSON.parse(readFileSync(resolve(ROOT, "site/data/interaction-definitions.json"), "utf8"));
const manifest = JSON.parse(readFileSync(resolve(ROOT, "site/data/learning-manifest.json"), "utf8"));
const formativeManifest = JSON.parse(readFileSync(resolve(ROOT, "site/data/lesson-competency-manifest.json"), "utf8"));
const studyGuideCatalog = JSON.parse(readFileSync(resolve(ROOT, "site/data/study-guide-catalog.json"), "utf8"));
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
    headers: { "content-type": "application/json" },
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
      headers: { "content-type": "application/json" },
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
    workerSource.indexOf("async function callApisGateway"),
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
