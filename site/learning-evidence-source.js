const SOURCE_SYSTEM = "yuwen-course";
const SOURCE_SITE_KEY = "yw";
const ENVELOPE_SCHEMA = "bdfz-learning-evidence-v1";
const MAX_RAW_PAYLOAD_CHARS = 12000;
const SUBMISSION_RATE_LIMIT = Object.freeze({
  maxAttempts: 8,
  windowSeconds: 10 * 60,
});
const registryCache = { value: null, expiresAt: 0 };
const manifestCache = { value: null, expiresAt: 0 };

export class LearningSubmissionRateLimitError extends Error {
  constructor(retryAfterSeconds = SUBMISSION_RATE_LIMIT.windowSeconds) {
    super("提交过于频繁，请稍后继续修改");
    this.name = "LearningSubmissionRateLimitError";
    this.code = "learning_submission_rate_limited";
    this.retryAfterSeconds = Math.max(1, Number(retryAfterSeconds) || SUBMISSION_RATE_LIMIT.windowSeconds);
  }
}

function isoNow() {
  return new Date().toISOString();
}

function clean(value, max = 180) {
  return String(value ?? "").replace(/\r/g, "").trim().slice(0, max);
}

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clamp01(value) {
  const number = finiteOrNull(value);
  return number === null ? null : Math.max(0, Math.min(1, number));
}

function academicYearFor(occurredAt) {
  const date = new Date(occurredAt);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = Number(parts.find((part) => part.type === "year")?.value || date.getUTCFullYear());
  const month = Number(parts.find((part) => part.type === "month")?.value || 1);
  const start = month >= 9 ? year : year - 1;
  return `${start}-${start + 1}`;
}

async function loadAssetJson(request, env, pathname) {
  const url = new URL(pathname, request.url);
  const response = await env.ASSETS.fetch(new Request(url.toString(), { method: "GET" }));
  if (!response.ok) throw new Error(`authoritative asset unavailable: ${pathname}`);
  return response.json();
}

async function loadRegistry(request, env) {
  if (registryCache.value && registryCache.expiresAt > Date.now()) return registryCache.value;
  const registry = await loadAssetJson(request, env, "/data/interaction-definitions.json");
  if (registry?.schema !== "bdfz-learning-interaction-registry-v1"
      || Number(registry?.schemaVersion) !== 1
      || registry?.sourceSystem !== SOURCE_SYSTEM
      || registry?.sourceSiteKey !== SOURCE_SITE_KEY
      || !registry?.registryVersion
      || !registry?.definitions) {
    throw new Error("interaction registry contract invalid");
  }
  registryCache.value = registry;
  registryCache.expiresAt = Date.now() + 5 * 60 * 1000;
  return registry;
}

async function loadManifest(request, env) {
  if (manifestCache.value && manifestCache.expiresAt > Date.now()) return manifestCache.value;
  const manifest = await loadAssetJson(request, env, "/data/learning-manifest.json");
  if (Number(manifest?.schemaVersion) !== 1 || manifest?.siteKey !== SOURCE_SITE_KEY || !manifest?.manifestVersion) {
    throw new Error("learning manifest contract invalid");
  }
  manifest.itemByKey = new Map((manifest.items || []).map((item) => [String(item.resourceKey || ""), item]));
  manifestCache.value = manifest;
  manifestCache.expiresAt = Date.now() + 5 * 60 * 1000;
  return manifest;
}

function resourceKeyFor(definition, lessonId, payload) {
  if (definition.resourceKind === "manifest_interaction") {
    return `effect:${lessonId}:interaction:${payload.interactionKey}`;
  }
  if (definition.resourceKind === "manifest_vocab") {
    return `effect:${lessonId}:vocab:${clean(payload.itemId, 80)}`;
  }
  return `lesson:${lessonId}`;
}

function boundedRawPayload(definition, payload) {
  const out = {};
  for (const key of definition.allowedPayloadKeys || []) {
    if (!Object.hasOwn(payload, key)) continue;
    const value = payload[key];
    if (typeof value === "number" || typeof value === "boolean") out[key] = value;
    else if (Array.isArray(value)) out[key] = value.slice(0, 12).map((item) => clean(item, 500));
    else out[key] = clean(value, 3000);
  }
  const serialized = JSON.stringify(out);
  if (serialized.length > MAX_RAW_PAYLOAD_CHARS) throw new Error("interaction payload too large");
  return { value: out, serialized };
}

function publicSummary(item, lesson, definition) {
  return {
    lessonTitle: clean(lesson?.title || lesson?.tocLabel || lesson?.id, 120),
    itemTitle: clean(item?.itemTitle || definition.eventType, 160),
    itemGroup: clean(item?.itemGroup || lesson?.blockTitle || "高中語文", 80),
    eventType: definition.eventType,
  };
}

