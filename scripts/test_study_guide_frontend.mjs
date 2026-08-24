import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../site/assets/app.js", import.meta.url), "utf8");
const styles = await readFile(new URL("../site/assets/styles.css", import.meta.url), "utf8");
const catalog = JSON.parse(await readFile(new URL("../site/data/study-guide-catalog.json", import.meta.url), "utf8"));

function section(start, end) {
  const startAt = source.indexOf(start);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.ok(startAt >= 0 && endAt > startAt, `missing source section ${start}`);
  return source.slice(startAt, endAt);
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function interactionHarness(fetchImpl, {
  persistSucceeds = true,
  setTimeoutImpl = globalThis.setTimeout,
  clearTimeoutImpl = globalThis.clearTimeout,
  interactionKey = "structure",
  initialInput = null,
} = {}) {
  const body = section("function learningSubmissionRetryMessage", "async function saveReadingSubmission");
  const deps = {
    state: {
      current: { id: "lesson-a" },
      progress: { "lesson-a": {}, "lesson-b": {} },
      interactionRequestsInFlight: new Set(),
    },
    input: initialInput || { reason: "以兩處具體章句說明前後照應、語勢轉折與整體章法如何逐層推進。" },
    interactionKey,
    mutationSequence: 0,
    persistSucceeds,
    setTimeout: setTimeoutImpl,
    clearTimeout: clearTimeoutImpl,
    calls: { saved: 0, synced: 0, rendered: 0, lessonIndex: 0, mastery: 0, toasts: [], requests: [] },
    fetch: async (path, init) => {
      deps.calls.requests.push(JSON.parse(init.body));
      return fetchImpl(path, init);
    },
  };
  const controls = new Function(
    "deps",
    `let progressOwnerScope = "owner-a";
     const state = deps.state;
     const els = { checkStage: { querySelector: () => null } };
     const interactionInput = () => ({ ...deps.input });
     const interactionInputLength = (input) => Object.values(input).join("").length;
     const interactionRequestKey = (...parts) => parts.join("\\n");
     const interactionSubmissionMode = () => "formal";
     const saveLocalInteractionPractice = () => false;
     const lessonProgress = (id = state.current?.id) => (state.progress[id] ||= {});
     const window = { YwLearningEvidence: { mutationId: () => \`mutation-\${++deps.mutationSequence}\` } };
     const saveStoredProgress = () => { deps.calls.saved += 1; return deps.persistSucceeds; };
     const setTimeout = deps.setTimeout;
     const clearTimeout = deps.clearTimeout;
     const fetch = deps.fetch;
     const interactionEvidenceDecision = () => ({ accepted: true, completed: true, evidenceStatus: "recorded" });
     const lessonVocabulary = () => [];
     const saveReadingSubmission = async () => {};
     const trackFor = () => [[deps.interactionKey === "contextWords" ? "context" : deps.interactionKey, "互動"]];
     const toast = (message) => deps.calls.toasts.push(message);
     const syncProgress = () => { deps.calls.synced += 1; };
     const renderCheckStage = () => { deps.calls.rendered += 1; };
     const renderLessonIndex = () => { deps.calls.lessonIndex += 1; };
     const renderMastery = () => { deps.calls.mastery += 1; };
     ${body}
     return {
       submit: () => submitInteraction(deps.interactionKey),
       setLesson: (id) => { state.current = { id }; },
       setOwner: (owner, progress) => { progressOwnerScope = owner; state.progress = progress; },
       setDraft: (value) => {
         deps.input.reason = value;
         const lessonId = state.current?.id;
         if (lessonId) state.progress[lessonId].structure = {
           ...(state.progress[lessonId].structure || {}),
           reason: value,
         };
       },
       setInput: (nextInput) => {
         Object.assign(deps.input, nextInput);
         const lessonId = state.current?.id;
         const progressKey = deps.interactionKey === "contextWords" ? "context" : deps.interactionKey;
         if (lessonId) state.progress[lessonId][progressKey] = {
           ...(state.progress[lessonId][progressKey] || {}),
           ...nextInput,
         };
       },
     };`,
  )(deps);
  return { deps, ...controls };
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

test("persisted in-flight study-guide work hydrates as an idempotent retry", () => {
  const body = section("function normalizeInterruptedStudyGuideSubmissions", "function loadStoredProgress");
  const normalize = new Function(`${body}; return normalizeInterruptedStudyGuideSubmissions;`)();
  const progress = {
    "lesson-1474": {
      studyGuide: {
        items: {
          item: {
            submitting: true,
            pendingSync: false,
            response: "已作答",
            clientMutationId: "stable-mutation",
            referenceRevealedAt: "2026-08-23T00:00:00.000Z",
          },
        },
      },
    },
  };
  const result = normalize(progress)["lesson-1474"].studyGuide.items.item;
  assert.equal(result.submitting, false);
  assert.equal(result.pendingSync, true);
  assert.equal(result.clientMutationId, "stable-mutation");
  assert.equal(result.referenceRevealedAt, "2026-08-23T00:00:00.000Z");
});

test("AI waits are bounded and formal dialogue keeps a monotonic transcript", () => {
  assert.equal((source.match(/controller\.abort\(\), 55_000/g) || []).length, 2,
    "both evaluator clients must outlive the 45-second Worker feedback budget");
  const studyGuide = section("async function submitStudyGuideAttempt", "function bindCheckStage");
  assert.match(studyGuide, /new AbortController\(\)/);
  assert.match(studyGuide, /controller\.abort\(\)/);
  assert.match(studyGuide, /learning_evaluator_timeout/);
  const interaction = section("async function submitInteraction", "function bindCheckStage");
  assert.match(interaction, /signal: controller\.signal/);
  assert.match(interaction, /previousProgress\.done === true \|\| evidence\.completed/);
  assert.match(interaction, /bestScore: Math\.max/);
  assert.match(interaction, /payload\.conversation/);
  assert.match(interaction, /progressOwnerScope !== requestOwnerScope/);
  assert.match(interaction, /lessonProgress\(requestLessonId\)/);
  assert.match(interaction, /learning_mutation_conflict/);
  assert.match(source, /interaction-transcript/);
  assert.match(source, /turn\?\.attemptNo/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /data-interaction-transcript/);
  assert.match(source, /data-interaction-latest-feedback/);
  assert.match(source, /已進行 \$\{latestAttemptNo\} 輪/);
  assert.doesNotMatch(source, /data-interaction-transcript aria-label="AI 多輪細讀記錄" aria-live=/);
  assert.match(styles, /interaction-transcript[^}]*overflow-wrap:\s*anywhere/);
  assert.match(source, /文本細讀教練/);
  assert.match(source, /\{ coach: true \}/);
});

test("formal interaction timeout covers a response body that never finishes", async () => {
  let timeoutCallback = null;
  let timeoutActive = false;
  let bodyAborts = 0;
  const setTimeoutImpl = (callback) => {
    timeoutCallback = callback;
    timeoutActive = true;
    return 1;
  };
  const clearTimeoutImpl = () => {
    timeoutActive = false;
    timeoutCallback = null;
  };
  const harness = interactionHarness(async (_path, init) => ({
    ok: true,
    status: 200,
    async json() {
      return new Promise((_resolve, reject) => {
        const rejectAbort = () => {
          bodyAborts += 1;
          reject(new DOMException("aborted", "AbortError"));
        };
        if (init.signal.aborted) rejectAbort();
        else init.signal.addEventListener("abort", rejectAbort, { once: true });
        if (timeoutActive && timeoutCallback) {
          timeoutActive = false;
          const callback = timeoutCallback;
          timeoutCallback = null;
          callback();
        } else {
          reject(new Error("timeout cleared before response body was consumed"));
        }
      });
    },
  }), { setTimeoutImpl, clearTimeoutImpl });
  await harness.submit();
  assert.equal(bodyAborts, 1);
  assert.equal(harness.deps.state.progress["lesson-a"].structure.done, undefined);
  assert.ok(harness.deps.state.progress["lesson-a"].structure.pendingSubmission);
  assert.match(harness.deps.calls.toasts.at(-1), /來源端評閱逾時/);
});

test("study-guide timeout covers a response body that never finishes", async () => {
  const helperSource = section("async function submitStudyGuideAttempt", "function bindCheckStage");
  let timeoutCallback = null;
  let bodyAborts = 0;
  const submitStudyGuideAttempt = new Function(
    "fetch",
    "setTimeout",
    "clearTimeout",
    "AbortController",
    `${helperSource}; return submitStudyGuideAttempt;`,
  )(
    async (_path, init) => ({
      ok: true,
      status: 200,
      async json() {
        return new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => {
            bodyAborts += 1;
            reject(new DOMException("aborted", "AbortError"));
          }, { once: true });
          timeoutCallback?.();
        });
      },
    }),
    (callback) => { timeoutCallback = callback; return 1; },
    () => { timeoutCallback = null; },
    AbortController,
  );
  const result = await submitStudyGuideAttempt({
    lessonId: "lesson-1474",
    itemKey: "item-1",
    response: "作答",
    referenceRevealedAt: "2026-08-23T00:00:00.000Z",
    clientMutationId: "study-mutation-1",
  });
  assert.equal(bodyAborts, 1);
  assert.equal(result.ok, false);
  assert.equal(result.code, "learning_evaluator_timeout");
});

