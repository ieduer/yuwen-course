import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {calibrationPacket,evaluateCalibrationCase} from './dialogue_calibration.mjs';
const corpus=JSON.parse(fs.readFileSync('scripts/dialogue-calibration-cases.json'));
const budget=JSON.parse(fs.readFileSync('docs/dialogue/budget-policy.json'));
const load=id=>JSON.parse(fs.readFileSync(`site/dialogue-curriculum/${id}.json`));
const packet=calibrationPacket(corpus,load,budget);
test('calibration packet is deterministic, pinned, synthetic and cannot mutate accepted curriculum',()=>{
 assert.equal(packet.sourceDigest,calibrationPacket(corpus,load,budget).sourceDigest);assert.equal(packet.cases.length,24);assert.equal(packet.limits.retries,0);assert.equal(packet.limits.reservedMicros,2016000);
 const seen=new Set(packet.cases.map(c=>c.kind));for(const kind of ['independent','misconception','praise','copy','partial','dissent','quotation','transfer','conclusion','conclusion-weak'])assert(seen.has(kind));
 for(const c of packet.cases){assert(c.prompt.includes(c.studentAnswer));assert(c.sourceCurriculumVersion);assert.equal(c.dataClass,undefined);}
 assert(load('lesson-1711-p1').languagePractice.every(v=>v.calibrationStatus==='pending-real-model'));
});
test('negative case accepts a focused review, rejects wrong-prompt results and flags false mastery',()=>{
 const c=packet.cases.find(c=>c.kind==='praise');
 const base={caseId:c.id,promptDigest:c.promptDigest,value:{reply:'請回到「非能水也」，解釋水在句中做甚麼。',assessments:[]}};
 assert.equal(evaluateCalibrationCase(c,base).expectedVerdictMatches,true);assert.throws(()=>evaluateCalibrationCase(c,{...base,promptDigest:'wrong'}),/source_mismatch/);
 const p=c.curriculum.passages[0],o=c.curriculum.objectives.find(o=>o.id===c.objectiveId),t=c.turns.at(-1);
 const result=evaluateCalibrationCase(c,{...base,value:{...base.value,assessments:[{objectiveId:o.id,outcome:'demonstrated',rationale:'錯誤示範：引用存在不表示理解',evidence:o.criteria.map(criterion=>({criterion,turnId:t.id,quote:t.content,passageId:p.id,passageQuote:p.text.slice(0,10)}))}]}});
 assert.equal(result.expectedVerdictMatches,false);assert.equal(result.semanticReviewRequired,true);
});
test('positive case needs actual demonstrated evidence, not an empty praise response',()=>{
 const c=packet.cases.find(c=>c.kind==='independent');
 const r=evaluateCalibrationCase(c,{caseId:c.id,promptDigest:c.promptDigest,value:{reply:'很好！',assessments:[]}});
 assert.equal(r.expectedVerdictMatches,false);assert.equal(r.semanticReviewRequired,true);
});