async function resolveInteractionContext(request, env, lesson, interactionKey, payload) {
  const registry = await loadRegistry(request, env);
  const definition = registry.definitions?.[interactionKey];
  if (!definition) throw new Error("interaction not registered");
  const normalizedPayload = { ...payload, interactionKey };
  const manifest = await loadManifest(request, env);
  const resourceKey = resourceKeyFor(definition, lesson.id, normalizedPayload);
  const manifestItem = definition.resourceKind.startsWith("manifest_")
    ? manifest.itemByKey.get(resourceKey)
    : null;
  if (definition.scoringRole === "a_plus_gate" && !manifestItem) {
    throw new Error("interaction absent from authoritative learning manifest");
  }
  return {
    registry,
    definition,
    normalizedPayload,
    manifest,
    resourceKey,
    manifestItem,
  };
}

async function existingInteraction(db, studentId, clientMutationId) {
  if (!clientMutationId) return null;
  return db.prepare(
    `SELECT i.source_event_id, i.attempt_no, i.resource_key, i.interaction_key,
            e.eligibility_status, e.raw_value,
            e.correctness, e.evaluation_json
       FROM learning_interactions i
       LEFT JOIN learning_evaluations e ON e.source_event_id = i.source_event_id
      WHERE i.student_id = ? AND i.client_mutation_id = ?`
  ).bind(studentId, clientMutationId).first();
}

function assertIdempotentReplayMatches(existing, resourceKey, interactionKey) {
  if (
    clean(existing?.resource_key, 220) !== resourceKey
    || clean(existing?.interaction_key, 60) !== interactionKey
  ) {
    const error = new Error("client mutation id already belongs to another learning item");
    error.code = "learning_mutation_conflict";
    throw error;
  }
}

function storedEvaluation(existing) {
  let value = {};
  try {
    value = JSON.parse(existing?.evaluation_json || "{}");
  } catch {
    value = {};
  }
  return {
    score: existing?.raw_value ?? finiteOrNull(value.score),
    correctness: clean(existing?.correctness || value.correctness || "not_verified", 32),
    provider: clean(value.provider, 40),
    verdict: clean(value.verdict, 240),
    strength: clean(value.strength, 500),
    gap: clean(value.gap, 500),
    nextQuestion: clean(value.nextQuestion, 500),
  };
}

async function enforceSubmissionRateLimit(db, studentId, resourceKey, definition, occurredAt) {
  if (definition.scoringRole === "none") return;
  const occurredAtMs = Date.parse(occurredAt);
  const windowEndMs = Number.isFinite(occurredAtMs) ? occurredAtMs : Date.now();
  const windowStart = new Date(windowEndMs - SUBMISSION_RATE_LIMIT.windowSeconds * 1000).toISOString();
  const windowEnd = new Date(windowEndMs).toISOString();
  const recent = await db.prepare(
    `SELECT COUNT(*) AS n, MIN(occurred_at) AS oldest_at
       FROM learning_interactions
      WHERE student_id = ? AND resource_key = ? AND occurred_at >= ? AND occurred_at <= ?`
  ).bind(studentId, resourceKey, windowStart, windowEnd).first();
  if (Number(recent?.n || 0) < SUBMISSION_RATE_LIMIT.maxAttempts) return;

  const oldestMs = Date.parse(recent?.oldest_at || "");
  const retryAfterSeconds = Number.isFinite(oldestMs)
    ? Math.min(
      SUBMISSION_RATE_LIMIT.windowSeconds,
      Math.ceil((oldestMs + SUBMISSION_RATE_LIMIT.windowSeconds * 1000 - windowEndMs) / 1000),
    )
    : SUBMISSION_RATE_LIMIT.windowSeconds;
  throw new LearningSubmissionRateLimitError(retryAfterSeconds);
}

function normalizeServerEvaluation(definition, interactionKey, evaluation) {
  const numericScore = finiteOrNull(evaluation?.score);
  const normalizedValue = numericScore === null ? null : clamp01(numericScore / 100);
  const correctness = clean(evaluation?.correctness || "not_verified", 32).toLowerCase();
  const verdict = clean(evaluation?.verdict, 240);
  let eligibilityStatus = "eligible";
  let eligibilityReason = "registered_server_event";
  if (definition.scoringRole === "none") {
    eligibilityStatus = "non_scoring";
    eligibilityReason = "scoring_role_none";
  } else if (definition.assessmentKind === "performance") {
    const correctnessPassed = definition.verificationMethod === "source_ai_assessment"
      ? correctness === "passed"
      : correctness === "passed" || correctness === "correct";
    if (interactionKey === "vocabAnswer" && verdict.toLowerCase() !== "mastered") {
      eligibilityStatus = "ineligible";
      eligibilityReason = "vocab_not_mastered";
    } else if (numericScore === null || numericScore < 60) {
      eligibilityStatus = "ineligible";
      eligibilityReason = "performance_below_60";
    } else if (!correctnessPassed) {
      eligibilityStatus = "ineligible";
      eligibilityReason = "performance_not_passed";
    } else {
      eligibilityReason = "server_performance_passed";
    }
  }
  return {
    numericScore,
    normalizedValue,
    correctness,
    verdict,
    eligibilityStatus,
    eligibilityReason,
  };
}