test("formal writes fail closed when their retry receipt cannot be persisted", async () => {
  const harness = interactionHarness(async () => {
    throw new Error("a request must not start without a durable retry receipt");
  }, { persistSucceeds: false });
  await harness.submit();
  assert.equal(harness.deps.calls.requests.length, 0);
  assert.equal(harness.deps.state.progress["lesson-a"].structure.pendingSubmission, undefined);
  assert.match(harness.deps.calls.toasts.at(-1), /無法保存本次提交，尚未送出/);

  const studyGuideBinding = section("$$('[data-study-response]'", "$$('[data-ai-check]'");
  const persistenceGate = studyGuideBinding.indexOf("if (!saveStoredProgress())");
  assert.ok(persistenceGate >= 0);
  assert.ok(persistenceGate < studyGuideBinding.indexOf("submitStudyGuideAttempt({"));
  assert.match(studyGuideBinding, /local_progress_storage_unavailable/);
});

test("a successful annotated-text render is not replaced when an ancillary renderer fails", () => {
  const helperSource = section("function safelyRenderCommittedFirstReadPart", "function renderText");
  const safelyRenderCommittedFirstReadPart = new Function(
    `${helperSource}; return safelyRenderCommittedFirstReadPart;`,
  )();
  let annotatedTextVisible = true;
  assert.equal(safelyRenderCommittedFirstReadPart(() => { throw new Error("materials failed"); }), false);
  assert.equal(annotatedTextVisible, true);
  const firstReadBinding = section("onUnlock: () =>", "return;\n  }");
  assert.match(firstReadBinding, /renderCommittedFirstReadAncillary\(lesson\)/);
  assert.match(firstReadBinding, /if \(!annotatedTextVisible\) renderCommittedFirstReadRecovery\(lesson\)/);
});

