#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  auditReceiptIssues,
  writeImmutableFile,
} from "./native_content_release_contract.mjs";
import { createUrlSanitizer } from "./native_content_url_sanitizer.mjs";
import { validateVocabEligibility } from "./vocab_eligibility.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const SITE = path.join(ROOT, "site");
const DATA = path.join(SITE, "data");
const OUTPUT_ROOT = process.env.YW_NATIVE_CONTENT_OUTPUT_ROOT
  ? path.resolve(process.env.YW_NATIVE_CONTENT_OUTPUT_ROOT)
  : path.join(SITE, "app-content");
const BASE_URL = "https://yw.bdfz.net/app-content";
const PAGE_ROOT = process.env.YW_PAGE_IMAGE_ROOT
  || "/Users/ylsuen/textbook_ai_migration/platform/frontend/assets/pages";
const PAGE_HASH_INVENTORY = process.env.YW_PAGE_HASH_INVENTORY
  || "/Users/ylsuen/CF/jc-textbook-reader/manifests/page-images.sha256";
const AUDIT_RECEIPT_FILE = process.env.YW_NATIVE_CONTENT_AUDIT_RECEIPT
  ? path.resolve(process.env.YW_NATIVE_CONTENT_AUDIT_RECEIPT)
  : path.join(ROOT, "scripts", "native_content_audit_receipt.json");
const CORE_MAX_BYTES = 25 * 1024 * 1024;
const REVIEWED_DISPOSITIONS = new Set([
  "compatible-and-synced",
  "compatible-no-client-release",
  "blocked",
]);
const PAGES_DEPLOYMENT_ID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const RIGHTS_PROVENANCE = "user-authorized-for-bdfz-yw-app-2026-07-29";

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function json(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right, "en"))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

function serialize(value) {
  return `${JSON.stringify(canonicalize(value))}\n`;
}

