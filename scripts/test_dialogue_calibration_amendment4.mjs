import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {AMENDMENT4_CONTRACT as contract} from '../site/dialogue-calibration-amendment4-contract.js';
import {amendment4Packet} from './dialogue_calibration_amendment4.mjs';
import {buildReleaseSite,projectReleaseJson,RELEASE_JSON_PROJECTION_VERSION} from './build_release_site.mjs';
import {amendment4Budget,amendment4ConservativeMicros,amendment4TerminalDisposition,amendment4Admission,amendment4CaseSourceReadiness,handleAmendment4Calibration} from '../site/dialogue-calibration-amendment4.js';
const corpus=JSON.parse(fs.readFileSync('scripts/dialogue-calibration-amendment4-cases.json'));
const packet=JSON.parse(fs.readFileSync('site/dialogue-calibration-amendment4-packet.json'));
const load=id=>JSON.parse(fs.readFileSync(`site/dialogue-curriculum/${id}.json`));
const hex='a'.repeat(64),now=Date.parse('2026-10-13T04:10:00Z');
const authority={...contract,status:'approved',active:true,paidCallsAuthorized:true,approvalDigest:contract.authorityDigest,registryReceiptDigest:hex,priorReceiptSetDigest:hex,readyAt:'2026-10-13T02:18:00Z',approvedNewAttempts:56,approvedNewReservedMicros:4704000};
const history={attempts:7,reservedMicros:588000,knownMicros:10267,unknownReservedMicros:420000,allReceiptsReconciled:true,receiptSetDigest:hex};
const capacity={userDayCalls:3,globalDayCalls:3,reservedConcurrentCalls:0,userDayConservativeMicros:173589,globalDayConservativeMicros:173589};
const row=(caseId=packet.cases[0].id)=>({caseId,attemptId:contract.operation+':'+caseId+':1',receiptDigest:hex,state:'review',createdAt:'2026-10-13T04:01:00Z',finishedAt:'2026-10-13T04:02:00Z',accountedMicros:null,reservedMicros:84000,chunkCount:0,partialChars:0,finalAssessment:false});
const fact=r=>({attemptId:r.attemptId,requestId:r.attemptId,receiptDigest:r.receiptDigest,caseId:r.caseId,kind:'provider503',providerStatus:503,providerAttemptCount:1,brokerCompleted:true,noOutput:true,model:contract.model,fallback:false,hedge:false,backgroundCalls:0,retryAfterMs:1000,evidenceRef:'synthetic-only/terminal.json',evidenceSha256:hex,invocationHash:hex});
const plan=extra=>amendment4Admission({packet,history,capacity,caseId:packet.cases[0].id,now,authority,...extra});

