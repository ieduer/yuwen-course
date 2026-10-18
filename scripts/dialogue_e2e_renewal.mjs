// Current driver. Uses existing server activation/readback formats; no authority
// creation, receipt registration, model switching, automatic replay or retries.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import packet from '../site/dialogue-full-language-packet.json' with {type:'json'};
import {FULL_OPERATION,FULL_E2E_OPERATION,releaseCases,fullActivation,caseRecovery} from '../site/dialogue-full-language.js';
import {acceptanceEnvironment} from '../site/dialogue-acceptance.js';
import {isolatedDialogueAdmission,E2E_LESSONS} from '../site/dialogue-e2e-admission.js';
import {renewedE2ECallLimit} from '../site/dialogue-e2e-renewal.js';
import {materializeCalibrationOverlay,inspectCalibrationBatch} from './dialogue_calibration_import.mjs';
import {preparePlan,loadFixtures,loadCurriculum,hash,E2ERunner,openJournal,ORIGIN,CAPS,validateFixture} from './dialogue_e2e.mjs';
export const OPERATION=FULL_E2E_OPERATION;
export const HTTP_CAP=6500;
export const JOURNAL_PATH='/Users/ylsuen/CF/reports/operations/yw-dialogue-20261012/full189-e2e-20261017/E2E-LEDGER.jsonl';
const same=(a,b,label)=>assert.deepEqual(a,b,label);
const hex=(s,n)=>typeof s==='string'&&new RegExp(`^[a-f0-9]{${n}}$`).test(s);
const dead=()=>{throw Error('local_validation_has_no_transport');};

export async function prepareRenewedPlan(inspection,loader=loadCurriculum){
 // Recover and verify the immutable calibration bases from the narrowly allowed
 // overlay. Authored learner answers and every non-overlay source byte stay fixed.
 const bases=new Map(),fixtures=loadFixtures();
 for(const pin of packet.sourceFiles){
  const current=loader(pin.lessonId),base=structuredClone(current),change=inspection.sourceChanges.find(c=>c.lessonId===pin.lessonId);
  if(change){same(hash(current),change.proposedRawDigest,'final curriculum does not match reviewed overlay');base.curriculumVersion=change.beforeVersion;
   for(const item of base.languagePractice){const c=inspection.changes.find(c=>c.objectiveId===item.id);if(c)item.calibrationStatus=c.from;}}
  same(hash(base),pin.rawSourceDigest,'immutable calibration base drift');bases.set(pin.lessonId,base);
 }
 const overlaid=await materializeCalibrationOverlay([...bases.values()],inspection);
 for(const current of overlaid)same(current,loader(current.lessonId),'final source changed beyond reviewed overlay');
 for(const [id,s]of Object.entries(fixtures.lessons)){
  validateFixture(bases.get(id),s);const current=loader(id);
  s.sourcePins.curriculumVersion=current.curriculumVersion;s.sourcePins.sourceDigest=hash(current);validateFixture(current,s);
 }
 const plan=preparePlan(fixtures,loader);
 plan.operation=OPERATION;plan.caps={...CAPS,hardExpiry:null,maxHttpRequests:HTTP_CAP};
 plan.isolatedAdmission={...plan.isolatedAdmission,operation:OPERATION,authorityDigest:null,hardExpiry:null};
 plan.calibration={operation:FULL_OPERATION,packetDigest:packet.sourceDigest,inspectionDigest:hash(inspection),sourceCommit:inspection.sourceCommit,artifactSha256:inspection.artifactSha256,apisVersion:inspection.apisVersion,modelVersion:inspection.modelVersion,executionDigest:inspection.executionDigest};
 same(plan.lessons.flatMap(l=>[...l.calibrationBlockers,...l.sourceBlockers]),[],'all three lessons must be ready');
 return {plan,fixtures,baseLoader:id=>bases.get(id)};
}

