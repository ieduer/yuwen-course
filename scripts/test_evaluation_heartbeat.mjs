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
