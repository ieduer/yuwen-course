import { loadClassicalFirstRead } from "./classical-first-read-source.js";

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
const formativeManifestCache = { value: null, expiresAt: 0 };

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
  const compatibility = registry.compatibilityContracts?.aPlusGate;
  if (
    compatibility?.schemaVersion !== "yw-aplus-producer-compatibility-v1"
    || !/^yw-[a-f0-9]{16}$/.test(String(compatibility?.sourceVersion || ""))
    || compatibility?.registryVersion !== "yw-interactions-2026-07-26-v1"
    || !/^sha256:[a-f0-9]{64}$/.test(String(compatibility?.resourceKeyHash || ""))
    || !/^yw-[a-f0-9]{16}$/.test(String(compatibility?.reviewedProducerManifestVersion || ""))
    || !/^sha256:[a-f0-9]{64}$/.test(String(compatibility?.reviewedProducerManifestDigest || ""))
    || !Number.isInteger(Number(compatibility?.reviewedProducerItemCount))
  ) throw new Error("A+ producer compatibility contract invalid");
  registryCache.value = registry;
  registryCache.expiresAt = Date.now() + 5 * 60 * 1000;
  return registry;
}

function evidenceVersions(registry, manifest, definition, formativeManifest) {
  if (definition.scoringRole === "a_plus_gate") {
    const contract = registry.compatibilityContracts.aPlusGate;
    if (
      manifest.manifestVersion !== contract.reviewedProducerManifestVersion
      || manifest.resourceKeyHash !== contract.reviewedProducerManifestDigest
      || Number(manifest.itemCount) !== Number(contract.reviewedProducerItemCount)
    ) throw new Error("current A+ resources have not been reviewed against the frozen scoring manifest");
    return {
      sourceVersion: contract.sourceVersion,
      registryVersion: contract.registryVersion,
      producerManifestVersion: manifest.manifestVersion,
    };
  }
  if (formativeManifest?.manifestVersion) {
    return {
      sourceVersion: formativeManifest.manifestVersion,
      registryVersion: registry.registryVersion,
      producerManifestVersion: manifest.manifestVersion,
    };
  }
  return {
    sourceVersion: manifest.manifestVersion,
    registryVersion: registry.registryVersion,
    producerManifestVersion: manifest.manifestVersion,
  };
}

async function loadManifest(request, env) {
  if (manifestCache.value && manifestCache.expiresAt > Date.now()) return manifestCache.value;
  const manifest = await loadAssetJson(request, env, "/data/learning-manifest.json");
  if (
    Number(manifest?.schemaVersion) !== 1
    || manifest?.siteKey !== SOURCE_SITE_KEY
    || !/^yw-[a-f0-9]{16}$/.test(String(manifest?.manifestVersion || ""))
    || !/^sha256:[a-f0-9]{64}$/.test(String(manifest?.resourceKeyHash || ""))
    || !Array.isArray(manifest?.items)
    || Number(manifest?.itemCount) !== manifest.items.length
  ) {
    throw new Error("learning manifest contract invalid");
  }
  manifest.itemByKey = new Map((manifest.items || []).map((item) => [String(item.resourceKey || ""), item]));
  if (manifest.itemByKey.size !== manifest.items.length || manifest.itemByKey.has("")) {
    throw new Error("learning manifest resource identity invalid");
  }
  manifestCache.value = manifest;
  manifestCache.expiresAt = Date.now() + 5 * 60 * 1000;
  return manifest;
}

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableJson(value[key])]));
}

