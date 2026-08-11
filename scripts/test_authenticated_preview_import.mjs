import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import {
  AUTHORIZED_SOURCE_BATCHES,
  importAuthenticatedPreviewScreenshots,
} from "./import_authenticated_preview_screenshots.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const canonicalManifest = JSON.parse(readFileSync(resolve(ROOT, "site/data/preview-screenshots.json"), "utf8"));
const canonicalRegistry = JSON.parse(readFileSync(resolve(ROOT, "site/data/preview-targets.json"), "utf8"));
const sampleEntry = canonicalManifest.entries.find((entry) => entry.width === 1024 && entry.height === 640 && entry.bytes <= 250_000);
const sampleBytes = readFileSync(resolve(ROOT, `site${sampleEntry.screenshotUrl}`));
const sampleSha = createHash("sha256").update(sampleBytes).digest("hex");
const sampleFile = `${sampleSha.slice(0, 24)}.webp`;
const orphanSampleEntry = canonicalManifest.entries.find((entry) => entry.sha256 !== sampleSha);
const orphanSampleBytes = readFileSync(resolve(ROOT, `site${orphanSampleEntry.screenshotUrl}`));
const orphanSampleFile = orphanSampleEntry.screenshotUrl.split("/").pop();

function isAuthorizedHost(sourceUrl) {
  return Object.hasOwn(AUTHORIZED_SOURCE_BATCHES, new URL(sourceUrl).hostname);
}

function authorizedRecord(entry) {
  return isAuthorizedHost(entry.sourceUrl) && (
    entry.auditCategory === "requires-suen-or-external-account"
    || entry.recoveryMethod === "reviewed-authenticated-page"
  );
}

function retainedExternalRecord(entry) {
  if (entry.resolutionGroup !== "external-condition-required" || isAuthorizedHost(entry.sourceUrl)) return false;
  return new URL(entry.sourceUrl).hostname !== "baike.baidu.com";
}

function deletedRecord(entry) {
  return entry.auditCategory === "permanent-dead-or-remove"
    || (entry.resolutionGroup === "external-condition-required" && new URL(entry.sourceUrl).hostname === "baike.baidu.com");
}

function asBlockedFixtureRecord(entry) {
  if (entry.auditCategory === "requires-suen-or-external-account") return entry;
  const {
    bytes: _bytes,
    captureUrl: _captureUrl,
    height: _height,
    recoveryMethod: _recoveryMethod,
    screenshotUrl: _screenshotUrl,
    sha256: _sha256,
    width: _width,
    ...rest
  } = entry;
  return {
    ...rest,
    disposition: "not-embedded",
    auditCategory: "requires-suen-or-external-account",
    resolutionGroup: "external-condition-required",
  };
}

