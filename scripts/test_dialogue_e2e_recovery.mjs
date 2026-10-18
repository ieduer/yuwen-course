import test,{beforeEach,afterEach,mock} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {acceptanceEnvironment,ACCEPTANCE_ORIGIN as origin} from '../site/dialogue-acceptance.js';
import {handleDialogue,callDialogueModel} from '../site/dialogue-source.js';
import {requestDialogueBudget} from '../site/dialogue-recovery.js';
import {E2E_OPERATION,E2E_HARD_EXPIRY,E2E_AUTHORITY_DIGEST,E2E_LESSONS} from '../site/dialogue-e2e-admission.js';
import {FULL_OPERATION,ORIGINAL_RECEIPTS,digest,QUOTE_RECOVERY as Q,TIMEOUT_RECOVERY as T,CASE2_RECOVERY as C,fullReceipt} from '../site/dialogue-full-language.js';
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
async function fixture(t,{calibrations=28,ordinary=false}={}){
 const sql=new DatabaseSync(':memory:');for(const f of fs.readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())sql.exec(fs.readFileSync('migrations/'+f,'utf8'));t.after(()=>sql.close());sql.exec("INSERT INTO students(id,uc_slug,display_name) VALUES(1,'synthetic-owner','Unit owner')");
 const wrap=(text,args=[])=>({bind:(...v)=>wrap(text,v),first:async()=>sql.prepare(text).get(...args)||null,all:async()=>({results:sql.prepare(text).all(...args)}),run:async()=>({meta:{changes:Number(sql.prepare(text).run(...args).changes)}}),runSync:()=>({meta:{changes:Number(sql.prepare(text).run(...args).changes)}})});
 const db={prepare:text=>wrap(text),batch:async rows=>{sql.exec('BEGIN');try{const r=rows.map(s=>s.runSync());sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 const priorReceipts=[...ORIGINAL_RECEIPTS].sort((a,b)=>a.attemptId<b.attemptId?-1:1);
 const full={version:'yw-full-language-activation-v1',enabled:true,operation:FULL_OPERATION,authorityDigest:H,packetDigest:packet.sourceDigest,sourceCommit:'b'.repeat(40),artifactSha256:H,origin,ownerUserId:553,databaseId:database,apisVersion:version,registryReceiptDigest:H,singleProviderSourceProofDigest:H,priorReceiptSetDigest:await digest(priorReceipts),priorReceipts,readyAt:'2026-10-17T11:00:00Z',hardExpiry:expiry,maxAttempts:28,maxReservedMicros:2352000,maxProviderAttempts:1,reserveMicros:84000,maxConcurrency:1,recoveryReadbacks:[]};
 const pin={version:'yw-isolated-e2e-admission-v2',enabled:true,operation:OP,authorityDigest:H,origin,ownerUserId:553,databaseId:database,apisVersion:version,registryReceiptDigest:H,hardExpiry:expiry,maxVisibleCalls:120,maxProviderAttempts:3,reserveMicros:252000,lessonIds:[...E2E_LESSONS]};
 const bindings={ASSETS:{fetch:async r=>new Response(fs.readFileSync('site'+new URL(r.url).pathname))},ACCEPTANCE_DB:db,USER_CENTER_EVIDENCE:{resolveSession:async()=>({userId:553})},APIS_CALLER_TOKEN:'synthetic-caller-only',APIS:{fetch:()=>{throw Error('network_forbidden');}},YW_ACCEPTANCE_USER_ID:'553',YW_FORMAL_APIS_VERSION:version,YW_ACCEPTANCE_DATABASE_ID:database,YW_ACCEPTANCE_ACTIVATION_SHA256:H,YW_ACCEPTANCE_EXPIRES_AT:expiry,YW_DIALOGUE_BUDGET_JSON:JSON.stringify(policy),YW_DIALOGUE_PROVIDER_ATTEMPTS:'3',YW_E2E_AUTHORITY_JSON:JSON.stringify(pin),YW_CALIBRATION_FULL_LANGUAGE_JSON:JSON.stringify(full),YW_FULL_LANGUAGE_ACTIVATION_SHA256:H};
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

const load=p=>p?JSON.parse(fs.readFileSync(p,'utf8')).response.result.value.body:null;
const failed=[load(process.env.YW_RECOVERY_READBACK),load(process.env.YW_TIMEOUT_READBACK),load(process.env.YW_CASE2_READBACK)];
const recoveryTest=(name,fn)=>test(name,{skip:failed.slice(0,2).some(x=>!x)&&'Both retained readbacks required'},fn);
async function recoveryFixture(t,count=2){
 const f=await fixture(t),c=packet.cases.find(c=>c.id===Q.caseId),pins=[Q,T,C].slice(0,count),id=Q.attemptId;
 for(const id of [...new Set(pins.map(p=>p.caseId))].map(c=>FULL_OPERATION+':'+c+':1')){f.sql.prepare('DELETE FROM dialogue_events WHERE turn_id=?').run(id);f.sql.prepare('DELETE FROM dialogue_calls WHERE turn_id=?').run(id);f.sql.prepare('DELETE FROM dialogue_turns WHERE id=?').run(id);f.sql.prepare('DELETE FROM dialogue_sessions WHERE id=?').run(id+':session');}
 for(const rb of failed.slice(0,count)){const r=rb.rawRow;
  f.sql.prepare('INSERT INTO dialogue_sessions(id,student_id,lesson_id,curriculum_version,curriculum_json,policy_version,created_at,updated_at) VALUES(?,1,?,?,?,?,?,?)').run(r.session_id,'calibration:'+c.lessonId,r.turn_id,r.curriculum_json,packet.policyVersion,r.created_at,r.finished_at);
  f.sql.prepare("INSERT INTO dialogue_turns(id,session_id,mutation_id,request_hash,role,content,status,policy_version,created_at) VALUES(?,?,?,?,'student','synthetic','synthetic_calibration',?,?)").run(r.turn_id,r.session_id,c.id,H,packet.policyVersion,r.created_at);
  f.sql.prepare("INSERT INTO dialogue_calls(turn_id,session_id,student_id,day,reserved_tokens,state,created_at,reserved_micros,accounted_micros,finished_at,budget_policy_json,usage_json) VALUES(?,?,1,?,2400,'review',?,84000,?,?,?,?)").run(r.turn_id,r.session_id,r.day,r.created_at,r.accounted_micros,r.finished_at,r.budget_policy_json,r.usage_json);
  f.sql.prepare('INSERT INTO dialogue_events(id,session_id,turn_id,event_type,details_json,created_at) VALUES(?,?,?,?,?,?)').run(r.turn_id+':result',r.session_id,r.turn_id,'synthetic_calibration_unconfirmed',r.details_json,r.finished_at);
 }
 const accepted=FULL_OPERATION+':'+Q.caseId+':'+(count===1?2:3);
 for(const caseId of [...new Set(pins.map(p=>p.caseId))]){const last=pins.filter(p=>p.caseId===caseId).at(-1),c=packet.cases.find(c=>c.id===caseId),rid=FULL_OPERATION+':'+caseId+':'+last.attempt;
 f.seed(rid,{caseSpec:c,version:policy.model});
 f.sql.prepare("UPDATE dialogue_sessions SET curriculum_json=json_set(curriculum_json,'$.promptDigest',?,'$.recoveryOf',?) WHERE id=?").run(last.promptDigest,last.receiptDigest,rid+':session');}
 f.sql.prepare("UPDATE dialogue_events SET details_json=json_set(details_json,'$.modelVersion',?) WHERE event_type='synthetic_calibration_result'").run(policy.model);
 Object.assign(f.full,{recoveryReadbacks:pins,maxAttempts:28+count,maxReservedMicros:(28+count)*84000});f.env.YW_CALIBRATION_FULL_LANGUAGE_JSON=JSON.stringify(f.full);
 const getRaw=id=>f.sql.prepare("SELECT c.*,s.student_id session_owner,s.curriculum_json,e.details_json,(SELECT COUNT(*) FROM dialogue_stream_chunks k WHERE k.turn_id=c.turn_id) chunk_count,(SELECT COALESCE(SUM(LENGTH(content)),0) FROM dialogue_stream_chunks k WHERE k.turn_id=c.turn_id) partial_chars FROM dialogue_calls c JOIN dialogue_sessions s ON s.id=c.session_id JOIN dialogue_events e ON e.id=c.turn_id||':result' WHERE c.turn_id=?").get(id);
 let calls=0;const send=(input=body(),provider)=>f.send(input,provider||(async()=>{calls++;return {...success(),modelVersion:policy.model};}));
 return {...f,send,accepted,getRaw,actualCalls:()=>calls,pins};
}
recoveryTest('E2E recovery: exact accepted attempt2 or3 opens admission while original failures remain unchanged',async t=>{
 for(const count of [1,2]){const f=await recoveryFixture(t,count);const before=await Promise.all(f.pins.map(p=>fullReceipt(f.getRaw(p.attemptId))));
  assert.deepEqual(before,f.pins.map(p=>p.receiptDigest));const r=await f.send();assert.equal(r.status,200);assert.equal(f.actualCalls(),1);
  assert.equal(f.sql.prepare("SELECT state FROM dialogue_calls WHERE json_extract(budget_policy_json,'$.isolatedAdmission.operation')=?").get(OP).state,'finished');
  assert.deepEqual(await Promise.all(f.pins.map(p=>fullReceipt(f.getRaw(p.attemptId)))),before);
 }
});
recoveryTest('E2E recovery: edited failure or unknown-cost refund is rejected before any provider call',async t=>{
 for(const pin of [Q,T]){const f=await recoveryFixture(t);f.sql.prepare("UPDATE dialogue_events SET details_json=details_json||' ' WHERE id=?").run(pin.attemptId+':result');const r=await f.send();assert.equal(r.status,429);assert.equal((await r.json()).code,'e2e_calibration_failed_receipt_changed');assert.equal(f.actualCalls(),0);}
 const f=await recoveryFixture(t);f.sql.prepare('UPDATE dialogue_calls SET accounted_micros=0 WHERE turn_id=?').run(T.attemptId);assert.equal((await f.send()).status,429);assert.equal(f.actualCalls(),0);
});
recoveryTest('E2E recovery: receipt race cannot cross the atomic reservation',async t=>{
 const f=await recoveryFixture(t),original=f.db.batch;f.db.batch=async rows=>{f.sql.prepare("UPDATE dialogue_events SET details_json=details_json||' ' WHERE id=?").run(T.attemptId+':result');return original(rows);};
 assert.equal((await f.send()).status,429);assert.equal(f.actualCalls(),0);
});
recoveryTest('E2E recovery: missing accepted result, wrong link, source drift or extra calibration remains blocked',async t=>{
 for(const change of ['state','link','source','extra']){const f=await recoveryFixture(t);
  if(change==='state')f.sql.prepare("UPDATE dialogue_calls SET state='review' WHERE turn_id=?").run(f.accepted);
  if(change==='link')f.sql.prepare("UPDATE dialogue_sessions SET curriculum_json=json_set(curriculum_json,'$.recoveryOf',?) WHERE id=?").run(Q.receiptDigest,f.accepted+':session');
  if(change==='source')f.sql.prepare("UPDATE dialogue_sessions SET curriculum_json=json_set(curriculum_json,'$.sourceDigest','wrong') WHERE id=?").run(f.accepted+':session');
  if(change==='extra')f.seed(FULL_OPERATION+':unexpected:1',{caseSpec:packet.cases[1],version:policy.model});
  assert.equal((await f.send()).status,429);assert.equal(f.actualCalls(),0);
 }
});
recoveryTest('E2E recovery: a partial continuation rechecks pinned failures and preserves one logical reservation',async t=>{
 const f=await recoveryFixture(t),text='尚未完整';
 const r=await f.send(body(),async(_e,_p,_id,onReply)=>{await onReply(text);const e=Error('gateway_stream_unconfirmed'),a=success().providerAccounting;a.attempts[0]={...a.attempts[0],outcome:'FETCH_ERROR',usage:null};e.gatewayFailure={providerAccounting:a};throw e;});
 const data=await r.json();assert(data.partial.continuation.allowed);
 const continuation={action:'continue',revision:data.revision,turnId:data.partial.turnId,partialDigest:data.partial.digest,mutationId:'recovery-continuation-001'};
 const result=await f.send(continuation,async(_e,_p,_id,_r,b)=>{assert.equal(b.providerAttemptLimit,2);const x={...success(),modelVersion:policy.model};x.value.reply=text+'，請指出原文。';x.providerAccounting.maxProviderAttempts=2;return x;});assert.equal(result.status,200);
 assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM dialogue_calls WHERE json_extract(budget_policy_json,'$.isolatedAdmission.operation')=?").get(OP).n,1);
 assert.equal(await fullReceipt(f.getRaw(T.attemptId)),T.receiptDigest);
});

test('E2E case2: both per-case replacements required and all three failures retained',{skip:failed.some(x=>!x)},async t=>{const f=await recoveryFixture(t,3);assert.equal((await f.send()).status,200);assert.deepEqual(await Promise.all(f.pins.map(p=>fullReceipt(f.getRaw(p.attemptId)))),[Q.receiptDigest,T.receiptDigest,C.receiptDigest]);const g=await recoveryFixture(t,3);g.sql.prepare("UPDATE dialogue_calls SET state='review' WHERE turn_id=?").run(g.accepted);assert.equal((await g.send()).status,429);assert.equal(g.actualCalls(),0);});
