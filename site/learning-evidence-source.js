import {
  hasClassicalAnnotatedReadReceipt,
  loadClassicalFirstRead,
} from "./classical-first-read-source.js";

const SOURCE_SYSTEM = "yuwen-course";
const SOURCE_SITE_KEY = "yw";
const ENVELOPE_SCHEMA = "bdfz-learning-evidence-event-v2";
const CURRENT_A_PLUS_CONTRACT_VERSION = "yw-aplus-e310-v2";
const MAX_RAW_PAYLOAD_CHARS = 12000;
const SUBMISSION_RATE_LIMIT = Object.freeze({
  maxAttempts: 8,
  windowSeconds: 10 * 60,
});
const SUBMISSION_RESERVATION_LEASE_SECONDS = 60;
const EVALUATOR_FAILURE_COOLDOWN_SECONDS = 15;
export const learningEvaluatorCallBudget = Object.freeze({
  studentWindowLimit: 60,
  mutationWindowLimit: 4,
  windowSeconds: SUBMISSION_RATE_LIMIT.windowSeconds,
});
const SUBMISSION_RATE_LIMIT_REASONS = Object.freeze({
  windowCapacity: "window_capacity",
});
const registryCache = { value: null, expiresAt: 0 };
const manifestCache = { value: null, expiresAt: 0 };
const formativeManifestCache = { value: null, expiresAt: 0 };
const trustedSubmissionReservations = new WeakSet();
const A_PLUS_COMPATIBILITY_KEYS = Object.freeze([
  "schemaVersion",
  "contractVersion",
  "sourceVersion",
  "sourceReleaseId",
  "mappingVersion",
  "registryVersion",
  "itemCount",
  "resourceKeyHash",
  "eligibleAssessmentKind",
  "eligibleScoringRole",
  "excludedQuestionKinds",
  "excludedItemCount",
  "eligibleItemCount",
  "mappingCoveragePercent",
  "thresholdPercent",
  "thresholdCount",
  "academicYearPolicy",
  "historicalEvidencePolicy",
  "resourceLifecyclePolicy",
  "sourceFactPolicy",
  "ledgerAuthority",
  "clientPolicy",
  "deliveryEvidenceIdentity",
  "scoringCreditIdentity",
  "acceptedTerminalDisposition",
  "legacyAcceptedEvidencePolicy",
]);

export class LearningSubmissionRateLimitError extends Error {
  constructor(
    retryAfterSeconds = SUBMISSION_RATE_LIMIT.windowSeconds,
    limitReason = SUBMISSION_RATE_LIMIT_REASONS.windowCapacity,
  ) {
    const reason = Object.values(SUBMISSION_RATE_LIMIT_REASONS).includes(limitReason)
      ? limitReason
      : SUBMISSION_RATE_LIMIT_REASONS.windowCapacity;
    super("提交过于频繁，请稍后继续修改");
    this.name = "LearningSubmissionRateLimitError";
    this.code = "learning_submission_rate_limited";
    this.retryAfterSeconds = Math.max(1, Number(retryAfterSeconds) || SUBMISSION_RATE_LIMIT.windowSeconds);
    this.limitReason = reason;
  }
}

export class LearningSubmissionInProgressError extends Error {
  constructor(retryAfterSeconds = SUBMISSION_RESERVATION_LEASE_SECONDS) {
    const wait = Math.max(1, Number(retryAfterSeconds) || SUBMISSION_RESERVATION_LEASE_SECONDS);
    super(`上一次提交仍在评阅中，请在 ${wait} 秒后使用同一答案重试`);
    this.name = "LearningSubmissionInProgressError";
    this.code = "learning_submission_in_progress";
    this.retryAfterSeconds = wait;
  }
}

export class LearningEvaluatorCooldownError extends Error {
  constructor(retryAfterSeconds = EVALUATOR_FAILURE_COOLDOWN_SECONDS) {
    const wait = Math.max(1, Math.min(
      EVALUATOR_FAILURE_COOLDOWN_SECONDS,
      Number(retryAfterSeconds) || EVALUATOR_FAILURE_COOLDOWN_SECONDS,
    ));
    super(`評閱服務暫時繁忙，請在 ${wait} 秒後使用同一答案重試`);
    this.name = "LearningEvaluatorCooldownError";
    this.code = "learning_evaluator_unavailable";
    this.retryAfterSeconds = wait;
  }
}

export class LearningEvaluatorBudgetExceededError extends Error {
  constructor(retryAfterSeconds = learningEvaluatorCallBudget.windowSeconds, limitReason = "student_window_capacity") {
    const wait = Math.max(1, Number(retryAfterSeconds) || learningEvaluatorCallBudget.windowSeconds);
    super(`本輪評閱次數已達安全上限，請在 ${wait} 秒後使用同一答案重試`);
    this.name = "LearningEvaluatorBudgetExceededError";
    this.code = "learning_evaluator_budget_exhausted";
    this.retryAfterSeconds = wait;
    this.limitReason = limitReason === "mutation_capacity" ? limitReason : "student_window_capacity";
  }
}

export class LearningEvaluatorBudgetUnavailableError extends Error {
  constructor(retryAfterSeconds = EVALUATOR_FAILURE_COOLDOWN_SECONDS) {
    const wait = Math.max(1, Number(retryAfterSeconds) || EVALUATOR_FAILURE_COOLDOWN_SECONDS);
    super("評閱安全額度暫時無法核對；答案已保留，但尚未完成評閱，請稍後使用同一內容重試");
    this.name = "LearningEvaluatorBudgetUnavailableError";
    this.code = "learning_evaluator_budget_unavailable";
    this.retryAfterSeconds = wait;
  }
}

