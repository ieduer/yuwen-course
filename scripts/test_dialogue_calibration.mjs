import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {calibrationPacket,evaluateCalibrationCase} from './dialogue_calibration.mjs';
const corpus=JSON.parse(fs.readFileSync('scripts/dialogue-calibration-cases.json'));
const budget=JSON.parse(fs.readFileSync('docs/dialogue/budget-policy.json'));
const load=id=>JSON.parse(fs.readFileSync(`site/dialogue-curriculum/${id}.json`));
const packet=calibrationPacket(corpus,load,budget);
test('calibration packet is deterministic, pinned, synthetic and cannot mutate accepted curriculum',()=>{
 assert.equal(packet.sourceDigest,calibrationPacket(corpus,load,budget).sourceDigest);assert.equal(packet.cases.length,24);assert.equal(packet.limits.retries,1);assert.equal(packet.limits.reservedMicros,2016000);
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

test('real first-call regression preserves rejection and requires every criterion',()=>{
 const failed=JSON.parse(fs.readFileSync('scripts/fixtures/dialogue-calibration-missing-criteria.json'));
 const c=packet.cases.find(c=>c.id===failed.caseId);
 const recorded=JSON.parse(fs.readFileSync('scripts/fixtures/dialogue-calibration-amendment1-packet.json')).cases.find(x=>x.id===failed.caseId);
 assert.equal(recorded.sourceDigest,failed.sourceDigest);assert.notEqual(c.sourceDigest,failed.sourceDigest);
 assert.throws(()=>evaluateCalibrationCase(recorded,{caseId:recorded.id,promptDigest:recorded.promptDigest,value:failed.value}),/missing_criterion/);
 assert.notEqual(c.promptDigest,failed.originalPromptDigest);
 const result={caseId:c.id,promptDigest:c.promptDigest,value:failed.value};
 assert.throws(()=>evaluateCalibrationCase(c,result),/missing_criterion|unverifiable_evidence/);
 // Synthetic structural fixture only: never substitute this for the stored model result.
 const full=structuredClone(failed.value),a=full.assessments[0],e=a.evidence[0];
 e.passageId=c.curriculum.passages.find(p=>p.text.includes(e.passageQuote)).id;
 const criteria=c.curriculum.objectives.find(o=>o.id===c.objectiveId).criteria;
 a.evidence=criteria.map(criterion=>({...e,criterion}));
 assert.equal(evaluateCalibrationCase(c,{...result,value:full}).expectedVerdictMatches,true);
 for(const criterion of criteria){
  const partial=structuredClone(full);partial.assessments[0].evidence=partial.assessments[0].evidence.filter(e=>e.criterion!==criterion);
  assert.throws(()=>evaluateCalibrationCase(c,{...result,value:partial}),/missing_criterion/);
 }
 full.assessments[0].evidence[1].quote='這不是任何學生說過的話';
 assert.throws(()=>evaluateCalibrationCase(c,{...result,value:full}),/unverifiable_evidence/);
});
test('all revised prompts request complete grounded criteria without changing old runtime packet',()=>{
 const original=JSON.parse(fs.readFileSync('scripts/fixtures/dialogue-calibration-stopped-packet.json'));
 assert.equal(original.sourceDigest,'95b8f943e519191aba697a0c01984621ee8ea12549e164379363f5ef54a04f09');
 assert.equal(original.policyVersion,'yw-dialogue-policy-v5');
 assert.equal(packet.policyVersion,'yw-dialogue-policy-v6');
 for(const c of packet.cases){
  assert(c.prompt.includes('每個 criterion 至少一筆'));
  assert(c.prompt.includes('缺少任何必要證據時不給 demonstrated'));
  assert.notEqual(c.sourceDigest,original.cases.find(o=>o.id===c.id).sourceDigest);
  assert.equal(packet.operation,'yw-dialogue-real-calibration-20261012-v1-amendment-2');assert.equal(packet.amendment.maxTotalAttempts,26);
 }
});
