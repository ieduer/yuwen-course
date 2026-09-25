// Bounded replay of centrally quarantined YW learning evidence (P11,
// owner decision 2026-09-24). This module plans and applies the replay; it is
// run by an operator through D1 with an exact reviewed plan, never through a
// public route.
//
// User Center treats a quarantined source attempt as terminal and requires
// sourceAttemptId === sourceEventId for YW event-v2, so each replayed outbox
// row receives one new deterministic source-owned attempt. The outbox row keeps
// its original source_event_id; sourcePayloadRef keeps pointing at the original
// learning_interactions row; attemptNo remains the learner's attempt ordinal.
// evidence_replay_ledger (migration 0008) archives the exact prior envelope
// and delivery state first, and its primary key makes the replay idempotent.
import { createHash } from "node:crypto";

import { learningEvidenceContract } from "../site/learning-evidence-source.js";

export const REPLAY_ATTEMPT_NAMESPACE = "yw-evidence-replay-attempt-v1";
export const REPLAY_TARGET_ACADEMIC_YEAR = "2026-2027";
export const REPLAY_TARGET_POLICY_VERSION = "yw-aplus-2026-2027-v1";
export const REPLAY_REASON_CODES = Object.freeze({
  "2025-2026": "owner_2026_09_24_august_work_counts_toward_2026_2027",
  "2026-2027": "uc_occurred_at_check_false_quarantine_fixed_2026_08_25",
});

const SOURCE_EVENT_ID = /^[0-9a-f-]{20,100}$/i;

export function sha256Hex(text) {
  return createHash("sha256").update(String(text), "utf8").digest("hex");
}

function fail(message) {
  throw new Error(`evidence replay: ${message}`);
}

export function replaySourceAttemptId(originalSourceEventId, generation = 1) {
  const original = String(originalSourceEventId ?? "");
  if (!SOURCE_EVENT_ID.test(original)) fail("original source event id invalid");
  if (!Number.isInteger(generation) || generation < 1) fail("replay generation invalid");
  const hex = sha256Hex(`${REPLAY_ATTEMPT_NAMESPACE}\n${original}\n${generation}`);
  // Name-based UUID layout (version 5, RFC 4122 variant), like the source's
  // deterministic reservation ids.
  const variant = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  if (id.toLowerCase() === original.toLowerCase()) fail("replay attempt id collision");
  return id;
}

export function activeReplayPolicy(registry) {
  const policy = registry?.compatibilityContracts?.aPlusGate?.academicYearPolicy;
  const contractVersion = registry?.compatibilityContracts?.aPlusGate?.contractVersion;
  if (
    policy?.status !== "active"
    || policy?.academicYear !== REPLAY_TARGET_ACADEMIC_YEAR
    || policy?.policyVersion !== REPLAY_TARGET_POLICY_VERSION
    || contractVersion !== learningEvidenceContract.contractVersion
  ) fail("active source policy no longer matches the owner-approved 2026-2027 replay target");
  return Object.freeze({
    academicYear: policy.academicYear,
    policyVersion: policy.policyVersion,
    contractVersion,
  });
}

