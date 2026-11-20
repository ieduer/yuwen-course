#!/usr/bin/env node
// Migration 0014: the receipt reconciliation pass must read only rows that still wait
// for a central receipt, and must behave exactly as it did without the index.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  OUTBOX_RECONCILE_SELECTION_SQL,
  OUTBOX_RETRY_SELECTION_SQL,
  learningEvidenceContract,
  reconcileEvidenceOutbox,
} from '../site/learning-evidence-source.js';

const ROOT = resolve(import.meta.dirname, '..');
const INDEX = 'idx_evidence_outbox_reconcile_due';
const MIGRATION = '0014_evidence_outbox_reconcile_due_index.sql';
const V2 = learningEvidenceContract.envelopeSchema;
const CONTRACT = learningEvidenceContract.contractVersion;
const V1 = 'bdfz-learning-evidence-v1';
const migrationFiles = readdirSync(resolve(ROOT, 'migrations')).filter((name) => name.endsWith('.sql')).sort();
const migrationSql = (name) => readFileSync(resolve(ROOT, 'migrations', name), 'utf8');

function openDb({ withIndex }) {
  const db = new DatabaseSync(':memory:');
  for (const name of migrationFiles) {
    if (!withIndex && name === MIGRATION) continue;
    db.exec(migrationSql(name));
  }
  db.prepare('INSERT INTO students (id, uc_slug, display_name, uc_user_id, identity_verified_at) VALUES (?, ?, ?, ?, ?)')
    .run(7, 'reconcile-index-fixture', 'Fixture', 42, '2026-08-13T22:00:00.000Z');
  return db;
}

