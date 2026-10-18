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
const at=Date.parse('2026-10-18T09:55:00Z'),expiry='2026-10-18T13:14:55.135Z';
beforeEach(()=>mock.timers.enable({apis:['Date'],now:at}));afterEach(()=>mock.timers.reset());
const student={id:1,ucUserId:553};
const policy={version:'synthetic-unit',validUntil:expiry,currency:'USD',model:packet.model,globalDailyMicros:50000000,userDailyMicros:50000000,lessonLifetimeMicros:50000000,reserveMicros:84000,inputMicrosPerMillion:0,outputMicrosPerMillion:0};
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
 const authority={version:'yw-full-language-activation-v1',enabled:true,operation:OP,authorityDigest:H,packetDigest:packet.sourceDigest,sourceCommit:'b'.repeat(40),artifactSha256:H,origin,ownerUserId:553,databaseId:database,apisVersion:version,registryReceiptDigest:H,singleProviderSourceProofDigest:H,priorReceiptSetDigest:await digest(priorReceipts),priorReceipts,readyAt:'2026-10-18T07:14:55.135Z',hardExpiry:expiry,maxAttempts:28,maxReservedMicros:2352000,maxProviderAttempts:1,reserveMicros:84000,maxConcurrency:1,recoveryReadbacks:[]};
 const bindings={YW_ACCEPTANCE_EXPIRES_AT:expiry,YW_ACCEPTANCE_USER_ID:'553',YW_FORMAL_APIS_VERSION:version,YW_ACCEPTANCE_DATABASE_ID:database,YW_ACCEPTANCE_ACTIVATION_SHA256:H,ACCEPTANCE_DB:db,ASSETS:{fetch:async r=>new Response(projectReleaseJson(new URL(r.url).pathname.slice(1),fs.readFileSync('site'+new URL(r.url).pathname,'utf8')))},USER_CENTER_EVIDENCE:{resolveSession:async()=>({userId:553})},APIS_CALLER_TOKEN:'synthetic-caller-only',APIS:{fetch:()=>{throw Error('real_network_forbidden');}},YW_DIALOGUE_BUDGET_JSON:JSON.stringify(policy),YW_CALIBRATION_FULL_LANGUAGE_JSON:JSON.stringify(authority),YW_FULL_LANGUAGE_ACTIVATION_SHA256:H};
 const env=acceptanceEnvironment(req(),bindings);
 let calls=0;const model=async(e,p,id,onReply,budget)=>{calls++;assert.equal(budget.providerAttemptLimit,1);assert.equal(budget.logicalProviderAttemptLimit,1);await onReply('原句');return structuredClone(success);};
 const get=async(c=negative[0])=>await(await handle(req(c),env,student,model)).json();
 const post=async(c=negative[0],fn=model,extra={})=>{const rb=await get(c);return await(await handle(req(c,{action:'calibration_full_language',ownerRef:rb.ownerRef,...extra}),env,student,fn)).json();};
 const external=(id,cost=0)=>{const sid=old[0].turn_id+':session';sql.prepare("INSERT INTO dialogue_turns(id,session_id,mutation_id,request_hash,role,content,status,policy_version,created_at) VALUES(?,?,?,?,'student','synthetic','synthetic_calibration',?,'2026-10-17T01:00:00Z')").run(id,sid,id,H,packet.policyVersion);sql.prepare("INSERT INTO dialogue_calls(turn_id,session_id,student_id,day,reserved_tokens,state,created_at,reserved_micros,accounted_micros,budget_policy_json) VALUES(?,?,1,'2026-10-17',2400,'finished','2026-10-17T01:00:00Z',84000,?,'{}')").run(id,sid,cost);};
 return {sql,env,bindings,authority,get,post,model,external,calls:()=>calls};
}