function canonicalSha256(value) {
  return sha256(JSON.stringify(canonicalize(value)));
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--")) fail(`unexpected argument: ${key}`);
    if (key === "--allow-dirty" || key === "--promote-stable") {
      args[key.slice(2)] = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) fail(`missing value for ${key}`);
    args[key.slice(2)] = value;
    index += 1;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const appDisposition = args["app-disposition"] || "blocked";
assert(REVIEWED_DISPOSITIONS.has(appDisposition), `invalid app disposition: ${appDisposition}`);

const {
  redactions,
  sanitizeUrl,
  sanitizeValue,
} = createUrlSanitizer();

const pageHashInventoryBytes = readFileSync(PAGE_HASH_INVENTORY);
const pageHashInventory = new Map();
for (const line of pageHashInventoryBytes.toString("utf8").split(/\r?\n/)) {
  const match = line.match(/^([a-f0-9]{64})\s+\.[/\\](.+)$/i);
  if (match) pageHashInventory.set(match[2].replaceAll("\\", "/"), match[1].toLowerCase());
}
const pageReceiptCache = new Map();

function pageReceipt(rawUrl) {
  const href = sanitizeUrl(rawUrl);
  if (pageReceiptCache.has(href)) return pageReceiptCache.get(href);
  const url = new URL(href);
  const match = url.pathname.match(/^\/pages\/([^/]+)\/(p\d+\.webp)$/);
  assert(url.origin === "https://img.rdfzer.com" && match, `unsupported textbook page URL: ${href}`);
  const relative = `${match[1]}/${match[2]}`;
  const declaredSha = pageHashInventory.get(relative);
  assert(declaredSha, `page hash missing from inventory: ${relative}`);
  const localFile = path.join(PAGE_ROOT, relative);
  assert(existsSync(localFile), `local textbook page missing: ${relative}`);
  const bytes = readFileSync(localFile);
  const actualSha = sha256(bytes);
  assert(actualSha === declaredSha, `textbook page hash mismatch: ${relative}`);
  const receipt = {
    href,
    sourceUrl: href,
    sourceLocalRef: `textbook_ai_migration/platform/frontend/assets/pages/${relative}`,
    bytes: bytes.length,
    sha256: actualSha,
    mediaType: "image/webp",
    rightsBasis: RIGHTS_PROVENANCE,
  };
  pageReceiptCache.set(href, receipt);
  return receipt;
}

function enrichPage(page) {
  const safe = sanitizeValue(page);
  const receipt = pageReceipt(safe.src);
  const { src: _src, ...rest } = safe;
  return { ...rest, ...receipt };
}

function normalizePost(post) {
  const {
    cooked: _cooked,
    plain_text: plainText,
    ...rest
  } = post;
  assert(typeof plainText === "string", `post ${post.id || "unknown"} has no plain_text`);
  return sanitizeValue({ ...rest, plainText });
}

function readerBlockText(block) {
  if (!block) return "";
  if (Array.isArray(block.runs)) {
    return block.runs.map((run) => (
      run.type === "text" || run.type === "link"
        ? run.text || ""
        : run.type === "annotation-ref"
          ? run.label || ""
          : run.type === "media-ref"
            ? run.alt || ""
            : ""
    )).join("");
  }
  if (Array.isArray(block.blocks)) return block.blocks.map(readerBlockText).join("\n");
  if (Array.isArray(block.items)) {
    return block.items.flatMap((item) => item.blocks || []).map(readerBlockText).join("\n");
  }
  if (Array.isArray(block.rows)) {
    return block.rows.flat().map((cell) => readerBlockText(cell)).join("\n");
  }
  return String(block.text || "");
}

function readerBody(document) {
  return [
    ...(document.main?.frontMatter || []),
    ...(document.main?.guidance || []),
    ...(document.main?.blocks || []),
  ].map(readerBlockText).join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

const sourceManifestFile = path.join(DATA, "manifest.json");
const sourceManifestBytes = readFileSync(sourceManifestFile);
const sourceManifest = JSON.parse(sourceManifestBytes.toString("utf8"));
const activeIds = new Set(sourceManifest.lessons.map((lesson) => lesson.id));
const learningManifest = canonicalize(sanitizeValue(json(path.join(DATA, "learning-manifest.json"))));
const excludedLessonIds = new Set(
  (learningManifest.exclusions || []).map((item) => String(item.lessonId || "")),
);
assert(
  excludedLessonIds.size === (learningManifest.exclusions || []).length
    && [...excludedLessonIds].every((lessonId) => activeIds.has(lessonId)),
  "learning manifest exclusions must identify unique source lessons",
);
const nativeSourceLessons = sourceManifest.lessons.filter((lesson) => !excludedLessonIds.has(lesson.id));
const nativeIds = new Set(nativeSourceLessons.map((lesson) => lesson.id));
assert(nativeIds.size > 0, "native lesson projection is empty");
assert(activeIds.size === sourceManifest.lessons.length, "source manifest has duplicate active lesson IDs");
const blockLessonIds = sourceManifest.blocks.flatMap((block) => block.lessons.map((lesson) => lesson.id));
assert(
  new Set(blockLessonIds).size === blockLessonIds.length,
  "source manifest blocks contain duplicate lesson IDs",
);
assert(
  JSON.stringify([...new Set(blockLessonIds)].sort()) === JSON.stringify([...activeIds].sort()),
  "source manifest blocks and active lesson inventory differ",
);
const bookTitles = new Set(nativeSourceLessons.map((lesson) => (
  lesson.textbookBookTitle || lesson.blockTitle
)).filter(Boolean));
const readerIndexFile = path.join(DATA, "reader-documents", "index.json");
const readerIndexBytes = readFileSync(readerIndexFile);
const readerIndex = JSON.parse(readerIndexBytes.toString("utf8"));
const readerMediaReceiptFile = path.join(DATA, "reader-media-receipts.v1.json");
const readerMediaReceiptBytes = readFileSync(readerMediaReceiptFile);
const readerMediaReceiptLedger = JSON.parse(readerMediaReceiptBytes.toString("utf8"));
assert(readerIndex.schemaVersion === "yw-reader-document-index-v1", "unsupported reader document index");
assert(readerIndex.sourceManifestSha256 === sha256(sourceManifestBytes),
  "reader document index source-manifest receipt is stale");
assert(readerIndex.lessonCount === sourceManifest.lessons.length,
  "reader document index lesson count differs from source manifest");
assert(
  JSON.stringify(Object.keys(readerIndex.documents).sort())
    === JSON.stringify(sourceManifest.lessons.map((lesson) => lesson.id).sort()),
  "reader document index inventory differs from source manifest",
);
assert(readerIndex.mediaReceiptLedger?.schemaVersion === "yw-reader-media-receipts-v1",
  "reader document index has no supported media receipt ledger");
assert(readerIndex.mediaReceiptLedger.sha256 === sha256(readerMediaReceiptBytes),
  "reader media receipt ledger hash differs from reader index");
assert(readerMediaReceiptLedger.readerSemanticDigest === readerIndex.readerSemanticDigest,
  "reader media receipt ledger semantic digest differs from reader index");
assert(readerMediaReceiptLedger.receiptCount === readerIndex.mediaReceiptLedger.receiptCount,
  "reader media receipt count differs from reader index");
assert(readerMediaReceiptLedger.sourceInventorySha256
  === readerIndex.mediaReceiptLedger.sourceInventorySha256,
  "reader media receipt inventory differs from reader index");

const classicalFirstReadIndexFile = path.join(DATA, "classical-first-read", "index.json");
const classicalFirstReadIndexBytes = readFileSync(classicalFirstReadIndexFile);
const classicalFirstReadSourceIndex = JSON.parse(classicalFirstReadIndexBytes.toString("utf8"));
assert(
  classicalFirstReadSourceIndex.schema === "yw-classical-first-read-index-v1"
    && Number(classicalFirstReadSourceIndex.schemaVersion) === 1
    && classicalFirstReadSourceIndex.offsetUnit === "utf16_code_unit",
  "unsupported classical first-read index",
);
assert(
  classicalFirstReadSourceIndex.lessonCount === classicalFirstReadSourceIndex.lessons.length,
  "classical first-read index lesson count differs from its inventory",
);
const classicalFirstReadLessons = [];
const classicalFirstReadLessonIds = new Set();
let classicalFirstReadParagraphs = 0;
for (const indexEntry of classicalFirstReadSourceIndex.lessons) {
  const lessonId = String(indexEntry.lessonId || "");
  assert(nativeIds.has(lessonId), `classical first-read references inactive lesson: ${lessonId}`);
  assert(!classicalFirstReadLessonIds.has(lessonId), `duplicate classical first-read lesson: ${lessonId}`);
  assert(
    indexEntry.dataUrl === `data/classical-first-read/${lessonId}.json`,
    `${lessonId}: classical first-read path differs from its source contract`,
  );
  const assetFile = path.join(SITE, indexEntry.dataUrl);
  assert(existsSync(assetFile), `${lessonId}: classical first-read asset is missing`);
  const asset = sanitizeValue(json(assetFile));
  assert(
    asset.schema === "yw-classical-first-read-v1"
      && Number(asset.schemaVersion) === 1
      && asset.offsetUnit === "utf16_code_unit",
    `${lessonId}: unsupported classical first-read asset`,
  );
  assert(asset.lessonId === lessonId, `${lessonId}: classical first-read identity mismatch`);
  assert(typeof asset.text === "string", `${lessonId}: classical first-read text is invalid`);
  const textDigest = String(asset.textDigest || "");
  assert(
    asset.textVersionId === indexEntry.textVersionId
      && textDigest === indexEntry.textDigest
      && /^sha256:[a-f0-9]{64}$/.test(textDigest)
      && sha256(Buffer.from(asset.text, "utf8")) === textDigest.slice(7)
      && asset.textVersionId === `cfr-${lessonId}-${textDigest.slice(7, 23)}`,
    `${lessonId}: classical first-read version receipt mismatch`,
  );
  assert(
    Array.isArray(asset.paragraphs)
      && asset.paragraphs.length > 0
      && asset.paragraphCount === asset.paragraphs.length
      && asset.paragraphCount === indexEntry.paragraphCount,
    `${lessonId}: classical first-read paragraph count mismatch`,
  );
  assert(
    asset.text === asset.paragraphs.map((paragraph) => paragraph.text).join("")
      && Array.from(asset.text).length === asset.charCount
      && asset.charCount === indexEntry.charCount,
    `${lessonId}: classical first-read text receipt mismatch`,
  );
  const paragraphKeys = asset.paragraphs.map((paragraph, index) => {
    assert(
      paragraph.ordinal === index + 1
        && typeof paragraph.text === "string"
        && paragraph.text.length > 0
        && Number.isInteger(paragraph.sourceBlockIndex)
        && paragraph.sourceBlockIndex >= 0
        && paragraph.charCount === Array.from(paragraph.text).length
        && new RegExp(
          `^cfrp:${lessonId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:` +
            "[a-f0-9]{16}:\\d{2,4}$",
        ).test(String(paragraph.key || "")),
      `${lessonId}: classical first-read paragraph is invalid`,
    );
    return paragraph.key;
  });
  assert(
    new Set(paragraphKeys).size === paragraphKeys.length,
    `${lessonId}: duplicate classical first-read paragraph key`,
  );
  classicalFirstReadLessonIds.add(lessonId);
  classicalFirstReadParagraphs += asset.paragraphs.length;
  classicalFirstReadLessons.push(canonicalize(asset));
}
const normalizedClassicalFirstReadIndex = canonicalize({
  schemaVersion: "yw-native-classical-first-read-index-v1",
  sourceSchema: classicalFirstReadSourceIndex.schema,
  sourceSchemaVersion: classicalFirstReadSourceIndex.schemaVersion,
  offsetUnit: classicalFirstReadSourceIndex.offsetUnit,
  policyId: classicalFirstReadSourceIndex.policyId,
  policyDigest: classicalFirstReadSourceIndex.policyDigest,
  lessonCount: classicalFirstReadLessons.length,
  paragraphCount: classicalFirstReadParagraphs,
  lessons: classicalFirstReadLessons.map((lesson) => ({
    lessonId: lesson.lessonId,
    title: lesson.title,
    path: `classical-first-read/${lesson.lessonId}.json`,
    textVersionId: lesson.textVersionId,
    textDigest: lesson.textDigest,
    paragraphCount: lesson.paragraphCount,
    charCount: lesson.charCount,
  })),
});
const readerDocuments = new Map();
for (const meta of sourceManifest.lessons) {
  const receipt = readerIndex.documents[meta.id];
  assert(receipt, `${meta.id}: reader document receipt missing`);
  const file = path.join(DATA, receipt.path);
  assert(existsSync(file), `${meta.id}: reader document file missing`);
  const bytes = readFileSync(file);
  assert(bytes.length === receipt.bytes, `${meta.id}: reader document byte receipt mismatch`);
  assert(sha256(bytes) === receipt.sha256, `${meta.id}: reader document hash receipt mismatch`);
  const document = JSON.parse(bytes.toString("utf8"));
  assert(document.schemaVersion === "yw-reader-document-v1", `${meta.id}: unsupported reader document`);
  assert(document.lessonId === meta.id, `${meta.id}: reader document identity mismatch`);
  assert(document.main?.sourcePostId != null, `${meta.id}: reader document primary post missing`);
  assert(document.provenance?.posts?.filter((post) => post.role === "primary").length === 1,
    `${meta.id}: reader document must have exactly one primary post`);
  assert(document.provenance?.posts?.length === receipt.sourcePostCount,
    `${meta.id}: reader document provenance post count mismatch`);
  readerDocuments.set(meta.id, sanitizeValue(document));
}
const normalizedLessons = [];
for (const meta of sourceManifest.lessons) {
  const sourceFile = path.join(SITE, meta.dataUrl);
  assert(existsSync(sourceFile), `active lesson file missing: ${meta.dataUrl}`);
  const source = json(sourceFile);
  const posts = (source.posts || []).map(normalizePost);
  assert(posts.length === Number(meta.postCount || 0), `${meta.id}: post count mismatch`);
  const textbook = sanitizeValue(source.textbook || {});
  textbook.pageImages = (source.textbook?.pageImages || []).map(enrichPage);
  textbook.contextPageImages = (source.textbook?.contextPageImages || []).map(enrichPage);
  const lesson = sanitizeValue({
    ...source,
    cooked: undefined,
    posts: undefined,
    textbook: undefined,
  });
  const readerDocument = readerDocuments.get(meta.id);
  assert(readerDocument, `${meta.id}: reader document not loaded`);
  assert(readerDocument.provenance.posts.length === posts.length,
    `${meta.id}: reader/source post count mismatch`);
  assert(
    JSON.stringify(readerDocument.provenance.posts.map((post) => String(post.postId)).sort())
      === JSON.stringify(posts.map((post) => String(post.id)).sort()),
    `${meta.id}: reader/source post inventory mismatch`,
  );
  const normalizedLesson = canonicalize({
    schemaVersion: "yw-native-lesson-v1",
    ...lesson,
    postCount: posts.length,
    body: readerBody(readerDocument),
    readerDocument,
    posts,
    textbook,
  });
  if (nativeIds.has(meta.id)) normalizedLessons.push(normalizedLesson);
}

const actualTotals = normalizedLessons.reduce((totals, lesson) => {
  totals.posts += lesson.posts.length;
  totals.textbookPageRefs += lesson.textbook.pageImages.length;
  totals.textbookContextPageRefs += lesson.textbook.contextPageImages.length;
  totals.forumImages += (lesson.forumImages || []).length;
  totals.resources += (lesson.resources || []).length;
  totals.annotations += (lesson.readerDocument?.main?.annotations || []).length;
  totals.annotations += (lesson.readerDocument?.supplementary || [])
    .reduce((count, section) => count + (section.annotations || []).length, 0);
  totals.learningTasks += (lesson.learningTasks || []).length;
  for (const post of lesson.posts) {
    totals.postAttachments += (post.attachments || []).length;
    totals.postImages += (post.images || []).length;
    totals.postLinks += (post.links || []).length;
  }
  return totals;
}, {
  posts: 0,
  textbookPageRefs: 0,
  textbookContextPageRefs: 0,
  forumImages: 0,
  resources: 0,
  annotations: 0,
  learningTasks: 0,
  postAttachments: 0,
  postImages: 0,
  postLinks: 0,
});
const activePageUrls = new Set(normalizedLessons.flatMap((lesson) => lesson.textbook.pageImages.map((page) => page.href)));
const contextPageUrls = new Set(normalizedLessons.flatMap((lesson) => lesson.textbook.contextPageImages.map((page) => page.href)));

const vocabSourceIndex = json(path.join(DATA, "vocab", "index.json"));
const vocabLessonIds = Object.keys(vocabSourceIndex.lessons).sort((left, right) => left.localeCompare(right, "en"));
const vocabEligibilityFile = path.join(DATA, "vocab-eligibility.json");
const vocabEligibilityBytes = readFileSync(vocabEligibilityFile);
const vocabEligibility = canonicalize(sanitizeValue(
  validateVocabEligibility(JSON.parse(vocabEligibilityBytes.toString("utf8"))),
));
const vocabFileIds = readdirSync(path.join(DATA, "vocab"))
  .filter((file) => file.endsWith(".json") && file !== "index.json")
  .map((file) => file.slice(0, -5))
  .sort((left, right) => left.localeCompare(right, "en"));
assert(
  JSON.stringify(vocabFileIds) === JSON.stringify(vocabLessonIds),
  "vocab index and JSON file inventory differ",
);
const allVocabLessons = [];
const vocabLessons = [];
let vocabInventoryItems = 0;
let vocabQuestions = 0;
const vocabDecisionCounts = {};
for (const lessonId of vocabLessonIds) {
  assert(activeIds.has(lessonId), `vocab references inactive lesson: ${lessonId}`);
  const bank = sanitizeValue(json(path.join(DATA, "vocab", `${lessonId}.json`)));
  assert(bank.lessonId === lessonId, `${lessonId}: vocab identity mismatch`);
  const questions = bank.inventory.filter((item) => item.decision === "question");
  assert(vocabSourceIndex.lessons[lessonId] === questions.length,
    `${lessonId}: vocab index question count mismatch`);
  allVocabLessons.push(canonicalize(bank));
  if (!nativeIds.has(lessonId)) continue;
  if (questions.length === 0) continue;
  vocabInventoryItems += bank.inventory.length;
  for (const item of bank.inventory) {
    vocabDecisionCounts[item.decision] = (vocabDecisionCounts[item.decision] || 0) + 1;
    if (item.decision === "question") vocabQuestions += 1;
  }
  vocabLessons.push(canonicalize(bank));
}
const nativeVocabLessonIds = new Set(vocabLessons.map((bank) => bank.lessonId));
const normalizedVocabIndex = canonicalize({
  schemaVersion: "yw-native-vocab-index-v1",
  eligibilityPolicyVersion: vocabEligibility.policyVersion,
  lessonCount: vocabLessons.length,
  sourceBankCount: allVocabLessons.length,
  inventoryFileCount: vocabLessons.length + 1,
  inventoryItemCount: vocabInventoryItems,
  questionCount: vocabQuestions,
  decisionCounts: vocabDecisionCounts,
  lessons: Object.fromEntries(vocabLessons.map((bank) => [bank.lessonId, {
    path: `vocab/${bank.lessonId}.json`,
    inventoryItemCount: bank.inventory.length,
    questionCount: bank.inventory.filter((item) => item.decision === "question").length,
  }])),
});

const mediaSourceFile = path.join(DATA, "lesson-media.json");
const mediaSourceBytes = readFileSync(mediaSourceFile);
const mediaSource = JSON.parse(mediaSourceBytes.toString("utf8"));
const mediaSourceSha256 = sha256(mediaSourceBytes);
assert(
  new Set(mediaSource.lessons.map((lesson) => lesson.lessonId)).size === mediaSource.lessons.length,
  "media catalog has duplicate lesson IDs",
);
let approvedDecks = 0;
let catalogedDecks = 0;
const mutableApprovedMedia = [];
const allMediaLessons = mediaSource.lessons.map((item) => {
  const reviewStatus = item.reviewStatus?.slideDeck || "cataloged";
  assert(activeIds.has(item.lessonId), `media catalog references inactive lesson: ${item.lessonId}`);
  assert(
    reviewStatus === "approved" || reviewStatus === "cataloged",
    `${item.lessonId}: unsupported media review status ${reviewStatus}`,
  );
  if (reviewStatus !== "approved") {
    assert(!item.slideDeck, `${item.lessonId}: non-approved deck must not expose an asset`);
    catalogedDecks += 1;
    return sanitizeValue({
      lessonId: item.lessonId,
      title: item.title,
      blockTitle: item.blockTitle,
      pilot: item.pilot,
      sourceVersion: item.sourceVersion,
      promptVersions: item.promptVersions,
      generatedAt: item.generatedAt,
      reviewStatus,
      rightsBasis: RIGHTS_PROVENANCE,
      missingReason: "not_generated_or_not_approved",
      asset: null,
    });
  }
  assert(item.slideDeck?.href && item.slideDeck?.sha256, `${item.lessonId}: approved deck receipt incomplete`);
  const relative = item.slideDeck.href.replace(/^\/+/, "");
  const file = path.join(SITE, relative);
  assert(existsSync(file), `${item.lessonId}: approved deck file missing`);
  const bytes = readFileSync(file);
  const actualSha = sha256(bytes);
  assert(actualSha === item.slideDeck.sha256, `${item.lessonId}: approved deck hash mismatch`);
  if (path.posix.basename(relative) !== `sha256-${actualSha}.pdf`) {
    mutableApprovedMedia.push(item.lessonId);
  }
  approvedDecks += 1;
  return sanitizeValue({
    lessonId: item.lessonId,
    title: item.title,
    blockTitle: item.blockTitle,
    pilot: item.pilot,
    sourceVersion: item.sourceVersion,
    promptVersions: item.promptVersions,
    generatedAt: item.generatedAt,
    reviewStatus,
    rightsBasis: RIGHTS_PROVENANCE,
    missingReason: null,
    asset: {
      href: new URL(relative, "https://yw.bdfz.net/").toString(),
      sourceKind: "notebooklm",
      sourceRecord: "site/data/lesson-media.json",
      sourceRecordSha256: mediaSourceSha256,
      sourceLocalRef: `site/${relative}`,
      sourceSha256: actualSha,
      sourceVersion: item.sourceVersion,
      sha256: actualSha,
      bytes: bytes.length,
      mediaType: "application/pdf",
      title: item.slideDeck.title,
      rightsBasis: RIGHTS_PROVENANCE,
    },
  });
});
const mediaLessons = allMediaLessons.filter((item) => nativeIds.has(item.lessonId));
approvedDecks = mediaLessons.filter((item) => item.reviewStatus === "approved").length;
catalogedDecks = mediaLessons.filter((item) => item.reviewStatus === "cataloged").length;
if (appDisposition !== "blocked") {
  assert(
    mutableApprovedMedia.length === 0,
    `${mutableApprovedMedia.length} approved media URL(s) are not content-addressed`,
  );
}
const normalizedMediaBase = canonicalize({
  schemaVersion: "yw-native-content-media-v1",
  sourceSchemaVersion: mediaSource.schemaVersion,
  sourceCatalog: mediaSource.sourceCatalog,
  counts: { lessons: mediaLessons.length, approved: approvedDecks, cataloged: catalogedDecks },
  lessons: mediaLessons,
});
const mediaByLessonId = new Map(mediaLessons.map((lesson) => [lesson.lessonId, lesson]));

const lessonFiles = readdirSync(path.join(DATA, "lessons"))
  .filter((file) => /^lesson-.+\.json$/.test(file))
  .sort((left, right) => left.localeCompare(right, "en"));
const tombstones = [];
for (const file of lessonFiles) {
  const id = file.slice(0, -5);
  if (activeIds.has(id)) continue;
  const replacements = normalizedLessons
    .filter((lesson) => lesson.derivedFrom === id)
    .map((lesson) => ({ id: lesson.id, title: lesson.title }));
  assert(replacements.length > 0, `inactive lesson has no derived replacement: ${id}`);
  tombstones.push({
    id,
    status: "replaced",
    reason: "composite_split_into_atomic_lessons",
    replacements,
  });
}
const normalizedTombstones = canonicalize({
  schemaVersion: "yw-native-tombstones-v1",
  count: tombstones.length,
  tombstones,
});

const catalogBase = canonicalize({
  schemaVersion: "yw-native-content-catalog-v1",
  siteKey: "yw",
  counts: {
    blocks: sourceManifest.blocks.length,
    lessons: normalizedLessons.length,
    posts: actualTotals.posts,
    textbookPageRefs: actualTotals.textbookPageRefs,
  },
  blocks: sourceManifest.blocks.map((block) => {
    const lessonIds = block.lessons.map((lesson) => lesson.id).filter((lessonId) => nativeIds.has(lessonId));
    return {
    id: block.id,
    title: block.title,
    lessonCount: lessonIds.length,
    lessonIds,
  };
  }),
  lessons: nativeSourceLessons.map((lesson) => ({
    id: lesson.id,
    title: lesson.title,
    sourceTitle: lesson.sourceTitle,
    blockId: lesson.blockId,
    blockTitle: lesson.blockTitle,
    bookTitle: lesson.textbookBookTitle || lesson.blockTitle,
    hasSlideDeck: mediaByLessonId.get(lesson.id)?.reviewStatus === "approved"
      && mediaByLessonId.get(lesson.id)?.asset !== null,
    path: `lessons/${lesson.id}.json`,
    postCount: lesson.postCount,
    textbookPageCount: lesson.textbookPageCount,
    vocabPath: nativeVocabLessonIds.has(lesson.id) ? `vocab/${lesson.id}.json` : null,
    classicalFirstReadPath: classicalFirstReadLessonIds.has(lesson.id)
      ? `classical-first-read/${lesson.id}.json`
      : null,
    readerDocumentPath: `data/reader-documents/${lesson.id}.json`,
    readerDocumentSha256: readerIndex.documents[lesson.id].sha256,
    readerDocumentEmbeddedSha256: canonicalSha256(readerDocuments.get(lesson.id)),
  })),
});

const interactionDefinitions = canonicalize(sanitizeValue(json(path.join(DATA, "interaction-definitions.json"))));
const sourceRevision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
const dirtyRows = execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
  cwd: ROOT,
  encoding: "utf8",
}).split(/\r?\n/).filter(Boolean).filter((row) => !row.slice(3).startsWith("site/app-content/"));
const sourceClean = dirtyRows.length === 0;
const deploymentId = args["deployment-id"] || null;
const publishedAt = args["published-at"] || null;
const allowDirty = args["allow-dirty"] === true;
const promoteStable = args["promote-stable"] === true;
if (!sourceClean) {
  assert(allowDirty, "source tree is dirty; use --allow-dirty only for a blocked development receipt");
  assert(appDisposition === "blocked", "--allow-dirty may only be used with appDisposition=blocked");
}
if (appDisposition !== "blocked") {
  assert(sourceClean, "a compatible App disposition requires a clean source tree");
  assert(
    PAGES_DEPLOYMENT_ID.test(String(deploymentId || "")),
    "a compatible App disposition requires a validated Pages deployment UUID",
  );
  assert(
    typeof publishedAt === "string"
      && publishedAt.endsWith("Z")
      && !Number.isNaN(Date.parse(publishedAt)),
    "a compatible App disposition requires an ISO-8601 UTC publication time",
  );
}
if (promoteStable) {
  assert(sourceClean, "--promote-stable requires a clean source tree");
  assert(appDisposition !== "blocked", "--promote-stable requires a compatible App disposition");
  assert(mutableApprovedMedia.length === 0, "--promote-stable requires content-addressed approved media");
}
const releaseGate = canonicalize({
  sourceRevision,
  sourceClean,
  deploymentId,
  publishedAt,
  appDisposition,
});

