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

const sourceManifest = json(path.join(DATA, "manifest.json"));
const activeIds = new Set(sourceManifest.lessons.map((lesson) => lesson.id));
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
const bookTitles = new Set(sourceManifest.lessons.map((lesson) => (
  lesson.textbookBookTitle || lesson.blockTitle
)).filter(Boolean));
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
  normalizedLessons.push(canonicalize({
    schemaVersion: "yw-native-lesson-v1",
    ...lesson,
    postCount: posts.length,
    body: posts.map((post) => post.plainText).join("\n\n"),
    posts,
    textbook,
  }));
}

const actualTotals = normalizedLessons.reduce((totals, lesson) => {
  totals.posts += lesson.posts.length;
  totals.textbookPageRefs += lesson.textbook.pageImages.length;
  totals.textbookContextPageRefs += lesson.textbook.contextPageImages.length;
  totals.forumImages += (lesson.forumImages || []).length;
  totals.resources += (lesson.resources || []).length;
  totals.annotations += (lesson.annotations || []).length;
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
const vocabFileIds = readdirSync(path.join(DATA, "vocab"))
  .filter((file) => file.endsWith(".json") && file !== "index.json")
  .map((file) => file.slice(0, -5))
  .sort((left, right) => left.localeCompare(right, "en"));
assert(
  JSON.stringify(vocabFileIds) === JSON.stringify(vocabLessonIds),
  "vocab index and JSON file inventory differ",
);
const vocabLessons = [];
let vocabInventoryItems = 0;
let vocabQuestions = 0;
const vocabDecisionCounts = {};
for (const lessonId of vocabLessonIds) {
  assert(activeIds.has(lessonId), `vocab references inactive lesson: ${lessonId}`);
  const bank = sanitizeValue(json(path.join(DATA, "vocab", `${lessonId}.json`)));
  assert(bank.lessonId === lessonId, `${lessonId}: vocab identity mismatch`);
  vocabInventoryItems += bank.inventory.length;
  for (const item of bank.inventory) {
    vocabDecisionCounts[item.decision] = (vocabDecisionCounts[item.decision] || 0) + 1;
    if (item.decision === "question") vocabQuestions += 1;
  }
  assert(vocabSourceIndex.lessons[lessonId] === bank.inventory.filter((item) => item.decision === "question").length,
    `${lessonId}: vocab index question count mismatch`);
  vocabLessons.push(canonicalize(bank));
}
const normalizedVocabIndex = canonicalize({
  schemaVersion: "yw-native-vocab-index-v1",
  lessonCount: vocabLessonIds.length,
  inventoryFileCount: vocabLessonIds.length + 1,
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
const mediaLessons = mediaSource.lessons.map((item) => {
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
  blocks: sourceManifest.blocks.map((block) => ({
    id: block.id,
    title: block.title,
    lessonCount: block.lessons.length,
    lessonIds: block.lessons.map((lesson) => lesson.id),
  })),
  lessons: sourceManifest.lessons.map((lesson) => ({
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
    vocabPath: vocabLessonIds.includes(lesson.id) ? `vocab/${lesson.id}.json` : null,
  })),
});

const learningManifest = canonicalize(sanitizeValue(json(path.join(DATA, "learning-manifest.json"))));
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
  vocabLessonFiles: vocabLessonIds.length,
  vocabInventoryFiles: vocabLessonIds.length + 1,
  vocabInventoryItems,
  vocabQuestions,
  vocabularyLessons: vocabLessonIds.length,
  vocabularyQuestions: vocabQuestions,
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
  catalog: catalogBase,
  lessons: normalizedLessons,
  vocab: {
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
for (const lesson of versionedLessons) {
  addObject(lesson.id, "lesson", `lessons/${lesson.id}.json`, lesson);
}
addObject("vocab-index", "vocab-index", "vocab/index.json", normalizedVocabIndex);
for (const bank of vocabLessons) {
  addObject(bank.lessonId, "vocab-lesson", `vocab/${bank.lessonId}.json`, bank);
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
      sha256: sha256(readFileSync(path.join(DATA, "manifest.json"))),
    },
    learningManifest: {
      path: "site/data/learning-manifest.json",
      sha256: sha256(readFileSync(path.join(DATA, "learning-manifest.json"))),
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
