// Offline inspection of existing runtime readbacks. This never authorizes a model
// call, accepts semantic quality, writes curriculum, or changes a consumed packet.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import packet from '../site/dialogue-full-language-packet.json' with {type:'json'};
import {FULL_OPERATION,FULL_MODEL,FULL_CASE_COUNT,fullReceipt,fullMaterialize,digest} from '../site/dialogue-full-language.js';
import {validateProposal} from '../site/dialogue-policy.js';
import {reconciledCost} from '../site/dialogue-budget.js';
import {projectReleaseJson} from './build_release_site.mjs';
import {loadCurriculum} from './dialogue_full_language.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
const hex=(value,size)=>typeof value==='string'&&new RegExp(`^[a-f0-9]{${size}}$`).test(value);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const parse=(value,label)=>{assert.equal(typeof value,'string',label);return JSON.parse(value);};
const same=(a,b,label)=>assert(isDeepStrictEqual(a,b),label);
function validateExecution(e){
 assert(hex(e?.sourceCommit,40)&&hex(e.artifactSha256,64)&&hex(e.activationDigest,64)&&hex(e.ownerRef,64)&&hex(e.priorReceiptSetDigest,64),'execution pins required');
 assert(uuid(e.apisVersion),'APIS version required');
 assert(Number.isFinite(Date.parse(e.readyAt))&&Number.isFinite(Date.parse(e.hardExpiry))&&Date.parse(e.hardExpiry)>Date.parse(e.readyAt)&&Date.parse(e.hardExpiry)-Date.parse(e.readyAt)<=21600000,'execution window invalid');
 assert(e.budget?.model===FULL_MODEL&&e.budget.reserveMicros===84000&&e.budget.providerAttemptLimit===1&&e.budget.logicalProviderAttemptLimit===1,'exact recorded budget required');
 const b=e.budget;
 assert(b.currency==='USD'&&b.maxInputTokens===100000&&b.maxOutputTokens===2400&&Number.isFinite(Date.parse(b.validUntil))&&Date.parse(b.validUntil)>Date.parse(e.readyAt),'recorded token and price bounds required');
 for(const key of ['globalDailyMicros','userDailyMicros','lessonLifetimeMicros','inputMicrosPerMillion','outputMicrosPerMillion'])assert(Number.isSafeInteger(b[key])&&b[key]>0&&b[key]<=1000000000000,'invalid recorded budget value');
 assert(b.globalDailyMicros<=50000000&&b.userDailyMicros<=50000000&&b.reserveMicros<=Math.min(b.globalDailyMicros,b.userDailyMicros,b.lessonLifetimeMicros),'recorded budget ceiling mismatch');
 const minimum=Number((100000n*BigInt(b.inputMicrosPerMillion)+2400n*BigInt(b.outputMicrosPerMillion)+999999n)/1000000n);assert(b.reserveMicros>=minimum,'recorded reserve insufficient');
}

