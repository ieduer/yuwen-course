#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_MANIFEST_PATH = resolve(ROOT, "site/data/preview-screenshots.json");
const DEFAULT_REGISTRY_PATH = resolve(ROOT, "site/data/preview-targets.json");
const DEFAULT_OUTPUT_DIR = resolve(ROOT, "site/assets/preview-screenshots");

const RECEIPT_SCHEMA = "yw-authenticated-preview-receipt-v1";
const RECOVERY_METHOD = "reviewed-authenticated-page";
const MAX_SCREENSHOT_BYTES = 250_000;
const PRIVATE_QUERY_KEY = /(?:auth|client|code|continue|credential|dsh|email|flow|followup|identity|ifkv|login|nonce|pass|passive|prompt|redirect|secret|service|session|state|token|user)/i;
const AUTH_PATH = /\/(?:account|activate|auth|login|logout|oauth|session|signin|signup|u)(?:\/|$)/i;
const CONTENT_ADDRESSED_FILE = /^[a-f0-9]{24}\.webp$/;

// These hashes freeze the exact authorized batches that existed in the reviewed
// blocked list. A changed, partial, combined, or newly injected host set fails.
export const AUTHORIZED_SOURCE_BATCHES = Object.freeze({
  "ctext.org": Object.freeze({
    count: 22,
    digest: "f3ba141bdb0028e6c2116dfecbcb756ee28865b453dd82aa5f7e36b78b818d10",
  }),
  "forum.rdfzer.com": Object.freeze({
    count: 27,
    digest: "64e441d8eac69183118d5e80e106609cc3f30d800e0c83426b4fb0cf8af279a3",
  }),
});

// E01, P01-P16, and the reviewed empty SCDFZ page are removed by the
// source/registry policy. The six remaining external-condition records must
// survive either authenticated batch.
const RETAINED_EXTERNAL_BATCH = Object.freeze({
  count: 6,
  digest: "8fd16f05cd6ffbb159453c8622df7b0a0325e638002dd0597d423093e098968c",
});

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function digestSourceSet(sources) {
  return sha256(JSON.stringify([...sources].sort()));
}

function fail(message) {
  throw new Error(`authenticated preview import rejected: ${message}`);
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    fail(`${label} must be a plain object`);
  }
}

function assertExactKeys(value, allowed, required, label) {
  assertPlainObject(value, label);
  const keys = Object.keys(value).sort();
  const unexpected = keys.filter((key) => !allowed.includes(key));
  const missing = required.filter((key) => !Object.hasOwn(value, key));
  if (unexpected.length) fail(`${label} contains forbidden fields: ${unexpected.join(", ")}`);
  if (missing.length) fail(`${label} is missing fields: ${missing.join(", ")}`);
}

function normalizeExpectedSha(value) {
  const normalized = String(value || "").toLowerCase().replace(/^sha256:/, "");
  if (!/^[a-f0-9]{64}$/.test(normalized)) fail("expected receipt SHA-256 is invalid");
  return normalized;
}

function assertRegularFile(path, label) {
  if (!existsSync(path)) fail(`${label} is missing: ${path}`);
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) fail(`${label} must be a regular non-symlink file: ${path}`);
}

function readJsonFile(path, label) {
  assertRegularFile(path, label);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`${label} is not valid JSON: ${error.message}`);
  }
}

function validateManifestAndRegistry(manifest, registry) {
  assertPlainObject(manifest, "manifest");
  assertPlainObject(registry, "registry");
  if (manifest.schemaVersion !== "yw-preview-screenshots-v1") fail("manifest schema is not supported");
  if (registry.schemaVersion !== "yw-preview-targets-v1" || !Array.isArray(registry.targets)) {
    fail("preview target registry schema is not supported");
  }
  for (const section of ["entries", "blocked", "resolved"]) {
    if (!Array.isArray(manifest[section])) fail(`manifest.${section} must be an array`);
  }
  if (new Set(registry.targets).size !== registry.targets.length) fail("preview target registry contains duplicates");
  const seen = new Set();
  for (const section of ["entries", "blocked", "resolved"]) {
    for (const entry of manifest[section]) {
      assertPlainObject(entry, `manifest.${section} entry`);
      if (typeof entry.sourceUrl !== "string" || !entry.sourceUrl) fail(`manifest.${section} has an invalid sourceUrl`);
      if (seen.has(entry.sourceUrl)) fail(`manifest source is duplicated across sections: ${entry.sourceUrl}`);
      seen.add(entry.sourceUrl);
    }
  }
}

