#!/usr/bin/env node
// 初中（七至九年級）教材閱讀: the data stays a page index into sun.bdfz.net, the page
// never talks to the yw API or My, and nothing in the senior learning system names it.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { parseHTML } from "linkedom";
import { validTextbookPages, lessonPlates, plateUrl, TEXTBOOK_IMAGE_ORIGIN } from "../site/assets/textbook-pages.js";
import { validJuniorData, entryTitle, pageSpan } from "../site/assets/junior.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const data = JSON.parse(read("site/data/junior-textbook-pages.v1.json"));
const version = (path) => createHash("sha256").update(readFileSync(new URL(`../site/${path}`, import.meta.url))).digest("hex").slice(0, 16);
const SUN_EDITIONS = {
  "g7-shang": "cn-8b9c7052-add4-4744-ab04-69d6c180d5d9-83735d49f455",
  "g7-xia": "cn-6b3ec445-9f7b-430c-a246-fc1903ca38b2-302ffb9346de",
  "g8-shang": "cn-4f64356a-8df7-4579-9400-e32c9a7f6718-818068db3c20",
  "g8-xia": "cn-8f907d12-14b5-44ba-b042-0ffbc46e085b-b03a898b410b",
  "g9-shang": "cn-a8b13ab7-7eef-4dc7-a3c7-8009ba65ce11-2771da91d637",
  "g9-xia": "cn-a45516ee-78ed-46f0-b88b-671174f2a2fe-22ca8f2e5c82",
};

test("junior data is a sun page index: six current editions, no scoring, no page text", () => {
  assert.ok(validTextbookPages(data));
  assert.ok(validJuniorData(data));
  assert.equal(data.track, "junior");
  assert.equal(data.scoring, "none");
  assert.equal(data.imageHost, "sun.bdfz.net");
  assert.deepEqual(data.order, Object.keys(SUN_EDITIONS));
  for (const [bookId, editionId] of Object.entries(SUN_EDITIONS)) {
    const book = data.books[bookId];
    assert.equal(book.editionId, editionId);
    assert.equal(book.pdfSha256.slice(0, 12), book.pdfSha12);
    assert.ok(editionId.endsWith(`-${book.pdfSha12}`));
    assert.ok(book.pdfDownload.startsWith(`/files/pdf/${editionId}/${book.pdfSha12}/`));
  }
  const allowed = new Set(["book", "status", "kind", "unit", "title", "pages", "basis", "number", "selfRead", "author", "subtitle", "label", "section", "parts"]);
  for (const [id, entry] of Object.entries(data.lessons)) {
    for (const key of Object.keys(entry)) assert.ok(allowed.has(key), `${id} carries ${key}`);
    assert.ok(entry.title.length <= 40, `${id} title looks like page text`);
    for (const page of entry.pages) assert.deepEqual(Object.keys(page).filter((k) => !["pdf", "printed"].includes(k)), []);
  }
  assert.equal(Object.keys(data.lessons).length, data.counts.entries);
  assert.equal(data.counts.kinds.lesson, 150);
});

test("each book's entries cover its contents pages once, in order, with no gap", () => {
  for (const bookId of data.order) {
    const pages = data.catalog[bookId].flatMap((id) => data.lessons[id].pages.map((page) => page.pdf));
    assert.deepEqual(pages, [...pages].sort((a, b) => a - b), `${bookId} order`);
    assert.equal(new Set(pages).size, pages.length, `${bookId} overlap`);
    for (let p = pages[0]; p <= pages.at(-1); p += 1) assert.ok(pages.includes(p), `${bookId} gap at ${p}`);
    assert.ok(pages.at(-1) <= data.books[bookId].pdfPages);
    for (const id of data.catalog[bookId]) {
      const entry = data.lessons[id];
      for (const part of entry.parts || []) if (part.pdf != null) assert.ok(entry.pages.some((page) => page.pdf === part.pdf), `${id} part outside its pages`);
      if (entry.kind !== "unit") assert.ok(entry.pages[0].printed, `${id} starts on a verified printed page`);
    }
  }
});

test("every plate address is sun.bdfz.net's own immutable page file", () => {
  let count = 0;
  for (const id of Object.keys(data.lessons)) {
    const plates = lessonPlates(data, id);
    assert.equal(plates.state, "ready");
    for (const page of plates.pages) {
      for (const url of [page.src, page.thumb, page.viewer, plateUrl(data, data.lessons[id].book, page.pdf, data.widths.large)]) {
        assert.equal(new URL(url).origin, TEXTBOOK_IMAGE_ORIGIN);
      }
      assert.match(page.src, /^https:\/\/sun\.bdfz\.net\/files\/page\/cn-[0-9a-f-]+\/[0-9a-f]{12}\/\d+\.webp\?w=960$/);
      count += 1;
    }
  }
  assert.equal(count, data.counts.pages);
});

test("labels keep the textbook's own wording", () => {
  const spring = data.lessons["junior-g7-shang-02"];
  assert.equal(spring.title, "春");
  assert.equal(spring.author, "朱自清");
  assert.equal(entryTitle(spring), "春");
  assert.equal(pageSpan(spring), "教材第 2–5 頁");
  assert.equal(entryTitle(data.lessons["junior-g7-shang-04"]), "* 雨的四季");
  assert.equal(pageSpan(data.lessons["junior-g7-shang-01"]), "單元頁");
  const writing = Object.values(data.lessons).find((entry) => entry.kind === "writing");
  assert.match(entryTitle(writing), /^写作 · /);
});

