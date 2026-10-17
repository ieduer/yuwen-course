import test,{beforeEach,afterEach,mock} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {acceptanceEnvironment,ACCEPTANCE_ORIGIN as origin} from '../site/dialogue-acceptance.js';
import {handleDialogue,callDialogueModel} from '../site/dialogue-source.js';
import {requestDialogueBudget} from '../site/dialogue-recovery.js';
import {E2E_OPERATION,E2E_HARD_EXPIRY,E2E_AUTHORITY_DIGEST,E2E_LESSONS} from '../site/dialogue-e2e-admission.js';
import {FULL_OPERATION,ORIGINAL_RECEIPTS,digest} from '../site/dialogue-full-language.js';
import packet from '../site/dialogue-full-language-packet.json' with {type:'json'};
const OP='yw-e2e-real-dialogue-20261017-v1',H='a'.repeat(64),at=Date.parse('2026-10-17T12:00:00Z'),expiry='2026-10-17T17:00:00Z',modelVersion='synthetic-pinned-version';
const student={id:1,ucUserId:553},lesson='lesson-1717-p2',version='11111111-2222-4333-8444-555555555555',database='c45988a6-9094-4306-bcce-98704b3989e3';
const ownerRef=createHash('sha256').update('dialogue-owner:1').digest('hex');
const policy={version:'synthetic-renewal-only',validUntil:expiry,currency:'USD',model:'gemini-3.8-flash',globalDailyMicros:50000000,userDailyMicros:50000000,lessonLifetimeMicros:50000000,reserveMicros:84000,inputMicrosPerMillion:750000,outputMicrosPerMillion:3750000};
const req=body=>new Request(origin+'/api/dialogue/v1?lessonId='+lesson,body?{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({ownerRef,...body})}:{});
const body=(revision=0,id='renewal-synthetic-000001')=>({content:'我注意到原句的對照，仍不確定情感如何轉變。',revision,mutationId:id});
const usage={promptTokenCount:100,totalTokenCount:200,cachedContentTokenCount:50};
const success=()=>({value:{reply:'請再指出一處原文，說明對照。',assessments:[]},model:policy.model,modelVersion,usage,firstTokenMs:100,totalDurationMs:200,providerAccounting:{version:1,policy:'yw-same-model-sequential-v1',mode:'sequential-distinct-key',fallback:false,hedge:false,backgroundCalls:0,maxProviderAttempts:3,providerAttemptCount:1,attempts:[{ordinal:1,model:policy.model,outcome:'OK',brokerCompleted:true,outputStarted:true,usage}]}});
beforeEach(()=>mock.timers.enable({apis:['Date'],now:at}));afterEach(()=>mock.timers.reset());
async function fixture(t,{calibrations=235,ordinary=false}={}){
 const sql=new DatabaseSync(':memory:');for(const f of fs.readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())sql.exec(fs.readFileSync('migrations/'+f,'utf8'));t.after(()=>sql.close());sql.exec("INSERT INTO students(id,uc_slug,display_name) VALUES(1,'synthetic-owner','Unit owner')");
 const wrap=(text,args=[])=>({bind:(...v)=>wrap(text,v),first:async()=>sql.prepare(text).get(...args)||null,all:async()=>({results:sql.prepare(text).all(...args)}),run:async()=>({meta:{changes:Number(sql.prepare(text).run(...args).changes)}}),runSync:()=>({meta:{changes:Number(sql.prepare(text).run(...args).changes)}})});
 const db={prepare:text=>wrap(text),batch:async rows=>{sql.exec('BEGIN');try{const r=rows.map(s=>s.runSync());sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 const priorReceipts=[...ORIGINAL_RECEIPTS].sort((a,b)=>a.attemptId<b.attemptId?-1:1);
 const full={version:'yw-full-language-activation-v1',enabled:true,operation:FULL_OPERATION,authorityDigest:H,packetDigest:packet.sourceDigest,sourceCommit:'b'.repeat(40),artifactSha256:H,origin,ownerUserId:553,databaseId:database,apisVersion:version,registryReceiptDigest:H,singleProviderSourceProofDigest:H,priorReceiptSetDigest:await digest(priorReceipts),priorReceipts,readyAt:'2026-10-17T11:00:00Z',hardExpiry:expiry,maxAttempts:235,maxReservedMicros:19740000,maxProviderAttempts:1,reserveMicros:84000,maxConcurrency:1,recoveryReadbacks:[]};
 const pin={version:'yw-isolated-e2e-admission-v2',enabled:true,operation:OP,authorityDigest:H,origin,ownerUserId:553,databaseId:database,apisVersion:version,registryReceiptDigest:H,hardExpiry:expiry,maxVisibleCalls:120,maxProviderAttempts:3,reserveMicros:252000,lessonIds:[...E2E_LESSONS]};
 const bindings={ASSETS:{fetch:async r=>new Response(fs.readFileSync('site'+new URL(r.url).pathname))},ACCEPTANCE_DB:db,USER_CENTER_EVIDENCE:{resolveSession:async()=>({userId:553})},APIS_ACCEPTANCE:{fetch:()=>{throw Error('network_forbidden');}},YW_ACCEPTANCE_USER_ID:'553',YW_ACCEPTANCE_APIS_VERSION:version,YW_ACCEPTANCE_DATABASE_ID:database,YW_ACCEPTANCE_ACTIVATION_SHA256:H,YW_ACCEPTANCE_EXPIRES_AT:expiry,YW_DIALOGUE_BUDGET_JSON:JSON.stringify(policy),YW_DIALOGUE_PROVIDER_ATTEMPTS:'3',YW_E2E_AUTHORITY_JSON:JSON.stringify(pin),YW_CALIBRATION_FULL_LANGUAGE_JSON:JSON.stringify(full),YW_FULL_LANGUAGE_ACTIVATION_SHA256:H};
 const env=ordinary?{...bindings,READING_DB:db,YW_DIALOGUE_ENABLED:'true'}:acceptanceEnvironment(req(),bindings);
 function seed(id,{caseSpec=null,operation=OP,state='finished',day='2026-10-17',accounted=1,version=modelVersion}={}){
  const sid=id+':session',created=new Date(at).toISOString(),meta=caseSpec?{caseId:caseSpec.id,packetDigest:packet.sourceDigest,sourceDigest:caseSpec.sourceDigest,promptDigest:caseSpec.promptDigest}:{};
  sql.prepare('INSERT INTO dialogue_sessions(id,student_id,lesson_id,curriculum_version,curriculum_json,policy_version,created_at,updated_at) VALUES(?,1,?,?,?,?,?,?)').run(sid,caseSpec?'calibration:'+caseSpec.lessonId:'lesson-1498',id,JSON.stringify(meta),'synthetic',created,created);
  sql.prepare("INSERT INTO dialogue_turns(id,session_id,mutation_id,request_hash,role,content,status,policy_version,created_at) VALUES(?,?,?,?,'student','synthetic','saved','synthetic',?)").run(id,sid,id,H,created);
  sql.prepare('INSERT INTO dialogue_calls(turn_id,session_id,student_id,day,reserved_tokens,state,created_at,reserved_micros,accounted_micros,finished_at,budget_policy_json) VALUES(?,?,1,?,2400,?,?,?,?,?,?)').run(id,sid,day,state,created,caseSpec?84000:252000,accounted,state==='finished'?created:null,JSON.stringify({...policy,...(!caseSpec?{isolatedAdmission:{operation}}:{})}));
  if(caseSpec)sql.prepare('INSERT INTO dialogue_events(id,session_id,turn_id,event_type,details_json,created_at) VALUES(?,?,?,?,?,?)').run(id+':result',sid,id,'synthetic_calibration_result',JSON.stringify({model:policy.model,modelVersion:version,expectedVerdictMatches:true,value:{}}),created);
 }
 for(const c of packet.cases.slice(0,calibrations))seed(FULL_OPERATION+':'+c.id+':1',{caseSpec:c});
 let calls=0;const model=async()=>{calls++;return success();};
 const send=(input=body(),fn=model)=>handleDialogue(req(input),env,student,null,{callModel:fn});
 return {sql,db,env,bindings,pin,full,send,seed,model,calls:()=>calls};
}
test('renewed E2E uses current fixed235 prerequisites and reserves one three-attempt logical call',async t=>{
 const f=await fixture(t),before=f.sql.prepare('SELECT * FROM dialogue_calls ORDER BY turn_id').all();
 const response=await f.send();assert.equal(response.status,200);assert.equal(f.calls(),1);
 const row=f.sql.prepare("SELECT * FROM dialogue_calls WHERE json_extract(budget_policy_json,'$.isolatedAdmission.operation')=?").get(OP);assert.equal(row.reserved_micros,252000);assert.equal(row.state,'finished');assert.equal(JSON.parse(row.usage_json).cachedContentTokenCount,50);
 assert.equal((await f.send()).status,200);assert.equal(f.calls(),1);assert.deepEqual(f.sql.prepare('SELECT * FROM dialogue_calls WHERE turn_id LIKE ? ORDER BY turn_id').all(FULL_OPERATION+':%'),before);
});
test('incomplete or failed calibration denies E2E before a provider call',async t=>{
 for(const count of [234,235]){const f=await fixture(t,{calibrations:count});if(count===235)f.sql.prepare("UPDATE dialogue_calls SET state='review' WHERE turn_id=?").run(FULL_OPERATION+':'+packet.cases[0].id+':1');const r=await f.send();assert.equal(r.status,429);assert.equal((await r.json()).code,'e2e_calibration_not_complete');assert.equal(f.calls(),0);}
});
test('the old E2E operation and hard expiry remain retired without rewriting old constants',async t=>{
 const f=await fixture(t);f.env.YW_E2E_AUTHORITY_JSON=JSON.stringify({...f.pin,operation:E2E_OPERATION,authorityDigest:E2E_AUTHORITY_DIGEST,hardExpiry:E2E_HARD_EXPIRY});assert.throws(()=>requestDialogueBudget(f.env,student,lesson),/expired/);assert.equal(E2E_HARD_EXPIRY,'2026-10-14T12:00:00Z');assert.equal(f.calls(),0);
});
test('120th logical call is final across days; publisher receipt rotation does not reset it',async t=>{
 const f=await fixture(t);for(let i=0;i<119;i++)f.seed('previous-e2e-'+i,{day:i%2?'2026-10-15':'2026-10-16'});
 const response=await f.send();assert.equal(response.status,200);const snapshot=await response.json();assert.equal(f.calls(),1);
 const denied=await f.send(body(snapshot.revision,'renewal-synthetic-000002'));assert.equal(denied.status,429);const reason=await denied.json();assert.equal(reason.code,'e2e_operation_call_budget_exhausted');assert.equal(reason.resetsAt,undefined);assert(reason.draftSaved);
 const rotated='c'.repeat(64);Object.assign(f.bindings,{YW_ACCEPTANCE_ACTIVATION_SHA256:rotated,YW_FULL_LANGUAGE_ACTIVATION_SHA256:rotated,YW_E2E_AUTHORITY_JSON:JSON.stringify({...f.pin,registryReceiptDigest:rotated}),YW_CALIBRATION_FULL_LANGUAGE_JSON:JSON.stringify({...f.full,registryReceiptDigest:rotated})});
 const env=acceptanceEnvironment(req(),f.bindings);f.sql.prepare("UPDATE dialogue_calls SET day='2026-10-01' WHERE json_extract(budget_policy_json,'$.isolatedAdmission.operation')=?").run(OP);
 const after=await handleDialogue(req(body(snapshot.revision,'renewal-synthetic-000002')),env,student,null,{callModel:()=>{throw Error('must_not_call');}});assert.equal(after.status,429);assert.equal((await after.json()).code,'e2e_operation_call_budget_exhausted');
});
test('two submissions cannot both consume the last operation slot',async t=>{
 const f=await fixture(t);for(let i=0;i<119;i++)f.seed('prior-'+i,{day:'2026-10-16'});
 const results=await Promise.all([f.send(body(0,'renewal-race-submit-0001')),f.send(body(0,'renewal-race-submit-0002'))]);assert.equal(f.calls(),1);assert(results.some(r=>r.status===200));assert(results.some(r=>[409,429].includes(r.status)));
 assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM dialogue_calls WHERE json_extract(budget_policy_json,'$.isolatedAdmission.operation')=?").get(OP).n,120);
});
test('separate lessons share one in-flight slot; a review state blocks a fresh logical call',async t=>{
 for(const state of ['reserved','review']){const f=await fixture(t);f.seed('other-lesson-'+state,{state,accounted:null});const r=await f.send();assert.equal(r.status,429);assert.equal((await r.json()).code,state==='reserved'?'e2e_operation_concurrency_busy':'e2e_operation_review_required');assert.equal(f.calls(),0);}
});
test('all235 prior results must retain the exact source, owner, packet and one model version',async t=>{
 const target=FULL_OPERATION+':'+packet.cases[0].id+':1';
 for(const sql of ["UPDATE dialogue_sessions SET curriculum_json=json_set(curriculum_json,'$.packetDigest','wrong') WHERE id=?", "UPDATE dialogue_events SET details_json=json_set(details_json,'$.modelVersion','other-version') WHERE id=?", "UPDATE dialogue_events SET details_json=json_set(details_json,'$.expectedVerdictMatches',0) WHERE id=?", "UPDATE dialogue_calls SET accounted_micros=NULL WHERE turn_id=?"]){
  const f=await fixture(t);f.sql.prepare(sql).run(target+(sql.startsWith('UPDATE dialogue_sessions')?':session':sql.startsWith('UPDATE dialogue_events')?':result':''));const r=await f.send();assert.equal(r.status,429);assert.equal((await r.json()).code,'e2e_calibration_not_complete');assert.equal(f.calls(),0);
 }
});
for(const [name,edit] of Object.entries({full_missing:f=>delete f.env.YW_CALIBRATION_FULL_LANGUAGE_JSON,
 receipt:f=>f.env.YW_FULL_LANGUAGE_ACTIVATION_SHA256='b'.repeat(64),owner:f=>f.pin.ownerUserId++,
 extra_field:f=>f.pin.readyAt='2026-10-17T11:00:00Z',extended_expiry:f=>f.pin.hardExpiry='2026-10-18T17:00:00Z',
 changed_authority:f=>f.pin.authorityDigest='b'.repeat(64),attempt_count:f=>f.pin.maxProviderAttempts=4,
 model:f=>f.env.YW_DIALOGUE_BUDGET_JSON=JSON.stringify({...policy,model:'gemini-3.5-flash-lite'}),
 }))test('renewal rejects '+name+' without a provider reservation',async t=>{
 const f=await fixture(t);edit(f);f.env.YW_E2E_AUTHORITY_JSON=JSON.stringify(f.pin);const r=await f.send();assert.equal(r.status,503);assert.equal(f.calls(),0);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM dialogue_calls').get().n,235);
});
test('ordinary deployment still enforces40/day despite copied approval variables',async t=>{
 const f=await fixture(t,{ordinary:true,calibrations:0});for(let i=0;i<40;i++)f.seed('ordinary-'+i,{operation:'ordinary'});
 assert.equal(requestDialogueBudget(f.env,student,lesson).isolatedAdmission,undefined);
 const r=await f.send();assert.equal(r.status,429);assert.equal((await r.json()).code,'daily_call_budget_exhausted');assert.equal(f.calls(),0);
});
test('existing global request and money ceilings still subtract unrelated calls',async t=>{
 for(const mode of ['requests','money']){const f=await fixture(t);if(mode==='requests')for(let i=0;i<165;i++)f.seed('outside-'+i,{operation:'outside'});else f.seed('outside-money',{operation:'outside',accounted:50000000});
  const r=await f.send();assert.equal(r.status,429);assert.equal((await r.json()).code,mode==='requests'?'daily_call_budget_exhausted':'daily_money_budget_exhausted');assert.equal(f.calls(),0);
 }
});
test('expiry and changed publisher source are revalidated before provider dispatch',async t=>{
 const f=await fixture(t),budget=requestDialogueBudget(f.env,student,lesson);
 f.env.YW_CALIBRATION_FULL_LANGUAGE_JSON=JSON.stringify({...f.full,sourceCommit:'c'.repeat(40)});
 await assert.rejects(()=>callDialogueModel(f.env,'synthetic','synthetic',()=>{},budget),/e2e_activation_changed/);
 f.env.YW_CALIBRATION_FULL_LANGUAGE_JSON=JSON.stringify(f.full);mock.timers.setTime(Date.parse(expiry));
 await assert.rejects(()=>callDialogueModel(f.env,'synthetic','synthetic',()=>{},budget),/e2e_renewal_activation_invalid/);
});
for(const [name,edit] of Object.entries({missing_version:r=>delete r.modelVersion,changed_version:r=>r.modelVersion='other-version',missing_usage:r=>r.usage=null,missing_accounting:r=>r.providerAccounting=null}))test(name+' stores the received result and blocks new logical calls',async t=>{
 const f=await fixture(t);const r=await f.send(body(),async()=>{const result=success();edit(result);return result;});assert.equal(r.status,200);const data=await r.json();
 const row=f.sql.prepare("SELECT * FROM dialogue_calls WHERE json_extract(budget_policy_json,'$.isolatedAdmission.operation')=?").get(OP);assert.equal(row.state,'review');assert.equal(row.accounted_micros,null);assert.equal(row.reserved_micros,252000);
 const saved=JSON.parse(f.sql.prepare("SELECT details_json FROM dialogue_events WHERE turn_id=? AND event_type='response_unconfirmed'").get(row.turn_id).details_json);assert(saved.received);assert(saved.renewalReason.startsWith('e2e_'));
 assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM dialogue_turns WHERE reply_to=? AND role='teacher'").get(row.turn_id).n,0);
 const next=await f.send(body(data.revision,'renewal-following-000002'));assert.equal(next.status,429);assert.equal((await next.json()).code,'e2e_operation_review_required');
});
test('proven partial continuation reuses the original reservation and only its two remaining slots',async t=>{
 const f=await fixture(t),text='尚未完整的回應';
 const failed=await f.send(body(),async(_e,_p,_id,onReply)=>{await onReply(text);const error=Error('gateway_stream_unconfirmed'),a=success().providerAccounting;a.attempts[0]={...a.attempts[0],outcome:'FETCH_ERROR',usage:null};error.gatewayFailure={providerAccounting:a};throw error;});
 const data=await failed.json();assert(data.partial.continuation.allowed);const id=data.partial.turnId;
 const input={action:'continue',revision:data.revision,turnId:id,partialDigest:data.partial.digest,mutationId:'renewal-continuation-001'};
 const r=await f.send(input,async(_e,_p,_id,_reply,budget)=>{assert.equal(budget.providerAttemptLimit,2);const result=success();result.value.reply=text+'，請再指出原文。';result.providerAccounting.maxProviderAttempts=2;return result;});assert.equal(r.status,200);
 const row=f.sql.prepare('SELECT * FROM dialogue_calls WHERE turn_id=?').get(id);assert.equal(row.state,'finished');assert.equal(row.reserved_micros,252000);assert.equal(row.accounted_micros,84450);
 assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM dialogue_calls WHERE json_extract(budget_policy_json,'$.isolatedAdmission.operation')=?").get(OP).n,1);
 assert.equal((await f.send(input,()=>{throw Error('duplicate_provider');})).status,200);
});
