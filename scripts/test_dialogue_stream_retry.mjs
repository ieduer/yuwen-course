import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {handleDialogue,callDialogueModel} from '../site/dialogue-source.js';
import {consumeGatewayStream,validatedProviderAccounting} from '../site/dialogue-stream.js';
import {requestDialogueBudget,operatorCost,continuationDisposition} from '../site/dialogue-recovery.js';
import {loadModeCurriculum} from './dialogue_mode_sample.mjs';
const student={id:1,ucUserId:700001},lesson='lesson-1717-p2';
const policy={version:'synthetic-retry-v1',validUntil:'2099-01-01T00:00:00Z',currency:'USD',model:'gemini-3.6-flash',globalDailyMicros:50000000,userDailyMicros:50000000,lessonLifetimeMicros:50000000,reserveMicros:84000,inputMicrosPerMillion:750000,outputMicrosPerMillion:3750000};
const usage={promptTokenCount:100,candidatesTokenCount:20,thoughtsTokenCount:80,totalTokenCount:200};
const attempt=(ordinal,outcome='UNAVAILABLE',extra={})=>({ordinal,model:policy.model,outcome,brokerCompleted:true,outputStarted:false,usage:null,...extra});
const accounting=attempts=>({version:1,policy:'yw-same-model-sequential-v1',mode:'sequential-distinct-key',fallback:false,hedge:false,backgroundCalls:0,maxProviderAttempts:3,providerAttemptCount:attempts.length,attempts});
function fixture(){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON;');for(const file of fs.readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())sql.exec(fs.readFileSync('migrations/'+file,'utf8'));sql.exec("INSERT INTO students(id,uc_slug,display_name) VALUES(1,'synthetic-one','Test'),(2,'synthetic-two','Test');");
 const wrap=(text,args=[])=>({bind:(...v)=>wrap(text,v),first:async()=>sql.prepare(text).get(...args)||null,all:async()=>({results:sql.prepare(text).all(...args)}),run:async()=>({meta:{changes:Number(sql.prepare(text).run(...args).changes)}}),runSync:()=>({meta:{changes:Number(sql.prepare(text).run(...args).changes)}})});
 const db={prepare:text=>wrap(text),batch:async rows=>{sql.exec('BEGIN');try{const r=rows.map(s=>s.runSync());sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 return {sql,db,env:{YW_DIALOGUE_BUDGET_JSON:JSON.stringify(policy),YW_DIALOGUE_PROVIDER_ATTEMPTS:'3',READING_DB:db,YW_DIALOGUE_ENABLED:'true',ASSETS:{fetch:async r=>new Response(fs.readFileSync('site'+new URL(r.url).pathname))}},close:()=>sql.close()};
}
const req=(body,owner=1,query='')=>new Request(`https://yw.bdfz.net/api/dialogue/v1?lessonId=${lesson}${query}`,body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ownerRef:createHash('sha256').update(`dialogue-owner:${owner}`).digest('hex'),...body})}:{});
const body=(revision=0,mutationId='stream-retry-student-0001')=>({content:'我注意到原句的對照，仍不確定情感如何轉變。',revision,mutationId});
const partial='這段文字已保存';
const modelSuccess=(reply=partial+'，請接著指出一處原文。',a=accounting([attempt(1,'OK',{outputStarted:true,usage})]))=>({value:{reply,assessments:[]},model:policy.model,usage,providerAccounting:a});
const failModel=(prior=[])=>async(_e,_p,_id,onReply)=>{await onReply(partial);const error=Error('gateway_stream_unconfirmed');error.gatewayFailure={providerAccounting:accounting([...prior,attempt(prior.length+1,'FETCH_ERROR',{outputStarted:true})])};throw error;};
async function firstFailure(f,fn=failModel()){return await(await handleDialogue(req(body()),f.env,student,null,{callModel:fn})).json();}
const continuation=data=>({action:'continue',turnId:data.partial.turnId,partialDigest:data.partial.digest,revision:data.revision,mutationId:'stream-retry-continue-0001'});
for(const disposition of ['same','historical-unprojected','changed'])test('partial continuation preserves calibration disposition: '+disposition,async()=>{
 const f=fixture();try{
  const source=loadModeCurriculum('lesson-1498'),fetch=f.env.ASSETS.fetch;
  f.env.ASSETS.fetch=async r=>new URL(r.url).pathname==='/dialogue-curriculum/lesson-1498.json'?Response.json(source):fetch(r);
  const request=b=>new Request('https://yw.bdfz.net/api/dialogue/v1?lessonId=lesson-1498',{method:'POST',body:JSON.stringify({ownerRef:createHash('sha256').update('dialogue-owner:1').digest('hex'),...b})});
  const first=await(await handleDialogue(request(body()),f.env,student,null,{callModel:failModel()})).json();assert(first.partial);
  const row=f.sql.prepare("SELECT id,details_json FROM dialogue_events WHERE event_type='source_context_prepared'").get(),context=JSON.parse(row.details_json);assert(context.calibrationEvidence);
  // The old-runtime fixture had no calibration supplement. This represents its
  // immutable recorded disposition, not a migration of any real learner data.
  if(disposition==='historical-unprojected')delete context.calibrationEvidence;
  if(disposition==='changed')context.calibrationEvidence.manifestDigest='f'.repeat(64);
  if(disposition!=='same')f.sql.prepare('UPDATE dialogue_events SET details_json=? WHERE id=?').run(JSON.stringify(context),row.id);
  const before=f.sql.prepare('SELECT * FROM dialogue_calls').all();let calls=0;
  const response=await handleDialogue(request(continuation(first)),f.env,student,null,{callModel:async(_env,prompt)=>{calls++;assert.equal(prompt.includes('calibrationEvidence'),disposition==='same');return modelSuccess();}});
  if(disposition==='changed'){assert.equal(response.status,503);assert.equal(calls,0);assert.deepEqual(f.sql.prepare('SELECT * FROM dialogue_calls').all(),before);}
  else {assert.equal(response.status,200);assert.equal(calls,1);const after=JSON.parse(f.sql.prepare("SELECT details_json FROM dialogue_events WHERE event_type='source_context_prepared' AND id LIKE '%:continued'").get().details_json);assert.equal(!!after.calibrationEvidence,disposition==='same');}
  assert.equal(f.sql.prepare('SELECT curriculum_json FROM dialogue_sessions').get().curriculum_json,JSON.stringify(source));
 }finally{f.close();}
});
function stream(a,answer=JSON.stringify({reply:'可見回應',assessments:[]})){
 const data=`id: 1\nevent: delta\ndata: ${JSON.stringify({text:answer})}\n\nid: 2\nevent: done\ndata: ${JSON.stringify({answer,model:policy.model,usage,providerAttemptCount:a.providerAttemptCount,providerAccounting:a})}\n\n`;
 return new Response(data,{headers:{'content-type':'text/event-stream'}});
}
test('two and three same-model sequential attempts need full final accounting proof',async()=>{for(const count of [2,3]){const a=accounting([...Array.from({length:count-1},(_,i)=>attempt(i+1)),attempt(count,'OK',{outputStarted:true,usage})]);const r=await consumeGatewayStream(stream(a),()=>{},{maxProviderAttempts:3});assert.equal(r.providerAttemptCount,count);assert.equal(r.value.reply,'可見回應');await assert.rejects(()=>consumeGatewayStream(stream(a),()=>{}));}});
test('final successful attempt also requires broker completion and emitted output',async()=>{for(const override of [{brokerCompleted:false},{outputStarted:false}]){const a=accounting([attempt(1),attempt(2,'OK',{outputStarted:true,usage,...override})]);await assert.rejects(()=>consumeGatewayStream(stream(a),()=>{},{maxProviderAttempts:3}));}});
for(const [name,edit] of Object.entries({fallback:a=>a.fallback=true,hedge:a=>a.hedge=true,background:a=>a.backgroundCalls=1,wrongModel:a=>a.attempts[0].model='other',unreleased:a=>a.attempts[0].brokerCompleted=false,partialRetry:a=>a.attempts[0].outputStarted=true,ordinal:a=>a.attempts[0].ordinal=2,quotaRetry:a=>a.attempts[0].outcome='RPD_429',count:a=>a.providerAttemptCount=3}))test('rejects forged or inconsistent '+name,async()=>{const a=accounting([attempt(1),attempt(2,'OK',{outputStarted:true,usage})]);edit(a);await assert.rejects(()=>consumeGatewayStream(stream(a),()=>{},{maxProviderAttempts:3}));});
test('partial exception retains text and terminal accounting but does not call a provider',async()=>{const a=accounting([attempt(1,'FETCH_ERROR',{outputStarted:true})]);const data=`id: 1\nevent: delta\ndata: ${JSON.stringify({text:'{"reply":"'+partial})}\n\nid: 2\nevent: error\ndata: ${JSON.stringify({providerAccounting:a})}\n\n`;await assert.rejects(()=>consumeGatewayStream(new Response(data,{headers:{'content-type':'text/event-stream'}}),()=>{},{maxProviderAttempts:3}),error=>{assert.equal(error.partialReply,partial);assert.equal(error.gatewayFailure.providerAccounting.attempts[0].usage,null);return true;});});
test('reserve is252000 and successful usage never makes failed attempts free',()=>{const p=requestDialogueBudget({YW_DIALOGUE_BUDGET_JSON:JSON.stringify(policy),YW_DIALOGUE_PROVIDER_ATTEMPTS:'3'});assert.equal(p.reserveMicros,252000);assert.equal(operatorCost(p,{usage},accounting([attempt(1),attempt(2),attempt(3,'OK',{usage,outputStarted:true})])),168450);assert.equal(operatorCost(p,{usage},null),null);assert.equal(requestDialogueBudget({YW_DIALOGUE_BUDGET_JSON:JSON.stringify(policy)}).reserveMicros,84000);});
test('real source continuation preserves partial, uses remaining slots, one ledger and one student turn',async()=>{const f=fixture();try{const initial=await firstFailure(f);assert.equal(initial.partial.content,partial);assert.equal(initial.partial.continuation.allowed,true);assert.equal(f.sql.prepare('SELECT reserved_micros FROM dialogue_calls').get().reserved_micros,252000);let n=0;
 const callModel=async(_e,p,_id,onReply,budget)=>{n++;assert(p.includes(JSON.stringify(partial)));assert.equal(budget.providerAttemptLimit,2);await onReply(partial.slice(0,3));await onReply(partial+'，請接著指出一處原文。');return modelSuccess(undefined,{...accounting([attempt(1,'OK',{outputStarted:true,usage})]),maxProviderAttempts:2});};
 const r=await handleDialogue(req(continuation(initial)),f.env,student,null,{callModel});assert.equal(r.status,200);const value=await r.json();assert.equal(value.partial,null);assert.equal(value.turns.length,2);assert.equal(n,1);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM dialogue_calls').get().n,1);assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM dialogue_turns WHERE role='student'").get().n,1);const call=f.sql.prepare('SELECT * FROM dialogue_calls').get();assert.equal(call.state,'finished');assert.equal(call.accounted_micros,84450);assert.deepEqual(JSON.parse(call.usage_json),usage);assert.equal(value.turns[0].status,'saved');const evidence=JSON.parse(f.sql.prepare("SELECT details_json FROM dialogue_events WHERE event_type='provider_accounting_saved'").get().details_json);assert.equal(evidence.studentAccountedMicros,450);assert.equal(evidence.providerAccounting.providerAttemptCount,2);assert.equal(evidence.providerAccounting.continuedAfter,1);
 const duplicate=await handleDialogue(req(continuation(initial)),f.env,student,null,{callModel});assert.equal(duplicate.status,200);assert.equal(n,1);
 }finally{f.close();}});
