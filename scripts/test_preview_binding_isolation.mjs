import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const config = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
const precheckConfig = readFileSync(new URL("../wrangler.precheck.toml", import.meta.url), "utf8");
const workerSource = readFileSync(new URL("../site/_worker.js", import.meta.url), "utf8");
const productionMarker = "[[env.production.d1_databases]]";
const markerIndex = config.indexOf(productionMarker);

test("the primary Pages project keeps every preview isolated from UC and Queue capabilities", () => {
  assert.notEqual(markerIndex, -1, "production bindings must be explicit");

  const preview = config.slice(0, markerIndex);
  assert.match(preview, /database_name = "yuwen-reading-db-preview"/);
  assert.match(preview, /database_id = "39ed36d9-b3f3-40fd-933a-9a68a4066302"/);
  assert.equal((preview.match(/^\[\[d1_databases\]\]$/gm) || []).length, 1);
  assert.doesNotMatch(config, /^\[\[env\.preview\./m);
  assert.doesNotMatch(preview, /^\[\[services\]\]/m);
  assert.doesNotMatch(preview, /USER_CENTER_EVIDENCE/);
  assert.doesNotMatch(preview, /YuwenEvidenceIdentity/);
  assert.doesNotMatch(preview, /^\[\[queues\.producers\]\]/m);
  assert.doesNotMatch(preview, /^\[\[env\.preview\.queues\.producers\]\]/m);
  assert.doesNotMatch(preview, /99c541e7-e70b-4584-b939-7e88a6dd68c5/);
  assert.doesNotMatch(preview, /bdfz-learning-evidence-yw-v[12]/);
});

test("the dedicated precheck project has exact preview D1 and UC RPC bindings but no Queue", () => {
  assert.match(precheckConfig, /^name = "yuwen-course-foundation-precheck"$/m);
  assert.match(precheckConfig, /^compatibility_date = "2026-05-12"$/m);
  assert.match(precheckConfig, /^pages_build_output_dir = "site"$/m);
  assert.equal((precheckConfig.match(/^\[\[env\.preview\.d1_databases\]\]$/gm) || []).length, 1);
  assert.match(precheckConfig, /\[\[env\.preview\.d1_databases\]\][\s\S]*?binding = "READING_DB"[\s\S]*?database_name = "yuwen-reading-db-preview"[\s\S]*?database_id = "39ed36d9-b3f3-40fd-933a-9a68a4066302"/);
  assert.equal((precheckConfig.match(/^\[\[env\.preview\.services\]\]$/gm) || []).length, 1);
  assert.match(precheckConfig, /binding = "USER_CENTER_EVIDENCE"/);
  assert.match(precheckConfig, /service = "bdfz-user-center"/);
  assert.match(precheckConfig, /entrypoint = "YuwenEvidenceIdentity"/);
  assert.equal((precheckConfig.match(/^\[\[(?:env\.preview\.)?services\]\]$/gm) || []).length, 1);
  assert.doesNotMatch(precheckConfig, /(?:^|\s)queue\s*=/m);
  assert.doesNotMatch(precheckConfig, /^\[\[.*queues.*\]\]$/m);
  assert.doesNotMatch(precheckConfig, /bdfz-learning-evidence-yw-v[12]/);
  assert.doesNotMatch(precheckConfig, /99c541e7-e70b-4584-b939-7e88a6dd68c5/);
  assert.doesNotMatch(precheckConfig, /^\[\[env\.production\./m);
  assert.doesNotMatch(precheckConfig, /yw\.bdfz\.net/);
  assert.doesNotMatch(workerSource, /fetch\([^\n]*\/api\/me/);
  assert.match(workerSource, /typeof env\.USER_CENTER_EVIDENCE\?\.resolveSession !== "function"/);
  assert.match(workerSource, /throw readingIdentityUnavailable\(\)/);
});

test("Pages production keeps the exact reviewed bindings", () => {
  const production = config.slice(markerIndex);
  assert.match(production, /database_name = "yuwen-reading-db"/);
  assert.match(production, /database_id = "99c541e7-e70b-4584-b939-7e88a6dd68c5"/);
  assert.match(production, /\[\[env\.production\.services\]\]/);
  assert.match(production, /service = "bdfz-user-center"/);
  assert.match(production, /entrypoint = "YuwenEvidenceIdentity"/);
  assert.equal((config.match(/binding = "USER_CENTER_EVIDENCE"/g) || []).length, 1);
  assert.match(production, /\[\[env\.production\.queues\.producers\]\]/);
  assert.match(production, /queue = "bdfz-learning-evidence-yw-v2"/);
  assert.doesNotMatch(production, /queue = "bdfz-learning-evidence-yw-v1"/);
});
