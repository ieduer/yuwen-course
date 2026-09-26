import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { readRecorderSource } from '../site/learning-recorder-source.js';
import { canonicalEventJson, eventDigest, sourceEventStatement } from '../site/learning-evaluation-events.js';
import { createRecorderBridge } from '../site/assets/learning-recorder-bridge.js';
import { normalizeLearningOperation } from './fixtures/uc-learning-operation-journal-65be121.js';

const scope = 'a'.repeat(64), otherScope = 'b'.repeat(64);
function database() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('../migrations/0007_learning_pending_submissions.sql', import.meta.url), 'utf8'));
  sql.exec(readFileSync(new URL('../migrations/0009_durable_evaluation_jobs.sql', import.meta.url), 'utf8'));
  return { sql, prepare(query) { const q = sql.prepare(query); let values = [];
    return { bind(...args) { values = args; return this; }, async all() { return { results: q.all(...values) }; },
      async run() { return q.run(...values); } }; } };
}
async function seed(db, owner, n, content = { answer: '原文\n保留空白、<b>標記</b>及𠮷。' }) {
  const sourceId = `recorder-fixture-${owner}-${n}`;
  db.sql.prepare(`INSERT INTO learning_pending_submissions
    (source_event_id,student_id,client_mutation_id,lesson_id,interaction_key,resource_key,raw_payload_json,captured_at,updated_at)
    VALUES(?,?,?,'lesson-1','structure','lesson-1:structure','{}','2026-09-25T01:02:03Z','2026-09-25T01:02:03Z')`)
    .run(sourceId, owner, sourceId);
  await (await sourceEventStatement(db, { sourceEventId: sourceId, studentId: owner, resourceKey: 'lesson-1:structure', resourceVersion: 'fixture-v1' },
    { action: 'answer.submit', kind: 'submit', actor: 'student', status: 'succeeded', at: '2026-09-25T01:02:03Z', content })).run();
}
function source(db, options = {}) {
  return readRecorderSource({ request: new Request(`https://yw.bdfz.net/api/learning/recorder-events?after=${options.after || 0}`),
    db, student: { id: 1 }, cookieHeader: 'bdfz_uc_session=synthetic-only',
    fetchContext: async (url, init) => {
      assert.equal(url, 'https://my.bdfz.net/api/learning-operations?context=1');
      assert.equal(init.redirect, 'manual');
      assert.deepEqual(Object.keys(init.headers).sort(), ['Accept', 'Cookie', 'Origin']);
      return Response.json({ schemaVersion: 'bdfz-learning-operation-v1', scope });
    }, ...options });
}

test('source SQL is owner-scoped, paginated beyond 200, immutable and schema-compatible', async () => {
  const db = database();
  try {
    for (let n = 0; n < 205; n++) { await seed(db, 1, n); if (n % 5 === 0) await seed(db, 2, n); }
    const ids = new Set(); let after = 0, more = true;
    while (more) {
      const response = await source(db, { after });
      assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'private, no-store');
      const batch = await response.json(); assert.ok(batch.events.length <= 32); assert.equal(batch.scope, scope);
      for (const row of batch.events) {
        assert.equal(await eventDigest(row.payload), row.sha256);
        const operation = JSON.parse(row.payload);
        assert.match(operation.context.sourceContext.sourceEventId, /^recorder-fixture-1-/);
        assert.equal(operation.occurredAt, '2026-09-25T01:02:03Z');
        assert.equal(operation.content.answer, '原文\n保留空白、<b>標記</b>及𠮷。');
        assert.equal(normalizeLearningOperation({ ...operation, scope }).ok, true);
        ids.add(operation.operationId);
      }
      after = batch.nextCursor; more = batch.hasMore;
    }
    assert.equal(ids.size, 205);
    assert.equal((await (await source(db, { after })).json()).events.length, 0);
    assert.throws(() => db.sql.exec("UPDATE learning_evaluation_events SET payload_json='{}'"), /immutable/);
  } finally { db.sql.close(); }
});

