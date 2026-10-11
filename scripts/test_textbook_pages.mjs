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
  legacyTraceLabel,
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
// Release mode (YW_RELEASE_CHECK=1): the catalog copy must be present, so the
// resolution check below fails instead of being skipped.
const RELEASE_CHECK = process.env.YW_RELEASE_CHECK === "1";
const overrideFile = JSON.parse(readFileSync(resolve(ROOT, "scripts/textbook_page_overrides.v1.json"), "utf8"));
const absentFile = JSON.parse(readFileSync(resolve(ROOT, "scripts/textbook_absent_lessons.v1.json"), "utf8"));
const manifest = JSON.parse(readFileSync(resolve(ROOT, "site/data/manifest.json"), "utf8"));
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
  let overridden = 0;
  let outside = 0;
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
        assert.equal(plate.fromOverride, entry.pages[index].override === true);
        assert.doesNotMatch(`${plate.src}${plate.thumb}${plate.viewer}`, /rdfzer|\/pages\//);
      }
    }
    // Each legacy page is accounted for exactly once.
    const seen = new Map();
    for (const page of entry.pages) for (const index of page.legacy) seen.set(index, (seen.get(index) || 0) + 1);
    for (const index of entry.unmappedLegacy) seen.set(index, (seen.get(index) || 0) + 1);
    for (const index of entry.legacyOutsideOverride || []) seen.set(index, (seen.get(index) || 0) + 1);
    for (const index of entry.legacyNotShown || []) seen.set(index, (seen.get(index) || 0) + 1);
    if (entry.status === "override") {
      // The page list is exactly the proven range; pages the exact rows did not
      // give are marked as coming from the override, and only those.
      const range = entry.override;
      assert.equal(range.basis, "current-edition-text-layer");
      assert.deepEqual(entry.pages.map((page) => page.pdf), Array.from({ length: range.lastPdf - range.firstPdf + 1 }, (_, i) => range.firstPdf + i));
      for (const page of entry.pages) {
        assert.equal(page.override === true, !entry.exactRowPages.includes(page.pdf), `${lesson.id}: override mark on PDF ${page.pdf}`);
        if (page.override) assert.deepEqual([page.legacy, page.basis], [[], range.basis]);
      }
      assert.notDeepEqual(entry.pages.map((page) => page.pdf), entry.exactRowPages);
      overridden += 1;
    } else {
      assert.ok(entry.pages.every((page) => page.override === undefined));
      if (entry.status !== "absent") assert.equal(entry.exactRowPages, undefined);
      assert.equal(entry.legacyOutsideOverride, undefined);
    }
    assert.deepEqual([...seen.keys()].sort((a, b) => a - b), [...legacy].sort((a, b) => a - b), `${lesson.id}: legacy pages`);
    assert.ok([...seen.values()].every((count) => count === 1));
    resolved += entry.pages.reduce((sum, page) => sum + page.legacy.length, 0);
    unmapped += entry.unmappedLegacy.length;
    outside += (entry.legacyOutsideOverride || []).length + (entry.legacyNotShown || []).length;
    const pdfPages = entry.pages.map((page) => page.pdf);
    assert.deepEqual(pdfPages, [...new Set(pdfPages)].sort((a, b) => a - b), `${lesson.id}: PDF pages increase`);
  }
  assert.equal(legacyPages, 742);
  assert.equal(resolved + unmapped + outside, 742);
  assert.equal(unmapped, 13);
  assert.equal(overridden, overrideFile.overrides.length);
  assert.deepEqual(
    Object.keys(data.lessons).filter((id) => data.lessons[id].status === "override").sort(),
    overrideFile.overrides.map((item) => item.lessonId).sort(),
  );
  assert.equal(Object.keys(data.lessons).length, withPages);
  assert.deepEqual(data.counts, {
    lessons: withPages,
    mapped: Object.values(data.lessons).filter((entry) => entry.status === "mapped").length,
    partial: Object.values(data.lessons).filter((entry) => entry.status === "partial").length,
    none: Object.values(data.lessons).filter((entry) => entry.status === "none").length,
    override: Object.values(data.lessons).filter((entry) => entry.status === "override").length,
    absent: Object.values(data.lessons).filter((entry) => entry.status === "absent").length,
    legacyPages: 742,
    unmappedLegacyPages: unmapped,
    pages: Object.values(data.lessons).reduce((sum, entry) => sum + entry.pages.length, 0),
    overridePages: Object.values(data.lessons).reduce((sum, entry) => sum + entry.pages.filter((page) => page.override).length, 0),
  });
});

