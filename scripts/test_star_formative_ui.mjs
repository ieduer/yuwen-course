import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { parseHTML } from "linkedom";

const ROOT = new URL("../", import.meta.url);
const STAR_HTML = await readFile(new URL("site/star.html", ROOT), "utf8");
const STAR_JS = pathToFileURL(new URL("site/assets/star.js", ROOT).pathname);

const manifest = {
  blocks: Array.from({ length: 5 }, (_, index) => ({
    id: `book-${index + 1}`,
    title: `第${index + 1}冊`,
    lessons: index === 0 ? [{ id: "lesson-a" }, { id: "lesson-b" }] : [],
  })),
};

const constellation = {
  nodes: [],
  links: [],
  stats: { lessons: 7, words: 21, volumes: {} },
  groupLabels: {},
};

const availablePayload = {
  schemaVersion: "bdfz-yw-formative-mastery-v1",
  status: "available",
  unit: "lesson_competency",
  manifestVersion: "yw-formative-test0001",
  nonScoring: true,
  affectsGrowthScore: false,
  affectsAPlus: false,
  summary: {
    lessonCount: 2,
    competencyUnitCount: 7,
    completedItems: 9,
    totalItems: 18,
    masteryRate: 50,
  },
  lessons: [
    {
      lessonId: "lesson-a",
      lessonTitle: "屈原列傳",
      competencies: [
        { competencyTag: "first_read_process", status: "available", completedItems: 1, totalItems: 2, masteryRate: 50 },
        { competencyTag: "vocabulary", status: "available", completedItems: 3, totalItems: 5, masteryRate: 60 },
        { competencyTag: "syntax", status: "unavailable", completedItems: 0, totalItems: 0, masteryRate: null },
        { competencyTag: "comprehension", status: "available", completedItems: 2, totalItems: 4, masteryRate: 50 },
      ],
    },
    {
      lessonId: "lesson-b",
      lessonTitle: "蘇武傳",
      interestRating: 84,
      competencies: [
        { competencyTag: "first_read_process", status: "available", completedItems: 2, totalItems: 2, masteryRate: 100 },
        { competencyTag: "vocabulary", status: "available", completedItems: 1, totalItems: 2, masteryRate: 50 },
        { competencyTag: "syntax", status: "available", completedItems: 1, totalItems: 1, masteryRate: 100 },
        { competencyTag: "comprehension", status: "available", completedItems: 0, totalItems: 2, masteryRate: 0 },
      ],
    },
  ],
};

let importSequence = 0;

function jsonResponse(value, status = 200) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() { return value; },
  };
}

function canvasContext() {
  return new Proxy({}, {
    get(target, key) {
      if (!(key in target)) target[key] = () => {};
      return target[key];
    },
    set(target, key, value) {
      target[key] = value;
      return true;
    },
  });
}

async function waitFor(predicate, message) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(message);
}

async function loadStar(formativeResponse) {
  const { window, document } = parseHTML(STAR_HTML);
  document.getElementById("gl").getContext = () => canvasContext();
  const lessonSelect = document.getElementById("mastery-lesson");
  let selectedLesson = "";
  Object.defineProperty(lessonSelect, "value", {
    configurable: true,
    get() { return selectedLesson || this.querySelector("option")?.value || ""; },
    set(value) { selectedLesson = String(value); },
  });

  const location = { href: "https://yw.bdfz.net/star.html", pathname: "/star.html", hash: "" };
  const history = { replaceState() {} };
  const matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const requestAnimationFrame = () => 1;
  const fetch = async (url) => {
    const target = String(url);
    if (target === "data/manifest.json") return jsonResponse(manifest);
    if (target === "/api/reading/constellation") return jsonResponse(constellation);
    if (target === "/api/reading/formative-mastery") return formativeResponse;
    throw new Error(`unexpected fetch: ${target}`);
  };

  Object.assign(window, { location, history, matchMedia, requestAnimationFrame, fetch });
  const globals = {
    window,
    document,
    location,
    history,
    matchMedia,
    requestAnimationFrame,
    fetch,
    innerWidth: 1280,
    innerHeight: 800,
    devicePixelRatio: 1,
    addEventListener: window.addEventListener.bind(window),
    Event: window.Event,
  };
  const previous = new Map();
  for (const [key, value] of Object.entries(globals)) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }

  await import(`${STAR_JS.href}?test=${importSequence += 1}`);
  return {
    document,
    window,
    cleanup() {
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    },
  };
}

test("null mastery stays unavailable and lesson switching follows the active denominator", async () => {
  const ui = await loadStar(jsonResponse(availablePayload));
  try {
    await waitFor(
      () => !ui.document.getElementById("mastery-content").hidden,
      "formative mastery UI did not hydrate",
    );

    assert.equal(ui.document.getElementById("stat-lessons").textContent, "7", "legacy constellation remains populated");
    assert.equal(ui.document.getElementById("mastery-toggle-status").textContent, "9/18");
    assert.match(ui.document.getElementById("mastery-denominator").textContent, /目前啟用題組/);
    assert.equal(ui.document.getElementById("mastery-policy").textContent, "affectsGrowthScore=false · affectsAPlus=false");

    const syntax = ui.document.querySelector('#mastery-dimensions [data-competency="syntax"]');
    assert.equal(syntax.dataset.status, "unavailable");
    assert.equal(syntax.querySelector("strong").textContent, "未提供");
    assert.doesNotMatch(syntax.textContent, /0%/, "null must never be formatted as zero percent");
    assert.equal(ui.document.querySelector('#mastery-radar-values [data-competency="syntax"]'), null);
    assert.equal(ui.document.querySelector("#mastery-radar-values .mastery-value-shape"), null, "partial data must not close a false zero-valued polygon");

    const vocabulary = ui.document.querySelector('#mastery-dimensions [data-competency="vocabulary"]');
    assert.match(vocabulary.textContent, /3 \/ 5/, "first lesson uses its current active denominator");
    assert.equal(ui.document.getElementById("mastery-interest-value").textContent, "尚無已同步評價");
    assert.equal(ui.document.getElementById("mastery-interest-track").hidden, true);

    const selector = ui.document.getElementById("mastery-lesson");
    selector.value = "lesson-b";
    selector.dispatchEvent(new ui.window.Event("change"));
    const switchedVocabulary = ui.document.querySelector('#mastery-dimensions [data-competency="vocabulary"]');
    assert.match(switchedVocabulary.textContent, /1 \/ 2/, "switching lessons swaps in the selected lesson denominator");
    assert.equal(ui.document.getElementById("mastery-interest-value").textContent, "84 / 100");
    assert.equal(ui.document.getElementById("mastery-interest-track").hidden, false);
    assert.equal(ui.document.getElementById("mastery-interest-fill").style.width, "84%");
  } finally {
    ui.cleanup();
  }
});

test("503 fails closed without changing the existing three-word constellation", async () => {
  const ui = await loadStar(jsonResponse({ error: "unavailable" }, 503));
  try {
    await waitFor(
      () => ui.document.getElementById("mastery-toggle-status").textContent === "暫不可用",
      "503 state did not settle",
    );
    assert.equal(ui.document.getElementById("mastery-content").hidden, true);
    assert.match(ui.document.getElementById("mastery-state").textContent, /沒有把缺失資料當成 0/);
    assert.equal(ui.document.getElementById("stat-lessons").textContent, "7");
    assert.equal(ui.document.getElementById("stat-words").textContent, "21");
  } finally {
    ui.cleanup();
  }
});
