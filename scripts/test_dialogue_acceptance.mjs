import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import worker from '../site/_worker.js';
import {callDialogueModel} from '../site/dialogue-source.js';
import {ACCEPTANCE_ORIGIN, acceptanceEnvironment, acceptanceContext, createAcceptanceWorker} from '../site/dialogue-acceptance.js';

const entry = createAcceptanceWorker(worker);
const version = '11111111-2222-4333-8444-555555555555';
const request = (path='/api/dialogue/v1?lessonId=lesson-1717-p2', init={}) => new Request(ACCEPTANCE_ORIGIN+path, init);
function fixture(t) {
  const sql = new DatabaseSync(':memory:');
  for (const name of fs.readdirSync('migrations').filter(x=>x.endsWith('.sql')).sort()) sql.exec(fs.readFileSync('migrations/'+name,'utf8'));
  t.after(()=>sql.close());
  const calls = {db:0, identity:0, assets:0, model:0};
  const wrap=(text,args=[])=>({bind:(...values)=>wrap(text,values), first:async()=>sql.prepare(text).get(...args)||null,
    all:async()=>({results:sql.prepare(text).all(...args)}), run:async()=>({meta:{changes:Number(sql.prepare(text).run(...args).changes)}})});
  const user={sourceSiteKey:'yw',authenticated:true,userId:700001,slug:'synthetic-acceptance',displayName:'Synthetic'};
  const bindings={
    YW_ACCEPTANCE_EXPIRES_AT:new Date(Date.now()+3600000).toISOString(), YW_ACCEPTANCE_USER_ID:'700001',
    YW_ACCEPTANCE_APIS_VERSION:version, YW_ACCEPTANCE_DATABASE_ID:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    ACCEPTANCE_DB:{prepare:text=>{calls.db++;return wrap(text);}, batch:async statements=>Promise.all(statements.map(s=>s.run()))},
    ASSETS:{fetch:async req=>{calls.assets++;return new Response(fs.readFileSync('site'+new URL(req.url).pathname));}},
    USER_CENTER_EVIDENCE:{resolveSession:async()=>{calls.identity++;return user;},resolveNativeSession:async()=>({
      ...user,schemaVersion:'bdfz-native-auth/1',status:200,clientId:'yuwen-native-android',capability:'data',
    })},
    APIS:{fetch:async()=>{calls.model++;return new Response(null,{status:503});}}, APIS_CALLER_TOKEN:'synthetic-only',
  };
  const authenticated = (path,init={}) => request(path,{...init,headers:{cookie:'bdfz_uc_session=synthetic-'+crypto.randomUUID(),...init.headers}});
  return {sql,calls,bindings,user,authenticated};
}

test('unavailable, malformed and unsafe isolation configurations fail before all dependencies', async t=>{
  const f=fixture(t);
  for (const change of [
    {YW_ACCEPTANCE_EXPIRES_AT:'invalid'}, {YW_ACCEPTANCE_EXPIRES_AT:'2020-01-01'},
    {YW_ACCEPTANCE_USER_ID:'0'}, {YW_ACCEPTANCE_USER_ID:'700001.0'}, {YW_ACCEPTANCE_USER_ID:'9007199254740993'},
    {YW_ACCEPTANCE_APIS_VERSION:'bad'}, {YW_ACCEPTANCE_DATABASE_ID:'99c541e7-e70b-4584-b939-7e88a6dd68c5'},
    {YW_ACCEPTANCE_APIS_VERSION:'00000000-0000-0000-0000-000000000000'},
    {YW_ACCEPTANCE_DATABASE_ID:'39ed36d9-b3f3-40fd-933a-9a68a4066302'},
    {READING_DB:{}}, {READING_TEST_SLUG:'synthetic'}, {LEARNING_EVIDENCE_QUEUE:{}},
    {ACCEPTANCE_DB:null}, {USER_CENTER_EVIDENCE:null}, {APIS:null}, {APIS_CALLER_TOKEN:''},
  ]) assert.equal((await entry.fetch(f.authenticated(),{...f.bindings,...change})).status,503);
  for (const origin of ['https://yw.bdfz.net','https://preview.pages.dev','http://yw-acceptance.bdfz.net','https://yw-acceptance.bdfz.net:8443']) {
    assert.equal((await entry.fetch(new Request(origin+'/api/dialogue/v1'),f.bindings)).status,503);
  }
  assert.deepEqual(f.calls,{db:0,identity:0,assets:0,model:0});
});

