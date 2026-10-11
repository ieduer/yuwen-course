#!/usr/bin/env node
// Textbook plates come from sun.bdfz.net through data/textbook-pages.v1.json.
// (Byte identity of the scoring inputs for the phase-1 release is proven
// separately by scripts/test_textbook_pages_phase1_identity.mjs.)

import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  PLATE_RETRY_MS,
  THUMBNAIL_CONCURRENCY,
  createPlateLoader,
  createThumbnailQueue,
  lessonPlates,
  plateReference,
  plateRetryDelay,
  plateUrl,
  plateViewerUrl,
  startPlateLabel,
  validTextbookPages,
} from "../site/assets/textbook-pages.js";
import { renderTextbookPages } from "./resolve_textbook_pages.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const DEFAULT_CATALOG = "/private/tmp/cf-task-sun-consolidation-20261010/catalog-release/20261011T015939Z-24b58ca8";
const CATALOG = process.env.YW_SUN_CATALOG || DEFAULT_CATALOG;
const read = (relative) => readFileSync(resolve(ROOT, relative), "utf8");
const data = JSON.parse(read("site/data/textbook-pages.v1.json"));
const lessonFiles = readdirSync(resolve(ROOT, "site/data/lessons")).filter((name) => name.endsWith(".json")).sort();
const lessons = lessonFiles.map((name) => JSON.parse(read(`site/data/lessons/${name}`)));

const SHIPPED_CODE = [
  "site/assets/app.js",
  "site/assets/textbook-pages.js",
  "site/assets/styles.css",
  "site/index.html",
  "site/_headers",
  "site/data/textbook-pages.v1.json",
];
const PLATE = /^https:\/\/sun\.bdfz\.net\/files\/page\/(cn-[0-9a-f-]{36}-([0-9a-f]{12}))\/\2\/([1-9]\d{0,3})\.webp\?w=(240|960|1440)$/;

