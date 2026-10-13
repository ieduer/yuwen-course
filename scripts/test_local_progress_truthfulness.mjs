import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const APP_PATH = new URL("../site/assets/app.js", import.meta.url);
const INDEX_PATH = new URL("../site/index.html", import.meta.url);
const MANIFEST_PATH = new URL("../site/data/manifest.json", import.meta.url);
const LEARNING_MANIFEST_PATH = new URL("../site/data/learning-manifest.json", import.meta.url);
const source = await readFile(APP_PATH, "utf8");
const indexHtml = await readFile(INDEX_PATH, "utf8");
const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
const learningManifest = JSON.parse(await readFile(LEARNING_MANIFEST_PATH, "utf8"));

function section(start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing ${start}`);
  assert.notEqual(endIndex, -1, `missing ${end}`);
  return source.slice(startIndex, endIndex);
}

function namedFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing function ${name}`);
  const parametersOpen = source.indexOf("(", start);
  let parametersDepth = 0;
  let parametersClose = -1;
  for (let index = parametersOpen; index < source.length; index += 1) {
    if (source[index] === "(") parametersDepth += 1;
    if (source[index] !== ")") continue;
    parametersDepth -= 1;
    if (parametersDepth === 0) {
      parametersClose = index;
      break;
    }
  }
  assert.notEqual(parametersClose, -1, `unterminated parameters ${name}`);
  const open = source.indexOf("{", parametersClose);
  assert.notEqual(open, -1, `missing function body ${name}`);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] !== "}") continue;
    depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  assert.fail(`unterminated function ${name}`);
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
const loadSource = section("function normalizeInterruptedStudyGuideSubmissions", "function saveStoredProgress");

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

