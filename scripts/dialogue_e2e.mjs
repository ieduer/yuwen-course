// Ordinary student-route E2E driver. Offline by default; no model or DB adapter.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {FORMAL_FIELDS} from '../site/dialogue-formal.js';
import {LIMITS, POLICY_VERSION, RULE_VERSION, pendingSupplement} from '../site/dialogue-policy.js';
import {sanitizeDialogueCurriculum} from '../site/dialogue-public-curriculum.js';
import {readDialogueEvents} from '../site/assets/dialogue-events.js';
import {deterministicStudyGuideAssessment} from '../site/study-guide-assessment.js';
import {E2E_AUTHORITY_DIGEST,E2E_HARD_EXPIRY,E2E_LESSONS,E2E_OPERATION} from '../site/dialogue-e2e-admission.js';

export const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const ORIGIN='https://yw-acceptance.bdfz.net';
export const OPERATION=E2E_OPERATION;
export const JOURNAL_PATH='/Users/ylsuen/CF/reports/operations/yw-dialogue-20261012/continuation-01a132c3/E2E-REAL-DIALOGUE-LEDGER.jsonl';
export const CAPS=Object.freeze({visibleCalls:120,providerAttemptsPerCall:3,reserveMicrosPerCall:252000,totalReserveMicros:30240000,hardExpiry:E2E_HARD_EXPIRY,readbacksPerMutation:3,maxHistoryPages:24,maxFirstReadMutations:8});
export const hash=value=>crypto.createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const fail=(code,details={})=>{throw Object.assign(Error(code),{code,details});};
const domains={contextWords:'context',authorQuestion:'authorQuestion',revision:'revision',structure:'structure',wordCreation:'wordCreation',evaluation:'evaluation'};
const success=new Set(['preserved','demonstrated']);
export const loadFixtures=()=>read(path.join(ROOT,'scripts/dialogue_e2e_fixtures.json'));
export const loadCurriculum=id=>read(path.join(ROOT,'site/dialogue-curriculum',id+'.json'));

export function validateFixture(c,s){
 if(c.sourceInventory.readerSha256!==s.sourcePins.readerSha256)fail('fixture_reader_drift',{lessonId:c.lessonId});
 if(JSON.stringify(c.objectives.map(o=>o.id))!==JSON.stringify(s.sourcePins.objectiveIds))fail('fixture_objective_drift',{lessonId:c.lessonId});
 if(JSON.stringify(c.objectives.filter(o=>o.domain==='legacy').map(o=>[o.id,o.legacy.resourceVersion]))!==JSON.stringify(s.sourcePins.formal))fail('fixture_formal_version_drift');
 for(const a of s.anchors)if(!c.passages.some(p=>p.id===a.passageId&&p.text.includes(a.quote)))fail('fixture_quote_drift',a);
 for(const o of c.objectives){
  if(o.domain==='legacy'&&FORMAL_FIELDS[o.legacy.questionKind])for(const field of FORMAL_FIELDS[o.legacy.questionKind])if(!s.formal[o.legacy.questionKind]?.[field])fail('fixture_formal_field_missing',{objectiveId:o.id,field});
  if(o.domain==='vocabulary'&&!s.vocabulary[o.id]&&!s.language[o.id])fail('fixture_independent_answer_missing',{objectiveId:o.id});
  if(o.domain==='studyGuide'&&!s.studyGuide?.[o.sourceItemKey])fail('fixture_study_guide_answer_missing',{objectiveId:o.id});
 }
 for(const [id,a]of Object.entries(s.language)){const item=c.languagePractice.find(v=>v.id===id);if(!item||item.version!==a.itemVersion)fail('fixture_language_version_drift',{objectiveId:id});}
 if(!s.dialogue.transfer||!s.dialogue.shangyou)fail('fixture_final_dialogue_missing');
 if(s.sourcePins.curriculumVersion!==c.curriculumVersion||s.sourcePins.sourceDigest!==hash(c))fail('fixture_curriculum_version_drift',{lessonId:c.lessonId});
 return true;
}