test("author-question role labels follow the same author-or-coach authority", () => {
  const roleSource = section("function interactionResponseRole", "function interactionResult");
  const interactionResponseRole = new Function(
    "formalResponseAuthorFor",
    `${roleSource}; return interactionResponseRole;`,
  )(
    (lesson) => lesson.authors?.[0] || null,
  );
  assert.equal(interactionResponseRole({ authors: [{ name: "孔子" }] }, "authorQuestion"), "孔子");
  assert.equal(interactionResponseRole({ authors: [] }, "authorQuestion"), "文本細讀教練");
  assert.equal(interactionResponseRole({ authors: [{ name: "孔子" }] }, "structure"), "文本細讀教練");
  assert.equal(
    interactionResponseRole({ authors: [{ name: "第一作者" }, { name: "第二作者" }] }, "authorQuestion"),
    "第一作者",
    "formal author dialogue must match the server's authoritative primary author",
  );
  assert.match(source, /aria-label="向\$\{esc\(responseRole\)\}回應或提出追問"/);
  assert.match(source, /\$\{esc\(responseRole\)\}回饋/);
});

test("formal interaction retry receipts bind owner lesson input and mutation", () => {
  const body = section("function interactionInputSignature", "async function submitInteraction");
  const helpers = new Function(
    `${body}; return { pendingInteractionMutation, interactionPendingMatches };`,
  )();
  let sequence = 0;
  const create = () => `mutation-${++sequence}`;
  const first = helpers.pendingInteractionMutation({}, { reason: "同一答案" }, create);
  assert.equal(first.clientMutationId, "mutation-1");
  const persisted = { pendingSubmission: first };
  const sameAfterRefresh = helpers.pendingInteractionMutation(persisted, { reason: "同一答案" }, create);
  assert.equal(sameAfterRefresh.clientMutationId, first.clientMutationId);
  assert.equal(sequence, 1, "the same persisted input must not allocate a new mutation");
  assert.equal(helpers.interactionPendingMatches(persisted, sameAfterRefresh), true);
  const changed = helpers.pendingInteractionMutation(persisted, { reason: "修改後答案" }, create);
  assert.equal(changed.clientMutationId, "mutation-2");
  assert.equal(helpers.interactionPendingMatches(persisted, changed), false);
  const nextTurn = helpers.pendingInteractionMutation({}, { reason: "下一輪答案" }, create);
  assert.equal(nextTurn.clientMutationId, "mutation-3", "a completed turn without pending receipt must allocate a new mutation");
});

