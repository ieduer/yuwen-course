import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {validateProposal,projectState,contextFor,createQuestion,LIMITS} from '../site/dialogue-policy.js';
import {handleDialogue,reconcileAbandonedCalls,callDialogueModel} from '../site/dialogue-source.js';
import {replyPrefix,consumeGatewayStream} from '../site/dialogue-stream.js';
import {readDialogueEvents} from '../site/assets/dialogue-events.js';
import {dialogueBudget,reconciledCost} from '../site/dialogue-budget.js';
const curriculum=JSON.parse(fs.readFileSync('site/dialogue-curriculum/lesson-1717-p2.json'));
const classical=JSON.parse(fs.readFileSync('site/dialogue-curriculum/lesson-1711-p1.json'));
const student={id:1,ucUserId:700001};
const syntheticBudget=JSON.stringify({version:'synthetic-only',validUntil:'2099-01-01T00:00:00Z',currency:'USD',model:'gemini-test',globalDailyMicros:1000000,userDailyMicros:100000,lessonLifetimeMicros:500000,reserveMicros:1100,inputMicrosPerMillion:10000,outputMicrosPerMillion:10000});
function fixture(){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON;');
 for(const file of fs.readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())sql.exec(fs.readFileSync('migrations/'+file,'utf8'));
 sql.exec("INSERT INTO students(id,uc_slug,display_name) VALUES(1,'synthetic-one','Test'),(2,'synthetic-two','Test');");
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
  f.sql.prepare("INSERT INTO learning_interactions(source_event_id,student_id,academic_year,lesson_id,interaction_key,event_type,assessment_kind,scoring_role,resource_key,resource_version,registry_version,occurred_at) VALUES('old-accepted',1,'2026-2027',?,'revision','revisionCompleted','ai_evaluation','a_plus_gate',?,?,'old-registry','2020-01-01')").run(c.lessonId,o.legacy.resourceKey,o.legacy.resourceVersion);
  f.sql.exec("INSERT INTO learning_evaluations(source_event_id,verification_method,eligibility_status,raw_value,max_value,normalized_value,correctness,evaluated_at) VALUES('old-accepted','source_ai_evaluation','eligible',83,100,83,'correct','2020-01-01')");
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
  INSERT INTO learning_evaluations(source_event_id,verification_method,eligibility_status,raw_value,max_value,normalized_value,correctness,evaluation_json,evaluated_at) VALUES('original-source-event','source_ai_evaluation','eligible',83,100,83,'correct','{"ruleVersion":"original-rule","rationale":"original feedback"}','2026-09-01T00:00:01Z');
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
test('refresh retains the exact outstanding question and criteria are absent from public question',async()=>{const f=fixture();try{const b={action:'question',objectiveId:classical.vocabulary[0].id};const one=await (await handleDialogue(req(b,classical.lessonId),f.env,student)).json();const two=await (await handleDialogue(req(b,classical.lessonId),f.env,student)).json();assert.equal(one.question.id,two.question.id);assert.equal(one.question.criteria,undefined);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM dialogue_questions').get().n,1);}finally{f.close();}});
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
test('failed vocabulary requires confirmed student reformulation before another variant',async()=>{const f=fixture();try{
 const qBody={action:'question',objectiveId:classical.vocabulary[0].id};const first=await (await handleDialogue(req(qBody,classical.lessonId),f.env,student)).json();
 await handleDialogue(req({...body(),questionId:first.question.id},classical.lessonId),f.env,student,null,{callModel:good});
 const blocked=await handleDialogue(req(qBody,classical.lessonId),f.env,student);assert.equal(blocked.status,409);assert.equal((await blocked.json()).code,'reformulation_required');
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM dialogue_questions').get().n,1);
}finally{f.close();}});
test('bounded context keeps recent evidence without resending long histories',()=>{const turns=Array.from({length:200},(_,i)=>({id:`turn-${i}`,role:i%2?'teacher':'student',content:'測'.repeat(2500)}));const prompt=contextFor({curriculum,state:projectState(curriculum,[]),turns,question:null});assert(prompt.length<LIMITS.contextChars+2000);assert(!prompt.includes('"turn-0"'));assert(prompt.includes('turn-199'));});
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
test('owner export contains the evidence index, questions and events without granting teacher access',async()=>{const f=fixture();try{
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
