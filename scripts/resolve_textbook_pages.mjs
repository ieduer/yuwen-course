#!/usr/bin/env node
// Offline, deterministic resolver: lesson textbook pages -> current-edition PDF pages.
//
// Reads only local files: this repository's lesson files, the reviewed override
// file and one local copy of a SUN catalog release.  It never uses the network.
//
// A legacy page index resolves only through its own page-map row, or through an
// entry of another row's `legacy_also`.  No offset is applied and no neighbouring
// page is ever substituted: a legacy page without such a row is "unmapped".
//
//   node scripts/resolve_textbook_pages.mjs --catalog <release dir>           write
//   node scripts/resolve_textbook_pages.mjs --catalog <release dir> --check   compare only

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const LESSONS_DIR = resolve(ROOT, "site/data/lessons");
export const OVERRIDES_PATH = resolve(ROOT, "scripts/textbook_page_overrides.v1.json");
export const OUTPUT_PATH = resolve(ROOT, "site/data/textbook-pages.v1.json");

export const SCHEMA = "yw-textbook-pages-v1";
// A host name, not a URL: the release-site builder normalises URL-shaped strings.
export const IMAGE_HOST = "sun.bdfz.net";
export const WIDTHS = Object.freeze({ thumb: 240, full: 960, large: 1440 });
const LEGACY_KEY = /^[0-9a-f]{12}$/;

function fail(message) {
  throw new Error(message);
}

