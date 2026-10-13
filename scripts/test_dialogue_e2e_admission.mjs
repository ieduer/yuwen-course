import test,{before,after,mock} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {acceptanceEnvironment,ACCEPTANCE_ORIGIN} from '../site/dialogue-acceptance.js';
import {requestDialogueBudget} from '../site/dialogue-recovery.js';
import {dialogueBudget} from '../site/dialogue-budget.js';
import {handleDialogue,callDialogueModel} from '../site/dialogue-source.js';
import {isolatedDialogueAdmission,isolatedCallCount,E2E_OPERATION,E2E_HARD_EXPIRY,E2E_AUTHORITY_DIGEST,E2E_LESSONS} from '../site/dialogue-e2e-admission.js';

const at=Date.parse('2026-10-13T03:00:00Z');
before(()=>mock.timers.enable({apis:['Date'],now:at}));
after(()=>mock.timers.reset());
const student={id:1,ucUserId:700001},lesson='lesson-1717-p2';
const version='11111111-2222-4333-8444-555555555555',database='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',deployment='22222222-3333-4444-8555-666666666666';
const policy={version:'synthetic-e2e-v1',validUntil:'2099-01-01T00:00:00Z',currency:'USD',model:'gemini-3.6-flash',globalDailyMicros:50000000,userDailyMicros:50000000,lessonLifetimeMicros:50000000,reserveMicros:84000,inputMicrosPerMillion:750000,outputMicrosPerMillion:3750000};
const authority=()=>({version:'yw-isolated-e2e-admission-v1',enabled:true,operation:E2E_OPERATION,authorityDigest:E2E_AUTHORITY_DIGEST,origin:ACCEPTANCE_ORIGIN,ownerUserId:student.ucUserId,databaseId:database,apisVersion:version,registryReceiptDigest:'a'.repeat(64),hardExpiry:E2E_HARD_EXPIRY,maxVisibleCalls:120,maxProviderAttempts:3,reserveMicros:252000,lessonIds:[...E2E_LESSONS]});
const ownerRef=createHash('sha256').update('dialogue-owner:1').digest('hex');
const request=(body)=>new Request(`${ACCEPTANCE_ORIGIN}/api/dialogue/v1?lessonId=${lesson}`,body?{method:'POST',headers:{origin:ACCEPTANCE_ORIGIN,'content-type':'application/json'},body:JSON.stringify({ownerRef,...body})}:{});
const body=(revision=0,mutationId='synthetic-e2e-mutation-0001')=>({content:'我注意到原句的對照，仍不確定情感如何轉變。',revision,mutationId});
const usage={promptTokenCount:100,totalTokenCount:200};
const attempt=(outcome='OK')=>({ordinal:1,model:policy.model,outcome,brokerCompleted:true,outputStarted:true,usage:outcome==='OK'?usage:null});
const accounting=(outcome='OK',limit=3)=>({version:1,policy:'yw-same-model-sequential-v1',mode:'sequential-distinct-key',fallback:false,hedge:false,backgroundCalls:0,maxProviderAttempts:limit,providerAttemptCount:1,attempts:[attempt(outcome)]});
const partial='這段文字已保存';
const success=(limit=3)=>({value:{reply:partial+'，請接著指出一處原文。',assessments:[]},model:policy.model,usage,providerAccounting:accounting('OK',limit)});
function fixture({ordinary=false,pin=authority(),bindingEdits={}}={}){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
 for(const file of fs.readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())sql.exec(fs.readFileSync('migrations/'+file,'utf8'));
 sql.exec("INSERT INTO students(id,uc_slug,display_name) VALUES(1,'synthetic-one','Test'),(2,'synthetic-two','Test')");
 const wrap=(text,args=[])=>({bind:(...values)=>wrap(text,values),first:async()=>sql.prepare(text).get(...args)||null,all:async()=>({results:sql.prepare(text).all(...args)}),run:async()=>({meta:{changes:Number(sql.prepare(text).run(...args).changes)}}),runSync:()=>({meta:{changes:Number(sql.prepare(text).run(...args).changes)}})});
 const db={prepare:text=>wrap(text),batch:async rows=>{sql.exec('BEGIN');try{const values=rows.map(row=>row.runSync());sql.exec('COMMIT');return values;}catch(error){sql.exec('ROLLBACK');throw error;}}};
 const bindings={ASSETS:{fetch:async r=>new Response(fs.readFileSync('site'+new URL(r.url).pathname))},ACCEPTANCE_DB:db,USER_CENTER_EVIDENCE:{resolveSession:async()=>({userId:student.ucUserId})},APIS_ACCEPTANCE:{fetch:()=>{throw Error('network forbidden');}},YW_ACCEPTANCE_USER_ID:String(student.ucUserId),YW_ACCEPTANCE_APIS_VERSION:version,YW_ACCEPTANCE_DATABASE_ID:database,YW_ACCEPTANCE_ACTIVATION_SHA256:'a'.repeat(64),YW_ACCEPTANCE_EXPIRES_AT:E2E_HARD_EXPIRY,YW_DIALOGUE_BUDGET_JSON:JSON.stringify(policy),YW_DIALOGUE_PROVIDER_ATTEMPTS:'3',YW_E2E_AUTHORITY_JSON:typeof pin==='string'?pin:JSON.stringify(pin),...bindingEdits};
 const env=ordinary?{...bindings,READING_DB:db,YW_DIALOGUE_ENABLED:'true'}:acceptanceEnvironment(request(),bindings);
 return {sql,db,env,bindings,close:()=>sql.close()};
}
function seed(f,count,{operation=true,oldDays=true,session=null,reserved=252000,accounted=1}={}){
 for(let i=0;i<count;i++){
  const id=`seed-${operation?'e2e':'calibration'}-${i}`,sid=session||id+':session',day=oldDays?(i%2?'2026-10-11':'2026-10-12'):'2026-10-13';
  if(!session)f.sql.prepare("INSERT INTO dialogue_sessions(id,student_id,lesson_id,curriculum_version,curriculum_json,policy_version,created_at,updated_at) VALUES(?,1,?,?,'{}','synthetic',?,?)").run(sid,operation?E2E_LESSONS[i%2]:'calibration:lesson-1498',id,day,day);
  f.sql.prepare("INSERT INTO dialogue_turns(id,session_id,mutation_id,request_hash,role,content,status,policy_version,created_at) VALUES(?,?,?,'seed','student','synthetic','saved','synthetic',?)").run(id,sid,id,day);
  const budget=operation?{...policy,isolatedAdmission:{operation:E2E_OPERATION}}:policy;
  f.sql.prepare("INSERT INTO dialogue_calls(turn_id,session_id,student_id,day,reserved_tokens,state,created_at,reserved_micros,accounted_micros,budget_policy_json) VALUES(?,?,1,?,2400,'finished',?,?,?,?)").run(id,sid,day,day,reserved,accounted,JSON.stringify(budget));
 }
}
const send=(f,input,callModel=async()=>success())=>handleDialogue(request(input),f.env,student,null,{callModel});

