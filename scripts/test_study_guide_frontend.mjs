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
  assert.match(source, /code: payload\.code/);
  assert.match(source, /retryAfterSeconds: Number\(payload\.retryAfterSeconds\)/);
  assert.match(binding, /classical_first_read_required/);
  assert.match(binding, /classical_annotated_reading_required/);
});

test("study-guide catalog failure is isolated from core textbook startup", () => {
  const init = section("async function init()", "init();");
  assert.match(init, /fetchJson\("data\/study-guide-catalog\.json"[\s\S]*\.catch\(\(\) => null\)/);
  assert.doesNotMatch(init, /\|\| studyGuideCatalog\?\.schemaVersion !==/);
  assert.match(init, /state\.studyGuideCatalogStatus = "unavailable"/);
  const rendering = section("function renderStudyGuideCards", "function appendFirstReadCorrections");
  assert.match(rendering, /學案知能清算資料暫時無法載入/);
});

test("study-guide completion fails closed while the catalog is unavailable", () => {
  const body = section("function studyGuideCompletedFor", "function progressPercent");
  assert.match(body, /state\.studyGuideCatalogStatus !== "available"\) return false/);
  assert.ok(
    body.indexOf("studyGuideCatalogStatus") < body.indexOf("if (!active.length) return true"),
    "catalog availability must be checked before accepting an empty active set",
  );
});

test("AI interaction feedback is accepted only with a durable My evidence receipt", () => {
  const decision = section("function interactionEvidenceDecision", "async function submitInteraction");
  assert.match(decision, /normalized === "anonymous"[\s\S]*accepted: false/);
  const submission = section("async function submitInteraction", "function bindCheckStage");
  assert.match(submission, /authenticated_evaluation_required/);
  assert.match(submission, /請先登入 My/);
  assert.match(submission, /learning_submission_in_progress/);
  assert.match(submission, /retryAfterSeconds/);
  assert.match(submission, /interactionMutationIds\.get\(mutationKey\)/);
  assert.match(submission, /interactionMutationIds\.set\(mutationKey, clientMutationId\)/);
  assert.match(submission, /interactionMutationIds\.delete\(mutationKey\)/);
});
