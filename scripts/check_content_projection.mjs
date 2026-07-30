#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const residue = /\[\/?color(?:=[^\]]+)?\]|\[\d+:\d+\]/i;

const files = [
  path.join(ROOT, "site", "data", "manifest.json"),
  path.join(ROOT, "site", "data", "literary-taxonomy.json"),
  path.join(ROOT, "site", "data", "learning-manifest.json"),
  ...readdirSync(path.join(ROOT, "site", "data", "lessons"))
    .filter((name) => name.endsWith(".json"))
    .map((name) => path.join(ROOT, "site", "data", "lessons", name)),
  ...readdirSync(path.join(ROOT, "site", "data", "reader-documents"))
    .filter((name) => name.startsWith("lesson-") && name.endsWith(".json"))
    .map((name) => path.join(ROOT, "site", "data", "reader-documents", name)),
];

const failures = [];
for (const file of files) {
  const content = readFileSync(file, "utf8");
  const match = content.match(residue);
  if (match) {
    failures.push(`${path.relative(ROOT, file)}: ${match[0]}`);
  }
}

const appSource = readFileSync(path.join(ROOT, "site", "assets", "app.js"), "utf8");
assert(!/\.inline-note|note-popover/.test(appSource), "legacy inline-note renderer must stay removed");
assert.equal(failures.length, 0, `user-facing projection residue:\n${failures.slice(0, 20).join("\n")}`);

console.log(`content projection ok: ${files.length} JSON files`);
