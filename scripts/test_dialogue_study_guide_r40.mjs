// r40 (owner-approved 2026-11-01, 「做，其他我沒想到但可以優化的一併部署」 on the design
// _meta/reports/operations/yw-study-guide-dialogue-20261031/DESIGN.md): classical study-guide items are read paragraph by
// paragraph and answered before their answer is shown (先答後看); a demonstrated dialogue objective whose rubric item is
// still unrecorded is named to the author; an omitted assessments field is no assessment; refused rubric items say what
// they still need.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {handleDialogue} from '../site/dialogue-source.js';
import {handleDialogueFormal,handleDialogueOriginal} from '../site/_worker.js';
import {projectState,questionItems,contextFor,formalStillOpen,POLICY,POLICY_VERSION} from '../site/dialogue-policy.js';
import {paragraphGuide,paragraphGuideContext,studyGuidePlacement,guideItems,PARAGRAPH_GUIDE_VERSION} from '../site/dialogue-paragraph-guide.js';
import {validateStudyGuideAnswer,studyGuideReferenceShown} from '../site/dialogue-formal.js';
import {STUDY_GUIDE_GRADING_LINES,STUDY_GUIDE_DIALOGUE_GRADING_RULE,studyGuideAssessmentPrompt} from '../site/study-guide-assessment.js';

const load=id=>JSON.parse(fs.readFileSync(`site/dialogue-curriculum/${id}.json`,'utf8'));
const CLOSE={phase:'close_reading',unresolvedMarks:0};
const golden=JSON.parse(fs.readFileSync('scripts/fixtures/study-guide-paragraph-map-r40.json','utf8')).items;
const DANG='study:lesson-1477-p34-ancient-modern-01';

test('every study-guide item is placed in the paragraph of the last sentence it quotes, or in 通篇 (golden map of the design)',()=>{
 const lessons=[...new Set(Object.keys(golden).map(id=>id.replace(/^study:(lesson-\d+(?:-p\d+)?)-p\d+-.*/,'$1')))];
 let n=0;const placement={};
 for(const file of fs.readdirSync('site/dialogue-curriculum').filter(f=>/^lesson-.*\.json$/.test(f))){
  const c=load(file.replace(/\.json$/,''));
  for(const g of guideItems(c)){n++;const p=studyGuidePlacement(c,g.item);assert.deepEqual([p.passageId,p.placement],golden[g.objective.id],g.objective.id);placement[p.placement]=(placement[p.placement]||0)+1;}
 }
 assert.equal(n,193);assert.deepEqual(placement,{paragraph:110,'whole-text':64,'paragraph-partial':19});assert.ok(lessons.length>=16);
});