function topicId(raw) {
  const parts = new URL(raw).pathname.split("/").filter(Boolean);
  if (parts[0] !== "t") return "";
  if (/^\d+$/.test(parts[1] || "")) return parts[1];
  if (/^\d+$/.test(parts[2] || "")) return parts[2];
  return "";
}

function validateCaptureUrl(raw, sourceUrl, sourceHost) {
  if (typeof raw !== "string" || !raw || raw.length > 2_048) fail(`invalid captureUrl for ${sourceUrl}`);
  let capture;
  try {
    capture = new URL(raw);
  } catch {
    fail(`invalid captureUrl for ${sourceUrl}`);
  }
  if (
    capture.protocol !== "https:"
    || capture.hostname !== sourceHost
    || capture.port
    || capture.username
    || capture.password
    || capture.hash
    || AUTH_PATH.test(capture.pathname)
  ) fail(`captureUrl leaves the privacy-bounded source surface for ${sourceUrl}`);
  for (const key of capture.searchParams.keys()) {
    if (PRIVATE_QUERY_KEY.test(key)) fail(`captureUrl contains a private query key for ${sourceUrl}`);
    if (sourceHost === "forum.rdfzer.com") fail(`forum captureUrl must not contain query parameters: ${sourceUrl}`);
    if (!["chapter", "file", "if", "page", "remap", "searchmode", "searchu"].includes(key.toLowerCase())) {
      fail(`captureUrl contains a non-semantic query key for ${sourceUrl}`);
    }
  }
  if (sourceHost === "forum.rdfzer.com" && (!topicId(sourceUrl) || topicId(sourceUrl) !== topicId(raw))) {
    fail(`forum captureUrl does not identify the source topic: ${sourceUrl}`);
  }
  if (sourceHost === "ctext.org" && capture.toString() !== new URL(sourceUrl).toString()) {
    fail(`ctext captureUrl must be the exact registered source URL: ${sourceUrl}`);
  }
  return capture.toString();
}

function webpDimensions(bytes, label) {
  if (
    bytes.length < 30
    || bytes.subarray(0, 4).toString("ascii") !== "RIFF"
    || bytes.subarray(8, 12).toString("ascii") !== "WEBP"
    || bytes.readUInt32LE(4) + 8 !== bytes.length
  ) fail(`${label} is not a complete RIFF WebP`);
  let offset = 12;
  let canvas = null;
  let image = null;
  while (offset + 8 <= bytes.length) {
    const type = bytes.subarray(offset, offset + 4).toString("ascii");
    const size = bytes.readUInt32LE(offset + 4);
    const data = offset + 8;
    const end = data + size;
    if (end > bytes.length) fail(`${label} has a truncated WebP chunk`);
    if (type === "VP8X" && size >= 10) {
      canvas = {
        width: 1 + bytes.readUIntLE(data + 4, 3),
        height: 1 + bytes.readUIntLE(data + 7, 3),
      };
    }
    if (type === "VP8 " && size >= 10 && bytes.subarray(data + 3, data + 6).equals(Buffer.from([0x9d, 0x01, 0x2a]))) {
      image = {
        width: bytes.readUInt16LE(data + 6) & 0x3fff,
        height: bytes.readUInt16LE(data + 8) & 0x3fff,
      };
    }
    if (type === "VP8L" && size >= 5 && bytes[data] === 0x2f) {
      const bits = bytes.readUInt32LE(data + 1);
      image = {
        width: 1 + (bits & 0x3fff),
        height: 1 + ((bits >>> 14) & 0x3fff),
      };
    }
    offset = end + (size % 2);
  }
  if (offset !== bytes.length || !image) fail(`${label} has no complete WebP image payload`);
  if (canvas && (canvas.width !== image.width || canvas.height !== image.height)) {
    fail(`${label} has inconsistent WebP canvas dimensions`);
  }
  if (canvas || image) return canvas || image;
  fail(`${label} has no decodable WebP dimensions`);
}

function validateAsset(bytes, expected, label) {
  if (!bytes.length || bytes.length > MAX_SCREENSHOT_BYTES) fail(`${label} exceeds the 250KB byte limit`);
  if (bytes.length !== expected.bytes) fail(`${label} byte count does not match the receipt`);
  if (sha256(bytes) !== expected.sha256) fail(`${label} SHA-256 does not match the receipt`);
  const dimensions = webpDimensions(bytes, label);
  if (dimensions.width !== 1024 || dimensions.height !== 640) fail(`${label} is not 1024x640`);
  if (expected.width !== 1024 || expected.height !== 640) fail(`${label} receipt dimensions are not 1024x640`);
}