export function countPaths(c){
 const formal=c.objectives.filter(o=>o.domain==='legacy'), fields=formal.filter(o=>FORMAL_FIELDS[o.legacy.questionKind]);
 const guides=(c.studyGuide||[]).filter(g=>g.activeForSelfTest), q=c.vocabulary.length+(c.languagePractice||[]).filter(v=>!pendingSupplement(v)).length;
 const mapped=new Set(formal.map(o=>domains[o.legacy.questionKind]).filter(Boolean));
 const direct=c.objectives.filter(o=>!['legacy','studyGuide','vocabulary','read','firstRead'].includes(o.domain)&&!mapped.has(o.domain));
 const fieldTurns=fields.reduce((n,o)=>n+FORMAL_FIELDS[o.legacy.questionKind].length,0);
 const originalChoices=formal.filter(o=>o.legacy.questionKind==='vocabulary').length;
 const ratings=formal.filter(o=>o.legacy.questionKind==='evaluation').length, reads=c.objectives.filter(o=>o.domain==='read').length;
 const deterministic=guides.filter(g=>deterministicStudyGuideAssessment(g,typeof g.referenceAnswer==='string'?g.referenceAnswer:JSON.stringify(g.referenceAnswer))).length;
 const firstPassStudentTurns=q+fieldTurns+originalChoices+ratings+reads+guides.length+direct.length;
 const firstPassCallRows=q+fields.length+guides.length+direct.length;
 const boundedRemediationCallRows=q*5+fields.length+guides.length+direct.length;
 // 3 independent attempts + 2 student reformulations; original choice may be
 // wrong once then correct twice. These are different loops and budgets.
 const boundedRemediationStudentTurns=q*5+fieldTurns+originalChoices*3+ratings+reads+guides.length+direct.length;
 return {lessonId:c.lessonId,originalVocabulary:c.vocabulary.length,supplementalLanguage:(c.languagePractice||[]).filter(v=>!pendingSupplement(v)).length,formalItems:formal.length,formalProviderAssessments:fields.length,formalTypedFieldTurns:fieldTurns,activeGuides:guides.length,exactReferenceDeterministicGuides:deterministic,directDialogueObjectives:direct.map(o=>o.id),firstPassStudentTurns,firstPassCallRows,firstPassProviderCallsRange:[firstPassCallRows-deterministic,firstPassCallRows],boundedRemediationStudentTurns,boundedRemediationCallRows,boundedRemediationProviderCallsRange:[boundedRemediationCallRows-deterministic,boundedRemediationCallRows],classicalSourceMutationsOutsideDialogueTurns:c.mode==='classical'?8:0,prior128Or132Core:c.vocabulary.length*8+formal.filter(o=>o.legacy.questionKind!=='vocabulary').length+guides.length,notes:'Bound assumes each formal/guide accepted once; additional semantic corrections are not silently free. Deterministic guide rows use no provider but currently consume dialogue_calls count quotas.'};
}