export function buildReplayEnvelope(priorEnvelopeJson, { originalSourceEventId, generation = 1, policy }) {
  const original = String(originalSourceEventId ?? "");
  let prior;
  try {
    prior = JSON.parse(priorEnvelopeJson);
  } catch {
    fail("prior envelope is not JSON");
  }
  if (!prior || typeof prior !== "object" || Array.isArray(prior)) fail("prior envelope must be an object");
  if (JSON.stringify(prior) !== priorEnvelopeJson) fail("prior envelope is not canonical source JSON");
  if (
    prior.schema !== learningEvidenceContract.envelopeSchema
    || Number(prior.schemaVersion) !== 2
    || prior.sourceSystem !== learningEvidenceContract.sourceSystem
    || prior.sourceSiteKey !== learningEvidenceContract.sourceSiteKey
    || prior.contractVersion !== policy.contractVersion
  ) fail("prior envelope contract mismatch");
  if (prior.sourceEventId !== original || prior.sourceAttemptId !== original) {
    fail("prior envelope attempt identity mismatch");
  }
  if (Object.hasOwn(prior, "supersedesSourceAttemptId")) fail("prior envelope carries supersession");
  if (prior.sourcePayloadRef !== `learning_interactions:${original}`) fail("prior envelope provenance mismatch");
  if (!Object.hasOwn(REPLAY_REASON_CODES, prior.academicYear)) fail("prior academic year outside the replay decision");

  const newAttemptId = replaySourceAttemptId(original, generation);
  // Reassigning existing keys keeps the source key order; only the attempt
  // identity and, for 2025-2026 labels, the academic year change.
  const next = { ...prior };
  next.sourceEventId = newAttemptId;
  next.sourceAttemptId = newAttemptId;
  next.academicYear = policy.academicYear;
  return Object.freeze({
    priorAcademicYear: prior.academicYear,
    newAcademicYear: next.academicYear,
    newAttemptId,
    reasonCode: REPLAY_REASON_CODES[prior.academicYear],
    newEnvelopeJson: JSON.stringify(next),
  });
}

/**
 * Exact selection: the quarantined outbox rows must equal the reviewed
 * allowlist one-to-one, byte-for-byte, with the expected per-year counts.
 */
export function planEvidenceReplay({ rows, allowlist, registry, expected, generation = 1 }) {
  const policy = activeReplayPolicy(registry);
  if (!Array.isArray(rows) || !Array.isArray(allowlist)) fail("rows and allowlist are required");
  const allowed = new Map();
  for (const entry of allowlist) {
    const id = String(entry?.sourceEventId ?? "");
    if (!SOURCE_EVENT_ID.test(id) || allowed.has(id)) fail("allowlist identity invalid or duplicated");
    if (!/^[a-f0-9]{64}$/.test(String(entry?.envelopeSha256 ?? ""))) fail("allowlist hash invalid");
    allowed.set(id, entry);
  }
  const seen = new Set();
  const items = [];
  for (const row of rows) {
    const id = String(row?.source_event_id ?? "");
    const entry = allowed.get(id);
    if (!entry) fail("quarantined outbox row outside the reviewed allowlist");
    if (seen.has(id)) fail("duplicated outbox row");
    seen.add(id);
    if (row.central_disposition !== "quarantined") fail("selected outbox row is not quarantined");
    const priorEnvelopeJson = String(row.envelope_json ?? "");
    const priorEnvelopeSha256 = sha256Hex(priorEnvelopeJson);
    if (priorEnvelopeSha256 !== entry.envelopeSha256) fail("outbox envelope differs from the reviewed allowlist");
    const replay = buildReplayEnvelope(priorEnvelopeJson, { originalSourceEventId: id, generation, policy });
    if (entry.academicYear !== undefined && entry.academicYear !== replay.priorAcademicYear) {
      fail("allowlist academic year differs from the envelope");
    }
    items.push(Object.freeze({
      sourceEventId: id,
      priorSourceAttemptId: id,
      priorEnvelopeJson,
      priorEnvelopeSha256,
      priorAcademicYear: replay.priorAcademicYear,
      newAttemptId: replay.newAttemptId,
      newEnvelopeJson: replay.newEnvelopeJson,
      newEnvelopeSha256: sha256Hex(replay.newEnvelopeJson),
      newAcademicYear: replay.newAcademicYear,
      reasonCode: replay.reasonCode,
    }));
  }
  if (seen.size !== allowed.size) fail("reviewed allowlist row is missing from the quarantined selection");
  const byYear = {};
  for (const item of items) byYear[item.priorAcademicYear] = (byYear[item.priorAcademicYear] || 0) + 1;
  const expectedByYear = expected?.byYear || {};
  if (
    items.length !== Number(expected?.total)
    || Object.keys(byYear).length !== Object.keys(expectedByYear).length
    || Object.entries(expectedByYear).some(([year, count]) => byYear[year] !== count)
  ) fail(`selection count mismatch: ${JSON.stringify({ total: items.length, byYear })}`);
  items.sort((a, b) => a.sourceEventId.localeCompare(b.sourceEventId));
  const digest = sha256Hex(JSON.stringify(items.map((item) => [
    item.sourceEventId,
    item.priorEnvelopeSha256,
    item.newAttemptId,
    item.newEnvelopeSha256,
    item.reasonCode,
  ])));
  return Object.freeze({
    schemaVersion: "yw-evidence-replay-plan-v1",
    generation,
    policy,
    counts: Object.freeze({ total: items.length, byYear: Object.freeze(byYear) }),
    digest,
    items: Object.freeze(items),
  });
}

