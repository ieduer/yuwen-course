// Offline evidence reuse only. No execution, live writes, or source mutation.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import * as esbuild from 'esbuild';
import packet from '../site/dialogue-full-language-packet.json' with {type:'json'};
import {fullMaterialize,releaseCases,digest} from '../site/dialogue-full-language.js';
import {POLICY,RULE_VERSION,validateProposal} from '../site/dialogue-policy.js';
import {projectReleaseJson} from './build_release_site.mjs';
import {loadCurriculum} from './dialogue_full_language.mjs';
import {CALIBRATION_STATUS_VERSION} from '../site/dialogue-calibration-status.js';

const root=path.resolve(import.meta.dirname,'..'),sha=x=>createHash('sha256').update(x).digest('hex');
const snapshots=new Map();
const reviewedSources=['2bd882345cdaab319157905a7de160f374c3e1f0','84065f31c2fd9882b06618a51155f6dc7fa0d164'];
// This later offline checker added the already-approved deadline exception;
// the provider's original source and prompt are still reconstructed separately.
const reviewedVerifier='de20dcd4f963cf82d42d39bf0b965006c973a81f';
const require=createRequire(import.meta.url);
// Reviewed deltas: (v11) allow retaining original-answer quotations during continuous vocabulary conversation;
// (v12, 2026-10-21, suen's correction directive) first-person persona without repeated disclaimers, discussion-first
// replies, explicit recognition of a correct answer, merged learningTargets guidance, sourceDraft during an active
// question. Neither delta changes a language criterion, an evidence rule or a verdict (lines 30-33 and the JSON /
// evidence paragraphs are byte-identical to v11).
const policyBridge={before:'b30b2257fec87625920f648797d8b89b6b9495c9e258599b54bfe800d041917c',after:'154228771fab98e54a9660dd9e88d28e02f195009db964c974e59d81377c1fb9'};

export async function historicalCalibrationSource(commit){
 assert(/^[a-f0-9]{40}$/.test(commit||''),'exact historical commit required');
 assert([...reviewedSources,reviewedVerifier].includes(commit),'historical verifier source not reviewed');
 if(!snapshots.has(commit))snapshots.set(commit,(async()=>{
  execFileSync('git',['merge-base','--is-ancestor',commit,'HEAD'],{cwd:root,stdio:'pipe'});
  const inputs=[];
  const bundle=await esbuild.build({stdin:{contents:"export {inspectCalibrationReadback} from './scripts/dialogue_calibration_import.mjs'; export {fullMaterialize} from './site/dialogue-full-language.js'; export * as fullLanguage from './site/dialogue-full-language.js'; export {POLICY,RULE_VERSION,validateProposal} from './site/dialogue-policy.js';",resolveDir:root,sourcefile:'historical-calibration-entry.js'},bundle:true,write:false,platform:'node',format:'esm',logLevel:'silent',define:{'import.meta.dirname':JSON.stringify(path.join(root,'scripts'))},plugins:[{name:'immutable-git-calibration',setup(build){
   build.onResolve({filter:/.*/},args=>{
    if(args.path.startsWith('node:'))return {path:args.path,external:true};
    if(args.path==='esbuild')return {path:pathToFileURL(require.resolve('esbuild')).href,external:true};
    assert(args.path.startsWith('.'),'historical external dependency unavailable: '+args.path);
    const file=path.posix.normalize(path.posix.join(args.namespace==='historical-git'?path.posix.dirname(args.importer):'',args.path));
    assert(/^(site|scripts)\/[\w./-]+\.(js|mjs|json)$/.test(file)&&!file.includes('../'),'historical source path invalid');
    return {path:file,namespace:'historical-git'};
   });
   build.onLoad({filter:/.*/,namespace:'historical-git'},async args=>{
    const bytes=execFileSync('git',['show',commit+':'+args.path],{cwd:root,maxBuffer:20*1024*1024,stdio:['ignore','pipe','pipe']});
    inputs.push({path:args.path,sha256:sha(bytes)});
    if(args.path.endsWith('.json'))return {contents:bytes.toString(),loader:'json'};
    // Preserve each source module's local file location when bundled in memory.
    const location=path.join(root,args.path);
    const compiled=await esbuild.transform(bytes.toString(),{loader:'js',format:'esm',define:{'import.meta.url':JSON.stringify(pathToFileURL(location).href),'import.meta.dirname':JSON.stringify(path.dirname(location))}});
    return {contents:compiled.code,loader:'js'};
   });
  }}]});
  const module=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].contents).toString('base64'));
  return {module,sourceCommit:commit,inputs:inputs.sort((a,b)=>a.path.localeCompare(b.path)),bundleSha256:sha(bundle.outputFiles[0].contents)};
 })());
 return snapshots.get(commit);
}

