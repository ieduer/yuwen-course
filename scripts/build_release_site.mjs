#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  createUrlSanitizer,
  privacyIssueCounts,
} from "./native_content_url_sanitizer.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const DEFAULT_SOURCE_ROOT = path.join(ROOT, "site");
const DEFAULT_RELEASE_ROOT = path.join(ROOT, ".release", "site");
const MARKER_PATH = ".bdfz-release-artifact.json";
const MAX_FILES = 20_000;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const BASE_EXCLUDED_PREFIXES = [
  "app-content/",
  "data/cache/",
];
const RELEASE_KINDS = {
  formal: "formal-stable",
  preview: "preview-web-only",
};
const TEXT_EXTENSIONS = new Set([
  ".css",
  ".htm",
  ".html",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".svg",
  ".txt",
  ".webmanifest",
  ".xml",
]);

function fail(message) {
  throw new Error(message);
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

function collectFiles(root, prefix = "") {
  if (!existsSync(path.join(root, prefix))) return [];
  const files = [];
  for (const entry of readdirSync(path.join(root, prefix), { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(root, relative);
    if (lstatSync(full).isSymbolicLink()) fail(`symlink is forbidden in release input: ${relative}`);
    if (entry.isDirectory()) files.push(...collectFiles(root, relative));
    else if (entry.isFile()) files.push(relative);
  }
  return files.sort((left, right) => left.localeCompare(right, "en"));
}

function resolveUnder(root, relative, label) {
  if (
    typeof relative !== "string"
    || !relative
    || path.isAbsolute(relative)
    || relative.includes("\\")
    || relative.split("/").includes("..")
  ) {
    fail(`${label} path is unsafe`);
  }
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relative);
  if (!resolved.startsWith(`${resolvedRoot}${path.sep}`)) fail(`${label} escapes its root`);
  return resolved;
}

function privacyTotal(counts) {
  return Object.values(counts).reduce((sum, count) => sum + count.raw + count.decoded, 0);
}

function visitJsonStrings(value, callback, pathParts = []) {
  if (typeof value === "string") {
    callback(value, pathParts);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => visitJsonStrings(item, callback, [...pathParts, index]));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      callback(key, [...pathParts, "<key>"]);
      visitJsonStrings(item, callback, [...pathParts, "<field>"]);
    }
  }
}

function assertJsonStringsSafe(relative, value, sanitizer) {
  visitJsonStrings(value, (text, pathParts) => {
    const issues = privacyIssueCounts(text);
    const sanitized = sanitizer.sanitizeString(text);
    if (privacyTotal(issues) > 0 || sanitized !== text) {
      const location = pathParts.length > 0 ? pathParts.join(".") : "<root>";
      fail(`JSON privacy gate failed in ${relative} at ${location}`);
    }
  });
}

function parseJson(relative, text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    fail(`invalid JSON release input ${relative}: ${error.message}`);
  }
}

function projectJson(relative, text, sanitizer, immutable = false) {
  const parsed = parseJson(relative, text);
  const sanitizedValue = sanitizer.sanitizeValue(parsed);
  if (immutable && JSON.stringify(sanitizedValue) !== JSON.stringify(parsed)) {
    fail(`immutable native JSON requires privacy sanitization: ${relative}`);
  }
  const projectedValue = immutable ? parsed : sanitizedValue;
  assertJsonStringsSafe(relative, projectedValue, sanitizer);
  if (JSON.stringify(projectedValue) === JSON.stringify(parsed)) return text;
  const indentation = text.includes("\n") ? 2 : undefined;
  const trailingNewline = text.endsWith("\n") ? "\n" : "";
  return `${JSON.stringify(projectedValue, null, indentation)}${trailingNewline}`;
}

function assertTextSafe(relative, text) {
  if (privacyTotal(privacyIssueCounts(text)) > 0) {
    fail(`forbidden URL material in non-JSON release input ${relative}; fix the source explicitly`);
  }
}

function assertReceipt(receipt, bytes, label) {
  if (
    !receipt
    || !Number.isSafeInteger(receipt.bytes)
    || receipt.bytes < 0
    || !/^[a-f0-9]{64}$/.test(receipt.sha256 || "")
  ) {
    fail(`${label} receipt is invalid`);
  }
  if (bytes.length !== receipt.bytes || sha256(bytes) !== receipt.sha256) {
    fail(`${label} byte receipt does not match`);
  }
}

