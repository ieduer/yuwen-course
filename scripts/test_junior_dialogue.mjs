// 初中細讀對話 (/api/junior/dialogue): sign-in and budget like the senior dialogue, a separate 'junior:' session, and no
// learning evidence of any kind (no assessment, evaluation, outbox or interaction row), so My never receives it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {handleJuniorDialogue,juniorPrompt,JUNIOR_POLICY,JUNIOR_POLICY_VERSION} from '../site/junior-dialogue.js';
import {readDialogueEvents} from '../site/assets/dialogue-events.js';
import worker from '../site/_worker.js';

const ENTRY='junior-g7-shang-02';
const entry=JSON.parse(fs.readFileSync(`site/data/junior-reading/${ENTRY}.json`,'utf8'));
const student={id:1,ucUserId:700001};
const budget=JSON.stringify({version:'synthetic-only',validUntil:'2099-01-01T00:00:00Z',currency:'USD',model:'gemini-test',globalDailyMicros:1000000,userDailyMicros:100000,lessonLifetimeMicros:500000,reserveMicros:1100,inputMicrosPerMillion:10000,outputMicrosPerMillion:10000});
const EVIDENCE_TABLES=['dialogue_assessments','dialogue_questions','learning_interactions','learning_evaluations','learning_evaluation_events','evidence_outbox','learning_submission_records','learning_pending_submissions','vocab_attempts','submissions'];

