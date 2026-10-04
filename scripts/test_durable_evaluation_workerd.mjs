import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {Log,LogLevel,Miniflare} from 'miniflare';
const ROOT=resolve(import.meta.dirname,'..');

test('real workerd/D1 preserves a 202 submission across independent foreground and scheduler runtimes',async()=>{
  let attempts=0;const answer=JSON.stringify({score:85,verdict:'fixture verdict',strength:'fixture strength',gap:'fixture gap',nextQuestion:'fixture question'});
  const common={compatibilityDate:'2026-05-12',modules:true,modulesRoot:ROOT,
    modulesRules:[{type:'ESModule',include:['**/*.js']}],
    d1Databases:{READING_DB:'durable-evaluation-fixture'},
    bindings:{READING_TEST_SLUG:'durable-workerd-fixture',APIS_CALLER_TOKEN:'fixture-not-a-secret',
      YW_DURABLE_EVALUATION_ENABLED:'true',YW_BACKGROUND_EVALUATION_ENABLED:'true',YW_EVALUATION_MACHINE_SECRET:'cd'.repeat(32)},
    serviceBindings:{
      ASSETS(request){const pathname=new URL(request.url).pathname;
        if(!/^\/data\/[a-zA-Z0-9_./-]+\.json$/.test(pathname)||pathname.includes('..'))return new Response('not found',{status:404});
        try{return new Response(readFileSync(resolve(ROOT,'site'+pathname)),{headers:{'content-type':'application/json'}});}catch{return new Response('not found',{status:404});}},
      APIS(){attempts++;return attempts===1?Response.json({error_code:'UPSTREAM_UNAVAILABLE'},{status:503})
        :Response.json({answer,model:'gemini-3.5-flash-lite',raw_response:{modelVersion:'fixture-revision'}});},
    },outboundService(){throw new Error('unexpected external request');},
  };
  const mf=new Miniflare({log:new Log(LogLevel.NONE),workers:[
    {...common,name:'foreground',scriptPath:resolve(ROOT,'site/_worker.js')},
    {...common,serviceBindings:{},bindings:{YW_BACKGROUND_EVALUATION_ENABLED:'true',YW_EVALUATION_MACHINE_SECRET:'cd'.repeat(32)},
      name:'scheduler',scriptPath:resolve(ROOT,'scripts/fixtures/durable-scheduler-harness.js'),
      // Native workerd bridge preserves the exact server-to-server headers.
      // Node dispatchFetch injects sec-fetch-mode and correctly fails auth.
      outboundService:'foreground'},
    {name:'health-probe',compatibilityDate:'2026-05-12',modules:true,
      script:"export default {async fetch(request,env){return Response.json(await env.HEALTH.read());}}",
      serviceBindings:{HEALTH:{name:'scheduler',entrypoint:'EvaluationHealth'}}},
  ]});
  try {
    const db=await mf.getD1Database('READING_DB','foreground');
    for(const file of readdirSync(resolve(ROOT,'migrations')).filter(x=>x.endsWith('.sql')).sort()){
      // D1 exec consumes one statement per line; prepare accepts complete SQL,
      // including the migration's multi-line trigger as one statement.
      const sql=readFileSync(resolve(ROOT,'migrations',file),'utf8').replace(/--[^\n]*/g,'');
      const statements=sql.match(/\s*CREATE TRIGGER[\s\S]*?\nEND;|[^;]+;/gi)||[];
      for(const statement of statements)await db.prepare(statement).run();
    }
    await db.prepare('INSERT INTO students(id,uc_slug,display_name,uc_user_id,identity_verified_at) VALUES(7,?,?,42,?)')
      .bind('durable-workerd-fixture','Fixture',new Date().toISOString()).run();
    const body={lessonId:'lesson-1458',interaction:'structure',input:{reason:'合成測試：比較兩處字句的前後照應，並說明文章結構推進。'},clientMutationId:'workerd-durable-fixture'};
    const request=()=>({method:'POST',headers:{'content-type':'application/json',origin:'https://yw.bdfz.net'},body:JSON.stringify(body)});
    const scheduler=await mf.getWorker('scheduler');
    const response=await mf.dispatchFetch('https://yw.bdfz.net/api/interaction-check',request()),pending=await response.json();
    assert.equal(response.status,202,JSON.stringify(pending));assert.ok(pending.pendingId);assert.equal(attempts,1);
    assert.equal((await mf.dispatchFetch('https://yw.bdfz.net/api/interaction-check',request())).status,202);assert.equal(attempts,1);
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM learning_interactions').first()).n,0);
    await db.prepare('UPDATE learning_evaluation_jobs SET next_attempt_at=0').run();
    const drained=await scheduler.fetch('https://fixture.invalid/');assert.equal(drained.status,200);
    assert.equal((await drained.json()).completed,1);assert.equal(attempts,2);
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM learning_evaluation_machine_nonces').first()).n,1);
    const health=await (await (await mf.getWorker('health-probe')).fetch('https://fixture.invalid/')).json();
    assert.equal(health.schema,'yw-evaluation-health-v1');assert.equal(health.pendingCount,0);
    assert.equal(health.backgroundEnabled,true);assert.ok(health.lastSuccessfulScanAt);
    assert.deepEqual(Object.keys(health).sort(),['asOf','backgroundEnabled','lastSuccessfulScanAt','oldestPendingAgeSeconds','pendingCount','schema','version']);
    const facts=(await db.prepare('SELECT payload_json FROM learning_evaluation_events ORDER BY rowid').all()).results.map(r=>JSON.parse(r.payload_json));
    assert.deepEqual(facts.filter(r=>r.action==='ai.request').map(r=>r.context.sourceContext.attemptNumber),[1,2]);
    assert.equal(facts.filter(r=>r.action==='ai.failure').length,1);
    assert.equal(facts.filter(r=>r.action==='evaluation.result').length,1);
    const eventIds=new Set(facts.map(r=>r.operationId));
    assert.ok(facts.every(r=>!r.parentOperationId || eventIds.has(r.parentOperationId)));
    assert.ok(facts.every(r=>!Object.hasOwn(r,'scope')));
    const reply=await db.prepare('SELECT * FROM learning_evaluation_replies').first();
    assert.equal(reply.answer_text,answer);assert.equal(reply.model_version,'fixture-revision');
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM learning_interactions').first()).n,1);
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM evidence_outbox').first()).n,1);
    assert.equal((await db.prepare('SELECT state FROM learning_evaluation_jobs').first()).state,'completed');
    const status=await mf.dispatchFetch('https://yw.bdfz.net/api/learning/pending-interactions?pendingId='+pending.pendingId);
    assert.equal(status.status,200);assert.equal((await status.json()).assessment.score,85);
    await scheduler.fetch('https://fixture.invalid/');assert.equal(attempts,2);
  }finally{await mf.dispose();}
});

