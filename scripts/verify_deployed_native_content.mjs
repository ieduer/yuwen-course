#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { privacyIssueCounts } from "./native_content_url_sanitizer.mjs";

const base = new URL(process.argv[2] || "https://yw.bdfz.net/");
if (base.protocol !== "https:") throw new Error("deployment base must use HTTPS");
const concurrency = 8;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function deployedUrl(canonicalHref) {
  const source = new URL(canonicalHref);
  return new URL(`${source.pathname}${source.search}`, base);
}

async function fetchBytes(url, label) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { accept: "*/*" },
        redirect: "follow",
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return {
        bytes: Buffer.from(await response.arrayBuffer()),
        cacheControl: response.headers.get("cache-control") || "",
        contentType: response.headers.get("content-type") || "",
        url: response.url,
      };
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
  throw new Error(`${label} unavailable: ${lastError?.message || lastError}`);
}

async function fetchJson(url, label) {
  const result = await fetchBytes(url, label);
  let value;
  try {
    value = JSON.parse(result.bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
  return { ...result, value };
}

async function mapLimit(items, worker) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (next < items.length) {
        const index = next;
        next += 1;
        results[index] = await worker(items[index], index);
      }
    },
  ));
  return results;
}

function assertReceipt(result, receipt, label) {
  assert.equal(result.bytes.length, receipt.bytes, `${label}: byte count`);
  assert.equal(sha256(result.bytes), receipt.sha256, `${label}: sha256`);
}

function assertPrivateUrlScan(text, label) {
  const issues = privacyIssueCounts(text);
  const total = Object.values(issues).reduce(
    (sum, issue) => sum + issue.raw + issue.decoded,
    0,
  );
  assert.equal(total, 0, `${label}: forbidden URL material`);
}

const root = await fetchBytes(base, "site root");
assert.match(root.contentType, /text\/html/i);

const pointerResult = await fetchJson(
  new URL("/app-content/latest-stable.json", base),
  "stable pointer",
);
assert.match(pointerResult.cacheControl, /no-store/i);
assertPrivateUrlScan(pointerResult.bytes.toString("utf8"), "stable pointer");
const pointer = pointerResult.value;
assert.equal(pointer.schemaVersion, "yw-native-content-pointer-v1");
assert.equal(pointer.sourceClean, true);
assert.equal(pointer.appDisposition, "compatible-and-synced");

const manifestResult = await fetchJson(
  new URL(`/app-content/${pointer.manifest.path}`, base),
  "native manifest",
);
assert.match(manifestResult.cacheControl, /immutable/i);
assertReceipt(manifestResult, pointer.manifest, "native manifest");
assertPrivateUrlScan(manifestResult.bytes.toString("utf8"), "native manifest");
const manifest = manifestResult.value;
assert.equal(manifest.releaseReceiptId, pointer.releaseReceiptId);
assert.equal(manifest.semanticDigest, pointer.semanticDigest);
assert.equal(manifest.counts.objects, manifest.objects.length);

const releasePrefix = pointer.manifest.path.split("/").slice(0, -1).join("/");
const objects = await mapLimit(manifest.objects, async (object) => {
  const result = await fetchBytes(
    new URL(`/app-content/${releasePrefix}/${object.path}`, base),
    `object ${object.path}`,
  );
  assert.match(result.cacheControl, /immutable/i, `${object.path}: cache-control`);
  assertReceipt(result, object, object.path);
  if (object.mediaType === "application/json") {
    assertPrivateUrlScan(result.bytes.toString("utf8"), object.path);
  }
  return { object, result };
});

const coreEntry = objects.find(({ object }) => object.kind === "core-bundle");
const mediaEntry = objects.find(({ object }) => object.kind === "media");
assert.ok(coreEntry, "core bundle object missing");
assert.ok(mediaEntry, "media object missing");
const core = JSON.parse(coreEntry.result.bytes.toString("utf8"));
const media = JSON.parse(mediaEntry.result.bytes.toString("utf8"));
assert.deepEqual(core.counts, pointer.counts);
assert.equal(core.contentVersion, pointer.contentVersion);
assert.equal(core.semanticDigest, pointer.semanticDigest);

const approvedSlides = media.lessons.filter((lesson) => lesson.reviewStatus === "approved");
const missingSlides = media.lessons.filter((lesson) => lesson.reviewStatus === "cataloged");
assert.equal(approvedSlides.length, pointer.counts.approvedDecks);
assert.equal(missingSlides.length, pointer.counts.catalogedDecks);
for (const lesson of missingSlides) {
  assert.equal(lesson.asset, null, `${lesson.lessonId}: missing deck must not have an asset`);
  assert.equal(lesson.missingReason, "not_generated_or_not_approved");
}
await mapLimit(approvedSlides, async (lesson) => {
  const result = await fetchBytes(
    deployedUrl(lesson.asset.href),
    `slide deck ${lesson.lessonId}`,
  );
  assert.match(result.cacheControl, /immutable/i, `${lesson.lessonId}: cache-control`);
  assert.match(result.contentType, /application\/pdf/i, `${lesson.lessonId}: content-type`);
  assertReceipt(result, lesson.asset, `slide deck ${lesson.lessonId}`);
});

const pageRepresentatives = [];
const representedBooks = new Set();
for (const lesson of core.lessons) {
  const page = lesson.textbook?.pageImages?.[0];
  const bookTitle = lesson.textbook?.bookTitle;
  if (!page || !bookTitle || representedBooks.has(bookTitle)) continue;
  representedBooks.add(bookTitle);
  pageRepresentatives.push({ bookTitle, lessonId: lesson.id, page });
}
assert.equal(pageRepresentatives.length, pointer.counts.books);
await mapLimit(pageRepresentatives, async ({ bookTitle, page }) => {
  const result = await fetchBytes(page.href, `textbook page ${bookTitle}`);
  assert.match(result.contentType, /image\/webp/i, `${bookTitle}: content-type`);
  assertReceipt(result, page, `textbook page ${bookTitle}`);
});

const health = await fetchJson(new URL("/api/reading/health", base), "reading health");
assert.equal(health.value.ok, true);

process.stdout.write(`${JSON.stringify({
  base: base.href,
  contentVersion: pointer.contentVersion,
  semanticDigest: pointer.semanticDigest,
  releaseReceiptId: pointer.releaseReceiptId,
  counts: pointer.counts,
  immutableObjectsVerified: objects.length,
  approvedSlidesVerified: approvedSlides.length,
  missingSlidesRepresented: missingSlides.length,
  textbookBooksVerified: pageRepresentatives.length,
  readingHealth: "ok",
  status: "verified",
}, null, 2)}\n`);
