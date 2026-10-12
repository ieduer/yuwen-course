// Fixed synthetic operation on the existing owner-only acceptance context.
// No browser prompt, curriculum override, grades or central evidence writes.
import {CALIBRATION_CONTRACT as amendment} from './dialogue-calibration-contract.js';
import packet from './dialogue-calibration-packet.json' with {type:'json'};
import {acceptanceContext} from './dialogue-acceptance.js';
import {dialogueBudget,reconciledCost} from './dialogue-budget.js';
import {POLICY_VERSION,LIMITS,validateProposal} from './dialogue-policy.js';
const OP=amendment.operation;
const DIGEST=amendment.packetDigest;
const priorPrefix=amendment.priorOperation+':',priorId=priorPrefix+amendment.priorCase;
const prefix=OP+':',second=amendment.secondPrior,secondPrefix=second.operation+':',secondId=secondPrefix+second.caseId;
const hardExpiry=Date.parse(amendment.hardExpiry);
const callSelect='SELECT c.*,s.curriculum_json,e.details_json FROM dialogue_calls c JOIN dialogue_sessions s ON s.id=c.session_id LEFT JOIN dialogue_events e ON e.id=c.turn_id||\':result\' WHERE c.turn_id=? AND c.student_id=? AND s.student_id=?';
const receipt=async row=>row?sha(JSON.stringify({id:row.turn_id,state:row.state,reserved:row.reserved_micros,accounted:row.accounted_micros,created:row.created_at,finished:row.finished_at,source:row.curriculum_json,result:row.details_json})):null;
const sha=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(x=>x.toString(16).padStart(2,'0')).join('');
const json=(x,status=200)=>Response.json(x,{status,headers:{'cache-control':'private, no-store'}});
export async function handleCalibration(request,env,student,callModel){
 const context=acceptanceContext(env),url=new URL(request.url);
 if(!context||Number(student.ucUserId)!==context.userId||Date.now()>=Math.min(context.expires,hardExpiry))return json({code:'not_found'},404);
 if(packet.operation!==OP||packet.sourceDigest!==DIGEST||packet.cases.length!==24)return json({code:'calibration_packet_invalid'},503);
 const index=packet.cases.findIndex(c=>c.id===url.searchParams.get('calibration')),c=packet.cases[index];
 if(!c||url.searchParams.get('lessonId')!==c.lessonId)return json({code:'calibration_case_invalid'},400);
 const attempt=Number(url.searchParams.get('attempt')||1);
 if(!Number.isInteger(attempt)||attempt<1||attempt>amendment.additionalAttempts)return json({code:'calibration_attempt_invalid'},400);
 const db=env.READING_DB,id=prefix+'attempt-'+attempt,sessionId=id+':session',ownerRef=await sha(`dialogue-owner:${student.id}`);
 const prior=await db.prepare(callSelect).bind(priorId,student.id,student.id).first();
 let priorSource,priorResult;try{priorSource=JSON.parse(prior?.curriculum_json||'null');priorResult=JSON.parse(prior?.details_json||'null');}catch{}
 const priorValid=prior?.state===amendment.priorState&&prior.reserved_micros===amendment.priorReservedMicros&&prior.accounted_micros===amendment.priorAccountedMicros&&prior.created_at===amendment.priorCreatedAt&&prior.finished_at===amendment.priorFinishedAt&&JSON.stringify(JSON.parse(prior.usage_json||'null'))===JSON.stringify(amendment.priorUsage)&&priorSource?.sourceDigest===amendment.priorSourceDigest&&priorSource?.promptDigest===amendment.priorPromptDigest&&priorResult?.reason===amendment.priorReason;
 const prior2=await db.prepare(callSelect).bind(secondId,student.id,student.id).first();
 let source2,result2;try{source2=JSON.parse(prior2?.curriculum_json||'null');result2=JSON.parse(prior2?.details_json||'null');}catch{}
 const prior2Valid=prior2?.state===second.state&&prior2.reserved_micros===second.reservedMicros&&prior2.accounted_micros===null&&prior2.usage_json===null&&prior2.created_at===second.createdAt&&prior2.finished_at===second.finishedAt&&source2?.sourceDigest===second.sourceDigest&&source2?.promptDigest===second.promptDigest&&result2?.reason===second.reason&&result2.received===null;
 const readback=async()=>{
  const row=await db.prepare('SELECT state,reserved_micros,accounted_micros,usage_json,created_at,finished_at FROM dialogue_calls WHERE turn_id=? AND student_id=?').bind(id,student.id).first();
  const event=await db.prepare("SELECT details_json FROM dialogue_events WHERE id=? AND session_id=?").bind(id+':result',sessionId).first();
  const chunks=(await db.prepare('SELECT sequence,content FROM dialogue_stream_chunks WHERE turn_id=? ORDER BY sequence').bind(id).all()).results||[];
  const full=await db.prepare(callSelect).bind(id,student.id,student.id).first();
  const totals=await db.prepare('SELECT COUNT(*) attempts,SUM(reserved_micros) reservedMicros,SUM(COALESCE(accounted_micros,reserved_micros)) conservativeMicros FROM dialogue_calls WHERE substr(turn_id,1,?)=? OR substr(turn_id,1,?)=? OR substr(turn_id,1,?)=?').bind(prefix.length,prefix,priorPrefix.length,priorPrefix,secondPrefix.length,secondPrefix).first();
  const start=await db.prepare('SELECT created_at FROM dialogue_sessions WHERE id=?').bind(OP+':intent').first();
  return {operation:OP,attempt,attemptId:id,receiptDigest:await receipt(full),totals,deadlineAt:start?new Date(Math.min(Date.parse(start.created_at)+amendment.windowMs,hardExpiry)).toISOString():null,caseId:c.id,ownerRef,promptDigest:c.promptDigest,sourceDigest:c.sourceDigest,call:row||null,result:event?JSON.parse(event.details_json):null,chunks,syntheticOnly:true,amendment,secondPrior:prior2?{state:prior2.state,accountedMicros:prior2.accounted_micros,reservedMicros:prior2.reserved_micros,receiptValid:prior2Valid}:null,prior:prior?{state:prior.state,reservedMicros:prior.reserved_micros,accountedMicros:prior.accounted_micros,createdAt:prior.created_at,source:priorSource,result:priorResult}:null};
 };
 const storedAttempt=await db.prepare(callSelect).bind(id,student.id,student.id).first();
 if(storedAttempt&&JSON.parse(storedAttempt.curriculum_json).caseId!==c.id)return json({code:'calibration_attempt_case_mismatch'},409);
 if(request.method==='GET')return json(await readback());
 if(request.method!=='POST'||request.headers.get('origin')!==context.origin)return json({code:'web_origin_required'},403);
 const raw=await request.text();if(raw.length>512)return json({code:'calibration_input_invalid'},400);
 let body;try{body=JSON.parse(raw);}catch{return json({code:'calibration_input_invalid'},400);}
 if(!body||Object.keys(body).sort().join(',')!==(attempt===1?'action,ownerRef':'action,ownerRef,previousReceipt')||body.action!==amendment.action||body.ownerRef!==ownerRef)return json({code:'calibration_input_invalid'},400);
 if(!priorValid||!prior2Valid)return json({code:'calibration_prior_receipt_mismatch'},409);
 const existing=await readback();if(existing.call){
  const stored=await db.prepare(callSelect).bind(id,student.id,student.id).first();
  if(JSON.parse(stored.curriculum_json).caseId!==c.id)return json({code:'calibration_attempt_case_mismatch'},409);
  return json(existing,existing.call.state==='finished'?200:409);
 }
 const previous=attempt>1?await db.prepare(callSelect).bind(prefix+'attempt-'+(attempt-1),student.id,student.id).first():null;
 if(attempt>1){
  if(!previous||!['finished','review'].includes(previous.state)||body.previousReceipt!==await receipt(previous))return json({code:'calibration_reconcile_required'},409);
  const meta=JSON.parse(previous.curriculum_json),result=JSON.parse(previous.details_json||'null');
  if(!result||result.boundaryStop)return json({code:'calibration_boundary_stop'},409);
  const previousIndex=packet.cases.findIndex(x=>x.id===meta.caseId);
  if(index!==previousIndex+1&&index!==previousIndex)return json({code:'calibration_case_order'},409);
  if(index===previousIndex){
   const count=await db.prepare('SELECT COUNT(*) n FROM dialogue_sessions WHERE substr(curriculum_version,1,?)=?').bind((OP+':'+c.id+':').length,OP+':'+c.id+':').first();
   if(previous.state!=='review'||previous.accounted_micros===null||!(result.received||result.value)||count.n>=2)return json({code:'calibration_recovery_not_safe'},409);
  }
 }else if(index!==0)return json({code:'calibration_case_order'},409);
 // Compare the published source before applying any hypothetical fixture state.
 const source=await env.ASSETS.fetch(new Request(context.origin+`/dialogue-curriculum/${c.lessonId}.json`));
 if(!source.ok||await sha(JSON.stringify(await source.json()))!==c.sourceDigest||await sha(JSON.stringify(c.prompt))!==c.promptDigest)return json({code:'calibration_source_mismatch'},409);
 let budget;try{budget=dialogueBudget(env);}catch{return json({code:'budget_policy_required'},503);}
 if(budget.model!==packet.model||budget.reserveMicros*24>2016000)return json({code:'calibration_budget_mismatch'},503);
 const at=new Date().toISOString(),day=at.slice(0,10),cutoff=new Date(Date.now()-amendment.windowMs).toISOString(),namespace='calibration:'+c.lessonId;
 // One durable first-intent clock; failed admission and reload never restart it.
 await db.prepare('INSERT OR IGNORE INTO dialogue_sessions(id,student_id,lesson_id,curriculum_version,curriculum_json,policy_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(OP+':intent',student.id,'calibration-control',OP,JSON.stringify({syntheticOnly:true,packetDigest:DIGEST}),POLICY_VERSION,at,at).run();
 await db.prepare('INSERT OR IGNORE INTO dialogue_sessions(id,student_id,lesson_id,curriculum_version,curriculum_json,policy_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(sessionId,student.id,namespace,OP+':'+c.id+':'+attempt,JSON.stringify({syntheticOnly:true,caseId:c.id,sourceDigest:c.sourceDigest,promptDigest:c.promptDigest}),POLICY_VERSION,at,at).run();
 const reserve=await db.batch([
  db.prepare(`UPDATE dialogue_sessions SET revision=1,inflight=?,updated_at=? WHERE id=? AND student_id=? AND revision=0 AND curriculum_version=?
   AND (SELECT COUNT(*) FROM dialogue_calls WHERE substr(turn_id,1,?)=?)=?
   AND EXISTS(SELECT 1 FROM dialogue_sessions WHERE id=? AND student_id=? AND created_at>=?)
   AND NOT EXISTS(SELECT 1 FROM dialogue_calls WHERE substr(turn_id,1,?)=? AND state NOT IN ('finished','review'))
   AND (SELECT COUNT(*) FROM dialogue_calls WHERE substr(turn_id,1,?)=?)=1
   AND (SELECT COUNT(*) FROM dialogue_calls WHERE substr(turn_id,1,?)=?)=1
   AND (SELECT COUNT(*) FROM dialogue_calls WHERE substr(turn_id,1,?)=? OR substr(turn_id,1,?)=? OR substr(turn_id,1,?)=?)<?
   AND (SELECT COALESCE(SUM(reserved_micros),0) FROM dialogue_calls WHERE substr(turn_id,1,?)=? OR substr(turn_id,1,?)=? OR substr(turn_id,1,?)=?)+?<=?
   AND (SELECT COUNT(*) FROM dialogue_calls WHERE day=?)<?
   AND (SELECT COUNT(*) FROM dialogue_calls WHERE student_id=? AND day=?)<?
   AND (SELECT COUNT(*) FROM dialogue_calls WHERE state IN ('reserved','finishing'))<?
   AND NOT EXISTS(SELECT 1 FROM dialogue_calls WHERE budget_policy_json IS NULL)
   AND (SELECT COALESCE(SUM(COALESCE(accounted_micros,reserved_micros)),0) FROM dialogue_calls WHERE day=?)+?<=?
   AND (SELECT COALESCE(SUM(COALESCE(accounted_micros,reserved_micros)),0) FROM dialogue_calls WHERE student_id=? AND day=?)+?<=?
   AND (SELECT COUNT(*) FROM dialogue_calls c JOIN dialogue_sessions s ON s.id=c.session_id WHERE c.student_id=? AND s.lesson_id IN (?,?))<?
   AND (SELECT COALESCE(SUM(COALESCE(c.accounted_micros,c.reserved_micros)),0) FROM dialogue_calls c JOIN dialogue_sessions s ON s.id=c.session_id WHERE c.student_id=? AND s.lesson_id IN (?,?))+?<=?`).bind(id,at,sessionId,student.id,OP+':'+c.id+':'+attempt,prefix.length,prefix,attempt-1,OP+':intent',student.id,cutoff,prefix.length,prefix,priorPrefix.length,priorPrefix,secondPrefix.length,secondPrefix,priorPrefix.length,priorPrefix,secondPrefix.length,secondPrefix,prefix.length,prefix,amendment.maxTotalAttempts,priorPrefix.length,priorPrefix,secondPrefix.length,secondPrefix,prefix.length,prefix,budget.reserveMicros,amendment.maxCumulativeReservedMicros,day,LIMITS.globalPerDay,student.id,day,LIMITS.turnsPerDay,LIMITS.concurrency,day,budget.reserveMicros,budget.globalDailyMicros,student.id,day,budget.reserveMicros,budget.userDailyMicros,student.id,c.lessonId,namespace,LIMITS.lessonLifetime,student.id,c.lessonId,namespace,budget.reserveMicros,budget.lessonLifetimeMicros),
  db.prepare("INSERT OR IGNORE INTO dialogue_turns(id,session_id,mutation_id,request_hash,role,content,status,policy_version,created_at) SELECT ?,id,?,?,'student',?,'synthetic_calibration',?,? FROM dialogue_sessions WHERE id=? AND inflight=? AND revision=1").bind(id,c.id,c.promptDigest,c.studentAnswer,POLICY_VERSION,at,sessionId,id),
  db.prepare("INSERT OR IGNORE INTO dialogue_calls(turn_id,session_id,student_id,day,reserved_tokens,state,created_at,reserved_micros,budget_policy_json) SELECT ?,id,?,?,?,'reserved',?,?,? FROM dialogue_sessions WHERE id=? AND inflight=? AND revision=1").bind(id,student.id,day,LIMITS.outputTokens,at,budget.reserveMicros,JSON.stringify(budget),sessionId,id),
 ]);
 if(!reserve[0].meta.changes)return json({code:'calibration_admission_stopped',...(await readback())},409);
 // A single provider attempt. On any uncertainty the reservation remains charged
 // conservatively; same-attempt POST returns readback, never calls the provider.
 let visible='',sequence=0,received=null;
 try{
  const result=received=await callModel(env,c.prompt,id,async text=>{
   if(typeof text!=='string'||!text.startsWith(visible)||text.length>LIMITS.replyChars)throw Error('invalid_visible_stream');
   if(text===visible)return;const delta=text.slice(visible.length);visible=text;
   await db.prepare('INSERT INTO dialogue_stream_chunks(turn_id,sequence,content,created_at) VALUES(?,?,?,?)').bind(id,++sequence,delta,new Date().toISOString()).run();
  },budget);
  const cost=reconciledCost(budget,result.usage);if(result.model!==packet.model)throw Error('calibration_model_mismatch');if(cost===null)throw Error('calibration_usage_missing');
  const proposal=validateProposal(result.value,{curriculum:c.curriculum,state:c.state,turns:c.turns,question:c.question,hints:c.turns.filter(t=>t.role==='teacher').map(t=>t.content)});
  const verdict=proposal.assessments.find(a=>a.objectiveId===c.objectiveId)?.outcome||'no_assessment';
  const expected=(c.expected==='demonstrated'?verdict==='demonstrated':verdict!=='demonstrated')&&!proposal.assessments.some(a=>a.outcome==='demonstrated'&&a.objectiveId!==c.objectiveId);
  const details={value:result.value,model:result.model,modelVersion:result.modelVersion||null,usage:result.usage,firstTokenMs:result.firstTokenMs,totalDurationMs:result.totalDurationMs,expectedVerdictMatches:expected,verdict,semanticReviewRequired:true,review:c.review,syntheticOnly:true};
  const ended=new Date().toISOString();await db.batch([
   db.prepare('INSERT INTO dialogue_events(id,session_id,turn_id,event_type,details_json,created_at) VALUES(?,?,?,?,?,?)').bind(id+':result',sessionId,id,'synthetic_calibration_result',JSON.stringify(details),ended),
   db.prepare('UPDATE dialogue_calls SET state=?,accounted_micros=?,usage_json=?,first_token_ms=?,completed_ms=?,finished_at=? WHERE turn_id=? AND state=\'reserved\'').bind(expected?'finished':'review',cost,JSON.stringify(result.usage),result.firstTokenMs??null,result.totalDurationMs??null,ended,id),
   db.prepare('UPDATE dialogue_sessions SET inflight=NULL,updated_at=? WHERE id=? AND inflight=?').bind(ended,sessionId,id),
  ]);
  return json(await readback(),expected?200:409);
 }catch(error){
  const existing=await readback();if(existing.call?.state==='finished')return json(existing);
  const ended=new Date().toISOString(),knownCost=received?reconciledCost(budget,received.usage):null;
  const reason=/^[a-z_]{1,80}$/.test(error.message||'')?error.message:'calibration_unconfirmed';
  const evidence={syntheticOnly:true,reason,boundaryStop:/credential|unauth|forbidden|locked|rate_limit|model.*mismatch/.test(reason),received,semanticReviewRequired:true,expectedVerdictMatches:false};
  await db.batch([
   db.prepare('INSERT OR IGNORE INTO dialogue_events(id,session_id,turn_id,event_type,details_json,created_at) VALUES(?,?,?,?,?,?)').bind(id+':result',sessionId,id,'synthetic_calibration_unconfirmed',JSON.stringify(evidence),ended),
   db.prepare("UPDATE dialogue_calls SET state='review',accounted_micros=?,usage_json=?,finished_at=? WHERE turn_id=? AND state='reserved'").bind(knownCost,received?.usage?JSON.stringify(received.usage):null,ended,id),
   db.prepare('UPDATE dialogue_sessions SET inflight=NULL WHERE id=? AND inflight=?').bind(sessionId,id),
  ]);
  return json({code:'calibration_unconfirmed',...(await readback())},409);
 }
}
