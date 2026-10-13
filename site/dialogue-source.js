import {handleCalibration} from './dialogue-calibration.js';
import {historicalEvidence} from './dialogue-legacy.js';
import {acceptanceVersionHeaders,acceptanceContext} from './dialogue-acceptance.js';
import {recordCorrection} from './dialogue-corrections.js';
import {hasClassicalAnnotatedReadReceipt} from './classical-first-read-source.js';
import {consumeGatewayStream,studentStream} from './dialogue-stream.js';
import {dialogueBudget,reconciledCost} from './dialogue-budget.js';
import {prepareFormalInput,formalPrompt,originalTask,prepareOriginalInput} from './dialogue-formal.js';
import {POLICY_VERSION,RULE_VERSION,LIMITS,PILOTS,validateProposal,projectState,contextFor,createQuestion,vocabularyOrder,evidenceReport} from './dialogue-policy.js';
const now=()=>new Date().toISOString();
const uuid=()=>crypto.randomUUID();
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'private, no-store','x-content-type-options':'nosniff'}});
const all=async stmt=>(await stmt.all()).results||[];
const sha=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(x=>x.toString(16).padStart(2,'0')).join('');
const admitted=(env,student)=>env.YW_DIALOGUE_ENABLED==='true' && !!student.id && !!student.ucUserId;
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
 if(!PILOTS.includes(lessonId))throw new Error('lesson_not_in_pilot');
 const response=await env.ASSETS.fetch(new Request(`https://yw.bdfz.net/dialogue-curriculum/${lessonId}.json`));
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
async function transcript(db,session){
 const rows=await all(db.prepare('SELECT id,sequence,role,content,question_id AS questionId,status,created_at AS createdAt FROM dialogue_turns WHERE session_id=? ORDER BY sequence LIMIT ?').bind(session.id,LIMITS.lessonLifetime*2+1));
 if(rows.length>LIMITS.lessonLifetime*2)throw Error('transcript_requires_review');
 return rows;
}
async function assessmentRows(db,id){return (await all(db.prepare('SELECT * FROM dialogue_assessments WHERE session_id=? ORDER BY created_at,id').bind(id))).map(a=>({objectiveId:a.objective_id,outcome:a.outcome,evidence:JSON.parse(a.evidence_json),rationale:a.rationale,ruleVersion:a.rule_version,createdAt:a.created_at}));}
async function savedConclusion(db,id){const row=await db.prepare("SELECT details_json FROM dialogue_events WHERE session_id=? AND event_type='conclusion_saved' ORDER BY created_at DESC,id DESC LIMIT 1").bind(id).first();return row?JSON.parse(row.details_json):null;}
async function proposedSourceDraft(db,session,legacy){
 if(legacy.completion)return null;
 const row=await db.prepare("SELECT details_json FROM dialogue_events WHERE session_id=? AND event_type='source_answer_proposed' ORDER BY created_at DESC,id DESC LIMIT 1").bind(session.id).first();
 if(!row)return null;
 const draft=JSON.parse(row.details_json);
 if(legacy.preserved.some(p=>p.objectiveId===draft.formal.objectiveId))return null;
 const sent=await db.prepare('SELECT id FROM dialogue_turns WHERE session_id=? AND source_request_json=? LIMIT 1').bind(session.id,JSON.stringify(draft.formal)).first();
 return sent?null:draft;
}
async function snapshot(db,session,curriculum,before){
 const [page,assessments,q,draft]=await Promise.all([history(db,session,before),assessmentRows(db,session.id),db.prepare("SELECT instance_json FROM dialogue_questions WHERE session_id=? AND state='issued'").bind(session.id).first(),db.prepare('SELECT mutation_id,revision,content,question_id,created_at,source_request_json FROM dialogue_drafts WHERE session_id=? AND submitted_turn_id IS NULL ORDER BY created_at DESC LIMIT 1').bind(session.id).first()]);
 const legacy=await historicalEvidence(db,session.student_id,curriculum),preserved=legacy.preserved;
 const question=q?JSON.parse(q.instance_json):null;
 // Answer criteria are server-only and never included in the student question.
 const publicQuestion=question?{id:question.id,objectiveId:question.objectiveId,attempt:question.attempt,question:question.question,source:question.source,createdAt:question.createdAt}:null;
 const conclusion=await savedConclusion(db,session.id);
 const state=projectState(curriculum,assessments,preserved,legacy.completion,await readingGate(db,session.student_id,curriculum,legacy),conclusion),completeTurns=await transcript(db,session);
 const partialRows=await all(db.prepare(`SELECT c.content,c.sequence,c.created_at,t.id AS turn_id,t.status FROM dialogue_stream_chunks c JOIN dialogue_turns t ON t.id=c.turn_id WHERE t.session_id=? AND c.turn_id=(SELECT id FROM dialogue_turns WHERE session_id=? AND role='student' ORDER BY sequence DESC LIMIT 1) AND NOT EXISTS(SELECT 1 FROM dialogue_turns r WHERE r.reply_to=t.id AND r.role='teacher') ORDER BY c.sequence LIMIT 128`).bind(session.id,session.id));
 const partial=partialRows.length?{turnId:partialRows[0].turn_id,content:partialRows.map(c=>c.content).join(''),status:partialRows[0].status==='needs_review'?'unconfirmed':'streaming'}:null;
 return {originalTask:originalTask(curriculum,state,legacy.mastery),sourceDraft:await proposedSourceDraft(db,session,legacy),partial,ownerRef:await sha(`dialogue-owner:${session.student_id}`),sessionId:session.id,revision:session.revision,pending:!!session.inflight,curriculumVersion:session.curriculum_version,...page,state,assessments,report:evidenceReport(curriculum,state,assessments,completeTurns,conclusion),question:publicQuestion,draft:draft?{mutationId:draft.mutation_id,revision:draft.revision,content:draft.content,questionId:draft.question_id,createdAt:draft.created_at,formal:draft.source_request_json?JSON.parse(draft.source_request_json):null}:null,legacy,readingGate:state.readingGate};
}
export async function handleDialogue(request,env,student,ctx,{callModel=callDialogueModel,readSharedHistory=null,firstReadAction=null,formalAction=null,originalAction=null}={}){
 if(!student)return json({error:'請先登入 My。',code:'authentication_required'},401);
 if(!admitted(env,student))return json({error:'試點尚未開放。',code:'pilot_unavailable'},404);
 const url=new URL(request.url),lessonId=url.searchParams.get('lessonId');
 if(url.searchParams.has('calibration'))return handleCalibration(request,env,student,callModel);
 if(!PILOTS.includes(lessonId))return json({code:'lesson_not_in_pilot'},404);
 let curriculum;try{curriculum=await loadDialogueCurriculum(env,lessonId);}catch{return json({code:'curriculum_unavailable'},503);}
 const db=env.READING_DB;
 await reconcileAbandonedCalls(db);
 const publishedCurriculum=curriculum;
 let session=await db.prepare('SELECT * FROM dialogue_sessions WHERE student_id=? AND lesson_id=? ORDER BY created_at DESC,id DESC LIMIT 1').bind(student.id,lessonId).first();
 // A new source version never resets an existing learner's objectives or history.
 // The exact per-session contract remains interpretable even after static assets change.
 if(session){try{curriculum=JSON.parse(session.curriculum_json);if(curriculum.lessonId!==lessonId||curriculum.curriculumVersion!==session.curriculum_version)throw Error();}catch{return json({code:'stored_curriculum_requires_review'},503);}}
 if(request.method==='GET'){
  if(url.searchParams.get('sharedHistory')==='1'){
   const shared=readSharedHistory?await readSharedHistory():{status:'unavailable',reason:'shared_history_unavailable'};
   return json({ownerRef:await sha(`dialogue-owner:${student.id}`),sharedHistory:shared});
  }
  if(url.searchParams.has('correctionsFor')){
   const turnId=url.searchParams.get('correctionsFor');
   const turn=session&&await db.prepare('SELECT id FROM dialogue_turns WHERE id=? AND session_id=?').bind(turnId,session.id).first();
   if(!turn)return json({code:'turn_not_found'},404);
   const rows=await all(db.prepare("SELECT id,details_json,created_at FROM dialogue_events WHERE session_id=? AND turn_id=? AND event_type='owner_correction_recorded' ORDER BY created_at,id LIMIT 8").bind(session.id,turnId));
   return json({ownerRef:await sha(`dialogue-owner:${student.id}`),corrections:rows.map(r=>({id:r.id,createdAt:r.created_at,...JSON.parse(r.details_json)}))});
  }
  if(!session){const legacy=await historicalEvidence(db,student.id,curriculum),state=projectState(curriculum,[],legacy.preserved,legacy.completion,await readingGate(db,student.id,curriculum,legacy));return json({ownerRef:await sha(`dialogue-owner:${student.id}`),revision:0,turns:[],question:null,state,legacy,readingGate:state.readingGate,report:evidenceReport(curriculum,state,[]),saved:false});}
  const before=url.searchParams.has('beforeSeq')?{sequence:Number(url.searchParams.get('beforeSeq'))}:null;
  if(before && (!Number.isSafeInteger(before.sequence)||before.sequence<1))return json({code:'invalid_cursor'},400);
  const result=await snapshot(db,session,curriculum,before);
  if(curriculum.curriculumVersion!==publishedCurriculum.curriculumVersion)result.resumeCurriculum=curriculum;
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
 if(body.action==='first_read'){
  if(curriculum.mode!=='classical'||!['state','mark','delete','submit','resolve','acknowledge'].includes(body.operation)||!body.payload||typeof body.payload!=='object'||Array.isArray(body.payload))return json({code:'invalid_first_read_action'},400);
  if(!firstReadAction)return json({code:'first_read_unavailable',message:'初讀來源暫時不可用；原有紀錄保留。'},503);
  const response=await firstReadAction(body.operation,{...body.payload,lessonId});
  const value=await response.json();return json({...value,ownerRef:await sha(`dialogue-owner:${student.id}`)},response.status);
 }
 if(!session){
  const at=now();await db.prepare('INSERT OR IGNORE INTO dialogue_sessions(id,student_id,lesson_id,curriculum_version,curriculum_json,policy_version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').bind(uuid(),student.id,lessonId,curriculum.curriculumVersion,JSON.stringify(curriculum),POLICY_VERSION,at,at).run();
  session=await db.prepare('SELECT * FROM dialogue_sessions WHERE student_id=? AND lesson_id=? AND curriculum_version=?').bind(student.id,lessonId,curriculum.curriculumVersion).first();
 }
 if(body.action==='correction'){
  const result=await recordCorrection(db,session,body,now());return json(result.value,result.status);
 }
 if(body.action==='original'){
  if(!originalAction)return json({code:'original_source_unavailable'},503);
  if(!/^[a-zA-Z0-9_-]{16,80}$/.test(body.mutationId||'')||!Number.isSafeInteger(body.revision))return json({code:'invalid_input'},400);
  const requestHash=await sha(JSON.stringify(['original',body.objectiveId,body.input,body.revision]));
  const duplicate=await db.prepare("SELECT request_hash FROM dialogue_turns WHERE session_id=? AND mutation_id=? AND role='student'").bind(session.id,body.mutationId).first();
  if(duplicate)return duplicate.request_hash===requestHash?json(await snapshot(db,session,curriculum)):json({code:'idempotency_conflict'},409);
  if(session.inflight||session.revision!==body.revision)return json({code:'stale_revision'},409);
  const count=await db.prepare("SELECT COUNT(*) n FROM dialogue_turns WHERE session_id=? AND role='student'").bind(session.id).first();
  if(count.n>=LIMITS.lessonLifetime)return json({code:'lesson_review_required',message:'本課已達會話上限；已保存紀錄保留，請匯出交由教師覆核。這次選擇尚未保存。'},409);
  const data=await snapshot(db,session,curriculum),task=data.originalTask;
  if(data.question||!task||task.objectiveId!==body.objectiveId)return json({code:'original_task_not_ready',message:'請先完成目前的語境說明；已完成的原有結果不重做。'},409);
  let formal;try{formal=prepareOriginalInput(curriculum,task,body.input);}catch{return json({code:'invalid_original_input'},400);}
  const turnId=uuid(),teacherId=uuid(),at=now();
  try{
   const response=await originalAction({...formal,lessonId},turnId,result=>{
    const reply=formal.interaction==='evaluation'?'你的篇目自評已保存；高低都不計入成績。':result.evaluation.correctness==='correct'?'這個選項符合原題準據，原有作答紀錄已保存。請保留剛才對語境的解釋，繼續細讀。':'這次選擇與原題準據不同，第一次及後續作答會分開保留。回到原句核對語境，再在對話說說你改變的判斷。';
    return [
     db.prepare(`INSERT INTO dialogue_events(id,session_id,turn_id,event_type,details_json,created_at) VALUES(?,(SELECT id FROM dialogue_sessions WHERE id=? AND student_id=? AND revision=? AND inflight IS NULL AND (SELECT COUNT(*) FROM dialogue_turns WHERE session_id=? AND role='student')<?),?,'original_source_saved',?,?)`).bind(`${turnId}:source`,session.id,student.id,body.revision,session.id,LIMITS.lessonLifetime,turnId,JSON.stringify({objectiveId:formal.objectiveId,...result}),at),
     db.prepare(`INSERT INTO dialogue_turns(id,session_id,mutation_id,request_hash,role,content,status,policy_version,created_at,source_request_json) VALUES(?,?,?,?,'student',?,'saved',?,?,?)`).bind(turnId,session.id,body.mutationId,requestHash,formal.content,POLICY_VERSION,at,JSON.stringify(formal)),
     db.prepare(`INSERT INTO dialogue_turns(id,session_id,mutation_id,request_hash,role,content,reply_to,status,model,policy_version,created_at) VALUES(?,?,?,'original-answer-key','teacher',?,?,'saved','source-owned',?,?)`).bind(teacherId,session.id,body.mutationId,reply,turnId,POLICY_VERSION,at),
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
  const order=await vocabularyOrder(curriculum,session.id);
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
  q.selection={...q.selection,orderAlgorithm:'sha256-session-v1',coverageOrder:order,coverageIndex:order.indexOf(objectiveId)};
  await db.prepare('INSERT OR IGNORE INTO dialogue_questions(id,session_id,objective_id,attempt,instance_json,state,created_at) VALUES(?,?,?,?,?,?,?)').bind(q.id,session.id,q.objectiveId,q.attempt,JSON.stringify(q),q.state,q.createdAt).run();
  return json(await snapshot(db,session,curriculum));
 }
 if(body.action==='review'){
  const id=`${session.id}:review-request`;
  await db.prepare('INSERT OR IGNORE INTO dialogue_events(id,session_id,event_type,details_json,created_at) VALUES(?,?,?,?,?)').bind(id,session.id,'teacher_review_requested','{"scoringChange":false}',now()).run();
  return json({saved:true,review:'requested',delivery:'student-export-required',message:'覆核請求已保存。請匯出本課紀錄交給任課教師；尚未發送通知。'});
 }
 if(typeof body.content!=='string'||!body.content.trim()||body.content.length>LIMITS.inputChars||!/^[a-zA-Z0-9_-]{16,80}$/.test(body.mutationId||'')||!Number.isSafeInteger(body.revision))return json({code:'invalid_input'},400);
 let formal=null;
 if(body.formal){
  try{formal=prepareFormalInput(curriculum,body.formal);}catch{return json({code:'invalid_source_submission',message:'原題作答欄位不完整；文字仍保留，請先核對。'},400);}
  if(!formalAction)return json({code:'source_assessment_unavailable'},503);
  if(body.content!==formal.content||body.questionId)return json({code:'source_content_mismatch'},400);
 }
 const requestHash=await sha(JSON.stringify(formal?[body.content,null,body.revision,formal]:[body.content,body.questionId||null,body.revision]));
 const duplicate=await db.prepare("SELECT * FROM dialogue_turns WHERE session_id=? AND mutation_id=? AND role='student'").bind(session.id,body.mutationId).first();
 if(duplicate){if(duplicate.request_hash!==requestHash)return json({code:'idempotency_conflict'},409);return json(await snapshot(db,session,curriculum));}
 const capturedDraft=await db.prepare('SELECT request_hash FROM dialogue_drafts WHERE session_id=? AND mutation_id=?').bind(session.id,body.mutationId).first();
 if(capturedDraft && capturedDraft.request_hash!==requestHash)return json({code:'draft_conflict',message:'這份草稿已有保存的原题欄位；請讀回核對，不能改成另一種提交。'},409);
 if(formal){
  const sameAnswer=await db.prepare(`SELECT c.state FROM dialogue_turns t JOIN dialogue_calls c ON c.turn_id=t.id WHERE t.session_id=? AND t.source_request_json=? LIMIT 1`).bind(session.id,JSON.stringify(formal)).first();
  if(sameAnswer)return json({code:sameAnswer.state==='finished'?'source_answer_already_recorded':'source_result_unconfirmed',message:'這份原題答案已保存；請讀回原結果。尚未確認的評價不會重送，修改後的新答案另存。'},409);
 }
 const qrow=await db.prepare("SELECT instance_json FROM dialogue_questions WHERE session_id=? AND state='issued'").bind(session.id).first();
 const question=qrow?JSON.parse(qrow.instance_json):null;
 if(body.questionId && question?.id!==body.questionId)return json({code:'question_mismatch'},409);
 const original=await historicalEvidence(db,student.id,curriculum),gate=await readingGate(db,student.id,curriculum,original);
 if(formal && (original.completion||original.preserved.some(p=>p.objectiveId===formal.objectiveId)))return json({code:'original_result_preserved',message:'原有結果已保留，不需重評或重做。'},409);
 if(formal && question)return json({code:'question_in_progress',message:'先保留並處理目前的字詞作答，再核對原題。'},409);
 if(gate?.phase==='initial_reading')return json({code:'first_read_required',message:'請先在無注疏正文保存疑點、猜測與初讀感知，再展開細讀對話。'},409);
 let budget;
 try{budget=dialogueBudget(env);}catch{
  await db.prepare('INSERT OR IGNORE INTO dialogue_drafts(id,session_id,mutation_id,request_hash,revision,content,question_id,created_at,source_request_json) VALUES(?,?,?,?,?,?,?,?,?)').bind(uuid(),session.id,body.mutationId,requestHash,body.revision,body.content,body.questionId||null,now(),formal?JSON.stringify(formal):null).run();
  const saved=await db.prepare('SELECT request_hash FROM dialogue_drafts WHERE session_id=? AND mutation_id=?').bind(session.id,body.mutationId).first();
  if(saved?.request_hash!==requestHash)return json({code:'draft_conflict',message:'伺服器已有另一份待送草稿；目前文字仍保留在本頁，請先核對匯出紀錄。'},409);
  return json({code:'budget_policy_required',draftSaved:true,message:'支出政策尚未配置；草稿已保存，本輪未呼叫 AI。'},503);
 }
 const at=now(),day=at.slice(0,10),turnId=uuid();
 // Atomic D1 batch: CAS + reservation + student persistence precede the only AI call.
 const changes=await db.batch([
  db.prepare(`UPDATE dialogue_sessions SET revision=revision+1,inflight=?,updated_at=? WHERE id=? AND revision=? AND inflight IS NULL
   AND (SELECT COUNT(*) FROM dialogue_calls WHERE day=?)<?
   AND (SELECT COUNT(*) FROM dialogue_calls WHERE student_id=? AND day=?)<?
   AND (SELECT COUNT(*) FROM dialogue_turns WHERE session_id=? AND role='student')<?
   AND (SELECT COUNT(*) FROM dialogue_calls WHERE state IN ('reserved','finishing'))<?
   AND NOT EXISTS(SELECT 1 FROM dialogue_calls WHERE budget_policy_json IS NULL)
   AND (SELECT COALESCE(SUM(COALESCE(accounted_micros,reserved_micros)),0) FROM dialogue_calls WHERE day=?)+?<=?
   AND (SELECT COALESCE(SUM(COALESCE(accounted_micros,reserved_micros)),0) FROM dialogue_calls WHERE student_id=? AND day=?)+?<=?
   AND (SELECT COALESCE(SUM(COALESCE(c.accounted_micros,c.reserved_micros)),0) FROM dialogue_calls c JOIN dialogue_sessions s ON s.id=c.session_id WHERE c.student_id=? AND s.lesson_id=?)+?<=?`).bind(turnId,at,session.id,body.revision,day,LIMITS.globalPerDay,student.id,day,LIMITS.turnsPerDay,session.id,LIMITS.lessonLifetime,LIMITS.concurrency,day,budget.reserveMicros,budget.globalDailyMicros,student.id,day,budget.reserveMicros,budget.userDailyMicros,student.id,lessonId,budget.reserveMicros,budget.lessonLifetimeMicros),
  db.prepare(`INSERT OR IGNORE INTO dialogue_turns(id,session_id,mutation_id,request_hash,role,content,question_id,status,policy_version,created_at,source_request_json) SELECT ?,id,?,?, 'student',?,?, 'saved',?,?,? FROM dialogue_sessions WHERE id=? AND inflight=?`).bind(turnId,body.mutationId,requestHash,body.content,body.questionId||null,POLICY_VERSION,at,formal?JSON.stringify(formal):null,session.id,turnId),
  db.prepare(`INSERT OR IGNORE INTO dialogue_calls(turn_id,session_id,student_id,day,reserved_tokens,state,created_at,reserved_micros,budget_policy_json) SELECT ?,id,?,?,?,'reserved',?,?,? FROM dialogue_sessions WHERE id=? AND inflight=?`).bind(turnId,student.id,day,LIMITS.outputTokens,at,budget.reserveMicros,JSON.stringify(budget),session.id,turnId),
  db.prepare(`INSERT OR IGNORE INTO dialogue_events(id,session_id,turn_id,event_type,details_json,created_at) SELECT ?,id,?,'turn_saved','{}',? FROM dialogue_sessions WHERE id=? AND inflight=?`).bind(uuid(),turnId,at,session.id,turnId),
  db.prepare('UPDATE dialogue_drafts SET submitted_turn_id=? WHERE session_id=? AND mutation_id=? AND request_hash=? AND EXISTS(SELECT 1 FROM dialogue_sessions WHERE id=? AND inflight=?)').bind(turnId,session.id,body.mutationId,requestHash,session.id,turnId),
 ]);
 if(!changes[0].meta.changes){
  const current=await db.prepare('SELECT * FROM dialogue_sessions WHERE id=?').bind(session.id).first();
  if(current.revision!==body.revision || current.inflight)return json({code:current.revision!==body.revision?'stale_revision':'turn_in_progress',message:'此輪尚未送出。請保留文字、讀取已保存紀錄後再繼續。'},409);
  await db.prepare('INSERT OR IGNORE INTO dialogue_drafts(id,session_id,mutation_id,request_hash,revision,content,question_id,created_at,source_request_json) VALUES(?,?,?,?,?,?,?,?,?)').bind(uuid(),session.id,body.mutationId,requestHash,body.revision,body.content,body.questionId||null,at,formal?JSON.stringify(formal):null).run();
  const saved=await db.prepare('SELECT request_hash FROM dialogue_drafts WHERE session_id=? AND mutation_id=?').bind(session.id,body.mutationId).first();
  if(saved?.request_hash!==requestHash)return json({code:'draft_conflict',message:'伺服器已有另一份待送草稿；目前文字仍保留在本頁，請先核對匯出紀錄。'},409);
  return json({code:'budget_exhausted',draftSaved:true,message:'本輪尚未呼叫 AI；草稿已由伺服器保存。配額恢復後可再送出，歷史紀錄不受影響。'},429);
 }
 const stream=request.headers.get('accept')?.includes('text/event-stream')?studentStream():null;
 stream?.send('saved',{saved:true,turnId,mutationId:body.mutationId,revision:body.revision+1,createdAt:at});
 const work=finishTurn({env,db,session,curriculum,question:body.questionId?question:null,turnId,body,callModel,stream,budget,formal,formalAction});
 if(stream){if(ctx?.waitUntil)ctx.waitUntil(work);return stream.response;}
 if(ctx?.waitUntil){ctx.waitUntil(work);return json({saved:true,turnId,pending:true,revision:body.revision+1},202);}
 await work;
 session=await db.prepare('SELECT * FROM dialogue_sessions WHERE id=?').bind(session.id).first();return json(await snapshot(db,session,curriculum));
}
export async function reconcileAbandonedCalls(db,at=now()){
 const cutoff=new Date(Date.parse(at)-60000).toISOString();
 const stale="SELECT turn_id FROM dialogue_calls WHERE state IN ('reserved','finishing') AND COALESCE(finished_at,created_at)<?";
 await db.batch([
  db.prepare(`INSERT OR IGNORE INTO dialogue_events(id,session_id,turn_id,event_type,details_json,created_at) SELECT turn_id||':crash',session_id,turn_id,'response_unconfirmed','{"retry":"readback_only","reason":"worker_interrupted"}',? FROM dialogue_calls WHERE turn_id IN (${stale})`).bind(at,cutoff),
  db.prepare(`UPDATE dialogue_turns SET status='needs_review' WHERE id IN (${stale})`).bind(cutoff),
  db.prepare(`UPDATE dialogue_sessions SET inflight=NULL,updated_at=? WHERE inflight IN (${stale})`).bind(at,cutoff),
  db.prepare(`UPDATE dialogue_calls SET state='review',finished_at=? WHERE turn_id IN (${stale})`).bind(at,cutoff),
 ]);
}
async function finishTurn({env,db,session,curriculum,question,turnId,body,callModel,stream,budget,formal,formalAction}){
 try{
  const completeTurns=await transcript(db,session),assessments=await assessmentRows(db,session.id);
  const legacy=await historicalEvidence(db,session.student_id,curriculum);
  const remediationRows=await all(db.prepare("SELECT q.instance_json FROM dialogue_questions q WHERE q.session_id=? AND q.state='needs_reformulation' AND NOT EXISTS(SELECT 1 FROM dialogue_questions newer WHERE newer.session_id=q.session_id AND newer.objective_id=q.objective_id AND newer.attempt>q.attempt) ORDER BY q.created_at DESC").bind(session.id));
  const remediation=remediationRows.map(r=>JSON.parse(r.instance_json)).find(q=>!legacy.preserved.some(p=>p.objectiveId===q.objectiveId))||null;
  const state=projectState(curriculum,assessments,legacy.preserved,legacy.completion,await readingGate(db,session.student_id,curriculum,legacy),await savedConclusion(db,session.id));
  const prompt=formal?null:contextFor({curriculum,state,turns:completeTurns,question,remediation,assessments});
  let persisted='',sequence=0,lastPersist=0;
  const persistReply=async text=>{
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
   let result=null,teacherId=null,attempted=false;
   const response=await formalAction({...formal,lessonId:curriculum.lessonId},turnId,async sourcePrompt=>{
    if(attempted)throw Error('duplicate_source_evaluation');attempted=true;
    result=await callModel(env,formalPrompt(sourcePrompt),turnId,persistReply,budget);
    if(typeof result.value?.reply!=='string'||!result.value.reply.trim()||result.value.reply.length>LIMITS.replyChars||!result.value.reply.startsWith(persisted))throw Error('invalid_source_reply');
    return JSON.stringify(result.value);
   },async(reservation,assessment)=>{
    if(!result)throw Error('source_reply_missing');
    const at=now();teacherId=uuid();
    // The NOT NULL owner lookup is the transaction guard: if the attempt was
    // reconciled/expired, this batch and every original grade/outbox write fail.
    return [
     db.prepare(`INSERT INTO dialogue_events(id,session_id,turn_id,event_type,details_json,created_at)
      VALUES(?,(SELECT s.id FROM dialogue_sessions s JOIN dialogue_calls c ON c.session_id=s.id WHERE c.turn_id=? AND c.state='reserved' AND s.inflight=c.turn_id AND s.student_id=?),?,'source_assessment_saved',?,?)`).bind(`${turnId}:source`,turnId,session.student_id,turnId,JSON.stringify({objectiveId:formal.objectiveId,sourceEventId:reservation.sourceEventId,resourceKey:formal.resourceKey,resourceVersion:formal.resourceVersion,assessment,modelReply:result.value}),at),
     db.prepare(`INSERT INTO dialogue_turns(id,session_id,mutation_id,request_hash,role,content,reply_to,status,model,model_version,policy_version,created_at) VALUES(?,?,?,?,'teacher',?,?,'saved',?,?,?,?)`).bind(teacherId,session.id,body.mutationId,'original-source-response',result.value.reply,turnId,result.model||null,result.modelVersion||null,POLICY_VERSION,at),
     db.prepare("UPDATE dialogue_calls SET state='finished',finished_at=?,usage_json=?,first_token_ms=?,completed_ms=?,accounted_micros=? WHERE turn_id=? AND state='reserved'").bind(at,JSON.stringify(result.usage||null),Number.isSafeInteger(result.firstTokenMs)?result.firstTokenMs:null,Number.isSafeInteger(result.totalDurationMs)?result.totalDurationMs:null,reconciledCost(budget,result.usage),turnId),
     db.prepare('UPDATE dialogue_sessions SET inflight=NULL,updated_at=? WHERE id=? AND inflight=?').bind(at,session.id,turnId),
    ];
   });
   if(!response.ok||!teacherId)throw Error('source_result_unconfirmed');
   stream?.send('done',{saved:true,turnId,teacherTurnId:teacherId});return;
  }
  const result=await callModel(env,prompt,turnId,persistReply,budget);
  const proposal=validateProposal(result.value,{curriculum,state,turns:completeTurns,question,remediation,assessments,hints:completeTurns.filter(t=>t.role==='teacher').map(t=>t.content)});
  if(proposal.sourceDraft&&(legacy.completion||legacy.preserved.some(p=>p.objectiveId===proposal.sourceDraft.formal.objectiveId)))throw Error('original_result_preserved');
  const at=now(),teacherId=uuid();
  const claimed=await db.prepare("UPDATE dialogue_calls SET state='finishing',finished_at=? WHERE turn_id=? AND state='reserved'").bind(at,turnId).run();
  if(!claimed.meta.changes)throw Error('call_already_reconciled');
  const active="EXISTS(SELECT 1 FROM dialogue_calls WHERE turn_id=? AND state='finishing')";
  const statements=[db.prepare(`INSERT INTO dialogue_turns(id,session_id,mutation_id,request_hash,role,content,reply_to,status,model,model_version,policy_version,created_at) SELECT ?,?,?,?,'teacher',?,?,'saved',?,?,?,? WHERE ${active}`).bind(teacherId,session.id,body.mutationId,'server-response',proposal.reply,turnId,result.model||null,result.modelVersion||null,POLICY_VERSION,at,turnId)];
  if(proposal.sourceDraft)statements.push(db.prepare(`INSERT INTO dialogue_events(id,session_id,turn_id,event_type,details_json,created_at) SELECT ?,?,?,'source_answer_proposed',?,? WHERE ${active}`).bind(`${turnId}:source-proposal`,session.id,turnId,JSON.stringify(proposal.sourceDraft),at,turnId));
  if(proposal.conclusion)statements.push(db.prepare(`INSERT INTO dialogue_events(id,session_id,turn_id,event_type,details_json,created_at) SELECT ?,?,?,'conclusion_saved',?,? WHERE ${active}`).bind(`${turnId}:conclusion`,session.id,turnId,JSON.stringify({...proposal.conclusion,curriculumVersion:curriculum.curriculumVersion,policyVersion:POLICY_VERSION,createdAt:at,teacherTurnId:teacherId}),at,turnId));
  for(const a of proposal.assessments)statements.push(db.prepare(`INSERT INTO dialogue_assessments(id,session_id,turn_id,objective_id,outcome,evidence_json,rationale,rule_version,curriculum_version,created_at) SELECT ?,?,?,?,?,?,?,?,?,? WHERE ${active}`).bind(uuid(),session.id,turnId,a.objectiveId,a.outcome,JSON.stringify(a.evidence),a.rationale,a.ruleVersion,curriculum.curriculumVersion,at,turnId));
  if(question){const a=proposal.assessments.find(a=>a.objectiveId===question.objectiveId);const updated={...question,state:a?.outcome==='demonstrated'?'mastered':a?.outcome==='review'?'review':'needs_reformulation',answeredAt:at,hinted:a?.outcome!=='demonstrated'};statements.push(db.prepare(`UPDATE dialogue_questions SET state=?,instance_json=? WHERE id=? AND session_id=? AND ${active}`).bind(updated.state,JSON.stringify(updated),question.id,session.id,turnId));}
  statements.push(db.prepare(`INSERT INTO dialogue_events(id,session_id,turn_id,event_type,details_json,created_at) SELECT ?,?,?,?,?,? WHERE ${active}`).bind(uuid(),session.id,turnId,'assessment_saved',JSON.stringify({objectiveIds:proposal.assessments.map(a=>a.objectiveId),ruleVersion:RULE_VERSION}),at,turnId),
   db.prepare("UPDATE dialogue_calls SET state='finished',finished_at=?,usage_json=?,first_token_ms=?,completed_ms=?,accounted_micros=? WHERE turn_id=? AND state='finishing'").bind(at,JSON.stringify(result.usage||null),Number.isSafeInteger(result.firstTokenMs)?result.firstTokenMs:null,Number.isSafeInteger(result.totalDurationMs)?result.totalDurationMs:null,reconciledCost(budget,result.usage),turnId),
   db.prepare('UPDATE dialogue_sessions SET inflight=NULL,updated_at=? WHERE id=? AND inflight=?').bind(at,session.id,turnId));
  const saved=await db.batch(statements);if(!saved[0].meta.changes)throw Error('call_already_reconciled');
  stream?.send('done',{saved:true,turnId,teacherTurnId:teacherId});
 }catch{
  // The source transaction may have committed before an outbox decoration or
  // response failed. Read that exact receipt; never downgrade or resubmit it.
  const completed=await db.prepare("SELECT t.id FROM dialogue_turns t JOIN dialogue_calls c ON c.turn_id=t.reply_to WHERE t.reply_to=? AND t.role='teacher' AND c.state='finished'").bind(turnId).first();
  if(completed){stream?.send('done',{saved:true,turnId,teacherTurnId:completed.id});return;}
  const at=now();await db.batch([db.prepare("UPDATE dialogue_calls SET state='review',finished_at=? WHERE turn_id=? AND state IN ('reserved','finishing')").bind(at,turnId),db.prepare("UPDATE dialogue_turns SET status='needs_review' WHERE id=? AND NOT EXISTS(SELECT 1 FROM dialogue_calls WHERE turn_id=? AND state='finished')").bind(turnId,turnId),db.prepare('UPDATE dialogue_sessions SET inflight=NULL,updated_at=? WHERE id=? AND inflight=?').bind(at,session.id,turnId),db.prepare('INSERT OR IGNORE INTO dialogue_events(id,session_id,turn_id,event_type,details_json,created_at) VALUES(?,?,?,?,?,?)').bind(`${turnId}:failure`,session.id,turnId,'response_unconfirmed','{"retry":"readback_only"}',at)]);
  stream?.send('unconfirmed',{turnId,saved:true,retry:'readback_only'});
 }finally{stream?.close();}
}
export async function callDialogueModel(env,prompt,requestId,onReply,budget=dialogueBudget(env)){
 if(!env.APIS?.fetch||(!env.APIS_CALLER_TOKEN&&!acceptanceContext(env)))throw new Error('approved_gateway_unavailable');
 const signal=AbortSignal.timeout(LIMITS.timeoutMs);
 const response=await env.APIS.fetch(new Request('https://apis.internal/api/yw/dialogue-stream',{method:'POST',headers:{'content-type':'application/json',accept:'text/event-stream','x-project-name':'yw.bdfz.net','x-task-type':'chat','x-thinking-level':'low',...(env.APIS_CALLER_TOKEN?{'x-internal-token':env.APIS_CALLER_TOKEN}:{}),'x-request-id':requestId,...acceptanceVersionHeaders(env)},body:JSON.stringify({stream:true,model:budget.model,contents:[{role:'user',parts:[{text:prompt}]}],taskType:'chat',thinkingLevel:'low',generationConfig:{temperature:0.3,maxOutputTokens:LIMITS.outputTokens,responseMimeType:'application/json'}}),signal}));
 if(!response.ok){
  if(acceptanceContext(env)&&[401,403,429].includes(response.status))throw new Error(response.status===429?'gateway_rate_limit':'gateway_credential_rejected');
  const error=new Error('gateway_unavailable');
  if(acceptanceContext(env)){
   // Transport metadata alone never proves provider/broker completion.
   const raw=response.headers.get('retry-after');
   const delay=raw===null?0:/^\d+$/.test(raw)?Number(raw)*1000:Date.parse(raw)-Date.now();
   error.gatewayFailure={requestId,httpStatus:response.status,retryAfterMs:Number.isFinite(delay)&&delay>=0?delay:null};
  }
  throw error;
 }
 const result=await consumeGatewayStream(response,onReply,{maxReplyChars:LIMITS.replyChars,signal});
 if(result.model!==budget.model)throw Error('budget_model_mismatch');
 return result;
}
