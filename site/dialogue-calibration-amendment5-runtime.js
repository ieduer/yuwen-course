// Owner-only synthetic execution. The default has paid authority but no active
// deployment pin. Request JSON can never provide activation or terminal proof.
import packet from './dialogue-calibration-amendment5-packet.json' with {type:'json'};
import {AMENDMENT5_CONTRACT as contract} from './dialogue-calibration-amendment5-contract.js';
import {amendment5Admission,amendment5CaseSourceReadiness} from './dialogue-calibration-amendment5.js';
import {acceptanceContext} from './dialogue-acceptance.js';
import {dialogueBudget,reconciledCost} from './dialogue-budget.js';
import {POLICY_VERSION,LIMITS,validateProposal} from './dialogue-policy.js';
const OP=contract.operation,prefix=OP+':',base='yw-dialogue-real-calibration-20261012-v1';
const historyIds=["yw-dialogue-real-calibration-20261012-v1-amendment-1:language-er-independent", "yw-dialogue-real-calibration-20261012-v1-amendment-2:attempt-1", "yw-dialogue-real-calibration-20261012-v1-amendment-2:attempt-2", "yw-dialogue-real-calibration-20261012-v1-amendment-3:attempt-1", "yw-dialogue-real-calibration-20261012-v1-amendment-3:attempt-2", "yw-dialogue-real-calibration-20261012-v1-amendment-3:attempt-3", "yw-dialogue-real-calibration-20261012-v1-amendment-4:grammar-one-independent:1", "yw-dialogue-real-calibration-20261012-v1-amendment-4:grammar-water-independent:1", "yw-dialogue-real-calibration-20261012-v1-amendment-4:grammar-water-misconception:1", "yw-dialogue-real-calibration-20261012-v1-amendment-4:language-er-misconception:1", "yw-dialogue-real-calibration-20261012-v1-amendment-4:language-yu-independent:1", "yw-dialogue-real-calibration-20261012-v1-amendment-4:language-yu-misconception:1", "yw-dialogue-real-calibration-20261012-v1:language-er-independent"];
const sha=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(x=>x.toString(16).padStart(2,'0')).join('');
const json=(value,status=200)=>Response.json(value,{status,headers:{'cache-control':'private, no-store'}});
const all=async stmt=>(await stmt.all()).results||[];
const fullSql=`SELECT c.*,s.student_id AS session_owner,s.curriculum_json,e.details_json,
 (SELECT COUNT(*) FROM dialogue_stream_chunks k WHERE k.turn_id=c.turn_id) chunk_count,
 (SELECT COALESCE(SUM(LENGTH(content)),0) FROM dialogue_stream_chunks k WHERE k.turn_id=c.turn_id) partial_chars
 FROM dialogue_calls c JOIN dialogue_sessions s ON s.id=c.session_id LEFT JOIN dialogue_events e ON e.id=c.turn_id||':result'`;
const receipt=async row=>sha(JSON.stringify({id:row.turn_id,state:row.state,reserved:row.reserved_micros,accounted:row.accounted_micros,created:row.created_at,finished:row.finished_at,source:row.curriculum_json,result:row.details_json}));
const safeParse=value=>{try{return JSON.parse(value||'null');}catch{return null;}};

