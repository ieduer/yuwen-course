import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(readFileSync(resolve(ROOT, "site/data/preview-screenshots.json"), "utf8"));
const registry = JSON.parse(readFileSync(resolve(ROOT, "site/data/preview-targets.json"), "utf8"));
const appSource = readFileSync(resolve(ROOT, "site/assets/app.js"), "utf8");
const captureSource = readFileSync(resolve(ROOT, "scripts/capture_preview_screenshots.mjs"), "utf8");

test("preview screenshot manifest is bounded and every byte is content-addressed", () => {
  assert.equal(manifest.schemaVersion, "yw-preview-screenshots-v1");
  assert.deepEqual(manifest.viewport, { width: 1024, height: 640 });
  assert.equal(manifest.screenshotCount, manifest.entries.length);
  assert.equal(manifest.blockedCount, manifest.blocked.length);
  assert.equal(manifest.resolvedCount, manifest.resolved.length);
  assert.equal(manifest.candidateCount, manifest.entries.length + manifest.resolved.length + manifest.blocked.length);
  assert.equal(new Set(manifest.entries.map((entry) => entry.sourceUrl)).size, manifest.entries.length);
  assert.ok(new Set(manifest.entries.map((entry) => entry.screenshotUrl)).size <= manifest.entries.length);
  assert.deepEqual(
    readdirSync(resolve(ROOT, "site/assets/preview-screenshots")).sort(),
    [...new Set(manifest.entries.map((entry) => entry.screenshotUrl.split("/").pop()))].sort(),
  );

  const registered = new Set(registry.targets);
  let totalBytes = 0;
  for (const entry of manifest.entries) {
    assert.ok(registered.has(entry.sourceUrl), entry.sourceUrl);
    assert.match(entry.screenshotUrl, /^\/assets\/preview-screenshots\/[a-f0-9]{24}\.webp$/);
    assert.equal(new URL(entry.sourceUrl).hostname, new URL(entry.sourceUrl).hostname.toLowerCase());
    assert.notEqual(new URL(entry.sourceUrl).hostname, "accounts.google.com");
    assert.notEqual(new URL(entry.sourceUrl).hostname, "bdfz.yuque.com");
    assert.deepEqual([entry.width, entry.height], [1024, 640]);
    assert.ok(entry.bytes > 0 && entry.bytes <= 250_000, entry.sourceUrl);
    assert.match(entry.sha256, /^[a-f0-9]{64}$/);
    assert.ok(Array.isArray(entry.attribution) && entry.attribution.length > 0, entry.sourceUrl);
    if (entry.captureUrl) {
      const captureUrl = new URL(entry.captureUrl);
      assert.equal(captureUrl.hash, "", entry.sourceUrl);
      for (const key of captureUrl.searchParams.keys()) {
        assert.doesNotMatch(
          key,
          /(?:auth|client|code|continue|dsh|flow|followup|ifkv|nonce|passive|prompt|redirect|secret|service|session|state|token)/i,
          entry.sourceUrl,
        );
      }
      if (captureUrl.hostname === "accounts.google.com" || captureUrl.hostname === "passport.seiue.com") {
        assert.equal(captureUrl.search, "", entry.sourceUrl);
      }
    }
    const assetPath = resolve(ROOT, `site${entry.screenshotUrl}`);
    assert.ok(existsSync(assetPath), assetPath);
    const bytes = readFileSync(assetPath);
    assert.equal(bytes.length, entry.bytes, entry.sourceUrl);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), entry.sha256, entry.sourceUrl);
    assert.equal(bytes.subarray(0, 4).toString("ascii"), "RIFF", entry.sourceUrl);
    assert.equal(bytes.subarray(8, 12).toString("ascii"), "WEBP", entry.sourceUrl);
    totalBytes += bytes.length;
  }
  assert.equal(totalBytes, manifest.totalBytes);
  assert.ok(totalBytes <= 80 * 1024 * 1024);
  for (const blocked of manifest.blocked) {
    assert.ok(registered.has(blocked.sourceUrl), blocked.sourceUrl);
    assert.equal(manifest.entries.some((entry) => entry.sourceUrl === blocked.sourceUrl), false);
    assert.ok(String(blocked.reason || "").trim(), blocked.sourceUrl);
    assert.ok(["external-condition-required", "remove-from-embed"].includes(blocked.resolutionGroup));
    assert.ok(Array.isArray(blocked.attribution) && blocked.attribution.length > 0, blocked.sourceUrl);
    if (blocked.finalUrl) {
      const finalUrl = new URL(blocked.finalUrl);
      assert.equal(finalUrl.hash, "", blocked.sourceUrl);
      for (const key of finalUrl.searchParams.keys()) {
        assert.doesNotMatch(
          key,
          /(?:auth|client|code|continue|dsh|flow|followup|ifkv|nonce|passive|prompt|redirect|secret|service|session|state|token)/i,
          blocked.sourceUrl,
        );
      }
      if (finalUrl.hostname === "accounts.google.com" || finalUrl.hostname === "passport.seiue.com") {
        assert.equal(finalUrl.search, "", blocked.sourceUrl);
      }
    }
  }
  for (const resolved of manifest.resolved) {
    assert.ok(registered.has(resolved.sourceUrl), resolved.sourceUrl);
    assert.equal(resolved.disposition, "already-fixed");
    assert.ok(["reviewed-video-thumbnail", "direct-image-content"].includes(resolved.resolution));
    assert.ok(Array.isArray(resolved.attribution) && resolved.attribution.length > 0, resolved.sourceUrl);
    if (resolved.finalUrl) {
      const finalUrl = new URL(resolved.finalUrl);
      assert.equal(finalUrl.hash, "", resolved.sourceUrl);
      for (const key of finalUrl.searchParams.keys()) {
        assert.doesNotMatch(
          key,
          /(?:auth|client|code|continue|dsh|flow|followup|ifkv|nonce|passive|prompt|redirect|secret|service|session|state|token)/i,
          resolved.sourceUrl,
        );
      }
    }
  }
});

