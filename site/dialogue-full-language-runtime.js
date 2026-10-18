import {fetchAssessmentAsset} from './assessment-assets.js';
// Owner-only synthetic execution. No paid authority or deployment activation is
// supplied by this module. Request JSON cannot supply either capability.
import packet from './dialogue-full-language-packet.json' with {type:'json'};
import {FULL_OPERATION as OP,HISTORICAL_BASE as base,FULL_CASE_COUNT,RELEASE_CASE_COUNT,FULL_MODEL,FULL_E2E_OPERATION,QUOTE_RECOVERY,quotationRecovery,recoveryPrompt,fullActivation,fullAdmission,fullSourceGate,fullMaterialize,fullReceipt as receipt,digest} from './dialogue-full-language.js';
import {acceptanceContext} from './dialogue-acceptance.js';
import {dialogueBudget,reconciledCost} from './dialogue-budget.js';
import {POLICY_VERSION,LIMITS,validateProposal} from './dialogue-policy.js';
const prefix=OP+':';
const contract={operation:OP,action:'calibration_full_language',packetDigest:packet.sourceDigest,model:FULL_MODEL,firstTokenTargetMs:5000};
const sha=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))).map(x=>x.toString(16).padStart(2,'0')).join('');
const json=(value,status=200)=>Response.json(value,{status,headers:{'cache-control':'private, no-store'}});
const all=async stmt=>(await stmt.all()).results||[];
const fullSql=`SELECT c.*,s.student_id AS session_owner,s.curriculum_json,e.details_json,
 (SELECT COUNT(*) FROM dialogue_stream_chunks k WHERE k.turn_id=c.turn_id) chunk_count,
 (SELECT COALESCE(SUM(LENGTH(content)),0) FROM dialogue_stream_chunks k WHERE k.turn_id=c.turn_id) partial_chars
 FROM dialogue_calls c JOIN dialogue_sessions s ON s.id=c.session_id LEFT JOIN dialogue_events e ON e.id=c.turn_id||':result'`;
const safeParse=value=>{try{return JSON.parse(value||'null');}catch{return null;}};