test("an in-flight formal response writes only its original lesson and never a new owner scope", async () => {
  const lessonResponse = deferred();
  const lessonHarness = interactionHarness(() => lessonResponse.promise);
  const lessonSubmit = lessonHarness.submit();
  await Promise.resolve();
  lessonHarness.setLesson("lesson-b");
  lessonResponse.resolve(Response.json({
    assessment: { score: 82, verdict: "已達標", strength: "證據可定位", gap: "", nextQuestion: "再比較一處句式。" },
    evidence: { status: "recorded" },
    conversation: [{ attemptNo: 1, input: { reason: "第一輪" }, assessment: { score: 82 } }],
  }));
  await lessonSubmit;
  assert.equal(lessonHarness.deps.state.progress["lesson-a"].structure.done, true);
  assert.equal(lessonHarness.deps.state.progress["lesson-b"].structure, undefined);
  assert.equal(lessonHarness.deps.calls.rendered, 0, "a response for a background lesson must not rerender the current lesson");

  const ownerResponse = deferred();
  const ownerHarness = interactionHarness(() => ownerResponse.promise);
  const ownerSubmit = ownerHarness.submit();
  await Promise.resolve();
  const ownerBProgress = { "lesson-a": {}, "lesson-b": {} };
  ownerHarness.setOwner("owner-b", ownerBProgress);
  ownerResponse.resolve(Response.json({
    assessment: { score: 88 },
    evidence: { status: "recorded" },
    conversation: [],
  }));
  await ownerSubmit;
  assert.equal(ownerBProgress["lesson-a"].structure, undefined, "owner A response must not write owner B progress");
});

test("formal multi-turn submission dedupes clicks and preserves a draft typed during evaluation", async () => {
  const response = deferred();
  const harness = interactionHarness(() => response.promise);
  const first = harness.submit();
  await Promise.resolve();
  await harness.submit();
  assert.equal(harness.deps.calls.requests.length, 1, "the same in-flight mutation must have one request");

  const nextDraft = "下一輪我要比較開篇蓄勢與末段收束，補上兩處句式回環的具體證據。";
  harness.setDraft(nextDraft);
  response.resolve(Response.json({
    assessment: { score: 84, verdict: "已達標", nextQuestion: "再辨一處照應。" },
    evidence: { status: "recorded", sourceEventId: "event-1", attemptNo: 1 },
    conversation: [],
  }));
  await first;
  const record = harness.deps.state.progress["lesson-a"].structure;
  assert.equal(record.reason, nextDraft, "the newer draft must survive the prior round response");
  assert.equal(record.pendingSubmission, undefined);
  assert.equal(record.turns.length, 1, "an empty history decoration must still keep the committed round");
  assert.equal(record.turns[0].sourceEventId, "event-1");
});

test("failed formal round visibly retries its old receipt before a new draft becomes a new mutation", async () => {
  const firstResponse = deferred();
  let call = 0;
  const harness = interactionHarness(async () => {
    call += 1;
    if (call === 1) return firstResponse.promise;
    return Response.json({
      assessment: { score: call === 2 ? 81 : 86 },
      evidence: { status: "recorded", sourceEventId: `event-${call}`, attemptNo: call - 1 },
      conversation: [],
    });
  });
  const oldInput = harness.deps.input.reason;
  const first = harness.submit();
  await Promise.resolve();
  const nextDraft = "新的草稿要分析中段轉折如何改變論證方向，並補充末句回扣中心的證據。";
  harness.setDraft(nextDraft);
  firstResponse.resolve(Response.json({ error: "upstream unavailable" }, { status: 503 }));
  await first;
  const afterFailure = harness.deps.state.progress["lesson-a"].structure;
  assert.equal(afterFailure.reason, nextDraft);
  assert.equal(afterFailure.pendingSubmission.clientMutationId, "mutation-1");
  assert.ok(harness.deps.calls.rendered > 0, "failure must rerender the explicit previous-round retry state");

  await harness.submit();
  assert.deepEqual(
    harness.deps.calls.requests.slice(0, 2).map((request) => request.clientMutationId),
    ["mutation-1", "mutation-1"],
  );
  assert.equal(harness.deps.calls.requests[1].input.reason, oldInput);
  assert.equal(harness.deps.state.progress["lesson-a"].structure.reason, nextDraft);
  await harness.submit();
  assert.equal(harness.deps.calls.requests[2].clientMutationId, "mutation-2");
  assert.equal(harness.deps.calls.requests[2].input.reason, nextDraft);
});

