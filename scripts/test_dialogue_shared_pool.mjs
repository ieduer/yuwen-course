// Shared-budget pacing (yw-shared-pool-v1): arithmetic, policy validation and the atomic admission in handleDialogue.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {handleDialogue} from '../site/dialogue-source.js';
import {dialogueBudget} from '../site/dialogue-budget.js';
import {pacedAllowance,allowanceReachedAt,poolPhase,validSharedPool} from '../site/dialogue-pacing.js';
const curriculum=JSON.parse(fs.readFileSync('site/dialogue-curriculum/lesson-1717-p2.json'));
const student={id:1,ucUserId:700001},other={id:2,ucUserId:700002};
const iso=ms=>new Date(ms).toISOString(),NOW=Date.now();
const pool=(over={})=>({version:'yw-shared-pool-v1',poolId:'synthetic-pool',startsAt:iso(NOW-86400000),endsAt:iso(NOW+30*86400000),ceilingMicros:1000000,burstMicros:500000,releaseFraction:0.15,concurrency:12,ratePerWindow:20,rateWindowSeconds:600,verifiedAt:iso(NOW),evidenceRef:'synthetic',...over});
const policy=(over={},poolOver={})=>JSON.stringify({version:'synthetic-shared',validUntil:'2099-01-01T00:00:00Z',currency:'USD',model:'gemini-test',reserveMicros:1100,inputMicrosPerMillion:10000,outputMicrosPerMillion:10000,sharedPool:pool(poolOver),...over});
function fixture(budget=policy()){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON;');
 for(const file of fs.readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())sql.exec(fs.readFileSync('migrations/'+file,'utf8'));
 sql.exec("INSERT INTO students(id,uc_slug,display_name) VALUES(1,'synthetic-one','Test'),(2,'synthetic-two','Test');");
 const wrap=(text,args=[])=>({bind:(...v)=>wrap(text,v),first:async()=>sql.prepare(text).get(...args)||null,all:async()=>({results:sql.prepare(text).all(...args)}),run:async()=>({meta:{changes:Number(sql.prepare(text).run(...args).changes)}}),runSync:()=>({meta:{changes:Number(sql.prepare(text).run(...args).changes)}})});
 const db={prepare:text=>wrap(text),batch:async statements=>{sql.exec('BEGIN');try{const r=statements.map(s=>s.runSync());sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 const env={YW_DIALOGUE_BUDGET_JSON:budget,READING_DB:db,YW_DIALOGUE_ENABLED:'true',ASSETS:{fetch:async request=>new Response(fs.readFileSync('site'+new URL(request.url).pathname))}};
 return {sql,db,env,close:()=>sql.close()};
}
const req=(body,owner=1,id=curriculum.lessonId)=>new Request(`https://yw.bdfz.net/api/dialogue/v1?lessonId=${id}`,body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ownerRef:createHash('sha256').update(`dialogue-owner:${owner}`).digest('hex'),...body})}:{});
const body=(revision=0,mutationId='synthetic-shared-0001',content='我注意到「不寧靜」與寧靜景物的對照，仍不確定結尾是否真的解脫。')=>({content,revision,mutationId});
const options={callModel:async()=>({value:{reply:'我在景物描寫中留下了情緒的轉折。你能指出一處聲音嗎？',assessments:[]},model:'synthetic-model',modelVersion:null})};
const send=async(f,b,who=student)=>{const r=await handleDialogue(req(b,who.id),f.env,who,null,options);return {status:r.status,value:await r.json()};};
const used=f=>f.sql.prepare('SELECT COALESCE(SUM(COALESCE(accounted_micros,reserved_micros)),0) n FROM dialogue_calls').get().n;

test('the pace line carries unused allowance forward, lets learning burst ahead, opens the whole ceiling in the release window, and is zero outside the period',()=>{
 const p=validSharedPool({...pool(),startsAt:'2026-11-01T00:00:00Z',endsAt:'2026-11-11T00:00:00Z',ceilingMicros:1000000,burstMicros:100000,releaseFraction:0.2});
 assert.equal(poolPhase(p,'2026-10-31T23:59:59Z'),'before');assert.equal(pacedAllowance(p,'2026-10-31T23:59:59Z'),0);
 assert.equal(pacedAllowance(p,'2026-11-01T00:00:00Z'),100000,'the burst is available at once');assert.equal(pacedAllowance(p,'2026-11-01T00:00:00Z',{burst:false}),0,'tests get the line only');
 assert.equal(pacedAllowance(p,'2026-11-05T00:00:00Z',{burst:false}),500000,'half way to the release point (day 8) = half the ceiling: unused days accumulate');
 assert.equal(pacedAllowance(p,'2026-11-05T00:00:00Z'),600000);
 assert.equal(pacedAllowance(p,'2026-11-09T00:00:00Z'),1000000,'release window (last 20%): the whole ceiling');
 assert.equal(poolPhase(p,'2026-11-11T00:00:00Z'),'ended');assert.equal(pacedAllowance(p,'2026-11-11T00:00:00Z'),0);
 assert.equal(allowanceReachedAt(p,600000,'2026-11-02T00:00:00Z'),'2026-11-05T00:00:00.000Z');assert.equal(allowanceReachedAt(p,50000,'2026-11-02T00:00:00Z'),'2026-11-02T00:00:00.000Z');
 assert.equal(allowanceReachedAt(p,1000001,'2026-11-02T00:00:00Z'),null,'above the ceiling: never');
});