async function snapshot(db,student,id,authority){
 const allRows=await all(db.prepare(fullSql+' WHERE substr(c.turn_id,1,?)=? OR substr(c.turn_id,1,?)=? ORDER BY c.turn_id').bind(base.length,base,prefix.length,prefix));
 if(allRows.some(r=>r.student_id!==student.id||r.session_owner!==student.id))throw Error('calibration_owner_mismatch');
 const historical=allRows.filter(r=>!r.turn_id.startsWith(prefix)),current=allRows.filter(r=>r.turn_id.startsWith(prefix));
 const pins=await Promise.all(historical.map(async r=>({attemptId:r.turn_id,receiptDigest:await receipt(r)})));
 const history={attempts:historical.length,reservedMicros:historical.reduce((n,r)=>n+r.reserved_micros,0),knownMicros:historical.reduce((n,r)=>n+(r.accounted_micros??0),0),unknownReservedMicros:historical.reduce((n,r)=>n+(r.accounted_micros===null?r.reserved_micros:0),0),receiptSetDigest:await digest(pins),reconciled:!!authority&&historical.every(r=>['finished','review'].includes(r.state)&&r.finished_at)&&JSON.stringify(pins)===JSON.stringify(authority.priorReceipts)};
 const rows=await Promise.all(current.map(async r=>{const meta=safeParse(r.curriculum_json),result=safeParse(r.details_json),spec=packet.cases.find(c=>c.id===meta?.caseId);return {sourceValid:!!spec&&meta.packetDigest===packet.sourceDigest&&meta.sourceDigest===spec.sourceDigest&&(meta.promptDigest===spec.promptDigest&&r.turn_id.endsWith(':1')||quotationRecovery(authority)&&spec.id===QUOTE_RECOVERY.caseId&&r.turn_id===prefix+spec.id+':2'&&meta.promptDigest===QUOTE_RECOVERY.promptDigest&&meta.recoveryOf===QUOTE_RECOVERY.receiptDigest),caseId:meta?.caseId,attemptId:r.turn_id,receiptDigest:await receipt(r),state:r.state,reservedMicros:r.reserved_micros,accountedMicros:r.accounted_micros,createdAt:r.created_at,finishedAt:r.finished_at,chunkCount:r.chunk_count,partialChars:r.partial_chars,finalAssessment:!!(result?.value||result?.received?.value),boundaryStop:result?.boundaryStop===true,model:result?.model||result?.received?.model,modelVersion:result?.modelVersion||result?.received?.modelVersion};}));
 const day=new Date().toISOString().slice(0,10);
 const capacity=await db.prepare(`SELECT COUNT(*) globalDayCalls,COALESCE(SUM(COALESCE(accounted_micros,reserved_micros)),0) globalDayConservativeMicros,
 (SELECT COUNT(*) FROM dialogue_calls WHERE student_id=? AND day=?) userDayCalls,
 (SELECT COALESCE(SUM(COALESCE(accounted_micros,reserved_micros)),0) FROM dialogue_calls WHERE student_id=? AND day=?) userDayConservativeMicros,
 (SELECT COUNT(*) FROM dialogue_calls WHERE state IN ('reserved','finishing')) reservedConcurrentCalls,
 (SELECT COUNT(*) FROM dialogue_calls WHERE (substr(turn_id,1,?)=? OR json_extract(CASE WHEN json_valid(budget_policy_json) THEN budget_policy_json ELSE '{}' END,'$.isolatedAdmission.operation')=?) AND state IN ('reserved','finishing')) operationConcurrentCalls FROM dialogue_calls WHERE day=?`).bind(student.id,day,student.id,day,prefix.length,prefix,FULL_E2E_OPERATION,day).first();
 const row=current.find(r=>r.turn_id===id),chunks=row?await all(db.prepare('SELECT sequence,content FROM dialogue_stream_chunks WHERE turn_id=? ORDER BY sequence').bind(id)):[];
 return {history,rows,capacity,recoveryFailure:quotationRecovery(authority)?current.find(r=>r.turn_id===QUOTE_RECOVERY.attemptId)||null:null,rawRow:row||null,call:row?{state:row.state,reserved_micros:row.reserved_micros,accounted_micros:row.accounted_micros,usage_json:row.usage_json,created_at:row.created_at,finished_at:row.finished_at}:null,receiptDigest:row?await receipt(row):null,result:row?safeParse(row.details_json):null,chunks};
}

