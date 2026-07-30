import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_VOCAB_ELIGIBILITY_FILE = path.join(
  ROOT,
  "site",
  "data",
  "vocab-eligibility.json",
);
export const ELIGIBILITY_TOMBSTONE_REASON = "non_classical_scope_excluded";

const ITEM_ID_RE = /^lesson-[\w-]+:v\d{2,}$/;
const SHA256_RE = /^[a-f0-9]{64}$/;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function hashEligibilitySourceItem(item) {
  return createHash("sha256").update(JSON.stringify(item)).digest("hex");
}

export function validateVocabEligibility(document) {
  assert(document?.schemaVersion === "yw-vocab-eligibility-v1", "unsupported vocab eligibility schema");
  assert(typeof document.policyVersion === "string" && document.policyVersion.length > 0,
    "vocab eligibility policyVersion required");
  assert(Array.isArray(document.defaultEligibleModes) && document.defaultEligibleModes.length > 0,
    "defaultEligibleModes required");
  assert(
    new Set(document.defaultEligibleModes).size === document.defaultEligibleModes.length,
    "defaultEligibleModes must be unique",
  );
  assert(
    document.defaultEligibleModes.every((mode) => typeof mode === "string" && mode.length > 0),
    "defaultEligibleModes contains an invalid mode",
  );
  assert(document.exceptionPolicy === "reviewed-item-only", "unsupported vocab exception policy");
  assert(typeof document.review?.reviewId === "string" && document.review.reviewId.length > 0,
    "vocab eligibility reviewId required");
  assert(
    typeof document.review?.reviewedAt === "string"
      && Number.isFinite(Date.parse(document.review.reviewedAt)),
    "vocab eligibility reviewedAt must be ISO-8601",
  );
  assert(typeof document.review?.authority === "string" && document.review.authority.length > 0,
    "vocab eligibility review authority required");
  assert(typeof document.review?.reason === "string" && document.review.reason.length > 0,
    "vocab eligibility review reason required");
  assert(Array.isArray(document.exceptions), "vocab eligibility exceptions must be an array");

  const exceptionIds = new Set();
  const itemIds = new Set();
  for (const exception of document.exceptions) {
    assert(typeof exception.exceptionId === "string" && exception.exceptionId.length > 0,
      "vocab exceptionId required");
    assert(!exceptionIds.has(exception.exceptionId), `duplicate vocab exceptionId: ${exception.exceptionId}`);
    exceptionIds.add(exception.exceptionId);
    assert(/^lesson-[\w-]+$/.test(exception.lessonId || ""),
      `${exception.exceptionId}: invalid lessonId`);
    assert(ITEM_ID_RE.test(exception.itemId || ""), `${exception.exceptionId}: invalid itemId`);
    assert(exception.itemId.startsWith(`${exception.lessonId}:`),
      `${exception.exceptionId}: itemId lesson mismatch`);
    assert(!itemIds.has(exception.itemId), `duplicate vocab exception item: ${exception.itemId}`);
    itemIds.add(exception.itemId);
    assert(SHA256_RE.test(exception.sourceItemSha256 || ""),
      `${exception.exceptionId}: invalid sourceItemSha256`);
    assert(typeof exception.reviewId === "string" && exception.reviewId.length > 0,
      `${exception.exceptionId}: reviewId required`);
    assert(
      typeof exception.reviewedAt === "string" && Number.isFinite(Date.parse(exception.reviewedAt)),
      `${exception.exceptionId}: reviewedAt must be ISO-8601`,
    );
    assert(typeof exception.authority === "string" && exception.authority.length > 0,
      `${exception.exceptionId}: authority required`);
    assert(typeof exception.reason === "string" && exception.reason.length > 0,
      `${exception.exceptionId}: reason required`);
  }
  return document;
}

export function loadVocabEligibility(file = DEFAULT_VOCAB_ELIGIBILITY_FILE) {
  return validateVocabEligibility(JSON.parse(readFileSync(file, "utf8")));
}

export function vocabExceptionByItem(document) {
  return new Map(document.exceptions.map((exception) => [exception.itemId, exception]));
}

export function isDefaultVocabMode(document, mode) {
  return document.defaultEligibleModes.includes(String(mode || ""));
}

export function isVocabItemEligible(document, { mode, lessonId, itemId, sourceItemSha256 = "" }) {
  if (isDefaultVocabMode(document, mode)) return true;
  const exception = vocabExceptionByItem(document).get(itemId);
  if (!exception || exception.lessonId !== lessonId) return false;
  return sourceItemSha256 === "" || exception.sourceItemSha256 === sourceItemSha256;
}

export function isEligibilityTombstone(tombstone) {
  return tombstone?.reasonCode === ELIGIBILITY_TOMBSTONE_REASON;
}

function eligibilityDisposition(document, item) {
  return {
    schemaVersion: "yw-vocab-question-tombstone-v1",
    dispositionId: `${document.policyVersion}:${item.id}`,
    reviewId: document.review.reviewId,
    reviewedAt: document.review.reviewedAt,
    itemId: item.id,
    action: "suppress",
    reasonCode: ELIGIBILITY_TOMBSTONE_REASON,
    reason: document.review.reason,
    sourceItemSha256: hashEligibilitySourceItem(item),
    formerItem: clone(item),
  };
}

