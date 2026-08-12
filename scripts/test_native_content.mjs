#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import test, { after } from "node:test";
import os from "node:os";
import path from "node:path";
import { auditReceiptIssues } from "./native_content_release_contract.mjs";
import {
  createUrlSanitizer,
  privacyIssueCounts,
} from "./native_content_url_sanitizer.mjs";
import { nativeContentAssetContentTypeMatches } from "../site/_worker.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const SITE_ROOT = path.join(ROOT, "site");
const RELEASE_SITE_ROOT = path.join(ROOT, ".release", "site");
const OUTPUT_ROOT = mkdtempSync(path.join(os.tmpdir(), "yw-native-content-tests-"));
const MAX_CORE_BYTES = 25 * 1024 * 1024;
const MAX_PAGES_FILES = 20_000;
const RIGHTS_PROVENANCE = "user-authorized-for-bdfz-yw-app-2026-07-29";
const SENSITIVE_QUERY_KEY = /(^|[_-])(access|api|auth|authorization|cookie|credential|jwt|key|password|refresh|secret|session|sig|signature|token)([_-]|$)|^(chksm|continue|dsh|followup|ifkv|osid|sn|state)$/i;
const FORBIDDEN_AUTH_QUERY = /[?&](?:continue|dsh|followup|ifkv|osid)=/i;
const PRIVATE_NOTEBOOK_PATH = /notebooklm\.google\.com\/notebook\/[^"'\\/\s?#]+/i;
const AI_STUDIO_PROMPT_QUERY = /aistudio\.google\.com\/app\/prompts\?[^"'\\\s#]*(?:state|usp)=/i;
const BILIBILI_TRACKING_QUERY = /bilibili\.com\/[^"'\\\s#?]*\?[^"'\\\s#]*(?:vd_source|spm_id_from)=/i;
const GOOGLE_REDIRECT_QUERY = /google\.com\/url\?[^"'\\\s#]*(?:q|url|usg)=/i;
const PATH_SESSION_IDENTIFIER = /;jsessionid=/i;
const SEIUE_LOGIN_QUERY = /passport\.seiue\.com\/go\/?\?/i;
const SITES_AUTH_QUERY = /sites\.google\.com\/[^"'\\\s#?]*\?[^"'\\\s#]*authuser=/i;
const YUQUE_LOGIN_QUERY = /(?:^|\/\/)(?:[^/]+\.)?yuque\.com\/login\/?\?/i;

after(() => rmSync(OUTPUT_ROOT, { recursive: true, force: true }));

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

function json(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function runBuild(extraArgs = [], extraEnv = {}) {
  return JSON.parse(execFileSync(process.execPath, [
    "scripts/build_native_content.mjs",
    "--allow-dirty",
    ...extraArgs,
  ], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      YW_NATIVE_CONTENT_OUTPUT_ROOT: OUTPUT_ROOT,
      ...extraEnv,
    },
  }));
}

function collectFiles(root, prefix = "") {
  const files = [];
  for (const entry of readdirSync(path.join(root, prefix), { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(root, relative);
    assert.equal(lstatSync(full).isSymbolicLink(), false, `symlink forbidden: ${relative}`);
    if (entry.isDirectory()) files.push(...collectFiles(root, relative));
    else if (entry.isFile()) files.push(relative);
  }
  return files.sort((left, right) => left.localeCompare(right, "en"));
}

function snapshot(root) {
  return Object.fromEntries(collectFiles(root).map((file) => {
    const bytes = readFileSync(path.join(root, file));
    return [file, {
      bytes: bytes.length,
      mtimeMs: statSync(path.join(root, file)).mtimeMs,
      sha256: sha256(bytes),
    }];
  }));
}

function visit(value, callback, pathParts = []) {
  callback(value, pathParts);
  if (Array.isArray(value)) value.forEach((item, index) => visit(item, callback, [...pathParts, index]));
  else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) visit(item, callback, [...pathParts, key]);
  }
}

function urlsIn(value) {
  const urls = [];
  visit(value, (item) => {
    if (typeof item !== "string") return;
    for (const match of item.matchAll(/https?:\/\/[^\s<>"'，。；！？、）】》]+/gu)) urls.push(match[0]);
  });
  return urls;
}

function readerRunText(run) {
  if (run?.type === "text" || run?.type === "link") return run.text || "";
  if (run?.type === "annotation-ref") return run.label || "";
  if (run?.type === "media-ref") return run.alt || "";
  return "";
}

function readerBlockText(block) {
  if (!block) return "";
  if (Array.isArray(block.runs)) return block.runs.map(readerRunText).join("");
  if (Array.isArray(block.blocks)) return block.blocks.map(readerBlockText).join("\n");
  if (Array.isArray(block.items)) {
    return block.items.flatMap((item) => item.blocks || []).map(readerBlockText).join("\n");
  }
  if (Array.isArray(block.rows)) {
    return block.rows.flat().map((cell) => readerBlockText(cell)).join("\n");
  }
  return String(block.text || "");
}

function expectedReaderBody(document) {
  return [
    ...(document.main?.frontMatter || []),
    ...(document.main?.guidance || []),
    ...(document.main?.blocks || []),
  ].map(readerBlockText).join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

function collectAnnotationRefs(blocks) {
  const refs = [];
  visit(blocks, (item) => {
    if (item?.type === "annotation-ref") refs.push(item.noteId);
  });
  return refs;
}

function decodePercentEscapes(value) {
  let decoded = String(value);
  for (let pass = 0; pass < 3; pass += 1) {
    const next = decoded.replace(/(?:%[0-9a-f]{2})+/gi, (encoded) => {
      try {
        return decodeURIComponent(encoded);
      } catch {
        return encoded;
      }
    });
    if (next === decoded) break;
    decoded = next;
  }
  return decoded;
}

function deriveSourceCounts() {
  const sourceManifest = json(path.join(SITE_ROOT, "data", "manifest.json"));
  const learningManifest = json(path.join(SITE_ROOT, "data", "learning-manifest.json"));
  const excludedIds = new Set((learningManifest.exclusions || []).map((item) => item.lessonId));
  const nativeManifestLessons = sourceManifest.lessons.filter((lesson) => !excludedIds.has(lesson.id));
  const sourceLessons = nativeManifestLessons.map((lesson) => (
    json(path.join(SITE_ROOT, lesson.dataUrl))
  ));
  const readerIndex = json(path.join(SITE_ROOT, "data", "reader-documents", "index.json"));
  assert.equal(readerIndex.schemaVersion, "yw-reader-document-index-v1");
  assert.deepEqual(
    Object.keys(readerIndex.documents).sort(),
    sourceManifest.lessons.map((lesson) => lesson.id).sort(),
    "reader/source lesson inventory",
  );
  const readerAnnotations = nativeManifestLessons.reduce((count, lesson) => {
    const receipt = readerIndex.documents[lesson.id];
    const document = json(path.join(SITE_ROOT, "data", receipt.path));
    return count
      + (document.main?.annotations || []).length
      + (document.supplementary || []).reduce(
        (subtotal, section) => subtotal + (section.annotations || []).length,
        0,
      );
  }, 0);
  const lessonTotals = sourceLessons.reduce((totals, lesson) => {
    const posts = lesson.posts || [];
    const pageImages = lesson.textbook?.pageImages || [];
    const contextPageImages = lesson.textbook?.contextPageImages || [];
    totals.posts += posts.length;
    totals.textbookPageRefs += pageImages.length;
    totals.textbookContextPageRefs += contextPageImages.length;
    totals.forumImages += (lesson.forumImages || []).length;
    totals.resources += (lesson.resources || []).length;
    totals.learningTasks += (lesson.learningTasks || []).length;
    totals.postAttachments += posts.flatMap((post) => post.attachments || []).length;
    totals.postImages += posts.flatMap((post) => post.images || []).length;
    totals.postLinks += posts.flatMap((post) => post.links || []).length;
    for (const page of pageImages) totals.activePageUrls.add(page.src);
    for (const page of contextPageImages) totals.contextPageUrls.add(page.src);
    return totals;
  }, {
    activePageUrls: new Set(),
    contextPageUrls: new Set(),
    forumImages: 0,
    learningTasks: 0,
    postAttachments: 0,
    postImages: 0,
    postLinks: 0,
    posts: 0,
    resources: 0,
    textbookContextPageRefs: 0,
    textbookPageRefs: 0,
  });
  const vocabIndex = json(path.join(SITE_ROOT, "data", "vocab", "index.json"));
  const vocabIds = Object.keys(vocabIndex.lessons)
    .filter((lessonId) => Number(vocabIndex.lessons[lessonId]) > 0 && !excludedIds.has(lessonId));
  const vocabBanks = vocabIds.map((lessonId) => (
    json(path.join(SITE_ROOT, "data", "vocab", `${lessonId}.json`))
  ));
  const vocabInventoryItems = vocabBanks.reduce((sum, bank) => sum + bank.inventory.length, 0);
  const vocabQuestions = vocabBanks.reduce((sum, bank) => (
    sum + bank.inventory.filter((item) => item.decision === "question").length
  ), 0);
  const classicalFirstReadIndex = json(path.join(
    SITE_ROOT,
    "data",
    "classical-first-read",
    "index.json",
  ));
  const media = json(path.join(SITE_ROOT, "data", "lesson-media.json"));
  const nativeMedia = media.lessons.filter((lesson) => !excludedIds.has(lesson.lessonId));
  const approvedDecks = nativeMedia.filter((lesson) => (
    lesson.reviewStatus?.slideDeck === "approved"
  )).length;
  const activeIds = new Set(sourceManifest.lessons.map((lesson) => lesson.id));
  const lessonInventory = readdirSync(path.join(SITE_ROOT, "data", "lessons"))
    .filter((file) => /^lesson-.+\.json$/.test(file))
    .map((file) => file.slice(0, -5));
  return canonicalize({
    annotations: readerAnnotations,
    approvedDecks,
    approvedSlideDecks: approvedDecks,
    blockedTextbookPageRefs: 0,
    blocks: sourceManifest.blocks.length,
    books: new Set(nativeManifestLessons.map((lesson) => (
      lesson.textbookBookTitle || lesson.blockTitle
    )).filter(Boolean)).size,
    catalogedDecks: nativeMedia.length - approvedDecks,
    classicalFirstReadLessons: classicalFirstReadIndex.lessonCount,
    classicalFirstReadParagraphs: classicalFirstReadIndex.lessons.reduce(
      (sum, lesson) => sum + lesson.paragraphCount,
      0,
    ),
    compositeTombstones: lessonInventory.filter((lessonId) => !activeIds.has(lessonId)).length,
    forumImages: lessonTotals.forumImages,
    learningTasks: lessonTotals.learningTasks,
    lessons: nativeManifestLessons.length,
    mediaCatalogLessons: nativeMedia.length,
    postAttachments: lessonTotals.postAttachments,
    postImages: lessonTotals.postImages,
    postLinks: lessonTotals.postLinks,
    posts: lessonTotals.posts,
    resources: lessonTotals.resources,
    textbookContextPageRefs: lessonTotals.textbookContextPageRefs,
    textbookPageRefs: lessonTotals.textbookPageRefs,
    uniqueTextbookContextPageAssets: lessonTotals.contextPageUrls.size,
    uniqueTextbookPageAssets: lessonTotals.activePageUrls.size,
    verifiedTextbookPageRefs: lessonTotals.textbookPageRefs,
    vocabInventoryFiles: vocabIds.length + 1,
    vocabInventoryItems,
    vocabLessonFiles: vocabIds.length,
    vocabQuestions,
    vocabularyLessons: vocabIds.length,
    vocabularyQuestions: vocabQuestions,
  });
}

const firstBuild = runBuild();
const pointerFile = path.resolve(ROOT, firstBuild.pointer);
const firstPointer = json(pointerFile);
const releaseRoot = path.dirname(path.join(OUTPUT_ROOT, firstPointer.manifest.path));
const firstSnapshot = {
  pointer: {
    bytes: readFileSync(pointerFile).length,
    mtimeMs: statSync(pointerFile).mtimeMs,
    sha256: sha256(readFileSync(pointerFile)),
  },
  release: snapshot(releaseRoot),
};
const secondBuild = runBuild();
const secondPointerFile = path.resolve(ROOT, secondBuild.pointer);
const secondPointer = json(secondPointerFile);
const secondReleaseRoot = path.dirname(path.join(OUTPUT_ROOT, secondPointer.manifest.path));
const secondSnapshot = {
  pointer: {
    bytes: readFileSync(secondPointerFile).length,
    mtimeMs: statSync(secondPointerFile).mtimeMs,
    sha256: sha256(readFileSync(secondPointerFile)),
  },
  release: snapshot(secondReleaseRoot),
};

test("two builds are byte-identical", () => {
  assert.equal(secondBuild.contentVersion, firstBuild.contentVersion);
  assert.equal(secondBuild.semanticDigest, firstBuild.semanticDigest);
  assert.deepEqual(secondSnapshot, firstSnapshot);
});

test("blocked development builds only write a receipt-scoped candidate pointer", () => {
  assert.equal(firstBuild.pointerKind, "candidate");
  assert.equal(firstBuild.stablePromoted, false);
  assert.equal(firstBuild.pointer, firstBuild.candidatePointer);
  assert.equal(secondBuild.pointer, firstBuild.pointer);
  assert.equal(path.resolve(ROOT, firstBuild.pointer).startsWith(`${OUTPUT_ROOT}${path.sep}`), true);
  assert.match(
    path.relative(OUTPUT_ROOT, pointerFile),
    new RegExp(`^candidates/${firstBuild.contentVersion}/${firstBuild.releaseReceiptId}\\.json$`),
  );
  assert.equal(lstatSync(pointerFile).isFile(), true);
  assert.equal(
    readdirSync(OUTPUT_ROOT).includes("latest-stable.json"),
    false,
    "blocked build must not create or overwrite latest-stable.json",
  );
});

const pointer = secondPointer;
const manifestFile = path.join(OUTPUT_ROOT, pointer.manifest.path);
const coreFile = path.join(OUTPUT_ROOT, pointer.coreBundle.path);
const manifestBytes = readFileSync(manifestFile);
const coreBytes = readFileSync(coreFile);
const manifest = JSON.parse(manifestBytes);
const core = JSON.parse(coreBytes);
const sourceCounts = deriveSourceCounts();
const auditReceipt = json(path.join(ROOT, "scripts", "native_content_audit_receipt.json"));

test("pointer and immutable receipts are complete", () => {
  assert.equal(pointer.schemaVersion, "yw-native-content-pointer-v1");
  assert.match(pointer.contentVersion, /^yw-[a-f0-9]{24}$/);
  assert.match(pointer.semanticDigest, /^sha256:[a-f0-9]{64}$/);
  assert.match(pointer.releaseReceiptId, /^sha256-[a-f0-9]{64}$/);
  assert.equal(pointer.releaseReceiptId, manifest.releaseReceiptId);
  assert.equal(pointer.deploymentId, null);
  for (const key of ["sourceRevision", "sourceClean", "deploymentId", "publishedAt", "appDisposition"]) {
    assert.ok(Object.hasOwn(pointer, key), `pointer missing ${key}`);
    assert.deepEqual(pointer[key], manifest[key], `${key} differs between pointer and manifest`);
  }
  assert.ok(["compatible-and-synced", "compatible-no-client-release", "blocked"].includes(pointer.appDisposition));
  assert.equal(pointer.manifest.sha256, sha256(manifestBytes));
  assert.equal(pointer.manifest.bytes, manifestBytes.length);
  assert.equal(pointer.coreBundle.sha256, sha256(coreBytes));
  assert.equal(pointer.coreBundle.bytes, coreBytes.length);
  assert.ok(coreBytes.length < MAX_CORE_BYTES, `core bundle exceeds 25 MiB: ${coreBytes.length}`);
  assert.equal(pointer.coreBundle.mediaType, "application/json");
  assert.equal(pointer.rights, RIGHTS_PROVENANCE);
  assert.equal(pointer.provenance, RIGHTS_PROVENANCE);
  assert.equal(manifest.rights, RIGHTS_PROVENANCE);
  assert.equal(manifest.provenance, RIGHTS_PROVENANCE);
  assert.equal(core.rights, RIGHTS_PROVENANCE);
  assert.equal(core.provenance, RIGHTS_PROVENANCE);
  assert.equal(core.semanticDigest, pointer.semanticDigest);
  assert.equal(core.contentVersion, pointer.contentVersion);
  assert.deepEqual(pointer.counts, sourceCounts);
  assert.deepEqual(core.counts, sourceCounts);
  assert.deepEqual(core.releaseGate, {
    appDisposition: pointer.appDisposition,
    deploymentId: pointer.deploymentId,
    publishedAt: pointer.publishedAt,
    sourceClean: pointer.sourceClean,
    sourceRevision: pointer.sourceRevision,
  });
});

test("review receipt state is reflected exactly in the candidate release gate", () => {
  const auditIssues = auditReceiptIssues(auditReceipt, {
    semanticDigest: pointer.semanticDigest,
    counts: sourceCounts,
  });
  assert.deepEqual(firstBuild.audit.issues, auditIssues);
  assert.equal(
    firstBuild.audit.status,
    auditIssues.length === 0 ? "approved" : "review-required",
  );
  assert.deepEqual(
    firstBuild.releaseBlockers.filter(({ code }) => code === "canonical_graph_review_required"),
    auditIssues.length > 0
      ? [{ code: "canonical_graph_review_required", count: auditIssues.length }]
      : [],
  );
  assert.equal(pointer.appDisposition, "blocked");
  const driftedCounts = { ...sourceCounts, lessons: sourceCounts.lessons + 1 };
  assert.ok(auditReceiptIssues(auditReceipt, {
    semanticDigest: pointer.semanticDigest,
    counts: driftedCounts,
  }).length > 0);
});

test("manifest object receipts match every immutable object", () => {
  assert.equal(manifest.schemaVersion, "yw-native-content-manifest-v1");
  assert.equal(manifest.counts.objects, manifest.objects.length);
  const { objects: _objects, ...manifestCounts } = manifest.counts;
  assert.deepEqual(manifestCounts, sourceCounts);
  assert.equal(manifest.objects.find((object) => object.id === "media")?.kind, "media");
  assert.equal(new Set(manifest.objects.map((object) => object.path)).size, manifest.objects.length);
  for (const object of manifest.objects) {
    assert.equal(path.isAbsolute(object.path), false);
    assert.equal(object.path.split("/").includes(".."), false);
    assert.match(object.href, new RegExp(`^https://yw\\.bdfz\\.net/app-content/releases/${pointer.contentVersion}/`));
    const file = path.join(secondReleaseRoot, object.path);
    const bytes = readFileSync(file);
    assert.equal(bytes.length, object.bytes, `${object.path}: byte count`);
    assert.equal(sha256(bytes), object.sha256, `${object.path}: sha256`);
    assert.ok(["application/json", "application/octet-stream"].includes(object.mediaType));
  }
  const expected = new Set(["manifest.json", ...manifest.objects.map((object) => object.path)]);
  assert.deepEqual(new Set(collectFiles(secondReleaseRoot)), expected);
  const receipts = manifest.objects.map(({ href: _href, ...receipt }) => receipt);
  const releaseReceiptInput = serialize({
    schemaVersion: "yw-native-release-receipt-v1",
    semanticDigest: manifest.semanticDigest,
    releaseGate: {
      sourceRevision: manifest.sourceRevision,
      sourceClean: manifest.sourceClean,
      deploymentId: manifest.deploymentId,
      publishedAt: manifest.publishedAt,
      appDisposition: manifest.appDisposition,
    },
    objects: receipts,
  });
  assert.equal(manifest.releaseReceiptId, `sha256-${sha256(releaseReceiptInput)}`);
  assert.equal(
    manifest.objects.length,
    core.lessons.length
      + core.vocab.lessons.length
      + core.classicalFirstRead.lessons.length
      + 9,
  );
  assert.deepEqual(firstBuild.immutableWrites, {
    unchanged: 0,
    written: manifest.objects.length + 2,
  });
  assert.deepEqual(secondBuild.immutableWrites, {
    unchanged: manifest.objects.length + 2,
    written: 0,
  });
});

test("immutable receipt paths reject byte mismatches", () => {
  const temporaryOutput = mkdtempSync(path.join(os.tmpdir(), "yw-native-immutable-"));
  try {
    const build = runBuild([], { YW_NATIVE_CONTENT_OUTPUT_ROOT: temporaryOutput });
    const temporaryPointer = json(path.resolve(ROOT, build.pointer));
    const target = path.join(temporaryOutput, temporaryPointer.coreBundle.path);
    writeFileSync(target, Buffer.concat([readFileSync(target), Buffer.from(" ")]));
    let failure;
    try {
      runBuild([], { YW_NATIVE_CONTENT_OUTPUT_ROOT: temporaryOutput });
    } catch (error) {
      failure = error;
    }
    assert.ok(failure, "immutable mismatch unexpectedly succeeded");
    assert.match(String(failure.stderr), /immutable path already exists with different bytes/);
  } finally {
    rmSync(temporaryOutput, { recursive: true, force: true });
  }
});

test("semantic digest covers the canonical unversioned semantic graph", () => {
  const unversionedCore = structuredClone(core);
  delete unversionedCore.contentVersion;
  delete unversionedCore.semanticDigest;
  delete unversionedCore.releaseGate;
  delete unversionedCore.securityRedactions;
  delete unversionedCore.catalog.contentVersion;
  delete unversionedCore.media.contentVersion;
  for (const lesson of unversionedCore.lessons) delete lesson.contentVersion;
  const semanticInput = serialize({
    schemaVersion: "yw-native-semantic-digest-v2",
    rights: RIGHTS_PROVENANCE,
    provenance: RIGHTS_PROVENANCE,
    core: unversionedCore,
  });
  assert.equal(manifest.semanticDigest, `sha256:${sha256(semanticInput)}`);
});

test("release metadata changes the immutable receipt, not semantic content identity", () => {
  const temporaryOutput = mkdtempSync(path.join(os.tmpdir(), "yw-native-content-"));
  try {
    const variantBuild = runBuild([
      "--deployment-id", "preview-receipt-not-a-pages-id",
      "--published-at", "2026-07-29T00:00:00Z",
    ], {
      YW_NATIVE_CONTENT_OUTPUT_ROOT: temporaryOutput,
    });
    const variantPointer = json(path.resolve(ROOT, variantBuild.pointer));
    assert.equal(variantBuild.contentVersion, pointer.contentVersion);
    assert.equal(variantBuild.semanticDigest, pointer.semanticDigest);
    assert.notEqual(variantPointer.releaseReceiptId, pointer.releaseReceiptId);
    assert.equal(variantPointer.deploymentId, "preview-receipt-not-a-pages-id");
    assert.equal(variantPointer.publishedAt, "2026-07-29T00:00:00Z");

    const alternateGate = {
      appDisposition: "compatible-and-synced",
      deploymentId: null,
      publishedAt: null,
      sourceClean: true,
      sourceRevision: "f".repeat(40),
    };
    const semanticGraph = structuredClone(core);
    delete semanticGraph.contentVersion;
    delete semanticGraph.semanticDigest;
    delete semanticGraph.releaseGate;
    delete semanticGraph.securityRedactions;
    delete semanticGraph.catalog.contentVersion;
    delete semanticGraph.media.contentVersion;
    for (const lesson of semanticGraph.lessons) delete lesson.contentVersion;
    const semanticWithAlternateGateIgnored = serialize({
      schemaVersion: "yw-native-semantic-digest-v2",
      rights: RIGHTS_PROVENANCE,
      provenance: RIGHTS_PROVENANCE,
      core: semanticGraph,
    });
    assert.equal(`sha256:${sha256(semanticWithAlternateGateIgnored)}`, pointer.semanticDigest);
    assert.notDeepEqual(alternateGate, core.releaseGate);
  } finally {
    rmSync(temporaryOutput, { recursive: true, force: true });
  }
});

test("dirty source cannot promote a compatible stable pointer", () => {
  const dirtyMarker = path.join(
    ROOT,
    `.native-content-dirty-test-${process.pid}`,
  );
  writeFileSync(dirtyMarker, "intentional test-only dirty marker\n");
  let failure;
  try {
    execFileSync(process.execPath, [
      "scripts/build_native_content.mjs",
      "--allow-dirty",
      "--app-disposition", "compatible-and-synced",
      "--promote-stable",
      "--deployment-id", "609fdc2b-0410-4f14-b553-b0df3916b6df",
      "--published-at", "2026-07-29T00:00:00Z",
    ], {
      cwd: ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        YW_NATIVE_CONTENT_OUTPUT_ROOT: OUTPUT_ROOT,
      },
      stdio: "pipe",
    });
  } catch (error) {
    failure = error;
  } finally {
    rmSync(dirtyMarker, { force: true });
  }
  assert.ok(failure, "compatible promotion unexpectedly succeeded");
  assert.match(String(failure.stderr), /--allow-dirty may only be used with appDisposition=blocked/);
  assert.equal(readdirSync(OUTPUT_ROOT).includes("latest-stable.json"), false);
});

test("full active content and native body counts match the Web source", () => {
  const webManifest = json(path.join(ROOT, "site", "data", "manifest.json"));
  const webLessons = new Map(webManifest.lessons.map((lesson) => [lesson.id, lesson]));
  assert.equal(core.catalog.blocks.length, sourceCounts.blocks);
  assert.equal(core.catalog.schemaVersion, "yw-native-content-catalog-v1");
  assert.equal(core.catalog.contentVersion, pointer.contentVersion);
  assert.equal(core.catalog.lessons.length, sourceCounts.lessons);
  assert.equal(
    core.catalog.lessons.filter((lesson) => lesson.hasSlideDeck).length,
    sourceCounts.approvedDecks,
  );
  assert.equal(
    new Set(core.catalog.lessons.map((lesson) => lesson.bookTitle)).size,
    sourceCounts.books,
  );
  for (const lesson of core.catalog.lessons) {
    const source = webLessons.get(lesson.id);
    assert.equal(lesson.bookTitle, source.textbookBookTitle || source.blockTitle);
    assert.equal(typeof lesson.hasSlideDeck, "boolean");
  }
  assert.equal(core.lessons.length, sourceCounts.lessons);
  assert.equal(core.lessons.reduce((sum, lesson) => sum + lesson.posts.length, 0), sourceCounts.posts);
  assert.equal(core.lessons.reduce((sum, lesson) => sum + lesson.textbook.pageImages.length, 0), sourceCounts.textbookPageRefs);
  assert.equal(core.lessons.reduce((sum, lesson) => sum + lesson.forumImages.length, 0), sourceCounts.forumImages);
  assert.equal(core.lessons.reduce((sum, lesson) => sum + lesson.resources.length, 0), sourceCounts.resources);
  assert.equal(core.lessons.reduce((sum, lesson) => sum + lesson.posts.flatMap((post) => post.attachments || []).length, 0), sourceCounts.postAttachments);
  assert.equal(core.lessons.reduce((sum, lesson) => sum + lesson.posts.flatMap((post) => post.images || []).length, 0), sourceCounts.postImages);
  assert.equal(core.lessons.reduce((sum, lesson) => sum + lesson.posts.flatMap((post) => post.links || []).length, 0), sourceCounts.postLinks);
  for (const lesson of core.lessons) {
    assert.equal(lesson.schemaVersion, "yw-native-lesson-v1");
    assert.equal(lesson.contentVersion, pointer.contentVersion);
    assert.equal(lesson.body, expectedReaderBody(lesson.readerDocument), `${lesson.id}: reader body`);
    for (const post of lesson.posts) {
      assert.equal(typeof post.plainText, "string");
      assert.equal(Object.hasOwn(post, "cooked"), false);
      assert.equal(Object.hasOwn(post, "plain_text"), false);
    }
    for (const page of [...lesson.textbook.pageImages, ...lesson.textbook.contextPageImages]) {
      assert.match(page.sha256, /^[a-f0-9]{64}$/);
      assert.ok(page.bytes > 0);
      assert.equal(page.mediaType, "image/webp");
      assert.match(page.href, /^https:\/\/img\.rdfzer\.com\/pages\//);
      assert.equal(page.sourceUrl, page.href);
      assert.match(page.sourceLocalRef, /^textbook_ai_migration\/platform\/frontend\/assets\/pages\//);
      assert.equal(page.rightsBasis, "user-authorized-for-bdfz-yw-app-2026-07-29");
    }
  }
  assert.deepEqual(core.exclusions, [{
    field: "posts.cooked",
    count: sourceCounts.posts,
    reason: "remote_html_is_not_part_of_the_native_content_contract",
  }]);
});

test("shared reader projection assigns every post once and is byte-bound to Web", () => {
  const sourceManifestLessonCount = json(path.join(SITE_ROOT, "data", "manifest.json")).lessons.length;
  const readerIndexFile = path.join(SITE_ROOT, "data", "reader-documents", "index.json");
  const readerIndexBytes = readFileSync(readerIndexFile);
  const readerIndex = JSON.parse(readerIndexBytes.toString("utf8"));
  const curationFile = path.join(ROOT, "scripts", "reader_content_curation.v1.json");
  const curation = json(curationFile);
  const roleAuditFile = path.join(ROOT, "scripts", "reader_role_audit.v1.json");
  const roleAuditBytes = readFileSync(roleAuditFile);
  const roleAudit = JSON.parse(roleAuditBytes.toString("utf8"));
  const mediaReceiptFile = path.join(SITE_ROOT, "data", "reader-media-receipts.v1.json");
  const mediaReceiptBytes = readFileSync(mediaReceiptFile);
  const mediaReceiptLedger = JSON.parse(mediaReceiptBytes.toString("utf8"));
  const mediaReceiptByUrl = new Map(mediaReceiptLedger.receipts.map((receipt) => (
    [receipt.sourceUrl, receipt]
  )));
  const catalogLessons = new Map(core.catalog.lessons.map((lesson) => [lesson.id, lesson]));
  const sanitizedHashDifferences = [];
  assert.equal(curation.schemaVersion, "yw-reader-curation-v1");
  assert.equal(curation.rolePolicyVersion, "yw-reader-post-role-policy-v1");
  assert.equal(curation.review?.status, "reviewed");
  assert.equal(curation.review?.basis, "explicit-post-role-review-v1");
  assert.equal(roleAudit.schemaVersion, "yw-reader-role-audit-v1");
  assert.equal(roleAudit.rolePolicyVersion, curation.rolePolicyVersion);
  assert.equal(roleAudit.review?.status, "reviewed");
  assert.equal(roleAudit.review?.basis, "independent-reader-content-audit-v1");
  assert.equal(roleAudit.decisions.length, 9);
  assert.equal(new Set(roleAudit.decisions.map((decision) => (
    `${decision.lessonId}:${decision.postId}`
  ))).size, roleAudit.decisions.length);
  assert.equal(curation.lessons.length, sourceManifestLessonCount);
  assert.equal(new Set(curation.lessons.map((lesson) => lesson.lessonId)).size, sourceManifestLessonCount);
  assert.equal(readerIndex.schemaVersion, "yw-reader-document-index-v1");
  assert.equal(readerIndex.roleAuditVersion, roleAudit.auditVersion);
  assert.equal(readerIndex.roleAuditSha256, sha256(roleAuditBytes));
  assert.equal(readerIndex.roleOverrideCount, roleAudit.decisions.length);
  assert.equal(readerIndex.mediaReceiptLedger.schemaVersion, mediaReceiptLedger.schemaVersion);
  assert.equal(readerIndex.mediaReceiptLedger.ledgerVersion, mediaReceiptLedger.ledgerVersion);
  assert.equal(readerIndex.mediaReceiptLedger.sha256, sha256(mediaReceiptBytes));
  assert.equal(readerIndex.mediaReceiptLedger.receiptCount, 165);
  assert.equal(readerIndex.mediaReceiptLedger.totalBytes, 28066373);
  assert.equal(
    readerIndex.mediaReceiptLedger.sourceInventorySha256,
    mediaReceiptLedger.sourceInventorySha256,
  );
  assert.equal(readerIndex.lessonCount, sourceManifestLessonCount);
  assert.equal(core.readerProjection.schemaVersion, readerIndex.schemaVersion);
  assert.equal(core.readerProjection.curationVersion, readerIndex.curationVersion);
  assert.equal(core.readerProjection.readerSemanticDigest, readerIndex.readerSemanticDigest);
  assert.equal(core.readerProjection.indexSha256, sha256(readerIndexBytes));
  assert.equal(Object.keys(readerIndex.documents).length, sourceManifestLessonCount);

  const allowedRoles = new Set([
    "primary",
    "supplementary",
    "resource-only",
    "discussion",
    "reply",
    "source-only",
  ]);
  let assignedPosts = 0;
  let provenanceMedia = 0;
  let blockedHttpLinks = 0;
  let projectedAnnotations = 0;
  let annotationRefOccurrences = 0;
  let resourceLinkBlocks = 0;
  let actionableMediaReferences = 0;
  const sanitizedReaderDocuments = new Map();
  const sanitizer = createUrlSanitizer();
  const roleDecisionsByLesson = new Map();
  for (const decision of roleAudit.decisions) {
    const decisions = roleDecisionsByLesson.get(decision.lessonId) || [];
    decisions.push(decision);
    roleDecisionsByLesson.set(decision.lessonId, decisions);
  }
  const expectedPrimaryEmbedLinks = new Map([
    ["lesson-1558", "https://www.youtube.com/watch?v=K5LIDpXFWKk"],
    ["lesson-1560", "https://ctext.org/library.pl?if=gb&file=56722&page=49"],
    ["lesson-1589", "https://ctext.org/wiki.pl?if=gb&chapter=206323"],
    ["lesson-1590", "https://ctext.org/wiki.pl?if=gb&chapter=65609"],
    ["lesson-1591", "https://ctext.org/wiki.pl?if=gb&chapter=768444"],
  ]);
  const lesson1557Image =
    "https://files.rdfzer.com/original/2X/b/bdfbe13294db151cbe5b180495493a0a46181138.jpeg";

  for (const lesson of core.lessons) {
    const receipt = readerIndex.documents[lesson.id];
    const catalogLesson = catalogLessons.get(lesson.id);
    assert.ok(receipt, `${lesson.id}: reader receipt`);
    assert.ok(catalogLesson, `${lesson.id}: catalog reader receipt`);
    const file = path.join(SITE_ROOT, "data", receipt.path);
    const bytes = readFileSync(file);
    assert.equal(bytes.length, receipt.bytes, `${lesson.id}: reader bytes`);
    assert.equal(sha256(bytes), receipt.sha256, `${lesson.id}: reader sha256`);
    const webDocument = JSON.parse(bytes);
    const sanitizedWebDocument = canonicalize(sanitizer.sanitizeValue(webDocument));
    sanitizedReaderDocuments.set(lesson.id, sanitizedWebDocument);
    const rawCanonicalSha256 = sha256(JSON.stringify(canonicalize(webDocument)));
    const embeddedSha256 = sha256(JSON.stringify(sanitizedWebDocument));
    assert.equal(catalogLesson.readerDocumentPath, `data/reader-documents/${lesson.id}.json`);
    assert.equal(catalogLesson.readerDocumentSha256, receipt.sha256);
    assert.equal(catalogLesson.readerDocumentEmbeddedSha256, embeddedSha256);
    if (rawCanonicalSha256 !== embeddedSha256) sanitizedHashDifferences.push(lesson.id);
    assert.deepEqual(lesson.readerDocument, sanitizedWebDocument, `${lesson.id}: Web/App reader drift`);
    assert.equal(lesson.readerDocument.schemaVersion, "yw-reader-document-v1");
    assert.equal(lesson.readerDocument.lessonId, lesson.id);
    assert.equal(lesson.readerDocument.main.sourcePostId, receipt.primaryPostId);
    assert.equal(lesson.readerDocument.provenance.sourcePostCount, lesson.posts.length);

    const assignments = lesson.readerDocument.provenance.posts;
    assignedPosts += assignments.length;
    assert.equal(assignments.length, lesson.posts.length, `${lesson.id}: assignment count`);
    assert.equal(new Set(assignments.map((post) => String(post.postId))).size, assignments.length);
    assert.deepEqual(
      assignments.map((post) => String(post.postId)).sort(),
      lesson.posts.map((post) => String(post.id)).sort(),
      `${lesson.id}: assigned post inventory`,
    );
    for (const assignment of assignments) assert.ok(allowedRoles.has(assignment.role));
    for (const decision of roleDecisionsByLesson.get(lesson.id) || []) {
      assert.equal(
        assignments.find((assignment) => String(assignment.postId) === String(decision.postId))?.role,
        decision.role,
        `${lesson.id}/${decision.postId}: audited role`,
      );
    }
    const primary = assignments.filter((post) => post.role === "primary");
    assert.equal(primary.length, 1, `${lesson.id}: exactly one main`);
    assert.equal(primary[0].postId, lesson.readerDocument.main.sourcePostId);
    assert.equal(primary[0].replyToPostNumber, null, `${lesson.id}: reply entered main`);
    assert.equal(
      assignments.some((post) => (
        (post.role === "discussion" || post.role === "reply")
        && String(post.postId) === String(lesson.readerDocument.main.sourcePostId)
      )),
      false,
      `${lesson.id}: discussion/reply entered main`,
    );

    const body = lesson.body.trim();
    assert.doesNotMatch(body, /^https?:\/\/\S+$/i, `${lesson.id}: pure URL body`);
    assert.doesNotMatch(JSON.stringify(lesson.readerDocument), /<\/?(?:p|div|span|a|img|ol|ul|li|blockquote)\b/i,
      `${lesson.id}: cooked HTML leaked`);
    visit(lesson.readerDocument, (_value, pathParts) => {
      assert.notEqual(pathParts.at(-1), "cooked", `${lesson.id}: cooked key leaked`);
    });

    const mainRefs = collectAnnotationRefs([
      ...lesson.readerDocument.main.frontMatter,
      ...lesson.readerDocument.main.guidance,
      ...lesson.readerDocument.main.blocks,
    ]);
    const uniqueMainRefs = [...new Set(mainRefs)];
    assert.deepEqual(
      lesson.readerDocument.main.annotations.map((note) => note.noteId),
      uniqueMainRefs,
      `${lesson.id}: main annotations must exactly follow first references`,
    );
    projectedAnnotations += lesson.readerDocument.main.annotations.length;
    annotationRefOccurrences += mainRefs.length;
    for (const supplementary of lesson.readerDocument.supplementary) {
      const refs = collectAnnotationRefs(supplementary.blocks);
      assert.deepEqual(
        supplementary.annotations.map((note) => note.noteId),
        [...new Set(refs)],
        `${lesson.id}/${supplementary.postId}: annotations must exactly follow first references`,
      );
      projectedAnnotations += supplementary.annotations.length;
      annotationRefOccurrences += refs.length;
    }

    const embedLinks = [];
    visit([
      ...lesson.readerDocument.main.frontMatter,
      ...lesson.readerDocument.main.guidance,
      ...lesson.readerDocument.main.blocks,
    ], (item) => {
      if (item?.type === "resource-link") embedLinks.push(item);
    });
    resourceLinkBlocks += embedLinks.length;
    if (expectedPrimaryEmbedLinks.has(lesson.id)) {
      assert.deepEqual(
        embedLinks.map((block) => block.href),
        [expectedPrimaryEmbedLinks.get(lesson.id)],
        `${lesson.id}: primary iframe fallback`,
      );
      assert.equal(embedLinks[0].disposition, "system-browser");
    } else {
      assert.equal(embedLinks.length, 0, `${lesson.id}: unexpected primary embed link`);
    }
    if (lesson.id === "lesson-1557") {
      const media = lesson.readerDocument.main.media.find((item) => (
        item.sourceUrl === lesson1557Image
      ));
      assert.ok(media, "lesson-1557 nested heading image receipt");
      const projectedMediaIds = [];
      visit(lesson.readerDocument.main.blocks, (item) => {
        if (item?.type === "image" || item?.type === "media-ref") {
          projectedMediaIds.push(item.mediaId);
        }
      });
      assert.equal(
        projectedMediaIds.filter((mediaId) => mediaId === media.id).length,
        1,
        "lesson-1557 nested heading image projected exactly once",
      );
    }

    for (const media of [
      ...lesson.readerDocument.main.media,
      ...lesson.readerDocument.supplementary.flatMap((section) => section.media),
    ]) {
      const sourceReceipt = mediaReceiptByUrl.get(media.sourceUrl);
      assert.ok(sourceReceipt, `${lesson.id}: actionable image has source receipt`);
      assert.equal(media.nativeDisposition, "verified-in-app");
      assert.equal(media.bytes, sourceReceipt.bytes);
      assert.equal(media.sha256, sourceReceipt.sha256);
      assert.equal(media.mediaType, sourceReceipt.mime);
      assert.equal(media.width, sourceReceipt.width);
      assert.equal(media.height, sourceReceipt.height);
      assert.equal(media.finalUrl, sourceReceipt.finalUrl);
      assert.equal(media.receiptRequired, true);
      actionableMediaReferences += 1;
    }

    for (const media of lesson.readerDocument.provenance.media) {
      provenanceMedia += 1;
      assert.match(media.sourceUrl, /^https?:\/\//);
      assert.ok(Object.hasOwn(media, "bytes"));
      assert.ok(Object.hasOwn(media, "sha256"));
      assert.ok(Object.hasOwn(media, "mediaType"));
      assert.ok(Object.hasOwn(media, "width"));
      assert.ok(Object.hasOwn(media, "height"));
      if (media.postRole === "primary" || media.postRole === "supplementary") {
        const sourceReceipt = mediaReceiptByUrl.get(media.sourceUrl);
        assert.ok(sourceReceipt, `${lesson.id}: visible provenance media receipt`);
        assert.equal(media.nativeDisposition, "verified-in-app");
        assert.equal(media.bytes, sourceReceipt.bytes);
        assert.equal(media.sha256, sourceReceipt.sha256);
        assert.equal(media.mediaType, sourceReceipt.mime);
      } else if (media.nativeDisposition === "blocked-missing-receipt") {
        assert.equal(media.bytes, null);
        assert.equal(media.sha256, null);
        assert.equal(media.receiptRequired, true);
      } else {
        assert.equal(media.nativeDisposition, "blocked-http");
        assert.equal(media.webDisposition, "source-only");
      }
    }
    for (const link of lesson.readerDocument.provenance.links) {
      if (link.disposition !== "blocked-http") continue;
      blockedHttpLinks += 1;
      assert.match(link.sourceUrl, /^http:\/\//);
      assert.equal(link.href, null);
    }
  }
  assert.deepEqual(
    sanitizedHashDifferences,
    [],
    "canonical Web and embedded App reader documents must be byte-identical after source sanitization",
  );
  assert.equal(assignedPosts, sourceCounts.posts);
  assert.equal(projectedAnnotations, 2932);
  assert.equal(annotationRefOccurrences, 2933);
  assert.equal(resourceLinkBlocks, expectedPrimaryEmbedLinks.size);
  assert.equal(actionableMediaReferences, 166);
  assert.equal(provenanceMedia, sourceCounts.postImages);
  assert.equal(blockedHttpLinks, 11);
  assert.equal(sanitizedReaderDocuments.size, sourceCounts.lessons);
  const webAppSource = readFileSync(path.join(SITE_ROOT, "assets", "app.js"), "utf8");
  const renderTextSource = webAppSource.slice(
    webAppSource.indexOf("function renderText("),
    webAppSource.indexOf("function absoluteResourceUrl("),
  );
  assert.match(webAppSource, /function renderReaderDocument\(/);
  assert.match(webAppSource, /function fetchVerifiedJson\(/);
  assert.match(webAppSource, /globalThis\.crypto\.subtle\.digest\("SHA-256", bytes\)/);
  assert.match(webAppSource, /data-reader-retry/);
  assert.match(webAppSource, /state\.lessons\.delete\(id\)/);
  assert.match(webAppSource, /if \(shouldCache\) state\.lessons\.set\(id, lesson\)/);
  assert.doesNotMatch(webAppSource, /existing lesson-v1 renderer is the only compatibility fallback/);
  assert.doesNotMatch(renderTextSource, /meaningfulPosts|primaryContentParts|cleanedCooked/);
});

test("classical first-read projection is exact and receipt-bound", () => {
  const sourceIndexFile = path.join(
    SITE_ROOT,
    "data",
    "classical-first-read",
    "index.json",
  );
  const sourceIndexBytes = readFileSync(sourceIndexFile);
  const sourceIndex = JSON.parse(sourceIndexBytes.toString("utf8"));
  assert.equal(sourceIndex.lessonCount, 30);
  assert.equal(core.classicalFirstRead.index.schemaVersion,
    "yw-native-classical-first-read-index-v1");
  assert.equal(core.classicalFirstRead.index.lessonCount, sourceIndex.lessonCount);
  assert.equal(core.classicalFirstRead.index.offsetUnit, "utf16_code_unit");
  assert.equal(core.classicalFirstRead.lessons.length, sourceIndex.lessonCount);
  assert.equal(manifest.sourceProvenance.classicalFirstReadIndex.sha256,
    sha256(sourceIndexBytes));
  assert.equal(
    manifest.objects.filter((object) => object.kind === "classical-first-read").length,
    sourceIndex.lessonCount,
  );
  const projectedByLesson = new Map(
    core.classicalFirstRead.lessons.map((lesson) => [lesson.lessonId, lesson]),
  );
  for (const entry of sourceIndex.lessons) {
    const source = json(path.join(SITE_ROOT, entry.dataUrl));
    assert.deepEqual(projectedByLesson.get(entry.lessonId), canonicalize(source));
    const catalogLesson = core.catalog.lessons.find((lesson) => lesson.id === entry.lessonId);
    assert.equal(
      catalogLesson?.classicalFirstReadPath,
      `classical-first-read/${entry.lessonId}.json`,
    );
  }
  assert.equal(
    core.catalog.lessons.filter((lesson) => lesson.classicalFirstReadPath).length,
    sourceIndex.lessonCount,
  );
});

test("vocab, tombstones and media fail closed", () => {
  assert.equal(core.vocab.index.lessonCount, sourceCounts.vocabLessonFiles);
  assert.equal(core.vocab.index.sourceBankCount, Object.keys(
    json(path.join(SITE_ROOT, "data", "vocab", "index.json")).lessons,
  ).length);
  assert.equal(core.vocab.index.inventoryFileCount, sourceCounts.vocabInventoryFiles);
  assert.equal(core.vocab.index.questionCount, sourceCounts.vocabQuestions);
  assert.equal(core.vocab.lessons.length, sourceCounts.vocabLessonFiles);
  assert.deepEqual(core.vocab.eligibility, json(path.join(
    SITE_ROOT,
    "data",
    "vocab-eligibility.json",
  )));
  assert.equal(core.vocab.lessons.reduce((sum, bank) => sum + bank.inventory.filter((item) => item.decision === "question").length, 0), sourceCounts.vocabQuestions);
  assert.equal(core.tombstones.tombstones.length, sourceCounts.compositeTombstones);
  const active = new Set(core.lessons.map((lesson) => lesson.id));
  for (const tombstone of core.tombstones.tombstones) {
    assert.ok(tombstone.replacements.length > 0);
    for (const replacement of tombstone.replacements) assert.ok(active.has(replacement.id));
  }
  assert.equal(core.media.lessons.length, sourceCounts.mediaCatalogLessons);
  assert.equal(core.media.schemaVersion, "yw-native-content-media-v1");
  assert.equal(core.media.contentVersion, pointer.contentVersion);
  assert.equal(core.media.lessons.filter((lesson) => lesson.reviewStatus === "approved").length, sourceCounts.approvedDecks);
  assert.equal(core.media.lessons.filter((lesson) => lesson.reviewStatus === "cataloged").length, sourceCounts.catalogedDecks);
  const catalogLessons = new Map(core.catalog.lessons.map((lesson) => [lesson.id, lesson]));
  for (const lesson of core.media.lessons.filter((item) => item.reviewStatus === "cataloged")) {
    assert.equal(catalogLessons.get(lesson.lessonId)?.hasSlideDeck, false);
  }
  for (const lesson of core.media.lessons) {
    if (lesson.reviewStatus === "approved") {
      assert.match(lesson.asset.href, /^https:\/\/yw\.bdfz\.net\/media\/lesson-media\//);
      assert.match(lesson.asset.sha256, /^[a-f0-9]{64}$/);
      assert.equal(
        path.posix.basename(new URL(lesson.asset.href).pathname),
        `sha256-${lesson.asset.sha256}.pdf`,
      );
      assert.ok(lesson.asset.bytes > 0);
      assert.equal(lesson.asset.mediaType, "application/pdf");
      assert.equal(lesson.asset.sourceKind, "notebooklm");
      assert.equal(lesson.asset.sourceRecord, "site/data/lesson-media.json");
      assert.equal(
        lesson.asset.sourceRecordSha256,
        sha256(readFileSync(path.join(ROOT, lesson.asset.sourceRecord))),
      );
      assert.match(lesson.asset.sourceLocalRef, /^site\/media\/lesson-media\//);
      assert.equal(lesson.asset.sourceSha256, lesson.asset.sha256);
      assert.equal(lesson.asset.sourceVersion, lesson.sourceVersion);
      assert.equal(typeof lesson.asset.sourceVersion, "string");
      assert.ok(lesson.asset.sourceVersion.length > 0);
      assert.equal(lesson.asset.rightsBasis, "user-authorized-for-bdfz-yw-app-2026-07-29");
    } else {
      assert.equal(lesson.asset, null);
      assert.equal(lesson.missingReason, "not_generated_or_not_approved");
    }
    assert.equal(lesson.rightsBasis, "user-authorized-for-bdfz-yw-app-2026-07-29");
  }
  const builderSource = readFileSync(path.join(ROOT, "scripts", "build_native_content.mjs"), "utf8");
  assert.doesNotMatch(builderSource, /selected-compulsory|resource-record\.json/);
});

test("all derived immutable objects have safe URLs", () => {
  assert.equal(
    manifest.objects.length,
    core.lessons.length
      + core.vocab.lessons.length
      + core.classicalFirstRead.lessons.length
      + 9,
  );
  const publicDocuments = [
    { name: "latest-stable.json", value: pointer },
    { name: "manifest.json", value: manifest },
    ...manifest.objects.map((object) => ({
      name: object.path,
      value: json(path.join(secondReleaseRoot, object.path)),
    })),
  ];
  const urls = publicDocuments.flatMap(({ value }) => urlsIn(value));
  assert.ok(urls.length > 0);
  for (const candidate of urls) {
    let url;
    try {
      url = new URL(candidate);
    } catch {
      assert.fail(`invalid URL in native content: ${candidate}`);
    }
    assert.equal(url.username, "");
    assert.equal(url.password, "");
    assert.doesNotMatch(url.pathname, PATH_SESSION_IDENTIFIER);
    if (url.hostname.toLowerCase() === "accounts.google.com") {
      assert.equal(url.search, "", `Google authentication URL has a query: ${url.origin}${url.pathname}`);
      assert.equal(url.hash, "", `Google authentication URL has a fragment: ${url.origin}${url.pathname}`);
    }
    if (url.hostname.toLowerCase() === "notebooklm.google.com") {
      assert.equal(url.pathname, "/", "NotebookLM URL must be collapsed to the site root");
      assert.equal(url.search, "", "NotebookLM root URL has a query");
      assert.equal(url.hash, "", "NotebookLM root URL has a fragment");
    }
    if (
      url.hostname.toLowerCase() === "aistudio.google.com"
      && url.pathname.startsWith("/app/prompts")
    ) {
      assert.equal(url.search, "", "AI Studio prompt URL has a query");
      assert.equal(url.hash, "", "AI Studio prompt URL has a fragment");
    }
    if (
      url.hostname.toLowerCase() === "passport.seiue.com"
      && (url.pathname === "/go" || url.pathname === "/go/")
    ) {
      assert.equal(url.search, "", "Seiue login URL has a query");
      assert.equal(url.hash, "", "Seiue login URL has a fragment");
    }
    if (
      (
        url.hostname.toLowerCase() === "yuque.com"
        || url.hostname.toLowerCase().endsWith(".yuque.com")
      )
      && (url.pathname === "/login" || url.pathname === "/login/")
    ) {
      assert.equal(url.search, "", "Yuque login URL has a query");
      assert.equal(url.hash, "", "Yuque login URL has a fragment");
    }
    if (
      url.hostname.toLowerCase() === "bilibili.com"
      || url.hostname.toLowerCase().endsWith(".bilibili.com")
    ) {
      assert.equal(url.searchParams.has("vd_source"), false);
      assert.equal(url.searchParams.has("spm_id_from"), false);
    }
    if (url.hostname.toLowerCase() === "sites.google.com") {
      assert.equal(url.searchParams.has("authuser"), false);
    }
    if (
      (
        url.hostname.toLowerCase() === "google.com"
        || url.hostname.toLowerCase().endsWith(".google.com")
      )
      && url.pathname === "/url"
    ) {
      assert.equal(url.searchParams.has("q"), false);
      assert.equal(url.searchParams.has("url"), false);
      assert.equal(url.searchParams.has("usg"), false);
    }
    for (const key of url.searchParams.keys()) {
      assert.equal(SENSITIVE_QUERY_KEY.test(key), false, `sensitive query key ${key} in ${url.origin}${url.pathname}`);
    }
  }
  assert.ok(core.securityRedactions.authenticationUrlsCollapsed > 0);
  assert.ok(core.securityRedactions.aiStudioPromptUrlsCollapsed > 0);
  assert.ok(core.securityRedactions.bilibiliTrackingParametersRemoved > 0);
  assert.ok(core.securityRedactions.googleRedirectUrlsUnwrapped > 0);
  assert.ok(core.securityRedactions.pathSessionIdentifiersRemoved > 0);
  assert.ok(core.securityRedactions.seiueLoginUrlsCollapsed > 0);
  assert.ok(core.securityRedactions.sitesAuthParametersRemoved > 0);
  assert.ok(core.securityRedactions.sensitiveQueryParametersRemoved > 0);
  assert.ok(core.securityRedactions.yuqueLoginUrlsCollapsed > 0);
});

test("all current public files pass raw and percent-decoded privacy scans", () => {
  const currentPublicFiles = [
    {
      name: "latest-stable.json",
      body: readFileSync(pointerFile, "utf8"),
    },
    ...collectFiles(secondReleaseRoot).map((file) => ({
      name: file,
      body: readFileSync(path.join(secondReleaseRoot, file), "utf8"),
    })),
  ];
  assert.equal(currentPublicFiles.length, manifest.objects.length + 2);
  const publicOutput = currentPublicFiles.map(({ body }) => body).join("\n");
  const decodedPublicOutput = decodePercentEscapes(publicOutput);
  assert.doesNotMatch(publicOutput, /\/Users\//);
  assert.doesNotMatch(decodedPublicOutput, /\/Users\//);
  assert.doesNotMatch(publicOutput, PRIVATE_NOTEBOOK_PATH);
  assert.doesNotMatch(decodedPublicOutput, PRIVATE_NOTEBOOK_PATH);
  assert.doesNotMatch(publicOutput, FORBIDDEN_AUTH_QUERY);
  assert.doesNotMatch(decodedPublicOutput, FORBIDDEN_AUTH_QUERY);
  assert.doesNotMatch(publicOutput, AI_STUDIO_PROMPT_QUERY);
  assert.doesNotMatch(decodedPublicOutput, AI_STUDIO_PROMPT_QUERY);
  assert.doesNotMatch(publicOutput, BILIBILI_TRACKING_QUERY);
  assert.doesNotMatch(decodedPublicOutput, BILIBILI_TRACKING_QUERY);
  assert.doesNotMatch(publicOutput, GOOGLE_REDIRECT_QUERY);
  assert.doesNotMatch(decodedPublicOutput, GOOGLE_REDIRECT_QUERY);
  assert.doesNotMatch(publicOutput, PATH_SESSION_IDENTIFIER);
  assert.doesNotMatch(decodedPublicOutput, PATH_SESSION_IDENTIFIER);
  assert.doesNotMatch(publicOutput, SEIUE_LOGIN_QUERY);
  assert.doesNotMatch(decodedPublicOutput, SEIUE_LOGIN_QUERY);
  assert.doesNotMatch(publicOutput, SITES_AUTH_QUERY);
  assert.doesNotMatch(decodedPublicOutput, SITES_AUTH_QUERY);
  assert.doesNotMatch(publicOutput, YUQUE_LOGIN_QUERY);
  assert.doesNotMatch(decodedPublicOutput, YUQUE_LOGIN_QUERY);
  assert.doesNotMatch(publicOutput, /\.secrets\.env|\/home\/|\bHOME=/i);
  assert.doesNotMatch(decodedPublicOutput, /\.secrets\.env|\/home\/|\bHOME=/i);
  assert.doesNotMatch([
    readFileSync(pointerFile, "utf8"),
    readFileSync(manifestFile, "utf8"),
    readFileSync(coreFile, "utf8"),
  ].join("\n"), PRIVATE_NOTEBOOK_PATH);
});

test("Pages upload tree stays below file-count and per-file limits", () => {
  const sourceFiles = collectFiles(SITE_ROOT).filter((file) => (
    !file.startsWith("app-content/") && !file.startsWith("data/cache/")
  ));
  const releaseFiles = collectFiles(secondReleaseRoot);
  const projectedFileCount = sourceFiles.length + releaseFiles.length + 2;
  assert.ok(projectedFileCount < MAX_PAGES_FILES, `projected release has ${projectedFileCount} files`);
  for (const file of sourceFiles) {
    const bytes = statSync(path.join(SITE_ROOT, file)).size;
    assert.ok(bytes < MAX_CORE_BYTES, `${file} is ${bytes} bytes; each Pages file must be under 25 MiB`);
  }
  for (const file of releaseFiles) {
    const bytes = statSync(path.join(secondReleaseRoot, file)).size;
    assert.ok(bytes < MAX_CORE_BYTES, `${file} is ${bytes} bytes; each Pages file must be under 25 MiB`);
  }
  assert.ok(statSync(pointerFile).size < MAX_CORE_BYTES);
  assert.equal(sourceFiles.some((file) => file.startsWith("data/cache/")), false);
});

test("Web preview release projection excludes the complete native content tree", () => {
  execFileSync(process.execPath, ["scripts/build_release_site.mjs", "--preview"], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: "pipe",
  });
  const releaseAppContent = path.join(RELEASE_SITE_ROOT, "app-content");
  assert.equal(existsSync(releaseAppContent), false);
  const marker = json(path.join(RELEASE_SITE_ROOT, ".bdfz-release-artifact.json"));
  assert.equal(marker.schemaVersion, "yw-release-site-v2");
  assert.equal(marker.releaseKind, "preview-web-only");
  assert.equal(marker.nativeContent.policy, "excluded");
  assert.equal(marker.nativeContent.includedPathCount, 0);
});

test("release projection preserves verified Web reader receipts", () => {
  execFileSync(process.execPath, ["scripts/build_release_site.mjs", "--preview"], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: "pipe",
  });
  const readerRoot = path.join(RELEASE_SITE_ROOT, "data", "reader-documents");
  const readerIndex = json(path.join(readerRoot, "index.json"));
  assert.equal(readerIndex.schemaVersion, "yw-reader-document-index-v1");
  assert.equal(Object.keys(readerIndex.documents).length, readerIndex.lessonCount);
  for (const [lessonId, receipt] of Object.entries(readerIndex.documents)) {
    const bytes = readFileSync(path.join(RELEASE_SITE_ROOT, "data", receipt.path));
    assert.equal(bytes.length, receipt.bytes, `${lessonId}: release byte receipt mismatch`);
    assert.equal(sha256(bytes), receipt.sha256, `${lessonId}: release hash receipt mismatch`);
    assert.equal(JSON.parse(bytes).lessonId, lessonId);
  }
});

test("shared sanitizer preserves surrounding content and clears the Web projection", () => {
  const sanitizer = createUrlSanitizer();
  const source = [
    "课文内容必须保留",
    "https://passport.seiue.com/go?t=opaque12345678901234567890&school_id=1",
    "https://bdfz.yuque.com/login?goto=https%3A%2F%2Fexample.com",
    "https://www.google.com/url?q=https%3A%2F%2Fexample.com%2Fresource&usg=opaque",
    "https://www.zhbc.com.cn/info.html;jsessionid=opaque?newsid=123",
  ].join("\n");
  const sanitized = sanitizer.sanitizeString(source);
  assert.match(sanitized, /课文内容必须保留/);
  for (const issue of Object.values(privacyIssueCounts(sanitized))) {
    assert.equal(issue.raw + issue.decoded, 0);
  }
  const escapedJson = [
    '{"content":"课文内容必须保留<a href=\\"',
    "https://passport.seiue.com/go?t=opaque12345678901234567890&school_id=1",
    '\\">登录</a>"}',
  ].join("");
  const parsedEscapedJson = JSON.parse(escapedJson);
  const sanitizedEscapedJson = sanitizer.sanitizeValue(parsedEscapedJson);
  const serializedEscapedJson = JSON.stringify(sanitizedEscapedJson);
  assert.deepEqual(JSON.parse(serializedEscapedJson), sanitizedEscapedJson);
  assert.match(serializedEscapedJson, /课文内容必须保留/);
  for (const issue of Object.values(privacyIssueCounts(serializedEscapedJson))) {
    assert.equal(issue.raw + issue.decoded, 0);
  }
  const htmlEntityUrl = sanitizer.sanitizeString(
    "https://files.rdfzer.com/resource?download=1&amp;token=opaque&amp;page=2",
  );
  assert.match(htmlEntityUrl, /\?download=1&amp;page=2$/);
  assert.doesNotMatch(htmlEntityUrl, /token=/);
  const malformedAiStudioState = sanitizer.sanitizeString([
    "正文前",
    'https://aistudio.google.com/app/prompts?state={"ids":["prompt"],"action":"open","userId":"private","resourceKeys":{}}&usp=sharing',
    "正文后",
  ].join(" "));
  assert.equal(
    malformedAiStudioState,
    "正文前 https://aistudio.google.com/app/prompts 正文后",
  );
  assert.doesNotMatch(malformedAiStudioState, /userId|resourceKeys|state=|usp=/);
  for (const issue of Object.values(privacyIssueCounts(malformedAiStudioState))) {
    assert.equal(issue.raw + issue.decoded, 0);
  }
  assert.ok(
    privacyIssueCounts(
      'https://aistudio.google.com/app/prompts"ids":[],"userId":"private","resourceKeys":{}}',
    ).aiStudioEmbeddedStatePayload.raw > 0,
  );
  for (const issue of Object.values(
    privacyIssueCounts("https://example.com/search?keywords=语文"),
  )) {
    assert.equal(issue.raw + issue.decoded, 0);
  }
  const projection = JSON.parse(execFileSync(process.execPath, [
    "scripts/build_release_site.mjs",
    "--check-source",
    "--preview",
  ], {
    cwd: ROOT,
    encoding: "utf8",
  }));
  assert.ok(projection.changedFiles > 0);
  assert.ok(projection.projectedFiles < MAX_PAGES_FILES);
  assert.ok(projection.excludedPrefixes.includes("data/cache/"));
});

test("reader annotation controls use occurrence-scoped inline note ids", () => {
  const appSource = readFileSync(path.join(SITE_ROOT, "assets", "app.js"), "utf8");
  assert.match(
    appSource,
    /const noteId = `reader-inline-note-\$\{run\.noteId\}-\$\{occurrence\}`;/,
  );
  assert.match(
    appSource,
    /options\.annotationOccurrences \|\| \(options\.annotationOccurrences = new Map\(\)\)/,
  );
  assert.match(
    appSource,
    /class="reader-note-ref" type="button" data-note-ref="\$\{esc\(run\.noteId\)\}" aria-expanded="false" aria-controls="\$\{esc\(noteId\)\}" aria-label="展開註釋 \$\{number\}"/,
  );
  assert.doesNotMatch(
    appSource,
    /class="reader-note-ref" href=/,
  );
  assert.match(
    appSource,
    /link\.hasAttribute\("data-same-tab"\) \|\| href\.startsWith\("#"\)/,
  );
  assert.match(appSource, /class="reader-annotation-anchor"/);
  assert.match(appSource, />\$\{number\}<\/button>/);
  assert.doesNotMatch(appSource, />注<\/button>/);
  assert.match(appSource, /if \(note\.dataset\.typed !== "true"\)/);
});

test("native content routes fail closed instead of serving the SPA fallback", () => {
  assert.equal(
    nativeContentAssetContentTypeMatches(
      "/app-content/latest-stable.json",
      "application/json; charset=utf-8",
    ),
    true,
  );
  assert.equal(
    nativeContentAssetContentTypeMatches(
      "/app-content/releases/yw-version/sha256-receipt/core-bundle.json",
      "text/html; charset=utf-8",
    ),
    false,
  );
  assert.equal(
    nativeContentAssetContentTypeMatches(
      `/media/lesson-media/lesson-1/sha256-${"a".repeat(64)}.pdf`,
      "application/pdf",
    ),
    true,
  );
});

test("formal deploy gates cannot bypass stable sync or staging", () => {
  const missingOutput = mkdtempSync(path.join(os.tmpdir(), "yw-native-missing-stable-"));
  try {
    let failure;
    try {
      execFileSync(process.execPath, ["scripts/check_native_content_deploy_sync.mjs"], {
        cwd: ROOT,
        encoding: "utf8",
        env: {
          ...process.env,
          YW_NATIVE_CONTENT_DEPLOY_ROOT: missingOutput,
        },
        stdio: "pipe",
      });
    } catch (error) {
      failure = error;
    }
    assert.ok(failure, "deploy-sync unexpectedly accepted a missing stable pointer");
    assert.match(String(failure.stderr), /latest-stable\.json is missing/);
  } finally {
    rmSync(missingOutput, { recursive: true, force: true });
  }
  const packageJson = json(path.join(ROOT, "package.json"));
  assert.match(packageJson.scripts["release:check"], /check:native-content:deploy-sync/);
  assert.match(packageJson.scripts["release:check"], /build:release-site/);
  assert.match(packageJson.scripts["prepare:release-artifact"], /^npm run check:native-content:deploy-sync/);
  assert.match(packageJson.scripts["prepare:preview-artifact"], /build:release-site:preview/);
  assert.match(packageJson.scripts["prepare:preview-artifact"], /check:release-site:preview/);
  assert.match(packageJson.scripts["precontent:check"], /test:release-site/);
  assert.match(packageJson.scripts.deploy, /pages deploy \.release\/site/);
  assert.doesNotMatch(packageJson.scripts.deploy, /pages deploy site(?:\s|$)/);
});
