import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";

import { Log, LogLevel, Miniflare } from "miniflare";

const ROOT = resolve(import.meta.dirname, "..");
const HTML_TARGET = "https://preview.example.com/lesson.html";
const JS_TARGET = "https://preview.example.com/payload.js";
const SVG_TARGET = "https://preview.example.com/payload.svg";

const registry = {
  schemaVersion: "yw-preview-targets-v1",
  targetDigest: `sha256:${"0".repeat(64)}`,
  targetCount: 3,
  allowedHosts: ["preview.example.com"],
  targets: [HTML_TARGET, JS_TARGET, SVG_TARGET],
  redirectTargets: [],
};

const unsafeHtml = `<!doctype html>
<html>
  <head>
    <base href="https://attacker.invalid/">
    <link rel="stylesheet" href="https://attacker.invalid/payload.css">
    <meta http-equiv="refresh" content="0;url=https://attacker.invalid/">
    <script>globalThis.previewPwned = true</script>
  </head>
  <body onload="globalThis.previewPwned = true">
    <iframe src="https://attacker.invalid/frame"></iframe>
    <object data="https://attacker.invalid/object"></object>
    <embed src="https://attacker.invalid/embed">
    <form action="javascript:globalThis.previewPwned=true">
      <button onclick="globalThis.previewPwned=true">保留表單內文字</button>
    </form>
    <a id="bad-link" href="javascript:globalThis.previewPwned=true" onclick="globalThis.previewPwned=true">惡意鏈接</a>
    <a id="safe-link" href="/notes">安全鏈接</a>
    <img id="bad-image" src="javascript:globalThis.previewPwned=true" srcset="https://attacker.invalid/a.png 2x" onerror="globalThis.previewPwned=true">
    <p id="bad-style" style="background:url(javascript:globalThis.previewPwned=true)">正文</p>
  </body>
</html>`;

function contentFor(request) {
  switch (request.url) {
    case HTML_TARGET:
      return new Response(unsafeHtml, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "access-control-allow-origin": "*",
          "set-cookie": "upstream=secret",
          "x-frame-options": "DENY",
        },
      });
    case JS_TARGET:
      return new Response("globalThis.previewPwned = true", {
        headers: { "content-type": "application/javascript" },
      });
    case SVG_TARGET:
      return new Response("<svg onload='globalThis.previewPwned=true'></svg>", {
        headers: { "content-type": "image/svg+xml" },
      });
    default:
      return new Response("unexpected outbound request", { status: 599 });
  }
}

test("workerd executes HTMLRewriter and rejects executable preview MIME types", async () => {
  const hostFetch = globalThis.fetch;
  const outboundUrls = [];
  const mf = new Miniflare({
    compatibilityDate: "2026-05-12",
    modules: true,
    modulesRules: [{ type: "ESModule", include: ["**/*.js"] }],
    modulesRoot: resolve(ROOT, "site"),
    scriptPath: resolve(ROOT, "site/_worker.js"),
    log: new Log(LogLevel.NONE),
    serviceBindings: {
      ASSETS(request) {
        const url = new URL(request.url);
        if (url.pathname === "/data/preview-targets.json") return Response.json(registry);
        return new Response("asset not found", { status: 404 });
      },
    },
    outboundService(request) {
      outboundUrls.push(request.url);
      return contentFor(request);
    },
  });

  try {
    const htmlResponse = await mf.dispatchFetch(
      `https://yw.bdfz.net/api/preview?url=${encodeURIComponent(HTML_TARGET)}`,
    );
    assert.equal(htmlResponse.status, 200);
    const html = await htmlResponse.text();

    assert.doesNotMatch(html, /<script\b|<iframe\b|<object\b|<embed\b|<link\b/i);
    assert.doesNotMatch(html, /http-equiv=["']?refresh|\son[a-z]+\s*=|javascript:|srcset\s*=/i);
    assert.doesNotMatch(html, /<form\b|background\s*:\s*url/i);
    assert.match(html, /保留表單內文字/);
    assert.match(html, /href="https:\/\/preview\.example\.com\/notes"/);

    const csp = htmlResponse.headers.get("content-security-policy") || "";
    assert.match(csp, /default-src 'none'/);
    assert.match(csp, /script-src 'none'/);
    assert.match(csp, /frame-src 'none'/);
    assert.match(csp, /form-action 'none'/);
    assert.match(csp, /sandbox/);
    assert.equal(htmlResponse.headers.get("x-content-type-options"), "nosniff");
    assert.equal(htmlResponse.headers.get("cross-origin-resource-policy"), "same-origin");
    assert.equal(htmlResponse.headers.get("access-control-allow-origin"), null);
    assert.equal(htmlResponse.headers.get("set-cookie"), null);

    for (const target of [JS_TARGET, SVG_TARGET]) {
      const response = await mf.dispatchFetch(
        `https://yw.bdfz.net/api/preview?url=${encodeURIComponent(target)}`,
      );
      assert.equal(response.status, 415);
      assert.equal(response.headers.get("x-content-type-options"), "nosniff");
      assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin");
      assert.doesNotMatch(await response.text(), /previewPwned|<svg/i);
    }

    assert.deepEqual(outboundUrls, [HTML_TARGET, JS_TARGET, SVG_TARGET]);
    assert.strictEqual(globalThis.fetch, hostFetch);
  } finally {
    await mf.dispose();
  }
});
