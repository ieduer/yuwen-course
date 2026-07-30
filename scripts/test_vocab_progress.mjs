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
