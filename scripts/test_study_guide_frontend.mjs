import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../site/assets/app.js", import.meta.url), "utf8");

function section(start, end) {
  const startAt = source.indexOf(start);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.ok(startAt >= 0 && endAt > startAt, `missing source section ${start}`);
  return source.slice(startAt, endAt);
}

test("local completion is bound to the current semantic revision", () => {
  const body = section("function studyGuideRecordMatches", "function studyGuideCompletedFor");
  const matches = new Function(`${body}; return studyGuideRecordMatches;`)();
  assert.equal(matches({ semanticRevision: "sha256:new" }, { completed: true, semanticRevision: "sha256:new" }), true);
  assert.equal(matches({ semanticRevision: "sha256:new" }, { completed: true, semanticRevision: "sha256:old" }), false);
  assert.equal(matches({ semanticRevision: "sha256:new" }, { completed: false, semanticRevision: "sha256:new" }), false);
});

test("study-guide cards use the authoritative assessment endpoint", () => {
  const binding = section("function studyGuideMutationId", "$$('[data-ai-check]'");
  assert.match(binding, /fetch\("\/api\/reading\/study-guide-attempt"/);
  assert.doesNotMatch(binding, /recordLearning\("studyGuideItemCompleted"/);
  assert.doesNotMatch(source, /data-study-complete/);
  assert.match(binding, /result\.passed === true/);
  assert.match(binding, /eligibilityStatus === "eligible"/);
  const rendering = section("function renderStudyGuideCards", "function appendFirstReadCorrections");
  assert.match(rendering, /current\.qualityNotes\?\.length/);
  assert.match(rendering, /study-guide-quality-notes/);
});

test("an interrupted attempt reuses its mutation and reveal receipt", () => {
  const binding = section("$$('[data-study-response]'", "$$('[data-ai-check]'");
  assert.match(binding, /previous\.pendingSync === true/);
  assert.match(binding, /previous\.clientMutationId/);
  assert.match(binding, /previous\.referenceRevealedAt/);
  assert.match(binding, /pendingSync: result\?\.ok !== true/);
});