// Invalid replies: preserved, never reused, retried within the four-call budget.
const VALID=JSON.stringify({score:85,verdict:'fixture verdict',strength:'fixture strength',gap:'fixture gap',nextQuestion:'fixture question'});
async function harness(answers,{newPolicy=false,schedulerReceipts=false}={}) {
  const calls={n:0};
  const common={compatibilityDate:'2026-05-12',modules:true,modulesRoot:ROOT,
    modulesRules:[{type:'ESModule',include:['**/*.js']}],
    d1Databases:{READING_DB:'durable-evaluation-fixture'},
    bindings:{READING_TEST_SLUG:'durable-workerd-fixture',APIS_CALLER_TOKEN:'fixture-not-a-secret',
      YW_DURABLE_EVALUATION_ENABLED:'true',YW_BACKGROUND_EVALUATION_ENABLED:'true',YW_EVALUATION_MACHINE_SECRET:'cd'.repeat(32)},
    serviceBindings:{
      ASSETS(request){const pathname=new URL(request.url).pathname;
        if(!/^\/data\/[a-zA-Z0-9_./-]+\.json$/.test(pathname)||pathname.includes('..'))return new Response('not found',{status:404});
        try{return new Response(readFileSync(resolve(ROOT,'site'+pathname)),{headers:{'content-type':'application/json'}});}catch{return new Response('not found',{status:404});}},
      async APIS(){let answer=answers[Math.min(calls.n,answers.length-1)];calls.n++;
        if(typeof answer==='function')answer=await answer();
        if(answer?.transportUnknown) throw new TypeError('synthetic transport interruption');
        if(answer?.errorCode) return Response.json({error_code:answer.errorCode},{status:answer.httpStatus||503,
          headers:answer.retryAfter?{'retry-after':String(answer.retryAfter)}:{}});
        return Response.json({answer,model:'gemini-3.8-flash',raw_response:{modelVersion:'fixture-revision'}});},
    },outboundService(){throw new Error('unexpected external request');},
  };
  const options=(extra={})=>({log:new Log(LogLevel.NONE),workers:[
    {...common,bindings:{...common.bindings,...extra},name:'foreground',scriptPath:resolve(ROOT,'site/_worker.js')},
    {...common,serviceBindings:schedulerReceipts?{USER_CENTER_EVIDENCE:{name:'receipts',entrypoint:'Receipts'}}:{},bindings:{YW_BACKGROUND_EVALUATION_ENABLED:'true',YW_EVALUATION_MACHINE_SECRET:'cd'.repeat(32),...extra},
      name:'scheduler',scriptPath:resolve(ROOT,'scripts/fixtures/durable-scheduler-harness.js'),outboundService:'foreground'},
    ...(schedulerReceipts?[{name:'receipts',compatibilityDate:'2026-05-12',modules:true,
      d1Databases:{READING_DB:'durable-evaluation-fixture'},
      script:`import {WorkerEntrypoint} from 'cloudflare:workers';
        export class Receipts extends WorkerEntrypoint {
          async getLearningEvidenceDeliveryReceipts(ids) {
            await this.env.READING_DB.prepare('INSERT INTO fixture_receipt_reads(n) VALUES(?)').bind(ids.length).run();
            return {schemaVersion:'bdfz-learning-evidence-delivery-receipts-v1',sourceSiteKey:'yw',contractVersion:'yw-aplus-e310-v2',
              receipts:ids.map(sourceAttemptId=>({sourceAttemptId,disposition:'accepted'}))};
          }
        } export default {fetch(){return new Response('unused',{status:404})}};`}]:[]),
  ]});
  const mf=new Miniflare(options());
  let db=await mf.getD1Database('READING_DB','foreground');
  for(const file of readdirSync(resolve(ROOT,'migrations')).filter(x=>x.endsWith('.sql')).sort()){
    const sql=readFileSync(resolve(ROOT,'migrations',file),'utf8').replace(/--[^\n]*/g,'');
    for(const statement of sql.match(/\s*CREATE TRIGGER[\s\S]*?\nEND;|[^;]+;/gi)||[])await db.prepare(statement).run();
  }
  await db.prepare('INSERT INTO students(id,uc_slug,display_name,uc_user_id,identity_verified_at) VALUES(7,?,?,42,?)')
    .bind('durable-workerd-fixture','Fixture',new Date().toISOString()).run();
  const body={lessonId:'lesson-1458',interaction:'structure',input:{reason:'合成測試：比較兩處字句的前後照應，並說明文章結構推進。'},clientMutationId:'workerd-invalid-reply-fixture'};
  const submit=async()=>{
    const response=await mf.dispatchFetch('https://yw.bdfz.net/api/interaction-check',{method:'POST',
      headers:{'content-type':'application/json',origin:'https://yw.bdfz.net'},body:JSON.stringify(body)});
    if(!newPolicy) await db.prepare('UPDATE learning_evaluation_jobs SET first_pending_at=?').bind(Date.parse('2026-09-29T04:19:00Z')).run();
    return response;
  };
  const drain=async()=>{await db.prepare('UPDATE learning_evaluation_jobs SET next_attempt_at=0').run();
    return (await (await mf.getWorker('scheduler')).fetch('https://fixture.invalid/')).json();};
  const facts=async()=>(await db.prepare('SELECT payload_json FROM learning_evaluation_events ORDER BY rowid').all()).results.map(r=>JSON.parse(r.payload_json));
  const job=()=>db.prepare('SELECT state,last_error_class FROM learning_evaluation_jobs').first();
  const configure=async extra=>{await mf.setOptions(options(extra));db=await mf.getD1Database('READING_DB','foreground');};
  return {mf,get db(){return db;},calls,submit,drain,facts,job,configure};
}

