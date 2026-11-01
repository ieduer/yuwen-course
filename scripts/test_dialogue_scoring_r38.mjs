// r38 (owner-approved 2026-11-01, 「連補記一起做」 after the 10-31 analysis of real dialogues): what the server accepts as a
// plainly given self-rating or reading statement, a refused first-read part that no longer discards the reply, score
// questions the author can answer, script-folded attribution, and the exact owner-approved replay of retained evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {handleDialogue,unverifiedStudentQuotes} from '../site/dialogue-source.js';
import {handleDialogueFormal,handleDialogueOriginal,handleDialogueFirstRead} from '../site/_worker.js';
import {validateOriginalEvidence as original,validateReadingEvidence as reading,explicitRating} from '../site/dialogue-reading-evidence.js';
import {scoreAsked,POLICY,POLICY_VERSION} from '../site/dialogue-policy.js';
import {APPROVED_RETAINED_REPLAYS,replayApprovedRetained} from '../site/dialogue-retained-replay.js';
import {prepareOriginalInput} from '../site/dialogue-formal.js';
import {foldScript,SCRIPT_FOLD_PAIRS} from '../site/dialogue-script-fold.js';

let student={id:1,ucUserId:700001},ownerRef=createHash('sha256').update('dialogue-owner:1').digest('hex');
const budget=JSON.stringify({version:'synthetic',validUntil:'2099-01-01T00:00:00Z',currency:'USD',model:'gemini-test',globalDailyMicros:1000000,userDailyMicros:100000,lessonLifetimeMicros:500000,reserveMicros:1100,inputMicrosPerMillion:10000,outputMicrosPerMillion:10000});

const one=content=>[{id:'s1',role:'student',content}];
const rate=(content,quote)=>original({objectiveId:'e',evidence:{turnId:'s1',quote}},{turns:one(content),task:{kind:'evaluation',objectiveId:'e'}}).input.rating;
const readOk=(content,quote)=>original({objectiveId:'r',evidence:{turnId:'s1',quote}},{turns:one(content),task:{kind:'read',objectiveId:'r'}}).input.acknowledgement;

