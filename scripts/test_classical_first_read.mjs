import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import {
  buildClassicalFirstReadArtifacts,
  checkClassicalFirstReadArtifacts,
  extractCanonicalParagraphs,
  isUnpunctuatedText,
} from "./build_classical_first_read.mjs";
import {
  classicalAnnotatedReadMutationId,
  getClassicalFirstReadState,
  loadClassicalFirstRead,
} from "../site/classical-first-read-source.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const taxonomy = JSON.parse(readFileSync(resolve(ROOT, "site/data/literary-taxonomy.json"), "utf8"));
const policy = JSON.parse(readFileSync(resolve(ROOT, "scripts/classical_first_read_policy.v1.json"), "utf8"));
const expectedIds = taxonomy.lessons.filter((lesson) => lesson.mode === "classical").map((lesson) => lesson.id);
const artifacts = buildClassicalFirstReadArtifacts();

assert.equal(artifacts.lessons.length, 30);
assert.deepEqual(artifacts.lessons.map((lesson) => lesson.lessonId), expectedIds);
assert.equal(artifacts.index.lessonCount, 30);

const paragraphKeys = new Set();
for (const lesson of artifacts.lessons) {
  assert.equal(lesson.schema, "yw-classical-first-read-v1");
  assert.equal(lesson.schemaVersion, 1);
  assert.ok(lesson.text.length > 0, `${lesson.lessonId} text is empty`);
  assert.ok(isUnpunctuatedText(lesson.text), `${lesson.lessonId} text retains punctuation or whitespace`);
  assert.ok(lesson.paragraphs.length > 0, `${lesson.lessonId} paragraphs are empty`);
  assert.equal(lesson.paragraphCount, lesson.paragraphs.length);
  assert.equal(lesson.charCount, Array.from(lesson.text).length);
  assert.match(lesson.textDigest, /^sha256:[a-f0-9]{64}$/);
  assert.match(lesson.textVersionId, new RegExp(`^cfr-${lesson.lessonId}-[a-f0-9]{16}$`));
  for (const paragraph of lesson.paragraphs) {
    assert.ok(isUnpunctuatedText(paragraph.text), `${paragraph.key} retains punctuation or whitespace`);
    assert.match(paragraph.key, new RegExp(`^cfrp:${lesson.lessonId}:[a-f0-9]{16}:\\d{2}$`));
    assert.equal(paragraphKeys.has(paragraph.key), false, `duplicate paragraph key ${paragraph.key}`);
    paragraphKeys.add(paragraph.key);
  }
}

const serverLoaded = await loadClassicalFirstRead(
  new Request("https://yw.bdfz.net/api/reading/first-read/state/lesson-1534"),
  {
    ASSETS: {
      async fetch(request) {
        const id = new URL(request.url).pathname.split("/").pop().replace(/\.json$/, "");
        const lesson = artifacts.lessons.find((entry) => entry.lessonId === id);
        return lesson ? Response.json(lesson) : new Response("not found", { status: 404 });
      },
    },
  },
  "lesson-1534",
);
assert.equal(serverLoaded.textVersionId, "cfr-lesson-1534-c332d4cede431f64");

function firstReadStateEnvironment({ acknowledged = false, grandfathered = false } = {}) {
  return {
    ASSETS: {
      async fetch(request) {
        const id = new URL(request.url).pathname.split("/").pop().replace(/\.json$/, "");
        const lesson = artifacts.lessons.find((entry) => entry.lessonId === id);
        return lesson ? Response.json(lesson) : new Response("not found", { status: 404 });
      },
    },
    READING_DB: {
      prepare(sql) {
        return {
          bind() {
            return this;
          },
          async first() {
            if (sql.includes("FROM classical_first_read_sessions")) {
              return {
                submitted_at: "2026-08-11T00:00:00.000Z",
                elapsed_ms: 90000,
                summary_text: "已完成無注疏初讀",
              };
            }
            if (sql.includes("AS acknowledged") && sql.includes("AS grandfathered")) {
              return { acknowledged: Number(acknowledged), grandfathered: Number(grandfathered) };
            }
            return null;
          },
          async all() {
            return { results: [] };
          },
        };
      },
    },
  };
}