test('an invalid saved reply is kept, never reused, and a fresh call completes the evaluation',async()=>{
  const h=await harness(['{',VALID]);
  try {
    const response=await h.submit(),pending=await response.json();
    assert.equal(response.status,202);assert.equal(pending.pendingState,'queued');assert.equal(pending.error,'答案已保存，評閱稍後補上');
    assert.deepEqual(await h.job(),{state:'queued',last_error_class:'invalid_reply'});
    assert.equal((await h.drain()).completed,1);assert.equal(h.calls.n,2);
    const replies=(await h.db.prepare('SELECT lease_epoch,answer_text FROM learning_evaluation_replies ORDER BY id').all()).results;
    assert.deepEqual(replies.map(r=>r.answer_text),['{',VALID]);
    assert.equal((await h.job()).state,'completed');
    const facts=await h.facts(),ids=new Set(facts.map(r=>r.operationId));
    const failure=facts.find(r=>r.action==='ai.failure');
    assert.equal(failure.context.sourceContext.reason,'invalid_ai_assessment');
    assert.ok(failure.parentOperationId.endsWith(':reply:'+replies[0].lease_epoch));
    assert.equal(facts.find(r=>r.action==='ai.retry').context.sourceContext.executionKind,'apis_call');
    assert.equal(facts.filter(r=>r.action==='evaluation.result').length,1);
    assert.ok(facts.every(r=>!r.parentOperationId || ids.has(r.parentOperationId)));
  } finally {await h.mf.dispose();}
});

test('invalid replies block only when the four-call budget is spent',async()=>{
  const h=await harness(['{']);
  try {
    assert.equal((await h.submit()).status,202);
    for(let i=0;i<3;i++) await h.drain();
    assert.equal(h.calls.n,4);assert.deepEqual(await h.job(),{state:'blocked',last_error_class:'invalid_reply'});
    await h.drain();assert.equal(h.calls.n,4,'no fifth call and no reconciliation of a spent budget');
    assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM learning_evaluation_replies').first()).n,4);
  } finally {await h.mf.dispose();}
});

test('a job blocked on an invalid reply before this change is reconciled once and completes',async()=>{
  const h=await harness(['{',VALID]);
  try {
    assert.equal((await h.submit()).status,202);
    // The state the previous release left: blocked with the invalid reply saved.
    await h.db.prepare("UPDATE learning_evaluation_jobs SET state='blocked',last_error_class='reply_saved'").run();
    assert.equal((await h.drain()).completed,1);assert.equal(h.calls.n,2);
    assert.equal((await h.job()).state,'completed');
    const facts=await h.facts(),ids=new Set(facts.map(r=>r.operationId));
    const retry=facts.find(r=>r.context.sourceContext.retryKind==='reconciliation');
    assert.equal(retry.action,'ai.retry');assert.equal(retry.context.sourceContext.reason,'invalid_reply');
    assert.ok(ids.has(retry.parentOperationId));
    await h.drain();assert.equal(h.calls.n,2);
  } finally {await h.mf.dispose();}
});

async function blockedWithOwnerScope(fifth=VALID,previousWindow=true) {
  const failure={errorCode:'DEADLINE_EXCEEDED'};
  const h=await harness([failure,failure,failure,failure,fifth]);
  await h.submit();for(let i=0;i<3;i++)await h.drain();
  assert.equal(h.calls.n,4);assert.equal((await h.job()).state,'blocked');
  // Production failures spanned 24 minutes; the one-shot runs in a new window.
  if(previousWindow) await h.db.prepare("UPDATE learning_evaluator_calls SET window_start='2026-01-01T00:00:00.000Z'").run();
  const row=await h.db.prepare('SELECT source_event_id FROM learning_evaluation_jobs').first();
  const scope={YW_EVALUATION_ONE_SHOT_SHA256:createHash('sha256').update(row.source_event_id).digest('hex'),
    YW_EVALUATION_ONE_SHOT_UNTIL:new Date(Date.now()+3600000).toISOString()};
  return {h,scope};
}