function json(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function legacyKeyOf(textbook) {
  const key = String(textbook?.imageBase || "").split("/").pop();
  return LEGACY_KEY.test(key) ? key : null;
}

function loadBook(catalogDir, catalog, legacyKey, bookId) {
  const matches = catalog.reader_books.filter((book) => book.jc_short_key === legacyKey);
  if (matches.length !== 1) fail(`catalog has ${matches.length} reader books for ${legacyKey}`);
  const reader = matches[0];
  if (reader.sun_book_key !== bookId) fail(`catalog book key mismatch for ${legacyKey}`);
  const edition = catalog.editions.find((item) => item.edition_id === reader.edition_id);
  if (!edition || edition.status !== "active" || edition.platform_current !== true) {
    fail(`edition for ${legacyKey} is not the active current edition`);
  }
  const map = json(resolve(catalogDir, "page-maps", `${reader.edition_id}.json`));
  if (
    map.contract !== "sun-catalog-v1/page-map"
    || map.edition_id !== reader.edition_id
    || map.pdf_sha256 !== edition.pdf.sha256
    || map.pdf_pages !== edition.pdf.pages
    || map.pages.length !== map.pdf_pages
    || !reader.edition_id.endsWith(`-${map.pdf_sha256.slice(0, 12)}`)
  ) fail(`page map for ${reader.edition_id} is inconsistent with the catalog`);

  const byLegacy = new Map();
  const byPdf = new Map();
  const claim = (index, row) => {
    if (!Number.isInteger(index) || index < 0) fail(`invalid legacy index in ${reader.edition_id}`);
    if (byLegacy.has(index)) fail(`legacy index ${index} has two rows in ${reader.edition_id}`);
    byLegacy.set(index, row);
  };
  map.pages.forEach((row, position) => {
    if (row.pdf_page !== position + 1) fail(`page map order broken in ${reader.edition_id}`);
    const legacy = [];
    if (row.legacy_image_index != null) {
      legacy.push(row.legacy_image_index);
      claim(row.legacy_image_index, {
        pdf: row.pdf_page,
        basis: row.legacy_basis,
        revised: row.legacy_content_revised === true,
      });
    }
    for (const also of row.legacy_also || []) {
      legacy.push(also.legacy_image_index);
      claim(also.legacy_image_index, {
        pdf: row.pdf_page,
        basis: also.legacy_basis,
        revised: also.legacy_content_revised === true,
      });
    }
    byPdf.set(row.pdf_page, {
      legacy,
      printed: row.printed_verified === true && row.printed_label != null ? String(row.printed_label) : null,
    });
  });
  return {
    legacyKey,
    bookId,
    title: edition.title,
    editionId: reader.edition_id,
    pdfSha256: map.pdf_sha256,
    pdfPages: map.pdf_pages,
    pageMapVersion: map.page_map_version,
    byLegacy,
    byPdf,
  };
}

function pageEntry(book, pdf, legacy, basis, revised) {
  const entry = { pdf };
  const printed = book.byPdf.get(pdf)?.printed;
  if (printed) entry.printed = printed;
  entry.legacy = legacy;
  entry.basis = basis;
  if (revised) entry.revised = true;
  return entry;
}

function resolveLesson(lesson, book, override) {
  const legacyPages = lesson.textbook.pages;
  const pages = [];
  const unmappedLegacy = [];
  for (const index of legacyPages) {
    const row = book.byLegacy.get(index);
    if (!row) {
      unmappedLegacy.push(index);
      continue;
    }
    const previous = pages.find((page) => page.pdf === row.pdf);
    if (previous) {
      // Two legacy pages that the current edition prints on one page.
      previous.legacy.push(index);
      if (row.revised) previous.revised = true;
      continue;
    }
    pages.push(pageEntry(book, row.pdf, [index], row.basis, row.revised));
  }
  for (let i = 1; i < pages.length; i += 1) {
    if (pages[i].pdf <= pages[i - 1].pdf) fail(`${lesson.id}: resolved PDF pages are not increasing`);
  }

  const entry = { book: lesson.blockId };
  if (override) {
    if (pages.length !== 0) fail(`${lesson.id}: an override is only allowed when no legacy page resolves`);
    if (override.book !== lesson.blockId || override.pdfSha256 !== book.pdfSha256) {
      fail(`${lesson.id}: override is bound to another book or PDF`);
    }
    if (JSON.stringify(override.replacesLegacy) !== JSON.stringify(legacyPages)) {
      fail(`${lesson.id}: override does not name the lesson's legacy pages`);
    }
    const { firstPdf, lastPdf } = override;
    if (!Number.isInteger(firstPdf) || !Number.isInteger(lastPdf) || firstPdf < 1 || lastPdf < firstPdf || lastPdf > book.pdfPages) {
      fail(`${lesson.id}: override page range is invalid`);
    }
    for (let pdf = firstPdf; pdf <= lastPdf; pdf += 1) {
      // An override may only take pages that no legacy page maps to.
      if (book.byPdf.get(pdf).legacy.length) fail(`${lesson.id}: override page ${pdf} already has a legacy row`);
      pages.push(pageEntry(book, pdf, [], override.basis, false));
    }
    entry.status = "override";
    entry.override = {
      basis: override.basis,
      firstPdf,
      lastPdf,
      titleLine: override.titleLine,
      nextTitleLine: override.nextTitleLine,
      nextTitlePdf: override.nextTitlePdf,
      verifiedOn: override.verifiedOn,
      extractor: override.extractor,
      decision: override.decision,
    };
  } else if (pages.length === 0) {
    entry.status = "none";
  } else {
    entry.status = unmappedLegacy.length ? "partial" : "mapped";
  }
  entry.pages = pages;
  entry.unmappedLegacy = unmappedLegacy;
  // Reported, never shown as an image: pages of the current edition that lie
  // between two resolved pages of this lesson and have no legacy counterpart.
  if (!override && pages.length > 1) {
    const listed = new Set(pages.map((page) => page.pdf));
    const unlisted = [];
    for (let pdf = pages[0].pdf + 1; pdf < pages.at(-1).pdf; pdf += 1) {
      if (!listed.has(pdf) && book.byPdf.get(pdf).legacy.length === 0) unlisted.push(pdf);
    }
    if (unlisted.length) entry.unlistedBetween = unlisted;
  }
  return entry;
}

export function buildTextbookPages(catalogDir) {
  const catalog = json(resolve(catalogDir, "catalog.json"));
  const release = json(resolve(catalogDir, "RELEASE.json"));
  if (catalog.contract !== "sun-catalog-v1" || catalog.release_id !== release.release_id) {
    fail("catalog copy is not one consistent sun-catalog-v1 release");
  }
  const overrideFile = json(OVERRIDES_PATH);
  if (overrideFile.schema !== "yw-textbook-page-overrides-v1") fail("override file schema is invalid");
  const overrides = new Map(overrideFile.overrides.map((item) => [item.lessonId, item]));
  if (overrides.size !== overrideFile.overrides.length) fail("duplicate override");

  const books = new Map();
  const lessons = {};
  const files = readdirSync(LESSONS_DIR).filter((name) => name.endsWith(".json")).sort();
  for (const name of files) {
    const lesson = json(resolve(LESSONS_DIR, name));
    if (`${lesson.id}.json` !== name) fail(`lesson id does not match file name: ${name}`);
    const textbook = lesson.textbook || {};
    if (!Array.isArray(textbook.pages) || textbook.pages.length === 0) continue;
    const legacyKey = legacyKeyOf(textbook);
    if (!legacyKey) fail(`${lesson.id}: textbook pages without a legacy key`);
    if (!books.has(lesson.blockId)) {
      books.set(lesson.blockId, loadBook(catalogDir, catalog, legacyKey, textbook.bookId));
    }
    const book = books.get(lesson.blockId);
    if (book.legacyKey !== legacyKey || book.bookId !== textbook.bookId) fail(`${lesson.id}: block maps to two books`);
    lessons[lesson.id] = resolveLesson(lesson, book, overrides.get(lesson.id));
    overrides.delete(lesson.id);
  }
  if (overrides.size) fail(`override names an unknown lesson: ${[...overrides.keys()].join(", ")}`);

  const pageMapVersions = new Set([...books.values()].map((book) => book.pageMapVersion));
  if (pageMapVersions.size !== 1) fail("books use different page-map versions");
  const outBooks = {};
  for (const [blockId, book] of [...books.entries()].sort(([a], [b]) => a.localeCompare(b, "en"))) {
    outBooks[blockId] = {
      title: book.title,
      editionId: book.editionId,
      pdfSha256: book.pdfSha256,
      pdfSha12: book.pdfSha256.slice(0, 12),
      pdfPages: book.pdfPages,
    };
  }
  const counts = { lessons: 0, mapped: 0, partial: 0, none: 0, override: 0, legacyPages: 0, unmappedLegacyPages: 0, pages: 0 };
  const sortedLessons = {};
  for (const id of Object.keys(lessons).sort((a, b) => a.localeCompare(b, "en"))) {
    const entry = lessons[id];
    sortedLessons[id] = entry;
    counts.lessons += 1;
    counts[entry.status] += 1;
    counts.pages += entry.pages.length;
    counts.unmappedLegacyPages += entry.unmappedLegacy.length;
    counts.legacyPages += entry.unmappedLegacy.length + entry.pages.reduce((sum, page) => sum + page.legacy.length, 0);
  }
  return {
    schema: SCHEMA,
    catalogContract: catalog.contract,
    catalogRelease: catalog.release_id,
    pageMapVersion: [...pageMapVersions][0],
    resolution: "exact page-map rows (own row or legacy_also) only; no offset, no neighbouring page",
    imageHost: IMAGE_HOST,
    widths: WIDTHS,
    counts,
    books: outBooks,
    lessons: sortedLessons,
  };
}

export function renderTextbookPages(catalogDir) {
  return `${JSON.stringify(buildTextbookPages(catalogDir))}\n`;
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index > 0 ? process.argv[index + 1] : "";
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const catalogDir = argument("--catalog") || process.env.YW_SUN_CATALOG || "";
  if (!catalogDir || !existsSync(resolve(catalogDir, "catalog.json"))) {
    fail("usage: resolve_textbook_pages.mjs --catalog <local SUN catalog release directory> [--check]");
  }
  const rendered = renderTextbookPages(resolve(catalogDir));
  const data = JSON.parse(rendered);
  if (process.argv.includes("--check")) {
    if (!existsSync(OUTPUT_PATH) || readFileSync(OUTPUT_PATH, "utf8") !== rendered) {
      fail("site/data/textbook-pages.v1.json is stale against this catalog release");
    }
    process.stdout.write(`textbook pages are current (${data.catalogRelease}; ${JSON.stringify(data.counts)})\n`);
  } else {
    writeFileSync(OUTPUT_PATH, rendered, "utf8");
    process.stdout.write(`wrote textbook pages from ${data.catalogRelease}: ${JSON.stringify(data.counts)}\n`);
  }
}
