import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import packet from '../site/dialogue-full-language-packet.json' with {type:'json'};
import {FULL_OPERATION,releaseCases,fullReceipt,digest} from '../site/dialogue-full-language.js';
import {reconciledCost} from '../site/dialogue-budget.js';
import {projectReleaseJson} from './build_release_site.mjs';
import {loadCurriculum} from './dialogue_full_language.mjs';
import {historicalCalibrationSource,inspectHistoricalCalibration,inspectScopedCalibration} from './dialogue_calibration_scope.mjs';

const sha=x=>createHash('sha256').update(x).digest('hex');
const sourceCommit='2bd882345cdaab319157905a7de160f374c3e1f0';
const objectives=['lesson-1498:language-he','lesson-1498:language-dan','lesson-1498:grammar-moon'];
const specs=releaseCases(packet).filter(c=>objectives.includes(c.objectiveId));
const execution={sourceCommit,artifactSha256:'b'.repeat(64),activationDigest:'c'.repeat(64),apisVersion:'11111111-2222-4333-8444-555555555555',ownerRef:sha('dialogue-owner:1'),priorReceiptSetDigest:'d'.repeat(64),readyAt:'2026-10-17T12:00:00Z',hardExpiry:'2026-10-17T18:00:00Z',budget:{version:'synthetic-unit-only',validUntil:'2026-10-17T18:00:00Z',currency:'USD',model:packet.model,globalDailyMicros:50000000,userDailyMicros:50000000,lessonLifetimeMicros:50000000,reserveMicros:84000,inputMicrosPerMillion:750000,outputMicrosPerMillion:3750000,providerAttemptLimit:1,logicalProviderAttemptLimit:1,maxInputTokens:100000,maxOutputTokens:2400}};

// Synthetic, memory-only fixtures. These are never saved as acceptance records.
async function fixture(c=specs[0]){
 const old=(await historicalCalibrationSource(sourceCommit)).module;
 const raw=loadCurriculum(c.lessonId),source=JSON.parse(projectReleaseJson(`dialogue-curriculum/${c.lessonId}.json`,JSON.stringify(raw))),f=old.fullMaterialize(c,source);
 const o=f.curriculum.objectives.find(o=>o.id===c.objectiveId),t=f.turns.at(-1),p=f.curriculum.passages[0];
 const assessments=c.expected==='demonstrated'?[{objectiveId:o.id,outcome:'demonstrated',rationale:'SYNTHETIC unit only',evidence:o.criteria.map(criterion=>({criterion,turnId:t.id,quote:t.content,passageId:p.id,passageQuote:p.text.slice(0,10)}))}]:[];
 const result={value:{reply:'SYNTHETIC unit only',assessments},model:packet.model,modelVersion:'synthetic-not-provider-proof',usage:{promptTokenCount:100,totalTokenCount:150},verdict:c.expected==='demonstrated'?'demonstrated':'no_assessment',expectedVerdictMatches:true,semanticReviewRequired:true,syntheticOnly:true};
 const attemptId=`${FULL_OPERATION}:${c.id}:1`;
 const row={turn_id:attemptId,session_id:attemptId+':session',student_id:1,session_owner:1,state:'finished',reserved_micros:84000,accounted_micros:reconciledCost(execution.budget,result.usage),created_at:'2026-10-17T12:00:01Z',finished_at:'2026-10-17T12:00:02Z',usage_json:JSON.stringify(result.usage),budget_policy_json:JSON.stringify(execution.budget),details_json:JSON.stringify(result),curriculum_json:JSON.stringify({syntheticOnly:true,caseId:c.id,sourceDigest:c.sourceDigest,rawSourceDigest:c.rawSourceDigest,projectionVersion:packet.projectionVersion,promptDigest:c.promptDigest,packetDigest:packet.sourceDigest,recoveryOf:null})};
 const readback={operation:FULL_OPERATION,caseId:c.id,attempt:1,attemptId,...Object.fromEntries(['sourceCommit','artifactSha256','apisVersion','ownerRef','activationDigest','hardExpiry'].map(k=>[k,execution[k]])),packetDigest:packet.sourceDigest,sourceDigest:c.sourceDigest,promptDigest:c.promptDigest,rawSourceDigest:c.rawSourceDigest,projectionVersion:packet.projectionVersion,history:{reconciled:true,receiptSetDigest:execution.priorReceiptSetDigest},rawRow:row,receiptDigest:await fullReceipt(row),result,call:Object.fromEntries(['state','reserved_micros','accounted_micros','usage_json','created_at','finished_at'].map(k=>[k,row[k]]))};
 const semanticReview={caseId:c.id,receiptDigest:readback.receiptDigest,readbackDigest:await digest(readback),reviewer:'synthetic-only',designationReference:'SYNTHETIC TEST ONLY, no real acceptance',reviewedAt:'2026-10-17T12:01:00Z',verdict:'accepted',...Object.fromEntries(['sourceGrounding','independentEvidence','authorFidelity','teachingQuality'].map(k=>[k,'SYNTHETIC unit test only']))};
 return {readback,execution:structuredClone(execution),semanticReview};
}