export function preparePlan(fixtures=loadFixtures(),loader=loadCurriculum){
 const lessons=Object.entries(fixtures.lessons).map(([id,s])=>{
  const c=loader(id);validateFixture(c,s);
  const calibration=c.languagePractice.filter(v=>!pendingSupplement(v)).filter(v=>v.calibrationStatus!=='accepted'||v.sourceVerification?.status==='pending-verification'||v.dictionaryId&&c.dictionary.find(d=>d.id===v.dictionaryId)?.verificationStatus!=='source-image-verified').map(v=>({objectiveId:v.id,itemVersion:v.version,calibrationStatus:v.calibrationStatus,sourceVerification:v.sourceVerification?.status||null,dictionaryId:v.dictionaryId||null,required:'individually accepted calibration + verified exact source, then deployed server curriculum; never fixture override'}));
  const sourceBlockers=c.languagePractice.filter(v=>!pendingSupplement(v)).filter(v=>v.sourceVerification?.status==='pending-verification'||v.dictionaryId&&c.dictionary.find(d=>d.id===v.dictionaryId)?.verificationStatus!=='source-image-verified').map(v=>({objectiveId:v.id,itemVersion:v.version,sourceVerification:v.sourceVerification?.status||null,required:'independent exact-source acceptance; a model verdict cannot clear this gap'}));
  return {lessonId:id,title:c.title,curriculumVersion:c.curriculumVersion,sourceDigest:hash(c),publicDigest:hash(sanitizeDialogueCurriculum(c)),objectiveIds:c.objectives.map(o=>o.id),counts:countPaths(c),sourceBlockers,calibrationBlockers:calibration};
 });
 const firstPass=lessons.reduce((n,l)=>n+l.counts.firstPassCallRows,0),worst=lessons.reduce((n,l)=>n+l.counts.boundedRemediationCallRows,0);
 return {schemaVersion:1,operation:OPERATION,status:'offline-prepared-not-executed',fixtureDigest:hash(fixtures),policyVersion:POLICY_VERSION,ruleVersion:RULE_VERSION,origin:ORIGIN,caps:CAPS,serverLimits:LIMITS,lessons,
  isolatedAdmission:{status:'trusted-activation-readback-required-not-established-by-offline-plan',version:'yw-isolated-e2e-admission-v2',operation:OPERATION,authorityDigest:E2E_AUTHORITY_DIGEST,lessonIds:[...E2E_LESSONS],hardExpiry:E2E_HARD_EXPIRY,maxVisibleCalls:120,maxProviderAttempts:3,reserveMicros:252000,ordinaryDailyLimit:LIMITS.turnsPerDay,globalDailyLimit:LIMITS.globalPerDay},
  budget:{firstPassCallRows:firstPass,boundedRemediationCallRows:worst,firstPassFits120:firstPass<=120,remediationFits120:worst<=120,firstPassWorstReserveMicros:firstPass*CAPS.reserveMicrosPerCall,firstPassFitsOrdinaryDailyCount:firstPass<=LIMITS.turnsPerDay,firstPassFitsTrustedIsolatedOperationCount:firstPass<=120,explanation:'120 is an operation-wide ceiling only after registered-publisher activation and same-owner isolated readback. Ordinary daily40 stays unchanged outside that capability; global daily400 and monetary limits still apply. Failed/unknown calls count and no day, lesson, owner or deployment reset is allowed. This offline plan does not prove activation or remaining capacity.'},longLessons:['lesson-1477','lesson-1534'].map(id=>countPaths(loader(id))),readiness:lessons.some(l=>l.sourceBlockers.length)?'blocked_by_exact_source':lessons.some(l=>l.calibrationBlockers.length)?'blocked_by_exact_language_calibration':'candidate_checks_still_required'};
}

export function selectAnswer(snapshot,c,s){
 const t=snapshot.learningTurn;if(!t||['unavailable','exemption'].includes(t.kind))fail('no_ordinary_learning_task');
 if(snapshot.draft)fail('saved_draft_requires_exact_request_reconciliation');
 if(snapshot.partial||snapshot.pending)fail('unfinished_response_readback_only');
 const o=c.objectives.find(o=>o.id===t.objectiveId);
 let content,extra={};
 if(t.kind==='read')content='已讀完。'+(s.dialogue.context||s.dialogue.firstRead);
 else if(t.kind==='formal')content=s.formal[o?.legacy?.questionKind]?.[t.field];
 else if(t.kind==='evaluation'){content=s.ratingReason;extra.rating=s.rating;}
 else if(t.kind==='vocabulary'){
  const v=c.vocabulary.find(v=>v.id===t.itemId);if(!v||JSON.stringify(t.options)!==JSON.stringify(v.options)||t.prompt!==v.question)fail('original_question_drift');
  // This is an authored synthetic learner choosing the visible option. Never
  // attach answerIndex, model verdict or server state to a request.
  content=s.vocabulary[v.id].answer;extra.selectedIndex=v.answerIndex;
 }else if(t.kind==='studyGuide')content=s.studyGuide?.[t.itemKey];
 else if(t.kind==='sourceEvidence')content='我同意保存前面自己的原話，補充說明：'+(s.dialogue[o?.domain]||Object.values(s.formal[o?.legacy?.questionKind]||{}).join(' '));
 else if(t.kind==='dialogue'){
  const a=s.vocabulary[t.objectiveId]||s.language[t.objectiveId];
  if(a){if(!snapshot.question||snapshot.question.id!==t.questionId||snapshot.question.objectiveId!==t.objectiveId)fail('independent_question_not_issued',{objectiveId:t.objectiveId});content=`[${a.sourcePassageId}] ${a.answer}`;}
  else content=s.dialogue[o?.domain]||Object.values(s.formal[Object.keys(domains).find(k=>domains[k]===o?.domain)]||{}).join(' ')||(o?.domain==='evaluation'?s.ratingReason:null);
  if(a&&s.dialogue.firstRead&&!snapshot.turns?.some(t=>t.role==='student'))content=s.dialogue.firstRead+'\n'+content;
 }
 if(!content?.trim()||content.length>LIMITS.inputChars)fail('authored_answer_missing_or_too_large',{taskId:t.taskId});
 const possibleProvider=t.kind==='dialogue'||t.kind==='sourceEvidence'||t.kind==='studyGuide'||t.kind==='formal'&&FORMAL_FIELDS[o?.legacy?.questionKind]?.at(-1)===t.field;
 return {body:{taskId:t.taskId,content,...extra},possibleProvider,objectiveId:t.objectiveId};
}