test('guide v2 reads words and items in text order, never confirms an item itself, and moves stuck items on',()=>{
 const c=load('lesson-1477'),state=projectState(c,[],[],null,CLOSE),guide=paragraphGuide(c,state,questionItems(c));
 assert.equal(guide.version,PARAGRAPH_GUIDE_VERSION);assert.equal(guide.version,'yw-paragraph-guide-v2');
 assert.equal(guide.totalItems,21);assert.equal(guide.confirmedItems,0);assert.equal(guide.totalWords,13);
 const p1=guide.paragraphs[0];assert.equal(p1.opening,'孟子曰');assert.deepEqual(p1.words.map(w=>w.word),['运']);assert.deepEqual(p1.items.map(i=>i.type),['虛詞','虛詞','句式']);
 assert.equal(guide.focus.next.kind,'studyGuide');assert.equal(guide.focus.next.sentence,'人皆有不忍人之心','the first thing read is the first sentence');
 const p2=guide.paragraphs.find(p=>p.passageId==='lesson-1477:p2');assert.equal(p2.items.length,7);assert.equal(p2.words.length,6);
 assert.ok(guide.paragraphs.find(p=>p.passageId==='lesson-1477:p3').words.length===0,'a paragraph with items only is read too');
 // A preserved original record confirms an item; the guide itself never does.
 const preserved=projectState(c,[],[{objectiveId:guide.focus.next.objectiveId,verified:true,sourceEventId:'e'}],null,CLOSE);
 const after=paragraphGuide(c,preserved,questionItems(c));assert.equal(after.confirmedItems,1);assert.notEqual(after.focus.next.objectiveId,guide.focus.next.objectiveId);
 // Shown answer or three attempts: waiting, never the focus again; offered three turns without an attempt: moved to 通篇.
 const first=guide.focus.next.objectiveId,second=guide.paragraphs[0].items[1].objectiveId;
 const shown=paragraphGuide(c,state,questionItems(c),null,{attempts:{},shown:{[first]:true},offered:{}});
 assert.equal(shown.paragraphs[0].items[0].status,'waiting');assert.equal(shown.paragraphs[0].items[0].closed,'reference_shown');assert.notEqual(shown.focus.next.objectiveId,first);
 assert.equal(paragraphGuide(c,state,questionItems(c),null,{attempts:{[first]:3},shown:{},offered:{}}).paragraphs[0].items[0].closed,'attempts');
 const deferred=paragraphGuide(c,state,questionItems(c),null,{attempts:{},shown:{},offered:{[first]:3,[second]:2}});
 assert.ok(!deferred.paragraphs[0].items.some(i=>i.objectiveId===first));const end=deferred.paragraphs.at(-1);assert.equal(end.opening,'通篇');assert.ok(end.items.some(i=>i.objectiveId===first&&i.deferred&&i.status==='open'));
 assert.equal(deferred.focus.next.objectiveId,second);
 // An open word question keeps the focus on its word (r35), items or not.
 const word=guide.paragraphs.find(p=>p.passageId==='lesson-1477:p2').words[0].objectiveId;
 assert.equal(paragraphGuide(c,state,questionItems(c),word).focus.next.objectiveId,word);
 // Lessons without study-guide items read as before.
 const plain=load('lesson-1711-p1'),pg=paragraphGuide(plain,projectState(plain,[],[],null,CLOSE),questionItems(plain));
 assert.equal(pg.totalItems,0);assert.equal(pg.focus.next.kind,'word');assert.ok(pg.paragraphs.every(p=>!p.wholeText));
});

test('an author turn shows the answer when it holds the whole reference, in either script, or names a choice item\'s letters',()=>{
 const c=load('lesson-1477'),item=guideItems(c).find(g=>g.objective.id===DANG).item;
 assert.equal(studyGuideReferenceShown('「乡党」就是同乡邻里。這裡是乡党、乡里。',item),true);
 assert.equal(studyGuideReferenceShown('這裡是鄉黨、鄉里的意思',item),true,'traditional script still shows it');
 assert.equal(studyGuideReferenceShown('你覺得孟子說的「党」是甚麼人？',item),false);
 const choice={referenceAnswer:'A',detailTag:'language-discrimination'};
 assert.equal(studyGuideReferenceShown('答案是 A。',choice),true);assert.equal(studyGuideReferenceShown('應選A',choice),true);
 assert.equal(studyGuideReferenceShown('先看 B 項的說法。',choice),false);assert.equal(studyGuideReferenceShown('答案是 B。',choice),false);
 assert.equal(studyGuideReferenceShown('應選 B、C',{referenceAnswer:['B','C'],detailTag:'multiple_choice'}),true);
});