const stateRequest = new Request("https://yw.bdfz.net/api/reading/first-read/state/lesson-1534");
const beforeAnnotatedReceipt = await getClassicalFirstReadState(
  stateRequest,
  firstReadStateEnvironment(),
  { id: 7 },
  "lesson-1534",
);
assert.equal(beforeAnnotatedReceipt.submitted, true);
assert.equal(beforeAnnotatedReceipt.annotatedReadCompleted, false);

const afterAnnotatedReceipt = await getClassicalFirstReadState(
  stateRequest,
  firstReadStateEnvironment({ acknowledged: true }),
  { id: 7 },
  "lesson-1534",
);
assert.equal(afterAnnotatedReceipt.annotatedReadCompleted, true);
assert.equal(
  classicalAnnotatedReadMutationId("lesson-1534", serverLoaded.textVersionId),
  "annotated-read:lesson-1534:cfr-lesson-1534-c332d4cede431f64",
);

const browserContractSource = readFileSync(resolve(ROOT, "site/assets/classical-first-read.js"), "utf8");
const appSource = readFileSync(resolve(ROOT, "site/assets/app.js"), "utf8");
const indexSource = readFileSync(resolve(ROOT, "site/index.html"), "utf8");
const browserContractHash = createHash("sha256").update(browserContractSource).digest("hex").slice(0, 16);
assert.ok(indexSource.includes(`assets/classical-first-read.js?v=${browserContractHash}`));
assert.doesNotMatch(indexSource, /assets\/classical-first-read\.js\?v=20260811-annotated-read-v2/);
assert.match(browserContractSource, /asset\.schema\s*!==\s*"yw-classical-first-read-v1"/);
assert.match(browserContractSource, /Number\(asset\.schemaVersion\)\s*!==\s*1/);
assert.match(browserContractSource, /data-first-read-keyboard-form/);
assert.match(browserContractSource, /tabindex="0" data-first-read-paragraph/);
assert.match(browserContractSource, /renderSubmittedReading/);
assert.match(browserContractSource, /data-first-read-submitted-review/);
assert.match(browserContractSource, /session\.authMode\s*!==\s*"authenticated"/);
assert.doesNotMatch(browserContractSource, /localStorage\.setItem/);
assert.match(browserContractSource, /new AbortController\(\)/);
assert.match(browserContractSource, /signal: controller\.signal/);
assert.match(browserContractSource, /return await consume\(response\)/);
assert.match(browserContractSource, /fetchWithTimeout\(`\/api\/reading\/first-read\/state/);
assert.match(browserContractSource, /fetchWithTimeout\(`data\/classical-first-read/);
assert.match(browserContractSource, /notifyUnlock\(session, handlers\)/);
assert.match(browserContractSource, /handlers\.onUnlockFailure\?\.\(session, error\)/);
assert.ok(
  appSource.indexOf("renderCommittedFirstReadTransition(lesson)", appSource.indexOf("onUnlock: () =>"))
    < appSource.indexOf("syncProgress({ event: true });", appSource.indexOf("onUnlock: () =>")),
  "the committed next-stage UI must render before ancillary progress synchronization",
);
assert.match(browserContractSource, /localStorage\.removeItem\(localKey\(asset\)\)/);
assert.match(appSource, /data-inline-note role="note" hidden/);
assert.match(appSource, /aria-expanded="false" aria-controls=/);
assert.match(appSource, /if \(note\.dataset\.typed !== "true"\)/);
assert.match(appSource, /note\.dataset\.typed = "true"/);
assert.match(appSource, /event\.key === "Escape"/);
assert.match(appSource, /closeInlineNote\(openNote\)/);
assert.match(appSource, /noteButton\?\.focus\(\{ preventScroll: true \}\)/);
assert.match(appSource, /function renderCommittedFirstReadRecovery/);
assert.match(appSource, /data-first-read-render-retry/);
assert.match(appSource, /onUnlockFailure: \(\) =>/);

function firstReadLoadHarness() {
  const asset = artifacts.lessons.find((lesson) => lesson.lessonId === "lesson-1534");
  const calls = { assets: 0, authority: 0 };
  const window = {};
  const fetch = async (input) => {
    const path = typeof input === "string" ? input : new URL(input.url).pathname;
    if (path === `data/classical-first-read/${asset.lessonId}.json`) {
      calls.assets += 1;
      return Response.json(asset);
    }
    if (path === `/api/reading/first-read/state/${asset.lessonId}`) {
      calls.authority += 1;
      return Response.json({
        ok: true,
        lessonId: asset.lessonId,
        textVersionId: asset.textVersionId,
        textDigest: asset.textDigest,
        submitted: false,
        unlocked: false,
        annotatedReadCompleted: false,
        submittedAt: null,
        elapsedMs: 0,
        summary: "",
        markCount: 0,
        resolvedCount: 0,
        marks: [],
      });
    }
    throw new Error(`unexpected load request: ${path}`);
  };
  vm.runInNewContext(browserContractSource, {
    window,
    performance: { now: () => 1000 },
    localStorage: { removeItem() {} },
    location: { href: `https://yw.bdfz.net/#${asset.lessonId}` },
    fetch,
    AbortController,
    setTimeout,
    clearTimeout,
    Response,
  });
  return { asset, calls, load: window.YwClassicalFirstRead.load };
}

for (const fallbackAuthMode of ["offline", "local"]) {
  const harness = firstReadLoadHarness();
  const session = await harness.load(harness.asset.lessonId, {
    readAuthority: false,
    fallbackAuthMode,
  });
  assert.equal(harness.calls.assets, 1, `${fallbackAuthMode} public load must read the reviewed asset once`);
  assert.equal(harness.calls.authority, 0, `${fallbackAuthMode} public load must not read private authority`);
  assert.equal(session.authMode, fallbackAuthMode);
  assert.equal(session.authorityLessonId, null);
  assert.equal(session.submitted, false);
}

const privateLoadHarness = firstReadLoadHarness();
const privateSession = await privateLoadHarness.load(privateLoadHarness.asset.lessonId, {
  readAuthority: true,
  fallbackAuthMode: "offline",
});
assert.equal(privateLoadHarness.calls.assets, 1);
assert.equal(privateLoadHarness.calls.authority, 1, "an authority-enabled load must retain the private state read");
assert.equal(privateSession.authMode, "authenticated");
assert.equal(privateSession.authorityLessonId, privateLoadHarness.asset.lessonId);
assert.equal(privateSession.authorityTextVersionId, privateLoadHarness.asset.textVersionId);
assert.equal(privateSession.authorityTextDigest, privateLoadHarness.asset.textDigest);

const quyuan = artifacts.lessons.find((lesson) => lesson.lessonId === "lesson-1534");
assert.deepEqual(quyuan.source.segments, [{ startBlock: 0, endBlock: 13 }]);
assert.deepEqual(quyuan.paragraphs.map((paragraph) => paragraph.sourceBlockIndex), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
assert.equal(quyuan.paragraphCount, 14);
assert.equal(quyuan.charCount, 1366);
assert.equal(quyuan.canonicalPunctuatedDigest, "sha256:39fff1653aef7e89c9b720a9af8c1aec4cb8676fc856ead61a674291d7da9f44");
assert.equal(quyuan.textDigest, "sha256:c332d4cede431f640196a6a75dc1edab906a044eecaebdc04c7b8620b81fe264");
assert.equal(quyuan.textVersionId, "cfr-lesson-1534-c332d4cede431f64");
assert.ok(quyuan.text.startsWith("屈原者名平楚之同姓也为楚怀王左徒"));
assert.ok(quyuan.text.endsWith("同死生轻去就又爽然自失矣"));
assert.equal(quyuan.text.includes("史家之绝唱"), false);

const tamperedQuyuanReader = JSON.parse(readFileSync(resolve(ROOT, "site/data/reader-documents/lesson-1534.json"), "utf8"));
tamperedQuyuanReader.main.blocks[0].runs[0].text += "改";
assert.throws(
  () => extractCanonicalParagraphs(
    tamperedQuyuanReader,
    policy.lessons.find((lesson) => lesson.lessonId === "lesson-1534"),
  ),
  /canonical punctuated digest mismatch/,
  "source text drift must fail before unpunctuated text is generated",
);

const suwu = artifacts.lessons.find((lesson) => lesson.lessonId === "lesson-1535");
assert.deepEqual(suwu.source.segments, [{ startBlock: 28, endBlock: 31 }]);
assert.deepEqual(suwu.paragraphs.map((paragraph) => paragraph.sourceBlockIndex), [28, 29, 30, 31]);
assert.equal(suwu.paragraphCount, 4);
assert.equal(suwu.charCount, 1468);
assert.equal(suwu.canonicalPunctuatedDigest, "sha256:d11c7763a7067f304a6f4edfaa7c9d22934b847ca954b8170e2725be8749830a");
assert.equal(suwu.textDigest, "sha256:a6d3d69153bd010066e85998fc751ceabf615a446ffd34c801927deb14eadfa3");
assert.equal(suwu.textVersionId, "cfr-lesson-1535-a6d3d69153bd0100");
assert.ok(suwu.text.startsWith("武字子卿少以父任兄弟并为郎"));
assert.ok(suwu.text.endsWith("武留匈奴凡十九岁始以强壮出及还须发尽白"));
for (const excluded of ["Summary", "李廣隴西成紀人也", "使动用法", "甘露三年單于始入朝"]) {
  assert.equal(suwu.text.includes(excluded), false, `苏武传 leaked excluded content: ${excluded}`);
}

const staleArtifacts = structuredClone(artifacts);
staleArtifacts.index.lessonCount = 29;
assert.throws(
  () => checkClassicalFirstReadArtifacts(staleArtifacts),
  /index\.json is stale/,
  "--check must reject a generated artifact that no longer matches the reviewed build",
);
checkClassicalFirstReadArtifacts(artifacts);

function firstReadSubmitController({
  authoritativeSubmitted,
  authoritativeLessonId,
  authoritativeTextVersionId,
  authoritativeTextDigest,
  hangRecoveryAsset = false,
  hangRecoveryAssetBody = false,
  hangSubmit = false,
  hangSubmitBody = false,
  immediateTimeout = false,
  unlockThrows = false,
  submitReceipt = null,
}) {
  const asset = artifacts.lessons.find((lesson) => lesson.lessonId === "lesson-1534");
  const marks = asset.paragraphs.slice(0, 3).map((paragraph, index) => ({
    markId: `controller-mark-${index + 1}`,
    paragraphKey: paragraph.key,
    startOffset: 0,
    endOffset: Math.min(2, paragraph.text.length),
    selectedText: paragraph.text.slice(0, 2),
    guess: `第 ${index + 1} 處第一直覺`,
    correction: "",
    resolutionStatus: "open",
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
  }));
  const authoritativeSummary = "權威初讀狀態已提交，應在同一頁直接展開下一階段。";
  const calls = {
    stateReads: 0,
    reconciles: 0,
    unlocks: 0,
    unlockFailures: 0,
    bodyAborts: 0,
    toasts: [],
  };
  let timeoutCallback = null;
  let timeoutActive = false;
  const runControlledTimeout = () => {
    if (!timeoutActive || !timeoutCallback) return false;
    timeoutActive = false;
    const callback = timeoutCallback;
    timeoutCallback = null;
    callback();
    return true;
  };
  const controlledSetTimeout = (callback) => {
    timeoutCallback = callback;
    timeoutActive = true;
    return 1;
  };
  const controlledClearTimeout = () => {
    timeoutActive = false;
    timeoutCallback = null;
  };
  const hangingBodyResponse = (signal) => ({
    ok: true,
    status: 200,
    async json() {
      return new Promise((_resolve, reject) => {
        const rejectAbort = () => {
          calls.bodyAborts += 1;
          reject(new DOMException("aborted", "AbortError"));
        };
        if (signal?.aborted) rejectAbort();
        else signal?.addEventListener("abort", rejectAbort, { once: true });
        if (!runControlledTimeout()) reject(new Error("timeout cleared before response body was consumed"));
      });
    },
  });
  const fetch = async (input, init = {}) => {
    const path = typeof input === "string" ? input : input.url;
    if (path === `data/classical-first-read/${asset.lessonId}.json`) {
      if (hangRecoveryAsset) {
        if (init.signal?.aborted) throw new DOMException("aborted", "AbortError");
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
          runControlledTimeout();
        });
      }
      if (hangRecoveryAssetBody) return hangingBodyResponse(init.signal);
      return Response.json(asset);
    }
    if (path === `/api/reading/first-read/state/${asset.lessonId}`) {
      calls.stateReads += 1;
      return Response.json({
        ok: true,
        lessonId: authoritativeLessonId ?? asset.lessonId,
        textVersionId: authoritativeTextVersionId ?? asset.textVersionId,
        textDigest: authoritativeTextDigest ?? asset.textDigest,
        submitted: authoritativeSubmitted,
        unlocked: authoritativeSubmitted,
        annotatedReadCompleted: false,
        submittedAt: authoritativeSubmitted ? "2026-08-22T00:01:00.000Z" : null,
        elapsedMs: 60000,
        summary: authoritativeSubmitted ? authoritativeSummary : "",
        markCount: marks.length,
        resolvedCount: 0,
        marks,
      });
    }
    if (path === "/api/reading/first-read/submit") {
      if (hangSubmit) {
        if (init.signal?.aborted) throw new DOMException("aborted", "AbortError");
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
          runControlledTimeout();
        });
      }
      if (hangSubmitBody) return hangingBodyResponse(init.signal);
      if (submitReceipt) return Response.json(submitReceipt);
      return Response.json({
        ok: false,
        error: "post-commit evidence failure",
      }, { status: 500 });
    }
    if (path === "/api/reading/first-read/reconcile") {
      calls.reconciles += 1;
      return Response.json({ ok: true });
    }
    throw new Error(`unexpected controller request: ${path}`);
  };
  const window = {};
  class ControllerFormData {
    constructor(form) {
      this.form = form;
    }

    get(name) {
      return this.form.values?.[name] ?? null;
    }
  }
  vm.runInNewContext(browserContractSource, {
    window,
    performance: { now: () => 1000 },
    localStorage: { removeItem() {} },
    location: { href: `https://yw.bdfz.net/#${asset.lessonId}` },
    crypto: { randomUUID: () => "controller-test-mutation" },
    fetch,
    AbortController,
    setTimeout: immediateTimeout ? controlledSetTimeout : setTimeout,
    clearTimeout: immediateTimeout ? controlledClearTimeout : clearTimeout,
    FormData: ControllerFormData,
    Node: { ELEMENT_NODE: 1 },
    Response,
  });

  const listeners = {};
  const submitButton = { disabled: false };
  const submitForm = {
    values: { summary: "我先辨人物處境，再核對字句與篇章推進關係。" },
    addEventListener(type, listener) {
      listeners[type] = listener;
    },
  };
  const sidebar = {
    querySelector(selector) {
      return selector === "[data-first-read-submit]" ? submitForm : null;
    },
    querySelectorAll() {
      return [];
    },
  };
  const root = {
    querySelector(selector) {
      return selector === "[data-first-read-sidebar]" ? sidebar : null;
    },
  };
  const session = {
    asset,
    authMode: "authenticated",
    authorityLessonId: asset.lessonId,
    authorityTextVersionId: asset.textVersionId,
    authorityTextDigest: asset.textDigest,
    submitted: false,
    submittedAt: null,
    annotatedReadCompleted: false,
    summary: "",
    elapsedMs: 0,
    openedAt: 0,
    marks,
    pending: null,
  };
  window.YwClassicalFirstRead.bindGate(root, session, {
    onUnlock() {
      calls.unlocks += 1;
      if (unlockThrows) throw new Error("host render failed");
    },
    onUnlockFailure() {
      calls.unlockFailures += 1;
    },
    toast(message) {
      calls.toasts.push(message);
    },
  });

  return {
    calls,
    session,
    submitButton,
    authoritativeSummary,
    async submit() {
      await listeners.submit({
        preventDefault() {},
        currentTarget: submitForm,
        submitter: submitButton,
      });
      await Promise.resolve();
    },
  };
}

