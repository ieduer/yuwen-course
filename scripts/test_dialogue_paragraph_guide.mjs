import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {projectState,lessonScore,questionItems,contextFor,POLICY,POLICY_VERSION} from '../site/dialogue-policy.js';
import {paragraphGuide,paragraphGuideContext,PARAGRAPH_GUIDE_VERSION} from '../site/dialogue-paragraph-guide.js';
import {READING_GATE_NOTICE} from '../site/dialogue-source.js';
import {questionVocabularyTask,originalVocabularyTasks} from '../site/dialogue-formal.js';
import {conversationOriginalTasks} from '../site/dialogue-reading-evidence.js';

const load=id=>JSON.parse(fs.readFileSync(`site/dialogue-curriculum/${id}.json`,'utf8'));
const CLOSE={phase:'close_reading',unresolvedMarks:0};
const legacyVocab=(c,vid)=>c.objectives.find(o=>o.domain==='legacy'&&o.legacy?.resourceKey===`effect:${c.lessonId}:vocab:${vid}`).id;
const demonstrated=id=>({objectiveId:id,outcome:'demonstrated',evidence:[],rationale:'test',ruleVersion:'test'});
const guideFor=(c,state)=>paragraphGuide(c,state,questionItems(c));
const vocabularyTrack=score=>score.tracks.find(t=>t.key==='vocabulary');

test('classical words follow the text paragraph by paragraph',()=>{
 const c=load('lesson-1474'),guide=guideFor(c,projectState(c,[],[],null,CLOSE));
 assert.equal(guide.version,PARAGRAPH_GUIDE_VERSION);
 const index=new Map(c.passages.map((p,i)=>[p.id,i]));
 const ranks=guide.paragraphs.map(p=>index.get(p.passageId));
 assert.deepEqual(ranks,[...ranks].sort((a,b)=>a-b),'paragraphs keep the order of the text');
 assert.equal(guide.totalWords,questionItems(c).filter(v=>c.objectives.some(o=>o.id===v.id&&o.domain==='vocabulary')).length);
 assert.equal(new Set(guide.order).size,guide.order.length,'every word appears once');
 for(const p of guide.paragraphs)for(const w of p.words){
  const o=c.objectives.find(x=>x.id===w.objectiveId);
  assert.ok(o.sourcePassages.includes(p.passageId),`${w.word} sits in one of its own source paragraphs`);
 }
 assert.equal(guide.focus.ordinal,1);
 assert.equal(guide.focus.next.objectiveId,guide.paragraphs[0].words[0].objectiveId);
});

test('a word is confirmed by a verified dialogue assessment or a preserved original answer; a review without a calibration hold reopens (r35)',()=>{
 const c=load('lesson-1476'),order=guideFor(c,projectState(c,[],[],null,CLOSE)).order;
 const [first,second,third]=order;
 const preserved=[{objectiveId:legacyVocab(c,second),verified:true,sourceEventId:'e1'}];
 const state=projectState(c,[demonstrated(first),{...demonstrated(third),outcome:'review'}],preserved,null,CLOSE);
 const guide=guideFor(c,state),words=new Map(guide.paragraphs.flatMap(p=>p.words).map(w=>[w.objectiveId,w.status]));
 assert.equal(words.get(first),'confirmed');
 assert.equal(words.get(second),'confirmed');
 // r35 (owner direction 2026-10-24): a review the evidence rules could still turn into demonstrated is unfinished work.
 assert.equal(words.get(third),'open');
 assert.equal(guide.confirmedWords,2);
 assert.equal(guide.waitingWords,0);
 assert.equal(guide.focus.next.objectiveId,third,'the focus skips confirmed words and comes back to the reopened one');
});

test('the guide stays out of non-classical lessons and out of the prompt before close reading',()=>{
 const poetry=load('lesson-1498');
 assert.equal(guideFor(poetry,projectState(poetry,[],[],null,null)),null);
 const c=load('lesson-1476'),initial=guideFor(c,projectState(c,[],[],null,{phase:'initial_reading'}));
 assert.equal(initial.phase,'initial_reading');
 assert.equal(paragraphGuideContext(initial),null);
 const close=paragraphGuideContext(guideFor(c,projectState(c,[],[],null,CLOSE)));
 assert.deepEqual(Object.keys(close).sort(),['complete','confirmedWords','focus','totalWords','version']);
});