test("the page data is one valid release-bound document", () => {
  assert.ok(validTextbookPages(data));
  assert.match(data.catalogRelease, /^\d{8}T\d{6}Z-[0-9a-f]{8}$/);
  // The release-site builder rewrites URL-shaped strings in JSON; the page data
  // must hold none, so the staged copy means exactly what the source means.
  assert.doesNotMatch(read("site/data/textbook-pages.v1.json"), /https?:|\/\//);
  assert.deepEqual(Object.keys(data.books).sort(), ["bixiu-shang", "bixiu-xia", "xuanbi-shang", "xuanbi-xia", "xuanbi-zhong"]);
  for (const book of Object.values(data.books)) {
    assert.equal(book.pdfSha256.slice(0, 12), book.pdfSha12);
    assert.ok(book.editionId.endsWith(`-${book.pdfSha12}`));
  }
});

test("every displayed lesson page resolves to a SUN plate or is explicitly unmapped", () => {
  let legacyPages = 0;
  let resolved = 0;
  let unmapped = 0;
  let withPages = 0;
  for (const lesson of lessons) {
    const legacy = lesson.textbook?.pages || [];
    assert.equal((lesson.textbook?.pageImages || []).length, legacy.length, `${lesson.id}: displayed pages`);
    const entry = data.lessons[lesson.id];
    if (!legacy.length) {
      assert.equal(entry, undefined, `${lesson.id} has no textbook pages`);
      assert.equal(lessonPlates(data, lesson.id).state, "absent");
      continue;
    }
    withPages += 1;
    legacyPages += legacy.length;
    assert.ok(entry, `${lesson.id} is missing from the page data`);
    assert.equal(entry.book, lesson.blockId);
    for (const large of [false, true]) {
      const plates = lessonPlates(data, lesson.id, { large });
      assert.equal(plates.pages.length, entry.pages.length);
      assert.equal(plates.state, entry.pages.length ? "ready" : "none");
      for (const [index, plate] of plates.pages.entries()) {
        const full = PLATE.exec(plate.src);
        const thumb = PLATE.exec(plate.thumb);
        assert.ok(full && thumb, `${lesson.id}: plate address`);
        assert.equal(full[1], data.books[entry.book].editionId);
        assert.equal(Number(full[3]), entry.pages[index].pdf);
        assert.equal(full[4], large ? "1440" : "960");
        assert.equal(thumb[4], "240");
        assert.equal(thumb[3], full[3]);
        assert.ok(Number(full[3]) <= data.books[entry.book].pdfPages);
        assert.equal(plate.viewer, `https://sun.bdfz.net/?view=pdf&edition=${full[1]}&p=${full[3]}`);
        assert.equal(plate.reference, `pdf:${full[2]}:${full[3]}`);
        assert.doesNotMatch(`${plate.src}${plate.thumb}${plate.viewer}`, /rdfzer|\/pages\//);
      }
    }
    // Each legacy page is accounted for exactly once.
    const seen = new Map();
    for (const page of entry.pages) for (const index of page.legacy) seen.set(index, (seen.get(index) || 0) + 1);
    for (const index of entry.unmappedLegacy) seen.set(index, (seen.get(index) || 0) + 1);
    if (entry.status === "override") {
      assert.deepEqual(entry.unmappedLegacy, legacy);
      assert.ok(entry.pages.every((page) => page.legacy.length === 0 && page.basis === entry.override.basis));
    }
    assert.deepEqual([...seen.keys()].sort((a, b) => a - b), [...legacy].sort((a, b) => a - b), `${lesson.id}: legacy pages`);
    assert.ok([...seen.values()].every((count) => count === 1));
    resolved += entry.pages.reduce((sum, page) => sum + page.legacy.length, 0);
    unmapped += entry.unmappedLegacy.length;
    const pdfPages = entry.pages.map((page) => page.pdf);
    assert.deepEqual(pdfPages, [...new Set(pdfPages)].sort((a, b) => a - b), `${lesson.id}: PDF pages increase`);
  }
  assert.equal(legacyPages, 742);
  assert.equal(resolved + unmapped, 742);
  assert.equal(Object.keys(data.lessons).length, withPages);
  assert.deepEqual(data.counts, {
    lessons: withPages,
    mapped: Object.values(data.lessons).filter((entry) => entry.status === "mapped").length,
    partial: Object.values(data.lessons).filter((entry) => entry.status === "partial").length,
    none: Object.values(data.lessons).filter((entry) => entry.status === "none").length,
    override: Object.values(data.lessons).filter((entry) => entry.status === "override").length,
    legacyPages: 742,
    unmappedLegacyPages: unmapped,
    pages: Object.values(data.lessons).reduce((sum, entry) => sum + entry.pages.length, 0),
  });
});

test("unmapped, revised and override lessons say so instead of showing a wrong page", () => {
  const none = lessonPlates(data, "lesson-1569");
  assert.equal(none.state, "none");
  assert.equal(none.pages.length, 0);
  assert.match(none.notes.join(""), /沒有對應頁/);

  const revised = lessonPlates(data, "lesson-1522");
  assert.deepEqual(revised.pages.map((page) => [page.pdf, page.revised]), [[38, true]]);
  assert.match(revised.notes.join(""), /另有 4 頁/);

  const override = data.lessons["lesson-1570"];
  assert.equal(override.status, "override");
  assert.equal(override.override.basis, "current-edition-text-layer");
  assert.deepEqual(override.pages.map((page) => page.pdf), [52, 53, 54, 55]);
  assert.deepEqual(override.unmappedLegacy, [53]);
  assert.match(lessonPlates(data, "lesson-1570").notes.join(""), /現行版教材/);
  assert.equal(Object.values(data.lessons).filter((entry) => entry.status === "override").length, 1);

  // 《人应当坚持正义》 resolves through its own exact rows; it needs no override.
  assert.equal(data.lessons["lesson-1523"].status, "mapped");
  assert.deepEqual(data.lessons["lesson-1523"].pages.map((page) => page.pdf), [34, 35, 36, 37, 38]);

  const partial = lessonPlates(data, "lesson-1755-p4");
  assert.equal(partial.pages.length, 1);
  assert.equal(partial.pages[0].label, "PDF 第 167 頁", "no printed label unless verified");
  assert.equal(startPlateLabel(data, "lesson-1523"), "頁 29");
  assert.equal(startPlateLabel(data, "lesson-1569"), "");
});

test("address builders refuse anything outside the page data", () => {
  assert.equal(plateUrl(data, "xuanbi-zhong", 38, 960), "https://sun.bdfz.net/files/page/cn-da694670-f25b-46a0-9c3f-a31f5a2f131a-efe51d7a6773/efe51d7a6773/38.webp?w=960");
  for (const [book, page, width] of [
    ["xuanbi-zhong", 0, 960], ["xuanbi-zhong", 139, 960], ["xuanbi-zhong", 1.5, 960], ["xuanbi-zhong", "38", 960],
    ["xuanbi-zhong", 38, 800], ["unknown", 1, 960], ["__proto__", 1, 960],
  ]) assert.equal(plateUrl(data, book, page, width), "");
  assert.equal(plateViewerUrl(data, "unknown", 1), "");
  assert.equal(plateReference(data, "xuanbi-zhong", 999), "");
  assert.equal(lessonPlates(null, "lesson-1523").state, "unavailable");
  assert.equal(lessonPlates({ ...data, imageHost: "example.org" }, "lesson-1523").state, "unavailable");
  const tampered = structuredClone(data);
  tampered.books["xuanbi-zhong"].editionId = "cn-da694670-f25b-46a0-9c3f-a31f5a2f131a-000000000000";
  assert.equal(lessonPlates(tampered, "lesson-1523").state, "unavailable");
});

test("nothing shipped can request a legacy textbook page image", () => {
  for (const relative of SHIPPED_CODE) {
    const source = read(relative);
    assert.doesNotMatch(source, /img\.rdfzer\.com/, `${relative} names the legacy image host`);
    assert.doesNotMatch(source, /1082bfb4a71a|9535dacc9628|47e3538c5b76|0433798ca156|822b23a796e3/, `${relative} names a legacy key`);
    assert.doesNotMatch(source, /\/pages\/|\/p\$\{|p\d+\.webp/, `${relative} builds a legacy page path`);
  }
  const allCode = [
    ...readdirSync(resolve(ROOT, "site/assets")).filter((name) => /\.(js|css)$/.test(name)).map((name) => `site/assets/${name}`),
    ...readdirSync(resolve(ROOT, "site")).filter((name) => /\.(js|html)$/.test(name)).map((name) => `site/${name}`),
  ];
  for (const relative of allCode) {
    const source = read(relative);
    assert.doesNotMatch(source, /img\.rdfzer\.com/, `${relative} names the legacy image host`);
    assert.doesNotMatch(source, /imageBase|pageImages|contextPageImages/, `${relative} reads a legacy image field`);
  }
  const app = read("site/assets/app.js");
  assert.doesNotMatch(app, /page\.src\b[^;]*=|textbookStartPage|textbook\?\.startPage/);
  assert.match(app, /fetchJson\("data\/textbook-pages\.v1\.json"/);
  assert.match(app, /data-plate-thumb="\$\{esc\(page\.thumb\)\}"/);
  assert.doesNotMatch(app, /<img src="\$\{esc\(page\.(src|thumb)\)\}"/, "thumbnails must not load eagerly");
});

function fakeImage() {
  const listeners = new Map();
  const attributes = new Map();
  const image = {
    hidden: true,
    dataset: {},
    requests: [],
    addEventListener(type, handler) { listeners.set(type, [...(listeners.get(type) || []), handler]); },
    removeEventListener(type, handler) { listeners.set(type, (listeners.get(type) || []).filter((item) => item !== handler)); },
    getAttribute(name) { return attributes.get(name) ?? null; },
    removeAttribute(name) { attributes.delete(name); },
    emit(type) { for (const handler of [...(listeners.get(type) || [])]) handler(); },
  };
  Object.defineProperty(image, "src", {
    get() { return attributes.get("src") || ""; },
    set(value) { attributes.set("src", value); image.requests.push(value); },
  });
  return image;
}

function fakeTimers() {
  const timers = new Map();
  let next = 1;
  return {
    timers,
    setTimer(callback, delay) { timers.set(next, { callback, delay }); return next++; },
    clearTimer(id) { timers.delete(id); },
    fire() {
      const [id, timer] = [...timers.entries()][0];
      timers.delete(id);
      timer.callback();
      return timer.delay;
    },
  };
}

test("a failed plate retries at about 3, 6 and 12 s, then reports a failure distinct from 'no mapping'", () => {
  assert.deepEqual([...PLATE_RETRY_MS], [3000, 6000, 12000]);
  assert.deepEqual([0, 1, 2, 3].map((attempt) => plateRetryDelay(attempt, () => 0)), [3000, 6000, 12000, null]);
  assert.deepEqual([0, 1, 2].map((attempt) => plateRetryDelay(attempt, () => 1)), [3750, 7500, 15000]);

  const image = fakeImage();
  const clock = fakeTimers();
  const states = [];
  let hidden = false;
  const loader = createPlateLoader({
    image, onState: (state) => states.push(state), isHidden: () => hidden,
    setTimer: clock.setTimer, clearTimer: clock.clearTimer, random: () => 0,
  });
  loader.show("https://sun.bdfz.net/a");
  assert.equal(image.hidden, false);
  const delays = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    image.emit("error");
    assert.equal(clock.timers.size, 1);
    delays.push(clock.fire());
  }
  assert.deepEqual(delays, [3000, 6000, 12000]);
  assert.equal(image.requests.length, 4, "one request plus three retries");
  image.emit("error");
  assert.equal(clock.timers.size, 0);
  assert.equal(states.at(-1), "failed");
  assert.equal(image.requests.length, 4, "no request after giving up");

  // Showing another page or closing cancels a pending retry for good.
  loader.show("https://sun.bdfz.net/b");
  image.emit("error");
  assert.equal(clock.timers.size, 1);
  loader.cancel();
  assert.equal(clock.timers.size, 0);
  const before = image.requests.length;
  image.emit("error");
  assert.equal(image.requests.length, before);
  assert.equal(clock.timers.size, 0);

  // A hidden tab parks the retry until it is visible again.
  loader.show("https://sun.bdfz.net/c");
  image.emit("error");
  hidden = true;
  clock.fire();
  const parked = image.requests.length;
  loader.resume();
  assert.equal(image.requests.length, parked, "still hidden");
  hidden = false;
  loader.resume();
  assert.equal(image.requests.length, parked + 1);
  image.emit("load");
  assert.equal(states.at(-1), "loaded");

  // No page: no request at all.
  const requests = image.requests.length;
  loader.show("");
  assert.equal(image.hidden, true);
  assert.equal(image.requests.length, requests);
  assert.equal(states.at(-1), "empty");

  const app = read("site/assets/app.js");
  assert.match(app, /圖頁暫時無法載入/);
  assert.match(app, /pageDialog\.addEventListener\("close", closePages\)/);
  assert.match(read("site/assets/textbook-pages.js"), /沒有對應頁/);
});

test("thumbnails load at most two at a time and stop when cancelled", () => {
  assert.equal(THUMBNAIL_CONCURRENCY, 2);
  const images = Array.from({ length: 6 }, (_, index) => {
    const image = fakeImage();
    image.dataset.plateThumb = `https://sun.bdfz.net/t${index}`;
    return image;
  });
  const started = () => images.filter((image) => image.requests.length).length;
  const queue = createThumbnailQueue();
  queue.load(images);
  assert.equal(started(), 2);
  images[0].emit("load");
  assert.equal(started(), 3);
  images[1].emit("error");
  assert.equal(images[1].getAttribute("src"), null);
  assert.equal(started(), 4);
  queue.cancel();
  images[2].emit("load");
  images[3].emit("load");
  assert.equal(started(), 4, "nothing starts after cancel");
});

test("the page data equals a fresh resolution of the catalog release", { skip: existsSync(resolve(CATALOG, "catalog.json")) ? false : `catalog copy not present at ${CATALOG}` }, () => {
  assert.equal(renderTextbookPages(CATALOG), read("site/data/textbook-pages.v1.json"));
});