const validReceiptController = firstReadSubmitController({
  authoritativeSubmitted: false,
  submitReceipt: {
    ok: true,
    lessonId: "lesson-1534",
    textVersionId: "cfr-lesson-1534-c332d4cede431f64",
    submittedAt: "2026-08-22T00:01:00.000Z",
  },
});
await validReceiptController.submit();
assert.equal(validReceiptController.calls.stateReads, 0, "a complete matching 2xx receipt must not need authority recovery");
assert.equal(validReceiptController.calls.unlocks, 1);
assert.equal(validReceiptController.session.submitted, true);

for (const malformedReceipt of [
  {
    ok: false,
    lessonId: "lesson-1534",
    textVersionId: "cfr-lesson-1534-c332d4cede431f64",
    submittedAt: "2026-08-22T00:01:00.000Z",
  },
  {
    ok: true,
    lessonId: "lesson-1534",
    textVersionId: "cfr-lesson-1534-c332d4cede431f64",
    submittedAt: "not-a-date",
  },
]) {
  const malformedReceiptController = firstReadSubmitController({
    authoritativeSubmitted: false,
    submitReceipt: malformedReceipt,
  });
  await malformedReceiptController.submit();
  assert.equal(malformedReceiptController.calls.stateReads, 1, "a malformed 2xx receipt must read authority");
  assert.equal(malformedReceiptController.calls.unlocks, 0, "an unconfirmed malformed receipt must remain locked");
  assert.equal(malformedReceiptController.session.submitted, false);
  assert.equal(malformedReceiptController.submitButton.disabled, false, "an unconfirmed malformed receipt must remain retryable");
}

