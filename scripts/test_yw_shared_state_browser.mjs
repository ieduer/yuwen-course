#!/usr/bin/env node

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const SITE_ROOT = path.resolve(import.meta.dirname, "../site");
const BRAVE = "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";
const OWNER_A = `ywo_${"a".repeat(32)}`;
const OWNER_B = `ywo_${"b".repeat(32)}`;
const CONTENT_VERSION = JSON.parse(
  await readFile(path.join(SITE_ROOT, "app-content/latest-stable.json"), "utf8"),
).contentVersion;
const MIME = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
]);

function startStaticServer() {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      const relative = url.pathname === "/"
        ? "index.html"
        : decodeURIComponent(url.pathname).replace(/^\/+/, "");
      const file = path.resolve(SITE_ROOT, relative);
      if (!file.startsWith(`${SITE_ROOT}${path.sep}`)) {
        response.writeHead(403).end();
        return;
      }
      const body = await readFile(file);
      response.writeHead(200, {
        "content-type": MIME.get(path.extname(file)) || "application/octet-stream",
        "cache-control": "no-store",
      });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

const siteAuthStub = `
const OWNER_A = "${OWNER_A}";
const OWNER_B = "${OWNER_B}";
const CONTENT_VERSION = "${CONTENT_VERSION}";

function remoteState(ownerScope, lessonId, textScale, contentVersion = CONTENT_VERSION) {
  return {
    schemaVersion: "yw-shared-state/1",
    siteKey: "yw",
    ownerScope,
    state: {
      readingPosition: {
        kind: "READING_POSITION",
        contentVersion,
        lessonId,
        documentId: "body",
        stableAnchor: "lesson-root",
        updatedAtEpochMillis: 1775000000000,
        clientMutationId: "11111111-1111-4111-8111-111111111111"
      },
      readerPreferences: {
        TEXT_SCALE: {
          value: textScale,
          updatedAtEpochMillis: 1775000000001,
          clientMutationId: "22222222-2222-4222-8222-222222222222"
        }
      }
    }
  };
}

async function requestSha256(text) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text)
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

window.__sharedStateCalls = [];
window.__sharedStateGets = [];
window.__acceptedMutations = [];
window.__sharedOffline = false;
window.__currentOwner = OWNER_A;
window.__remoteSharedStates = {
  [OWNER_A]: remoteState(OWNER_A, "lesson-1576", 1.26),
  [OWNER_B]: remoteState(OWNER_B, "lesson-1576", 0.92)
};
window.__stateGateOpen = false;
window.__stateGate = new Promise((resolve) => {
  window.__releaseStateGate = () => {
    window.__stateGateOpen = true;
    resolve();
  };
});

window.BdfzIdentity = {
  getSession: async () => ({
    authenticated: window.__sharedStateTestAuthenticated !== false,
  }),
  api: async (path, options = {}) => {
    const ownerAtRequest = window.__currentOwner;
    if (path === "/api/yw/v1/state") {
      window.__sharedStateGets.push(ownerAtRequest);
      if (!window.__stateGateOpen) await window.__stateGate;
      return structuredClone(window.__remoteSharedStates[ownerAtRequest]);
    }

    const body = structuredClone(options.body || null);
    const bodyText = JSON.stringify(body);
    const call = { path, ownerAtRequest, body, bodyText };
    window.__sharedStateCalls.push(call);
    if (window.__sharedOffline) throw new TypeError("offline");
    if (body.ownerScope !== ownerAtRequest) {
      const error = new Error("web_owner_scope_mismatch");
      error.status = 409;
      throw error;
    }

    const remote = window.__remoteSharedStates[ownerAtRequest];
    if (body.mutation.kind === "READING_POSITION") {
      remote.state.readingPosition = {
        kind: "READING_POSITION",
        contentVersion: body.mutation.contentVersion,
        lessonId: body.mutation.lessonId,
        documentId: body.mutation.documentId,
        stableAnchor: body.mutation.stableAnchor,
        updatedAtEpochMillis: body.mutation.updatedAtEpochMillis,
        clientMutationId: body.clientMutationId
      };
    } else {
      remote.state.readerPreferences.TEXT_SCALE = {
        value: body.mutation.value,
        updatedAtEpochMillis: body.mutation.updatedAtEpochMillis,
        clientMutationId: body.clientMutationId
      };
    }
    window.__acceptedMutations.push(structuredClone(call));
    return {
      schemaVersion: "yw-shared-state-receipt/1",
      clientMutationId: body.clientMutationId,
      ownerScope: body.ownerScope,
      durableReceiptId: "ywmr_" + body.clientMutationId,
      durableStorageVerified: true,
      requestSha256: await requestSha256(bodyText)
    };
  }
};
`;

const evidenceStub = `
window.__evidenceCalls = [];
window.YwLearningEvidence = {
  mutationId: () => "33333333-3333-4333-8333-333333333333",
  record: (...args) => {
    window.__evidenceCalls.push(args);
    return Promise.resolve({ ok: true });
  }
};
`;

async function configurePage(
  page,
  base,
  pageErrors,
  { authenticated = true } = {},
) {
  await page.addInitScript((value) => {
    window.__sharedStateTestAuthenticated = value;
  }, authenticated);
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("https://my.bdfz.net/site-auth.js", (route) => route.fulfill({
    contentType: "text/javascript; charset=utf-8",
    body: siteAuthStub,
  }));
  await page.route("https://nav.bdfz.net/bdfz-nav.js", (route) => route.fulfill({
    contentType: "text/javascript; charset=utf-8",
    body: "",
  }));
  await page.route(`${base}/assets/learning-evidence.js*`, (route) => route.fulfill({
    contentType: "text/javascript; charset=utf-8",
    body: evidenceStub,
  }));
}

let server;
let browser;
try {
  server = await startStaticServer();
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ executablePath: BRAVE, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const pageErrors = [];
  await configurePage(page, base, pageErrors);

  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => (
    document.querySelector("#lesson-title")?.textContent.includes("中国人民站起来了")
    && window.__sharedStateGets.length >= 1
  ));
  const noPreferenceDefault = await page.evaluate(() => ({
    scale: getComputedStyle(document.documentElement)
      .getPropertyValue("--reader-scale").trim(),
    anonymousFont: localStorage.getItem(
      "yw-matrix-font-v1:scope:anonymous-v2",
    ),
  }));
  assert.deepEqual(noPreferenceDefault, {
    scale: "1.26",
    anonymousFont: null,
  });

  await page.evaluate(() => {
    location.hash = "#lesson-1579";
  });
  await page.waitForFunction(() => (
    location.hash === "#lesson-1579"
    && document.querySelector("#lesson-title")?.textContent.includes("归去来兮辞")
  ));
  await page.evaluate(() => document.querySelector("#font-up").click());
  await page.waitForFunction(() => (
    getComputedStyle(document.documentElement)
      .getPropertyValue("--reader-scale").trim() === "1.42"
  ));
  await page.evaluate(() => window.__releaseStateGate());

  const ownerAOutbox = `yw-shared-state-outbox/2:${OWNER_A}`;
  try {
    await page.waitForFunction(({ storageKey, ownerA }) => {
      const outbox = JSON.parse(localStorage.getItem(storageKey) || "null");
      return location.hash === "#lesson-1576"
        && getComputedStyle(document.documentElement)
          .getPropertyValue("--reader-scale").trim() === "1.26"
        && localStorage.getItem(`yw-matrix-last-lesson-v1:scope:${ownerA}`) === "lesson-1576"
        && (outbox === null || outbox.mutations?.length === 0);
    }, { storageKey: ownerAOutbox, ownerA: OWNER_A });
  } catch (error) {
    const diagnostic = await page.evaluate(({ storageKey, ownerA }) => ({
      hash: location.hash,
      scale: getComputedStyle(document.documentElement)
        .getPropertyValue("--reader-scale").trim(),
      storedLesson: localStorage.getItem(`yw-matrix-last-lesson-v1:scope:${ownerA}`),
      storedFont: localStorage.getItem(`yw-matrix-font-v1:scope:${ownerA}`),
      outbox: JSON.parse(localStorage.getItem(storageKey) || "null"),
      stateGets: structuredClone(window.__sharedStateGets),
      calls: structuredClone(window.__sharedStateCalls),
    }), { storageKey: ownerAOutbox, ownerA: OWNER_A });
    process.stderr.write(`initial identity diagnostic=${JSON.stringify(diagnostic)}\n`);
    throw error;
  }

  const initWindow = await page.evaluate(({ ownerA, storageKey }) => ({
    lessonId: location.hash.slice(1),
    scale: getComputedStyle(document.documentElement)
      .getPropertyValue("--reader-scale").trim(),
    lessonScope: localStorage.getItem(
      `yw-matrix-last-lesson-v1:scope:${ownerA}`,
    ),
    fontScope: localStorage.getItem(`yw-matrix-font-v1:scope:${ownerA}`),
    outbox: JSON.parse(localStorage.getItem(storageKey)),
    calls: structuredClone(window.__acceptedMutations),
    evidenceCalls: window.__evidenceCalls.map((call) => call.slice(0, 2)),
  }), { ownerA: OWNER_A, storageKey: ownerAOutbox });
  assert.equal(initWindow.lessonId, "lesson-1576");
  assert.equal(initWindow.scale, "1.26");
  assert.equal(initWindow.lessonScope, "lesson-1576");
  assert.equal(initWindow.fontScope, "3");
  assert.equal(initWindow.outbox, null);
  assert.deepEqual(
    initWindow.calls,
    [],
    "unowned reading and font changes must not be rebound to the discovered owner",
  );
  assert.deepEqual(
    initWindow.evidenceCalls,
    [],
    "lesson opens that occurred before owner discovery must not be replayed under a guessed owner",
  );

  const textScaleCallCount = await page.evaluate(
    () => window.__acceptedMutations.length,
  );
  await page.evaluate(() => document.querySelector("#font-up").click());
  await page.waitForFunction((fromIndex) => window.__acceptedMutations.slice(fromIndex).some(
    (call) => call.body.mutation.kind === "READER_PREFERENCE"
      && call.body.mutation.key === "TEXT_SCALE"
      && call.body.mutation.value === 1.42,
  ), textScaleCallCount);
  const ownerATextScale = await page.evaluate((fromIndex) => structuredClone(
    window.__acceptedMutations.slice(fromIndex).find(
      (call) => call.body.mutation.kind === "READER_PREFERENCE",
    ),
  ), textScaleCallCount);
  assert.equal(ownerATextScale.ownerAtRequest, OWNER_A);
  assert.equal(ownerATextScale.body.ownerScope, OWNER_A);
  assert.equal(
    await page.evaluate((ownerA) => localStorage.getItem(
      `yw-matrix-font-v1:scope:${ownerA}`,
    ), OWNER_A),
    "4",
  );

  const replacementMutationStart = await page.evaluate(() => {
    const previousIdentity = window.BdfzIdentity;
    window.__replacementWorkingApi = previousIdentity.api.bind(previousIdentity);
    window.__replacementWorkingSession = previousIdentity.getSession.bind(previousIdentity);
    previousIdentity.api = () => new Promise(() => {});
    const before = window.__acceptedMutations.length;
    document.querySelector("#font-up").click();
    return before;
  });
  await page.waitForFunction(() => (
    getComputedStyle(document.documentElement)
      .getPropertyValue("--reader-scale").trim() === "1.6"
  ));
  const replacedIdentityStart = await page.evaluate(() => {
    window.BdfzIdentity = {
      getSession: window.__replacementWorkingSession,
      api: window.__replacementWorkingApi,
    };
    const before = window.__sharedStateGets.length;
    window.dispatchEvent(new Event("focus"));
    return before;
  });
  await page.waitForFunction((before) => (
    window.__sharedStateGets.length >= before + 3
  ), replacedIdentityStart);
  assert.ok(
    await page.evaluate((before) => window.__sharedStateGets.length - before, replacedIdentityStart)
      >= 3,
    "same-owner identity replacement must rebuild and re-verify the client instead of calling the stale object",
  );
  await page.waitForFunction((fromIndex) => window.__acceptedMutations.slice(fromIndex).some(
    (call) => call.body.mutation.kind === "READER_PREFERENCE"
      && call.body.mutation.key === "TEXT_SCALE"
      && call.body.mutation.value === 1.6,
  ), replacementMutationStart);
  const replacementMutation = await page.evaluate((fromIndex) => structuredClone(
    window.__acceptedMutations.slice(fromIndex).find(
      (call) => call.body.mutation.kind === "READER_PREFERENCE"
        && call.body.mutation.value === 1.6,
    ),
  ), replacementMutationStart);
  assert.equal(replacementMutation.ownerAtRequest, OWNER_A);
  assert.equal(replacementMutation.body.ownerScope, OWNER_A);
  assert.equal(
    await page.evaluate(() => getComputedStyle(document.documentElement)
      .getPropertyValue("--reader-scale").trim()),
    "1.6",
    "same-owner identity replacement must preserve the newest pending text scale",
  );
  assert.equal(
    await page.evaluate((ownerA) => localStorage.getItem(
      `yw-matrix-font-v1:scope:${ownerA}`,
    ), OWNER_A),
    "5",
  );

  const initialCallCount = await page.evaluate(
    () => window.__sharedStateCalls.length,
  );
  await page.evaluate(() => {
    window.__sharedOffline = true;
    location.hash = "#lesson-1458";
  });
  await page.waitForFunction((fromIndex) => (
    location.hash === "#lesson-1458"
    && document.querySelector("#lesson-title")?.textContent.includes("中国人民站起来了")
    && window.__sharedStateCalls.slice(fromIndex).some(
      (call) => call.body.mutation.kind === "READING_POSITION"
        && call.body.mutation.lessonId === "lesson-1458",
    )
  ), initialCallCount);
  const offlineCall = await page.evaluate((fromIndex) => structuredClone(
    window.__sharedStateCalls.slice(fromIndex).find(
      (call) => call.body.mutation.kind === "READING_POSITION"
        && call.body.mutation.lessonId === "lesson-1458",
    ),
  ), initialCallCount);
  assert.equal(
    await page.evaluate(
      (storageKey) => JSON.parse(localStorage.getItem(storageKey)).mutations.length,
      ownerAOutbox,
    ),
    1,
  );

  await page.evaluate((ownerB) => {
    window.__sharedOffline = false;
    window.__currentOwner = ownerB;
    window.dispatchEvent(new Event("online"));
  }, OWNER_B);
  await page.waitForFunction((ownerB) => (
    location.hash === "#lesson-1576"
    && getComputedStyle(document.documentElement)
      .getPropertyValue("--reader-scale").trim() === "0.92"
    && localStorage.getItem(`yw-matrix-last-lesson-v1:scope:${ownerB}`)
      === "lesson-1576"
  ), OWNER_B);

  const underB = await page.evaluate((ownerB) => window.__sharedStateCalls.filter(
    (call) => call.ownerAtRequest === ownerB,
  ), OWNER_B);
  assert.equal(
    underB.some((call) => call.body.ownerScope === OWNER_A),
    false,
  );
  assert.equal(
    await page.evaluate(
      (storageKey) => JSON.parse(localStorage.getItem(storageKey)).mutations.length,
      ownerAOutbox,
    ),
    1,
  );

  await page.evaluate((ownerA) => {
    window.__currentOwner = ownerA;
    window.dispatchEvent(new Event("focus"));
  }, OWNER_A);
  await page.waitForFunction(({ mutationId, storageKey }) => {
    const replay = window.__sharedStateCalls.filter(
      (call) => call.body.clientMutationId === mutationId,
    );
    const outbox = JSON.parse(localStorage.getItem(storageKey) || "null");
    return location.hash === "#lesson-1458"
      && replay.length >= 2
      && replay.at(-1).ownerAtRequest === window.__currentOwner
      && outbox?.mutations?.length === 0;
  }, {
    mutationId: offlineCall.body.clientMutationId,
    storageKey: ownerAOutbox,
  });
  const replay = await page.evaluate((mutationId) => structuredClone(
    window.__sharedStateCalls.filter(
      (call) => call.body.clientMutationId === mutationId,
    ),
  ), offlineCall.body.clientMutationId);
  assert.equal(replay[0].path, replay.at(-1).path);
  assert.equal(replay[0].bodyText, replay.at(-1).bodyText);
  assert.equal(replay[0].ownerAtRequest, OWNER_A);
  assert.equal(replay.at(-1).ownerAtRequest, OWNER_A);

  const mismatchStart = await page.evaluate(() => {
    const remote = window.__remoteSharedStates[window.__currentOwner];
    remote.state.readingPosition = {
      kind: "READING_POSITION",
      contentVersion: "yw-000000000000000000000000",
      lessonId: "lesson-1576",
      documentId: "body",
      stableAnchor: "lesson-root",
      updatedAtEpochMillis: 1775000000999,
      clientMutationId: "44444444-4444-4444-8444-444444444444"
    };
    const before = window.__sharedStateGets.length;
    window.dispatchEvent(new Event("focus"));
    return before;
  });
  await page.waitForFunction((before) => window.__sharedStateGets.length >= before + 3, mismatchStart);
  assert.equal(
    await page.evaluate((before) => window.__sharedStateGets.length - before, mismatchStart),
    3,
  );
  assert.equal(await page.evaluate(() => location.hash), "#lesson-1458");

  const deletionStart = await page.evaluate(() => {
    const remote = window.__remoteSharedStates[window.__currentOwner];
    remote.state.readingPosition = null;
    remote.state.readerPreferences = {};
    const before = window.__sharedStateGets.length;
    window.dispatchEvent(new Event("focus"));
    return before;
  });
  await page.waitForFunction(({ before, ownerA }) => (
    window.__sharedStateGets.length >= before + 3
    && location.hash === "#lesson-1458"
    && getComputedStyle(document.documentElement)
      .getPropertyValue("--reader-scale").trim() === "1.26"
    && localStorage.getItem(`yw-matrix-last-lesson-v1:scope:${ownerA}`) === null
    && localStorage.getItem(`yw-matrix-font-v1:scope:${ownerA}`) === null
  ), { before: deletionStart, ownerA: OWNER_A });
  assert.equal(
    await page.evaluate((before) => window.__sharedStateGets.length - before, deletionStart),
    3,
  );

  const finalState = await page.evaluate(({ ownerA, ownerB }) => ({
    aLesson: localStorage.getItem(`yw-matrix-last-lesson-v1:scope:${ownerA}`),
    aFont: localStorage.getItem(`yw-matrix-font-v1:scope:${ownerA}`),
    bLesson: localStorage.getItem(`yw-matrix-last-lesson-v1:scope:${ownerB}`),
    bFont: localStorage.getItem(`yw-matrix-font-v1:scope:${ownerB}`),
    evidenceCalls: window.__evidenceCalls.map((call) => call.slice(0, 2)),
  }), { ownerA: OWNER_A, ownerB: OWNER_B });
  assert.deepEqual(finalState, {
    aLesson: null,
    aFont: null,
    bLesson: "lesson-1576",
    bFont: "0",
    evidenceCalls: [["lessonOpened", "lesson-1458"]],
  });
  assert.equal(
    /answer|correct|score|mastery|lessonOpened|progress/i.test(
      JSON.stringify(await page.evaluate(() => window.__sharedStateCalls)),
    ),
    false,
  );
  assert.deepEqual(pageErrors, []);

  const racePage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const racePageErrors = [];
  await configurePage(racePage, base, racePageErrors);
  await racePage.goto(base, { waitUntil: "domcontentloaded" });
  await racePage.waitForFunction(() => (
    document.querySelector("#lesson-title")?.textContent.includes("中国人民站起来了")
    && window.__sharedStateGets.length >= 1
  ));
  await racePage.evaluate(() => {
    location.hash = "#lesson-1579";
  });
  await racePage.waitForFunction(() => (
    location.hash === "#lesson-1579"
    && document.querySelector("#lesson-title")?.textContent.includes("归去来兮辞")
  ));
  await racePage.evaluate((ownerB) => {
    document.querySelector("#font-up").click();
    window.__currentOwner = ownerB;
    window.__releaseStateGate();
  }, OWNER_B);
  try {
    await racePage.waitForFunction((ownerB) => (
      location.hash === "#lesson-1576"
      && getComputedStyle(document.documentElement)
        .getPropertyValue("--reader-scale").trim() === "0.92"
      && localStorage.getItem(`yw-matrix-last-lesson-v1:scope:${ownerB}`)
        === "lesson-1576"
    ), OWNER_B);
  } catch (error) {
    const diagnostic = await racePage.evaluate((ownerB) => ({
      hash: location.hash,
      title: document.querySelector("#lesson-title")?.textContent || "",
      scale: getComputedStyle(document.documentElement)
        .getPropertyValue("--reader-scale").trim(),
      storedLesson: localStorage.getItem(`yw-matrix-last-lesson-v1:scope:${ownerB}`),
      currentOwner: window.__currentOwner,
      stateGets: structuredClone(window.__sharedStateGets),
      calls: structuredClone(window.__sharedStateCalls),
    }), OWNER_B);
    process.stderr.write(`race diagnostic=${JSON.stringify(diagnostic)}\n`);
    error.message += `; race diagnostic=${JSON.stringify(diagnostic)}`;
    throw error;
  }
  const racedGeneration = await racePage.evaluate(() => ({
    calls: structuredClone(window.__sharedStateCalls),
    evidenceCalls: window.__evidenceCalls.map((call) => call.slice(0, 2)),
  }));
  assert.deepEqual(racedGeneration.calls, []);
  assert.deepEqual(
    racedGeneration.evidenceCalls,
    [],
    "identity-raced lesson opens must never be attributed to the replacement owner",
  );
  assert.deepEqual(racePageErrors, []);
  await racePage.close();

  const anonymousPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const anonymousPageErrors = [];
  await configurePage(anonymousPage, base, anonymousPageErrors, {
    authenticated: false,
  });
  await anonymousPage.goto(base, { waitUntil: "domcontentloaded" });
  await anonymousPage.waitForFunction(() => (
    document.querySelector("#lesson-title")?.textContent.includes("中国人民站起来了")
    && !document.querySelector("#auth-login")?.hidden
    && getComputedStyle(document.documentElement)
      .getPropertyValue("--reader-scale").trim() === "1.26"
  ));
  const anonymousDefault = await anonymousPage.evaluate(() => ({
    scale: getComputedStyle(document.documentElement)
      .getPropertyValue("--reader-scale").trim(),
    fontScope: localStorage.getItem(
      "yw-matrix-font-v1:scope:anonymous-v2",
    ),
    stateGets: window.__sharedStateGets.length,
  }));
  assert.deepEqual(anonymousDefault, {
    scale: "1.26",
    fontScope: null,
    stateGets: 0,
  });

  await anonymousPage.evaluate(() => document.querySelector("#font-up").click());
  await anonymousPage.waitForFunction(() => (
    getComputedStyle(document.documentElement)
      .getPropertyValue("--reader-scale").trim() === "1.42"
  ));
  await anonymousPage.evaluate(() => {
    location.hash = "#lesson-1579";
  });
  await anonymousPage.waitForFunction(() => (
    location.hash === "#lesson-1579"
      && document.querySelector("#lesson-title")?.textContent.includes("归去来兮辞")
      && localStorage.getItem("yw-matrix-last-lesson-v1:scope:anonymous-v2") === "lesson-1579"
  ));
  assert.deepEqual(
    await anonymousPage.evaluate(() => ({
      fontScope: localStorage.getItem(
        "yw-matrix-font-v1:scope:anonymous-v2",
      ),
      lessonScope: localStorage.getItem(
        "yw-matrix-last-lesson-v1:scope:anonymous-v2",
      ),
      stateGets: window.__sharedStateGets.length,
      stateMutations: window.__sharedStateCalls.length,
    })),
    {
      fontScope: "4",
      lessonScope: "lesson-1579",
      stateGets: 0,
      stateMutations: 0,
    },
  );
  assert.deepEqual(anonymousPageErrors, []);
  await anonymousPage.close();

  process.stdout.write("YW shared-state browser contract passed\n");
} finally {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
}
