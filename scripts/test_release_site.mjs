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

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
import {
  REMOVED_WEB_RESOURCE_URLS,
  isRemovedWebResource,
} from "./web_resource_policy.mjs";

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

function removedResourceUrlsInText(value) {
  return [...String(value || "").matchAll(/https?:\/\/[^\s"'<>]+/gi)]
    .map((match) => match[0].replaceAll("&amp;", "&"))
    .filter(isRemovedWebResource);
}

function privacyTotal(value) {
  return Object.values(privacyIssueCounts(value))
    .reduce((sum, count) => sum + count.raw + count.decoded, 0);
}

function writeBytes(file, bytes) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, bytes);
}

test("lesson portrait decoration has no perpetual motion", () => {
  const css = readFileSync(
    path.join(REPO_ROOT, "site", "assets", "styles.css"),
    "utf8",
  );
  const portraitDecoration = css.match(/\.lesson-portraits::before\s*\{([^}]*)\}/s);
  assert.ok(portraitDecoration, "lesson portrait decoration must remain styled");
  assert.doesNotMatch(portraitDecoration[1], /\banimation(?:-name)?\s*:/i);
  assert.doesNotMatch(css, /@keyframes\s+portrait-orbit\b/i);
});

test("lesson title fitting is idempotent under ResizeObserver callbacks", () => {
  const app = readFileSync(
    path.join(REPO_ROOT, "site", "assets", "app.js"),
    "utf8",
  );
  const start = app.indexOf("function fitLessonTitle(");
  const end = app.indexOf("function renderReaderLoadFailure", start);
  assert.ok(start >= 0 && end > start, "fitLessonTitle implementation must remain discoverable");
  const implementation = app.slice(start, end);
  const unchangedGeometryGuard = implementation.indexOf("signature === lessonTitleFitSignature");
  const resetFontSize = implementation.indexOf('removeProperty("font-size")');
  assert.ok(unchangedGeometryGuard >= 0, "unchanged title geometry must have an idempotency guard");
  assert.ok(
    unchangedGeometryGuard < resetFontSize,
    "the idempotency guard must run before resetting the live title font size",
  );
  assert.match(app, /new ResizeObserver\(\(\) => requestAnimationFrame\(fitLessonTitle\)\)/);
  assert.match(app, /document\.fonts\?\.ready\.then\(\(\) => fitLessonTitle\(\{ force: true \}\)\)/);
});

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
  writeBytes(path.join(sourceRoot, "_redirects"), Buffer.from(
    "/insights      /star   301\n/insights.html /star   301\n",
  ));
  writeBytes(path.join(sourceRoot, "data", "fixture.json"), serialize({
    title: "课文与注释保持不变",
    href: "https://example.com/lesson",
  }));
  writeBytes(path.join(sourceRoot, "data", "class_resources.json"), serialize({
    href: "https://bdfz.yuque.com/legacy-class-index",
  }));
  writeBytes(path.join(sourceRoot, "assets", "app.js"), Buffer.from(
    'const blockedHost = "bdfz.yuque.com";\n',
  ));
  writeBytes(path.join(sourceRoot, "data", "lessons", "lesson-yuque.json"), serialize({
    lessonId: "lesson-yuque",
    resources: [{
      href: "https://bdfz.yuque.com/lesson",
      text: "旧语雀课文",
    }, {
      href: "https://bdfz.yuque.com.evil.example/keep-exact-host-semantics",
      text: "相似但不同的主机",
    },
    ...REMOVED_WEB_RESOURCE_URLS.map((href) => ({ href, text: "已删除资源" })),
    {
      href: "https://baike.baidu.com/item/%E6%97%A0%E9%A2%98",
      text: "保留相邻百科条目",
    }, {
      href: "https://pkuschool.yuque.com/g/qrvbic/books/folder/29416843",
      text: "保留外部条件资源",
    }],
    posts: [{
      post_number: 5,
      cooked: '<p><a href="https://bdfz.yuque.com/lesson">课文标题</a> 保留正文 <a href="https://www.bilibili.com/video/BV1Zg4y1H7fK/">已失效视频</a></p>',
      links: [
        { href: "https://bdfz.yuque.com/lesson", text: "课文标题" },
        { href: "https://www.bilibili.com/video/BV1Zg4y1H7fK/", text: "已失效视频" },
      ],
    }, {
      post_number: 6,
      cooked: '<aside data-onebox-src="https://www.bilibili.com/video/BV1Zg4y1H7fK/"><a href="https://www.bilibili.com/video/BV1Zg4y1H7fK/">已失效视频</a></aside>',
      plain_text: "bilibili.com 已失效视频 视频播放量 100",
      images: [{ src: "https://example.com/stale-thumbnail.png" }],
      links: [{ href: "https://www.bilibili.com/video/BV1Zg4y1H7fK/", text: "已失效视频" }],
    }],
  }));
  const readerDocument = serialize({
    lessonId: "lesson-yuque",
    resources: [{
      href: "https://bdfz.yuque.com/lesson",
      sourceUrl: "https://bdfz.yuque.com/lesson",
    },
    ...REMOVED_WEB_RESOURCE_URLS.map((href) => ({ href, sourceUrl: href })),
    {
      href: "https://baike.baidu.com/item/%E6%97%A0%E9%A2%98",
      sourceUrl: "https://baike.baidu.com/item/%E6%97%A0%E9%A2%98",
    }, {
      href: "https://pkuschool.yuque.com/g/qrvbic/books/folder/29416843",
      sourceUrl: "https://pkuschool.yuque.com/g/qrvbic/books/folder/29416843",
    }],
  });
  writeBytes(
    path.join(sourceRoot, "data", "reader-documents", "lesson-yuque.json"),
    readerDocument,
  );
  writeBytes(path.join(sourceRoot, "data", "reader-documents", "index.json"), serialize({
    schemaVersion: "yw-reader-document-index-v1",
    readerSemanticDigest: `sha256:${"3".repeat(64)}`,
    documents: {
      "lesson-yuque": {
        path: "reader-documents/lesson-yuque.json",
        bytes: Buffer.byteLength(readerDocument),
        sha256: sha256(readerDocument),
      },
    },
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
    assert.equal(
      readFileSync(path.join(releaseRoot, "_redirects"), "utf8"),
      "/insights      /star   301\n/insights.html /star   301\n",
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

test("Web projection removes the exact legacy Yuque host and refreshes reader receipts", () => {
  const fixture = createFixture();
  const releaseRoot = path.join(fixture.root, "formal-web-host-policy");
  try {
    buildReleaseSite({
      sourceRoot: fixture.sourceRoot,
      releaseRoot,
      releaseKind: "formal-stable",
    });
    assert.equal(existsSync(path.join(releaseRoot, "data", "class_resources.json")), false);
    const lesson = readFileSync(
      path.join(releaseRoot, "data", "lessons", "lesson-yuque.json"),
      "utf8",
    );
    assert.doesNotMatch(lesson, /(?<![a-z0-9.-])bdfz\.yuque\.com(?![a-z0-9.-])/i);
    assert.match(lesson, /bdfz\.yuque\.com\.evil\.example/);
    assert.match(lesson, /课文标题/);
    assert.match(lesson, /保留正文/);
    assert.doesNotMatch(lesson, /BV1Zg4y1H7fK|已失效视频|视频播放量|stale-thumbnail/);
    assert.deepEqual(removedResourceUrlsInText(lesson), []);
    assert.match(lesson, /https:\/\/baike\.baidu\.com\/item\/%E6%97%A0%E9%A2%98/);
    assert.match(lesson, /https:\/\/pkuschool\.yuque\.com\/g\/qrvbic\/books\/folder\/29416843/);

    const readerPath = path.join(
      releaseRoot,
      "data",
      "reader-documents",
      "lesson-yuque.json",
    );
    const readerBytes = readFileSync(readerPath);
    assert.doesNotMatch(readerBytes.toString("utf8"), /bdfz\.yuque\.com/i);
    assert.doesNotMatch(readerBytes.toString("utf8"), /BV1Zg4y1H7fK/);
    assert.deepEqual(removedResourceUrlsInText(readerBytes), []);
    const readerIndex = JSON.parse(readFileSync(
      path.join(releaseRoot, "data", "reader-documents", "index.json"),
      "utf8",
    ));
    assert.equal(readerIndex.documents["lesson-yuque"].bytes, readerBytes.length);
    assert.equal(readerIndex.documents["lesson-yuque"].sha256, sha256(readerBytes));
    assert.equal(readerIndex.readerSemanticDigest, `sha256:${"3".repeat(64)}`);
    assert.doesNotMatch(
      readFileSync(path.join(releaseRoot, "assets", "app.js"), "utf8"),
      /bdfz\.yuque\.com/i,
    );
    verifyReleaseStaging({ releaseRoot, releaseKind: "formal-stable" });

    writeBytes(
      path.join(releaseRoot, "index.html"),
      Buffer.from('<a href="https://bdfz.yuque.com/forbidden">forbidden</a>\n'),
    );
    assert.throws(
      () => verifyReleaseStaging({ releaseRoot, releaseKind: "formal-stable" }),
      /forbidden Web host remains/,
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