for (const receiptMismatch of [
  {
    label: "lesson id",
    submitReceipt: {
      ok: true,
      lessonId: "lesson-1535",
      textVersionId: "cfr-lesson-1534-c332d4cede431f64",
      submittedAt: "2026-08-22T00:01:00.000Z",
    },
  },
  {
    label: "text version",
    submitReceipt: {
      ok: true,
      lessonId: "lesson-1534",
      textVersionId: "cfr-lesson-1534-0000000000000000",
      submittedAt: "2026-08-22T00:01:00.000Z",
    },
  },
]) {
  const mismatchController = firstReadSubmitController({
    authoritativeSubmitted: true,
    submitReceipt: receiptMismatch.submitReceipt,
  });
  await mismatchController.submit();
  assert.equal(mismatchController.calls.stateReads, 1, `a cross-${receiptMismatch.label} 2xx receipt must read authority`);
  assert.equal(mismatchController.calls.unlocks, 1, `a cross-${receiptMismatch.label} receipt may unlock only after authority confirms the commit`);
  assert.equal(mismatchController.calls.reconciles, 1);
  assert.equal(mismatchController.session.submitted, true);
  assert.equal(mismatchController.session.summary, mismatchController.authoritativeSummary);
}

const committedController = firstReadSubmitController({ authoritativeSubmitted: true });
await committedController.submit();
assert.equal(committedController.calls.stateReads, 1, "a failed submit must read back authoritative state");
assert.equal(committedController.calls.unlocks, 1, "a committed first read must unlock without reloading");
assert.equal(committedController.calls.reconciles, 1, "a recovered commit must reconcile learning evidence");
assert.equal(committedController.session.submitted, true);
assert.equal(committedController.session.summary, committedController.authoritativeSummary);