export async function inspectHistoricalCalibration(record,load=loadCurriculum){
 const {readback,execution,semanticReview:review}=record;
 assert(reviewedSources.includes(execution?.sourceCommit),'historical execution source not reviewed');
 const historical=await historicalCalibrationSource(execution?.sourceCommit),old=historical.module;
 const verifier=await historicalCalibrationSource(reviewedVerifier);
 // The deadline-corrected verifier reconstructs the original prompt and checks its raw
 // receipt, expiry, price, usage, recovery chain and exact source/owner pins.
 const checked=await verifier.module.inspectCalibrationReadback(readback,execution,load);
 const c=releaseCases(packet).find(c=>c.id===checked.caseId);assert(c,'current case absent');
 const raw=load(c.lessonId),source=JSON.parse(projectReleaseJson(`dialogue-curriculum/${c.lessonId}.json`,JSON.stringify(raw)));
 assert.equal(await digest(raw),c.rawSourceDigest,'current raw source drift');assert.equal(await digest(source),c.sourceDigest,'current source projection drift');
 const before=old.fullMaterialize(c,source),current=fullMaterialize(c,source);
 assert.equal(await digest(before.prompt),c.promptDigest,'original base prompt differs');
 if(checked.recoveryOf){
  const recovery=verifier.module.fullLanguage.caseRecovery(execution,c.id);
  assert(recovery&&recovery.receiptDigest===checked.recoveryOf,'exact historical recovery required');
  before.prompt=old.fullLanguage.recoveryPrompt(before.prompt,recovery,before);
  const currentLanguage=await import('../site/dialogue-full-language.js');
  current.prompt=currentLanguage.recoveryPrompt(current.prompt,recovery,current);
 }
 assert.equal(await digest(before.prompt),checked.promptDigest,'original provider prompt differs');
 assert.equal(old.RULE_VERSION,RULE_VERSION,'evidence rule changed');
 if(old.POLICY!==POLICY){assert.equal(sha(old.POLICY),policyBridge.before,'unreviewed historical policy');assert.equal(sha(POLICY),policyBridge.after,'unreviewed current policy');}
 assert.equal(before.prompt.replace(old.POLICY,POLICY),current.prompt,'prompt delta exceeds reviewed shared policy');
 const {prompt:oldPrompt,...oldFixture}=before,{prompt:currentPrompt,...currentFixture}=current;
 assert.deepEqual(oldFixture,currentFixture,'source/criteria/student fixture changed');
 const options=f=>({...f,hints:f.turns.filter(t=>t.role==='teacher').map(t=>t.content)});
 assert.deepEqual(validateProposal(readback.result.value,options(current)),old.validateProposal(readback.result.value,options(before)),'current validation differs');
 assert(review&&review.caseId===checked.caseId&&review.verdict==='accepted','accepted case review required');
 assert.equal(review.receiptDigest,checked.receiptDigest,'semantic receipt mismatch');assert.equal(review.readbackDigest,checked.readbackDigest,'semantic readback mismatch');
 assert(typeof review.reviewer==='string'&&review.reviewer.trim()&&(review.reviewer==='suen'||typeof review.designationReference==='string'&&review.designationReference.trim().length>=12)&&Number.isFinite(Date.parse(review.reviewedAt)),'review provenance missing');
 assert(Date.parse(review.reviewedAt)>=Date.parse(readback.rawRow.finished_at),'review predates completed case');
 for(const key of ['sourceGrounding','independentEvidence','authorFidelity','teachingQuality'])assert(typeof review[key]==='string'&&review[key].trim().length>=12,'substantive case review required');
 return {...checked,historicalSourceCommit:execution.sourceCommit,historicalInputs:historical.inputs,historicalBundleSha256:historical.bundleSha256,verifierSourceCommit:reviewedVerifier,verifierInputs:verifier.inputs,verifierBundleSha256:verifier.bundleSha256,currentPromptDigest:await digest(currentPrompt),policyBridge:{before:sha(old.POLICY),after:sha(POLICY)},currentValidatorCompatible:true,currentPromptProviderVerified:false,semanticReviewDigest:await digest(review)};
}