test('owner-scoped fifth call completes without erasing any failure, ledger or original answer',async()=>{
  const {h,scope}=await blockedWithOwnerScope();
  try {
    const before=await h.facts();
    const original=await h.db.prepare('SELECT submitted_payload_json FROM learning_submission_records').first();
    await h.configure(scope);
    assert.equal((await h.drain()).completed,1);assert.equal(h.calls.n,5);
    assert.equal((await h.job()).state,'completed');
    const facts=await h.facts();
    for(const event of before)assert.deepEqual(facts.find(x=>x.operationId===event.operationId),event);
    assert.equal(facts.filter(x=>x.action==='ai.failure').length,4);
    assert.equal(facts.filter(x=>x.action==='evaluation.result').length,1);
    assert.equal(facts.filter(x=>x.context.sourceContext.reason==='owner_approved_extra_attempt').length,1);
    assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM learning_evaluator_calls').first()).n,5);
    assert.deepEqual(await h.db.prepare('SELECT submitted_payload_json FROM learning_submission_records').first(),original);
    await h.drain();assert.equal(h.calls.n,5);
  } finally {await h.mf.dispose();}
});

test('a failed fifth call stays blocked after reload and repeated scheduler scans',async()=>{
  const {h,scope}=await blockedWithOwnerScope({errorCode:'UPSTREAM_UNAVAILABLE'});
  try {
    await h.configure(scope);await h.drain();assert.equal(h.calls.n,5);
    assert.equal((await h.job()).state,'blocked');
    await h.configure(scope);await h.drain();await h.drain();
    assert.equal(h.calls.n,5,'no sixth model call');
    assert.equal((await h.facts()).filter(x=>x.action==='ai.failure').length,5);
  } finally {await h.mf.dispose();}
});

for(const kind of ['absent','wrong-job','expired','malformed','too-long']) {
  test(`owner-scoped reconciliation rejects ${kind} settings`,async()=>{
    const {h,scope}=await blockedWithOwnerScope();
    try {
      if(kind==='absent')delete scope.YW_EVALUATION_ONE_SHOT_SHA256;
      if(kind==='wrong-job')scope.YW_EVALUATION_ONE_SHOT_SHA256='ab'.repeat(32);
      if(kind==='expired')scope.YW_EVALUATION_ONE_SHOT_UNTIL=new Date(Date.now()-1000).toISOString();
      if(kind==='malformed')scope.YW_EVALUATION_ONE_SHOT_UNTIL='invalid';
      if(kind==='too-long')scope.YW_EVALUATION_ONE_SHOT_UNTIL=new Date(Date.now()+2*86400000).toISOString();
      await h.configure(scope);await h.drain();
      assert.equal(h.calls.n,4);assert.equal((await h.job()).state,'blocked');
    } finally {await h.mf.dispose();}
  });
}

// Even explicit recovery cannot bypass the existing ten-minute caller budget.
test('owner-scoped recovery preserves the per-window call budget',async()=>{
  const {h,scope}=await blockedWithOwnerScope(VALID,false);
  try {
    await h.configure(scope);await h.drain();
    assert.equal(h.calls.n,4);assert.equal((await h.job()).state,'blocked');
    assert.equal((await h.facts()).at(-1).context.sourceContext.reason,'local_budget_exhausted');
  } finally {await h.mf.dispose();}
});

for(const successful of [true,false]) test(`frozen two-job scope serializes grants and stops after failure: ${successful}`,async()=>{
  const failure={errorCode:'UPSTREAM_UNAVAILABLE'};
  const h=await harness([...Array(8).fill(failure),successful?VALID:failure,VALID]);
  try {
    await h.submit();for(let i=0;i<3;i++)await h.drain();assert.equal(h.calls.n,4);
    await h.db.prepare('INSERT INTO students(id,uc_slug,display_name,uc_user_id,identity_verified_at) VALUES(8,?,?,43,?)')
      .bind('second-fixture','Second Fixture',new Date().toISOString()).run();
    await h.configure({READING_TEST_SLUG:'second-fixture'});
    await h.submit();for(let i=0;i<3;i++)await h.drain();assert.equal(h.calls.n,8);
    await h.db.prepare("UPDATE learning_evaluator_calls SET window_start='2026-01-01T00:00:00.000Z'").run();
    const jobs=(await h.db.prepare('SELECT source_event_id FROM learning_evaluation_jobs ORDER BY first_pending_at').all()).results;
    assert.equal(jobs.length,2);
    const scope={YW_EVALUATION_ONE_SHOT_SHA256:jobs.map(j=>createHash('sha256').update(j.source_event_id).digest('hex')).join(','),YW_EVALUATION_ONE_SHOT_UNTIL:new Date(Date.now()+3600000).toISOString()};
    await h.configure(scope);await h.drain();assert.equal(h.calls.n,9,'one grant only in first tick');
    await h.drain();await h.drain();assert.equal(h.calls.n,successful?10:9);
    const rows=(await h.db.prepare('SELECT state,lease_epoch FROM learning_evaluation_jobs ORDER BY first_pending_at').all()).results;
    assert.deepEqual(rows.map(j=>j.state),successful?['completed','completed']:['blocked','blocked']);
    assert.deepEqual(rows.map(j=>j.lease_epoch),successful?[5,5]:[5,4]);
    assert.equal((await h.db.prepare("SELECT COUNT(*) n FROM learning_evaluation_events WHERE action='ai.failure'").first()).n,successful?8:9);
  } finally {await h.mf.dispose();}
});

