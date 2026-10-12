import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {validateProposal,projectState,contextFor,createQuestion,vocabularyOrder,learningTrajectory,evidenceReport,LIMITS} from '../site/dialogue-policy.js';
import {handleDialogue,reconcileAbandonedCalls,callDialogueModel} from '../site/dialogue-source.js';
import {replyPrefix,consumeGatewayStream} from '../site/dialogue-stream.js';
import {readDialogueEvents} from '../site/assets/dialogue-events.js';
import {dialogueBudget,reconciledCost} from '../site/dialogue-budget.js';
import worker,{handleDialogueFirstRead,handleDialogueFormal} from '../site/_worker.js';
import {prepareFormalInput} from '../site/dialogue-formal.js';
import {loadPendingLearningSubmission,assertLearningSubmissionAllowed} from '../site/learning-evidence-source.js';
const curriculum=JSON.parse(fs.readFileSync('site/dialogue-curriculum/lesson-1717-p2.json'));
const classical=JSON.parse(fs.readFileSync('site/dialogue-curriculum/lesson-1711-p1.json'));
const student={id:1,ucUserId:700001};
const syntheticBudget=JSON.stringify({version:'synthetic-only',validUntil:'2099-01-01T00:00:00Z',currency:'USD',model:'gemini-test',globalDailyMicros:1000000,userDailyMicros:100000,lessonLifetimeMicros:500000,reserveMicros:1100,inputMicrosPerMillion:10000,outputMicrosPerMillion:10000});
function fixture({classicalReady=false}={}){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON;');
 for(const file of fs.readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())sql.exec(fs.readFileSync('migrations/'+file,'utf8'));
 sql.exec("INSERT INTO students(id,uc_slug,display_name) VALUES(1,'synthetic-one','Test'),(2,'synthetic-two','Test');");
 if(classicalReady)sql.exec("INSERT INTO classical_first_read_sessions(student_id,lesson_id,text_version_id,text_digest,submitted_at) VALUES(1,'lesson-1711-p1','synthetic-ready','synthetic-digest','2020-01-01'); INSERT INTO learning_interactions(source_event_id,student_id,academic_year,lesson_id,interaction_key,event_type,assessment_kind,scoring_role,resource_key,resource_version,registry_version,client_mutation_id,lesson_phase,occurred_at) VALUES('synthetic-read',1,'2026-2027','lesson-1711-p1','readAcknowledged','read_acknowledged','participation','none','synthetic-read','v1','v1','annotated-read:lesson-1711-p1:synthetic-ready','annotated_reading','2020-01-01');");
 const wrap=(text,args=[])=>({bind:(...v)=>wrap(text,v),first:async()=>sql.prepare(text).get(...args)||null,all:async()=>({results:sql.prepare(text).all(...args)}),run:async()=>({meta:{changes:Number(sql.prepare(text).run(...args).changes)}}),runSync:()=>({meta:{changes:Number(sql.prepare(text).run(...args).changes)}})});
 const db={prepare:text=>wrap(text),batch:async statements=>{sql.exec('BEGIN');try{const r=statements.map(s=>s.runSync());sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 const env={YW_DIALOGUE_BUDGET_JSON:syntheticBudget,READING_DB:db,YW_DIALOGUE_ENABLED:'true',ASSETS:{fetch:async request=>new Response(fs.readFileSync('site'+new URL(request.url).pathname))}};
 return {sql,db,env,close:()=>sql.close()};
}
const req=(body,id=curriculum.lessonId,owner=1)=>new Request(`https://yw.bdfz.net/api/dialogue/v1?lessonId=${id}`,body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ownerRef:createHash('sha256').update(`dialogue-owner:${owner}`).digest('hex'),...body})}:{});
const body=(revision=0,mutationId='synthetic-mutation-0001')=>({content:'我注意到「不寧靜」與寧靜景物的對照，仍不確定結尾是否真的解脫。',revision,mutationId});
const good=async()=>({value:{reply:'我在景物描寫中留下了情緒的轉折。你能指出一處聲音，說說它如何改變寧靜嗎？',assessments:[]},model:'synthetic-model',modelVersion:null});
test('original vocabulary mastery and submitted first reading are credited before a new conversation',async()=>{
 const f=fixture();try{
  const item=classical.vocabulary[0].id;
  f.sql.prepare("INSERT INTO vocab_mastery(student_id,lesson_id,item_id,status,correct_count,wrong_count,last_at) VALUES(1,?,?,'mastered',2,1,'2020-01-01')").run(classical.lessonId,item);
  f.sql.prepare("INSERT INTO classical_first_read_sessions(student_id,lesson_id,text_version_id,text_digest,summary_text,submitted_at) VALUES(1,?,'historical-v1','historical-digest','原有初讀','2020-01-01')").run(classical.lessonId);
  const before=f.sql.prepare('SELECT * FROM vocab_mastery').all();
  const data=await(await handleDialogue(req(null,classical.lessonId),f.env,student)).json();
  assert.equal(data.state.objectives.find(o=>o.id===item).status,'preserved');
  assert.equal(data.state.objectives.find(o=>o.domain==='firstRead').status,'preserved');
  assert.equal(data.state.objectives.find(o=>o.id===item).evidence.ruleVersion,null);
  const retry=await handleDialogue(req({action:'question',objectiveId:item},classical.lessonId),f.env,student);assert.equal(retry.status,409);assert.equal((await retry.json()).code,'already_demonstrated');
  let observed;await handleDialogue(req(body(),classical.lessonId),f.env,student,null,{callModel:async(_e,p)=>{observed=p;return good();}});
  assert(observed.includes('"id":"'+item+'","status":"preserved"'));assert.deepEqual(f.sql.prepare('SELECT * FROM vocab_mastery').all(),before);
 }finally{f.close();}
});
test('unfinished first reading retains source version and text without becoming zero, completed or another owner data',async()=>{
 const f=fixture();try{
  f.sql.prepare("INSERT INTO classical_first_read_sessions(student_id,lesson_id,text_version_id,text_digest,elapsed_ms,summary_text) VALUES(1,?,'old-v1','old-digest',91234,'尚未完成的原始想法')").run(classical.lessonId);
  const before=f.sql.prepare('SELECT * FROM classical_first_read_sessions').all();
  const data=await(await handleDialogue(req(null,classical.lessonId),f.env,student)).json();
  assert.equal(data.legacy.firstRead[0].elapsed_ms,91234);assert.equal(data.legacy.firstRead[0].summary_text,'尚未完成的原始想法');assert.equal(data.legacy.firstRead[0].submitted_at,null);
  assert.equal(data.state.objectives.find(o=>o.domain==='firstRead').status,'not_yet_observed');
  const other=await(await handleDialogue(req(null,classical.lessonId),f.env,{id:2,ucUserId:700002})).json();assert.deepEqual(other.legacy.firstRead,[]);
  assert.deepEqual(f.sql.prepare('SELECT * FROM classical_first_read_sessions').all(),before);
 }finally{f.close();}
});
test('formal completion uses exact resource versions and preserves the corresponding domain without regrading',async()=>{
 const f=fixture();try{
  const c=JSON.parse(fs.readFileSync('site/dialogue-curriculum/lesson-1498.json')),o=c.objectives.find(o=>o.domain==='legacy'&&o.legacy.questionKind==='revision');
  f.sql.prepare("INSERT INTO learning_interactions(source_event_id,student_id,academic_year,lesson_id,interaction_key,event_type,assessment_kind,scoring_role,resource_key,resource_version,registry_version,occurred_at) VALUES('old-accepted',1,'2026-2027',?,'revision','revision_submitted','performance','a_plus_gate',?,?,'old-registry','2020-01-01')").run(c.lessonId,o.legacy.resourceKey,o.legacy.resourceVersion);
  f.sql.exec("INSERT INTO learning_evaluations(source_event_id,verification_method,eligibility_status,raw_value,max_value,normalized_value,correctness,evaluated_at) VALUES('old-accepted','source_ai_assessment','eligible',83,100,0.83,'passed','2020-01-01')");
  const before=f.sql.prepare('SELECT * FROM learning_evaluations').all();
  const data=await(await handleDialogue(req(null,c.lessonId),f.env,student)).json();assert.equal(data.state.objectives.find(x=>x.domain==='revision').status,'preserved');
  f.sql.exec("UPDATE learning_interactions SET resource_version='different' WHERE source_event_id='old-accepted'");
  const changed=await(await handleDialogue(req(null,c.lessonId),f.env,student)).json();assert.equal(changed.state.objectives.find(x=>x.domain==='revision').status,'historical_review');assert.deepEqual(f.sql.prepare('SELECT * FROM learning_evaluations').all(),before);
 }finally{f.close();}
});
test('missing monetary policy never calls a model and preserves a recoverable draft',async()=>{
 const f=fixture();delete f.env.YW_DIALOGUE_BUDGET_JSON;
 try{const r=await handleDialogue(req(body()),f.env,student,null,{callModel:()=>{throw Error('forbidden');}});assert.equal(r.status,503);assert.equal((await r.json()).draftSaved,true);assert.equal(f.sql.prepare('SELECT content FROM dialogue_drafts').get().content,body().content);}finally{f.close();}
});
test('money reservation is atomic across students and unknown calls keep their full cost',async()=>{
 const f=fixture();f.env.YW_DIALOGUE_BUDGET_JSON=JSON.stringify({...JSON.parse(syntheticBudget),globalDailyMicros:1100});
 try{
  let calls=0;const options={callModel:async()=>{calls++;throw Error('unknown provider outcome');}};
  const responses=await Promise.all([handleDialogue(req(body()),f.env,student,null,options),handleDialogue(req(body(),curriculum.lessonId,2),f.env,{id:2,ucUserId:700002},null,options)]);
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,429]);assert.equal(calls,1);const row=f.sql.prepare('SELECT reserved_micros,accounted_micros,state FROM dialogue_calls').get();assert.equal(row.reserved_micros,1100);assert.equal(row.accounted_micros,null);assert.equal(row.state,'review');
 }finally{f.close();}
});
test('usage reconciliation uses total tokens including thinking and stays conservative for missing usage',()=>{
 const p=dialogueBudget({YW_DIALOGUE_BUDGET_JSON:syntheticBudget});assert.equal(reconciledCost(p,{promptTokenCount:100,totalTokenCount:500,candidatesTokenCount:50,thoughtsTokenCount:350}),5);assert.equal(reconciledCost(p,{}),null);assert.equal(reconciledCost(p,{promptTokenCount:1,totalTokenCount:999999}),null);
 assert.throws(()=>dialogueBudget({YW_DIALOGUE_BUDGET_JSON:JSON.stringify({...JSON.parse(syntheticBudget),reserveMicros:1})}));
});
test('all authenticated My accounts are admitted, without accepting another owner through request parameters',async()=>{
 const f=fixture();try{
  await handleDialogue(req(body()),f.env,student,null,{callModel:good});
  const request=new Request(req().url+'&studentId=1&ucUserId=700001&records=1');
  const r=await handleDialogue(request,f.env,{id:2,ucUserId:991177});assert.equal(r.status,200);
  const value=await r.json();assert.deepEqual(value.turns,[]);assert.equal(value.trace,undefined);
 }finally{f.close();}
});
test('an account change between reading and submitting cannot save the old text under the new owner',async()=>{
 const f=fixture();try{
  const r=await handleDialogue(req(body()),f.env,{id:2,ucUserId:700002},null,{callModel:()=>{throw Error('must not call');}});
  assert.equal(r.status,409);assert.equal((await r.json()).code,'account_changed');
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM dialogue_sessions').get().n,0);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM dialogue_turns').get().n,0);
 }finally{f.close();}
});
test('daily cap renews on the next UTC day without changing earlier usage or records',async()=>{
 const f=fixture();f.env.YW_DIALOGUE_BUDGET_JSON=JSON.stringify({...JSON.parse(syntheticBudget),globalDailyMicros:1100});
 try{
  assert.equal((await handleDialogue(req(body()),f.env,student,null,{callModel:good})).status,200);
  assert.equal((await handleDialogue(req(body(1,'synthetic-second-0001')),f.env,student,null,{callModel:good})).status,429);
  f.sql.exec("UPDATE dialogue_calls SET day='2000-01-01'");
  assert.equal((await handleDialogue(req(body(1,'synthetic-second-0001')),f.env,student,null,{callModel:good})).status,200);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM dialogue_turns').get().n,4);
  assert.equal(f.sql.prepare('SELECT SUM(reserved_micros) AS n FROM dialogue_calls').get().n,2200);
 }finally{f.close();}
});
test('missing monetary policy cannot falsely acknowledge a conflicting saved draft',async()=>{
 const f=fixture();delete f.env.YW_DIALOGUE_BUDGET_JSON;
 try{
  assert.equal((await handleDialogue(req(body()),f.env,student)).status,503);
  const conflict=await handleDialogue(req({...body(),content:'different text'}),f.env,student);
  assert.equal(conflict.status,409);assert.equal((await conflict.json()).code,'draft_conflict');
  assert.equal(f.sql.prepare('SELECT content FROM dialogue_drafts').get().content,body().content);
 }finally{f.close();}
});
test('first visible chunk is persisted before delivery and a disconnected reader does not replay the model',async()=>{
 const f=fixture(),background=[];let emit,complete;const done=new Promise(resolve=>{complete=resolve;});let calls=0;
 try{
  const r=await handleDialogue(new Request(req(body()),{headers:{'content-type':'application/json',accept:'text/event-stream'}}),f.env,student,{waitUntil:p=>background.push(p)},{callModel:async(_e,_p,_id,onReply)=>{calls++;emit=onReply;await done;return good();}});
  const reader=r.body.getReader();assert.match(new TextDecoder().decode((await reader.read()).value),/event: saved/);
  while(!emit)await new Promise(resolve=>setTimeout(resolve,0));
  await emit('我在景物描寫中');assert.equal(f.sql.prepare('SELECT content FROM dialogue_stream_chunks').get().content,'我在景物描寫中');
  assert.match(new TextDecoder().decode((await reader.read()).value),/event: delta/);
  await reader.cancel();complete();await Promise.all(background);
  const duplicate=await(await handleDialogue(req(body()),f.env,student,null,{callModel:()=>{throw Error('never replay');}})).json();
  assert.equal(calls,1);assert.equal(duplicate.turns.length,2);assert.equal(duplicate.partial,null);
 }finally{complete();await Promise.all(background);f.close();}
});
test('unconfirmed streamed text survives reload without granting assessment',async()=>{
 const f=fixture();try{
  await handleDialogue(req(body()),f.env,student,null,{callModel:async(_e,_p,_id,emit)=>{await emit('這段尚未確認');throw Error('cut stream');}});
  const read=await(await handleDialogue(req(),f.env,student)).json();assert.equal(read.partial.content,'這段尚未確認');assert.equal(read.partial.status,'unconfirmed');assert.equal(read.assessments.length,0);
  const other=await(await handleDialogue(req(),f.env,{id:2,ucUserId:700002})).json();assert.equal(other.partial,undefined);
 }finally{f.close();}
});
test('crash reconciliation releases stale capacity, preserves work and rejects a late completion',async()=>{
 const f=fixture(),background=[];let complete;const done=new Promise(resolve=>{complete=resolve;});
 try{
  await handleDialogue(req(body()),f.env,student,{waitUntil:p=>background.push(p)},{callModel:async()=>{await done;return good();}});
  const call=f.sql.prepare('SELECT * FROM dialogue_calls').get();await reconcileAbandonedCalls(f.db,new Date(Date.parse(call.created_at)+61000).toISOString());
  assert.equal(f.sql.prepare('SELECT state FROM dialogue_calls').get().state,'review');assert.equal(f.sql.prepare('SELECT inflight FROM dialogue_sessions').get().inflight,null);
  assert.equal(f.sql.prepare('SELECT status FROM dialogue_turns').get().status,'needs_review');complete();await Promise.all(background);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM dialogue_turns WHERE role='teacher'").get().n,0);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM dialogue_calls').get().n,1);
 }finally{complete();await Promise.all(background);f.close();}
});
test('JSON prefix exposes only reply text with split escapes and never assessment metadata',()=>{
 assert.equal(replyPrefix('{"reply":"你好\\u4e'),'你好');assert.equal(replyPrefix('{"reply":"你好\\u4e2d\\"人" ,"assessments":[{"secret":1}]}'),'你好中"人');
 assert.equal(replyPrefix('{"assessments":[{"reply":"secret"}]}'),'');
});
test('gateway adapter requires ordered complete SSE, persists exact usage, never falls back to JSON',async()=>{
 const answer=JSON.stringify({reply:'你好',assessments:[]}),enc=new TextEncoder();let observedRequest;
 const data=`id: 1\nevent: delta\ndata: ${JSON.stringify({text:answer})}\n\nid: 2\nevent: done\ndata: ${JSON.stringify({answer,model:'gemini-test',modelVersion:'test-1',providerAttemptCount:1,usage:{totalTokenCount:20},firstTokenMs:42,totalDurationMs:100})}\n\n`;
 const env={YW_DIALOGUE_BUDGET_JSON:syntheticBudget,APIS_CALLER_TOKEN:'fixture-only',APIS:{fetch:async r=>{assert.equal(new URL(r.url).pathname,'/api/yw/dialogue-stream');observedRequest=await r.json();return new Response(enc.encode(data),{headers:{'content-type':'text/event-stream'}});}}};
 const visible=[];const value=await callDialogueModel(env,'bounded synthetic prompt','request-1',t=>visible.push(t));
 assert.equal(observedRequest.stream,true);assert.deepEqual(visible,['你好']);assert.equal(value.usage.totalTokenCount,20);assert.equal(value.firstTokenMs,42);
 for(const broken of [data.replace('id: 2','id: 3'),data.split('id: 2')[0],data.replace('"providerAttemptCount":1','"providerAttemptCount":2')])await assert.rejects(()=>consumeGatewayStream(new Response(broken,{headers:{'content-type':'text/event-stream'}}),()=>{}));
 await assert.rejects(()=>consumeGatewayStream(Response.json({answer}),()=>{}));
});
test('browser stream parser waits for confirmed terminal state and rejects a truncated connection',async()=>{
 const prefix='event: saved\ndata: {"turnId":"x","saved":true}\n\nevent: delta\ndata: {"turnId":"x","text":"hello"}\n\n';const seen=[];
 const result=await readDialogueEvents(new Response(prefix+'event: done\ndata: {"turnId":"x"}\n\n'),(e)=>seen.push(e));assert.equal(result.saved,true);assert.deepEqual(seen,['saved','delta','done']);
 await assert.rejects(()=>readDialogueEvents(new Response(prefix),()=>{}));
});
function evidenceFor(o,c=curriculum){const p=c.passages.find(p=>p.text.length>20),t={id:'student-turn',role:'student',content:'起初覺得愉快，現在認為內心尚有不安。我從描寫中看到轉折，也可以不同意作者。'};return {t,p,a:{objectiveId:o.id,outcome:'demonstrated',rationale:'以原句說明理解變化；不同意作者不影響證據。',evidence:o.criteria.map(criterion=>({criterion,turnId:t.id,quote:'現在認為內心尚有不安',passageId:p.id,passageQuote:p.text.slice(0,10)}))}};}
test('inventory retains exact source ids and every formal and active guide requirement',()=>{
 const m=JSON.parse(fs.readFileSync('docs/dialogue/requirement-map.json')),f=JSON.parse(fs.readFileSync('site/data/learning-manifest.json')),g=JSON.parse(fs.readFileSync('site/data/study-guide-catalog.json'));
 assert.equal(m.lessons.length,189);assert.deepEqual(m.lessons.flatMap(l=>l.formal.map(i=>i.resourceKey)).sort(),f.items.map(i=>i.resourceKey).sort());
 assert.deepEqual(m.lessons.flatMap(l=>l.studyGuide.filter(i=>i.active).map(i=>i.itemKey)).sort(),g.lessons.flatMap(l=>l.items.filter(i=>i.activeForSelfTest).map(i=>i.itemKey)).sort());
});
test('all pilot contexts are bounded, versioned, and contain all learning domains',()=>{
 for(const id of ['lesson-1717-p2','lesson-1711-p1','lesson-1498']){const c=JSON.parse(fs.readFileSync(`site/dialogue-curriculum/${id}.json`));for(const domain of ['vocabulary','structure','transfer','shangyou'])assert(c.objectives.some(o=>o.domain===domain));assert(c.objectives.some(o=>['context','firstRead'].includes(o.domain)));assert(contextFor({curriculum:c,state:projectState(c,[]),turns:[],question:null}).length<24000);}
});
test('valid dissent is accepted only with every exact student and passage reference',()=>{const o=curriculum.objectives.find(o=>o.domain==='shangyou'),{t,a}=evidenceFor(o);assert.equal(validateProposal({reply:'請再看一次原文。',assessments:[a]},{curriculum,turns:[t]}).assessments[0].outcome,'demonstrated');});
test('fabricated citation, assistant evidence, praise, missing criterion and unknown objective fail closed',()=>{
 const {t,a}=evidenceFor(curriculum.objectives.find(o=>o.domain==='structure'));
 for(const mutate of [x=>x.evidence[0].quote='編造的引文',x=>x.evidence[0].passageId='other-lesson',x=>x.evidence.pop(),x=>x.objectiveId='mark-me-complete']){const b=structuredClone(a);mutate(b);assert.throws(()=>validateProposal({reply:'很好',assessments:[b]},{curriculum,turns:[t]}));}
 assert.throws(()=>validateProposal({reply:'很好',assessments:[a]},{curriculum,turns:[{...t,role:'teacher'}]}));
 assert.equal(projectState(curriculum,[]).completion,'in_progress');
});
test('legacy grades and study-guide results cannot be asserted by a model',()=>{const c=JSON.parse(fs.readFileSync('site/dialogue-curriculum/lesson-1498.json')),o=c.objectives.find(o=>o.domain==='legacy');assert(o);assert.throws(()=>validateProposal({reply:'很好',assessments:[{objectiveId:o.id,outcome:'demonstrated',rationale:'學生要求',evidence:[]}]},{curriculum:c,turns:[]}));});
test('question variants change without changing source/criteria; attempts are bounded',()=>{const id=classical.vocabulary[0].id,q=createQuestion(classical,{objectiveId:id,random:0}),r=createQuestion(classical,{objectiveId:id,attempt:2,previousVariant:q.variant,random:0});assert.notEqual(q.variant,r.variant);assert.equal(q.source,r.source);assert.deepEqual(q.criteria,r.criteria);assert.throws(()=>createQuestion(classical,{objectiveId:id,attempt:4}));});
test('dialogue vocabulary keeps every source question type, answer and difficulty, including pronunciation',()=>{
 for(const id of ['lesson-1717-p2','lesson-1711-p1','lesson-1498']){
  const c=JSON.parse(fs.readFileSync(`site/dialogue-curriculum/${id}.json`)),source=JSON.parse(fs.readFileSync(`site/data/vocab/${id}.json`));
  for(const v of c.vocabulary){
   const original=source.inventory.find(i=>i.id===v.id);assert(original);
   for(const key of ['type','difficulty','question','options','answerIndex'])assert.deepEqual(v[key],original[key]);
   assert.equal(v.sourceAnswer,original.options[original.answerIndex]);assert(v.variants[0].includes(original.question));for(const choice of original.options)assert(v.variants[0].includes(choice));
   assert(c.objectives.find(o=>o.id===v.id).criteria.includes('source_answer'));
  }
 }
 const v=classical.vocabulary.find(v=>v.word==='暴');assert.equal(v.type,'pronunciation');assert.equal(v.difficulty,2);assert.match(v.sourceAnswer,/pù/);
 const q=createQuestion(classical,{objectiveId:v.id,random:1});assert.match(q.question,/拼音/);assert.match(q.criteria.sourceAnswer,/pù/);
 const o=classical.objectives.find(o=>o.id===v.id),{t,a}=evidenceFor(o,classical);t.questionId=q.id;a.evidence=a.evidence.filter(e=>e.criterion!=='source_answer');
 assert.throws(()=>validateProposal({reply:'尚缺讀音。',assessments:[a]},{curriculum:classical,turns:[t],question:q}),/missing_criterion/);
});
test('verified teaching references retain provenance and do not create uncalibrated mastery gates',()=>{
 assert.equal(classical.languagePractice.length,4);
 for(const item of classical.languagePractice){assert.equal(item.difficulty,null);assert.equal(item.assessmentStatus,'teaching-reference-only-awaiting-calibration');assert(!classical.objectives.some(o=>o.id===item.id));for(const id of item.annotationIds)assert(classical.annotations.some(a=>a.noteId===id));}
 const entry=classical.dictionary.find(d=>d.id==='xc-er');assert.deepEqual(entry.pages.map(p=>[p.pdfPage,p.printedPage]),[[132,120],[133,121]]);assert(entry.pages.every(p=>p.url.startsWith('https://dict.bdfz.net/source/xc/images/')));
 assert.deepEqual(classical.exam.examples.map(e=>[e.year,e.questionNumber]),[[2024,19],[2022,18]]);assert(classical.exam.examples.every(e=>e.sourceKind.includes('非原試卷')));
 const prompt=contextFor({curriculum:classical,state:projectState(classical,[]),turns:[],question:null});assert(prompt.includes('teaching-reference-only-awaiting-calibration'));assert(prompt.includes('source_answer'));assert(prompt.includes('非原試卷或官方評分細則'));
});
test('hinted and unissued vocabulary cannot be credited as independent',()=>{const o=classical.objectives.find(o=>o.domain==='vocabulary'),{t,a}=evidenceFor(o,classical),q=createQuestion(classical,{objectiveId:o.id});t.questionId=q.id;assert.throws(()=>validateProposal({reply:'再試',assessments:[a]},{curriculum:classical,turns:[t]}));assert.throws(()=>validateProposal({reply:'再試',assessments:[a]},{curriculum:classical,turns:[t],question:{...q,hinted:true}}));});
test('additive migration preserves each legacy row, schema, relationships and sequence',()=>{
 const sql=new DatabaseSync(':memory:');for(const f of fs.readdirSync('migrations').filter(f=>/000[1-9].*sql$/.test(f)).sort())sql.exec(fs.readFileSync('migrations/'+f,'utf8'));
 sql.exec("INSERT INTO students(id,uc_slug,display_name) VALUES(1,'synthetic','Test'); INSERT INTO vocab_attempts(id,student_id,lesson_id,item_id,attempt_no,correct,answer,created_at) VALUES(17,1,'old-lesson','word',2,1,'preserve original','2021-02-03'); INSERT INTO vocab_mastery(student_id,lesson_id,item_id,status,correct_count,wrong_count) VALUES(1,'old-lesson','word','mastered',1,1);");
 sql.exec(`
  INSERT INTO submissions(id,student_id,lesson_id,words_raw,words_norm,content_hash,ai_score,ai_verdict,version,created_at) VALUES(31,1,'old-lesson','["沉靜","矛盾","疏離"]','["沉静","矛盾","疏离"]','original-hash',83,'原評語',2,'2021-02-03');
  INSERT INTO submission_words(submission_id,student_id,lesson_id,position,word_raw,word_norm) VALUES(31,1,'old-lesson',1,'沉靜','沉静');
  INSERT INTO star_nodes(student_id,node_id,kind,ref,seq,born_at) VALUES(1,'lesson:old-lesson','lesson','old-lesson',9,'2021-02-03');
  INSERT INTO classical_first_read_sessions(student_id,lesson_id,text_version_id,text_digest,elapsed_ms,summary_text) VALUES(1,'unfinished','old-text-v1','old-text-hash',91234,'未完成的原始想法');
  INSERT INTO classical_first_read_marks(mark_id,student_id,lesson_id,text_version_id,text_digest,paragraph_key,start_offset,end_offset,selected_text,guess_text) VALUES('original-mark',1,'unfinished','old-text-v1','old-text-hash','p3',2,4,'原文','待解惑');
  INSERT INTO learning_interactions(source_event_id,student_id,academic_year,lesson_id,interaction_key,event_type,assessment_kind,scoring_role,resource_key,resource_version,registry_version,raw_payload_json,occurred_at) VALUES('original-source-event',1,'2026-2027','old-lesson','structure','structureCompleted','ai_evaluation','a_plus_gate','original-resource','original-version','original-registry','{"answer":"original answer","ruleVersion":"original-rule"}','2026-09-01T00:00:00Z');
  INSERT INTO learning_evaluations(source_event_id,verification_method,eligibility_status,raw_value,max_value,normalized_value,correctness,evaluation_json,evaluated_at) VALUES('original-source-event','source_ai_assessment','eligible',83,100,0.83,'passed','{"ruleVersion":"original-rule","rationale":"original feedback"}','2026-09-01T00:00:01Z');
  INSERT INTO evidence_outbox(source_event_id,envelope_json,delivery_status) VALUES('original-source-event','{"original":"envelope"}','accepted');
 `);
 const tables=sql.prepare("SELECT name,sql FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();const before=tables.map(t=>({schema:t,rows:sql.prepare(`SELECT * FROM "${t.name}" ORDER BY rowid`).all()}));const seq=sql.prepare('SELECT * FROM sqlite_sequence ORDER BY name').all();
 for(const file of fs.readdirSync('migrations').filter(f=>Number(f.slice(0,4))>=10&&f.endsWith('.sql')).sort())sql.exec(fs.readFileSync('migrations/'+file,'utf8'));
 const after=tables.map(t=>({schema:sql.prepare('SELECT name,sql FROM sqlite_schema WHERE name=?').get(t.name),rows:sql.prepare(`SELECT * FROM "${t.name}" ORDER BY rowid`).all()}));assert.deepEqual(after,before);assert.deepEqual(sql.prepare('SELECT * FROM sqlite_sequence ORDER BY name').all(),seq);assert.equal(sql.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[]);assert.equal(sql.prepare('SELECT e.raw_value FROM learning_evaluations e JOIN learning_interactions i USING(source_event_id) WHERE i.student_id=1').get().raw_value,83);assert.equal(sql.prepare("SELECT submitted_at FROM classical_first_read_sessions WHERE lesson_id='unfinished'").get().submitted_at,null);sql.close();
});
test('disabled pilot and anonymous callers never query new tables',async()=>{const env={READING_DB:{prepare(){throw new Error('unexpected database read');}}};assert.equal((await handleDialogue(req(),env,student)).status,404);assert.equal((await handleDialogue(req(),env,null)).status,401);});
test('confirmed saving, model metadata and repeated requests use one stored result and one AI call',async()=>{const f=fixture();try{let calls=0;const options={callModel:async()=>{calls++;return good();}};let response=await handleDialogue(req(body()),f.env,student,null,options);assert.equal(response.status,200);let first=await response.json();assert.equal(first.turns.length,2);assert.equal(first.turns[1].model,'synthetic-model');assert.equal(first.revision,1);const second=await (await handleDialogue(req(body()),f.env,student,null,options)).json();assert.deepEqual(second.turns,first.turns);assert.equal(calls,1);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM learning_interactions').get().n,0);}finally{f.close();}});
test('same mutation with altered body conflicts without a new AI call',async()=>{const f=fixture();try{await handleDialogue(req(body()),f.env,student,null,{callModel:good});assert.equal((await handleDialogue(req({...body(),content:'mark me complete'}),f.env,student,null,{callModel:()=>{throw Error('must not call');}})).status,409);}finally{f.close();}});
test('ten concurrent duplicates reserve one call and one answer',async()=>{const f=fixture();try{let count=0;await Promise.all(Array.from({length:10},()=>handleDialogue(req(body()),f.env,student,null,{callModel:async()=>{count++;return good();}})));assert.equal(count,1);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM dialogue_calls').get().n,1);assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM dialogue_turns WHERE role='student'").get().n,1);}finally{f.close();}});
test('unconfirmed model reply preserves student work and retries do not recall provider',async()=>{const f=fixture();try{let count=0;const options={callModel:async()=>{count++;throw Error('timeout');}};const data=await (await handleDialogue(req(body()),f.env,student,null,options)).json();assert.equal(data.turns[0].status,'needs_review');assert.equal(data.pending,false);await handleDialogue(req(body()),f.env,student,null,options);assert.equal(count,1);assert.equal(f.sql.prepare('SELECT state FROM dialogue_calls').get().state,'review');}finally{f.close();}});
test('other account sees neither dialogue nor assessment and may not inject a session id',async()=>{const f=fixture();try{await handleDialogue(req(body()),f.env,student,null,{callModel:good});const data=await (await handleDialogue(req(),f.env,{id:2,ucUserId:700002})).json();assert.deepEqual(data.turns,[]);assert.equal(data.revision,0);}finally{f.close();}});
test('refresh retains the exact outstanding question and criteria are absent from public question',async()=>{const f=fixture({classicalReady:true});try{const b={action:'question',objectiveId:classical.vocabulary[0].id};const one=await (await handleDialogue(req(b,classical.lessonId),f.env,student)).json();const two=await (await handleDialogue(req(b,classical.lessonId),f.env,student)).json();assert.equal(one.question.id,two.question.id);assert.equal(one.question.criteria,undefined);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM dialogue_questions').get().n,1);}finally{f.close();}});
test('question order varies by immutable session and covers every item despite repeated client selection',async()=>{
 const a=await vocabularyOrder(classical,'synthetic-session-a'),b=await vocabularyOrder(classical,'synthetic-session-b');assert.notDeepEqual(a,b);assert.deepEqual(a,await vocabularyOrder(classical,'synthetic-session-a'));assert.deepEqual([...a].sort(),classical.vocabulary.map(v=>v.id).sort());
 const f=fixture({classicalReady:true});try{
  const seen=[];
  for(let i=0;i<classical.vocabulary.length;i++){
   const payload={action:'question',objectiveId:classical.vocabulary[0].id};
   const data=await(await handleDialogue(req(payload,classical.lessonId),f.env,student)).json();seen.push(data.question.objectiveId);
   const repeated=await(await handleDialogue(req({...payload,objectiveId:'attempt-to-choose-another'},classical.lessonId),f.env,student)).json();assert.equal(repeated.question.id,data.question.id);
   const row=f.sql.prepare('SELECT instance_json FROM dialogue_questions WHERE id=?').get(data.question.id);const q=JSON.parse(row.instance_json);assert.equal(q.selection.coverageIndex,i);q.state='mastered';
   f.sql.prepare("UPDATE dialogue_questions SET state='mastered',instance_json=? WHERE id=?").run(JSON.stringify(q),q.id);
  }
  assert.equal(new Set(seen).size,classical.vocabulary.length);assert.deepEqual([...seen].sort(),classical.vocabulary.map(v=>v.id).sort());
  const done=await handleDialogue(req({action:'question'},classical.lessonId),f.env,student);assert.equal((await done.json()).code,'vocabulary_covered');
 }finally{f.close();}
});
test('budget exhaustion durably preserves one recoverable draft without another AI call',async()=>{const f=fixture();try{
 let count=0;const options={callModel:async()=>{count++;return good();}};
 for(let i=0;i<LIMITS.turnsPerDay;i++)assert.equal((await handleDialogue(req(body(i,`synthetic-budget-${String(i).padStart(4,'0')}`)),f.env,student,null,options)).status,200);
 const deferred=body(LIMITS.turnsPerDay,'synthetic-over-budget');
 for(let i=0;i<2;i++){const response=await handleDialogue(req(deferred),f.env,student,null,options);assert.equal(response.status,429);assert.equal((await response.json()).draftSaved,true);}
 const read=await(await handleDialogue(req(),f.env,student)).json();assert.equal(read.draft.content,deferred.content);assert.equal(read.draft.mutationId,deferred.mutationId);assert.equal(count,LIMITS.turnsPerDay);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM dialogue_drafts').get().n,1);
 // Synthetic next-day budget permits an explicit resume using the original receipt.
 f.sql.prepare("UPDATE dialogue_calls SET day='2000-01-01'").run();
 const resumed=await(await handleDialogue(req(deferred),f.env,student,null,options)).json();assert.equal(resumed.draft,null);assert.equal(resumed.revision,LIMITS.turnsPerDay+1);assert.equal(count,LIMITS.turnsPerDay+1);
}finally{f.close();}});
test('failed vocabulary requires confirmed student reformulation before another variant',async()=>{const f=fixture({classicalReady:true});try{
 const qBody={action:'question',objectiveId:classical.vocabulary[0].id};const first=await (await handleDialogue(req(qBody,classical.lessonId),f.env,student)).json();
 await handleDialogue(req({...body(),questionId:first.question.id},classical.lessonId),f.env,student,null,{callModel:good});
 const escape=await handleDialogue(req({...qBody,objectiveId:classical.vocabulary.find(v=>v.id!==first.question.objectiveId).id},classical.lessonId),f.env,student);assert.equal((await escape.json()).code,'reformulation_required');
 const blocked=await handleDialogue(req(qBody,classical.lessonId),f.env,student);assert.equal(blocked.status,409);assert.equal((await blocked.json()).code,'reformulation_required');
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM dialogue_questions').get().n,1);
}finally{f.close();}});
test('bounded context keeps recent evidence without resending long histories',()=>{const turns=Array.from({length:200},(_,i)=>({id:`turn-${i}`,role:i%2?'teacher':'student',content:'測'.repeat(2500)}));const prompt=contextFor({curriculum,state:projectState(curriculum,[]),turns,question:null});assert(prompt.length<LIMITS.contextChars+2000);assert(prompt.includes('"turn-0"'));assert(!prompt.includes('"turn-20"'));assert(prompt.includes('turn-199'));});
test('whole-history trajectory keeps early difficulty and later evidence outside the recent context window',()=>{
 const turns=Array.from({length:100},(_,i)=>({id:`t-${i}`,role:i%2?'teacher':'student',content:i===0?'最初我只覺得寧靜，卻不懂最後的失落。':`第${i}輪原話`,createdAt:`2026-01-${String(i+1).padStart(2,'0')}`}));
 const objective=curriculum.objectives.find(o=>o.domain==='context');
 const assessments=[{objectiveId:objective.id,outcome:'needs_practice',evidence:[{turnId:'t-0',quote:'不懂最後的失落',passageId:curriculum.passages[1].id,passageQuote:'这几天心里颇不宁静'}]},{objectiveId:objective.id,outcome:'demonstrated',evidence:[{turnId:'t-40',quote:'第40輪原話',passageId:curriculum.passages[1].id,passageQuote:'这几天心里颇不宁静'}]}];
 const trajectory=learningTrajectory(curriculum,turns,assessments);assert.equal(trajectory.turnCount,100);assert.equal(trajectory.first.turnId,'t-0');assert.equal(trajectory.latest.turnId,'t-98');
 const prompt=contextFor({curriculum,state:projectState(curriculum,assessments),turns,assessments,question:null});assert(prompt.includes('不懂最後的失落'));assert(prompt.includes('t-40'));assert(!prompt.includes('第20輪原話'));
 const report=evidenceReport(curriculum,projectState(curriculum,assessments),assessments,turns);assert.equal(report.teacher.turnIndex.length,100);assert.equal(report.student.summary[0].references[0].turnId,'t-0');assert.equal(report.student.trajectory.domains[0].outcomes.needs_practice,1);
});
test('complete classical trajectory still fits the fixed context budget at long-history limits',()=>{
 const turns=Array.from({length:120},(_,i)=>({id:`long-${i}`,role:i%2?'teacher':'student',content:'長'.repeat(2400)}));
 const assessments=classical.objectives.filter(o=>!['legacy','studyGuide'].includes(o.domain)).flatMap(o=>[0,2].map(i=>({objectiveId:o.id,outcome:i?'demonstrated':'needs_practice',evidence:[{turnId:turns[i].id,quote:'長'.repeat(120),passageId:classical.passages[0].id,passageQuote:classical.passages[0].text.slice(0,100)}]})));
 const prompt=contextFor({curriculum:classical,state:projectState(classical,assessments),turns,assessments,question:null});assert(prompt.length<LIMITS.contextChars+2000);for(const v of classical.vocabulary)assert(prompt.includes(v.id));
});
test('long history uses a stable sequence cursor with no repeated or lost equal-time turns',async()=>{const f=fixture();try{
 await handleDialogue(req(body()),f.env,student,null,{callModel:good});const s=f.sql.prepare('SELECT * FROM dialogue_sessions').get();const at='2026-10-11T01:00:00.000Z';
 for(let i=0;i<100;i++)f.sql.prepare("INSERT INTO dialogue_turns(id,session_id,mutation_id,request_hash,role,content,status,policy_version,created_at) VALUES(?,?,?,'fixture','student','synthetic turn','saved','fixture',?)").run(`history-${i}`,s.id,`history-${i}`,at);
 let page=await (await handleDialogue(req(),f.env,student)).json(),rows=[...page.turns];while(page.older){page=await(await handleDialogue(new Request(`https://yw.bdfz.net/api/dialogue/v1?lessonId=${curriculum.lessonId}&beforeSeq=${page.older.sequence}`),f.env,student)).json();rows.unshift(...page.turns);}
 assert.equal(rows.length,102);assert.equal(new Set(rows.map(t=>t.id)).size,102);assert(rows.every((t,i)=>!i||rows[i-1].sequence<t.sequence));
 assert.equal((await handleDialogue(new Request(`https://yw.bdfz.net/api/dialogue/v1?lessonId=${curriculum.lessonId}&beforeSeq=NaN`),f.env,student)).status,400);
}finally{f.close();}});
test('real Worker route stays disabled without migration, identity or provider access',async()=>{const {default:worker}=await import('../site/_worker.js');const env={READING_DB:{prepare(){throw Error('must not read');}}};assert.equal((await worker.fetch(req(),env,{})).status,404);});
test('real Worker rejects cross-origin pilot writes before identity or D1',async()=>{const {default:worker}=await import('../site/_worker.js');const env={YW_DIALOGUE_ENABLED:'true'};const request=new Request('https://yw.bdfz.net/api/dialogue/v1?lessonId=lesson-1498',{method:'POST',headers:{'content-type':'application/json',origin:'https://attacker.invalid'},body:JSON.stringify(body())});assert.equal((await worker.fetch(request,env,{})).status,403);});
test('pilot admission uses the actual reconciled identity contract and never a browser-supplied id',async()=>{const f=fixture();try{const bad={id:student.id,uc_user_id:student.ucUserId};assert.equal((await handleDialogue(req(),f.env,bad)).status,404);assert.equal((await handleDialogue(req(),f.env,student)).status,200);}finally{f.close();}});

test('private owner reference changes across accounts and saved receipts are recoverable',async()=>{const f=fixture();try{
 const first=await(await handleDialogue(req(body()),f.env,student,null,{callModel:good})).json();
 const other=await(await handleDialogue(req(),f.env,{id:2,ucUserId:700002})).json();
 assert(first.ownerRef);assert(other.ownerRef);assert.notEqual(first.ownerRef,other.ownerRef);
 assert.equal(first.turns[0].mutationId,body().mutationId);assert.equal(first.turns[1].mutationId,null);
}finally{f.close();}});
test('owner export contains the evidence index, questions and events without granting teacher access',async()=>{const f=fixture({classicalReady:true});try{
 await handleDialogue(req({action:'question',objectiveId:classical.vocabulary[0].id},classical.lessonId),f.env,student);
 const request=new Request(`https://yw.bdfz.net/api/dialogue/v1?lessonId=${classical.lessonId}&records=1`);
 const data=await(await handleDialogue(request,f.env,student)).json();
 assert.equal(data.report.kind,'evidence-index-not-official-grade');assert.equal(data.report.teacher.items.length,classical.objectives.length);
 assert.equal(data.trace.questions.length,1);assert.equal(data.trace.questions[0].criteria,undefined);
 const stranger=await(await handleDialogue(request,f.env,{id:2,ucUserId:700002})).json();assert.equal(stranger.trace,undefined);
}finally{f.close();}});

test('a published curriculum revision resumes the immutable in-progress contract without resetting history',async()=>{const f=fixture();try{
 const before=await(await handleDialogue(req(body()),f.env,student,null,{callModel:good})).json();
 const newer=structuredClone(curriculum);newer.curriculumVersion='synthetic-new-curriculum';newer.objectives.push({id:'new-rule-not-retroactive',criteria:[],domain:'context'});
 f.env.ASSETS.fetch=async()=>new Response(JSON.stringify(newer));
 const after=await(await handleDialogue(req(),f.env,student)).json();
 assert.equal(after.sessionId,before.sessionId);assert.deepEqual(after.turns,before.turns);assert.equal(after.curriculumVersion,before.curriculumVersion);assert.equal(after.resumeCurriculum.curriculumVersion,before.curriculumVersion);assert(!after.state.objectives.some(o=>o.id==='new-rule-not-retroactive'));
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM dialogue_sessions').get().n,1);
}finally{f.close();}});
test('requirement mapping includes compound first-read gates and poetry word creation',()=>{
 const m=JSON.parse(fs.readFileSync('docs/dialogue/requirement-map.json'));
 for(const l of m.lessons){assert.equal(l.requirementMappings.filter(r=>r.source==='formal').length,l.formal.length);for(const r of l.requirementMappings)assert(r.conversationEquivalent&&r.evidenceRule&&r.storage);}
 assert(m.lessons.find(l=>l.lessonId===classical.lessonId).compoundRequirements.some(r=>r.id==='unannotated-first-read'));
 const poem=JSON.parse(fs.readFileSync('site/dialogue-curriculum/lesson-1498.json'));assert(poem.objectives.some(o=>o.domain==='wordCreation'));
 assert(!m.lessons.find(l=>l.lessonId===curriculum.lessonId).legacyTracks.includes('vocabulary'));
});

function historicalEvent(f,{id='historical',owner=1,lessonId=curriculum.lessonId,key='lessonCompleted',kind='self_report',role='none',resourceKey='lesson:'+lessonId,version='unknown',eligibility='non_scoring',correctness='not_verified',payload={}}={}){
 f.sql.prepare('INSERT INTO learning_interactions(source_event_id,student_id,academic_year,lesson_id,interaction_key,event_type,assessment_kind,scoring_role,resource_key,resource_version,registry_version,occurred_at,raw_payload_json) VALUES(?,?,\'2026-2027\',?,?,\'synthetic\',?,?,?,?,\'source-fixture\',\'2020-01-01\',?)').run(id,owner,lessonId,key,kind,role,resourceKey,version,JSON.stringify(payload));
 f.sql.prepare('INSERT INTO learning_evaluations(source_event_id,verification_method,eligibility_status,correctness,evaluated_at) VALUES(?,\'source-fixture\',?,?,\'2020-01-01\')').run(id,eligibility,correctness);
}
test('original self-report completion survives without becoming a score or new mastery',async()=>{
 const f=fixture();try{
  historicalEvent(f);historicalEvent(f,{id:'read',key:'readAcknowledged',kind:'participation'});
  const before=f.sql.prepare('SELECT * FROM learning_interactions').all();
  const data=await(await handleDialogue(req(),f.env,student)).json();
  assert.equal(data.legacy.completion.kind,'self_report');assert.equal(data.state.legacyCompletion.status,'preserved');
  assert.equal(data.state.objectives.find(o=>o.domain==='read').status,'preserved');assert.equal(data.state.next,null);
  assert.equal(data.state.readyForShangyou,false);assert.equal(data.state.completion,'in_progress');assert.equal(data.state.legacyGrades,'unchanged');
  const other=await(await handleDialogue(req(),f.env,{id:2,ucUserId:700002})).json();assert.equal(other.legacy.completion,null);
  assert.deepEqual(f.sql.prepare('SELECT * FROM learning_interactions').all(),before);
 }finally{f.close();}
});
test('negative personal evaluation is preserved as non-scoring self-report without correctness requirement',async()=>{
 const f=fixture();try{
  const c=JSON.parse(fs.readFileSync('site/dialogue-curriculum/lesson-1498.json')),o=c.objectives.find(o=>o.domain==='legacy'&&o.legacy.questionKind==='evaluation');
  historicalEvent(f,{lessonId:c.lessonId,key:'evaluation',resourceKey:o.legacy.resourceKey,version:o.legacy.resourceVersion,payload:{rating:0,reason:'我不認同。'}});
  const data=await(await handleDialogue(req(null,c.lessonId),f.env,student)).json();
  assert.equal(data.state.objectives.find(x=>x.id===o.id).status,'preserved');assert.equal(data.state.objectives.find(x=>x.domain==='evaluation').status,'preserved');
  assert.equal(f.sql.prepare('SELECT raw_value FROM learning_evaluations').get().raw_value,null);
 }finally{f.close();}
});
test('unregistered older performance stays preserved-review while failed or unevaluated work is never credited',async()=>{
 const f=fixture();try{
  historicalEvent(f,{key:'revision',kind:'performance',role:'a_plus_gate',eligibility:'eligible',correctness:'passed'});
  historicalEvent(f,{id:'failed',key:'structure',kind:'performance',role:'a_plus_gate',eligibility:'ineligible',correctness:'needs_revision'});
  const data=await(await handleDialogue(req(),f.env,student)).json();
  assert.equal(data.state.objectives.find(o=>o.domain==='revision').status,'historical_review');assert.equal(data.state.objectives.find(o=>o.domain==='structure').status,'not_yet_observed');
 }finally{f.close();}
});
test('study-guide credit follows semantic resource keys and reviewed aliases, never the manifest digest as item revision',async()=>{
 const f=fixture();try{
  const c=structuredClone(curriculum),item={itemKey:'synthetic-item',interactionKey:'studyGuideItemCompleted',semanticRevision:'1111111111111111',resourceKey:'formative:'+c.lessonId+':syntax:1111111111111111',resourceAliases:['formative:'+c.lessonId+':syntax:2222222222222222']};
  c.legacy.formative.push(item);c.objectives.push({id:'study:synthetic-item',sourceItemKey:item.itemKey,domain:'studyGuide',criteria:['existing_source_assessment']});
  f.env.ASSETS.fetch=async()=>new Response(JSON.stringify(c));
  historicalEvent(f,{key:'studyGuideItemCompleted',kind:'performance',role:'formative',resourceKey:item.resourceAliases[0],version:'manifest-digest-not-semantic-revision',eligibility:'eligible',correctness:'passed',payload:{itemKey:item.itemKey}});
  let data=await(await handleDialogue(req(),f.env,student)).json();assert.equal(data.state.objectives.find(o=>o.id==='study:synthetic-item').status,'preserved');
  f.sql.prepare('UPDATE learning_interactions SET resource_key=?').run('formative:'+c.lessonId+':syntax:3333333333333333');
  data=await(await handleDialogue(req(),f.env,student)).json();assert.equal(data.state.objectives.find(o=>o.id==='study:synthetic-item').status,'historical_review');
 }finally{f.close();}
});
test('first-read original marks, guesses, corrections and tombstones remain bound to their exact old text version',async()=>{
 const f=fixture();try{
  f.sql.prepare("INSERT INTO classical_first_read_marks(mark_id,student_id,lesson_id,text_version_id,text_digest,paragraph_key,start_offset,end_offset,selected_text,guess_text,correction_text,resolution_status,deleted_at) VALUES('old-mark',1,?,'original-version','original-digest','old-p',4,6,'學習','原猜測','後來的訂正','resolved','2020-01-02')").run(classical.lessonId);
  const before=f.sql.prepare('SELECT * FROM classical_first_read_marks').all();
  const data=await(await handleDialogue(req(null,classical.lessonId),f.env,student)).json();
  const mark=data.legacy.firstReadMarks[0];assert.equal(mark.text_version_id,'original-version');assert.equal(mark.start_offset,4);assert.equal(mark.guess_text,'原猜測');assert.equal(mark.correction_text,'後來的訂正');assert.equal(mark.deleted_at,'2020-01-02');
  assert.deepEqual(f.sql.prepare('SELECT * FROM classical_first_read_marks').all(),before);
  const other=await(await handleDialogue(req(null,classical.lessonId),f.env,{id:2,ucUserId:700002})).json();assert.deepEqual(other.legacy.firstReadMarks,[]);
 }finally{f.close();}
});
test('owner corrections are append-only, idempotent, exported and require no provider call',async()=>{
 const f=fixture();try{
  const initial=await(await handleDialogue(req(body()),f.env,student,null,{callModel:good})).json(),turnId=initial.turns[0].id;
  const before=f.sql.prepare('SELECT * FROM dialogue_turns').all(),assessments=f.sql.prepare('SELECT * FROM dialogue_assessments').all();
  const correction={action:'correction',turnId,mutationId:'correction-mutation-01',note:'補充說明',proposedText:'我想說的是尚未完全解脫。'};
  const options={callModel:()=>{throw Error('correction must never call provider');}};
  const first=await(await handleDialogue(req(correction),f.env,student,null,options)).json();assert.equal(first.saved,true);
  const repeated=await(await handleDialogue(req(correction),f.env,student,null,options)).json();assert.deepEqual(repeated,first);
  assert.equal((await handleDialogue(req({...correction,note:'changed'}),f.env,student,null,options)).status,409);
  const read=new Request(req().url+'&correctionsFor='+encodeURIComponent(turnId));const notes=await(await handleDialogue(read,f.env,student)).json();assert.equal(notes.corrections.length,1);assert.equal(notes.corrections[0].proposedText,correction.proposedText);
  const exported=await(await handleDialogue(new Request(req().url+'&records=1'),f.env,student)).json();assert(exported.trace.events.some(e=>e.event_type==='owner_correction_recorded'&&e.details.originalPreserved));
  assert.deepEqual(f.sql.prepare('SELECT * FROM dialogue_turns').all(),before);assert.deepEqual(f.sql.prepare('SELECT * FROM dialogue_assessments').all(),assessments);
 }finally{f.close();}
});
test('correction ownership and concurrent quota reject cross-account access and preserve all accepted notes',async()=>{
 const f=fixture();try{
  const data=await(await handleDialogue(req(body()),f.env,student,null,{callModel:good})).json(),turnId=data.turns[1].id;
  const base={action:'correction',turnId,note:'AI 回饋疑問',proposedText:'',mutationId:'correction-other-user'};
  assert.equal((await handleDialogue(req(base,curriculum.lessonId,2),f.env,{id:2,ucUserId:700002})).status,404);
  assert.equal((await handleDialogue(new Request(req().url+'&correctionsFor='+turnId),f.env,{id:2,ucUserId:700002})).status,404);
  assert.equal((await handleDialogue(req(base),f.env,{id:2,ucUserId:700002})).status,409);
  const responses=await Promise.all(Array.from({length:9},(_,i)=>handleDialogue(req({...base,mutationId:'concurrent-correction-'+i}),f.env,student)));
  assert.equal(responses.filter(r=>r.status===200).length,8);assert.equal(responses.filter(r=>r.status===409).length,1);
  const count=f.sql.prepare("SELECT COUNT(*) n FROM dialogue_events WHERE event_type='owner_correction_recorded'").get().n;assert.equal(count,8);
 }finally{f.close();}
});

test('shared history is read once with the already authenticated cookie, fixed destination and strict state shape',async()=>{
 const {readSharedHistory}=await import('../site/dialogue-history.js');let calls=0;
 const raw={schemaVersion:'yw-shared-state/1',siteKey:'yw',ownerScope:'ywo_'+'a'.repeat(32),state:{readingPosition:null,readerPreferences:{}}};
 const value=await readSharedHistory('bdfz_uc_session=SYNTHETIC_ONLY',{fetcher:async(url,options)=>{calls++;assert.equal(url,'https://my.bdfz.net/api/yw/v1/state');assert.equal(options.method,'GET');assert.equal(options.headers.cookie,'bdfz_uc_session=SYNTHETIC_ONLY');assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');return new Response(JSON.stringify(raw));}});
 assert.equal(value.status,'available');assert.equal(calls,1);assert.equal(value.scoringRole,'none');
 assert.equal((await readSharedHistory('',{fetcher:()=>{throw Error('must not fetch');}})).reason,'web_session_required');
 for(const response of [new Response('{}',{status:401}),new Response(JSON.stringify({...raw,ownerScope:'invalid'})),new Response('x'.repeat(16001))])assert.equal((await readSharedHistory('synthetic',{fetcher:async()=>response})).status,'unavailable');
});
test('browser history reads only the centrally verified owner namespace and never mutates or adopts unscoped work',async()=>{
 const {readBrowserHistory}=await import('../site/assets/dialogue-history.js'),scope='ywo_'+'b'.repeat(32),reads=[];
 const record={revision:{done:true,answer:'已保存的原話',score:83},context:{done:false,draft:'未完成'}},values=new Map([
  ['yw-matrix-progress-v2:scope:'+scope,JSON.stringify({[curriculum.lessonId]:record})],
  ['yw-matrix-progress-v2',JSON.stringify({private:'anonymous or unknown owner'})],
 ]);
 const storage={getItem:key=>{reads.push(key);return values.get(key)??null;},setItem:()=>{throw Error('must not write');}};
 const result=readBrowserHistory(storage,scope,curriculum.lessonId);assert.deepEqual(result.record,record);assert.equal(result.authority,'browser_only_unverified');assert.deepEqual(reads,['yw-matrix-progress-v2:scope:'+scope]);
 const other=readBrowserHistory(storage,'ywo_'+'c'.repeat(32),curriculum.lessonId);assert.equal(other.status,'not_found');
 const before=reads.length;assert.equal(readBrowserHistory(storage,'anonymous',curriculum.lessonId).status,'unavailable');assert.equal(reads.length,before);
 assert.equal(readBrowserHistory({getItem(){throw Error('storage denied');}},scope,curriculum.lessonId).status,'unavailable');
});
test('shared-history is opt-in, authenticated and unavailable without its approved reader',async()=>{
 const f=fixture();try{let calls=0;const options={readSharedHistory:async()=>{calls++;return {status:'available',ownerScope:'ywo_'+'a'.repeat(32),readingPosition:null,readerPreferences:{}};}};
 await handleDialogue(req(),f.env,student,null,options);assert.equal(calls,0);
 const request=new Request(req().url+'&sharedHistory=1');const value=await(await handleDialogue(request,f.env,student,null,options)).json();assert.equal(calls,1);assert.equal(value.sharedHistory.status,'available');assert.equal(value.ownerRef,createHash('sha256').update('dialogue-owner:1').digest('hex'));
 assert.equal((await handleDialogue(request,f.env,null,null,options)).status,401);assert.equal(calls,1);
 assert.equal((await(await handleDialogue(request,f.env,student)).json()).sharedHistory.status,'unavailable');
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM dialogue_sessions').get().n,0);
 }finally{f.close();}
});

test('classical dialogue reuses exact source first-reading handlers and gates annotations before any model call',async()=>{
 const f=fixture();let modelCalls=0;f.env.APIS={fetch:()=>{throw Error('no_provider_for_first_read');}};
 const options={callModel:async()=>{modelCalls++;return good();},firstReadAction:(op,payload)=>handleDialogueFirstRead(req(null,classical.lessonId),f.env,student,null,op,payload)};
 const action=async(operation,payload={})=>handleDialogue(req({action:'first_read',operation,payload},classical.lessonId),f.env,student,null,options);
 try{
  assert.equal((await(await handleDialogue(req(null,classical.lessonId),f.env,student)).json()).readingGate.phase,'initial_reading');
  const premature=await handleDialogue(req(body(),classical.lessonId),f.env,student,null,options);assert.equal(premature.status,409);assert.equal(modelCalls,0);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM dialogue_calls').get().n,0);
  const state=await(await action('state')).json(),asset=JSON.parse(fs.readFileSync('site/data/classical-first-read/lesson-1711-p1.json'));
  assert.equal(state.textVersionId,asset.textVersionId);assert.equal(state.submitted,false);
  const base={textVersionId:asset.textVersionId,textDigest:asset.textDigest,elapsedMs:60000};
  for(let i=0;i<3;i++){
   const paragraph=asset.paragraphs[0],startOffset=i*3,endOffset=startOffset+2;
   const response=await action('mark',{...base,lessonId:'lesson-1498',paragraphKey:paragraph.key,startOffset,endOffset,selectedText:paragraph.text.slice(startOffset,endOffset),guess:`原始猜測${i}`,clientMutationId:`synthetic-first-read-mark-${i}`});
   assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
  }
  const before=f.sql.prepare('SELECT mark_id,selected_text,guess_text FROM classical_first_read_marks ORDER BY mark_id').all();assert.equal(before.length,3);
  const submitted=await action('submit',{...base,summary:'我初步理解學習需要持續積累也有未懂之處。',clientMutationId:'synthetic-first-read-submitted'});assert.equal(submitted.status,200,JSON.stringify(await submitted.clone().json()));
  assert.equal((await(await handleDialogue(req(null,classical.lessonId),f.env,student)).json()).readingGate.phase,'annotated_reading');
  const earlyQuestion=await handleDialogue(req({action:'question'},classical.lessonId),f.env,student);assert.equal((await earlyQuestion.json()).code,'reading_required');
  const acknowledged=await action('acknowledge',base);assert.equal(acknowledged.status,200,JSON.stringify(await acknowledged.clone().json()));
  const readback=await(await handleDialogue(req(null,classical.lessonId),f.env,student)).json();assert.equal(readback.readingGate.phase,'close_reading');
  assert.equal(readback.readingGate.unresolvedMarks,3);assert.equal(readback.state.next.domain,'vocabulary');
  const modelProposals=classical.objectives.map(o=>({objectiveId:o.id,outcome:'demonstrated',evidence:[]}));
  assert.equal(projectState(classical,modelProposals,[],null,readback.readingGate).readyForShangyou,false,'model claims cannot bypass unresolved source marks');
  const firstMark=before[0],resolved=await action('resolve',{...base,markId:firstMark.mark_id,correction:'根據本句與教材註釋，我修正原有猜測。'});assert.equal(resolved.status,200);
  assert.deepEqual(f.sql.prepare('SELECT mark_id,selected_text,guess_text FROM classical_first_read_marks ORDER BY mark_id').all(),before);
  const switched=await handleDialogue(req({action:'first_read',operation:'mark',payload:base},classical.lessonId),f.env,{id:2,ucUserId:700002},null,{firstReadAction:()=>{throw Error('must_not_reach_source');}});assert.equal(switched.status,409);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM classical_first_read_marks WHERE student_id=2').get().n,0);
  const evaluations=f.sql.prepare('SELECT correctness,eligibility_status,normalized_value FROM learning_evaluations').all();assert(evaluations.every(e=>e.eligibility_status==='non_scoring'&&e.normalized_value===null));assert.equal(modelCalls,0);
 }finally{f.close();}
});

const poem=JSON.parse(fs.readFileSync('site/dialogue-curriculum/lesson-1498.json'));
const sourceInput={
 contextWords:{words:'澄澈、流轉、追問'},
 authorQuestion:{answer:'「江月年年望相似」與「人生代代無窮已」的相似，是否讓個人離愁更顯短暫？'},
 revision:{original:'江月年年望相似',action:'改',revised:'江月年年都相同',reason:'「望」保留觀照的距離，相似亦容許差別；改句把不確定的凝視變為直接斷言。'},
 structure:{reason:'前段「春江潮水連海平」從廣闊景象展開；後段「不知乘月幾人歸」收束到游子，將天地時間與離人相聯。'},
 wordCreation:{word:'徘徊',creation:'他徘徊在江邊。月色移過石階。那封未寄出的信仍留在手中。'},
};
const formalBody=(kind='structure',revision=0,mutationId='synthetic-formal-00001')=>{
 const objective=poem.objectives.find(o=>o.domain==='legacy'&&o.legacy.questionKind===kind);
 const formal={objectiveId:objective.id,input:sourceInput[kind]};
 return {formal,content:prepareFormalInput(poem,formal).content,revision,mutationId};
};
const formalResult=(score=83)=>({value:{reply:'我把江月的長久與離人的等待放在一起。你會如何理解結尾的歸途？',score,verdict:'有具體文本依據',strength:'能連結首尾',gap:'仍可細辨情緒轉折',nextQuestion:'結尾的落月改變了甚麼？'},model:'gemini-test',modelVersion:'synthetic-version',usage:{promptTokenCount:100,totalTokenCount:500}});
const formalOptions=(f,callModel)=>({callModel,formalAction:(formal,id,evaluate,commit)=>handleDialogueFormal(req(null,poem.lessonId),f.env,student,formal,id,evaluate,commit)});

test('five original formal rubrics use one budgeted call and atomically retain source answers, original scores and dialogue',async()=>{
 for(const kind of Object.keys(sourceInput)){
  const f=fixture();f.env.YW_DURABLE_EVALUATION_ENABLED='true';
  try{
   let calls=0,prompt;const submit=formalBody(kind),options=formalOptions(f,async(_e,p)=>{calls++;prompt=p;return formalResult();});
   const response=await handleDialogue(req(submit,poem.lessonId),f.env,student,null,options),data=await response.json();
   assert.equal(response.status,200);assert.equal(calls,1,kind);assert.equal(data.turns.length,2,JSON.stringify(data));
   assert(prompt.includes('互動類型：'+kind));assert(prompt.includes('第一個欄位必須為 reply'));
   assert.equal(f.sql.prepare('SELECT raw_value,correctness FROM learning_evaluations').get().raw_value,83);
   assert.equal(f.sql.prepare('SELECT correctness FROM learning_evaluations').get().correctness,'passed');
   assert.deepEqual(JSON.parse(f.sql.prepare('SELECT submitted_payload_json FROM learning_submission_records').get().submitted_payload_json),sourceInput[kind]);
   const source=f.sql.prepare('SELECT * FROM learning_interactions').get();assert(source.client_mutation_id.startsWith('yw-dialogue:'));
   const outbox=JSON.parse(f.sql.prepare('SELECT envelope_json FROM evidence_outbox').get().envelope_json);assert.equal(outbox.sourceEventId,source.source_event_id);assert.equal(outbox.rawValue,83);
   const c=f.sql.prepare('SELECT * FROM dialogue_calls').get();assert.equal(c.state,'finished');assert.equal(c.accounted_micros,5);
   assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM learning_evaluation_jobs').get().n,0);
   assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM learning_evaluator_calls').get().n,0);
   const duplicate=await handleDialogue(req(submit,poem.lessonId),f.env,student,null,options);assert.equal(duplicate.status,200);assert.equal(calls,1);
   const retry=await handleDialogue(req(formalBody(kind,1,'synthetic-formal-00002'),poem.lessonId),f.env,student,null,options);assert.equal(retry.status,409);assert.equal(calls,1);
  }finally{f.close();}
 }
});
test('formal failed score keeps original needs_revision and may only receive a new explicit answer',async()=>{
 const f=fixture();try{
  let calls=0;const options=formalOptions(f,async()=>{calls++;return formalResult(42);});
  const response=await handleDialogue(req(formalBody(),poem.lessonId),f.env,student,null,options);assert.equal(response.status,200);
  const evaluation=f.sql.prepare('SELECT * FROM learning_evaluations').get();assert.equal(evaluation.raw_value,42);assert.equal(evaluation.correctness,'needs_revision');assert.equal(evaluation.eligibility_status,'ineligible');
  const updated=formalBody('structure',1,'synthetic-formal-00002');updated.formal.input={reason:sourceInput.structure.reason+' 江月照見的是不同世代的離人，時間的循環並未消除個體的等待。'};updated.content=prepareFormalInput(poem,updated.formal).content;
  await handleDialogue(req(updated,poem.lessonId),f.env,student,null,options);
  assert.equal(calls,2);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM learning_evaluations').get().n,2);
 }finally{f.close();}
});
test('unknown formal result keeps full reserved cost and is blocked from every legacy retry path',async()=>{
 const f=fixture();try{
  let calls=0;await handleDialogue(req(formalBody(),poem.lessonId),f.env,student,null,formalOptions(f,async()=>{calls++;throw Error('uncertain');}));
  const pending=f.sql.prepare('SELECT * FROM learning_pending_submissions').get();assert(pending);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM learning_evaluation_jobs').get().n,0);
  assert.equal(f.sql.prepare('SELECT state FROM dialogue_calls').get().state,'review');assert.equal(f.sql.prepare('SELECT accounted_micros FROM dialogue_calls').get().accounted_micros,null);
  await assert.rejects(loadPendingLearningSubmission({env:f.env,student,clientMutationId:pending.client_mutation_id}),{code:'dialogue_readback_only'});
  await assert.rejects(assertLearningSubmissionAllowed({request:req(),env:f.env,student,lesson:{id:poem.lessonId},interactionKey:'structure',payload:{reason:sourceInput.structure.reason,clientMutationId:pending.client_mutation_id}}),{code:'dialogue_readback_only'});
  const publicRequest=new Request('https://yw.bdfz.net/api/interaction-check',{method:'POST',headers:{'content-type':'application/json',origin:'https://yw.bdfz.net'},body:JSON.stringify({clientMutationId:pending.client_mutation_id})});
  const rejected=await worker.fetch(publicRequest,f.env,{});assert.equal(rejected.status,409);assert.equal((await rejected.json()).code,'dialogue_readback_only');assert.equal(calls,1);
  const replay=await handleDialogue(req(formalBody('structure',1,'synthetic-formal-new-id'),poem.lessonId),f.env,student,null,formalOptions(f,()=>{throw Error('must not re-evaluate');}));assert.equal(replay.status,409);assert.equal((await replay.json()).code,'source_result_unconfirmed');
 }finally{f.close();}
});
test('formal late replies cannot write a grade after same-attempt reconciliation',async()=>{
 const f=fixture();try{
  await handleDialogue(req(formalBody(),poem.lessonId),f.env,student,null,formalOptions(f,async()=>{
   f.sql.exec("UPDATE dialogue_calls SET created_at='2000-01-01T00:00:00Z'");await reconcileAbandonedCalls(f.db);return formalResult();
  }));
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM learning_evaluations').get().n,0);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM dialogue_turns').get().n,1);
  assert.equal(f.sql.prepare('SELECT state FROM dialogue_calls').get().state,'review');
 }finally{f.close();}
});
test('a source-ledger write failure rolls back final dialogue, cost reconciliation and grade together',async()=>{
 const f=fixture();try{
  f.sql.exec("CREATE TRIGGER synthetic_fail BEFORE INSERT ON evidence_outbox BEGIN SELECT RAISE(ABORT,'synthetic write failure'); END;");
  await handleDialogue(req(formalBody(),poem.lessonId),f.env,student,null,formalOptions(f,async()=>formalResult()));
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM learning_evaluations').get().n,0);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM dialogue_turns').get().n,1);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM learning_submission_records').get().n,1);
  assert.equal(f.sql.prepare('SELECT state FROM dialogue_calls').get().state,'review');assert.equal(f.sql.prepare('SELECT accounted_micros FROM dialogue_calls').get().accounted_micros,null);
 }finally{f.close();}
});
test('budget-blocked formal draft retains exact original fields and cannot become an ordinary dialogue by losing its metadata',async()=>{
 const f=fixture();delete f.env.YW_DIALOGUE_BUDGET_JSON;
 try{
  const r=await handleDialogue(req(formalBody(),poem.lessonId),f.env,student,null,formalOptions(f,()=>{throw Error('forbidden');}));assert.equal(r.status,503);
  const data=await(await handleDialogue(req(null,poem.lessonId),f.env,student)).json();assert.deepEqual(data.draft.formal.input,sourceInput.structure);
  f.env.YW_DIALOGUE_BUDGET_JSON=syntheticBudget;const {formal,...ordinary}=formalBody();
  const changed=await handleDialogue(req(ordinary,poem.lessonId),f.env,student,null,{callModel:()=>{throw Error('must not lose original fields');}});assert.equal(changed.status,409);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM learning_submission_records').get().n,0);
 }finally{f.close();}
});
test('formal request cannot invent objectives or claim source input different from visible dialogue',async()=>{
 const f=fixture();try{
  const b=formalBody();const options=formalOptions(f,()=>{throw Error('forbidden');});
  assert.equal((await handleDialogue(req(b),f.env,student,null,options)).status,400);
  assert.equal((await handleDialogue(req({...b,content:'other text'},poem.lessonId),f.env,student,null,options)).status,400);
  assert.equal((await handleDialogue(req({...b,formal:{...b.formal,input:{...b.formal.input,score:100}}},poem.lessonId),f.env,student,null,options)).status,400);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM dialogue_calls').get().n,0);
 }finally{f.close();}
});
test('formal assessment shares the global money cap with ordinary dialogue calls',async()=>{
 const f=fixture();f.env.YW_DIALOGUE_BUDGET_JSON=JSON.stringify({...JSON.parse(syntheticBudget),globalDailyMicros:1100});
 try{
  let calls=0;await handleDialogue(req(body()),f.env,student,null,{callModel:async()=>{calls++;throw Error('unknown');}});
  const response=await handleDialogue(req(formalBody(),poem.lessonId),f.env,student,null,formalOptions(f,()=>{calls++;throw Error('over budget');}));
  assert.equal(response.status,429);assert.equal(calls,1);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM learning_pending_submissions').get().n,0);
  const data=await(await handleDialogue(req(null,poem.lessonId),f.env,student)).json();assert.deepEqual(data.draft.formal.input,sourceInput.structure);
 }finally{f.close();}
});
test('simultaneous formal duplicates cannot duplicate source events or paid attempts',async()=>{
 const f=fixture();try{
  let calls=0;const options=formalOptions(f,async()=>{calls++;return formalResult();});
  const responses=await Promise.all(Array.from({length:6},()=>handleDialogue(req(formalBody(),poem.lessonId),f.env,student,null,options)));
  assert.equal(calls,1);assert(responses.every(r=>[200,409].includes(r.status)));
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM learning_interactions').get().n,1);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM evidence_outbox').get().n,1);
 }finally{f.close();}
});
test('stored formal version drift stops before source capture and paid evaluation',async()=>{
 const f=fixture(),fetchAsset=f.env.ASSETS.fetch;
 f.env.ASSETS.fetch=async request=>{
  const response=await fetchAsset(request);if(!new URL(request.url).pathname.includes('/dialogue-curriculum/'))return response;
  const c=await response.json();for(const o of c.objectives.filter(o=>o.domain==='legacy'))o.legacy.resourceVersion='different';return Response.json(c);
 };
 try{
  let calls=0;await handleDialogue(req(formalBody(),poem.lessonId),f.env,student,null,formalOptions(f,async()=>{calls++;return formalResult();}));
  assert.equal(calls,0);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM learning_pending_submissions').get().n,0);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM learning_evaluations').get().n,0);
 }finally{f.close();}
});
test('original scorer rejects incomplete or non-integer formal assessments without inventing a grade',async()=>{
 for(const value of [{...formalResult().value,score:60.5},{...formalResult().value,gap:''}]){
  const f=fixture();try{
   await handleDialogue(req(formalBody(),poem.lessonId),f.env,student,null,formalOptions(f,async()=>({...formalResult(),value})));
   assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM learning_evaluations').get().n,0);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM learning_submission_records').get().n,1);assert.equal(f.sql.prepare('SELECT state FROM dialogue_calls').get().state,'review');
  }finally{f.close();}
 }
});
