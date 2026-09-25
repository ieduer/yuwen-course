#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { resolve } from "node:path";

import {
  drainEvidenceOutbox,
  OUTBOX_RECONCILE_SELECTION_SQL,
  OUTBOX_RETRY_SELECTION_SQL,
} from "../site/learning-evidence-source.js";
import {
  buildReplayEnvelope,
  classifyReplayState,
  executeEvidenceReplay,
  planEvidenceReplay,
  REPLAY_REASON_CODES,
  replaySourceAttemptId,
  replayStatements,
  sha256Hex,
} from "./learning_evidence_replay.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const registry = JSON.parse(readFileSync(resolve(ROOT, "site/data/interaction-definitions.json"), "utf8"));
const aPlus = registry.compatibilityContracts.aPlusGate;
const BATCH_ID = "yw-evidence-replay-test-0001";
const REPLAYED_AT = "2026-09-25T03:00:00.000Z";
const UC_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9:._+/-]*$/;
const UC_V2_SOURCE_EVENT_ID = /^[0-9a-f-]{20,100}$/i;

function fixtureId(n) {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function fixtureEnvelope(id, academicYear, n) {
  return {
    schema: "bdfz-learning-evidence-event-v2",
    schemaVersion: 2,
    sourceSystem: "yuwen-course",
    sourceSiteKey: "yw",
    contractVersion: aPlus.contractVersion,
    sourceEventId: id,
    sourceAttemptId: id,
    sourceVersion: aPlus.sourceVersion,
    sourceReleaseId: aPlus.sourceReleaseId,
    canonicalUnitId: `yw:lesson:lesson-fixture-${n}`,
    resourceVersion: `sha256:${sha256Hex(`fixture-${n}`)}`,
    mappingVersion: aPlus.mappingVersion,
    registryVersion: aPlus.registryVersion,
    userId: 42,
    academicYear,
    dimensionKey: "reading",
    eventType: "text_read_acknowledged",
    interactionKey: "readAcknowledged",
    assessmentKind: "participation",
    scoringRole: "none",
    verificationMethod: "source_scroll_threshold",
    eligibilityStatus: "non_scoring",
    resourceKey: `lesson:lesson-fixture-${n}`,
    classSessionId: "",
    lessonPhase: "",
    attemptNo: 1 + (n % 3),
    rawValue: null,
    maxValue: null,
    normalizedValue: null,
    occurredAt: `2026-08-2${1 + (n % 5)}T08:00:00.000Z`,
    sourceUrl: `https://yw.bdfz.net/#lesson-fixture-${n}`,
    sourcePayloadRef: `learning_interactions:${id}`,
    summary: { lessonTitle: "示例課", itemTitle: "讀完", itemGroup: "選必上", eventType: "text_read_acknowledged" },
    facets: [{ key: "lesson", value: `lesson-fixture-${n}` }, { key: "assessment", value: "participation" }],
  };
}

function sqliteD1(db) {
  return {
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
}

function replayIo(db) {
  return {
    async query(sql, params) {
      return db.prepare(sql).all(...params);
    },
    async batch(statements) {
      db.exec("BEGIN IMMEDIATE");
      try {
        const changes = statements.map((statement) => Number(db.prepare(statement.sql).run(...statement.params).changes || 0));
        db.exec("COMMIT");
        return changes;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

// Real schema: every production migration the source runtime depends on, plus
// the additive replay ledger.
function fixtureDb({ quarantined2025 = 3, quarantined2026 = 2 } = {}) {
  const db = new DatabaseSync(":memory:");
  for (const migration of [
    "migrations/0001_reading_constellation.sql",
    "migrations/0003_learning_evidence_loop_v1.sql",
    "migrations/0004_classical_first_read_and_outbox_index.sql",
    "migrations/0005_learning_evidence_central_receipts.sql",
    "migrations/0006_learning_evaluator_call_ledger.sql",
    "migrations/0007_learning_pending_submissions.sql",
    "migrations/0008_learning_evidence_replay_ledger.sql",
  ]) {
    db.exec(readFileSync(resolve(ROOT, migration), "utf8"));
  }
  db.prepare(
    "INSERT INTO students (id, uc_slug, display_name, uc_user_id, identity_verified_at) VALUES (?, ?, ?, ?, ?)"
  ).run(7, "replay-fixture-student", "Replay Fixture Student", 42, "2026-08-13T22:00:00.000Z");
  const rows = [];
  let n = 0;
  const add = (academicYear, disposition, schema = "bdfz-learning-evidence-event-v2") => {
    n += 1;
    const id = fixtureId(n);
    const envelope = schema === "bdfz-learning-evidence-event-v2"
      ? fixtureEnvelope(id, academicYear, n)
      : { schema, sourceEventId: id, academicYear };
    db.prepare(
      `INSERT INTO learning_interactions (
         source_event_id, student_id, uc_user_id, academic_year, lesson_id, interaction_key,
         event_type, assessment_kind, scoring_role, resource_key, resource_version, registry_version,
         attempt_no, occurred_at
       ) VALUES (?, 7, 42, ?, ?, 'readAcknowledged', 'text_read_acknowledged', 'participation', 'none', ?, 'v', ?, ?, ?)`
    ).run(id, academicYear, `lesson-fixture-${n}`, `lesson:lesson-fixture-${n}`, aPlus.registryVersion, n, "2026-08-23T08:00:00.000Z");
    db.prepare(
      `INSERT INTO evidence_outbox (
         source_event_id, envelope_json, delivery_status, delivery_attempts, last_error_class,
         last_attempt_at, delivered_at, created_at, central_disposition, central_receipted_at
       ) VALUES (?, ?, 'enqueued', 2, '', '2026-08-23T08:00:05.000Z', NULL, '2026-08-23 08:00:00', ?, ?)`
    ).run(id, JSON.stringify(envelope), disposition, disposition ? "2026-08-23T09:00:00.000Z" : null);
    rows.push({ id, academicYear, disposition, envelopeJson: JSON.stringify(envelope) });
  };
  for (let i = 0; i < quarantined2025; i += 1) add("2025-2026", "quarantined");
  for (let i = 0; i < quarantined2026; i += 1) add("2026-2027", "quarantined");
  add("2026-2027", "accepted");
  add("2025-2026", null, "bdfz-learning-evidence-v1");
  return { db, rows };
}

function exportQuarantined(db) {
  return db.prepare(
    "SELECT * FROM evidence_outbox WHERE central_disposition = 'quarantined' ORDER BY id"
  ).all();
}

function allowlistFor(rows) {
  return rows.filter((row) => row.disposition === "quarantined").map((row) => ({
    sourceEventId: row.id,
    envelopeSha256: sha256Hex(row.envelopeJson),
    academicYear: row.academicYear,
  }));
}

function snapshot(db, table) {
  return db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all();
}

test("replay attempt ids are deterministic, new, and accepted by User Center identity rules", () => {
  const original = fixtureId(1);
  const first = replaySourceAttemptId(original, 1);
  assert.equal(first, replaySourceAttemptId(original, 1));
  assert.notEqual(first, original);
  assert.notEqual(first, replaySourceAttemptId(original, 2));
  assert.notEqual(first, replaySourceAttemptId(fixtureId(2), 1));
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.match(first, UC_IDENTIFIER);
  assert.match(first, UC_V2_SOURCE_EVENT_ID);
  assert.throws(() => replaySourceAttemptId("not an id", 1));
  assert.throws(() => replaySourceAttemptId(original, 0));
});

test("replay envelope changes only attempt identity and the 2025-2026 label", () => {
  const policy = { academicYear: "2026-2027", policyVersion: "yw-aplus-2026-2027-v1", contractVersion: aPlus.contractVersion };
  for (const year of ["2025-2026", "2026-2027"]) {
    const id = fixtureId(year === "2025-2026" ? 11 : 12);
    const priorJson = JSON.stringify(fixtureEnvelope(id, year, 11));
    const replay = buildReplayEnvelope(priorJson, { originalSourceEventId: id, policy });
    const prior = JSON.parse(priorJson);
    const next = JSON.parse(replay.newEnvelopeJson);
    assert.deepEqual(Object.keys(next), Object.keys(prior), "key set and source order are preserved");
    const changed = Object.keys(prior).filter((key) => JSON.stringify(prior[key]) !== JSON.stringify(next[key]));
    assert.deepEqual(changed, year === "2025-2026"
      ? ["sourceEventId", "sourceAttemptId", "academicYear"]
      : ["sourceEventId", "sourceAttemptId"]);
    assert.equal(next.sourceEventId, next.sourceAttemptId);
    assert.equal(next.sourceEventId, replaySourceAttemptId(id, 1));
    assert.equal(next.academicYear, "2026-2027");
    assert.equal(next.sourcePayloadRef, `learning_interactions:${id}`, "provenance stays on the original interaction");
    assert.equal(next.attemptNo, prior.attemptNo, "learner attempt ordinal is not rewritten");
    assert.equal(next.occurredAt, prior.occurredAt, "original occurrence time is kept");
    assert.equal(Object.hasOwn(next, "supersedesSourceAttemptId"), false);
    assert.equal(replay.reasonCode, REPLAY_REASON_CODES[year]);
  }
});

test("replay envelope refuses anything outside the reviewed contract", () => {
  const policy = { academicYear: "2026-2027", policyVersion: "yw-aplus-2026-2027-v1", contractVersion: aPlus.contractVersion };
  const id = fixtureId(21);
  const base = fixtureEnvelope(id, "2025-2026", 21);
  const variants = [
    { ...base, contractVersion: "yw-aplus-b530-v1" },
    { ...base, schema: "bdfz-learning-evidence-v1" },
    { ...base, sourceAttemptId: fixtureId(22) },
    { ...base, supersedesSourceAttemptId: fixtureId(23) },
    { ...base, sourcePayloadRef: `learning_interactions:${fixtureId(24)}` },
    { ...base, academicYear: "2024-2025" },
    { ...base, sourceSiteKey: "gks" },
  ];
  for (const variant of variants) {
    assert.throws(() => buildReplayEnvelope(JSON.stringify(variant), { originalSourceEventId: id, policy }));
  }
  assert.throws(() => buildReplayEnvelope(JSON.stringify(base, null, 1), { originalSourceEventId: id, policy }),
    /canonical/);
});

test("plan requires the exact reviewed selection and per-year counts", () => {
  const { db, rows } = fixtureDb();
  try {
    const exported = exportQuarantined(db);
    const allowlist = allowlistFor(rows);
    const expected = { total: 5, byYear: { "2025-2026": 3, "2026-2027": 2 } };
    const plan = planEvidenceReplay({ rows: exported, allowlist, registry, expected });
    assert.equal(plan.counts.total, 5);
    assert.deepEqual(plan.counts.byYear, { "2025-2026": 3, "2026-2027": 2 });
    assert.match(plan.digest, /^[a-f0-9]{64}$/);
    assert.equal(plan.digest, planEvidenceReplay({ rows: [...exported].reverse(), allowlist, registry, expected }).digest);

    assert.throws(() => planEvidenceReplay({ rows: exported, allowlist: allowlist.slice(1), registry, expected }),
      /outside the reviewed allowlist/);
    assert.throws(() => planEvidenceReplay({ rows: exported.slice(1), allowlist, registry, expected }),
      /missing from the quarantined selection/);
    assert.throws(() => planEvidenceReplay({ rows: exported, allowlist, registry, expected: { total: 5, byYear: { "2025-2026": 2, "2026-2027": 3 } } }),
      /selection count mismatch/);
    const tampered = exported.map((row, index) => (index === 0
      ? { ...row, envelope_json: row.envelope_json.replace('"attemptNo":', '"attemptNo": ') }
      : row));
    assert.throws(() => planEvidenceReplay({ rows: tampered, allowlist, registry, expected }),
      /differs from the reviewed allowlist/);
    const notQuarantined = exported.map((row, index) => (index === 0 ? { ...row, central_disposition: "accepted" } : row));
    assert.throws(() => planEvidenceReplay({ rows: notQuarantined, allowlist, registry, expected }), /not quarantined/);
    const otherPolicy = structuredClone(registry);
    otherPolicy.compatibilityContracts.aPlusGate.academicYearPolicy.academicYear = "2027-2028";
    assert.throws(() => planEvidenceReplay({ rows: exported, allowlist, registry: otherPolicy, expected }),
      /owner-approved 2026-2027 replay target/);
  } finally {
    db.close();
  }
});

test("apply archives exact prior state, relabels only the reviewed rows, and a rerun is a no-op", async () => {
  const { db, rows } = fixtureDb();
  try {
    const plan = planEvidenceReplay({
      rows: exportQuarantined(db),
      allowlist: allowlistFor(rows),
      registry,
      expected: { total: 5, byYear: { "2025-2026": 3, "2026-2027": 2 } },
    });
    const outboxBefore = snapshot(db, "evidence_outbox");
    const interactionsBefore = snapshot(db, "learning_interactions");
    const io = replayIo(db);
    const options = { plan, expectedDigest: plan.digest, batchId: BATCH_ID, replayedAt: REPLAYED_AT, ...io };

    const dryRun = await executeEvidenceReplay(options);
    assert.deepEqual(dryRun.counts, { ready: 5, partial: 0, replayed: 0, conflict: 0 });
    assert.equal(dryRun.writes, 0);
    assert.deepEqual(snapshot(db, "evidence_outbox"), outboxBefore, "dry run writes nothing");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM evidence_replay_ledger").get().n, 0);

    const first = await executeEvidenceReplay({ ...options, apply: true });
    assert.equal(first.stopped, null);
    assert.deepEqual(first.appliedCounts, { ready: 5, partial: 0 });

    const ledger = db.prepare("SELECT * FROM evidence_replay_ledger ORDER BY source_event_id").all();
    assert.equal(ledger.length, 5);
    for (const entry of ledger) {
      const before = outboxBefore.find((row) => row.source_event_id === entry.source_event_id);
      const item = plan.items.find((candidate) => candidate.sourceEventId === entry.source_event_id);
      assert.equal(entry.prior_envelope_json, before.envelope_json, "prior envelope archived byte for byte");
      assert.equal(entry.prior_envelope_sha256, sha256Hex(before.envelope_json));
      assert.equal(entry.prior_source_attempt_id, entry.source_event_id);
      assert.equal(entry.new_source_attempt_id, replaySourceAttemptId(entry.source_event_id, 1));
      assert.deepEqual(JSON.parse(entry.prior_outbox_state_json), {
        delivery_status: before.delivery_status,
        delivery_attempts: before.delivery_attempts,
        last_error_class: before.last_error_class,
        last_attempt_at: before.last_attempt_at,
        delivered_at: before.delivered_at,
        central_disposition: before.central_disposition,
        central_receipted_at: before.central_receipted_at,
        created_at: before.created_at,
      });
      assert.equal(entry.reason_code, REPLAY_REASON_CODES[entry.prior_academic_year]);
      assert.equal(entry.new_academic_year, "2026-2027");
      assert.equal(entry.replay_batch_id, BATCH_ID);
      assert.equal(entry.replayed_at, REPLAYED_AT);
      assert.equal(item.newEnvelopeSha256, entry.new_envelope_sha256);
    }

    const outboxAfter = snapshot(db, "evidence_outbox");
    for (const before of outboxBefore) {
      const after = outboxAfter.find((row) => row.source_event_id === before.source_event_id);
      const item = plan.items.find((candidate) => candidate.sourceEventId === before.source_event_id);
      if (!item) {
        assert.deepEqual(after, before, "rows outside the plan are untouched");
        continue;
      }
      assert.equal(after.id, before.id);
      assert.equal(after.created_at, before.created_at);
      assert.equal(after.envelope_json, item.newEnvelopeJson);
      assert.equal(after.central_disposition, null);
      assert.equal(after.central_receipted_at, null);
      assert.equal(after.delivery_status, "pending");
      assert.equal(after.delivery_attempts, 0);
      assert.equal(after.last_error_class, "");
      assert.equal(after.last_attempt_at, null);
      assert.equal(after.delivered_at, null);
      const prior = JSON.parse(before.envelope_json);
      const next = JSON.parse(after.envelope_json);
      assert.equal(next.academicYear, "2026-2027");
      assert.equal(prior.academicYear === "2025-2026", item.priorAcademicYear === "2025-2026");
    }
    const relabelled = plan.items.filter((item) => JSON.parse(item.priorEnvelopeJson).academicYear
      !== JSON.parse(item.newEnvelopeJson).academicYear);
    assert.equal(relabelled.length, 3, "only the 2025-2026 rows change academic year");
    assert.deepEqual(snapshot(db, "learning_interactions"), interactionsBefore, "source interactions are never rewritten");

    const rerun = await executeEvidenceReplay({ ...options, apply: true });
    assert.deepEqual(rerun.counts, { ready: 0, partial: 0, replayed: 5, conflict: 0 });
    assert.equal(rerun.writes, 0);
    assert.deepEqual(snapshot(db, "evidence_outbox"), outboxAfter, "rerun is a no-op");
    for (const item of plan.items) {
      const [ledgerChange, outboxChange] = await io.batch(replayStatements(item, {
        batchId: BATCH_ID, generation: 1, replayedAt: REPLAYED_AT,
      }));
      assert.equal(ledgerChange, 0);
      assert.equal(outboxChange, 0);
    }
  } finally {
    db.close();
  }
});

test("an interrupted replay converges and a conflict stops before any write", async () => {
  const { db, rows } = fixtureDb({ quarantined2025: 2, quarantined2026: 1 });
  try {
    const plan = planEvidenceReplay({
      rows: exportQuarantined(db),
      allowlist: allowlistFor(rows),
      registry,
      expected: { total: 3, byYear: { "2025-2026": 2, "2026-2027": 1 } },
    });
    const io = replayIo(db);
    const options = { plan, expectedDigest: plan.digest, batchId: BATCH_ID, replayedAt: REPLAYED_AT, ...io };
    // Only the ledger statement committed for the first item.
    const [ledgerOnly] = replayStatements(plan.items[0], { batchId: BATCH_ID, generation: 1, replayedAt: REPLAYED_AT });
    assert.equal(Number(db.prepare(ledgerOnly.sql).run(...ledgerOnly.params).changes), 1);
    const resumed = await executeEvidenceReplay({ ...options, apply: true });
    assert.deepEqual(resumed.counts, { ready: 2, partial: 1, replayed: 0, conflict: 0 });
    assert.deepEqual(resumed.appliedCounts, { ready: 2, partial: 1 });
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM evidence_outbox WHERE envelope_json IN (SELECT ? UNION SELECT ? UNION SELECT ?)")
      .get(...plan.items.map((item) => item.newEnvelopeJson)).n, 3);

    // A later central quarantine of the new attempt is a terminal outcome,
    // not a reason to replay again.
    db.prepare("UPDATE evidence_outbox SET central_disposition = 'quarantined' WHERE source_event_id = ?")
      .run(plan.items[1].sourceEventId);
    const afterTerminal = await executeEvidenceReplay({ ...options, apply: true });
    assert.deepEqual(afterTerminal.counts, { ready: 0, partial: 0, replayed: 3, conflict: 0 });
    assert.equal(afterTerminal.writes, 0);
  } finally {
    db.close();
  }

  const conflictFixture = fixtureDb({ quarantined2025: 1, quarantined2026: 1 });
  try {
    const plan = planEvidenceReplay({
      rows: exportQuarantined(conflictFixture.db),
      allowlist: allowlistFor(conflictFixture.rows),
      registry,
      expected: { total: 2, byYear: { "2025-2026": 1, "2026-2027": 1 } },
    });
    conflictFixture.db.prepare("UPDATE evidence_outbox SET central_disposition = 'accepted' WHERE source_event_id = ?")
      .run(plan.items[0].sourceEventId);
    const before = snapshot(conflictFixture.db, "evidence_outbox");
    const result = await executeEvidenceReplay({
      plan, expectedDigest: plan.digest, batchId: BATCH_ID, replayedAt: REPLAYED_AT, apply: true,
      ...replayIo(conflictFixture.db),
    });
    assert.equal(result.stopped, "conflict");
    assert.equal(result.writes, 0);
    assert.deepEqual(snapshot(conflictFixture.db, "evidence_outbox"), before);
    assert.equal(conflictFixture.db.prepare("SELECT COUNT(*) AS n FROM evidence_replay_ledger").get().n, 0);
    await assert.rejects(() => executeEvidenceReplay({
      plan, expectedDigest: "0".repeat(64), batchId: BATCH_ID, replayedAt: REPLAYED_AT, ...replayIo(conflictFixture.db),
    }), /plan digest mismatch/);
    assert.equal(classifyReplayState(plan.items[1], null, { batchId: BATCH_ID }), "conflict");
  } finally {
    conflictFixture.db.close();
  }
});

test("replayed rows deliver the new attempt and reconcile only by the new attempt receipt", async () => {
  const { db, rows } = fixtureDb({ quarantined2025: 2, quarantined2026: 1 });
  try {
    const plan = planEvidenceReplay({
      rows: exportQuarantined(db),
      allowlist: allowlistFor(rows),
      registry,
      expected: { total: 3, byYear: { "2025-2026": 2, "2026-2027": 1 } },
    });
    await executeEvidenceReplay({
      plan, expectedDigest: plan.digest, batchId: BATCH_ID, replayedAt: REPLAYED_AT, apply: true, ...replayIo(db),
    });
    const newIds = new Set(plan.items.map((item) => item.newAttemptId));
    const oldIds = new Set(plan.items.map((item) => item.sourceEventId));

    const retrySelection = db.prepare(OUTBOX_RETRY_SELECTION_SQL).all(50);
    assert.deepEqual(new Set(retrySelection.map((row) => row.source_event_id)), oldIds,
      "only the replayed rows become transport-retryable");
    const reconcileSelection = db.prepare(OUTBOX_RECONCILE_SELECTION_SQL).all(50);
    assert.deepEqual(new Set(reconcileSelection.map((row) => row.source_attempt_id)), newIds);

    const queued = [];
    const receiptRequests = [];
    const central = new Map([...oldIds].map((id) => [id, "quarantined"]));
    const env = {
      READING_DB: sqliteD1(db),
      LEARNING_EVIDENCE_QUEUE: {
        async send(envelope) {
          queued.push(envelope);
          central.set(envelope.sourceAttemptId, "accepted");
        },
      },
      USER_CENTER_EVIDENCE: {
        async getLearningEvidenceDeliveryReceipts(sourceAttemptIds) {
          receiptRequests.push([...sourceAttemptIds]);
          return {
            schemaVersion: "bdfz-learning-evidence-delivery-receipts-v1",
            sourceSiteKey: "yw",
            contractVersion: aPlus.contractVersion,
            receipts: sourceAttemptIds.filter((id) => central.has(id))
              .map((id) => ({ sourceAttemptId: id, disposition: central.get(id) })),
          };
        },
      },
    };

    const firstDrain = await drainEvidenceOutbox(env, 50);
    assert.deepEqual(firstDrain.reconciled, { checked: 3, receipted: 0 },
      "the old terminal receipt cannot re-quarantine a replayed row");
    assert.deepEqual(firstDrain.retried, { attempted: 3, enqueued: 3 });
    assert.deepEqual(new Set(receiptRequests.flat()), newIds, "receipts are requested by the new attempt only");
    assert.equal(queued.length, 3);
    for (const envelope of queued) {
      assert.ok(newIds.has(envelope.sourceEventId));
      assert.equal(envelope.sourceEventId, envelope.sourceAttemptId);
      assert.equal(envelope.academicYear, "2026-2027");
    }

    // The next health drain after the fifteen-minute receipt lease.
    db.exec("UPDATE evidence_outbox SET central_receipted_at = datetime('now', '-16 minutes'), last_attempt_at = datetime('now', '-1 minute') WHERE central_disposition IS NULL");
    const secondDrain = await drainEvidenceOutbox(env, 50);
    assert.deepEqual(secondDrain.reconciled, { checked: 3, receipted: 3 });
    assert.deepEqual(secondDrain.retried, { attempted: 0, enqueued: 0 });
    const dispositions = db.prepare(
      "SELECT central_disposition, COUNT(*) AS n FROM evidence_outbox WHERE source_event_id IN (SELECT source_event_id FROM evidence_replay_ledger) GROUP BY 1"
    ).all();
    assert.deepEqual(dispositions.map((row) => ({ ...row })), [{ central_disposition: "accepted", n: 3 }]);
  } finally {
    db.close();
  }
});

test("a stale receipt for a superseded attempt cannot change a row that now carries a new attempt", async () => {
  const { db, rows } = fixtureDb({ quarantined2025: 1, quarantined2026: 0 });
  try {
    const plan = planEvidenceReplay({
      rows: exportQuarantined(db),
      allowlist: allowlistFor(rows),
      registry,
      expected: { total: 1, byYear: { "2025-2026": 1 } },
    });
    await executeEvidenceReplay({
      plan, expectedDigest: plan.digest, batchId: BATCH_ID, replayedAt: REPLAYED_AT, apply: true, ...replayIo(db),
    });
    const [item] = plan.items;
    // A receipt for the prior attempt id arriving at the exact-attempt update
    // guard changes nothing.
    const stale = db.prepare(
      `UPDATE evidence_outbox
          SET central_disposition = ?
        WHERE source_event_id = ?
          AND ((? IS NULL AND central_disposition IS NULL) OR central_disposition = ?)
          AND delivery_status IN ('pending', 'enqueued')
          AND COALESCE(json_extract(envelope_json, '$.sourceAttemptId'), source_event_id) = ?`
    ).run("quarantined", item.sourceEventId, null, null, item.sourceEventId);
    assert.equal(Number(stale.changes), 0);
    assert.equal(db.prepare("SELECT central_disposition FROM evidence_outbox WHERE source_event_id = ?")
      .get(item.sourceEventId).central_disposition, null);
    const workerSource = readFileSync(resolve(ROOT, "site/learning-evidence-source.js"), "utf8");
    assert.match(workerSource, /AND COALESCE\(json_extract\(envelope_json, '\$\.sourceAttemptId'\), source_event_id\) = \?`/);
  } finally {
    db.close();
  }
});