test('legacy model, scheduler, history, preview and central-write APIs are absent',async t=>{
  const f=fixture(t);
  for (const path of ['/api/chat','/api/learning/interactions','/api/learning/health','/api/reading/history','/api/preview','/api/learning/ai-readiness','/api/learning/recorder-events','/index.html','/assets/app.js','/_worker.js']) {
    for(const method of ['GET','POST'])assert.equal((await entry.fetch(f.authenticated(path,{method}),f.bindings)).status,404);
  }
  assert.equal((await entry.fetch(f.authenticated(undefined,{method:'DELETE'}),f.bindings)).status,405);
  assert.deepEqual(f.calls,{db:0,identity:0,assets:0,model:0});
});

test('cross-origin and native-header mutations are rejected before My or D1',async t=>{
  const f=fixture(t);
  for(const origin of ['', 'https://yw.bdfz.net', 'https://attacker.invalid']) {
    const r=await entry.fetch(f.authenticated(undefined,{method:'POST',headers:{origin,authorization:'Bearer ywat_'+'a'.repeat(43),'content-type':'application/json'},body:'{}'}),f.bindings);
    assert.equal(r.status,403);
  }
  assert.equal((await entry.fetch(f.authenticated(undefined,{method:'POST',headers:{origin:ACCEPTANCE_ORIGIN},body:'{}'}),f.bindings)).status,415);
  assert.deepEqual(f.calls,{db:0,identity:0,assets:0,model:0});
});

test('anonymous and a verified foreign account cannot reconcile a D1 identity',async t=>{
  const f=fixture(t);
  assert.equal((await entry.fetch(request(),f.bindings)).status,401);
  f.user.userId=700002;
  const r=await entry.fetch(f.authenticated('/api/dialogue/v1?lessonId=lesson-1717-p2&userId=700001',{headers:{'x-user-id':'700001'}}),f.bindings);
  assert.equal(r.status,401);assert.equal(f.calls.db,0);assert.equal(f.calls.assets,0);assert.equal(f.calls.model,0);
  assert.equal(f.sql.prepare('SELECT count(*) AS n FROM students').get().n,0);
});

test('approved My identity uses real source reads in the empty synthetic D1 and rechecks revocation',async t=>{
  const f=fixture(t), req=f.authenticated();
  const response=await entry.fetch(req,f.bindings);assert.equal(response.status,200);
  assert.deepEqual((await response.json()).turns,[]);
  assert.equal(f.sql.prepare('SELECT uc_user_id FROM students').get().uc_user_id,700001);
  const reads=f.calls.db;f.user.authenticated=false;
  assert.equal((await entry.fetch(req,f.bindings)).status,401);
  assert.equal(f.calls.identity,2);assert.equal(f.calls.db,reads);assert.equal(f.calls.model,0);
});

test('native identity retains existing verification and the same fixed owner boundary',async t=>{
  const f=fixture(t), req=request(undefined,{headers:{authorization:'Bearer ywat_'+'a'.repeat(43)}});
  assert.equal((await entry.fetch(req,f.bindings)).status,200);
  const reads=f.calls.db;f.user.userId=700002;
  assert.equal((await entry.fetch(req,f.bindings)).status,401);assert.equal(f.calls.db,reads);
});