test('a plainly given self-rating is recorded in the forms students actually used (10-24..26)',()=>{
 for(const [content,quote,value] of [
  ['如果只用一個數字，我給 76／100。\n\n這個分數不是說它「好」或「不好」。所以 76：有分量。','我給 76／100',76],
  ['我给 78 分。\n\n说“喜欢”不准确。这一点，值得 78 分。','我给 78 分。',78],
  ['评分：85分\n\n理由： 这篇文章对我“有意思”的分数我给 85分。扣掉的15分是因为时代语境。','评分：85分',85],
  ['评分：80分\n理由：扣掉的20分，是因为距离感。','评分：80分',80],
  ['评分：90/100。\n\n理由：亲历者的回忆。扣分点在于节奏略平。','评分：90/100。',90],
  ['60吧','60吧',60],['78','78',78],['我给85分','我给85分',85],['这篇我打100分','这篇我打100分',100],
  ['經過這一輪細讀，我會把分數從先前的 76 調到 82／100。','我會把分數從先前的 76 調到 82／100',82],
  ['读了10分钟，我给 70 分','我给 70 分',70],['這篇我覺得有 85 分，因為結尾很安靜。','這篇我覺得有 85 分',85],
 ])assert.equal(rate(content,quote),value,content);
});
test('hedged, negated, conflicting or reason-only numbers are still not a self-rating',()=>{
 for(const [content,quote] of [
  ['还是 78，不动','还是 78'],['如果给 90 分就好了','如果给 90 分就好了'],['我不给 60 分','我不给 60 分'],['可能 70 分吧','可能 70 分吧'],
  ['我给 70 分，又觉得该给 90 分','我给 70 分'],['扣掉的15分是因为时代语境','扣掉的15分'],['十分喜欢这篇','十分喜欢这篇'],['不是85分','不是85分'],
  ['我给 78 分','我给 80 分'],
 ])assert.throws(()=>rate(content,quote),/rating_not_explicit|original_evidence_not_student_quote/,content);
 assert.equal(explicitRating('我给 78 分。','我给'),null);
});
test('「通讀完了」 and a statement followed by an invitation to go on are reading statements; negation, question and hypothesis are not',()=>{
 for(const [content,quote] of [['我已经通读完了你可以提问了','我已经通读完了'],['我已经通读完了','我已经通读完了'],['看完了，开始吧','看完了'],['老师，我读完了','我读完了'],['读完了','读完了']])
  assert.equal(readOk(content,quote),'已讀完',content);
 for(const [content,quote] of [['我还没读完','读完'],['我读完了吗','我读完了'],['等我读完了再说','我读完了'],['如果我读完了，你再提问','我读完了'],['我没有通读完','通读完'],['读完了？','读完了'],['读完了但没看懂','读完了'],['我已经通读完了吗你可以提问了','我已经通读完了'],['好的，我读完了','我读完了'],['第一段，我已经读完了','我已经读完了'],['读完了，不过只读了第一段','读完了']])
  assert.throws(()=>readOk(content,quote),/reading_acknowledgement_not_verified|original_evidence_not_student_quote/,content);
});
test('an original first-read impression before three marked doubts is refused as a part, before the source is asked',()=>{
 const asset={textVersionId:'v1',textDigest:'d',paragraphs:[{key:'p1',text:'學而時習之不亦說乎'}]};
 const ctx=marks=>({turns:one('抛开注释，读完整篇，我觉得它像一个严厉的班主任。'),asset,state:{submitted:false,marks},lessonId:'l',turnId:'s1'});
 const p={operation:'submit',evidence:{turnId:'s1',quote:'抛开注释，读完整篇，我觉得它像一个严厉的班主任。'}};
 assert.throws(()=>reading(p,ctx([{guess:'一'},{guess:'二'}])),/reading_summary_marks_required/);
 assert.throws(()=>reading(p,ctx([{guess:'一'},{guess:'二'},{guess:' '}])),/reading_summary_marks_required/);
 assert.equal(reading(p,ctx([{guess:'一'},{guess:'二'},{guess:'三'}])).operation,'submit');
 assert.equal(reading(p,{...ctx([]),asset:{...asset,kind:'conversation-reading'}}).operation,'submit','poems and modern prose keep no count threshold');
});
test('the score questions students asked (10-21..27) reach the score; 十分, 部分, 分析 and a self-rating do not',()=>{
 const asked=c=>scoreAsked([{role:'student',content:c}]);
 for(const q of ['我怎麼滿分','我需要怎么拿到满分','我怎么能得分','我怎么得这一分','我都回答了，为什么不给分','我必须一直回答你的问题才能得分？','怎么拿到分呢','你不管分吗','怎么问你能得到一百分','我怎么才能得到分数','不是 是本课0/100分 我的份呢给我加上','啥时候能给我最后13分','我回答这些问题可以拿到分吗','我的观点评价为什么没有分','那么我问的问题不好吗？为什么不给我加分呢','但是目前没有高考考这个，我怎么拿到这个分'])assert.equal(asked(q),true,q);
 for(const q of ['我十分喜欢这一段','为什么作者十分喜欢月亮','这一部分写得好','我想分析一下第二段','我给这篇打85分','我觉得可以分成三层','为什么要分开写'])assert.equal(asked(q),false,q);
});
test('policy v22 tells students the reading and self-rating points as they are',()=>{
 assert.equal(POLICY_VERSION,'yw-dialogue-policy-v22');
 assert.match(POLICY,/通讀與自評是完成就得的分數/);assert.doesNotMatch(POLICY,/通讀與自評是不評分的完成分/);
});
test('an author quotation in the other script is the student\'s own words; a real misquotation is still shown',()=>{
 assert.ok(SCRIPT_FOLD_PAIRS>2800);assert.equal(foldScript('或許江月也不知，個別句勢偏滿'),'或许江月也不知，个别句势偏满');
 const turns=[{role:'student',content:'当然是代代人的接续，或许江月也不知'},{role:'student',content:'无尽的，'}];
 assert.deepEqual(unverifiedStudentQuotes('你說「或許江月也不知」，又說「無盡的」。',turns),[]);
 assert.deepEqual(unverifiedStudentQuotes('你說「必須砸碎階級鴻溝」。',turns),['必須砸碎階級鴻溝']);
});
function fixture(t,lessonId='lesson-1498',filter=()=>true){
 const curriculum=JSON.parse(fs.readFileSync(`site/dialogue-curriculum/${lessonId}.json`));curriculum.objectives=curriculum.objectives.filter(filter);
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
 for(const f of fs.readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())sql.exec(fs.readFileSync('migrations/'+f,'utf8'));
 sql.exec("INSERT INTO students(id,uc_slug,display_name) VALUES(1,'synthetic-guided','Synthetic')");t.after(()=>sql.close());
 const wrap=(text,args=[])=>({bind:(...args)=>wrap(text,args),first:async()=>sql.prepare(text).get(...args)||null,all:async()=>({results:sql.prepare(text).all(...args)}),run:async()=>({meta:{changes:Number(sql.prepare(text).run(...args).changes)}}),runSync:()=>({meta:{changes:Number(sql.prepare(text).run(...args).changes)}})});
 const db={prepare:text=>wrap(text),batch:async statements=>{sql.exec('BEGIN');try{const r=statements.map(s=>s.runSync());sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 const env={READING_DB:db,YW_DIALOGUE_ENABLED:'true',YW_DIALOGUE_BUDGET_JSON:budget,ASSETS:{fetch:async request=>{const path=new URL(request.url).pathname;return new Response(path===`/dialogue-curriculum/${lessonId}.json`?JSON.stringify(curriculum):fs.readFileSync('site'+path));}}};
 const req=body=>new Request(`https://yw.bdfz.net/api/dialogue/v1?lessonId=${lessonId}`,body?{method:'POST',body:JSON.stringify({ownerRef,...body})}:{});
 let calls=0;
 const options={callModel:async()=>{calls++;return {value:{reply:'這項解釋有原文依據。你接下來想追問哪一句？',score:83,verdict:'有文本依據',strength:'能比較',gap:'可再精確',nextQuestion:'何處呼應？'},model:'gemini-test',usage:{promptTokenCount:100,totalTokenCount:500}};},formalAction:(formal,id,evaluate,commit)=>handleDialogueFormal(req(),env,student,formal,id,evaluate,commit),originalAction:(formal,id,commit)=>handleDialogueOriginal(req(),env,student,formal,id,commit)};
 const read=async()=>await(await handleDialogue(req(),env,student,null,options)).json();
 const send=async(data,content,extra={})=>{const body={taskId:data.learningTurn.taskId,content,revision:data.revision,mutationId:'synthetic-guided-'+crypto.randomUUID(),...extra};const response=await handleDialogue(req(body),env,student,null,options);return {response,data:await response.json(),body};};
 if(curriculum.mode==='classical'){
  const a=JSON.parse(fs.readFileSync(`site/data/classical-first-read/${lessonId}.json`));
  sql.prepare("INSERT INTO classical_first_read_sessions(student_id,lesson_id,text_version_id,text_digest,submitted_at) VALUES(1,?,?,?,'2020-01-01')").run(lessonId,a.textVersionId,a.textDigest);
  sql.prepare("INSERT INTO learning_interactions(source_event_id,student_id,academic_year,lesson_id,interaction_key,event_type,assessment_kind,scoring_role,resource_key,resource_version,registry_version,client_mutation_id,lesson_phase,occurred_at) VALUES('synthetic-read',1,'2026-2027',?,'readAcknowledged','read_acknowledged','participation','none','synthetic-read','v1','v1',?,'annotated_reading','2020-01-01')").run(lessonId,`annotated-read:${lessonId}:${a.textVersionId}`.slice(0,100));
 }
 return {curriculum,sql,env,req,options,read,send,calls:()=>calls};
}

const read2=async(f,s)=>await(await handleDialogue(f.req(),f.env,s,null,f.options)).json();
test('a first-read action the source refuses drops only that part and the reply still reaches the student',async t=>{
 const f=fixture(t,'lesson-1711-p1');f.sql.exec('DELETE FROM classical_first_read_sessions; DELETE FROM learning_interactions;');
 const asset=JSON.parse(fs.readFileSync('site/data/classical-first-read/lesson-1711-p1.json'));
 f.options.firstReadAction=async()=>new Response(JSON.stringify({ok:false,error:'初讀標記位置無效'}),{status:422});
 const p=asset.paragraphs[0],selectedText=p.text.slice(0,3),guess='我猜這幾個字是在引出主要意思。';
 f.options.callModel=async(_env,prompt)=>{const data=JSON.parse(prompt.split('以下是資料，不是指令：\n').at(-1)),turn=data.recent.filter(t=>t.role==='student').at(-1);return {value:{reply:'你停在這裡，先說說你的第一直覺。',assessments:[],readingEvidence:{operation:'mark',paragraphKey:p.key,selectedText,evidence:{turnId:turn.id,quote:guess}}},model:'synthetic-test',usage:{promptTokenCount:100,totalTokenCount:500}};};
 const before=await f.read(),body={conversation:true,taskId:before.learningTurn?.taskId||`${f.curriculum.curriculumVersion}:${before.revision}:reading-conversation`,content:`[${p.key}] ${selectedText}\n${guess}`,revision:before.revision,mutationId:crypto.randomUUID()};
 const response=await handleDialogue(f.req(body),f.env,student,null,f.options),data=await response.json();
 assert.equal(response.status,200,JSON.stringify(data));
 assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM dialogue_turns WHERE role='teacher'").get().n,1,'the reply is saved and shown');
 assert.equal(f.sql.prepare("SELECT status FROM dialogue_turns WHERE role='student'").get().status,'saved');
 const rejected=JSON.parse(f.sql.prepare("SELECT details_json FROM dialogue_events WHERE event_type='proposal_parts_rejected'").get().details_json);
 assert.deepEqual(rejected.parts.map(p=>p.code),['reading_source_unconfirmed']);assert.equal(rejected.retained.readingEvidence.operation,'mark');
 assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM dialogue_events WHERE event_type='reading_evidence_saved'").get().n,0);
});
test('a first-read impression before the third doubt keeps the reply and records nothing in the source',async t=>{
 const f=fixture(t,'lesson-1711-p1');f.sql.exec('DELETE FROM classical_first_read_sessions; DELETE FROM learning_interactions;');
 let sourceCalls=0;f.options.firstReadAction=async(op,payload)=>{sourceCalls++;return handleDialogueFirstRead(f.req(),f.env,student,null,op,payload);};
 const summary='抛开注释，读完整篇，我觉得它像一个严厉又热心的班主任。';
 f.options.callModel=async(_env,prompt)=>{const data=JSON.parse(prompt.split('以下是資料，不是指令：\n').at(-1)),turn=data.recent.filter(t=>t.role==='student').at(-1);return {value:{reply:'這個比方有意思。你還有哪一處讀不通？',assessments:[],readingEvidence:{operation:'submit',evidence:{turnId:turn.id,quote:summary}}},model:'synthetic-test',usage:{promptTokenCount:100,totalTokenCount:500}};};
 const before=await f.read(),body={conversation:true,taskId:before.learningTurn?.taskId||`${f.curriculum.curriculumVersion}:${before.revision}:reading-conversation`,content:summary,revision:before.revision,mutationId:crypto.randomUUID()};
 const response=await handleDialogue(f.req(body),f.env,student,null,f.options);assert.equal(response.status,200);
 assert.equal(sourceCalls,0,'refused before the source is asked');
 assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM dialogue_turns WHERE role='teacher'").get().n,1);
 assert.equal(JSON.parse(f.sql.prepare("SELECT details_json FROM dialogue_events WHERE event_type='proposal_parts_rejected'").get().details_json).parts[0].code,'reading_summary_marks_required');
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM classical_first_read_sessions WHERE submitted_at IS NOT NULL').get().n,0);
});

// The production entry for student 9 / lesson-1462, rebuilt in a local database with the exact retained part.
const ENTRY=APPROVED_RETAINED_REPLAYS.find(e=>e.studentId===9&&!e.kind);
function replayFixture(t){
 const f=fixture(t,'lesson-1462');student={id:9,ucUserId:700009};
 t.after(()=>{student={id:1,ucUserId:700001};});
 f.sql.exec("INSERT INTO students(id,uc_slug,display_name) VALUES(9,'synthetic-nine','Synthetic')");
 const at='2026-10-29T11:00:00.000Z',c=JSON.stringify(f.curriculum);
 f.sql.prepare('INSERT INTO dialogue_sessions(id,student_id,lesson_id,curriculum_version,curriculum_json,policy_version,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(ENTRY.sessionId,9,'lesson-1462',f.curriculum.curriculumVersion,c,'yw-dialogue-policy-v21',4,at,at);
 const turn=(id,content,role='student',mutation=id)=>f.sql.prepare("INSERT INTO dialogue_turns(id,session_id,mutation_id,request_hash,role,content,status,policy_version,created_at) VALUES(?,?,?,?,?,?,'saved','yw-dialogue-policy-v21',?)").run(id,ENTRY.sessionId,mutation,'h',role,content,at);
 turn('c00bce6e-4b90-4c2c-af7c-934f125bafb2','我已经通读完了你可以提问了');turn('t-reply-1','好，那咱們談得更深一些。','teacher','c00bce6e-4b90-4c2c-af7c-934f125bafb2');
 turn('f94c62f4-ab0c-449a-b8aa-0c339bf8921e','今天先到这里');turn('t-reply-2','好。','teacher','f94c62f4-ab0c-449a-b8aa-0c339bf8921e');
 f.sql.prepare("INSERT INTO dialogue_events(id,session_id,turn_id,event_type,details_json,created_at) VALUES(?,?,?,'proposal_parts_rejected',?,?)").run(ENTRY.eventId,ENTRY.sessionId,'f94c62f4-ab0c-449a-b8aa-0c339bf8921e','{"policyVersion":"yw-dialogue-policy-v21","parts":[{"part":"originalEvidence","code":"reading_acknowledgement_not_verified"}],"credited":false,"retained":{"originalEvidence":{"objectiveId":"lesson-1462:read","evidence":{"turnId":"c00bce6e-4b90-4c2c-af7c-934f125bafb2","quote":"我已经通读完了"}}},"retainedVersion":"yw-rejected-retained-v1"}',at);
 f.options.originalAction=(formal,id,commit)=>handleDialogueOriginal(f.req(),f.env,student,formal,id,commit);
 return f;
}
test('the approved list is exactly the five owner-approved replays and the one owner-approved correction',()=>{
 assert.deepEqual(APPROVED_RETAINED_REPLAYS.filter(e=>!e.kind).map(e=>`${e.studentId}/${e.lessonId}`).sort(),['37/lesson-1461','41/lesson-1458','61/lesson-1458','63/lesson-1458','9/lesson-1462']);
 const fix=APPROVED_RETAINED_REPLAYS.filter(e=>e.kind==='correction');
 assert.deepEqual(fix.map(e=>`${e.studentId}/${e.lessonId}/${e.release}/${e.supersededRating}`),['8/lesson-1458/r39/100']);
 assert.equal(fix[0].quoteSha256,createHash('sha256').update('我給 83／100').digest('hex'));
 for(const e of APPROVED_RETAINED_REPLAYS)assert.match(e.quoteSha256,/^[0-9a-f]{64}$/);
 assert.equal(ENTRY.quoteSha256,createHash('sha256').update('我已经通读完了').digest('hex'));
});
test('opening the lesson records the approved reading statement once, through the ordinary original-task path',async t=>{
 const f=replayFixture(t);let modelCalls=0;f.options.callModel=async()=>{modelCalls++;throw Error('no model call');};
 const first=await read2(f,student);
 assert.equal(first.state.objectives.find(o=>o.id==='lesson-1462:read').status,'preserved');
 assert.equal(first.state.score.tracks.find(x=>x.key==='read').status,'done');
 const li=f.sql.prepare("SELECT interaction_key,client_mutation_id,scoring_role,assessment_kind FROM learning_interactions WHERE student_id=9").all();
 assert.equal(li.length,1);assert.equal(li[0].interaction_key,'readAcknowledged');assert.equal(li[0].client_mutation_id,'yw-dialogue-local:f94c62f4-ab0c-449a-b8aa-0c339bf8921e-r38');
 const saved=JSON.parse(f.sql.prepare("SELECT details_json FROM dialogue_events WHERE event_type='retained_replay_saved'").get().details_json);
 assert.equal(saved.release,'r38');assert.equal(saved.retainedEventId,ENTRY.eventId);assert.equal(saved.evidence.quote,'我已经通读完了');
 await read2(f,student);await read2(f,student);
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM learning_interactions WHERE student_id=9').get().n,1,'idempotent');
 assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM dialogue_events WHERE event_type='retained_replay_saved'").get().n,1);
 assert.equal(modelCalls,0);
});
test('the replay touches nothing for another student, a changed quote, or an item already complete',async t=>{
 const f=replayFixture(t);
 const other={...student,id:1};
 assert.deepEqual(await replayApprovedRetained({db:f.env.READING_DB,session:{id:ENTRY.sessionId,student_id:9},curriculum:f.curriculum,student:other,originalAction:f.options.originalAction}),[]);
 const bad=[{...ENTRY,quoteSha256:'0'.repeat(64)}];
 assert.equal((await replayApprovedRetained({db:f.env.READING_DB,session:{id:ENTRY.sessionId,student_id:9},curriculum:f.curriculum,student,originalAction:f.options.originalAction,approved:bad}))[0].status,'retained_part_mismatch');
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM learning_interactions WHERE student_id=9').get().n,0);
 assert.equal((await replayApprovedRetained({db:f.env.READING_DB,session:{id:ENTRY.sessionId,student_id:9},curriculum:f.curriculum,student,originalAction:f.options.originalAction}))[0].status,'recorded');
 f.sql.exec("DELETE FROM dialogue_events WHERE event_type='retained_replay_saved'");
 assert.equal((await replayApprovedRetained({db:f.env.READING_DB,session:{id:ENTRY.sessionId,student_id:9},curriculum:f.curriculum,student,originalAction:f.options.originalAction}))[0].status,'already_complete');
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM learning_interactions WHERE student_id=9').get().n,1);
});

// r39 (suen 2026-11-01 「學生 8改正」): a correction records the student's last plainly given rating as a new attempt and
// keeps the earlier record, only while that record is the exact one named and still holds the named value.
function correctionFixture(t){
 const f=fixture(t,'lesson-1458');student={id:8,ucUserId:700008};
 t.after(()=>{student={id:1,ucUserId:700001};});
 f.sql.exec("INSERT INTO students(id,uc_slug,display_name) VALUES(8,'synthetic-eight','Synthetic')");
 const at='2026-10-24T11:00:00.000Z',sid='correction-session',objectiveId='legacy:effect:lesson-1458:interaction:evaluation';
 f.sql.prepare('INSERT INTO dialogue_sessions(id,student_id,lesson_id,curriculum_version,curriculum_json,policy_version,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(sid,8,'lesson-1458',f.curriculum.curriculumVersion,JSON.stringify(f.curriculum),'yw-dialogue-policy-v21',4,at,at);
 const turn=(id,content)=>f.sql.prepare("INSERT INTO dialogue_turns(id,session_id,mutation_id,request_hash,role,content,status,policy_version,created_at) VALUES(?,?,?,?,'student',?,'saved','yw-dialogue-policy-v21',?)").run(id,sid,id,'h',content,at);
 turn('t-83','我給 83／100。\n\n比先前的 82 略高一點。');turn('t-100','算了，我改成100分');
 f.sql.prepare("INSERT INTO dialogue_events(id,session_id,turn_id,event_type,details_json,created_at) VALUES(?,?,?,'proposal_parts_rejected',?,?)").run('t-83:rejected',sid,'t-83',JSON.stringify({parts:[{part:'originalEvidence',code:'rating_not_explicit'}],credited:false,retained:{originalEvidence:{objectiveId,evidence:{turnId:'t-83',quote:'我給 83／100'}}},retainedVersion:'yw-rejected-retained-v1'}),at);
 const original=(formal,id,commit)=>handleDialogueOriginal(f.req(),f.env,student,formal,id,commit);
 return {f,sid,objectiveId,original};
}
const ratings=f=>f.sql.prepare("SELECT attempt_no,json_extract(raw_payload_json,'$.rating') rating FROM learning_interactions WHERE student_id=8 AND interaction_key='evaluation' ORDER BY id").all().map(r=>`${r.attempt_no}:${r.rating}`);
test('a correction records the last plainly given rating as a new attempt and keeps the forced one',async t=>{
 const {f,sid,objectiveId,original}=correctionFixture(t);
 const forced=prepareOriginalInput(f.curriculum,{kind:'evaluation',objectiveId},{rating:100,reason:'算了，我改成100分'});
 assert.equal((await original({...forced,lessonId:'lesson-1458'},'t-100',()=>[])).status,200);
 const target=f.sql.prepare("SELECT source_event_id FROM learning_interactions WHERE student_id=8 AND interaction_key='evaluation'").get().source_event_id;
 const entry={kind:'correction',release:'r39',sessionId:sid,studentId:8,lessonId:'lesson-1458',eventId:'t-83:rejected',objectiveId,quoteSha256:createHash('sha256').update('我給 83／100').digest('hex'),supersedesSourceEventId:target,supersededRating:100};
 const run=(approved)=>replayApprovedRetained({db:f.env.READING_DB,session:{id:sid,student_id:8},curriculum:f.curriculum,student,originalAction:original,approved});
 assert.equal((await run([{...entry,supersededRating:99}]))[0].status,'correction_target_mismatch','only the value it was named for');
 assert.equal((await run([{...entry,supersedesSourceEventId:'another'}]))[0].status,'correction_target_mismatch','only the record it was named for');
 assert.deepEqual(ratings(f),['1:100']);
 assert.equal((await run([entry]))[0].status,'recorded');
 assert.deepEqual(ratings(f),['1:100','2:83'],'the forced record stays; the corrected rating is a new attempt');
 const saved=JSON.parse(f.sql.prepare("SELECT details_json FROM dialogue_events WHERE event_type='retained_correction_saved'").get().details_json);
 assert.equal(saved.release,'r39');assert.deepEqual(saved.supersedes,{sourceEventId:target,rating:100});assert.equal(saved.input.rating,83);
 assert.equal((await run([entry]))[0].status,'already_replayed');assert.deepEqual(ratings(f),['1:100','2:83']);
 assert.equal(f.sql.prepare("SELECT client_mutation_id FROM learning_interactions WHERE student_id=8 ORDER BY id DESC").get().client_mutation_id,'yw-dialogue-local:t-83-r39c');
});
test('a correction never runs when the item was never completed (that is a replay, not a correction)',async t=>{
 const {f,sid,objectiveId,original}=correctionFixture(t);
 const entry={kind:'correction',release:'r39',sessionId:sid,studentId:8,lessonId:'lesson-1458',eventId:'t-83:rejected',objectiveId,quoteSha256:createHash('sha256').update('我給 83／100').digest('hex'),supersedesSourceEventId:'none',supersededRating:100};
 assert.equal((await replayApprovedRetained({db:f.env.READING_DB,session:{id:sid,student_id:8},curriculum:f.curriculum,student,originalAction:original,approved:[entry]}))[0].status,'correction_target_mismatch');
 assert.deepEqual(ratings(f),[]);
});