async function snapshot(db,student,id){
 const allRows=await all(db.prepare(fullSql+' WHERE substr(c.turn_id,1,?)=? ORDER BY c.turn_id').bind(base.length,base));
 if(allRows.some(r=>r.student_id!==student.id||r.session_owner!==student.id))throw Error('calibration_owner_mismatch');
 const historical=allRows.filter(r=>historyIds.includes(r.turn_id)),current=allRows.filter(r=>r.turn_id.startsWith(prefix));
 const pins=await Promise.all(historical.map(async r=>({attemptId:r.turn_id,receiptDigest:await receipt(r)})));
 const history={attempts:historical.length,reservedMicros:historical.reduce((n,r)=>n+r.reserved_micros,0),knownMicros:historical.reduce((n,r)=>n+(r.accounted_micros??0),0),unknownReservedMicros:historical.reduce((n,r)=>n+(r.accounted_micros===null?r.reserved_micros:0),0),allReceiptsReconciled:historical.length===contract.priorAttempts&&historyIds.every(x=>historical.some(r=>r.turn_id===x&&['finished','review'].includes(r.state)&&r.finished_at)),receiptSetDigest:await sha(JSON.stringify(pins))};
 const rows=await Promise.all(current.map(async r=>{const meta=safeParse(r.curriculum_json),result=safeParse(r.details_json);return {caseId:meta?.caseId,attemptId:r.turn_id,receiptDigest:await receipt(r),state:r.state,reservedMicros:r.reserved_micros,accountedMicros:r.accounted_micros,createdAt:r.created_at,finishedAt:r.finished_at,chunkCount:r.chunk_count,partialChars:r.partial_chars,finalAssessment:!!(result?.value||result?.received?.value),boundaryStop:result?.boundaryStop===true,model:result?.model||result?.received?.model};}));
 const day=new Date().toISOString().slice(0,10);
 const capacity=await db.prepare(`SELECT COUNT(*) globalDayCalls,COALESCE(SUM(COALESCE(accounted_micros,reserved_micros)),0) globalDayConservativeMicros,
 (SELECT COUNT(*) FROM dialogue_calls WHERE student_id=? AND day=?) userDayCalls,
 (SELECT COALESCE(SUM(COALESCE(accounted_micros,reserved_micros)),0) FROM dialogue_calls WHERE student_id=? AND day=?) userDayConservativeMicros,
 (SELECT COUNT(*) FROM dialogue_calls WHERE state IN ('reserved','finishing')) reservedConcurrentCalls FROM dialogue_calls WHERE day=?`).bind(student.id,day,student.id,day,day).first();
 const row=current.find(r=>r.turn_id===id),chunks=row?await all(db.prepare('SELECT sequence,content FROM dialogue_stream_chunks WHERE turn_id=? ORDER BY sequence').bind(id)):[];
 return {history,rows,capacity,call:row?{state:row.state,reserved_micros:row.reserved_micros,accounted_micros:row.accounted_micros,usage_json:row.usage_json,created_at:row.created_at,finished_at:row.finished_at}:null,receiptDigest:row?await receipt(row):null,result:row?safeParse(row.details_json):null,chunks};
}

function activated(env){
 const pin=safeParse(env.YW_CALIBRATION_AMENDMENT5_JSON);
 if(!pin||pin.enabled!==true||pin.operation!==OP||pin.packetDigest!==contract.packetDigest||pin.authorityDigest!==contract.authorityDigest||pin.maxProviderAttempts!==1||!/^[a-f0-9]{64}$/.test(pin.singleProviderAttemptReceiptDigest||'')||pin.hardExpiry!==contract.hardExpiry)return null;
 return {...contract,status:'approved',active:true,approvalDigest:contract.authorityDigest,registryReceiptDigest:pin.registryReceiptDigest,priorReceiptSetDigest:pin.priorReceiptSetDigest,readyAt:pin.readyAt,recoveryReadbacks:pin.recoveryReadbacks||[]};
}

