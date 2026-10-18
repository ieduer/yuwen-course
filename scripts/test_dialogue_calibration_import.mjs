import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync,execFileSync} from 'node:child_process';
import path from 'node:path';
import packet from '../site/dialogue-full-language-packet.json' with {type:'json'};
import {FULL_OPERATION,ORIGINAL_RECEIPTS,fullMaterialize,fullReceipt,digest} from '../site/dialogue-full-language.js';
import {reconciledCost} from '../site/dialogue-budget.js';
import {projectReleaseJson,buildReleaseSite} from './build_release_site.mjs';
import {loadCurriculum} from './dialogue_full_language.mjs';
import {inspectCalibrationReadback,inspectCalibrationBatch,materializeCalibrationOverlay,stageCalibrationOverlay} from './dialogue_calibration_import.mjs';
import {prepareRenewedPlan,validateRenewedExecution,RenewedE2ERunner,OPERATION} from './dialogue_e2e_renewal.mjs';
import {sanitizeDialogueCurriculum} from '../site/dialogue-public-curriculum.js';
import {E2E_LESSONS} from '../site/dialogue-e2e-admission.js';
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
 const r=await fixture();await assert.rejects(inspectCalibrationBatch([r],execution),/all28/);await assert.rejects(inspectCalibrationBatch(Array(28).fill(r),execution),/duplicate/);
});
test('complete synthetic batch gives only a deterministic review diff, never acceptance',async()=>{
 const rows=[];for(const c of packet.cases.filter(c=>c.group==='representative-28'))rows.push(await fixture(c));
 const before=fs.readFileSync('site/dialogue-full-language-packet.json'),sources=packet.sourceFiles.map(p=>fs.readFileSync(`site/dialogue-curriculum/${p.lessonId}.json`));
 const a=await inspectCalibrationBatch(rows,execution),b=await inspectCalibrationBatch([...rows].reverse(),execution);
 assert.deepEqual(a,b);assert.equal(a.cases.length,28);assert.equal(a.changes.length,9);assert.equal(a.sourceFiles.length,189);assert.equal(a.sourceChanges.flatMap(c=>c.changedItemIds).length,9);for(const c of a.sourceChanges){assert.notEqual(c.beforeRawDigest,c.proposedRawDigest);assert.notEqual(c.beforeVersion,c.proposedVersion);assert.equal(c.applied,false);assert.deepEqual(c.allowedFields,['languagePractice[].calibrationStatus','curriculumVersion']);}assert.equal(a.reviewRequiredCaseIds.length,28);assert.equal(a.status,'mechanical-pass-semantic-review-required');assert.equal(a.overlayApplied,false);assert.equal(a.paidCallsAuthorized,false);assert.equal(a.releaseAuthorized,false);
 assert.deepEqual(fs.readFileSync('site/dialogue-full-language-packet.json'),before);for(const [i,p] of packet.sourceFiles.entries())assert.deepEqual(fs.readFileSync(`site/dialogue-curriculum/${p.lessonId}.json`),sources[i]);
 await assert.rejects(materializeCalibrationOverlay(packet.sourceFiles.map(p=>loadCurriculum(p.lessonId)),a),/all28 semantic/);
 a.semanticReviews=a.cases.map(c=>({caseId:c.caseId,receiptDigest:c.receiptDigest,readbackDigest:c.readbackDigest,reviewer:'suen',reviewedAt:'2026-10-17T01:00:00Z',verdict:'accepted',sourceGrounding:'SYNTHETIC TEST ONLY source evidence',independentEvidence:'SYNTHETIC TEST ONLY learner evidence',authorFidelity:'SYNTHETIC TEST ONLY author fidelity',teachingQuality:'SYNTHETIC TEST ONLY teaching review'}));
 for(const edit of [x=>x.semanticReviews.pop(),x=>x.semanticReviews[0].reviewer='not-designated',x=>x.semanticReviews[0].verdict='pending',x=>x.semanticReviews[0].readbackDigest='e'.repeat(64),x=>x.semanticReviews[0].teachingQuality='']){const unreviewed=structuredClone(a);edit(unreviewed);await assert.rejects(materializeCalibrationOverlay(packet.sourceFiles.map(p=>loadCurriculum(p.lessonId)),unreviewed));}
 const bases=packet.sourceFiles.map(p=>loadCurriculum(p.lessonId)),overlaid=await materializeCalibrationOverlay(bases,a);
 for(const [i,next] of overlaid.entries()){
  const before=bases[i],masked=structuredClone(next);masked.curriculumVersion=before.curriculumVersion;
  for(const item of masked.languagePractice)item.calibrationStatus=before.languagePractice.find(x=>x.id===item.id).calibrationStatus;
  assert.deepEqual(masked,before,'only status and curriculum version may differ');
 }
 for(const edit of [x=>x.changes.pop(),x=>x.changes[0].itemDigest='e'.repeat(64),x=>x.changes[0].to='rejected',x=>x.sourceChanges[0].proposedRawDigest='e'.repeat(64),x=>x.sourceChanges[0].allowedFields.push('scores'),x=>x.cases.pop(),x=>x.cases[0].promptDigest='e'.repeat(64),x=>x.cases[0].caseId='unrelated',x=>x.accountedMicros++]){
  const changed=structuredClone(a);edit(changed);await assert.rejects(materializeCalibrationOverlay(bases,changed));
 }
 const deferredRaw=bases.find(c=>c.languagePractice.some(v=>v.sourceEvidence)),deferredItem=deferredRaw.languagePractice.find(v=>v.sourceEvidence);
 const forged=structuredClone(a);forged.changes[0]={lessonId:deferredRaw.lessonId,objectiveId:deferredItem.id,itemVersion:deferredItem.version,itemDigest:sha(JSON.stringify(deferredItem)),caseIds:[],receiptDigests:[],from:'pending-real-model',to:'accepted'};
 await assert.rejects(materializeCalibrationOverlay(bases,forged),/deferred item/);
 const overlaidById=new Map(overlaid.map(c=>[c.lessonId,c])),currentLoader=id=>overlaidById.get(id),prepared=await prepareRenewedPlan(a,currentLoader);
 assert.equal(prepared.plan.operation,OPERATION);assert.equal(prepared.plan.budget.firstPassCallRows,44);assert.equal(prepared.plan.caps.hardExpiry,null);
 await assert.rejects(prepareRenewedPlan(a),/reviewed overlay/);
 const altered=structuredClone(overlaidById.get('lesson-1717-p2'));altered.title+='drift';await assert.rejects(prepareRenewedPlan(a,id=>id===altered.lessonId?altered:currentLoader(id)),/base drift|source changed/);
 const origin='https://yw-acceptance.bdfz.net',database='c45988a6-9094-4306-bcce-98704b3989e3',H=execution.activationDigest;
 const full={version:'yw-full-language-activation-v1',enabled:true,operation:FULL_OPERATION,authorityDigest:H,packetDigest:packet.sourceDigest,sourceCommit:execution.sourceCommit,artifactSha256:execution.artifactSha256,origin,ownerUserId:553,databaseId:database,apisVersion:execution.apisVersion,registryReceiptDigest:H,singleProviderSourceProofDigest:H,priorReceiptSetDigest:execution.priorReceiptSetDigest,priorReceipts:[...ORIGINAL_RECEIPTS],readyAt:execution.readyAt,hardExpiry:execution.hardExpiry,maxAttempts:28,maxReservedMicros:2352000,maxProviderAttempts:1,reserveMicros:84000,maxConcurrency:1,recoveryReadbacks:[]};
 const admission={version:'yw-isolated-e2e-admission-v2',enabled:true,operation:OPERATION,authorityDigest:H,origin,ownerUserId:553,databaseId:database,apisVersion:execution.apisVersion,registryReceiptDigest:H,hardExpiry:execution.hardExpiry,maxVisibleCalls:120,maxProviderAttempts:3,reserveMicros:252000,lessonIds:[...E2E_LESSONS]};
 const bindings={YW_ACCEPTANCE_USER_ID:'553',YW_ACCEPTANCE_EXPIRES_AT:execution.hardExpiry,YW_ACCEPTANCE_DATABASE_ID:database,YW_FORMAL_APIS_VERSION:execution.apisVersion,YW_ACCEPTANCE_ACTIVATION_SHA256:H,YW_FULL_LANGUAGE_ACTIVATION_SHA256:H,YW_CALIBRATION_FULL_LANGUAGE_JSON:JSON.stringify(full),YW_E2E_AUTHORITY_JSON:JSON.stringify(admission)};
 const cfg={operation:OPERATION,origin,ownerRef:execution.ownerRef,sourceCommit:'e'.repeat(40),artifactSha256:'f'.repeat(64),pagesDeploymentId:'synthetic-only',planDigest:sha(JSON.stringify(prepared.plan)),fixtureDigest:prepared.plan.fixtureDigest,syntheticOnly:true,centralWritesDisabled:true,checks:Object.fromEntries(['staticChecks','ci','isolatedSourceReadback','sameOwnerAuthentication','providerAttemptContract','isolated120AdmissionReadback'].map(k=>[k,'accepted'])),lessonIds:[...E2E_LESSONS],providerAttemptLimit:3,reserveMicrosPerCall:252000,maxVisibleCalls:120,maxReserveMicros:30240000,maxHttpRequests:6500,apisVersion:execution.apisVersion,isolatedDatabaseId:database,expiresAt:execution.hardExpiry,calibrationPins:execution,activationBindings:bindings};
 const now=Date.parse(execution.readyAt)+10000;assert(validateRenewedExecution(cfg,prepared.plan,now));
 for(const edit of [c=>c.operation='yw-e2e-real-dialogue-01a132c3',c=>c.maxVisibleCalls=121,c=>c.ownerRef='f'.repeat(64),c=>c.calibrationPins.sourceCommit='f'.repeat(40),c=>c.lessonIds.pop(),c=>c.activationBindings.YW_E2E_AUTHORITY_JSON=JSON.stringify({...admission,operation:'yw-e2e-real-dialogue-01a132c3'}),c=>c.expiresAt='2030-01-01T00:00:00Z']){const changed=structuredClone(cfg);edit(changed);assert.throws(()=>validateRenewedExecution(changed,prepared.plan,now));}
 assert.throws(()=>validateRenewedExecution(cfg,prepared.plan,Date.parse(execution.hardExpiry)),/expired|activation/);
 const readbacks=[],record=[];let posts=0;
 const fetchImpl=async(url,opt={})=>{const u=new URL(url),id=u.searchParams.get('lessonId');if(u.searchParams.has('calibration')){assert.equal(opt.method,'GET');readbacks.push(u.searchParams.get('calibration'));return Response.json(rows.find(r=>r.caseId===u.searchParams.get('calibration')));}
  assert.equal(readbacks.length,28,'all28 receipts precede ordinary route');if(u.pathname.includes('dialogue-curriculum'))return Response.json(sanitizeDialogueCurriculum(currentLoader(path.basename(u.pathname,'.json'))));
  if(opt.method==='POST'){posts++;assert.equal(JSON.parse(opt.body).operation,'state');return Response.json({ownerRef:execution.ownerRef,markCount:0,submitted:false});}
  return Response.json({ownerRef:execution.ownerRef,turns:[],state:{objectives:currentLoader(id).objectives.map(o=>({...o,status:'not_yet_observed'}))}});
 };
 const runner=new RenewedE2ERunner({...prepared,inspection:a,loader:currentLoader,config:cfg,cookie:'bdfz_uc_session=synthetic-only',clock:()=>now,record:e=>record.push(e),fetchImpl});await runner.preflight();assert.equal(readbacks.length,28);assert.equal(posts,1);assert.equal(record[0].operation,OPERATION);assert.equal(record.filter(r=>r.type==='http_intent').length,runner.httpRequests);runner.httpRequests=6500;await assert.rejects(runner.snapshot('lesson-1498'),/HTTP allowance/);
 const drifted=structuredClone(a);drifted.cases[0].receiptDigest='f'.repeat(64);assert.throws(()=>new RenewedE2ERunner({...prepared,inspection:drifted,config:cfg,cookie:'bdfz_uc_session=synthetic-only',clock:()=>now,record:()=>{}}),/reviewed input/);
 // Caller registers the exact scratch root in its task artifact manifest.
 const scratch=process.env.YW_OVERLAY_TEST_ROOT;assert(scratch&&path.isAbsolute(scratch)&&fs.statSync(scratch).isDirectory(),'set YW_OVERLAY_TEST_ROOT to an owned existing scratch directory');
 const stage=path.join(scratch,'overlay-stage'),release=path.join(scratch,'overlay-release');
 assert(!fs.existsSync(stage)&&!fs.existsSync(release));
 const original=new Map();let staged;
 try{
  staged=await stageCalibrationOverlay(a,stage);assert.equal(staged.releaseAuthorized,false);assert.equal(staged.files.length,a.sourceChanges.length+2);
  await assert.rejects(stageCalibrationOverlay(a,stage),/new absolute/);
  for(const f of staged.files){const file=path.resolve(f.path);original.set(file,fs.existsSync(file)?fs.readFileSync(file):null);fs.writeFileSync(file,fs.readFileSync(path.join(stage,f.path)));}
  execFileSync(process.execPath,['scripts/build_dialogue_curriculum.mjs','--check'],{encoding:'utf8',stdio:'pipe'});
  const built=buildReleaseSite({sourceRoot:path.resolve('site'),releaseRoot:release});assert(built);console.log(JSON.stringify({evidence:'synthetic-overlay-build-only',stagedFiles:staged.files.length,changedLessons:a.sourceChanges.length,languageItems:a.changes.length,artifactFiles:built.artifactFiles,releaseAuthorized:false}));
  assert(!fs.existsSync(path.join(release,'scripts/dialogue-calibration-overlay.json')),'private review evidence cannot publish');
  const module=fs.readFileSync(path.join(release,'_worker.js/dialogue-full-language-packet.json.js'));
  const frozen=(await import('data:text/javascript;base64,'+module.toString('base64'))).default;
  assert.deepEqual(frozen,packet,'consumed packet is immutable after overlay build');
  const builtIndex=JSON.parse(fs.readFileSync(path.join(release,'dialogue-curriculum/index.json')));
  for(const change of a.sourceChanges)assert.equal(builtIndex.lessons.find(l=>l.lessonId===change.lessonId).curriculumVersion,change.proposedVersion);
 }finally{
  for(const [file,bytes] of original)if(bytes===null)fs.rmSync(file);else fs.writeFileSync(file,bytes);
  fs.rmSync(stage,{recursive:true,force:true});fs.rmSync(release,{recursive:true,force:true});fs.rmSync(release+'.pending-'+process.pid,{recursive:true,force:true});
 }
 assert(!fs.existsSync(stage)&&!fs.existsSync(release));
 for(const [i,p] of packet.sourceFiles.entries())assert.deepEqual(fs.readFileSync(`site/dialogue-curriculum/${p.lessonId}.json`),sources[i]);
 assert.deepEqual(fs.readFileSync('site/dialogue-full-language-packet.json'),before);
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