test('120th call succeeds across lessons/days; 121st saves draft and cannot reset tomorrow',async()=>{
 const f=fixture();try{
  seed(f,119);seed(f,40,{operation:false,oldDays:false,reserved:84000});
  const before=f.sql.prepare("SELECT turn_id,day,reserved_micros,accounted_micros,budget_policy_json FROM dialogue_calls ORDER BY turn_id").all();
  let paid=0;const input=body(),r=await send(f,input,async()=>{paid++;return success();});assert.equal(r.status,200);
  assert.equal(await isolatedCallCount(f.db),120);assert.equal(paid,1);
  const repeated=await send(f,input,()=>{throw Error('duplicate provider call');});assert.equal(repeated.status,200);
  const data=await r.json(),denied=await send(f,body(data.revision,'synthetic-e2e-mutation-0002'),()=>{throw Error('121st provider call');});
  assert.equal(denied.status,429);const detail=await denied.json();assert.equal(detail.code,'e2e_operation_call_budget_exhausted');assert.equal(detail.retryable,false);assert(detail.draftSaved);assert.equal(detail.resetsAt,undefined);
  // A date change in all existing rows must not restore operation capacity.
  assert.deepEqual(f.sql.prepare("SELECT turn_id,day,reserved_micros,accounted_micros,budget_policy_json FROM dialogue_calls WHERE turn_id LIKE 'seed-%' ORDER BY turn_id").all(),before);
  f.sql.prepare("UPDATE dialogue_calls SET day='2026-10-01'").run();
  assert.equal((await send(f,body(data.revision,'synthetic-e2e-mutation-0002'),()=>{throw Error('counter reset');})).status,429);
  assert.equal(await isolatedCallCount(f.db),120);
 }finally{f.close();}
});
test('two simultaneous submissions contend for the final atomic reservation',async()=>{
 const f=fixture();try{seed(f,119);await send(f);let calls=0;const model=async()=>{calls++;await Promise.resolve();return success();};
  const responses=await Promise.all([send(f,body(0,'synthetic-e2e-race-0001'),model),send(f,body(0,'synthetic-e2e-race-0002'),model)]);
  assert.equal(calls,1);assert.equal(await isolatedCallCount(f.db),120);assert(responses.some(r=>r.status===200));assert(responses.some(r=>[409,429].includes(r.status)));
 }finally{f.close();}
});
test('a new publisher activation receipt cannot reset the same operation ledger',async()=>{
 const f=fixture();try{seed(f,120);const rotated={...authority(),registryReceiptDigest:'b'.repeat(64)};
  f.env=acceptanceEnvironment(request(),{...f.bindings,YW_ACCEPTANCE_ACTIVATION_SHA256:rotated.registryReceiptDigest,YW_E2E_AUTHORITY_JSON:JSON.stringify(rotated)});
  const r=await send(f,body(),()=>{throw Error('activation reset');});assert.equal(r.status,429);assert.equal((await r.json()).code,'e2e_operation_call_budget_exhausted');assert.equal(await isolatedCallCount(f.db),120);
 }finally{f.close();}
});
test('partial continuation at 120 is still one call, one reservation and one student turn',async()=>{
 const f=fixture();try{seed(f,119);let calls=0;
  const initial=await(await send(f,body(),async(_env,_prompt,_id,onReply)=>{calls++;await onReply(partial);const error=Error('partial');error.gatewayFailure={providerAccounting:accounting('FETCH_ERROR')};throw error;})).json();
  assert.equal(await isolatedCallCount(f.db),120);assert(initial.partial.continuation.allowed);
  const input={action:'continue',turnId:initial.partial.turnId,partialDigest:initial.partial.digest,revision:initial.revision,mutationId:'synthetic-e2e-continue-0001'};
  const r=await send(f,input,async(_env,_prompt,_id,_reply,budget)=>{calls++;assert.equal(budget.providerAttemptLimit,2);return success(2);});assert.equal(r.status,200);
  assert.equal(await isolatedCallCount(f.db),120);const call=f.sql.prepare('SELECT * FROM dialogue_calls WHERE turn_id=?').get(input.turnId);assert.equal(call.reserved_micros,252000);assert.equal(call.accounted_micros,84450);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM dialogue_turns WHERE session_id=? AND role='student'").get(call.session_id).n,1);
  assert.equal((await send(f,input,()=>{throw Error('duplicate continuation');})).status,200);assert.equal(calls,2);
 }finally{f.close();}
});
test('ordinary production retains 40/day despite activation variables and injected budget tag',async()=>{
 const f=fixture({ordinary:true});try{seed(f,40,{operation:false,oldDays:false});
  f.env.YW_DIALOGUE_BUDGET_JSON=JSON.stringify({...policy,isolatedAdmission:{operation:E2E_OPERATION}});
  const budget=requestDialogueBudget(f.env,student,lesson);assert.equal(budget.isolatedAdmission,undefined);
  const r=await send(f,{...body(),e2e:true,operation:E2E_OPERATION},()=>{throw Error('ordinary limit bypass');});assert.equal(r.status,429);assert.equal((await r.json()).code,'daily_call_budget_exhausted');
 }finally{f.close();}
});
test('isolated host without activation remains ordinary and calibration budgets gain no tag',async()=>{
 const f=fixture({bindingEdits:{YW_E2E_AUTHORITY_JSON:undefined}});try{seed(f,40,{operation:false,oldDays:false});assert.equal((await send(f,body())).status,429);assert.equal(dialogueBudget(f.env).isolatedAdmission,undefined);}finally{f.close();}
});
for(const [name,edit] of Object.entries({operation:p=>p.operation+='-new',owner:p=>p.ownerUserId++,origin:p=>p.origin='https://yw.bdfz.net',database:p=>p.databaseId=deployment,apis:p=>p.apisVersion=deployment,activation:p=>p.registryReceiptDigest='b'.repeat(64),receipt:p=>p.registryReceiptDigest='',authority:p=>p.authorityDigest='0'.repeat(64),deadline:p=>p.hardExpiry='2099-01-01T00:00:00Z',count:p=>p.maxVisibleCalls=121,attempts:p=>p.maxProviderAttempts=4,reserve:p=>p.reserveMicros=84000,scope:p=>p.lessonIds.push('lesson-1458'),extra:p=>p.clientFlag=true,disabled:p=>p.enabled=false}))test('configured '+name+' mismatch fails closed before reservation',async()=>{
 const pin=authority();edit(pin);const f=fixture({pin});try{const r=await send(f,body(),()=>{throw Error('unauthorized provider call');});assert.equal(r.status,503);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM dialogue_calls').get().n,0);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM dialogue_drafts').get().n,1);}finally{f.close();}
});
for(const pin of ['{','null','[]',''])test('malformed configured activation '+JSON.stringify(pin)+' fails closed',()=>{const f=fixture({pin});try{assert.throws(()=>requestDialogueBudget(f.env,student,lesson),/e2e_activation_invalid/);}finally{f.close();}});
test('missing publisher activation pin, wrong authenticated owner, wrong lesson and expired context fail closed',()=>{
 const f=fixture();try{const budget=requestDialogueBudget(f.env,student,lesson);
  assert.throws(()=>isolatedDialogueAdmission(f.env,{...student,ucUserId:700002},lesson,budget),/invalid/);
  assert.throws(()=>isolatedDialogueAdmission(f.env,student,'lesson-1458',budget),/invalid/);
  assert.throws(()=>isolatedDialogueAdmission(f.env,student,lesson,budget,Date.parse(E2E_HARD_EXPIRY)),/expired/);
  const env=acceptanceEnvironment(request(),{...f.bindings,YW_ACCEPTANCE_ACTIVATION_SHA256:undefined});assert.throws(()=>requestDialogueBudget(env,student,lesson),/invalid/);
  const short=acceptanceEnvironment(request(),{...f.bindings,YW_ACCEPTANCE_EXPIRES_AT:'2026-10-13T03:01:00Z'});assert.throws(()=>isolatedDialogueAdmission(short,student,lesson,budget,at+60000),/expired/);
 }finally{f.close();}
});
test('provider dispatch revalidates current activation and hard expiry',async()=>{
 const f=fixture();try{const budget=requestDialogueBudget(f.env,student,lesson);f.env.YW_E2E_AUTHORITY_JSON='{}';await assert.rejects(()=>callDialogueModel(f.env,'synthetic','synthetic-call',()=>{},budget),/e2e_activation_invalid/);
  f.env.YW_E2E_AUTHORITY_JSON=JSON.stringify(authority());mock.timers.setTime(Date.parse(E2E_HARD_EXPIRY));await assert.rejects(()=>callDialogueModel(f.env,'synthetic','synthetic-call',()=>{},budget),/e2e_activation_expired/);
 }finally{mock.timers.setTime(at);f.close();}
});
test('E2E requires the exact three-attempt and 252000 reservation contract',()=>{
 for(const edit of [{YW_DIALOGUE_PROVIDER_ATTEMPTS:'1'},{YW_DIALOGUE_BUDGET_JSON:JSON.stringify({...policy,reserveMicros:85000})}]){
  const f=fixture({bindingEdits:edit});try{assert.throws(()=>requestDialogueBudget(f.env,student,lesson),/e2e_budget_mismatch/);}finally{f.close();}
 }
});
test('money, lesson lifetime and global concurrency remain binding in isolated E2E',async()=>{
 for(const mode of ['money','lesson','concurrency']){const f=fixture();try{await send(f,body());const session=f.sql.prepare('SELECT id FROM dialogue_sessions').get().id;
  if(mode==='money')seed(f,1,{operation:false,oldDays:false,reserved:50000000,accounted:null});
  if(mode==='lesson')seed(f,120,{operation:false,session});
  if(mode==='concurrency'){seed(f,4,{operation:false,oldDays:false});f.sql.prepare("UPDATE dialogue_calls SET state='reserved',created_at='2026-10-13T03:00:00.000Z'").run();}
  const r=await send(f,body(1,'synthetic-e2e-guard-0002'),()=>{throw Error('remaining guard bypass');});assert.equal(r.status,429);assert.equal((await r.json()).code,{money:'daily_money_budget_exhausted',lesson:'paid_lesson_lifetime_exhausted',concurrency:'dialogue_concurrency_busy'}[mode]);
 }finally{f.close();}}
});