function buildFixture(t) {
  const directory = mkdtempSync(resolve(tmpdir(), "yw-auth-preview-import-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const manifestPath = resolve(directory, "preview-screenshots.json");
  const registryPath = resolve(directory, "preview-targets.json");
  const outputDir = resolve(directory, "output");
  const stagedAssetsPath = resolve(directory, "staged");
  mkdirSync(outputDir);
  mkdirSync(stagedAssetsPath);

  const allBlocked = [
    ...[...canonicalManifest.blocked, ...canonicalManifest.entries]
      .filter(authorizedRecord)
      .map(asBlockedFixtureRecord),
    ...canonicalManifest.blocked.filter((entry) => retainedExternalRecord(entry) || deletedRecord(entry)),
  ];
  const deletedSource = allBlocked.find(deletedRecord) || {
    sourceUrl: "https://deleted.invalid/retired-preview-target",
    title: "Retired preview fixture",
    reason: "source-removed-from-registry",
    attribution: [{ surface: "test-fixture" }],
    auditCategory: "permanent-dead-or-remove",
    resolutionGroup: "remove-from-embed",
  };
  const blocked = allBlocked.filter((entry) => entry.sourceUrl !== deletedSource?.sourceUrl);
  const deletedEntry = {
    sourceUrl: deletedSource.sourceUrl,
    screenshotUrl: `/assets/preview-screenshots/${orphanSampleFile}`,
    title: "Deleted fixture target",
    width: 1024,
    height: 640,
    bytes: orphanSampleBytes.length,
    sha256: createHash("sha256").update(orphanSampleBytes).digest("hex"),
    reason: deletedSource.reason,
    attribution: deletedSource.attribution,
    disposition: "screenshot-provided",
  };
  const registeredSources = blocked.filter((entry) => !deletedRecord(entry)).map((entry) => entry.sourceUrl).sort();
  const manifest = {
    schemaVersion: "yw-preview-screenshots-v1",
    capturedAt: canonicalManifest.capturedAt,
    viewport: { width: 1024, height: 640 },
    totalBytes: deletedEntry.bytes,
    candidateCount: blocked.length + 1,
    screenshotCount: 1,
    blockedCount: blocked.length,
    entries: [deletedEntry],
    resolved: [],
    blocked,
    resolvedCount: 0,
  };
  const registry = {
    ...canonicalRegistry,
    targetCount: registeredSources.length,
    targets: registeredSources,
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
  writeFileSync(resolve(stagedAssetsPath, sampleFile), sampleBytes);
  writeFileSync(resolve(outputDir, orphanSampleFile), orphanSampleBytes);
  return { directory, manifestPath, registryPath, outputDir, stagedAssetsPath };
}

function buildReceipt(host, overrides = {}) {
  const sources = [...canonicalManifest.blocked, ...canonicalManifest.entries]
    .filter((entry) => authorizedRecord(entry) && new URL(entry.sourceUrl).hostname === host)
    .map((entry) => entry.sourceUrl)
    .sort();
  const receipt = {
    schemaVersion: "yw-authenticated-preview-receipt-v1",
    sourceHost: host,
    reviewStatus: "reviewed-authenticated-page",
    viewport: { width: 1024, height: 640 },
    captures: sources.map((sourceUrl, index) => ({
      sourceUrl,
      captureUrl: sourceUrl,
      title: `Reviewed ${host} page ${String(index + 1).padStart(2, "0")}`,
      width: 1024,
      height: 640,
      bytes: sampleBytes.length,
      sha256: sampleSha,
      screenshotFile: sampleFile,
    })),
  };
  return { ...receipt, ...overrides };
}

function writeReceipt(directory, receipt) {
  const path = resolve(directory, "receipt.json");
  const bytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
  writeFileSync(path, bytes);
  return { path, sha256: createHash("sha256").update(bytes).digest("hex") };
}

function importFixture(fixture, receiptFile) {
  return importAuthenticatedPreviewScreenshots({
    receiptPath: receiptFile.path,
    stagedAssetsPath: fixture.stagedAssetsPath,
    expectedReceiptSha256: receiptFile.sha256,
    manifestPath: fixture.manifestPath,
    registryPath: fixture.registryPath,
    outputDir: fixture.outputDir,
  });
}

for (const [host, authority] of Object.entries(AUTHORIZED_SOURCE_BATCHES)) {
  test(`imports the exact ${host} batch and preserves canonical attribution`, (t) => {
    const fixture = buildFixture(t);
    const before = JSON.parse(readFileSync(fixture.manifestPath, "utf8"));
    const receiptFile = writeReceipt(fixture.directory, buildReceipt(host));
    const result = importFixture(fixture, receiptFile);
    const afterBytes = readFileSync(fixture.manifestPath);
    const after = JSON.parse(afterBytes);

    assert.equal(result.sourceHost, host);
    assert.equal(result.importedCount, authority.count);
    assert.equal(after.entries.length, authority.count);
    assert.equal(after.entries.every((entry) => entry.recoveryMethod === "reviewed-authenticated-page"), true);
    assert.equal(after.entries.every((entry) => entry.screenshotUrl === `/assets/preview-screenshots/${sampleFile}`), true);
    assert.equal(after.entries.every((entry) => entry.captureUrl.startsWith(`https://${host}/`)), true);
    assert.equal(after.totalBytes, authority.count * sampleBytes.length);
    assert.equal(after.screenshotCount, after.entries.length);
    assert.equal(after.blockedCount, after.blocked.length);
    assert.equal(after.candidateCount, after.entries.length + after.blocked.length + after.resolved.length);
    assert.equal(after.blocked.filter(retainedExternalRecord).length, 6);
    assert.equal(after.blocked.some(deletedRecord), false);
    assert.deepEqual(readdirSync(fixture.outputDir), [sampleFile]);

    for (const entry of after.entries) {
      const original = before.blocked.find((candidate) => candidate.sourceUrl === entry.sourceUrl);
      assert.deepEqual(entry.attribution, original.attribution);
    }

    const firstOutput = Buffer.from(afterBytes);
    const replay = importFixture(fixture, receiptFile);
    assert.equal(replay.manifestSha256, result.manifestSha256);
    assert.deepEqual(readFileSync(fixture.manifestPath), firstOutput);
    assert.deepEqual(readdirSync(fixture.outputDir), [sampleFile]);
  });
}

test("rejects a partial or mixed host receipt before mutation", (t) => {
  const fixture = buildFixture(t);
  const original = readFileSync(fixture.manifestPath);
  const partial = buildReceipt("ctext.org");
  partial.captures.pop();
  const partialFile = writeReceipt(fixture.directory, partial);
  assert.throws(() => importFixture(fixture, partialFile), /exact 22-source ctext\.org batch/);
  assert.deepEqual(readFileSync(fixture.manifestPath), original);

  const mixed = buildReceipt("ctext.org");
  mixed.captures[0] = buildReceipt("forum.rdfzer.com").captures[0];
  const mixedFile = writeReceipt(fixture.directory, mixed);
  assert.throws(() => importFixture(fixture, mixedFile), /not in the canonical ctext\.org batch/);
  assert.deepEqual(readFileSync(fixture.manifestPath), original);
});

test("rejects receipt tampering, private fields, and private capture URLs", (t) => {
  const fixture = buildFixture(t);
  const original = readFileSync(fixture.manifestPath);
  const receipt = buildReceipt("ctext.org");
  const receiptFile = writeReceipt(fixture.directory, receipt);
  writeFileSync(receiptFile.path, `${readFileSync(receiptFile.path, "utf8")} `);
  assert.throws(() => importFixture(fixture, receiptFile), /receipt SHA-256 does not match/);

  const privateField = { ...buildReceipt("ctext.org"), accountEmail: "redaction-failure@example.invalid" };
  const privateFieldFile = writeReceipt(fixture.directory, privateField);
  assert.throws(() => importFixture(fixture, privateFieldFile), /forbidden fields: accountEmail/);

  const privateUrl = buildReceipt("ctext.org");
  privateUrl.captures[0].captureUrl = `${privateUrl.captures[0].sourceUrl}&session=redaction-failure`;
  const privateUrlFile = writeReceipt(fixture.directory, privateUrl);
  assert.throws(() => importFixture(fixture, privateUrlFile), /private query key/);
  assert.deepEqual(readFileSync(fixture.manifestPath), original);
});

test("rejects missing, extra, or tampered staged assets before mutation", (t) => {
  const fixture = buildFixture(t);
  const original = readFileSync(fixture.manifestPath);
  const receiptFile = writeReceipt(fixture.directory, buildReceipt("forum.rdfzer.com"));

  writeFileSync(resolve(fixture.stagedAssetsPath, "extra.webp"), sampleBytes);
  assert.throws(() => importFixture(fixture, receiptFile), /missing files or contain extra files/);
  unlinkSync(resolve(fixture.stagedAssetsPath, "extra.webp"));

  writeFileSync(resolve(fixture.stagedAssetsPath, sampleFile), Buffer.concat([sampleBytes, Buffer.from([0])]));
  assert.throws(() => importFixture(fixture, receiptFile), /byte count does not match/);
  unlinkSync(resolve(fixture.stagedAssetsPath, sampleFile));
  assert.throws(() => importFixture(fixture, receiptFile), /missing files or contain extra files/);
  assert.deepEqual(readFileSync(fixture.manifestPath), original);
  assert.deepEqual(readdirSync(fixture.outputDir), [orphanSampleFile]);
});