export async function handleFullLanguageCalibration(request,env,student,callModel){
 const context=acceptanceContext(env),url=new URL(request.url);
 if(!context||url.origin!==context.origin||Number(student.ucUserId)!==context.userId||Date.now()>=context.expires)return json({code:'not_found'},404);
 const {sourceDigest,...unsignedPacket}=packet;
 if(packet.operation!==OP||await digest(unsignedPacket)!==sourceDigest||packet.cases.length!==FULL_CASE_COUNT)return json({code:'calibration_packet_invalid'},503);
 const c=packet.cases.find(c=>c.id===url.searchParams.get('calibration')),attempt=Number(url.searchParams.get('attempt')||1);
 if(!c||c.lessonId!==url.searchParams.get('lessonId')||!(attempt===1||attempt===2&&c.id===QUOTE_RECOVERY.caseId))return json({code:'calibration_case_invalid'},400);
 const id=prefix+c.id+':'+attempt,sessionId=id+':session',db=env.READING_DB,ownerRef=await sha(`dialogue-owner:${student.id}`);
 const authority=fullActivation(env,packet),recovery=quotationRecovery(authority),recoveryOf=attempt===2&&recovery?recovery.receiptDigest:null,promptDigest=recoveryOf?recovery.promptDigest:c.promptDigest;
 let state;try{state=await snapshot(db,student,id,authority);}catch{return json({code:'calibration_owner_mismatch'},409);}
 const readback=async()=>({operation:OP,caseId:c.id,attempt,attemptId:id,ownerRef,packetDigest:contract.packetDigest,sourceDigest:c.sourceDigest,promptDigest,recoveryOf,hardExpiry:authority?.hardExpiry||null,sourceReadiness:c.sourceGate,rawSourceDigest:c.rawSourceDigest,projectionVersion:packet.projectionVersion,activationDigest:authority?.registryReceiptDigest||null,sourceCommit:authority?.sourceCommit||null,artifactSha256:authority?.artifactSha256||null,apisVersion:context.version,...await snapshot(db,student,id,authority),syntheticOnly:true});
 if(request.method==='GET')return json(await readback());
 if(request.method!=='POST'||request.headers.get('origin')!==context.origin)return json({code:'web_origin_required'},403);
 const raw=await request.text();if(raw.length>900)return json({code:'calibration_input_invalid'},400);
 const body=safeParse(raw),keys='action,ownerRef';
 if(!body||Object.keys(body).sort().join(',')!==keys||body.action!==contract.action||body.ownerRef!==ownerRef)return json({code:'calibration_input_invalid'},400);
 if(state.call)return json(await readback(),state.call.state==='finished'?200:409);
 if(!authority)return json({code:'full_activation_required',paidCallsAuthorized:false,packetDigest:contract.packetDigest},409);
 const admission=fullAdmission({packet,rows:state.rows,history:state.history,capacity:state.capacity,caseId:c.id,recoveryOf,authority});
 if(!admission.allowed||admission.attempt!==attempt)return json(admission.allowed?{code:'full_case_attempt_invalid'}:admission,409);
 const source=await fetchAssessmentAsset(env,new Request(context.origin+`/dialogue-curriculum/${c.lessonId}.json`));
 if(!source.ok)return json({code:'full_source_mismatch',scope:'operation'},409);
 const curriculum=await source.json();
 if(await digest(curriculum)!==c.sourceDigest)return json({code:'full_source_mismatch',scope:'operation'},409);
 if(!fullSourceGate(curriculum,c).eligible)return json({code:'full_case_source_blocked',scope:'case'},409);
 const fixture=fullMaterialize(c,curriculum);
 if(await digest(fixture.prompt)!==c.promptDigest)return json({code:'full_prompt_mismatch',scope:'operation'},409);
 if(recoveryOf)fixture.prompt=recoveryPrompt(fixture.prompt);
 if(await digest(fixture.prompt)!==promptDigest)return json({code:'full_recovery_prompt_mismatch',scope:'operation'},409);
 let budget;try{budget=dialogueBudget(env);}catch{return json({code:'budget_policy_required'},503);}
 if(budget.model!==contract.model||budget.reserveMicros!==84000||budget.globalDailyMicros>50000000||budget.userDailyMicros>50000000)return json({code:'calibration_budget_mismatch'},503);
 // The ordinary acceptance route may permit three attempts; calibration never
 // inherits that setting or a caller-supplied attempt count from its price policy.
 budget={...budget,providerAttemptLimit:1,logicalProviderAttemptLimit:1};
 const at=new Date().toISOString(),day=at.slice(0,10),casePrefix=prefix+c.id+':';
 await db.prepare('INSERT OR IGNORE INTO dialogue_sessions(id,student_id,lesson_id,curriculum_version,curriculum_json,policy_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(sessionId,student.id,'calibration:'+c.lessonId,OP+':'+c.id+':'+attempt,JSON.stringify({syntheticOnly:true,caseId:c.id,sourceDigest:c.sourceDigest,rawSourceDigest:c.rawSourceDigest,projectionVersion:packet.projectionVersion,promptDigest,packetDigest:contract.packetDigest,recoveryOf}),POLICY_VERSION,at,at).run();
 const reserved=await db.batch([
  db.prepare(`UPDATE dialogue_sessions SET revision=1,inflight=?,updated_at=? WHERE id=? AND student_id=? AND revision=0
   AND (SELECT COUNT(*) FROM dialogue_calls WHERE substr(turn_id,1,?)=?)=?
   AND (SELECT COUNT(*) FROM dialogue_calls WHERE substr(turn_id,1,?)=?)<${authority.maxAttempts}
   AND (SELECT COALESCE(SUM(reserved_micros),0) FROM dialogue_calls WHERE substr(turn_id,1,?)=?)+84000<=${authority.maxReservedMicros}
   AND (SELECT COUNT(*) FROM dialogue_calls WHERE (substr(turn_id,1,?)=? OR json_extract(CASE WHEN json_valid(budget_policy_json) THEN budget_policy_json ELSE '{}' END,'$.isolatedAdmission.operation')=?) AND state IN ('reserved','finishing'))<1
   AND (SELECT COUNT(*) FROM dialogue_calls WHERE substr(turn_id,1,?)=?)=?
   AND (SELECT COUNT(*) FROM dialogue_calls WHERE day=?)<400
   AND (SELECT COUNT(*) FROM dialogue_calls WHERE state IN ('reserved','finishing'))<4
   AND (SELECT COALESCE(SUM(COALESCE(accounted_micros,reserved_micros)),0) FROM dialogue_calls WHERE day=?)+?<=?
   AND (SELECT COALESCE(SUM(COALESCE(accounted_micros,reserved_micros)),0) FROM dialogue_calls WHERE student_id=? AND day=?)+?<=?
   AND (SELECT COUNT(*) FROM dialogue_calls WHERE substr(turn_id,1,?)=?)=?
   AND (?=0 OR EXISTS(SELECT 1 FROM dialogue_calls f JOIN dialogue_sessions s ON s.id=f.session_id JOIN dialogue_events e ON e.id=f.turn_id||':result' WHERE f.turn_id=? AND f.state='review' AND f.reserved_micros=84000 AND f.accounted_micros=0 AND f.created_at=? AND f.finished_at=? AND s.curriculum_json=? AND e.details_json=?))
   AND NOT EXISTS(SELECT 1 FROM dialogue_calls c LEFT JOIN dialogue_events e ON e.id=c.turn_id||':result' WHERE substr(c.turn_id,1,?)=? AND c.turn_id<>? AND (c.state='review' OR json_extract(e.details_json,'$.boundaryStop')=1 OR COALESCE(json_extract(e.details_json,'$.model'),json_extract(e.details_json,'$.received.model'),'gemini-3.8-flash')<>'gemini-3.8-flash'))`).bind(id,at,sessionId,student.id,casePrefix.length,casePrefix,attempt-1,prefix.length,prefix,prefix.length,prefix,prefix.length,prefix,FULL_E2E_OPERATION,base.length,base,state.history.attempts,day,day,budget.reserveMicros,budget.globalDailyMicros,student.id,day,budget.reserveMicros,budget.userDailyMicros,prefix.length,prefix,state.rows.length,recovery?1:0,recovery?.attemptId||'',state.recoveryFailure?.created_at||'',state.recoveryFailure?.finished_at||'',state.recoveryFailure?.curriculum_json||'',state.recoveryFailure?.details_json||'',prefix.length,prefix,recovery?.attemptId||''),
  db.prepare("INSERT OR IGNORE INTO dialogue_turns(id,session_id,mutation_id,request_hash,role,content,status,policy_version,created_at) SELECT ?,id,?,?,'student',?,'synthetic_calibration',?,? FROM dialogue_sessions WHERE id=? AND inflight=? AND revision=1").bind(id,c.id,promptDigest,c.studentAnswer,POLICY_VERSION,at,sessionId,id),
  db.prepare("INSERT OR IGNORE INTO dialogue_calls(turn_id,session_id,student_id,day,reserved_tokens,state,created_at,reserved_micros,budget_policy_json) SELECT ?,id,?,?,?,'reserved',?,?,? FROM dialogue_sessions WHERE id=? AND inflight=? AND revision=1").bind(id,student.id,day,LIMITS.outputTokens,at,budget.reserveMicros,JSON.stringify(budget),sessionId,id),
 ]);
 if(!reserved[0].meta.changes)return json({code:'full_atomic_admission_stopped',...await readback()},409);
 let visible='',sequence=0,received=null;
 try{
  if(Date.now()>=Math.min(context.expires,Date.parse(authority.hardExpiry)))throw Error('full_expired');
  const result=received=await callModel(env,fixture.prompt,id,async text=>{
   if(typeof text!=='string'||!text.startsWith(visible)||text.length>LIMITS.replyChars)throw Error('invalid_visible_stream');
   if(text===visible)return;const delta=text.slice(visible.length);visible=text;
   await db.prepare('INSERT INTO dialogue_stream_chunks(turn_id,sequence,content,created_at) VALUES(?,?,?,?)').bind(id,++sequence,delta,new Date().toISOString()).run();
  },budget);
  const cost=reconciledCost(budget,result.usage);if(result.providerAttemptCount!==1)throw Error('calibration_provider_attempt_mismatch');if(!result.modelVersion||typeof result.modelVersion!=='string')throw Error('calibration_model_version_missing');if(result.model!==contract.model)throw Error('calibration_model_mismatch');if(state.rows.some(r=>r.modelVersion&&r.modelVersion!==result.modelVersion))throw Error('calibration_model_version_mismatch');if(cost===null)throw Error('calibration_usage_missing');if(cost>budget.reserveMicros)throw Error('calibration_budget_exceeded');
  const proposal=validateProposal(result.value,{...fixture,hints:fixture.turns.filter(t=>t.role==='teacher').map(t=>t.content)});
  const verdict=proposal.assessments.find(a=>a.objectiveId===c.objectiveId)?.outcome||'no_assessment',expected=(c.expected==='demonstrated'?verdict==='demonstrated':verdict!=='demonstrated')&&!proposal.assessments.some(a=>a.outcome==='demonstrated'&&a.objectiveId!==c.objectiveId);
  const details={value:result.value,providerAccounting:result.providerAccounting||null,model:result.model,modelVersion:result.modelVersion||null,usage:result.usage,firstTokenMs:result.firstTokenMs,totalDurationMs:result.totalDurationMs,firstTokenTargetMet:Number.isFinite(result.firstTokenMs)?result.firstTokenMs<=contract.firstTokenTargetMs:null,verdict,expectedVerdictMatches:expected,semanticReviewRequired:true,review:c.review,syntheticOnly:true};
  const ended=new Date().toISOString();await db.batch([
   db.prepare('INSERT INTO dialogue_events(id,session_id,turn_id,event_type,details_json,created_at) VALUES(?,?,?,?,?,?)').bind(id+':result',sessionId,id,'synthetic_calibration_result',JSON.stringify(details),ended),
   db.prepare("UPDATE dialogue_calls SET state=?,accounted_micros=?,usage_json=?,first_token_ms=?,completed_ms=?,finished_at=? WHERE turn_id=? AND state='reserved'").bind(expected?'finished':'review',cost,JSON.stringify(result.usage),result.firstTokenMs??null,result.totalDurationMs??null,ended,id),
   db.prepare('UPDATE dialogue_sessions SET inflight=NULL,updated_at=? WHERE id=? AND inflight=?').bind(ended,sessionId,id),
  ]);return json(await readback(),expected?200:409);
 }catch(error){
  const ended=new Date().toISOString(),knownCost=received?reconciledCost(budget,received.usage):null,reason=/^[a-z_]{1,80}$/.test(error.message||'')?error.message:'calibration_unconfirmed';
  const details={syntheticOnly:true,reason,boundaryStop:/expired|credential|unauth|forbidden|locked|rate_limit|model.*mismatch|budget.*exceeded/.test(reason),received,semanticReviewRequired:true,expectedVerdictMatches:false,...(error.gatewayFailure?{gatewayFailure:error.gatewayFailure}:{})};
  await db.batch([
   db.prepare('INSERT OR IGNORE INTO dialogue_events(id,session_id,turn_id,event_type,details_json,created_at) VALUES(?,?,?,?,?,?)').bind(id+':result',sessionId,id,'synthetic_calibration_unconfirmed',JSON.stringify(details),ended),
   db.prepare("UPDATE dialogue_calls SET state='review',accounted_micros=?,usage_json=?,finished_at=? WHERE turn_id=? AND state='reserved'").bind(knownCost,received?.usage?JSON.stringify(received.usage):null,ended,id),
   db.prepare('UPDATE dialogue_sessions SET inflight=NULL WHERE id=? AND inflight=?').bind(sessionId,id),
  ]);return json({code:'calibration_unconfirmed',...await readback()},409);
 }
}
