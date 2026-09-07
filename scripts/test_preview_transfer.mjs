import assert from "node:assert/strict";
import test from "node:test";
import { getEventListeners } from "node:events";
import { createPreviewTransfer } from "../site/preview-transfer.js";
import { handlePreview } from "../site/_worker.js";

const origin = "https://preview.example.com";
const targets = ["/a.pdf", "/b.pdf", "/a.html", "/bytes.txt", "/bad.js", "/redirect", "/loop"];
const externalTargets = ["https://ctext.org/pre-qin-and-han/zh", "https://www.shuge.org/view/fixture/"];
const env = { ASSETS: { fetch: async () => Response.json({
  schemaVersion: "yw-preview-targets-v1", targetDigest: `sha256:${"0".repeat(64)}`,
  targetCount: targets.length + externalTargets.length, allowedHosts: ["preview.example.com", "ctext.org", "www.shuge.org"],
  targets: [...targets.map((p) => origin + p), ...externalTargets], redirectTargets: [],
}) } };
const request = (path = "/a.pdf", init) => new Request(
  `https://yw.bdfz.net/api/preview?url=${encodeURIComponent(path.startsWith("https:") ? path : origin + path)}`, init,
);
const stalled = (onCancel = () => {}) => new ReadableStream({ cancel: onCancel });
const pdf = (body = "%PDF fixture", extra = {}) => new Response(body, {
  ...extra, headers: { "content-type": "application/pdf", ...extra.headers },
});
async function mockFetch(fn, run) {
  const prior = globalThis.fetch;
  globalThis.fetch = fn;
  try { await run(); } finally { globalThis.fetch = prior; }
}
const failure = (response, status, code, stage) => {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("x-preview-error-code"), code);
  assert.equal(response.headers.get("x-preview-error-stage"), stage);
};

// Fixture deadlines below are test controls, never production measurements.
test("registered redirect preserves Range and HEAD, cancels discarded body", async () => {
  let discarded = 0;
  const calls = [];
  await mockFetch(async (url, options) => {
    calls.push([url, options]);
    if (url.endsWith("/a.pdf")) return new Response(stalled(() => discarded++), {
      status: 302, headers: { location: "/b.pdf" },
    });
    return pdf("partial", { status: 206, headers: { "content-range": "bytes 0-6/100" } });
  }, async () => {
    const result = await handlePreview(request("/a.pdf", { headers: { range: "bytes=0-6" } }), env);
    assert.equal(result.status, 206);
    assert.equal(await result.text(), "partial");
    assert.equal(result.headers.get("content-range"), "bytes 0-6/100");
    assert.equal(calls.length, 2);
    assert.equal(calls[1][1].headers.get("range"), "bytes=0-6");
    assert.strictEqual(calls[0][1].signal, calls[1][1].signal);
    assert.equal(discarded, 1);
    const head = await handlePreview(request("/b.pdf", { method: "HEAD" }), env);
    assert.equal(head.body, null);
    assert.equal(calls.at(-1)[1].method, "HEAD");
  });
});

test("unregistered initial and redirected targets cannot fetch", async () => {
  let calls = 0, discarded = 0;
  await mockFetch(async () => {
    calls++;
    return new Response(stalled(() => discarded++), { status: 302, headers: { location: "https://127.0.0.1/private" } });
  }, async () => {
    assert.equal((await handlePreview(request("/unregistered"), env)).status, 403);
    assert.equal(calls, 0);
    failure(await handlePreview(request(), env), 403, "preview_redirect_denied", "redirect");
    assert.equal(calls, 1);
    assert.equal(discarded, 1);
  });
});