const counts = canonicalize({
  books: bookTitles.size,
  blocks: sourceManifest.blocks.length,
  lessons: normalizedLessons.length,
  posts: actualTotals.posts,
  textbookPageRefs: actualTotals.textbookPageRefs,
  textbookContextPageRefs: actualTotals.textbookContextPageRefs,
  uniqueTextbookPageAssets: activePageUrls.size,
  uniqueTextbookContextPageAssets: contextPageUrls.size,
  verifiedTextbookPageRefs: actualTotals.textbookPageRefs,
  blockedTextbookPageRefs: 0,
  forumImages: actualTotals.forumImages,
  resources: actualTotals.resources,
  annotations: actualTotals.annotations,
  learningTasks: actualTotals.learningTasks,
  postAttachments: actualTotals.postAttachments,
  postImages: actualTotals.postImages,
  postLinks: actualTotals.postLinks,
  vocabLessonFiles: vocabLessons.length,
  vocabInventoryFiles: vocabLessons.length + 1,
  vocabInventoryItems,
  vocabQuestions,
  vocabularyLessons: vocabLessons.length,
  vocabularyQuestions: vocabQuestions,
  classicalFirstReadLessons: classicalFirstReadLessons.length,
  classicalFirstReadParagraphs,
  mediaCatalogLessons: mediaLessons.length,
  approvedDecks,
  approvedSlideDecks: approvedDecks,
  catalogedDecks,
  compositeTombstones: tombstones.length,
});

