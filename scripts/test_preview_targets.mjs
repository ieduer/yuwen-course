import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolve } from "node:path";
import { buildPreviewTargets, renderPreviewTargets } from "./build_preview_targets.mjs";
import { previewUrlHasPublicHostname } from "../site/preview-network-policy.js";
import worker from "../site/_worker.js";

const ROOT = resolve(import.meta.dirname, "..");

test("preview proxy accepts only the generated authoritative resource registry", () => {
  const registry = buildPreviewTargets();
  assert.equal(registry.schemaVersion, "yw-preview-targets-v1");
  assert.ok(registry.targetCount > 0);
  assert.equal(new Set(registry.targets).size, registry.targetCount);
  assert.equal(registry.targets.every((entry) => entry.startsWith("https://")), true);
  assert.equal(registry.targets.some((entry) => /(?:localhost|127\.0\.0\.1|192\.168\.)/.test(entry)), false);
  assert.equal(
    readFileSync(resolve(ROOT, "site/data/preview-targets.json"), "utf8"),
    renderPreviewTargets(),
  );
});

test("preview network policy rejects every address literal and non-public hostname form", () => {
  for (const target of [
    "https://127.0.0.1/x",
    "https://10.0.0.1/x",
    "https://169.254.169.254/latest/meta-data",
    "https://[::1]/x",
    "https://[::ffff:7f00:1]/x",
    "https://[::ffff:a00:1]/x",
    "https://[fe90::1]/x",
    "https://[febf::1]/x",
    "https://service.internal/x",
    "https://singlelabel/x",
  ]) assert.equal(previewUrlHasPublicHostname(new URL(target)), false, target);
  assert.equal(previewUrlHasPublicHostname(new URL("https://ctext.org/pre-qin-and-han/zh")), true);
});

test("preview Worker denies unregistered targets and never emits wildcard CORS", async () => {
  const registry = buildPreviewTargets();
  const target = registry.targets.find((entry) => new URL(entry).hostname === "zh.wikipedia.org")
    || registry.targets[0];
  const env = {
    ASSETS: {
      async fetch(request) {
        const pathname = new URL(request.url).pathname;
        if (pathname === "/data/preview-targets.json") return Response.json(registry);
        if (pathname === "/data/resource_redirects.json") return Response.json({ redirects: {} });
        return new Response("not found", { status: 404 });
      },
    },
  };
  const denied = await worker.fetch(
    new Request("https://yw.bdfz.net/api/preview?url=https%3A%2F%2Fexample.com%2Funregistered"),
    env,
    {},
  );
  assert.equal(denied.status, 403);

  for (const privateTarget of [
    "https://[::ffff:7f00:1]/x",
    "https://[fe90::1]/x",
    "https://[febf::1]/x",
  ]) {
    const privateRegistry = {
      ...registry,
      targets: [privateTarget],
      targetCount: 1,
      redirectTargets: [],
      allowedHosts: [new URL(privateTarget).hostname],
    };
    const privateEnv = {
      ASSETS: {
        async fetch(request) {
          return new URL(request.url).pathname === "/data/preview-targets.json"
            ? Response.json(privateRegistry)
            : Response.json({ redirects: {} });
        },
      },
    };
    const blockedPrivate = await worker.fetch(
      new Request(`https://yw.bdfz.net/api/preview?url=${encodeURIComponent(privateTarget)}`),
      privateEnv,
      {},
    );
    assert.equal(blockedPrivate.status, 400, privateTarget);
  }

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response("%PDF-1.4", {
      headers: {
        "content-type": "application/pdf",
        "access-control-allow-origin": "*",
        "access-control-allow-credentials": "true",
      },
    });
    const allowed = await worker.fetch(
      new Request(`https://yw.bdfz.net/api/preview?url=${encodeURIComponent(target)}`),
      env,
      {},
    );
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get("access-control-allow-origin"), null);
    assert.equal(allowed.headers.get("access-control-allow-credentials"), null);
    assert.equal(allowed.headers.get("cross-origin-resource-policy"), "same-origin");

    for (const [contentType, body] of [
      ["application/javascript", "globalThis.previewPwned = true"],
      ["image/svg+xml", "<svg xmlns=\"http://www.w3.org/2000/svg\"><script>alert(1)</script></svg>"],
    ]) {
      globalThis.fetch = async () => new Response(body, { headers: { "content-type": contentType } });
      const rejected = await worker.fetch(
        new Request(`https://yw.bdfz.net/api/preview?url=${encodeURIComponent(target)}`),
        env,
        {},
      );
      assert.equal(rejected.status, 415);
      assert.equal(rejected.headers.get("x-content-type-options"), "nosniff");
      assert.match(rejected.headers.get("content-security-policy") || "", /default-src 'none'/);
      assert.doesNotMatch(await rejected.text(), /previewPwned|<svg/i);
    }

    const sameAllowedHost = new URL(target);
    sameAllowedHost.pathname = "/unregistered-sensitive-path";
    sameAllowedHost.search = "";
    globalThis.fetch = async () => new Response(null, {
      status: 302,
      headers: { location: sameAllowedHost.toString() },
    });
    const redirected = await worker.fetch(
      new Request(`https://yw.bdfz.net/api/preview?url=${encodeURIComponent(target)}`),
      env,
      {},
    );
    assert.equal(redirected.status, 502);
  } finally {
    globalThis.fetch = originalFetch;
  }

  const removedStaticProxy = await worker.fetch(
    new Request("https://yw.bdfz.net/static/unregistered-active-content.html"),
    env,
    {},
  );
  assert.equal(removedStaticProxy.status, 404);

  const workerSource = readFileSync(resolve(ROOT, "site/_worker.js"), "utf8");
  assert.doesNotMatch(workerSource, /access-control-allow-origin["']\s*,\s*["']\*["']/i);
  assert.doesNotMatch(workerSource, /function\s+rewritePreviewHtml/);
  assert.doesNotMatch(workerSource, /handleCtextStatic|pathname\.startsWith\(["']\/static\//);
  assert.match(workerSource, /new HTMLRewriter\(\)/);
});