function assertPublicHref(href, appContentPath, label) {
  let url;
  try {
    url = new URL(href);
  } catch {
    fail(`${label} href is invalid`);
  }
  if (
    url.protocol !== "https:"
    || url.hostname !== "yw.bdfz.net"
    || url.username
    || url.password
    || url.search
    || url.hash
    || url.pathname !== `/app-content/${appContentPath}`
  ) {
    fail(`${label} href does not match its immutable path`);
  }
}

function readImmutableJson(root, relative, sanitizer, label = relative) {
  const file = resolveUnder(root, relative, label);
  if (!existsSync(file) || !lstatSync(file).isFile()) fail(`${label} is missing`);
  const bytes = readFileSync(file);
  const value = parseJson(relative, bytes.toString("utf8"));
  const sanitized = sanitizer.sanitizeValue(value);
  if (JSON.stringify(sanitized) !== JSON.stringify(value)) {
    fail(`immutable native JSON requires privacy sanitization: ${relative}`);
  }
  assertJsonStringsSafe(relative, value, sanitizer);
  return { bytes, value };
}

function releasePrefixes(files) {
  return [...new Set(files.flatMap((relative) => {
    const match = relative.match(/^releases\/([^/]+)\/([^/]+)\//);
    return match ? [`app-content/releases/${match[1]}/${match[2]}/`] : [];
  }))].sort((left, right) => left.localeCompare(right, "en"));
}

function pathsSha256(paths) {
  return sha256(paths.map((relative) => `${relative}\n`).join(""));
}

function previewNativePolicy(sourceRoot) {
  const appContentRoot = path.join(sourceRoot, "app-content");
  const sourcePaths = collectFiles(appContentRoot);
  return {
    policy: "excluded",
    pointerPath: null,
    contentVersion: null,
    releaseReceiptId: null,
    includedPrefix: null,
    includedPaths: [],
    includedPathCount: 0,
    includedPathsSha256: pathsSha256([]),
    candidatesExcluded: true,
    historicalReleasePrefixesExcluded: true,
    excludedHistoricalReleasePrefixes: releasePrefixes(sourcePaths),
    sourceNativePathsExcluded: sourcePaths.length,
  };
}

function resolveStableNativeContent(appContentRoot) {
  const sanitizer = createUrlSanitizer();
  const pointerPath = "latest-stable.json";
  const { bytes: pointerBytes, value: pointer } = readImmutableJson(
    appContentRoot,
    pointerPath,
    sanitizer,
    "stable pointer",
  );
  if (pointer.schemaVersion !== "yw-native-content-pointer-v1") {
    fail("stable pointer schema is invalid");
  }
  if (!/^yw-[a-f0-9]{24}$/.test(pointer.contentVersion || "")) {
    fail("stable pointer contentVersion is invalid");
  }
  if (!/^sha256-[a-f0-9]{64}$/.test(pointer.releaseReceiptId || "")) {
    fail("stable pointer releaseReceiptId is invalid");
  }
  if (
    pointer.sourceClean !== true
    || !["compatible-and-synced", "compatible-no-client-release"].includes(pointer.appDisposition)
    || !/^[a-f0-9]{40}$/.test(pointer.sourceRevision || "")
    || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
      .test(pointer.deploymentId || "")
    || !Number.isFinite(Date.parse(pointer.publishedAt || ""))
  ) {
    fail("stable pointer release gate is incomplete or blocked");
  }

  const releaseRelativePrefix = `releases/${pointer.contentVersion}/${pointer.releaseReceiptId}/`;
  const includedPrefix = `app-content/${releaseRelativePrefix}`;
  const expectedManifestPath = `${releaseRelativePrefix}manifest.json`;
  const expectedCorePath = `${releaseRelativePrefix}core-bundle.json`;
  if (pointer.manifest?.path !== expectedManifestPath) {
    fail("stable pointer manifest path does not match its identity");
  }
  if (pointer.coreBundle?.path !== expectedCorePath) {
    fail("stable pointer core bundle path does not match its identity");
  }
  assertPublicHref(pointer.manifest?.href, expectedManifestPath, "stable manifest");
  assertPublicHref(pointer.coreBundle?.href, expectedCorePath, "stable core bundle");

  const { bytes: manifestBytes, value: manifest } = readImmutableJson(
    appContentRoot,
    pointer.manifest.path,
    sanitizer,
    "stable manifest",
  );
  assertReceipt(pointer.manifest, manifestBytes, "stable manifest");
  if (manifest.schemaVersion !== "yw-native-content-manifest-v1") {
    fail("stable manifest schema is invalid");
  }
  for (const key of [
    "appDisposition",
    "contentVersion",
    "deploymentId",
    "publishedAt",
    "releaseReceiptId",
    "semanticDigest",
    "sourceClean",
    "sourceRevision",
  ]) {
    if (manifest[key] !== pointer[key]) fail(`stable pointer and manifest differ at ${key}`);
  }
  const { objects: _objectCount, ...manifestContentCounts } = manifest.counts || {};
  if (
    JSON.stringify(canonicalize(manifestContentCounts))
    !== JSON.stringify(canonicalize(pointer.counts))
  ) {
    fail("stable pointer and manifest counts differ");
  }
  if (!Array.isArray(manifest.objects) || manifest.counts?.objects !== manifest.objects.length) {
    fail("stable manifest object inventory is incomplete");
  }

  const releaseRoot = path.join(appContentRoot, releaseRelativePrefix);
  const expectedReleaseFiles = new Set(["manifest.json"]);
  const selectedFiles = [{
    path: "app-content/latest-stable.json",
    bytes: pointerBytes,
    sha256: sha256(pointerBytes),
  }, {
    path: `app-content/${pointer.manifest.path}`,
    bytes: manifestBytes,
    sha256: sha256(manifestBytes),
  }];
  const objectPaths = new Set();
  let coreObject = null;
  for (const object of manifest.objects) {
    if (!object || typeof object !== "object") fail("stable manifest object receipt is invalid");
    if (objectPaths.has(object.path)) fail(`duplicate stable object path: ${object.path}`);
    objectPaths.add(object.path);
    const objectFile = resolveUnder(releaseRoot, object.path, `stable object ${object.id || "unknown"}`);
    if (!existsSync(objectFile) || !lstatSync(objectFile).isFile()) {
      fail(`stable object is missing: ${object.path}`);
    }
    const bytes = readFileSync(objectFile);
    assertReceipt(object, bytes, `stable object ${object.path}`);
    const appContentPath = `${releaseRelativePrefix}${object.path}`;
    assertPublicHref(object.href, appContentPath, `stable object ${object.path}`);
    if (TEXT_EXTENSIONS.has(path.extname(object.path).toLowerCase())) {
      if (path.extname(object.path).toLowerCase() === ".json") {
        projectJson(`app-content/${appContentPath}`, bytes.toString("utf8"), sanitizer, true);
      } else {
        assertTextSafe(`app-content/${appContentPath}`, bytes.toString("utf8"));
      }
    }
    if (bytes.length >= MAX_FILE_BYTES) {
      fail(`app-content/${appContentPath} is ${bytes.length} bytes; each Pages file must be under 25 MiB`);
    }
    expectedReleaseFiles.add(object.path);
    selectedFiles.push({
      path: `app-content/${appContentPath}`,
      bytes,
      sha256: sha256(bytes),
    });
    if (object.path === "core-bundle.json") coreObject = object;
  }
  if (!coreObject) fail("stable manifest does not receipt the core bundle");
  const coreBytes = readFileSync(path.join(releaseRoot, "core-bundle.json"));
  assertReceipt(pointer.coreBundle, coreBytes, "stable core bundle");
  if (
    coreObject.bytes !== pointer.coreBundle.bytes
    || coreObject.sha256 !== pointer.coreBundle.sha256
  ) {
    fail("stable core bundle receipts disagree");
  }
  if (
    JSON.stringify([...expectedReleaseFiles].sort())
    !== JSON.stringify(collectFiles(releaseRoot))
  ) {
    fail("stable release file inventory differs from its manifest");
  }

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
    objects: manifest.objects.map(({ href: _href, ...receipt }) => receipt),
  });
  if (manifest.releaseReceiptId !== `sha256-${sha256(releaseReceiptInput)}`) {
    fail("stable release receipt ID cannot be reproduced");
  }

  selectedFiles.sort((left, right) => left.path.localeCompare(right.path, "en"));
  const includedPaths = selectedFiles.map((file) => file.path);
  const allSourcePaths = collectFiles(appContentRoot);
  const allowedSourcePaths = new Set(includedPaths.map((relative) => (
    relative.slice("app-content/".length)
  )));
  const excludedSourcePaths = allSourcePaths.filter((relative) => !allowedSourcePaths.has(relative));
  const historicalPrefixes = releasePrefixes(allSourcePaths)
    .filter((prefix) => prefix !== includedPrefix);
  return {
    files: selectedFiles,
    policy: {
      policy: "single-stable-release",
      pointerPath: "app-content/latest-stable.json",
      contentVersion: pointer.contentVersion,
      releaseReceiptId: pointer.releaseReceiptId,
      includedPrefix,
      includedPaths,
      includedPathCount: includedPaths.length,
      includedPathsSha256: pathsSha256(includedPaths),
      candidatesExcluded: true,
      historicalReleasePrefixesExcluded: true,
      excludedHistoricalReleasePrefixes: historicalPrefixes,
      sourceNativePathsExcluded: excludedSourcePaths.length,
    },
  };
}

