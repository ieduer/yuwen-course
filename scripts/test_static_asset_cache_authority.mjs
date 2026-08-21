#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const INDEX_FILE = resolve(ROOT, "site/index.html");
const EXPECTED_LOCAL_ASSETS = [
  "assets/styles.css",
  "assets/learning-evidence.js",
  "assets/vocab-progress.js",
  "assets/classical-first-read.js",
  "assets/app.js",
];

function contentVersion(relativePath) {
  return createHash("sha256")
    .update(readFileSync(resolve(ROOT, "site", relativePath)))
    .digest("hex")
    .slice(0, 16);
}

test("every immutable local entry asset uses its current content hash", () => {
  const html = readFileSync(INDEX_FILE, "utf8");
  const versions = new Map([...html.matchAll(
    /(?:href|src)="(assets\/(?:styles\.css|learning-evidence\.js|vocab-progress\.js|classical-first-read\.js|app\.js))\?v=([a-f0-9]{16})"/g,
  )].map((match) => [match[1], match[2]]));

  assert.deepEqual([...versions.keys()], EXPECTED_LOCAL_ASSETS);
  for (const relativePath of EXPECTED_LOCAL_ASSETS) {
    assert.equal(
      versions.get(relativePath),
      contentVersion(relativePath),
      `${relativePath} cache authority must change with its bytes`,
    );
  }
});