export function validateRenewedExecution(config,plan,now=Date.now()){
 assert(config.operation===OPERATION&&plan.operation===OPERATION&&config.origin===ORIGIN,'current isolated operation required');
 same(config.planDigest,hash(plan),'plan changed');same(config.fixtureDigest,plan.fixtureDigest,'authored fixtures changed');
 assert(hex(config.ownerRef,64)&&hex(config.sourceCommit,40)&&hex(config.artifactSha256,64)&&config.pagesDeploymentId,'exact final source/artifact/owner required');
 assert(config.syntheticOnly===true&&config.centralWritesDisabled===true,'isolated synthetic scope required');
 for(const key of ['staticChecks','ci','isolatedSourceReadback','sameOwnerAuthentication','providerAttemptContract','isolated120AdmissionReadback'])same(config.checks?.[key],'accepted','candidate check missing');
 same(config.lessonIds,[...E2E_LESSONS],'complete three-lesson scope required');
 same(config.maxHttpRequests,HTTP_CAP,'HTTP allowance differs');
 const b=config.activationBindings;
 assert(b&&Object.keys(b).every(k=>k.startsWith('YW_')&&typeof b[k]==='string'),'non-secret activation readback required');
 const env=acceptanceEnvironment(new Request(ORIGIN),{...b,ASSETS:{fetch:dead},ACCEPTANCE_DB:{prepare:dead},USER_CENTER_EVIDENCE:{resolveSession:dead},APIS_CALLER_TOKEN:'synthetic-caller-only',APIS:{fetch:dead}},now),full=fullActivation(env,packet,now);
 assert(full,'current server activation required');
 const callLimit=renewedE2ECallLimit(full);
 same([config.providerAttemptLimit,config.reserveMicrosPerCall,config.maxVisibleCalls,config.maxReserveMicros],[3,252000,callLimit,callLimit*252000],'operation budget changed');
 same([config.apisVersion,config.isolatedDatabaseId,config.expiresAt],[full.apisVersion,full.databaseId,full.hardExpiry],'execution pins differ');
 same([full.sourceCommit,full.artifactSha256,full.apisVersion],[plan.calibration.sourceCommit,plan.calibration.artifactSha256,plan.calibration.apisVersion],'calibration activation changed');
 same(hash(config.calibrationPins),plan.calibration.executionDigest,'original calibration pins changed');
 same(config.calibrationPins.ownerRef,config.ownerRef,'calibration owner differs');
 same(config.calibrationPins.activationDigest,full.registryReceiptDigest,'activation readback differs');
 same(config.calibrationPins.hardExpiry,full.hardExpiry,'deadline changed');
 for(const id of config.lessonIds)assert(isolatedDialogueAdmission(env,{ucUserId:553},id,{model:'gemini-3.8-flash',logicalProviderAttemptLimit:3,perAttemptReserveMicros:84000,reserveMicros:252000},now),'renewed admission required');
 assert(plan.lessons.every(l=>!l.sourceBlockers.length&&!l.calibrationBlockers.length),'reviewed sources required');
 return true;
}

export class RenewedE2ERunner extends E2ERunner{
 constructor(options){
  super({...options,validateConfig:validateRenewedExecution});this.inspection=options.inspection;this.baseLoader=options.baseLoader;same(hash(this.inspection),this.plan.calibration.inspectionDigest,'reviewed input changed');
  const transport=this.fetchImpl;this.httpRequests=0;
  this.fetchImpl=async(url,init={})=>{
   assert(this.httpRequests<HTTP_CAP,'HTTP allowance exhausted');const ordinal=++this.httpRequests;
   await this.record({operation:OPERATION,at:new Date(this.clock()).toISOString(),type:'http_intent',ordinal,method:init.method||'GET',url:String(url)});
   const response=await transport(url,init);await this.record({operation:OPERATION,at:new Date(this.clock()).toISOString(),type:'http_response',ordinal,status:response.status});return response;
  };
 }
 async preflight(){
  // Same-target GET only; no calibration POST, retries, replacement cases or
  // silent local-ledger reset. Every real receipt must still match its review.
  if(this.events.length)throw Error('existing_operation_readback_only_no_automatic_resume');
  const rows=[];
  for(const c of releaseCases(packet))rows.push(await this.request(c.lessonId,null,{calibration:c.id,attempt:String(caseRecovery(this.config.calibrationPins,c.id)?.attempt||1)}));
  const checked=await inspectCalibrationBatch(rows,this.config.calibrationPins,this.baseLoader);
  same(checked.cases,this.inspection.cases,'current receipts differ from semantic review');
  await super.preflight();
 }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 let journal;
 try{
  const [action,reportPath,configPath,manifestPath,...extra]=process.argv.slice(2);
  assert(['plan','execute'].includes(action)&&reportPath&&!extra.length,'plan REVIEWED_REPORT | execute REVIEWED_REPORT EXACT_CONFIG ARTIFACT_MANIFEST');
  const inspection=JSON.parse(fs.readFileSync(reportPath)),prepared=await prepareRenewedPlan(inspection);
  if(action==='plan'){assert(!configPath&&!manifestPath);console.log(JSON.stringify(prepared.plan,null,2));}
  else{assert(configPath&&manifestPath);const config=JSON.parse(fs.readFileSync(configPath));validateRenewedExecution(config,prepared.plan);
   journal=openJournal(JOURNAL_PATH,manifestPath,JOURNAL_PATH);
   const runner=new RenewedE2ERunner({...prepared,inspection,config,cookie:process.env.YW_E2E_SESSION_COOKIE,record:journal.record});console.log(JSON.stringify(await runner.run()));}
 }catch{if(journal)journal.record({operation:OPERATION,at:new Date().toISOString(),type:'stopped',automaticRetry:false});console.error('E2E stopped; preserve the exact journal and private inputs for same-target reconciliation. No automatic retry.');process.exitCode=1;}
 finally{journal?.close();}
}