const turns=(...list)=>list.map(([role,content],i)=>({id:`t${i}`,role,content,createdAt:new Date(Date.UTC(2026,10,1,0,i)).toISOString()}));
const grade={score:90,verdict:'答對古義',strength:'能從上下文判斷',gap:'本題要求已完成。',nextQuestion:'再看整句的語序？'};
test('a study-guide answer is admitted only as the student\'s whole turn written before any answer was shown, not a copy, within three attempts',()=>{
 const c=load('lesson-1477'),state=projectState(c,[],[],null,CLOSE);
 const t=turns(['teacher','「要誉于乡党朋友」的「党」，孟子說的是甚麼人？'],['student','不是政党，是同乡的人，乡里。']);
 const ok=validateStudyGuideAnswer({objectiveId:DANG,turnId:'t1',...grade},{curriculum:c,state,turns:t});
 assert.equal(ok.formal.input.response,'不是政党，是同乡的人，乡里。','the whole turn, never an excerpt');assert.equal(ok.formal.interaction,'studyGuideItemCompleted');
 assert.equal(ok.formal.input.referenceRevealedAt,undefined,'the server stamps the reveal when the result is shown');assert.equal(ok.assessment.score,90);
 // Feedback the author left out takes the rubric's own words; score and verdict are required.
 assert.equal(validateStudyGuideAnswer({objectiveId:DANG,turnId:'t1',score:70,verdict:'答對'},{curriculum:c,state,turns:t}).assessment.gap,'本題要求已完成。');
 for(const bad of [{score:101},{score:'90'},{verdict:''}])assert.throws(()=>validateStudyGuideAnswer({objectiveId:DANG,turnId:'t1',...grade,...bad},{curriculum:c,state,turns:t}),/invalid_study_guide_grade/);
 // The answer was already shown before the student wrote: refused. Shown after the student wrote: still the student's own answer.
 const shownFirst=turns(['teacher','這個「党」是乡党、乡里，不是政黨。'],['student','乡里的意思']);
 assert.throws(()=>validateStudyGuideAnswer({objectiveId:DANG,turnId:'t1',...grade},{curriculum:c,state,turns:shownFirst}),/study_guide_reference_shown_first/);
 const shownAfter=[...t,{id:'t2',role:'teacher',content:'對，就是乡党、乡里。',createdAt:'2026-11-01T00:05:00Z'}];
 assert.equal(validateStudyGuideAnswer({objectiveId:DANG,turnId:'t1',...grade},{curriculum:c,state,turns:shownAfter}).formal.input.response,'不是政党，是同乡的人，乡里。');
 // A copy of the author's own words is not an answer.
 const copied=turns(['teacher','有人會說是同乡朋友，你怎麼看？'],['student','同乡朋友']);
 assert.throws(()=>validateStudyGuideAnswer({objectiveId:DANG,turnId:'t1',...grade},{curriculum:c,state,turns:copied}),/copied_hint/);
 assert.throws(()=>validateStudyGuideAnswer({objectiveId:DANG,turnId:'t0',...grade},{curriculum:c,state,turns:t}),/study_guide_response_not_student_turn/);
 assert.throws(()=>validateStudyGuideAnswer({objectiveId:'lesson-1477:v04',turnId:'t1',...grade},{curriculum:c,state,turns:t}),/study_guide_not_eligible/);
 const done=projectState(c,[],[{objectiveId:DANG,verified:true,sourceEventId:'e'}],null,CLOSE);
 assert.throws(()=>validateStudyGuideAnswer({objectiveId:DANG,turnId:'t1',...grade},{curriculum:c,state:done,turns:t}),/study_guide_not_eligible/);
 const attempt=(n,response='別的回答')=>Array.from({length:n},()=>({objectiveId:DANG,interaction:'studyGuideItemCompleted',status:'confirmed',input:{response}}));
 assert.throws(()=>validateStudyGuideAnswer({objectiveId:DANG,turnId:'t1',...grade},{curriculum:c,state,turns:t,submissions:attempt(3)}),/study_guide_attempts_exhausted/);
 assert.throws(()=>validateStudyGuideAnswer({objectiveId:DANG,turnId:'t1',...grade},{curriculum:c,state,turns:t,submissions:attempt(1,'不是政党，是同乡的人，乡里。')}),/study_guide_same_response/,'the same words are not graded twice');
 assert.throws(()=>validateStudyGuideAnswer({objectiveId:DANG,turnId:'t1',...grade},{curriculum:c,state,turns:t,submissions:[{objectiveId:DANG,interaction:'studyGuideItemCompleted',status:'pending',input:{}}]}),/study_guide_result_pending/);
 assert.equal(validateStudyGuideAnswer({objectiveId:DANG,turnId:'t1',...grade},{curriculum:c,state,turns:t,submissions:[{objectiveId:DANG,interaction:'studyGuideItemCompleted',status:'refused',input:{}}]}).formal.objectiveId,DANG,'a refused submission was never evaluated');
});