function excludedFromBaseProjection(relative) {
  return BASE_EXCLUDED_PREFIXES.some((prefix) => relative.startsWith(prefix));
}

function projectSource(sourceRoot, releaseKind) {
  const sanitizer = createUrlSanitizer();
  const sourceFiles = collectFiles(sourceRoot);
  const projected = [];
  let changedFiles = 0;
  for (const relative of sourceFiles) {
    if (excludedFromBaseProjection(relative)) continue;
    const source = readFileSync(path.join(sourceRoot, relative));
    let output = source;
    if (TEXT_EXTENSIONS.has(path.extname(relative).toLowerCase())) {
      const text = source.toString("utf8");
      if (path.extname(relative).toLowerCase() === ".json") {
        output = Buffer.from(projectJson(relative, text, sanitizer));
      } else {
        assertTextSafe(relative, text);
      }
      if (!output.equals(source)) changedFiles += 1;
    }
    if (output.length >= MAX_FILE_BYTES) {
      fail(`${relative} is ${output.length} bytes; each Pages file must be under 25 MiB`);
    }
    projected.push({
      path: relative,
      bytes: output,
      sha256: sha256(output),
    });
  }

  let nativeContent;
  if (releaseKind === RELEASE_KINDS.formal) {
    const selection = resolveStableNativeContent(path.join(sourceRoot, "app-content"));
    projected.push(...selection.files);
    nativeContent = selection.policy;
  } else {
    nativeContent = previewNativePolicy(sourceRoot);
  }
  projected.sort((left, right) => left.path.localeCompare(right.path, "en"));
  if (new Set(projected.map((file) => file.path)).size !== projected.length) {
    fail("release projection contains duplicate paths");
  }
  if (projected.length + 1 >= MAX_FILES) {
    fail(`release projection has ${projected.length + 1} files; must stay below ${MAX_FILES}`);
  }
  return {
    changedFiles,
    nativeContent,
    projected,
    redactions: sanitizer.redactions,
    sourceFiles: sourceFiles.length,
  };
}