export function assertOwner(data,owner){if(data?.ownerRef!==owner)fail('same_owner_readback_failed');}
export function assertComplete(data,c){
 if(data.state?.completion!=='evidence_ready_for_review'||!data.state.hasConclusion)fail('not_complete',{remaining:data.report?.student?.remaining});
 if(JSON.stringify(data.state.objectives.map(o=>o.id))!==JSON.stringify(c.objectives.map(o=>o.id))||data.state.objectives.some(o=>{const deferred=pendingSupplement(c.languagePractice.find(v=>v.id===o.id));return deferred?o.requiredForCompletion!==false||o.status!=='pending_calibration':!success.has(o.status);}))fail('objective_confirmation_incomplete');
 for(const o of c.objectives.filter(o=>o.domain==='legacy'))if(!data.sourceSubmissions?.some(s=>s.objectiveId===o.id&&s.status==='confirmed'&&s.sourceEventId))fail('original_source_receipt_missing',{objectiveId:o.id});
 const byId=new Map(data.turns.filter(t=>t.role==='student').map(t=>[t.id,t]));
 const check=(ref,needsPassage=true)=>{if(!ref?.quote||!byId.get(ref.turnId)?.content.includes(ref.quote))fail('final_student_quote_unverifiable');if(needsPassage&&(!ref.passageQuote||!c.passages.some(p=>p.id===ref.passageId&&p.text.includes(ref.passageQuote))))fail('final_source_quote_unverifiable');};
 for(const a of data.assessments||[])for(const e of a.evidence||[])check(e);
 const end=data.report?.conclusion;if(!end||end.kind!=='model-synthesis-for-review')fail('conclusion_missing');
 if(JSON.stringify(end.domains.map(d=>d.domain).sort())!==JSON.stringify(['interpretation','vocabulary','technique','transfer','uncertainty'].sort()))fail('conclusion_five_domains_missing');
 check(end.change.before,false);check(end.change.after,false);check(end.stance);
 if(data.turns.findIndex(t=>t.id===end.change.before.turnId)>=data.turns.findIndex(t=>t.id===end.change.after.turnId))fail('conclusion_change_order_invalid');
 for(const d of end.domains){if(!d.evidence?.length&&!d.preservedObjectives?.length)fail('conclusion_domain_empty');for(const e of d.evidence||[])check(e);for(const p of d.preservedObjectives||[])if(!data.state.objectives.some(o=>o.id===p.objectiveId&&o.status==='preserved'))fail('conclusion_history_unverified');}
 return {lessonId:c.lessonId,status:'server_evidence_ready_for_independent_human_review',objectiveCount:c.objectives.length,studentTurns:byId.size,callRows:data.trace?.calls?.length||0,officialGrades:data.sourceSubmissions.filter(s=>s.score!==null).map(s=>({objectiveId:s.objectiveId,score:s.score,sourceEventId:s.sourceEventId})),humanAcceptance:false};
}