test('the author grades under the original evaluator\'s rubric lines; the evaluator prompt is unchanged',()=>{
 assert.equal(STUDY_GUIDE_GRADING_LINES.length,6);assert.ok(!STUDY_GUIDE_DIALOGUE_GRADING_RULE.includes('只輸出 JSON'));
 const prompt=studyGuideAssessmentPrompt({prompt:'p',answerLabel:'L',referenceAnswer:'r'},'x').split('\n');
 assert.deepEqual(prompt.slice(0,6),[...STUDY_GUIDE_GRADING_LINES]);
 assert.equal(createHash('sha256').update(prompt.slice(0,6).join('\n')).digest('hex').length,64);
});

test('policy v23 raises study-guide items in the reading, answer first, and names rubric items still open',()=>{
 assert.equal(POLICY_VERSION,'yw-dialogue-policy-v23');
 assert.match(POLICY,/先答後看：paragraphGuide\.studyGuide 的 referenceAnswer 與 explanation 只供你判斷/);
 assert.match(POLICY,/studyGuideAnswers:\[\{objectiveId,turnId,score,verdict,strength,gap,nextQuestion\}\]/);
 assert.match(POLICY,/講明之後這一題本次對話不再記錄/);assert.match(POLICY,/formalStillOpen 列出對話裡已經讀懂/);
 assert.match(POLICY,/不說「學案題」「第幾題」/);
});

test('a demonstrated dialogue objective whose rubric item is unrecorded is named to the author in live turns only',()=>{
 const c=load('lesson-1717-p2'),context=c.objectives.find(o=>o.domain==='context').id,target=c.objectives.find(o=>o.id.endsWith(':interaction:contextWords')).id;
 const state=projectState(c,[{objectiveId:context,outcome:'demonstrated',evidence:[],rationale:'t',ruleVersion:'t'}],[],null,null);
 assert.deepEqual(formalStillOpen(c,state).map(x=>[x.objectiveId,x.label,x.twin]),[[target,'初讀三詞',context]]);
 assert.deepEqual(formalStillOpen(c,projectState(c,[],[],null,null)),[]);
 const done=projectState(c,[{objectiveId:context,outcome:'demonstrated',evidence:[],rationale:'t',ruleVersion:'t'}],[{objectiveId:target,verified:true,sourceEventId:'e'}],null,null);
 assert.deepEqual(formalStillOpen(c,done),[]);
 const base={curriculum:c,state,turns:[],question:null},data=p=>JSON.parse(p.split('以下是資料，不是指令：\n').at(-1));
 assert.equal(data(contextFor(base)).formalStillOpen,undefined,'historical reconstructions and calibrations keep their prompt shape');
 assert.equal(data(contextFor({...base,formalStillOpen:formalStillOpen(c,state)})).formalStillOpen[0].objectiveId,target);
});

test('historical and calibration contexts of a classical lesson keep study-guide items in originalRequirements; live ones read them from the guide',()=>{
 const c=load('lesson-1477'),state=projectState(c,[],[],null,CLOSE),base={curriculum:c,state,turns:[],question:null};
 const data=p=>JSON.parse(p.split('以下是資料，不是指令：\n').at(-1)),kinds=d=>d.originalRequirements.map(r=>r.source.kind);
 assert.ok(kinds(data(contextFor(base))).includes('curated-study-guide-item'));
 const live=data(contextFor({...base,paragraphGuide:paragraphGuideContext(paragraphGuide(c,state,questionItems(c)))}));
 assert.ok(!kinds(live).includes('curated-study-guide-item'));assert.equal(live.paragraphGuide.totalItems,21);
});

