import {dialogueConclusionSchema,CONCLUSION_SCHEMA_VERSION} from './dialogue-conclusion-schema.js';
import {authorPassages,authorPassagesContext} from './dialogue-author-corpus.js';
import {dialogueAdmissionAllowed} from './release-admission.js';
import {fetchAssessmentAsset} from './assessment-assets.js';
import {validateReadingEvidence,validateOriginalEvidence,conversationOriginalTasks,READING_CONVERSATION_POLICY,CONVERSATION_POLICY_VERSION} from './dialogue-reading-evidence.js';
import {loadClassicalFirstRead,getClassicalFirstReadState} from './classical-first-read-source.js';
import {dialogueReadingAsset,unpunctuated} from './dialogue-reading-material.js';
import {readDialogueNotes} from './dialogue-reading-notes.js';
import {handleCalibration} from './dialogue-calibration.js';
import {historicalEvidence} from './dialogue-legacy.js';
import {acceptanceContext} from './dialogue-acceptance.js';
import {dialogueCallAdmission,assertIsolatedCallCurrent} from './dialogue-e2e-admission.js';
import {sharedPoolAdmission,SHARED_POOL_MESSAGES} from './dialogue-pacing.js';
import {RENEWED_E2E_OPERATION,renewedOperationCondition,prepareRenewedRetainedFailures,validateRenewedResult} from './dialogue-e2e-renewal.js';
import {MODE_OPERATION,modeConfigured,prepareModeLedger,validateModeResult} from './dialogue-mode-admission.js';
import {recordCorrection} from './dialogue-corrections.js';
import {hasClassicalAnnotatedReadReceipt} from './classical-first-read-source.js';
import {paragraphGuide,paragraphGuideContext} from './dialogue-paragraph-guide.js';
import {promptParts} from './dialogue-policy.js';
import {consumeGatewayStream,studentStream,validatedProviderAccounting} from './dialogue-stream.js';
import {dialogueBudget,reconciledCost} from './dialogue-budget.js';
import {requestDialogueBudget,combinedProviderAccounting,operatorCost,continuationDisposition,budgetDenial} from './dialogue-recovery.js';
import {prepareFormalInput,formalPrompt,studyGuideConversationReply,originalTask,originalVocabularyTasks,questionVocabularyTask,prepareOriginalInput,revealFollowupDraft,sourceDraftReady} from './dialogue-formal.js';
import {learningTurn,collectedFormal} from './dialogue-learning-turn.js';
import {lessonCallLimit} from './dialogue-lesson-limits.js';
import {sanitizeDialogueCurriculum} from './dialogue-public-curriculum.js';
import {approvedSupplement} from './dialogue-completion-exemptions.js';
import {withProspectiveFormalScope} from './formal-scope-policy.js';
import {withSessionSourceMaterials} from './dialogue-session-source.js';
import {withCalibratedLanguage,calibrationReopensReview} from './dialogue-calibration-status.js';
import {POLICY_VERSION,RULE_VERSION,CONTEXT_LAYOUT_VERSION,LIMITS,PILOTS,validateProposal,projectState,contextFor,createQuestion,vocabularyOrder,evidenceReport,questionItems,lessonScore,validateFormalAssessment} from './dialogue-policy.js';
const now=()=>new Date().toISOString();
const uuid=()=>crypto.randomUUID();
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'private, no-store','x-content-type-options':'nosniff'}});
const all=async stmt=>(await stmt.all()).results||[];
const sha=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(x=>x.toString(16).padStart(2,'0')).join('');
const admitted=(env,student)=>dialogueAdmissionAllowed(env,student.ucUserId) && !!student.id && !!student.ucUserId;
// Only fixed internal codes enter sampled-mode diagnostics. Never persist an
// arbitrary exception message, stack, provider payload or learner quotation.
const MODE_FAILURE_CODES=new Set([
 'mode_provider_result_unconfirmed','invalid_model_reply','invalid_assessment',
 'unverifiable_evidence','missing_criterion','reformulation_not_verified',
 'language_calibration_required','independence_not_verified','copied_hint',
 'quotation_without_explanation','original_evidence_requires_source_receipt',
 'original_result_preserved','original_evidence_wrong_task','original_evidence_not_student_quote',
 'reading_evidence_not_student_quote','reading_mark_not_available','reading_selection_not_verified',
 'reading_selection_ambiguous','reading_original_mark_preserved','reading_summary_not_verified',
 'reading_correction_not_verified','reading_acknowledgement_not_verified','reading_operation_not_allowed',
 'rating_not_explicit','rating_out_of_range','choice_not_explicit',
 'source_draft_not_eligible','source_draft_during_vocabulary','source_draft_not_student_quote',
 'invalid_source_draft','invalid_source_submission','invalid_source_input','source_input_too_large',
 'study_guide_draft_not_verified','study_guide_reference_not_revealed',
 'conclusion_not_ready','unverifiable_conclusion_turn','unverifiable_conclusion_passage',
 'conclusion_change_requires_earlier_turn','invalid_conclusion_domain','unverified_conclusion_history',
 'conclusion_domain_without_evidence','conclusion_reply_too_long','shangyou_conclusion_required',
 'shangyou_evidence_required','context_budget_exceeded','source_context_budget_exceeded',
 'invalid_visible_stream','continuation_prefix_mismatch','invalid_source_reply',
 'duplicate_source_evaluation','source_reply_missing','source_result_unconfirmed',
 'reading_source_unavailable','reading_source_unconfirmed','original_source_unavailable',
 'original_source_unconfirmed','call_already_reconciled','call_no_longer_active',
]);
// Verification failures of optional proposal parts: the part is dropped and recorded; the reply stays. Everything else
// (no reply, provider, storage, budget, continuation) keeps failing closed.
// A classical text records nothing before its first read: say exactly what unlocks the record instead of inviting the
// student to resubmit words that would be refused again.
export const READING_GATE_NOTICE={classical_first_read_required:'這是文言文：作者剛才的評閱要等你完成「無注疏初讀」才能記分——先不看注釋自己讀一遍，告訴作者至少三處讀不通或拿不準的地方和你的猜測，再寫幾句初讀感受。剛才的對話都已保存，不必重寫。',classical_annotated_reading_required:'這是文言文：作者剛才的評閱要等你讀完帶註釋的正文、並告訴作者一聲，才能記分。剛才的對話都已保存，不必重寫。'};
const originalRejectedNotice=code=>READING_GATE_NOTICE[code]||(['original_evidence_wrong_task','original_result_preserved'].includes(code)?'作者提到的原題答案：該題先前已有紀錄，不重複計分。':code==='choice_not_explicit'?'作者提到的原題選擇本輪未能記錄：請在同一句裡清楚寫出「我選 某選項」。':'作者提到的原題答案本輪未能記錄（未通過核驗）；學習紀錄以下方實際保存的為準。');
const formalRejectedNotice=code=>READING_GATE_NOTICE[code]||(['formal_assessment_not_eligible','original_result_preserved'].includes(code)?'作者提到的評閱：該項先前已有紀錄，不重複計分。':`作者提到的評閱本輪未能記錄（${code==='one_formal_assessment_per_turn'?'一輪只記一項':'未通過核驗'}）；下一輪可引用你先前的話補記。`);
// The author may only put the student's own words in quotation marks. Any 「…」 the reply attributes to the student
// (你說「…」, 你前面才說「…」 …) that is not a verbatim part of a saved student message is recorded and shown to the student.
const STUDENT_QUOTE=/你(?:前面|剛才|剛剛|上一輪|先前|之前|一開始|後來|開頭|又|也|才|曾|還|只)*(?:說過|說到|說的是|說的|說|提到|提過|寫道|寫的是|寫過|講過|講)[，,：:]?\s*[「『"]([^」』"\n]{2,80})[」』"]/gu;
const foldText=value=>String(value||'').replace(/[\s\p{P}\p{S}]/gu,'');
// Whether a dialogue vocabulary question is settled by the word's original item: the item was answered correctly in this
// turn, or the state already holds the preserved original answer.
export function originalSettles(curriculum,state,objectiveId,originalResult){
 const key=`effect:${curriculum?.lessonId}:vocab:${objectiveId}`;
 const legacy=(curriculum?.objectives||[]).find(o=>o.domain==='legacy'&&o.legacy?.questionKind==='vocabulary'&&o.legacy.resourceKey===key);
 if(!legacy)return false;
 if(originalResult?.objectiveId===legacy.id&&originalResult.correctness==='correct')return true;
 return (state?.objectives||[]).some(o=>o.id===legacy.id&&o.status==='preserved');
}
export function unverifiedStudentQuotes(reply,turns){
 const said=foldText((turns||[]).filter(t=>t.role==='student').map(t=>t.content).join('\n')),out=[];
 for(const m of String(reply||'').matchAll(STUDENT_QUOTE)){const quote=m[1].trim(),folded=foldText(quote);if(folded.length>=2&&!said.includes(folded)&&!out.includes(quote))out.push(quote);}
 return out;
}
const misquoteNotice=quotes=>`作者引用的「${quotes.join('」「')}」不是你訊息裡的原話，以你自己寫的為準。`;
// Stable rejection code of a validation error. Some validators keep the code in error.code and a learner-facing sentence in
// error.message (assertNewFormalAnswerTime); reading only the message recorded those as 'unclassified'.
// A rejected proposal part is kept, privately and bounded, with its reason (2026-10-23): after a validator fix the saved
// student words and this retained part can be re-checked and, with the owner's approval, recorded as a correction. Never
// credited here, never sent to the User Center.
const RETAINED_KEYS={assessments:['assessments'],formalAssessments:['formalAssessments'],originalEvidence:['originalEvidence'],readingEvidence:['readingEvidence'],sourceDraft:['sourceDraft'],sourceDraft_or_conclusion:['sourceDraft','conclusion']};
export const RETAINED_MAX_CHARS=24000;
export function retainedRejected(value,parts){
 if(!value||typeof value!=='object'||!Array.isArray(parts)||!parts.length)return {};
 const kept={};
 for(const p of parts)for(const key of RETAINED_KEYS[p.part]||[])if(value[key]!==undefined)kept[key]=value[key];
 if(!Object.keys(kept).length)return {};
 const text=JSON.stringify(kept);
 return text.length<=RETAINED_MAX_CHARS?{retained:kept,retainedVersion:'yw-rejected-retained-v1'}:{retainedTruncated:true,retainedChars:text.length,retainedVersion:'yw-rejected-retained-v1'};
}
export function rejectionCode(error){return [error?.code,error?.message].find(v=>typeof v==='string'&&/^[a-z0-9_]{1,80}$/.test(v))||'unclassified';}
// Exact provider cost of a call whose every attempt reported usage; null when any attempt's usage is unknown.
function knownProviderCost(budget,result,accounting){
 const attempts=accounting?.attempts;
 if(Array.isArray(attempts)&&attempts.length){let sum=0;for(const a of attempts){const c=reconciledCost(budget,a.usage,a.model);if(c===null)return null;sum+=c;}return Number.isSafeInteger(sum)&&sum<=budget.reserveMicros?sum:null;}
 if((budget.logicalProviderAttemptLimit||1)!==1)return null;
 const c=reconciledCost(budget,result?.usage,result?.model||null);return c===null||c>budget.reserveMicros?null:c;
}
const LENIENT_PROPOSAL_CODES=new Set(['invalid_assessment','unverifiable_evidence','missing_criterion','reformulation_not_verified','language_calibration_required','independence_not_verified','copied_hint','quotation_without_explanation','source_draft_not_eligible','source_draft_during_vocabulary','source_draft_not_student_quote','invalid_source_draft','invalid_source_submission','invalid_source_input','source_input_too_large','study_guide_draft_not_verified','study_guide_reference_not_revealed','conclusion_not_ready','unverifiable_conclusion_turn','unverifiable_conclusion_passage','conclusion_change_requires_earlier_turn','invalid_conclusion_domain','unverified_conclusion_history','conclusion_domain_without_evidence','conclusion_reply_too_long','shangyou_conclusion_required','shangyou_evidence_required']);
async function readingGate(db,studentId,curriculum,legacy){
 if(curriculum.mode!=='classical')return null;
 if(legacy.completion)return {phase:'close_reading',preservedCompletion:true};
 const submitted=legacy.firstRead.find(row=>row.submitted_at);
 if(!submitted)return {phase:'initial_reading'};
 const annotated=await hasClassicalAnnotatedReadReceipt(db,studentId,curriculum.lessonId,submitted.text_version_id);
 const unresolvedMarks=legacy.firstReadMarks.filter(mark=>mark.text_version_id===submitted.text_version_id&&!mark.deleted_at&&mark.resolution_status!=='resolved').length;
 return {phase:annotated?'close_reading':'annotated_reading',unresolvedMarks,textVersionId:submitted.text_version_id,textDigest:submitted.text_digest};
}
export async function loadDialogueCurriculum(env,lessonId){
 if(!/^lesson-[\w-]{1,60}$/.test(lessonId||''))throw new Error('lesson_not_available');
 if(!PILOTS.includes(lessonId)){
  const index=await env.ASSETS.fetch(new Request('https://yw.bdfz.net/dialogue-curriculum/index.json'));
  if(!index.ok||!(await index.json()).lessons?.some(row=>row.lessonId===lessonId))throw Error('lesson_not_available');
 }
 const response=await fetchAssessmentAsset(env,new Request(`https://yw.bdfz.net/dialogue-curriculum/${lessonId}.json`));
 if(!response.ok)throw new Error('curriculum_unavailable');
 const value=await response.json();
 if(value.lessonId!==lessonId || value.schemaVersion!==1 || !value.curriculumVersion)throw new Error('curriculum_invalid');
 return value;
}
async function history(db,session,before=null){
 const rows=await all(db.prepare(`SELECT * FROM dialogue_turns WHERE session_id=? AND (? IS NULL OR sequence < ?) ORDER BY sequence DESC LIMIT ?`).bind(session.id,before?.sequence||null,before?.sequence||null,LIMITS.historyPage+1));
 const more=rows.length>LIMITS.historyPage;rows.splice(LIMITS.historyPage);
 return {turns:rows.reverse().map(t=>({id:t.id,sequence:t.sequence,mutationId:t.role==='student'?t.mutation_id:null,role:t.role,content:t.content,status:t.status,questionId:t.question_id,createdAt:t.created_at,model:t.model,modelVersion:t.model_version,formal:t.source_request_json?JSON.parse(t.source_request_json):null})),older:more?{sequence:rows[0].sequence}:null};
}
const SESSION_PAGE=100,EXPORT_SESSIONS_PER_PAGE=5;
// Keyset cursor over (updated_at DESC, id DESC); both cursor parts or neither; the page size is bounded by the caller's maximum.
function sessionCursor(url,maxLimit){
 const updatedAt=url.searchParams.get('before'),id=url.searchParams.get('beforeId'),rawLimit=url.searchParams.get('limit');
 if((updatedAt===null)!==(id===null))return null;
 if(updatedAt!==null&&(!/^\d{4}-\d{2}-\d{2}T[0-9:.]+Z$/.test(updatedAt)||!/^[A-Za-z0-9_-]{1,80}$/.test(id)))return null;
 const limit=rawLimit===null?maxLimit:Number(rawLimit);
 if(!Number.isSafeInteger(limit)||limit<1||limit>maxLimit)return null;
 return {before:updatedAt===null?null:{updatedAt,id},limit};
}
// Homework execution contract (2026-10-20): an execution id names one attempt of a lesson under the currently published
// curriculum version. The binding is an append-only `execution_started` event on the bound session; valid results from
// earlier sessions of the same student and lesson carry forward by projection only (no rows are copied or rewritten).
const EXECUTION_ID=/^[A-Za-z0-9][A-Za-z0-9:_.-]{7,119}$/;
const CARRIED_STATUSES=['preserved','demonstrated','historical_review'];
const missingObjectives=state=>state.objectives.filter(o=>!CARRIED_STATUSES.includes(o.status)&&o.requiredForCompletion!==false).map(o=>o.id);
const objectiveSignature=o=>JSON.stringify({id:o.id,domain:o.domain,criteria:o.criteria||[],rule:o.rule||'',legacy:o.legacy||null});
// Demonstrated dialogue objectives of earlier sessions carry forward only when the objective definition is identical in the
// new curriculum. Formal (legacy) items and reading confirmations already carry through historicalEvidence (source records).
async function computeCarryForward(db,studentId,lessonId,curriculum,excludeSessionId=null){
 const prior=await all(db.prepare('SELECT id,curriculum_version,curriculum_json FROM dialogue_sessions WHERE student_id=? AND lesson_id=? AND id<>? ORDER BY created_at,id').bind(studentId,lessonId,excludeSessionId??''));
 if(!prior.length)return {carriedForward:[],priorSessions:[]};
 const wanted=new Map(curriculum.objectives.filter(o=>o.domain!=='legacy').map(o=>[o.id,objectiveSignature(o)]));
 const carried=new Map();
 for(const p of prior){
  let old;try{old=JSON.parse(p.curriculum_json);}catch{continue;}
  const same=new Set((old.objectives||[]).filter(o=>wanted.get(o.id)===objectiveSignature(o)).map(o=>o.id));
  if(!same.size)continue;
  const rows=await all(db.prepare("SELECT objective_id,created_at FROM dialogue_assessments WHERE session_id=? AND outcome='demonstrated' ORDER BY created_at,id").bind(p.id));
  for(const a of rows)if(same.has(a.objective_id))carried.set(a.objective_id,{objectiveId:a.objective_id,fromSession:p.id,fromCurriculumVersion:p.curriculum_version,assessedAt:a.created_at});
 }
 return {carriedForward:[...carried.values()],priorSessions:prior.map(p=>({sessionId:p.id,curriculumVersion:p.curriculum_version}))};
}
async function executionState(db,session){
 const row=await db.prepare("SELECT details_json,created_at FROM dialogue_events WHERE session_id=? AND event_type='execution_started' ORDER BY created_at DESC,id DESC LIMIT 1").bind(session.id).first();
 return row?{...JSON.parse(row.details_json),startedAt:row.created_at}:null;
}
async function ensureExecution(db,session,published,executionId){
 const existing=await db.prepare("SELECT details_json FROM dialogue_events WHERE session_id=? AND event_type='execution_started' AND json_extract(details_json,'$.executionId')=? LIMIT 1").bind(session.id,executionId).first();
 if(existing)return JSON.parse(existing.details_json);
 const details={executionId,requiredCurriculumVersion:published.curriculumVersion,sessionCurriculumVersion:session.curriculum_version,...await computeCarryForward(db,session.student_id,session.lesson_id,published,session.id)};
 await db.prepare("INSERT INTO dialogue_events(id,session_id,turn_id,event_type,details_json,created_at) VALUES(?,?,NULL,'execution_started',?,?)").bind(`execution:${session.id}:${executionId}`,session.id,JSON.stringify(details),now()).run();
 return details;
}
async function executionPreview(db,studentId,published,executionId,state){
 const plan=await computeCarryForward(db,studentId,published.lessonId,published,null);
 const carriedIds=new Set(plan.carriedForward.map(c=>c.objectiveId));
 return {executionId,requiredCurriculumVersion:published.curriculumVersion,satisfied:false,created:false,...plan,missing:state.objectives.filter(o=>!CARRIED_STATUSES.includes(o.status)&&!carriedIds.has(o.id)&&o.requiredForCompletion!==false).map(o=>o.id)};
}
async function carriedAssessments(db,session,execution){
 const wanted=new Map((execution.carriedForward||[]).map(c=>[c.objectiveId,c]));
 if(!wanted.size)return [];
 const rows=await all(db.prepare("SELECT a.*,s.curriculum_version AS from_version FROM dialogue_assessments a JOIN dialogue_sessions s ON s.id=a.session_id WHERE s.student_id=? AND s.lesson_id=? AND a.session_id<>? AND a.outcome='demonstrated' ORDER BY a.created_at,a.id").bind(session.student_id,session.lesson_id,session.id));
 return rows.filter(a=>wanted.get(a.objective_id)?.fromSession===a.session_id).map(a=>({objectiveId:a.objective_id,outcome:a.outcome,evidence:JSON.parse(a.evidence_json),rationale:a.rationale,ruleVersion:a.rule_version,createdAt:a.created_at,carriedFrom:{sessionId:a.session_id,curriculumVersion:a.from_version,turnId:a.turn_id}}));
}
async function exportSession(db,s){
 // Every turn is exported: the transcript is read in bounded chunks until exhausted (never cut). A session beyond the
 // policy bound (lessonLifetime x 2 rows) is still complete and is flagged for review instead of being truncated.
 const bound=LIMITS.lessonLifetime*2,chunk=500,rows=[];
 for(let after=0;;){const page=await all(db.prepare('SELECT id,sequence,role,content,status,question_id,reply_to,model,model_version,policy_version,created_at,source_request_json FROM dialogue_turns WHERE session_id=? AND sequence>? ORDER BY sequence LIMIT ?').bind(s.id,after,chunk));rows.push(...page);if(page.length<chunk||rows.length>=bound*8)break;after=page.at(-1).sequence;}
 const overBound=rows.length>bound;
 const replied=new Set(rows.filter(t=>t.role==='teacher'&&t.reply_to).map(t=>t.reply_to));
 const chunks=await all(db.prepare('SELECT c.turn_id,c.content FROM dialogue_stream_chunks c JOIN dialogue_turns t ON t.id=c.turn_id WHERE t.session_id=? ORDER BY t.sequence,c.sequence').bind(s.id));
 const partial=new Map();for(const c of chunks)partial.set(c.turn_id,(partial.get(c.turn_id)||'')+c.content);
 const turns=rows.map(t=>{const confirmed=t.status==='saved';const streamed=t.role==='student'&&!replied.has(t.id)&&partial.has(t.id)?partial.get(t.id):null;
  return {id:t.id,sequence:t.sequence,role:t.role,speaker:t.role==='student'?'student':'author-simulation',content:t.content,status:t.status,confirmed,createdAt:t.created_at,model:t.model,modelVersion:t.model_version,policyVersion:t.policy_version,questionId:t.question_id,replyTo:t.reply_to,formal:t.source_request_json?JSON.parse(t.source_request_json):null,...(streamed!==null?{partialReply:{content:streamed,label:'incomplete_unconfirmed_stream'}}:{})};});
 const {submissions}=await learningRecords(db,s),assessments=await assessmentRows(db,s.id);
 const drafts=await all(db.prepare('SELECT mutation_id,revision,content,question_id,created_at FROM dialogue_drafts WHERE session_id=? AND submitted_turn_id IS NULL ORDER BY created_at,id').bind(s.id));
 const executions=(await all(db.prepare("SELECT details_json,created_at FROM dialogue_events WHERE session_id=? AND event_type='execution_started' ORDER BY created_at,id").bind(s.id))).map(e=>({...JSON.parse(e.details_json),startedAt:e.created_at}));
 return {sessionId:s.id,lessonId:s.lesson_id,curriculumVersion:s.curriculum_version,policyVersion:s.policy_version,revision:s.revision,createdAt:s.created_at,updatedAt:s.updated_at,inflight:!!s.inflight,turnCount:rows.length,complete:true,...(overBound?{reviewRequired:'transcript_over_policy_bound'}:{}),
  turns,submissions:submissions.map(x=>({turnId:x.turnId,sequence:x.sequence,objectiveId:x.objectiveId,interaction:x.interaction,label:x.label,input:x.input,status:x.status,assessment:x.assessment??null})),
  assessments:assessments.map(a=>({objectiveId:a.objectiveId,outcome:a.outcome,ruleVersion:a.ruleVersion,createdAt:a.createdAt})),
  unsentDrafts:drafts.map(d=>({mutationId:d.mutation_id,revision:d.revision,content:d.content,questionId:d.question_id,createdAt:d.created_at,label:'unsent_draft'})),executions};
}
async function transcript(db,session){
 const rows=await all(db.prepare('SELECT id,sequence,role,content,question_id AS questionId,status,created_at AS createdAt FROM dialogue_turns WHERE session_id=? ORDER BY sequence LIMIT ?').bind(session.id,LIMITS.lessonLifetime*2+1));
 if(rows.length>LIMITS.lessonLifetime*2)throw Error('transcript_requires_review');
 return rows;
}
async function assessmentRows(db,id){return (await all(db.prepare('SELECT * FROM dialogue_assessments WHERE session_id=? ORDER BY created_at,id').bind(id))).map(a=>({objectiveId:a.objective_id,outcome:a.outcome,evidence:JSON.parse(a.evidence_json),rationale:a.rationale,ruleVersion:a.rule_version,createdAt:a.created_at}));}
async function savedConclusion(db,id){const row=await db.prepare("SELECT details_json FROM dialogue_events WHERE session_id=? AND event_type='conclusion_saved' ORDER BY created_at DESC,id DESC LIMIT 1").bind(id).first();return row?JSON.parse(row.details_json):null;}
async function proposedSourceDraft(db,session,legacy,submissions){
 if(legacy.completion)return null;
 const rows=await all(db.prepare("SELECT e.details_json,t.sequence FROM dialogue_events e JOIN dialogue_turns t ON t.id=e.turn_id WHERE e.session_id=? AND e.event_type='source_answer_proposed' ORDER BY t.sequence DESC,e.id DESC").bind(session.id));
 for(const row of rows){
  const draft=JSON.parse(row.details_json);
  if(legacy.preserved.some(p=>p.objectiveId===draft.formal.objectiveId))continue;
  const sent=submissions.filter(s=>s.objectiveId===draft.formal.objectiveId&&s.status!=='refused'),latest=sent.at(-1);
  // Uncertain results cannot be retried through another proposal. Once an
  // unsuccessful result is confirmed, a later revised answer may be assessed
  // separately, but neither an older proposal nor repackaged old words may run.
  if(sent.some(s=>s.status!=='confirmed'))continue;
  if(latest){
   if(row.sequence<=latest.sequence||sent.some(s=>JSON.stringify(s.input)===JSON.stringify(draft.formal.input)))continue;
   let revised=false;
   for(const ref of draft.references||[]){
    if(await db.prepare("SELECT id FROM dialogue_turns WHERE session_id=? AND id=? AND role='student' AND sequence>? LIMIT 1").bind(session.id,ref.turnId,latest.sequence).first()){revised=true;break;}
   }
   if(!revised)continue;
  }
  return draft;
 }
 return null;
}
async function learningRecords(db,session){
 const fields=(await all(db.prepare("SELECT e.details_json,t.content,t.sequence,t.id AS turnId FROM dialogue_events e JOIN dialogue_turns t ON t.id=e.turn_id WHERE e.session_id=? AND e.event_type='source_field_saved' ORDER BY t.sequence").bind(session.id))).map(({details_json,...row})=>({...row,...JSON.parse(details_json)}));
 // A submission the source refused for a missing classical prerequisite was never evaluated or recorded: it is 'refused',
 // not an uncertain result, so it neither blocks the saved draft nor counts as an attempt.
 const refused=new Set((await all(db.prepare("SELECT turn_id FROM dialogue_events WHERE session_id=? AND event_type='response_unconfirmed' AND json_extract(details_json,'$.stage')='original_source' AND json_extract(details_json,'$.code') IN ('classical_first_read_required','classical_annotated_reading_required')").bind(session.id))).map(r=>r.turn_id));
 const rows=await all(db.prepare("SELECT t.id AS turnId,t.sequence,t.source_request_json,t.status,c.state AS call_state,COALESCE(c.finished_at,c.created_at) AS call_updated_at,e.details_json FROM dialogue_turns t LEFT JOIN dialogue_calls c ON c.turn_id=t.id LEFT JOIN dialogue_events e ON e.turn_id=t.id AND e.event_type IN ('source_assessment_saved','original_source_saved') WHERE t.session_id=? AND t.role='student' AND t.source_request_json IS NOT NULL ORDER BY t.sequence").bind(session.id));
 const submissions=rows.map(row=>{const result=row.details_json?JSON.parse(row.details_json):null,formal=result?.request||JSON.parse(row.source_request_json),assessment=result?.assessment||result?.evaluation;return {turnId:row.turnId,sequence:row.sequence,objectiveId:formal.objectiveId,input:formal.input,interaction:formal.interaction,label:formal.interaction==='studyGuideItemCompleted'?'學習提示':formal.interaction==='readAcknowledged'?'閱讀確認':null,references:formal.references||null,status:result?'confirmed':refused.has(row.turnId)?'refused':['reserved','finishing'].includes(row.call_state)&&Date.now()-Date.parse(row.call_updated_at)<120000?'pending':'unconfirmed',score:result&&Number.isFinite(assessment?.score??assessment?.numericScore)?assessment.score??assessment.numericScore:null,correctness:assessment?.correctness||null,scoringRole:['evaluation','readAcknowledged'].includes(formal.interaction)?'none':null,sourceEventId:result?.sourceEventId||null,assessment,reference:formal.reference||null};});
 return {fields,submissions};
}
async function plannedQuestion(db,session,curriculum,state){
 // Classical close reading follows the text: the planned word is the paragraph guide's next open word.
 const guided=state.next?.domain==='vocabulary'?paragraphGuide(curriculum,state,questionItems(curriculum))?.focus?.next:null;
 const objective=guided?state.objectives.find(o=>o.id===guided.objectiveId)||state.next:state.next;
 if(objective?.domain!=='vocabulary'||!questionItems(curriculum).some(v=>v.id===objective.id))return null;
 const row=await db.prepare('SELECT instance_json FROM dialogue_questions WHERE session_id=? AND objective_id=? ORDER BY attempt DESC LIMIT 1').bind(session.id,objective.id).first(),prior=row?JSON.parse(row.instance_json):null;
 if(prior&&['mastered','review'].includes(prior.state)&&!calibrationReopensReview(prior,curriculum))return null;
 if(prior&&!calibrationReopensReview(prior,curriculum)&&!(await db.prepare("SELECT id FROM dialogue_assessments WHERE session_id=? AND objective_id=? AND outcome='reformulated' AND created_at>? LIMIT 1").bind(session.id,objective.id,prior.answeredAt||prior.createdAt).first()))return null;
 const attempt=(prior?.attempt||0)+1,digest=await sha(`${session.student_id}:${curriculum.curriculumVersion}:${objective.id}:${attempt}`);
 try{const q=createQuestion(curriculum,{objectiveId:objective.id,attempt,previousVariant:prior?.variant??null,random:parseInt(digest.slice(0,8),16)});return {...q,id:`guided-${digest.slice(0,32)}`,createdAt:session.created_at};}catch{return null;}
}
async function snapshot(db,session,curriculum,before){
 const [page,assessments,q,draft]=await Promise.all([history(db,session,before),assessmentRows(db,session.id),db.prepare("SELECT instance_json FROM dialogue_questions WHERE session_id=? AND state='issued'").bind(session.id).first(),db.prepare('SELECT mutation_id,revision,content,question_id,created_at,source_request_json FROM dialogue_drafts WHERE session_id=? AND submitted_turn_id IS NULL AND revision=? ORDER BY created_at DESC LIMIT 1').bind(session.id,session.revision).first()]);
 const legacy=await historicalEvidence(db,session.student_id,curriculum),preserved=legacy.preserved;
 const execution=await executionState(db,session),carried=execution?await carriedAssessments(db,session,execution):[],merged=carried.length?[...carried,...assessments]:assessments;
 let question=q?JSON.parse(q.instance_json):null;
 // Answer criteria are server-only and never included in the student question.
 let publicQuestion=question?{id:question.id,objectiveId:question.objectiveId,attempt:question.attempt,question:question.question,source:question.source,createdAt:question.createdAt}:null;
 const conclusion=await savedConclusion(db,session.id);
 const state=projectState(curriculum,merged,preserved,legacy.completion,await readingGate(db,session.student_id,curriculum,legacy),conclusion),completeTurns=await transcript(db,session);
 if(!question){question=await plannedQuestion(db,session,curriculum,state);if(question)publicQuestion={id:question.id,objectiveId:question.objectiveId,attempt:question.attempt,question:question.question,source:question.source,createdAt:question.createdAt};}
 const partialRows=await all(db.prepare(`SELECT c.content,c.sequence,c.created_at,t.id AS turn_id,t.status FROM dialogue_stream_chunks c JOIN dialogue_turns t ON t.id=c.turn_id WHERE t.session_id=? AND c.turn_id=(SELECT id FROM dialogue_turns WHERE session_id=? AND role='student' ORDER BY sequence DESC LIMIT 1) AND NOT EXISTS(SELECT 1 FROM dialogue_turns r WHERE r.reply_to=t.id AND r.role='teacher') ORDER BY c.sequence LIMIT 128`).bind(session.id,session.id));
 const inflight=session.inflight?await db.prepare('SELECT state,COALESCE(finished_at,created_at) AS updated_at FROM dialogue_calls WHERE turn_id=?').bind(session.inflight).first():null;
 const pending=!!session.inflight&&!!inflight&&['reserved','finishing'].includes(inflight.state)&&Date.now()-Date.parse(inflight.updated_at)<120000;
 const partial=partialRows.length?{turnId:partialRows[0].turn_id,content:partialRows.map(c=>c.content).join(''),status:partialRows[0].status==='needs_review'||!pending?'unconfirmed':'streaming'}:null;
 if(partial){
  partial.digest=await sha(partial.content);
  const call=await db.prepare('SELECT c.*,t.source_request_json FROM dialogue_calls c JOIN dialogue_turns t ON t.id=c.turn_id WHERE c.turn_id=? AND c.session_id=?').bind(partial.turnId,session.id).first();
  const failed=await db.prepare("SELECT details_json FROM dialogue_events WHERE turn_id=? AND session_id=? AND event_type='response_unconfirmed' ORDER BY created_at DESC,id DESC LIMIT 1").bind(partial.turnId,session.id).first();
  const continued=await db.prepare("SELECT id FROM dialogue_events WHERE id=? AND session_id=?").bind(`${partial.turnId}:continued`,session.id).first();
  const failureDetails=failed?JSON.parse(failed.details_json):null;
  partial.continuation=continuationDisposition(call,failureDetails,!!continued);
  if(failureDetails?.stage)partial.disposition={stage:failureDetails.stage,code:failureDetails.code||null,received:['proposal','original_evidence','reading_evidence'].includes(failureDetails.stage)&&failureDetails.providerAccounting?.attempts?.at?.(-1)?.outcome==='OK'};
 }
 // A saved student turn whose provider attempts all ended before any output has no partial to continue; it may be re-dispatched once by an explicit learner action.
 let replyRetry=null;
 if(!partial&&!pending){
  const unanswered=await db.prepare("SELECT t.id FROM dialogue_turns t WHERE t.session_id=? AND t.role='student' AND t.status='needs_review' AND t.sequence=(SELECT MAX(sequence) FROM dialogue_turns WHERE session_id=?) AND NOT EXISTS(SELECT 1 FROM dialogue_turns r WHERE r.reply_to=t.id AND r.role='teacher')").bind(session.id,session.id).first();
  if(unanswered){
   const call=await db.prepare('SELECT c.*,t.source_request_json FROM dialogue_calls c JOIN dialogue_turns t ON t.id=c.turn_id WHERE c.turn_id=? AND c.session_id=?').bind(unanswered.id,session.id).first();
   const failed=await db.prepare("SELECT details_json FROM dialogue_events WHERE turn_id=? AND session_id=? AND event_type='response_unconfirmed' ORDER BY created_at DESC,id DESC LIMIT 1").bind(unanswered.id,session.id).first();
   const continued=await db.prepare("SELECT id FROM dialogue_events WHERE id=? AND session_id=?").bind(`${unanswered.id}:continued`,session.id).first();
   const details=failed?JSON.parse(failed.details_json):null;
   replyRetry={turnId:unanswered.id,...continuationDisposition(call,details,!!continued,{noOutput:true}),...(details?.stage?{stage:details.stage,code_detail:details.code||null}:{})};
  }
 }
 const records=await learningRecords(db,session),sourceDraft=await proposedSourceDraft(db,session,legacy,records.submissions);
 state.score=lessonScore(curriculum,state,{submissions:records.submissions});
 const statusEvent=await db.prepare("SELECT details_json FROM dialogue_events WHERE session_id=? AND event_type='source_status' AND turn_id=(SELECT id FROM dialogue_turns WHERE session_id=? AND role='student' ORDER BY sequence DESC LIMIT 1) ORDER BY created_at DESC LIMIT 1").bind(session.id,session.id).first();
 const statusNotice=statusEvent?JSON.parse(statusEvent.details_json).message:null;
 return {statusNotice,paragraphGuide:paragraphGuide(curriculum,state,questionItems(curriculum)),learningTurn:learningTurn(curriculum,state,{revision:session.revision,...records,sourceDraft,question:publicQuestion,mastery:legacy.mastery}),sourceSubmissions:records.submissions,originalTask:originalTask(curriculum,state,legacy.mastery),sourceDraft,partial,replyRetry,ownerRef:await sha(`dialogue-owner:${session.student_id}`),sessionId:session.id,revision:session.revision,pending,curriculumVersion:session.curriculum_version,...page,state,assessments:merged,report:evidenceReport(curriculum,state,merged,completeTurns,conclusion),execution:execution?{...execution,satisfied:session.curriculum_version===execution.requiredCurriculumVersion,missing:missingObjectives(state)}:null,question:publicQuestion,draft:draft?{mutationId:draft.mutation_id,revision:draft.revision,content:draft.content,questionId:draft.question_id,createdAt:draft.created_at,formal:draft.source_request_json?JSON.parse(draft.source_request_json):null,learningRequest:draft.source_request_json?JSON.parse(draft.source_request_json).learningRequest||null:null}:null,legacy,readingGate:state.readingGate};
}
export async function handleDialogue(request,env,student,ctx,{callModel=callDialogueModel,readSharedHistory=null,firstReadAction=null,formalAction=null,originalAction=null}={}){
 if(!student)return json({error:'請先登入 My。',code:'authentication_required'},401);
 if(!admitted(env,student))return json({error:'試點尚未開放。',code:'pilot_unavailable'},404);
 const url=new URL(request.url),lessonId=url.searchParams.get('lessonId');
 if(url.searchParams.has('calibration'))return handleCalibration(request,env,student,callModel);
 let curriculum;try{curriculum=await loadDialogueCurriculum(env,lessonId);}catch{return json({code:'curriculum_unavailable'},503);}
 const db=env.READING_DB;
 if(request.method==='POST')await reconcileAbandonedCalls(db);
 const publishedCurriculum=curriculum;
 let session=await db.prepare('SELECT * FROM dialogue_sessions WHERE student_id=? AND lesson_id=? ORDER BY created_at DESC,id DESC LIMIT 1').bind(student.id,lessonId).first();
 // Explicit new-curriculum attempt selection (homework execution contract): `execution=<id>` binds the request to the
 // session under the currently published curriculum version. An older saved session is never modified; its valid results
 // carry forward by projection (ensureExecution). Without `execution` the latest session resumes exactly as before.
 const executionId=url.searchParams.get('execution');
 if(executionId!==null&&!EXECUTION_ID.test(executionId))return json({code:'invalid_execution'},400);
 if(executionId!==null)session=await db.prepare('SELECT * FROM dialogue_sessions WHERE student_id=? AND lesson_id=? AND curriculum_version=?').bind(student.id,lessonId,publishedCurriculum.curriculumVersion).first();
 // A new source version never resets an existing learner's objectives or history.
 // The exact per-session contract remains interpretable even after static assets change.
 if(session){try{curriculum=JSON.parse(session.curriculum_json);if(curriculum.lessonId!==lessonId||curriculum.curriculumVersion!==session.curriculum_version)throw Error();}catch{return json({code:'stored_curriculum_requires_review'},503);}}
 // Append only the newly authorized future-answer tasks in the read projection.
 // Completed lessons and an unfinished saved request retain their exact contract.
 // Stored curriculum, prior answers, drafts and scores are never rewritten.
 const historicalCurriculum=curriculum;
 const needsSourceMetadata=!!session&&!Object.hasOwn(curriculum,'sourceInventory')&&!!publishedCurriculum.sourceInventory;
 if(session&&(publishedCurriculum.formalScopeExpansion&&!curriculum.formalScopeExpansion||needsSourceMetadata)){
  const legacy=await historicalEvidence(db,student.id,curriculum),assessments=await assessmentRows(db,session.id),conclusion=await savedConclusion(db,session.id);
  const prior=projectState(curriculum,assessments,legacy.preserved,legacy.completion,await readingGate(db,student.id,curriculum,legacy),conclusion);
  // Only a draft of the current revision can still be sent; older unsent drafts stay in the record and the export.
  const draft=await db.prepare('SELECT mutation_id FROM dialogue_drafts WHERE session_id=? AND submitted_turn_id IS NULL AND revision=? LIMIT 1').bind(session.id,session.revision).first();
  const completed=!!legacy.completion||prior.completion==='evidence_ready_for_review';
  let pending=!!session.inflight||!!draft;
  if(needsSourceMetadata&&!completed&&!pending){
   const [issued,partial]=await Promise.all([
    db.prepare("SELECT id FROM dialogue_questions WHERE session_id=? AND state='issued' LIMIT 1").bind(session.id).first(),
    db.prepare("SELECT t.id FROM dialogue_turns t WHERE t.session_id=? AND t.id=(SELECT id FROM dialogue_turns WHERE session_id=? AND role='student' ORDER BY sequence DESC LIMIT 1) AND EXISTS(SELECT 1 FROM dialogue_stream_chunks c WHERE c.turn_id=t.id) AND NOT EXISTS(SELECT 1 FROM dialogue_turns r WHERE r.reply_to=t.id AND r.role='teacher') LIMIT 1").bind(session.id,session.id).first()]);
   pending=!!issued||!!partial;
  }
  curriculum=withProspectiveFormalScope(curriculum,publishedCurriculum,{completed,pending});
  if(needsSourceMetadata)curriculum=await withSessionSourceMaterials(curriculum,publishedCurriculum,{completed,pending,historicalCurriculum});
 }
 // Current owner dispositions apply to the exact supplementary lesson even
 // when its previous source contract stays frozen in a historical session.
 const exemption=approvedSupplement(publishedCurriculum);
 if(exemption&&curriculum.lessonId===exemption.lessonId)curriculum={...curriculum,completionExemption:exemption};
 const curriculumBeforeCalibration=curriculum;
 try{curriculum=await withCalibratedLanguage(curriculum);}catch{return json({code:'calibration_evidence_requires_review'},503);}
 if(request.method==='GET'){
  if(url.searchParams.get('firstReadingState')==='1'){
   if(curriculum.mode!=='classical')return json({...await readDialogueNotes(db,session,await dialogueReadingAsset(curriculum)),ownerRef:await sha(`dialogue-owner:${student.id}`)});
   if(!firstReadAction)return json({code:'first_read_unavailable'},404);
   const response=await firstReadAction('state',{lessonId}),value=await response.json();
   return json({...value,ownerRef:await sha(`dialogue-owner:${student.id}`)},response.status);
  }
  if(url.searchParams.get('sharedHistory')==='1'){
   const shared=readSharedHistory?await readSharedHistory():{status:'unavailable',reason:'shared_history_unavailable'};
   return json({ownerRef:await sha(`dialogue-owner:${student.id}`),sharedHistory:shared});
  }
  if(url.searchParams.get('sessions')==='1'){
   const page=sessionCursor(url,SESSION_PAGE);if(!page)return json({code:'invalid_cursor'},400);
   const rows=await all(db.prepare('SELECT s.id,s.lesson_id,s.curriculum_version,s.revision,s.created_at,s.updated_at,(SELECT COUNT(*) FROM dialogue_turns t WHERE t.session_id=s.id) AS turn_count,(SELECT MAX(t.created_at) FROM dialogue_turns t WHERE t.session_id=s.id) AS last_turn_at FROM dialogue_sessions s WHERE s.student_id=? AND (? IS NULL OR s.updated_at<? OR (s.updated_at=? AND s.id<?)) ORDER BY s.updated_at DESC,s.id DESC LIMIT ?').bind(student.id,page.before?.updatedAt??null,page.before?.updatedAt??null,page.before?.updatedAt??null,page.before?.id??null,page.limit+1));
   const more=rows.length>page.limit;rows.splice(page.limit);
   const total=Number((await db.prepare('SELECT COUNT(*) AS n FROM dialogue_sessions WHERE student_id=?').bind(student.id).first())?.n??0);
   return json({ownerRef:await sha(`dialogue-owner:${student.id}`),scope:'own-sessions-only',total,pageSize:page.limit,sessions:rows.map(r=>({lessonId:r.lesson_id,curriculumVersion:r.curriculum_version,revision:r.revision,createdAt:r.created_at,updatedAt:r.updated_at,turnCount:Number(r.turn_count||0),lastTurnAt:r.last_turn_at||null})),older:more?{updatedAt:rows.at(-1).updated_at,id:rows.at(-1).id}:null});
  }
  if(url.searchParams.get('exportAll')==='1'){
   // Full-account transcript export: every session of the signed-in account, in bounded pages ordered newest first;
   // each session carries its exact lesson/source versions, speakers, timestamps, saved replies, submissions and
   // assessments, and labels unconfirmed turns, partial streamed replies, unsent drafts and over-long transcripts.
   const page=sessionCursor(url,EXPORT_SESSIONS_PER_PAGE);if(!page)return json({code:'invalid_cursor'},400);
   const sessions=await all(db.prepare('SELECT * FROM dialogue_sessions WHERE student_id=? AND (? IS NULL OR updated_at<? OR (updated_at=? AND id<?)) ORDER BY updated_at DESC,id DESC LIMIT ?').bind(student.id,page.before?.updatedAt??null,page.before?.updatedAt??null,page.before?.updatedAt??null,page.before?.id??null,page.limit+1));
   const more=sessions.length>page.limit;sessions.splice(page.limit);
   const records=[];for(const s of sessions)records.push(await exportSession(db,s));
   const total=Number((await db.prepare('SELECT COUNT(*) AS n FROM dialogue_sessions WHERE student_id=?').bind(student.id).first())?.n??0);
   return json({ownerRef:await sha(`dialogue-owner:${student.id}`),scope:'own-sessions-only',exportedAt:now(),total,pageSize:page.limit,sessions:records,older:more?{updatedAt:sessions.at(-1).updated_at,id:sessions.at(-1).id}:null});
  }
  if(url.searchParams.has('correctionsFor')){
   const turnId=url.searchParams.get('correctionsFor');
   const turn=session&&await db.prepare('SELECT id FROM dialogue_turns WHERE id=? AND session_id=?').bind(turnId,session.id).first();
   if(!turn)return json({code:'turn_not_found'},404);
   const rows=await all(db.prepare("SELECT id,details_json,created_at FROM dialogue_events WHERE session_id=? AND turn_id=? AND event_type='owner_correction_recorded' ORDER BY created_at,id LIMIT 8").bind(session.id,turnId));
   return json({ownerRef:await sha(`dialogue-owner:${student.id}`),corrections:rows.map(r=>({id:r.id,createdAt:r.created_at,...JSON.parse(r.details_json)}))});
  }
  if(!session){const legacy=await historicalEvidence(db,student.id,curriculum),state=projectState(curriculum,[],legacy.preserved,legacy.completion,await readingGate(db,student.id,curriculum,legacy)),planned=await plannedQuestion(db,{id:'not-created',student_id:student.id,created_at:null},curriculum,state),question=planned?{id:planned.id,objectiveId:planned.objectiveId,attempt:planned.attempt,question:planned.question,source:planned.source,createdAt:null}:null;state.score=lessonScore(curriculum,state,{submissions:[]});return json({paragraphGuide:paragraphGuide(curriculum,state,questionItems(curriculum)),learningTurn:learningTurn(curriculum,state,{question}),sourceSubmissions:[],ownerRef:await sha(`dialogue-owner:${student.id}`),revision:0,turns:[],question,state,legacy,readingGate:state.readingGate,report:evidenceReport(curriculum,state,[]),...(curriculum.calibrationEvidence?{resumeCurriculum:sanitizeDialogueCurriculum(curriculum)}:{}),saved:false,...(executionId!==null?{execution:await executionPreview(db,student.id,curriculum,executionId,state)}:{})});}
  const before=url.searchParams.has('beforeSeq')?{sequence:Number(url.searchParams.get('beforeSeq'))}:null;
  if(before && (!Number.isSafeInteger(before.sequence)||before.sequence<1))return json({code:'invalid_cursor'},400);
  if(executionId!==null)await ensureExecution(db,session,publishedCurriculum,executionId);
  const result=await snapshot(db,session,curriculum,before);
  if(curriculum.calibrationEvidence||curriculum.sessionSourceProjection||curriculum.curriculumVersion!==publishedCurriculum.curriculumVersion)result.resumeCurriculum=sanitizeDialogueCurriculum(curriculum);
  if(url.searchParams.get('records')==='1'){
   const [questions,events,drafts,chunks,calls]=await Promise.all([
    all(db.prepare('SELECT instance_json FROM dialogue_questions WHERE session_id=? ORDER BY created_at,id').bind(session.id)),
    all(db.prepare('SELECT id,turn_id,event_type,details_json,created_at FROM dialogue_events WHERE session_id=? ORDER BY created_at,id').bind(session.id)),
    all(db.prepare('SELECT mutation_id,revision,content,question_id,submitted_turn_id,created_at,source_request_json FROM dialogue_drafts WHERE session_id=? ORDER BY created_at,id').bind(session.id)),
    all(db.prepare('SELECT c.turn_id,c.sequence,c.content,c.created_at FROM dialogue_stream_chunks c JOIN dialogue_turns t ON t.id=c.turn_id WHERE t.session_id=? ORDER BY t.sequence,c.sequence').bind(session.id)),
    all(db.prepare('SELECT turn_id,state,reserved_micros,accounted_micros,budget_policy_json,usage_json,first_token_ms,completed_ms,created_at,finished_at FROM dialogue_calls WHERE session_id=? ORDER BY created_at,turn_id').bind(session.id))]);
   result.trace={questions:questions.map(r=>{const q=JSON.parse(r.instance_json);if(q.state==='issued')delete q.criteria;return q;}),events:events.map(({details_json,...e})=>({...e,details:JSON.parse(details_json)})),drafts,chunks,calls};
  }
  return json(result);
 }
 if(request.method!=='POST')return json({code:'method_not_allowed'},405);
 if(Number(request.headers.get('content-length'))>16000)return json({code:'input_too_large'},413);
 const bytes=await request.text();if(bytes.length>16000)return json({code:'input_too_large'},413);
 let body;try{body=JSON.parse(bytes);}catch{return json({code:'invalid_json'},400);}
 if(!body || typeof body!=='object')return json({code:'invalid_input'},400);
 if(body.ownerRef!==await sha(`dialogue-owner:${student.id}`))return json({code:'account_changed',message:'登入帳戶已變更；這輪未保存，請讀回目前帳戶的紀錄再繼續。'},409);
 if(modeConfigured(env)&&(body.formal||body.action==='original'||body.taskId&&body.conversation!==true))return json({code:'mode_conversation_required'},400);
 if(body.action==='first_read'){
  if(curriculum.mode!=='classical'||!['state','mark','delete','submit','resolve','acknowledge'].includes(body.operation)||!body.payload||typeof body.payload!=='object'||Array.isArray(body.payload))return json({code:'invalid_first_read_action'},400);
  if(!firstReadAction)return json({code:'first_read_unavailable',message:'初讀來源暫時不可用；原有紀錄保留。'},503);
  const response=await firstReadAction(body.operation,{...body.payload,lessonId});
  const value=await response.json();return json({...value,ownerRef:await sha(`dialogue-owner:${student.id}`)},response.status);
 }
 if(!session){
  const at=now();await db.prepare('INSERT OR IGNORE INTO dialogue_sessions(id,student_id,lesson_id,curriculum_version,curriculum_json,policy_version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').bind(uuid(),student.id,lessonId,curriculum.curriculumVersion,JSON.stringify(curriculumBeforeCalibration),POLICY_VERSION,at,at).run();
  session=await db.prepare('SELECT * FROM dialogue_sessions WHERE student_id=? AND lesson_id=? AND curriculum_version=?').bind(student.id,lessonId,curriculum.curriculumVersion).first();
 }
 if(executionId!==null)await ensureExecution(db,session,publishedCurriculum,executionId);
 if(body.action==='continue'){
  // An interrupted provider request retains the exact calibration disposition
  // recorded before its first dispatch. A newer supplement cannot alter it.
  const priorContext=await db.prepare("SELECT details_json FROM dialogue_events WHERE session_id=? AND turn_id=? AND event_type='source_context_prepared' ORDER BY created_at,id LIMIT 1").bind(session.id,typeof body.turnId==='string'?body.turnId:'').first();
  const evidence=priorContext?JSON.parse(priorContext.details_json).calibrationEvidence:null;
  if(evidence&&JSON.stringify(evidence)!==JSON.stringify(curriculum.calibrationEvidence))return json({code:'calibration_continuation_requires_review'},503);
  return continueDialogue({request,env,db,student,session,curriculum:evidence?curriculum:curriculumBeforeCalibration,body,ctx,callModel,firstReadAction,originalAction});
 }
 if(body.action==='correction'){
  const result=await recordCorrection(db,session,body,now());return json(result.value,result.status);
 }
 let learningFormal=null,learningField=null,learningHash=null,learningOriginal=null,learningQuestion=null;
 if(body.taskId){
  if(typeof body.content!=='string'||body.content.length>LIMITS.inputChars||!/^[a-zA-Z0-9_-]{16,80}$/.test(body.mutationId||'')||!Number.isSafeInteger(body.revision))return json({code:'invalid_input'},400);
  learningHash=await sha(JSON.stringify(['learning',body.taskId,body.content,body.selectedIndex??null,body.rating??null,body.revision,...(body.conversation===true?['conversation']:[])]));
  const duplicate=await db.prepare("SELECT request_hash FROM dialogue_turns WHERE session_id=? AND mutation_id=? AND role='student'").bind(session.id,body.mutationId).first();
  if(duplicate)return duplicate.request_hash===learningHash?json(await snapshot(db,session,curriculum)):json({code:'idempotency_conflict'},409);
  if(session.inflight||session.revision!==body.revision)return json({code:'stale_revision'},409);
  const data=await snapshot(db,session,curriculum),task=data.learningTurn||{kind:'dialogue'};
  if((!task.taskId||task.taskId!==body.taskId)&&!(body.conversation===true&&!task.taskId&&body.taskId===`${curriculum.curriculumVersion}:${session.revision}:reading-conversation`))return json({code:'learning_task_changed',message:'本輪問題已更新；你的文字保留，請讀回後繼續。'},409);
  if(task.kind==='exemption')return json({code:'owner_approved_supplement',message:'此補充篇目已由教師確認通過，無須作答或新增評分。'},409);
  if(task.kind==='unavailable')return json({code:'source_unavailable'},409);
  const records=await learningRecords(db,session);
  if(body.conversation===true){
   if(data.sourceDraft&&!data.question&&data.state.next?.domain!=='vocabulary'&&sourceDraftReady(curriculum,data.state.readingGate,data.sourceDraft))learningFormal={...data.sourceDraft.formal,references:data.sourceDraft.references};
   if(task.questionId){body.questionId=task.questionId;learningQuestion=await plannedQuestion(db,session,curriculum,data.state);}
  }else if(task.kind==='formal'){
   if(!body.content.trim()||body.content.length>1800)return json({code:'invalid_source_input'},400);
   learningField={objectiveId:task.objectiveId,field:task.field};
   try{learningFormal=collectedFormal(curriculum,task,records.fields,body.content,records.submissions);}catch{return json({code:'invalid_source_input'},400);}
   if(!learningFormal){
    const at=now(),turnId=uuid(),next=learningTurn(curriculum,data.state,{revision:session.revision+1,fields:[...records.fields,{...learningField,content:body.content,sequence:Number.MAX_SAFE_INTEGER}],submissions:records.submissions});
    const writes=await db.batch([
     db.prepare(`INSERT INTO dialogue_turns(id,session_id,mutation_id,request_hash,role,content,status,policy_version,created_at) VALUES(?,(SELECT id FROM dialogue_sessions WHERE id=? AND revision=? AND inflight IS NULL AND (SELECT COUNT(*) FROM dialogue_turns WHERE session_id=? AND role='student')<?),?,?,'student',?,'saved',?,?)`).bind(turnId,session.id,body.revision,session.id,LIMITS.lessonLifetime,body.mutationId,learningHash,body.content,POLICY_VERSION,at),
     db.prepare("INSERT INTO dialogue_events(id,session_id,turn_id,event_type,details_json,created_at) VALUES(?,?,?,'source_field_saved',?,?)").bind(`${turnId}:field`,session.id,turnId,JSON.stringify(learningField),at),
     db.prepare("INSERT INTO dialogue_events(id,session_id,turn_id,event_type,details_json,created_at) VALUES(?,?,?,'source_status',?,?)").bind(`${turnId}:status`,session.id,turnId,JSON.stringify({message:next.prompt}),at),
     db.prepare('UPDATE dialogue_sessions SET revision=revision+1,updated_at=? WHERE id=? AND revision=? AND inflight IS NULL').bind(at,session.id,body.revision),
    ]).catch(()=>null);
    if(!writes)return json({code:'learning_save_unconfirmed',message:'尚未確認保存；請保留文字並讀回本輪紀錄。'},409);
    session=await db.prepare('SELECT * FROM dialogue_sessions WHERE id=?').bind(session.id).first();return json(await snapshot(db,session,curriculum));
   }
  }else if(task.kind==='sourceEvidence'){
   if(!body.content.trim()||!data.sourceDraft)return json({code:'invalid_source_input'},400);
   if(!sourceDraftReady(curriculum,data.state.readingGate,data.sourceDraft))return json({code:'source_prerequisite_pending',message:'本課要先完成無標點初讀（詞句類學案另須讀完帶註釋正文），原有評價才會核對；你的作答已保存。'},409);
   learningFormal={...data.sourceDraft.formal,references:data.sourceDraft.references};
  }else if(['vocabulary','evaluation','read'].includes(task.kind)){
   learningOriginal=task;body.action='original';body.objectiveId=task.objectiveId;
   body.input=task.kind==='vocabulary'?{selectedIndex:body.selectedIndex}:task.kind==='evaluation'?{rating:body.rating,reason:body.content===String(body.rating)?'':body.content}:{acknowledgement:body.content};
  }else if(task.kind==='studyGuide'){
   const item=curriculum.studyGuide.find(item=>item.itemKey===task.itemKey),source=curriculum.legacy.formative.find(item=>item.itemKey===task.itemKey);
   if(!body.content.trim()||!source)return json({code:'invalid_source_input'},400);
   learningFormal={objectiveId:task.objectiveId,interaction:'studyGuideItemCompleted',input:{itemKey:task.itemKey,response:body.content,referenceRevealedAt:now()},content:body.content,resourceKey:source.resourceKey,resourceVersion:source.semanticRevision,reference:item.referenceAnswer};
  }else if(task.questionId){body.questionId=task.questionId;learningQuestion=await plannedQuestion(db,session,curriculum,data.state);}
 }
 if(body.action==='original'){
  if(!originalAction)return json({code:'original_source_unavailable'},503);
  if(!/^[a-zA-Z0-9_-]{16,80}$/.test(body.mutationId||'')||!Number.isSafeInteger(body.revision))return json({code:'invalid_input'},400);
  const requestHash=learningHash||await sha(JSON.stringify(['original',body.objectiveId,body.input,body.revision]));
  const duplicate=await db.prepare("SELECT request_hash FROM dialogue_turns WHERE session_id=? AND mutation_id=? AND role='student'").bind(session.id,body.mutationId).first();
  if(duplicate)return duplicate.request_hash===requestHash?json(await snapshot(db,session,curriculum)):json({code:'idempotency_conflict'},409);
  if(session.inflight||session.revision!==body.revision)return json({code:'stale_revision'},409);
  const count=await db.prepare("SELECT COUNT(*) n FROM dialogue_turns WHERE session_id=? AND role='student'").bind(session.id).first();
  if(count.n>=LIMITS.lessonLifetime)return json({code:'lesson_review_required',message:'本課已達會話上限；已保存紀錄保留，請匯出交由教師覆核。這次選擇尚未保存。'},409);
  const data=await snapshot(db,session,curriculum),task=learningOriginal||data.originalTask;
  if(data.question||!task||task.objectiveId!==body.objectiveId)return json({code:'original_task_not_ready',message:'請先完成目前的語境說明；已完成的原有結果不重做。'},409);
  let formal;try{formal=prepareOriginalInput(curriculum,task,body.input);}catch{return json({code:'invalid_original_input'},400);}
  const turnId=uuid(),at=now();
  try{
   const response=await originalAction({...formal,lessonId},turnId,result=>{
    const reply=formal.interaction==='readAcknowledged'?'已保存你的閱讀確認。繼續說說你對這篇作品的初步理解。':formal.interaction==='evaluation'?'你的篇目自評已保存；高低都不計入成績。':result.evaluation.correctness==='correct'?'這個選項符合原題準據，原有作答紀錄已保存。請保留剛才對語境的解釋，繼續細讀。':'這次選擇與原題準據不同，第一次及後續作答會分開保留。回到原句核對語境，再說說你改變的判斷。';
    return [
     db.prepare(`INSERT INTO dialogue_events(id,session_id,turn_id,event_type,details_json,created_at) VALUES(?,(SELECT id FROM dialogue_sessions WHERE id=? AND student_id=? AND revision=? AND inflight IS NULL AND (SELECT COUNT(*) FROM dialogue_turns WHERE session_id=? AND role='student')<?),?,'original_source_saved',?,?)`).bind(`${turnId}:source`,session.id,student.id,body.revision,session.id,LIMITS.lessonLifetime,turnId,JSON.stringify({objectiveId:formal.objectiveId,...result}),at),
     db.prepare(`INSERT INTO dialogue_turns(id,session_id,mutation_id,request_hash,role,content,status,policy_version,created_at,source_request_json) VALUES(?,?,?,?,'student',?,'saved',?,?,?)`).bind(turnId,session.id,body.mutationId,requestHash,learningOriginal&&body.content?body.content:formal.content,POLICY_VERSION,at,JSON.stringify(formal)),
     db.prepare("INSERT INTO dialogue_events(id,session_id,turn_id,event_type,details_json,created_at) VALUES(?,?,?,'source_status',?,?)").bind(`${turnId}:status`,session.id,turnId,JSON.stringify({message:reply}),at),
     db.prepare('UPDATE dialogue_sessions SET revision=revision+1,updated_at=? WHERE id=? AND revision=? AND inflight IS NULL').bind(at,session.id,body.revision),
    ];
   });
   if(!response.ok){
    const saved=await db.prepare("SELECT id FROM dialogue_turns WHERE session_id=? AND mutation_id=? AND role='student'").bind(session.id,body.mutationId).first();
    if(!saved){const value=await response.json();return json(value,response.status);}
   }
  }catch{
   const saved=await db.prepare("SELECT id FROM dialogue_turns WHERE session_id=? AND mutation_id=? AND role='student'").bind(session.id,body.mutationId).first();
   if(!saved)return json({code:'original_source_unconfirmed',message:'尚未確認原題保存；請保留選擇並讀回紀錄，重送會使用同一回執。'},503);
  }
  session=await db.prepare('SELECT * FROM dialogue_sessions WHERE id=?').bind(session.id).first();return json(await snapshot(db,session,curriculum));
 }
 if(body.action==='question'){
  if(session.inflight)return json({code:'turn_in_progress'},409);
  const legacy=await historicalEvidence(db,student.id,curriculum);
  if(legacy.preserved.some(p=>p.objectiveId===body.objectiveId))return json({code:'already_demonstrated',message:'原有掌握紀錄已保留，不需重做。'},409);
  const gate=await readingGate(db,student.id,curriculum,legacy);
  if(gate && gate.phase!=='close_reading')return json({code:'reading_required',message:gate.phase==='initial_reading'?'請先保存無注疏初讀。':'請先確認讀完帶註釋正文，再進入字詞練習。'},409);
  const outstanding=await db.prepare("SELECT id FROM dialogue_questions WHERE session_id=? AND state='issued'").bind(session.id).first();
  if(outstanding)return json(await snapshot(db,session,curriculum));
  const textOrder=curriculum.mode==='classical'?paragraphGuide(curriculum,{objectives:[],readingGate:gate},questionItems(curriculum))?.order:null;
  const order=textOrder?.length?textOrder:await vocabularyOrder(curriculum,session.id);
  const priorRows=await all(db.prepare('SELECT instance_json FROM dialogue_questions WHERE session_id=? ORDER BY attempt,id').bind(session.id));
  const priorById=new Map(priorRows.map(r=>{const q=JSON.parse(r.instance_json);return [q.objectiveId,q];}));
  const remaining=order.filter(id=>!legacy.preserved.some(p=>p.objectiveId===id)&&!['mastered','review'].includes(priorById.get(id)?.state));
  // A new browser-supplied objective cannot bypass an unanswered remediation.
  const objectiveId=remaining.find(id=>priorById.get(id)?.state==='needs_reformulation')||remaining[0];
  if(!objectiveId)return json([...priorById.values()].some(q=>q.state==='review')?{code:'vocabulary_review_required',message:'語言練習中有待覆核的證據，無須重複作答；請保留紀錄供教師核對，其他閱讀可繼續。'}:{code:'vocabulary_covered',message:'原有與本次字詞證據已保留，可繼續其他閱讀。'},409);
  const prior=priorById.get(objectiveId)||null;
  if(prior?.state==='mastered')return json({code:'already_demonstrated'},409);
  if(prior){
    const reformulated=await db.prepare("SELECT id FROM dialogue_assessments WHERE session_id=? AND objective_id=? AND outcome='reformulated' AND created_at>? LIMIT 1").bind(session.id,prior.objectiveId,prior.answeredAt||prior.createdAt).first();
    if(!reformulated)return json({code:'reformulation_required',message:'請先用自己的話改述剛才的詞義與語境依據，確認後再換一題獨立作答。'},409);
  }
  let q;try{q=createQuestion(curriculum,{objectiveId,attempt:(prior?.attempt||0)+1,previousVariant:prior?.variant??null});}catch{return json({code:'teacher_review_required',message:'請保留答案與提示，交由教師覆核；其他閱讀可繼續。'},409);}
  q.selection={...q.selection,orderAlgorithm:textOrder?.length?'paragraph-order-v1':'sha256-session-v1',coverageOrder:order,coverageIndex:order.indexOf(objectiveId)};
  await db.prepare('INSERT OR IGNORE INTO dialogue_questions(id,session_id,objective_id,attempt,instance_json,state,created_at) VALUES(?,?,?,?,?,?,?)').bind(q.id,session.id,q.objectiveId,q.attempt,JSON.stringify(q),q.state,q.createdAt).run();
  return json(await snapshot(db,session,curriculum));
 }
 if(body.action==='review'){
  const id=`${session.id}:review-request`;
  await db.prepare('INSERT OR IGNORE INTO dialogue_events(id,session_id,event_type,details_json,created_at) VALUES(?,?,?,?,?)').bind(id,session.id,'teacher_review_requested','{"scoringChange":false}',now()).run();
  return json({saved:true,review:'requested',delivery:'student-export-required',message:'覆核請求已保存。請匯出本課紀錄交給任課教師；尚未發送通知。'});
 }
 if(typeof body.content!=='string'||!body.content.trim()||body.content.length>LIMITS.inputChars||!/^[a-zA-Z0-9_-]{16,80}$/.test(body.mutationId||'')||!Number.isSafeInteger(body.revision))return json({code:'invalid_input'},400);
 let formal=learningFormal;
 if(formal&&!formalAction)return json({code:'source_assessment_unavailable'},503);
 if(body.formal){
  try{formal=prepareFormalInput(curriculum,body.formal);}catch{return json({code:'invalid_source_submission',message:'原題作答欄位不完整；文字仍保留，請先核對。'},400);}
  if(!formalAction)return json({code:'source_assessment_unavailable'},503);
  if(body.content!==formal.content||body.questionId)return json({code:'source_content_mismatch'},400);
 }
 const requestHash=learningHash||await sha(JSON.stringify(formal?[body.content,null,body.revision,formal]:[body.content,body.questionId||null,body.revision]));
 const draftRequest=body.taskId?{...formal,learningRequest:{taskId:body.taskId,content:body.content,...(body.conversation===true?{conversation:true}:{}),...(body.selectedIndex!==undefined?{selectedIndex:body.selectedIndex}:{}),...(body.rating!==undefined?{rating:body.rating}:{})}}:formal;
 const duplicate=await db.prepare("SELECT * FROM dialogue_turns WHERE session_id=? AND mutation_id=? AND role='student'").bind(session.id,body.mutationId).first();
 if(duplicate){if(duplicate.request_hash!==requestHash)return json({code:'idempotency_conflict'},409);return json(await snapshot(db,session,curriculum));}
 const capturedDraft=await db.prepare('SELECT request_hash FROM dialogue_drafts WHERE session_id=? AND mutation_id=?').bind(session.id,body.mutationId).first();
 if(capturedDraft && capturedDraft.request_hash!==requestHash)return json({code:'draft_conflict',message:'這份草稿已有保存的原题欄位；請讀回核對，不能改成另一種提交。'},409);
 if(formal){
  // An earlier identical answer the source refused for a missing classical prerequisite was never evaluated or recorded.
  const sameAnswer=await db.prepare(`SELECT c.state FROM dialogue_turns t JOIN dialogue_calls c ON c.turn_id=t.id WHERE t.session_id=? AND t.source_request_json=? AND NOT EXISTS(SELECT 1 FROM dialogue_events e WHERE e.turn_id=t.id AND e.event_type='response_unconfirmed' AND json_extract(e.details_json,'$.stage')='original_source' AND json_extract(e.details_json,'$.code') IN ('classical_first_read_required','classical_annotated_reading_required')) LIMIT 1`).bind(session.id,JSON.stringify(formal)).first();
  if(sameAnswer)return json({code:sameAnswer.state==='finished'?'source_answer_already_recorded':'source_result_unconfirmed',message:'這份原題答案已保存；請讀回原結果。尚未確認的評價不會重送，修改後的新答案另存。'},409);
 }
 const qrow=await db.prepare("SELECT instance_json FROM dialogue_questions WHERE session_id=? AND state='issued'").bind(session.id).first();
 const question=qrow?JSON.parse(qrow.instance_json):learningQuestion;
 if(body.questionId && question?.id!==body.questionId)return json({code:'question_mismatch'},409);
 const original=await historicalEvidence(db,student.id,curriculum),gate=await readingGate(db,student.id,curriculum,original);
 if(curriculum.status==='source-unavailable'||curriculum.sourceStatus==='source-unavailable'||!curriculum.passages?.length)return json({code:'source_unavailable'},409);
 if(formal && (original.completion||original.preserved.some(p=>p.objectiveId===formal.objectiveId)))return json({code:'original_result_preserved',message:'原有結果已保留，不需重評或重做。'},409);
 if(formal && question)return json({code:'question_in_progress',message:'先保留並處理目前的字詞作答，再核對原題。'},409);
 if(gate?.phase==='initial_reading'&&body.conversation!==true)return json({code:'first_read_required',message:'請先在無注疏正文保存疑點、猜測與初讀感知，再展開細讀對話。'},409);
 let budget;
 // Keep the unsent text: 'server' (stored as this revision's draft), 'device' (an earlier unsent text already holds this
 // revision's draft slot — it stays untouched; the newer text stays on the student's device) or 'conflict' (same receipt id
 // with different content).
 const keepDraft=async(at)=>{
  await db.prepare('INSERT OR IGNORE INTO dialogue_drafts(id,session_id,mutation_id,request_hash,revision,content,question_id,created_at,source_request_json) VALUES(?,?,?,?,?,?,?,?,?)').bind(uuid(),session.id,body.mutationId,requestHash,body.revision,body.content,body.questionId||null,at,draftRequest?JSON.stringify(draftRequest):null).run();
  const saved=await db.prepare('SELECT request_hash FROM dialogue_drafts WHERE session_id=? AND mutation_id=?').bind(session.id,body.mutationId).first();
  if(saved)return saved.request_hash===requestHash?'server':'conflict';
  return await db.prepare('SELECT 1 n FROM dialogue_drafts WHERE session_id=? AND revision=? AND submitted_turn_id IS NULL').bind(session.id,body.revision).first()?'device':'conflict';
 };
 const draftConflict=()=>json({code:'draft_conflict',message:'伺服器已有另一份待送草稿；目前文字仍保留在本頁，請先核對匯出紀錄。'},409);
 const deviceOnly=message=>String(message||'').replace('文字已保存','這段文字保存在此裝置（伺服器另存你先前未送出的文字）');
 try{budget=requestDialogueBudget(env,student,lessonId);}catch(error){
  const kept=await keepDraft(now());if(kept==='conflict')return draftConflict();
  // A shared-pool policy past its period is an expired credit period, not a missing policy.
  if(error?.message==='budget_price_expired'&&/"sharedPool"/.test(env.YW_DIALOGUE_BUDGET_JSON||'')){const message=SHARED_POOL_MESSAGES.ended;return json({code:'shared_budget_period_ended',scope:'exhausted',retryable:false,canSave:true,canExport:true,canReview:true,draftSaved:kept==='server',...(kept==='device'?{deviceOnly:true}:{}),message:kept==='device'?deviceOnly(message):message},429);}
  const message='支出政策尚未配置；文字已保存，本輪未呼叫 AI。';
  return json({code:'budget_policy_required',draftSaved:kept==='server',...(kept==='device'?{deviceOnly:true}:{}),message:kept==='device'?deviceOnly(message):message},503);
 }
 const at=now(),day=at.slice(0,10),turnId=uuid();
 if(budget.isolatedAdmission?.operation===MODE_OPERATION&&body.conversation!==true)return json({code:'mode_conversation_required'},400);
 await prepareModeLedger(db,budget,student.id,curriculum);
 await prepareRenewedRetainedFailures(db,budget,student.id);
 const callAdmission=dialogueCallAdmission(budget,student,LIMITS,day,at);
 // Money: the shared pool (one atomic condition over the pool window) or, for a legacy policy, the fixed daily/lesson caps.
 const money=budget.sharedPool?sharedPoolAdmission(budget.sharedPool,budget.reserveMicros,at,{burst:!budget.isolatedAdmission}):{sql:`(SELECT COALESCE(SUM(COALESCE(accounted_micros,reserved_micros)),0) FROM dialogue_calls WHERE day=?)+?<=?
   AND (SELECT COALESCE(SUM(COALESCE(accounted_micros,reserved_micros)),0) FROM dialogue_calls WHERE student_id=? AND day=?)+?<=?
   AND (SELECT COALESCE(SUM(COALESCE(c.accounted_micros,c.reserved_micros)),0) FROM dialogue_calls c JOIN dialogue_sessions s ON s.id=c.session_id WHERE c.student_id=? AND s.lesson_id=?)+?<=?`,args:[day,budget.reserveMicros,budget.globalDailyMicros,student.id,day,budget.reserveMicros,budget.userDailyMicros,student.id,lessonId,budget.reserveMicros,budget.lessonLifetimeMicros]};
 const concurrency=budget.sharedPool?.concurrency??LIMITS.concurrency;
 // Atomic D1 batch: CAS + reservation + student persistence precede the only AI call.
 const changes=await db.batch([
  db.prepare(`UPDATE dialogue_sessions SET revision=revision+1,inflight=?,updated_at=? WHERE id=? AND revision=? AND inflight IS NULL
   AND ${callAdmission.sql}
   AND (SELECT COUNT(*) FROM dialogue_turns WHERE session_id=? AND role='student')<?
   AND (SELECT COUNT(*) FROM dialogue_calls WHERE session_id=?)<?
   AND (SELECT COUNT(*) FROM dialogue_calls WHERE state IN ('reserved','finishing'))<?
   AND NOT EXISTS(SELECT 1 FROM dialogue_calls WHERE budget_policy_json IS NULL)
   AND ${money.sql}`).bind(turnId,at,session.id,body.revision,...callAdmission.args,session.id,LIMITS.lessonLifetime,session.id,lessonCallLimit(curriculum,LIMITS.paidLessonLifetime),concurrency,...money.args),
  ...(learningQuestion?[db.prepare("INSERT OR IGNORE INTO dialogue_questions(id,session_id,objective_id,attempt,instance_json,state,created_at) SELECT ?,id,?,?,?,'issued',? FROM dialogue_sessions WHERE id=? AND inflight=?").bind(learningQuestion.id,learningQuestion.objectiveId,learningQuestion.attempt,JSON.stringify(learningQuestion),learningQuestion.createdAt,session.id,turnId)]:[]),
  db.prepare(`INSERT OR IGNORE INTO dialogue_turns(id,session_id,mutation_id,request_hash,role,content,question_id,status,policy_version,created_at,source_request_json) SELECT ?,id,?,?, 'student',?,?, 'saved',?,?,? FROM dialogue_sessions WHERE id=? AND inflight=?`).bind(turnId,body.mutationId,requestHash,body.content,body.questionId||null,POLICY_VERSION,at,formal?JSON.stringify(formal):null,session.id,turnId),
  db.prepare(`INSERT OR IGNORE INTO dialogue_calls(turn_id,session_id,student_id,day,reserved_tokens,state,created_at,reserved_micros,budget_policy_json) SELECT ?,id,?,?,?,'reserved',?,?,? FROM dialogue_sessions WHERE id=? AND inflight=?`).bind(turnId,student.id,day,budget.maxOutputTokens??LIMITS.outputTokens,at,budget.reserveMicros,JSON.stringify(budget),session.id,turnId),
  db.prepare(`INSERT OR IGNORE INTO dialogue_events(id,session_id,turn_id,event_type,details_json,created_at) SELECT ?,id,?,'turn_saved','{}',? FROM dialogue_sessions WHERE id=? AND inflight=?`).bind(uuid(),turnId,at,session.id,turnId),
  ...(body.conversation===true?[db.prepare("INSERT OR IGNORE INTO dialogue_events(id,session_id,turn_id,event_type,details_json,created_at) SELECT ?,id,?,'conversation_mode',?,? FROM dialogue_sessions WHERE id=? AND inflight=?").bind(`${turnId}:conversation`,turnId,JSON.stringify({version:CONVERSATION_POLICY_VERSION}),at,session.id,turnId)]:[]),
  ...(learningField?[db.prepare("INSERT INTO dialogue_events(id,session_id,turn_id,event_type,details_json,created_at) SELECT ?,id,?,'source_field_saved',?,? FROM dialogue_sessions WHERE id=? AND inflight=?").bind(`${turnId}:field`,turnId,JSON.stringify(learningField),at,session.id,turnId)]:[]),
  db.prepare('UPDATE dialogue_drafts SET submitted_turn_id=? WHERE session_id=? AND mutation_id=? AND request_hash=? AND EXISTS(SELECT 1 FROM dialogue_sessions WHERE id=? AND inflight=?)').bind(turnId,session.id,body.mutationId,requestHash,session.id,turnId),
 ]);
 if(!changes[0].meta.changes){
  const current=await db.prepare('SELECT * FROM dialogue_sessions WHERE id=?').bind(session.id).first();
  if(current.revision!==body.revision || current.inflight)return json({code:current.revision!==body.revision?'stale_revision':'turn_in_progress',message:'此輪尚未送出。請保留文字、讀取已保存紀錄後再繼續。'},409);
  const kept=await keepDraft(at);if(kept==='conflict')return draftConflict();
  const denial=await budgetDenial(db,session,student,budget,{...LIMITS,paidLessonLifetime:lessonCallLimit(curriculum,LIMITS.paidLessonLifetime)},day,at);
  return json({...denial,draftSaved:kept==='server',...(kept==='device'?{deviceOnly:true,message:deviceOnly(denial.message)}:{})},429);
 }
 const stream=request.headers.get('accept')?.includes('text/event-stream')?studentStream():null;
 stream?.send('saved',{saved:true,turnId,mutationId:body.mutationId,revision:body.revision+1,createdAt:at});
 const work=finishTurn({env,db,session,curriculum,question:body.questionId?question:null,turnId,body,callModel,stream,budget,formal,formalAction,firstReadAction,originalAction});
 if(stream){if(ctx?.waitUntil)ctx.waitUntil(work);return stream.response;}
 if(ctx?.waitUntil){ctx.waitUntil(work);return json({saved:true,turnId,pending:true,revision:body.revision+1},202);}
 await work;
 session=await db.prepare('SELECT * FROM dialogue_sessions WHERE id=?').bind(session.id).first();return json(await snapshot(db,session,curriculum));
}
async function continueDialogue({request,env,db,student,session,curriculum,body,ctx,callModel,firstReadAction,originalAction}){
 if(!/^[a-zA-Z0-9_-]{16,80}$/.test(body.mutationId||'')||!Number.isSafeInteger(body.revision)||typeof body.turnId!=='string'||typeof body.partialDigest!=='string'||!(body.partialDigest===''||/^[a-f0-9]{64}$/.test(body.partialDigest)))return json({code:'invalid_continuation'},400);
 const requestHash=await sha(JSON.stringify(['continue',body.turnId,body.partialDigest,body.revision]));
 const previous=await db.prepare("SELECT details_json FROM dialogue_events WHERE id=? AND session_id=?").bind(`${body.turnId}:continued`,session.id).first();
 if(previous){const value=JSON.parse(previous.details_json);return value.mutationId===body.mutationId&&value.requestHash===requestHash?json(await snapshot(db,session,curriculum)):json({code:'continuation_already_used'},409);}
 if(session.inflight||session.revision!==body.revision)return json({code:'stale_revision'},409);
 const turn=await db.prepare("SELECT * FROM dialogue_turns WHERE id=? AND session_id=? AND role='student' AND sequence=(SELECT MAX(sequence) FROM dialogue_turns WHERE session_id=? AND role='student')").bind(body.turnId,session.id,session.id).first();
 if(!turn)return json({code:'continuation_turn_not_current'},409);
 const data=await snapshot(db,session,curriculum),partial=data.partial;
 // Two explicit learner actions share this path: continuing/regenerating visible partial text (partialDigest = its digest) and re-dispatching a saved turn that never received any output (partialDigest = '' and replyRetry allowed).
 const retry=!partial&&body.partialDigest===''&&data.replyRetry?.turnId===turn.id?data.replyRetry:null;
 if(!retry&&(!partial||partial.turnId!==turn.id||partial.digest!==body.partialDigest))return json({code:'continuation_readback_required'},409);
 const disposition=retry||partial.continuation;
 if(!disposition.allowed)return json({code:disposition.code,partial},409);
 const call=await db.prepare('SELECT * FROM dialogue_calls WHERE turn_id=? AND session_id=?').bind(turn.id,session.id).first();
 let stored,budget;
 try{
  stored=JSON.parse(call.budget_policy_json);const current=requestDialogueBudget(env,student,curriculum.lessonId);
  if(JSON.stringify(stored.isolatedAdmission)!==JSON.stringify(current.isolatedAdmission))throw Error('operation_changed');
  for(const key of ['version','model','inputMicrosPerMillion','outputMicrosPerMillion','reserveMicros','providerAttemptLimit'])if(stored[key]!==current[key])throw Error('policy_changed');
  if(call.day!==now().slice(0,10))throw Error('day_changed');
  budget={...stored,providerAttemptLimit:disposition.remainingProviderAttempts};
 }catch{return json({code:'continuation_budget_revalidation_required',canExport:true,canReview:true},409);}
 const failed=await db.prepare("SELECT details_json FROM dialogue_events WHERE turn_id=? AND session_id=? AND event_type='response_unconfirmed' ORDER BY created_at DESC,id DESC LIMIT 1").bind(turn.id,session.id).first();
 const priorAttempts=JSON.parse(failed.details_json).providerAccounting.attempts.map(a=>a.outcome==='OK'?{...a,outcome:'OK_REJECTED'}:a);
 const chunks=await all(db.prepare('SELECT sequence,content FROM dialogue_stream_chunks WHERE turn_id=? ORDER BY sequence').bind(turn.id));
 const at=now();
 const failureDetails=JSON.parse(failed.details_json),regenerate=disposition.code==='explicit_regeneration_available';
 await prepareRenewedRetainedFailures(db,budget,student.id);
 const renewedCondition=renewedOperationCondition(budget,student.id,{continuingTurn:turn.id});
 const updates=await db.batch([
  db.prepare(`UPDATE dialogue_sessions SET revision=revision+1,inflight=?,updated_at=? WHERE id=? AND student_id=? AND revision=? AND inflight IS NULL AND EXISTS(SELECT 1 FROM dialogue_calls WHERE turn_id=? AND state='review') AND NOT EXISTS(SELECT 1 FROM dialogue_events WHERE id=?) AND (SELECT COUNT(*) FROM dialogue_calls WHERE state IN ('reserved','finishing'))<? AND ${renewedCondition.sql}`).bind(turn.id,at,session.id,student.id,body.revision,turn.id,`${turn.id}:continued`,LIMITS.concurrency,...renewedCondition.args),
  db.prepare("UPDATE dialogue_calls SET state='reserved',finished_at=?,accounted_micros=NULL WHERE turn_id=? AND state='review' AND EXISTS(SELECT 1 FROM dialogue_sessions WHERE id=? AND inflight=?)").bind(at,turn.id,session.id,turn.id),
  db.prepare("INSERT OR IGNORE INTO dialogue_events(id,session_id,turn_id,event_type,details_json,created_at) SELECT ?,id,?,'continuation_started',?,? FROM dialogue_sessions WHERE id=? AND inflight=?").bind(`${turn.id}:continued`,turn.id,JSON.stringify({mutationId:body.mutationId,requestHash,partialDigest:body.partialDigest,priorProviderAttempts:priorAttempts.length,remainingProviderAttempts:budget.providerAttemptLimit,regeneration:regenerate,retry:!!retry}),at,session.id,turn.id),
  // A regeneration keeps the rejected text as an audit event (never as learning evidence) and clears the display buffer so the fresh reply is not shown as a continuation of it.
  ...(regenerate?[db.prepare("INSERT OR IGNORE INTO dialogue_events(id,session_id,turn_id,event_type,details_json,created_at) SELECT ?,id,?,'response_rejected_retained',?,? FROM dialogue_sessions WHERE id=? AND inflight=?").bind(`${turn.id}:rejected:${priorAttempts.length}`,turn.id,JSON.stringify({content:partial.content,digest:partial.digest,stage:failureDetails.stage||null,code:failureDetails.code||null,providerAttempt:priorAttempts.length}),at,session.id,turn.id),db.prepare('DELETE FROM dialogue_stream_chunks WHERE turn_id=? AND EXISTS(SELECT 1 FROM dialogue_sessions WHERE id=? AND inflight=?)').bind(turn.id,session.id,turn.id)]:[]),
 ]);
 if(!updates[0].meta.changes){session=await db.prepare('SELECT * FROM dialogue_sessions WHERE id=?').bind(session.id).first();return json({code:session.inflight?'turn_in_progress':'continuation_not_reserved',saved:true},409);}
 const row=turn.question_id?await db.prepare('SELECT instance_json FROM dialogue_questions WHERE id=? AND session_id=?').bind(turn.question_id,session.id).first():null;
 const stream=request.headers.get('accept')?.includes('text/event-stream')?studentStream():null;
 stream?.send('saved',{saved:true,continuation:true,turnId:turn.id,mutationId:body.mutationId,revision:body.revision+1,createdAt:at});
 const mode=await db.prepare("SELECT details_json FROM dialogue_events WHERE id=? AND session_id=? AND event_type='conversation_mode'").bind(`${turn.id}:conversation`,session.id).first();
 const conversation=mode&&JSON.parse(mode.details_json).version===CONVERSATION_POLICY_VERSION;
 const work=finishTurn({env,db,session,curriculum,question:row?JSON.parse(row.instance_json):null,turnId:turn.id,body:{mutationId:turn.mutation_id,content:turn.content,conversation:!!conversation},callModel,stream,budget,formal:null,firstReadAction,originalAction,resume:retry?{partialText:'',sequence:0,priorAttempts,retry:true}:regenerate?{partialText:'',sequence:0,priorAttempts,regenerate:true,rejected:{stage:failureDetails.stage||null,code:failureDetails.code||null}}:{partialText:partial.content,sequence:chunks.at(-1)?.sequence||0,priorAttempts}});
 if(stream){if(ctx?.waitUntil)ctx.waitUntil(work);return stream.response;}
 if(ctx?.waitUntil){ctx.waitUntil(work);return json({saved:true,continuation:true,turnId:turn.id,pending:true,revision:body.revision+1},202);}
 await work;session=await db.prepare('SELECT * FROM dialogue_sessions WHERE id=?').bind(session.id).first();return json(await snapshot(db,session,curriculum));
}

export async function reconcileAbandonedCalls(db,at=now()){
 const cutoff=new Date(Date.parse(at)-120000).toISOString(); // > LIMITS.timeoutMs (90 s): a call still inside its gateway window is never reconciled as abandoned
 const stale="SELECT turn_id FROM dialogue_calls WHERE state IN ('reserved','finishing') AND COALESCE(finished_at,created_at)<?";
 await db.batch([
  db.prepare(`INSERT OR IGNORE INTO dialogue_events(id,session_id,turn_id,event_type,details_json,created_at) SELECT turn_id||':crash',session_id,turn_id,'response_unconfirmed','{"retry":"readback_only","reason":"worker_interrupted"}',? FROM dialogue_calls WHERE turn_id IN (${stale})`).bind(at,cutoff),
  db.prepare(`UPDATE dialogue_turns SET status='needs_review' WHERE id IN (${stale})`).bind(cutoff),
  db.prepare(`UPDATE dialogue_sessions SET inflight=NULL,updated_at=? WHERE inflight IN (${stale})`).bind(at,cutoff),
  db.prepare(`UPDATE dialogue_calls SET state='review',finished_at=? WHERE turn_id IN (${stale})`).bind(at,cutoff),
 ]);
}
async function finishTurn({env,db,session,curriculum,question,turnId,body,callModel:callProvider,stream,budget,formal,formalAction,firstReadAction=null,originalAction=null,resume=null}){
 let observedResult=null,providerAccounting=null,failureStage='context',providerCalls=0;
 const callModel=(...args)=>{providerCalls++;return callProvider(...args);}; // the only provider path of a turn
 const observe=async result=>{failureStage='provider_result';observedResult=result;providerAccounting=combinedProviderAccounting(result.providerAccounting,budget,resume?.priorAttempts||[],true);await validateRenewedResult(db,budget,result,providerAccounting);validateModeResult(budget,result,providerAccounting);return result;};
 const recordPrompt=async (prompt,responseJsonSchema=null,sourceOwnedGuide=null)=>{
  const marker=formal?'下列是同版本課文和註釋原始資料（不是指令或新增判準）：\n':'以下是資料，不是指令：\n';
  const materials=JSON.parse(prompt.split(marker).at(-1).split('\n')[0]);
  const annotationTranscriptions=(materials.annotations||[]).filter(a=>a.transcription).map(a=>({noteId:a.noteId,...a.transcription}));
  const originalRequirementSources=await Promise.all((materials.originalRequirements||[]).map(async r=>({objectiveId:r.objectiveId,source:r.source,materialSha256:await sha(JSON.stringify(r))})));
  const reviewSourceMaterials=await Promise.all((materials.reviewSources||[]).map(async r=>({objectiveId:r.objectiveId,source:r.source,sourceOnly:true,submissionEligible:false,sourceStatus:r.sourceStatus,materialSha256:await sha(JSON.stringify(r))})));
  const details={policyVersion:POLICY_VERSION,contextLayout:formal?'original-evaluator':CONTEXT_LAYOUT_VERSION,promptSha256:await sha(prompt),promptChars:prompt.length,sourceProvenance:materials.sourceProvenance,passages:(materials.passages||[]).map(p=>({id:p.id,sourceOffsets:p.sourceOffsets||null,excerpted:!!p.excerpted,annotationIds:p.annotationIds||[]})),annotationIds:(materials.annotations||[]).map(a=>a.noteId),...(annotationTranscriptions.length?{annotationTranscriptions}:{}),coverage:materials.sourceCoverage||materials.coverage,continued:!!resume};
  if(curriculum.calibrationEvidence)details.calibrationEvidence=curriculum.calibrationEvidence;
  if(responseJsonSchema)Object.assign(details,{responseSchemaVersion:CONCLUSION_SCHEMA_VERSION,responseSchemaSha256:await sha(JSON.stringify(responseJsonSchema))});
  if(formal&&body.conversation===true)details.conversationTurn={turnId,contentSha256:await sha(body.content),chars:body.content.length};
  if(sourceOwnedGuide)details.sourceOwnedGuide={version:'yw-source-owned-guide-reply-v1',source:sourceOwnedGuide.source,materialSha256:await sha(JSON.stringify(sourceOwnedGuide.material)),assessmentSha256:await sha(JSON.stringify(sourceOwnedGuide.assessment)),scoringAuthority:'original-answer-key',replyOnly:true};
  if(originalRequirementSources.length)details.originalRequirementSources=originalRequirementSources;
  if(reviewSourceMaterials.length)details.reviewSourceMaterials=reviewSourceMaterials;
  await db.prepare("INSERT OR IGNORE INTO dialogue_events(id,session_id,turn_id,event_type,details_json,created_at) VALUES(?,?,?,'source_context_prepared',?,?)").bind(`${turnId}:context:${resume?'continued':'initial'}`,session.id,turnId,JSON.stringify(details),now()).run();
 };
 try{
  const completeTurns=await transcript(db,session),assessments=await assessmentRows(db,session.id);
  const legacy=await historicalEvidence(db,session.student_id,curriculum);
  const remediationRows=await all(db.prepare("SELECT q.instance_json FROM dialogue_questions q WHERE q.session_id=? AND q.state='needs_reformulation' AND NOT EXISTS(SELECT 1 FROM dialogue_questions newer WHERE newer.session_id=q.session_id AND newer.objective_id=q.objective_id AND newer.attempt>q.attempt) ORDER BY q.created_at DESC").bind(session.id));
  const state=projectState(curriculum,assessments,legacy.preserved,legacy.completion,await readingGate(db,session.student_id,curriculum,legacy),await savedConclusion(db,session.id));
  // A word whose original choice is already preserved needs no reformulation (r34).
  const remediation=remediationRows.map(r=>JSON.parse(r.instance_json)).find(q=>!legacy.preserved.some(p=>p.objectiveId===q.objectiveId)&&!originalSettles(curriculum,state,q.objectiveId,null))||null;
  let firstReading=null;
  if(body.conversation===true&&curriculum.mode==='classical'){
   const request=new Request(`https://yw.bdfz.net/api/dialogue/v1?lessonId=${curriculum.lessonId}`);
   const asset=await loadClassicalFirstRead(request,env,curriculum.lessonId),reading=await getClassicalFirstReadState(request,env,{id:session.student_id},curriculum.lessonId);
   firstReading={asset,state:reading};
  }else if(body.conversation===true){
   const asset=await dialogueReadingAsset(curriculum);
   firstReading={asset,state:await readDialogueNotes(db,session,asset)};
  }
  const records=await learningRecords(db,session),guide=learningTurn(curriculum,state,{revision:session.revision,...records,question});
  state.score=lessonScore(curriculum,state,{submissions:records.submissions});
  const pendingEvaluation=(()=>{const o=curriculum.objectives.find(o=>o.domain==='legacy'&&o.legacy?.questionKind==='evaluation');if(!o||state.legacyCompletion)return null;const st=state.objectives.find(x=>x.id===o.id)?.status;return ['preserved','historical_review'].includes(st)?null:{objectiveId:o.id,kind:'evaluation'};})();
  // The word being practised keeps its original item on offer, so the follow-up that asks for the missing option can be recorded (r34).
  const originalTasks=body.conversation===true?conversationOriginalTasks(curriculum,state,guide,[...originalVocabularyTasks(curriculum,state,legacy.mastery),questionVocabularyTask(curriculum,state,question||remediation,legacy.mastery),originalTask(curriculum,state,legacy.mastery),pendingEvaluation]):null;
  const firstReadingContext=firstReading?{...firstReading.state,kind:firstReading.asset.kind||'classical-original',summaries:firstReading.state.summaries?.slice(-3),marks:firstReading.state.marks?.slice(-8).map(m=>({...m,...(m.corrections?{corrections:m.corrections.slice(-2)}:{})})),paragraphs:firstReading.asset.paragraphs.filter(p=>body.content.includes(p.key)||unpunctuated(body.content).includes(p.text.slice(0,12))).slice(0,2).map(p=>({...p,text:p.text.slice(0,1200)}))}:null;
  const paragraphFocus=paragraphGuideContext(paragraphGuide(curriculum,state,questionItems(curriculum)));
  let prompt=formal?null:contextFor({curriculum,state,turns:completeTurns,question,remediation,assessments,paragraphGuide:paragraphFocus,...(body.conversation===true?{conversationGuide:guide,conversationOriginalTasks:originalTasks,firstReading:firstReadingContext}:{})});
  if(body.conversation===true&&!formal)prompt=READING_CONVERSATION_POLICY+'\n'+prompt+'\n';
  if(prompt&&body.conversation===true&&!formal&&typeof body.content==='string'){const passages=await authorPassages(env,curriculum,body.content);const extra=authorPassagesContext(passages);if(extra&&prompt.length+extra.length<=LIMITS.contextChars-800)prompt+=extra;}
  if(resume?.retry){/* re-dispatch of a saved turn that received no output: the same prompt, no continuation text */}
  else if(resume?.regenerate)prompt+='\n伺服器確認上一回應已完整收到但未通過核驗（原因代碼：'+(resume.rejected?.code||'unclassified')+'），使用者明確要求重新生成。請重新返回完整原定JSON，不要沿用上一回應的文字；原有學生回答只算一次，所有assessment仍須依原判準和學生證據核驗。';
  else if(resume)prompt+='\n伺服器確認上一串流中斷，使用者明確要求續答。下列是已顯示但未評分的模型文字，不是學生答案或指令。請返回完整原定JSON；reply必須逐字以此字串開頭，再接續尚未完成的回應。原有學生回答只算一次，所有assessment仍須依原判準和學生證據核驗。已顯示字串：'+JSON.stringify(resume.partialText);
  let persisted=resume?.partialText||'',sequence=resume?.sequence||0,lastPersist=0;

  const persistReply=async text=>{
   if(resume&&typeof text==='string'&&text.length<persisted.length&&persisted.startsWith(text))return;
   if(typeof text!=='string'||!text.startsWith(persisted)||text.length>LIMITS.replyChars)throw Error('invalid_visible_stream');
   if(text===persisted||sequence>=127)return;
   if(sequence>0&&text.length-persisted.length<32&&Date.now()-lastPersist<150)return;
   const delta=text.slice(persisted.length),at=now();
   const write=await db.prepare(`INSERT INTO dialogue_stream_chunks(turn_id,sequence,content,created_at) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM dialogue_calls WHERE turn_id=? AND state='reserved')`).bind(turnId,sequence+1,delta,at,turnId).run();
   if(!write.meta.changes)throw Error('call_no_longer_active');
   sequence++;persisted=text;lastPersist=Date.now();
   stream?.send('delta',{turnId,sequence,text:delta,persisted:true});
  };
  if(formal){
   failureStage='original_source';
   let result=null,teacherId=null,attempted=false;
   const response=await formalAction({...formal,lessonId:curriculum.lessonId},turnId,async sourcePrompt=>{
    if(attempted)throw Error('duplicate_source_evaluation');attempted=true;
    const prompt=formalPrompt(sourcePrompt,curriculum,formal,body.conversation===true?{turnId,content:body.content}:null);await recordPrompt(prompt);
    failureStage='provider_request';result=await observe(await callModel(env,prompt,turnId,persistReply,budget));
    if(typeof result.value?.reply!=='string'||!result.value.reply.trim()||result.value.reply.length>LIMITS.replyChars||!result.value.reply.startsWith(persisted))throw Error('invalid_source_reply');
    failureStage='original_source';
    return JSON.stringify(result.value);
   },async(reservation,assessment)=>{
    if(!result&&formal.interaction==='studyGuideItemCompleted'){
     if(body.conversation===true){
      if(attempted)throw Error('duplicate_source_evaluation');attempted=true;
      const replyContext=studyGuideConversationReply(curriculum,formal,assessment,{turnId,content:body.content});await recordPrompt(replyContext.prompt,null,{...replyContext,assessment});
      failureStage='provider_request';const response=await observe(await callModel(env,replyContext.prompt,turnId,persistReply,budget));
      if(typeof response.value?.reply!=='string'||!response.value.reply.trim()||response.value.reply.length>LIMITS.replyChars||!response.value.reply.startsWith(persisted))throw Error('invalid_source_reply');
      // The source-owned assessment is already fixed. Discard every model field
      // except reply so conversational output cannot become a grade or action.
      result={...response,value:{reply:response.value.reply}};
     }else result={value:{...assessment,reply:[assessment.verdict,assessment.strength,assessment.nextQuestion].filter(Boolean).join('\n')},model:'source-owned',usage:null};
    }
    failureStage='original_source';if(!result)throw Error('source_reply_missing');
    const at=now();teacherId=uuid();
    // The NOT NULL owner lookup is the transaction guard: if the attempt was
    // reconciled/expired, this batch and every original grade/outbox write fail.
    return [
     db.prepare(`INSERT INTO dialogue_events(id,session_id,turn_id,event_type,details_json,created_at)
      VALUES(?,(SELECT s.id FROM dialogue_sessions s JOIN dialogue_calls c ON c.session_id=s.id WHERE c.turn_id=? AND c.state='reserved' AND s.inflight=c.turn_id AND s.student_id=?),?,'source_assessment_saved',?,?)`).bind(`${turnId}:source`,turnId,session.student_id,turnId,JSON.stringify({objectiveId:formal.objectiveId,sourceEventId:reservation.sourceEventId,resourceKey:formal.resourceKey,resourceVersion:formal.resourceVersion,assessment,modelReply:result.value}),at),
     db.prepare(`INSERT INTO dialogue_turns(id,session_id,mutation_id,request_hash,role,content,reply_to,status,model,model_version,policy_version,created_at) VALUES(?,?,?,?,'teacher',?,?,'saved',?,?,?,?)`).bind(teacherId,session.id,body.mutationId,'original-source-response',result.value.reply,turnId,result.model||null,result.modelVersion||null,POLICY_VERSION,at),
     db.prepare("INSERT OR IGNORE INTO dialogue_events(id,session_id,turn_id,event_type,details_json,created_at) VALUES(?,?,?,'provider_accounting_saved',?,?)").bind(`${turnId}:accounting`,session.id,turnId,JSON.stringify({providerAccounting,studentUsage:result.usage||null,studentAccountedMicros:attempted?reconciledCost(budget,result.usage):0,operatorAccountedMicros:attempted?operatorCost(budget,result,providerAccounting):0,reservedMicros:budget.reserveMicros}),at),
     db.prepare("UPDATE dialogue_calls SET state='finished',finished_at=?,usage_json=?,first_token_ms=?,completed_ms=?,accounted_micros=? WHERE turn_id=? AND state='reserved'").bind(at,JSON.stringify(result.usage||null),Number.isSafeInteger(result.firstTokenMs)?result.firstTokenMs:null,Number.isSafeInteger(result.totalDurationMs)?result.totalDurationMs:null,attempted?operatorCost(budget,result,providerAccounting):0,turnId),
     db.prepare('UPDATE dialogue_sessions SET inflight=NULL,updated_at=? WHERE id=? AND inflight=?').bind(at,session.id,turnId),
    ];
   });
   if(!response.ok||!teacherId)throw Error('source_result_unconfirmed');
   stream?.send('done',{saved:true,turnId,teacherTurnId:teacherId});return;
  }
  const responseJsonSchema=dialogueConclusionSchema({curriculum,state,turns:completeTurns,question,remediation,prompt});
  await recordPrompt(prompt,responseJsonSchema);
  failureStage='provider_request';
  const result=await observe(await callModel(env,prompt,resume?`${turnId}:continue`:turnId,persistReply,budget,{responseJsonSchema}));
  if(resume&&!result.value?.reply?.startsWith(resume.partialText))throw Error('continuation_prefix_mismatch');
  failureStage='proposal';
  // A reply the student can read is never discarded because an optional proposal (an assessment, a source draft, a
  // conclusion, an original-evidence or reading-evidence reference) failed verification: the failing part is dropped,
  // nothing is credited for it, and the rejection is recorded as an event. A reply without a usable reply text still fails.
  const rejectedParts=[],validateWith=value=>validateProposal(value,{curriculum,state,turns:completeTurns,question,remediation,assessments,hints:completeTurns.filter(t=>t.role==='teacher').map(t=>t.content),conversation:body.conversation===true});
  const partCode=rejectionCode;
  // Only the student's conversation path keeps the reply; structured turns and isolated acceptance / diagnostic
  // admissions keep failing closed so their evidence and failure records are unchanged.
  const lenient=body.conversation===true&&!budget.isolatedAdmission;
  // A readable reply whose structured assessments field is missing or malformed keeps the reply: the field is dropped,
  // nothing is credited for it, and the rejection is recorded (conversation path only; isolated admissions fail closed).
  let candidate=result.value;
  if(lenient&&candidate&&typeof candidate.reply==='string'&&candidate.reply.trim()&&candidate.reply.length<=LIMITS.replyChars&&(!Array.isArray(candidate.assessments)||candidate.assessments.length>8)){rejectedParts.push({part:'assessments',code:'invalid_assessments_shape'});candidate={...candidate,assessments:[]};}
  let proposal;
  try{proposal=validateWith(candidate);}
  catch(error){
   if(!lenient||!LENIENT_PROPOSAL_CODES.has(error?.message))throw error;
   const first=partCode(error);
   try{proposal=validateWith({reply:result.value.reply,assessments:Array.isArray(result.value.assessments)?result.value.assessments:[]});rejectedParts.push({part:'sourceDraft_or_conclusion',code:first});}
   catch(second){if(!LENIENT_PROPOSAL_CODES.has(second?.message))throw second;proposal=validateWith({reply:result.value.reply,assessments:[]});rejectedParts.push({part:'assessments',code:first===partCode(second)?first:`${first};${partCode(second)}`});}
  }
  if(body.conversation===true){
   const needsReceipt=proposal.assessments.filter(a=>['read','firstRead','studyGuide','evaluation','legacy'].includes(curriculum.objectives.find(o=>o.id===a.objectiveId)?.domain));
   if(needsReceipt.length){if(!lenient)throw Error('original_evidence_requires_source_receipt');proposal={...proposal,assessments:proposal.assessments.filter(a=>!needsReceipt.includes(a))};rejectedParts.push({part:'assessments',code:'original_evidence_requires_source_receipt',objectiveIds:needsReceipt.map(a=>a.objectiveId)});}
  }
  if(proposal.sourceDraft&&(legacy.completion||legacy.preserved.some(p=>p.objectiveId===proposal.sourceDraft.formal.objectiveId))){if(!lenient)throw Error('original_result_preserved');proposal={...proposal,sourceDraft:null};rejectedParts.push({part:'sourceDraft',code:'original_result_preserved'});}
  // The reply left out the draft of a study-guide answer the student just declared after the reference was shown:
  // derive it from the student's own words (revealFollowupDraft). Only for an item with no earlier proposal or result.
  if(lenient&&!proposal.sourceDraft&&!legacy.completion){
   const derived=revealFollowupDraft(curriculum,state,completeTurns,turnId);
   if(derived&&!legacy.preserved.some(p=>p.objectiveId===derived.formal.objectiveId)){
    const prior=await all(db.prepare("SELECT details_json FROM dialogue_events WHERE session_id=? AND event_type IN ('source_answer_proposed','source_assessment_saved')").bind(session.id));
    if(!prior.some(r=>{const d=JSON.parse(r.details_json);return (d.formal?.objectiveId??d.objectiveId)===derived.formal.objectiveId;}))proposal={...proposal,sourceDraft:derived};
   }
  }
  failureStage='original_evidence';
  let originalEvidence=null;
  if(body.conversation===true){try{originalEvidence=validateOriginalEvidence(result.value.originalEvidence,{turns:completeTurns,curriculum,task:guide,tasks:originalTasks});}catch(error){if(!lenient)throw error;rejectedParts.push({part:'originalEvidence',code:partCode(error)});}}
  failureStage='reading_evidence';
  let readingAction=null;
  if(body.conversation===true){try{readingAction=validateReadingEvidence(result.value.readingEvidence,{turns:completeTurns,asset:firstReading?.asset,state:firstReading?.state,lessonId:curriculum.lessonId,turnId});}catch(error){if(!lenient)throw error;rejectedParts.push({part:'readingEvidence',code:partCode(error),...(error.detail?{detail:error.detail}:{})});}}
  // The author's in-turn assessment of an original formal item goes through the same source pipeline (guard,
  // dedupe, ledger, outbox) while this call is still reserved; the pipeline's own batch commits the receipt.
  failureStage='formal_assessment';
  let formalInline=null;
  if(body.conversation===true&&lenient&&Array.isArray(result.value.formalAssessments)&&result.value.formalAssessments.length){
   // An original-evidence submission (read / rating / choice) and one author assessment may share a turn: each is its own source event.
   if(result.value.formalAssessments.length>1)rejectedParts.push({part:'formalAssessments',code:'one_formal_assessment_per_turn'});
   try{formalInline=validateFormalAssessment(result.value.formalAssessments[0],{curriculum,state,turns:completeTurns,legacy});}
   catch(error){rejectedParts.push({part:'formalAssessments',code:partCode(error)});}
  }
  if(formalInline){
   failureStage='original_source';
   try{
    if(!formalAction)throw Error('original_source_unavailable');
    const promptSha256=await sha(prompt),sourceAt=now();
    const response=await formalAction({...formalInline.formal,lessonId:curriculum.lessonId},turnId,async()=>JSON.stringify({reply:proposal.reply,...formalInline.assessment}),async(reservation,assessment)=>[
     db.prepare(`INSERT INTO dialogue_events(id,session_id,turn_id,event_type,details_json,created_at) VALUES(?,(SELECT s.id FROM dialogue_sessions s JOIN dialogue_calls c ON c.session_id=s.id WHERE c.turn_id=? AND c.state='reserved' AND s.inflight=c.turn_id AND s.student_id=?),?,'source_assessment_saved',?,?)`).bind(`${turnId}:formal`,turnId,session.student_id,turnId,JSON.stringify({objectiveId:formalInline.formal.objectiveId,request:{...formalInline.formal,references:formalInline.references},sourceEventId:reservation.sourceEventId,resourceKey:formalInline.formal.resourceKey,resourceVersion:formalInline.formal.resourceVersion,assessment,modelReply:{reply:proposal.reply},scoringProvenance:{by:'conversation-author',policyVersion:POLICY_VERSION,contextLayout:CONTEXT_LAYOUT_VERSION,promptSha256,turnId}}),sourceAt),
     db.prepare('UPDATE dialogue_turns SET source_request_json=? WHERE id=? AND session_id=?').bind(JSON.stringify({...formalInline.formal,references:formalInline.references}),turnId,session.id),
    ]);
    if(!response.ok){const value=await response.json().catch(()=>({}));rejectedParts.push({part:'formalAssessments',code:/^[a-z0-9_]{1,80}$/.test(value.code||'')?value.code:'original_source_unconfirmed'});formalInline=null;}
   }catch(error){rejectedParts.push({part:'formalAssessments',code:partCode(error)});formalInline=null;}
  }
  failureStage='storage';
  const at=now(),teacherId=uuid();
  const claimed=await db.prepare("UPDATE dialogue_calls SET state='finishing',finished_at=? WHERE turn_id=? AND state='reserved'").bind(at,turnId).run();
  if(!claimed.meta.changes)throw Error('call_already_reconciled');
  const active="EXISTS(SELECT 1 FROM dialogue_calls WHERE turn_id=? AND state='finishing')";
  let readingReceipt=null;
  if(readingAction){
   failureStage='reading_source';
   if(firstReading.asset.kind==='conversation-reading')readingReceipt={kind:'local-dialogue-note',scoringRole:'none',sourceVersion:firstReading.asset.textVersionId};
   else{
    if(!firstReadAction)throw Error('reading_source_unavailable');
    const response=await firstReadAction(readingAction.operation,readingAction.payload);readingReceipt=await response.json();
    if(!response.ok||readingReceipt.ok!==true)throw Error('reading_source_unconfirmed');
   }
  }

  let originalResult=null;
  if(originalEvidence){
   failureStage='original_source';
   if(!originalAction)throw Error('original_source_unavailable');
   const original=prepareOriginalInput(curriculum,originalEvidence.task,originalEvidence.input);
   const response=await originalAction({...original,lessonId:curriculum.lessonId},turnId,result=>(originalResult={objectiveId:original.objectiveId,correctness:result?.evaluation?.correctness},[
    db.prepare('UPDATE dialogue_turns SET source_request_json=? WHERE id=? AND session_id=?').bind(JSON.stringify({...original,references:[originalEvidence.evidence]}),turnId,session.id),
    db.prepare("INSERT INTO dialogue_events(id,session_id,turn_id,event_type,details_json,created_at) VALUES(?,?,?,'original_source_saved',?,?)").bind(`${turnId}:source`,session.id,turnId,JSON.stringify({objectiveId:original.objectiveId,...result}),at),
   ]));
   if(!response.ok)throw Error('original_source_unconfirmed');
  }
  failureStage='storage';
  const statements=[db.prepare(`INSERT INTO dialogue_turns(id,session_id,mutation_id,request_hash,role,content,reply_to,status,model,model_version,policy_version,created_at) SELECT ?,?,?,?,'teacher',?,?,'saved',?,?,?,? WHERE ${active}`).bind(teacherId,session.id,body.mutationId,'server-response',proposal.reply,turnId,result.model||null,result.modelVersion||null,POLICY_VERSION,at,turnId)];
  if(readingAction)statements.push(db.prepare(`INSERT INTO dialogue_events(id,session_id,turn_id,event_type,details_json,created_at) SELECT ?,?,?,'reading_evidence_saved',?,? WHERE ${active}`).bind(`${turnId}:reading`,session.id,turnId,JSON.stringify({action:readingAction,receipt:readingReceipt}),at,turnId));
  if(proposal.sourceDraft)statements.push(db.prepare(`INSERT INTO dialogue_events(id,session_id,turn_id,event_type,details_json,created_at) SELECT ?,?,?,'source_answer_proposed',?,? WHERE ${active}`).bind(`${turnId}:source-proposal`,session.id,turnId,JSON.stringify(proposal.sourceDraft),at,turnId));
  if(rejectedParts.length)statements.push(db.prepare(`INSERT OR IGNORE INTO dialogue_events(id,session_id,turn_id,event_type,details_json,created_at) SELECT ?,?,?,'proposal_parts_rejected',?,? WHERE ${active}`).bind(`${turnId}:rejected`,session.id,turnId,JSON.stringify({policyVersion:POLICY_VERSION,parts:rejectedParts,credited:false,...retainedRejected(result?.value,rejectedParts)}),at,turnId));
  // The author's reply may have announced a score that the server could not record: the student must see that at once, not discover it later.
  const formalRejected=rejectedParts.find(p=>p.part==='formalAssessments');
  const misquotes=body.conversation===true?unverifiedStudentQuotes(proposal.reply,completeTurns):[];
  if(misquotes.length)statements.push(db.prepare(`INSERT OR IGNORE INTO dialogue_events(id,session_id,turn_id,event_type,details_json,created_at) SELECT ?,?,?,'reply_attribution_unverified',?,? WHERE ${active}`).bind(`${turnId}:attribution`,session.id,turnId,JSON.stringify({policyVersion:POLICY_VERSION,quotes:misquotes,credited:false}),at,turnId));
  // The author's reply may have recognised an original answer or a rubric item the server could not record: say so at once,
  // so what the student is told and what is recorded always agree.
  const originalRejected=rejectedParts.find(p=>p.part==='originalEvidence');
  const notices=[...(formalRejected?[formalRejectedNotice(formalRejected.code)]:[]),...(originalRejected?[originalRejectedNotice(originalRejected.code)]:[]),...(misquotes.length?[misquoteNotice(misquotes)]:[])];
  if(notices.length)statements.push(db.prepare(`INSERT OR IGNORE INTO dialogue_events(id,session_id,turn_id,event_type,details_json,created_at) SELECT ?,?,?,'source_status',?,? WHERE ${active}`).bind(`${turnId}:status`,session.id,turnId,JSON.stringify({message:notices.join(' '),code:formalRejected?.code||originalRejected?.code||'reply_attribution_unverified'}),at,turnId));
  if(proposal.conclusion)statements.push(db.prepare(`INSERT INTO dialogue_events(id,session_id,turn_id,event_type,details_json,created_at) SELECT ?,?,?,'conclusion_saved',?,? WHERE ${active}`).bind(`${turnId}:conclusion`,session.id,turnId,JSON.stringify({...proposal.conclusion,curriculumVersion:curriculum.curriculumVersion,policyVersion:POLICY_VERSION,createdAt:at,teacherTurnId:teacherId}),at,turnId));
  for(const a of proposal.assessments)statements.push(db.prepare(`INSERT INTO dialogue_assessments(id,session_id,turn_id,objective_id,outcome,evidence_json,rationale,rule_version,curriculum_version,created_at) SELECT ?,?,?,?,?,?,?,?,?,? WHERE ${active}`).bind(uuid(),session.id,turnId,a.objectiveId,a.outcome,JSON.stringify(a.evidence),a.rationale,a.ruleVersion,curriculum.curriculumVersion,at,turnId));
  const answer=question?proposal.assessments.find(a=>a.objectiveId===question.objectiveId):null;
  // A conversational preference or another verified action is not a wrong
  // answer to the outstanding question. Only its actual assessment advances it.
  if(question&&(body.conversation!==true||answer)){const updated={...question,state:answer?.outcome==='demonstrated'?'mastered':answer?.outcome==='review'?'review':'needs_reformulation',answeredAt:at,hinted:answer?.outcome!=='demonstrated'};statements.push(db.prepare(`UPDATE dialogue_questions SET state=?,instance_json=? WHERE id=? AND session_id=? AND ${active}`).bind(updated.state,JSON.stringify(updated),question.id,session.id,turnId));}
  // A word confirmed by its original choice (correct in this turn, or already preserved) settles its open question even
  // when no dialogue assessment of it was recorded; otherwise every later answer stays bound to a word the paragraph
  // guide has already passed, and the next word can never be credited (2026-10-23). Credit itself is unchanged.
  else if(question&&body.conversation===true&&originalSettles(curriculum,state,question.objectiveId,originalResult)){const updated={...question,state:'mastered',answeredAt:at,settledBy:'original_answer'};statements.push(db.prepare(`UPDATE dialogue_questions SET state=?,instance_json=? WHERE id=? AND session_id=? AND state='issued' AND ${active}`).bind(updated.state,JSON.stringify(updated),question.id,session.id,turnId));}
  statements.push(db.prepare(`INSERT INTO dialogue_events(id,session_id,turn_id,event_type,details_json,created_at) SELECT ?,?,?,?,?,? WHERE ${active}`).bind(uuid(),session.id,turnId,'assessment_saved',JSON.stringify({objectiveIds:proposal.assessments.map(a=>a.objectiveId),ruleVersion:RULE_VERSION}),at,turnId),
   db.prepare("UPDATE dialogue_calls SET state='finished',finished_at=?,usage_json=?,first_token_ms=?,completed_ms=?,accounted_micros=? WHERE turn_id=? AND state='finishing'").bind(at,JSON.stringify(result.usage||null),Number.isSafeInteger(result.firstTokenMs)?result.firstTokenMs:null,Number.isSafeInteger(result.totalDurationMs)?result.totalDurationMs:null,operatorCost(budget,result,providerAccounting),turnId),
   db.prepare('UPDATE dialogue_sessions SET inflight=NULL,updated_at=? WHERE id=? AND inflight=?').bind(at,session.id,turnId));
  statements.push(db.prepare(`INSERT OR IGNORE INTO dialogue_events(id,session_id,turn_id,event_type,details_json,created_at) VALUES(?,?,?,'provider_accounting_saved',?,?)`).bind(`${turnId}:accounting`,session.id,turnId,JSON.stringify({providerAccounting,studentUsage:result.usage||null,studentAccountedMicros:reconciledCost(budget,result.usage),operatorAccountedMicros:operatorCost(budget,result,providerAccounting),reservedMicros:budget.reserveMicros}),at));
  if(resume)statements.push(db.prepare("UPDATE dialogue_turns SET status='saved' WHERE id=? AND EXISTS(SELECT 1 FROM dialogue_calls WHERE turn_id=? AND state='finished')").bind(turnId,turnId));
  const saved=await db.batch(statements);if(!saved[0].meta.changes)throw Error('call_already_reconciled');
  stream?.send('done',{saved:true,turnId,teacherTurnId:teacherId});
 }catch(error){
  // The source transaction may have committed before an outbox decoration or
  // response failed. Read that exact receipt; never downgrade or resubmit it.
  const completed=await db.prepare("SELECT t.id FROM dialogue_turns t JOIN dialogue_calls c ON c.turn_id=t.reply_to WHERE t.reply_to=? AND t.role='teacher' AND c.state='finished'").bind(turnId).first();
  if(completed){stream?.send('done',{saved:true,turnId,teacherTurnId:completed.id});return;}
  if(!providerAccounting&&error.gatewayFailure?.providerAccounting){try{providerAccounting=combinedProviderAccounting(error.gatewayFailure.providerAccounting,budget,resume?.priorAttempts||[],false);}catch{}}
  const failureCode=rejectionCode(error);
  const failure={retry:'readback_only',reason:'response_unconfirmed',providerAccounting,continued:!!resume,stage:failureStage,code:failureCode,...(budget.isolatedAdmission?.operation===RENEWED_E2E_OPERATION?{received:observedResult,renewalReason:/^[a-z0-9_]{1,80}$/.test(error.message||'')?error.message:'response_unconfirmed'}:{})};
  if(budget.isolatedAdmission?.operation===MODE_OPERATION)failure.modeFailure={version:'yw-mode-failure-v1',stage:failureStage,code:MODE_FAILURE_CODES.has(error.message)?error.message:'unclassified'};
  const lateReply=typeof observedResult?.value?.reply==='string'&&observedResult.value.reply.trim()&&observedResult.value.reply.length<=LIMITS.replyChars&&(!resume||observedResult.value.reply.startsWith(resume.partialText||''))?observedResult.value.reply:null;
  if(lateReply){try{const stored=await db.prepare('SELECT COUNT(*) AS n FROM dialogue_stream_chunks WHERE turn_id=?').bind(turnId).first();if(!Number(stored?.n)){await db.prepare('INSERT INTO dialogue_stream_chunks(turn_id,sequence,content,created_at) VALUES(?,1,?,?)').bind(turnId,lateReply,now()).run();failure.lateReplyRetained=true;}}catch{/* retention is best effort; the unconfirmed state stands */}}
  // The provider's cost is settled even though the reply failed validation, but only when every provider attempt's usage is
  // known (ordinary learning only; isolated admissions keep their own reviewed contracts). Otherwise the call stays UNKNOWN and
  // its reservation keeps counting. No learning record is written on this path.
  // A turn that failed before any provider call (and is not a continuation of earlier attempts) cost nothing: settle 0.
  const settledMicros=budget.isolatedAdmission?null:!providerCalls&&!resume?0:knownProviderCost(budget,observedResult,providerAccounting);if(Number.isSafeInteger(settledMicros))failure.accountedMicros=settledMicros;failure.providerCalls=providerCalls;
  const at=now();await db.batch([db.prepare("UPDATE dialogue_calls SET state='review',finished_at=?,usage_json=COALESCE(?,usage_json),accounted_micros=? WHERE turn_id=? AND state IN ('reserved','finishing')").bind(at,observedResult?.usage?JSON.stringify(observedResult.usage):null,Number.isSafeInteger(settledMicros)?settledMicros:null,turnId),db.prepare("UPDATE dialogue_turns SET status='needs_review' WHERE id=? AND NOT EXISTS(SELECT 1 FROM dialogue_calls WHERE turn_id=? AND state='finished')").bind(turnId,turnId),db.prepare('UPDATE dialogue_sessions SET inflight=NULL,updated_at=? WHERE id=? AND inflight=?').bind(at,session.id,turnId),db.prepare('INSERT OR IGNORE INTO dialogue_events(id,session_id,turn_id,event_type,details_json,created_at) VALUES(?,?,?,?,?,?)').bind(`${turnId}:failure${resume?':continue':''}`,session.id,turnId,'response_unconfirmed',JSON.stringify(failure),at)]);
  const call=await db.prepare('SELECT c.*,t.source_request_json FROM dialogue_calls c JOIN dialogue_turns t ON t.id=c.turn_id WHERE c.turn_id=?').bind(turnId).first();
  stream?.send('unconfirmed',{turnId,saved:true,retry:'readback_only',continuation:continuationDisposition(call,failure,!!resume)});
 }finally{stream?.close();}
}
export function http400Diagnostic(failure){
 // Explicit source-verified enums only. Never retain or parse raw provider text.
 const diagnostic={},googleError={};
 const httpStatuses=[400,401,403,404,408,409,413,429,500,502,503,504];
 const googleStatuses=['CANCELLED','UNKNOWN','INVALID_ARGUMENT','DEADLINE_EXCEEDED','NOT_FOUND','ALREADY_EXISTS','PERMISSION_DENIED','RESOURCE_EXHAUSTED','FAILED_PRECONDITION','ABORTED','OUT_OF_RANGE','UNIMPLEMENTED','INTERNAL','UNAVAILABLE','DATA_LOSS','UNAUTHENTICATED'];
 if(failure.error_code==='CLIENT_REQUEST_INVALID')diagnostic.errorCode=failure.error_code;
 if(httpStatuses.includes(failure.status_code))diagnostic.statusCode=failure.status_code;
 const provider=failure.google_error?.error;
 if(provider&&typeof provider==='object'&&!Array.isArray(provider)){
  if(httpStatuses.includes(provider.code))googleError.code=provider.code;
  if(googleStatuses.includes(provider.status))googleError.status=provider.status;
 }
 if(Object.keys(googleError).length)diagnostic.googleError=googleError;
 return Object.keys(diagnostic).length?diagnostic:null;
}
export async function callDialogueModel(env,prompt,requestId,onReply,budget=dialogueBudget(env),{responseJsonSchema=null}={}){
 assertIsolatedCallCurrent(env,budget);
 if(!env.APIS?.fetch||!env.APIS_CALLER_TOKEN)throw new Error('approved_gateway_unavailable');
 const signal=AbortSignal.timeout(LIMITS.timeoutMs);
 const response=await env.APIS.fetch(new Request('https://apis.internal/api/yw/dialogue-stream',{method:'POST',headers:{'content-type':'application/json',accept:'text/event-stream','x-project-name':'yw.bdfz.net','x-task-type':'chat','x-thinking-level':'low',...(env.APIS_CALLER_TOKEN?{'x-internal-token':env.APIS_CALLER_TOKEN}:{}),'x-request-id':requestId},body:JSON.stringify({stream:true,providerAttemptLimit:budget.providerAttemptLimit||1,model:budget.model,...(budget.primaryModel?{tier:'claude-primary'}:{}),...(()=>{const parts=budget.primaryModel?promptParts(prompt):[prompt];return {contents:[{role:'user',parts:parts.map(text=>({text}))}],...(parts.length===3?{cacheBreakpoints:[0,1]}:{})};})(),taskType:'chat',thinkingLevel:'low',generationConfig:{temperature:0.3,maxOutputTokens:budget.maxOutputTokens??LIMITS.outputTokens,responseMimeType:'application/json',...(responseJsonSchema?{responseJsonSchema}:{})}}),signal}));
 if(!response.ok){
  if([401,403,429].includes(response.status))throw new Error(response.status===429?'gateway_rate_limit':'gateway_credential_rejected');
  const error=new Error('gateway_unavailable');
  if(acceptanceContext(env)){
   // Transport metadata alone never proves provider/broker completion.
   const raw=response.headers.get('retry-after');
   const delay=raw===null?0:/^\d+$/.test(raw)?Number(raw)*1000:Date.parse(raw)-Date.now();
   error.gatewayFailure={requestId,httpStatus:response.status,retryAfterMs:Number.isFinite(delay)&&delay>=0?delay:null};
  }
  // A pre-delta HTTP error can have a completed provider attempt. Preserve its
  // verified accounting without turning it into a successful assessment or
  // inferring broker completion from HTTP status alone.
  try{
   const failure=await response.json();
   if(failure.requestId===requestId&&failure.providerAccounting){
    const providerAccounting=validatedProviderAccounting(failure.providerAccounting,{maxProviderAttempts:budget.providerAttemptLimit||1,model:budget.model,primaryModel:budget.primaryModel||null});
    error.gatewayFailure={...error.gatewayFailure,requestId,httpStatus:response.status,providerAccounting,partialOutput:false,retryable:false};
    if(acceptanceContext(env)&&response.status===400){
     const diagnostic=http400Diagnostic(failure);
     if(diagnostic)error.gatewayFailure.diagnostic=diagnostic;
    }
   }
  }catch{}
  throw error;
 }
 const result=await consumeGatewayStream(response,onReply,{maxReplyChars:LIMITS.replyChars,maxProviderAttempts:budget.providerAttemptLimit||1,model:budget.model,primaryModel:budget.primaryModel||null,signal});
 if(!(result.model===budget.model||(budget.primaryModel&&result.model===budget.primaryModel)))throw Error('budget_model_mismatch');
 return result;
}