test("the junior track stays outside the senior learning system and My", () => {
  const ids = Object.keys(data.lessons);
  const senior = [
    read("site/dialogue-curriculum/index.json"),
    read("site/data/learning-manifest.json"),
    read("site/data/lesson-competency-manifest.json"),
    read("site/app-content/latest-stable.json"),
    read("site/_worker.js"),
  ].join("\n");
  assert.ok(!senior.includes("junior-"), "senior learning data names a junior entry");
  assert.ok(ids.every((id) => !id.startsWith("lesson-")));
  const code = read("site/assets/junior.js");
  assert.ok(!/\/api\//.test(code), "junior page calls the yw API");
  assert.ok(!/my\.bdfz\.net|learning-evidence|sendBeacon|credentials/.test(code), "junior page touches My or evidence");
  assert.deepEqual([...code.matchAll(/fetch\(([^,)]+)/g)].map((m) => m[1]), ["DATA_URL"]);
  const html = read("site/junior.html");
  assert.deepEqual([...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1].split("?")[0]), ["/assets/junior.js"]);
});

test("junior page assets and imports use their current content hashes", () => {
  const html = read("site/junior.html");
  for (const path of ["assets/dialogue.css", "assets/junior.css", "assets/junior.js", "assets/dialogue-palettes.js", "assets/textbook-pages.js"]) {
    assert.ok(html.includes(`/${path}?v=${version(path)}`), `${path} version`);
  }
  const code = read("site/assets/junior.js");
  for (const [specifier, path] of [["./dialogue-palettes.js", "assets/dialogue-palettes.js"], ["./textbook-pages.js", "assets/textbook-pages.js"]]) {
    assert.ok(code.includes(`${specifier}?v=${version(path)}`), `${path} import version`);
  }
});

test("the senior catalog links to the six junior books", () => {
  const html = read("site/dialogue.html");
  const links = [...html.matchAll(/<a href="\/junior#([a-z0-9-]+)">/g)].map((m) => m[1]);
  assert.deepEqual(links, data.order);
  assert.ok(!html.includes("persona-label"));
  assert.ok(!html.includes("不是作者本人"));
});

async function render(hash, { width = 1280 } = {}) {
  const { window, document } = parseHTML(read("site/junior.html"));
  const calls = [];
  const storage = new Map();
  Object.assign(globalThis, {
    window, document, history: { replaceState(_s, _t, url) { window.location.hash = url; } },
  });
  window.location = { hash };
  window.innerWidth = width;
  window.matchMedia = (query) => ({ matches: width < 900 && /max-width/.test(query) });
  window.localStorage = { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) };
  window.scrollTo = () => {};
  document.documentElement.style.setProperty = () => {};
  window.HTMLElement.prototype.focus = () => {};
  window.HTMLElement.prototype.scrollIntoView = () => {};
  globalThis.location = window.location;
  globalThis.fetch = async (url) => { calls.push(String(url)); return Response.json(data); };
  await import(`../site/assets/junior.js?render=${Math.random()}`);
  for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setImmediate(resolve));
  return { document, window, calls };
}

test("the page shows a lesson from sun's pages and fetches nothing else", async () => {
  const { document, calls } = await render("#junior-g7-shang-05");
  assert.deepEqual(calls, ["/data/junior-textbook-pages.v1.json"]);
  assert.equal(document.getElementById("title").textContent, "古代诗歌四首");
  assert.equal(document.querySelectorAll("#pages figure").length, 3);
  assert.equal(document.querySelectorAll("#parts button").length, 4);
  const images = [...document.querySelectorAll("#pages img")];
  assert.ok(images.every((img) => img.getAttribute("src").startsWith("https://sun.bdfz.net/files/page/")));
  assert.ok(images.every((img) => img.getAttribute("srcset").split(",").every((c) => c.trim().startsWith("https://sun.bdfz.net/files/page/"))));
  assert.match(document.getElementById("download").getAttribute("href"), /^https:\/\/sun\.bdfz\.net\/files\/pdf\//);
  assert.equal(document.querySelectorAll("#catalog-results .catalog-book").length, 6);
  assert.equal(document.querySelector("#catalog-results [aria-current]").getAttribute("href"), "#junior-g7-shang-05");
  assert.match(document.querySelector(".junior-source").textContent, /不計入 My/);
  const button = document.getElementById("theme-cycle"), first = document.getElementById("theme-name").textContent;
  button.onclick();
  assert.notEqual(document.getElementById("theme-name").textContent, first);
  assert.equal(document.querySelectorAll("#junior-root select").length, 0);
});

test("a book link opens its first entry and an unknown hash falls back to the first book", async () => {
  const book = await render("#g9-xia");
  assert.equal(book.window.location.hash, "#junior-g9-xia-01");
  const unknown = await render("#lesson-1462");
  assert.equal(unknown.window.location.hash, "#junior-g7-shang-01");
  assert.equal(unknown.document.getElementById("title").textContent, "第一单元");
});
