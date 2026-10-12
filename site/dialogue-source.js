import {historicalEvidence} from './dialogue-legacy.js';
import {consumeGatewayStream,studentStream} from './dialogue-stream.js';
import {dialogueBudget,reconciledCost} from './dialogue-budget.js';
import {POLICY_VERSION,LIMITS,PILOTS,validateProposal,projectState,contextFor,createQuestion,evidenceReport} from './dialogue-policy.js';
const now=()=>new Date().toISOString();
const uuid=()=>crypto.randomUUID();
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'private, no-store','x-content-type-options':'nosniff'}});
const all=async stmt=>(await stmt.all()).results||[];
const sha=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(x=>x.toString(16).padStart(2,'0')).join('');
const admitted=(env,student)=>env.YW_DIALOGUE_ENABLED==='true' && !!student.id && !!student.ucUserId;
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
 const legacy=await historicalEvidence(db,session.student_id,curriculum),preserved=legacy.preserved;
 const question=q?JSON.parse(q.instance_json):null;
 // Answer criteria are server-only and never included in the student question.
 const publicQuestion=question?{id:question.id,objectiveId:question.objectiveId,attempt:question.attempt,question:question.question,source:question.source,createdAt:question.createdAt}:null;
 const state=projectState(curriculum,assessments,preserved);
 const partialRows=await all(db.prepare(`SELECT c.content,c.sequence,c.created_at,t.id AS turn_id,t.status FROM dialogue_stream_chunks c JOIN dialogue_turns t ON t.id=c.turn_id WHERE t.session_id=? AND c.turn_id=(SELECT id FROM dialogue_turns WHERE session_id=? AND role='student' ORDER BY sequence DESC LIMIT 1) AND NOT EXISTS(SELECT 1 FROM dialogue_turns r WHERE r.reply_to=t.id AND r.role='teacher') ORDER BY c.sequence LIMIT 128`).bind(session.id,session.id));
 const partial=partialRows.length?{turnId:partialRows[0].turn_id,content:partialRows.map(c=>c.content).join(''),status:partialRows[0].status==='needs_review'?'unconfirmed':'streaming'}:null;
 return {partial,ownerRef:await sha(`dialogue-owner:${session.student_id}`),sessionId:session.id,revision:session.revision,pending:!!session.inflight,curriculumVersion:session.curriculum_version,...page,state,assessments,report:evidenceReport(curriculum,state,assessments),question:publicQuestion,draft:draft?{mutationId:draft.mutation_id,revision:draft.revision,content:draft.content,questionId:draft.question_id,createdAt:draft.created_at}:null,legacy};
}
export async function handleDialogue(request,env,student,ctx,{callModel=callDialogueModel}={}){
 if(!student)return json({error:'請先登入 My。',code:'authentication_required'},401);
 if(!admitted(env,student))return json({error:'試點尚未開放。',code:'pilot_unavailable'},404);
 const url=new URL(request.url),lessonId=url.searchParams.get('lessonId');
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
  if(!session){const legacy=await historicalEvidence(db,student.id,curriculum),state=projectState(curriculum,[],legacy.preserved);return json({ownerRef:await sha(`dialogue-owner:${student.id}`),revision:0,turns:[],question:null,state,legacy,report:evidenceReport(curriculum,state,[]),saved:false});}
  const before=url.searchParams.has('beforeSeq')?{sequence:Number(url.searchParams.get('beforeSeq'))}:null;
  if(before && (!Number.isSafeInteger(before.sequence)||before.sequence<1))return json({code:'invalid_cursor'},400);
  const result=await snapshot(db,session,curriculum,before);
  if(curriculum.curriculumVersion!==publishedCurriculum.curriculumVersion)result.resumeCurriculum=curriculum;
  if(url.searchParams.get('records')==='1'){
   const [questions,events,drafts,chunks,calls]=await Promise.all([
    all(db.prepare('SELECT instance_json FROM dialogue_questions WHERE session_id=? ORDER BY created_at,id').bind(session.id)),
    all(db.prepare('SELECT id,turn_id,event_type,details_json,created_at FROM dialogue_events WHERE session_id=? ORDER BY created_at,id').bind(session.id)),
    all(db.prepare('SELECT mutation_id,revision,content,question_id,submitted_turn_id,created_at FROM dialogue_drafts WHERE session_id=? ORDER BY created_at,id').bind(session.id)),
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
 if(!session){
  const at=now();await db.prepare('INSERT OR IGNORE INTO dialogue_sessions(id,student_id,lesson_id,curriculum_version,curriculum_json,policy_version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').bind(uuid(),student.id,lessonId,curriculum.curriculumVersion,JSON.stringify(curriculum),POLICY_VERSION,at,at).run();
  session=await db.prepare('SELECT * FROM dialogue_sessions WHERE student_id=? AND lesson_id=? AND curriculum_version=?').bind(student.id,lessonId,curriculum.curriculumVersion).first();
 }
 if(body.action==='question'){
  if(session.inflight)return json({code:'turn_in_progress'},409);
  const outstanding=await db.prepare("SELECT id FROM dialogue_questions WHERE session_id=? AND state='issued'").bind(session.id).first();
  if(outstanding)return json(await snapshot(db,session,curriculum));
  const legacy=await historicalEvidence(db,student.id,curriculum);
  if(legacy.preserved.some(p=>p.objectiveId===body.objectiveId))return json({code:'already_demonstrated',message:'原有掌握紀錄已保留，不需重做。'},409);
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
 let budget;
 try{budget=dialogueBudget(env);}catch{
  await db.prepare('INSERT OR IGNORE INTO dialogue_drafts(id,session_id,mutation_id,request_hash,revision,content,question_id,created_at) VALUES(?,?,?,?,?,?,?,?)').bind(uuid(),session.id,body.mutationId,requestHash,body.revision,body.content,body.questionId||null,now()).run();
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
   AND (SELECT COUNT(*) FROM dialogue_calls WHERE session_id=?)<?
   AND (SELECT COUNT(*) FROM dialogue_calls WHERE state IN ('reserved','finishing'))<?
   AND NOT EXISTS(SELECT 1 FROM dialogue_calls WHERE budget_policy_json IS NULL)
   AND (SELECT COALESCE(SUM(COALESCE(accounted_micros,reserved_micros)),0) FROM dialogue_calls WHERE day=?)+?<=?
   AND (SELECT COALESCE(SUM(COALESCE(accounted_micros,reserved_micros)),0) FROM dialogue_calls WHERE student_id=? AND day=?)+?<=?
   AND (SELECT COALESCE(SUM(COALESCE(c.accounted_micros,c.reserved_micros)),0) FROM dialogue_calls c JOIN dialogue_sessions s ON s.id=c.session_id WHERE c.student_id=? AND s.lesson_id=?)+?<=?`).bind(turnId,at,session.id,body.revision,day,LIMITS.globalPerDay,student.id,day,LIMITS.turnsPerDay,session.id,LIMITS.lessonLifetime,LIMITS.concurrency,day,budget.reserveMicros,budget.globalDailyMicros,student.id,day,budget.reserveMicros,budget.userDailyMicros,student.id,lessonId,budget.reserveMicros,budget.lessonLifetimeMicros),
  db.prepare(`INSERT OR IGNORE INTO dialogue_turns(id,session_id,mutation_id,request_hash,role,content,question_id,status,policy_version,created_at) SELECT ?,id,?,?, 'student',?,?, 'saved',?,? FROM dialogue_sessions WHERE id=? AND inflight=?`).bind(turnId,body.mutationId,requestHash,body.content,body.questionId||null,POLICY_VERSION,at,session.id,turnId),
  db.prepare(`INSERT OR IGNORE INTO dialogue_calls(turn_id,session_id,student_id,day,reserved_tokens,state,created_at,reserved_micros,budget_policy_json) SELECT ?,id,?,?,?,'reserved',?,?,? FROM dialogue_sessions WHERE id=? AND inflight=?`).bind(turnId,student.id,day,LIMITS.outputTokens,at,budget.reserveMicros,JSON.stringify(budget),session.id,turnId),
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
 const stream=request.headers.get('accept')?.includes('text/event-stream')?studentStream():null;
 stream?.send('saved',{saved:true,turnId,mutationId:body.mutationId,revision:body.revision+1,createdAt:at});
 const work=finishTurn({env,db,session,curriculum,question:body.questionId?question:null,turnId,body,callModel,stream,budget});
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
async function finishTurn({env,db,session,curriculum,question,turnId,body,callModel,stream,budget}){
 try{
  const page=await history(db,session),assessments=await assessmentRows(db,session.id);
  const remediationRow=await db.prepare("SELECT instance_json FROM dialogue_questions WHERE session_id=? AND state='needs_reformulation' ORDER BY created_at DESC LIMIT 1").bind(session.id).first();
  const remediation=remediationRow?JSON.parse(remediationRow.instance_json):null;
  const legacy=await historicalEvidence(db,session.student_id,curriculum);
  const prompt=contextFor({curriculum,state:projectState(curriculum,assessments,legacy.preserved),turns:page.turns,question,remediation});
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
  const result=await callModel(env,prompt,turnId,persistReply,budget);
  const proposal=validateProposal(result.value,{curriculum,turns:page.turns,question,remediation,hints:page.turns.filter(t=>t.role==='teacher').map(t=>t.content)});
  const at=now(),teacherId=uuid();
  const claimed=await db.prepare("UPDATE dialogue_calls SET state='finishing',finished_at=? WHERE turn_id=? AND state='reserved'").bind(at,turnId).run();
  if(!claimed.meta.changes)throw Error('call_already_reconciled');
  const active="EXISTS(SELECT 1 FROM dialogue_calls WHERE turn_id=? AND state='finishing')";
  const statements=[db.prepare(`INSERT INTO dialogue_turns(id,session_id,mutation_id,request_hash,role,content,reply_to,status,model,model_version,policy_version,created_at) SELECT ?,?,?,?,'teacher',?,?,'saved',?,?,?,? WHERE ${active}`).bind(teacherId,session.id,body.mutationId,'server-response',proposal.reply,turnId,result.model||null,result.modelVersion||null,POLICY_VERSION,at,turnId)];
  for(const a of proposal.assessments)statements.push(db.prepare(`INSERT INTO dialogue_assessments(id,session_id,turn_id,objective_id,outcome,evidence_json,rationale,rule_version,curriculum_version,created_at) SELECT ?,?,?,?,?,?,?,?,?,? WHERE ${active}`).bind(uuid(),session.id,turnId,a.objectiveId,a.outcome,JSON.stringify(a.evidence),a.rationale,a.ruleVersion,curriculum.curriculumVersion,at,turnId));
  if(question){const a=proposal.assessments.find(a=>a.objectiveId===question.objectiveId);const updated={...question,state:a?.outcome==='demonstrated'?'mastered':'needs_reformulation',answeredAt:at,hinted:a?.outcome!=='demonstrated'};statements.push(db.prepare(`UPDATE dialogue_questions SET state=?,instance_json=? WHERE id=? AND session_id=? AND ${active}`).bind(updated.state,JSON.stringify(updated),question.id,session.id,turnId));}
  statements.push(db.prepare(`INSERT INTO dialogue_events(id,session_id,turn_id,event_type,details_json,created_at) SELECT ?,?,?,?,?,? WHERE ${active}`).bind(uuid(),session.id,turnId,'assessment_saved',JSON.stringify({objectiveIds:proposal.assessments.map(a=>a.objectiveId),ruleVersion:'yw-dialogue-evidence-v1'}),at,turnId),
   db.prepare("UPDATE dialogue_calls SET state='finished',finished_at=?,usage_json=?,first_token_ms=?,completed_ms=?,accounted_micros=? WHERE turn_id=? AND state='finishing'").bind(at,JSON.stringify(result.usage||null),Number.isSafeInteger(result.firstTokenMs)?result.firstTokenMs:null,Number.isSafeInteger(result.totalDurationMs)?result.totalDurationMs:null,reconciledCost(budget,result.usage),turnId),
   db.prepare('UPDATE dialogue_sessions SET inflight=NULL,updated_at=? WHERE id=? AND inflight=?').bind(at,session.id,turnId));
  const saved=await db.batch(statements);if(!saved[0].meta.changes)throw Error('call_already_reconciled');
  stream?.send('done',{saved:true,turnId,teacherTurnId:teacherId});
 }catch{
  const at=now();await db.batch([db.prepare("UPDATE dialogue_calls SET state='review',finished_at=? WHERE turn_id=? AND state IN ('reserved','finishing')").bind(at,turnId),db.prepare("UPDATE dialogue_turns SET status='needs_review' WHERE id=? AND NOT EXISTS(SELECT 1 FROM dialogue_calls WHERE turn_id=? AND state='finished')").bind(turnId,turnId),db.prepare('UPDATE dialogue_sessions SET inflight=NULL,updated_at=? WHERE id=? AND inflight=?').bind(at,session.id,turnId),db.prepare('INSERT OR IGNORE INTO dialogue_events(id,session_id,turn_id,event_type,details_json,created_at) VALUES(?,?,?,?,?,?)').bind(`${turnId}:failure`,session.id,turnId,'response_unconfirmed','{"retry":"readback_only"}',at)]);
  stream?.send('unconfirmed',{turnId,saved:true,retry:'readback_only'});
 }finally{stream?.close();}
}
export async function callDialogueModel(env,prompt,requestId,onReply,budget=dialogueBudget(env)){
 if(!env.APIS?.fetch||!env.APIS_CALLER_TOKEN)throw new Error('approved_gateway_unavailable');
 const signal=AbortSignal.timeout(LIMITS.timeoutMs);
 const response=await env.APIS.fetch(new Request('https://apis.internal/',{method:'POST',headers:{'content-type':'application/json',accept:'text/event-stream','x-project-name':'yw.bdfz.net','x-task-type':'chat','x-thinking-level':'low','x-internal-token':env.APIS_CALLER_TOKEN,'x-request-id':requestId},body:JSON.stringify({stream:true,model:budget.model,contents:[{role:'user',parts:[{text:prompt}]}],taskType:'chat',thinkingLevel:'low',generationConfig:{temperature:0.3,maxOutputTokens:LIMITS.outputTokens,responseMimeType:'application/json'}}),signal}));
 if(!response.ok)throw new Error('gateway_unavailable');
 const result=await consumeGatewayStream(response,onReply,{maxReplyChars:LIMITS.replyChars,signal});
 if(result.model!==budget.model)throw Error('budget_model_mismatch');
 return result;
}
