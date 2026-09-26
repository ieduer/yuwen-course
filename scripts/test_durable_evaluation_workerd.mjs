import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
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
async function harness(answers) {
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
      APIS(){const answer=answers[Math.min(calls.n,answers.length-1)];calls.n++;
        return Response.json({answer,model:'gemini-3.8-flash',raw_response:{modelVersion:'fixture-revision'}});},
    },outboundService(){throw new Error('unexpected external request');},
  };
  const mf=new Miniflare({log:new Log(LogLevel.NONE),workers:[
    {...common,name:'foreground',scriptPath:resolve(ROOT,'site/_worker.js')},
    {...common,serviceBindings:{},bindings:{YW_BACKGROUND_EVALUATION_ENABLED:'true',YW_EVALUATION_MACHINE_SECRET:'cd'.repeat(32)},
      name:'scheduler',scriptPath:resolve(ROOT,'scripts/fixtures/durable-scheduler-harness.js'),outboundService:'foreground'},
  ]});
  const db=await mf.getD1Database('READING_DB','foreground');
  for(const file of readdirSync(resolve(ROOT,'migrations')).filter(x=>x.endsWith('.sql')).sort()){
    const sql=readFileSync(resolve(ROOT,'migrations',file),'utf8').replace(/--[^\n]*/g,'');
    for(const statement of sql.match(/\s*CREATE TRIGGER[\s\S]*?\nEND;|[^;]+;/gi)||[])await db.prepare(statement).run();
  }
  await db.prepare('INSERT INTO students(id,uc_slug,display_name,uc_user_id,identity_verified_at) VALUES(7,?,?,42,?)')
    .bind('durable-workerd-fixture','Fixture',new Date().toISOString()).run();
  const body={lessonId:'lesson-1458',interaction:'structure',input:{reason:'合成測試：比較兩處字句的前後照應，並說明文章結構推進。'},clientMutationId:'workerd-invalid-reply-fixture'};
  const submit=()=>mf.dispatchFetch('https://yw.bdfz.net/api/interaction-check',{method:'POST',
    headers:{'content-type':'application/json',origin:'https://yw.bdfz.net'},body:JSON.stringify(body)});
  const drain=async()=>{await db.prepare('UPDATE learning_evaluation_jobs SET next_attempt_at=0').run();
    return (await (await mf.getWorker('scheduler')).fetch('https://fixture.invalid/')).json();};
  const facts=async()=>(await db.prepare('SELECT payload_json FROM learning_evaluation_events ORDER BY rowid').all()).results.map(r=>JSON.parse(r.payload_json));
  const job=()=>db.prepare('SELECT state,last_error_class FROM learning_evaluation_jobs').first();
  return {mf,db,calls,submit,drain,facts,job};
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