function fixture(extra={}){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON;');
 for(const file of fs.readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())sql.exec(fs.readFileSync('migrations/'+file,'utf8'));
 sql.exec("INSERT INTO students(id,uc_slug,display_name) VALUES(1,'synthetic-one','Test'),(2,'synthetic-two','Test');");
 const wrap=(text,args=[])=>({bind:(...v)=>wrap(text,v),first:async()=>sql.prepare(text).get(...args)||null,all:async()=>({results:sql.prepare(text).all(...args)}),run:async()=>({meta:{changes:Number(sql.prepare(text).run(...args).changes)}}),runSync:()=>({meta:{changes:Number(sql.prepare(text).run(...args).changes)}})});
 const db={prepare:text=>wrap(text),batch:async statements=>{sql.exec('BEGIN');try{const r=statements.map(s=>s.runSync());sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 const env={YW_DIALOGUE_BUDGET_JSON:budget,READING_DB:db,YW_DIALOGUE_ENABLED:'true',ASSETS:{fetch:async request=>{const path='site'+new URL(request.url).pathname;return fs.existsSync(path)?new Response(fs.readFileSync(path)):new Response('',{status:404});}},...extra};
 return {sql,env,close:()=>sql.close()};
}
const owner=(id=1)=>createHash('sha256').update(`dialogue-owner:${id}`).digest('hex');
const req=(body,id=ENTRY,{stream=false,ownerId=1}={})=>new Request(`https://yw.bdfz.net/api/junior/dialogue?entryId=${id}`,body?{method:'POST',headers:{'content-type':'application/json',...(stream?{accept:'text/event-stream'}:{})},body:JSON.stringify({ownerRef:owner(ownerId),...body})}:{});
const turn=(revision=0,mutationId='junior-mutation-0001',content='为什么作者说春天像“刚落地的娃娃”？')=>({content,revision,mutationId});
const reply=async()=>({value:{reply:'“刚落地的娃娃”写出了春天的新：从头到脚都是新的。你读到哪一句时，觉得春天最“新”？'},model:'gemini-test',modelVersion:null,usage:{promptTokenCount:900,totalTokenCount:1000}});
const evidenceRows=sql=>Object.fromEntries(EVIDENCE_TABLES.map(t=>[t,sql.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n]));
const zero=Object.fromEntries(EVIDENCE_TABLES.map(t=>[t,0]));

test('signed out: the dialogue asks for My and saves nothing',async()=>{
 const f=fixture();try{
  const r=await handleJuniorDialogue(req(null),f.env,null);
  assert.equal(r.status,401);assert.equal((await r.json()).code,'authentication_required');
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM dialogue_sessions').get().n,0);
 }finally{f.close();}
});

test('a reply is saved under the junior track and writes no learning evidence',async()=>{
 const f=fixture();try{
  const empty=await(await handleJuniorDialogue(req(null),f.env,student)).json();
  assert.deepEqual([empty.track,empty.scoring,empty.revision,empty.turns.length],['junior','none',0,0]);
  let prompt;
  const r=await handleJuniorDialogue(req(turn()),f.env,student,null,{callModel:async(_e,p,_id,onReply)=>{prompt=p;await onReply('“刚落地');return reply();}});
  const data=await r.json();
  assert.equal(r.status,200);assert.equal(data.turns.length,2);assert.equal(data.turns[1].role,'teacher');assert.equal(data.revision,1);
  const session=f.sql.prepare('SELECT * FROM dialogue_sessions').get();
  assert.equal(session.lesson_id,'junior:'+ENTRY);assert.equal(session.policy_version,JUNIOR_POLICY_VERSION);assert.equal(JSON.parse(session.curriculum_json).scoring,'none');
  assert.equal(f.sql.prepare("SELECT state FROM dialogue_calls").get().state,'finished');
  assert.ok(Number.isSafeInteger(f.sql.prepare("SELECT accounted_micros FROM dialogue_calls").get().accounted_micros));
  assert.deepEqual(evidenceRows(f.sql),zero);
  assert.ok(prompt.startsWith(JUNIOR_POLICY));
  assert.ok(prompt.includes('盼望着，盼望着，东风来了，春天的脚步近了。'),'the textbook text reaches the model verbatim');
  assert.ok(prompt.includes('〔朗润〕明亮滋润'),'the textbook notes reach the model');
  assert.ok(prompt.includes('"persona":{"kind":"author","name":"朱自清"}'));
  assert.ok(!/分數|評分|計分/.test(prompt.split('以下是資料')[1]||''),'no scoring material is sent');
 }finally{f.close();}
});

test('streamed turn: saved, deltas and done; a repeated receipt is idempotent; a stale revision is refused',async()=>{
 const f=fixture();try{
  const events=[];
  const r=await handleJuniorDialogue(req(turn(),ENTRY,{stream:true}),f.env,student,{waitUntil:()=>{}},{callModel:async(_e,_p,_id,onReply)=>{await onReply('“刚落地的');await onReply('“刚落地的娃娃”');return reply();}});
  await readDialogueEvents(r,(event,data)=>events.push([event,data]));
  assert.deepEqual(events.map(e=>e[0]),['saved','delta','delta','done']);
  assert.equal(events.filter(e=>e[0]==='delta').map(e=>e[1].text).join(''),'“刚落地的娃娃”');
  const again=await handleJuniorDialogue(req(turn()),f.env,student,null,{callModel:async()=>{throw Error('must_not_call');}});
  assert.equal(again.status,200);assert.equal((await again.json()).turns.length,2);
  const stale=await handleJuniorDialogue(req(turn(0,'junior-mutation-0002','再问一次')),f.env,student,null,{callModel:reply});
  assert.equal(stale.status,409);
  assert.deepEqual(evidenceRows(f.sql),zero);
 }finally{f.close();}
});

test('a failed AI call keeps the words, releases the session and settles the budget',async()=>{
 const f=fixture();try{
  const events=[];
  const r=await handleJuniorDialogue(req(turn(),ENTRY,{stream:true}),f.env,student,{waitUntil:()=>{}},{callModel:async()=>{throw Error('gateway_unavailable');}});
  await readDialogueEvents(r,(event,data)=>events.push([event,data]));
  assert.deepEqual(events.map(e=>e[0]),['saved','unconfirmed']);
  assert.equal(events[1][1].code,'gateway_unavailable');
  assert.equal(f.sql.prepare("SELECT status FROM dialogue_turns").get().status,'needs_review');
  assert.equal(f.sql.prepare("SELECT inflight FROM dialogue_sessions").get().inflight,null);
  assert.equal(f.sql.prepare("SELECT state FROM dialogue_calls").get().state,'review');
  const data=await(await handleJuniorDialogue(req(null),f.env,student)).json();
  assert.equal(data.turns.length,1);assert.equal(data.turns[0].unanswered,true);
  const next=await handleJuniorDialogue(req(turn(1,'junior-mutation-0002','再说一次')),f.env,student,null,{callModel:reply});
  assert.equal(next.status,200);
 }finally{f.close();}
});

test('another account, an unknown entry and a changed account are refused',async()=>{
 const f=fixture();try{
  await handleJuniorDialogue(req(turn()),f.env,student,null,{callModel:reply});
  const other=await(await handleJuniorDialogue(req(null),f.env,{id:2,ucUserId:700002})).json();
  assert.equal(other.turns.length,0);
  assert.equal((await handleJuniorDialogue(req(null,'junior-g7-shang-99'),f.env,student)).status,404);
  assert.equal((await handleJuniorDialogue(req(null,'lesson-1458'),f.env,student)).status,404);
  assert.equal((await handleJuniorDialogue(req(turn(1,'junior-mutation-0003'),ENTRY,{ownerId:2}),f.env,student)).status,409);
 }finally{f.close();}
});

test('the shared budget refuses before any AI call and the text stays with the student',async()=>{
 const f=fixture({YW_DIALOGUE_BUDGET_JSON:JSON.stringify({...JSON.parse(budget),userDailyMicros:1500})});try{
  await handleJuniorDialogue(req(turn()),f.env,student,null,{callModel:async()=>({...await reply(),usage:{promptTokenCount:100000,totalTokenCount:100000}})});
  let called=false;
  const r=await handleJuniorDialogue(req(turn(1,'junior-mutation-0004','还有一个问题')),f.env,student,null,{callModel:async()=>{called=true;return reply();}});
  const data=await r.json();
  assert.equal(r.status,429);assert.equal(called,false);
  assert.ok(!data.message.includes('文字已保存'));
 }finally{f.close();}
});

test('the worker serves the route only with the dialogue feature and never without sign-in',async()=>{
 const f=fixture();try{
  const off=await worker.fetch(new Request(`https://yw.bdfz.net/api/junior/dialogue?entryId=${ENTRY}`),{...f.env,YW_DIALOGUE_ENABLED:'false'},{});
  assert.equal(off.status,404);
  const signedOut=await worker.fetch(new Request(`https://yw.bdfz.net/api/junior/dialogue?entryId=${ENTRY}`),f.env,{});
  assert.notEqual(signedOut.status,200);
 }finally{f.close();}
});

test('every junior entry builds a prompt inside the gateway admission bound',()=>{
 const dir='site/data/junior-reading';
 for(const file of fs.readdirSync(dir).filter(f=>/^junior-.*\.json$/.test(f))){
  const value=JSON.parse(fs.readFileSync(`${dir}/${file}`,'utf8'));
  const prompt=juniorPrompt(value,Array.from({length:12},(_,i)=>({role:i%2?'teacher':'student',content:'很长的对话'.repeat(80)})),'问'.repeat(1500));
  assert.ok(prompt.length<=30000,`${file}: ${prompt.length}`);
 }
});
