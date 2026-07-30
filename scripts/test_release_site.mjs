#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import {
  buildReleaseSite,
  verifyReleaseStaging,
} from "./build_release_site.mjs";
import { privacyIssueCounts } from "./native_content_url_sanitizer.mjs";

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

function privacyTotal(value) {
  return Object.values(privacyIssueCounts(value))
    .reduce((sum, count) => sum + count.raw + count.decoded, 0);
}

function writeBytes(file, bytes) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, bytes);
}

function collectFiles(root, prefix = "") {
  if (!existsSync(path.join(root, prefix))) return [];
  const files = [];
  for (const entry of readdirSync(path.join(root, prefix), { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...collectFiles(root, relative));
    else if (entry.isFile()) files.push(relative);
  }
  return files.sort((left, right) => left.localeCompare(right, "en"));
}

function writeImmutableRelease(appContentRoot, {
  contentVersion,
  corePayload,
  sourceRevision,
}) {
  const semanticDigest = `sha256:${sha256(serialize(corePayload))}`;
  const coreBytes = Buffer.from(serialize({
    schemaVersion: "yw-release-test-core-v1",
    contentVersion,
    semanticDigest,
    payload: corePayload,
  }));
  const objectReceipt = {
    id: "core",
    kind: "core",
    path: "core-bundle.json",
    mediaType: "application/json",
    bytes: coreBytes.length,
    sha256: sha256(coreBytes),
  };
  const releaseGate = {
    sourceRevision,
    sourceClean: true,
    deploymentId: "00000000-0000-4000-8000-000000000001",
    publishedAt: "2026-07-30T00:00:00.000Z",
    appDisposition: "compatible-and-synced",
  };
  const releaseReceiptInput = serialize({
    schemaVersion: "yw-native-release-receipt-v1",
    semanticDigest,
    releaseGate,
    objects: [objectReceipt],
  });
  const releaseReceiptId = `sha256-${sha256(releaseReceiptInput)}`;
  const releasePrefix = `releases/${contentVersion}/${releaseReceiptId}/`;
  const object = {
    ...objectReceipt,
    href: `https://yw.bdfz.net/app-content/${releasePrefix}${objectReceipt.path}`,
  };
  const manifest = {
    schemaVersion: "yw-native-content-manifest-v1",
    contentVersion,
    semanticDigest,
    releaseReceiptId,
    ...releaseGate,
    counts: {
      lessons: 1,
      objects: 1,
    },
    objects: [object],
  };
  const manifestBytes = Buffer.from(serialize(manifest));
  writeBytes(path.join(appContentRoot, releasePrefix, "core-bundle.json"), coreBytes);
  writeBytes(path.join(appContentRoot, releasePrefix, "manifest.json"), manifestBytes);
  return {
    pointer: {
      schemaVersion: "yw-native-content-pointer-v1",
      contentVersion,
      semanticDigest,
      releaseReceiptId,
      ...releaseGate,
      counts: {
        lessons: 1,
      },
      manifest: {
        path: `${releasePrefix}manifest.json`,
        href: `https://yw.bdfz.net/app-content/${releasePrefix}manifest.json`,
        mediaType: "application/json",
        bytes: manifestBytes.length,
        sha256: sha256(manifestBytes),
      },
      coreBundle: {
        path: `${releasePrefix}core-bundle.json`,
        href: `https://yw.bdfz.net/app-content/${releasePrefix}core-bundle.json`,
        mediaType: "application/json",
        bytes: coreBytes.length,
        sha256: sha256(coreBytes),
      },
    },
    releasePrefix: `app-content/${releasePrefix}`,
  };
}

function createFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "yw-release-site-test-"));
  const sourceRoot = path.join(root, "site");
  const appContentRoot = path.join(sourceRoot, "app-content");
  mkdirSync(appContentRoot, { recursive: true });
  writeBytes(path.join(sourceRoot, "index.html"), Buffer.from("<!doctype html><title>YW preview</title>\n"));
  writeBytes(path.join(sourceRoot, "data", "fixture.json"), serialize({
    title: "课文与注释保持不变",
    href: "https://example.com/lesson",
  }));
  const clean = writeImmutableRelease(appContentRoot, {
    contentVersion: "yw-111111111111111111111111",
    corePayload: {
      lessonId: "lesson-clean",
      body: "课文正文",
      annotations: ["注释一", "注释二"],
    },
    sourceRevision: "1111111111111111111111111111111111111111",
  });
  const escapedSensitiveString = [
    "课文正文 ",
    'https://aistudio.google.com/app/prompts"ids":[],"userId":"fixture-user",',
    '"resourceKeys":{"fixture":"fixture-resource"}}',
  ].join("");
  const historical = writeImmutableRelease(appContentRoot, {
    contentVersion: "yw-222222222222222222222222",
    corePayload: {
      lessonId: "lesson-1579",
      body: escapedSensitiveString,
      annotations: ["注释保持"],
    },
    sourceRevision: "2222222222222222222222222222222222222222",
  });
  writeBytes(
    path.join(appContentRoot, "latest-stable.json"),
    serialize(clean.pointer),
  );
  writeBytes(
    path.join(appContentRoot, "candidates", clean.pointer.contentVersion, `${clean.pointer.releaseReceiptId}.json`),
    serialize(clean.pointer),
  );
  return {
    appContentRoot,
    clean,
    escapedSensitiveString,
    historical,
    root,
    sourceRoot,
  };
}

