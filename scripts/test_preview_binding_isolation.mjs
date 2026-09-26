import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const config = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
const precheckConfig = readFileSync(new URL("../wrangler.precheck.toml", import.meta.url), "utf8");
const workerSource = readFileSync(new URL("../site/_worker.js", import.meta.url), "utf8");
const productionMarker = "[[env.production.d1_databases]]";
const markerIndex = config.indexOf(productionMarker);

// Project API settings can report a flag that the uploaded Worker does not bind.
// Inspect the same multipart metadata Wrangler uses for Pages deployment.
for (const environment of ["production", "preview"]) {
  test(`the actual ${environment} Worker bundle has the intended evaluation bindings`, async () => {
    const root = path.resolve(import.meta.dirname, "..");
    const scratch = mkdtempSync(path.join(os.tmpdir(), "yw-pages-bindings-"));
    try {
      const outfile = path.join(scratch, "worker.bundle");
      execFileSync(process.execPath, [
        path.join(root, "node_modules/wrangler/bin/wrangler.js"),
        "pages", "functions", "build", "--project-directory", root,
        "--build-metadata-path", path.join(scratch, "build.json"),
        "--outfile", outfile,
      ], {
        cwd: scratch,
        env: {
          ...process.env,
          PAGES_ENVIRONMENT: environment,
          WRANGLER_SEND_METRICS: "false",
          WRANGLER_LOG_PATH: path.join(scratch, "wrangler.log"),
          CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false",
          TMPDIR: scratch,
        },
        timeout: 30_000,
        stdio: "pipe",
      });
      const bytes = readFileSync(outfile);
      const boundary = bytes.toString().split("\r\n", 1)[0].slice(2);
      const form = await new Response(bytes, {
        headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      }).formData();
      const raw = form.get("metadata");
      const { bindings } = JSON.parse(typeof raw === "string" ? raw : await raw.text());
      const binding = name => bindings.find(item => item.name === name);
      assert.equal(binding("READING_TEST_SLUG"), undefined);
      if (environment === "production") {
        assert.deepEqual(binding("YW_DURABLE_EVALUATION_ENABLED"), {
          name: "YW_DURABLE_EVALUATION_ENABLED", type: "plain_text", text: "true",
        });
        assert.equal(binding("READING_DB").id, "99c541e7-e70b-4584-b939-7e88a6dd68c5");
        assert.equal(binding("APIS").service, "apis");
      } else {
        assert.equal(binding("READING_DB").id, "39ed36d9-b3f3-40fd-933a-9a68a4066302");
        for (const name of ["YW_DURABLE_EVALUATION_ENABLED", "APIS", "USER_CENTER_EVIDENCE", "LEARNING_EVIDENCE_QUEUE"]) {
          assert.equal(binding(name), undefined, `${name} must not reach previews`);
        }
      }
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
}

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
