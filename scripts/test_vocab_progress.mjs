#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const MODULE = pathToFileURL(path.resolve(import.meta.dirname, "../site/assets/vocab-progress.js"));
delete globalThis.YwVocabProgress;
await import(`${MODULE.href}?test=${Date.now()}`);

test("a correct answer advances to the next unanswered item in the same lesson", () => {
  const questions = [{ id: "lesson-a:v01" }, { id: "lesson-a:v02" }, { id: "lesson-a:v03" }];
  const answers = {
    "lesson-a:v01": { correct: true },
    "lesson-a:v02": { correct: false },
  };
  assert.equal(globalThis.YwVocabProgress.nextCursor(questions, answers), "lesson-a:v02");
});

test("the final correct answer ends the lesson quiz instead of crossing lessons", () => {
  const questions = [{ id: "lesson-a:v01" }, { id: "lesson-a:v02" }];
  const answers = {
    "lesson-a:v01": { correct: true },
    "lesson-a:v02": { correct: true },
  };
  assert.equal(globalThis.YwVocabProgress.nextCursor(questions, answers), null);
});

test("a scheduled transition is cancelled after the learner switches lessons", () => {
  assert.equal(
    globalThis.YwVocabProgress.canAdvanceScheduledLesson("lesson-b", "lesson-a"),
    false,
  );
  assert.equal(
    globalThis.YwVocabProgress.canAdvanceScheduledLesson("lesson-a", "lesson-a"),
    true,
  );
});

test("wrong then one correct stays on the item until the server reports mastery", () => {
  const wrong = globalThis.YwVocabProgress.applyServerAttempt({}, {
    ok: true,
    status: "learning",
    attemptNo: 1,
    correct: false,
    correctCount: 0,
    wrongCount: 1,
  }, 0);
  assert.deepEqual(
    { correct: wrong.correct, lastAnswerCorrect: wrong.lastAnswerCorrect, wrongCount: wrong.wrongCount },
    { correct: false, lastAnswerCorrect: false, wrongCount: 1 },
  );

  const firstCorrect = globalThis.YwVocabProgress.applyServerAttempt(wrong, {
    ok: true,
    status: "learning",
    attemptNo: 2,
    correct: true,
    correctCount: 1,
    wrongCount: 1,
  }, 2);
  assert.equal(firstCorrect.correct, false);
  assert.equal(firstCorrect.lastAnswerCorrect, true);
  assert.equal(globalThis.YwVocabProgress.nextCursor([{ id: "lesson-a:v01" }], {
    "lesson-a:v01": firstCorrect,
  }), "lesson-a:v01");

  const secondCorrect = globalThis.YwVocabProgress.applyServerAttempt(firstCorrect, {
    ok: true,
    status: "mastered",
    attemptNo: 3,
    correct: true,
    correctCount: 2,
    wrongCount: 1,
  }, 2);
  assert.equal(secondCorrect.correct, true);
  assert.equal(secondCorrect.mastered, false);
  assert.equal(globalThis.YwVocabProgress.nextCursor([{ id: "lesson-a:v01" }], {
    "lesson-a:v01": secondCorrect,
  }), null);
});

test("an unavailable server result never mutates local mastery", () => {
  assert.equal(globalThis.YwVocabProgress.applyServerAttempt(
    { correct: false },
    { ok: false, status: "mastered" },
    1,
  ), null);
});

test("local-only practice mirrors mastery without claiming formal evidence sync", () => {
  const wrong = globalThis.YwVocabProgress.applyLocalPracticeAttempt({}, false, 0);
  const firstCorrect = globalThis.YwVocabProgress.applyLocalPracticeAttempt(wrong, true, 2);
  const mastered = globalThis.YwVocabProgress.applyLocalPracticeAttempt(firstCorrect, true, 2);
  assert.deepEqual(
    {
      firstCorrect: firstCorrect.correct,
      mastered: mastered.correct,
      synced: mastered.synced,
      formalEvidence: mastered.formalEvidence,
    },
    { firstCorrect: false, mastered: true, synced: false, formalEvidence: false },
  );
});

test("expanded authority admits all 723 current questions and retains original answer identities", () => {
  const dataRoot = path.resolve(import.meta.dirname, "../site/data");
  const learningManifest = JSON.parse(fs.readFileSync(
    path.join(dataRoot, "learning-manifest.json"),
    "utf8",
  ));
  const vocabularyIndex = JSON.parse(fs.readFileSync(
    path.join(dataRoot, "vocab/index.json"),
    "utf8",
  ));
  const formalKeys = globalThis.YwVocabProgress.formalVocabularyResourceKeys(learningManifest);
  const counts = globalThis.YwVocabProgress.validateVocabularyAuthority(
    formalKeys,
    vocabularyIndex.activeItemIds,
  );
  const active = Object.entries(vocabularyIndex.activeItemIds).flatMap(([lessonId, itemIds]) =>
    itemIds.map((itemId) => ({ lessonId, itemId }))
  );
  const formal = active.filter(({ lessonId, itemId }) =>
    globalThis.YwVocabProgress.isFormalVocabularyQuestion(formalKeys, lessonId, itemId)
  );
  assert.equal(active.length, 723);
  assert.equal(formal.length, 723);
  assert.equal(active.length - formal.length, 0);
  assert.equal(formalKeys.size, formal.length);
  assert.deepEqual(counts, { active: 723, formal: 723, localPractice: 0 });
});

test("a formal question absent from the active index fails closed", () => {
  assert.throws(
    () => globalThis.YwVocabProgress.validateVocabularyAuthority(
      new Set(["effect:lesson-a:vocab:lesson-a:v02"]),
      { "lesson-a": ["lesson-a:v01"] },
    ),
    /not active/,
  );
});

test('future formal vocabulary attempts preserve prior local practice without crediting its counters',()=>{
  const local=globalThis.YwVocabProgress.applyLocalPracticeAttempt(null,false,2);
  const before=structuredClone(local);
  const formal=globalThis.YwVocabProgress.applyServerAttempt(local,{ok:true,status:'learning',attemptNo:1,wrongCount:1,correctCount:0,correct:false},1);
  assert.deepEqual(local,before);assert.deepEqual(formal.historicalPractice,[before]);
  assert.equal(formal.attempts,1);assert.equal(formal.wrongCount,1);assert.equal(formal.formalEvidence,true);
  const later=globalThis.YwVocabProgress.applyServerAttempt(formal,{ok:true,status:'learning',attemptNo:2,wrongCount:1,correctCount:1,correct:true},0);
  assert.deepEqual(later.historicalPractice,[before]);assert.equal(later.correct,false);
});
