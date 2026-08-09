import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const config = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
const productionMarker = "[[env.production.d1_databases]]";
const markerIndex = config.indexOf(productionMarker);

test("Pages preview cannot inherit production student-data bindings", () => {
  assert.notEqual(markerIndex, -1, "production bindings must be explicit");

  const preview = config.slice(0, markerIndex);
  assert.match(preview, /database_name = "yuwen-reading-db-preview"/);
  assert.match(preview, /database_id = "39ed36d9-b3f3-40fd-933a-9a68a4066302"/);
  assert.doesNotMatch(preview, /^\[\[services\]\]/m);
  assert.doesNotMatch(preview, /^\[\[queues\.producers\]\]/m);
  assert.doesNotMatch(preview, /99c541e7-e70b-4584-b939-7e88a6dd68c5/);
  assert.doesNotMatch(preview, /bdfz-user-center/);
  assert.doesNotMatch(preview, /bdfz-learning-evidence-yw-v1/);
});

test("Pages production keeps the exact reviewed bindings", () => {
  const production = config.slice(markerIndex);
  assert.match(production, /database_name = "yuwen-reading-db"/);
  assert.match(production, /database_id = "99c541e7-e70b-4584-b939-7e88a6dd68c5"/);
  assert.match(production, /\[\[env\.production\.services\]\]/);
  assert.match(production, /service = "bdfz-user-center"/);
  assert.match(production, /entrypoint = "YuwenEvidenceIdentity"/);
  assert.match(production, /\[\[env\.production\.queues\.producers\]\]/);
  assert.match(production, /queue = "bdfz-learning-evidence-yw-v1"/);
});
