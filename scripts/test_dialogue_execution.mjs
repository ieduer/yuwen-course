import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {handleDialogue} from '../site/dialogue-source.js';
const curriculum=JSON.parse(fs.readFileSync('site/dialogue-curriculum/lesson-1717-p2.json'));
const student={id:1,ucUserId:700001},lessonId=curriculum.lessonId,OLD='yw-dialogue-old-v0',H='a'.repeat(64);
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
// An older saved session under a previous curriculum version with one demonstrated dialogue objective (context).
function seedOld(f,{changeRule=false,studentId=1}={}){
 const old=structuredClone(curriculum);old.curriculumVersion=OLD;
 if(changeRule)old.objectives.find(o=>o.id===lessonId+':context').rule='（舊版規則）';
 f.sql.prepare('INSERT INTO dialogue_sessions(id,student_id,lesson_id,curriculum_version,curriculum_json,policy_version,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run('s-old',studentId,lessonId,OLD,JSON.stringify(old),'synthetic-policy',5,'2026-10-01T00:00:00Z','2026-10-01T01:00:00Z');
 f.sql.prepare("INSERT INTO dialogue_turns(id,session_id,mutation_id,request_hash,role,content,status,policy_version,created_at) VALUES('t-old-1','s-old','m-old-1',?,'student','初讀感受','saved','synthetic-policy','2026-10-01T00:10:00Z')").run(H);
 f.sql.prepare("INSERT INTO dialogue_assessments(id,session_id,turn_id,objective_id,outcome,evidence_json,rationale,rule_version,curriculum_version,created_at) VALUES('a-old-1','s-old','t-old-1',?,'demonstrated',?,'說出了初讀印象','rules-v1',?,'2026-10-01T00:11:00Z')").run(lessonId+':context',JSON.stringify([{turnId:'t-old-1',quote:'初讀感受',passageId:curriculum.passages[1].id,passageQuote:'这几天心里颇不宁静'}]),OLD);
}
const req=(q='',body=null)=>new Request(`https://yw.bdfz.net/api/dialogue/v1?lessonId=${lessonId}${q}`,body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ownerRef:createHash('sha256').update('dialogue-owner:1').digest('hex'),...body})}:{});
const body=(revision=0,mutationId='synthetic-mutation-0001')=>({content:'我注意到「不寧靜」與寧靜景物的對照，仍不確定結尾是否真的解脫。',revision,mutationId});
const good=async()=>({value:{reply:'我在景物描寫中留下了情緒的轉折。你能指出一處聲音，說說它如何改變寧靜嗎？',assessments:[]},model:'synthetic-model',modelVersion:null});
const EX='hw:2026-10-20:assignment-1';
test('without execution the latest saved session resumes as before',async()=>{
 const f=fixture();try{seedOld(f);
  const data=await(await handleDialogue(req(),f.env,student)).json();
  assert.equal(data.sessionId,'s-old');assert.equal(data.curriculumVersion,OLD);assert.equal(data.execution,null);
 }finally{f.close();}
});
test('execution preview: no session under the published curriculum yet, carry-forward previewed, nothing written',async()=>{
 const f=fixture();try{seedOld(f);
  const data=await(await handleDialogue(req('&execution='+EX),f.env,student)).json();
  assert.equal(data.saved,false);assert.equal(data.execution.executionId,EX);assert.equal(data.execution.requiredCurriculumVersion,curriculum.curriculumVersion);
  assert.equal(data.execution.satisfied,false);assert.equal(data.execution.created,false);
  assert.deepEqual(data.execution.carriedForward.map(c=>[c.objectiveId,c.fromSession,c.fromCurriculumVersion]),[[lessonId+':context','s-old',OLD]]);
  assert.ok(!data.execution.missing.includes(lessonId+':context'));assert.ok(data.execution.missing.includes(lessonId+':structure'));
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM dialogue_sessions').get().n,1);assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM dialogue_events WHERE event_type='execution_started'").get().n,0);
  assert.equal((await handleDialogue(req('&execution=bad'),f.env,student)).status,400);
  assert.equal((await handleDialogue(req('&execution='+EX),f.env,null)).status,401);
 }finally{f.close();}
});
test('execution start creates a session under the published curriculum, binds once, carries results forward and leaves the old session untouched',async()=>{
 const f=fixture();try{seedOld(f);
  const before=f.sql.prepare("SELECT revision,updated_at,(SELECT COUNT(*) FROM dialogue_turns WHERE session_id='s-old') AS turns FROM dialogue_sessions WHERE id='s-old'").get();
  const posted=await handleDialogue(req('&execution='+EX,body()),f.env,student,null,{callModel:good});assert.equal(posted.status,200);
  const sessions=f.sql.prepare('SELECT id,curriculum_version FROM dialogue_sessions ORDER BY created_at').all();assert.equal(sessions.length,2);
  const fresh=sessions.find(s=>s.id!=='s-old');assert.equal(fresh.curriculum_version,curriculum.curriculumVersion);
  const data=await(await handleDialogue(req('&execution='+EX),f.env,student)).json();
  assert.equal(data.sessionId,fresh.id);assert.equal(data.execution.executionId,EX);assert.equal(data.execution.satisfied,true);
  assert.deepEqual(data.execution.carriedForward.map(c=>c.objectiveId),[lessonId+':context']);
  const ctx=data.state.objectives.find(o=>o.id===lessonId+':context');assert.equal(ctx.status,'demonstrated');
  const carried=data.assessments.find(a=>a.objectiveId===lessonId+':context');assert.deepEqual(carried.carriedFrom,{sessionId:'s-old',curriculumVersion:OLD,turnId:'t-old-1'});
  assert.ok(!data.execution.missing.includes(lessonId+':context'));assert.ok(data.execution.missing.includes(lessonId+':revision'));
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM dialogue_events WHERE event_type='execution_started'").get().n,1);
  await handleDialogue(req('&execution='+EX),f.env,student);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM dialogue_events WHERE event_type='execution_started'").get().n,1,'binding is idempotent');
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM dialogue_assessments WHERE session_id=?').get(fresh.id).n,0,'no assessment rows copied');
  const after=f.sql.prepare("SELECT revision,updated_at,(SELECT COUNT(*) FROM dialogue_turns WHERE session_id='s-old') AS turns FROM dialogue_sessions WHERE id='s-old'").get();assert.deepEqual(after,before);
  const legacy=await(await handleDialogue(req(),f.env,student)).json();assert.equal(legacy.sessionId,fresh.id,'the newest session is now the published one');
  const exp=await(await handleDialogue(req('&exportAll=1'),f.env,student)).json();
  const es=exp.sessions.find(s=>s.sessionId===fresh.id);assert.equal(es.executions.length,1);assert.equal(es.executions[0].executionId,EX);assert.equal(exp.sessions.find(s=>s.sessionId==='s-old').executions.length,0);
 }finally{f.close();}
});
test('a second execution reuses the session already under the published curriculum; a changed objective definition is not carried',async()=>{
 const f=fixture();try{seedOld(f,{changeRule:true});
  await handleDialogue(req('&execution='+EX,body()),f.env,student,null,{callModel:good});
  const current=f.sql.prepare('SELECT id FROM dialogue_sessions WHERE curriculum_version=?').get(curriculum.curriculumVersion);assert.ok(current);
  const data=await(await handleDialogue(req('&execution=hw:2026-10-21:assignment-2'),f.env,student)).json();
  assert.equal(data.sessionId,current.id);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM dialogue_sessions').get().n,2,'no third session');
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM dialogue_events WHERE event_type='execution_started'").get().n,2,'each execution binds once');
  assert.equal(data.execution.executionId,'hw:2026-10-21:assignment-2');
  assert.deepEqual(data.execution.carriedForward,[],'rule text differs in the old curriculum');assert.ok(data.execution.missing.includes(lessonId+':context'));
 }finally{f.close();}
});
test('another account\'s sessions never feed the carry-forward',async()=>{
 const f=fixture();try{seedOld(f,{studentId:2});
  const data=await(await handleDialogue(req('&execution='+EX),f.env,student)).json();
  assert.deepEqual(data.execution.carriedForward,[]);assert.deepEqual(data.execution.priorSessions,[]);
 }finally{f.close();}
});