test('a shared-pool policy may not declare the old daily or lesson caps; its reserve must fit the ceiling; malformed pools are refused',()=>{
 const ok=dialogueBudget({YW_DIALOGUE_BUDGET_JSON:policy()});assert.equal(ok.sharedPool.poolId,'synthetic-pool');assert.equal(ok.userDailyMicros,undefined);
 for(const key of ['globalDailyMicros','userDailyMicros','lessonLifetimeMicros'])assert.throws(()=>dialogueBudget({YW_DIALOGUE_BUDGET_JSON:policy({[key]:2000000})}),/invalid_budget_policy/);
 assert.throws(()=>dialogueBudget({YW_DIALOGUE_BUDGET_JSON:policy({},{ceilingMicros:1000,burstMicros:0})}),/invalid_budget_reserve/);
 for(const bad of [{version:'x'},{endsAt:iso(NOW-2*86400000)},{releaseFraction:1},{concurrency:0},{rateWindowSeconds:5},{evidenceRef:''},{burstMicros:2000000}])assert.throws(()=>dialogueBudget({YW_DIALOGUE_BUDGET_JSON:policy({},bad)}),/invalid_shared_pool/);
});

test('ordinary learning is not capped per day: 45 turns in one day by one student are admitted while the shared pool has room',async()=>{const f=fixture(policy({}, {ratePerWindow:100}));try{
 for(let i=0;i<45;i++)assert.equal((await send(f,body(i,`synthetic-day-${String(i).padStart(3,'0')}`))).status,200,`turn ${i}`);
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM dialogue_calls').get().n,45);
}finally{f.close();}});

test('concurrent admissions near the ceiling: exactly the requests that fit are admitted; the rest are refused as exhausted with nothing reserved',async()=>{const f=fixture(policy({},{ceilingMicros:3000,burstMicros:3000}));try{
 const results=await Promise.all([send(f,body(0,'synthetic-a-0001')),send(f,body(0,'synthetic-b-0001'),other),send(f,body(1,'synthetic-a-0002'))]);
 const admitted=results.filter(r=>r.status===200).length,refused=results.filter(r=>r.status===429);
 assert.ok(admitted===2,'two reservations of 1100 fit under 3000; a third would be 3300');assert.ok(used(f)<=3000,'never above the ceiling');
 for(const r of refused){assert.equal(r.value.code,'shared_budget_exhausted');assert.equal(r.value.scope,'exhausted');assert.equal(r.value.retryable,false);assert.match(r.value.message,/共用 AI 額度已用完/);}
}finally{f.close();}});

test('an UNKNOWN reservation (review state, no settled cost) keeps counting; it is never treated as zero',async()=>{const f=fixture(policy({},{ceilingMicros:2500,burstMicros:2500}));try{
 assert.equal((await send(f,body(0,'synthetic-u-0001'))).status,200);
 f.sql.exec("UPDATE dialogue_calls SET state='review',accounted_micros=NULL");
 assert.equal(used(f),1100);
 assert.equal((await send(f,body(1,'synthetic-u-0002'))).status,200,'2200 fits');
 const third=await send(f,body(2,'synthetic-u-0003'));assert.equal(third.status,429);assert.equal(third.value.code,'shared_budget_exhausted');
}finally{f.close();}});

test('a settled call counts its accounted cost once, whatever its provider attempts; the reservation is not added again',async()=>{const f=fixture(policy({},{ceilingMicros:5000,burstMicros:5000}));try{
 assert.equal((await send(f,body(0,'synthetic-r-0001'))).status,200);
 f.sql.exec('UPDATE dialogue_calls SET accounted_micros=300');
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM dialogue_calls').get().n,1,'one row per learner turn');assert.equal(used(f),300);
 for(let i=1;i<=4;i++)assert.equal((await send(f,body(i,`synthetic-r-000${i+1}`))).status,200,'300 + 4 x 1100 = 4700 fits');
}finally{f.close();}});

test('paced: early in the period beyond the burst the turn waits for the line, with a real retry time; tests get no burst',async()=>{const f=fixture(policy({},{startsAt:iso(NOW-1000),endsAt:iso(NOW+10*86400000),ceilingMicros:1000000,burstMicros:1500}));try{
 assert.equal((await send(f,body(0,'synthetic-p-0001'))).status,200,'within the burst');
 const second=await send(f,body(1,'synthetic-p-0002'));assert.equal(second.status,429);assert.equal(second.value.code,'shared_budget_paced');assert.equal(second.value.scope,'paced');assert.equal(second.value.retryable,true);
 assert.ok(Date.parse(second.value.retryAt)>Date.now()&&Date.parse(second.value.retryAt)<NOW+10*86400000);assert.equal(second.value.resetsAt,second.value.retryAt);assert.match(second.value.message,/共用 AI 額度此刻較緊/);
 assert.equal(second.value.draftSaved,true);
}finally{f.close();}});