test("a lesson absent from the current edition shows no page, never another lesson's", () => {
  const listed = absentFile.lessons.map((item) => item.lessonId).sort();
  assert.deepEqual(listed, ["lesson-1522", "lesson-1569", "lesson-1572"]);
  assert.deepEqual(Object.keys(data.lessons).filter((id) => data.lessons[id].status === "absent").sort(), listed);
  assert.equal(absentFile.catalogRelease, data.catalogRelease);
  for (const item of absentFile.lessons) {
    // Evidence: not an entry of the volume's contents, title on no page.
    assert.ok(item.contentsEntry === false && item.titleLinePages.length === 0 && item.titlesChecked.length > 0, item.lessonId);
    const entry = data.lessons[item.lessonId];
    assert.deepEqual(entry.pages, [], item.lessonId);
    assert.ok(entry.absent.basis && entry.absent.verifiedOn, item.lessonId);
    for (const large of [false, true]) {
      const plates = lessonPlates(data, item.lessonId, { large });
      assert.equal(plates.state, "none", item.lessonId);
      assert.equal(plates.pages.length, 0, item.lessonId);
      assert.match(plates.notes[0], /^本課不在現行版教材中/, item.lessonId);
      assert.doesNotMatch(plates.notes.join(""), /沒有對應頁/, item.lessonId);
    }
    // Even if the data were to carry pages for it, none is shown.
    const forced = structuredClone(data);
    forced.lessons[item.lessonId].pages = [{ pdf: 58, legacy: [56], basis: "text-anchor" }];
    assert.equal(lessonPlates(forced, item.lessonId).pages.length, 0, item.lessonId);
  }
  // 《聽聽那冷雨》 used to show 《秦腔》's pages 58-60: now nothing, and no pointer.
  assert.deepEqual(data.lessons["lesson-1572"].exactRowPages, [58, 59, 60]);
  assert.equal(lessonPlates(data, "lesson-1572").samePosition, null);
  // 《怜悯是人的天性》: PDF 38 is only pointed to as the same position, content revised.
  const pointed = lessonPlates(data, "lesson-1522");
  assert.deepEqual(pointed.samePosition, { pdf: 38, viewer: plateViewerUrl(data, "xuanbi-zhong", 38) });
  assert.match(pointed.notes.join(""), /相同位置為 PDF 第 38 頁（內容已修訂）/);
  assert.equal(lessonPlates(data, "lesson-1569").samePosition, null);
  // Absent is distinct from unmapped.
  assert.equal(Object.values(data.lessons).filter((entry) => entry.status === "none").length, 0);
  assert.ok(Object.values(data.lessons).every((entry) => entry.status === "absent" || entry.absent === undefined));
});

