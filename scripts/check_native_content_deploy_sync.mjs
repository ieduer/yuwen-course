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
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUTPUT_ROOT = process.env.YW_NATIVE_CONTENT_DEPLOY_ROOT
  ? path.resolve(process.env.YW_NATIVE_CONTENT_DEPLOY_ROOT)
  : path.join(ROOT, "site", "app-content");
const STABLE_POINTER_FILE = path.join(OUTPUT_ROOT, "latest-stable.json");
const ARTIFACT_ROOT = path.join(ROOT, ".release", "site");
const ARTIFACT_MANIFEST_FILE = path.join(ROOT, "docs", "baselines", "site-artifact-manifest.json");
const RECEIPT_ROOT = "/Users/ylsuen/CF/reports/operations/shared_hub_changes";
const WEB_ONLY_MODE = "compatible-no-client-release";

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

function parseArguments(args) {
  if (args.length === 0) return { mode: "compatible-and-synced", receiptFile: "" };
  if (
    args.length !== 4
    || args[0] !== "--mode"
    || args[1] !== WEB_ONLY_MODE
    || args[2] !== "--receipt"
  ) {
    fail(`usage: check_native_content_deploy_sync.mjs [--mode ${WEB_ONLY_MODE} --receipt <ABSOLUTE_PATH>]`);
  }
  const receiptFile = path.resolve(args[3]);
  if (!path.isAbsolute(args[3]) || receiptFile !== args[3]) fail("receipt path must be exact and absolute");
  if (!receiptFile.startsWith(`${RECEIPT_ROOT}${path.sep}`)) fail("receipt must be under the shared-hub receipt root");
  if (!existsSync(receiptFile) || !lstatSync(receiptFile).isFile() || lstatSync(receiptFile).isSymbolicLink()) {
    fail("receipt must be a regular non-symlink file");
  }
  return { mode: WEB_ONLY_MODE, receiptFile };
}

function treeReceipt(root) {
  const files = collectFiles(root).map((relative) => {
    const bytes = readFileSync(path.join(root, relative));
    return { path: relative, bytes: bytes.length, sha256: sha256(bytes) };
  });
  return {
    fileCount: files.length,
    totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
    aggregateSha256: sha256(files.map((file) => `${file.sha256}  ${file.path}\n`).join("")),
  };
}