export async function inspectScopedCalibration(records,objectiveIds,load=loadCurriculum){
 assert(Array.isArray(objectiveIds)&&objectiveIds.length&&new Set(objectiveIds).size===objectiveIds.length,'distinct explicit objectives required');
 const scope=[...objectiveIds].sort(),specs=releaseCases(packet).filter(c=>scope.includes(c.objectiveId));
 for(const id of scope){
  const c=specs.find(c=>c.objectiveId===id);assert(c,'objective has no original cases');
  assert(load(c.lessonId).languagePractice.some(i=>i.id===id),'only original language calibration may be scoped');
 }
 assert(Array.isArray(records)&&records.length===specs.length&&new Set(records.map(r=>r.readback?.caseId)).size===records.length,'complete distinct selected-case coverage required');
 assert.deepEqual(records.map(r=>r.readback.caseId).sort(),specs.map(c=>c.id).sort(),'selected case coverage differs');
 const cases=[];
 for(const spec of specs)cases.push(await inspectHistoricalCalibration(records.find(r=>r.readback.caseId===spec.id),load));
 assert.equal(new Set(cases.map(c=>c.modelVersion)).size,1,'historical model version drift');
 const changes=scope.map(id=>{
  const spec=specs.find(c=>c.objectiveId===id),item=load(spec.lessonId).languagePractice.find(i=>i.id===id);
  assert(['pending-real-model','accepted'].includes(item.calibrationStatus),'unexpected calibration status');
  return {lessonId:spec.lessonId,objectiveId:id,itemVersion:item.version,from:item.calibrationStatus,to:'accepted',caseIds:cases.filter(c=>c.objectiveId===id).map(c=>c.caseId),applied:false};
 });
 return {version:'yw-scoped-historical-calibration-v1',status:'verified-historical-evidence-local-proposal',packetDigest:packet.sourceDigest,objectiveIds:scope,cases,changes,currentPromptProviderVerified:false,completeModeAccepted:false,sourceApplied:false,releaseAuthorized:false,paidCallsAuthorized:false};
}

// Build a private runtime projection only after independently rechecking the
// raw historical evidence. Its publication still needs the normal release gate.
export async function scopedCalibrationManifest(records,objectiveIds,load=loadCurriculum){
 const inspection=await inspectScopedCalibration(records,objectiveIds,load),inspectionDigest=await digest(inspection),lessons=[];
 for(const lessonId of [...new Set(inspection.changes.map(c=>c.lessonId))].sort()){
  const raw=load(lessonId),source=JSON.parse(projectReleaseJson(`dialogue-curriculum/${lessonId}.json`,JSON.stringify(raw))),items=[];
  for(const change of inspection.changes.filter(c=>c.lessonId===lessonId)){
   assert.equal(change.from,'pending-real-model','only unapplied calibration may be projected');
   const cases=inspection.cases.filter(c=>c.objectiveId===change.objectiveId);
   items.push({objectiveId:change.objectiveId,itemVersion:change.itemVersion,itemDigest:await digest(source.languagePractice.find(i=>i.id===change.objectiveId)),evidenceDigest:await digest(cases),cases:cases.map(c=>({caseId:c.caseId,receiptDigest:c.receiptDigest,readbackDigest:c.readbackDigest,semanticReviewDigest:c.semanticReviewDigest}))});
  }
  lessons.push({lessonId,curriculumVersion:source.curriculumVersion,sourceDigest:await digest(source),inspectionDigest,items});
 }
 return {inspection,manifest:{version:CALIBRATION_STATUS_VERSION,lessons}};
}