test('same-origin owned save survives reload without model, Queue or central publication',async t=>{
  const f=fixture(t);
  const initial=await(await entry.fetch(f.authenticated(),f.bindings)).json();
  const post=body=>f.authenticated(undefined,{method:'POST',headers:{origin:ACCEPTANCE_ORIGIN,'content-type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await entry.fetch(post({action:'review',ownerRef:'wrong-owner'}),f.bindings)).status,409);
  assert.equal(f.sql.prepare('SELECT count(*) AS n FROM dialogue_sessions').get().n,0);
  const saved=await(await entry.fetch(post({action:'review',ownerRef:initial.ownerRef}),f.bindings)).json();
  assert.equal(saved.saved,true);assert.equal(saved.delivery,'student-export-required');
  const reload=await(await entry.fetch(f.authenticated('/api/dialogue/v1?lessonId=lesson-1717-p2&records=1'),f.bindings)).json();
  assert.equal(reload.trace.events[0].event_type,'teacher_review_requested');
  assert.equal(reload.ownerRef,initial.ownerRef);assert.equal(f.calls.model,0);
  assert.equal(f.sql.prepare('SELECT count(*) AS n FROM dialogue_calls').get().n,0);
});

test('shared learner history remains unavailable and capabilities are narrowly projected',async t=>{
  const f=fixture(t);
  const env=acceptanceEnvironment(request(),{...f.bindings,UNRELATED_DB:{},ARBITRARY_SECRET:'unused'});
  assert.equal(env.READING_DB,f.bindings.ACCEPTANCE_DB);assert.equal(env.UNRELATED_DB,undefined);assert.equal(env.ARBITRARY_SECRET,undefined);
  assert.deepEqual(Object.keys(env.USER_CENTER_EVIDENCE).sort(),['resolveNativeSession','resolveSession']);
  const value=await(await entry.fetch(f.authenticated('/api/dialogue/v1?lessonId=lesson-1717-p2&sharedHistory=1'),f.bindings)).json();
  assert.equal(value.sharedHistory.status,'unavailable');assert.equal(f.calls.model,0);
});

test('only the acceptance context supplies the exact APIS version; normal env and client spoof cannot',async t=>{
  const f=fixture(t), observed=[];
  f.bindings.APIS.fetch=async req=>{observed.push(req.headers.get('Cloudflare-Workers-Version-Overrides'));return new Response(null,{status:503});};
  const env=acceptanceEnvironment(request(undefined,{headers:{'Cloudflare-Workers-Version-Overrides':'apis="spoof"'}}),f.bindings);
  const budget={model:'synthetic'};
  await assert.rejects(callDialogueModel(env,'synthetic','synthetic-request',()=>{},budget),/gateway_unavailable/);
  await assert.rejects(callDialogueModel(f.bindings,'synthetic','synthetic-request',()=>{},budget),/gateway_unavailable/);
  assert.deepEqual(observed,[`apis="${version}"`,null]);assert.equal(acceptanceContext(f.bindings),null);
});

test('restricted static page uses original UI with no external script or central network capability',async t=>{
  const f=fixture(t), r=await entry.fetch(request('/dialogue'),f.bindings);
  assert.equal(r.status,200);assert.match(await r.text(),/尚友/);
  assert.match(r.headers.get('content-security-policy'),/connect-src 'self';/);
  assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(f.calls.identity,0);
  const firstRead=await entry.fetch(request('/data/classical-first-read/lesson-1711-p1.json'),f.bindings);
  assert.equal(firstRead.status,200);assert.equal((await firstRead.json()).lessonId,'lesson-1711-p1');
  assert.equal((await entry.fetch(request('/data/classical-first-read/lesson-1484.json'),f.bindings)).status,404);
});

test('ordinary entrypoint is not enabled by acceptance variables',async t=>{
  const f=fixture(t);
  assert.equal((await worker.fetch(request(),f.bindings)).status,404);
  assert.deepEqual(f.calls,{db:0,identity:0,assets:0,model:0});
});