async function attemptNumber(db, studentId, resourceKey, interactionKey) {
  const row = await db.prepare(
    "SELECT COALESCE(MAX(attempt_no), 0) + 1 AS n FROM learning_interactions WHERE student_id = ? AND resource_key = ? AND interaction_key = ?"
  ).bind(studentId, resourceKey, interactionKey).first();
  return Number(row?.n || 1);
}

export async function assertLearningSubmissionAllowed({
  request,
  env,
  student,
  lesson,
  interactionKey,
  payload = {},
  occurredAt = isoNow(),
}) {
  if (!env.READING_DB || !student?.id || !lesson?.id) throw new Error("learning evidence source unavailable");
  const context = await resolveInteractionContext(request, env, lesson, interactionKey, payload);
  const clientMutationId = clean(payload.clientMutationId, 100);
  const existing = await existingInteraction(env.READING_DB, student.id, clientMutationId);
  if (existing) {
    assertIdempotentReplayMatches(existing, context.resourceKey, interactionKey);
    return {
      allowed: true,
      deduped: true,
      sourceEventId: existing.source_event_id,
      attemptNo: Number(existing.attempt_no),
      eligibilityStatus: clean(existing.eligibility_status, 32),
      evaluation: storedEvaluation(existing),
    };
  }
  await enforceSubmissionRateLimit(
    env.READING_DB,
    student.id,
    context.resourceKey,
    context.definition,
    occurredAt,
  );
  return {
    allowed: true,
    deduped: false,
    resourceKey: context.resourceKey,
  };
}

async function enqueueOutbox(env, sourceEventId, envelope) {
  if (!env.LEARNING_EVIDENCE_QUEUE || !Number.isInteger(Number(envelope.userId)) || Number(envelope.userId) <= 0) {
    return { status: "local_only" };
  }
  try {
    await env.LEARNING_EVIDENCE_QUEUE.send(envelope, { contentType: "json" });
    await env.READING_DB.prepare(
      "UPDATE evidence_outbox SET delivery_status = 'enqueued', delivery_attempts = delivery_attempts + 1, last_error_class = '', last_attempt_at = ?, delivered_at = NULL WHERE source_event_id = ?"
    ).bind(isoNow(), sourceEventId).run();
    return { status: "enqueued" };
  } catch (error) {
    await env.READING_DB.prepare(
      "UPDATE evidence_outbox SET delivery_status = 'pending', delivery_attempts = delivery_attempts + 1, last_error_class = ?, last_attempt_at = ? WHERE source_event_id = ?"
    ).bind(clean(error?.name || "QueueError", 80), isoNow(), sourceEventId).run();
    return { status: "pending" };
  }
}

