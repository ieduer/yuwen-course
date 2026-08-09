#!/usr/bin/env node

import assert from "node:assert/strict";
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