export async function inspectCalibrationReadback(readback,execution,load=loadCurriculum){
 validateExecution(execution);
 const c=packet.cases.find(c=>c.id===readback?.caseId);assert(c,'unknown case');
 const attemptId=`${FULL_OPERATION}:${c.id}:1`;
 same(readback.operation,FULL_OPERATION,'operation mismatch');same(readback.attempt,1,'attempt mismatch');same(readback.attemptId,attemptId,'attempt identity mismatch');
 for(const key of ['sourceCommit','artifactSha256','apisVersion','ownerRef','activationDigest','hardExpiry'])same(readback[key],execution[key],`execution ${key} mismatch`);
 same(readback.packetDigest,packet.sourceDigest,'packet mismatch');same(readback.sourceDigest,c.sourceDigest,'source pin mismatch');same(readback.promptDigest,c.promptDigest,'prompt pin mismatch');same(readback.rawSourceDigest,c.rawSourceDigest,'raw source pin mismatch');same(readback.projectionVersion,packet.projectionVersion,'projection mismatch');
 assert(readback.history?.reconciled===true,'history unreconciled');same(readback.history.receiptSetDigest,execution.priorReceiptSetDigest,'history digest mismatch');
 const raw=load(c.lessonId),source=JSON.parse(projectReleaseJson(`dialogue-curriculum/${c.lessonId}.json`,JSON.stringify(raw)));
 same(await digest(raw),c.rawSourceDigest,'current raw curriculum changed');same(await digest(source),c.sourceDigest,'current projected curriculum changed');
 const fixture=fullMaterialize(c,source);same(await digest(fixture.prompt),c.promptDigest,'reconstructed prompt changed');
 const row=readback.rawRow;assert(row,'raw row missing');same(row.turn_id,attemptId,'raw attempt mismatch');same(row.session_id,attemptId+':session','raw session mismatch');
 assert(Number.isSafeInteger(row.student_id)&&row.student_id>0&&row.student_id===row.session_owner,'raw owner mismatch');same(sha('dialogue-owner:'+row.student_id),execution.ownerRef,'owner identity mismatch');
 same(row.state,'finished','unfinished or failed case');same(row.reserved_micros,84000,'reservation changed');
 assert(Number.isSafeInteger(row.accounted_micros)&&row.accounted_micros>=0&&row.accounted_micros<=84000,'unknown or invalid cost');
 const started=Date.parse(row.created_at),ended=Date.parse(row.finished_at);assert(Number.isFinite(started)&&Number.isFinite(ended)&&started>=Date.parse(execution.readyAt)&&started<Date.parse(execution.budget.validUntil)&&ended>=started&&ended<Date.parse(execution.hardExpiry),'receipt outside execution window');
 same(await fullReceipt(row),readback.receiptDigest,'raw receipt digest mismatch');
 const meta=parse(row.curriculum_json,'source metadata missing');
 same(meta,{syntheticOnly:true,caseId:c.id,sourceDigest:c.sourceDigest,rawSourceDigest:c.rawSourceDigest,projectionVersion:packet.projectionVersion,promptDigest:c.promptDigest,packetDigest:packet.sourceDigest,recoveryOf:null},'raw source metadata mismatch');
 const result=parse(row.details_json,'raw result missing');same(result,readback.result,'readback result differs from raw');
 assert(result.syntheticOnly===true&&result.expectedVerdictMatches===true&&result.semanticReviewRequired===true&&!result.boundaryStop&&!result.received,'result not mechanically finished');
 same(result.model,FULL_MODEL,'model mismatch');assert(typeof result.modelVersion==='string'&&result.modelVersion.trim(),'actual model version missing');
 const budget=parse(row.budget_policy_json,'raw budget missing');same(budget,execution.budget,'recorded price or budget mismatch');
 same(parse(row.usage_json,'raw usage missing'),result.usage,'usage mismatch');const cost=reconciledCost(budget,result.usage);assert(cost!==null,'usage cannot be reconciled');same(cost,row.accounted_micros,'accounted cost mismatch');
 const call={state:row.state,reserved_micros:row.reserved_micros,accounted_micros:row.accounted_micros,usage_json:row.usage_json,created_at:row.created_at,finished_at:row.finished_at};same(readback.call,call,'call projection mismatch');
 const proposal=validateProposal(result.value,{...fixture,hints:fixture.turns.filter(t=>t.role==='teacher').map(t=>t.content)});
 const verdict=proposal.assessments.find(a=>a.objectiveId===c.objectiveId)?.outcome||'no_assessment';same(result.verdict,verdict,'stored verdict differs');
 assert((c.expected==='demonstrated'?verdict==='demonstrated':verdict!=='demonstrated')&&!proposal.assessments.some(a=>a.outcome==='demonstrated'&&a.objectiveId!==c.objectiveId),'expected verdict failed');
 return {caseId:c.id,lessonId:c.lessonId,objectiveId:c.objectiveId,attemptId,receiptDigest:readback.receiptDigest,readbackDigest:await digest(readback),sourceDigest:c.sourceDigest,promptDigest:c.promptDigest,modelVersion:result.modelVersion,accountedMicros:cost,usage:result.usage,firstTokenMs:result.firstTokenMs??null,totalDurationMs:result.totalDurationMs??null,semanticReviewRequired:true};
}

