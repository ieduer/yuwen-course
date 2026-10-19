import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {CALIBRATION_STATUS_VERSION,calibrationDigest,withCalibratedLanguage,calibratedQuestion,calibrationReopensReview} from '../site/dialogue-calibration-status.js';
import {projectReleaseJson} from './build_release_site.mjs';
import {prepareCalibratedModeSample,loadModeCurriculum} from './dialogue_mode_sample.mjs';
import packet from '../site/dialogue-full-language-packet.json' with {type:'json'};
import {fullMaterialize} from '../site/dialogue-full-language.js';
import {validateProposal} from '../site/dialogue-policy.js';

async function fixture(){
 const source={lessonId:'synthetic',curriculumVersion:'frozen-v1',languagePractice:[{id:'one',version:'item-v1',calibrationStatus:'pending-real-model',meaning:'immutable criterion'},{id:'two',version:'item-v2',calibrationStatus:'pending-real-model'}],passages:[{id:'p1',text:'immutable source'}],objectives:[{id:'one',criteria:['original']}]};
 const proof={objectiveId:'one',itemVersion:'item-v1',itemDigest:await calibrationDigest(source.languagePractice[0]),evidenceDigest:'e'.repeat(64),cases:[{caseId:'synthetic-case',receiptDigest:'a'.repeat(64),readbackDigest:'b'.repeat(64),semanticReviewDigest:'c'.repeat(64)}]};
 const manifest={version:CALIBRATION_STATUS_VERSION,lessons:[{lessonId:source.lessonId,curriculumVersion:source.curriculumVersion,sourceDigest:await calibrationDigest(source),inspectionDigest:'d'.repeat(64),items:[proof]}]};
 return {source,manifest};
}
test('calibration is additive and exact-source: frozen contract and other objectives stay intact',async()=>{
 const {source,manifest}=await fixture(),before=JSON.stringify(source),next=await withCalibratedLanguage(source,manifest);
 assert.equal(JSON.stringify(source),before);assert.equal(next.curriculumVersion,source.curriculumVersion);
 assert.equal(next.languagePractice[0].calibrationStatus,'accepted');assert.equal(next.languagePractice[1].calibrationStatus,'pending-real-model');
 const {calibrationEvidence,...rest}=next;rest.languagePractice=rest.languagePractice.map((i,n)=>({...i,calibrationStatus:source.languagePractice[n].calibrationStatus}));assert.deepEqual(rest,source);
 assert.equal(calibrationEvidence.sourceDigest,await calibrationDigest(source));assert.equal(calibrationEvidence.manifestDigest,await calibrationDigest(manifest));
 for(const changed of [{...source,lessonId:'other'},{...source,curriculumVersion:'new'},{...source,passages:[]}])assert.equal(await withCalibratedLanguage(changed,manifest),changed);
});
test('invalid or ambiguous source-owned calibration fails closed',async()=>{
 for(const edit of [m=>m.version='unknown',m=>m.lessons.push(m.lessons[0]),m=>m.lessons[0].items[0].itemDigest='f'.repeat(64),m=>m.lessons[0].items[0].itemVersion='new',m=>m.lessons[0].items[0].cases=[],m=>m.lessons[0].items[0].cases[0].semanticReviewDigest=null,m=>m.lessons[0].items.push(m.lessons[0].items[0])]){
  const {source,manifest}=await fixture();edit(manifest);await assert.rejects(withCalibratedLanguage(source,manifest),/calibration_/);
 }
});
test('saved question and review history remain frozen; only future prompts and new attempts use calibration',async()=>{
 const {source,manifest}=await fixture(),next=await withCalibratedLanguage(source,manifest),q={id:'old',objectiveId:'one',state:'review',criteria:{calibrationStatus:'pending-real-model',meaning:'original'}};
 const bytes=JSON.stringify(q),promptQuestion=calibratedQuestion(q,next);
 assert.equal(promptQuestion.criteria.calibrationStatus,'accepted');assert.equal(promptQuestion.calibrationEvidence.originalStatus,'pending-real-model');assert.equal(JSON.stringify(q),bytes);
 assert(calibrationReopensReview(q,next));assert(!calibrationReopensReview({...q,state:'mastered'},next));assert(!calibrationReopensReview({...q,objectiveId:'two'},next));assert(!calibrationReopensReview({...q,criteria:{calibrationStatus:'accepted'}},next));
});
test('committed real calibration matches the exact projected lesson and leaves raw curriculum unchanged',async()=>{
 const bytes=fs.readFileSync('site/dialogue-curriculum/lesson-1498.json','utf8'),source=JSON.parse(projectReleaseJson('dialogue-curriculum/lesson-1498.json',bytes));
 const next=await withCalibratedLanguage(source);assert.equal(next.calibrationEvidence.items.length,3);assert(next.languagePractice.every(i=>i.calibrationStatus==='accepted'));
 assert.equal(fs.readFileSync('site/dialogue-curriculum/lesson-1498.json','utf8'),bytes);assert.equal((await withCalibratedLanguage({...source,title:'different edition'})).calibrationEvidence,undefined);
});
test('new mode plan binds effective calibrated materials without granting a new transaction',async()=>{
 const plan=await prepareCalibratedModeSample();
 for(const pin of plan.lessons){const base=loadModeCurriculum(pin.lessonId),effective=await withCalibratedLanguage(base);assert.equal(pin.baseSourceDigest,await calibrationDigest(base));assert.equal(pin.sourceDigest,await calibrationDigest(effective));}
 assert.notEqual(plan.lessons[0].baseSourceDigest,plan.lessons[0].sourceDigest);assert.equal(plan.executionAuthorized,false);assert.equal(plan.realProviderVerified,false);assert.equal(plan.productScope,189);
});
test('calibration enables only future independently evidenced mastery, never mastery by itself',async()=>{
 const source=loadModeCurriculum('lesson-1498'),effective=await withCalibratedLanguage(source),spec=packet.cases.find(c=>c.id==='language-he-independent'),f=fullMaterialize(spec,source),o=source.objectives.find(o=>o.id===spec.objectiveId),t=f.turns.at(-1),p=source.passages[0];
 const proposal={reply:'SYNTHETIC only',assessments:[{objectiveId:o.id,outcome:'demonstrated',rationale:'SYNTHETIC only',evidence:o.criteria.map(criterion=>({criterion,turnId:t.id,quote:t.content,passageId:p.id,passageQuote:p.text.slice(0,10)}))}]};
 assert.throws(()=>validateProposal(proposal,{...f,curriculum:source}),/language_calibration_required/);
 assert.equal(validateProposal(proposal,{...f,curriculum:effective}).assessments[0].outcome,'demonstrated');
 assert.throws(()=>validateProposal(proposal,{...f,curriculum:effective,question:null}),/independence_not_verified/);
 assert.deepEqual(validateProposal({reply:'SYNTHETIC only',assessments:[]},{...f,curriculum:effective}).assessments,[]);
});