function registeredCanonicalBatches(manifest, registered) {
  const byHost = new Map();
  for (const [host, authority] of Object.entries(AUTHORIZED_SOURCE_BATCHES)) {
    const records = [...manifest.blocked, ...manifest.entries].filter((entry) => {
      if (!registered.has(entry.sourceUrl)) return false;
      let entryHost = "";
      try { entryHost = new URL(entry.sourceUrl).hostname; } catch { return false; }
      return entryHost === host && (
        entry.auditCategory === "requires-suen-or-external-account"
        || entry.recoveryMethod === RECOVERY_METHOD
      );
    });
    const sources = records.map((entry) => entry.sourceUrl).sort();
    if (sources.length !== authority.count || digestSourceSet(sources) !== authority.digest) {
      fail(`canonical ${host} source batch no longer matches the reviewed ${authority.count}-source set`);
    }
    byHost.set(host, new Map(records.map((entry) => [entry.sourceUrl, entry])));
  }
  return byHost;
}

function validateRetainedExternalBlockers(manifest, registered) {
  const sources = manifest.blocked
    .filter((entry) => {
      if (!registered.has(entry.sourceUrl) || entry.resolutionGroup !== "external-condition-required") return false;
      try { return !Object.hasOwn(AUTHORIZED_SOURCE_BATCHES, new URL(entry.sourceUrl).hostname); } catch { return false; }
    })
    .map((entry) => entry.sourceUrl)
    .sort();
  if (sources.length !== RETAINED_EXTERNAL_BATCH.count || digestSourceSet(sources) !== RETAINED_EXTERNAL_BATCH.digest) {
    fail("the six retained external-condition blockers no longer match the reviewed set");
  }
}

function validateReceipt(receipt, sourceRecords, sourceHost) {
  assertExactKeys(
    receipt,
    ["captures", "reviewStatus", "schemaVersion", "sourceHost", "viewport"],
    ["captures", "reviewStatus", "schemaVersion", "sourceHost", "viewport"],
    "receipt",
  );
  if (receipt.schemaVersion !== RECEIPT_SCHEMA) fail("receipt schema is not supported");
  if (receipt.sourceHost !== sourceHost || !Object.hasOwn(AUTHORIZED_SOURCE_BATCHES, sourceHost)) {
    fail("receipt sourceHost is not an authorized single-host batch");
  }
  if (receipt.reviewStatus !== RECOVERY_METHOD) fail("receipt is not marked reviewed-authenticated-page");
  assertExactKeys(receipt.viewport, ["height", "width"], ["height", "width"], "receipt.viewport");
  if (receipt.viewport.width !== 1024 || receipt.viewport.height !== 640) fail("receipt viewport is not 1024x640");
  if (!Array.isArray(receipt.captures)) fail("receipt.captures must be an array");

  const authority = AUTHORIZED_SOURCE_BATCHES[sourceHost];
  const captures = new Map();
  for (const [index, capture] of receipt.captures.entries()) {
    const label = `receipt.captures[${index}]`;
    assertExactKeys(
      capture,
      ["bytes", "captureUrl", "height", "screenshotFile", "sha256", "sourceUrl", "title", "width"],
      ["bytes", "captureUrl", "height", "screenshotFile", "sha256", "sourceUrl", "title", "width"],
      label,
    );
    if (typeof capture.sourceUrl !== "string" || !sourceRecords.has(capture.sourceUrl)) {
      fail(`${label}.sourceUrl is not in the canonical ${sourceHost} batch`);
    }
    if (captures.has(capture.sourceUrl)) fail(`receipt duplicates sourceUrl: ${capture.sourceUrl}`);
    if (
      typeof capture.title !== "string"
      || !capture.title.trim()
      || capture.title.length > 200
      || /[\u0000-\u001f\u007f]/.test(capture.title)
      || /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(capture.title)
    ) {
      fail(`${label}.title is invalid`);
    }
    if (!Number.isInteger(capture.bytes) || capture.bytes <= 0 || capture.bytes > MAX_SCREENSHOT_BYTES) {
      fail(`${label}.bytes is invalid`);
    }
    if (!/^[a-f0-9]{64}$/.test(capture.sha256 || "")) fail(`${label}.sha256 is invalid`);
    const expectedFile = `${capture.sha256.slice(0, 24)}.webp`;
    if (capture.screenshotFile !== expectedFile || !CONTENT_ADDRESSED_FILE.test(capture.screenshotFile)) {
      fail(`${label}.screenshotFile is not content-addressed`);
    }
    capture.captureUrl = validateCaptureUrl(capture.captureUrl, capture.sourceUrl, sourceHost);
    captures.set(capture.sourceUrl, capture);
  }
  const sources = [...captures.keys()].sort();
  if (sources.length !== authority.count || digestSourceSet(sources) !== authority.digest) {
    fail(`receipt must contain the exact ${authority.count}-source ${sourceHost} batch`);
  }
  return captures;
}