test('source page boundaries preserve full large content and original bytes', async () => {
  const db = database();
  try {
    const answer = '全原文\n'.repeat(200000); // More than two MiB; never split or truncate.
    await seed(db, 1, 1, { answer }); await seed(db, 1, 2);
    const first = await (await source(db)).json();
    assert.equal(first.events.length, 1); assert.equal(first.hasMore, true);
    assert.equal(JSON.parse(first.events[0].payload).content.answer, answer);
    assert.equal((await (await source(db, { after: first.nextCursor })).json()).events.length, 1);
  } finally { db.sql.close(); }
});

test('missing auth, invalid cursors, UC failure and tampered source fail closed', async () => {
  const db = database();
  try {
    let reads = 0;
    const fetchContext = async () => { reads++; return Response.json({}, { status: 503 }); };
    assert.equal((await source(db, { cookieHeader: '', fetchContext })).status, 401);
    assert.equal((await source(db, { student: null, fetchContext })).status, 401);
    assert.equal((await source(db, { after: '-1', fetchContext })).status, 400); assert.equal(reads, 0);
    assert.equal((await source(db, { fetchContext })).status, 503);
    assert.equal((await source(db, { fetchContext: async () => Response.json({}, { status: 401 }) })).status, 401);
    await seed(db, 1, 1);
    // Corruption fixture bypasses only its isolated SQLite trigger.
    db.sql.exec("DROP TRIGGER learning_event_no_update; UPDATE learning_evaluation_events SET payload_sha256='bad'");
    const corrupt = await source(db); assert.equal(corrupt.status, 503);
    assert.deepEqual(await corrupt.json(), { code: 'learning_source_integrity_failed' });
  } finally { db.sql.close(); }
});

async function event(sequence, changes = {}) {
  const operation = { schemaVersion: 'bdfz-learning-operation-v1', siteKey: 'yw', operationId: `yw:test-event-${sequence}`,
    sessionKey: 'yw:test-session', resourceKey: 'lesson:1', resourceVersion: 'fixture-v1', action: 'assistant.reply',
    actor: 'assistant', status: 'succeeded', occurredAt: '2026-09-25T01:02:03Z', parentOperationId: '', revisesOperationId: '',
    content: { answer: `完整第${sequence}筆\n原文` }, context: {}, assessment: { promptTokenCount: null }, ...changes };
  const payload = canonicalEventJson(operation);
  return { sequence, payload, sha256: await eventDigest(payload), byteLength: Buffer.byteLength(payload) };
}
function fixture(events, overrides = {}) {
  let cursor = 0, online = true, sourceScope = scope;
  const stored = new Map(), states = [], scheduled = [], requests = [];
  const r = { scope, closed: false, close() { this.closed = true; }, async flush() { return {}; },
    async record(operation) { const old = stored.get(operation.operationId);
      if (old) assert.deepEqual(old, operation); stored.set(operation.operationId, structuredClone(operation)); } };
  const options = {
    identity: () => ({ getSession: async () => ({ authenticated: true }), createLearningRecorder: async () => ({ ...r }) }),
    cursors: { get: async () => cursor, advance: async (_owner, next) => { cursor = Math.max(cursor, next); } },
    fetchSource: async (path, init) => {
      requests.push(path); assert.equal(init.credentials, 'same-origin');
      const after = Number(new URL(path, 'https://yw.bdfz.net').searchParams.get('after'));
      const rows = events.filter(e => e.sequence > after).slice(0, 32);
      return Response.json({ ok: true, scope: sourceScope, events: rows, nextCursor: rows.at(-1)?.sequence ?? after,
        hasMore: events.some(e => e.sequence > (rows.at(-1)?.sequence ?? after)) });
    },
    active: () => online, onState: state => states.push(state), schedule: fn => { scheduled.push(fn); return fn; }, cancel: () => {},
    ...overrides,
  };
  const bridge = createRecorderBridge(options);
  return { bridge, options, stored, states, requests, scheduled, get cursor() { return cursor; },
    offline() { online = false; }, online() { online = true; }, changeScope() { sourceScope = otherScope; } };
}