function excludedInventoryItem(tombstone) {
  const item = {};
  const questionOnlyFields = new Set([
    "type",
    "question",
    "options",
    "answerIndex",
    "explanation",
    "distractorRationales",
    "difficulty",
    "sourceRefs",
  ]);
  for (const [key, value] of Object.entries(tombstone.formerItem)) {
    if (!questionOnlyFields.has(key)) item[key] = clone(value);
  }
  item.decision = "excluded";
  item.reason = `依詞級疏通範圍規則移除：${tombstone.reason}`;
  item.tombstoneRef = tombstone.dispositionId;
  return item;
}

export function verifyEligibilityTombstone(tombstone, document, { mode, lessonId }) {
  assert(isEligibilityTombstone(tombstone), `${tombstone?.itemId || lessonId}: not an eligibility tombstone`);
  assert(tombstone.schemaVersion === "yw-vocab-question-tombstone-v1",
    `${tombstone.itemId}: bad tombstone schema`);
  assert(tombstone.dispositionId === `${document.policyVersion}:${tombstone.itemId}`,
    `${tombstone.itemId}: eligibility dispositionId drift`);
  assert(tombstone.reviewId === document.review.reviewId,
    `${tombstone.itemId}: eligibility reviewId drift`);
  assert(tombstone.reviewedAt === document.review.reviewedAt,
    `${tombstone.itemId}: eligibility reviewedAt drift`);
  assert(tombstone.action === "suppress", `${tombstone.itemId}: eligibility action drift`);
  assert(tombstone.reason === document.review.reason, `${tombstone.itemId}: eligibility reason drift`);
  assert(tombstone.formerItem?.id === tombstone.itemId,
    `${tombstone.itemId}: eligibility former item id drift`);
  assert(tombstone.formerItem?.decision === "question",
    `${tombstone.itemId}: eligibility former item is not a question`);
  assert(hashEligibilitySourceItem(tombstone.formerItem) === tombstone.sourceItemSha256,
    `${tombstone.itemId}: eligibility former item hash drift`);
  assert(
    !isVocabItemEligible(document, {
      mode,
      lessonId,
      itemId: tombstone.itemId,
      sourceItemSha256: tombstone.sourceItemSha256,
    }),
    `${tombstone.itemId}: reviewed exception cannot remain eligibility-tombstoned`,
  );
  return tombstone;
}

export function applyVocabEligibilityToBank(bank, mode, document) {
  assert(Array.isArray(bank?.inventory), `${bank?.lessonId || "(unknown)"}: inventory missing`);
  const result = clone(bank);
  const tombstones = Array.isArray(result.questionTombstones)
    ? result.questionTombstones
    : [];
  const eligibilityByItem = new Map(
    tombstones.filter(isEligibilityTombstone).map((tombstone) => [tombstone.itemId, tombstone]),
  );
  const inventoryById = new Map(result.inventory.map((item, index) => [item.id, index]));

  for (const tombstone of eligibilityByItem.values()) {
    verifyEligibilityTombstone(tombstone, document, { mode, lessonId: result.lessonId });
    const index = inventoryById.get(tombstone.itemId);
    const excluded = excludedInventoryItem(tombstone);
    if (index === undefined) {
      inventoryById.set(tombstone.itemId, result.inventory.length);
      result.inventory.push(excluded);
    } else {
      result.inventory[index] = excluded;
    }
  }

  for (let index = 0; index < result.inventory.length; index += 1) {
    const item = result.inventory[index];
    if (item?.decision !== "question") continue;
    const sourceItemSha256 = hashEligibilitySourceItem(item);
    if (isVocabItemEligible(document, {
      mode,
      lessonId: result.lessonId,
      itemId: item.id,
      sourceItemSha256,
    })) {
      continue;
    }
    let tombstone = eligibilityByItem.get(item.id);
    if (tombstone) {
      verifyEligibilityTombstone(tombstone, document, { mode, lessonId: result.lessonId });
      assert(tombstone.sourceItemSha256 === sourceItemSha256,
        `${item.id}: eligibility source question hash drift`);
    } else {
      tombstone = eligibilityDisposition(document, item);
      tombstones.push(tombstone);
      eligibilityByItem.set(item.id, tombstone);
    }
    result.inventory[index] = excludedInventoryItem(tombstone);
  }

  result.questionTombstones = tombstones.sort((left, right) => (
    left.itemId.localeCompare(right.itemId, "en")
  ));
  if (eligibilityByItem.size > 0) {
    const prior = result.reviewRevision?.reviewIds || [];
    result.reviewRevision = {
      schemaVersion: "yw-vocab-review-revision-v2",
      reviewIds: [...new Set([...prior, document.review.reviewId])].sort(),
      latestReviewedAt: [result.reviewRevision?.latestReviewedAt, document.review.reviewedAt]
        .filter(Boolean)
        .sort()
        .at(-1),
    };
  }
  const activeIds = result.inventory
    .filter((item) => item?.decision === "question")
    .map((item) => item.id);
  if (!isDefaultVocabMode(document, mode) && activeIds.length === 0) {
    delete result.questionSetStatus;
    delete result.questionSetBlocker;
  }
  result.questionSetVersion = `vocab-set-${createHash("sha256")
    .update(JSON.stringify(activeIds))
    .digest("hex")
    .slice(0, 16)}`;
  return result;
}