test('scoped historical evidence keeps old prompts and produces only an unapplied proposal',async()=>{
 const records=await Promise.all(specs.map(fixture)),before=JSON.stringify(records),curriculum=JSON.stringify(loadCurriculum('lesson-1498'));
 const a=await inspectScopedCalibration(records,objectives),b=await inspectScopedCalibration([...records].reverse(),[...objectives].reverse());
 assert.deepEqual(a,b);assert.equal(a.cases.length,6);assert.equal(a.changes.length,3);
 assert(a.cases.every(c=>c.promptDigest!==c.currentPromptDigest&&c.currentValidatorCompatible&&!c.currentPromptProviderVerified));
 for(const k of ['sourceApplied','releaseAuthorized','paidCallsAuthorized','completeModeAccepted','currentPromptProviderVerified'])assert.equal(a[k],false);
 assert(a.changes.every(c=>!c.applied));assert.equal(JSON.stringify(records),before);assert.equal(JSON.stringify(loadCurriculum('lesson-1498')),curriculum);
});
test('scoping cannot omit a negative case, duplicate a result or add a different objective',async()=>{
 const records=await Promise.all(specs.map(fixture));
 for(const rows of [records.slice(1),[...records.slice(1),records[1]],[...records,{...records[0],readback:{...records[0].readback,caseId:'foreign'}}]])await assert.rejects(inspectScopedCalibration(rows,objectives),/coverage/);
 await assert.rejects(inspectScopedCalibration(records,[...objectives,objectives[0]]),/distinct/);
 await assert.rejects(inspectScopedCalibration(records,['lesson-1498:unknown']),/no original cases/);
});
for(const [label,edit,pattern] of [
 ['execution substitution',r=>r.execution.sourceCommit='a'.repeat(40),/not reviewed/],
 ['receipt alteration',r=>r.readback.rawRow.accounted_micros++,/digest/],
 ['unknown cost',r=>r.readback.rawRow.accounted_micros=null,/cost/],
 ['owner substitution',r=>r.readback.rawRow.session_owner=2,/owner/],
 ['result substitution',r=>r.readback.result.modelVersion='changed',/raw/],
 ['expired receipt',r=>r.readback.rawRow.finished_at=execution.hardExpiry,/window/],
 ['unapproved window',r=>r.execution.hardExpiry='2026-10-20T00:00:00Z',/window/],
 ['missing review',r=>delete r.semanticReview,/review required/],
 ['review points at another receipt',r=>r.semanticReview.receiptDigest='e'.repeat(64),/receipt mismatch/],
 ['review points at another readback',r=>r.semanticReview.readbackDigest='e'.repeat(64),/readback mismatch/],
 ['empty reasoning',r=>r.semanticReview.sourceGrounding='ok',/substantive/],
 ['undesignated review',r=>delete r.semanticReview.designationReference,/provenance/],
 ['premature review',r=>r.semanticReview.reviewedAt=execution.readyAt,/predates/],
])test(label+' fails closed',async()=>{const r=await fixture();edit(r);await assert.rejects(inspectHistoricalCalibration(r),pattern);});
test('current curriculum drift and unreviewed code cannot reuse old calibration',async()=>{
 await assert.rejects(inspectHistoricalCalibration(await fixture(),id=>({...loadCurriculum(id),author:'changed'})),/curriculum changed/);
 await assert.rejects(historicalCalibrationSource('a'.repeat(40)),/not reviewed/);
});
test('rehashed raw records cannot hide usage, cost or source metadata tampering',async()=>{
 for(const [edit,pattern] of [[r=>r.rawRow.usage_json='{}',/usage/],[r=>r.rawRow.accounted_micros=1,/cost/],[r=>r.rawRow.curriculum_json='{}',/source metadata/]]){
  const r=await fixture();edit(r.readback);r.readback.receiptDigest=await fullReceipt(r.readback.rawRow);
  await assert.rejects(inspectHistoricalCalibration(r),pattern);
 }
});