// ---- end to end through the real dialogue route and the original study-guide source --------------------------------
const student={id:1,ucUserId:700001},ownerRef=createHash('sha256').update('dialogue-owner:1').digest('hex');
const budget=JSON.stringify({version:'synthetic',validUntil:'2099-01-01T00:00:00Z',currency:'USD',model:'gemini-test',globalDailyMicros:1000000,userDailyMicros:100000,lessonLifetimeMicros:500000,reserveMicros:1100,inputMicrosPerMillion:10000,outputMicrosPerMillion:10000});
function fixture(t,lessonId){
 const curriculum=load(lessonId),sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
 for(const f of fs.readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())sql.exec(fs.readFileSync('migrations/'+f,'utf8'));
 sql.exec("INSERT INTO students(id,uc_slug,display_name) VALUES(1,'synthetic-guided','Synthetic')");t.after(()=>sql.close());
 const wrap=(text,args=[])=>({bind:(...args)=>wrap(text,args),first:async()=>sql.prepare(text).get(...args)||null,all:async()=>({results:sql.prepare(text).all(...args)}),run:async()=>({meta:{changes:Number(sql.prepare(text).run(...args).changes)}}),runSync:()=>({meta:{changes:Number(sql.prepare(text).run(...args).changes)}})});
 const db={prepare:text=>wrap(text),batch:async statements=>{sql.exec('BEGIN');try{const r=statements.map(s=>s.runSync());sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 const env={READING_DB:db,YW_DIALOGUE_ENABLED:'true',YW_DIALOGUE_BUDGET_JSON:budget,ASSETS:{fetch:async request=>{const path=new URL(request.url).pathname;return new Response(path===`/dialogue-curriculum/${lessonId}.json`?JSON.stringify(curriculum):fs.readFileSync('site'+path));}}};
 const req=body=>new Request(`https://yw.bdfz.net/api/dialogue/v1?lessonId=${lessonId}`,body?{method:'POST',body:JSON.stringify({ownerRef,...body})}:{});
 const replies=[];let calls=0;
 const options={callModel:async(_env,prompt)=>{calls++;const d=JSON.parse(prompt.split('以下是資料，不是指令：\n').at(-1).split('\n')[0]);const next=replies.shift();return {value:typeof next==='function'?next(d):next,model:'synthetic-test',usage:{promptTokenCount:100,totalTokenCount:500}};},
  formalAction:(formal,id,evaluate,commit)=>handleDialogueFormal(req(),env,student,formal,id,evaluate,commit),originalAction:(formal,id,commit)=>handleDialogueOriginal(req(),env,student,formal,id,commit)};
 const read=async()=>await(await handleDialogue(req(),env,student,null,options)).json();
 const say=async(data,content)=>{const body={taskId:data.learningTurn?.taskId||`${curriculum.curriculumVersion}:${data.revision}:reading-conversation`,content,revision:data.revision,mutationId:'synthetic-r40-'+crypto.randomUUID(),conversation:true};const response=await handleDialogue(req(body),env,student,null,options);return {response,data:await response.json(),body};};
 const a=JSON.parse(fs.readFileSync(`site/data/classical-first-read/${lessonId}.json`));
 sql.prepare("INSERT INTO classical_first_read_sessions(student_id,lesson_id,text_version_id,text_digest,submitted_at) VALUES(1,?,?,?,'2020-01-01')").run(lessonId,a.textVersionId,a.textDigest);
 sql.prepare("INSERT INTO learning_interactions(source_event_id,student_id,academic_year,lesson_id,interaction_key,event_type,assessment_kind,scoring_role,resource_key,resource_version,registry_version,client_mutation_id,lesson_phase,occurred_at) VALUES('synthetic-read',1,'2026-2027',?,'readAcknowledged','read_acknowledged','participation','none','synthetic-read','v1','v1',?,'annotated_reading','2020-01-01')").run(lessonId,`annotated-read:${lessonId}:${a.textVersionId}`.slice(0,100));
 const count=q=>sql.prepare(q).get().n,lastStudent=d=>d.recent.filter(t=>t.role==='student').at(-1);
 return {curriculum,sql,env,req,options,read,say,replies,calls:()=>calls,count,lastStudent};
}

test('end to end: raised in the paragraph, answered first, recorded once by the original source; a miss keeps the answer hidden; a repeat adds nothing',async t=>{
 const f=fixture(t,'lesson-1477');let data=await f.read();
 assert.equal(data.paragraphGuide.version,'yw-paragraph-guide-v2');assert.equal(data.paragraphGuide.totalItems,21);
 // Turn 1: the student talks; the author raises 党 without its answer. Its material reaches the author, the reference does not reach the page.
 f.replies.push(d=>{assert.ok(d.paragraphGuide.studyGuide.items.length>=1);return {reply:'「要誉于乡党朋友」的「党」，你覺得孟子說的是甚麼人？',assessments:[]};});
 let r=await f.say(data,'我讀到第二段，孟子說救孩子不是為了名聲。');assert.equal(r.response.status,200,JSON.stringify(r.data));
 assert.ok(!JSON.stringify(r.data.paragraphGuide).includes('乡党、乡里'),'no reference on the page before a pass');
 // Turn 2: a wrong answer, graded by the author under the rubric: recorded as a failed attempt, the answer stays hidden.
 f.replies.push(d=>({reply:'還不是。想想「朋友」前面為甚麼並列這個詞。',assessments:[],studyGuideAnswers:[{objectiveId:DANG,turnId:f.lastStudent(d).id,score:20,verdict:'把古義當成今義',strength:'注意到了這個字',gap:'沒有讀出同鄉的意思',nextQuestion:'它和「朋友」並列，說明是哪一類人？'}]}));
 r=await f.say(r.data,'是政党的意思吧');assert.equal(r.response.status,200,JSON.stringify(r.data));
 assert.equal(f.count("SELECT COUNT(*) n FROM learning_interactions WHERE interaction_key='studyGuideItemCompleted'"),1);
 const miss=r.data.sourceSubmissions.find(s=>s.objectiveId===DANG);assert.equal(miss.status,'confirmed');assert.equal(miss.reference,null,'先答後看: no reference for a miss');assert.equal(miss.assessment.gap,undefined);
 assert.equal(r.data.state.objectives.find(o=>o.id===DANG).status,'not_yet_observed');
 const item=r.data.paragraphGuide.paragraphs.flatMap(p=>p.items).find(i=>i.objectiveId===DANG);assert.equal(item.attempts,1);assert.equal(item.status,'open');
 // Turn 3: the right answer in the student's own words: recorded through the source with the author's rubric grade.
 const before=r.data.state.score.tracks.find(x=>x.key==='vocabulary').progress.confirmed;
 f.replies.push(d=>({reply:'對！就是同鄉的人：乡党、乡里。孟子說救人不是為了在鄉里博名聲。',assessments:[],studyGuideAnswers:[{objectiveId:DANG,turnId:f.lastStudent(d).id,...grade}]}));
 r=await f.say(r.data,'和朋友並列，那应该是同乡的人，乡里乡亲');assert.equal(r.response.status,200,JSON.stringify(r.data));
 assert.equal(f.calls(),3,'one model call per turn: the author graded inside its reply');
 assert.equal(f.count("SELECT COUNT(*) n FROM learning_interactions WHERE interaction_key='studyGuideItemCompleted'"),2);
 const receipt=JSON.parse(f.sql.prepare("SELECT details_json FROM dialogue_events WHERE event_type='source_assessment_saved' ORDER BY created_at DESC LIMIT 1").get().details_json);
 assert.equal(receipt.scoringProvenance.by,'conversation-author');assert.equal(receipt.scoringProvenance.answerVersion,'yw-study-guide-answer-v1');assert.equal(receipt.request.input.response,'和朋友並列，那应该是同乡的人，乡里乡亲');
 assert.ok(Number.isFinite(Date.parse(receipt.request.input.referenceRevealedAt)));assert.equal(receipt.assessment.score,90);
 const led=f.sql.prepare("SELECT e.correctness,e.eligibility_status FROM learning_evaluations e JOIN learning_interactions i ON i.source_event_id=e.source_event_id WHERE i.interaction_key='studyGuideItemCompleted' ORDER BY i.id DESC LIMIT 1").get();
 assert.equal(led.correctness,'passed');assert.equal(led.eligibility_status,'eligible');
 assert.equal(r.data.state.objectives.find(o=>o.id===DANG).status,'preserved');
 assert.equal(r.data.state.score.tracks.find(x=>x.key==='vocabulary').progress.confirmed,before+1,'the vocabulary track counts the item');
 const confirmed=r.data.paragraphGuide.paragraphs.flatMap(p=>p.items).find(i=>i.objectiveId===DANG);assert.equal(confirmed.status,'confirmed');assert.equal(confirmed.reference,'乡党、乡里。');assert.match(confirmed.explanation,/同乡邻里/);
 assert.equal(r.data.sourceSubmissions.filter(s=>s.objectiveId===DANG).every(s=>s.reference!==null),true,'after the pass the page may show the reference');
 assert.equal(r.data.statusNotice,null);
 // A repeat of the same proposal for a preserved item records nothing.
 f.replies.push(d=>({reply:'我們往下讀。',assessments:[],studyGuideAnswers:[{objectiveId:DANG,turnId:f.lastStudent(d).id,...grade}]}));
 r=await f.say(r.data,'好，往下读');assert.equal(r.response.status,200);
 assert.equal(f.count("SELECT COUNT(*) n FROM learning_interactions WHERE interaction_key='studyGuideItemCompleted'"),2);
 assert.match(r.data.statusNotice||'',/先前已有紀錄/);
});

test('end to end: an answer written after the author showed it is refused with a plain notice; the item stops being offered',async t=>{
 const f=fixture(t,'lesson-1477');const data=await f.read();
 f.replies.push({reply:'這個「党」是乡党、乡里，不是今天的政黨。',assessments:[]});
 let r=await f.say(data,'第二段的「党」是什么？');
 f.replies.push(d=>({reply:'對。',assessments:[],studyGuideAnswers:[{objectiveId:DANG,turnId:f.lastStudent(d).id,...grade}]}));
 r=await f.say(r.data,'是乡里的意思');assert.equal(r.response.status,200);
 assert.equal(f.count("SELECT COUNT(*) n FROM learning_interactions WHERE interaction_key='studyGuideItemCompleted'"),0);
 const rejected=JSON.parse(f.sql.prepare("SELECT details_json FROM dialogue_events WHERE event_type='proposal_parts_rejected'").get().details_json);
 assert.equal(rejected.parts[0].part,'studyGuideAnswers');assert.equal(rejected.parts[0].code,'study_guide_reference_shown_first');assert.ok(rejected.retained.studyGuideAnswers);
 assert.match(r.data.statusNotice,/答案先前已經說出/);
 const item=r.data.paragraphGuide.paragraphs.flatMap(p=>p.items).find(i=>i.objectiveId===DANG);assert.equal(item.status,'waiting');assert.equal(item.closed,'reference_shown');
});

test('end to end: a choice item is decided by its answer key even when the author said otherwise, and the student is told',async t=>{
 const f=fixture(t,'lesson-1578'),objective='study:lesson-1578-p79-content-discrimination-01';const data=await f.read();
 f.replies.push(d=>({reply:'選得好。',assessments:[],studyGuideAnswers:[{objectiveId:objective,turnId:f.lastStudent(d).id,...grade}]}));
 const r=await f.say(data,'我选B，因为修短随化的修是修为');assert.equal(r.response.status,200,JSON.stringify(r.data));
 const receipt=JSON.parse(f.sql.prepare("SELECT details_json FROM dialogue_events WHERE event_type='source_assessment_saved'").get().details_json);
 assert.equal(receipt.assessment.provider,'study-guide-answer-key');assert.equal(receipt.assessment.score,0);assert.equal(receipt.scoringProvenance.by,'study-guide-answer-key');
 assert.match(r.data.statusNotice,/按答案鍵核對：還沒通過/);
 assert.equal(r.data.sourceSubmissions.find(s=>s.objectiveId===objective).assessment.gap,undefined,'the key\'s gap (應選 …) does not reach the page');
});

test('end to end: one source submission per turn, the study-guide answer first; a show-first study-guide draft is dropped in classical conversation',async t=>{
 const f=fixture(t,'lesson-1477');let data=await f.read();
 const context=f.curriculum.objectives.find(o=>o.id.endsWith(':interaction:authorQuestion')).id;
 // The author shows another item's answer first (这、这些。); a draft of the student's later words for it is the old show-first route.
 f.replies.push({reply:'先說「人之有是四端也」的「是」：这、这些。',assessments:[]});
 data=(await f.say(data,'请先讲讲第五段')).data;
 f.replies.push(d=>({reply:'對，就是同鄉的人。',assessments:[],studyGuideAnswers:[{objectiveId:DANG,turnId:f.lastStudent(d).id,...grade}],formalAssessments:[{objectiveId:context,fields:{answer:{turnId:f.lastStudent(d).id,quote:'党是同乡的人'}},score:70,verdict:'v',strength:'s',gap:'g',nextQuestion:'n'}],sourceDraft:{objectiveId:'study:lesson-1477-p34-ancient-modern-02',fields:{response:{turnId:f.lastStudent(d).id,quote:'同乡的人'}}}}));
 const r=await f.say(data,'党是同乡的人');assert.equal(r.response.status,200,JSON.stringify(r.data));
 assert.equal(f.count("SELECT COUNT(*) n FROM learning_interactions WHERE interaction_key='studyGuideItemCompleted'"),1);
 const parts=JSON.parse(f.sql.prepare("SELECT details_json FROM dialogue_events WHERE event_type='proposal_parts_rejected'").get().details_json).parts;
 assert.ok(parts.some(p=>p.part==='sourceDraft'&&p.code==='study_guide_answer_first'),JSON.stringify(parts));
 assert.ok(parts.some(p=>p.part==='formalAssessments'&&p.code==='one_source_submission_per_turn'&&p.kind==='authorQuestion'),JSON.stringify(parts));assert.equal(f.count("SELECT COUNT(*) n FROM learning_interactions WHERE interaction_key='authorQuestion'"),0);
 assert.match(r.data.statusNotice||'',/這一輪只記一項/);
 assert.equal(f.count("SELECT COUNT(*) n FROM dialogue_events WHERE event_type='source_answer_proposed'"),0);
});

test('the guide records how long an item was offered and moves it to 通篇 after three turns without an attempt',async t=>{
 const f=fixture(t,'lesson-1477');let data=await f.read();const first=data.paragraphGuide.focus.next.objectiveId;
 for(let i=0;i<3;i++){f.replies.push({reply:'我們慢慢讀。',assessments:[]});const r=await f.say(data,`我想先談別的 ${i}`);assert.equal(r.response.status,200);data=r.data;}
 assert.equal(f.count(`SELECT COUNT(DISTINCT turn_id) n FROM dialogue_events WHERE event_type='source_context_prepared' AND json_extract(details_json,'$.guideNext.objectiveId')='${first}'`),3);
 assert.notEqual(data.paragraphGuide.focus.next.objectiveId,first);
 assert.ok(data.paragraphGuide.paragraphs.at(-1).items.some(i=>i.objectiveId===first&&i.deferred),'deferred to the closing 通篇 stage, still open');
});

test('a refused rubric item tells the student what it still needs instead of inviting a resubmission',async t=>{
 const f=fixture(t,'lesson-1477');const data=await f.read(),target=f.curriculum.objectives.find(o=>o.id.endsWith(':interaction:authorQuestion')).id;
 f.replies.push(d=>({reply:'這個問題問得好，我給 80 分。',assessments:[],formalAssessments:[{objectiveId:target,fields:{answer:{turnId:f.lastStudent(d).id,quote:'孟子真的相信人人都有四端嗎'}},score:80,verdict:'v',strength:'s',gap:'g',nextQuestion:'n'}]}));
 const r=await f.say(data,'我想問孟子：人人都有四端嗎？');assert.equal(r.response.status,200);
 assert.equal(f.count("SELECT COUNT(*) n FROM learning_interactions WHERE interaction_key='authorQuestion'"),0);
 assert.match(r.data.statusNotice,/「向作者發問」還沒有記下/);assert.doesNotMatch(r.data.statusNotice,/補記/);
});