export const LEDGER_INSERT_SQL = `INSERT INTO evidence_replay_ledger (
    source_event_id, replay_batch_id, replay_generation, reason_code,
    prior_source_attempt_id, prior_envelope_sha256, prior_envelope_json, prior_outbox_state_json,
    prior_academic_year, new_source_attempt_id, new_envelope_sha256, new_academic_year, replayed_at
  )
  SELECT o.source_event_id, ?, ?, ?,
         ?, ?, o.envelope_json,
         json_object(
           'delivery_status', o.delivery_status,
           'delivery_attempts', o.delivery_attempts,
           'last_error_class', o.last_error_class,
           'last_attempt_at', o.last_attempt_at,
           'delivered_at', o.delivered_at,
           'central_disposition', o.central_disposition,
           'central_receipted_at', o.central_receipted_at,
           'created_at', o.created_at
         ),
         ?, ?, ?, ?, ?
    FROM evidence_outbox o
   WHERE o.source_event_id = ?
     AND o.central_disposition = 'quarantined'
     AND o.envelope_json = ?
     AND NOT EXISTS (
       SELECT 1 FROM evidence_replay_ledger l WHERE l.source_event_id = o.source_event_id
     )`;

// The new attempt is written only when the ledger row for exactly this plan
// item already archives the row's current (prior) envelope.
export const OUTBOX_REPLAY_UPDATE_SQL = `UPDATE evidence_outbox
     SET envelope_json = ?,
         central_disposition = NULL,
         central_receipted_at = NULL,
         delivery_status = 'pending',
         delivery_attempts = 0,
         last_error_class = '',
         last_attempt_at = NULL,
         delivered_at = NULL
   WHERE source_event_id = ?
     AND central_disposition = 'quarantined'
     AND envelope_json = ?
     AND EXISTS (
       SELECT 1 FROM evidence_replay_ledger l
        WHERE l.source_event_id = evidence_outbox.source_event_id
          AND l.replay_batch_id = ?
          AND l.new_envelope_sha256 = ?
          AND l.new_source_attempt_id = ?
          AND l.prior_envelope_json = evidence_outbox.envelope_json
     )`;

export function replayStatements(item, { batchId, generation, replayedAt }) {
  if (!/^yw-evidence-replay-[a-z0-9-]{8,80}$/.test(String(batchId ?? ""))) fail("batch id invalid");
  if (!Number.isFinite(Date.parse(replayedAt))) fail("replay timestamp invalid");
  return [
    {
      sql: LEDGER_INSERT_SQL,
      params: [
        batchId, generation, item.reasonCode,
        item.priorSourceAttemptId, item.priorEnvelopeSha256,
        item.priorAcademicYear, item.newAttemptId, item.newEnvelopeSha256, item.newAcademicYear, replayedAt,
        item.sourceEventId, item.priorEnvelopeJson,
      ],
    },
    {
      sql: OUTBOX_REPLAY_UPDATE_SQL,
      params: [
        item.newEnvelopeJson,
        item.sourceEventId, item.priorEnvelopeJson,
        batchId, item.newEnvelopeSha256, item.newAttemptId,
      ],
    },
  ];
}