function markerFor(projected, changedFiles, releaseKind, nativeContent) {
  const aggregateSha256 = sha256(
    projected.map((file) => `${file.sha256}  ${file.path}\n`).join(""),
  );
  return {
    schemaVersion: "yw-release-site-v2",
    releaseKind,
    sourceRoot: "site/",
    baseExcludedPrefixes: BASE_EXCLUDED_PREFIXES,
    sanitizedFiles: changedFiles,
    projectedFiles: projected.length,
    artifactFiles: projected.length + 1,
    projectedAggregateSha256: aggregateSha256,
    nativeContent,
  };
}

function verifyMarkerNativePolicy(marker, releaseRoot, releaseKind) {
  const policy = marker.nativeContent;
  if (!policy || policy.candidatesExcluded !== true || policy.historicalReleasePrefixesExcluded !== true) {
    fail("release artifact native-content exclusion policy is invalid");
  }
  if (!Array.isArray(policy.includedPaths) || policy.includedPathCount !== policy.includedPaths.length) {
    fail("release artifact native-content allowlist is invalid");
  }
  if (pathsSha256(policy.includedPaths) !== policy.includedPathsSha256) {
    fail("release artifact native-content allowlist receipt is invalid");
  }
  for (const prefix of policy.excludedHistoricalReleasePrefixes || []) {
    if (typeof prefix !== "string" || !prefix.startsWith("app-content/releases/")) {
      fail("release artifact historical exclusion prefix is invalid");
    }
    if (collectFiles(releaseRoot).some((relative) => relative.startsWith(prefix))) {
      fail(`historical native release exists in staging: ${prefix}`);
    }
  }
  if (collectFiles(releaseRoot).some((relative) => relative.startsWith("app-content/candidates/"))) {
    fail("native candidate pointer exists in staging");
  }

  if (releaseKind === RELEASE_KINDS.preview) {
    if (
      policy.policy !== "excluded"
      || policy.pointerPath !== null
      || policy.includedPrefix !== null
      || policy.includedPaths.length !== 0
      || existsSync(path.join(releaseRoot, "app-content"))
    ) {
      fail("preview artifact must exclude the entire native app-content tree");
    }
    return;
  }

  if (policy.policy !== "single-stable-release") {
    fail("formal artifact native-content policy is invalid");
  }
  const selection = resolveStableNativeContent(path.join(releaseRoot, "app-content"));
  if (
    selection.policy.includedPrefix !== policy.includedPrefix
    || selection.policy.contentVersion !== policy.contentVersion
    || selection.policy.releaseReceiptId !== policy.releaseReceiptId
    || JSON.stringify(selection.policy.includedPaths) !== JSON.stringify(policy.includedPaths)
  ) {
    fail("formal artifact native-content allowlist differs from its stable receipts");
  }
  const stagedNativePaths = collectFiles(path.join(releaseRoot, "app-content"))
    .map((relative) => `app-content/${relative}`);
  if (JSON.stringify(stagedNativePaths) !== JSON.stringify(policy.includedPaths)) {
    fail("formal artifact contains native paths outside the exact stable allowlist");
  }
}