import {QUOTE_RECOVERY as Q,quotationRecovery,recoveryPrompt,fullReceipt} from '../site/dialogue-full-language.js';
import {validateProposal} from '../site/dialogue-policy.js';
import {inspectCalibrationReadback} from './dialogue_calibration_import.mjs';
// Exact retained synthetic readback is supplied locally, never copied into public source.
const retained=process.env.YW_RECOVERY_READBACK?JSON.parse(fs.readFileSync(process.env.YW_RECOVERY_READBACK,'utf8')).response.result.value.body:null;
const recoveryTest=(name,fn)=>test(name,{skip:!retained&&'Set YW_RECOVERY_READBACK to the retained failed synthetic readback'},fn);
const target=packet.cases.find(c=>c.id===Q.caseId),nextCase=negative.find(c=>c.group==='representative-28');
async function recoverFixture(t){
 const f=await fixture(t),r=retained.rawRow,sid=r.session_id;
 f.sql.prepare('INSERT INTO dialogue_sessions(id,student_id,lesson_id,curriculum_version,curriculum_json,policy_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(sid,1,'calibration:'+target.lessonId,OP+':'+target.id+':1',r.curriculum_json,packet.policyVersion,r.created_at,r.finished_at);
 f.sql.prepare("INSERT INTO dialogue_turns(id,session_id,mutation_id,request_hash,role,content,status,policy_version,created_at) VALUES(?,?,?,?,'student','synthetic retained calibration','synthetic_calibration',?,?)").run(r.turn_id,sid,target.id,target.promptDigest,packet.policyVersion,r.created_at);
 f.sql.prepare("INSERT INTO dialogue_calls(turn_id,session_id,student_id,day,reserved_tokens,state,created_at,reserved_micros,accounted_micros,finished_at,budget_policy_json,usage_json) VALUES(?,?,1,?,2400,'review',?,84000,0,?,?,?)").run(r.turn_id,sid,r.day,r.created_at,r.finished_at,r.budget_policy_json,r.usage_json);
 f.sql.prepare('INSERT INTO dialogue_events(id,session_id,turn_id,event_type,details_json,created_at) VALUES(?,?,?,?,?,?)').run(r.turn_id+':result',sid,r.turn_id,'synthetic_calibration_unconfirmed',r.details_json,r.finished_at);
 Object.assign(f.authority,{maxAttempts:29,maxReservedMicros:29*84000,recoveryReadbacks:[{...Q}]});f.env.YW_CALIBRATION_FULL_LANGUAGE_JSON=JSON.stringify(f.authority);
 const source=JSON.parse(projectReleaseJson('dialogue-curriculum/'+target.lessonId+'.json',JSON.stringify(loadCurriculum(target.lessonId)))),material=fullMaterialize(target,source);
 // Artificial local fixture only. The retained model answer and receipt are never edited.
 const localValue=structuredClone(retained.result.received.value);
 for(const a of localValue.assessments)for(const e of a.evidence)e.passageQuote='君子博学而日参省乎己';
 validateProposal(localValue,material);
 let sends=0;
 const provider=async(e,p,id,onReply,budget)=>{sends++;assert.equal(id,OP+':'+target.id+':2');assert.equal(p,recoveryPrompt(material.prompt));assert.equal(budget.providerAttemptLimit,1);return {...structuredClone(retained.result.received),value:localValue};};
 const request=async(c=target,attempt=2,fn=provider)=>{const rb=await(await handle(req(c,null,attempt),f.env,student,fn)).json();return await(await handle(req(c,{action:'calibration_full_language',ownerRef:rb.ownerRef},attempt),f.env,student,fn)).json();};
 return {...f,request,provider,sends:()=>sends,material};
}
recoveryTest('recovery delta: original failed evidence still fails; only citation formatting changes one derived prompt',async()=>{
 assert.equal(await fullReceipt(retained.rawRow),Q.receiptDigest);
 for(const c of releaseCasesLocal()){
  const source=JSON.parse(projectReleaseJson('dialogue-curriculum/'+c.lessonId+'.json',JSON.stringify(loadCurriculum(c.lessonId)))),m=fullMaterialize(c,source);
  assert.equal(await digest(m.prompt),c.promptDigest);
  if(c.id===Q.caseId){assert.throws(()=>validateProposal(retained.result.received.value,m),/unverifiable_evidence/);assert.equal(await digest(recoveryPrompt(m.prompt)),Q.promptDigest);assert(recoveryPrompt(m.prompt).startsWith(m.prompt));}
 }
});
function releaseCasesLocal(){return packet.cases.filter(c=>c.group==='representative-28');}
recoveryTest('recovery delta: exact receipt authority, immutable failed row, one new attempt and subsequent case',async t=>{
 const f=await recoverFixture(t);assert(fullActivation(f.env,packet));
 const before=await f.get(target);assert.equal(await fullReceipt(before.rawRow),Q.receiptDigest);
 assert.equal((await f.request(nextCase,1)).code,'full_recovery_required');
 const r=await f.request();assert.equal(r.call.state,'finished');assert.equal(r.attempt,2);assert.equal(f.sends(),1);assert.equal(await fullReceipt(r.recoveryFailure),Q.receiptDigest);assert.equal(r.rows.length,2);assert.equal(r.rows.reduce((n,x)=>n+x.reservedMicros,0),168000);
 const again=await f.request();assert.equal(again.receiptDigest,r.receiptDigest);assert.equal(f.sends(),1);
 const execution={...f.authority,activationDigest:f.authority.registryReceiptDigest,ownerRef:r.ownerRef,budget:JSON.parse(r.rawRow.budget_policy_json)};
 const checked=await inspectCalibrationReadback(r,execution);assert.equal(checked.recoveryOf,Q.receiptDigest);assert.equal(checked.attemptId,r.attemptId);
 const other=await f.request(nextCase,1,async()=>({...success,modelVersion:packet.model}));assert.equal(other.call.state,'finished');
 assert.equal(await fullReceipt((await f.get(target)).rawRow),Q.receiptDigest);
});
recoveryTest('recovery delta: wrong receipt, extra authority fields, unrelated case and a third attempt are denied',async t=>{
 const f=await recoverFixture(t);
 for(const patch of [{receiptDigest:H},{attempt:3},{caseId:nextCase.id},{promptDigest:H},{extra:true}]){const a={...f.authority,recoveryReadbacks:[{...Q,...patch}]};assert.equal(fullActivation({...f.env,YW_CALIBRATION_FULL_LANGUAGE_JSON:JSON.stringify(a)},packet),null);}
 for(const patch of [{maxAttempts:30},{maxReservedMicros:30*84000}])assert.equal(fullActivation({...f.env,YW_CALIBRATION_FULL_LANGUAGE_JSON:JSON.stringify({...f.authority,...patch})},packet),null);
 assert.equal((await(await handle(req(target,null,3),f.env,student,f.provider)).json()).code,'calibration_case_invalid');
 assert.equal((await(await handle(req(nextCase,null,2),f.env,student,f.provider)).json()).code,'calibration_case_invalid');
 f.sql.prepare("UPDATE dialogue_calls SET accounted_micros=1 WHERE turn_id=?").run(Q.attemptId);assert.equal((await f.request()).code,'full_recovery_receipt_mismatch');assert.equal(f.sends(),0);
});
recoveryTest('recovery delta: another failed result stops all remaining cases and cannot be retried',async t=>{
 const f=await recoverFixture(t);let n=0;const fail=async()=>{n++;return structuredClone(retained.result.received);};
 const r=await f.request(target,2,fail);assert.equal(r.call.state,'review');assert.equal(r.result.reason,'unverifiable_evidence');
 assert.equal((await f.request(nextCase,1)).code,'full_boundary_stop');assert.equal((await f.request(target,2,fail)).receiptDigest,r.receiptDigest);assert.equal(n,1);
});
recoveryTest('recovery delta: unchanged deadline and atomic concurrency prevent late or duplicated sends',async t=>{
 const f=await recoverFixture(t);let n=0;const provider=async(...args)=>{n++;return f.provider(...args);};
 const results=await Promise.all([f.request(target,2,provider),f.request(target,2,provider)]);assert.equal(n,1);assert(results.some(r=>r.call?.state==='finished'));assert(results.some(r=>r.code==='full_atomic_admission_stopped'||r.call?.state==='finished'));
 mock.timers.setTime(Date.parse(expiry));assert.equal((await handle(req(target,null,2),f.env,student,provider)).status,404);assert.equal(n,1);
});
recoveryTest('recovery delta: 29 charges include the failure and no additional case may pass the cap',async t=>{
 const f=await recoverFixture(t),r=await f.request(),rows=[...r.rows];
 for(const c of releaseCasesLocal().filter(c=>c.id!==Q.caseId))rows.push({sourceValid:true,caseId:c.id,attemptId:OP+':'+c.id+':1',receiptDigest:'b'.repeat(64),state:'finished',reservedMicros:84000,accountedMicros:0,finishedAt:new Date(at).toISOString(),finalAssessment:true,boundaryStop:false,model:packet.model,modelVersion:packet.model});
 assert.equal(rows.length,29);assert.equal(rows.reduce((n,x)=>n+x.reservedMicros,0),2436000);
 assert.equal(fullAdmission({authority:f.authority,packet,caseId:nextCase.id,rows,history:r.history,capacity:r.capacity,now:at}).code,'full_operation_exhausted');
});
recoveryTest('recovery delta: failed receipt drift between snapshot and reservation is rejected atomically',async t=>{
 const f=await recoverFixture(t),original=f.env.READING_DB.batch;
 f.env.READING_DB.batch=async rows=>{f.sql.prepare("UPDATE dialogue_events SET details_json=details_json||' ' WHERE id=?").run(Q.attemptId+':result');return original(rows);};
 assert.equal((await f.request()).code,'full_atomic_admission_stopped');assert.equal(f.sends(),0);
});