test('bridge continues beyond 200 in bounded batches and resumes its exact cursor on reload', async () => {
  const events = await Promise.all(Array.from({ length: 205 }, (_, i) => event(i + 1)));
  const f = fixture(events);
  assert.deepEqual(await f.bridge.run(), { queued: 128, hasMore: true }); assert.equal(f.scheduled.length, 1);
  assert.equal(f.cursor, 128);
  f.bridge.close(); const reloaded = createRecorderBridge(f.options);
  assert.deepEqual(await reloaded.run(), { queued: 77, hasMore: false }); assert.equal(f.stored.size, 205);
  assert.equal((await reloaded.run()).queued, 0); reloaded.close();
});

test('scope mismatch and full-page hash mismatch cannot advance or misattribute any event', async () => {
  const rows = [await event(1), await event(2)];
  const f = fixture(rows); f.changeScope();
  assert.equal((await f.bridge.run()).error, 'learning_account_changed'); assert.equal(f.cursor, 0); assert.equal(f.stored.size, 0);
  const broken = fixture([rows[0], { ...rows[1], sha256: '0'.repeat(64) }]);
  assert.equal((await broken.bridge.run()).error, 'learning_source_integrity_failed');
  assert.equal(broken.cursor, 0); assert.equal(broken.stored.size, 0);
});

test('cursor moves only after durable acceptance; interrupted cursor save replays exact content', async () => {
  const rows = [await event(1)];
  const f = fixture(rows, { cursors: { get: async () => 0, advance: async () => { throw new Error('disk failure'); } } });
  assert.equal((await f.bridge.run()).error, 'learning_recording_unavailable');
  const exact = structuredClone(f.stored.get('yw:test-event-1'));
  await f.bridge.run(); assert.equal(f.stored.size, 1); assert.deepEqual(f.stored.get('yw:test-event-1'), exact);
  const rejected = fixture(rows, { identity: () => ({ getSession: async () => ({ authenticated: true }), createLearningRecorder: async () => ({
    scope, close() {}, async flush() {}, async record() { throw new Error('storage unavailable'); },
  }) }) });
  await rejected.bridge.run(); assert.equal(rejected.cursor, 0);
});

test('offline, account invalidation and in-flight restoration retain the pending source', async () => {
  let unblock; const rows = [await event(1)]; const f = fixture(rows);
  const original = f.options.fetchSource;
  let first = true;
  f.options.fetchSource = async (...args) => { if (first) { first = false; await new Promise(resolve => { unblock = resolve; }); } return original(...args); };
  const b = createRecorderBridge(f.options);
  f.offline(); assert.deepEqual(await b.run(), { inactive: true }); assert.equal(f.requests.length, 0);
  f.online(); const prior = b.run();
  while (!unblock) await new Promise(resolve => setImmediate(resolve));
  b.suspend(); const restored = b.run(); unblock();
  assert.deepEqual(await prior, { stale: true }); assert.equal((await restored).queued, 1); assert.equal(f.cursor, 1); b.close();
});

test('large replies, null usage and source time are passed unchanged to the shared recorder', async () => {
  const answer = '正文𠮷\n'.repeat(50000), row = await event(1, { content: { answer }, occurredAt: null });
  const f = fixture([row]); await f.bridge.run();
  const operation = f.stored.get('yw:test-event-1');
  assert.equal(operation.content.answer, answer); assert.equal(operation.occurredAt, null);
  assert.equal(operation.assessment.promptTokenCount, null); assert.equal(Object.hasOwn(operation, 'scope'), false);
});

test('reload keeps exhausted or rejected delivery visible without resetting its retry budget', async () => {
  let retries = 0;
  const f = fixture([], { identity: () => ({ getSession: async () => ({ authenticated: true }), createLearningRecorder: async () => ({
    scope, close() {}, async flush() {}, async pending() { return [{ state: 'review', attempts: 1 }]; },
    retry() { retries++; },
  }) }) });
  await f.bridge.run();
  assert.deepEqual(f.states.at(-1), { status: 'needs_attention', code: 'learning_delivery_needs_attention' });
  assert.equal(retries, 0);
});