function sqliteD1(db) {
  return {
    prepare(sql) {
      return {
        sql,
        values: [],
        bind(...values) { this.values = values; return this; },
        async all() { return { results: db.prepare(sql).all(...this.values) }; },
        async first() { return db.prepare(sql).get(...this.values) || null; },
        async run() {
          const result = db.prepare(sql).run(...this.values);
          return { success: true, meta: { changes: Number(result.changes || 0) } };
        },
      };
    },
    async batch(statements) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const results = statements.map((statement) => {
          const result = db.prepare(statement.sql).run(...statement.values);
          return { success: true, meta: { changes: Number(result.changes || 0) } };
        });
        db.exec('COMMIT');
        return results;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

const sqlTime = (msAgo) => new Date(Date.now() - msAgo).toISOString().slice(0, 19).replace('T', ' ');
const isoTime = (msAgo) => new Date(Date.now() - msAgo).toISOString();
const MINUTE = 60_000;

// One row per call. `created`/`receipted` are fixed strings so two databases get identical data.
function insertRow(db, row) {
  const envelope = { schema: row.schema ?? V2, sourceEventId: row.id, sourceSiteKey: 'yw' };
  if ((row.schema ?? V2) === V2) envelope.contractVersion = row.contract ?? CONTRACT;
  if (row.attemptId) envelope.sourceAttemptId = row.attemptId;
  db.prepare(`INSERT INTO learning_interactions
      (source_event_id, student_id, academic_year, lesson_id, interaction_key, event_type, assessment_kind,
       scoring_role, resource_key, registry_version, occurred_at)
    VALUES (?, 7, '2026', 'lesson-1', 'fixture', 'fixture', 'fixture', 'fixture', ?, 'fixture', ?)`)
    .run(row.id, row.id, row.created);
  db.prepare(`INSERT INTO evidence_outbox
      (source_event_id, envelope_json, delivery_status, delivery_attempts, last_attempt_at, created_at,
       central_disposition, central_receipted_at)
    VALUES (?, ?, ?, 1, ?, ?, ?, ?)`)
    .run(row.id, JSON.stringify(envelope), row.status ?? 'enqueued', row.created, row.created,
      row.disposition ?? null, row.receipted ?? null);
}

// Every state the statement distinguishes, repeated so ordering and LIMIT matter.
function mixedFixture(count = 40) {
  const rows = [];
  for (let i = 0; i < count; i += 1) {
    const created = sqlTime((count - i) * 90_000 + (i % 3) * 1000);
    const tag = String(i).padStart(3, '0');
    rows.push({ id: `due-enqueued-${tag}`, created });
    rows.push({ id: `due-pending-${tag}`, created, status: 'pending' });
    rows.push({ id: `due-replay-${tag}`, created, attemptId: `attempt-${tag}` });
    rows.push({ id: `mapping-stale-${tag}`, created, disposition: 'pending_mapping', receipted: isoTime((16 + i) * MINUTE) });
    rows.push({ id: `mapping-leased-${tag}`, created, disposition: 'pending_mapping', receipted: isoTime(5 * MINUTE) });
    rows.push({ id: `lease-stale-${tag}`, created, receipted: isoTime((20 + i) * MINUTE) });
    rows.push({ id: `lease-fresh-${tag}`, created, receipted: isoTime(3 * MINUTE) });
    rows.push({ id: `accepted-${tag}`, created, disposition: 'accepted', receipted: isoTime(60 * MINUTE) });
    rows.push({ id: `quarantined-${tag}`, created, disposition: 'quarantined', receipted: isoTime(60 * MINUTE) });
    rows.push({ id: `legacy-v1-${tag}`, created, schema: V1 });
    rows.push({ id: `delivered-${tag}`, created, status: 'delivered' });
    rows.push({ id: `other-contract-${tag}`, created, contract: 'yw-aplus-older-contract' });
  }
  return rows;
}

const planOf = (db, sql) => db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(20).map((row) => row.detail);
const select = (db, limit) => db.prepare(OUTBOX_RECONCILE_SELECTION_SQL).all(limit);
const selectRetry = (db, limit) => db.prepare(OUTBOX_RETRY_SELECTION_SQL).all(limit);

test('0014 is additive, idempotent and carries no schema or contract literal', () => {
  const sql = migrationSql(MIGRATION);
  assert.equal(migrationFiles.at(-1), MIGRATION, '0014 is the newest migration');
  assert.ok(!sql.replace(/--[^\n]*/g, '').includes(V2) && !sql.replace(/--[^\n]*/g, '').includes(CONTRACT),
    'schema and contract are index keys, not literals, so a later contract version uses the same index');
  const statements = sql.replace(/--[^\n]*/g, '').split(';').map((part) => part.trim()).filter(Boolean);
  assert.equal(statements.length, 1);
  assert.match(statements[0], /^CREATE INDEX IF NOT EXISTS idx_evidence_outbox_reconcile_due\s+ON evidence_outbox\(/);
  assert.doesNotMatch(sql.replace(/--[^\n]*/g, ''), /\b(DROP|DELETE|UPDATE|INSERT|ALTER)\b/i);
  assert.doesNotMatch(sql, /--[^\n]*;/, 'no semicolon inside a comment (line-based migration splitters)');

  const db = openDb({ withIndex: false });
  try {
    for (const row of mixedFixture(6)) insertRow(db, row);
    const before = db.prepare('SELECT * FROM evidence_outbox ORDER BY id').all();
    const tableSql = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'evidence_outbox'").get().sql;
    db.exec(sql);
    db.exec(sql);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sqlite_master WHERE name = ?').get(INDEX).n, 1);
    assert.deepEqual(db.prepare('SELECT * FROM evidence_outbox ORDER BY id').all(), before);
    assert.equal(db.prepare("SELECT sql FROM sqlite_master WHERE name = 'evidence_outbox'").get().sql, tableSql);
    db.exec(`DROP INDEX IF EXISTS ${INDEX}`);
    assert.deepEqual(db.prepare('SELECT * FROM evidence_outbox ORDER BY id').all(), before, 'rollback leaves every row as it was');
  } finally { db.close(); }
});

test('the unchanged reconciliation and retry statements select the due index', () => {
  const indexed = openDb({ withIndex: true });
  const plain = openDb({ withIndex: false });
  try {
    assert.ok(planOf(indexed, OUTBOX_RECONCILE_SELECTION_SQL).some((detail) => detail.includes(INDEX)),
      JSON.stringify(planOf(indexed, OUTBOX_RECONCILE_SELECTION_SQL)));
    assert.ok(planOf(plain, OUTBOX_RECONCILE_SELECTION_SQL).some((detail) => detail.includes('idx_evidence_outbox_pending_id')),
      'baseline plan is the full delivery_status search this migration replaces');
    assert.ok(planOf(indexed, OUTBOX_RETRY_SELECTION_SQL).some((detail) => detail.includes(INDEX)));
    assert.ok(planOf(plain, OUTBOX_RETRY_SELECTION_SQL).some((detail) => detail.includes('idx_evidence_outbox_v2_recovery')));
    // A later contract version or envelope schema is served by the same index.
    for (const sql of [OUTBOX_RECONCILE_SELECTION_SQL.replace(CONTRACT, 'yw-aplus-later-contract'), OUTBOX_RECONCILE_SELECTION_SQL.replace(V2, 'bdfz-learning-evidence-event-v3')]) {
      assert.ok(planOf(indexed, sql).some((detail) => detail.includes(INDEX)), JSON.stringify(planOf(indexed, sql)));
    }
  } finally { indexed.close(); plain.close(); }
});

test('the index holds only rows without a final central decision', () => {
  const db = openDb({ withIndex: true });
  try {
    const rows = mixedFixture(10);
    for (const row of rows) insertRow(db, row);
    const members = () => db.prepare(`SELECT source_event_id FROM evidence_outbox INDEXED BY ${INDEX}
      WHERE (central_disposition IS NULL OR central_disposition = 'pending_mapping') ORDER BY source_event_id`).all().map((row) => row.source_event_id);
    const expected = rows.filter((row) => !row.disposition || row.disposition === 'pending_mapping').map((row) => row.id).sort();
    assert.deepEqual(members(), expected);
    assert.ok(!members().some((id) => /^(accepted|quarantined)-/.test(id)));
    // A central decision removes the row from the index; nothing else changes.
    db.prepare("UPDATE evidence_outbox SET central_disposition = 'accepted', central_receipted_at = ? WHERE source_event_id LIKE 'due-%'")
      .run(isoTime(0));
    assert.ok(!members().some((id) => id.startsWith('due-')));
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  } finally { db.close(); }
});

test('selection returns the same rows in the same order with and without the index', () => {
  const indexed = openDb({ withIndex: true });
  const plain = openDb({ withIndex: false });
  try {
    const rows = mixedFixture(40);
    for (const row of rows) { insertRow(indexed, row); insertRow(plain, row); }
    for (const limit of [1, 5, 20, 50, 200]) {
      const expected = select(plain, limit);
      assert.deepEqual(select(indexed, limit), expected, `limit ${limit}`);
      assert.equal(expected.length, Math.min(limit, 200));
      assert.deepEqual(selectRetry(indexed, limit), selectRetry(plain, limit), `retry limit ${limit}`);
    }
    assert.ok(selectRetry(indexed, 100000).length > 0, 'the retry fixture is not empty');
    const all = select(indexed, 100000).map((row) => row.source_event_id);
    assert.equal(all.length, 40 * 5, 'enqueued, pending, replay, stale mapping and stale lease rows are due');
    assert.ok(all.every((id) => /^(due-enqueued|due-pending|due-replay|mapping-stale|lease-stale)-/.test(id)));
  } finally { indexed.close(); plain.close(); }
});

// The same scripted run on both databases: every RPC batch and the final table must match.
async function scriptedRun(db) {
  const rpc = [];
  let mode = 'accept';
  const env = {
    READING_DB: sqliteD1(db),
    USER_CENTER_EVIDENCE: {
      async getLearningEvidenceDeliveryReceipts(ids) {
        rpc.push({ mode, ids: [...ids] });
        if (mode === 'throw') throw new Error('fixture transport failure');
        const receipts = mode === 'none' ? []
          : ids.filter((id) => mode !== 'partial' || !id.endsWith('-skip')).map((sourceAttemptId) => ({ sourceAttemptId, disposition: 'accepted' }));
        return { schemaVersion: 'bdfz-learning-evidence-delivery-receipts-v1', sourceSiteKey: 'yw', contractVersion: CONTRACT, receipts };
      },
    },
  };
  const results = [];
  const tick = async (limit = 20) => { const result = await reconcileEvidenceOutbox(env, limit); results.push(result); return result; };
  const expire = (like) => db.prepare("UPDATE evidence_outbox SET central_receipted_at = datetime('now', '-16 minutes') WHERE source_event_id LIKE ? AND central_disposition IS NULL").run(like);

  // Idle: nothing due, no RPC.
  for (let i = 0; i < 300; i += 1) insertRow(db, { id: `old-accepted-${i}`, created: sqlTime((400 - i) * MINUTE), disposition: 'accepted', receipted: isoTime(300 * MINUTE) });
  for (let i = 0; i < 30; i += 1) insertRow(db, { id: `old-v1-${i}`, created: sqlTime((900 - i) * MINUTE), schema: V1 });
  assert.deepEqual(await tick(), { checked: 0, receipted: 0 });
  assert.equal(rpc.length, 0);

  // Normal: six due rows, two not yet reported by User Center.
  mode = 'partial';
  for (let i = 0; i < 6; i += 1) insertRow(db, { id: `normal-${i}${i >= 4 ? '-skip' : ''}`, created: sqlTime((60 - i) * 1000) });
  assert.deepEqual(await tick(), { checked: 6, receipted: 4 });
  assert.deepEqual(await tick(), { checked: 0, receipted: 0 }, 'unreported rows hold their fifteen-minute lease');
  assert.equal(rpc.length, 1);

  // Burst: 120 due rows drain twenty at a time, oldest first, each asked about once.
  mode = 'accept';
  for (let i = 0; i < 120; i += 1) insertRow(db, { id: `burst-${String(i).padStart(3, '0')}`, created: sqlTime((50 - Math.floor(i / 3)) * 1000) });
  for (let i = 0; i < 6; i += 1) assert.deepEqual(await tick(20), { checked: 20, receipted: 20 });
  assert.deepEqual(await tick(20), { checked: 0, receipted: 0 });

  // Interrupted: the receipt read fails after the lease was taken.
  mode = 'throw';
  for (let i = 0; i < 10; i += 1) insertRow(db, { id: `cut-${i}`, created: sqlTime((30 - i) * 1000) });
  assert.deepEqual(await tick(), { checked: 10, receipted: 0 });
  assert.deepEqual(await tick(), { checked: 0, receipted: 0 }, 'a failed read is not repeated inside the lease');
  mode = 'accept';
  assert.deepEqual(await tick(), { checked: 0, receipted: 0 });
  expire('cut-%');
  assert.deepEqual(await tick(), { checked: 10, receipted: 10 });

  // Late receipt for the two unreported rows once their lease expired.
  expire('normal-%');
  assert.deepEqual(await tick(), { checked: 2, receipted: 2 });

  // Twenty overlapping isolates on five due rows make one RPC.
  for (let i = 0; i < 5; i += 1) insertRow(db, { id: `overlap-${i}`, created: sqlTime((10 - i) * 1000) });
  const before = rpc.length;
  const wave = await Promise.all(Array.from({ length: 20 }, () => reconcileEvidenceOutbox({ ...env, READING_DB: sqliteD1(db) }, 20)));
  assert.equal(rpc.length - before, 1);
  assert.equal(wave.reduce((sum, result) => sum + result.checked, 0), 5);
  assert.equal(wave.reduce((sum, result) => sum + result.receipted, 0), 5);
  assert.deepEqual(await tick(), { checked: 0, receipted: 0 });

  const requested = rpc.filter((call) => call.mode !== 'throw').flatMap((call) => call.ids);
  const accepted = rpc.filter((call) => call.mode === 'accept' || call.mode === 'partial').flatMap((call) => call.ids.filter((id) => call.mode !== 'partial' || !id.endsWith('-skip')));
  assert.equal(new Set(accepted).size, accepted.length, 'no row is receipted twice');
  const table = db.prepare(`SELECT source_event_id, delivery_status, central_disposition,
      central_receipted_at IS NOT NULL AS has_receipt_time, delivered_at IS NOT NULL AS has_delivered_time
    FROM evidence_outbox ORDER BY id`).all();
  assert.equal(table.filter((row) => /^(normal|burst|cut|overlap)-/.test(row.source_event_id) && row.central_disposition !== 'accepted').length, 0,
    'no receipt is lost');
  assert.equal(table.filter((row) => row.source_event_id.startsWith('old-v1-') && (row.central_disposition !== null || row.has_receipt_time)).length, 0,
    'historical v1 rows are never claimed or receipted');
  return { rpc, results, table, requested };
}

test('normal, burst, interrupted and overlapping reconciliation is identical with and without the index', async () => {
  const indexed = openDb({ withIndex: true });
  const plain = openDb({ withIndex: false });
  try {
    const withIndex = await scriptedRun(indexed);
    const without = await scriptedRun(plain);
    assert.deepEqual(withIndex.results, without.results);
    assert.deepEqual(withIndex.rpc, without.rpc, 'the same receipt reads in the same order');
    assert.deepEqual(withIndex.table, without.table);
    assert.equal(indexed.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  } finally { indexed.close(); plain.close(); }
});

test('real workerd D1: an idle pass reads a handful of rows instead of the whole table', async (t) => {
  let Miniflare, Log, LogLevel;
  try { ({ Miniflare, Log, LogLevel } = await import('miniflare')); }
  catch { t.skip('miniflare is not installed'); return; }
  const mf = new Miniflare({ log: new Log(LogLevel.NONE), modules: true, compatibilityDate: '2026-05-12',
    script: 'export default {fetch(){return new Response("ok")}}', d1Databases: { READING_DB: 'reconcile-index-fixture' } });
  try {
    const db = await mf.getD1Database('READING_DB');
    for (const name of migrationFiles) {
      const statements = migrationSql(name).replace(/--[^\n]*/g, '').match(/\s*CREATE TRIGGER[\s\S]*?\nEND;|[^;]+;/gi) || [];
      for (const statement of statements) await db.prepare(statement).run();
    }
    await db.prepare("INSERT INTO students(id,uc_slug,display_name,uc_user_id,identity_verified_at) VALUES(7,'fixture','Fixture',42,'2026-08-01T00:00:00Z')").run();
    const rows = [];
    for (let i = 0; i < 3000; i += 1) rows.push({ id: `accepted-${i}`, disposition: 'accepted', receipted: isoTime(60 * MINUTE), schema: V2 });
    for (let i = 0; i < 150; i += 1) rows.push({ id: `legacy-${i}`, disposition: null, receipted: null, schema: V1 });
    for (let offset = 0; offset < rows.length; offset += 250) {
      const batch = [];
      for (const row of rows.slice(offset, offset + 250)) {
        const created = sqlTime(90 * MINUTE);
        const envelope = { schema: row.schema, sourceEventId: row.id, pad: 'x'.repeat(1200) };
        if (row.schema === V2) envelope.contractVersion = CONTRACT;
        batch.push(db.prepare(`INSERT INTO learning_interactions(source_event_id,student_id,academic_year,lesson_id,interaction_key,event_type,
          assessment_kind,scoring_role,resource_key,registry_version,occurred_at) VALUES(?1,7,'2026','lesson-1','f','f','f','f',?1,'f',?2)`).bind(row.id, created));
        batch.push(db.prepare(`INSERT INTO evidence_outbox(source_event_id,envelope_json,delivery_status,delivery_attempts,last_attempt_at,created_at,
          central_disposition,central_receipted_at) VALUES(?,?,'enqueued',1,?,?,?,?)`).bind(row.id, JSON.stringify(envelope), created, created, row.disposition, row.receipted));
      }
      await db.batch(batch);
    }
    const idle = await db.prepare(OUTBOX_RECONCILE_SELECTION_SQL).bind(20).all();
    assert.equal(idle.results.length, 0);
    assert.ok(idle.meta.rows_read <= 5, `idle pass read ${idle.meta.rows_read} rows`);
    const plan = (await db.prepare(`EXPLAIN QUERY PLAN ${OUTBOX_RECONCILE_SELECTION_SQL}`).bind(20).all()).results.map((row) => row.detail);
    assert.ok(plan.some((detail) => detail.includes(INDEX)), JSON.stringify(plan));
    // Sensitivity: without the index the same statement reads every enqueued row.
    await db.prepare(`DROP INDEX ${INDEX}`).run();
    const baseline = await db.prepare(OUTBOX_RECONCILE_SELECTION_SQL).bind(20).all();
    assert.equal(baseline.results.length, 0);
    assert.ok(baseline.meta.rows_read >= 3150, `baseline read ${baseline.meta.rows_read} rows`);
  } finally { await mf.dispose(); }
});