for(const errorCode of ['DEADLINE_EXCEEDED','UPSTREAM_UNAVAILABLE']) test(`definite ${errorCode} retries promptly without resetting calls or the original submission`,async()=>{
  const f={errorCode},h=await harness([f,f,f,VALID],{newPolicy:true});
  try {
    await h.submit();
    const original=await h.db.prepare('SELECT submitted_payload_json FROM learning_submission_records').first();
    for(let n=1;n<=3;n++) {
      const j=await h.db.prepare('SELECT * FROM learning_evaluation_jobs').first();
      const failure=(await h.facts()).filter(x=>x.action==='ai.failure').at(-1);
      const delay=j.next_attempt_at-Date.parse(failure.occurredAt);
      assert.equal(j.state,'queued');assert.equal(h.calls.n,n);
      assert(delay>=[30_000,60_000,120_000][n-1] && delay<=[40_000,70_000,130_000][n-1],`unexpected delay ${delay}`);
      await (await h.mf.getWorker('scheduler')).fetch('https://fixture.invalid/');
      assert.equal(h.calls.n,n,'natural tick must still honor the retry clock');
      await h.drain();
    }
    assert.equal((await h.job()).state,'completed');assert.equal(h.calls.n,4);
    assert.deepEqual(await h.db.prepare('SELECT submitted_payload_json FROM learning_submission_records').first(),original);
    assert.equal((await h.facts()).filter(x=>x.action==='evaluation.result').length,1);
    await h.drain();assert.equal(h.calls.n,4);
  } finally {await h.mf.dispose();}
});

for(const httpStatus of [429,503]) test(`HTTP ${httpStatus} Retry-After remains a hard floor for accelerated recovery`,async()=>{
  const h=await harness([{errorCode:'UPSTREAM_UNAVAILABLE',httpStatus,retryAfter:600}],{newPolicy:true});
  try {
    await h.submit();const j=await h.db.prepare('SELECT * FROM learning_evaluation_jobs').first();
    const failure=(await h.facts()).find(x=>x.action==='ai.failure');
    const delay=j.next_attempt_at-Date.parse(failure.occurredAt);
    assert(delay>=600_000 && delay<=610_000);assert.equal(h.calls.n,1);
    await (await h.mf.getWorker('scheduler')).fetch('https://fixture.invalid/');assert.equal(h.calls.n,1);
  } finally {await h.mf.dispose();}
});

test('429 without Retry-After retains the existing five-minute second backoff',async()=>{
  const h=await harness([{errorCode:'UPSTREAM_UNAVAILABLE',httpStatus:429}],{newPolicy:true});
  try {
    await h.submit();await h.drain();const j=await h.db.prepare('SELECT * FROM learning_evaluation_jobs').first();
    const failure=(await h.facts()).filter(x=>x.action==='ai.failure').at(-1);
    const delay=j.next_attempt_at-Date.parse(failure.occurredAt);
    assert(delay>=300_000 && delay<=310_000);assert.equal(h.calls.n,2);
  } finally {await h.mf.dispose();}
});

test('idle scheduled ticks reconcile exact central receipts without a browser, delivery replay or model call',async()=>{
  const h=await harness([VALID],{newPolicy:true,schedulerReceipts:true});
  try {
    await h.db.prepare('CREATE TABLE fixture_receipt_reads(n INTEGER)').run();
    assert.equal((await h.submit()).status,200);assert.equal(h.calls.n,1);
    const before=await h.db.prepare('SELECT envelope_json,delivery_attempts FROM evidence_outbox').first();
    assert.equal((await h.db.prepare('SELECT central_disposition FROM evidence_outbox').first()).central_disposition,null);
    await h.configure({YW_BACKGROUND_EVALUATION_ENABLED:'false'});
    await (await h.mf.getWorker('scheduler')).fetch('https://fixture.invalid/');
    assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM fixture_receipt_reads').first()).n,0);
    await h.configure({YW_BACKGROUND_EVALUATION_ENABLED:'true'});
    await (await h.mf.getWorker('scheduler')).fetch('https://fixture.invalid/');
    assert.equal((await h.db.prepare('SELECT central_disposition FROM evidence_outbox').first()).central_disposition,'accepted');
    assert.deepEqual(await h.db.prepare('SELECT envelope_json,delivery_attempts FROM evidence_outbox').first(),before);
    await (await h.mf.getWorker('scheduler')).fetch('https://fixture.invalid/');
    assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM fixture_receipt_reads').first()).n,1);
    assert.equal(h.calls.n,1);assert.equal((await h.facts()).filter(x=>x.action==='evaluation.result').length,1);
  } finally {await h.mf.dispose();}
});

test('new transient outage survives four failures, defers an hour, then completes once without resubmission',async()=>{
  const failure={errorCode:'UPSTREAM_UNAVAILABLE'};
  const h=await harness([failure,failure,failure,failure,VALID],{newPolicy:true});
  try {
    await h.submit();for(let i=0;i<3;i++)await h.drain();
    const j=await h.db.prepare('SELECT * FROM learning_evaluation_jobs').first();
    assert.equal(j.state,'queued');assert.equal(h.calls.n,4);
    assert(j.next_attempt_at-Date.now()>3_590_000,'four failures must not burn the next call immediately');
    const before=await h.db.prepare('SELECT submitted_payload_json FROM learning_submission_records').first();
    await (await h.mf.getWorker('scheduler')).fetch('https://fixture.invalid/');assert.equal(h.calls.n,4,'normal cron respects recovery time');
    await h.drain();assert.equal(h.calls.n,4,'same-window budget still applies');assert.equal((await h.job()).state,'queued');
    await h.db.prepare("UPDATE learning_evaluator_calls SET window_start='2026-01-01T00:00:00.000Z'").run();
    await h.drain();assert.equal(h.calls.n,5);assert.equal((await h.job()).state,'completed');
    assert.deepEqual(await h.db.prepare('SELECT submitted_payload_json FROM learning_submission_records').first(),before);
    assert.equal((await h.facts()).filter(x=>x.action==='evaluation.result').length,1);
    await h.drain();assert.equal(h.calls.n,5);
  } finally {await h.mf.dispose();}
});