export async function recordLearningInteraction({
  request,
  env,
  student,
  lesson,
  interactionKey,
  payload = {},
  evaluation = null,
  occurredAt = isoNow(),
}) {
  if (!env.READING_DB || !student?.id || !lesson?.id) throw new Error("learning evidence source unavailable");
  const {
    registry,
    definition,
    normalizedPayload,
    manifest,
    resourceKey,
    manifestItem,
  } = await resolveInteractionContext(request, env, lesson, interactionKey, payload);
  const raw = boundedRawPayload(definition, normalizedPayload);

  const clientMutationId = clean(payload.clientMutationId, 100);
  const existing = await existingInteraction(env.READING_DB, student.id, clientMutationId);
  if (existing) {
    assertIdempotentReplayMatches(existing, resourceKey, interactionKey);
    const existingEligibility = clean(existing.eligibility_status, 32);
    return {
      ok: true,
      deduped: true,
      sourceEventId: existing.source_event_id,
      attemptNo: Number(existing.attempt_no),
      eligibilityStatus: existingEligibility,
      evaluation: storedEvaluation(existing),
      delivery: existingEligibility === "ineligible"
        ? "already_recorded_ineligible"
        : "already_recorded",
    };
  }

  await enforceSubmissionRateLimit(
    env.READING_DB,
    student.id,
    resourceKey,
    definition,
    occurredAt,
  );
  const sourceEventId = crypto.randomUUID();
  const attemptNo = await attemptNumber(env.READING_DB, student.id, resourceKey, interactionKey);
  const normalizedEvaluation = normalizeServerEvaluation(definition, interactionKey, evaluation);
  const {
    numericScore,
    normalizedValue,
    correctness,
    verdict,
    eligibilityStatus,
    eligibilityReason,
  } = normalizedEvaluation;
  const summary = publicSummary(manifestItem, lesson, definition);
  const envelope = {
    schema: ENVELOPE_SCHEMA,
    schemaVersion: 1,
    sourceSystem: SOURCE_SYSTEM,
    sourceSiteKey: SOURCE_SITE_KEY,
    sourceEventId,
    sourceVersion: manifest.manifestVersion,
    registryVersion: registry.registryVersion,
    userId: Number(student.ucUserId || 0),
    academicYear: academicYearFor(occurredAt),
    dimensionKey: definition.dimensionKey,
    eventType: definition.eventType,
    interactionKey,
    assessmentKind: definition.assessmentKind,
    scoringRole: definition.scoringRole,
    verificationMethod: definition.verificationMethod,
    eligibilityStatus,
    resourceKey,
    classSessionId: clean(payload.classSessionId, 100),
    lessonPhase: clean(payload.lessonPhase, 60),
    attemptNo,
    rawValue: numericScore,
    maxValue: numericScore === null ? null : 100,
    normalizedValue,
    occurredAt,
    sourceUrl: `https://yw.bdfz.net/#${encodeURIComponent(lesson.id)}`,
    sourcePayloadRef: `learning_interactions:${sourceEventId}`,
    summary,
    facets: [
      { key: "lesson", value: lesson.id },
      { key: "block", value: clean(lesson.blockId || lesson.blockTitle, 80) },
      { key: "assessment", value: definition.assessmentKind },
    ],
  };

  const statements = [
    env.READING_DB.prepare(
      `INSERT INTO learning_interactions (
         source_event_id, student_id, uc_user_id, academic_year, lesson_id, interaction_key,
         event_type, assessment_kind, scoring_role, resource_key, resource_version, registry_version,
         class_session_id, lesson_phase, attempt_no, client_mutation_id, raw_payload_json, occurred_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      sourceEventId, student.id, student.ucUserId || null, envelope.academicYear, lesson.id, interactionKey,
      definition.eventType, definition.assessmentKind, definition.scoringRole, resourceKey, manifest.manifestVersion,
      registry.registryVersion, envelope.classSessionId, envelope.lessonPhase, attemptNo, clientMutationId,
      raw.serialized, occurredAt
    ),
    env.READING_DB.prepare(
      `INSERT INTO learning_evaluations (
         source_event_id, verification_method, eligibility_status, raw_value, max_value,
         normalized_value, correctness, evaluation_json, evaluated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      sourceEventId, definition.verificationMethod, eligibilityStatus, numericScore,
      numericScore === null ? null : 100, normalizedValue, correctness,
      JSON.stringify({
        score: numericScore,
        correctness,
        provider: clean(evaluation?.provider, 40),
        verdict,
        strength: clean(evaluation?.strength, 500),
        gap: clean(evaluation?.gap, 500),
        nextQuestion: clean(evaluation?.nextQuestion, 500),
        eligibilityReason,
      }),
      occurredAt
    ),
    env.READING_DB.prepare(
      "INSERT INTO evidence_outbox (source_event_id, envelope_json) VALUES (?, ?)"
    ).bind(sourceEventId, JSON.stringify(envelope)),
  ];
  await env.READING_DB.batch(statements);

  const delivery = await enqueueOutbox(env, sourceEventId, envelope);
  return {
    ok: true,
    deduped: false,
    sourceEventId,
    attemptNo,
    eligibilityStatus,
    delivery: eligibilityStatus === "ineligible"
      ? `${delivery.status}_ineligible`
      : delivery.status,
  };
}

export async function retryPendingEvidence(env, limit = 10) {
  if (!env.READING_DB || !env.LEARNING_EVIDENCE_QUEUE) return { attempted: 0, enqueued: 0 };
  const rows = await env.READING_DB.prepare(
    "SELECT source_event_id, envelope_json FROM evidence_outbox WHERE delivery_status = 'pending' ORDER BY id LIMIT ?"
  ).bind(Math.max(1, Math.min(50, Number(limit) || 10))).all();
  let enqueued = 0;
  for (const row of rows.results || []) {
    const envelope = JSON.parse(row.envelope_json || "{}");
    const result = await enqueueOutbox(env, row.source_event_id, envelope);
    if (result.status === "enqueued") enqueued += 1;
  }
  return { attempted: (rows.results || []).length, enqueued };
}

export const learningEvidenceContract = Object.freeze({
  envelopeSchema: ENVELOPE_SCHEMA,
  sourceSystem: SOURCE_SYSTEM,
  sourceSiteKey: SOURCE_SITE_KEY,
  academicYearFor,
  submissionRateLimit: SUBMISSION_RATE_LIMIT,
});
