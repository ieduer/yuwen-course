import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  applyDecisionsToBank,
  hashQuestionItem,
  loadDispositionDocument,
} from "./apply_vocab_review_decisions.mjs";
import { assignStableIds } from "./build_vocab_bank.mjs";
import { currentVocabMastery } from "../site/_worker.js";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const VOCAB_DIR = path.join(ROOT, "site", "data", "vocab");
const document = loadDispositionDocument();

function loadBank(lessonId) {
  return JSON.parse(readFileSync(path.join(VOCAB_DIR, `${lessonId}.json`), "utf8"));
}

test("review ledger freezes both independently reviewed batches", () => {
  assert.equal(document.schemaVersion, "yw-vocab-question-dispositions-v2");
  assert.equal(document.decisions.length, 35);
  assert.equal(new Set(document.decisions.map((item) => item.itemId)).size, 35);
  assert.deepEqual(
    new Set(document.decisions.map((item) => item.reasonCode)),
    new Set([
      "context_free_basic_meaning",
      "invalid_or_ambiguous_question",
      "wrong_source_material",
    ]),
  );
  assert.equal(document.decisions.filter((item) => !item.reviewRef).length, 16);
  assert.equal(
    document.decisions.filter(
      (item) => item.reviewRef === "yw-vocab-review-20260730-independent-quality-v1",
    ).length,
    19,
  );
});

test("suppression preserves the stable ID and full former question", () => {
  const decision = document.decisions[0];
  const appliedBank = loadBank(decision.lessonId);
  const existingTombstone = appliedBank.questionTombstones.find((item) => item.itemId === decision.itemId);
  assert.ok(existingTombstone);
  const sourceQuestion = existingTombstone.formerItem;
  const fixture = {
    lessonId: decision.lessonId,
    inventory: [sourceQuestion],
  };
  const result = applyDecisionsToBank(fixture, document, [decision]);
  const excluded = result.inventory.find((item) => item.id === decision.itemId);
  const tombstone = result.questionTombstones.find((item) => item.itemId === decision.itemId);
  assert.equal(excluded.id, sourceQuestion.id);
  assert.equal(excluded.decision, "excluded");
  assert.equal(excluded.tombstoneRef, decision.dispositionId);
  assert.equal("question" in excluded, false);
  assert.deepEqual(tombstone.formerItem, sourceQuestion);
  assert.equal(hashQuestionItem(tombstone.formerItem), decision.sourceItemSha256);
  assert.match(result.questionSetVersion, /^vocab-set-[a-f0-9]{16}$/);
  assert.deepEqual(applyDecisionsToBank(result, document, [decision]), result);
});

test("a reviewed ID cannot be reused for a changed question", () => {
  const decision = document.decisions[0];
  const bank = loadBank(decision.lessonId);
  const tombstone = bank.questionTombstones.find((item) => item.itemId === decision.itemId);
  const changed = {
    ...tombstone.formerItem,
    question: `${tombstone.formerItem.question}（改寫）`,
  };
  assert.throws(
    () => applyDecisionsToBank({ lessonId: decision.lessonId, inventory: [changed], questionTombstones: [tombstone] }, document, [decision]),
    /semantic snapshot drift|reused for a different question/,
  );
});

test("stable ID assignment survives reorder and never reuses a tombstoned number", () => {
  const existing = {
    lessonId: "lesson-test",
    inventory: [
      { id: "lesson-test:v01", word: "甲", sourceSentence: "甲在原句", decision: "question", type: "contextual-choice" },
      { id: "lesson-test:v02", word: "乙", sourceSentence: "乙在原句", decision: "note-only" },
      { id: "lesson-test:v03", word: "旧题", sourceSentence: "旧题原句", decision: "excluded", tombstoneRef: "review:old" },
    ],
    questionTombstones: [
      {
        itemId: "lesson-test:v03",
        formerItem: {
          id: "lesson-test:v03",
          word: "旧题",
          sourceSentence: "旧题原句",
          decision: "question",
          type: "contextual-choice",
        },
      },
    ],
  };
  const assigned = assignStableIds([
    { word: "乙", sourceSentence: "乙在原句", decision: "note-only" },
    { word: "甲", sourceSentence: "甲在原句", decision: "question", type: "contextual-choice" },
    { word: "新词", sourceSentence: "新词在原句", decision: "question", type: "contextual-choice" },
  ], existing, "lesson-test", "modern-prose");
  assert.deepEqual(assigned.map((item) => item.id), ["lesson-test:v02", "lesson-test:v01", "lesson-test:v04"]);
});

