import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {handleDialogue} from '../site/dialogue-source.js';
const student={id:1,ucUserId:700001},lessonId='lesson-1717-p2';
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
const H='a'.repeat(64),owner=createHash('sha256').update('dialogue-owner:1').digest('hex');
const url=(q='')=>`https://yw.bdfz.net/api/dialogue/v1?lessonId=${lessonId}${q}`;
function seed(f){
 const session=(sid,studentId,lesson,updated,inflight=null)=>f.sql.prepare('INSERT INTO dialogue_sessions(id,student_id,lesson_id,curriculum_version,curriculum_json,policy_version,revision,inflight,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(sid,studentId,lesson,'v1','{}','synthetic-policy',3,inflight,'2026-10-19T00:00:00Z',updated);
 session('s1',1,'lesson-1498','2026-10-19T01:00:00Z');session('s2',1,'lesson-1578','2026-10-19T02:00:00Z');session('s3',1,'lesson-1458','2026-10-19T02:00:00Z');session('s4',1,'lesson-1711-p1','2026-10-19T04:00:00Z');session('x1',2,'lesson-1717-p2','2026-10-19T05:00:00Z');
 const turn=(id,sid,seq,role,status,at,extra={})=>f.sql.prepare("INSERT INTO dialogue_turns(id,session_id,mutation_id,request_hash,role,content,status,model,policy_version,reply_to,created_at,source_request_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run(id,sid,id,H,role,extra.content||('turn '+id),status,extra.model||null,'synthetic-policy',extra.replyTo||null,at,extra.formal?JSON.stringify(extra.formal):null);
 turn('t1','s1',1,'student','saved','2026-10-19T00:30:00Z');turn('t2','s1',2,'teacher','saved','2026-10-19T00:31:00Z',{model:'claude-sonnet-5-5',replyTo:'t1'});
 turn('t3','s1',3,'student','needs_review','2026-10-19T00:40:00Z');
 f.sql.prepare("INSERT INTO dialogue_stream_chunks(turn_id,sequence,content,created_at) VALUES('t3',1,'partial ','2026-10-19T00:40:01Z'),('t3',2,'reply','2026-10-19T00:40:02Z')").run();
 f.sql.prepare("INSERT INTO dialogue_drafts(id,session_id,mutation_id,request_hash,revision,content,created_at) VALUES('d1','s1','draft-mutation-0001',?,3,'未送出的文字','2026-10-19T00:50:00Z')").run(H);
 turn('x1t','x1',1,'student','saved','2026-10-19T04:30:00Z');
}
test('sessions=1 pages the account list newest first with a keyset cursor and a bounded page size',async()=>{
 const f=fixture();try{seed(f);
  assert.equal((await handleDialogue(new Request(url('&sessions=1')),f.env,null)).status,401);
  const p1=await(await handleDialogue(new Request(url('&sessions=1&limit=2')),f.env,student)).json();
  assert.equal(p1.ownerRef,owner);assert.equal(p1.scope,'own-sessions-only');assert.equal(p1.total,4);assert.equal(p1.pageSize,2);
  assert.deepEqual(p1.sessions.map(s=>s.lessonId),['lesson-1711-p1','lesson-1458']);assert.deepEqual(p1.older,{updatedAt:'2026-10-19T02:00:00Z',id:'s3'});
  const p2=await(await handleDialogue(new Request(url(`&sessions=1&limit=2&before=${p1.older.updatedAt}&beforeId=${p1.older.id}`)),f.env,student)).json();
  assert.deepEqual(p2.sessions.map(s=>s.lessonId),['lesson-1578','lesson-1498']);assert.equal(p2.older,null);
  for(const bad of ['&sessions=1&limit=0','&sessions=1&limit=101','&sessions=1&before=2026-10-19T02:00:00Z','&sessions=1&before=x&beforeId=s3'])assert.equal((await handleDialogue(new Request(url(bad)),f.env,student)).status,400,bad);
  const whole=await(await handleDialogue(new Request(url('&sessions=1')),f.env,student)).json();assert.equal(whole.sessions.length,4);assert.equal(whole.pageSize,100);
 }finally{f.close();}
});
test('exportAll=1 returns every own session in bounded pages with versions, speakers, timestamps, saved replies and labelled incomplete content, never another account',async()=>{
 const f=fixture();try{seed(f);
  assert.equal((await handleDialogue(new Request(url('&exportAll=1')),f.env,null)).status,401);
  assert.equal((await handleDialogue(new Request(url('&exportAll=1&limit=6')),f.env,student)).status,400);
  const pages=[];let cursor=null;
  for(let n=0;n<10;n++){const page=await(await handleDialogue(new Request(url(`&exportAll=1&limit=2${cursor?`&before=${cursor.updatedAt}&beforeId=${cursor.id}`:''}`)),f.env,student)).json();pages.push(page);cursor=page.older;if(!cursor)break;}
  assert.equal(pages.length,2);assert.equal(pages[0].ownerRef,owner);assert.equal(pages[0].total,4);assert.equal(pages[0].scope,'own-sessions-only');
  const sessions=pages.flatMap(p=>p.sessions);assert.deepEqual(sessions.map(s=>s.sessionId),['s4','s3','s2','s1']);assert.ok(!sessions.some(s=>s.sessionId==='x1'));
  const s1=sessions.find(s=>s.sessionId==='s1');
  assert.equal(s1.curriculumVersion,'v1');assert.equal(s1.policyVersion,'synthetic-policy');assert.equal(s1.revision,3);assert.equal(s1.complete,true);assert.equal(s1.turnCount,3);
  assert.deepEqual(s1.turns.map(t=>[t.sequence,t.speaker,t.confirmed,t.createdAt,t.model]),[[1,'student',true,'2026-10-19T00:30:00Z',null],[2,'author-simulation',true,'2026-10-19T00:31:00Z','claude-sonnet-5-5'],[3,'student',false,'2026-10-19T00:40:00Z',null]]);
  assert.equal(s1.turns[1].replyTo,'t1');assert.deepEqual(s1.turns[2].partialReply,{content:'partial reply',label:'incomplete_unconfirmed_stream'});assert.equal(s1.turns[0].partialReply,undefined);
  assert.deepEqual(s1.unsentDrafts.map(d=>[d.content,d.label]),[['未送出的文字','unsent_draft']]);
  assert.deepEqual(sessions.find(s=>s.sessionId==='s4').turns,[]);
 }finally{f.close();}
});