export async function inspectCalibrationBatch(readbacks,execution,load=loadCurriculum){
 const {sourceDigest,...unsigned}=packet;same(await digest(unsigned),sourceDigest,'frozen packet integrity');
 assert(Array.isArray(readbacks)&&readbacks.length===FULL_CASE_COUNT,'all235 readbacks required');
 assert(new Set(readbacks.map(r=>r.caseId)).size===FULL_CASE_COUNT,'duplicate case');
 // Ordering is packet-defined. No network, recovery, or replacement case exists.
 const byId=new Map(readbacks.map(r=>[r.caseId,r]));const cases=[];
 for(const c of packet.cases)cases.push(await inspectCalibrationReadback(byId.get(c.id),execution,load));
 assert(new Set(cases.map(c=>c.modelVersion)).size===1,'model version drift');
 const changes=[],preserved=[],sourceChanges=[];
 assert(packet.sourceFiles.length===189,'all189 source pins required');
 for(const pin of packet.sourceFiles){
  const raw=load(pin.lessonId);same(await digest(raw),pin.rawSourceDigest,'full189 raw source drift');
  const source=JSON.parse(projectReleaseJson(`dialogue-curriculum/${pin.lessonId}.json`,JSON.stringify(raw)));same(await digest(source),pin.sourceDigest,'full189 projected source drift');
  const proposed=structuredClone(raw),changedIds=[];
  for(const item of raw.languagePractice){
   const refs=cases.filter(c=>c.lessonId===pin.lessonId&&c.objectiveId===item.id);assert(refs.length,'uncovered language item');
   const entry={lessonId:pin.lessonId,objectiveId:item.id,itemVersion:item.version,itemDigest:await digest(item),caseIds:refs.map(c=>c.caseId),receiptDigests:refs.map(c=>c.receiptDigest)};
   if(item.calibrationStatus==='accepted')preserved.push(entry);
   else {same(item.calibrationStatus,'pending-real-model','unknown calibration disposition');changes.push({...entry,from:item.calibrationStatus,to:'accepted'});proposed.languagePractice.find(i=>i.id===item.id).calibrationStatus='accepted';changedIds.push(item.id);}
  }
  if(changedIds.length){
   proposed.curriculumVersion='';proposed.curriculumVersion='yw-dialogue-'+(await digest(proposed)).slice(0,20);
   const projected=JSON.parse(projectReleaseJson(`dialogue-curriculum/${pin.lessonId}.json`,JSON.stringify(proposed)));
   sourceChanges.push({lessonId:pin.lessonId,beforeRawDigest:pin.rawSourceDigest,beforeProjectedDigest:pin.sourceDigest,beforeVersion:raw.curriculumVersion,proposedRawDigest:await digest(proposed),proposedProjectedDigest:await digest(projected),proposedVersion:proposed.curriculumVersion,changedItemIds:changedIds,allowedFields:['languagePractice[].calibrationStatus','curriculumVersion'],applied:false});
  }
 }
 assert(changes.length+preserved.length===78,'all78 language items required');
 return {status:'mechanical-pass-semantic-review-required',sourceCommit:execution.sourceCommit,artifactSha256:execution.artifactSha256,apisVersion:execution.apisVersion,packetDigest:sourceDigest,executionDigest:await digest(execution),model:FULL_MODEL,modelVersion:cases[0].modelVersion,cases,accountedMicros:cases.reduce((n,c)=>n+c.accountedMicros,0),changes,preserved,sourceChanges,sourceFiles:packet.sourceFiles,reviewRequiredCaseIds:cases.map(c=>c.caseId),overlayApplied:false,paidCallsAuthorized:false,releaseAuthorized:false,notice:'Local hashes and structural checks do not authenticate provider evidence or certify author fidelity and teaching quality. Review original readbacks and every case before applying this exact diff through the existing source/release workflow. Never regenerate consumed packets.'};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try {
 const [action,input,pins,output,...extra]=process.argv.slice(2);
 assert(action==='inspect'&&input&&pins&&output&&!extra.length,'Usage: inspect READBACKS_JSON EXECUTION_PINS_JSON EXACT_NEW_REPORT_JSON');
 assert(path.isAbsolute(output)&&!fs.existsSync(output),'new absolute output required');
 const inputBytes=fs.readFileSync(input),pinsBytes=fs.readFileSync(pins);
 const report=await inspectCalibrationBatch(JSON.parse(inputBytes),JSON.parse(pinsBytes));
 report.inputFileSha256=sha(inputBytes);report.executionPinsFileSha256=sha(pinsBytes);
 fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log(JSON.stringify({status:report.status,cases:report.cases.length,proposedChanges:report.changes.length,overlayApplied:false,paidCallsAuthorized:false}));
 } catch {
  // Parsing/assertion errors can contain private input. Keep raw evidence in its
  // owned location and never echo it into shell logs.
  console.error('Calibration inspection failed; no acceptance or authorization was created. Inspect the retained inputs locally.');process.exitCode=1;
 }
}