test("overrides replace inherited wrong ranges and never drop a page without naming its owner", () => {
  // Inherited wrong pages are replaced by the proven range ...
  const expected = {
    "lesson-1570": [52, 53, 54, 55],
    "lesson-1722-p2": [148], "lesson-1722-p3": [149], "lesson-1722-p4": [150],
    "lesson-1755-p2": [163], "lesson-1755-p3": [164], "lesson-1755-p4": [165],
    "lesson-1705-p2": [68], "lesson-1705-p3": [69, 70, 71], "lesson-1711-p2": [92, 93, 94],
    "lesson-1719-p2": [127, 128, 129], "lesson-1743-p2": [94, 95, 96, 97],
    "lesson-1692-p3": [13, 14], "lesson-1692-p4": [14, 15, 16, 17, 18],
    // ... a page the exact rows skipped inside a lesson is shown ...
    "lesson-1520": [20, 21, 22, 23, 24, 25, 26, 27], "lesson-1581": [91, 92, 93],
    // ... a missing last page is added, a unit title page goes to its own lesson.
    "lesson-1697": [39, 40, 41, 42, 43, 44, 45], "lesson-1720": [130, 131],
    "lesson-1721": Array.from({ length: 15 }, (_, i) => 132 + i),
  };
  for (const [id, pdfPages] of Object.entries(expected)) {
    assert.deepEqual(data.lessons[id].pages.map((page) => page.pdf), pdfPages, id);
    const plates = lessonPlates(data, id);
    assert.doesNotMatch(plates.notes.join(""), /沒有對應頁|不在現行版/, id);
    assert.match(plates.notes.join(""), /依現行版教材的目錄與課題位置校定/, id);
  }
  assert.deepEqual(data.lessons["lesson-1520"].pages.filter((page) => page.override).map((page) => page.pdf), [23]);

  // A numbered lesson keeps its later texts: no override cuts these.
  const whole = {
    "lesson-1714": [104, 109], "lesson-1736": [53, 61], "lesson-1742": [87, 91],
    "lesson-1747": [114, 125], "lesson-1748": [126, 141], "lesson-1752": [151, 154], "lesson-1546": [131, 132],
  };
  for (const [id, [first, last]] of Object.entries(whole)) {
    const entry = data.lessons[id];
    assert.notEqual(entry.status, "override", id);
    assert.deepEqual([entry.pages[0].pdf, entry.pages.at(-1).pdf, entry.pages.length], [first, last, last - first + 1], id);
  }

  // Every page an override drops from the exact rows names the other yw lesson
  // that owns it, and that lesson shows the page when it shows pages at all.
  const lessonIds = new Set(lessons.map((lesson) => lesson.id));
  let dropping = 0;
  for (const [id, entry] of Object.entries(data.lessons)) {
    if (entry.status !== "override") continue;
    const shown = new Set(entry.pages.map((page) => page.pdf));
    const dropped = entry.exactRowPages.filter((pdf) => !shown.has(pdf));
    assert.deepEqual(entry.override.removedPages.map((item) => item.pdf), dropped, id);
    if (dropped.length) dropping += 1;
    for (const item of entry.override.removedPages) {
      assert.ok(lessonIds.has(item.ownerLesson) && item.ownerLesson !== id, `${id}: owner of PDF ${item.pdf}`);
      const owner = data.lessons[item.ownerLesson];
      if (owner) assert.ok(owner.pages.some((page) => page.pdf === item.pdf), `${id}: ${item.ownerLesson} shows PDF ${item.pdf}`);
    }
  }
  assert.ok(dropping > 0);
  for (const item of overrideFile.overrides) {
    assert.ok(item.titleLine && item.nextTitleLine && item.reason && item.pdfSha256 === data.books[item.book].pdfSha256, item.lessonId);
    assert.ok(item.nextTitlePdf === item.lastPdf + 1 ? item.nextTitleOpensItsPage === true : item.nextTitlePdf === item.lastPdf, item.lessonId);
  }
  assert.equal(overrideFile.catalogRelease, data.catalogRelease);

  // A lesson that still skips a page inside its range must say that text is missing.
  const skipping = structuredClone(data);
  skipping.lessons["lesson-1523"] = { ...data.lessons["lesson-1523"], status: "mapped", unlistedBetween: [36] };
  assert.match(lessonPlates(skipping, "lesson-1523").notes.join(""), /也屬本課範圍，但此處未顯示.*以免漏讀/);
  assert.equal(Object.values(data.lessons).filter((entry) => entry.unlistedBetween).length, 0, "no lesson currently skips an inside page");

  assert.equal(lessonPlates(data, "lesson-1755-p4").pages[0].label, "第 158 頁");
  assert.equal(startPlateLabel(data, "lesson-1523"), "頁 29");
  assert.equal(startPlateLabel(data, "lesson-1569"), "");
});

test("the page-opened trace records exactly what the accepted source records, for every displayed lesson", () => {
  // What base 7bfe60c does on opening the dialog (app.js preparePages/openPages):
  //   pages = pageImages, else the matched contextPageImages; if none, nothing is recorded;
  //   resourceRef = pages[index]?.label || String(index + 1), with index 0.
  const baseValue = (lesson, index = 0) => {
    const direct = lesson.textbook?.pageImages || [];
    const context = (lesson.textbook?.contextPageImages || []).filter((page) => page.matched);
    const pages = direct.length ? direct : context;
    return pages.length ? (pages[index]?.label || String(index + 1)) : null;
  };
  const byId = new Map(lessons.map((lesson) => [lesson.id, lesson]));
  let displayed = 0;
  for (const meta of manifest.lessons) {
    const lesson = byId.get(meta.id);
    const base = baseValue(lesson);
    // The candidate opens the dialog (and records) exactly when the lesson is in the page data.
    assert.equal(Boolean(data.lessons[meta.id]), base !== null, `${meta.id}: recorded or not`);
    if (base === null) continue;
    displayed += 1;
    assert.equal(legacyTraceLabel(lesson, 0), base, meta.id);
    for (let index = 0; index < lesson.textbook.pageImages.length; index += 1) {
      assert.equal(legacyTraceLabel(lesson, index), baseValue(lesson, index), `${meta.id} #${index}`);
    }
  }
  assert.equal(displayed, 185);
  assert.equal(legacyTraceLabel(byId.get("lesson-1522")), "p29");
  assert.equal(legacyTraceLabel({ textbook: { pages: [] } }, 2), "3");
  const app = read("site/assets/app.js");
  assert.match(app, /resourceRef: state\.plateApi\.legacyTraceLabel\(state\.current, index\),/);
  // Recorded on every open, as before: no early return between opening and recording.
  const open = app.slice(app.indexOf("function openPages("), app.indexOf("function resourcePreviewUrl("));
  assert.doesNotMatch(open.slice(open.indexOf("showModal()")), /return;/);
});

