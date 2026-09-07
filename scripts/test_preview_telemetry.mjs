import assert from "node:assert/strict";
import test from "node:test";
import { createPreviewTelemetry } from "../site/preview-telemetry.js";

const secret = "DO_NOT_LOG_SYNTHETIC_PAYLOAD";
const target = `https://preview.example.com/file.pdf?source=${secret}`;
const request = () => new Request(`https://yw.bdfz.net/api/preview?url=${encodeURIComponent(target)}`, {
  headers: { cookie: secret, authorization: secret, range: "bytes=0-9" },
});
const registry = { schemaVersion: "yw-preview-targets-v1", targetDigest: `sha256:${"0".repeat(64)}`,
  targetCount: 1, allowedHosts: ["preview.example.com"], targets: [target], redirectTargets: [] };
const env = { ASSETS: { fetch: async () => Response.json(registry) } };

async function fixture(name, fetchImpl, run) {
  const priorFetch = globalThis.fetch, priorLog = console.log;
  const events = [];
  globalThis.fetch = fetchImpl;
  console.log = (text) => { events.push(JSON.parse(text)); };
  try {
    const { handlePreview } = await import(`../site/_worker.js?telemetry=${name}`);
    await run(handlePreview, events);
    const serialized = JSON.stringify(events);
    assert.doesNotMatch(serialized, new RegExp(`${secret}|preview\\.example|https:|cookie|authorization|source=`));
    assert.equal(events.filter((e) => e.event === "YW_PREVIEW_TERMINAL").length, 1);
    assert.equal(new Set(events.map((e) => e.correlation_id)).size, 1);
  } finally { globalThis.fetch = priorFetch; console.log = priorLog; }
}
const terminal = (events) => events.find((e) => e.event === "YW_PREVIEW_TERMINAL");

test("successful stream logs original byte count and correlation without private inputs", async () => {
  await fixture("success", async () => new Response("1234567890", { status: 206, headers: { "content-type": "application/pdf", "content-range": "bytes 0-9/10" } }), async (handle, events) => {
    const response = await handle(request(), env);
    assert.equal(await response.text(), "1234567890");
    const event = terminal(events);
    assert.equal(response.headers.get("x-preview-request-id"), event.correlation_id);
    assert.equal(event.outcome, "success"); assert.equal(event.bytes, 10);
    assert.equal(event.response_status, 206); assert.equal(event.fetch_count, 1);
    assert.equal(event.range_request, true); assert.equal(event.censored, false);
  });
});

test("registry fault stays separate and performs zero provider calls", async () => {
  let calls = 0;
  await fixture("registry", async () => { calls++; throw Error(secret); }, async (handle, events) => {
    const response = await handle(request(), { ASSETS: { fetch() { throw Error(secret); } } });
    assert.equal(response.status, 503); assert.equal(calls, 0);
    assert.equal(terminal(events).stage, "registry");
    assert.equal(terminal(events).error_code, "preview_registry_unavailable");
  });
});

test("network failure preserves safe code and retryability", async () => {
  await fixture("network", async () => { throw Error(secret); }, async (handle, events) => {
    assert.equal((await handle(request(), env)).status, 502);
    const event = terminal(events);
    assert.equal(event.error_code, "preview_upstream_network");
    assert.equal(event.stage, "headers"); assert.equal(event.retryable, true);
    assert.equal(event.censored, true);
  });
});

test("HTTP failure reports its actual status and is not a censored network sample", async () => {
  await fixture("http", async () => new Response(secret, { status: 429 }), async (handle, events) => {
    assert.equal((await handle(request(), env)).status, 429);
    const event = terminal(events);
    assert.equal(event.upstream_status, 429); assert.equal(event.error_code, "preview_upstream_http");
    assert.equal(event.censored, false); assert.equal(event.retryable, true);
  });
});

test("stream failure emits once after a constructed 200 response", async () => {
  let chunks = 0;
  await fixture("body", async () => new Response(new ReadableStream({ pull(out) {
    if (chunks++ === 0) out.enqueue(new Uint8Array([1, 2, 3])); else out.error(Error(secret));
  } }), { headers: { "content-type": "application/pdf" } }), async (handle, events) => {
    const response = await handle(request(), env);
    await assert.rejects(response.arrayBuffer(), { code: "preview_body_failed" });
    const event = terminal(events);
    assert.equal(event.response_status, 200); assert.equal(event.response_constructed, true);
    assert.equal(event.error_code, "preview_body_failed"); assert.equal(event.bytes, 3);
    assert.equal(event.outcome, "failure"); assert.equal(event.censored, true);
  });
});

test("body cancel records a censored sample and releases the upstream body", async () => {
  let cancelled = 0;
  await fixture("cancel", async () => new Response(new ReadableStream({ cancel() { cancelled++; } }), { headers: { "content-type": "application/pdf" } }), async (handle, events) => {
    const response = await handle(request(), env);
    await response.body.cancel();
    assert.equal(cancelled, 1); assert.equal(terminal(events).outcome, "cancelled");
    assert.equal(terminal(events).error_code, "preview_client_cancelled");
  });
});