test('new outage has an eight-call lifetime ceiling and increasing recovery delays, never a ninth call',async()=>{
  const h=await harness([{errorCode:'DEADLINE_EXCEEDED'}],{newPolicy:true});
  try {
    await h.submit();
    for(let n=2;n<=8;n++){
      await h.db.prepare("UPDATE learning_evaluator_calls SET window_start='2026-01-01T00:00:00.000Z'").run();
      await h.drain();assert.equal(h.calls.n,n);
      const j=await h.db.prepare('SELECT * FROM learning_evaluation_jobs').first();
      if(n>=4&&n<8){assert.equal(j.state,'queued');assert(j.next_attempt_at-Date.now()>[0,0,0,0,3600000,10800000,21600000,43200000][n]-10000);}
    }
    assert.equal((await h.job()).state,'blocked');await h.drain();assert.equal(h.calls.n,8);
    assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM learning_evaluator_calls').first()).n,8);
  } finally {await h.mf.dispose();}
});

test('mixed invalid replies and permanent or unknown failures cannot earn extra recovery calls',async()=>{
  for(const last of [{errorCode:'NON_RETRYABLE'},'{']){
    const f={errorCode:'DEADLINE_EXCEEDED'},h=await harness([f,f,f,last],{newPolicy:true});
    try {await h.submit();for(let i=0;i<3;i++)await h.drain();assert.equal((await h.job()).state,'blocked');await h.drain();assert.equal(h.calls.n,4);}
    finally{await h.mf.dispose();}
  }
  const f={errorCode:'DEADLINE_EXCEEDED'},h=await harness(['{',f,f,f],{newPolicy:true});
  try {await h.submit();for(let i=0;i<3;i++)await h.drain();assert.equal((await h.job()).state,'blocked');assert.equal(h.calls.n,4);}
  finally{await h.mf.dispose();}
});

test('new recovery expires after 24 hours and ambiguous outcomes remain uncertain',async()=>{
  const {evaluationCallLimit,deferEvaluationJob}=await import('../site/durable-evaluation-jobs.js');
  const h=await harness([{errorCode:'DEADLINE_EXCEEDED'}],{newPolicy:true});
  try {
    await h.submit();const j=await h.db.prepare('SELECT * FROM learning_evaluation_jobs').first();
    assert.equal(await evaluationCallLimit({READING_DB:h.db},j,j.first_pending_at+86400000),0);
    await h.db.prepare("UPDATE learning_evaluation_jobs SET state='leased'").run();
    const uncertain=await deferEvaluationJob(h.db,{...j,state:'leased'},new TypeError('unknown transport'));
    assert.equal(uncertain.state,'uncertain');await h.drain();assert.equal(h.calls.n,1);
  } finally {await h.mf.dispose();}
});

async function lostReplyFixture(result=VALID) {
  const h=await harness([null,result],{newPolicy:true});
  // Simulate a claim conflict while capturing a synthetic pending job. Only
  // this local D1 fixture uses the trigger; remove it before normal execution.
  await h.db.prepare(`CREATE TRIGGER fixture_defer_claim BEFORE UPDATE OF state ON learning_evaluation_jobs
    WHEN NEW.state='leased' BEGIN SELECT RAISE(IGNORE); END`).run();
  await h.submit();assert.equal(h.calls.n,0);
  await h.db.prepare('DROP TRIGGER fixture_defer_claim').run();
  const {claimEvaluationJob}=await import('../site/durable-evaluation-jobs.js');
  const {sourceEventStatement,evaluationEventBase,evaluationEventId}=await import('../site/learning-evaluation-events.js');
  const row=await h.db.prepare('SELECT source_event_id FROM learning_evaluation_jobs').first();
  const job=await claimEvaluationJob(h.db,row.source_event_id);
  // Restore the exact shape of a pre-fix invocation that ended after outbound
  // dispatch. Synthetic D1 fixture only: no real request or record is replayed.
  await h.db.prepare(`INSERT INTO learning_evaluator_calls(student_id,source_event_id,resource_key,window_start,created_at)
    VALUES(?,?,?,'2026-01-01T00:00:00.000Z',?)`).bind(job.student_id,job.source_event_id,job.resource_key,new Date().toISOString()).run();
  await h.db.prepare('INSERT INTO learning_evaluation_executions VALUES(?,?,?)').bind(job.source_event_id,1,Date.now()).run();
  await (await sourceEventStatement(h.db,evaluationEventBase(job),{action:'ai.request',kind:'request',key:1,
    parentId:await evaluationEventId(job.source_event_id,'submit'),sourceContext:{leaseEpoch:1,attemptNumber:1,requestId:'synthetic-lost-reply'}})).run();
  h.calls.n=1;
  await h.db.prepare('UPDATE learning_evaluation_jobs SET lease_until=0').run();
  await h.drain();assert.equal((await h.job()).state,'uncertain');assert.equal(h.calls.n,1);
  const scope={YW_EVALUATION_ONE_SHOT_MODE:'lost_reply',
    YW_EVALUATION_ONE_SHOT_SHA256:createHash('sha256').update(job.source_event_id).digest('hex'),
    YW_EVALUATION_ONE_SHOT_UNTIL:new Date(Date.now()+3600000).toISOString()};
  return {h,scope};
}

