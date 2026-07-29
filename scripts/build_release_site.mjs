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
import {
  createUrlSanitizer,
  privacyIssueCounts,
} from "./native_content_url_sanitizer.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const SOURCE_ROOT = path.join(ROOT, "site");
const RELEASE_ROOT = path.join(ROOT, ".release", "site");
const MAX_FILES = 20_000;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const EXCLUDED_PREFIXES = [
  "app-content/candidates/",
  "data/cache/",
];
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
const mode = process.argv.includes("--check-source")
  ? "check-source"
  : process.argv.includes("--check-staging")
    ? "check-staging"
    : "build";

function fail(message) {
  throw new Error(message);
}

function collectFiles(root, prefix = "") {
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

function excluded(relative) {
  const normalized = `${relative.replaceAll("\\", "/")}${relative.endsWith("/") ? "" : ""}`;
  return EXCLUDED_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function privacyTotal(counts) {
  return Object.values(counts).reduce((sum, count) => sum + count.raw + count.decoded, 0);
}

function sanitizeJsonProjection(relative, text, sanitizer) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    fail(`invalid JSON release input ${relative}: ${error.message}`);
  }
  const sanitizedValue = sanitizer.sanitizeValue(parsed);
  const indentation = text.includes("\n") ? 2 : undefined;
  const trailingNewline = text.endsWith("\n") ? "\n" : "";
  return `${JSON.stringify(sanitizedValue, null, indentation)}${trailingNewline}`;
}

function projectSource() {
  const sanitizer = createUrlSanitizer();
  const projected = [];
  let changedFiles = 0;
  for (const relative of collectFiles(SOURCE_ROOT)) {
    if (excluded(relative)) continue;
    const source = readFileSync(path.join(SOURCE_ROOT, relative));
    let output = source;
    if (TEXT_EXTENSIONS.has(path.extname(relative).toLowerCase())) {
      const text = source.toString("utf8");
      const extension = path.extname(relative).toLowerCase();
      const projectedText = extension === ".json"
        ? sanitizeJsonProjection(relative, text, sanitizer)
        : text;
      const issues = privacyIssueCounts(projectedText);
      if (privacyTotal(issues) > 0) {
        fail(
          extension === ".json"
            ? `privacy sanitizer left forbidden URL material in ${relative}`
            : `forbidden URL material in non-JSON release input ${relative}; fix the source explicitly`,
        );
      }
      output = Buffer.from(projectedText);
      if (!output.equals(source)) changedFiles += 1;
    }
    if (output.length >= MAX_FILE_BYTES) {
      fail(`${relative} is ${output.length} bytes; each Pages file must be under 25 MiB`);
    }
    projected.push({
      path: relative,
      bytes: output,
      sha256: createHash("sha256").update(output).digest("hex"),
    });
  }
  if (projected.length + 1 >= MAX_FILES) {
    fail(`release projection has ${projected.length + 1} files; must stay below ${MAX_FILES}`);
  }
  return { changedFiles, projected, redactions: sanitizer.redactions };
}

function markerFor(projected, changedFiles) {
  const aggregateSha256 = createHash("sha256")
    .update(projected.map((file) => `${file.sha256}  ${file.path}\n`).join(""))
    .digest("hex");
  return {
    schemaVersion: "yw-release-site-v1",
    sourceRoot: "site/",
    excludedPrefixes: EXCLUDED_PREFIXES,
    sanitizedFiles: changedFiles,
    projectedFiles: projected.length,
    projectedAggregateSha256: aggregateSha256,
  };
}

function verifyStaging() {
  if (!existsSync(RELEASE_ROOT)) fail(".release/site is missing; run npm run build:release-site");
  const markerFile = path.join(RELEASE_ROOT, ".bdfz-release-artifact.json");
  if (!existsSync(markerFile)) fail("release artifact marker is missing");
  const marker = JSON.parse(readFileSync(markerFile, "utf8"));
  if (marker.schemaVersion !== "yw-release-site-v1") fail("release artifact marker schema is invalid");
  for (const prefix of EXCLUDED_PREFIXES) {
    if (existsSync(path.join(RELEASE_ROOT, prefix))) {
      fail(`excluded release path exists: ${prefix}`);
    }
  }
  const files = collectFiles(RELEASE_ROOT);
  if (files.length >= MAX_FILES) fail(`release artifact has ${files.length} files`);
  for (const relative of files) {
    const bytes = readFileSync(path.join(RELEASE_ROOT, relative));
    if (bytes.length >= MAX_FILE_BYTES) {
      fail(`${relative} is ${bytes.length} bytes; each Pages file must be under 25 MiB`);
    }
    if (TEXT_EXTENSIONS.has(path.extname(relative).toLowerCase())) {
      const issues = privacyIssueCounts(bytes.toString("utf8"));
      if (privacyTotal(issues) > 0) fail(`release artifact privacy check failed: ${relative}`);
    }
  }
  process.stdout.write(`${JSON.stringify({
    mode,
    releaseRoot: path.relative(ROOT, RELEASE_ROOT),
    files: files.length,
    marker,
  }, null, 2)}\n`);
}

if (mode === "check-staging") {
  verifyStaging();
  process.exit(0);
}

const { changedFiles, projected, redactions } = projectSource();
const marker = markerFor(projected, changedFiles);
if (mode === "check-source") {
  process.stdout.write(`${JSON.stringify({
    mode,
    sourceFiles: collectFiles(SOURCE_ROOT).length,
    projectedFiles: projected.length + 1,
    changedFiles,
    excludedPrefixes: EXCLUDED_PREFIXES,
    redactions,
    marker,
  }, null, 2)}\n`);
  process.exit(0);
}

const stablePointer = path.join(SOURCE_ROOT, "app-content", "latest-stable.json");
if (!existsSync(stablePointer)) {
  fail("site/app-content/latest-stable.json is missing; formal staging requires stable promotion");
}
const pendingRoot = path.join(ROOT, ".release", `site.pending-${process.pid}`);
rmSync(pendingRoot, { recursive: true, force: true });
mkdirSync(pendingRoot, { recursive: true });
for (const file of projected) {
  const output = path.join(pendingRoot, file.path);
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, file.bytes);
}
writeFileSync(
  path.join(pendingRoot, ".bdfz-release-artifact.json"),
  `${JSON.stringify(marker, null, 2)}\n`,
);
rmSync(RELEASE_ROOT, { recursive: true, force: true });
renameSync(pendingRoot, RELEASE_ROOT);
verifyStaging();