test("allowlisted emitter measures phases and ignores error extras and duplicate finish", () => {
  let clock = 0; const events = [];
  const log = createPreviewTelemetry(request(), { now: () => clock, emit: (event) => events.push(event) });
  log.phase("registry"); clock = 7; log.phase("target_resolution"); clock = 10;
  log.fetching("headers"); clock = 22; log.fetched(new Response(null, { status: 200 }));
  log.phase("body"); clock = 30; log.chunk(3); clock = 40; log.chunk(4); clock = 50;
  log.finish({ code: secret, stage: secret, message: secret, body: secret }); log.finish();
  const event = terminal(events);
  assert.equal(event.registry_ms, 7); assert.equal(event.target_resolution_ms, 3);
  assert.equal(event.headers_ms, 12); assert.equal(event.bytes, 7); assert.equal(event.max_chunk_gap_ms, 10);
  assert.equal(event.error_code, "preview_response_failed");
  assert.equal(events.filter((e) => e.event === "YW_PREVIEW_TERMINAL").length, 1);
  assert.doesNotMatch(JSON.stringify(events), new RegExp(secret));
});

test("private log receiver rejects oversized input and strips unexpected fields", async () => {
  const worker = (await import("../diagnostics/worker.js")).default;
  const priorLog = console.log, records = [];
  console.log = (record) => records.push(record);
  try {
    const input = { event: "YW_PREVIEW_TERMINAL", operation: "preview", source_site_key: "yw",
      correlation_id: crypto.randomUUID(), method: "GET", stage: "headers", outcome: "failure",
      error_code: "preview_upstream_network", body: secret, cookie: secret, url: target };
    const response = await worker.fetch(new Request("https://internal/events", { method: "POST", body: JSON.stringify(input) }));
    assert.equal(response.status, 204); assert.equal(records.length, 1);
    assert.doesNotMatch(JSON.stringify(records), new RegExp(`${secret}|cookie|https:`));
    assert.equal((await worker.fetch(new Request("https://internal/events", { method: "POST", body: "x".repeat(4097) }))).status, 413);
    assert.equal((await worker.fetch(new Request("https://internal/events", { method: "POST", body: JSON.stringify({ body: secret }) }))).status, 400);
    assert.equal((await worker.fetch(new Request("https://internal/events"))).status, 404);
    assert.equal(records.length, 1);
  } finally { console.log = priorLog; }
});

test("real preview path delivers safe stage and terminal events to the private sink", async () => {
  const worker = (await import("../diagnostics/worker.js")).default;
  const priorFetch = globalThis.fetch, priorLog = console.log; const pending = [], stored = [];
  console.log = (value) => { if (typeof value === "object") stored.push(value); };
  globalThis.fetch = async () => new Response("fixture", { headers: { "content-type": "application/pdf" } });
  try {
    const { handlePreview } = await import("../site/_worker.js?telemetry=delivery");
    const response = await handlePreview(request(), { ...env, PREVIEW_LOGS: { fetch: (url, init) => worker.fetch(new Request(url, init)) } }, {}, { waitUntil: (promise) => pending.push(promise) });
    assert.equal(await response.text(), "fixture"); await Promise.all(pending);
    assert.equal(stored.filter((e) => e.event === "YW_PREVIEW_TERMINAL").length, 1);
    assert.ok(stored.some((e) => e.stage === "registry")); assert.ok(stored.some((e) => e.stage === "headers"));
    assert.equal(terminal(stored).bytes, 7);
    assert.doesNotMatch(JSON.stringify(stored), new RegExp(`${secret}|cookie|https:`));
  } finally { console.log = priorLog; globalThis.fetch = priorFetch; }
});

test("sink failure cannot replace a successful preview or expose its error", async () => {
  const priorFetch = globalThis.fetch, priorLog = console.log; const pending = [], stored = [];
  console.log = (value) => stored.push(JSON.parse(value));
  globalThis.fetch = async () => new Response("fixture", { headers: { "content-type": "application/pdf" } });
  try {
    const { handlePreview } = await import("../site/_worker.js?telemetry=sink-failure");
    const response = await handlePreview(request(), { ...env, PREVIEW_LOGS: { fetch: async () => { throw Error(secret); } } }, {}, { waitUntil: (promise) => pending.push(promise) });
    assert.equal(response.status, 200); assert.equal(await response.text(), "fixture"); await Promise.all(pending);
    assert.equal(terminal(stored).outcome, "success");
    assert.equal(stored.filter((e) => e.event === "YW_PREVIEW_LOG_DELIVERY_FAILED").length, 1);
    assert.doesNotMatch(JSON.stringify(stored), new RegExp(secret));
  } finally { console.log = priorLog; globalThis.fetch = priorFetch; }
});

test("per-request delivery cap preserves the terminal event", async () => {
  const { createPreviewEmitter } = await import("../site/preview-telemetry.js");
  const priorLog = console.log; console.log = () => {};
  const calls = [], pending = [];
  try {
    const emit = createPreviewEmitter({ fetch: async (_url, init) => { calls.push(JSON.parse(init.body)); return new Response(null, { status: 204 }); } }, { waitUntil: (value) => pending.push(value) });
    for (let index = 0; index < 40; index++) emit({ event: "YW_PREVIEW_STAGE_STARTED", correlation_id: crypto.randomUUID() });
    emit({ event: "YW_PREVIEW_TERMINAL", correlation_id: crypto.randomUUID() });
    await Promise.all(pending);
    assert.equal(calls.length, 21); assert.equal(calls.at(-1).event, "YW_PREVIEW_TERMINAL");
  } finally { console.log = priorLog; }
});

test("an HTML login page for a PDF is logged as unavailable despite the preserved 200 fallback", async () => {
  await fixture("pdf-unavailable", async () => new Response(secret, { headers: { "content-type": "text/html" } }), async (handle, events) => {
    const response = await handle(request(), env);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /PDF 暫不可預覽/);
    assert.equal(terminal(events).outcome, "failure");
    assert.equal(terminal(events).error_code, "preview_pdf_unavailable");
    assert.equal(terminal(events).response_status, 200);
    assert.equal(terminal(events).censored, false);
  });
});