const exclusions = [
  {
    field: "posts.cooked",
    count: actualTotals.posts,
    reason: "remote_html_is_not_part_of_the_native_content_contract",
  },
];

const semanticCoreBase = canonicalize({
  schemaVersion: "yw-native-core-bundle-v1",
  siteKey: "yw",
  rights: RIGHTS_PROVENANCE,
  provenance: RIGHTS_PROVENANCE,
  counts,
  exclusions,
  readerProjection: {
    schemaVersion: readerIndex.schemaVersion,
    curationVersion: readerIndex.curationVersion,
    readerSemanticDigest: readerIndex.readerSemanticDigest,
    indexSha256: sha256(readerIndexBytes),
    mediaReceiptLedger: readerIndex.mediaReceiptLedger,
  },
  classicalFirstRead: {
    index: normalizedClassicalFirstReadIndex,
    lessons: classicalFirstReadLessons,
  },
  catalog: catalogBase,
  lessons: normalizedLessons,
  vocab: {
    eligibility: vocabEligibility,
    index: normalizedVocabIndex,
    lessons: vocabLessons,
  },
  media: normalizedMediaBase,
  tombstones: normalizedTombstones,
  learningManifest,
  interactionDefinitions,
});

const semanticInput = serialize({
  schemaVersion: "yw-native-semantic-digest-v2",
  rights: RIGHTS_PROVENANCE,
  provenance: RIGHTS_PROVENANCE,
  core: semanticCoreBase,
});
const semanticHex = sha256(semanticInput);
const semanticDigest = `sha256:${semanticHex}`;
const contentVersion = `yw-${semanticHex.slice(0, 24)}`;
const auditReceiptBytes = readFileSync(AUDIT_RECEIPT_FILE);
const auditReceipt = JSON.parse(auditReceiptBytes.toString("utf8"));
const auditIssues = auditReceiptIssues(auditReceipt, { semanticDigest, counts });
const releaseBlockers = [];
if (mutableApprovedMedia.length > 0) {
  releaseBlockers.push({
    code: "approved_media_url_not_content_addressed",
    count: mutableApprovedMedia.length,
  });
}
if (auditIssues.length > 0) {
  releaseBlockers.push({
    code: "canonical_graph_review_required",
    count: auditIssues.length,
  });
}
if (appDisposition !== "blocked") {
  assert(auditIssues.length === 0, `native content audit receipt is stale: ${auditIssues.join("; ")}`);
}
if (promoteStable) {
  assert(
    process.env.YW_NATIVE_CONTENT_AUDIT_RECEIPT === undefined,
    "--promote-stable must use the tracked native content audit receipt",
  );
  assert(auditIssues.length === 0, "--promote-stable requires an approved current content audit receipt");
}
const versionedCatalog = canonicalize({ ...catalogBase, contentVersion });
const versionedLessons = normalizedLessons.map((lesson) => canonicalize({ ...lesson, contentVersion }));
const versionedMedia = canonicalize({ ...normalizedMediaBase, contentVersion });
const coreBundle = canonicalize({
  ...semanticCoreBase,
  releaseGate,
  securityRedactions: redactions,
  contentVersion,
  semanticDigest,
  catalog: versionedCatalog,
  lessons: versionedLessons,
  media: versionedMedia,
});