test('the author context carries the paragraph guide only when the live turn passes it',()=>{
 const c=load('lesson-1476'),state=projectState(c,[],[],null,CLOSE);
 const base={curriculum:c,state,turns:[],question:null};
 assert.equal(JSON.parse(contextFor(base).split('\n').find(l=>l.startsWith('{'))||'{}').paragraphGuide,undefined);
 const guide=paragraphGuideContext(guideFor(c,state));
 assert.ok(contextFor({...base,paragraphGuide:guide}).includes('"paragraphGuide"'));
});

test('vocabulary points arrive word by word; the full weight still needs every original record',()=>{
 const c=load('lesson-1476'),order=guideFor(c,projectState(c,[],[],null,CLOSE)).order;
 const empty=vocabularyTrack(lessonScore(c,projectState(c,[],[],null,CLOSE)));
 assert.equal(empty.points,0);assert.equal(empty.status,'not_started');
 const total=empty.progress.total,weight=empty.weight;
 const some=projectState(c,order.slice(0,4).map(demonstrated),[],null,CLOSE),track=vocabularyTrack(lessonScore(c,some));
 assert.equal(track.progress.confirmed,4);
 assert.equal(track.points,Math.floor(weight*4/total));
 assert.ok(track.points>0);assert.equal(track.status,'partial');
 // Every item preserved: full weight; with an unresolved first-read mark the track stays one point short of done.
 const items=c.objectives.filter(o=>o.domain==='legacy'&&o.legacy?.questionKind==='vocabulary').map(o=>o.id);
 const guideItems=c.objectives.filter(o=>o.domain==='studyGuide'&&(c.legacy?.formative||[]).some(i=>i.itemKey===o.sourceItemKey&&['vocabulary','syntax'].includes(i.competencyTag))).map(o=>o.id);
 const all=[...items,...guideItems].map(id=>({objectiveId:id,verified:true,sourceEventId:'e-'+id}));
 assert.equal(all.length,total);
 const done=vocabularyTrack(lessonScore(c,projectState(c,[],all,null,CLOSE)));
 assert.equal(done.points,weight);assert.equal(done.status,'done');
 const marked=vocabularyTrack(lessonScore(c,projectState(c,[],all,null,{phase:'close_reading',unresolvedMarks:1})));
 assert.equal(marked.points,weight-1);assert.equal(marked.status,'partial');
 assert.equal(lessonScore(c,some).rule,'legacy-track-weights-v2');
});

test('the author is told what the classical reading gate means and how to read paragraph by paragraph',()=>{
 assert.equal(POLICY_VERSION,'yw-dialogue-policy-v20');
 assert.match(POLICY,/initial_reading 時，學生還沒有完成無注疏初讀/);
 assert.match(POLICY,/不提交 formalAssessments、originalEvidence 或字詞 demonstrated/);
 assert.match(POLICY,/paragraphGuide 存在時是文言細讀/);
 assert.match(POLICY,/不降低難度/);
 assert.match(POLICY,/只摘能支持該判準的最短一段/,'long answers must not be copied whole into every evidence quote (the 4096-token truncations of 2026-10-22/23)');
 for(const code of ['classical_first_read_required','classical_annotated_reading_required']){
  assert.match(READING_GATE_NOTICE[code],/文言文/);
  assert.doesNotMatch(READING_GATE_NOTICE[code],/引用你先前的話補記/,'the notice must not invite a resubmission that would be refused again');
 }
});

test('the word the current question asks about can take its original choice in the same turn, once',()=>{
 const c=load('lesson-1578'),state=projectState(c,[],[],null,CLOSE),word=guideFor(c,state).focus.next.objectiveId;
 assert.deepEqual(originalVocabularyTasks(c,state),[],'nothing demonstrated yet, so no original item is offered by the old rule');
 const task=questionVocabularyTask(c,state,{objectiveId:word});
 assert.equal(task.kind,'vocabulary');assert.equal(task.objectiveId,legacyVocab(c,word));assert.ok(task.options.length>=2);
 const tasks=conversationOriginalTasks(c,state,null,[...originalVocabularyTasks(c,state),task]);
 assert.equal(tasks.filter(t=>t.objectiveId===task.objectiveId).length,1);
 const answered=projectState(c,[],[{objectiveId:legacyVocab(c,word),verified:true,sourceEventId:'e'}],null,CLOSE);
 assert.equal(questionVocabularyTask(c,answered,{objectiveId:word}),null,'a preserved original answer is never offered again');
 assert.equal(questionVocabularyTask(c,state,null),null);
 assert.equal(questionVocabularyTask(c,state,{objectiveId:'lesson-1578:not-a-word'}),null);
 assert.match(POLICY,/不要請他把同一題再答一次/);
});
