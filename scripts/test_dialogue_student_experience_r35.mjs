// r35 (owner-approved 2026-10-24, "從學生視角思考如何提升對話學習體驗，核驗也要確保效度"): what the student reads and
// can still complete changes; what counts as evidence does not.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {POLICY,POLICY_VERSION,projectState,reviewReopenable,validateProposal} from '../site/dialogue-policy.js';
import {outputShape} from '../site/dialogue-source.js';
import {paragraphGuide} from '../site/dialogue-paragraph-guide.js';
import {questionItems} from '../site/dialogue-policy.js';

const load=id=>JSON.parse(fs.readFileSync(`site/dialogue-curriculum/${id}.json`,'utf8'));
const row=(objectiveId,outcome,policyVersion='yw-dialogue-policy-v15')=>({objectiveId,outcome,evidence:[],rationale:'test',ruleVersion:'test',policyVersion});

test('policy v20: foreign authors speak Chinese, the reply never narrates bookkeeping, first-read marks are tracked',()=>{
 assert.equal(POLICY_VERSION,'yw-dialogue-policy-v20');
 assert.match(POLICY,/外國作者一律用中文說話/);
 assert.doesNotMatch(POLICY,/先用其寫作語言，再附忠實、完整的中文對照/,'the full bilingual reply (40 Russian, English or Spanish replies to Chinese students, 10-21..23) is gone');
 assert.match(POLICY,/reply 只談作品和學生的想法，不談後台/);
 assert.doesNotMatch(POLICY,/並說明是補記/);
 assert.match(POLICY,/readingGate\.marks 是已記下的疑點數/);
 assert.match(POLICY,/reopenedFromReview 為 true 的項目/);
 // Evidence rules are untouched.
 assert.match(POLICY,/每個 demonstrated 的 evidence 必須逐項覆蓋該 objectives 條目 criteria 中的全部判準/);
 assert.match(POLICY,/calibrationStatus 非 accepted 或來源仍待核對時只能給 review/);
});

test('a pre-v19 review without a pending calibration reopens as unfinished work; v19+ reviews and calibration holds stay; credit is unchanged',()=>{
 const c=load('lesson-1499');
 const plain=c.objectives.find(o=>o.domain==='wordCreation')||c.objectives.find(o=>o.domain==='transfer');
 const state=projectState(c,[row(plain.id,'review')],[]);
 const o=state.objectives.find(x=>x.id===plain.id);
 assert.equal(o.status,'needs_practice');assert.equal(o.reopenedFromReview,true);
 assert.equal(state.targets.find(t=>t.id===plain.id).status,'in_progress','the page shows it as work in progress, not a teacher hold');
 assert.equal(projectState(c,[row(plain.id,'review'),row(plain.id,'demonstrated')],[]).objectives.find(x=>x.id===plain.id).status,'demonstrated','a verified demonstrated still wins');
 assert.equal(projectState(c,[row(plain.id,'needs_practice')],[]).objectives.find(x=>x.id===plain.id).reopenedFromReview,undefined);
 // From policy v19 (r34) review means an uncertain reading or a source/calibration hold: it keeps its meaning.
 for(const v of ['yw-dialogue-policy-v19','yw-dialogue-policy-v20',null])assert.equal(projectState(c,[row(plain.id,'review',v)],[]).objectives.find(x=>x.id===plain.id).status,'review',String(v));
 const held=load('lesson-1497'),item=held.languagePractice.find(v=>v.calibrationStatus!=='accepted');
 assert.ok(item,'lesson-1497 has a language item still pending calibration');
 assert.equal(reviewReopenable(held,item.id),false);
 if(held.objectives.some(o=>o.id===item.id)){
  const s=projectState(held,[row(item.id,'review')],[]);
  assert.notEqual(s.objectives.find(x=>x.id===item.id).status,'needs_practice','a calibration hold is not reopened');
 }
 // Reopening never adds credit: demonstrated still needs every criterion with verified quotes.
 const v=c.objectives.find(o=>o.domain==='vocabulary');
 assert.throws(()=>validateProposal({reply:'好。',assessments:[{objectiveId:v.id,outcome:'demonstrated',rationale:'x',evidence:[]}]},{curriculum:c,turns:[]}),/missing_criterion|independence_not_verified/);
});

test('the first read reports how many marks are saved and whether the summary is written',()=>{
 const c=load('lesson-1578');
 const g=paragraphGuide(c,projectState(c,[],[],null,{phase:'initial_reading',marks:2,marksRequired:3,summaryWritten:false}),questionItems(c));
 assert.deepEqual(g.firstRead,{marks:2,required:3,summaryWritten:false});
 const close=paragraphGuide(c,projectState(c,[],[],null,{phase:'close_reading',unresolvedMarks:0}),questionItems(c));
 assert.equal(close.firstRead,undefined);
});

test('the output shape records the visible reply against the whole structured reply',()=>{
 const shape=outputShape({reply:'對，「信」是確實。',assessments:[{objectiveId:'x',outcome:'needs_practice',rationale:'r',evidence:[]}]});
 assert.equal(shape.version,'yw-output-shape-v1');assert.equal(shape.replyChars,9);
 assert.ok(shape.totalChars>shape.replyChars);assert.deepEqual(Object.keys(shape.fields),['reply','assessments']);
 assert.deepEqual(outputShape(null),{version:'yw-output-shape-v1',replyChars:0,totalChars:4,fields:{}});
});

test('while a question is open its word stays the focus, even when an earlier word has been reopened',()=>{
 const c=load('lesson-1578'),items=questionItems(c),state=projectState(c,[],[],null,{phase:'close_reading',unresolvedMarks:0});
 const plain=paragraphGuide(c,state,items);
 const later=plain.order[3];
 const held=paragraphGuide(c,state,items,later);
 assert.equal(held.focus.next.objectiveId,later,'the open question keeps the focus');
 assert.equal(plain.focus.next.objectiveId,plain.order[0],'without an open question the first open word leads');
 const confirmed=projectState(c,[{objectiveId:later,outcome:'demonstrated',evidence:[],rationale:'t',ruleVersion:'t'}],[],null,{phase:'close_reading',unresolvedMarks:0});
 assert.equal(paragraphGuide(c,confirmed,items,later).focus.next.objectiveId,plain.order[0],'a finished word no longer holds the focus');
});