test("address builders refuse anything outside the page data", () => {
  assert.equal(plateUrl(data, "xuanbi-zhong", 38, 960), "https://sun.bdfz.net/files/page/cn-da694670-f25b-46a0-9c3f-a31f5a2f131a-efe51d7a6773/efe51d7a6773/38.webp?w=960");
  for (const [book, page, width] of [
    ["xuanbi-zhong", 0, 960], ["xuanbi-zhong", 139, 960], ["xuanbi-zhong", 1.5, 960], ["xuanbi-zhong", "38", 960],
    ["xuanbi-zhong", 38, 800], ["unknown", 1, 960], ["__proto__", 1, 960],
  ]) assert.equal(plateUrl(data, book, page, width), "");
  assert.equal(plateViewerUrl(data, "unknown", 1), "");
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
  assert.doesNotMatch(app, /page\.src\b[^;]*=/);
  // The sidebar keeps the previous `p<n>` only while the page data is not loaded.
  assert.match(app, /state\.plateApi\s*\?\s*state\.plateApi\.startPlateLabel\(state\.plateData, lesson\.id\)\s*:\s*\(legacyStart \? `p\$\{legacyStart\}` : ""\)/);
  assert.doesNotMatch(app, /pdf:\$\{|plateReference|traceLabel\b(?!\()/);
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

const catalogPresent = existsSync(resolve(CATALOG, "catalog.json"));
test("the page data equals a fresh resolution of the catalog release", {
  skip: catalogPresent || RELEASE_CHECK ? false : `catalog copy not present at ${CATALOG} (set YW_RELEASE_CHECK=1 to make this a failure)`,
}, () => {
  assert.ok(catalogPresent, `release check needs the SUN catalog release copy (YW_SUN_CATALOG); none at ${CATALOG}`);
  assert.equal(renderTextbookPages(CATALOG), read("site/data/textbook-pages.v1.json"));
});

test("the resolver refuses an override that drops exact-row pages without a named owner", {
  skip: catalogPresent || RELEASE_CHECK ? false : `catalog copy not present at ${CATALOG}`,
}, () => {
  assert.ok(catalogPresent, `release check needs the SUN catalog release copy (YW_SUN_CATALOG); none at ${CATALOG}`);
  const tamper = (edit) => {
    const file = structuredClone(overrideFile);
    edit(file);
    return () => renderTextbookPages(CATALOG, { overrideFile: file });
  };
  const dropper = overrideFile.overrides.find((item) => item.lessonId === "lesson-1720");
  assert.deepEqual(dropper.removedPages, [{ pdf: 132, ownerLesson: "lesson-1721" }]);
  const at = (file) => file.overrides.find((item) => item.lessonId === "lesson-1720");
  assert.throws(tamper((file) => { at(file).removedPages = []; }), /without naming the lesson that owns/);
  assert.throws(tamper((file) => { at(file).removedPages[0].ownerLesson = "lesson-1720"; }), /without naming the lesson that owns/);
  assert.throws(tamper((file) => { at(file).removedPages[0].ownerLesson = "lesson-0"; }), /without naming the lesson that owns/);
  // Named owner that does not show the page.
  assert.throws(tamper((file) => { at(file).removedPages[0].ownerLesson = "lesson-1719-p1"; }), /does not show it/);
  // The cut the second review rejected: 《促织》 keeps 《变形记》's pages unless an owner is named.
  assert.throws(tamper((file) => {
    file.overrides.push({ ...dropper, lessonId: "lesson-1748", book: "bixiu-xia", pdfSha256: data.books["bixiu-xia"].pdfSha256, firstPdf: 126, lastPdf: 129, nextTitlePdf: 130, nextTitleOpensItsPage: true, removedPages: [] });
  }), /without naming the lesson that owns/);
  // An absent lesson cannot be given pages by an override.
  assert.throws(tamper((file) => {
    file.overrides.push({ ...dropper, lessonId: "lesson-1572", book: "xuanbi-xia", pdfSha256: data.books["xuanbi-xia"].pdfSha256, firstPdf: 58, lastPdf: 60, nextTitlePdf: 61, removedPages: [] });
  }), /absent from the current edition cannot have an override/);
});
