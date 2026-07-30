#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  isEligibilityTombstone,
  isVocabItemEligible,
  loadVocabEligibility,
  verifyEligibilityTombstone,
} from "./vocab_eligibility.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const json = (file) => JSON.parse(readFileSync(path.join(ROOT, file), "utf8"));
const eligibility = loadVocabEligibility();
const taxonomy = json("site/data/literary-taxonomy.json");
const modeByLesson = new Map(taxonomy.lessons.map((lesson) => [lesson.id, lesson.mode]));
const index = json("site/data/vocab/index.json");
const banks = Object.keys(index.lessons).map((lessonId) => (
  json(`site/data/vocab/${lessonId}.json`)
));

test("policy is fail-closed with no current nonclassical exception", () => {
  assert.deepEqual(eligibility.defaultEligibleModes, ["classical", "poetry"]);
  assert.equal(eligibility.exceptionPolicy, "reviewed-item-only");
  assert.deepEqual(eligibility.exceptions, []);
});

test("all active vocabulary items are eligible and only classical or poetry", () => {
  const active = [];
  const activeLessons = new Set();
  for (const bank of banks) {
    const mode = modeByLesson.get(bank.lessonId);
    for (const item of bank.inventory.filter((entry) => entry.decision === "question")) {
      assert.equal(
        isVocabItemEligible(eligibility, {
          mode,
          lessonId: bank.lessonId,
          itemId: item.id,
        }),
        true,
        `${item.id} is outside policy`,
      );
      active.push(item.id);
      activeLessons.add(bank.lessonId);
    }
  }
  assert.equal(active.length, 723);
  assert.equal(activeLessons.size, 77);
});

test("nonclassical questions are exact tombstones and prior review history is preserved", () => {
  const dispositions = json("site/data/vocab-question-dispositions.json");
  const reviewedIds = new Set(dispositions.decisions.map((decision) => decision.itemId));
  let eligibilityTombstones = 0;
  let qualityTombstones = 0;
  const nonclassicalLessons = new Set();
  const qualityIds = new Set();

  for (const bank of banks) {
    const mode = modeByLesson.get(bank.lessonId);
    const active = bank.inventory.filter((item) => item.decision === "question");
    if (!eligibility.defaultEligibleModes.includes(mode)) {
      assert.equal(active.length, 0, `${bank.lessonId} still has nonclassical questions`);
    }
    for (const tombstone of bank.questionTombstones || []) {
      if (isEligibilityTombstone(tombstone)) {
        verifyEligibilityTombstone(tombstone, eligibility, {
          mode,
          lessonId: bank.lessonId,
        });
        eligibilityTombstones += 1;
        nonclassicalLessons.add(bank.lessonId);
      } else {
        qualityTombstones += 1;
        qualityIds.add(tombstone.itemId);
      }
    }
  }

  assert.equal(eligibilityTombstones, 344);
  assert.equal(nonclassicalLessons.size, 56);
  assert.equal(qualityTombstones, 35);
  assert.deepEqual([...qualityIds].sort(), [...reviewedIds].sort());
  assert.equal(eligibilityTombstones + qualityTombstones, 379);
});