test('reviewed lost response gets one background replacement, preserving input and all prior evidence',async()=>{
  const {h,scope}=await lostReplyFixture();
  try {
    const before=await h.facts(),original=await h.db.prepare('SELECT submitted_payload_json FROM learning_submission_records').first();
    await h.configure(scope);assert.equal((await h.drain()).completed,1);assert.equal(h.calls.n,2);
    const after=await h.facts();for(const event of before)assert.deepEqual(after.find(x=>x.operationId===event.operationId),event);
    assert.deepEqual(await h.db.prepare('SELECT submitted_payload_json FROM learning_submission_records').first(),original);
    assert.equal(after.filter(x=>x.action==='evaluation.result').length,1);
    assert.equal(after.filter(x=>x.context.sourceContext.reason==='owner_approved_lost_reply_recovery').length,1);
    assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM learning_interactions').first()).n,1);
    await h.configure({});await h.drain();assert.equal(h.calls.n,2);
  } finally {await h.mf.dispose();}
});

for(const result of [{errorCode:'UPSTREAM_UNAVAILABLE'},'{',{transportUnknown:true}]) {
  test(`lost-response grant cannot issue a third call after ${JSON.stringify(result)}`,async()=>{
    const {h,scope}=await lostReplyFixture(result);
    try {
      await h.configure(scope);await h.drain();assert.equal(h.calls.n,2);
      // Miniflare turns a thrown service-binding exception into HTTP 500.
      // Both this definite failure and invalid output exhaust the reviewed grant.
      assert.equal((await h.job()).state,'blocked');
      await h.configure({});await h.drain();await h.drain();assert.equal(h.calls.n,2);
      assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM learning_interactions').first()).n,0);
    } finally {await h.mf.dispose();}
  });
}

for(const invalid of ['missing-mode','wrong-job','expired']) test(`lost-response reconciliation rejects ${invalid}`,async()=>{
  const {h,scope}=await lostReplyFixture();
  try {
    if(invalid==='missing-mode')delete scope.YW_EVALUATION_ONE_SHOT_MODE;
    if(invalid==='wrong-job')scope.YW_EVALUATION_ONE_SHOT_SHA256='ab'.repeat(32);
    if(invalid==='expired')scope.YW_EVALUATION_ONE_SHOT_UNTIL=new Date(Date.now()-1000).toISOString();
    await h.configure(scope);await h.drain();assert.equal(h.calls.n,1);assert.equal((await h.job()).state,'uncertain');
  } finally {await h.mf.dispose();}
});

test('successful submissions return their immediate result without waiting for the scheduler',async()=>{
  const h=await harness([VALID]);
  try {
    const response=await h.submit();assert.equal(response.status,200);
    assert.equal(h.calls.n,1);assert.equal((await h.job()).state,'completed');
    assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM learning_evaluation_replies').first()).n,1);
    assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM learning_interactions').first()).n,1);
    await h.drain();assert.equal(h.calls.n,1);
  } finally {await h.mf.dispose();}
});

test('owned status projects progress without changing calls, leases, events or evidence',async()=>{
 const h=await harness([{errorCode:'UPSTREAM_UNAVAILABLE'},VALID],{newPolicy:true});
 try {
  const pending=await (await h.submit()).json();
  const row=await h.db.prepare('SELECT * FROM learning_pending_submissions').first();
  const read=async(params)=>{const response=await h.mf.dispatchFetch('https://yw.bdfz.net/api/learning/pending-interactions?'+new URLSearchParams(params));return {code:response.status,body:await response.json()};};
  const before=await h.db.prepare('SELECT * FROM learning_evaluation_jobs').first(),facts=await h.facts();
  const status=await read({clientMutationId:row.client_mutation_id});
  assert.equal(status.code,202);assert.equal(status.body.phase,'waiting_retry');
  assert.equal(status.body.saved,true);assert.equal(status.body.canStartNewTurn,false);
  assert.ok(status.body.nextAttemptAt);assert.equal(status.body.retryAfterSeconds,60);
  assert.equal((await read({pendingId:pending.pendingId,clientMutationId:'wrong'})).code,404);
  assert.equal((await read({clientMutationId:'wrong'})).code,404);
  assert.deepEqual(await h.db.prepare('SELECT * FROM learning_evaluation_jobs').first(),before);
  assert.deepEqual(await h.facts(),facts);assert.equal(h.calls.n,1);
  await h.db.prepare("UPDATE learning_evaluation_jobs SET state='leased',lease_until=?").bind(Date.now()+60000).run();
  assert.equal((await read({pendingId:pending.pendingId})).body.phase,'evaluating');
  for(const state of ['blocked','uncertain']) {
   await h.db.prepare('UPDATE learning_evaluation_jobs SET state=?').bind(state).run();
   const result=(await read({pendingId:pending.pendingId})).body;
   assert.equal(result.phase,'needs_attention');assert.equal(result.nextAttemptAt,null);
  }
  // Switching the verified source identity cannot disclose the first owner's job.
  await h.db.prepare('UPDATE students SET uc_slug=? WHERE id=7').bind('other-owner').run();
  const privateResult=await read({pendingId:pending.pendingId});assert.notEqual(privateResult.code,200);assert.notEqual(privateResult.code,202);
  assert.equal(h.calls.n,1);
 } finally {await h.mf.dispose();}
});