export function validateExecutionConfig(config,plan,now=Date.now()){
 if(config.operation!==OPERATION||config.origin!==ORIGIN||config.planDigest!==hash(plan)||config.fixtureDigest!==plan.fixtureDigest)fail('execution_receipt_not_exact');
 if(!Number.isFinite(Date.parse(config.expiresAt))||now>=Date.parse(CAPS.hardExpiry)||now>=Date.parse(config.expiresAt)||Date.parse(config.expiresAt)>Date.parse(CAPS.hardExpiry))fail('execution_expired');
 if(!/^[a-f0-9]{64}$/.test(config.ownerRef||'')||!config.sourceCommit||!config.pagesDeploymentId||!config.isolatedDatabaseId||!config.apisVersion||config.syntheticOnly!==true||config.centralWritesDisabled!==true)fail('isolated_candidate_receipt_incomplete');
 for(const key of ['staticChecks','ci','isolatedSourceReadback','sameOwnerAuthentication','providerAttemptContract','isolated120AdmissionReadback'])if(config.checks?.[key]!=='accepted')fail('candidate_check_missing',{key});
 const admission=config.isolatedAdmission, expected=plan.isolatedAdmission;
 if(!admission||admission.version!==expected.version||admission.operation!==OPERATION||admission.authorityDigest!==E2E_AUTHORITY_DIGEST
   ||admission.origin!==ORIGIN||admission.ownerRef!==config.ownerRef||admission.databaseId!==config.isolatedDatabaseId||admission.apisVersion!==config.apisVersion
   ||!/^([a-f0-9]{64})$/.test(admission.registryReceiptDigest||'')||admission.hardExpiry!==CAPS.hardExpiry
   ||admission.maxVisibleCalls!==120||admission.maxProviderAttempts!==3||admission.reserveMicros!==252000
   ||!Array.isArray(admission.lessonIds)||JSON.stringify([...admission.lessonIds].sort())!==JSON.stringify(E2E_LESSONS))fail('isolated_admission_receipt_not_exact');
 if(!Array.isArray(config.lessonIds)||!config.lessonIds.length||new Set(config.lessonIds).size!==config.lessonIds.length||config.lessonIds.some(id=>!plan.lessons.some(l=>l.lessonId===id)))fail('execution_lessons_invalid');
 for(const id of config.lessonIds)if(plan.lessons.find(l=>l.lessonId===id).sourceBlockers.length)fail('language_source_review_required',{lessonId:id});
 for(const id of config.lessonIds)if(plan.lessons.find(l=>l.lessonId===id).calibrationBlockers.length)fail('language_calibration_required',{lessonId:id});
 if(config.providerAttemptLimit!==3||config.reserveMicrosPerCall!==252000||config.maxVisibleCalls!==120||config.maxReserveMicros!==30240000)fail('operation_budget_changed');
 return true;
}

