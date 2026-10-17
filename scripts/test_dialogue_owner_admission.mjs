import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import worker from '../site/_worker.js';
import {handleDialogue} from '../site/dialogue-source.js';
import {dialogueAcceptanceScope,dialogueAdmissionAllowed} from '../site/release-admission.js';
const now=Date.parse('2026-10-17T14:00:00Z');
const config=()=>({YW_DIALOGUE_ENABLED:'true',YW_DIALOGUE_ACCEPTANCE_USER_ID:'553',YW_DIALOGUE_ACCEPTANCE_EXPIRES_AT:'2026-10-17T15:00:00Z'});
const identity=id=>({authenticated:true,sourceSiteKey:'yw',userId:id,slug:'synthetic-'+id,displayName:'Synthetic owner'});
function fixture(t,id=553){
 t.mock.timers.enable({apis:['Date'],now});
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());
 for(const f of fs.readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())sql.exec(fs.readFileSync('migrations/'+f,'utf8'));
 let reads=0,writes=0,identities=0,assets=[];
 const statement=(q,args=[])=>({bind:(...a)=>statement(q,a),first:async()=>{reads++;return sql.prepare(q).get(...args)||null;},all:async()=>{reads++;return {results:sql.prepare(q).all(...args)};},run:async()=>{writes++;return {meta:{changes:Number(sql.prepare(q).run(...args).changes)}};}});
 const env={...config(),READING_DB:{prepare:q=>statement(q)},USER_CENTER_EVIDENCE:{resolveSession:async()=>{identities++;return identity(id);}},ASSETS:{fetch:async r=>{assets.push(new URL(r.url).pathname);return new Response(new URL(r.url).pathname,{headers:{'cache-control':'public,max-age=3600'}});}},get APIS(){throw Error('no model call');},get LEARNING_EVIDENCE_QUEUE(){throw Error('no queue call');}};
 const request=(p='/api/dialogue/v1?lessonId=lesson-not-found',method='GET',more={})=>new Request('https://yw.bdfz.net'+p,{method,headers:{cookie:'bdfz_uc_session=synthetic-owner-test',...(method==='POST'?{'content-type':'application/json',origin:'https://yw.bdfz.net'}:{}),...more},...(method==='POST'?{body:'{"ownerRef":"553","ucUserId":553}'}:{})});
 return {env,sql,request,stats:()=>({reads,writes,identities,assets})};
}
for(const method of ['GET','POST'])test('non-owner '+method+' is denied before any local identity, dialogue, provider or Queue operation',async t=>{
 const f=fixture(t,554),req=f.request(undefined,method);const response=await worker.fetch(req,f.env,{});
 assert.equal(response.status,403);assert.equal((await response.json()).code,'dialogue_acceptance_restricted');assert.equal(req.bodyUsed,false);
 assert.deepEqual(f.stats(),{reads:0,writes:0,identities:1,assets:[]});
});
test('selected owner reaches existing source loading; others never gain access through request identity fields',async t=>{
 const f=fixture(t);f.env.ASSETS.fetch=async()=>new Response('missing',{status:404});
 const response=await worker.fetch(f.request(),f.env,{});assert.equal(response.status,503);assert.equal((await response.json()).code,'curriculum_unavailable');
 const row=f.sql.prepare('SELECT * FROM students').get();assert.equal(row.uc_user_id,553);assert(f.stats().writes>0);
});
test('restricted homepage selects owner dialogue and ordinary legacy without database writes or shared caching',async t=>{
 const f=fixture(t);let user=identity(553);f.env.USER_CENTER_EVIDENCE.resolveSession=async()=>user;
 for(const [u,target] of [[identity(553),'/dialogue.html'],[identity(554),'/'],[{authenticated:false},'/']]){
  user=u;const response=await worker.fetch(f.request('/'),f.env,{});assert.equal(await response.text(),target);assert.equal(response.headers.get('cache-control'),'private, no-store');assert(response.headers.get('vary').includes('Cookie'));assert(response.headers.get('vary').includes('Authorization'));
 }
 assert.equal(f.stats().reads,0);assert.equal(f.stats().writes,0);
 // Identity is freshly resolved despite reusing the exact same cookie.
 user=identity(554);assert.equal((await worker.fetch(f.request(),f.env,{})).status,403);
});
test('expired, partial, malformed, empty or overlong restriction fails closed before identity lookup',async t=>{
 const f=fixture(t);
 for(const change of [{YW_DIALOGUE_ACCEPTANCE_EXPIRES_AT:'2026-10-17T14:00:00Z'},{YW_DIALOGUE_ACCEPTANCE_EXPIRES_AT:'2026-10-18T14:00:00Z'},{YW_DIALOGUE_ACCEPTANCE_EXPIRES_AT:undefined},{YW_DIALOGUE_ACCEPTANCE_USER_ID:undefined},{YW_DIALOGUE_ACCEPTANCE_USER_ID:''},{YW_DIALOGUE_ACCEPTANCE_USER_ID:'553x'},{YW_DIALOGUE_ACCEPTANCE_USER_ID:'9007199254740992'},{READING_TEST_SLUG:'synthetic'}]){
  const env={...config(),USER_CENTER_EVIDENCE:{resolveSession(){throw Error('no identity');}},ASSETS:f.env.ASSETS,...change};
  const response=await worker.fetch(f.request(undefined,'POST'),env,{});assert.equal(response.status,503);assert.equal((await response.json()).admitted,false);
 }
});
test('identity expiry and dependency failure do not reuse the unrestricted identity cache',async t=>{
 const f=fixture(t);let user=identity(553);f.env.USER_CENTER_EVIDENCE.resolveSession=async()=>user;
 await worker.fetch(f.request('/'),f.env,{});user={authenticated:false};assert.equal((await worker.fetch(f.request(),f.env,{})).status,401);
 f.env.USER_CENTER_EVIDENCE.resolveSession=async()=>{throw Error('unavailable');};assert.equal((await worker.fetch(f.request(),f.env,{})).status,503);assert.equal(f.stats().reads,0);assert.equal(f.stats().writes,0);
});
test('maintenance remains absolute and no request body can change the deployment-owned restriction',async t=>{
 const f=fixture(t);const response=await worker.fetch(f.request(undefined,'POST'),Object.assign(f.env,{YW_RELEASE_READ_ONLY:'true'}),{});assert.equal(response.status,503);assert.equal((await response.json()).code,'release_read_only');assert.equal(f.stats().identities,0);assert.equal(f.stats().writes,0);
});
test('native mismatch and mixed web/native credentials cannot grant the selected owner',async t=>{
 const f=fixture(t,553);f.env.USER_CENTER_EVIDENCE.resolveNativeSession=async()=>({schemaVersion:'bdfz-native-auth/1',status:200,authenticated:true,sourceSiteKey:'yw',clientId:'yuwen-native-android',capability:'data',userId:554,slug:'synthetic-554',displayName:'Synthetic'});
 const r=await worker.fetch(f.request(undefined,'GET',{authorization:'Bearer ywat_'+'x'.repeat(43)}),f.env,{});assert.equal(r.status,401);assert.equal(f.stats().writes,0);
});
test('direct dialogue handler also refuses the wrong owner, even with an existing local student',async t=>{
 const f=fixture(t);const response=await handleDialogue(f.request(undefined,'POST'),f.env,{id:1,ucUserId:554},{});assert.equal(response.status,404);assert.equal(f.stats().reads,0);assert.equal(f.stats().writes,0);
});
test('scope absent preserves ordinary behavior and enabled=false still closes the feature',async t=>{
 const f=fixture(t);assert.equal(dialogueAcceptanceScope({}),null);assert(dialogueAdmissionAllowed({YW_DIALOGUE_ENABLED:'true'},554));assert(!dialogueAdmissionAllowed({...config(),YW_DIALOGUE_ENABLED:'false'},553));
 assert.equal((await worker.fetch(f.request(),Object.assign(f.env,{YW_DIALOGUE_ENABLED:'false'}),{})).status,404);
 const response=await worker.fetch(f.request('/?view=legacy'),f.env,{});assert.equal(await response.text(),'/');assert.equal(f.stats().identities,0);
});
test('owner reads the complete ordinary dialogue snapshot and cannot read it after account switch',async t=>{
 const f=fixture(t);f.env.ASSETS.fetch=async request=>{const file='site'+new URL(request.url).pathname;return fs.existsSync(file)?new Response(fs.readFileSync(file),{headers:{'content-type':'application/json'}}):new Response('missing',{status:404});};
 const path='/api/dialogue/v1?lessonId=lesson-1717-p2';
 const response=await worker.fetch(f.request(path),f.env,{});assert.equal(response.status,200);const snapshot=await response.json();assert.match(snapshot.ownerRef,/^[a-f0-9]{64}$/);assert(snapshot.state.objectives.length>0);
 const before=f.sql.prepare('SELECT COUNT(*) n FROM dialogue_sessions').get().n;
 f.env.USER_CENTER_EVIDENCE.resolveSession=async()=>identity(554);
 const denied=await worker.fetch(f.request(path),f.env,{});assert.equal(denied.status,403);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM dialogue_sessions').get().n,before);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM students').get().n,1);
});
test('non-owner legacy identity remains available without acquiring dialogue admission',async t=>{
 const f=fixture(t,554);f.env.ASSETS.fetch=async()=>new Response('missing',{status:404});
 const response=await worker.fetch(f.request('/api/reading/materials/vocab/lesson-1711-p1.json'),f.env,{});assert.equal(response.status,404);assert.equal(f.sql.prepare('SELECT uc_user_id FROM students').get().uc_user_id,554);
 const writes=f.stats().writes;assert.equal((await worker.fetch(f.request(),f.env,{})).status,403);assert.equal(f.stats().writes,writes);
});
