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
    YW_FORMAL_APIS_VERSION:version, YW_ACCEPTANCE_DATABASE_ID:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    ACCEPTANCE_DB:{prepare:text=>{calls.db++;return wrap(text);}, batch:async statements=>Promise.all(statements.map(s=>s.run()))},
    ASSETS:{fetch:async req=>{calls.assets++;const pathname=new URL(req.url).pathname;
      if(pathname==='/dialogue.html')return new Response(null,{status:308,headers:{location:'/dialogue'}});
      const file='site'+(pathname==='/dialogue'?'/dialogue.html':pathname);
      return fs.existsSync(file)?new Response(fs.readFileSync(file)):new Response(null,{status:404});}},
    USER_CENTER_EVIDENCE:{resolveSession:async()=>{calls.identity++;return user;},resolveNativeSession:async()=>({
      ...user,schemaVersion:'bdfz-native-auth/1',status:200,clientId:'yuwen-native-android',capability:'data',
    })},
    APIS_CALLER_TOKEN:'synthetic-caller-only',APIS:{fetch:async()=>{calls.model++;return new Response(null,{status:503});}},
  };
  const authenticated = (path,init={}) => request(path,{...init,headers:{cookie:'bdfz_uc_session=synthetic-'+crypto.randomUUID(),...init.headers}});
  return {sql,calls,bindings,user,authenticated};
}

