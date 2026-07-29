#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
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
  const sourceLessons = sourceManifest.lessons.map((lesson) => (
    json(path.join(SITE_ROOT, lesson.dataUrl))
  ));
  const lessonTotals = sourceLessons.reduce((totals, lesson) => {
    const posts = lesson.posts || [];
    const pageImages = lesson.textbook?.pageImages || [];
    const contextPageImages = lesson.textbook?.contextPageImages || [];
    totals.posts += posts.length;
    totals.textbookPageRefs += pageImages.length;
    totals.textbookContextPageRefs += contextPageImages.length;
    totals.forumImages += (lesson.forumImages || []).length;
    totals.resources += (lesson.resources || []).length;
    totals.annotations += (lesson.annotations || []).length;
    totals.learningTasks += (lesson.learningTasks || []).length;
    totals.postAttachments += posts.flatMap((post) => post.attachments || []).length;
    totals.postImages += posts.flatMap((post) => post.images || []).length;
    totals.postLinks += posts.flatMap((post) => post.links || []).length;
    for (const page of pageImages) totals.activePageUrls.add(page.src);
    for (const page of contextPageImages) totals.contextPageUrls.add(page.src);
    return totals;
  }, {
    activePageUrls: new Set(),
    annotations: 0,
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
  const vocabIds = Object.keys(vocabIndex.lessons);
  const vocabBanks = vocabIds.map((lessonId) => (
    json(path.join(SITE_ROOT, "data", "vocab", `${lessonId}.json`))
  ));
  const vocabInventoryItems = vocabBanks.reduce((sum, bank) => sum + bank.inventory.length, 0);
  const vocabQuestions = vocabBanks.reduce((sum, bank) => (
    sum + bank.inventory.filter((item) => item.decision === "question").length
  ), 0);
  const media = json(path.join(SITE_ROOT, "data", "lesson-media.json"));
  const approvedDecks = media.lessons.filter((lesson) => (
    lesson.reviewStatus?.slideDeck === "approved"
  )).length;
  const activeIds = new Set(sourceManifest.lessons.map((lesson) => lesson.id));
  const lessonInventory = readdirSync(path.join(SITE_ROOT, "data", "lessons"))
    .filter((file) => /^lesson-.+\.json$/.test(file))
    .map((file) => file.slice(0, -5));
  return canonicalize({
    annotations: lessonTotals.annotations,
    approvedDecks,
    approvedSlideDecks: approvedDecks,
    blockedTextbookPageRefs: 0,
    blocks: sourceManifest.blocks.length,
    books: new Set(sourceManifest.lessons.map((lesson) => (
      lesson.textbookBookTitle || lesson.blockTitle
    )).filter(Boolean)).size,
    catalogedDecks: media.lessons.length - approvedDecks,
    compositeTombstones: lessonInventory.filter((lessonId) => !activeIds.has(lessonId)).length,
    forumImages: lessonTotals.forumImages,
    learningTasks: lessonTotals.learningTasks,
    lessons: sourceManifest.lessons.length,
    mediaCatalogLessons: media.lessons.length,
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

test("review receipt approves exactly the current derived graph", () => {
  assert.deepEqual(auditReceiptIssues(auditReceipt, {
    semanticDigest: pointer.semanticDigest,
    counts: sourceCounts,
  }), []);
  assert.equal(firstBuild.audit.status, "approved");
  assert.deepEqual(firstBuild.releaseBlockers, []);
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
    core.lessons.length + core.vocab.lessons.length + 7,
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
    assert.equal(lesson.body, lesson.posts.map((post) => post.plainText).join("\n\n"), `${lesson.id}: body`);
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

test("vocab, tombstones and media fail closed", () => {
  assert.equal(core.vocab.index.lessonCount, sourceCounts.vocabLessonFiles);
  assert.equal(core.vocab.index.inventoryFileCount, sourceCounts.vocabInventoryFiles);
  assert.equal(core.vocab.index.questionCount, sourceCounts.vocabQuestions);
  assert.equal(core.vocab.lessons.length, sourceCounts.vocabLessonFiles);
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
  assert.equal(manifest.objects.length, core.lessons.length + core.vocab.lessons.length + 7);
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

test("release projection preserves immutable native receipts byte-for-byte", () => {
  execFileSync(process.execPath, ["scripts/build_release_site.mjs"], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: "pipe",
  });
  const sourceAppContent = path.join(SITE_ROOT, "app-content");
  const releaseAppContent = path.join(RELEASE_SITE_ROOT, "app-content");
  const publicFiles = collectFiles(sourceAppContent).filter((file) => (
    !file.startsWith("candidates/")
  ));
  assert.ok(publicFiles.length > 0);
  assert.equal(
    collectFiles(releaseAppContent).some((file) => file.startsWith("candidates/")),
    false,
  );
  for (const file of publicFiles) {
    assert.deepEqual(
      readFileSync(path.join(releaseAppContent, file)),
      readFileSync(path.join(sourceAppContent, file)),
      `${file}: release projection changed immutable bytes`,
    );
  }
  const releasePointer = json(path.join(releaseAppContent, "latest-stable.json"));
  const releaseManifestBytes = readFileSync(path.join(releaseAppContent, releasePointer.manifest.path));
  const releaseCoreBytes = readFileSync(path.join(releaseAppContent, releasePointer.coreBundle.path));
  assert.equal(sha256(releaseManifestBytes), releasePointer.manifest.sha256);
  assert.equal(releaseManifestBytes.length, releasePointer.manifest.bytes);
  assert.equal(sha256(releaseCoreBytes), releasePointer.coreBundle.sha256);
  assert.equal(releaseCoreBytes.length, releasePointer.coreBundle.bytes);
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
  for (const issue of Object.values(
    privacyIssueCounts("https://example.com/search?keywords=语文"),
  )) {
    assert.equal(issue.raw + issue.decoded, 0);
  }
  const projection = JSON.parse(execFileSync(process.execPath, [
    "scripts/build_release_site.mjs",
    "--check-source",
  ], {
    cwd: ROOT,
    encoding: "utf8",
  }));
  assert.ok(projection.changedFiles > 0);
  assert.ok(projection.projectedFiles < MAX_PAGES_FILES);
  assert.ok(projection.excludedPrefixes.includes("data/cache/"));
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
  assert.match(packageJson.scripts.deploy, /pages deploy \.release\/site/);
  assert.doesNotMatch(packageJson.scripts.deploy, /pages deploy site(?:\s|$)/);
});