export function verifyReleaseStaging({
  releaseRoot = DEFAULT_RELEASE_ROOT,
  releaseKind = RELEASE_KINDS.formal,
} = {}) {
  if (!existsSync(releaseRoot)) fail(".release/site is missing; build the release artifact first");
  const markerFile = path.join(releaseRoot, MARKER_PATH);
  if (!existsSync(markerFile)) fail("release artifact marker is missing");
  const marker = parseJson(MARKER_PATH, readFileSync(markerFile, "utf8"));
  const markerSanitizer = createUrlSanitizer();
  if (
    JSON.stringify(markerSanitizer.sanitizeValue(marker))
    !== JSON.stringify(marker)
  ) {
    fail("release artifact marker requires privacy sanitization");
  }
  assertJsonStringsSafe(MARKER_PATH, marker, markerSanitizer);
  if (marker.schemaVersion !== "yw-release-site-v2") fail("release artifact marker schema is invalid");
  if (marker.releaseKind !== releaseKind) {
    fail(`release artifact kind is ${marker.releaseKind}; expected ${releaseKind}`);
  }
  if (JSON.stringify(marker.baseExcludedPrefixes) !== JSON.stringify(BASE_EXCLUDED_PREFIXES)) {
    fail("release artifact base exclusion policy is invalid");
  }
  for (const prefix of BASE_EXCLUDED_PREFIXES.filter((item) => item !== "app-content/")) {
    if (existsSync(path.join(releaseRoot, prefix))) fail(`excluded release path exists: ${prefix}`);
  }

  const files = collectFiles(releaseRoot);
  if (files.length >= MAX_FILES) fail(`release artifact has ${files.length} files`);
  if (files.length !== marker.artifactFiles || marker.projectedFiles !== files.length - 1) {
    fail("release artifact file count differs from its marker");
  }
  const payloadFiles = files.filter((relative) => relative !== MARKER_PATH);
  const receipts = [];
  const sanitizer = createUrlSanitizer();
  for (const relative of payloadFiles) {
    const bytes = readFileSync(path.join(releaseRoot, relative));
    if (bytes.length >= MAX_FILE_BYTES) {
      fail(`${relative} is ${bytes.length} bytes; each Pages file must be under 25 MiB`);
    }
    if (TEXT_EXTENSIONS.has(path.extname(relative).toLowerCase())) {
      const text = bytes.toString("utf8");
      if (path.extname(relative).toLowerCase() === ".json") {
        projectJson(relative, text, sanitizer, true);
      } else {
        assertTextSafe(relative, text);
      }
    }
    receipts.push({ path: relative, sha256: sha256(bytes) });
  }
  const aggregateSha256 = sha256(
    receipts.map((file) => `${file.sha256}  ${file.path}\n`).join(""),
  );
  if (aggregateSha256 !== marker.projectedAggregateSha256) {
    fail("release artifact aggregate receipt differs from its marker");
  }
  verifyMarkerNativePolicy(marker, releaseRoot, releaseKind);
  return {
    mode: "check-staging",
    releaseKind,
    releaseRoot,
    files: files.length,
    marker,
  };
}