test("formal conversation merge is monotonic deduplicated and capped at six rounds", () => {
  const mergeSource = section("function mergeInteractionConversation", "function interactionInputProblem");
  const mergeInteractionConversation = new Function(
    `${mergeSource}; return mergeInteractionConversation;`,
  )();
  const existing = Array.from({ length: 6 }, (_value, index) => ({
    sourceEventId: `event-${index + 1}`,
    attemptNo: index + 1,
    assessment: { score: 60 + index },
  }));
  assert.deepEqual(
    mergeInteractionConversation(existing, [], null).map((turn) => turn.attemptNo),
    [1, 2, 3, 4, 5, 6],
    "an empty server decoration must never erase local history",
  );
  const fallback = { sourceEventId: "event-7", attemptNo: 7, assessment: { score: 70 } };
  const detailed = { ...fallback, assessment: { score: 88, verdict: "完整回執" } };
  const merged = mergeInteractionConversation(existing, [detailed], fallback);
  assert.deepEqual(merged.map((turn) => turn.attemptNo), [2, 3, 4, 5, 6, 7]);
  assert.equal(merged.at(-1).assessment.score, 88, "server detail replaces only its matching fallback turn");
});

test("context auto-check preserves edits made during the prior request and submits the new draft next", async () => {
  const firstResponse = deferred();
  const timers = [];
  let call = 0;
  const harness = interactionHarness(async () => {
    call += 1;
    if (call === 1) return firstResponse.promise;
    return Response.json({
      assessment: { score: 78 },
      evidence: { status: "recorded", sourceEventId: "context-event-2", attemptNo: 2 },
      conversation: [],
    });
  }, {
    interactionKey: "contextWords",
    initialInput: { words: "甲、乙、丙" },
    setTimeoutImpl(callback, delay) {
      const timer = { callback, delay, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeoutImpl(timer) {
      if (timer) timer.cleared = true;
    },
  });

  const first = harness.submit();
  await Promise.resolve();
  harness.setInput({ words: "甲、乙、丁" });
  firstResponse.resolve(Response.json({
    assessment: { score: 72 },
    evidence: { status: "recorded", sourceEventId: "context-event-1", attemptNo: 1 },
    conversation: [],
  }));
  await first;
  const record = harness.deps.state.progress["lesson-a"].context;
  assert.equal(record.words, "甲、乙、丁");
  assert.equal(record.assessedInputSignature, JSON.stringify({ words: "甲、乙、丙" }));
  const followUp = timers.find((timer) => timer.delay === 720 && !timer.cleared);
  assert.ok(followUp, "the preserved complete draft must receive its own deferred evaluation");
  followUp.callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.deps.calls.requests.length, 2);
  assert.equal(harness.deps.calls.requests[1].input.words, "甲、乙、丁");
  assert.notEqual(
    harness.deps.calls.requests[0].clientMutationId,
    harness.deps.calls.requests[1].clientMutationId,
  );
});

test("a mutation conflict clears the stale receipt so the next submission starts a new turn", async () => {
  let call = 0;
  const harness = interactionHarness(async () => {
    call += 1;
    if (call === 1) {
      return Response.json({ error: "mutation conflict", code: "learning_mutation_conflict" }, { status: 409 });
    }
    return Response.json({
      assessment: { score: 70 },
      evidence: { status: "recorded" },
      conversation: [{ attemptNo: 2, input: { reason: "retry" }, assessment: { score: 70 } }],
    });
  });
  await harness.submit();
  assert.equal(harness.deps.state.progress["lesson-a"].structure.pendingSubmission, undefined);
  await harness.submit();
  assert.deepEqual(
    harness.deps.calls.requests.map((request) => request.clientMutationId),
    ["mutation-1", "mutation-2"],
  );
});

test("study-guide completion reacquires the live owner-scoped record after identity hydration", () => {
  const body = section("function currentStudyGuideAttemptRecords", "async function submitStudyGuideAttempt");
  const detached = { item: { clientMutationId: "stable-id", pendingSync: true } };
  const live = { item: { clientMutationId: "stable-id", pendingSync: true } };
  const currentStudyGuideAttemptRecords = new Function(
    "progressOwnerScope",
    "studyGuideProgress",
    "lessonProgress",
    `${body}; return currentStudyGuideAttemptRecords;`,
  )(
    "owner-a",
    (progress) => progress.studyGuide.items,
    () => ({ studyGuide: { items: live } }),
  );
  const resolved = currentStudyGuideAttemptRecords("owner-a", "lesson-1474", "item", "stable-id");
  assert.equal(resolved, live);
  assert.notEqual(resolved, detached, "the response must not update records detached by identity hydration");
  assert.equal(currentStudyGuideAttemptRecords("owner-b", "lesson-1474", "item", "stable-id"), null);
  assert.equal(currentStudyGuideAttemptRecords("owner-a", "lesson-1474", "item", "different-id"), null);
  const binding = section("$$('[data-study-response]'", "$$('[data-ai-check]'");
  assert.match(binding, /currentStudyGuideAttemptRecords\(ownerScope, lessonId, itemKey, clientMutationId\)/);
});

test("lesson 1474 final study-guide result removes every downstream lock in the same render cycle", () => {
  const lesson = { id: "lesson-1474" };
  const lessonData = catalog.lessons.find((entry) => entry.lessonId === lesson.id);
  const active = lessonData.items.filter((item) => item.activeForSelfTest
    && ["vocabulary", "syntax"].includes(item.competencyTag));
  assert.equal(active.length, 19);
  const records = Object.fromEntries(active.slice(0, -1).map((item) => [
    item.itemKey,
    { completed: true, semanticRevision: item.semanticRevision },
  ]));
  const progress = {
    vocabulary: { done: true },
    studyGuide: { items: records },
  };
  const firstRead = {
    authMode: "authenticated",
    submitted: true,
    annotatedReadCompleted: true,
    marks: [
      { resolutionStatus: "resolved" },
      { resolutionStatus: "resolved" },
      { resolutionStatus: "resolved" },
    ],
  };
  const state = {
    studyGuideCatalogStatus: "available",
    studyGuideLessons: new Map([[lesson.id, lessonData]]),
    firstReads: new Map([[lesson.id, firstRead]]),
  };
  const checkpointBody = section("function checkpointDone", "function progressPercent");
  const checkpointDone = new Function(
    "progressOwnerScope",
    "ANONYMOUS_UI_SCOPE",
    "state",
    "sourceModeFor",
    "lessonProgress",
    "firstReadForLesson",
    `${checkpointBody}; return checkpointDone;`,
  )(
    "owner-a",
    "anonymous-v2",
    state,
    () => "classical",
    () => progress,
    (lessonId) => state.firstReads.get(lessonId),
  );
  assert.equal(checkpointDone(progress, "vocabulary", lesson), false);
  const finalItem = active.at(-1);
  records[finalItem.itemKey] = { completed: true, semanticRevision: finalItem.semanticRevision };
  assert.equal(checkpointDone(progress, "vocabulary", lesson), true);

  const lockBody = section("function classicalRoundLocked", "function formalInteractionResourceKeys");
  const classicalRoundLocked = new Function(
    "sourceModeFor",
    "checkpointDone",
    "state",
    "firstReadForLesson",
    `${lockBody}; return classicalRoundLocked;`,
  )(() => "classical", checkpointDone, state, (lessonId) => state.firstReads.get(lessonId));
  for (const key of ["structure", "evaluation", "authorQuestion"]) {
    assert.equal(classicalRoundLocked(key, lesson, progress), "", `${key} must unlock immediately after item 19`);
  }
  const binding = section("$$('[data-study-response]'", "$$('[data-ai-check]'");
  const applyIndex = binding.indexOf("liveRecords[itemKey] = {");
  assert.ok(
    applyIndex >= 0 && applyIndex < binding.indexOf("renderCheckStage(state.current)", applyIndex),
    "the final receipt must be applied before the same-page rerender",
  );
});

test("study-guide catalog failure is isolated from core textbook startup", () => {
  const init = section("async function init()", "init();");
  assert.match(init, /fetchStudyGuideCatalog\(\)\.catch\(\(\) => null\)/);
  const corePromiseAll = init.slice(init.indexOf("await Promise.all(["), init.indexOf("]);", init.indexOf("await Promise.all([")));
  assert.doesNotMatch(corePromiseAll, /fetchStudyGuideCatalog/);
  assert.match(init, /studyGuideCatalogPromise\.then/);
  assert.doesNotMatch(init, /\|\| studyGuideCatalog\?\.schemaVersion !==/);
  assert.match(init, /state\.studyGuideCatalogStatus = "unavailable"/);
  const rendering = section("function renderStudyGuideCards", "function appendFirstReadCorrections");
  assert.match(rendering, /學案知能清算資料暫時無法載入/);
});

test("study-guide catalog body timeout cannot block startup or later retries", async () => {
  const helperSource = section("async function fetchStudyGuideCatalog", "function installStudyGuideCatalog");
  let timeoutCallback = null;
  let bodyAborts = 0;
  const fetchStudyGuideCatalog = new Function(
    "fetch",
    "setTimeout",
    "clearTimeout",
    "AbortController",
    "STUDY_GUIDE_CATALOG_TIMEOUT_MS",
    `${helperSource}; return fetchStudyGuideCatalog;`,
  )(
    async (_path, init) => ({
      ok: true,
      async json() {
        return new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => {
            bodyAborts += 1;
            reject(new DOMException("aborted", "AbortError"));
          }, { once: true });
          timeoutCallback?.();
        });
      },
    }),
    (callback) => { timeoutCallback = callback; return 1; },
    () => { timeoutCallback = null; },
    AbortController,
    1,
  );
  await assert.rejects(fetchStudyGuideCatalog(), { name: "AbortError" });
  assert.equal(bodyAborts, 1);
});

