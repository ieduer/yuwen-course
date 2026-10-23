import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { evaluationHealthSnapshot, sendEvaluationHeartbeat } from '../site/evaluation-heartbeat.js';

const KEYS=['asOf','backgroundEnabled','lastSuccessfulScanAt','oldestPendingAgeSeconds','pendingCount','schema','version'];
const backlog=async()=>({pending_count:2,oldest_pending_age_seconds:40});
const env=(extra={})=>({YW_BACKGROUND_EVALUATION_ENABLED:'true',
  READING_DB:{prepare:(sql)=>{assert.match(sql,/FROM learning_evaluation_scheduler WHERE id=1/);return {first:async()=>({last_scan_at:Date.parse('2026-10-22T09:00:00Z')})};}},...extra});

test('the snapshot is exactly the aggregate the EvaluationHealth pull returned',async()=>{
  const s=await evaluationHealthSnapshot(env(),backlog);
  assert.deepEqual(Object.keys(s).sort(),KEYS);
  assert.equal(s.pendingCount,2);assert.equal(s.oldestPendingAgeSeconds,40);assert.equal(s.lastSuccessfulScanAt,'2026-10-22T09:00:00.000Z');
});
test('a heartbeat is pushed once per call with the aggregate only',async()=>{
  const sent=[];const r=await sendEvaluationHeartbeat(env({PULSE_HEARTBEAT:{record:async(v)=>{sent.push(v);return {accepted:true};}}}),backlog);
  assert.deepEqual(r,{sent:true});assert.equal(sent.length,1);assert.deepEqual(Object.keys(sent[0]).sort(),KEYS);
});
test('no binding, a refusal or a slow Pulse never throws into the scheduler tick',async()=>{
  assert.deepEqual(await sendEvaluationHeartbeat(env(),backlog),{sent:false,reason:'not_configured'});
  const logs=[];
  assert.deepEqual(await sendEvaluationHeartbeat(env({PULSE_HEARTBEAT:{record:async()=>{throw new Error('private detail');}}}),backlog,{log:(v)=>logs.push(v)}),{sent:false,reason:'unavailable'});
  assert.deepEqual(await sendEvaluationHeartbeat(env({PULSE_HEARTBEAT:{record:()=>new Promise(()=>{})}}),backlog,{timeoutMs:10,log:(v)=>logs.push(v)}),{sent:false,reason:'timeout'});
  assert.equal(logs.some((l)=>l.includes('private detail')),false);
});
test('the scheduler sends the heartbeat after the tick even when the tick fails, and keeps the pull entrypoint',()=>{
  const src=readFileSync(new URL('../site/evaluation-scheduler.js',import.meta.url),'utf8');
  assert.match(src,/try \{ await runScheduledEvaluations\(env\); \} finally \{ await sendEvaluationHeartbeat\(env,evaluationBacklog\); \}/);
  assert.match(src,/export class EvaluationHealth extends WorkerEntrypoint/);
  const toml=readFileSync(new URL('../wrangler.evaluation.toml',import.meta.url),'utf8');
  assert.match(toml,/binding = "PULSE_HEARTBEAT"\nservice = "pulse"\nentrypoint = "EvaluationHeartbeat"/);
  assert.match(toml,/crons = \["\* \* \* \* \*"\]/);
});

// Evaluation clock (2026-10-23): alarm-driven ticks, cron watchdog, kill switch. The module imports cloudflare:workers,
// so the clock is exercised through its source contract plus a small harness with the same logic boundaries.
test('the clock ticks heartbeat-first, always re-arms for the next minute, and the cron is only its watchdog',()=>{
  const src=readFileSync(new URL('../site/evaluation-scheduler.js',import.meta.url),'utf8');
  assert.match(src,/export class EvaluationClock extends DurableObject/);
  assert.match(src,/export async function evaluationTick\(env\)\{\n  await sendEvaluationHeartbeat\(env,evaluationBacklog\);\n  await runScheduledEvaluations\(env\);\n\}/,'heartbeat before the work');
  assert.match(src,/finally \{\n      await this\.ctx\.storage\.put\('lastTickAt',started\);\n      await this\.ctx\.storage\.setAlarm\(nextClockAt\(Date\.now\(\)\)\);/,'the next alarm is set whatever the tick did');
  assert.match(src,/if\(this\.env\.YW_EVALUATION_CLOCK!=='on'\) return;/,'kill switch stops the alarm');
  assert.match(src,/if\(clockOn\(env\)\) \{ ctx\.waitUntil\(watchdogTick\(env\)\); return; \}/);
  assert.match(src,/if\(state&&!state\.overdue\) return \{ran:false,state\};/,'a healthy clock means the cron does not tick');
  assert.match(src,/try \{ await runScheduledEvaluations\(env\); \} finally \{ await sendEvaluationHeartbeat\(env,evaluationBacklog\); \}/,'clock off: the old cron path is unchanged');
  const toml=readFileSync(new URL('../wrangler.evaluation.toml',import.meta.url),'utf8');
  assert.match(toml,/\[\[durable_objects\.bindings\]\]\nname = "EVALUATION_CLOCK"\nclass_name = "EvaluationClock"/);
  assert.match(toml,/\[\[migrations\]\]\ntag = "v1-evaluation-clock"\nnew_sqlite_classes = \["EvaluationClock"\]/);
  assert.match(toml,/crons = \["\* \* \* \* \*"\]/);
});
test('next clock time is one second past the next minute boundary, and the main module exports only handlers, classes and functions',()=>{
  const exported=[...readFileSync(new URL('../site/evaluation-scheduler.js',import.meta.url),'utf8').matchAll(/^export (const|let|var) (\w+)/gm)].map(m=>m[2]);
  assert.deepEqual(exported,[],'workerd refuses non-function named exports of the main module');
  const src=readFileSync(new URL('../site/evaluation-scheduler.js',import.meta.url),'utf8');
  const fn=new Function('CLOCK_PERIOD_MS',`return ${src.match(/const nextClockAt=(\(now\)=>[^;]+);/)[1]};`)(60000);
  assert.equal(fn(Date.parse('2026-10-23T16:00:00.000Z')),Date.parse('2026-10-23T16:01:01.000Z'));
  assert.equal(fn(Date.parse('2026-10-23T16:00:59.999Z')),Date.parse('2026-10-23T16:01:01.000Z'));
});