const objects = [];
function addObject(id, kind, relativePath, value, {
  required = false,
  mediaType = "application/json",
} = {}) {
  assert(!relativePath.startsWith("/") && !relativePath.split("/").includes(".."), `unsafe object path: ${relativePath}`);
  const body = serialize(value);
  objects.push({
    id,
    kind,
    path: relativePath,
    sha256: sha256(body),
    bytes: Buffer.byteLength(body),
    mediaType,
    required,
    body,
  });
}

addObject("core", "core-bundle", "core-bundle.json", coreBundle, {
  required: true,
  mediaType: "application/json",
});
addObject("catalog", "catalog", "catalog.json", versionedCatalog);
addObject("media", "media", "media.json", versionedMedia);
addObject("tombstones", "tombstones", "tombstones.json", normalizedTombstones);
addObject("learning-manifest", "learning-manifest", "learning-manifest.json", learningManifest);
addObject("interaction-definitions", "interaction-definitions", "interaction-definitions.json", interactionDefinitions);
addObject("vocab-eligibility", "vocab-eligibility", "vocab-eligibility.json", vocabEligibility);
for (const lesson of versionedLessons) {
  addObject(lesson.id, "lesson", `lessons/${lesson.id}.json`, lesson);
}
addObject("vocab-index", "vocab-index", "vocab/index.json", normalizedVocabIndex);
for (const bank of vocabLessons) {
  addObject(bank.lessonId, "vocab-lesson", `vocab/${bank.lessonId}.json`, bank);
}
addObject(
  "classical-first-read-index",
  "classical-first-read-index",
  "classical-first-read/index.json",
  normalizedClassicalFirstReadIndex,
);
for (const lesson of classicalFirstReadLessons) {
  addObject(
    lesson.lessonId,
    "classical-first-read",
    `classical-first-read/${lesson.lessonId}.json`,
    lesson,
  );
}
objects.sort((left, right) => left.path.localeCompare(right.path, "en"));