test("formal staging contains only the exact stable pointer and receipted release", () => {
  const fixture = createFixture();
  const releaseRoot = path.join(fixture.root, "formal");
  try {
    const result = buildReleaseSite({
      sourceRoot: fixture.sourceRoot,
      releaseRoot,
      releaseKind: "formal-stable",
    });
    assert.equal(result.marker.releaseKind, "formal-stable");
    assert.equal(result.marker.nativeContent.policy, "single-stable-release");
    assert.equal(
      result.marker.nativeContent.includedPrefix,
      fixture.clean.releasePrefix,
    );
    assert.ok(
      result.marker.nativeContent.excludedHistoricalReleasePrefixes
        .includes(fixture.historical.releasePrefix),
    );
    const stagedFiles = collectFiles(releaseRoot);
    assert.equal(
      stagedFiles.some((relative) => relative.startsWith(fixture.historical.releasePrefix)),
      false,
    );
    assert.equal(
      stagedFiles.some((relative) => relative.startsWith("app-content/candidates/")),
      false,
    );
    assert.deepEqual(
      stagedFiles
        .filter((relative) => relative.startsWith("app-content/"))
        .sort(),
      result.marker.nativeContent.includedPaths,
    );
    assert.equal(
      readFileSync(path.join(releaseRoot, "app-content", "latest-stable.json"), "utf8"),
      readFileSync(path.join(fixture.appContentRoot, "latest-stable.json"), "utf8"),
    );
    verifyReleaseStaging({ releaseRoot, releaseKind: "formal-stable" });
    const markerFile = path.join(releaseRoot, ".bdfz-release-artifact.json");
    const tamperedMarker = JSON.parse(readFileSync(markerFile, "utf8"));
    tamperedMarker.nativeContent.excludedHistoricalReleasePrefixes.push(
      fixture.clean.releasePrefix,
    );
    writeBytes(markerFile, serialize(tamperedMarker));
    assert.throws(
      () => verifyReleaseStaging({ releaseRoot, releaseKind: "formal-stable" }),
      /historical native release exists in staging/,
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("parsed JSON privacy gate catches escaped payloads and never rewrites immutable bytes", () => {
  const fixture = createFixture();
  const releaseRoot = path.join(fixture.root, "formal-sensitive");
  try {
    const serializedEscaped = JSON.stringify({ body: fixture.escapedSensitiveString });
    assert.match(serializedEscaped, /\\"userId\\"/);
    assert.match(serializedEscaped, /\\"resourceKeys\\"/);
    assert.ok(
      privacyTotal(JSON.parse(serializedEscaped).body) > 0,
      "parsed string must expose the sensitive payload",
    );
    const escapedSensitiveKey = [
      "https://aistudio.google.com/app/prompts",
      '?state={"userId":"fixture-key","resourceKeys":{}}',
    ].join("");
    const escapedKeyFile = path.join(
      fixture.sourceRoot,
      "data",
      "escaped-key.json",
    );
    writeBytes(escapedKeyFile, serialize({ [escapedSensitiveKey]: "safe value" }));
    assert.match(readFileSync(escapedKeyFile, "utf8"), /\\"userId\\"/);
    assert.throws(
      () => buildReleaseSite({
        sourceRoot: fixture.sourceRoot,
        releaseRoot: path.join(fixture.root, "preview-sensitive-key"),
        releaseKind: "preview-web-only",
      }),
      (error) => {
        assert.match(error.message, /JSON privacy gate failed.*<key>/);
        assert.doesNotMatch(error.message, /fixture-key|resourceKeys|aistudio/);
        return true;
      },
    );
    rmSync(escapedKeyFile);
    writeBytes(
      path.join(fixture.appContentRoot, "latest-stable.json"),
      serialize(fixture.historical.pointer),
    );
    assert.throws(
      () => buildReleaseSite({
        sourceRoot: fixture.sourceRoot,
        releaseRoot,
        releaseKind: "formal-stable",
      }),
      /JSON privacy gate failed|immutable native JSON requires privacy sanitization/,
    );
    assert.equal(existsSync(releaseRoot), false);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("formal staging fails closed on immutable object receipt drift", () => {
  const fixture = createFixture();
  const releaseRoot = path.join(fixture.root, "formal-tampered");
  try {
    const coreFile = path.join(
      fixture.appContentRoot,
      fixture.clean.pointer.coreBundle.path,
    );
    writeBytes(coreFile, Buffer.concat([readFileSync(coreFile), Buffer.from(" ")]));
    assert.throws(
      () => buildReleaseSite({
        sourceRoot: fixture.sourceRoot,
        releaseRoot,
        releaseKind: "formal-stable",
      }),
      /byte receipt does not match/,
    );
    assert.equal(existsSync(releaseRoot), false);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("Web preview staging excludes the complete app-content tree", () => {
  const fixture = createFixture();
  const releaseRoot = path.join(fixture.root, "preview");
  try {
    const result = buildReleaseSite({
      sourceRoot: fixture.sourceRoot,
      releaseRoot,
      releaseKind: "preview-web-only",
    });
    assert.equal(result.marker.releaseKind, "preview-web-only");
    assert.equal(result.marker.nativeContent.policy, "excluded");
    assert.equal(result.marker.nativeContent.includedPathCount, 0);
    assert.ok(result.marker.nativeContent.sourceNativePathsExcluded > 0);
    assert.equal(existsSync(path.join(releaseRoot, "app-content")), false);
    verifyReleaseStaging({ releaseRoot, releaseKind: "preview-web-only" });
    assert.throws(
      () => verifyReleaseStaging({ releaseRoot, releaseKind: "formal-stable" }),
      /expected formal-stable/,
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
