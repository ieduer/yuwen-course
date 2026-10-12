import {POLICY_VERSION,LIMITS,PILOTS,validateProposal,projectState,contextFor,createQuestion,evidenceReport} from './dialogue-policy.js';
const now=()=>new Date().toISOString();
const uuid=()=>crypto.randomUUID();
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'private, no-store','x-content-type-options':'nosniff'}});
const all=async stmt=>(await stmt.all()).results||[];
const sha=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(x=>x.toString(16).padStart(2,'0')).join('');
const admitted=(env,student)=>env.YW_DIALOGUE_ENABLED==='true' && String(env.YW_DIALOGUE_PILOT_USER_IDS||'').split(',').includes(String(student.ucUserId));
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
 return {turns:rows.reverse().map(t=>({id:t.id,sequence:t.sequence,mutationId:t.role==='student'?t.mutation_id:null,role:t.role,content:t.content,status:t.status,questionId:t.question_id,createdAt:t.created_at,model:t.model,modelVersion:t.model_version})),older:more?{sequence:rows[0].sequence}:null};
}
async function assessmentRows(db,id){return (await all(db.prepare('SELECT * FROM dialogue_assessments WHERE session_id=? ORDER BY created_at,id').bind(id))).map(a=>({objectiveId:a.objective_id,outcome:a.outcome,evidence:JSON.parse(a.evidence_json),rationale:a.rationale,ruleVersion:a.rule_version,createdAt:a.created_at}));}
async function snapshot(db,session,curriculum,before){
 const [page,assessments,q,draft]=await Promise.all([history(db,session,before),assessmentRows(db,session.id),db.prepare("SELECT instance_json FROM dialogue_questions WHERE session_id=? AND state='issued'").bind(session.id).first(),db.prepare('SELECT mutation_id,revision,content,question_id,created_at FROM dialogue_drafts WHERE session_id=? AND submitted_turn_id IS NULL ORDER BY created_at DESC LIMIT 1').bind(session.id).first()]);
 // Legacy evidence is read-only. Absence and old-policy ambiguity remain unknown.
 const legacy=await all(db.prepare(`SELECT i.source_event_id,i.resource_key,i.resource_version,i.interaction_key,i.occurred_at,e.correctness,e.eligibility_status,e.verification_method FROM learning_interactions i LEFT JOIN learning_evaluations e ON e.source_event_id=i.source_event_id WHERE i.student_id=? AND i.lesson_id=? ORDER BY i.id`).bind(session.student_id,session.lesson_id));
 const preserved=curriculum.objectives.filter(o=>o.domain==='legacy').flatMap(o=>{
  const row=legacy.find(r=>r.resource_key===o.legacy.resourceKey && r.resource_version===o.legacy.resourceVersion && r.correctness==='correct' && r.eligibility_status==='eligible');
  return row?[{objectiveId:o.id,verified:true,sourceEventId:row.source_event_id}]:[];
 });
 const question=q?JSON.parse(q.instance_json):null;
 // Answer criteria are server-only and never included in the student question.
 const publicQuestion=question?{id:question.id,objectiveId:question.objectiveId,attempt:question.attempt,question:question.question,source:question.source,createdAt:question.createdAt}:null;
 const state=projectState(curriculum,assessments,preserved);
 return {ownerRef:await sha(`dialogue-owner:${session.student_id}`),sessionId:session.id,revision:session.revision,pending:!!session.inflight,curriculumVersion:session.curriculum_version,...page,state,assessments,report:evidenceReport(curriculum,state,assessments),question:publicQuestion,draft:draft?{mutationId:draft.mutation_id,revision:draft.revision,content:draft.content,questionId:draft.question_id,createdAt:draft.created_at}:null,legacy:{records:legacy.length,policy:'read-only; historical grades/completions unchanged; unknown is not zero'}};
}
export async function handleDialogue(request,env,student,ctx,{callModel=callDialogueModel}={}){
 if(!student)return json({error:'請先登入 My。',code:'authentication_required'},401);
 if(!admitted(env,student))return json({error:'試點尚未開放。',code:'pilot_unavailable'},404);
 const url=new URL(request.url),lessonId=url.searchParams.get('lessonId');
 if(!PILOTS.includes(lessonId))return json({code:'lesson_not_in_pilot'},404);
 let curriculum;try{curriculum=await loadDialogueCurriculum(env,lessonId);}catch{return json({code:'curriculum_unavailable'},503);}
 const db=env.READING_DB;
 const publishedCurriculum=curriculum;
 let session=await db.prepare('SELECT * FROM dialogue_sessions WHERE student_id=? AND lesson_id=? ORDER BY created_at DESC,id DESC LIMIT 1').bind(student.id,lessonId).first();
 // A new source version never resets an existing learner's objectives or history.
 // The exact per-session contract remains interpretable even after static assets change.
 if(session){try{curriculum=JSON.parse(session.curriculum_json);if(curriculum.lessonId!==lessonId||curriculum.curriculumVersion!==session.curriculum_version)throw Error();}catch{return json({code:'stored_curriculum_requires_review'},503);}}
 if(request.method==='GET'){
  if(!session)return json({ownerRef:await sha(`dialogue-owner:${student.id}`),revision:0,turns:[],question:null,state:projectState(curriculum,[]),saved:false});
  const before=url.searchParams.has('beforeSeq')?{sequence:Number(url.searchParams.get('beforeSeq'))}:null;
  if(before && (!Number.isSafeInteger(before.sequence)||before.sequence<1))return json({code:'invalid_cursor'},400);
  const result=await snapshot(db,session,curriculum,before);
  if(curriculum.curriculumVersion!==publishedCurriculum.curriculumVersion)result.resumeCurriculum=curriculum;
  if(url.searchParams.get('records')==='1'){
   const [questions,events,drafts]=await Promise.all([
    all(db.prepare('SELECT instance_json FROM dialogue_questions WHERE session_id=? ORDER BY created_at,id').bind(session.id)),
    all(db.prepare('SELECT id,turn_id,event_type,details_json,created_at FROM dialogue_events WHERE session_id=? ORDER BY created_at,id').bind(session.id)),
    all(db.prepare('SELECT mutation_id,revision,content,question_id,submitted_turn_id,created_at FROM dialogue_drafts WHERE session_id=? ORDER BY created_at,id').bind(session.id))]);
   result.trace={questions:questions.map(r=>{const q=JSON.parse(r.instance_json);if(q.state==='issued')delete q.criteria;return q;}),events:events.map(({details_json,...e})=>({...e,details:JSON.parse(details_json)})),drafts};
  }
  return json(result);
 }
 if(request.method!=='POST')return json({code:'method_not_allowed'},405);
 if(Number(request.headers.get('content-length'))>16000)return json({code:'input_too_large'},413);
 const bytes=await request.text();if(bytes.length>16000)return json({code:'input_too_large'},413);
 let body;try{body=JSON.parse(bytes);}catch{return json({code:'invalid_json'},400);}
 if(!body || typeof body!=='object')return json({code:'invalid_input'},400);
 if(!session){
  const at=now();await db.prepare('INSERT OR IGNORE INTO dialogue_sessions(id,student_id,lesson_id,curriculum_version,curriculum_json,policy_version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').bind(uuid(),student.id,lessonId,curriculum.curriculumVersion,JSON.stringify(curriculum),POLICY_VERSION,at,at).run();
  session=await db.prepare('SELECT * FROM dialogue_sessions WHERE student_id=? AND lesson_id=? AND curriculum_version=?').bind(student.id,lessonId,curriculum.curriculumVersion).first();
 }
 if(body.action==='question'){
  if(session.inflight)return json({code:'turn_in_progress'},409);
  const outstanding=await db.prepare("SELECT id FROM dialogue_questions WHERE session_id=? AND state='issued'").bind(session.id).first();
  if(outstanding)return json(await snapshot(db,session,curriculum));
  const previous=await db.prepare('SELECT instance_json FROM dialogue_questions WHERE session_id=? AND objective_id=? ORDER BY attempt DESC LIMIT 1').bind(session.id,body.objectiveId||'').first();
  const prior=previous?JSON.parse(previous.instance_json):null;
  if(prior?.state==='mastered')return json({code:'already_demonstrated'},409);
  if(prior){
    const reformulated=await db.prepare("SELECT id FROM dialogue_assessments WHERE session_id=? AND objective_id=? AND outcome='reformulated' AND created_at>? LIMIT 1").bind(session.id,prior.objectiveId,prior.answeredAt||prior.createdAt).first();
    if(!reformulated)return json({code:'reformulation_required',message:'請先用自己的話改述剛才的詞義與語境依據，確認後再換一題獨立作答。'},409);
  }
  let q;try{q=createQuestion(curriculum,{objectiveId:body.objectiveId,attempt:(prior?.attempt||0)+1,previousVariant:prior?.variant??null});}catch{return json({code:'teacher_review_required',message:'請保留答案與提示，交由教師覆核；其他閱讀可繼續。'},409);}
  await db.prepare('INSERT OR IGNORE INTO dialogue_questions(id,session_id,objective_id,attempt,instance_json,state,created_at) VALUES(?,?,?,?,?,?,?)').bind(q.id,session.id,q.objectiveId,q.attempt,JSON.stringify(q),q.state,q.createdAt).run();
  return json(await snapshot(db,session,curriculum));
 }
 if(body.action==='review'){
  const id=`${session.id}:review-request`;
  await db.prepare('INSERT OR IGNORE INTO dialogue_events(id,session_id,event_type,details_json,created_at) VALUES(?,?,?,?,?)').bind(id,session.id,'teacher_review_requested','{"scoringChange":false}',now()).run();
  return json({saved:true,review:'requested',delivery:'student-export-required',message:'覆核請求已保存。請匯出本課紀錄交給任課教師；尚未發送通知。'});
 }
 if(typeof body.content!=='string'||!body.content.trim()||body.content.length>LIMITS.inputChars||!/^[a-zA-Z0-9_-]{16,80}$/.test(body.mutationId||'')||!Number.isSafeInteger(body.revision))return json({code:'invalid_input'},400);
 const requestHash=await sha(JSON.stringify([body.content,body.questionId||null,body.revision]));
 const duplicate=await db.prepare("SELECT * FROM dialogue_turns WHERE session_id=? AND mutation_id=? AND role='student'").bind(session.id,body.mutationId).first();
 if(duplicate){if(duplicate.request_hash!==requestHash)return json({code:'idempotency_conflict'},409);return json(await snapshot(db,session,curriculum));}
 const qrow=await db.prepare("SELECT instance_json FROM dialogue_questions WHERE session_id=? AND state='issued'").bind(session.id).first();
 const question=qrow?JSON.parse(qrow.instance_json):null;
 if(body.questionId && question?.id!==body.questionId)return json({code:'question_mismatch'},409);
 const at=now(),day=at.slice(0,10),turnId=uuid();
 // Atomic D1 batch: CAS + reservation + student persistence precede the only AI call.
 const changes=await db.batch([
  db.prepare(`UPDATE dialogue_sessions SET revision=revision+1,inflight=?,updated_at=? WHERE id=? AND revision=? AND inflight IS NULL
   AND (SELECT COUNT(*) FROM dialogue_calls WHERE day=?)<?
   AND (SELECT COUNT(*) FROM dialogue_calls WHERE student_id=? AND day=?)<?
   AND (SELECT COUNT(*) FROM dialogue_calls WHERE session_id=?)<?
   AND (SELECT COUNT(*) FROM dialogue_calls WHERE state='reserved')<?`).bind(turnId,at,session.id,body.revision,day,LIMITS.globalPerDay,student.id,day,LIMITS.turnsPerDay,session.id,LIMITS.lessonLifetime,LIMITS.concurrency),
  db.prepare(`INSERT OR IGNORE INTO dialogue_turns(id,session_id,mutation_id,request_hash,role,content,question_id,status,policy_version,created_at) SELECT ?,id,?,?, 'student',?,?, 'saved',?,? FROM dialogue_sessions WHERE id=? AND inflight=?`).bind(turnId,body.mutationId,requestHash,body.content,body.questionId||null,POLICY_VERSION,at,session.id,turnId),
  db.prepare(`INSERT OR IGNORE INTO dialogue_calls(turn_id,session_id,student_id,day,reserved_tokens,state,created_at) SELECT ?,id,?,?,?,'reserved',? FROM dialogue_sessions WHERE id=? AND inflight=?`).bind(turnId,student.id,day,LIMITS.outputTokens,at,session.id,turnId),
  db.prepare(`INSERT OR IGNORE INTO dialogue_events(id,session_id,turn_id,event_type,details_json,created_at) SELECT ?,id,?,'turn_saved','{}',? FROM dialogue_sessions WHERE id=? AND inflight=?`).bind(uuid(),turnId,at,session.id,turnId),
  db.prepare('UPDATE dialogue_drafts SET submitted_turn_id=? WHERE session_id=? AND mutation_id=? AND request_hash=? AND EXISTS(SELECT 1 FROM dialogue_sessions WHERE id=? AND inflight=?)').bind(turnId,session.id,body.mutationId,requestHash,session.id,turnId),
 ]);
 if(!changes[0].meta.changes){
  const current=await db.prepare('SELECT * FROM dialogue_sessions WHERE id=?').bind(session.id).first();
  if(current.revision!==body.revision || current.inflight)return json({code:current.revision!==body.revision?'stale_revision':'turn_in_progress',message:'此輪尚未送出。請保留文字、讀取已保存紀錄後再繼續。'},409);
  await db.prepare('INSERT OR IGNORE INTO dialogue_drafts(id,session_id,mutation_id,request_hash,revision,content,question_id,created_at) VALUES(?,?,?,?,?,?,?,?)').bind(uuid(),session.id,body.mutationId,requestHash,body.revision,body.content,body.questionId||null,at).run();
  const saved=await db.prepare('SELECT request_hash FROM dialogue_drafts WHERE session_id=? AND mutation_id=?').bind(session.id,body.mutationId).first();
  if(saved?.request_hash!==requestHash)return json({code:'draft_conflict',message:'伺服器已有另一份待送草稿；目前文字仍保留在本頁，請先核對匯出紀錄。'},409);
  return json({code:'budget_exhausted',draftSaved:true,message:'本輪尚未呼叫 AI；草稿已由伺服器保存。配額恢復後可再送出，歷史紀錄不受影響。'},429);
 }
 const work=finishTurn({env,db,session,curriculum,question:body.questionId?question:null,turnId,body,callModel});
 if(ctx?.waitUntil){ctx.waitUntil(work);return json({saved:true,turnId,pending:true,revision:body.revision+1},202);}
 await work;
 session=await db.prepare('SELECT * FROM dialogue_sessions WHERE id=?').bind(session.id).first();return json(await snapshot(db,session,curriculum));
}
async function finishTurn({env,db,session,curriculum,question,turnId,body,callModel}){
 try{
  const page=await history(db,session),assessments=await assessmentRows(db,session.id);
  const remediationRow=await db.prepare("SELECT instance_json FROM dialogue_questions WHERE session_id=? AND state='needs_reformulation' ORDER BY created_at DESC LIMIT 1").bind(session.id).first();
  const remediation=remediationRow?JSON.parse(remediationRow.instance_json):null;
  const prompt=contextFor({curriculum,state:projectState(curriculum,assessments),turns:page.turns,question,remediation});
  const result=await callModel(env,prompt,turnId);
  const proposal=validateProposal(result.value,{curriculum,turns:page.turns,question,remediation,hints:page.turns.filter(t=>t.role==='teacher').map(t=>t.content)});
  const at=now(),teacherId=uuid();
  const statements=[db.prepare(`INSERT INTO dialogue_turns(id,session_id,mutation_id,request_hash,role,content,reply_to,status,model,model_version,policy_version,created_at) VALUES(?,?,?,?,'teacher',?,?,'saved',?,?,?,?)`).bind(teacherId,session.id,body.mutationId,'server-response',proposal.reply,turnId,result.model||null,result.modelVersion||null,POLICY_VERSION,at)];
  for(const a of proposal.assessments)statements.push(db.prepare('INSERT INTO dialogue_assessments(id,session_id,turn_id,objective_id,outcome,evidence_json,rationale,rule_version,curriculum_version,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(uuid(),session.id,turnId,a.objectiveId,a.outcome,JSON.stringify(a.evidence),a.rationale,a.ruleVersion,curriculum.curriculumVersion,at));
  if(question){const a=proposal.assessments.find(a=>a.objectiveId===question.objectiveId);const updated={...question,state:a?.outcome==='demonstrated'?'mastered':'needs_reformulation',answeredAt:at,hinted:a?.outcome!=='demonstrated'};statements.push(db.prepare('UPDATE dialogue_questions SET state=?,instance_json=? WHERE id=? AND session_id=?').bind(updated.state,JSON.stringify(updated),question.id,session.id));}
  statements.push(db.prepare("UPDATE dialogue_calls SET state='finished',finished_at=? WHERE turn_id=?").bind(at,turnId),db.prepare('UPDATE dialogue_sessions SET inflight=NULL,updated_at=? WHERE id=? AND inflight=?').bind(at,session.id,turnId),db.prepare('INSERT INTO dialogue_events(id,session_id,turn_id,event_type,details_json,created_at) VALUES(?,?,?,?,?,?)').bind(uuid(),session.id,turnId,'assessment_saved',JSON.stringify({objectiveIds:proposal.assessments.map(a=>a.objectiveId),ruleVersion:'yw-dialogue-evidence-v1'}),at));
  await db.batch(statements);
 }catch{
  // A sent/uncertain request never auto-replays. Preserve the answer and mark the gap.
  const at=now();await db.batch([db.prepare("UPDATE dialogue_calls SET state='review',finished_at=? WHERE turn_id=?").bind(at,turnId),db.prepare("UPDATE dialogue_turns SET status='needs_review' WHERE id=?").bind(turnId),db.prepare('UPDATE dialogue_sessions SET inflight=NULL,updated_at=? WHERE id=? AND inflight=?').bind(at,session.id,turnId),db.prepare('INSERT OR IGNORE INTO dialogue_events(id,session_id,turn_id,event_type,details_json,created_at) VALUES(?,?,?,?,?,?)').bind(`${turnId}:failure`,session.id,turnId,'response_unconfirmed','{"retry":"readback_only"}',at)]);
 }
}
export async function callDialogueModel(env,prompt,requestId){
 if(!env.APIS?.fetch||!env.APIS_CALLER_TOKEN)throw new Error('approved_gateway_unavailable');
 const response=await env.APIS.fetch(new Request('https://apis.internal/',{method:'POST',headers:{'content-type':'application/json','x-project-name':'yw.bdfz.net','x-task-type':'chat','x-thinking-level':'low','x-internal-token':env.APIS_CALLER_TOKEN,'x-request-id':requestId},body:JSON.stringify({contents:[{role:'user',parts:[{text:prompt}]}],taskType:'chat',thinkingLevel:'low',generationConfig:{temperature:0.3,maxOutputTokens:LIMITS.outputTokens,responseMimeType:'application/json'}}),signal:AbortSignal.timeout(LIMITS.timeoutMs)}));
 if(!response.ok)throw new Error('gateway_unavailable');
 const raw=await response.text();if(raw.length>100000)throw new Error('reply_too_large');
 const data=JSON.parse(raw);if(typeof data.answer!=='string'||data.answer.length>24000)throw new Error('invalid_gateway_reply');
 const value=JSON.parse(data.answer.replace(/^```json\s*|\s*```$/g,''));
 return {value,model:typeof data.model==='string'?data.model.slice(0,160):null,modelVersion:typeof data.raw_response?.modelVersion==='string'?data.raw_response.modelVersion.slice(0,160):null};
}
