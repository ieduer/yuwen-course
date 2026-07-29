#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUTPUT_ROOT = process.env.YW_NATIVE_CONTENT_DEPLOY_ROOT
  ? path.resolve(process.env.YW_NATIVE_CONTENT_DEPLOY_ROOT)
  : path.join(ROOT, "site", "app-content");
const STABLE_POINTER_FILE = path.join(OUTPUT_ROOT, "latest-stable.json");

function fail(message) {
  throw new Error(message);
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

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function json(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function resolveUnder(root, relative, label) {
  if (typeof relative !== "string" || path.isAbsolute(relative) || relative.split("/").includes("..")) {
    fail(`${label} path is unsafe`);
  }
  const resolved = path.resolve(root, relative);
  if (!resolved.startsWith(`${path.resolve(root)}${path.sep}`)) fail(`${label} escapes its root`);
  return resolved;
}

function collectFiles(root, prefix = "") {
  const files = [];
  for (const entry of readdirSync(path.join(root, prefix), { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(root, relative);
    if (lstatSync(full).isSymbolicLink()) fail(`symlink is forbidden: ${relative}`);
    if (entry.isDirectory()) files.push(...collectFiles(root, relative));
    else if (entry.isFile()) files.push(relative);
  }
  return files.sort((left, right) => left.localeCompare(right, "en"));
}

if (!existsSync(STABLE_POINTER_FILE)) {
  fail("site/app-content/latest-stable.json is missing");
}

const temporaryOutput = mkdtempSync(path.join(os.tmpdir(), "yw-native-deploy-sync-"));
try {
  const currentBuild = JSON.parse(execFileSync(process.execPath, [
    "scripts/build_native_content.mjs",
    "--allow-dirty",
  ], {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      YW_NATIVE_CONTENT_OUTPUT_ROOT: temporaryOutput,
    },
  }));
  if (currentBuild.audit.status !== "approved" || currentBuild.releaseBlockers.length > 0) {
    fail("current canonical source graph lacks an approved audit receipt");
  }

  const pointerBytes = readFileSync(STABLE_POINTER_FILE);
  const pointer = JSON.parse(pointerBytes);
  if (pointer.schemaVersion !== "yw-native-content-pointer-v1") fail("stable pointer schema is invalid");
  if (pointer.sourceClean !== true) fail("stable pointer sourceClean is not true");
  if (pointer.appDisposition !== "compatible-and-synced") {
    fail("stable pointer appDisposition is not compatible-and-synced");
  }
  if (pointer.semanticDigest !== currentBuild.semanticDigest) {
    fail("stable pointer semanticDigest is stale against the current canonical graph");
  }
  if (pointer.contentVersion !== currentBuild.contentVersion) {
    fail("stable pointer contentVersion is stale against the current canonical graph");
  }
  if (JSON.stringify(canonicalize(pointer.counts)) !== JSON.stringify(canonicalize(currentBuild.counts))) {
    fail("stable pointer counts differ from the current canonical graph");
  }

  const manifestFile = resolveUnder(OUTPUT_ROOT, pointer.manifest?.path, "manifest");
  const coreFile = resolveUnder(OUTPUT_ROOT, pointer.coreBundle?.path, "core bundle");
  const manifestBytes = readFileSync(manifestFile);
  const coreBytes = readFileSync(coreFile);
  if (manifestBytes.length !== pointer.manifest.bytes || sha256(manifestBytes) !== pointer.manifest.sha256) {
    fail("stable pointer manifest receipt does not match");
  }
  if (coreBytes.length !== pointer.coreBundle.bytes || sha256(coreBytes) !== pointer.coreBundle.sha256) {
    fail("stable pointer core receipt does not match");
  }

  const manifest = JSON.parse(manifestBytes);
  const core = JSON.parse(coreBytes);
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
    if (manifest[key] !== pointer[key]) fail(`manifest and pointer differ at ${key}`);
  }
  if (core.contentVersion !== pointer.contentVersion || core.semanticDigest !== pointer.semanticDigest) {
    fail("core bundle identity differs from stable pointer");
  }
  if (JSON.stringify(canonicalize(core.counts)) !== JSON.stringify(canonicalize(currentBuild.counts))) {
    fail("core bundle counts differ from the current canonical graph");
  }
  if (manifest.counts?.objects !== manifest.objects?.length) fail("manifest object count is incomplete");

  const releaseRoot = path.dirname(manifestFile);
  const expectedFiles = new Set(["manifest.json"]);
  for (const object of manifest.objects || []) {
    const objectFile = resolveUnder(releaseRoot, object.path, `object ${object.id || "unknown"}`);
    const bytes = readFileSync(objectFile);
    if (bytes.length !== object.bytes || sha256(bytes) !== object.sha256) {
      fail(`object receipt does not match: ${object.path}`);
    }
    expectedFiles.add(object.path);
  }
  if (JSON.stringify([...expectedFiles].sort()) !== JSON.stringify(collectFiles(releaseRoot))) {
    fail("immutable release file inventory differs from the manifest");
  }

  const receiptInput = serialize({
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
  if (manifest.releaseReceiptId !== `sha256-${sha256(receiptInput)}`) {
    fail("release receipt ID cannot be reproduced");
  }

  process.stdout.write(`${JSON.stringify({
    contentVersion: pointer.contentVersion,
    semanticDigest: pointer.semanticDigest,
    releaseReceiptId: pointer.releaseReceiptId,
    objects: manifest.objects.length,
    sourceClean: pointer.sourceClean,
    appDisposition: pointer.appDisposition,
    status: "deploy-synced",
  }, null, 2)}\n`);
} finally {
  rmSync(temporaryOutput, { recursive: true, force: true });
}
