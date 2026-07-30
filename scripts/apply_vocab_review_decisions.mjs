import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  applyVocabEligibilityToBank,
  DEFAULT_VOCAB_ELIGIBILITY_FILE,
  isEligibilityTombstone,
  loadVocabEligibility,
} from "./vocab_eligibility.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");
const VOCAB_DIR = path.join(ROOT, "site", "data", "vocab");
const DEFAULT_DISPOSITIONS = path.join(ROOT, "site", "data", "vocab-question-dispositions.json");
const TAXONOMY_FILE = path.join(ROOT, "site", "data", "literary-taxonomy.json");
const ITEM_ID_RE = /^lesson-[\w-]+:v\d{2,}$/;
const SHA256_RE = /^[a-f0-9]{64}$/;
const DISPOSITION_SCHEMAS = new Set([
  "yw-vocab-question-dispositions-v1",
  "yw-vocab-question-dispositions-v2",
]);
const REASON_CODES = new Set([
  "context_free_basic_meaning",
  "invalid_or_ambiguous_question",
  "wrong_source_material",
]);
const QUESTION_ONLY_FIELDS = new Set([
  "type",
  "question",
  "options",
  "answerIndex",
  "explanation",
  "distractorRationales",
  "difficulty",
  "sourceRefs",
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function hashQuestionItem(item) {
  return createHash("sha256").update(JSON.stringify(item)).digest("hex");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertSemanticSnapshot(item, decision) {
  const summary = decision.semanticSummary || {};
  for (const field of ["word", "question", "contextMeaning", "sourceSentence"]) {
    assert(
      String(item?.[field] || "") === String(summary[field] || ""),
      `${decision.itemId}: semantic snapshot drift in ${field}`,
    );
  }
}

function reviewFor(document, decision) {
  if (!decision.reviewRef) {
    return {
      reviewId: document.reviewId,
      reviewedAt: document.reviewedAt,
      reason: String(decision.reason || document.policy?.reason || "").trim(),
    };
  }
  const review = document.reviews?.[decision.reviewRef];
  assert(review, `${decision.itemId}: unknown reviewRef ${decision.reviewRef}`);
  return {
    reviewId: decision.reviewRef,
    reviewedAt: review.reviewedAt,
    reason: String(decision.reason || review.reason || document.policy?.reason || "").trim(),
  };
}

function latestReviewedAt(document) {
  return document.decisions
    .map((decision) => reviewFor(document, decision).reviewedAt)
    .sort()
    .at(-1);
}

export function validateDispositionDocument(document) {
  assert(DISPOSITION_SCHEMAS.has(document?.schemaVersion), "unsupported disposition schema");
  assert(typeof document.reviewId === "string" && document.reviewId.length > 0, "reviewId required");
  assert(
    typeof document.reviewedAt === "string" && Number.isFinite(Date.parse(document.reviewedAt)),
    "reviewedAt must be an ISO timestamp",
  );
  if (document.schemaVersion === "yw-vocab-question-dispositions-v2") {
    assert(document.reviews && typeof document.reviews === "object", "reviews required for v2");
    for (const [reviewId, review] of Object.entries(document.reviews)) {
      assert(typeof reviewId === "string" && reviewId.length > 0, "review id required");
      assert(
        typeof review?.reviewedAt === "string" && Number.isFinite(Date.parse(review.reviewedAt)),
        `${reviewId}: reviewedAt must be an ISO timestamp`,
      );
      assert(typeof review.reason === "string" && review.reason.length > 0, `${reviewId}: reason required`);
    }
  }
  assert(Array.isArray(document.decisions) && document.decisions.length > 0, "decisions required");
  const dispositionIds = new Set();
  const itemIds = new Set();
  for (const decision of document.decisions) {
    assert(typeof decision.dispositionId === "string" && decision.dispositionId.length > 0, "dispositionId required");
    assert(!dispositionIds.has(decision.dispositionId), `duplicate dispositionId: ${decision.dispositionId}`);
    dispositionIds.add(decision.dispositionId);
    assert(ITEM_ID_RE.test(decision.itemId || ""), `bad itemId: ${decision.itemId}`);
    assert(decision.itemId.startsWith(`${decision.lessonId}:`), `${decision.itemId}: lessonId mismatch`);
    assert(!itemIds.has(decision.itemId), `duplicate item disposition: ${decision.itemId}`);
    itemIds.add(decision.itemId);
    assert(decision.action === "suppress", `${decision.itemId}: unsupported action`);
    assert(REASON_CODES.has(decision.reasonCode), `${decision.itemId}: unsupported reasonCode`);
    assert(SHA256_RE.test(decision.sourceItemSha256 || ""), `${decision.itemId}: bad sourceItemSha256`);
    const summary = decision.semanticSummary || {};
    for (const field of ["word", "question", "contextMeaning", "sourceSentence"]) {
      assert(typeof summary[field] === "string" && summary[field].length > 0, `${decision.itemId}: ${field} required`);
    }
    const review = reviewFor(document, decision);
    assert(
      typeof review.reviewedAt === "string" && Number.isFinite(Date.parse(review.reviewedAt)),
      `${decision.itemId}: invalid review timestamp`,
    );
    assert(review.reason.length > 0, `${decision.itemId}: review reason required`);
  }
  return document;
}

export function loadDispositionDocument(file = DEFAULT_DISPOSITIONS) {
  assert(existsSync(file), `disposition document missing: ${file}`);
  return validateDispositionDocument(JSON.parse(readFileSync(file, "utf8")));
}

function tombstoneFor(document, decision, formerItem) {
  const review = reviewFor(document, decision);
  const reason = review.reason;
  assert(reason, "policy.reason required");
  return {
    schemaVersion: "yw-vocab-question-tombstone-v1",
    dispositionId: decision.dispositionId,
    reviewId: review.reviewId,
    reviewedAt: review.reviewedAt,
    itemId: decision.itemId,
    action: decision.action,
    reasonCode: decision.reasonCode,
    reason,
    sourceItemSha256: decision.sourceItemSha256,
    formerItem: clone(formerItem),
  };
}

function excludedInventoryItem(tombstone) {
  const item = {};
  for (const [key, value] of Object.entries(tombstone.formerItem)) {
    if (!QUESTION_ONLY_FIELDS.has(key)) item[key] = clone(value);
  }
  item.decision = "excluded";
  item.reason = `经人工复核移除：${tombstone.reason}`;
  item.tombstoneRef = tombstone.dispositionId;
  return item;
}

export function verifyTombstone(tombstone, document, decision) {
  const review = reviewFor(document, decision);
  assert(tombstone?.schemaVersion === "yw-vocab-question-tombstone-v1", `${decision.itemId}: bad tombstone schema`);
  assert(tombstone.dispositionId === decision.dispositionId, `${decision.itemId}: dispositionId drift`);
  assert(tombstone.reviewId === review.reviewId, `${decision.itemId}: reviewId drift`);
  assert(tombstone.reviewedAt === review.reviewedAt, `${decision.itemId}: reviewedAt drift`);
  assert(tombstone.itemId === decision.itemId, `${decision.itemId}: tombstone itemId drift`);
  assert(tombstone.action === decision.action, `${decision.itemId}: tombstone action drift`);
  assert(tombstone.reasonCode === decision.reasonCode, `${decision.itemId}: tombstone reasonCode drift`);
  assert(tombstone.sourceItemSha256 === decision.sourceItemSha256, `${decision.itemId}: tombstone source hash drift`);
  assert(tombstone.formerItem?.id === decision.itemId, `${decision.itemId}: former item id drift`);
  assert(tombstone.formerItem?.decision === "question", `${decision.itemId}: former item is not a question`);
  assert(
    hashQuestionItem(tombstone.formerItem) === decision.sourceItemSha256,
    `${decision.itemId}: former item payload hash drift`,
  );
  assertSemanticSnapshot(tombstone.formerItem, decision);
}

export function applyDecisionsToBank(bank, document, lessonDecisions) {
  assert(Array.isArray(bank?.inventory), `${bank?.lessonId || "(unknown)"}: inventory missing`);
  const result = clone(bank);
  const tombstones = Array.isArray(result.questionTombstones) ? result.questionTombstones : [];
  const inventoryIds = new Set();
  for (const item of result.inventory) {
    assert(ITEM_ID_RE.test(item?.id || ""), `${result.lessonId}: bad inventory id ${item?.id}`);
    assert(!inventoryIds.has(item.id), `${result.lessonId}: duplicate inventory id ${item.id}`);
    inventoryIds.add(item.id);
  }

  for (const decision of lessonDecisions) {
    assert(decision.lessonId === result.lessonId, `${decision.itemId}: wrong bank ${result.lessonId}`);
    let itemIndex = result.inventory.findIndex((item) => item?.id === decision.itemId);
    const existingTombstone = tombstones.find((entry) => entry?.itemId === decision.itemId);

    if (existingTombstone) {
      verifyTombstone(existingTombstone, document, decision);
      const excluded = excludedInventoryItem(existingTombstone);
      if (itemIndex < 0) {
        result.inventory.push(excluded);
        itemIndex = result.inventory.length - 1;
      } else {
        const current = result.inventory[itemIndex];
        if (current.decision === "question") {
          assertSemanticSnapshot(current, decision);
        } else {
          assert(current.tombstoneRef === decision.dispositionId, `${decision.itemId}: inventory tombstoneRef drift`);
        }
        result.inventory[itemIndex] = excluded;
      }
      continue;
    }

    assert(itemIndex >= 0, `${decision.itemId}: reviewed item absent from bank`);
    const current = result.inventory[itemIndex];
    assert(current.decision === "question", `${decision.itemId}: reviewed item is not an active question`);
    assertSemanticSnapshot(current, decision);
    assert(
      hashQuestionItem(current) === decision.sourceItemSha256,
      `${decision.itemId}: source question hash drift`,
    );
    const tombstone = tombstoneFor(document, decision, current);
    tombstones.push(tombstone);
    result.inventory[itemIndex] = excludedInventoryItem(tombstone);
  }

  const tombstoneIds = new Set();
  for (const tombstone of tombstones) {
    assert(!tombstoneIds.has(tombstone.itemId), `${result.lessonId}: duplicate tombstone ${tombstone.itemId}`);
    tombstoneIds.add(tombstone.itemId);
  }
  result.questionTombstones = tombstones.sort((a, b) => a.itemId.localeCompare(b.itemId));
  const reviews = lessonDecisions.map((decision) => reviewFor(document, decision));
  result.reviewRevision = {
    schemaVersion: "yw-vocab-review-revision-v2",
    reviewIds: [...new Set(reviews.map((review) => review.reviewId))].sort(),
    latestReviewedAt: reviews.map((review) => review.reviewedAt).sort().at(-1),
  };
  const activeIds = result.inventory
    .filter((item) => item?.decision === "question")
    .map((item) => item.id);
  const wrongSourceDecisions = lessonDecisions.filter(
    (decision) => decision.reasonCode === "wrong_source_material",
  );
  if (activeIds.length === 0 && wrongSourceDecisions.length > 0) {
    result.questionSetStatus = "blocked-rebuild-required";
    result.questionSetBlocker = {
      reasonCode: "wrong_source_material",
      reviewIds: [...new Set(
        wrongSourceDecisions.map((decision) => reviewFor(document, decision).reviewId),
      )].sort(),
      suppressedQuestionIds: wrongSourceDecisions.map((decision) => decision.itemId).sort(),
    };
  } else {
    delete result.questionSetStatus;
    delete result.questionSetBlocker;
  }
  result.questionSetVersion = `vocab-set-${createHash("sha256")
    .update(JSON.stringify(activeIds))
    .digest("hex")
    .slice(0, 16)}`;
  return result;
}

export function buildVocabIndex(banks, builtAt) {
  const lessons = {};
  const activeItemIds = {};
  const tombstoneItemIds = {};
  for (const bank of [...banks].sort((a, b) => a.lessonId.localeCompare(b.lessonId))) {
    const active = bank.inventory
      .filter((item) => item?.decision === "question")
      .map((item) => item.id);
    const tombstones = (bank.questionTombstones || []).map((entry) => entry.itemId);
    lessons[bank.lessonId] = active.length;
    activeItemIds[bank.lessonId] = active;
    if (tombstones.length) tombstoneItemIds[bank.lessonId] = [...tombstones].sort();
  }
  return {
    schemaVersion: "yw-vocab-index-v2",
    builtAt,
    lessons,
    activeItemIds,
    tombstoneItemIds,
  };
}

function stringify(value) {
  return `${JSON.stringify(value, null, 1)}\n`;
}

function loadAllBanks(overrides = new Map()) {
  const lessonIds = readdirSync(VOCAB_DIR)
    .filter((file) => /^lesson-.*\.json$/.test(file))
    .map((file) => file.slice(0, -".json".length))
    .sort();
  return lessonIds.map((lessonId) => {
    if (overrides.has(lessonId)) return overrides.get(lessonId);
    return JSON.parse(readFileSync(path.join(VOCAB_DIR, `${lessonId}.json`), "utf8"));
  });
}

export function applyDispositionDocument({
  check = false,
  dispositionFile = DEFAULT_DISPOSITIONS,
  eligibilityFile = DEFAULT_VOCAB_ELIGIBILITY_FILE,
} = {}) {
  const document = loadDispositionDocument(dispositionFile);
  const eligibility = loadVocabEligibility(eligibilityFile);
  const taxonomy = JSON.parse(readFileSync(TAXONOMY_FILE, "utf8"));
  const taxonomyByLesson = new Map(taxonomy.lessons.map((lesson) => [lesson.id, lesson]));
  const byLesson = new Map();
  for (const decision of document.decisions) {
    if (!byLesson.has(decision.lessonId)) byLesson.set(decision.lessonId, []);
    byLesson.get(decision.lessonId).push(decision);
  }

  const overrides = new Map();
  let changedBanks = 0;
  const bankLessonIds = readdirSync(VOCAB_DIR)
    .filter((file) => /^lesson-.*\.json$/.test(file))
    .map((file) => file.slice(0, -".json".length))
    .sort((left, right) => left.localeCompare(right, "en"));
  for (const lessonId of bankLessonIds) {
    const file = path.join(VOCAB_DIR, `${lessonId}.json`);
    assert(existsSync(file), `${lessonId}: bank file missing`);
    const current = JSON.parse(readFileSync(file, "utf8"));
    const taxonomyLesson = taxonomyByLesson.get(lessonId);
    assert(taxonomyLesson, `${lessonId}: taxonomy entry missing`);
    const decisions = byLesson.get(lessonId) || [];
    const reviewed = decisions.length
      ? applyDecisionsToBank(current, document, decisions)
      : current;
    const next = applyVocabEligibilityToBank(reviewed, taxonomyLesson.mode, eligibility);
    overrides.set(lessonId, next);
    if (JSON.stringify(current) !== JSON.stringify(next)) {
      changedBanks += 1;
      if (!check) writeFileSync(file, stringify(next));
    }
  }

  const banks = loadAllBanks(overrides);
  const nextIndex = buildVocabIndex(
    banks,
    [latestReviewedAt(document), eligibility.review.reviewedAt].sort().at(-1),
  );
  const indexFile = path.join(VOCAB_DIR, "index.json");
  const currentIndex = JSON.parse(readFileSync(indexFile, "utf8"));
  const indexChanged = JSON.stringify(currentIndex) !== JSON.stringify(nextIndex);
  if (!check && indexChanged) writeFileSync(indexFile, stringify(nextIndex));
  if (check && (changedBanks || indexChanged)) {
    throw new Error(`review decisions not applied: changedBanks=${changedBanks} indexChanged=${indexChanged}`);
  }
  return {
    decisions: document.decisions.length,
    lessons: byLesson.size,
    changedBanks,
    indexChanged,
    activeQuestions: Object.values(nextIndex.lessons).reduce((sum, count) => sum + count, 0),
    tombstones: Object.values(nextIndex.tombstoneItemIds).reduce((sum, ids) => sum + ids.length, 0),
    eligibilityTombstones: banks.reduce((sum, bank) => (
      sum + (bank.questionTombstones || []).filter(isEligibilityTombstone).length
    ), 0),
    eligibilityLessons: banks.filter((bank) => (
      (bank.questionTombstones || []).some(isEligibilityTombstone)
    )).length,
  };
}

async function main() {
  const check = process.argv.includes("--check");
  const dispositionIndex = process.argv.indexOf("--dispositions");
  const dispositionFile = dispositionIndex >= 0
    ? path.resolve(process.cwd(), String(process.argv[dispositionIndex + 1] || ""))
    : DEFAULT_DISPOSITIONS;
  const eligibilityIndex = process.argv.indexOf("--eligibility");
  const eligibilityFile = eligibilityIndex >= 0
    ? path.resolve(process.cwd(), String(process.argv[eligibilityIndex + 1] || ""))
    : DEFAULT_VOCAB_ELIGIBILITY_FILE;
  const result = applyDispositionDocument({ check, dispositionFile, eligibilityFile });
  process.stdout.write(
    `${check ? "checked" : "applied"} ${result.decisions} decisions across ${result.lessons} lessons; ` +
    `active=${result.activeQuestions} tombstones=${result.tombstones} ` +
    `eligibility=${result.eligibilityTombstones}/${result.eligibilityLessons} ` +
    `changedBanks=${result.changedBanks}\n`,
  );
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    process.stderr.write(`apply_vocab_review_decisions: ${error.message}\n`);
    process.exit(1);
  });
}