test('completed mutation lookup reuses the existing result with no evaluator or outbox work',async()=>{
 const h=await harness([VALID],{newPolicy:true});
 try {
  assert.equal((await h.submit()).status,200);
  const row=await h.db.prepare('SELECT client_mutation_id FROM learning_pending_submissions').first();
  const before=await h.facts();
  for(let i=0;i<3;i++) {
   const response=await h.mf.dispatchFetch('https://yw.bdfz.net/api/learning/pending-interactions?clientMutationId='+encodeURIComponent(row.client_mutation_id));
   const result=await response.json();assert.equal(response.status,200);assert.equal(result.phase,'completed');
   assert.equal(result.canStartNewTurn,true);assert.equal(result.assessment.score,85);
  }
  assert.equal(h.calls.n,1);assert.deepEqual(await h.facts(),before);
  assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM evidence_outbox').first()).n,1);
 } finally {await h.mf.dispose();}
});


async function seedIndependentJobs(h,count) {
 for(let i=0;i<count;i++) {
  if(i) {
   await h.db.prepare('UPDATE students SET uc_slug=? WHERE uc_slug=?').bind('fixture-old-'+i,'durable-workerd-fixture').run();
   await h.db.prepare('INSERT INTO students(id,uc_slug,display_name,uc_user_id,identity_verified_at) VALUES(?,?,?,?,?)')
    .bind(7+i,'durable-workerd-fixture','Fixture',42+i,new Date().toISOString()).run();
  }
  assert.equal((await h.submit()).status,202);
 }
}

test('twenty independent 8-second model jobs drain four per tick, at most two concurrent',async()=>{
 let active=0,maximum=0;const answer=async()=>{active++;maximum=Math.max(maximum,active);await new Promise(resolve=>setTimeout(resolve,8000));active--;return VALID;};
 const h=await harness([...Array(20).fill({errorCode:'UPSTREAM_UNAVAILABLE'}),answer],{newPolicy:true});
 try {
  await seedIndependentJobs(h,20);const counts=[];
  for(let i=0;i<5;i++)counts.push((await h.drain()).completed);
  assert.deepEqual(counts,[4,4,4,4,4]);assert.equal(maximum,2);assert.equal(h.calls.n,40);
  assert.equal((await h.db.prepare("SELECT COUNT(*) n FROM learning_evaluation_jobs WHERE state!='completed'").first()).n,0);
  assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM learning_interactions').first()).n,20);
  assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM evidence_outbox').first()).n,20);
 }finally{await h.mf.dispose();}
});

test('twenty valid saved replies use local recovery without reserving any new model calls',async()=>{
 const h=await harness(Array(20).fill({errorCode:'UPSTREAM_UNAVAILABLE'}),{newPolicy:true});
 try {
  await seedIndependentJobs(h,20);
  for(const row of (await h.db.prepare('SELECT source_event_id FROM learning_evaluation_jobs').all()).results)
   await h.db.prepare("INSERT INTO learning_evaluation_replies(source_event_id,lease_epoch,request_id,answer_text,received_at,version_status) VALUES(?,1,?,?,?,'unavailable')")
    .bind(row.source_event_id,'local-fixture-reply',VALID,Date.now()).run();
  const counts=[];for(let i=0;i<3;i++)counts.push((await (await (await h.mf.getWorker("scheduler")).fetch("https://fixture.invalid/")).json()).completed);
  assert.equal(counts.reduce((a,b)=>a+b,0),20);assert.ok(counts.every(n=>n<=10));assert.equal(h.calls.n,20);
  assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM learning_interactions').first()).n,20);
  assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM evidence_outbox').first()).n,20);
 }finally{await h.mf.dispose();}
});

test('definite upstream outage stops dispatch after the in-flight pair and preserves queued work',async()=>{
 const h=await harness([{errorCode:'UPSTREAM_UNAVAILABLE'}],{newPolicy:true});
 try {
  await seedIndependentJobs(h,8);const before=h.calls.n;
  const result=await h.drain();assert.equal(result.completed,0);assert.ok(h.calls.n-before<=2);
  assert.equal((await h.db.prepare("SELECT COUNT(*) n FROM learning_evaluation_jobs WHERE state='queued'").first()).n,8);
 }finally{await h.mf.dispose();}
});

test('a later turn reports its own predecessor and never skips the resource fence',async()=>{
 const h=await harness([{errorCode:'UPSTREAM_UNAVAILABLE'}],{newPolicy:true});
 try {
  assert.equal((await h.submit()).status,202);
  const response=await h.mf.dispatchFetch('https://yw.bdfz.net/api/interaction-check',{method:'POST',headers:{'content-type':'application/json',origin:'https://yw.bdfz.net'},
   body:JSON.stringify({lessonId:'lesson-1458',interaction:'structure',input:{reason:'合成第二輪：比較兩处前後照應與語勢轉折，說明結構的推進。'},clientMutationId:'later-turn-fixture'})});
  assert.equal(response.status,202);
  const status=await h.mf.dispatchFetch('https://yw.bdfz.net/api/learning/pending-interactions?clientMutationId=later-turn-fixture');
  const body=await status.json();assert.equal(body.phase,'waiting_previous');assert.equal(body.canStartNewTurn,false);assert.equal(body.nextAttemptAt,null);
  assert.equal(h.calls.n,1);assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM learning_interactions').first()).n,0);
 }finally{await h.mf.dispose();}
});