export class LearningResourceNotPublishedError extends Error {
  constructor(interactionKey = "") {
    super("本課互動未納入目前的正式學習資源清單");
    this.name = "LearningResourceNotPublishedError";
    this.code = "learning_resource_not_published";
    this.interactionKey = clean(interactionKey, 40);
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

async function loadAssetJson(request, env, pathname) {
  const url = new URL(pathname, request.url);
  const response = await env.ASSETS.fetch(new Request(url.toString(), { method: "GET" }));
  if (!response.ok) throw new Error(`authoritative asset unavailable: ${pathname}`);
  return response.json();
}

function hasExactKeys(value, expectedKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

export function validateAPlusCompatibilityContract(registry, manifest = null) {
  const compatibility = registry?.compatibilityContracts?.aPlusGate;
  const excludedQuestionKinds = compatibility?.excludedQuestionKinds;
  if (
    !hasExactKeys(compatibility, A_PLUS_COMPATIBILITY_KEYS)
    || compatibility.schemaVersion !== "yw-aplus-producer-compatibility-v2"
    || compatibility.contractVersion !== "yw-aplus-e310-v2"
    || !/^yw-[a-f0-9]{16}$/.test(String(compatibility.sourceVersion || ""))
    || !/^yw-release-[a-f0-9]{16}$/.test(String(compatibility.sourceReleaseId || ""))
    || compatibility.mappingVersion !== "yw-canonical-learning-mapping-v1"
    || compatibility.registryVersion !== registry?.registryVersion
    || compatibility.registryVersion !== "yw-interactions-2026-08-09-v2"
    || !/^sha256:[a-f0-9]{64}$/.test(String(compatibility.resourceKeyHash || ""))
    || !Number.isInteger(Number(compatibility.itemCount))
    || Number(compatibility.itemCount) < 1
    || compatibility.eligibleAssessmentKind !== "performance"
    || compatibility.eligibleScoringRole !== "a_plus_gate"
    || !Array.isArray(excludedQuestionKinds)
    || excludedQuestionKinds.length !== 1
    || excludedQuestionKinds[0] !== "evaluation"
    || Number(compatibility.excludedItemCount) !== 101
    || !Number.isInteger(Number(compatibility.eligibleItemCount))
    || Number(compatibility.eligibleItemCount) < 1
    || Number(compatibility.eligibleItemCount) > Number(compatibility.itemCount)
    || Number(compatibility.mappingCoveragePercent) !== 100
    || Number(compatibility.thresholdPercent) !== 90
    || Number(compatibility.thresholdCount)
      !== Math.ceil(Number(compatibility.eligibleItemCount) * Number(compatibility.thresholdPercent) / 100)
    || !hasExactKeys(compatibility.academicYearPolicy, [
      "status",
      "policyVersion",
      "academicYear",
      "scoringMode",
      "priorContractEvidence",
      "creditUnitKey",
      "admissibleReleaseRule",
      "requiredDistinctCreditUnits",
      "scoringPolicyChangeRule",
    ])
    || compatibility.academicYearPolicy.status !== "active"
    || compatibility.academicYearPolicy.policyVersion !== "yw-aplus-2026-2027-v1"
    || compatibility.academicYearPolicy.academicYear !== "2026-2027"
    || compatibility.academicYearPolicy.scoringMode !== "fixed_distinct_credit_unit_a_plus_gate"
    || compatibility.academicYearPolicy.priorContractEvidence !== "historical_read_only"
    || compatibility.academicYearPolicy.creditUnitKey !== "canonicalUnitId"
    || compatibility.academicYearPolicy.admissibleReleaseRule
      !== "fully_mapped_effective_release_without_changing_fixed_threshold"
    || Number(compatibility.academicYearPolicy.requiredDistinctCreditUnits)
      !== Number(compatibility.thresholdCount)
    || compatibility.academicYearPolicy.scoringPolicyChangeRule !== "explicit_new_policy_version_only"
    || compatibility.historicalEvidencePolicy !== "read_only_not_counted_in_current_a_plus"
    || compatibility.resourceLifecyclePolicy !== "append_only_versions_retired_evidence_preserved_under_evidence_time_policy"
    || !hasExactKeys(compatibility.sourceFactPolicy, ["allowedResultClaims", "forbiddenGradingClaims"])
    || JSON.stringify(compatibility.sourceFactPolicy.allowedResultClaims)
      !== JSON.stringify(["rawValue", "maxValue", "normalizedValue", "verificationMethod"])
    || JSON.stringify(compatibility.sourceFactPolicy.forbiddenGradingClaims)
      !== JSON.stringify(["weight", "grade", "points", "bands", "sourceCap"])
    || compatibility.ledgerAuthority !== "shared_user_center_learning_evidence"
    || compatibility.clientPolicy !== "web_and_android_share_one_ledger_no_client_specific_denominator"
    || compatibility.deliveryEvidenceIdentity !== "sourceSiteKey+contractVersion+sourceReleaseId+canonicalUnitId+resourceVersion+sourceAttemptId"
    || compatibility.scoringCreditIdentity !== "userId+academicYear+policyVersion+canonicalUnitId"
    || compatibility.acceptedTerminalDisposition !== "mapped_accepted_eligibility_is_terminal_unless_superseded"
    || compatibility.legacyAcceptedEvidencePolicy !== "preserve_null_finalized_at_read_only_never_treat_as_platform_error"
  ) throw new Error("A+ producer compatibility contract invalid");

  if (manifest) {
    const items = Array.isArray(manifest.items) ? manifest.items : [];
    const excludedKinds = new Set(excludedQuestionKinds);
    const eligibleItems = items.filter((item) => !excludedKinds.has(String(item?.questionKind || "")));
    const excludedItems = items.length - eligibleItems.length;
    if (
      manifest.manifestVersion !== compatibility.sourceVersion
      || manifest.sourceReleaseId !== compatibility.sourceReleaseId
      || manifest.mappingVersion !== compatibility.mappingVersion
      || manifest.resourceKeyHash !== compatibility.resourceKeyHash
      || Number(manifest.itemCount) !== Number(compatibility.itemCount)
      || Number(manifest.thresholdPercent) !== Number(compatibility.thresholdPercent)
      || excludedItems !== Number(compatibility.excludedItemCount)
      || eligibleItems.length !== Number(compatibility.eligibleItemCount)
      || items.some((item) => (
        item.sourceReleaseId !== compatibility.sourceReleaseId
        || item.mappingVersion !== compatibility.mappingVersion
        || !/^yw:lesson-[a-z0-9-]+:(?:interaction:[A-Za-z]+|vocabulary:[A-Za-z0-9:-]+)$/.test(String(item.canonicalUnitId || ""))
        || !/^sha256:[a-f0-9]{64}$/.test(String(item.resourceVersion || ""))
        || !["retention", "reading", "inquiry", "reflection"].includes(item.dimensionKey)
        || !["vocabulary", "syntax", "comprehension", "reflection"].includes(item.competencyKey)
        || !["a_plus_gate", "non_scoring"].includes(item.evidenceRole)
        || item.lifecycleStatus !== "active"
        || !Number.isFinite(Date.parse(item.effectiveFrom))
        || item.effectiveTo !== null
      ))
    ) throw new Error("current A+ manifest disagrees with its compatibility contract");
  }
  return compatibility;
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
  validateAPlusCompatibilityContract(registry);
  registryCache.value = registry;
  registryCache.expiresAt = Date.now() + 5 * 60 * 1000;
  return registry;
}

function evidenceVersions(registry, manifest, definition, formativeManifest) {
  const sourceContract = validateAPlusCompatibilityContract(registry, manifest);
  if (definition.scoringRole === "a_plus_gate") {
    return {
      contractVersion: sourceContract.contractVersion,
      academicYear: sourceContract.academicYearPolicy.academicYear,
      sourceVersion: sourceContract.sourceVersion,
      sourceReleaseId: sourceContract.sourceReleaseId,
      mappingVersion: sourceContract.mappingVersion,
      registryVersion: sourceContract.registryVersion,
      producerManifestVersion: manifest.manifestVersion,
    };
  }
  if (formativeManifest?.manifestVersion) {
    return {
      contractVersion: sourceContract.contractVersion,
      academicYear: sourceContract.academicYearPolicy.academicYear,
      sourceVersion: formativeManifest.manifestVersion,
      sourceReleaseId: `yw-formative-release-${formativeManifest.manifestVersion.replace("yw-formative-", "")}`,
      mappingVersion: "yw-formative-learning-mapping-v1",
      registryVersion: registry.registryVersion,
      producerManifestVersion: manifest.manifestVersion,
    };
  }
  return {
    contractVersion: sourceContract.contractVersion,
    academicYear: sourceContract.academicYearPolicy.academicYear,
    sourceVersion: manifest.manifestVersion,
    sourceReleaseId: sourceContract.sourceReleaseId,
    mappingVersion: sourceContract.mappingVersion,
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

export function invalidateFormativeManifestCache() {
  formativeManifestCache.value = null;
  formativeManifestCache.expiresAt = 0;
}

async function assertClassicalFirstReadGate({ request, env, student, lesson, interactionKey, formativeManifest, formativeItem }) {
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
  const needsAnnotatedReading = interactionKey === "vocabAnswer"
    || (interactionKey === "studyGuideItemCompleted"
      && ["vocabulary", "syntax"].includes(formativeItem?.competencyTag));
  if (!needsAnnotatedReading) return;
  const annotatedReadCompleted = await hasClassicalAnnotatedReadReceipt(
    env.READING_DB,
    student.id,
    lesson.id,
    asset.textVersionId,
  );
  if (!annotatedReadCompleted) {
    const error = new Error("請先讀完帶註釋正文再進入詞級疏通");
    error.code = "classical_annotated_reading_required";
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
    throw new LearningResourceNotPublishedError(interactionKey);
  }
  await assertClassicalFirstReadGate({
    request,
    env,
    student,
    lesson,
    interactionKey,
    formativeManifest,
    formativeItem,
  });
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

async function existingPendingSubmission(db, studentId, clientMutationId) {
  if (!clientMutationId) return null;
  return db.prepare(
    `SELECT source_event_id, student_id, client_mutation_id, lesson_id, interaction_key,
            resource_key, raw_payload_json, status, attempt_count, captured_at, updated_at
       FROM learning_pending_submissions
      WHERE student_id = ? AND client_mutation_id = ?`
  ).bind(studentId, clientMutationId).first();
}

function assertPendingSubmissionMatches(existing, expected) {
  if (clean(existing?.source_event_id, 100) !== expected.sourceEventId
    || Number(existing?.student_id) !== Number(expected.studentId)
    || clean(existing?.lesson_id, 80) !== expected.lessonId
    || clean(existing?.interaction_key, 60) !== expected.interactionKey
    || clean(existing?.resource_key, 220) !== expected.resourceKey
    || String(existing?.raw_payload_json || "") !== expected.rawPayloadJson) {
    const error = new Error("client mutation id already belongs to another learning item");
    error.code = "learning_mutation_conflict";
    throw error;
  }
}

async function capturePendingSubmission(db, expected, occurredAt) {
  const existing = await existingPendingSubmission(
    db,
    expected.studentId,
    expected.clientMutationId,
  );
  if (existing) {
    assertPendingSubmissionMatches(existing, expected);
    if (existing.status !== "completed") {
      await db.prepare(
        `UPDATE learning_pending_submissions
            SET status = 'captured', updated_at = ?
          WHERE source_event_id = ? AND status != 'completed'`
      ).bind(occurredAt, expected.sourceEventId).run();
    }
    return;
  }
  try {
    await db.prepare(
      `INSERT INTO learning_pending_submissions (
         source_event_id, student_id, client_mutation_id, lesson_id, interaction_key,
         resource_key, raw_payload_json, status, captured_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'captured', ?, ?)`
    ).bind(
      expected.sourceEventId,
      expected.studentId,
      expected.clientMutationId,
      expected.lessonId,
      expected.interactionKey,
      expected.resourceKey,
      expected.rawPayloadJson,
      occurredAt,
      occurredAt,
    ).run();
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    const winner = await existingPendingSubmission(db, expected.studentId, expected.clientMutationId);
    assertPendingSubmissionMatches(winner, expected);
  }
}

export async function listPendingLearningSubmissions({ env, student, lessonId = "" }) {
  if (!env?.READING_DB || !Number.isInteger(Number(student?.id)) || Number(student.id) <= 0) {
    throw new Error("learning pending source unavailable");
  }
  const normalizedLessonId = clean(lessonId, 80);
  const query = normalizedLessonId
    ? `SELECT client_mutation_id, lesson_id, interaction_key, status, updated_at
         FROM learning_pending_submissions
        WHERE student_id = ? AND lesson_id = ? AND status IN ('captured', 'retryable')
        ORDER BY updated_at LIMIT 8`
    : `SELECT client_mutation_id, lesson_id, interaction_key, status, updated_at
         FROM learning_pending_submissions
        WHERE student_id = ? AND status IN ('captured', 'retryable')
        ORDER BY updated_at LIMIT 8`;
  const statement = env.READING_DB.prepare(query);
  const result = normalizedLessonId
    ? await statement.bind(Number(student.id), normalizedLessonId).all()
    : await statement.bind(Number(student.id)).all();
  return (result?.results || []).map((row) => ({
    clientMutationId: clean(row.client_mutation_id, 100),
    lessonId: clean(row.lesson_id, 80),
    interaction: clean(row.interaction_key, 60),
    status: clean(row.status, 20),
    updatedAt: clean(row.updated_at, 40),
  }));
}

export async function loadPendingLearningSubmission({ env, student, clientMutationId }) {
  if (!env?.READING_DB || !Number.isInteger(Number(student?.id)) || Number(student.id) <= 0) {
    throw new Error("learning pending source unavailable");
  }
  const mutationId = clean(clientMutationId, 100);
  if (!mutationId) throw new Error("client mutation id required");
  const row = await existingPendingSubmission(env.READING_DB, Number(student.id), mutationId);
  if (!row || row.status === "completed") return null;
  let input;
  try {
    input = JSON.parse(row.raw_payload_json);
  } catch {
    throw new Error("captured learning payload invalid");
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("captured learning payload invalid");
  }
  return {
    lessonId: clean(row.lesson_id, 80),
    interaction: clean(row.interaction_key, 60),
    input,
    clientMutationId: mutationId,
  };
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
      `SELECT COUNT(*) AS n, COALESCE(MAX(resource_slot_no), 0) AS max_slot
         FROM learning_submission_slots
        WHERE student_id = ? AND resource_key = ? AND window_start = ?
          AND created_at NOT LIKE '%.002Z'`
    ).bind(studentId, resourceKey, windowStart).first(),
    db.prepare(
      `SELECT COUNT(*) AS n, COALESCE(MAX(global_slot_no), 0) AS max_slot
         FROM learning_submission_slots
        WHERE student_id = ? AND window_start = ?
          AND created_at NOT LIKE '%.002Z'`
    ).bind(studentId, windowStart).first(),
  ]);
  const resourceUsed = Math.max(Number(recent?.n || 0), Number(resourceSlots?.n || 0));
  const globalUsed = Math.max(Number(globalRecent?.n || 0), Number(globalSlots?.n || 0));
  if (resourceUsed >= resourceLimit || globalUsed >= globalLimit) {
    throw new LearningSubmissionRateLimitError(
      Math.max(1, Math.ceil((windowStartMs + windowMs - windowEndMs) / 1000)),
      SUBMISSION_RATE_LIMIT_REASONS.windowCapacity,
    );
  }
  return {
    windowStart,
    resourceSlotNo: Number(resourceSlots?.max_slot || 0) + 1,
    globalSlotNo: Number(globalSlots?.max_slot || 0) + 1,
  };
}

async function deterministicReservationId(studentId, clientMutationId, windowStart) {
  const hex = await sha256Text(`yw-submission-reservation-v1\n${studentId}\n${clientMutationId}\n${windowStart}`);
  const variantNibble = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variantNibble}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function reservationTimestampMs(value) {
  const raw = clean(value, 40);
  if (!raw) return NaN;
  const explicitZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);
  return Date.parse(explicitZone ? raw : `${raw.replace(" ", "T")}Z`);
}

// `created_at` is the reservation state marker. New leases use .000Z; every
// expired non-cooldown lease reclaim rewrites the current time at .001Z, so
// .001Z is not a once-only retry counter. Evaluator-owned failures use .002Z,
// are excluded from learner capacity for a 15-second cooldown, and move both
// slot numbers into negative rowid space before a later fresh reservation.
function reservationLeaseTimestamp(value, reclaimed = false) {
  const milliseconds = typeof value === "number" ? value : reservationTimestampMs(value);
  const date = new Date(Number.isFinite(milliseconds) ? milliseconds : Date.now());
  date.setUTCMilliseconds(reclaimed ? 1 : 0);
  return date.toISOString();
}

function submissionSlotWasReclaimed(createdAt) {
  return /\.001Z$/i.test(clean(createdAt, 40));
}

function submissionSlotIsEvaluatorCooldown(createdAt) {
  return /\.002Z$/i.test(clean(createdAt, 40));
}

function evaluatorCooldownTimestamp(value = Date.now()) {
  const date = new Date(Number.isFinite(Number(value)) ? Number(value) : Date.now());
  date.setUTCMilliseconds(2);
  return date.toISOString();
}

async function readSubmissionSlot(db, sourceEventId) {
  return db.prepare(
    `SELECT slot.source_event_id, slot.student_id, slot.resource_key, slot.window_start,
            slot.resource_slot_no, slot.global_slot_no, slot.created_at,
            EXISTS (
              SELECT 1 FROM learning_interactions interaction
               WHERE interaction.source_event_id = slot.source_event_id
            ) AS interaction_committed
       FROM learning_submission_slots slot
      WHERE slot.source_event_id = ?`
  ).bind(sourceEventId).first();
}

function assertSubmissionSlotMatches(slot, sourceEventId, studentId, resourceKey, windowStart) {
  if (slot?.source_event_id !== sourceEventId
    || Number(slot.student_id) !== Number(studentId)
    || clean(slot.resource_key, 220) !== resourceKey
    || String(slot.window_start || "") !== windowStart) {
    const conflict = new Error("client mutation id already belongs to another learning item");
    conflict.code = "learning_mutation_conflict";
    throw conflict;
  }
}

async function reuseOrWaitForSubmissionSlot(
  db,
  slot,
  sourceEventId,
  clientMutationId,
  studentId,
  resourceKey,
  windowStart,
  definition,
  occurredAt,
  retry = 0,
) {
  assertSubmissionSlotMatches(slot, sourceEventId, studentId, resourceKey, windowStart);
  const reservation = {
    sourceEventId,
    windowStart,
    resourceSlotNo: Number(slot.resource_slot_no),
    globalSlotNo: Number(slot.global_slot_no),
    leaseStartedAt: String(slot.created_at || ""),
    reclaimed: submissionSlotWasReclaimed(slot.created_at),
  };
  if (Number(slot.interaction_committed) === 1) return { ...reservation, committed: true };

  const nowMs = reservationTimestampMs(occurredAt);
  const createdAtMs = reservationTimestampMs(slot.created_at);
  if (submissionSlotIsEvaluatorCooldown(slot.created_at)) {
    const cooldownMs = EVALUATOR_FAILURE_COOLDOWN_SECONDS * 1000;
    const remainingMs = Number.isFinite(nowMs) && Number.isFinite(createdAtMs)
      ? cooldownMs - Math.max(0, nowMs - createdAtMs)
      : cooldownMs;
    if (remainingMs > 0) {
      throw new LearningEvaluatorCooldownError(Math.ceil(remainingMs / 1000));
    }
    const removed = await db.prepare(
      `DELETE FROM learning_submission_slots
        WHERE source_event_id = ?
          AND created_at = ?
          AND created_at LIKE '%.002Z'
          AND NOT EXISTS (
            SELECT 1 FROM learning_interactions interaction
             WHERE interaction.source_event_id = learning_submission_slots.source_event_id
          )`
    ).bind(sourceEventId, slot.created_at).run();
    if (Number(removed?.meta?.changes || 0) === 1) {
      return reserveSubmissionSlot(
        db,
        studentId,
        clientMutationId,
        resourceKey,
        definition,
        occurredAt,
        Number(retry) + 1,
      );
    }
    const current = await readSubmissionSlot(db, sourceEventId);
    if (current && Number(retry) < 3) {
      return reuseOrWaitForSubmissionSlot(
        db,
        current,
        sourceEventId,
        clientMutationId,
        studentId,
        resourceKey,
        windowStart,
        definition,
        occurredAt,
        Number(retry) + 1,
      );
    }
    throw new LearningSubmissionInProgressError(1);
  }
  const leaseMs = SUBMISSION_RESERVATION_LEASE_SECONDS * 1000;
  if (!Number.isFinite(nowMs) || !Number.isFinite(createdAtMs) || nowMs - createdAtMs < leaseMs) {
    const remainingMs = Number.isFinite(nowMs) && Number.isFinite(createdAtMs)
      ? leaseMs - Math.max(0, nowMs - createdAtMs)
      : leaseMs;
    throw new LearningSubmissionInProgressError(Math.max(1, Math.ceil(remainingMs / 1000)));
  }

  const leaseStartedAt = reservationLeaseTimestamp(nowMs, true);
  const claimed = await db.prepare(
    `UPDATE learning_submission_slots
        SET created_at = ?
      WHERE source_event_id = ?
        AND created_at = ?
        AND created_at NOT LIKE '%.002Z'
        AND datetime(created_at) <= datetime(?, '-${SUBMISSION_RESERVATION_LEASE_SECONDS} seconds')
        AND NOT EXISTS (
          SELECT 1 FROM learning_interactions interaction
           WHERE interaction.source_event_id = learning_submission_slots.source_event_id
        )`
  ).bind(leaseStartedAt, sourceEventId, slot.created_at, leaseStartedAt).run();
  if (Number(claimed?.meta?.changes || 0) === 1) {
    return { ...reservation, leaseStartedAt, reclaimed: true };
  }

  const current = await readSubmissionSlot(db, sourceEventId);
  if (current) {
    assertSubmissionSlotMatches(current, sourceEventId, studentId, resourceKey, windowStart);
    if (Number(current.interaction_committed) === 1) return { ...reservation, committed: true };
    const currentCreatedAtMs = reservationTimestampMs(current.created_at);
    const remainingMs = Number.isFinite(currentCreatedAtMs)
      ? leaseMs - Math.max(0, nowMs - currentCreatedAtMs)
      : leaseMs;
    throw new LearningSubmissionInProgressError(Math.max(1, Math.ceil(remainingMs / 1000)));
  }
  throw new LearningSubmissionInProgressError();
}

async function reserveSubmissionSlot(
  db,
  studentId,
  clientMutationId,
  resourceKey,
  definition,
  occurredAt,
  retry = 0,
) {
  const occurredAtMs = reservationTimestampMs(occurredAt);
  const windowMs = SUBMISSION_RATE_LIMIT.windowSeconds * 1000;
  const windowStartMs = Math.floor((Number.isFinite(occurredAtMs) ? occurredAtMs : Date.now()) / windowMs) * windowMs;
  const windowStart = new Date(windowStartMs).toISOString();
  const sourceEventId = await deterministicReservationId(studentId, clientMutationId, windowStart);
  const existingSlot = await readSubmissionSlot(db, sourceEventId);
  if (existingSlot) {
    return reuseOrWaitForSubmissionSlot(
      db,
      existingSlot,
      sourceEventId,
      clientMutationId,
      studentId,
      resourceKey,
      windowStart,
      definition,
      occurredAt,
      retry,
    );
  }

  const rateReservation = await enforceSubmissionRateLimit(
    db,
    studentId,
    resourceKey,
    definition,
    occurredAt,
  );
  const leaseStartedAt = reservationLeaseTimestamp(Number.isFinite(occurredAtMs) ? occurredAtMs : Date.now());
  try {
    await db.prepare(
      `INSERT INTO learning_submission_slots (
         source_event_id, student_id, resource_key, window_start, resource_slot_no, global_slot_no, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      sourceEventId,
      studentId,
      resourceKey,
      rateReservation.windowStart,
      rateReservation.resourceSlotNo,
      rateReservation.globalSlotNo,
      leaseStartedAt,
    ).run();
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const sameMutation = await readSubmissionSlot(db, sourceEventId);
      if (sameMutation?.source_event_id === sourceEventId) {
        return reuseOrWaitForSubmissionSlot(
          db,
          sameMutation,
          sourceEventId,
          clientMutationId,
          studentId,
          resourceKey,
          rateReservation.windowStart,
          definition,
          occurredAt,
          retry,
        );
      }
      if (Number(retry) < 3) {
        return reserveSubmissionSlot(
          db,
          studentId,
          clientMutationId,
          resourceKey,
          definition,
          occurredAt,
          Number(retry) + 1,
        );
      }
    }
    throw error;
  }
  return { sourceEventId, ...rateReservation, leaseStartedAt, reclaimed: false };
}

function assertTrustedSubmissionReservation(
  reservation,
  { student, lesson, interactionKey, clientMutationId, rawPayloadJson },
) {
  if (!reservation || !trustedSubmissionReservations.has(reservation)
    || reservation.studentId !== Number(student.id)
    || reservation.lessonId !== lesson.id
    || reservation.interactionKey !== interactionKey
    || reservation.clientMutationId !== clientMutationId
    || reservation.rawPayloadJson !== rawPayloadJson) {
    throw new Error("learning submission reservation invalid");
  }
  return reservation;
}

export async function acquireLearningSubmissionReservation({
  db,
  studentId,
  clientMutationId,
  resourceKey,
  scoringRole = "formative",
  occurredAt = isoNow(),
}) {
  if (!db || !Number.isInteger(Number(studentId)) || Number(studentId) <= 0
    || !clean(clientMutationId, 100) || !clean(resourceKey, 220)) {
    throw new Error("submission reservation input invalid");
  }
  return reserveSubmissionSlot(
    db,
    Number(studentId),
    clean(clientMutationId, 100),
    clean(resourceKey, 220),
    { scoringRole: clean(scoringRole, 40) },
    occurredAt,
  );
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
  expectedStudyGuideCatalogDigest = "",
}) {
  if (!env.READING_DB || !student?.id || !lesson?.id) throw new Error("learning evidence source unavailable");
  const context = await resolveInteractionContext(request, env, student, lesson, interactionKey, payload);
  if (expectedStudyGuideCatalogDigest
    && context.formativeManifest.studyGuideCatalogDigest !== expectedStudyGuideCatalogDigest) {
    const error = new Error("study-guide and formative catalogs are not the same release");
    error.code = "study_guide_catalog_drift";
    throw error;
  }
  const raw = boundedRawPayload(context.definition, context.normalizedPayload);
  const clientMutationId = clean(payload.clientMutationId, 100);
  if (!clientMutationId) throw new Error("client mutation id required before evaluation");
  const existing = await existingInteraction(env.READING_DB, student.id, clientMutationId);
  if (existing) {
    assertIdempotentReplayMatches(existing, context.resourceKey, interactionKey, raw.serialized);
    return {
      allowed: true,
      deduped: true,
      resourceKey: context.resourceKey,
      sourceEventId: existing.source_event_id,
      attemptNo: Number(existing.attempt_no),
      eligibilityStatus: clean(existing.eligibility_status, 32),
      evaluation: storedEvaluation(existing),
    };
  }
  const slot = await reserveSubmissionSlot(
    env.READING_DB,
    student.id,
    clientMutationId,
    context.resourceKey,
    context.definition,
    occurredAt,
  );
  if (slot.committed) {
    const committed = await existingInteraction(env.READING_DB, student.id, clientMutationId);
    if (!committed) throw new LearningSubmissionInProgressError(1);
    assertIdempotentReplayMatches(committed, context.resourceKey, interactionKey, raw.serialized);
    return {
      allowed: true,
      deduped: true,
      resourceKey: context.resourceKey,
      sourceEventId: committed.source_event_id,
      attemptNo: Number(committed.attempt_no),
      eligibilityStatus: clean(committed.eligibility_status, 32),
      evaluation: storedEvaluation(committed),
    };
  }
  await capturePendingSubmission(env.READING_DB, {
    sourceEventId: slot.sourceEventId,
    studentId: Number(student.id),
    clientMutationId,
    lessonId: lesson.id,
    interactionKey,
    resourceKey: context.resourceKey,
    rawPayloadJson: raw.serialized,
  }, occurredAt);
  const submissionReservation = {
    sourceEventId: slot.sourceEventId,
    occurredAt,
    leaseStartedAt: slot.leaseStartedAt,
    reclaimed: slot.reclaimed === true,
    studentId: Number(student.id),
    lessonId: lesson.id,
    interactionKey,
    clientMutationId,
    resourceKey: context.resourceKey,
    rawPayloadJson: raw.serialized,
    rateReservation: {
      windowStart: slot.windowStart,
      resourceSlotNo: slot.resourceSlotNo,
      globalSlotNo: slot.globalSlotNo,
    },
    context,
  };
  trustedSubmissionReservations.add(submissionReservation);
  return {
    allowed: true,
    deduped: false,
    resourceKey: context.resourceKey,
    submissionReservation,
  };
}

function evaluatorBudgetRetryAfterSeconds(windowStart, occurredAt = isoNow()) {
  const windowStartMs = reservationTimestampMs(windowStart);
  const occurredAtMs = reservationTimestampMs(occurredAt);
  if (!Number.isFinite(windowStartMs) || !Number.isFinite(occurredAtMs)) {
    return learningEvaluatorCallBudget.windowSeconds;
  }
  return Math.max(1, Math.ceil(
    (windowStartMs + learningEvaluatorCallBudget.windowSeconds * 1000 - occurredAtMs) / 1000,
  ));
}

export async function reserveLearningEvaluatorCall({
  env,
  submissionReservation,
  occurredAt = isoNow(),
}) {
  if (!env?.READING_DB
    || !submissionReservation
    || !trustedSubmissionReservations.has(submissionReservation)
    || !Number.isInteger(Number(submissionReservation.studentId))
    || Number(submissionReservation.studentId) <= 0
    || !clean(submissionReservation.sourceEventId, 100)
    || !clean(submissionReservation.resourceKey, 220)
    || !clean(submissionReservation.rateReservation?.windowStart, 40)) {
    throw new LearningEvaluatorBudgetUnavailableError();
  }
  const db = env.READING_DB;
  const studentId = Number(submissionReservation.studentId);
  const sourceEventId = clean(submissionReservation.sourceEventId, 100);
  const resourceKey = clean(submissionReservation.resourceKey, 220);
  const windowStart = clean(submissionReservation.rateReservation.windowStart, 40);
  const createdAt = clean(occurredAt, 40) || isoNow();
  try {
    const inserted = await db.prepare(
      `INSERT INTO learning_evaluator_calls (
         student_id, source_event_id, resource_key, window_start, created_at
       )
       SELECT ?, ?, ?, ?, ?
        WHERE (
          SELECT COUNT(*) FROM learning_evaluator_calls
           WHERE student_id = ? AND window_start = ?
        ) < ${learningEvaluatorCallBudget.studentWindowLimit}
          AND (
          SELECT COUNT(*) FROM learning_evaluator_calls
           WHERE student_id = ? AND source_event_id = ? AND window_start = ?
        ) < ${learningEvaluatorCallBudget.mutationWindowLimit}`
    ).bind(
      studentId,
      sourceEventId,
      resourceKey,
      windowStart,
      createdAt,
      studentId,
      windowStart,
      studentId,
      sourceEventId,
      windowStart,
    ).run();
    if (Number(inserted?.meta?.changes || 0) === 1) {
      return { counted: true, studentId, sourceEventId, windowStart, createdAt };
    }
    const [studentWindow, mutationWindow] = await Promise.all([
      db.prepare(
        "SELECT COUNT(*) AS n FROM learning_evaluator_calls WHERE student_id = ? AND window_start = ?"
      ).bind(studentId, windowStart).first(),
      db.prepare(
        "SELECT COUNT(*) AS n FROM learning_evaluator_calls WHERE student_id = ? AND source_event_id = ? AND window_start = ?"
      ).bind(studentId, sourceEventId, windowStart).first(),
    ]);
    const mutationUsed = Number(mutationWindow?.n || 0);
    const studentUsed = Number(studentWindow?.n || 0);
    if (mutationUsed >= learningEvaluatorCallBudget.mutationWindowLimit
      || studentUsed >= learningEvaluatorCallBudget.studentWindowLimit) {
      throw new LearningEvaluatorBudgetExceededError(
        evaluatorBudgetRetryAfterSeconds(windowStart, occurredAt),
        mutationUsed >= learningEvaluatorCallBudget.mutationWindowLimit
          ? "mutation_capacity"
          : "student_window_capacity",
      );
    }
    throw new LearningEvaluatorBudgetUnavailableError();
  } catch (error) {
    if (error instanceof LearningEvaluatorBudgetExceededError
      || error instanceof LearningEvaluatorBudgetUnavailableError) throw error;
    throw new LearningEvaluatorBudgetUnavailableError();
  }
}

export async function releaseLearningSubmissionReservation({ env, submissionReservation }) {
  if (!env?.READING_DB
    || !submissionReservation
    || !trustedSubmissionReservations.has(submissionReservation)) {
    throw new Error("learning submission reservation release invalid");
  }
  const leaseStartedAt = clean(submissionReservation.leaseStartedAt, 40);
  const leaseStartedAtMs = reservationTimestampMs(leaseStartedAt);
  if (!Number.isFinite(leaseStartedAtMs)
    || submissionReservation.sourceEventId !== clean(submissionReservation.sourceEventId, 100)) {
    throw new Error("learning submission reservation lease invalid");
  }
  const cooldownStartedAt = evaluatorCooldownTimestamp();
  const released = await env.READING_DB.prepare(
    `UPDATE learning_submission_slots
        SET created_at = ?,
            resource_slot_no = -ABS(rowid),
            global_slot_no = -ABS(rowid)
      WHERE source_event_id = ?
        AND created_at = ?
        AND NOT EXISTS (
          SELECT 1 FROM learning_interactions interaction
           WHERE interaction.source_event_id = learning_submission_slots.source_event_id
        )`
  ).bind(cooldownStartedAt, submissionReservation.sourceEventId, leaseStartedAt).run();
  const changed = Number(released?.meta?.changes || 0) === 1;
  if (changed) {
    await env.READING_DB.prepare(
      `UPDATE learning_pending_submissions
          SET status = 'retryable', attempt_count = attempt_count + 1, updated_at = ?
        WHERE source_event_id = ? AND status != 'completed'`
    ).bind(isoNow(), submissionReservation.sourceEventId).run();
  }
  trustedSubmissionReservations.delete(submissionReservation);
  return {
    released: changed,
    retryAfterSeconds: EVALUATOR_FAILURE_COOLDOWN_SECONDS,
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
  submissionReservation = null,
  contentionRetry = 0,
}) {
  if (!env.READING_DB || !student?.id || !lesson?.id) throw new Error("learning evidence source unavailable");
  if (submissionReservation && sourceMutation) {
    throw new Error("reserved submission cannot carry a separate source mutation");
  }
  const effectiveOccurredAt = submissionReservation?.occurredAt || occurredAt;
  const reservedContext = submissionReservation?.context || null;
  const {
    registry,
    definition,
    normalizedPayload,
    manifest,
    resourceKey,
    manifestItem,
    formativeManifest,
    formativeItem,
  } = reservedContext || await resolveInteractionContext(request, env, student, lesson, interactionKey, payload);
  const raw = boundedRawPayload(definition, normalizedPayload);

  const clientMutationId = clean(payload.clientMutationId, 100);
  const trustedReservation = submissionReservation
    ? assertTrustedSubmissionReservation(submissionReservation, {
      student,
      lesson,
      interactionKey,
      clientMutationId,
      rawPayloadJson: raw.serialized,
    })
    : null;
  const existing = await existingInteraction(env.READING_DB, student.id, clientMutationId);
  if (existing) {
    assertIdempotentReplayMatches(existing, resourceKey, interactionKey, raw.serialized);
    return dedupedInteractionResult(existing);
  }

  const rateReservation = trustedReservation?.rateReservation || await enforceSubmissionRateLimit(
    env.READING_DB,
    student.id,
    resourceKey,
    definition,
    effectiveOccurredAt,
  );
  const sourceEventId = trustedReservation?.sourceEventId || crypto.randomUUID();
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
    schemaVersion: 2,
    sourceSystem: SOURCE_SYSTEM,
    sourceSiteKey: SOURCE_SITE_KEY,
    contractVersion: versions.contractVersion,
    sourceEventId,
    sourceAttemptId: sourceEventId,
    sourceVersion: versions.sourceVersion,
    sourceReleaseId: versions.sourceReleaseId,
    canonicalUnitId: manifestItem?.canonicalUnitId || `yw:${resourceKey}`,
    resourceVersion: manifestItem?.resourceVersion
      || `sha256:${await sha256Text(`${versions.sourceVersion}\n${resourceKey}`)}`,
    mappingVersion: versions.mappingVersion,
    registryVersion: versions.registryVersion,
    userId: Number(student.ucUserId || 0),
    academicYear: versions.academicYear,
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
    occurredAt: effectiveOccurredAt,
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
    ...(!trustedReservation ? [env.READING_DB.prepare(
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
    )] : []),
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
      raw.serialized, effectiveOccurredAt
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
      effectiveOccurredAt
    ),
    env.READING_DB.prepare(
      "INSERT INTO evidence_outbox (source_event_id, envelope_json) VALUES (?, ?)"
    ).bind(sourceEventId, JSON.stringify(envelope)),
    env.READING_DB.prepare(
      `UPDATE learning_pending_submissions
          SET status = 'completed', attempt_count = attempt_count + 1,
              updated_at = ?, completed_at = ?
        WHERE source_event_id = ? AND student_id = ? AND client_mutation_id = ?`
    ).bind(effectiveOccurredAt, effectiveOccurredAt, sourceEventId, student.id, clientMutationId),
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
          submissionReservation,
          contentionRetry: Number(contentionRetry) + 1,
        });
      }
    }
    throw error;
  }

  if (trustedReservation) trustedSubmissionReservations.delete(trustedReservation);

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

export const OUTBOX_RETRY_SELECTION_SQL = `SELECT source_event_id, envelope_json FROM evidence_outbox
  WHERE central_disposition IS NULL
    AND json_extract(envelope_json, '$.schema') = '${ENVELOPE_SCHEMA}'
    AND json_extract(envelope_json, '$.contractVersion') = '${CURRENT_A_PLUS_CONTRACT_VERSION}'
    AND delivery_status IN ('pending', 'enqueued')
    AND (last_attempt_at IS NULL OR datetime(last_attempt_at) < datetime('now', '-15 minutes'))
  ORDER BY CASE delivery_status WHEN 'pending' THEN 0 ELSE 1 END,
           COALESCE(last_attempt_at, created_at), id
  LIMIT ?`;

export async function retryPendingEvidence(env, limit = 10) {
  if (!env.READING_DB || !env.LEARNING_EVIDENCE_QUEUE) return { attempted: 0, enqueued: 0 };
  const rows = await env.READING_DB.prepare(OUTBOX_RETRY_SELECTION_SQL)
    .bind(Math.max(1, Math.min(50, Number(limit) || 10))).all();
  let enqueued = 0;
  for (const row of rows.results || []) {
    const envelope = JSON.parse(row.envelope_json || "{}");
    const result = await enqueueOutbox(env, row.source_event_id, envelope);
    if (result.status === "enqueued") enqueued += 1;
  }
  return { attempted: (rows.results || []).length, enqueued };
}

const CENTRAL_RECEIPT_SCHEMA = "bdfz-learning-evidence-delivery-receipts-v1";
const CENTRAL_RECEIPT_DISPOSITIONS = new Set(["accepted", "pending_mapping", "quarantined"]);

export const OUTBOX_RECONCILE_SELECTION_SQL = `SELECT source_event_id, central_disposition, central_receipted_at FROM evidence_outbox
  WHERE (central_disposition IS NULL OR central_disposition = 'pending_mapping')
    AND json_extract(envelope_json, '$.schema') = '${ENVELOPE_SCHEMA}'
    AND json_extract(envelope_json, '$.contractVersion') = '${CURRENT_A_PLUS_CONTRACT_VERSION}'
    AND delivery_status IN ('pending', 'enqueued')
    AND (central_receipted_at IS NULL OR datetime(central_receipted_at) < datetime('now', '-15 minutes'))
  ORDER BY COALESCE(central_receipted_at, created_at), id
  LIMIT ?`;

function exactCentralDeliveryReceipt(value, requestedAttemptIds) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (Object.keys(value).sort().join("\n") !== [
    "contractVersion", "receipts", "schemaVersion", "sourceSiteKey",
  ].sort().join("\n")) return null;
  if (value.schemaVersion !== CENTRAL_RECEIPT_SCHEMA
    || value.sourceSiteKey !== SOURCE_SITE_KEY
    || value.contractVersion !== CURRENT_A_PLUS_CONTRACT_VERSION
    || !Array.isArray(value.receipts)
    || value.receipts.length > requestedAttemptIds.length) return null;
  const requested = new Set(requestedAttemptIds);
  const seen = new Set();
  const receipts = [];
  for (const receipt of value.receipts) {
    if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)
      || Object.keys(receipt).sort().join("\n") !== ["disposition", "sourceAttemptId"].sort().join("\n")) {
      return null;
    }
    const sourceAttemptId = clean(receipt.sourceAttemptId, 100);
    const disposition = clean(receipt.disposition, 32);
    if (!requested.has(sourceAttemptId) || seen.has(sourceAttemptId)
      || !CENTRAL_RECEIPT_DISPOSITIONS.has(disposition)) return null;
    seen.add(sourceAttemptId);
    receipts.push({ sourceAttemptId, disposition });
  }
  return receipts;
}

export async function reconcileEvidenceOutbox(env, limit = 50) {
  if (!env.READING_DB
    || typeof env.USER_CENTER_EVIDENCE?.getLearningEvidenceDeliveryReceipts !== "function") {
    return { checked: 0, receipted: 0 };
  }
  const rows = await env.READING_DB.prepare(OUTBOX_RECONCILE_SELECTION_SQL)
    .bind(Math.max(1, Math.min(50, Number(limit) || 50))).all();
  const candidates = rows.results || [];
  if (!candidates.length) return { checked: 0, receipted: 0 };

  // `central_receipted_at` is also the durable receipt-readback lease. The
  // timestamp alone never proves acceptance; only central_disposition does.
  // Exact observed-value CAS makes one isolate the sole RPC owner per row for
  // fifteen minutes, including when UC is unavailable or returns no receipt.
  const pollStartedAt = isoNow();
  let claims;
  try {
    claims = await env.READING_DB.batch(candidates.map((row) => env.READING_DB.prepare(
      `UPDATE evidence_outbox
          SET central_receipted_at = ?
        WHERE source_event_id = ?
          AND ((? IS NULL AND central_disposition IS NULL) OR central_disposition = ?)
          AND ((? IS NULL AND central_receipted_at IS NULL) OR central_receipted_at = ?)
          AND (central_receipted_at IS NULL OR datetime(central_receipted_at) < datetime('now', '-15 minutes'))
          AND delivery_status IN ('pending', 'enqueued')`
    ).bind(
      pollStartedAt,
      row.source_event_id,
      row.central_disposition ?? null,
      row.central_disposition ?? null,
      row.central_receipted_at ?? null,
      row.central_receipted_at ?? null,
    )));
  } catch {
    return { checked: 0, receipted: 0 };
  }
  const claimedRows = candidates.filter((_row, index) => Number(claims?.[index]?.meta?.changes || 0) === 1);
  const attemptIds = [...new Set(claimedRows
    .map((row) => clean(row.source_event_id, 100))
    .filter(Boolean))];
  if (!attemptIds.length) return { checked: 0, receipted: 0 };
  let response;
  try {
    response = await env.USER_CENTER_EVIDENCE.getLearningEvidenceDeliveryReceipts(attemptIds);
  } catch {
    return { checked: attemptIds.length, receipted: 0 };
  }
  const receipts = exactCentralDeliveryReceipt(response, attemptIds);
  if (!receipts) return { checked: attemptIds.length, receipted: 0 };
  const currentDispositions = new Map(claimedRows.map((row) => [
    clean(row.source_event_id, 100),
    clean(row.central_disposition, 32),
  ]));
  let receipted = 0;
  for (const receipt of receipts) {
    // Health and interaction drains may overlap. Bind the exact observed state
    // so a stale poll cannot rewrite or misreport a newer central decision.
    const currentDisposition = currentDispositions.get(receipt.sourceAttemptId) || null;
    if (currentDisposition === receipt.disposition) continue;
    if (currentDisposition === "pending_mapping"
      && !["accepted", "quarantined"].includes(receipt.disposition)) continue;
    const result = await env.READING_DB.prepare(
      `UPDATE evidence_outbox
          SET central_disposition = ?, central_receipted_at = ?,
              delivered_at = COALESCE(delivered_at, ?), last_error_class = ''
        WHERE source_event_id = ?
          AND ((? IS NULL AND central_disposition IS NULL) OR central_disposition = ?)
          AND delivery_status IN ('pending', 'enqueued')`
    ).bind(
      receipt.disposition,
      isoNow(),
      isoNow(),
      receipt.sourceAttemptId,
      currentDisposition,
      currentDisposition,
    ).run();
    if (Number(result?.meta?.changes || 0) === 1) receipted += 1;
  }
  return { checked: attemptIds.length, receipted };
}

export async function drainEvidenceOutbox(env, limit = 50) {
  const reconciled = await reconcileEvidenceOutbox(env, limit);
  const retried = await retryPendingEvidence(env, limit);
  return { reconciled, retried };
}

export const learningEvidenceContract = Object.freeze({
  envelopeSchema: ENVELOPE_SCHEMA,
  sourceSystem: SOURCE_SYSTEM,
  sourceSiteKey: SOURCE_SITE_KEY,
  submissionRateLimit: SUBMISSION_RATE_LIMIT,
  submissionRateLimitReasons: SUBMISSION_RATE_LIMIT_REASONS,
  submissionReservationLeaseSeconds: SUBMISSION_RESERVATION_LEASE_SECONDS,
  evaluatorFailureCooldownSeconds: EVALUATOR_FAILURE_COOLDOWN_SECONDS,
});
