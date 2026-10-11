#!/usr/bin/env node
// Release proof for phase 1 of the textbook page-image migration (2026-10):
// the change is leaf-only.  Every input of a resource version, scoring
// contract, learning record, Worker, schema and the App content is
// byte-identical to the accepted production source it is built on.
//
// Run for that release only (node --test on this file); it
// is deliberately not part of the standing gate, because later content
// releases change these files on purpose.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const ROOT = resolve(import.meta.dirname, "..");
// The accepted production source this change is built on.
const BASE = "7bfe60c5b5c5eb1d9a02a1a278292c3356ff2310";

// Everything that feeds a resource version, a scoring contract, a learning
// record, the Worker, the schema or the App content.
const FROZEN_PATHS = [
  "site/data/lessons",
  "site/data/manifest.json",
  "site/data/learning-manifest.json",
  "site/data/lesson-competency-manifest.json",
  "site/data/interaction-definitions.json",
  "site/data/study-guide-catalog.json",
  "site/data/literary-taxonomy.json",
  "site/data/lesson-media.json",
  "site/data/vocab",
  "site/data/vocab-eligibility.json",
  "site/data/vocab-question-dispositions.json",
  "site/data/classical-first-read",
  "site/data/classical-learning-tips.json",
  "site/data/reader-documents",
  "site/data/reader-media-receipts.v1.json",
  "site/app-content",
  "site/_worker.js",
  "site/learning-evidence-source.js",
  "site/learning-recorder-source.js",
  "site/learning-evaluation-events.js",
  "site/classical-first-read-source.js",
  "site/reading-identity-source.js",
  "site/study-guide-assessment.js",
  "site/durable-evaluation-jobs.js",
  "site/evaluation-machine.js",
  "site/evaluation-scheduler.js",
  "site/evaluator-recovery.js",
  "site/lesson-blueprint-rules.js",
  "site/assets/learning-evidence.js",
  "site/assets/learning-recorder-bridge.js",
  "site/assets/pending-evaluation-recovery.js",
  "site/assets/vocab-progress.js",
  "site/assets/classical-first-read.js",
  "site/assets/yw-shared-state.js",
  "site/assets/star.js",
  "site/star.html",
  "migrations",
  "wrangler.toml",
  "wrangler.evaluation.toml",
  "package.json",
  "package-lock.json",
  "scripts/build_learning_manifest.mjs",
  "scripts/build_native_content.mjs",
  "scripts/build_site_data.py",
];
function git(...args) {
  return execFileSync("/usr/bin/git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

test("scoring, evidence, Worker, schema and App content are byte-identical to the accepted source", () => {
  assert.equal(git("cat-file", "-t", BASE).trim(), "commit", "accepted base commit must be present");
  for (const relative of FROZEN_PATHS) assert.ok(existsSync(resolve(ROOT, relative)), `${relative} is missing`);
  assert.equal(git("diff", "--name-only", BASE, "--", ...FROZEN_PATHS), "", "a frozen path differs from the accepted source");
  assert.equal(git("status", "--porcelain", "--untracked-files=all", "--", ...FROZEN_PATHS), "", "a frozen path has uncommitted or new files");
  const baseTree = git("ls-tree", "-r", BASE, "--", "site/data/lessons", "site/app-content").trim().split("\n");
  const headTree = git("ls-tree", "-r", "HEAD", "--", "site/data/lessons", "site/app-content").trim().split("\n");
  assert.deepEqual(headTree, baseTree);
  assert.equal(baseTree.filter((line) => line.includes("\tsite/data/lessons/")).length, 204);
});
