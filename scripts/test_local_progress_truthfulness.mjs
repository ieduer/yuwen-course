import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const APP_PATH = new URL("../site/assets/app.js", import.meta.url);
const INDEX_PATH = new URL("../site/index.html", import.meta.url);
const source = await readFile(APP_PATH, "utf8");
const indexHtml = await readFile(INDEX_PATH, "utf8");

function section(start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing ${start}`);
  assert.notEqual(endIndex, -1, `missing ${end}`);
  return source.slice(startIndex, endIndex);
}

function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    snapshot: () => Object.fromEntries(values),
  };
}

const PROGRESS_KEY = "yw-matrix-progress-v2";
const LEGACY_PROGRESS_KEY = "yw-matrix-progress-v1";
const ANONYMOUS_UI_SCOPE = "anonymous-v2";
const scopedUiStorageKey = (baseKey, scope) => `${baseKey}:scope:${scope}`;
const loadSource = section("function loadStoredProgress", "function saveStoredProgress");

function makeProgressLoader(localStorage, progressOwnerScope = ANONYMOUS_UI_SCOPE) {
  return new Function(
    "localStorage",
    "PROGRESS_KEY",
    "LEGACY_PROGRESS_KEY",
    "ANONYMOUS_UI_SCOPE",
    "progressOwnerScope",
    "scopedUiStorageKey",
    `${loadSource}; return loadStoredProgress;`,
  )(
    localStorage,
    PROGRESS_KEY,
    LEGACY_PROGRESS_KEY,
    ANONYMOUS_UI_SCOPE,
    progressOwnerScope,
    scopedUiStorageKey,
  );
}

test("legacy global progress migrates only to anonymous scope", () => {
  const localStorage = storage({
    [PROGRESS_KEY]: JSON.stringify({ anonymousLesson: { read: { done: true } } }),
    [scopedUiStorageKey(PROGRESS_KEY, "owner-a")]: JSON.stringify({ ownerALesson: { read: { done: true } } }),
  });
  const loadStoredProgress = makeProgressLoader(localStorage);

  assert.deepEqual(Object.keys(loadStoredProgress(ANONYMOUS_UI_SCOPE)), ["anonymousLesson"]);
  assert.deepEqual(Object.keys(loadStoredProgress("owner-a")), ["ownerALesson"]);
  assert.deepEqual(loadStoredProgress("owner-b"), {});
  assert.deepEqual(loadStoredProgress(null), {});
  assert.ok(localStorage.snapshot()[scopedUiStorageKey(PROGRESS_KEY, ANONYMOUS_UI_SCOPE)]);
  assert.equal(localStorage.snapshot()[scopedUiStorageKey(PROGRESS_KEY, "owner-b")], undefined);
});

test("authenticated hydration clears unowned progress until stable owner scope arrives", () => {
  const hydrateSource = section("async function hydrateSharedStateOnce", "function flushSharedState");
  const unknownSessionIndex = hydrateSource.indexOf('typeof session.authenticated !== "boolean"');
  const anonymousIndex = hydrateSource.indexOf("setProgressOwnerScope(ANONYMOUS_UI_SCOPE)");
  const clearIndices = [...hydrateSource.matchAll(/setProgressOwnerScope\(null\)/g)].map((match) => match.index);
  const authenticatedClearIndex = clearIndices.at(-1);
  const discoveryIndex = hydrateSource.indexOf('identity.api("/api/yw/v1/state")');
  const ownerIndex = hydrateSource.indexOf("setProgressOwnerScope(discovery.ownerScope)");

  assert.ok(unknownSessionIndex > -1);
  assert.ok(anonymousIndex > unknownSessionIndex);
  assert.equal(clearIndices.length, 2);
  assert.ok(discoveryIndex > authenticatedClearIndex);
  assert.ok(ownerIndex > discoveryIndex);
});

const saveEvaluationSource = section("async function saveEvaluation", "function bindCheckStage");

function evaluationHarness(evidence) {
  const state = { current: { id: "lesson-1" }, progress: { "lesson-1": {} } };
  const calls = { saved: 0, synced: 0, toasts: [] };
  const lessonProgress = (id = state.current?.id) => (state.progress[id] ||= {});
  const saveEvaluation = new Function(
    "els",
    "lessonProgress",
    "fieldValue",
    "syncProgress",
    "recordLearning",
    "saveStoredProgress",
    "toast",
    "state",
    "progressOwnerScope",
    `${saveEvaluationSource}; return saveEvaluation;`,
  )(
    { checkStage: { querySelector: () => null } },
    lessonProgress,
    () => "理由",
    () => { calls.synced += 1; },
    async () => evidence,
    () => { calls.saved += 1; return true; },
    (message) => calls.toasts.push(message),
    state,
    "owner-a",
  );
  return { saveEvaluation, state, calls };
}

for (const status of [401, 503]) {
  test(`evaluation ${status} remains local and never claims synchronization`, async () => {
    const harness = evaluationHarness({ ok: false, status, reason: status === 401 ? "unauthorized" : "unavailable" });
    const result = await harness.saveEvaluation(72);

    assert.equal(result.synced, false);
    assert.equal(result.savedLocal, true);
    assert.equal(result.status, status);
    assert.equal(harness.state.progress["lesson-1"].evaluation.synced, false);
    assert.match(harness.calls.toasts.at(-1), /本機已存／尚未同步/);
    assert.doesNotMatch(harness.calls.toasts.at(-1), /已同步為/);
  });
}

test("evaluation reports synchronized only after successful evidence response", async () => {
  const harness = evaluationHarness({ ok: true, status: 200 });
  const result = await harness.saveEvaluation(88);

  assert.equal(result.synced, true);
  assert.equal(harness.state.progress["lesson-1"].evaluation.synced, true);
  assert.match(harness.calls.toasts.at(-1), /已同步為 88%/);
});

test("local completion labels do not claim formative mastery", () => {
  assert.match(indexHtml, /本機步驟完成度/);
  assert.doesNotMatch(indexHtml, /本課掌握度/);
  assert.doesNotMatch(source, /已掌握/);
  assert.match(source, /本機已存／尚未同步/);
});