export const REPLAY_STATE_SQL = `SELECT o.source_event_id, o.envelope_json, o.central_disposition,
         l.replay_batch_id, l.new_source_attempt_id, l.new_envelope_sha256,
         l.prior_envelope_json, l.prior_envelope_sha256
    FROM evidence_outbox o
    LEFT JOIN evidence_replay_ledger l ON l.source_event_id = o.source_event_id
   WHERE o.source_event_id = ?`;

/**
 * ready: quarantined with the exact prior envelope and no ledger row.
 * partial: ledger archived for this plan, outbox still holds the prior envelope.
 * replayed: ledger archived and the outbox holds the planned new envelope
 *           (whatever its later delivery or central disposition).
 * conflict: anything else; the replay stops before writing.
 */
export function classifyReplayState(item, state, { batchId }) {
  if (!state) return "conflict";
  const hasLedger = state.replay_batch_id !== null && state.replay_batch_id !== undefined;
  if (!hasLedger) {
    return state.central_disposition === "quarantined" && state.envelope_json === item.priorEnvelopeJson
      ? "ready"
      : "conflict";
  }
  const ledgerMatches = state.replay_batch_id === batchId
    && state.new_source_attempt_id === item.newAttemptId
    && state.new_envelope_sha256 === item.newEnvelopeSha256
    && state.prior_envelope_json === item.priorEnvelopeJson
    && state.prior_envelope_sha256 === item.priorEnvelopeSha256;
  if (!ledgerMatches) return "conflict";
  if (state.envelope_json === item.newEnvelopeJson) return "replayed";
  if (state.central_disposition === "quarantined" && state.envelope_json === item.priorEnvelopeJson) return "partial";
  return "conflict";
}

const EXPECTED_CHANGES = Object.freeze({ ready: [1, 1], partial: [0, 1] });

/**
 * Guarded executor. `query(sql, params)` returns rows; `batch(statements)`
 * runs one atomic D1 batch and returns per-statement `changes`. Without
 * `apply`, it only classifies. Any conflict or unexpected write count stops
 * the run; reruns converge without a second attempt.
 */
export async function executeEvidenceReplay({
  plan,
  expectedDigest,
  batchId,
  replayedAt,
  query,
  batch,
  apply = false,
}) {
  if (plan?.schemaVersion !== "yw-evidence-replay-plan-v1" || plan.digest !== expectedDigest) {
    fail("plan digest mismatch");
  }
  const classified = [];
  for (const item of plan.items) {
    const [state] = await query(REPLAY_STATE_SQL, [item.sourceEventId]);
    classified.push([item, classifyReplayState(item, state || null, { batchId })]);
  }
  const counts = { ready: 0, partial: 0, replayed: 0, conflict: 0 };
  for (const [, state] of classified) counts[state] += 1;
  if (counts.conflict > 0) {
    return Object.freeze({ applied: false, stopped: "conflict", counts, writes: 0 });
  }
  if (!apply) return Object.freeze({ applied: false, stopped: null, counts, writes: 0 });
  let writes = 0;
  const applied = { ready: 0, partial: 0 };
  for (const [item, state] of classified) {
    if (state === "replayed") continue;
    const changes = await batch(replayStatements(item, { batchId, generation: plan.generation, replayedAt }));
    const expectedChanges = EXPECTED_CHANGES[state];
    if (!Array.isArray(changes) || changes.length !== 2
      || changes[0] !== expectedChanges[0] || changes[1] !== expectedChanges[1]) {
      return Object.freeze({
        applied: true,
        stopped: "unexpected_changes",
        counts,
        writes,
        appliedCounts: applied,
        observedChanges: changes,
      });
    }
    writes += 1;
    applied[state] += 1;
  }
  return Object.freeze({ applied: true, stopped: null, counts, writes, appliedCounts: applied });
}