test("hydration pauses writes and binds progress only after stable owner verification", () => {
  const hydrateSource = section("async function hydrateSharedStateOnce", "function flushSharedState");
  const unknownSessionIndex = hydrateSource.indexOf('typeof session.authenticated !== "boolean"');
  const anonymousIndex = hydrateSource.indexOf("setProgressOwnerScope(ANONYMOUS_UI_SCOPE)");
  const anonymousResolvedIndex = hydrateSource.indexOf("setInteractionIdentityResolved(true,", anonymousIndex);
  const pauseIndex = hydrateSource.indexOf("setInteractionIdentityResolved(false, { preserveSessions })");
  const sessionIndex = hydrateSource.indexOf("identity.getSession");
  const discoveryIndex = hydrateSource.indexOf('identity.api("/api/yw/v1/state")');
  const hydratedIndex = hydrateSource.indexOf("if (!hydrated.ok)");
  const ownerIndex = hydrateSource.indexOf("setProgressOwnerScope(ownerScope)");
  const ownerResolvedIndex = hydrateSource.indexOf("setInteractionIdentityResolved(true,", ownerIndex);

  assert.ok(unknownSessionIndex > -1);
  assert.ok(anonymousIndex > unknownSessionIndex);
  assert.ok(anonymousResolvedIndex > anonymousIndex, "anonymous owner scope must bind before identity becomes interactive");
  assert.ok(pauseIndex >= 0 && pauseIndex < sessionIndex, "writes pause before the first asynchronous identity check");
  assert.match(hydrateSource, /if \(discovery.ownerScope !== previousOwnerScope\) setProgressOwnerScope\(null\)/);
  assert.ok(hydratedIndex > discoveryIndex);
  assert.ok(ownerIndex > hydratedIndex, "new owner scope must bind only after client re-verification succeeds");
  assert.ok(ownerResolvedIndex > ownerIndex, "authenticated owner scope must bind before identity becomes interactive");
  assert.match(
    hydrateSource,
    /api:\s*\(path, options\)\s*=>\s*waitForSharedStateIdentity\(\s*\(\)\s*=>\s*identity\.api\(path, options\)/,
    "owner rechecks and mutation receipts must use the same bounded identity request",
  );
});

function sharedStateIdentityTimeoutHarness(identity) {
  const waitSource = namedFunction("waitForSharedStateIdentity");
  const hydrateSource = `async ${namedFunction("hydrateSharedStateOnce")}`;
  const timers = [];
  const controls = new Function(
    "deps",
    `const window = { BdfzIdentity: deps.identity };
     let sharedStateHydrationEpoch = 0;
     let progressOwnerScope = null;
     let sharedStateClient = null;
     let sharedStateClientIdentity = null;
     const ANONYMOUS_UI_SCOPE = "anonymous-v2";
     const SHARED_STATE_IDENTITY_TIMEOUT_MS = 1;
     const setTimeout = deps.setTimeout;
     const clearTimeout = deps.clearTimeout;
     const setAuthenticatedState = deps.noop;
     const setInteractionIdentityResolved = deps.noop;
     const setProgressOwnerScope = deps.noop;
     const loadSharedStateModule = async () => ({
       normalizeSharedStateResponse: () => null,
     });
     ${waitSource}
     ${hydrateSource}
     return { hydrate: () => hydrateSharedStateOnce(0) };`,
  )({
    identity,
    noop() {},
    setTimeout(callback, delay) {
      const timer = { callback, delay, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeout(timer) {
      if (timer) timer.cleared = true;
    },
  });
  return { controls, timers };
}

test("a never-settling identity session request times out as retryable hydration", async () => {
  const harness = sharedStateIdentityTimeoutHarness({
    getSession: () => new Promise(() => {}),
    api: async () => null,
  });
  const hydration = harness.controls.hydrate();
  assert.equal(harness.timers.length, 1);
  harness.timers[0].callback();
  assert.equal(await hydration, "retry");
  assert.equal(harness.timers[0].cleared, true);
});

test("a never-settling owner discovery request times out as retryable hydration", async () => {
  let stateReads = 0;
  const harness = sharedStateIdentityTimeoutHarness({
    getSession: async () => ({ authenticated: true }),
    api: () => {
      stateReads += 1;
      return new Promise(() => {});
    },
  });
  const hydration = harness.controls.hydrate();
  for (let turn = 0; turn < 20 && stateReads === 0; turn += 1) await Promise.resolve();
  assert.equal(stateReads, 1);
  const discoveryTimer = harness.timers.find((timer) => !timer.cleared);
  assert.ok(discoveryTimer, "owner discovery must have an active bounded timer");
  discoveryTimer.callback();
  assert.equal(await hydration, "retry");
  assert.equal(discoveryTimer.cleared, true);
});

test("a hanging shared-state module times out and the next attempt uses a fresh URL", async () => {
  const loaderSource = namedFunction("loadSharedStateModule");
  const timers = [];
  const urls = [];
  let imports = 0;
  const controls = new Function(
    "deps",
    `let sharedStateModulePromise = null;
     let sharedStateModuleAttempt = 0;
     const SHARED_STATE_MODULE_URL = "https://yw.bdfz.net/assets/yw-shared-state.js?v=test";
     const SHARED_STATE_MODULE_TIMEOUT_MS = 1;
     const importSharedStateModule = deps.importSharedStateModule;
     const setTimeout = deps.setTimeout;
     const clearTimeout = deps.clearTimeout;
     ${loaderSource}
     return { load: loadSharedStateModule, pending: () => sharedStateModulePromise };`,
  )({
    importSharedStateModule(url) {
      urls.push(url);
      imports += 1;
      return imports === 1 ? new Promise(() => {}) : Promise.resolve({ ready: true });
    },
    setTimeout(callback) {
      const timer = { callback, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeout(timer) {
      if (timer) timer.cleared = true;
    },
  });

  const first = controls.load();
  assert.equal(urls.length, 1);
  timers[0].callback();
  assert.equal(await first, null);
  assert.equal(controls.pending(), null, "timeout must release the cached pending promise");
  assert.deepEqual(await controls.load(), { ready: true });
  assert.equal(urls.length, 2);
  assert.notEqual(urls[0], urls[1]);
  assert.match(urls[1], /[?&]retry=1$/);
});

test("shared-state hydration retries in-place after a retryable failure", async () => {
  const retrySource = [
    namedFunction("clearSharedStateRetry"),
    namedFunction("scheduleSharedStateRetry"),
    namedFunction("flushSharedState"),
  ].join("\n");
  const timers = [];
  let hydrationCalls = 0;
  const controls = new Function(
    "deps",
    `let sharedStateRefreshPromise = null;
     let sharedStateRefreshRequested = false;
     let sharedStateHydrationEpoch = 0;
     let sharedStateRetryTimer = null;
     let sharedStateRetryAttempt = 0;
     const SHARED_STATE_RETRY_DELAYS_MS = [1, 2, 3, 4];
     const hydrateSharedStateOnce = deps.hydrateSharedStateOnce;
     const setTimeout = deps.setTimeout;
     const clearTimeout = deps.clearTimeout;
     ${retrySource}
     return {
       flush: flushSharedState,
       pending: () => sharedStateRefreshPromise,
       retryAttempt: () => sharedStateRetryAttempt,
     };`,
  )({
    async hydrateSharedStateOnce() {
      hydrationCalls += 1;
      return hydrationCalls === 1 ? "retry" : "ok";
    },
    setTimeout(callback, delay) {
      const timer = { callback, delay, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeout(timer) {
      if (timer) timer.cleared = true;
    },
  });

  await controls.flush();
  assert.equal(hydrationCalls, 1);
  assert.equal(controls.pending(), null, "retryable hydration must release the active refresh promise");
  const retry = timers.find((timer) => !timer.cleared);
  assert.ok(retry, "retryable hydration failure must schedule a same-page retry");
  retry.callback();
  await Promise.resolve();
  await controls.pending();
  assert.equal(hydrationCalls, 2);
  assert.equal(controls.retryAttempt(), 0, "successful hydration resets the bounded retry budget");

  const hydrateSource = section("async function hydrateSharedStateOnce", "function clearSharedStateRetry");
  assert.match(hydrateSource, /requestStillCurrent/);
  assert.match(hydrateSource, /identity !== window\.BdfzIdentity/);
  assert.match(hydrateSource, /client !== sharedStateClient/);
});

test("first-read sessions are visible only inside their resolved owner scope", () => {
  const helperSource = section("function activeFirstReadOwnerScope", "function invalidateFirstReadSessions");
  const state = { firstReads: new Map() };
  const controls = new Function(
    "state",
    `let interactionIdentityResolved = false;
     let progressOwnerScope = "owner-a";
     ${helperSource}
     return {
       get: firstReadForLesson,
       current: firstReadCallbackIsCurrent,
       setIdentity: (value) => { interactionIdentityResolved = value; },
       setOwner: (value) => { progressOwnerScope = value; },
     };`,
  )(state);
  const sessionA = { ownerScope: "owner-a", summary: "owner-a-private" };
  state.firstReads.set("lesson-1474", sessionA);
  assert.equal(controls.get("lesson-1474"), null, "unresolved identity must hide a cached private session");
  controls.setIdentity(true);
  assert.equal(controls.get("lesson-1474"), sessionA);
  assert.equal(controls.current("lesson-1474", sessionA), false, "a background lesson is never current");
  controls.setOwner(null);
  assert.equal(controls.get("lesson-1474"), null);
  controls.setOwner("owner-b");
  assert.equal(controls.get("lesson-1474"), null, "owner B must not see owner A's first-read state");
});

test("first-read authority loading is identity-gated and stale loads cannot enter the cache", () => {
  const showLessonSource = section("async function showLesson", "function fieldValue");
  assert.match(showLessonSource, /readAuthority: Boolean\([\s\S]*interactionIdentityResolved[\s\S]*firstReadOwnerScope !== ANONYMOUS_UI_SCOPE/);
  assert.match(showLessonSource, /fallbackAuthMode:[\s\S]*ANONYMOUS_UI_SCOPE[\s\S]*\? "local"[\s\S]*: "offline"/);
  assert.match(showLessonSource, /authorityGeneration !== firstReadAuthorityGeneration/);
  assert.match(showLessonSource, /firstReadOwnerScope !== activeFirstReadOwnerScope\(\)/);
  assert.ok(
    showLessonSource.indexOf("authorityGeneration !== firstReadAuthorityGeneration")
      < showLessonSource.indexOf("state.firstReads.set(id, firstRead)"),
    "owner/generation guards must run before a private session enters the cache",
  );
});

test("a stale first-read callback invalidates same-owner cache and reloads the visible lesson", async () => {
  const helperSource = namedFunction("invalidateStaleFirstReadAuthority");
  const stale = { ownerScope: "owner-a", submitted: false };
  const replacement = { ownerScope: "owner-a", submitted: false };
  const state = {
    current: { id: "lesson-1474" },
    firstReads: new Map([["lesson-1474", replacement]]),
  };
  const queued = [];
  const calls = { renders: 0, reloads: 0 };
  const controls = new Function(
    "state",
    "deps",
    `let firstReadAuthorityGeneration = 4;
     let ownerScope = "owner-a";
     const activeFirstReadOwnerScope = () => ownerScope;
     const renderLesson = () => { deps.calls.renders += 1; };
     const queueMicrotask = (callback) => deps.queued.push(callback);
     const showLesson = async () => { deps.calls.reloads += 1; };
     ${helperSource}
     return {
       invalidate: invalidateStaleFirstReadAuthority,
       setOwner: (owner) => { ownerScope = owner; },
     };`,
  )(state, { queued, calls });
  assert.equal(controls.invalidate("lesson-1474", stale, "owner-a"), true);
  assert.equal(state.firstReads.has("lesson-1474"), false);
  assert.equal(calls.renders, 1);
  assert.equal(queued.length, 1);
  queued.shift()();
  await Promise.resolve();
  assert.equal(calls.reloads, 1);

  state.firstReads.set("lesson-1474", { ownerScope: "owner-b" });
  controls.setOwner("owner-b");
  assert.equal(controls.invalidate("lesson-1474", stale, "owner-a"), false);
  assert.equal(state.firstReads.get("lesson-1474").ownerScope, "owner-b");

  const controller = await readFile(new URL("../site/assets/classical-first-read.js", import.meta.url), "utf8");
  assert.match(controller, /handlers\.onStale\?\.\(session\)/);
  const annotated = section("async function completeAnnotatedReading", "function absoluteResourceUrl");
  assert.match(annotated, /invalidateStaleFirstReadAuthority\(lesson\.id, session, ownerScope\)/);
});

test("owner-scoped persistence failure is contained and cannot abort a committed UI transition", () => {
  const saveSource = namedFunction("saveStoredProgress");
  const saveStoredProgress = new Function(
    "localStorage",
    "progressOwnerScope",
    "interactionIdentityResolved",
    "scopedUiStorageKey",
    "PROGRESS_KEY",
    "progressSnapshotForStorage",
    "state",
    `${saveSource}; return saveStoredProgress;`,
  )(
    { setItem() { throw new DOMException("quota", "QuotaExceededError"); } },
    "owner-a",
    true,
    scopedUiStorageKey,
    PROGRESS_KEY,
    (progress) => progress,
    { progress: { "lesson-1474": { firstRead: { done: true } } } },
  );
  assert.doesNotThrow(() => saveStoredProgress());
  assert.equal(saveStoredProgress(), false);
});

const saveEvaluationSource = section("async function saveEvaluation", "function bindCheckStage");

function evaluationHarness(evidence, { identityResolved = true, submissionMode = "formal" } = {}) {
  const state = { current: { id: "lesson-1" }, progress: { "lesson-1": {} } };
  const calls = { saved: 0, synced: 0, toasts: [] };
  const lessonProgress = (id = state.current?.id) => (state.progress[id] ||= {});
  const saveEvaluation = new Function(
    "els",
    "lessonProgress",
    "fieldValue",
    "syncProgress",
    "recordLearningForLesson",
    "saveStoredProgress",
    "toast",
    "state",
    "progressOwnerScope",
    "interactionIdentityResolved",
    "interactionSubmissionMode",
    `${saveEvaluationSource}; return saveEvaluation;`,
  )(
    { checkStage: { querySelector: () => null } },
    lessonProgress,
    () => "理由",
    () => { calls.synced += 1; },
    async (...args) => typeof evidence === "function" ? evidence(...args) : evidence,
    () => { calls.saved += 1; return true; },
    (message) => calls.toasts.push(message),
    state,
    "owner-a",
    identityResolved,
    () => submissionMode,
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

test("out-of-order evaluation responses cannot overwrite the newest local rating", async () => {
  let resolveFirst;
  let resolveSecond;
  let call = 0;
  const firstEvidence = new Promise((resolve) => { resolveFirst = resolve; });
  const secondEvidence = new Promise((resolve) => { resolveSecond = resolve; });
  const harness = evaluationHarness(() => {
    call += 1;
    return call === 1 ? firstEvidence : secondEvidence;
  });
  const first = harness.saveEvaluation(20, { reason: "第一個評價" });
  const second = harness.saveEvaluation(85, { reason: "較新的評價" });
  resolveSecond({ ok: true, status: 200 });
  await second;
  resolveFirst({ ok: false, status: 503, reason: "unavailable" });
  await first;
  assert.equal(harness.state.progress["lesson-1"].evaluation.rating, 85);
  assert.equal(harness.state.progress["lesson-1"].evaluation.synced, true);

  const binding = section("$$('[data-interest-slider]'", "$$('[data-quiz-option]'");
  assert.match(binding, /clearTimeout\(saveEvaluation\.timer\)/);
  assert.match(binding, /evaluationSaveAttempt/);
  const reasonBinding = section("const reason = els.checkStage.querySelector", "function openLexicon");
  assert.match(reasonBinding, /String\(liveRating\) !== String\(rating\)/);
  assert.match(reasonBinding, /reason\.value !== evaluationReason/);
});

test("identity-pending mutations perform zero storage writes and zero evidence posts", async () => {
  assert.match(source, /let progressOwnerScope = null/);
  const saveSource = namedFunction("saveStoredProgress");
  let storageWrites = 0;
  const saveStoredProgress = new Function(
    "localStorage",
    "progressOwnerScope",
    "interactionIdentityResolved",
    "scopedUiStorageKey",
    "PROGRESS_KEY",
    "progressSnapshotForStorage",
    "state",
    `${saveSource}; return saveStoredProgress;`,
  )(
    { setItem() { storageWrites += 1; } },
    "owner-a",
    false,
    scopedUiStorageKey,
    PROGRESS_KEY,
    (progress) => progress,
    { progress: { lesson: { read: { done: true } } } },
  );
  assert.equal(saveStoredProgress(), false);
  assert.equal(storageWrites, 0);

  let evidencePosts = 0;
  const recordSource = namedFunction("recordLearningForLesson");
  const recordLearningForLesson = new Function(
    "window",
    "learningMutationOwnerResolved",
    `${recordSource}; return recordLearningForLesson;`,
  )(
    { YwLearningEvidence: { record() { evidencePosts += 1; } } },
    () => false,
  );
  assert.equal((await recordLearningForLesson("evaluation", "lesson-1")).reason, "identity-unavailable");
  assert.equal(evidencePosts, 0);

  const pendingEvaluation = evaluationHarness({ ok: true }, { identityResolved: false });
  const result = await pendingEvaluation.saveEvaluation(75);
  assert.equal(result.savedLocal, false);
  assert.equal(pendingEvaluation.state.progress["lesson-1"].evaluation, undefined);
  assert.equal(pendingEvaluation.calls.synced, 0);

  const renderSource = namedFunction("renderCheckStage");
  assert.match(renderSource, /identityNoticeMode === "pending" \? "inert aria-disabled/);
  const vocabBinding = section("$$('[data-quiz-option]'", "$$('[data-quiz-lookup]'");
  assert.ok(
    vocabBinding.indexOf("learningMutationOwnerResolved(ownerScope)")
      < vocabBinding.indexOf("const progress = lessonProgress(lessonId)"),
    "vocabulary must reject pending identity before creating mutable quiz state",
  );
});

test("anonymous unpublished evaluation stays local while formal evaluation remains login-gated", async () => {
  const local = evaluationHarness({ ok: true }, { submissionMode: "local" });
  const localResult = await local.saveEvaluation(67);
  assert.equal(localResult.savedLocal, true);
  assert.equal(localResult.synced, false);
  assert.equal(local.state.progress["lesson-1"].evaluation.evidenceStatus, "local_practice");
  assert.equal(local.calls.synced, 1);

  const loginRequired = evaluationHarness({ ok: true }, { submissionMode: "login_required" });
  const loginResult = await loginRequired.saveEvaluation(67);
  assert.equal(loginResult.savedLocal, false);
  assert.equal(loginRequired.state.progress["lesson-1"].evaluation, undefined);
  assert.equal(loginRequired.calls.synced, 0);
});

test("local completion labels do not claim formative mastery", () => {
  assert.match(indexHtml, /本機步驟完成度/);
  assert.match(indexHtml, /id="mastery-label"/);
  assert.doesNotMatch(indexHtml, /本課掌握度/);
  assert.doesNotMatch(source, /已掌握/);
  assert.match(source, /本機已存／尚未同步/);
  assert.match(source, /本機試做 · 未記錄/);
  assert.match(source, /不進入 User Center 的 A–F 評價/);
});

test("identity-pending learning UI never claims that local practice can be saved", () => {
  const noticeModeSource = namedFunction("learningIdentityNoticeMode");
  const learningIdentityNoticeMode = new Function(
    "ANONYMOUS_UI_SCOPE",
    `${noticeModeSource}; return learningIdentityNoticeMode;`,
  )(ANONYMOUS_UI_SCOPE);
  assert.equal(learningIdentityNoticeMode(false, ANONYMOUS_UI_SCOPE), "pending");
  assert.equal(learningIdentityNoticeMode(false, null), "pending");
  assert.equal(learningIdentityNoticeMode(true, ANONYMOUS_UI_SCOPE), "anonymous");
  assert.equal(learningIdentityNoticeMode(true, "owner-a"), "authenticated");

  const renderSource = namedFunction("renderCheckStage");
  assert.match(renderSource, /identityNoticeMode === "pending"/);
  assert.match(renderSource, /身份與學情歸屬確認前，本頁作答不會保存或送出/);
});

const interactionEvidenceDecisionSource = section(
  "function interactionEvidenceDecision",
  "async function submitInteraction",
);
const interactionEvidenceDecision = new Function(
  `${interactionEvidenceDecisionSource}; return interactionEvidenceDecision;`,
)();

test("a new anonymous interaction cannot be accepted as evaluation evidence", () => {
  assert.deepEqual(interactionEvidenceDecision("anonymous", 98), {
    accepted: false,
    recorded: false,
    completed: false,
    evidenceStatus: "unavailable",
  });
});

test("anonymous scope cannot advance any visible completion checkpoint", () => {
  const checkpointSource = section("function checkpointDone", "function studyGuideProgress");
  assert.match(checkpointSource, /!progressOwnerScope \|\| progressOwnerScope === ANONYMOUS_UI_SCOPE/);
  assert.ok(
    checkpointSource.indexOf("progressOwnerScope === ANONYMOUS_UI_SCOPE")
      < checkpointSource.indexOf('if (key === "firstRead")'),
  );
});

test("recorded interaction completes only after a passing score", () => {
  assert.equal(interactionEvidenceDecision("enqueued", 98).completed, true);
  assert.equal(interactionEvidenceDecision("pending", 59).completed, false);
  assert.equal(interactionEvidenceDecision("already_recorded", 88).completed, true);
  assert.equal(interactionEvidenceDecision("already_recorded_ineligible", 99).completed, false);
  assert.equal(interactionEvidenceDecision("unknown", 100).accepted, false);
});

test("expanded formal authority includes required volumes while unknown controls remain local", () => {
  const authorityFunctions = [
    namedFunction("formalInteractionResourceKeys"),
    namedFunction("isFormalInteraction"),
  ].join("\n");
  const authority = new Function(
    `${authorityFunctions}; return { formalInteractionResourceKeys, isFormalInteraction };`,
  )();
  const resourceKeys = authority.formalInteractionResourceKeys(learningManifest);
  const expectedKeys = new Set(learningManifest.items
    .filter((item) => item.sourceKind === "lesson-interaction" && item.lifecycleStatus === "active")
    .map((item) => `${item.sourceId}\n${item.questionKind}`));
  assert.ok(resourceKeys instanceof Set);
  assert.deepEqual([...resourceKeys].sort(), [...expectedKeys].sort());
  assert.equal(authority.isFormalInteraction(resourceKeys, "lesson-1727", "structure"), true);
  assert.equal(authority.isFormalInteraction(resourceKeys, "lesson-1727", "authorQuestion"), true);
  assert.equal(authority.isFormalInteraction(resourceKeys, "lesson-1497", "structure"), true);
  assert.equal(authority.isFormalInteraction(resourceKeys, "lesson-1497", "authorQuestion"), true);

  const initSource = section("async function init", "init();");
  assert.match(
    initSource,
    /state\.formalInteractionResourceKeys\s*=\s*formalInteractionResourceKeys\(\s*learningManifest\s*\)/,
  );
  const modeSource = namedFunction("interactionSubmissionMode");
  const pendingIdentityIndex = modeSource.indexOf("!interactionIdentityResolved");
  const localAuthorityIndex = modeSource.indexOf("!isFormalInteraction");
  assert.ok(pendingIdentityIndex >= 0, "local practice must wait for identity ownership");
  assert.ok(
    localAuthorityIndex > pendingIdentityIndex,
    "identity ownership must resolve before an unpublished question becomes local practice",
  );
  assert.match(
    modeSource,
    /isFormalInteraction\(state\.formalInteractionResourceKeys,\s*lesson\?\.id,\s*interactionKey\)/,
  );
  const submissionSource = section("async function submitInteraction", "async function saveReadingSubmission");
  const localDecisionIndex = submissionSource.indexOf("interactionSubmissionMode(");
  const requestIndex = submissionSource.indexOf('fetch("/api/interaction-check"');
  assert.ok(localDecisionIndex >= 0, "submission must consult formal interaction authority");
  assert.ok(requestIndex > localDecisionIndex, "local-practice decision must happen before network evaluation");
  const localPracticeBranch = submissionSource.slice(localDecisionIndex, requestIndex);
  assert.match(localPracticeBranch, /saveLocalInteractionPractice\(/);
  assert.match(localPracticeBranch, /return/);
  const localSaveSource = namedFunction("saveLocalInteractionPractice");
  assert.match(localSaveSource, /!interactionIdentityResolved\s*\|\|\s*!progressOwnerScope/);
  assert.match(localSaveSource, /本次試做未保存/);
  assert.match(localSaveSource, /lessonProgress\(/);
  assert.match(localSaveSource, /本機(?:試做|練習)/);
  assert.doesNotMatch(localSaveSource, /恢復連線|連線失敗|同步失敗/);
});

test("local-practice completion never emits hidden lesson-completed learning evidence", async () => {
  const completionSource = namedFunction("completionEventEligible");
  const syncSource = namedFunction("syncProgress");
  const progress = {
    context: { done: true, evidenceStatus: "local_practice" },
    read: { done: true },
  };
  const calls = { learning: 0, saved: 0 };
  const trackFor = () => [["context"], ["read"]];
  const checkpointDone = (current, key) => Boolean(current[key]?.done);
  const completionEventEligible = new Function(
    "trackFor",
    "checkpointDone",
    "state",
    "lessonProgress",
    `${completionSource}; return completionEventEligible;`,
  )(trackFor, checkpointDone, { current: { id: "lesson-local" } }, () => progress);
  assert.equal(completionEventEligible(progress, { id: "lesson-local" }), false);

  const syncProgress = new Function(
    "saveStoredProgress",
    "state",
    "renderMastery",
    "renderLessonIndex",
    "renderMatrix",
    "progressPercent",
    "lessonProgress",
    "completionEventEligible",
    "recordLearningForLesson",
    "trackFor",
    "checkpointDone",
    "progressOwnerScope",
    "learningMutationOwnerResolved",
    `${syncSource}; return syncProgress;`,
  )(
    () => { calls.saved += 1; },
    { current: { id: "lesson-local" }, manifest: {} },
    () => {},
    () => {},
    () => {},
    () => 100,
    () => progress,
    completionEventEligible,
    async () => { calls.learning += 1; return { ok: true }; },
    trackFor,
    checkpointDone,
    "owner-local",
    () => true,
  );
  syncProgress({ event: true });
  await Promise.resolve();
  assert.equal(calls.learning, 0);
  assert.equal(progress.completionEventSent, undefined);
});

test("student lesson count and startup exclude hidden system records", () => {
  const retiredSource = section("function isRetiredMirror", "function genreFor");
  const studentLessonsSource = section("function studentVisibleLessons", "function visibleLessons");
  const studentVisibleLessons = new Function(
    "state",
    "lessonTitle",
    `${retiredSource}\n${studentLessonsSource}\nreturn studentVisibleLessons;`,
  )(
    { manifest },
    (lesson) => String(lesson?.title || lesson?.sourceTitle || ""),
  );
  const visible = studentVisibleLessons();

  assert.equal(manifest.lessons.length, 191);
  assert.equal(visible.length, 189);
  assert.deepEqual(
    manifest.lessons.filter((lesson) => !visible.some((entry) => entry.id === lesson.id)).map((lesson) => lesson.id),
    ["lesson-11637", "lesson-11705"],
  );

  const indexSource = section("function renderLessonIndex", "function removeUnwantedSourceNodes");
  assert.match(indexSource, /const allIds = studentVisibleLessons\(\)\.map/);
  const initSource = section("async function init", "init\(\);");
  assert.match(initSource, /atlasStatus\.textContent = `\$\{studentLessons\.length\} 篇 · 五冊教材`/);
  assert.match(initSource, /const initial = studentLessons\.find/);
  assert.match(initSource, /\|\| studentLessons\[0\]/);
  const anonymousSource = section("async function applyAnonymousSharedState", "async function hydrateSharedStateOnce");
  assert.match(anonymousSource, /const requestedLessonId = location\.hash\.slice\(1\)/);
  assert.match(anonymousSource, /const hashLessonId = studentVisibleLessons\(\)\.find/);
  assert.match(anonymousSource, /const storedStudentLessonId = studentVisibleLessons\(\)\.find/);
  assert.match(anonymousSource, /const lessonId = hashLessonId \|\| storedStudentLessonId/);
  const appHash = createHash("sha256").update(source).digest("hex").slice(0, 16);
  assert.ok(indexHtml.includes(`assets/app.js?v=${appHash}`));
  assert.doesNotMatch(indexHtml, /assets\/app\.js\?v=20260811-(?:embed-scroll-layout-v4|student-units-v5)/);
});

test('scope expansion never auto-evaluates an unchanged saved local answer',async()=>{
 const old={words:'寂靜、自由、惆悵',done:true,score:null,evidenceStatus:'local_practice',result:{verdict:'舊本機練習'}};
 const progress={context:structuredClone(old)},state={current:{id:'lesson-1717-p2'}};let calls=0;
 const deps={state,progressOwnerScope:'owner',interactionInput:()=>({words:old.words}),els:{checkStage:{querySelector:()=>null}},interactionSubmissionMode:()=> 'formal',lessonProgress:()=>progress,interactionInputSignature:JSON.stringify,toast:()=>{},fetch:()=>{calls++;throw Error('must not evaluate historical local work');}};
 const submit=new Function(...Object.keys(deps),`async ${namedFunction('submitInteraction')};return submitInteraction;`)(...Object.values(deps));
 await submit('contextWords',null,{silent:true});assert.equal(calls,0);assert.deepEqual(progress.context,old);
});

test('scope expansion preserves old self-rating and only records a newly changed rating',async()=>{
 let posts=0;const harness=evaluationHarness(()=>{posts++;return {ok:true,status:200};});
 const old={rating:60,reason:'理由',done:true,synced:false,evidenceStatus:'local_practice'};
 harness.state.progress['lesson-1'].evaluation=structuredClone(old);
 const same=await harness.saveEvaluation(60);assert.equal(same.reason,'historical_local_practice_preserved');assert.equal(posts,0);assert.deepEqual(harness.state.progress['lesson-1'].evaluation,old);
 await harness.saveEvaluation(75);assert.equal(posts,1);assert.deepEqual(harness.state.progress['lesson-1'].evaluation.historicalPractice,[old]);
});

function localPracticeEditHarness(key, record, { pendingResponse = false } = {}) {
  const lessonId = 'lesson-1717-p2', owner = 'practice-owner';
  const progressKey = key === 'contextWords' ? 'context' : key;
  const fieldKey = {contextWords:'words',authorQuestion:'answer',structure:'reason'}[key];
  const localStorage = storage({[scopedUiStorageKey(PROGRESS_KEY, owner)]:JSON.stringify({[lessonId]:{[progressKey]:record}})});
  const progress = makeProgressLoader(localStorage, owner)()[lessonId];
  const state = {current:{id:lessonId},interactionRequestsInFlight:new Set(),pendingReplayAttempted:new Set()};
  const fields = key === 'contextWords'
    ? String(progress[progressKey].words).split('、').map((value,i)=>({value,dataset:{field:`context.word${i+1}`},isConnected:true,listeners:{}}))
    : [{value:progress[progressKey][fieldKey],dataset:{field:`${progressKey}.${fieldKey}`},isConnected:true,listeners:{}}];
  const button = {dataset:{aiCheck:key},isConnected:true,listeners:{}}, timers=[], requests=[], assessments=[];
  const input = () => ({[fieldKey]:key==='contextWords'?fields.map(f=>f.value.trim()).filter(Boolean).join('、'):fields[0].value.trim()});
  const deps = {
    state,progressOwnerScope:owner,els:{checkStage:{querySelector:()=>null}},
    $$:selector=>selector.includes('data-context-word')?(key==='contextWords'?fields:[]):selector.includes('data-ai-check')?(key==='contextWords'?[]:[button]):(key==='contextWords'?[]:fields),
    listen:(element,type,handler)=>{element.listeners[type]=handler;},learningMutationOwnerResolved:()=>true,
    lessonProgress:()=>progress,interactionInput:input,interactionSubmissionMode:()=> 'formal',toast:()=>{},
    saveStoredProgress:()=>{localStorage.setItem(scopedUiStorageKey(PROGRESS_KEY,owner),JSON.stringify({[lessonId]:progress}));return true;},
    window:{YwLearningEvidence:{mutationId:()=>`new-${key}-mutation`}},
    setTimeout:(callback,delay)=>{const timer={callback,delay,cleared:false};timers.push(timer);return timer;},clearTimeout:timer=>{if(timer)timer.cleared=true;},
    watchEvaluationStatus:async()=>({settle:()=>{}}),resumeDetailedRecords:()=>{},renderCheckStage:()=>{},
    pendingReplayErrorIsRetryable:()=>false,pendingEvaluationRetryDelay:()=>0,
    fetch:async(_url,options)=>{requests.push(JSON.parse(options.body));return {ok:true,status:pendingResponse?202:200,json:async()=>pendingResponse?{status:'pending',code:'learning_evaluation_pending',pendingId:'preserved-pending-id'}:{assessment:{score:88}}};},
    applyInteractionAssessment:value=>{assessments.push(value);},
  };
  const functions = ['preserveLocalPracticeBeforeEdit','interactionInputSignature','interactionInputLength','interactionInputProblem','pendingInteractionInput','pendingInteractionMutation','interactionPendingMatches','interactionRequestKey'].map(namedFunction).join('\n');
  const bindings = section(`  $$('[data-field="structure.reason"], [data-field="authorQuestion.answer"]'`, `  $$('[data-interest-slider]'`);
  const controls = new Function(...Object.keys(deps),`${functions}\nasync ${namedFunction('submitInteraction')}\n${bindings}\nreturn {submit:()=>submitInteraction('${key}',null,{silent:true})};`)(...Object.values(deps));
  return {progress,progressKey,requests,assessments,
    change(value){if(key==='contextWords'){value.split('、').forEach((part,i)=>{fields[i].value=part;});fields[0].listeners.input();}else{fields[0].value=value;fields[0].listeners.input();}},
    async send(){if(key==='contextWords'){for(const timer of timers.filter(t=>t.delay===720&&!t.cleared)){timer.cleared=true;timer.callback();}for(let i=0;i<12;i++)await Promise.resolve();}else await button.listeners.click();},
    submit:controls.submit,
    reloadRecord(){return makeProgressLoader(localStorage,owner)()[lessonId][progressKey];},
  };
}

const practiceExamples = [
  {key:'contextWords',field:'words',old:'寂靜、自由、惆悵',edited:'朦朧、孤獨、暫慰'},
  {key:'authorQuestion',field:'answer',old:'荷塘能否消除作者這幾天心中的不寧靜？',edited:'我想問月光與流水的比喻如何改變眼前景象給人的感受？'},
  {key:'structure',field:'reason',old:'文章開頭與結尾都回到家庭，顯示作者遊覽荷塘後仍未完全擺脫內心的不寧靜。',edited:'開頭的不寧靜和末尾回家的腳步互相呼應，中間對月色的描写只提供暫時的舒展而非徹底解脫。'},
];
const oldPractice = example => ({[example.field]:example.old,done:true,score:null,evidenceStatus:'local_practice',id:'old-local-id',createdAt:'2026-10-01T00:00:00Z',result:{verdict:'舊本機回饋',details:{retained:true}}});

test('real input handlers preserve original local text and Send admits a changed answer for all three affected tasks',async()=>{
  for(const example of practiceExamples){
    const old=oldPractice(example),h=localPracticeEditHarness(example.key,old);
    h.change(example.edited);
    assert.deepEqual(h.progress[h.progressKey].localPracticeBaseline,old,example.key);
    assert.deepEqual(h.reloadRecord().localPracticeBaseline,old,example.key);
    assert.equal(h.requests.length,0,'typing must not synchronously evaluate');
    await h.send();
    assert.equal(h.requests.length,1,example.key);assert.deepEqual(h.requests[0].input,{[example.field]:example.edited});
    assert.equal(h.assessments.length,1);assert.deepEqual(h.progress[h.progressKey].historicalPractice,[old]);
    assert.equal(h.progress[h.progressKey].localPracticeBaseline,undefined);
  }
});

test('unchanged and reverted local practice remains ungraded after input events and a storage reload',async()=>{
  for(const example of practiceExamples){
    const old=oldPractice(example),untouched=localPracticeEditHarness(example.key,old);
    await untouched.submit();assert.equal(untouched.requests.length,0);assert.deepEqual(untouched.reloadRecord(),old);
    const edited=localPracticeEditHarness(example.key,old);edited.change(example.edited);
    const reloaded=localPracticeEditHarness(example.key,edited.reloadRecord());
    assert.equal(reloaded.requests.length,0);reloaded.change(example.old);await reloaded.send();await reloaded.submit();
    assert.equal(reloaded.requests.length,0,example.key);assert.deepEqual(reloaded.reloadRecord().localPracticeBaseline,old);
    assert.equal(reloaded.progress[reloaded.progressKey].evidenceStatus,'local_practice');
  }
});

test('changed drafts survive reload and a pending new assessment resumes its original input and mutation without duplicating history',async()=>{
  for(const example of practiceExamples){
    const old=oldPractice(example),editing=localPracticeEditHarness(example.key,old);editing.change(example.edited);
    const reloaded=localPracticeEditHarness(example.key,editing.reloadRecord(),{pendingResponse:true});
    assert.equal(reloaded.requests.length,0);await reloaded.submit();
    assert.deepEqual(reloaded.progress[reloaded.progressKey].historicalPractice,[old]);
    const resumed=localPracticeEditHarness(example.key,reloaded.reloadRecord());
    assert.equal(resumed.requests.length,0);resumed.change(example.edited+'補充');await resumed.submit();
    assert.equal(resumed.requests.length,1);assert.deepEqual(resumed.requests[0],reloaded.requests[0],example.key);
    assert.deepEqual(resumed.progress[resumed.progressKey].historicalPractice,[old]);
  }
});