test('period boundaries: before the start the turn waits for the start; after the end (or after validUntil) it is a clear expired period',async()=>{
 let f=fixture(policy({},{startsAt:iso(NOW+3600000),endsAt:iso(NOW+86400000)}));try{const r=await send(f,body());assert.equal(r.status,429);assert.equal(r.value.code,'shared_budget_not_started');assert.equal(r.value.retryAt,iso(NOW+3600000).replace(/\.\d{3}Z$/,m=>m));}finally{f.close();}
 f=fixture(policy({},{startsAt:iso(NOW-2*86400000),endsAt:iso(NOW-1000)}));try{const r=await send(f,body());assert.equal(r.status,429);assert.equal(r.value.code,'shared_budget_period_ended');assert.equal(r.value.retryable,false);assert.match(r.value.message,/已到期/);}finally{f.close();}
 f=fixture(policy({validUntil:iso(NOW-1000)},{startsAt:iso(NOW-2*86400000),endsAt:iso(NOW-1000)}));try{const r=await send(f,body());assert.equal(r.status,429);assert.equal(r.value.code,'shared_budget_period_ended');assert.equal(r.value.draftSaved,true);}finally{f.close();}
});

test('short-term rate protection stops runaway automation without a daily cap, with the time it frees up',async()=>{const f=fixture(policy({},{ratePerWindow:3,rateWindowSeconds:600}));try{
 for(let i=0;i<3;i++)assert.equal((await send(f,body(i,`synthetic-q-000${i}`))).status,200);
 const r=await send(f,body(3,'synthetic-q-0003'));assert.equal(r.status,429);assert.equal(r.value.code,'dialogue_rate_limited');assert.equal(r.value.scope,'rate');assert.ok(Date.parse(r.value.retryAt)>Date.now());
 f.sql.exec(`UPDATE dialogue_calls SET created_at='${iso(NOW-700000)}'`);assert.equal((await send(f,body(3,'synthetic-q-0003'))).status,200,'after the window the same receipt goes through');
}finally{f.close();}});

test('after a refused turn, edited text is refused for the same reason with the text kept on the device; the earlier unsent draft is untouched',async()=>{const f=fixture(policy({},{ceilingMicros:2000,burstMicros:2000}));try{
 assert.equal((await send(f,body(0,'synthetic-d-0000'))).status,200,'1100 of 2000 used');
 const first=await send(f,body(1,'synthetic-d-0001','第一段未送出的文字。'));assert.equal(first.status,429);assert.equal(first.value.draftSaved,true);
 const edited=await send(f,body(1,'synthetic-d-0002','改過的第二段文字。'));assert.equal(edited.status,429,'not the draft_conflict 409');assert.equal(edited.value.code,'shared_budget_exhausted');assert.equal(edited.value.draftSaved,false);assert.equal(edited.value.deviceOnly,true);assert.match(edited.value.message,/保存在此裝置/);
 assert.deepEqual(f.sql.prepare('SELECT mutation_id,content FROM dialogue_drafts').all().map(r=>[r.mutation_id,r.content]),[['synthetic-d-0001','第一段未送出的文字。']]);
 const read=await(await handleDialogue(req(),f.env,student)).json();assert.equal(read.draft.content,'第一段未送出的文字。');
 const same=await send(f,body(1,'synthetic-d-0001','另一段內容。'));assert.equal(same.status,409,'the same receipt id with different content is still a real conflict');
}finally{f.close();}});

test('an unsent draft of an older revision is kept in the record but never offered again once a later turn exists',async()=>{const f=fixture(policy({},{ceilingMicros:2000,burstMicros:2000}));try{
 assert.equal((await send(f,body(0,'synthetic-g-0000'))).status,200);
 const denied=await send(f,body(1,'synthetic-g-0001','被擋下的那段話。'));assert.equal(denied.status,429);assert.equal(denied.value.draftSaved,true);
 assert.equal((await(await handleDialogue(req(),f.env,student)).json()).draft.content,'被擋下的那段話。','offered while it is the current revision');
 f.env.YW_DIALOGUE_BUDGET_JSON=policy({},{ceilingMicros:1000000,burstMicros:1000000});
 assert.equal((await send(f,body(1,'synthetic-g-0002','後來送出的另一段話。'))).status,200);
 const read=await(await handleDialogue(req(),f.env,student)).json();assert.equal(read.draft,null,'the older draft is not put back into the composer');assert.equal(read.revision,2);
 assert.deepEqual(f.sql.prepare('SELECT mutation_id,revision,submitted_turn_id FROM dialogue_drafts').all().map(r=>[r.mutation_id,r.revision,r.submitted_turn_id]),[['synthetic-g-0001',1,null]],'the draft row is preserved, not deleted or marked submitted');
}finally{f.close();}});
