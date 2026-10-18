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

import {QUOTE_RECOVERY as Q,TIMEOUT_RECOVERY as T,quotationRecovery,recoveryPrompt,fullReceipt} from '../site/dialogue-full-language.js';
import {validateProposal} from '../site/dialogue-policy.js';
import {inspectCalibrationReadback} from './dialogue_calibration_import.mjs';
// Exact retained synthetic readback is supplied locally, never copied into public source.
const retained=process.env.YW_RECOVERY_READBACK?JSON.parse(fs.readFileSync(process.env.YW_RECOVERY_READBACK,'utf8')).response.result.value.body:null;
const timed=process.env.YW_TIMEOUT_READBACK?JSON.parse(fs.readFileSync(process.env.YW_TIMEOUT_READBACK,'utf8')).response.result.value.body:null;
const recoveryTest=(name,fn)=>test(name,{skip:(!retained||!timed)&&'Both retained readbacks required'},fn);
const target=packet.cases.find(c=>c.id===Q.caseId),nextCase=negative.find(c=>c.group==='representative-28');
async function recoverFixture(t){
 const f=await fixture(t),r=retained.rawRow,sid=r.session_id;
 f.sql.prepare('INSERT INTO dialogue_sessions(id,student_id,lesson_id,curriculum_version,curriculum_json,policy_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(sid,1,'calibration:'+target.lessonId,OP+':'+target.id+':1',r.curriculum_json,packet.policyVersion,r.created_at,r.finished_at);
 f.sql.prepare("INSERT INTO dialogue_turns(id,session_id,mutation_id,request_hash,role,content,status,policy_version,created_at) VALUES(?,?,?,?,'student','synthetic retained calibration','synthetic_calibration',?,?)").run(r.turn_id,sid,target.id,target.promptDigest,packet.policyVersion,r.created_at);
 f.sql.prepare("INSERT INTO dialogue_calls(turn_id,session_id,student_id,day,reserved_tokens,state,created_at,reserved_micros,accounted_micros,finished_at,budget_policy_json,usage_json) VALUES(?,?,1,?,2400,'review',?,84000,0,?,?,?)").run(r.turn_id,sid,r.day,r.created_at,r.finished_at,r.budget_policy_json,r.usage_json);
 f.sql.prepare('INSERT INTO dialogue_events(id,session_id,turn_id,event_type,details_json,created_at) VALUES(?,?,?,?,?,?)').run(r.turn_id+':result',sid,r.turn_id,'synthetic_calibration_unconfirmed',r.details_json,r.finished_at);
 const tr=timed.rawRow;
 f.sql.prepare('INSERT INTO dialogue_sessions(id,student_id,lesson_id,curriculum_version,curriculum_json,policy_version,created_at,updated_at) VALUES(?,1,?,?,?,?,?,?)').run(tr.session_id,'calibration:'+target.lessonId,OP+':'+target.id+':2',tr.curriculum_json,packet.policyVersion,tr.created_at,tr.finished_at);
 f.sql.prepare("INSERT INTO dialogue_turns(id,session_id,mutation_id,request_hash,role,content,status,policy_version,created_at) VALUES(?,?,?,?,'student','synthetic','synthetic_calibration',?,?)").run(tr.turn_id,tr.session_id,target.id,T.promptDigest,packet.policyVersion,tr.created_at);
 f.sql.prepare("INSERT INTO dialogue_calls(turn_id,session_id,student_id,day,reserved_tokens,state,created_at,reserved_micros,accounted_micros,finished_at,budget_policy_json,usage_json) VALUES(?,?,1,?,2400,'review',?,84000,NULL,?,?,NULL)").run(tr.turn_id,tr.session_id,tr.day,tr.created_at,tr.finished_at,tr.budget_policy_json);
 f.sql.prepare('INSERT INTO dialogue_events(id,session_id,turn_id,event_type,details_json,created_at) VALUES(?,?,?,?,?,?)').run(tr.turn_id+':result',tr.session_id,tr.turn_id,'synthetic_calibration_unconfirmed',tr.details_json,tr.finished_at);
 Object.assign(f.authority,{maxAttempts:30,maxReservedMicros:30*84000,recoveryReadbacks:[{...Q},{...T}]});f.env.YW_CALIBRATION_FULL_LANGUAGE_JSON=JSON.stringify(f.authority);
 const source=JSON.parse(projectReleaseJson('dialogue-curriculum/'+target.lessonId+'.json',JSON.stringify(loadCurriculum(target.lessonId)))),material=fullMaterialize(target,source);
 // Artificial local fixture only. The retained model answer and receipt are never edited.
 const localValue=structuredClone(retained.result.received.value);
 for(const a of localValue.assessments)for(const e of a.evidence)e.passageQuote='君子博学而日参省乎己';
 validateProposal(localValue,material);
 let sends=0;
 const provider=async(e,p,id,onReply,budget)=>{sends++;assert.equal(id,OP+':'+target.id+':3');assert.equal(p,recoveryPrompt(material.prompt));assert.equal(budget.providerAttemptLimit,1);return {...structuredClone(retained.result.received),value:localValue};};
 const request=async(c=target,attempt=3,fn=provider)=>{const rb=await(await handle(req(c,null,attempt),f.env,student,fn)).json();return await(await handle(req(c,{action:'calibration_full_language',ownerRef:rb.ownerRef},attempt),f.env,student,fn)).json();};
 return {...f,request,provider,sends:()=>sends,material};
}

recoveryTest('timeout: exact terminal evidence is preserved; no response or known cost is invented',async()=>{
 assert.equal(await fullReceipt(timed.rawRow),T.receiptDigest);assert.equal(timed.rawRow.accounted_micros,null);
 assert.equal(timed.result.received,null);assert.equal(timed.result.gatewayFailure.providerAccounting.providerAttemptCount,1);
 assert.equal(timed.result.gatewayFailure.providerAccounting.attempts[0].outcome,'TIMEOUT');
 assert.equal(timed.result.gatewayFailure.providerAccounting.attempts[0].usage,null);
});
recoveryTest('timeout: receipt-bound third attempt succeeds once and permits the next case; both failures remain',async t=>{
 const f=await recoverFixture(t);assert(fullActivation(f.env,packet));
 assert.equal((await f.request(nextCase,1)).code,'full_recovery_required');
 const r=await f.request();assert.equal(r.call.state,'finished');assert.equal(r.attempt,3);assert.equal(f.sends(),1);
 assert.deepEqual(await Promise.all(r.recoveryFailures.map(fullReceipt)),[Q.receiptDigest,T.receiptDigest]);
 assert.equal(r.rows.reduce((n,x)=>n+x.reservedMicros,0),252000);assert.equal(r.rows.find(x=>x.attemptId===T.attemptId).accountedMicros,null);
 const e={...f.authority,activationDigest:f.authority.registryReceiptDigest,ownerRef:r.ownerRef,budget:JSON.parse(r.rawRow.budget_policy_json)};
 const checked=await inspectCalibrationReadback(r,e);assert.equal(checked.attemptId,OP+':'+target.id+':3');assert.equal(checked.recoveryOf,T.receiptDigest);
 assert.equal((await f.request()).receiptDigest,r.receiptDigest);assert.equal(f.sends(),1);
 assert.equal((await f.request(nextCase,1,async()=>({...success,modelVersion:packet.model}))).call.state,'finished');
});
recoveryTest('timeout: reordered, omitted, altered or expanded receipt authority cannot activate',async t=>{
 const f=await recoverFixture(t);
 for(const pins of [[T],[T,Q],[Q,{...T,receiptDigest:H}],[Q,{...T,attempt:4}],[Q,{...T,extra:true}],[Q,T,T]]){
  assert.equal(fullActivation({...f.env,YW_CALIBRATION_FULL_LANGUAGE_JSON:JSON.stringify({...f.authority,recoveryReadbacks:pins})},packet),null);
 }
 for(const patch of [{maxAttempts:31},{maxReservedMicros:31*84000},{maxProviderAttempts:2}])assert.equal(fullActivation({...f.env,YW_CALIBRATION_FULL_LANGUAGE_JSON:JSON.stringify({...f.authority,...patch})},packet),null);
 assert.equal((await(await handle(req(target,null,4),f.env,student,f.provider)).json()).code,'calibration_case_invalid');assert.equal(f.sends(),0);
});
recoveryTest('timeout: unknown cost cannot be refunded and changed evidence stops before dispatch',async t=>{
 const f=await recoverFixture(t);f.sql.prepare('UPDATE dialogue_calls SET accounted_micros=0 WHERE turn_id=?').run(T.attemptId);
 assert.equal((await f.request()).code,'full_recovery_receipt_mismatch');assert.equal(f.sends(),0);
});
recoveryTest('timeout: drift of either failed receipt between readback and reservation is rejected atomically',async t=>{
 for(const pin of [Q,T]){const f=await recoverFixture(t),original=f.env.READING_DB.batch;
  f.env.READING_DB.batch=async rows=>{f.sql.prepare("UPDATE dialogue_events SET details_json=details_json||' ' WHERE id=?").run(pin.attemptId+':result');return original(rows);};
  assert.equal((await f.request()).code,'full_atomic_admission_stopped');assert.equal(f.sends(),0);
 }
});
recoveryTest('timeout: another timeout remains terminal, cannot admit a fourth attempt or another case',async t=>{
 const f=await recoverFixture(t);let n=0;const fn=async()=>{n++;const error=Error('gateway_unavailable');error.gatewayFailure=timed.result.gatewayFailure;throw error;};
 const r=await f.request(target,3,fn);assert.equal(r.call.state,'review');assert.equal(r.call.accounted_micros,null);
 assert.equal((await f.request(nextCase,1)).code,'full_boundary_stop');assert.equal((await f.request(target,3,fn)).receiptDigest,r.receiptDigest);assert.equal(n,1);
});
recoveryTest('timeout: concurrent requests dispatch once and original expiry stops further activity',async t=>{
 const f=await recoverFixture(t);await Promise.all([f.request(),f.request()]);assert.equal(f.sends(),1);
 mock.timers.setTime(Date.parse(expiry));assert.equal((await handle(req(target,null,3),f.env,student,f.provider)).status,404);assert.equal(f.sends(),1);
});
recoveryTest('timeout: thirty charges include both failures; no capacity or cost reset',async t=>{
 const f=await recoverFixture(t),r=await f.request(),rows=[...r.rows];
 for(const c of packet.cases.filter(c=>c.group==='representative-28'&&c.id!==Q.caseId))rows.push({sourceValid:true,caseId:c.id,attemptId:OP+':'+c.id+':1',receiptDigest:H,state:'finished',reservedMicros:84000,accountedMicros:0,finishedAt:new Date(at).toISOString(),finalAssessment:true,boundaryStop:false,model:packet.model,modelVersion:packet.model});
 assert.equal(rows.length,30);assert.equal(rows.reduce((n,x)=>n+x.reservedMicros,0),2520000);
 assert.equal(fullAdmission({authority:f.authority,packet,caseId:nextCase.id,rows,history:r.history,capacity:r.capacity,now:at}).code,'full_operation_exhausted');
});

import {CASE2_RECOVERY as C,caseRecovery,recoveryChain} from '../site/dialogue-full-language.js';
const case2Raw=process.env.YW_CASE2_READBACK?JSON.parse(fs.readFileSync(process.env.YW_CASE2_READBACK)).response.result.value.body:null;
const case2Test=(name,fn)=>test(name,{skip:(!retained||!timed||!case2Raw)&&'Three retained readbacks required'},fn);
async function case2Fixture(t){
 const f=await recoverFixture(t);await f.request();
 const r=case2Raw.rawRow;
 f.sql.prepare('INSERT INTO dialogue_sessions(id,student_id,lesson_id,curriculum_version,curriculum_json,policy_version,created_at,updated_at) VALUES(?,1,?,?,?,?,?,?)').run(r.session_id,'calibration:lesson-1498',C.attemptId,r.curriculum_json,packet.policyVersion,r.created_at,r.finished_at);
 f.sql.prepare("INSERT INTO dialogue_turns(id,session_id,mutation_id,request_hash,role,content,status,policy_version,created_at) VALUES(?,?,?,?,'student','synthetic','synthetic_calibration',?,?)").run(r.turn_id,r.session_id,C.caseId,C.promptDigest,packet.policyVersion,r.created_at);
 f.sql.prepare("INSERT INTO dialogue_calls(turn_id,session_id,student_id,day,reserved_tokens,state,created_at,reserved_micros,accounted_micros,finished_at,budget_policy_json,usage_json) VALUES(?,?,1,?,2400,'review',?,84000,NULL,?,?,NULL)").run(r.turn_id,r.session_id,r.day,r.created_at,r.finished_at,r.budget_policy_json);
 f.sql.prepare('INSERT INTO dialogue_events(id,session_id,turn_id,event_type,details_json,created_at) VALUES(?,?,?,?,?,?)').run(r.turn_id+':result',r.session_id,r.turn_id,'synthetic_calibration_unconfirmed',r.details_json,r.finished_at);
 Object.assign(f.authority,{maxAttempts:31,maxReservedMicros:31*84000,recoveryReadbacks:[Q,T,C]});f.env.YW_CALIBRATION_FULL_LANGUAGE_JSON=JSON.stringify(f.authority);
 return f;
}
case2Test('case2: one unchanged-prompt recovery preserves case1 success and three exact failures',async t=>{
 const f=await case2Fixture(t),c=packet.cases.find(x=>x.id===C.caseId);let sends=0;
 assert(fullActivation(f.env,packet));assert.equal(caseRecovery(f.authority,Q.caseId),T);assert.equal(caseRecovery(f.authority,C.caseId),C);
 const result=await f.request(c,2,async(e,p,id,onReply,b)=>{sends++;assert.equal(await digest(p),C.promptDigest);assert.equal(b.providerAttemptLimit,1);return {...success,modelVersion:packet.model};});
 assert.equal(result.call.state,'finished');assert.equal(sends,1);assert.deepEqual(await Promise.all(result.recoveryFailures.map(fullReceipt)),[Q.receiptDigest,T.receiptDigest,C.receiptDigest]);
 const execution={...f.authority,activationDigest:f.authority.registryReceiptDigest,ownerRef:result.ownerRef,budget:JSON.parse(result.rawRow.budget_policy_json)};
 assert.equal((await inspectCalibrationReadback(result,execution)).attemptId,OP+':'+C.caseId+':2');
 assert.equal(result.rows.find(r=>r.attemptId===OP+':'+Q.caseId+':3').state,'finished');
 assert.equal(result.rows.filter(r=>r.accountedMicros===null).length,2);
 const r1=await(await handle(req(target,null,3),f.env,student,f.provider)).json();assert.equal((await inspectCalibrationReadback(r1,execution)).attemptId,OP+':'+Q.caseId+':3');
 const other=packet.cases.find(x=>x.group==='representative-28'&&![Q.caseId,C.caseId].includes(x.id));assert.deepEqual(fullAdmission({authority:f.authority,packet,caseId:other.id,rows:result.rows,history:result.history,capacity:result.capacity,now:at}),{allowed:true,attempt:1});
});
case2Test('case2: another timeout stops the operation and a third attempt is not admitted',async t=>{
 const f=await case2Fixture(t),c=packet.cases.find(x=>x.id===C.caseId);let sends=0;
 const provider=async()=>{sends++;const e=Error('gateway_unavailable');e.gatewayFailure=case2Raw.result.gatewayFailure;throw e;};
 const r=await f.request(c,2,provider);assert.equal(r.call.state,'review');assert.equal((await f.request(c,2,provider)).receiptDigest,r.receiptDigest);assert.equal(sends,1);
 assert.equal((await f.request(c,3,provider)).code,'calibration_case_invalid');
 assert.equal(fullAdmission({authority:f.authority,packet,caseId:nextCase.id,rows:r.rows,history:r.history,capacity:r.capacity,now:at}).code,'full_boundary_stop');
});
case2Test('case2: altered failure and unapproved pin sequence fail closed',async t=>{
 const f=await case2Fixture(t);for(const pins of [[Q,C],[Q,T,{...C,promptDigest:H}],[Q,T,C,C]])assert.deepEqual(recoveryChain({recoveryReadbacks:pins}),[]);
 f.sql.prepare('UPDATE dialogue_calls SET accounted_micros=0 WHERE turn_id=?').run(C.attemptId);assert.equal((await f.request(packet.cases.find(x=>x.id===C.caseId),2)).code,'full_recovery_receipt_mismatch');
});

import {CASE2_QUOTE_RECOVERY as CQ} from '../site/dialogue-full-language.js';
const case2QuoteRaw=process.env.YW_CASE2_QUOTE_READBACK?JSON.parse(fs.readFileSync(process.env.YW_CASE2_QUOTE_READBACK)).response.result.value.body:null;
const cqTest=(name,fn)=>test(name,{skip:(!retained||!timed||!case2Raw||!case2QuoteRaw)&&'Four retained failures required'},fn);
async function case2QuoteFixture(t){
 const f=await case2Fixture(t),r=case2QuoteRaw.rawRow,c=packet.cases.find(c=>c.id===CQ.caseId);
 f.sql.prepare('INSERT INTO dialogue_sessions(id,student_id,lesson_id,curriculum_version,curriculum_json,policy_version,created_at,updated_at) VALUES(?,1,?,?,?,?,?,?)').run(r.session_id,'calibration:'+c.lessonId,r.turn_id,r.curriculum_json,packet.policyVersion,r.created_at,r.finished_at);
 f.sql.prepare("INSERT INTO dialogue_turns(id,session_id,mutation_id,request_hash,role,content,status,policy_version,created_at) VALUES(?,?,?,?,'student','synthetic','synthetic_calibration',?,?)").run(r.turn_id,r.session_id,c.id,c.promptDigest,packet.policyVersion,r.created_at);
 f.sql.prepare("INSERT INTO dialogue_calls(turn_id,session_id,student_id,day,reserved_tokens,state,created_at,reserved_micros,accounted_micros,finished_at,budget_policy_json,usage_json) VALUES(?,?,1,?,2400,'review',?,84000,0,?,?,?)").run(r.turn_id,r.session_id,r.day,r.created_at,r.finished_at,r.budget_policy_json,r.usage_json);
 f.sql.prepare('INSERT INTO dialogue_events(id,session_id,turn_id,event_type,details_json,created_at) VALUES(?,?,?,?,?,?)').run(r.turn_id+':result',r.session_id,r.turn_id,'synthetic_calibration_unconfirmed',r.details_json,r.finished_at);
 Object.assign(f.authority,{maxAttempts:32,maxReservedMicros:32*84000,recoveryReadbacks:[Q,T,C,CQ]});f.env.YW_CALIBRATION_FULL_LANGUAGE_JSON=JSON.stringify(f.authority);
 return {...f,c};
}
cqTest('case2 quote: original bad evidence still rejected; only split continuous quotes validate',async()=>{
 const c=packet.cases.find(c=>c.id===CQ.caseId),source=JSON.parse(projectReleaseJson('dialogue-curriculum/'+c.lessonId+'.json',JSON.stringify(loadCurriculum(c.lessonId)))),material=fullMaterialize(c,source),raw=case2QuoteRaw.result.received.value;
 assert.throws(()=>validateProposal(raw,material),/unverifiable_evidence/);
 const v=structuredClone(raw),e=v.assessments[0].evidence[0];v.assessments[0].evidence=[{...e,passageQuote:'顺风而呼，声非加疾也，而闻者彰。'},{...e,passageQuote:'君子博学而日参省乎己'}];validateProposal(v,material);
 assert.equal(await digest(material.prompt),C.promptDigest);assert.equal(await digest(recoveryPrompt(material.prompt)),CQ.promptDigest);
});
cqTest('case2 quote: exact single attempt3 preserves four failures and case1 success; importer agrees',async t=>{
 const f=await case2QuoteFixture(t);let calls=0;
 const fn=async(e,p,id,onReply,b)=>{calls++;assert.equal(await digest(p),CQ.promptDigest);assert.equal(b.providerAttemptLimit,1);const x=structuredClone(case2QuoteRaw.result.received),q=x.value.assessments[0].evidence[0];x.value.assessments[0].evidence=[{...q,passageQuote:'顺风而呼，声非加疾也，而闻者彰。'},{...q,passageQuote:'君子博学而日参省乎己'}];return x;};
 const r=await f.request(f.c,3,fn);assert.equal(r.call.state,'finished');assert.equal(calls,1);assert.deepEqual(await Promise.all(r.recoveryFailures.map(fullReceipt)),[Q.receiptDigest,T.receiptDigest,C.receiptDigest,CQ.receiptDigest]);
 const execution={...f.authority,activationDigest:f.authority.registryReceiptDigest,ownerRef:r.ownerRef,budget:JSON.parse(r.rawRow.budget_policy_json)};assert.equal((await inspectCalibrationReadback(r,execution)).attemptId,OP+':'+CQ.caseId+':3');
 const first=await(await handle(req(target,null,3),f.env,student,fn)).json();assert.equal((await inspectCalibrationReadback(first,execution)).attemptId,OP+':'+Q.caseId+':3');assert.equal(calls,1);assert.equal(r.rows.filter(r=>r.accountedMicros===null).length,2);
 await f.request(f.c,3,fn);assert.equal(calls,1);assert.equal((await f.request(f.c,4,fn)).code,'calibration_case_invalid');
});
cqTest('case2 quote: unchanged bad model output remains terminal and cannot admit another case',async t=>{
 const f=await case2QuoteFixture(t);const r=await f.request(f.c,3,async()=>structuredClone(case2QuoteRaw.result.received));assert.equal(r.call.state,'review');assert.equal(r.result.reason,'unverifiable_evidence');assert.equal((await f.request(target,1)).call.state,'review');
 assert.equal(fullAdmission({authority:f.authority,packet,caseId:packet.cases[2].id,rows:r.rows,history:r.history,capacity:r.capacity,now:at}).code,'full_boundary_stop');
});
cqTest('case2 quote: stale pins, refunded unknowns and altered failure cannot authorize dispatch',async t=>{
 const f=await case2QuoteFixture(t);for(const pins of [[Q,T,CQ],[Q,T,C,{...CQ,promptDigest:C.promptDigest}],[Q,T,C,CQ,CQ]])assert.deepEqual(recoveryChain({recoveryReadbacks:pins}),[]);
 f.sql.prepare("UPDATE dialogue_events SET details_json=details_json||' ' WHERE id=?").run(CQ.attemptId+':result');assert.equal((await f.request(f.c,3)).code,'full_recovery_receipt_mismatch');
});

import {CASE2_FINITE_RECOVERY as CF} from '../site/dialogue-full-language.js';
const case2FiniteRaw=process.env.YW_CASE2_FINITE_READBACK?JSON.parse(fs.readFileSync(process.env.YW_CASE2_FINITE_READBACK)).response.result.value.body:null;
const cfTest=(name,fn)=>test(name,{skip:(!retained||!timed||!case2Raw||!case2QuoteRaw||!case2FiniteRaw)&&'Five retained failures required'},fn);
async function finiteFixture(t){
 const f=await case2QuoteFixture(t),r=case2FiniteRaw.rawRow;
 f.sql.prepare('INSERT INTO dialogue_sessions(id,student_id,lesson_id,curriculum_version,curriculum_json,policy_version,created_at,updated_at) VALUES(?,1,?,?,?,?,?,?)').run(r.session_id,'calibration:'+f.c.lessonId,r.turn_id,r.curriculum_json,packet.policyVersion,r.created_at,r.finished_at);
 f.sql.prepare("INSERT INTO dialogue_turns(id,session_id,mutation_id,request_hash,role,content,status,policy_version,created_at) VALUES(?,?,?,?,'student','synthetic','synthetic_calibration',?,?)").run(r.turn_id,r.session_id,f.c.id,CF.promptDigest,packet.policyVersion,r.created_at);
 f.sql.prepare("INSERT INTO dialogue_calls(turn_id,session_id,student_id,day,reserved_tokens,state,created_at,reserved_micros,accounted_micros,finished_at,budget_policy_json,usage_json) VALUES(?,?,1,?,2400,'review',?,84000,NULL,?,?,NULL)").run(r.turn_id,r.session_id,r.day,r.created_at,r.finished_at,r.budget_policy_json);
 f.sql.prepare('INSERT INTO dialogue_events(id,session_id,turn_id,event_type,details_json,created_at) VALUES(?,?,?,?,?,?)').run(r.turn_id+':result',r.session_id,r.turn_id,'synthetic_calibration_unconfirmed',r.details_json,r.finished_at);
 return f;
}
function activateFinite(f){Object.assign(f.authority,{maxAttempts:33,maxReservedMicros:33*84000,recoveryReadbacks:[Q,T,C,CQ,CF]});f.env.YW_CALIBRATION_FULL_LANGUAGE_JSON=JSON.stringify(f.authority);}
cfTest('finite: current four-pin activation cannot admit attempt4; altered new pin fails closed',async t=>{
 const f=await finiteFixture(t);assert.equal((await f.request(f.c,4)).code,'calibration_case_invalid');
 for(const pins of [[Q,T,C,CQ,{...CF,receiptDigest:H}],[Q,T,C,CQ,{...CF,promptDigest:C.promptDigest}],[Q,T,C,CQ,CF,CF]])assert.deepEqual(recoveryChain({recoveryReadbacks:pins}),[]);
});
cfTest('finite: one exact attempt4 preserves five failures and case1; same id never dispatches twice',async t=>{
 const f=await finiteFixture(t);activateFinite(f);let sends=0;
 const provider=async(e,p,id,onReply,b)=>{sends++;assert.equal(await digest(p),CQ.promptDigest);assert.equal(b.providerAttemptLimit,1);const stored=f.sql.prepare('SELECT state,reserved_micros FROM dialogue_calls WHERE turn_id=?').get(id);assert.equal(stored.state,'reserved');assert.equal(stored.reserved_micros,84000);const v=structuredClone(case2QuoteRaw.result.received),q=v.value.assessments[0].evidence[0];v.value.assessments[0].evidence=[{...q,passageQuote:'顺风而呼，声非加疾也，而闻者彰。'},{...q,passageQuote:'君子博学而日参省乎己'}];return v;};
 const r=await f.request(f.c,4,provider);assert.equal(r.call.state,'finished');assert.equal(sends,1);assert.deepEqual(await Promise.all(r.recoveryFailures.map(fullReceipt)),[Q,T,C,CQ,CF].map(x=>x.receiptDigest));assert.equal(r.rows.filter(r=>r.accountedMicros===null).length,3);
 const execution={...f.authority,activationDigest:f.authority.registryReceiptDigest,ownerRef:r.ownerRef,budget:JSON.parse(r.rawRow.budget_policy_json)};assert.equal((await inspectCalibrationReadback(r,execution)).attemptId,OP+':'+CF.caseId+':4');
 const again=await f.request(f.c,4,provider);assert.equal(again.receiptDigest,r.receiptDigest);const first=await(await handle(req(target,null,3),f.env,student,provider)).json();assert.equal(first.call.state,'finished');assert.equal(sends,1);
});
cfTest('finite: new timeout stays unknown, stops all later cases and denies attempt5',async t=>{
 const f=await finiteFixture(t);activateFinite(f);let sends=0;const provider=async()=>{sends++;const e=Error('gateway_unavailable');e.gatewayFailure=case2FiniteRaw.result.gatewayFailure;throw e;};const r=await f.request(f.c,4,provider);assert.equal(r.call.state,'review');assert.equal(r.call.accounted_micros,null);await f.request(f.c,4,provider);assert.equal(sends,1);assert.equal((await f.request(f.c,5,provider)).code,'calibration_case_invalid');assert.equal(fullAdmission({authority:f.authority,packet,caseId:packet.cases[2].id,rows:r.rows,history:r.history,capacity:r.capacity,now:at}).code,'full_boundary_stop');
});
cfTest('finite: altered unknown liability and original expiry prevent dispatch',async t=>{
 const f=await finiteFixture(t);activateFinite(f);f.sql.prepare('UPDATE dialogue_calls SET accounted_micros=0 WHERE turn_id=?').run(CF.attemptId);assert.equal((await f.request(f.c,4)).code,'full_recovery_receipt_mismatch');assert.equal(fullActivation(f.env,packet,Date.parse(expiry)),null);
});