const rejectedController = firstReadSubmitController({ authoritativeSubmitted: false });
await rejectedController.submit();
assert.equal(rejectedController.calls.stateReads, 1, "a failed submit must confirm that no commit exists");
assert.equal(rejectedController.calls.unlocks, 0, "an uncommitted first read must remain locked");
assert.equal(rejectedController.calls.reconciles, 0, "an uncommitted first read has nothing to reconcile");
assert.equal(rejectedController.session.submitted, false);
assert.equal(rejectedController.submitButton.disabled, false, "an uncommitted submit must remain retryable");

const hangingSubmitController = firstReadSubmitController({
  authoritativeSubmitted: false,
  hangSubmit: true,
  immediateTimeout: true,
});
await hangingSubmitController.submit();
assert.equal(hangingSubmitController.calls.unlocks, 0);
assert.equal(hangingSubmitController.submitButton.disabled, false, "a never-settling submit must time out and become retryable");

const hangingAssetReadbackController = firstReadSubmitController({
  authoritativeSubmitted: true,
  hangRecoveryAsset: true,
  immediateTimeout: true,
});
await hangingAssetReadbackController.submit();
assert.equal(hangingAssetReadbackController.calls.stateReads, 0);
assert.equal(hangingAssetReadbackController.calls.unlocks, 0);
assert.equal(hangingAssetReadbackController.submitButton.disabled, false, "a never-settling authority asset read must time out and become retryable");