for (const [name, location, code, count] of [
  ["missing", null, "preview_redirect_missing", 1],
  ["invalid", "https://[", "preview_redirect_invalid", 1],
  ["loop", "/loop", "preview_redirect_limit", 6],
]) test(`redirect ${name} is classified and discarded`, async () => {
  let calls = 0, discarded = 0;
  await mockFetch(async () => {
    calls++;
    return new Response(stalled(() => discarded++), { status: 302, headers: location ? { location } : {} });
  }, async () => {
    failure(await handlePreview(request("/loop"), env), 502, code, "redirect");
    assert.equal(calls, count);
    assert.equal(discarded, count);
  });
});

for (const status of [404, 429, 503]) test(`upstream HTTP ${status} cannot become PDF fallback 200`, async () => {
  let discarded = 0;
  await mockFetch(async () => new Response(stalled(() => discarded++), { status, headers: { "content-type": "text/html" } }), async () => {
    failure(await handlePreview(request(), env), status, "preview_upstream_http", "headers");
    assert.equal(discarded, 1);
  });
});

test("network rejection stays 502 without exposing upstream error", async () => {
  await mockFetch(async () => { throw new Error("private upstream details"); }, async () => {
    const response = await handlePreview(request(), env);
    failure(response, 502, "preview_upstream_network", "headers");
    assert.doesNotMatch(await response.text(), /private/);
  });
});

test("headers deadline aborts fetch, returns 504 and cancels late response", async () => {
  let resolveFetch, signal, discarded = 0;
  await mockFetch((_, options) => {
    signal = options.signal;
    return new Promise((resolve) => { resolveFetch = resolve; });
  }, async () => {
    const response = await handlePreview(request(), env, { timeoutMs: 10 });
    failure(response, 504, "preview_timeout", "headers");
    assert.equal(signal.aborted, true);
    resolveFetch(pdf(stalled(() => discarded++)));
    await Promise.resolve(); await Promise.resolve();
    assert.equal(discarded, 1);
  });
});

for (const firstChunk of [false, true]) test(`deadline covers ${firstChunk ? "mid-stream" : "unread body"} and releases reader`, async () => {
  let discarded = 0, signal;
  const body = new ReadableStream({
    start(out) { if (firstChunk) out.enqueue(new Uint8Array([1])); },
    cancel() { discarded++; },
  });
  await mockFetch(async (_, options) => { signal = options.signal; return pdf(body); }, async () => {
    const response = await handlePreview(request(), env, { timeoutMs: 15 });
    assert.equal(response.status, 200); // already committed: never claim a later 504
    const reader = response.body.getReader();
    if (firstChunk) assert.equal((await reader.read()).value.byteLength, 1);
    await assert.rejects(reader.read(), { code: "preview_timeout", stage: firstChunk ? "stream" : "body" });
    assert.equal(signal.aborted, true);
    assert.equal(discarded, 1);
    assert.equal(body.locked, false);
  });
});

test("body exception is distinct from timeout", async () => {
  await mockFetch(async () => pdf(new ReadableStream({ pull(out) { out.error(new Error("private")); } })), async () => {
    const response = await handlePreview(request(), env);
    await assert.rejects(response.text(), { code: "preview_body_failed", stage: "body" });
  });
});

for (const declared of [false, true]) test(`byte budget handles ${declared ? "declared" : "chunked"} oversize body`, async () => {
  let discarded = 0;
  const body = new ReadableStream({ start(out) { out.enqueue(new Uint8Array(5)); }, cancel() { discarded++; } });
  await mockFetch(async () => pdf(body, { headers: declared ? { "content-length": "5" } : {} }), async () => {
    const response = await handlePreview(request(), env, { maxBytes: 4 });
    if (declared) failure(response, 502, "preview_body_too_large", "body");
    else await assert.rejects(response.text(), { code: "preview_body_too_large" });
    assert.equal(discarded, 1);
  });
});