test('authorized contract and routable endpoint cannot activate or spend from request fields',async()=>{
 assert.equal(contract.active,false);assert.equal(contract.paidCallsAuthorized,true);assert.equal(contract.approvedNewAttempts,56);
 assert.equal(amendment4Admission({packet,history,caseId:packet.cases[0].id,now}).code,'amendment4_approval_required');
 let calls=0;const r=handleAmendment4Calibration(new Request('https://example.test',{method:'POST',body:JSON.stringify(authority)}),{}, {},()=>calls++,{authority});
 assert.equal(r.status,409);assert.equal((await r.json()).active,false);assert.equal(calls,0);
});
test('28-case new packet is deterministic and source pinned; original packet is byte unchanged',()=>{
 // Hash the complete representation so a stale source failure does not dump
 // megabytes of lesson text or prompts into the task history.
 const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
 assert.equal(hash(amendment4Packet(corpus,load)),hash(packet),'new proposal must be refreshed after source writers freeze');
 assert.equal(packet.sourceDigest,contract.packetDigest);assert.equal(packet.active,false);
 assert.equal(crypto.createHash('sha256').update(fs.readFileSync('site/dialogue-calibration-packet.json')).digest('hex'),corpus.caseCorrection.previousPacketFileSha256);
 assert.notEqual(packet.sourceDigest,corpus.caseCorrection.previousPacketDigest);
 assert.deepEqual(packet.cases.slice(0,24).map(c=>c.id),corpus.caseCorrection.preservedOriginalCaseIds);
 assert.equal(new Set(packet.cases.map(c=>c.id)).size,28);
});
test('case 1 asks and answers the third example without weakening the rubric or rewriting old result',()=>{
 const c=packet.cases[0];assert.match(c.question.question,/君子博學而日參省乎己/);assert.match(c.studentAnswer,/博学而日参省乎己/);
 assert.deepEqual(c.rubricCoverage.criteria,['context_meaning','explanation','independent']);
 const old=JSON.parse(fs.readFileSync('site/dialogue-calibration-packet.json')).cases[0];
 assert.equal(old.studentAnswer,c.caseCorrection.oldStudentAnswer);assert.equal(old.promptDigest,c.caseCorrection.oldPromptDigest);
 assert(!old.studentAnswer.includes('博学而日参省乎己'));assert(c.caseCorrection.doesNotRewriteOldReceipt);
});
test('all28 pins match released curriculum and packet bytes, with separate raw provenance',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'yw-amendment4-projection-test-'));
 try{
  const sourceRoot=path.join(root,'source'),releaseRoot=path.join(root,'release');
  fs.mkdirSync(path.join(sourceRoot,'dialogue-curriculum'),{recursive:true});
  for(const id of new Set(packet.cases.map(c=>c.lessonId)))fs.copyFileSync(`site/dialogue-curriculum/${id}.json`,path.join(sourceRoot,'dialogue-curriculum',id+'.json'));
  fs.copyFileSync('site/dialogue-calibration-amendment4-packet.json',path.join(sourceRoot,'dialogue-calibration-amendment4-packet.json'));
  buildReleaseSite({sourceRoot,releaseRoot,releaseKind:'preview-web-only'});
  const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
  assert.equal(fs.readFileSync(path.join(releaseRoot,'dialogue-calibration-amendment4-packet.json'),'utf8'),fs.readFileSync('site/dialogue-calibration-amendment4-packet.json','utf8'));
  let changed=0;
  for(const c of packet.cases){
   const released=JSON.parse(fs.readFileSync(path.join(releaseRoot,'dialogue-curriculum',c.lessonId+'.json')));
   assert.equal(c.sourceDigest,hash(released),c.id);
   assert.equal(c.rawSourceDigest,hash(load(c.lessonId)),c.id);
   assert.equal(c.sourceProjectionVersion,RELEASE_JSON_PROJECTION_VERSION);
   assert.equal(c.promptDigest,hash(c.prompt));
   assert.equal(c.caseDefinitionDigest,hash(corpus.cases.find(s=>s.id===c.id)));
   if(c.sourceDigest!==c.rawSourceDigest){changed++;assert.equal(c.lessonId,'lesson-1498');}
  }
  assert.equal(changed,6);
  assert.equal(packet.caseCorrection.deployProjectionCorrection.noSemanticPassClaimed,true);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('proposal refuses a question that release projection would rewrite',()=>{
 const unsafe=structuredClone(corpus);
 unsafe.cases[0].studentAnswer+=' https://bdfz.yuque.com/unsafe';
 assert.throws(()=>amendment4Packet(unsafe,load),/amendment4_packet_projection_not_fixed/);
 assert.equal(projectReleaseJson('packet.json',JSON.stringify(packet)),JSON.stringify(packet));
});
test('every original and additional question has exact criterion and source coverage; missing coverage fails preparation',()=>{
 for(const c of packet.cases){const o=c.curriculum.objectives.find(o=>o.id===c.objectiveId);assert.deepEqual(c.rubricCoverage.criteria,o.criteria);for(const k of o.criteria)assert(c.validationQuestion.includes(c.rubricCoverage.questionEvidence[k]));assert(c.prompt.includes(c.validationQuestion));}
 const bad=structuredClone(corpus);delete bad.cases[0].rubricCoverage.questionEvidence.independent;
 assert.throws(()=>amendment4Packet(bad,load),/question_rubric_coverage_missing/);
 const fake=structuredClone(corpus);fake.cases[27].rubricCoverage.sourceAnchors[0].quote='invented-source';assert.throws(()=>amendment4Packet(fake,load),/unverified_source_anchor/);
});
test('four requested additions use current prose/source-guide curricula and do not promote dictionary source status',()=>{
 assert.deepEqual(packet.cases.slice(24).map(c=>c.objectiveId),['lesson-1717-p2:context','lesson-1717-p2:structure','lesson-1717-p2:transfer','lesson-1690:context']);
 assert.equal(packet.cases[27].curriculum.mode,'unit-intro');assert.equal(packet.cases[27].curriculum.sourceStatus,'source-ready');
 assert.equal(packet.cases[25].rubricCoverage.sourceAnchors.length,2);assert.match(packet.cases[26].validationQuestion,/不得編造高考年份/);
 assert(load('lesson-1711-p1').languagePractice.every(c=>c.calibrationStatus==='pending-real-model'));
});
test('precise base and one-recovery-per-case budgets keep the remaining 23 attempts visible',()=>{
 assert.deepEqual(amendment4Budget(),{baseCases:28,recoveryCases:0,newAttempts:28,newReservedMicros:2352000,inheritedRemainingAttempts:23,inheritedRemainingReservedMicros:1932000,extraAttempts:5,extraReservedMicros:420000,cumulativeAttempts:35,cumulativeReservedMicros:2940000});
 const all=amendment4Budget(28,28);assert.equal(all.newAttempts,56);assert.equal(all.extraAttempts,33);assert.equal(all.extraReservedMicros,2772000);assert.equal(all.newReservedMicros,4704000);assert.equal(all.cumulativeAttempts,63);assert.equal(all.cumulativeReservedMicros,5292000);
 assert.throws(()=>amendment4Budget(28,29),/budget_invalid/);
});
test('unknown usage always retains 84000 including partial output; known usage never erases other reservations',()=>{
 const r=row();r.chunkCount=4;r.partialChars=100;assert.equal(amendment4ConservativeMicros([r,{...row(packet.cases[1].id),accountedMicros:5589}]),89589);
 assert.throws(()=>amendment4ConservativeMicros([{...r,reservedMicros:0}]),/ledger_invalid/);
});
test('independent case can start after another case is unconfirmed, rejected, inflight or cooling down',()=>{
 for(const state of ['review','reserved','finishing']){const r={...row(),state};const p=plan({rows:[r],caseId:packet.cases[27].id});assert.equal(p.allowed,true);assert.equal(p.attempt,1);assert.equal(p.maxProviderAttempts,1);}
 const r=row();assert.equal(plan({rows:[r],caseId:r.caseId,recoveryOf:r.attemptId}).code,'amendment4_terminal_readback_required');
});
test('any source-ready fixed case may be first; pending source blocks only its own cases',()=>{
 for(const c of packet.cases){const p=plan({caseId:c.id});assert.equal(p.allowed,c.sourceReadiness.eligible);if(!p.allowed){assert.equal(p.scope,'case');assert.equal(p.code,'amendment4_case_source_verification_required');}}
 assert.deepEqual(packet.sourceReadiness.blockedCases,[]);
 assert.equal(packet.sourceReadiness.eligibleCases.length,28);
});
for(const kind of ['provider503','fetch_error_empty','fetch_error_partial','stream_interrupted'])test(kind+' recovery requires terminal proof and one new full reservation',()=>{
 const r=row(),f=fact(r);if(kind.startsWith('fetch_error')){f.kind='fetch_error';f.providerStatus='FETCH_ERROR';}
 if(kind.endsWith('partial')||kind==='stream_interrupted'){r.chunkCount=4;r.partialChars=130;f.noOutput=false;f.partialOutput=true;}
 if(kind==='stream_interrupted'){f.kind=kind;f.terminal=true;}
 assert.equal(amendment4TerminalDisposition(r,[f]),f);
 const p=plan({rows:[r],recoveryOf:r.attemptId,readbacks:[f]});assert.equal(p.allowed,true);assert.equal(p.attempt,2);assert.equal(p.reserveMicros,84000);assert.equal(r.accountedMicros,null);
});
for(const [key,value] of [['brokerCompleted',false],['fallback',true],['hedge',true],['backgroundCalls',1],['providerAttemptCount',2],['model','wrong'],['receiptDigest','b'.repeat(64)],['caseId','wrong'],['requestId','wrong'],['evidenceSha256','bad'],['invocationHash','bad']])test('same-case recovery rejects invalid '+key,()=>{
 const r=row(),f={...fact(r),[key]:value};assert.equal(amendment4TerminalDisposition(r,[f]),null);assert.equal(plan({rows:[r],recoveryOf:r.attemptId,readbacks:[f]}).allowed,false);
 assert.equal(plan({rows:[r],caseId:packet.cases[1].id,readbacks:[f]}).allowed,true);
});
test('partial output is not no-output 503, missing final-assessment state is not terminal evidence',()=>{
 const r={...row(),chunkCount:1,partialChars:6};assert.equal(amendment4TerminalDisposition(r,[fact(r)]),null);
 const missing=row();delete missing.finalAssessment;assert.equal(amendment4TerminalDisposition(missing,[fact(missing)]),null);
});
test('one recovery ceiling survives intervening cases and never resets',()=>{
 const r=row(),second={...r,attemptId:r.attemptId.replace(/:1$/,':2')};
 assert.equal(plan({rows:[r,row(packet.cases[1].id),second],recoveryOf:second.attemptId,readbacks:[fact(second)]}).code,'amendment4_case_recovery_exhausted');
 assert.equal(plan({rows:[{...r,state:'finished'}],recoveryOf:r.attemptId}).code,'amendment4_case_already_finished');
});
test('case cooldown obeys larger provider delay but cannot stop other cases',()=>{
 const r=row(),f={...fact(r),retryAfterMs:900000};assert.equal(plan({rows:[r],recoveryOf:r.attemptId,readbacks:[f]}).code,'amendment4_case_cooldown');
 assert.equal(plan({rows:[r],caseId:packet.cases[1].id,readbacks:[f]}).allowed,true);
});
test('diagnosed semantic recovery cannot disguise a new question or packet as the old case',()=>{
 const r={...row(),accountedMicros:5589,finalAssessment:true},f={...fact(r),kind:'semantic_correction',noOutput:false,diagnosis:'wrong transport formatting',correction:'apply the unchanged pinned schema',changesPinnedCase:false};
 assert.equal(plan({rows:[r],recoveryOf:r.attemptId,readbacks:[f]}).allowed,true);
 assert.equal(amendment4TerminalDisposition(r,[{...f,changesPinnedCase:true}]),null);
});
test('finite synthetic allowance preserves shared dollars, global count and concurrency capacity',()=>{
 assert.equal(plan({capacity:undefined}).code,'amendment4_capacity_readback_required');
 for(const change of [{globalDayCalls:400},{reservedConcurrentCalls:4},{globalDayConservativeMicros:50000000}])assert.equal(plan({capacity:{...capacity,...change}}).code,'amendment4_shared_capacity_exhausted');
 assert.equal(plan({capacity:{...capacity,userDayCalls:39}}).allowed,true);assert.equal(plan({capacity:{...capacity,userDayCalls:40}}).allowed,true);
});
test('global credential/model boundary, budget, historical receipts and fixed expiry still stop the operation',()=>{
 assert.equal(plan({rows:[{...row(),boundaryStop:true}],caseId:packet.cases[1].id}).scope,'operation');
 assert.equal(plan({history:{...history,allReceiptsReconciled:false}}).code,'amendment4_history_reconciliation_required');
 assert.equal(plan({authority:{...authority,approvedNewAttempts:23,approvedNewReservedMicros:1932000}}).code,'amendment4_budget_approval_insufficient');
 assert.equal(plan({now:Date.parse('2026-10-13T02:17:59Z')}).code,'amendment4_candidate_not_ready');assert.equal(plan({now:Date.parse('2026-10-13T02:18:00Z')}).allowed,true);assert.equal(plan({now:Date.parse('2026-10-13T08:00:00Z')}).allowed,true);
 for(const at of ['2026-10-13T12:00:00Z'])assert.equal(plan({now:Date.parse(at)}).code,'amendment4_window_closed');
 const rows=packet.cases.map(c=>row(c.id));assert.equal(plan({rows,authority:{...authority,approvedNewAttempts:28,approvedNewReservedMicros:2352000}}).code,'amendment4_budget_exhausted');
});

test('source review is preserved; only one target calibration status may be hypothetical',()=>{
 for(const c of packet.cases){const source=load(c.lessonId);assert.deepEqual(c.curriculum.dictionary,source.dictionary);for(const item of c.curriculum.languagePractice||[]){const original=source.languagePractice.find(x=>x.id===item.id);assert.deepEqual(item.sourceVerification,original.sourceVerification);if(item.id!==c.objectiveId||!c.sourceReadiness.eligible)assert.equal(item.calibrationStatus,original.calibrationStatus);else assert.equal(item.calibrationStatus,'accepted');}}
});
test('pending/missing grammar and dictionary source cannot be promoted in offline preparation or paid admission',()=>{
 for(const change of ['pending','missing','dictionary']){
  const loadChanged=id=>{const c=load(id);if(id==='lesson-1711-p1'){const item=c.languagePractice.find(x=>x.id==='lesson-1711-p1:grammar-water');if(change==='pending')item.sourceVerification={status:'pending-verification'};if(change==='missing')delete item.sourceVerification;if(change==='dictionary')c.dictionary.find(x=>x.id==='xc-er').verificationStatus='image-review-pending';}return c;};
  const projected=amendment4Packet(corpus,loadChanged),target=projected.cases.find(c=>c.id===(change==='dictionary'?'language-er-independent':'grammar-water-independent'));
  assert.equal(target.sourceReadiness.eligible,false);assert.equal(target.curriculum.languagePractice.find(x=>x.id===target.objectiveId).calibrationStatus,'pending-real-model');assert.equal(target.fixtureOverrides.calibrationProjection,null);
  const gated=structuredClone(packet);gated.cases[gated.cases.findIndex(c=>c.id===target.id)]=target;
  const admission=plan({packet:gated,caseId:target.id});assert.equal(admission.code,'amendment4_case_source_verification_required');assert.equal(admission.scope,'case');assert.equal(plan({packet:gated,caseId:'hetang-initial-response'}).allowed,true);
 }
});
test('all28 questions and complete earlier synthetic turns survive prompt construction',()=>{
 for(const c of packet.cases){assert(c.caseDefinitionDigest);assert(c.prompt.includes(c.validationQuestion));for(const t of c.turns)assert(c.prompt.includes(t.content),'lost '+c.id+':'+t.id);}
 assert.equal(packet.caseCorrection.preExecutionSourceConvergence.noSemanticPassClaimed,true);
});