const hangingSubmitBodyController = firstReadSubmitController({
  authoritativeSubmitted: true,
  hangSubmitBody: true,
  immediateTimeout: true,
});
await hangingSubmitBodyController.submit();
assert.equal(hangingSubmitBodyController.calls.bodyAborts, 1, "the submit timer must remain active while its response body is consumed");
assert.equal(hangingSubmitBodyController.calls.stateReads, 1);
assert.equal(hangingSubmitBodyController.calls.unlocks, 1, "a body timeout after commit must recover from authority without reloading");

const hangingAssetBodyReadbackController = firstReadSubmitController({
  authoritativeSubmitted: true,
  hangRecoveryAssetBody: true,
  immediateTimeout: true,
});
await hangingAssetBodyReadbackController.submit();
assert.equal(hangingAssetBodyReadbackController.calls.bodyAborts, 1, "the authority timer must remain active while its asset body is consumed");
assert.equal(hangingAssetBodyReadbackController.calls.unlocks, 0);
assert.equal(hangingAssetBodyReadbackController.submitButton.disabled, false, "a never-settling authority body must become retryable");

const failedHostRenderController = firstReadSubmitController({
  authoritativeSubmitted: true,
  unlockThrows: true,
});
await failedHostRenderController.submit();
assert.equal(failedHostRenderController.calls.unlocks, 1);
assert.equal(failedHostRenderController.calls.unlockFailures, 1, "a committed source must invoke the host recovery UI when critical rendering throws");

for (const authorityMismatch of [
  { authoritativeLessonId: "lesson-1535", label: "lesson id" },
  { authoritativeTextVersionId: "cfr-lesson-1534-0000000000000000", label: "text version" },
  { authoritativeTextDigest: `sha256:${"0".repeat(64)}`, label: "text digest" },
]) {
  const mismatchController = firstReadSubmitController({
    authoritativeSubmitted: true,
    ...authorityMismatch,
  });
  await mismatchController.submit();
  assert.equal(mismatchController.calls.stateReads, 1, `${authorityMismatch.label} mismatch must read authority once`);
  assert.equal(mismatchController.calls.unlocks, 0, `${authorityMismatch.label} mismatch must remain locked`);
  assert.equal(mismatchController.calls.reconciles, 0, `${authorityMismatch.label} mismatch must not reconcile`);
  assert.equal(mismatchController.session.submitted, false, `${authorityMismatch.label} mismatch must not become submitted`);
  assert.equal(mismatchController.submitButton.disabled, false, `${authorityMismatch.label} mismatch must remain retryable`);
}

console.log(`classical first-read tests passed: ${artifacts.lessons.length} lessons, ${paragraphKeys.size} paragraphs, authority-bound ambiguous-submit recovery`);