function validateStagedAssets(stagedAssetsPath, captures) {
  if (!existsSync(stagedAssetsPath)) fail(`staged assets directory is missing: ${stagedAssetsPath}`);
  const stat = lstatSync(stagedAssetsPath);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail("staged assets path must be a non-symlink directory");
  const expectedFiles = [...new Set([...captures.values()].map((entry) => entry.screenshotFile))].sort();
  const items = readdirSync(stagedAssetsPath, { withFileTypes: true });
  if (items.some((item) => !item.isFile() || item.isSymbolicLink())) fail("staged assets directory contains a non-file entry");
  const actualFiles = items.map((item) => item.name).sort();
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
    fail("staged assets are missing files or contain extra files");
  }
  const assets = new Map();
  for (const file of expectedFiles) {
    if (!CONTENT_ADDRESSED_FILE.test(file) || basename(file) !== file) fail(`invalid staged asset filename: ${file}`);
    const capture = [...captures.values()].find((entry) => entry.screenshotFile === file);
    const path = resolve(stagedAssetsPath, file);
    assertRegularFile(path, "staged screenshot");
    const bytes = readFileSync(path);
    validateAsset(bytes, capture, `staged screenshot ${file}`);
    assets.set(file, bytes);
  }
  return assets;
}

function validateExistingAssets(entries, outputDir) {
  for (const entry of entries) {
    const file = String(entry.screenshotUrl || "").replace(/^\/assets\/preview-screenshots\//, "");
    if (!CONTENT_ADDRESSED_FILE.test(file) || entry.screenshotUrl !== `/assets/preview-screenshots/${file}`) {
      fail(`existing manifest asset path is invalid: ${entry.sourceUrl}`);
    }
    const path = resolve(outputDir, file);
    assertRegularFile(path, "existing screenshot");
    validateAsset(readFileSync(path), entry, `existing screenshot ${file}`);
  }
}

function renderManifest(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function atomicWrite(path, bytes) {
  const temporary = `${path}.tmp-${process.pid}`;
  try {
    writeFileSync(temporary, bytes, { flag: "wx" });
    renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

export function importAuthenticatedPreviewScreenshots({
  receiptPath,
  stagedAssetsPath,
  expectedReceiptSha256,
  manifestPath = DEFAULT_MANIFEST_PATH,
  registryPath = DEFAULT_REGISTRY_PATH,
  outputDir = DEFAULT_OUTPUT_DIR,
}) {
  const expectedReceiptSha = normalizeExpectedSha(expectedReceiptSha256);
  assertRegularFile(receiptPath, "receipt");
  const receiptBytes = readFileSync(receiptPath);
  if (sha256(receiptBytes) !== expectedReceiptSha) fail("receipt SHA-256 does not match the expected value");

  let receipt;
  try { receipt = JSON.parse(receiptBytes.toString("utf8")); } catch (error) { fail(`receipt is not valid JSON: ${error.message}`); }
  const manifestBytes = readFileSync(manifestPath);
  const manifest = readJsonFile(manifestPath, "manifest");
  const registry = readJsonFile(registryPath, "registry");
  validateManifestAndRegistry(manifest, registry);

  const registered = new Set(registry.targets);
  const batches = registeredCanonicalBatches(manifest, registered);
  validateRetainedExternalBlockers(manifest, registered);
  const sourceHost = receipt?.sourceHost;
  const sourceRecords = batches.get(sourceHost);
  if (!sourceRecords) fail("receipt sourceHost is not authorized");
  const captures = validateReceipt(receipt, sourceRecords, sourceHost);
  const stagedAssets = validateStagedAssets(stagedAssetsPath, captures);

  const keptEntries = manifest.entries.filter((entry) => registered.has(entry.sourceUrl));
  validateExistingAssets(keptEntries, outputDir);
  const priorReferencedFiles = new Set(manifest.entries.map((entry) => String(entry.screenshotUrl || "").split("/").pop()));
  const importedSources = new Set(captures.keys());
  const nextEntries = keptEntries.filter((entry) => !importedSources.has(entry.sourceUrl));
  for (const sourceUrl of [...importedSources].sort()) {
    const capture = captures.get(sourceUrl);
    const canonical = sourceRecords.get(sourceUrl);
    if (!Array.isArray(canonical.attribution) || canonical.attribution.length === 0) {
      fail(`canonical attribution is missing for ${sourceUrl}`);
    }
    nextEntries.push({
      sourceUrl,
      screenshotUrl: `/assets/preview-screenshots/${capture.screenshotFile}`,
      title: capture.title.trim(),
      width: 1024,
      height: 640,
      bytes: capture.bytes,
      sha256: capture.sha256,
      reason: canonical.reason || "authenticated-page-required",
      captureUrl: capture.captureUrl,
      recoveryMethod: RECOVERY_METHOD,
      attribution: canonical.attribution,
      disposition: "screenshot-provided",
    });
  }
  nextEntries.sort((left, right) => left.sourceUrl.localeCompare(right.sourceUrl));
  const nextBlocked = manifest.blocked
    .filter((entry) => registered.has(entry.sourceUrl) && !importedSources.has(entry.sourceUrl))
    .sort((left, right) => left.sourceUrl.localeCompare(right.sourceUrl));
  const nextResolved = manifest.resolved
    .filter((entry) => registered.has(entry.sourceUrl))
    .sort((left, right) => left.sourceUrl.localeCompare(right.sourceUrl));
  const nextManifest = {
    ...manifest,
    totalBytes: nextEntries.reduce((total, entry) => total + entry.bytes, 0),
    candidateCount: nextEntries.length + nextBlocked.length + nextResolved.length,
    screenshotCount: nextEntries.length,
    blockedCount: nextBlocked.length,
    entries: nextEntries,
    resolved: nextResolved,
    blocked: nextBlocked,
    resolvedCount: nextResolved.length,
  };

  // Recheck the authority immediately before the first mutation.
  if (!readFileSync(manifestPath).equals(manifestBytes)) fail("manifest changed during validation");
  mkdirSync(outputDir, { recursive: true });
  for (const [file, bytes] of stagedAssets) {
    const destination = resolve(outputDir, file);
    if (existsSync(destination)) {
      assertRegularFile(destination, "destination screenshot");
      if (!readFileSync(destination).equals(bytes)) fail(`destination asset conflicts with content address: ${file}`);
      continue;
    }
    atomicWrite(destination, bytes);
  }
  atomicWrite(manifestPath, renderManifest(nextManifest));

  const nextReferencedFiles = new Set(nextEntries.map((entry) => entry.screenshotUrl.split("/").pop()));
  for (const file of [...priorReferencedFiles].filter((entry) => CONTENT_ADDRESSED_FILE.test(entry) && !nextReferencedFiles.has(entry))) {
    const path = resolve(outputDir, file);
    if (existsSync(path)) unlinkSync(path);
  }
  return {
    sourceHost,
    receiptSha256: expectedReceiptSha,
    importedCount: captures.size,
    screenshotCount: nextManifest.screenshotCount,
    blockedCount: nextManifest.blockedCount,
    resolvedCount: nextManifest.resolvedCount,
    candidateCount: nextManifest.candidateCount,
    totalBytes: nextManifest.totalBytes,
    manifestSha256: sha256(renderManifest(nextManifest)),
  };
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];
    if (!raw.startsWith("--")) fail(`unexpected argument: ${raw}`);
    const separator = raw.indexOf("=");
    if (separator !== -1) {
      values.set(raw.slice(2, separator), raw.slice(separator + 1));
      continue;
    }
    const key = raw.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail(`missing value for --${key}`);
    values.set(key, value);
    index += 1;
  }
  const allowed = new Set(["assets", "manifest", "output", "receipt", "receipt-sha256", "registry"]);
  for (const key of values.keys()) if (!allowed.has(key)) fail(`unknown argument: --${key}`);
  for (const key of ["assets", "receipt", "receipt-sha256"]) if (!values.get(key)) fail(`missing --${key}`);
  return {
    receiptPath: resolve(values.get("receipt")),
    stagedAssetsPath: resolve(values.get("assets")),
    expectedReceiptSha256: values.get("receipt-sha256"),
    ...(values.get("manifest") ? { manifestPath: resolve(values.get("manifest")) } : {}),
    ...(values.get("registry") ? { registryPath: resolve(values.get("registry")) } : {}),
    ...(values.get("output") ? { outputDir: resolve(values.get("output")) } : {}),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = importAuthenticatedPreviewScreenshots(parseArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