test('unavailable, malformed and unsafe isolation configurations fail before all dependencies', async t=>{
  const f=fixture(t);
  for (const change of [
    {YW_ACCEPTANCE_EXPIRES_AT:'invalid'}, {YW_ACCEPTANCE_EXPIRES_AT:'2020-01-01'},
    {YW_ACCEPTANCE_USER_ID:'0'}, {YW_ACCEPTANCE_USER_ID:'700001.0'}, {YW_ACCEPTANCE_USER_ID:'9007199254740993'},
    {YW_FORMAL_APIS_VERSION:'bad'}, {YW_ACCEPTANCE_DATABASE_ID:'99c541e7-e70b-4584-b939-7e88a6dd68c5'},
    {YW_FORMAL_APIS_VERSION:'00000000-0000-0000-0000-000000000000'},
    {YW_ACCEPTANCE_DATABASE_ID:'39ed36d9-b3f3-40fd-933a-9a68a4066302'},
    {READING_DB:{}}, {READING_TEST_SLUG:'synthetic'}, {LEARNING_EVIDENCE_QUEUE:{}},
    {ACCEPTANCE_DB:null}, {USER_CENTER_EVIDENCE:null}, {APIS:null},
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
  const activation='{"operation":"synthetic-amendment4"}';
  const env=acceptanceEnvironment(request(),{...f.bindings,YW_CALIBRATION_AMENDMENT4_JSON:activation,YW_DIALOGUE_PROVIDER_ATTEMPTS:'3',UNRELATED_DB:{},ARBITRARY_SECRET:'unused'});
  assert.equal(env.READING_DB,f.bindings.ACCEPTANCE_DB);assert.equal(env.UNRELATED_DB,undefined);assert.equal(env.ARBITRARY_SECRET,undefined);
  assert.equal(env.YW_CALIBRATION_AMENDMENT4_JSON,activation);
  assert.equal(env.YW_DIALOGUE_PROVIDER_ATTEMPTS,'3');
  assert.deepEqual(Object.keys(env.USER_CENTER_EVIDENCE).sort(),['resolveNativeSession','resolveSession']);
  const value=await(await entry.fetch(f.authenticated('/api/dialogue/v1?lessonId=lesson-1717-p2&sharedHistory=1'),f.bindings)).json();
  assert.equal(value.sharedHistory.status,'unavailable');assert.equal(f.calls.model,0);
});

test('formal caller authentication replaces private cookie and version routing',async t=>{
  const f=fixture(t), observed=[];
  f.bindings.APIS.fetch=async req=>{observed.push(req);assert.equal(req.headers.get('Cloudflare-Workers-Version-Overrides'),null);assert.equal(req.headers.get('x-internal-token'),'synthetic-caller-only');assert.equal(req.headers.get('cookie'),null);assert.equal(req.headers.get('authorization'),null);assert.equal(req.headers.get('x-project-name'),'yw.bdfz.net');return new Response(null,{status:503});};
  const env=acceptanceEnvironment(request(undefined,{headers:{cookie:'bdfz_uc_session=synthetic; unrelated=private','Cloudflare-Workers-Version-Overrides':'apis="spoof"'}}),f.bindings);
  await assert.rejects(callDialogueModel(env,'synthetic','synthetic-request',()=>{},{model:'gemini-3.8-flash'}),/gateway_unavailable/);
  assert.equal(observed.length,1);assert.equal(acceptanceContext(f.bindings),null);
  await assert.rejects(env.APIS.fetch(new Request('https://other.invalid/',{method:'POST'})),/formal_gateway_route_required/);
  const legacy={...f.bindings,APIS:undefined,APIS_ACCEPTANCE:f.bindings.APIS};
  assert.throws(()=>acceptanceEnvironment(request(),legacy),/configuration_invalid/);
  for(const value of [undefined,'','too-short','x'.repeat(300),'not a header secret'])assert.throws(()=>acceptanceEnvironment(request(),{...f.bindings,APIS_CALLER_TOKEN:value}),/configuration_invalid/);
});


test('restricted static page uses original UI with no external script or central network capability',async t=>{
  const f=fixture(t), r=await entry.fetch(request('/dialogue'),f.bindings);
  assert.equal(r.status,200);assert.match(await r.text(),/尚友/);
  assert.match(r.headers.get('content-security-policy'),/connect-src 'self';/);
  assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(f.calls.identity,0);
  const firstRead=await entry.fetch(request('/data/classical-first-read/lesson-1711-p1.json'),f.bindings);
  assert.equal(firstRead.status,200);assert.equal((await firstRead.json()).lessonId,'lesson-1711-p1');
  assert.equal((await entry.fetch(request('/data/classical-first-read/lesson-1484.json'),f.bindings)).status,200);
  assert.equal((await entry.fetch(request('/data/classical-first-read/lesson-999999.json'),f.bindings)).status,404);
});

test('full lesson catalog and sanitized curricula remain isolated from raw answer assets',async t=>{
  const f=fixture(t);
  const catalog=await(await entry.fetch(request('/dialogue-curriculum/index.json'),f.bindings)).json();
  assert.equal(catalog.lessons.length,189);
  const response=await entry.fetch(request('/dialogue-curriculum/lesson-1484.json'),f.bindings);
  assert.equal(response.status,200);
  const curriculum=await response.json();
  assert.equal(curriculum.lessonId,'lesson-1484');
  for(const item of curriculum.vocabulary||[]){assert.equal(item.answerIndex,undefined);assert.equal(item.sourceAnswer,undefined);assert.equal(item.variants,undefined);}
  for(const pathname of ['/dialogue-source.js','/dialogue-calibration-contract.js','/dialogue-calibration-packet.json','/data/vocab/lesson-1484.json'])assert.equal((await entry.fetch(request(pathname),f.bindings)).status,404);
  assert.equal(f.calls.model,0);assert.equal(f.calls.db,0);
});

test('ordinary entrypoint is not enabled by acceptance variables',async t=>{
  const f=fixture(t);
  assert.equal((await worker.fetch(request(),f.bindings)).status,404);
  assert.deepEqual(f.calls,{db:0,identity:0,assets:0,model:0});
});

test('browser cookies and supplied caller headers cannot replace the formal caller credential',async t=>{
 const f=fixture(t);let calls=0;f.bindings.APIS.fetch=async req=>{calls++;assert.equal(req.headers.get('cookie'),null);assert.equal(req.headers.get('x-internal-token'),'synthetic-caller-only');return new Response(null,{status:503});};
 const env=acceptanceEnvironment(request(undefined,{headers:{cookie:'bdfz_uc_session=a; bdfz_uc_session=b','x-internal-token':'spoof'}}),f.bindings);
 await assert.rejects(callDialogueModel(env,'synthetic','synthetic-request',()=>{},{model:'synthetic'}),/gateway_unavailable/);
 assert.equal(calls,1);assert.equal(env.APIS_CALLER_TOKEN,'synthetic-caller-only');
});
