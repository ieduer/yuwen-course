import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import packet from '../site/dialogue-full-language-packet.json' with {type:'json'};
import {FULL_OPERATION,fullMaterialize,fullReceipt,digest} from '../site/dialogue-full-language.js';
import {reconciledCost} from '../site/dialogue-budget.js';
import {projectReleaseJson} from './build_release_site.mjs';
import {loadCurriculum} from './dialogue_full_language.mjs';
import {inspectCalibrationReadback,inspectCalibrationBatch} from './dialogue_calibration_import.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex');
const execution={sourceCommit:'a'.repeat(40),artifactSha256:'b'.repeat(64),activationDigest:'c'.repeat(64),apisVersion:'11111111-2222-4333-8444-555555555555',ownerRef:sha('dialogue-owner:1'),priorReceiptSetDigest:'d'.repeat(64),readyAt:'2026-10-17T12:00:00Z',hardExpiry:'2026-10-17T18:00:00Z',budget:{version:'synthetic-unit-only',validUntil:'2026-10-17T18:00:00Z',currency:'USD',model:packet.model,globalDailyMicros:50000000,userDailyMicros:50000000,lessonLifetimeMicros:50000000,reserveMicros:84000,inputMicrosPerMillion:750000,outputMicrosPerMillion:3750000,providerAttemptLimit:1,logicalProviderAttemptLimit:1,maxInputTokens:100000,maxOutputTokens:2400}};
// Explicitly synthetic in-memory records. Never persisted or used as real acceptance.
async function fixture(c=packet.cases.find(c=>c.expected!=='demonstrated')){
 const raw=loadCurriculum(c.lessonId),source=JSON.parse(projectReleaseJson(`dialogue-curriculum/${c.lessonId}.json`,JSON.stringify(raw))),f=fullMaterialize(c,source);
 const o=f.curriculum.objectives.find(o=>o.id===c.objectiveId),t=f.turns.at(-1),p=f.curriculum.passages[0];
 const assessments=c.expected==='demonstrated'?[{objectiveId:o.id,outcome:'demonstrated',rationale:'synthetic structural example only',evidence:o.criteria.map(criterion=>({criterion,turnId:t.id,quote:t.content,passageId:p.id,passageQuote:p.text.slice(0,10)}))}]:[];
 const result={value:{reply:'請回到原文核對。',assessments},model:packet.model,modelVersion:'synthetic-unit-not-provider-proof',usage:{promptTokenCount:100,totalTokenCount:150},firstTokenMs:100,totalDurationMs:1000,verdict:c.expected==='demonstrated'?'demonstrated':'no_assessment',expectedVerdictMatches:true,semanticReviewRequired:true,syntheticOnly:true};
 if(o.domain==='shangyou'&&c.expected==='demonstrated'){
  const students=f.turns.filter(t=>t.role==='student'),ref=t=>({turnId:t.id,quote:t.content.slice(0,60)}),e={...ref(students.at(-1)),passageId:p.id,passageQuote:p.text.slice(0,30)};
  result.value.conclusion={studentSummary:'synthetic structural fixture, not semantic acceptance',change:{before:ref(students[0]),after:ref(students.at(-1))},stance:e,domains:['interpretation','vocabulary','technique','transfer','uncertainty'].map(domain=>({domain,finding:'synthetic only',evidence:[e],preservedObjectives:[]}))};
 }
 const attemptId=`${FULL_OPERATION}:${c.id}:1`;
 const row={turn_id:attemptId,session_id:attemptId+':session',student_id:1,session_owner:1,state:'finished',reserved_micros:84000,accounted_micros:reconciledCost(execution.budget,result.usage),created_at:'2026-10-17T12:00:01Z',finished_at:'2026-10-17T12:00:02Z',usage_json:JSON.stringify(result.usage),budget_policy_json:JSON.stringify(execution.budget),details_json:JSON.stringify(result),curriculum_json:JSON.stringify({syntheticOnly:true,caseId:c.id,sourceDigest:c.sourceDigest,rawSourceDigest:c.rawSourceDigest,projectionVersion:packet.projectionVersion,promptDigest:c.promptDigest,packetDigest:packet.sourceDigest,recoveryOf:null})};
 return {operation:FULL_OPERATION,caseId:c.id,attempt:1,attemptId,...Object.fromEntries(['sourceCommit','artifactSha256','apisVersion','ownerRef','activationDigest','hardExpiry'].map(k=>[k,execution[k]])),packetDigest:packet.sourceDigest,sourceDigest:c.sourceDigest,promptDigest:c.promptDigest,rawSourceDigest:c.rawSourceDigest,projectionVersion:packet.projectionVersion,history:{reconciled:true,receiptSetDigest:execution.priorReceiptSetDigest},rawRow:row,receiptDigest:await fullReceipt(row),result,call:Object.fromEntries(['state','reserved_micros','accounted_micros','usage_json','created_at','finished_at'].map(k=>[k,row[k]]))};
}
async function resign(r){r.receiptDigest=await fullReceipt(r.rawRow);r.call=Object.fromEntries(Object.keys(r.call).map(k=>[k,r.rawRow[k]]));r.result=JSON.parse(r.rawRow.details_json);return r;}