test("catalog transient failure retries in-place without focus online or reload", async () => {
  const helperSource = section("function installStudyGuideCatalog", "function hexDigest");
  const timers = [];
  let requests = 0;
  const validCatalog = {
    schemaVersion: "yw-study-guide-catalog-v1",
    catalogVersion: "yw-study-guides-0123456789abcdef",
    catalogDigest: `sha256:${"a".repeat(64)}`,
    lessonCount: 1,
    lessons: [{ lessonId: "lesson-1474", items: [] }],
  };
  const controls = new Function(
    "deps",
    `const state = {
       current: { id: "lesson-1474" },
       studyGuideLessons: new Map(),
       studyGuideCatalogStatus: "unavailable",
     };
     const STUDY_GUIDE_CATALOG_RETRY_DELAYS_MS = [1, 2, 3, 4];
     let studyGuideCatalogRefreshPromise = null;
     let studyGuideCatalogRetryTimer = null;
     let studyGuideCatalogRetryAttempt = 0;
     const fetchStudyGuideCatalog = deps.fetchStudyGuideCatalog;
     const setTimeout = deps.setTimeout;
     const clearTimeout = deps.clearTimeout;
     const renderCheckStage = () => { deps.renders.check += 1; };
     const renderMatrix = () => { deps.renders.matrix += 1; };
     const renderMastery = () => { deps.renders.mastery += 1; };
     ${helperSource}
     return {
       refresh: refreshStudyGuideCatalog,
       status: () => state.studyGuideCatalogStatus,
       lesson: () => state.studyGuideLessons.get("lesson-1474"),
       retryAttempt: () => studyGuideCatalogRetryAttempt,
     };`,
  )({
    async fetchStudyGuideCatalog() {
      requests += 1;
      if (requests === 1) throw new Error("transient 503");
      return validCatalog;
    },
    setTimeout(callback, delay) {
      const timer = { callback, delay, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeout(timer) {
      if (timer) timer.cleared = true;
    },
    renders: { check: 0, matrix: 0, mastery: 0 },
  });

  assert.equal(await controls.refresh(), false);
  assert.equal(controls.status(), "unavailable");
  const retry = timers.find((timer) => !timer.cleared);
  assert.ok(retry, "the unavailable state must schedule its own bounded retry");
  await retry.callback();
  assert.equal(requests, 2);
  assert.equal(controls.status(), "available");
  assert.equal(controls.lesson().lessonId, "lesson-1474");
  assert.equal(controls.retryAttempt(), 0);
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
  assert.match(submission, /learning_submission_rate_limited/);
  assert.match(submission, /retryAfterSeconds/);
  assert.match(submission, /limitReason/);
  assert.match(submission, /pendingInteractionMutation\(/);
  assert.match(submission, /pendingSubmission: pending/);
  assert.match(submission, /interactionPendingMatches\(liveRecord, pending\)/);
  assert.match(submission, /答案或提交狀態已變更/);
});

test("interaction and study-guide retry messages distinguish active work, capacity and upstream cooldown", () => {
  const retryMessage = section("function learningSubmissionRetryMessage", "async function submitInteraction");
  assert.match(retryMessage, /learning_submission_in_progress/);
  assert.match(retryMessage, /learning_submission_rate_limited/);
  assert.match(retryMessage, /learning_evaluator_unavailable/);
  assert.match(retryMessage, /learning_evaluator_budget_exhausted/);
  assert.match(retryMessage, /learning_evaluator_budget_unavailable/);
  assert.match(retryMessage, /來源端評閱暫時不可用/);
  assert.match(retryMessage, /評閱次數已達安全上限/);
  assert.match(retryMessage, /評閱安全額度暫時無法核對/);
  assert.doesNotMatch(retryMessage, /evaluator_retry_exhausted/);
  assert.match(retryMessage, /提交較頻繁/);
  const studyGuideSubmission = section("function bindCheckStage", "function openLexicon");
  assert.match(studyGuideSubmission, /learning_submission_rate_limited/);
  assert.match(studyGuideSubmission, /learning_evaluator_unavailable/);
  assert.match(studyGuideSubmission, /learning_evaluator_budget_exhausted/);
  assert.match(studyGuideSubmission, /learning_evaluator_budget_unavailable/);
  assert.match(studyGuideSubmission, /learningSubmissionRetryMessage/);
});

test("formal vocabulary attempts reuse a durable receipt and are owner scoped", () => {
  const helperSource = section("function pendingVocabAttempt", "async function recordVocabAttempt");
  const state = {
    progress: {
      "lesson-1474": {
        vocabularyQuiz: {
          answers: {
            "item-1": {
              pendingAttempt: { clientMutationId: "vocab-mutation-1", selectedIndex: 2 },
            },
          },
        },
      },
    },
  };
  const controls = new Function(
    "state",
    `let progressOwnerScope = "owner-a";
     ${helperSource}
     return {
       pendingVocabAttempt,
       currentVocabAttempt,
       setOwner: (owner) => { progressOwnerScope = owner; },
     };`,
  )(state);
  let created = 0;
  const previous = state.progress["lesson-1474"].vocabularyQuiz.answers["item-1"];
  assert.equal(
    controls.pendingVocabAttempt(previous, 2, () => `new-${++created}`).clientMutationId,
    "vocab-mutation-1",
  );
  assert.equal(created, 0);
  assert.ok(controls.currentVocabAttempt(
    "owner-a",
    "lesson-1474",
    "item-1",
    previous.pendingAttempt,
  ));
  controls.setOwner("owner-b");
  assert.equal(controls.currentVocabAttempt(
    "owner-a",
    "lesson-1474",
    "item-1",
    previous.pendingAttempt,
  ), null);

  const binding = section("$$('[data-quiz-option]'", "$$('[data-quiz-lookup]'");
  const persistIndex = binding.indexOf("if (!saveStoredProgress())");
  const requestIndex = binding.indexOf("await recordVocabAttempt(");
  assert.ok(persistIndex >= 0 && requestIndex > persistIndex);
  assert.match(binding, /currentVocabAttempt\(ownerScope, lessonId, item\.id, pending\)/);
  assert.match(binding, /上一答案尚未確認；請先點原選項用同一回執重試/);
});

test("formal vocabulary timeout covers a response body that never finishes", async () => {
  const helperSource = section("async function recordVocabAttempt", "function renderWordCreation");
  let timeoutCallback = null;
  let bodyAborts = 0;
  const recordVocabAttempt = new Function(
    "fetch",
    "setTimeout",
    "clearTimeout",
    "AbortController",
    `${helperSource}; return recordVocabAttempt;`,
  )(
    async (_path, init) => ({
      ok: true,
      status: 200,
      async json() {
        return new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => {
            bodyAborts += 1;
            reject(new DOMException("aborted", "AbortError"));
          }, { once: true });
          timeoutCallback?.();
        });
      },
    }),
    (callback) => { timeoutCallback = callback; return 1; },
    () => { timeoutCallback = null; },
    AbortController,
  );
  const result = await recordVocabAttempt("item-1", 2, "lesson-1474", "vocab-mutation-1");
  assert.equal(bodyAborts, 1);
  assert.equal(result.ok, false);
  assert.equal(result.code, "vocabulary_attempt_timeout");
});