export class E2ERunner{
 constructor({config,plan,fixtures=loadFixtures(),loader=loadCurriculum,fetchImpl=fetch,cookie,record,events=[],clock=Date.now,validateConfig=validateExecutionConfig,delay=ms=>new Promise(r=>setTimeout(r,ms))}){
  validateConfig(config,plan,clock());Object.assign(this,{config,plan,fixtures,loader,fetchImpl,cookie,record,events,clock,delay,validateConfig});this.streamEvents=[];
  if(!/^bdfz_uc_session=[^\s;\r\n]{1,2048}$/.test(cookie||''))fail('authorized_session_cookie_required');
  if(typeof record!=='function')fail('durable_recorder_required');
 }
 async emit(type,data){const e={operation:this.config.operation,at:new Date(this.clock()).toISOString(),type,...data};await this.record(e);this.events.push(e);return e;}
 async request(id,body,query={}){
  this.validateConfig(this.config,this.plan,this.clock());
  const q=new URLSearchParams({lessonId:id,...query}),headers={'cookie':this.cookie,'cache-control':'no-store'};
  if(body)Object.assign(headers,{'content-type':'application/json','origin':ORIGIN,'accept':'text/event-stream'});
  const response=await this.fetchImpl(`${ORIGIN}/api/dialogue/v1?${q}`,{method:body?'POST':'GET',headers,body:body?JSON.stringify({...body,ownerRef:this.config.ownerRef}):undefined,redirect:'error',signal:AbortSignal.timeout(body?90000:15000)});
  if(response.ok&&response.headers.get('content-type')?.includes('text/event-stream'))return readDialogueEvents(response,(type,value)=>{this.streamEvents.push({type,value});});
  const value=await response.json();if(!response.ok)fail(value.code||'student_route_rejected',{status:response.status,response:value});
  if(value.ownerRef)assertOwner(value,this.config.ownerRef);return value;
 }
 async snapshot(id){const p=await this.request(id,null,{records:'1'});assertOwner(p,this.config.ownerRef);const turns=[...(p.turns||[])];let cursor=p.older;
  for(let i=0;cursor&&i<CAPS.maxHistoryPages;i++){const page=await this.request(id,null,{beforeSeq:String(cursor.sequence)});assertOwner(page,this.config.ownerRef);turns.unshift(...page.turns);cursor=page.older;}
  if(cursor||turns.length>LIMITS.lessonLifetime*2||new Set(turns.map(t=>t.id)).size!==turns.length)fail('complete_transcript_readback_failed');
  return {...p,turns};
 }
 async mutate(id,body,{possibleProvider=false,objectiveId=null}={}){
  if(this.events.some(e=>e.type==='intent'&&!this.events.some(r=>r.type==='settled'&&r.mutationId===e.mutationId)))fail('outcome_unknown_readback_only');
  const count=this.events.filter(e=>e.type==='intent'&&e.possibleProvider).length;
  if(possibleProvider&&count>=CAPS.visibleCalls)fail('e2e_call_ceiling_exhausted');
  const mutationId=body.mutationId||'e2e_'+crypto.randomUUID().replaceAll('-','');this.streamEvents=[];
  body={...body,...(body.action==='first_read'?{payload:{...body.payload,clientMutationId:mutationId}}:{mutationId})};
  await this.emit('intent',{lessonId:id,mutationId,possibleProvider,reservedMicros:possibleProvider?CAPS.reserveMicrosPerCall:0,objectiveId,body,requestHash:hash(body)});
  let response,error;try{response=await this.request(id,body);}catch(e){error=e;}
  for(const event of this.streamEvents)await this.emit('stream',{lessonId:id,mutationId,event});
  let data;for(let n=0;n<CAPS.readbacksPerMutation;n++){try{data=await this.snapshot(id);}catch(e){error??=e;break;}if(!data.pending)break;await this.delay(2000);}
  await this.emit('readback',{lessonId:id,mutationId,data:data||null,requestError:error?{code:error.code||error.message,details:error.details||null}:null});
  if(body.action==='first_read'){
   if(error||response?.ok!==true)fail('first_read_outcome_requires_review');
  }else{
   const stored=data?.turns.find(t=>t.role==='student'&&t.mutationId===mutationId);
   if(!stored||stored.content!==body.content||data.pending||data.partial||stored.status==='needs_review')fail('outcome_unknown_readback_only',{mutationId});
   if(data.sourceSubmissions?.some(s=>s.turnId===stored.id&&s.status!=='confirmed'))fail('source_assessment_not_confirmed');
   if(error||response?.unconfirmed)fail('response_reconciliation_requires_review',{mutationId});
  }
  await this.emit('settled',{lessonId:id,mutationId,possibleProvider,revision:data?.revision});return {data,response};
 }
 async firstRead(id,s){
  const spec=s.firstRead;if(!spec)return;
  const state=await this.request(id,{action:'first_read',operation:'state',payload:{}});assertOwner(state,this.config.ownerRef);
  if(state.submitted||state.markCount)fail('existing_first_read_preserved_fresh_run_required');
  const started=this.clock(),base={textVersionId:spec.textVersionId,textDigest:spec.textDigest};
  for(const m of spec.marks){const {correction,...mark}=m;await this.mutate(id,{action:'first_read',operation:'mark',payload:{...base,...mark,elapsedMs:this.clock()-started}});}
  await this.mutate(id,{action:'first_read',operation:'submit',payload:{...base,summary:spec.summary,elapsedMs:this.clock()-started}});
  const submitted=await this.request(id,{action:'first_read',operation:'state',payload:{}});assertOwner(submitted,this.config.ownerRef);
  if(!submitted.submitted||submitted.summary!==spec.summary||submitted.marks.length!==3)fail('first_read_submission_not_confirmed');
  for(const m of spec.marks){const saved=submitted.marks.find(x=>x.selectedText===m.selectedText&&x.guess===m.guess);if(!saved)fail('first_read_original_guess_lost');await this.mutate(id,{action:'first_read',operation:'resolve',payload:{...base,markId:saved.markId,correction:m.correction}});}
  await this.mutate(id,{action:'first_read',operation:'acknowledge',payload:base});
  const final=await this.request(id,{action:'first_read',operation:'state',payload:{}});assertOwner(final,this.config.ownerRef);
  if(final.resolvedCount!==3||!final.annotatedReadCompleted||spec.marks.some(m=>!final.marks.some(x=>x.selectedText===m.selectedText&&x.guess===m.guess&&x.correction===m.correction)))fail('first_read_correction_readback_failed');
  await this.emit('first_read_confirmed',{lessonId:id,data:final});
 }
 async preflight(){
  if(this.events.length)fail('existing_operation_readback_only_no_automatic_resume');
  const selected=this.plan.lessons.filter(l=>this.config.lessonIds.includes(l.lessonId));
  for(const l of selected){const response=await this.fetchImpl(`${ORIGIN}/dialogue-curriculum/${l.lessonId}.json`,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});if(!response.ok||hash(await response.json())!==l.publicDigest)fail('deployed_curriculum_drift',{lessonId:l.lessonId});
   const data=await this.snapshot(l.lessonId);if(data.turns.length||data.draft||data.pending||data.partial||data.legacy?.completion||data.legacy?.records||data.legacy?.mastery?.length||data.legacy?.firstRead?.length||data.legacy?.firstReadMarks?.length||data.sessionId)fail('existing_records_preserved_fresh_e2e_required',{lessonId:l.lessonId});
   if(data.state.objectives.some(o=>o.status!=='not_yet_observed'))fail('preexisting_progress_not_e2e');
   if(this.fixtures.lessons[l.lessonId].firstRead){const state=await this.request(l.lessonId,{action:'first_read',operation:'state',payload:{}});assertOwner(state,this.config.ownerRef);if(state.markCount||state.submitted)fail('existing_first_read_preserved_fresh_run_required');}
  }
  await this.emit('preflight_accepted',{planDigest:hash(this.plan),candidate:this.config,scope:'ordinary route; no model result or progress injection'});
 }
 async run(){
  await this.preflight();const results=[];
  for(const id of this.config.lessonIds){const c=this.loader(id),s=this.fixtures.lessons[id];await this.firstRead(id,s);let data=await this.snapshot(id);
   for(let i=0;i<LIMITS.lessonLifetime;i++){
    if(data.state?.completion==='evidence_ready_for_review'){const result=assertComplete(data,c);await this.emit('lesson_result',{result,data});results.push(result);break;}
    const unresolved=data.state?.objectives.filter(o=>['needs_practice','review','historical_review','reformulated'].includes(o.status));
    if(unresolved?.length)fail('semantic_diagnosis_required',{lessonId:id,objectives:unresolved.map(o=>({id:o.id,status:o.status}))});
    const selected=selectAnswer(data,c,s);({data}=await this.mutate(id,{...selected.body,revision:data.revision},selected));
   }
   if(!results.some(r=>r.lessonId===id))fail('student_turn_ceiling_exhausted');
  }
  const result={operation:this.config.operation,status:'real_route_results_saved_human_review_required',results,humanAcceptance:false};await this.emit('run_result',result);return result;
 }
}