test('actual readback shape inspected without source, packet, or evidence mutation',async()=>{
 const r=await fixture(),before=JSON.stringify(r);
 const result=await inspectCalibrationReadback(r,execution);assert.equal(result.semanticReviewRequired,true);assert.equal(result.accountedMicros,263);assert.equal(JSON.stringify(r),before);
});
for(const [label,change,pattern] of [
 ['wrong execution source',r=>r.sourceCommit='e'.repeat(40),/sourceCommit/],
 ['wrong artifact',r=>r.artifactSha256='e'.repeat(64),/artifactSha256/],
 ['wrong APIS',r=>r.apisVersion='aaaaaaaa-2222-4333-8444-555555555555',/apisVersion/],
 ['wrong owner',r=>r.rawRow.student_id=2,/owner/],
 ['stale packet',r=>r.packetDigest='e'.repeat(64),/packet/],
 ['altered raw receipt',r=>r.rawRow.accounted_micros=264,/digest/],
 ['unfinished call',r=>r.rawRow.state='review',/unfinished/],
 ['unknown cost',r=>r.rawRow.accounted_micros=null,/cost/],
 ['unreconciled history',r=>r.history.reconciled=false,/history/],
 ['replayed attempt',r=>r.attempt=2,/attempt/],
 ['after deadline',r=>r.rawRow.finished_at='2026-10-17T18:00:00Z',/window/],
 ['result projection tampering',r=>r.result.modelVersion='different',/raw/],
])test(label+' fails closed',async()=>{const r=await fixture();change(r);await assert.rejects(inspectCalibrationReadback(r,execution),pattern);});

test('rehashed receipt cannot change usage, price, cost, or source metadata',async()=>{
 for(const [edit,pattern] of [[r=>r.rawRow.usage_json='{}',/usage/],[r=>r.rawRow.budget_policy_json='{}',/budget/],[r=>r.rawRow.accounted_micros=1,/cost/],[r=>r.rawRow.curriculum_json='{}',/source metadata/]]){const r=await fixture();edit(r);await resign(r);await assert.rejects(inspectCalibrationReadback(r,execution),pattern);}
});
test('mechanical success flags cannot hide a failed expected verdict',async()=>{
 const c=packet.cases.find(c=>c.expected==='demonstrated'),r=await fixture(c);r.rawRow.details_json=JSON.stringify({...r.result,value:{reply:'很好',assessments:[]},verdict:'no_assessment'});await resign(r);await assert.rejects(inspectCalibrationReadback(r,execution),/expected verdict/);
});
test('source changes fail before importing any result',async()=>{
 const r=await fixture();await assert.rejects(inspectCalibrationReadback(r,execution,id=>({...loadCurriculum(id),author:'changed'})),/raw curriculum/);
});
test('partial or duplicate batches cannot propose an overlay',async()=>{
 const r=await fixture();await assert.rejects(inspectCalibrationBatch([r],execution),/all235/);await assert.rejects(inspectCalibrationBatch(Array(235).fill(r),execution),/duplicate/);
});
test('complete synthetic batch gives only a deterministic review diff, never acceptance',async()=>{
 const rows=[];for(const c of packet.cases)rows.push(await fixture(c));
 const before=fs.readFileSync('site/dialogue-full-language-packet.json'),sources=packet.sourceFiles.map(p=>fs.readFileSync(`site/dialogue-curriculum/${p.lessonId}.json`));
 const a=await inspectCalibrationBatch(rows,execution),b=await inspectCalibrationBatch([...rows].reverse(),execution);
 assert.deepEqual(a,b);assert.equal(a.cases.length,235);assert.equal(a.changes.length,78);assert.equal(a.sourceFiles.length,189);assert.equal(a.sourceChanges.flatMap(c=>c.changedItemIds).length,78);for(const c of a.sourceChanges){assert.notEqual(c.beforeRawDigest,c.proposedRawDigest);assert.notEqual(c.beforeVersion,c.proposedVersion);assert.equal(c.applied,false);assert.deepEqual(c.allowedFields,['languagePractice[].calibrationStatus','curriculumVersion']);}assert.equal(a.reviewRequiredCaseIds.length,235);assert.equal(a.status,'mechanical-pass-semantic-review-required');assert.equal(a.overlayApplied,false);assert.equal(a.paidCallsAuthorized,false);assert.equal(a.releaseAuthorized,false);
 assert.deepEqual(fs.readFileSync('site/dialogue-full-language-packet.json'),before);for(const [i,p] of packet.sourceFiles.entries())assert.deepEqual(fs.readFileSync(`site/dialogue-curriculum/${p.lessonId}.json`),sources[i]);
 rows[0].rawRow.details_json=JSON.stringify({...rows[0].result,modelVersion:'another-version'});await resign(rows[0]);await assert.rejects(inspectCalibrationBatch(rows,execution),/model version drift/);
});

test('CLI failures redact raw parse input and never overwrite an existing file',()=>{
 const output=path.resolve('scripts/test_dialogue_calibration_import.mjs'),before=fs.readFileSync(output);
 for(const args of [['inspect',output,output,output],['inspect',output,output,path.resolve('site/dialogue-curriculum/nonexistent-private-test-output.json')]]){
  const result=spawnSync(process.execPath,['scripts/dialogue_calibration_import.mjs',...args],{encoding:'utf8'});
  assert.equal(result.status,1);assert.equal(result.stdout,'');assert.equal(result.stderr.trim(),'Calibration inspection failed; no acceptance or authorization was created. Inspect the retained inputs locally.');
 }
 assert.deepEqual(fs.readFileSync(output),before);assert.equal(fs.existsSync('site/dialogue-curriculum/nonexistent-private-test-output.json'),false);
});

test('missing token limits or impossible price/reserve policies cannot certify cost',async()=>{
 const r=await fixture();
 for(const edit of [b=>delete b.maxInputTokens,b=>b.maxOutputTokens=9999,b=>b.inputMicrosPerMillion=0,b=>b.outputMicrosPerMillion=99999999,b=>b.userDailyMicros=60000000]){
  const e=structuredClone(execution);edit(e.budget);await assert.rejects(inspectCalibrationReadback(r,e),/bounds|budget|reserve/);
 }
});