test('second continuation is forbidden and all original partial chunks remain',async()=>{const f=fixture();try{const first=await firstFailure(f);let n=0;const r=await handleDialogue(req(continuation(first)),f.env,student,null,{callModel:async(_e,_p,_id,onReply,budget)=>{n++;await onReply(partial+'，後段也已保存');const error=Error('stopped');error.gatewayFailure={providerAccounting:{...accounting([attempt(1,'FETCH_ERROR',{outputStarted:true})]),maxProviderAttempts:2}};throw error;}});const value=await r.json();assert.equal(n,1);assert.equal(value.partial.content,partial+'，後段也已保存');assert.equal(value.partial.continuation.allowed,false);assert.equal(value.partial.continuation.code,'continuation_already_used');assert.equal(f.sql.prepare('SELECT accounted_micros FROM dialogue_calls').get().accounted_micros,null);assert.equal(f.sql.prepare('SELECT reserved_micros FROM dialogue_calls').get().reserved_micros,252000);const again=await handleDialogue(req({...continuation(value),mutationId:'stream-retry-continue-0002'}),f.env,student,null,{callModel:()=>{throw Error('must not call');}});assert.equal(again.status,409);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM dialogue_assessments').get().n,0);}finally{f.close();}});
test('a partial on third slot cannot continue or create a fourth provider attempt',async()=>{const f=fixture();try{const data=await firstFailure(f,failModel([attempt(1),attempt(2)]));assert.equal(data.partial.continuation.allowed,false);assert.equal(data.partial.continuation.code,'provider_attempt_limit');const r=await handleDialogue(req(continuation(data)),f.env,student,null,{callModel:()=>{throw Error('forbidden');}});assert.equal(r.status,409);}finally{f.close();}});
test('double-submit continuation has one active writer and no duplicate reply',async()=>{const f=fixture();try{const data=await firstFailure(f);let n=0;const callModel=async()=>{n++;await Promise.resolve();return modelSuccess(undefined,{...accounting([attempt(1,'OK',{outputStarted:true,usage})]),maxProviderAttempts:2});};const responses=await Promise.all([handleDialogue(req(continuation(data)),f.env,student,null,{callModel}),handleDialogue(req(continuation(data)),f.env,student,null,{callModel})]);assert(responses.every(r=>[200,409].includes(r.status)));assert.equal(n,1);assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM dialogue_turns WHERE role='teacher'").get().n,1);}finally{f.close();}});
for(const mode of ['foreign','changedPartial','newerTurn','policyChanged','nextDay','originalSource','unknownProvider'])test('continuation denied for '+mode,async()=>{const f=fixture();try{const data=await firstFailure(f);let b=continuation(data),st=student,owner=1;if(mode==='foreign'){st={id:2,ucUserId:700002};owner=2;}if(mode==='changedPartial')b.partialDigest='0'.repeat(64);if(mode==='newerTurn'){f.sql.prepare('UPDATE dialogue_sessions SET revision=revision+1').run();}if(mode==='policyChanged')f.env.YW_DIALOGUE_PROVIDER_ATTEMPTS='1';if(mode==='nextDay')f.sql.prepare("UPDATE dialogue_calls SET day='2000-01-01'").run();if(mode==='originalSource')f.sql.prepare("UPDATE dialogue_turns SET source_request_json=? WHERE role='student'").run(JSON.stringify({interaction:'authorQuestion',objectiveId:'legacy:test'}));if(mode==='unknownProvider')f.sql.prepare("UPDATE dialogue_events SET details_json='{}' WHERE event_type='response_unconfirmed'").run();const r=await handleDialogue(req(b,owner),f.env,st,null,{callModel:()=>{throw Error('must not call');}});assert.equal(r.status,409);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM dialogue_calls').get().n,1);}finally{f.close();}});
test('divergent regenerated prefix never changes partial or saves a teacher assessment',async()=>{const f=fixture();try{const data=await firstFailure(f);await handleDialogue(req(continuation(data)),f.env,student,null,{callModel:async()=>modelSuccess('改寫舊部分',{...accounting([attempt(1,'OK',{outputStarted:true,usage})]),maxProviderAttempts:2})});const read=await(await handleDialogue(req(),f.env,student)).json();assert.equal(read.partial.content,partial);assert.equal(read.turns.length,1);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM dialogue_assessments').get().n,0);}finally{f.close();}});
function seedCalls(f,count,{oldDay=false}={}){const session=f.sql.prepare('SELECT * FROM dialogue_sessions').get();for(let i=1;i<count;i++){const id='seed-turn-'+i;f.sql.prepare("INSERT INTO dialogue_turns(id,session_id,mutation_id,request_hash,role,content,status,policy_version,created_at) VALUES(?,?,?,'seed','student','synthetic','saved','synthetic','2020-01-01')").run(id,session.id,id);f.sql.prepare("INSERT INTO dialogue_calls(turn_id,session_id,student_id,day,reserved_tokens,state,created_at,reserved_micros,accounted_micros,budget_policy_json) VALUES(?,?,1,?,2400,'finished','2020-01-01',84000,1,?)").run(id,session.id,oldDay?'2020-01-01':new Date().toISOString().slice(0,10),JSON.stringify(policy));}}
for(const [count,oldDay,expected] of [[120,true,'paid_lesson_lifetime_exhausted'],[40,false,'daily_call_budget_exhausted']])test(expected+' preserves draft, export and correct reset semantics',async()=>{const f=fixture();try{const first=await firstFailure(f);seedCalls(f,count,{oldDay});const r=await handleDialogue(req(body(first.revision,'stream-retry-budget-0002')),f.env,student,null,{callModel:()=>{throw Error('forbidden');}});assert.equal(r.status,429);const v=await r.json();assert.equal(v.code,expected);assert(v.draftSaved&&v.canSave&&v.canExport&&v.canReview);assert.equal(v.retryable,!oldDay);assert.equal(!!v.resetsAt,!oldDay);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM dialogue_drafts WHERE submitted_turn_id IS NULL').get().n,1);const read=await handleDialogue(req(null,1,'&records=1'),f.env,student);assert.equal(read.status,200);}finally{f.close();}});
test('calibration call budget stays one attempt even when runtime retry is enabled',async()=>{let sent;const env={YW_DIALOGUE_PROVIDER_ATTEMPTS:'3',APIS_CALLER_TOKEN:'synthetic',APIS:{fetch:async r=>{sent=await r.json();return new Response('not now',{status:503});}}};await assert.rejects(()=>callDialogueModel(env,'synthetic','fixed-case',()=>{}, {...policy,maxInputTokens:100000,maxOutputTokens:2400}));assert.equal(sent.providerAttemptLimit,1);});

test('three internal attempts settle one learner ledger with final successful usage and full unknown failure costs',async()=>{const f=fixture();try{const result=modelSuccess(undefined,accounting([attempt(1),attempt(2),attempt(3,'OK',{outputStarted:true,usage})]));const response=await handleDialogue(req(body()),f.env,student,null,{callModel:async()=>result});assert.equal(response.status,200);const rows=f.sql.prepare('SELECT * FROM dialogue_calls').all();assert.equal(rows.length,1);assert.equal(rows[0].accounted_micros,168450);assert.deepEqual(JSON.parse(rows[0].usage_json),usage);assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM dialogue_turns WHERE role='teacher'").get().n,1);}finally{f.close();}});
test('continuation consumes the last remaining logical slot after an earlier retry and partial failure',async()=>{const f=fixture();try{const first=await firstFailure(f,failModel([attempt(1)]));assert.equal(first.partial.continuation.remainingProviderAttempts,1);let n=0;await handleDialogue(req(continuation(first)),f.env,student,null,{callModel:async(_e,_p,_id,_reply,budget)=>{n++;assert.equal(budget.providerAttemptLimit,1);return modelSuccess(undefined,{...accounting([attempt(1,'OK',{outputStarted:true,usage})]),maxProviderAttempts:1});}});assert.equal(n,1);const row=f.sql.prepare('SELECT * FROM dialogue_calls').get();assert.equal(row.accounted_micros,168450);assert.equal(row.reserved_micros,252000);const evidence=JSON.parse(f.sql.prepare("SELECT details_json FROM dialogue_events WHERE event_type='provider_accounting_saved'").get().details_json);assert.equal(evidence.providerAccounting.providerAttemptCount,3);}finally{f.close();}});

test('model38 accepts only exact requested model accounting including single-attempt final frames',async()=>{const a=accounting([attempt(1,'OK',{outputStarted:true,usage})]);a.attempts[0].model='gemini-3.8-flash';const source=await stream(a).text();const body=source.replaceAll('gemini-3.6-flash','gemini-3.8-flash');const response=()=>new Response(body,{headers:{'content-type':'text/event-stream'}});assert.equal((await consumeGatewayStream(response(),()=>{},{maxProviderAttempts:3,model:'gemini-3.8-flash'})).model,'gemini-3.8-flash');await assert.rejects(()=>consumeGatewayStream(response(),()=>{},{maxProviderAttempts:3,model:'gemini-3.6-flash'}),/mismatch/);});

test('pre-delta HTTP failure retains exact-request terminal accounting in the saved learner failure',async()=>{
 const f=fixture();try{f.env.APIS_CALLER_TOKEN='synthetic';f.env.APIS={fetch:async r=>Response.json({requestId:r.headers.get('x-request-id'),providerAccounting:accounting([attempt(1,'TIMEOUT')])},{status:503})};
 await handleDialogue(req(body()),f.env,student,null,{callModel:callDialogueModel});
 const event=JSON.parse(f.sql.prepare("SELECT details_json FROM dialogue_events WHERE event_type='response_unconfirmed'").get().details_json);
 assert.equal(event.providerAccounting.providerAttemptCount,1);assert.equal(event.providerAccounting.attempts[0].outcome,'TIMEOUT');assert.equal(event.providerAccounting.attempts[0].brokerCompleted,true);
 const row=f.sql.prepare('SELECT * FROM dialogue_calls').get();assert.equal(row.state,'review');assert.equal(row.accounted_micros,null);assert.equal(row.reserved_micros,252000);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM dialogue_assessments').get().n,0);
 }finally{f.close();}
});
for(const corruption of ['request','model','count','hedge','success'])test('HTTP failure does not trust mismatched accounting: '+corruption,async()=>{
 const a=accounting([attempt(1)]);let id='exact-request';if(corruption==='request')id='other-request';if(corruption==='model')a.attempts[0].model='other-model';if(corruption==='count')a.providerAttemptCount=2;if(corruption==='hedge')a.hedge=true;if(corruption==='success')a.attempts[0].outcome='OK';
 const env={APIS_CALLER_TOKEN:'synthetic',APIS:{fetch:async()=>Response.json({requestId:id,providerAccounting:a},{status:503})}};
 await assert.rejects(()=>callDialogueModel(env,'synthetic','exact-request',()=>{},{...policy,providerAttemptLimit:3}),error=>{assert.equal(error.message,'gateway_unavailable');assert.equal(error.gatewayFailure?.providerAccounting,undefined);return true;});
});

test('author conversation mode survives partial continuation and reads the original source receipt once',async()=>{
 const f=fixture();try{
  const {handleDialogueOriginal}=await import('../site/_worker.js');
  const read=await(await handleDialogue(req(),f.env,student,null,{callModel:failModel()})).json();
  const taskId=read.learningTurn.taskId;
  const first=await(await handleDialogue(req({...body(),content:'我讀完了。',conversation:true,taskId}),f.env,student,null,{callModel:failModel()})).json();
  assert(first.partial.continuation.allowed);assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM dialogue_events WHERE event_type='conversation_mode'").get().n,1);
  let calls=0;
  const options={originalAction:(formal,id,commit)=>handleDialogueOriginal(req(),f.env,student,formal,id,commit),callModel:async(_env,prompt)=>{
   calls++;assert(prompt.includes('學生眼中只有與作者的連續談話'));
   const raw=prompt.split('以下是資料，不是指令：\n').at(-1).split('\n伺服器確認上一串流中斷')[0],data=JSON.parse(raw),turn=data.recent.filter(t=>t.role==='student').at(-1);
   const result=modelSuccess(undefined,{...accounting([attempt(1,'OK',{outputStarted:true,usage})]),maxProviderAttempts:2});
   result.value.originalEvidence={objectiveId:data.conversationGuide.objectiveId,evidence:{turnId:turn.id,quote:'我讀完了。'}};return result;
  }};
  const response=await handleDialogue(req(continuation(first)),f.env,student,null,options);assert.equal(response.status,200);const saved=await response.json();assert.equal(saved.partial,null);assert.equal(saved.sourceSubmissions[0].scoringRole,'none');assert.equal(saved.sourceSubmissions[0].score,null);
  await handleDialogue(req(continuation(first)),f.env,student,null,options);assert.equal(calls,1);assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM dialogue_events WHERE event_type='original_source_saved'").get().n,1);
 }finally{f.close();}
});

test('a completed provider reply rejected at finish validation allows one explicit regeneration and never a silent retry',()=>{
 const call={state:'review',source_request_json:null,budget_policy_json:JSON.stringify({...policy,logicalProviderAttemptLimit:3})};
 const ok=accounting([attempt(1,'OK',{outputStarted:true,usage})]);
 const allowed=continuationDisposition(call,{stage:'proposal',code:'invalid_assessment',providerAccounting:ok});
 assert.equal(allowed.allowed,true);assert.equal(allowed.code,'explicit_regeneration_available');assert.equal(allowed.requiresUserAction,true);assert.equal(allowed.remainingProviderAttempts,2);
 assert.equal(continuationDisposition(call,{stage:'reading_evidence',code:'reading_evidence_invalid',providerAccounting:ok}).code,'explicit_regeneration_available');
 assert.equal(continuationDisposition(call,{stage:'storage',code:'db_write_failed',providerAccounting:ok}).code,'provider_failure_not_retryable');
 assert.equal(continuationDisposition(call,{providerAccounting:ok}).code,'provider_failure_not_retryable');
 assert.equal(continuationDisposition(call,{stage:'proposal',providerAccounting:ok},true).code,'continuation_already_used');
 assert.equal(continuationDisposition({...call,budget_policy_json:JSON.stringify(policy)},{stage:'proposal',providerAccounting:ok}).code,'continuation_not_reserved');
 assert.equal(continuationDisposition(call,{stage:'proposal',providerAccounting:accounting([attempt(1,'400'),attempt(2,'OK',{outputStarted:true,usage})])}).code,'provider_completion_unconfirmed');
 assert.equal(continuationDisposition(call,{stage:'provider_request',providerAccounting:accounting([attempt(1,'TIMEOUT',{outputStarted:true})])}).code,'explicit_continuation_available');
});

test('a finish-rejected reply is retained as received-not-validated and an explicit regeneration starts a fresh reply',async()=>{
 const f=fixture();try{
  const rejected='這一句的對照我也留意到了。你覺得它讓情感往哪裡轉？',fresh='你提到的對照很關鍵。請找出原文裡一處聲音描寫，說說它如何打破寧靜。';
  const rejecting=async()=>{const r=modelSuccess(rejected,accounting([attempt(1,'OK',{outputStarted:true,usage})]));r.value.assessments=[{objectiveId:'not-in-lesson',outcome:'demonstrated',rationale:'synthetic',evidence:[]}];return r;};
  const first=await firstFailure(f,rejecting);
  const failure=JSON.parse(f.sql.prepare("SELECT details_json FROM dialogue_events WHERE event_type='response_unconfirmed'").get().details_json);
  assert.equal(failure.stage,'proposal');assert.equal(failure.code,'invalid_assessment');assert.equal(failure.lateReplyRetained,true);
  assert.equal(first.partial.content,rejected);assert.equal(first.partial.status,'unconfirmed');assert.deepEqual(first.partial.disposition,{stage:'proposal',code:'invalid_assessment',received:true});
  assert.equal(first.partial.continuation.allowed,true);assert.equal(first.partial.continuation.code,'explicit_regeneration_available');
  assert.equal(first.turns.filter(t=>t.role==='teacher').length,0);assert.equal(first.turns.filter(t=>t.role==='student').length,1);
  let prompt=null;const regen=async(_e,p,_id,_reply,budget)=>{prompt=p;assert.equal(budget.providerAttemptLimit,2);return modelSuccess(fresh,{...accounting([attempt(1,'OK',{outputStarted:true,usage})]),maxProviderAttempts:2});};
  const after=await(await handleDialogue(req(continuation(first)),f.env,student,null,{callModel:regen})).json();
  assert.match(prompt,/重新生成/);assert.doesNotMatch(prompt,/逐字以此字串開頭/);assert.doesNotMatch(prompt,new RegExp(rejected));
  assert.equal(after.partial,null);assert.deepEqual(after.turns.filter(t=>t.role==='teacher').map(t=>t.content),[fresh]);assert.equal(after.turns.filter(t=>t.role==='student').length,1);
  const archived=JSON.parse(f.sql.prepare("SELECT details_json FROM dialogue_events WHERE event_type='response_rejected_retained'").get().details_json);
  assert.equal(archived.content,rejected);assert.equal(archived.stage,'proposal');assert.equal(archived.code,'invalid_assessment');
  const started=JSON.parse(f.sql.prepare("SELECT details_json FROM dialogue_events WHERE event_type='continuation_started'").get().details_json);assert.equal(started.regeneration,true);
  const call=f.sql.prepare('SELECT state,usage_json FROM dialogue_calls').get();assert.equal(call.state,'finished');
  const usageAccounting=call.usage_json?JSON.parse(call.usage_json):null;if(usageAccounting?.providerAccounting)assert.deepEqual(usageAccounting.providerAccounting.attempts.map(a=>a.outcome),['OK_REJECTED','OK']);
 }finally{f.close();}
});

test('a saved turn whose provider attempts ended before any output offers one explicit retry that re-dispatches it without a new turn',async()=>{
 const f=fixture();try{
  const noOutput=(prior=[])=>async()=>{const error=Error('gateway_unavailable');error.gatewayFailure={providerAccounting:accounting([...prior,attempt(prior.length+1,'TIMEOUT'),attempt(prior.length+2,'TIMEOUT')])};throw error;};
  const first=await firstFailure(f,noOutput());
  assert.equal(first.partial,null);assert.equal(first.turns.length,1);assert.equal(first.turns[0].status,'needs_review');
  assert.equal(first.replyRetry?.allowed,true);assert.equal(first.replyRetry.code,'explicit_retry_available');assert.equal(first.replyRetry.remainingProviderAttempts,1);assert.equal(first.replyRetry.stage,'provider_request');
  const policy={state:'review',source_request_json:null,budget_policy_json:JSON.stringify({...f.env.YW_DIALOGUE_BUDGET_JSON?JSON.parse(f.env.YW_DIALOGUE_BUDGET_JSON):{},logicalProviderAttemptLimit:3})};
  assert.equal(continuationDisposition(policy,{stage:'provider_request',providerAccounting:accounting([attempt(1,'TIMEOUT',{outputStarted:true})])},false,{noOutput:true}).code,'partial_output_present');
  let prompt=null,limit=null;const fresh='先說說你在意的那一句吧。';
  const retryModel=async(_e,p,_id,_reply,budget)=>{prompt=p;limit=budget.providerAttemptLimit;return modelSuccess(fresh,{...accounting([attempt(1,'OK',{outputStarted:true,usage})]),maxProviderAttempts:1});};
  const bad=await(await handleDialogue(req({action:'continue',turnId:first.turns[0].id,partialDigest:'0'.repeat(64),revision:first.revision,mutationId:'stream-retry-noout-0000'}),f.env,student,null,{callModel:retryModel})).json();
  assert.equal(bad.code,'continuation_readback_required');assert.equal(prompt,null);
  const after=await(await handleDialogue(req({action:'continue',turnId:first.turns[0].id,partialDigest:'',revision:first.revision,mutationId:'stream-retry-noout-0001'}),f.env,student,null,{callModel:retryModel})).json();
  assert.equal(limit,1);assert.doesNotMatch(prompt,/續答|重新生成/);
  assert.deepEqual(after.turns.map(t=>t.role),['student','teacher']);assert.equal(after.turns[1].content,fresh);assert.equal(after.replyRetry,null);assert.equal(after.partial,null);
  const started=JSON.parse(f.sql.prepare("SELECT details_json FROM dialogue_events WHERE event_type='continuation_started'").get().details_json);assert.equal(started.retry,true);assert.equal(started.regeneration,false);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM dialogue_turns WHERE role='student'").get().n,1);
  const again=await(await handleDialogue(req({action:'continue',turnId:first.turns[0].id,partialDigest:'',revision:after.revision,mutationId:'stream-retry-noout-0002'}),f.env,student,null,{callModel:retryModel})).json();
  assert.notEqual(again.code,undefined);assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM dialogue_turns WHERE role='teacher'").get().n,1);
 }finally{f.close();}
});

test('a no-output failure on the last reserved attempt offers no retry',async()=>{
 const f=fixture();try{
  const exhausted=async()=>{const error=Error('gateway_unavailable');error.gatewayFailure={providerAccounting:accounting([attempt(1,'TIMEOUT'),attempt(2,'TIMEOUT'),attempt(3,'TIMEOUT')])};throw error;};
  const first=await firstFailure(f,exhausted);
  assert.equal(first.replyRetry?.allowed,false);assert.equal(first.replyRetry.code,'provider_attempt_limit');
  const r=await(await handleDialogue(req({action:'continue',turnId:first.turns[0].id,partialDigest:'',revision:first.revision,mutationId:'stream-retry-noout-0003'}),f.env,student,null,{callModel:()=>{throw Error('must not call');}})).json();
  assert.equal(r.code,'provider_attempt_limit');
 }finally{f.close();}
});

// Claude first, free Gemini fallback (2026-10-20 finding): a structured reply truncated at the output bound is a paid, failed
// Claude attempt the gateway never relays; the saved turn must offer the explicit retry instead of an unclassified denial.
test('Claude-primary: a truncated Claude attempt plus a free-pool failure reserves the policy output bound and offers one explicit retry',async()=>{
 const f=fixture();try{
  const CLAUDE='claude-sonnet-5-5',GEMINI='gemini-3.8-flash';
  const v2={version:'yw-claude-primary-20261020-v2',policy:'yw-claude-primary-gemini-fallback-v1',currency:'USD',model:GEMINI,primaryModel:CLAUDE,primaryInputMicrosPerMillion:2000000,primaryOutputMicrosPerMillion:10000000,inputMicrosPerMillion:0,outputMicrosPerMillion:0,maxInputTokens:32000,maxOutputTokens:8192,reserveMicros:145920,globalDailyMicros:20000000,userDailyMicros:2000000,lessonLifetimeMicros:4000000,validUntil:'2099-01-01T00:00:00Z'};
  f.env.YW_DIALOGUE_BUDGET_JSON=JSON.stringify(v2);
  const v2accounting=(attempts,max=3)=>({version:1,policy:'yw-claude-primary-gemini-fallback-v1',mode:'sequential-distinct-key',fallback:false,hedge:false,backgroundCalls:0,maxProviderAttempts:max,providerAttemptCount:attempts.length,attempts});
  const truncatedUsage={promptTokenCount:15600,candidatesTokenCount:8192,totalTokenCount:23792};
  let sentBudget=null;
  const truncated=async(_e,_p,_id,_reply,budget)=>{sentBudget=budget;const error=Error('gateway_stream_unconfirmed');error.gatewayFailure={providerAccounting:v2accounting([{ordinal:1,model:CLAUDE,outcome:'CLAUDE_TRUNCATED',brokerCompleted:true,outputStarted:true,usage:truncatedUsage},{ordinal:2,model:GEMINI,outcome:'TIMEOUT',brokerCompleted:true,outputStarted:false,usage:null}])};throw error;};
  const first=await firstFailure(f,truncated);
  assert.equal(sentBudget.maxOutputTokens,8192);assert.equal(sentBudget.providerAttemptLimit,3);assert.equal(sentBudget.reserveMicros,145920);
  const call=f.sql.prepare('SELECT * FROM dialogue_calls').get();assert.equal(call.state,'review');assert.equal(call.reserved_tokens,8192);assert.equal(call.reserved_micros,145920);assert.equal(call.accounted_micros,null);
  assert.equal(first.partial,null);assert.equal(first.turns.length,1);assert.equal(first.turns[0].status,'needs_review');
  assert.equal(first.replyRetry?.allowed,true);assert.equal(first.replyRetry.code,'explicit_retry_available');assert.equal(first.replyRetry.remainingProviderAttempts,1);assert.equal(first.replyRetry.providerAttemptsUsed,2);assert.equal(first.replyRetry.stage,'provider_request');assert.equal(first.replyRetry.code_detail,'gateway_stream_unconfirmed');
  const failure=JSON.parse(f.sql.prepare("SELECT details_json FROM dialogue_events WHERE event_type='response_unconfirmed'").get().details_json);
  assert.deepEqual(failure.providerAccounting.attempts.map(a=>a.outcome),['CLAUDE_TRUNCATED','TIMEOUT']);assert.deepEqual(failure.providerAccounting.attempts[0].usage,truncatedUsage);
  // The explicit retry re-dispatches the saved turn with the one remaining slot (Claude first again); no new student turn, no silent retry.
  const fresh='先說說你在意的那一句吧。',okUsage={promptTokenCount:15600,candidatesTokenCount:1200,totalTokenCount:16800};let limit=null,prompt=null;
  const retryModel=async(_e,p,_id,_reply,budget)=>{prompt=p;limit=budget.providerAttemptLimit;return {value:{reply:fresh,assessments:[]},model:CLAUDE,usage:okUsage,providerAccounting:v2accounting([{ordinal:1,model:CLAUDE,outcome:'OK',brokerCompleted:true,outputStarted:true,usage:okUsage}],1)};};
  const after=await(await handleDialogue(req({action:'continue',turnId:first.turns[0].id,partialDigest:'',revision:first.revision,mutationId:'stream-retry-trunc-0001'}),f.env,student,null,{callModel:retryModel})).json();
  assert.equal(limit,1);assert.doesNotMatch(prompt,/續答|重新生成/);
  assert.deepEqual(after.turns.map(t=>t.role),['student','teacher']);assert.equal(after.turns[1].content,fresh);assert.equal(after.replyRetry,null);assert.equal(after.partial,null);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM dialogue_turns WHERE role='student'").get().n,1);
  const settled=f.sql.prepare('SELECT * FROM dialogue_calls').get();assert.equal(settled.state,'finished');
  const evidence=JSON.parse(f.sql.prepare("SELECT details_json FROM dialogue_events WHERE event_type='provider_accounting_saved'").get().details_json);
  assert.deepEqual(evidence.providerAccounting.attempts.map(a=>[a.model,a.outcome]),[[CLAUDE,'CLAUDE_TRUNCATED'],[GEMINI,'TIMEOUT'],[CLAUDE,'OK']]);assert.equal(evidence.providerAccounting.continuedAfter,2);
  // Known cost: 15,600×2 + 8,192×10 (truncated, paid) + 0 (free pool) + 15,600×2 + 1,200×10 (served) = 174,320 > the one-primary
  // reservation of 145,920, so the operator cost is unknown and the budget keeps counting the call at its reservation.
  assert.equal(evidence.operatorAccountedMicros,null);assert.equal(settled.accounted_micros,null);assert.equal(settled.reserved_micros,145920);
  const again=await(await handleDialogue(req({action:'continue',turnId:first.turns[0].id,partialDigest:'',revision:after.revision,mutationId:'stream-retry-trunc-0002'}),f.env,student,null,{callModel:()=>{throw Error('must not call');}})).json();
  assert.notEqual(again.code,undefined);assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM dialogue_turns WHERE role='teacher'").get().n,1);
 }finally{f.close();}
});