function git(...args) {
  return execFileSync("/usr/bin/git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

export function validateWebOnlyReceipt(receipt, context) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) fail("receipt root must be an object");
  const gate = receipt.path_decision?.web_only_release;
  if (!gate || typeof gate !== "object" || Array.isArray(gate)) fail("receipt lacks path_decision.web_only_release");
  if (receipt.change_id !== gate.change_id || !/^\d{8}-[a-z0-9][a-z0-9-]*$/.test(receipt.change_id || "")) {
    fail("receipt change id does not match the Web-only release gate");
  }
  if (gate.gate_status !== "prepared") fail("Web-only release gate is not prepared");
  if (gate.disposition !== WEB_ONLY_MODE) fail("Web-only release disposition is invalid");
  if (gate.yuwen_main_sha !== context.sourceSha) fail("receipt YW main SHA does not match the exact source");
  if (gate.artifact?.aggregate_sha256 !== context.artifact.aggregateSha256) {
    fail("receipt artifact aggregate digest does not match");
  }
  if (gate.artifact?.file_count !== context.artifact.fileCount || gate.artifact?.total_bytes !== context.artifact.totalBytes) {
    fail("receipt artifact count or byte total does not match");
  }
  if (gate.app_pointer_sha256 !== context.pointerSha256) fail("receipt App pointer hash does not match");
  if (gate.app_tree_sha256 !== context.appTree.aggregateSha256) fail("receipt App tree hash does not match");
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  if (!existsSync(STABLE_POINTER_FILE)) {
    fail("site/app-content/latest-stable.json is missing");
  }

  const pointerBytesBefore = readFileSync(STABLE_POINTER_FILE);
  const pointerSha256Before = sha256(pointerBytesBefore);
  const appTreeBefore = treeReceipt(OUTPUT_ROOT);
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

    const pointer = JSON.parse(pointerBytesBefore);
    if (pointer.schemaVersion !== "yw-native-content-pointer-v1") fail("stable pointer schema is invalid");
    if (pointer.sourceClean !== true) fail("stable pointer sourceClean is not true");
    if (pointer.appDisposition !== "compatible-and-synced") {
      fail("stable pointer appDisposition is not compatible-and-synced");
    }
    if (options.mode === "compatible-and-synced") {
      if (pointer.semanticDigest !== currentBuild.semanticDigest) {
        fail("stable pointer semanticDigest is stale against the current canonical graph");
      }
      if (pointer.contentVersion !== currentBuild.contentVersion) {
        fail("stable pointer contentVersion is stale against the current canonical graph");
      }
      if (JSON.stringify(canonicalize(pointer.counts)) !== JSON.stringify(canonicalize(currentBuild.counts))) {
        fail("stable pointer counts differ from the current canonical graph");
      }
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
    const expectedCoreCounts = options.mode === WEB_ONLY_MODE ? pointer.counts : currentBuild.counts;
    if (JSON.stringify(canonicalize(core.counts)) !== JSON.stringify(canonicalize(expectedCoreCounts))) {
      fail(options.mode === WEB_ONLY_MODE
        ? "core bundle counts differ from stable pointer"
        : "core bundle counts differ from the current canonical graph");
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

    let output;
    if (options.mode === WEB_ONLY_MODE) {
      const sourceSha = git("rev-parse", "HEAD");
      const originMainSha = git("rev-parse", "origin/main");
      if (sourceSha !== originMainSha) fail("exact source is not the pushed origin/main SHA");
      if (git("status", "--porcelain") !== "") fail("exact source worktree is not clean");
      if (!existsSync(ARTIFACT_ROOT) || !existsSync(ARTIFACT_MANIFEST_FILE)) {
        fail("formal release artifact or manifest is missing");
      }
      const artifact = treeReceipt(ARTIFACT_ROOT);
      const artifactManifest = json(ARTIFACT_MANIFEST_FILE);
      if (
        artifactManifest.aggregateSha256 !== artifact.aggregateSha256
        || artifactManifest.fileCount !== artifact.fileCount
        || artifactManifest.totalBytes !== artifact.totalBytes
      ) {
        fail("formal artifact manifest does not match the release tree");
      }
      validateWebOnlyReceipt(json(options.receiptFile), {
        sourceSha,
        artifact,
        pointerSha256: pointerSha256Before,
        appTree: appTreeBefore,
      });
      const pointerSha256After = sha256(readFileSync(STABLE_POINTER_FILE));
      const appTreeAfter = treeReceipt(OUTPUT_ROOT);
      if (pointerSha256After !== pointerSha256Before || appTreeAfter.aggregateSha256 !== appTreeBefore.aggregateSha256) {
        fail("App pointer or immutable objects changed during the Web-only gate");
      }
      output = {
        artifactAggregateSha256: artifact.aggregateSha256,
        appPointerSha256: pointerSha256After,
        appTreeSha256: appTreeAfter.aggregateSha256,
        objects: manifest.objects.length,
        sourceClean: true,
        appDisposition: WEB_ONLY_MODE,
        status: "web-only-deploy-compatible",
      };
    } else {
      output = {
        contentVersion: pointer.contentVersion,
        semanticDigest: pointer.semanticDigest,
        releaseReceiptId: pointer.releaseReceiptId,
        objects: manifest.objects.length,
        sourceClean: pointer.sourceClean,
        appDisposition: pointer.appDisposition,
        status: "deploy-synced",
      };
    }
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  } finally {
    rmSync(temporaryOutput, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
