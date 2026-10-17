import test,{beforeEach,afterEach,mock} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {acceptanceEnvironment} from '../site/dialogue-acceptance.js';
import {projectReleaseJson} from './build_release_site.mjs';
import {handleFullLanguageCalibration as handle} from '../site/dialogue-full-language-runtime.js';
import {fullActivation,fullAdmission,fullMaterialize,digest,FULL_OPERATION as OP,FULL_CASE_COUNT,ORIGINAL_RECEIPTS} from '../site/dialogue-full-language.js';
import {fullLanguagePacket,loadCurriculum} from './dialogue_full_language.mjs';
import packet from '../site/dialogue-full-language-packet.json' with {type:'json'};
const old=JSON.parse(fs.readFileSync(new URL('./fixtures/dialogue-full-language-history.json',import.meta.url)));
const H='a'.repeat(64),origin='https://yw-acceptance.bdfz.net',version='11111111-2222-4333-8444-555555555555',database='c45988a6-9094-4306-bcce-98704b3989e3';
const at=Date.parse('2026-10-17T12:00:00Z'),expiry='2026-10-17T17:00:00Z';
beforeEach(()=>mock.timers.enable({apis:['Date'],now:at}));afterEach(()=>mock.timers.reset());
const student={id:1,ucUserId:553};
const policy={version:'synthetic-unit',validUntil:expiry,currency:'USD',model:packet.model,globalDailyMicros:50000000,userDailyMicros:50000000,lessonLifetimeMicros:50000000,reserveMicros:84000,inputMicrosPerMillion:750000,outputMicrosPerMillion:3750000};
const negative=packet.cases.filter(c=>c.expected!=='demonstrated'),positive=packet.cases.find(c=>c.expected==='demonstrated');
const req=(c=negative[0],body=null,attempt=1)=>new Request(origin+`/api/dialogue/v1?lessonId=${c.lessonId}&calibrationOperation=${OP}&calibration=${c.id}&attempt=${attempt}`,body?{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)}:{});
const success={value:{reply:'請再核對原句。',assessments:[]},model:packet.model,modelVersion:'synthetic-unit-only',providerAttemptCount:1,usage:{promptTokenCount:100,totalTokenCount:150},firstTokenMs:100};
async function fixture(t){
 const sql=new DatabaseSync(':memory:');for(const f of fs.readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())sql.exec(fs.readFileSync('migrations/'+f,'utf8'));
 sql.exec("INSERT INTO students(id,uc_slug,display_name) VALUES(1,'synthetic-owner','Unit owner')");t.after(()=>sql.close());
 const wrap=(text,args=[])=>({bind:(...v)=>wrap(text,v),first:async()=>sql.prepare(text).get(...args)||null,all:async()=>({results:sql.prepare(text).all(...args)}),run:async()=>({meta:{changes:Number(sql.prepare(text).run(...args).changes)}}),runSync:()=>({meta:{changes:Number(sql.prepare(text).run(...args).changes)}})});
 const db={prepare:text=>wrap(text),batch:async rows=>{sql.exec('BEGIN');try{const r=rows.map(s=>s.runSync());sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 for(const r of old){const sid=r.turn_id+':session';sql.prepare('INSERT INTO dialogue_sessions(id,student_id,lesson_id,curriculum_version,curriculum_json,policy_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(sid,1,'calibration:history',r.turn_id,r.curriculum_json,packet.policyVersion,r.created_at,r.finished_at);sql.prepare("INSERT INTO dialogue_turns(id,session_id,mutation_id,request_hash,role,content,status,policy_version,created_at) VALUES(?,?,?,?, 'student','synthetic historical fixture','synthetic_calibration',?,?)").run(r.turn_id,sid,r.turn_id,H,packet.policyVersion,r.created_at);sql.prepare("INSERT INTO dialogue_calls(turn_id,session_id,student_id,day,reserved_tokens,state,created_at,reserved_micros,accounted_micros,finished_at,budget_policy_json) VALUES(?,?,1,?,2400,?,?,?,?,?,?)").run(r.turn_id,sid,r.created_at.slice(0,10),r.state,r.created_at,r.reserved_micros,r.accounted_micros,r.finished_at,JSON.stringify(policy));sql.prepare('INSERT INTO dialogue_events(id,session_id,turn_id,event_type,details_json,created_at) VALUES(?,?,?,?,?,?)').run(r.turn_id+':result',sid,r.turn_id,'synthetic_calibration_result',r.details_json,r.finished_at);}
 const priorReceipts=[...ORIGINAL_RECEIPTS].sort((a,b)=>a.attemptId<b.attemptId?-1:1);
 const authority={version:'yw-full-language-activation-v1',enabled:true,operation:OP,authorityDigest:H,packetDigest:packet.sourceDigest,sourceCommit:'b'.repeat(40),artifactSha256:H,origin,ownerUserId:553,databaseId:database,apisVersion:version,registryReceiptDigest:H,singleProviderSourceProofDigest:H,priorReceiptSetDigest:await digest(priorReceipts),priorReceipts,readyAt:'2026-10-17T11:00:00Z',hardExpiry:expiry,maxAttempts:235,maxReservedMicros:19740000,maxProviderAttempts:1,reserveMicros:84000,maxConcurrency:1,recoveryReadbacks:[]};
 const bindings={YW_ACCEPTANCE_EXPIRES_AT:expiry,YW_ACCEPTANCE_USER_ID:'553',YW_ACCEPTANCE_APIS_VERSION:version,YW_ACCEPTANCE_DATABASE_ID:database,YW_ACCEPTANCE_ACTIVATION_SHA256:H,ACCEPTANCE_DB:db,ASSETS:{fetch:async r=>new Response(projectReleaseJson(new URL(r.url).pathname.slice(1),fs.readFileSync('site'+new URL(r.url).pathname,'utf8')))},USER_CENTER_EVIDENCE:{resolveSession:async()=>({userId:553})},APIS_ACCEPTANCE:{fetch:()=>{throw Error('real_network_forbidden');}},YW_DIALOGUE_BUDGET_JSON:JSON.stringify(policy),YW_CALIBRATION_FULL_LANGUAGE_JSON:JSON.stringify(authority),YW_FULL_LANGUAGE_ACTIVATION_SHA256:H};
 const env=acceptanceEnvironment(req(),bindings);
 let calls=0;const model=async(e,p,id,onReply,budget)=>{calls++;assert.equal(budget.providerAttemptLimit,1);assert.equal(budget.logicalProviderAttemptLimit,1);await onReply('原句');return structuredClone(success);};
 const get=async(c=negative[0])=>await(await handle(req(c),env,student,model)).json();
 const post=async(c=negative[0],fn=model,extra={})=>{const rb=await get(c);return await(await handle(req(c,{action:'calibration_full_language',ownerRef:rb.ownerRef,...extra}),env,student,fn)).json();};
 const external=(id,cost=0)=>{const sid=old[0].turn_id+':session';sql.prepare("INSERT INTO dialogue_turns(id,session_id,mutation_id,request_hash,role,content,status,policy_version,created_at) VALUES(?,?,?,?,'student','synthetic','synthetic_calibration',?,'2026-10-17T01:00:00Z')").run(id,sid,id,H,packet.policyVersion);sql.prepare("INSERT INTO dialogue_calls(turn_id,session_id,student_id,day,reserved_tokens,state,created_at,reserved_micros,accounted_micros,budget_policy_json) VALUES(?,?,1,'2026-10-17',2400,'finished','2026-10-17T01:00:00Z',84000,?,'{}')").run(id,sid,cost);};
 return {sql,env,bindings,authority,get,post,model,external,calls:()=>calls};
}
test('235 fixed cases reconstruct from all189 current private sources and cover all78 language items',async()=>{
 assert.equal(packet.active,false);assert.equal(packet.paidCallsAuthorized,false);
 assert.equal(await digest(await fullLanguagePacket()),await digest(packet));
 const {sourceDigest,...unsigned}=packet;assert.equal(await digest(unsigned),sourceDigest);
 assert.equal(packet.cases.filter(c=>c.group==='representative-28').length,28);assert.equal(packet.cases.filter(c=>c.group==='remaining-207').length,207);
 const language=new Set();for(const c of packet.cases){const raw=loadCurriculum(c.lessonId),source=JSON.parse(projectReleaseJson('dialogue-curriculum/'+c.lessonId+'.json',JSON.stringify(raw)));assert.equal(await digest(raw),c.rawSourceDigest,c.id);assert.equal(await digest(source),c.sourceDigest,c.id);assert.equal(await digest(fullMaterialize(c,source).prompt),c.promptDigest,c.id);assert(c.sourceGate.eligible);if(c.itemVersion)language.add(c.objectiveId);}
 assert.equal(language.size,78);assert.equal(packet.sourceFiles.length,189);
});
test('activation is a server-held isolated capability; unknown fields, wrong pins, retries and renewed old expiry fail closed',async t=>{
 const f=await fixture(t);assert(fullActivation(f.env,packet));assert.equal(fullActivation({...f.env},packet),null);
 for(const edit of [a=>a.enabled=false,a=>a.ownerUserId=1,a=>a.origin='https://yw.bdfz.net',a=>a.apisVersion='66cfaab9-e1a4-4a31-a8c4-98e656db7e04',a=>a.sourceCommit=null,a=>a.packetDigest=H,a=>a.extra=true,a=>a.registryReceiptDigest='c'.repeat(64),a=>a.priorReceipts[0].receiptDigest='f'.repeat(64),a=>a.maxProviderAttempts=3,a=>a.maxAttempts=236,a=>a.maxConcurrency=2,a=>a.hardExpiry='2026-10-14T12:00:00Z',a=>a.readyAt='2026-10-17T10:59:59Z',a=>a.recoveryReadbacks=[{}]]){const a=structuredClone(f.authority);edit(a);f.env.YW_CALIBRATION_FULL_LANGUAGE_JSON=JSON.stringify(a);assert.equal(fullActivation(f.env,packet),null);}
 assert.equal(f.calls(),0);
});
test('default inactive and ordinary environments cannot write or spend, including body-supplied authority',async t=>{
 const f=await fixture(t);delete f.env.YW_CALIBRATION_FULL_LANGUAGE_JSON;
 assert.equal((await f.post()).code,'full_activation_required');assert.equal((await f.post(negative[0],f.model,{authority:f.authority})).code,'calibration_input_invalid');
 const response=await handle(req(),{READING_DB:{prepare(){throw Error('must_not_read');}}},student,f.model);assert.equal(response.status,404);
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM dialogue_calls').get().n,7);assert.equal(f.calls(),0);
});
test('SQLite reserves one charge, preserves all seven opaque receipts, and deduplicates POST',async t=>{
 const f=await fixture(t),before=f.sql.prepare('SELECT * FROM dialogue_calls ORDER BY turn_id').all();
 const result=await f.post();assert.equal(result.call.state,'finished');assert.equal(result.history.attempts,7);assert.equal(result.history.unknownReservedMicros,420000);assert(result.history.reconciled);assert.equal(f.calls(),1);
 assert.equal((await f.post()).receiptDigest,result.receiptDigest);assert.equal(f.calls(),1);assert.deepEqual(f.sql.prepare('SELECT * FROM dialogue_calls WHERE turn_id NOT LIKE ? ORDER BY turn_id').all(OP+':%'),before);
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM dialogue_calls').get().n,8);
});
test('first quality failure stops the entire batch and repeat reads do not refund its cost',async t=>{
 const f=await fixture(t),failed=await f.post(positive);assert.equal(failed.call.state,'review');assert(failed.call.accounted_micros>0);
 assert.equal((await f.post()).code,'full_boundary_stop');assert.equal((await f.post(positive)).receiptDigest,failed.receiptDigest);assert.equal(f.calls(),1);
 const retry=await handle(req(positive,{action:'calibration_full_language',ownerRef:failed.ownerRef},2),f.env,student,f.model);assert.equal(retry.status,400);assert.equal(f.calls(),1);
});
for(const [name,fn] of [
 ['unknown usage',async()=>({...success,usage:null})],['model mismatch',async()=>({...success,model:'gemini-other'})],['missing model version',async()=>({...success,modelVersion:null})],['multiple attempts',async()=>({...success,providerAttemptCount:2})],['provider exception',async()=>{throw Error('gateway_unavailable');}],['partial stream',async(e,p,id,onReply)=>{await onReply('部分原話');throw Error('gateway_stream_unconfirmed');}],
])test(name+' preserves reservation and stops all subsequent cases',async t=>{
 const f=await fixture(t),failed=await f.post(negative[0],fn);assert.equal(failed.call.state,'review');assert.equal(failed.call.reserved_micros,84000);assert.equal((await f.post(negative[1])).code,'full_boundary_stop');assert.equal(f.calls(),0);if(name==='partial stream')assert.equal(failed.chunks[0].content,'部分原話');
});
test('changed history and wrong source stop before any charge',async t=>{
 const f=await fixture(t);f.sql.prepare("UPDATE dialogue_events SET details_json='{}' WHERE id=?").run(old[0].turn_id+':result');assert.equal((await f.post()).code,'full_history_unreconciled');assert.equal(f.calls(),0);
 const g=await fixture(t);g.env.ASSETS={fetch:async()=>Response.json({wrong:true})};assert.equal((await g.post()).code,'full_source_mismatch');assert.equal(g.calls(),0);assert.equal(g.sql.prepare('SELECT COUNT(*) n FROM dialogue_calls').get().n,7);
});
test('concurrent SQLite requests allow exactly one operation reservation',async t=>{
 const f=await fixture(t);let release,started;const barrier=new Promise(r=>release=r),entered=new Promise(r=>started=r);
 const first=f.post(negative[0],async(...args)=>{started();await barrier;return f.model(...args);});await entered;
 assert.equal((await f.post(negative[1])).code,'full_concurrency_busy');release();assert.equal((await first).call.state,'finished');assert.equal(f.calls(),1);
});
test('calibration and renewed E2E share the same one-at-a-time boundary',async t=>{
 const f=await fixture(t);f.external('e2e-inflight');f.sql.prepare("UPDATE dialogue_calls SET state='reserved',budget_policy_json=?,created_at=? WHERE turn_id='e2e-inflight'").run(JSON.stringify({isolatedAdmission:{operation:'yw-e2e-real-dialogue-20261017-v1'}}),new Date(at).toISOString());
 assert.equal((await f.post()).code,'full_concurrency_busy');assert.equal(f.calls(),0);
});
test('a provider model-version change preserves the result and ends calibration',async t=>{
 const f=await fixture(t);assert.equal((await f.post()).call.state,'finished');
 const changed=await f.post(negative[1],async()=>({...success,modelVersion:'other-provider-version'}));assert.equal(changed.call.state,'review');assert.equal(changed.result.received.modelVersion,'other-provider-version');assert.equal(changed.result.reason,'calibration_model_version_mismatch');
 assert.equal((await f.post(negative[2])).code,'full_boundary_stop');
});
test('a current-operation receipt from another packet blocks continuation',async t=>{
 const f=await fixture(t),r=await f.post();
 f.sql.prepare("UPDATE dialogue_sessions SET curriculum_json=json_set(curriculum_json,'$.packetDigest',?) WHERE id=?").run(H,r.rawRow.session_id);
 assert.equal((await f.post(negative[1])).code,'full_ledger_invalid');assert.equal(f.calls(),1);
});
test('SQLite operation count stops at235 regardless of dates and known low cost',async t=>{
 const f=await fixture(t),target=negative[0];
 for(const c of packet.cases.filter(c=>c.id!==target.id)){
  const id=OP+':'+c.id+':1',sid=id+':session',created='2026-10-17T11:30:00Z';
  f.sql.prepare('INSERT INTO dialogue_sessions(id,student_id,lesson_id,curriculum_version,curriculum_json,policy_version,created_at,updated_at) VALUES(?,1,?,?,?,?,?,?)').run(sid,'calibration:'+c.lessonId,OP+':'+c.id+':1',JSON.stringify({caseId:c.id,sourceDigest:c.sourceDigest,promptDigest:c.promptDigest,packetDigest:packet.sourceDigest}),packet.policyVersion,created,created);
  f.sql.prepare("INSERT INTO dialogue_turns(id,session_id,mutation_id,request_hash,role,content,status,policy_version,created_at) VALUES(?,?,?,?,'student','synthetic','synthetic_calibration',?,?)").run(id,sid,id,H,packet.policyVersion,created);
  f.sql.prepare("INSERT INTO dialogue_calls(turn_id,session_id,student_id,day,reserved_tokens,state,created_at,reserved_micros,accounted_micros,finished_at,budget_policy_json) VALUES(?,?,1,'2026-10-17',2400,'finished',?,84000,1,?,'{}')").run(id,sid,created,created);
  f.sql.prepare('INSERT INTO dialogue_events(id,session_id,turn_id,event_type,details_json,created_at) VALUES(?,?,?,?,?,?)').run(id+':result',sid,id,'synthetic_calibration_result',JSON.stringify({model:packet.model,modelVersion:'synthetic-unit-only',value:{}}),created);
 }
 const r=await f.post(target);assert.equal(r.rows.length,235);assert.equal(r.call.state,'finished');assert.equal(f.calls(),1);
 assert.equal(r.rows.reduce((sum,r)=>sum+r.reservedMicros,0),19740000);
 const admission=fullAdmission({authority:f.authority,packet,caseId:target.id,rows:r.rows,history:r.history,capacity:r.capacity,now:at});assert.equal(admission.code,'full_operation_exhausted');
});
test('atomic admission at399 charges at most once and global money includes other namespaces',async t=>{
 const f=await fixture(t);for(let i=0;i<399;i++)f.external('outside:'+i);
 const results=await Promise.all([f.post(negative[0]),f.post(negative[1])]);assert.equal(f.calls(),1);assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM dialogue_calls WHERE day='2026-10-17'").get().n,400);assert(results.some(r=>['full_atomic_admission_stopped','full_shared_capacity_exhausted','full_concurrency_busy'].includes(r.code)));
 const g=await fixture(t);g.external('outside-money',50000000);assert.equal((await g.post()).code,'full_shared_capacity_exhausted');assert.equal(g.calls(),0);
});
test('authority expires at the boundary; no reset via a new day or recovery',async t=>{
 const f=await fixture(t);mock.timers.setTime(Date.parse(expiry));assert.equal((await handle(req(),f.env,student,f.model)).status,404);assert.equal(fullActivation(f.env,packet),null);
 const authority={priorReceiptSetDigest:H,readyAt:'2026-10-17T11:00:00Z',hardExpiry:expiry},history={reconciled:true,receiptSetDigest:H},capacity={globalDayCalls:0,reservedConcurrentCalls:0,operationConcurrentCalls:0,globalDayConservativeMicros:0,userDayConservativeMicros:0};
 const rows=packet.cases.map(c=>({sourceValid:true,caseId:c.id,attemptId:OP+':'+c.id+':1',reservedMicros:84000,accountedMicros:1,state:'finished',finishedAt:'2026-10-17T11:30:00Z',model:packet.model,modelVersion:'synthetic-unit-only',finalAssessment:true}));
 const plan=extra=>fullAdmission({authority,packet,history,capacity,caseId:negative[0].id,now:at,...extra});
 assert.equal(plan({rows}).code,'full_operation_exhausted');assert.equal(plan({recoveryOf:'old'}).code,'full_recovery_not_authorized');assert.equal(plan({now:at+86400000}).code,'full_expired');assert.equal(FULL_CASE_COUNT,235);
 for(const patch of [{state:'unknown'},{accountedMicros:84001},{finishedAt:null},{attemptId:'old-operation'}])assert.equal(plan({rows:[{...rows[0],...patch}]}).code,'full_ledger_invalid');
});