test("a reviewed tombstone survives a legitimate bank rebuild before location is restored", () => {
  const document = loadDispositionDocument();
  const decision = document.decisions[0];
  const bank = JSON.parse(readFileSync(path.join(VOCAB_DIR, `${decision.lessonId}.json`), "utf8"));
  const tombstone = bank.questionTombstones.find((entry) => entry.itemId === decision.itemId);
  const rebuiltQuestion = structuredClone(tombstone.formerItem);
  delete rebuiltQuestion.location;

  const result = applyDecisionsToBank({
    lessonId: decision.lessonId,
    inventory: [rebuiltQuestion],
    questionTombstones: [tombstone],
  }, document, [decision]);

  const excluded = result.inventory.find((item) => item.id === decision.itemId);
  assert.equal(excluded.decision, "excluded");
  assert.equal(excluded.tombstoneRef, decision.dispositionId);
  assert.deepEqual(
    result.questionTombstones.find((entry) => entry.itemId === decision.itemId).formerItem,
    tombstone.formerItem,
  );
});

test("all reviewed questions are inactive with exact tombstones and index IDs", () => {
  const index = JSON.parse(readFileSync(path.join(VOCAB_DIR, "index.json"), "utf8"));
  assert.equal(index.schemaVersion, "yw-vocab-index-v2");
  for (const decision of document.decisions) {
    const bank = loadBank(decision.lessonId);
    const item = bank.inventory.find((entry) => entry.id === decision.itemId);
    const tombstone = bank.questionTombstones.find((entry) => entry.itemId === decision.itemId);
    assert.equal(item?.decision, "excluded", decision.itemId);
    assert.equal(item?.tombstoneRef, decision.dispositionId, decision.itemId);
    assert.equal(tombstone?.sourceItemSha256, decision.sourceItemSha256, decision.itemId);
    assert.equal(hashQuestionItem(tombstone.formerItem), decision.sourceItemSha256, decision.itemId);
    assert.equal(index.activeItemIds[decision.lessonId].includes(decision.itemId), false, decision.itemId);
    assert.equal(index.tombstoneItemIds[decision.lessonId].includes(decision.itemId), true, decision.itemId);
    assert.equal(index.lessons[decision.lessonId], index.activeItemIds[decision.lessonId].length);
  }
});

test("historical mastery for a tombstoned ID is excluded from current denominators", () => {
  const index = {
    lessons: { "lesson-example": 2 },
    activeItemIds: { "lesson-example": ["lesson-example:v01", "lesson-example:v02"] },
  };
  const result = currentVocabMastery([
    { lesson_id: "lesson-example", item_id: "lesson-example:v01", status: "mastered" },
    { lesson_id: "lesson-example", item_id: "lesson-example:v02", status: "learning" },
    { lesson_id: "lesson-example", item_id: "lesson-example:v03", status: "mastered" },
  ], index);
  assert.deepEqual(result.get("lesson-example"), { attempted: 2, mastered: 1 });
});

test("a bank whose entire prior question set came from the wrong source fails closed for rebuild", () => {
  const bank = loadBank("lesson-1572");
  assert.equal(bank.questionSetStatus, "blocked-rebuild-required");
  assert.equal(bank.questionSetBlocker.reasonCode, "wrong_source_material");
  assert.deepEqual(
    bank.questionSetBlocker.suppressedQuestionIds,
    [
      "lesson-1572:v01",
      "lesson-1572:v02",
      "lesson-1572:v03",
      "lesson-1572:v04",
      "lesson-1572:v05",
    ],
  );
  assert.equal(bank.inventory.filter((item) => item.decision === "question").length, 0);
});