async function sha256Text(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function assertFormativeSourceBinding(manifest, learningManifest) {
  if (
    manifest.formalLearningManifestVersion !== learningManifest.manifestVersion
    || manifest.formalLearningManifestDigest !== learningManifest.resourceKeyHash
  ) throw new Error("formative competency manifest source binding invalid");
}

async function loadFormativeManifest(request, env, learningManifest) {
  if (formativeManifestCache.value && formativeManifestCache.expiresAt > Date.now()) {
    assertFormativeSourceBinding(formativeManifestCache.value, learningManifest);
    return formativeManifestCache.value;
  }
  const manifest = await loadAssetJson(request, env, "/data/lesson-competency-manifest.json");
  if (
    manifest?.schemaVersion !== "yw-lesson-competency-manifest-v1"
    || manifest?.sourceSiteKey !== SOURCE_SITE_KEY
    || !manifest?.manifestVersion
    || manifest?.registryVersion !== "yw-interactions-2026-08-09-v2"
    || !/^sha256:[a-f0-9]{64}$/.test(String(manifest?.manifestDigest || ""))
    || !/^sha256:[a-f0-9]{64}$/.test(String(manifest?.studyGuideCatalogDigest || ""))
    || !/^sha256:[a-f0-9]{64}$/.test(String(manifest?.firstReadPolicyDigest || ""))
    || manifest?.historyPolicy?.identityUnit !== "lesson_competency_semantic_revision"
    || manifest?.historyPolicy?.itemKeyRole !== "internal_editor_address_only"
    || !Array.isArray(manifest?.tombstones)
    || !Array.isArray(manifest?.lessons)
  ) throw new Error("formative competency manifest contract invalid");
  assertFormativeSourceBinding(manifest, learningManifest);
  const itemByKey = new Map();
  const processByKey = new Map();
  const completionKeys = new Set();
  const descriptorRows = [];
  const allowedCompetencies = new Set(["first_read_process", "vocabulary", "syntax", "comprehension"]);
  if (Number(manifest.lessonCount) !== manifest.lessons.length) {
    throw new Error("formative competency lesson count invalid");
  }
  for (const lesson of manifest.lessons) {
    if (!/^lesson-[\w-]{1,60}$/.test(String(lesson?.lessonId || "")) || !Array.isArray(lesson?.competencies)) {
      throw new Error("formative competency lesson invalid");
    }
    for (const competency of lesson.competencies || []) {
      if (!allowedCompetencies.has(competency?.competencyTag) || !Array.isArray(competency?.items)) {
        throw new Error("formative competency group invalid");
      }
      if (Number(competency.activeItemCount) !== competency.items.length) {
        throw new Error("formative competency active count invalid");
      }
      const expectedSetHash = `sha256:${await sha256Text(competency.items.map((item) => item.completionKey).sort().join("\n"))}`;
      if (competency.activeSetHash !== expectedSetHash) throw new Error("formative competency active set hash invalid");
      for (const item of competency.items || []) {
        if (
          item.active !== true
          || item.lessonId !== lesson.lessonId
          || item.competencyTag !== competency.competencyTag
          || !item.itemKey
          || !item.interactionKey
          || !item.resourceKey
          || item.completionKey !== `${item.resourceKey}#${item.interactionKey}`
          || completionKeys.has(item.completionKey)
        ) throw new Error("formative competency item identity invalid");
        if (item.sourceKind === "study_guide") {
          const expectedResource = `formative:${lesson.lessonId}:${competency.competencyTag}:${item.semanticRevision}`;
          if (
            item.interactionKey !== "studyGuideItemCompleted"
            || item.scoringRole !== "formative"
            || !["source_answer", "codex_reference"].includes(item.answerAuthority)
            || !/^[a-f0-9]{16}$/.test(String(item.semanticRevision || ""))
            || item.resourceKey !== expectedResource
            || !Array.isArray(item.resourceAliases)
            || !Array.isArray(item.completionAliases)
            || item.resourceAliases.some((alias) => !new RegExp(`^formative:${lesson.lessonId}:${competency.competencyTag}:[a-f0-9]{16}$`).test(alias))
            || item.completionAliases.length !== item.resourceAliases.length
            || item.completionAliases.some((alias, index) => alias !== `${item.resourceAliases[index]}#studyGuideItemCompleted`)
          ) throw new Error("study-guide formative item invalid");
        } else if (item.sourceKind === "classical_first_read") {
          if (
            !["initialReadingSubmitted", "initialReadingResolved"].includes(item.interactionKey)
            || item.scoringRole !== "none"
            || item.answerAuthority !== "process_evidence"
            || item.resourceKey !== `lesson:${lesson.lessonId}`
            || competency.competencyTag !== "first_read_process"
          ) throw new Error("classical first-read formative item invalid");
        } else if (item.sourceKind === "formal_learning_manifest") {
          if (
            item.scoringRole !== "a_plus_gate"
            || !["source_answer", "source_assessment"].includes(item.answerAuthority)
            || !item.itemKey.startsWith("formal:")
            || !item.resourceKey.startsWith(`effect:${lesson.lessonId}:`)
          ) throw new Error("formal formative item invalid");
        } else {
          throw new Error("formative competency source kind invalid");
        }
        completionKeys.add(item.completionKey);
        descriptorRows.push({ lessonId: lesson.lessonId, competencyTag: competency.competencyTag, ...item });
        itemByKey.set(`${lesson.lessonId}\n${item.itemKey}`, {
          ...item,
          lessonId: lesson.lessonId,
          competencyTag: competency.competencyTag,
        });
        if (item.sourceKind === "classical_first_read") {
          processByKey.set(`${lesson.lessonId}\n${item.interactionKey}`, {
            ...item,
            lessonId: lesson.lessonId,
            competencyTag: competency.competencyTag,
          });
        }
      }
    }
  }
  if (Number(manifest.itemCount) !== descriptorRows.length) throw new Error("formative competency item count invalid");
  const tombstoneKeys = new Set();
  for (const tombstone of manifest.tombstones) {
    const expectedResource = `formative:${tombstone?.lessonId}:${tombstone?.competencyTag}:${tombstone?.semanticRevision}`;
    if (!/^lesson-[\w-]{1,60}$/.test(String(tombstone?.lessonId || ""))
      || !allowedCompetencies.has(tombstone?.competencyTag)
      || !/^[a-f0-9]{16}$/.test(String(tombstone?.semanticRevision || ""))
      || tombstone?.resourceKey !== expectedResource
      || !["inactive", "review_required_inactive"].includes(tombstone?.disposition)
      || completionKeys.has(`${tombstone.resourceKey}#studyGuideItemCompleted`)
      || tombstoneKeys.has(tombstone.resourceKey)) {
      throw new Error("formative competency tombstone invalid");
    }
    tombstoneKeys.add(tombstone.resourceKey);
  }
  const expectedDigest = `sha256:${await sha256Text(JSON.stringify(stableJson({
    descriptorRows,
    historyPolicy: manifest.historyPolicy,
    tombstones: manifest.tombstones,
  })))}`;
  if (manifest.manifestDigest !== expectedDigest || manifest.manifestVersion !== `yw-formative-${expectedDigest.slice(7, 23)}`) {
    throw new Error("formative competency semantic digest invalid");
  }
  manifest.itemByKey = itemByKey;
  manifest.processByKey = processByKey;
  formativeManifestCache.value = manifest;
  formativeManifestCache.expiresAt = Date.now() + 5 * 60 * 1000;
  return manifest;
}

async function assertClassicalFirstReadGate({ request, env, student, lesson, interactionKey, formativeManifest }) {
  if (["lessonOpened", "initialReadingSubmitted"].includes(interactionKey)) return;
  if (!formativeManifest.processByKey.has(`${lesson.id}\ninitialReadingSubmitted`)) return;
  const asset = await loadClassicalFirstRead(request, env, lesson.id);
  const session = await env.READING_DB.prepare(
    `SELECT submitted_at FROM classical_first_read_sessions
      WHERE student_id = ? AND lesson_id = ? AND text_version_id = ?`
  ).bind(student.id, lesson.id, asset.textVersionId).first();
  if (!session?.submitted_at) {
    const error = new Error("請先完成無標點初讀再進入本課後續關卡");
    error.code = "classical_first_read_required";
    throw error;
  }
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
    else out[key] = clean(value, key === "response" ? 4000 : 3000);
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

async function resolveInteractionContext(request, env, student, lesson, interactionKey, payload) {
  const registry = await loadRegistry(request, env);
  const registeredDefinition = registry.definitions?.[interactionKey];
  if (!registeredDefinition) throw new Error("interaction not registered");
  let definition = registeredDefinition;
  let normalizedPayload = { ...payload, interactionKey };
  let formativeItem = null;
  const manifest = await loadManifest(request, env);
  const formativeManifest = await loadFormativeManifest(request, env, manifest);
  if (registeredDefinition.resourceKind === "formative_item") {
    const itemKey = clean(payload.itemKey, 180);
    formativeItem = formativeManifest.itemByKey.get(`${lesson.id}\n${itemKey}`);
    if (!formativeItem || formativeItem.interactionKey !== interactionKey) {
      throw new Error("formative item absent from current active lesson set");
    }
    definition = { ...registeredDefinition, competencyTag: formativeItem.competencyTag };
    const response = clean(payload.response, 4000).normalize("NFC");
    const revealedAt = clean(payload.referenceRevealedAt, 40);
    if (!response || [...response].length > 4000 || !Number.isFinite(Date.parse(revealedAt))) {
      throw new Error("請先提交自己的答案並對照參考答案");
    }
    normalizedPayload = {
      ...normalizedPayload,
      itemKey: formativeItem.itemKey,
      competencyTag: formativeItem.competencyTag,
      answerAuthority: formativeItem.answerAuthority,
      responseDigest: `sha256:${await sha256Text(response)}`,
      responseLength: [...response].length,
      referenceRevealedAt: new Date(revealedAt).toISOString(),
    };
  } else if (registeredDefinition.competencyTag === "first_read_process") {
    formativeItem = formativeManifest.processByKey.get(`${lesson.id}\n${interactionKey}`);
    if (!formativeItem) throw new Error("first-read process absent from current active lesson set");
    definition = { ...registeredDefinition, competencyTag: formativeItem.competencyTag };
  }
  const resourceKey = formativeItem?.resourceKey || resourceKeyFor(definition, lesson.id, normalizedPayload);
  const manifestItem = formativeItem
    ? {
      itemTitle: "學案知能清算",
      itemGroup: lesson?.blockTitle || "高中語文",
    }
    : (definition.resourceKind.startsWith("manifest_") ? manifest.itemByKey.get(resourceKey) : null);
  if (definition.scoringRole === "a_plus_gate" && !manifestItem) {
    throw new Error("interaction absent from authoritative learning manifest");
  }
  await assertClassicalFirstReadGate({ request, env, student, lesson, interactionKey, formativeManifest });
  return {
    registry,
    definition,
    normalizedPayload,
    manifest,
    resourceKey,
    manifestItem,
    formativeManifest,
    formativeItem,
  };
}

async function existingInteraction(db, studentId, clientMutationId) {
  if (!clientMutationId) return null;
  return db.prepare(
    `SELECT i.source_event_id, i.attempt_no, i.resource_key, i.interaction_key,
            i.raw_payload_json,
            e.eligibility_status, e.raw_value,
            e.correctness, e.evaluation_json, o.delivery_status
       FROM learning_interactions i
       LEFT JOIN learning_evaluations e ON e.source_event_id = i.source_event_id
       LEFT JOIN evidence_outbox o ON o.source_event_id = i.source_event_id
      WHERE i.student_id = ? AND i.client_mutation_id = ?`
  ).bind(studentId, clientMutationId).first();
}

function isUniqueConstraintError(error) {
  const message = [error?.message, error?.cause?.message]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return message.includes("unique constraint") || message.includes("constraint failed");
}

function dedupedInteractionResult(existing) {
  const existingEligibility = clean(existing?.eligibility_status, 32);
  return {
    ok: true,
    deduped: true,
    sourceEventId: existing.source_event_id,
    attemptNo: Number(existing.attempt_no),
    eligibilityStatus: existingEligibility,
    evaluation: storedEvaluation(existing),
    delivery: existingEligibility === "ineligible"
      ? "already_recorded_ineligible"
      : clean(existing?.delivery_status || "already_recorded", 40),
  };
}

function assertIdempotentReplayMatches(existing, resourceKey, interactionKey, rawPayloadJson = null) {
  if (
    clean(existing?.resource_key, 220) !== resourceKey
    || clean(existing?.interaction_key, 60) !== interactionKey
    || (rawPayloadJson !== null && String(existing?.raw_payload_json || "") !== rawPayloadJson)
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
  const occurredAtMs = Date.parse(occurredAt);
  const windowEndMs = Number.isFinite(occurredAtMs) ? occurredAtMs : Date.now();
  const windowMs = SUBMISSION_RATE_LIMIT.windowSeconds * 1000;
  const windowStartMs = Math.floor(windowEndMs / windowMs) * windowMs;
  const windowStart = new Date(windowStartMs).toISOString();
  const windowEnd = new Date(windowStartMs + windowMs).toISOString();
  const resourceLimit = definition.scoringRole === "none" ? 60 : SUBMISSION_RATE_LIMIT.maxAttempts;
  const globalLimit = 300;
  const [recent, globalRecent, resourceSlots, globalSlots] = await Promise.all([
    db.prepare(
      `SELECT COUNT(*) AS n FROM learning_interactions
        WHERE student_id = ? AND resource_key = ? AND occurred_at >= ? AND occurred_at < ?`
    ).bind(studentId, resourceKey, windowStart, windowEnd).first(),
    db.prepare(
      `SELECT COUNT(*) AS n FROM learning_interactions
        WHERE student_id = ? AND occurred_at >= ? AND occurred_at < ?`
    ).bind(studentId, windowStart, windowEnd).first(),
    db.prepare(
      `SELECT COUNT(*) AS n FROM learning_submission_slots
        WHERE student_id = ? AND resource_key = ? AND window_start = ?`
    ).bind(studentId, resourceKey, windowStart).first(),
    db.prepare(
      `SELECT COUNT(*) AS n FROM learning_submission_slots
        WHERE student_id = ? AND window_start = ?`
    ).bind(studentId, windowStart).first(),
  ]);
  if (Number(recent?.n || 0) >= resourceLimit || Number(globalRecent?.n || 0) >= globalLimit) {
    throw new LearningSubmissionRateLimitError(Math.max(1, Math.ceil((windowStartMs + windowMs - windowEndMs) / 1000)));
  }
  return {
    windowStart,
    resourceSlotNo: Number(resourceSlots?.n || 0) + 1,
    globalSlotNo: Number(globalSlots?.n || 0) + 1,
  };
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
  const context = await resolveInteractionContext(request, env, student, lesson, interactionKey, payload);
  const raw = boundedRawPayload(context.definition, context.normalizedPayload);
  const clientMutationId = clean(payload.clientMutationId, 100);
  const existing = await existingInteraction(env.READING_DB, student.id, clientMutationId);
  if (existing) {
    assertIdempotentReplayMatches(existing, context.resourceKey, interactionKey, raw.serialized);
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
  sourceMutation = null,
  contentionRetry = 0,
}) {
  if (!env.READING_DB || !student?.id || !lesson?.id) throw new Error("learning evidence source unavailable");
  const {
    registry,
    definition,
    normalizedPayload,
    manifest,
    resourceKey,
    manifestItem,
    formativeManifest,
    formativeItem,
  } = await resolveInteractionContext(request, env, student, lesson, interactionKey, payload);
  const raw = boundedRawPayload(definition, normalizedPayload);

  const clientMutationId = clean(payload.clientMutationId, 100);
  const existing = await existingInteraction(env.READING_DB, student.id, clientMutationId);
  if (existing) {
    assertIdempotentReplayMatches(existing, resourceKey, interactionKey, raw.serialized);
    return dedupedInteractionResult(existing);
  }

  const rateReservation = await enforceSubmissionRateLimit(
    env.READING_DB,
    student.id,
    resourceKey,
    definition,
    occurredAt,
  );
  const sourceEventId = crypto.randomUUID();
  const attemptNo = await attemptNumber(env.READING_DB, student.id, resourceKey, interactionKey);
  const mutation = typeof sourceMutation === "function"
    ? await sourceMutation({ attemptNo, db: env.READING_DB, student, lesson, resourceKey })
    : null;
  const effectiveEvaluation = mutation?.evaluation || evaluation;
  const sourceStatements = Array.isArray(mutation?.statements) ? mutation.statements : [];
  if (sourceStatements.length > 8) throw new Error("source mutation statement limit exceeded");
  const normalizedEvaluation = normalizeServerEvaluation(definition, interactionKey, effectiveEvaluation);
  const {
    numericScore,
    normalizedValue,
    correctness,
    verdict,
    eligibilityStatus,
    eligibilityReason,
  } = normalizedEvaluation;
  const versions = evidenceVersions(registry, manifest, definition, formativeManifest);
  const summary = publicSummary(manifestItem, lesson, definition);
  const envelope = {
    schema: ENVELOPE_SCHEMA,
    schemaVersion: 1,
    sourceSystem: SOURCE_SYSTEM,
    sourceSiteKey: SOURCE_SITE_KEY,
    sourceEventId,
    sourceVersion: versions.sourceVersion,
    registryVersion: versions.registryVersion,
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
      ...(definition.competencyTag
        ? [{ key: "competency", value: clean(definition.competencyTag, 60) }]
        : []),
      ...(formativeManifest?.manifestVersion
        ? [{ key: "formative_manifest", value: clean(formativeManifest.manifestVersion, 80) }]
        : []),
      ...(formativeItem?.answerAuthority
        ? [{ key: "answer_authority", value: clean(formativeItem.answerAuthority, 60) }]
        : []),
      ...(definition.scoringRole === "a_plus_gate"
        ? [{ key: "producer_manifest", value: clean(versions.producerManifestVersion, 80) }]
        : []),
    ],
  };

  const statements = [
    env.READING_DB.prepare(
      `INSERT INTO learning_submission_slots (
         source_event_id, student_id, resource_key, window_start, resource_slot_no, global_slot_no
       ) VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(
      sourceEventId,
      student.id,
      resourceKey,
      rateReservation.windowStart,
      rateReservation.resourceSlotNo,
      rateReservation.globalSlotNo,
    ),
    ...sourceStatements,
    env.READING_DB.prepare(
      `INSERT INTO learning_interactions (
         source_event_id, student_id, uc_user_id, academic_year, lesson_id, interaction_key,
         event_type, assessment_kind, scoring_role, resource_key, resource_version, registry_version,
         class_session_id, lesson_phase, attempt_no, client_mutation_id, raw_payload_json, occurred_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      sourceEventId, student.id, student.ucUserId || null, envelope.academicYear, lesson.id, interactionKey,
      definition.eventType, definition.assessmentKind, definition.scoringRole, resourceKey, versions.sourceVersion,
      versions.registryVersion, envelope.classSessionId, envelope.lessonPhase, attemptNo, clientMutationId,
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
        provider: clean(effectiveEvaluation?.provider, 40),
        verdict,
        strength: clean(effectiveEvaluation?.strength, 500),
        gap: clean(effectiveEvaluation?.gap, 500),
        nextQuestion: clean(effectiveEvaluation?.nextQuestion, 500),
        eligibilityReason,
      }),
      occurredAt
    ),
    env.READING_DB.prepare(
      "INSERT INTO evidence_outbox (source_event_id, envelope_json) VALUES (?, ?)"
    ).bind(sourceEventId, JSON.stringify(envelope)),
  ];
  try {
    await env.READING_DB.batch(statements);
  } catch (error) {
    // Two same-mutation requests can both pass the read check. The D1 unique
    // index is authoritative; the losing request re-reads the committed row.
    if (clientMutationId && isUniqueConstraintError(error)) {
      const winner = await existingInteraction(env.READING_DB, student.id, clientMutationId);
      if (winner) {
        assertIdempotentReplayMatches(winner, resourceKey, interactionKey, raw.serialized);
        return dedupedInteractionResult(winner);
      }
      if (Number(contentionRetry) < 3) {
        return recordLearningInteraction({
          request,
          env,
          student,
          lesson,
          interactionKey,
          payload,
          evaluation,
          occurredAt,
          sourceMutation,
          contentionRetry: Number(contentionRetry) + 1,
        });
      }
    }
    throw error;
  }

  const delivery = await enqueueOutbox(env, sourceEventId, envelope);
  return {
    ok: true,
    deduped: false,
    sourceEventId,
    attemptNo,
    eligibilityStatus,
    sourceMutationResult: mutation?.result || null,
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