export async function handleAmendment5Calibration(request,env,student,callModel){
 const context=acceptanceContext(env),url=new URL(request.url);
 if(!context||Number(student.ucUserId)!==context.userId||Date.now()>=Math.min(context.expires,Date.parse(contract.hardExpiry)))return json({code:'not_found'},404);
 if(packet.operation!==OP||packet.sourceDigest!==contract.packetDigest||packet.cases.length!==28)return json({code:'calibration_packet_invalid'},503);
 const c=packet.cases.find(c=>c.id===url.searchParams.get('calibration')),attempt=Number(url.searchParams.get('attempt')||1);
 if(!c||c.lessonId!==url.searchParams.get('lessonId')||![1,2].includes(attempt))return json({code:'calibration_case_invalid'},400);
 const id=prefix+c.id+':'+attempt,sessionId=id+':session',db=env.READING_DB,ownerRef=await sha(`dialogue-owner:${student.id}`);
 let state;try{state=await snapshot(db,student,id);}catch{return json({code:'calibration_owner_mismatch'},409);}
 const readback=async()=>({operation:OP,caseId:c.id,attempt,attemptId:id,ownerRef,packetDigest:contract.packetDigest,sourceDigest:c.sourceDigest,promptDigest:c.promptDigest,hardExpiry:contract.hardExpiry,sourceReadiness:amendment5CaseSourceReadiness(c),...await snapshot(db,student,id),syntheticOnly:true});
 if(request.method==='GET')return json(await readback());
 if(request.method!=='POST'||request.headers.get('origin')!==context.origin)return json({code:'web_origin_required'},403);
 const raw=await request.text();if(raw.length>900)return json({code:'calibration_input_invalid'},400);
 const body=safeParse(raw),keys=attempt===1?'action,ownerRef':'action,ownerRef,previousReceipt,recoveryOf';
 if(!body||Object.keys(body).sort().join(',')!==keys||body.action!==contract.action||body.ownerRef!==ownerRef)return json({code:'calibration_input_invalid'},400);
 if(state.call)return json(await readback(),state.call.state==='finished'?200:409);
 const authority=activated(env);if(!authority)return json({code:'amendment5_activation_required',paidCallsAuthorized:true,packetDigest:contract.packetDigest},409);
 if(attempt===2&&!state.rows.some(r=>r.attemptId===body.recoveryOf&&r.caseId===c.id&&r.receiptDigest===body.previousReceipt))return json({code:'amendment5_same_case_receipt_required'},409);
 const admission=amendment5Admission({packet,rows:state.rows,history:state.history,capacity:state.capacity,caseId:c.id,recoveryOf:body.recoveryOf||null,readbacks:authority.recoveryReadbacks,authority});
 if(!admission.allowed||admission.attempt!==attempt)return json(admission.allowed?{code:'amendment5_case_attempt_invalid'}:admission,409);
 const source=await env.ASSETS.fetch(new Request(context.origin+`/dialogue-curriculum/${c.lessonId}.json`));
 if(!source.ok||await sha(JSON.stringify(await source.json()))!==c.sourceDigest||await sha(JSON.stringify(c.prompt))!==c.promptDigest)return json({code:'calibration_source_mismatch'},409);
 let budget;try{budget=dialogueBudget(env);}catch{return json({code:'budget_policy_required'},503);}
 if(budget.model!==contract.model||budget.reserveMicros!==84000)return json({code:'calibration_budget_mismatch'},503);
 // The ordinary acceptance route may permit three attempts; calibration never
 // inherits that setting or a caller-supplied attempt count from its price policy.
 budget={...budget,providerAttemptLimit:1,logicalProviderAttemptLimit:1};
 const at=new Date().toISOString(),day=at.slice(0,10),casePrefix=prefix+c.id+':';
 await db.prepare('INSERT OR IGNORE INTO dialogue_sessions(id,student_id,lesson_id,curriculum_version,curriculum_json,policy_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(sessionId,student.id,'calibration:'+c.lessonId,OP+':'+c.id+':'+attempt,JSON.stringify({syntheticOnly:true,caseId:c.id,sourceDigest:c.sourceDigest,promptDigest:c.promptDigest,packetDigest:contract.packetDigest,recoveryOf:body.recoveryOf||null}),POLICY_VERSION,at,at).run();
 const reserved=await db.batch([
  db.prepare(`UPDATE dialogue_sessions SET revision=1,inflight=?,updated_at=? WHERE id=? AND student_id=? AND revision=0
   AND (SELECT COUNT(*) FROM dialogue_calls WHERE substr(turn_id,1,?)=?)=?
   AND (SELECT COUNT(*) FROM dialogue_calls WHERE substr(turn_id,1,?)=?)=?
   AND (SELECT COUNT(*) FROM dialogue_calls WHERE substr(turn_id,1,?)=?)<?
   AND (SELECT COALESCE(SUM(reserved_micros),0) FROM dialogue_calls WHERE substr(turn_id,1,?)=?)+?<=?
   AND (SELECT COUNT(*) FROM dialogue_calls WHERE substr(turn_id,1,?)=? AND substr(turn_id,1,?)<>?)=13
   AND (SELECT COUNT(*) FROM dialogue_calls WHERE day=?)<?
   AND (SELECT COUNT(*) FROM dialogue_calls WHERE state IN ('reserved','finishing'))<?
   AND (SELECT COALESCE(SUM(COALESCE(accounted_micros,reserved_micros)),0) FROM dialogue_calls WHERE day=?)+?<=?
   AND (SELECT COALESCE(SUM(COALESCE(accounted_micros,reserved_micros)),0) FROM dialogue_calls WHERE student_id=? AND day=?)+?<=?`).bind(id,at,sessionId,student.id,prefix.length,prefix,state.rows.length,casePrefix.length,casePrefix,attempt-1,prefix.length,prefix,authority.approvedNewAttempts,prefix.length,prefix,budget.reserveMicros,authority.approvedNewReservedMicros,base.length,base,prefix.length,prefix,day,LIMITS.globalPerDay,LIMITS.concurrency,day,budget.reserveMicros,budget.globalDailyMicros,student.id,day,budget.reserveMicros,budget.userDailyMicros),
  db.prepare("INSERT OR IGNORE INTO dialogue_turns(id,session_id,mutation_id,request_hash,role,content,status,policy_version,created_at) SELECT ?,id,?,?,'student',?,'synthetic_calibration',?,? FROM dialogue_sessions WHERE id=? AND inflight=? AND revision=1").bind(id,c.id,c.promptDigest,c.studentAnswer,POLICY_VERSION,at,sessionId,id),
  db.prepare("INSERT OR IGNORE INTO dialogue_calls(turn_id,session_id,student_id,day,reserved_tokens,state,created_at,reserved_micros,budget_policy_json) SELECT ?,id,?,?,?,'reserved',?,?,? FROM dialogue_sessions WHERE id=? AND inflight=? AND revision=1").bind(id,student.id,day,LIMITS.outputTokens,at,budget.reserveMicros,JSON.stringify(budget),sessionId,id),
 ]);
 if(!reserved[0].meta.changes)return json({code:'amendment5_atomic_admission_stopped',...await readback()},409);
 let visible='',sequence=0,received=null;
 try{
  const result=received=await callModel(env,c.prompt,id,async text=>{
   if(typeof text!=='string'||!text.startsWith(visible)||text.length>LIMITS.replyChars)throw Error('invalid_visible_stream');
   if(text===visible)return;const delta=text.slice(visible.length);visible=text;
   await db.prepare('INSERT INTO dialogue_stream_chunks(turn_id,sequence,content,created_at) VALUES(?,?,?,?)').bind(id,++sequence,delta,new Date().toISOString()).run();
  },budget);
  const cost=reconciledCost(budget,result.usage);if(result.model!==contract.model)throw Error('calibration_model_mismatch');if(cost===null)throw Error('calibration_usage_missing');
  const proposal=validateProposal(result.value,{curriculum:c.curriculum,state:c.state,turns:c.turns,question:c.question,hints:c.turns.filter(t=>t.role==='teacher').map(t=>t.content)});
  const verdict=proposal.assessments.find(a=>a.objectiveId===c.objectiveId)?.outcome||'no_assessment',expected=(c.expected==='demonstrated'?verdict==='demonstrated':verdict!=='demonstrated')&&!proposal.assessments.some(a=>a.outcome==='demonstrated'&&a.objectiveId!==c.objectiveId);
  const details={value:result.value,model:result.model,modelVersion:result.modelVersion||null,usage:result.usage,firstTokenMs:result.firstTokenMs,totalDurationMs:result.totalDurationMs,firstTokenTargetMet:Number.isFinite(result.firstTokenMs)?result.firstTokenMs<=contract.firstTokenTargetMs:null,verdict,expectedVerdictMatches:expected,semanticReviewRequired:true,review:c.review,syntheticOnly:true};
  const ended=new Date().toISOString();await db.batch([
   db.prepare('INSERT INTO dialogue_events(id,session_id,turn_id,event_type,details_json,created_at) VALUES(?,?,?,?,?,?)').bind(id+':result',sessionId,id,'synthetic_calibration_result',JSON.stringify(details),ended),
   db.prepare("UPDATE dialogue_calls SET state=?,accounted_micros=?,usage_json=?,first_token_ms=?,completed_ms=?,finished_at=? WHERE turn_id=? AND state='reserved'").bind(expected?'finished':'review',cost,JSON.stringify(result.usage),result.firstTokenMs??null,result.totalDurationMs??null,ended,id),
   db.prepare('UPDATE dialogue_sessions SET inflight=NULL,updated_at=? WHERE id=? AND inflight=?').bind(ended,sessionId,id),
  ]);return json(await readback(),expected?200:409);
 }catch(error){
  const ended=new Date().toISOString(),knownCost=received?reconciledCost(budget,received.usage):null,reason=/^[a-z_]{1,80}$/.test(error.message||'')?error.message:'calibration_unconfirmed';
  const details={syntheticOnly:true,reason,boundaryStop:/credential|unauth|forbidden|locked|rate_limit|model.*mismatch/.test(reason),received,semanticReviewRequired:true,expectedVerdictMatches:false,...(error.gatewayFailure?{gatewayFailure:error.gatewayFailure}:{})};
  await db.batch([
   db.prepare('INSERT OR IGNORE INTO dialogue_events(id,session_id,turn_id,event_type,details_json,created_at) VALUES(?,?,?,?,?,?)').bind(id+':result',sessionId,id,'synthetic_calibration_unconfirmed',JSON.stringify(details),ended),
   db.prepare("UPDATE dialogue_calls SET state='review',accounted_micros=?,usage_json=?,finished_at=? WHERE turn_id=? AND state='reserved'").bind(knownCost,received?.usage?JSON.stringify(received.usage):null,ended,id),
   db.prepare('UPDATE dialogue_sessions SET inflight=NULL WHERE id=? AND inflight=?').bind(sessionId,id),
  ]);return json({code:'calibration_unconfirmed',...await readback()},409);
 }
}