test("reviewed recovery audit is fail-closed and preserves the original resource identity", () => {
  assert.equal(manifest.candidateCount, 352);
  assert.equal(manifest.screenshotCount, 334);
  assert.equal(manifest.resolvedCount, 11);
  assert.equal(manifest.blockedCount, 7);
  assert.equal(new Set(manifest.entries.map((entry) => entry.screenshotUrl)).size, 328);
  assert.equal(manifest.totalBytes, 12_795_016);
  const recovered = manifest.entries.filter((entry) => entry.recoveryMethod);
  assert.equal(recovered.length, 137);
  assert.equal(new Set(recovered.map((entry) => entry.sourceUrl)).size, 137);
  assert.ok(recovered.every((entry) => registry.targets.includes(entry.sourceUrl)));
  const authenticated = recovered.filter((entry) => entry.recoveryMethod === "reviewed-authenticated-page");
  assert.equal(authenticated.length, 49);
  assert.deepEqual(
    Object.fromEntries(
      ["ctext.org", "forum.rdfzer.com"].map((host) => [
        host,
        authenticated.filter((entry) => new URL(entry.sourceUrl).hostname === host).length,
      ]),
    ),
    { "ctext.org": 22, "forum.rdfzer.com": 27 },
  );
  const categories = Object.fromEntries(
    ["requires-suen-or-external-account", "permanent-dead-or-remove"]
      .map((category) => [category, manifest.blocked.filter((entry) => entry.auditCategory === category).length]),
  );
  assert.deepEqual(categories, {
    "requires-suen-or-external-account": 7,
    "permanent-dead-or-remove": 0,
  });
  const resolutionGroups = Object.fromEntries(
    ["external-condition-required", "remove-from-embed"]
      .map((group) => [group, manifest.blocked.filter((entry) => entry.resolutionGroup === group).length]),
  );
  assert.deepEqual(resolutionGroups, {
    "external-condition-required": 7,
    "remove-from-embed": 0,
  });
  assert.equal(registry.targets.some((entry) => entry.includes("BV1Zg4y1H7fK")), false);
  assert.equal(JSON.stringify(manifest).includes("BV1Zg4y1H7fK"), false);
  assert.equal(
    [...manifest.entries, ...manifest.blocked, ...manifest.resolved]
      .some((entry) => new URL(entry.sourceUrl).hostname === "xue.bdfz.net"),
    false,
  );
  assert.match(appSource, /\/video\/bv1zg4y1h7fk/);
});

test("all 99 exact Google Sites targets have reviewed screenshots", () => {
  const googleTargets = registry.targets
    .filter((entry) => new URL(entry).hostname === "sites.google.com")
    .sort();
  const googleScreenshots = manifest.entries
    .filter((entry) => new URL(entry.sourceUrl).hostname === "sites.google.com")
    .map((entry) => entry.sourceUrl)
    .sort();
  assert.equal(googleTargets.length, 99);
  assert.equal(googleScreenshots.length, 99);
  assert.deepEqual(googleScreenshots, googleTargets);
});

test("runtime falls back to reviewed screenshots and otherwise stops embedding", () => {
  assert.match(appSource, /fetchJson\("data\/preview-screenshots\.json"/);
  assert.match(appSource, /previewScreenshotBySource/);
  assert.match(appSource, /inlinePreviewUsable\(plan\.src\)/);
  assert.match(appSource, /screenshotFallbackPlan\(plan\)/);
  assert.match(appSource, /沒有經驗證的本機截圖；已停止嵌入/);
  assert.match(appSource, /openResourcePlan\(plan, title\)/);
});

test("capture is anonymous, fixed-size, compressed, and rejects login or error pages", () => {
  assert.match(captureSource, /newContext\(\{/);
  assert.doesNotMatch(captureSource, /launchPersistentContext|storageState|userDataDir/);
  assert.match(captureSource, /viewport: \{ width: 1024, height: 640 \}/);
  assert.match(captureSource, /webp\(\{ quality: 45, effort: 5 \}\)/);
  assert.match(captureSource, /MAX_SCREENSHOT_BYTES = 250_000/);
  assert.match(captureSource, /MAX_TOTAL_BYTES = 80 \* 1024 \* 1024/);
  assert.match(captureSource, /direct-login/);
  assert.match(captureSource, /direct-error-page/);
  assert.match(captureSource, /privacyBoundedFinalUrl/);
  assert.match(captureSource, /PRIVATE_OR_TRANSIENT_QUERY_KEY/);
  assert.match(captureSource, /recoveryAudit: value\("recovery-audit"\)/);
  assert.match(captureSource, /x-public-oembed/);
  assert.match(captureSource, /bilibili-public-view-api/);
  assert.match(captureSource, /mediawiki-public-api/);
  assert.doesNotMatch(captureSource, /storageState|userDataDir|cookie/i);
});