export function openJournal(file,manifestPath,expectedPath=JOURNAL_PATH){
 const absolute=path.resolve(file);if(absolute===JOURNAL_PATH)fail('historical_journal_read_only');const manifest=read(manifestPath);
 if(absolute!==expectedPath)fail('one_operation_one_cumulative_journal_path');
 if(!manifest.artifacts?.some(a=>path.resolve(a.path)===absolute&&a.created_by_task&&a.cleanup_owner))fail('exact_journal_artifact_not_registered');
 if(fs.existsSync(absolute))fail('existing_journal_readback_only_no_automatic_resume');
 const fd=fs.openSync(absolute,'wx',0o600);let previous='0'.repeat(64);
 return {record:e=>{const row={...e,previousHash:previous};row.hash=hash(row);fs.writeSync(fd,JSON.stringify(row)+'\n');fs.fsyncSync(fd);previous=row.hash;},close:()=>fs.closeSync(fd)};
}
if(typeof process!=='undefined'&&process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [command,...args]=process.argv.slice(2);const plan=preparePlan();
 if(command==='plan'&&!args.length)process.stdout.write(JSON.stringify(plan,null,2)+'\n');
 else if(command==='execute'&&args.length===3){
  fail('historical_operation_terminal_use_reviewed_renewal_driver');
 }else fail('usage: node scripts/dialogue_e2e.mjs plan | execute EXACT_CONFIG EXACT_NEW_REGISTERED_JOURNAL ARTIFACT_MANIFEST');
}