const semanticObjectReceipts = objects.map(({ body: _body, ...receipt }) => receipt);
const releaseReceiptInput = serialize({
  schemaVersion: "yw-native-release-receipt-v1",
  semanticDigest,
  releaseGate,
  objects: semanticObjectReceipts,
});
const releaseReceiptId = `sha256-${sha256(releaseReceiptInput)}`;
const releasePrefix = `releases/${contentVersion}/${releaseReceiptId}`;
const releaseDirectory = path.join(OUTPUT_ROOT, releasePrefix);

const manifestObjects = semanticObjectReceipts.map((receipt) => ({
  ...receipt,
  href: `${BASE_URL}/${releasePrefix}/${receipt.path}`,
}));
const manifest = canonicalize({
  schemaVersion: "yw-native-content-manifest-v1",
  siteKey: "yw",
  contentVersion,
  semanticDigest,
  releaseReceiptId,
  rights: RIGHTS_PROVENANCE,
  provenance: RIGHTS_PROVENANCE,
  ...releaseGate,
  counts: { ...counts, objects: manifestObjects.length },
  exclusions,
  securityRedactions: redactions,
  sourceProvenance: {
    sourceManifest: {
      path: "site/data/manifest.json",
      sha256: sha256(sourceManifestBytes),
    },
    readerDocumentIndex: {
      path: "site/data/reader-documents/index.json",
      sha256: sha256(readerIndexBytes),
      readerSemanticDigest: readerIndex.readerSemanticDigest,
      curationVersion: readerIndex.curationVersion,
    },
    readerMediaReceiptLedger: {
      path: "site/data/reader-media-receipts.v1.json",
      sha256: sha256(readerMediaReceiptBytes),
      schemaVersion: readerMediaReceiptLedger.schemaVersion,
      ledgerVersion: readerMediaReceiptLedger.ledgerVersion,
      sourceInventorySha256: readerMediaReceiptLedger.sourceInventorySha256,
      receiptCount: readerMediaReceiptLedger.receiptCount,
      totalBytes: readerMediaReceiptLedger.totalBytes,
      rightsBasis: readerMediaReceiptLedger.rightsBasis,
    },
    classicalFirstReadIndex: {
      path: "site/data/classical-first-read/index.json",
      sha256: sha256(classicalFirstReadIndexBytes),
      schema: classicalFirstReadSourceIndex.schema,
      policyId: classicalFirstReadSourceIndex.policyId,
      policyDigest: classicalFirstReadSourceIndex.policyDigest,
      lessonCount: classicalFirstReadSourceIndex.lessonCount,
    },
    learningManifest: {
      path: "site/data/learning-manifest.json",
      sha256: sha256(readFileSync(path.join(DATA, "learning-manifest.json"))),
    },
    vocabEligibility: {
      path: "site/data/vocab-eligibility.json",
      sha256: sha256(vocabEligibilityBytes),
      policyVersion: vocabEligibility.policyVersion,
      exceptionCount: vocabEligibility.exceptions.length,
    },
    nativeContentAuditReceipt: {
      path: "scripts/native_content_audit_receipt.json",
      sha256: sha256(auditReceiptBytes),
      reviewedAt: auditReceipt.reviewedAt,
      reviewDisposition: auditReceipt.reviewDisposition,
    },
    pageHashInventory: {
      source: "jc-textbook-reader/manifests/page-images.sha256",
      sha256: sha256(pageHashInventoryBytes),
      bytes: pageHashInventoryBytes.length,
      entries: pageHashInventory.size,
    },
  },
  objects: manifestObjects,
});
const manifestBody = serialize(manifest);
const manifestReceipt = {
  path: `${releasePrefix}/manifest.json`,
  href: `${BASE_URL}/${releasePrefix}/manifest.json`,
  sha256: sha256(manifestBody),
  bytes: Buffer.byteLength(manifestBody),
  mediaType: "application/json",
};
const coreReceipt = manifestObjects.find((object) => object.id === "core");
assert(coreReceipt.bytes < CORE_MAX_BYTES, `core bundle is ${coreReceipt.bytes} bytes; limit is ${CORE_MAX_BYTES}`);
const pointer = canonicalize({
  schemaVersion: "yw-native-content-pointer-v1",
  siteKey: "yw",
  contentVersion,
  semanticDigest,
  releaseReceiptId,
  rights: RIGHTS_PROVENANCE,
  provenance: RIGHTS_PROVENANCE,
  counts,
  ...releaseGate,
  manifest: manifestReceipt,
  coreBundle: {
    path: `${releasePrefix}/${coreReceipt.path}`,
    href: coreReceipt.href,
    sha256: coreReceipt.sha256,
    bytes: coreReceipt.bytes,
    mediaType: coreReceipt.mediaType,
  },
});