test("client cancellation before headers and during stream propagates upstream", async () => {
  const client = new AbortController();
  let upstreamSignal;
  await mockFetch((_, options) => { upstreamSignal = options.signal; return new Promise(() => {}); }, async () => {
    const pending = handlePreview(request("/a.pdf", { signal: client.signal }), env);
    await new Promise((resolve) => setImmediate(resolve));
    client.abort();
    failure(await pending, 499, "preview_client_cancelled", "headers");
    assert.equal(upstreamSignal.aborted, true);
  });
  let discarded = 0;
  await mockFetch(async (_, options) => { upstreamSignal = options.signal; return pdf(stalled(() => discarded++)); }, async () => {
    const response = await handlePreview(request(), env);
    await response.body.cancel();
    assert.equal(upstreamSignal.aborted, true);
    assert.equal(discarded, 1);
  });
});

test("fallback and rejected MIME cancel their unused body", async () => {
  for (const [type, status] of [["text/html", 200], ["application/javascript", 415]]) {
    let discarded = 0;
    await mockFetch(async () => new Response(stalled(() => discarded++), { headers: { "content-type": type } }), async () => {
      assert.equal((await handlePreview(request(), env)).status, status);
      assert.equal(discarded, 1);
    });
  }
});

test("success, cancellation and explicit finish clear timers and listeners", async () => {
  const realSet = globalThis.setTimeout, realClear = globalThis.clearTimeout;
  const active = new Set();
  globalThis.setTimeout = (...args) => { const id = realSet(...args); active.add(id); return id; };
  globalThis.clearTimeout = (id) => { active.delete(id); realClear(id); };
  const client = new AbortController();
  try {
    const transfer = createPreviewTransfer(client.signal, { timeoutMs: 1000 });
    assert.equal(getEventListeners(client.signal, "abort").length, 1);
    assert.equal(await new Response(transfer.body(pdf())).text(), "%PDF fixture");
    assert.equal(active.size, 0);
    assert.equal(getEventListeners(client.signal, "abort").length, 0);
    const cancelled = createPreviewTransfer(client.signal, { timeoutMs: 1000 });
    await cancelled.body(pdf(stalled())).cancel();
    const unused = createPreviewTransfer(client.signal, { timeoutMs: 1000 });
    unused.finish();
    assert.equal(active.size, 0);
    assert.equal(getEventListeners(client.signal, "abort").length, 0);
    const noLimits = createPreviewTransfer(client.signal);
    assert.equal(active.size, 0);
    noLimits.finish();
  } finally {
    for (const id of active) realClear(id);
    globalThis.setTimeout = realSet; globalThis.clearTimeout = realClear;
  }
});

test("Ctext login and Shuge retry share cancellation and discard unused bodies", async () => {
  let discarded = 0;
  const signals = [], urls = [];
  await mockFetch(async (url, options) => {
    urls.push(url); signals.push(options.signal);
    if (url.endsWith("account.pl")) return new Response(stalled(() => discarded++), {
      status: 302, headers: { "set-cookie": "fixture=value" },
    });
    if (url.includes("shuge") && urls.filter((u) => u.includes("shuge")).length === 1) {
      return new Response(stalled(() => discarded++), { status: 403, headers: { "set-cookie": "fixture=value" } });
    }
    return new Response("fixture", { headers: { "content-type": "text/plain" } });
  }, async () => {
    const ctext = await handlePreview(request(externalTargets[0]), { ...env, CTEXT_USERNAME: "fixture", CTEXT_PASSWORD: "fixture" });
    assert.equal(await ctext.text(), "fixture");
    assert.equal(discarded, 1);
    assert.strictEqual(signals[0], signals[1]);
    const shuge = await handlePreview(request(externalTargets[1]), env);
    assert.equal(await shuge.text(), "fixture");
    assert.equal(discarded, 2);
    assert.strictEqual(signals[2], signals[3]);
    assert.equal(urls.length, 4);
  });
});

test("a pre-aborted request never starts an external fetch", async () => {
  const client = new AbortController(); client.abort();
  await mockFetch(() => { assert.fail("unexpected external fetch"); }, async () => {
    failure(await handlePreview(request("/a.pdf", { signal: client.signal }), env), 499, "preview_client_cancelled", "headers");
  });
});
