import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Log, LogLevel, Miniflare } from 'miniflare';
import { sourceEventStatement } from '../site/learning-evaluation-events.js';
const root = resolve(import.meta.dirname, '..');

test('actual Worker authenticates two owners and reads full events without model, grading or outbox writes', async () => {
  let contextReads = 0;
  const mf = new Miniflare({ log: new Log(LogLevel.NONE), workers: [
    { name: 'yw', modules: true, modulesRoot: root, scriptPath: resolve(root, 'site/_worker.js'),
      compatibilityDate: '2026-05-12', modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
      d1Databases: { READING_DB: 'recorder-source-fixture' },
      serviceBindings: { USER_CENTER_EVIDENCE: { name: 'identity', entrypoint: 'Identity' },
        ASSETS: () => new Response('not found', { status: 404 }) },
      outboundService(request) {
        assert.equal(request.url, 'https://my.bdfz.net/api/learning-operations?context=1');
        assert.equal(request.method, 'GET'); contextReads++;
        const cookie = request.headers.get('cookie');
        assert.ok(['bdfz_uc_session=fixture-a', 'bdfz_uc_session=fixture-b'].includes(cookie));
        return Response.json({ schemaVersion: 'bdfz-learning-operation-v1', scope: (cookie.endsWith('a') ? 'a' : 'b').repeat(64) });
      } },
    { name: 'identity', modules: true, compatibilityDate: '2026-05-12',
      script: `import { WorkerEntrypoint } from 'cloudflare:workers';
        export class Identity extends WorkerEntrypoint {
          resolveSession(cookie) {
            if(!['bdfz_uc_session=fixture-a','bdfz_uc_session=fixture-b'].includes(cookie)) return {authenticated:false};
            const a=cookie.endsWith('a'); return {authenticated:true,sourceSiteKey:'yw',userId:a?41:42,slug:a?'fixture-a':'fixture-b',displayName:'Fixture'};
          }
        }
        export default {fetch(){return new Response('not found',{status:404});}};` },
  ] });
  try {
    const db = await mf.getD1Database('READING_DB', 'yw');
    for (const file of readdirSync(resolve(root, 'migrations')).filter(x => x.endsWith('.sql')).sort()) {
      const sql = readFileSync(resolve(root, 'migrations', file), 'utf8').replace(/--[^\n]*/g, '');
      for (const statement of sql.match(/\s*CREATE TRIGGER[\s\S]*?\nEND;|[^;]+;/gi) || []) await db.prepare(statement).run();
    }
    await db.prepare("INSERT INTO students(id,uc_slug,display_name,uc_user_id) VALUES(1,'fixture-a','Fixture',41),(2,'fixture-b','Fixture',42)").run();
    const answer = '完整原文\n𠮷與 <b>HTML</b> 保留。'.repeat(14000);
    for (const owner of [1, 2]) {
      const source = `yw-source-fixture-${owner}`;
      await db.prepare(`INSERT INTO learning_pending_submissions
        (source_event_id,student_id,client_mutation_id,lesson_id,interaction_key,resource_key,raw_payload_json,captured_at,updated_at)
        VALUES(?,?,?,'lesson-1','structure','lesson-1:structure','{}','2026-09-25T01:02:03Z','2026-09-25T01:02:03Z')`)
        .bind(source, owner, source).run();
      await (await sourceEventStatement(db, { sourceEventId: source, studentId: owner, resourceKey: 'lesson-1:structure', resourceVersion: 'fixture-v1' },
        { action: 'answer.submit', kind: 'submit', actor: 'student', status: 'succeeded', at: '2026-09-25T01:02:03Z', content: { answer, ownerFixture: owner } })).run();
    }
    const url = 'https://yw.bdfz.net/api/learning/recorder-events';
    assert.equal((await mf.dispatchFetch(url)).status, 401); assert.equal(contextReads, 0);
    assert.equal((await mf.dispatchFetch(url, { headers: { Cookie: 'bdfz_uc_session=unknown' } })).status, 401);
    for (const [owner, letter] of [[1, 'a'], [2, 'b']]) {
      const response = await mf.dispatchFetch(url, { headers: { Cookie: `bdfz_uc_session=fixture-${letter}; unrelated=not-forwarded` } });
      assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'private, no-store');
      const batch = await response.json(); assert.equal(batch.scope, letter.repeat(64)); assert.equal(batch.events.length, 1);
      const operation = JSON.parse(batch.events[0].payload);
      assert.equal(operation.content.answer, answer); assert.equal(operation.content.ownerFixture, owner);
      assert.equal(operation.occurredAt, '2026-09-25T01:02:03Z'); assert.equal(batch.hasMore, false);
      assert.equal((await (await mf.dispatchFetch(url + '?after=' + batch.nextCursor,
        { headers: { Cookie: `bdfz_uc_session=fixture-${letter}` } })).json()).events.length, 0);
    }
    for (const table of ['learning_interactions', 'learning_evaluations', 'evidence_outbox', 'learning_evaluation_executions']) {
      assert.equal((await db.prepare(`SELECT COUNT(*) n FROM ${table}`).first()).n, 0, table);
    }
    assert.equal(contextReads, 4);
  } finally { await mf.dispose(); }
});