mkdirSync(releaseDirectory, { recursive: true });
const immutableWrites = { unchanged: 0, written: 0 };
for (const object of objects) {
  const output = path.join(releaseDirectory, object.path);
  immutableWrites[writeImmutableFile(output, object.body)] += 1;
}
immutableWrites[writeImmutableFile(path.join(releaseDirectory, "manifest.json"), manifestBody)] += 1;
mkdirSync(OUTPUT_ROOT, { recursive: true });
const pointerBody = serialize(pointer);
const candidatePointerFile = path.join(
  OUTPUT_ROOT,
  "candidates",
  contentVersion,
  `${releaseReceiptId}.json`,
);
immutableWrites[writeImmutableFile(candidatePointerFile, pointerBody)] += 1;
let pointerFile = candidatePointerFile;
let pointerKind = "candidate";
if (promoteStable) {
  const stablePointerFile = path.join(OUTPUT_ROOT, "latest-stable.json");
  const pendingStablePointerFile = `${stablePointerFile}.pending-${process.pid}`;
  writeFileSync(pendingStablePointerFile, pointerBody);
  renameSync(pendingStablePointerFile, stablePointerFile);
  pointerFile = stablePointerFile;
  pointerKind = "stable";
}

process.stdout.write(`${JSON.stringify({
  contentVersion,
  semanticDigest,
  releaseReceiptId,
  releaseDirectory: path.relative(ROOT, releaseDirectory),
  pointer: path.relative(ROOT, pointerFile),
  candidatePointer: path.relative(ROOT, candidatePointerFile),
  pointerKind,
  stablePromoted: promoteStable,
  objectCount: manifestObjects.length,
  coreBytes: coreReceipt.bytes,
  manifestBytes: manifestReceipt.bytes,
  immutableWrites,
  counts,
  releaseGate,
  audit: {
    receipt: path.relative(ROOT, AUDIT_RECEIPT_FILE),
    issues: auditIssues,
    status: auditIssues.length === 0 ? "approved" : "review-required",
  },
  releaseBlockers,
  securityRedactions: redactions,
}, null, 2)}\n`);