export function buildReleaseSite({
  sourceRoot = DEFAULT_SOURCE_ROOT,
  releaseRoot = DEFAULT_RELEASE_ROOT,
  releaseKind = RELEASE_KINDS.formal,
  mode = "build",
} = {}) {
  if (!Object.values(RELEASE_KINDS).includes(releaseKind)) {
    fail(`unknown release kind: ${releaseKind}`);
  }
  if (mode === "check-staging") {
    return verifyReleaseStaging({ releaseRoot, releaseKind });
  }
  const {
    changedFiles,
    nativeContent,
    projected,
    redactions,
    sourceFiles,
  } = projectSource(sourceRoot, releaseKind);
  const marker = markerFor(projected, changedFiles, releaseKind, nativeContent);
  if (mode === "check-source") {
    return {
      mode,
      releaseKind,
      sourceFiles,
      projectedFiles: projected.length,
      artifactFiles: projected.length + 1,
      changedFiles,
      excludedPrefixes: BASE_EXCLUDED_PREFIXES,
      redactions,
      nativeContent,
      marker,
    };
  }
  if (mode !== "build") fail(`unknown release mode: ${mode}`);

  const pendingRoot = `${releaseRoot}.pending-${process.pid}`;
  rmSync(pendingRoot, { recursive: true, force: true });
  mkdirSync(pendingRoot, { recursive: true });
  for (const file of projected) {
    const output = path.join(pendingRoot, file.path);
    mkdirSync(path.dirname(output), { recursive: true });
    writeFileSync(output, file.bytes);
  }
  writeFileSync(
    path.join(pendingRoot, MARKER_PATH),
    `${JSON.stringify(marker, null, 2)}\n`,
  );
  rmSync(releaseRoot, { recursive: true, force: true });
  renameSync(pendingRoot, releaseRoot);
  return verifyReleaseStaging({ releaseRoot, releaseKind });
}

function parseCli(argv) {
  const known = new Set(["--check-source", "--check-staging", "--preview"]);
  for (const argument of argv) {
    if (!known.has(argument)) fail(`unknown argument: ${argument}`);
  }
  if (argv.includes("--check-source") && argv.includes("--check-staging")) {
    fail("--check-source and --check-staging are mutually exclusive");
  }
  return {
    mode: argv.includes("--check-source")
      ? "check-source"
      : argv.includes("--check-staging")
        ? "check-staging"
        : "build",
    releaseKind: argv.includes("--preview")
      ? RELEASE_KINDS.preview
      : RELEASE_KINDS.formal,
  };
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const { mode, releaseKind } = parseCli(process.argv.slice(2));
  const result = buildReleaseSite({ mode, releaseKind });
  process.stdout.write(`${JSON.stringify({
    ...result,
    releaseRoot: result.releaseRoot
      ? path.relative(ROOT, result.releaseRoot)
      : undefined,
  }, null, 2)}\n`);
}
