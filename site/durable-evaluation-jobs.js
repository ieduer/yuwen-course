// All content belongs only in the authenticated source database, never logs.
import { sourceEventStatement, evaluationEventId, evaluationEventBase,
  latestSourceEvent, replyAssessment } from './learning-evaluation-events.js';
import { extractJsonObject, normalizeOpenStudyGuideAssessment } from './study-guide-assessment.js';
export const JOB_POLICY = Object.freeze({ maxCalls: 4, leaseMs: 90_000, maxJobsPerTick: 2 });
export class EvaluationPending extends Error {
  constructor(job) { super('答案已保存，評閱稍後補上'); this.code='learning_evaluation_pending'; this.job=job; }
}
export function pendingEvaluationResponse(job) {
  return Response.json({ ok:false, status:'pending', code:'learning_evaluation_pending',
    pendingId:job.source_event_id, pendingState:job.state, saved:true, assessment:null,
    error:['blocked','uncertain'].includes(job.state)?'答案已保存，評閱需要處理；無需重新提交。':'答案已保存，評閱稍後補上', retryAfterSeconds:60 },
  {status:202,headers:{'Cache-Control':'private, no-store','Retry-After':'60'}});
}
export async function loadEvaluationJob(db,id) {
  return db.prepare('SELECT * FROM learning_evaluation_jobs WHERE source_event_id=?').bind(id).first();
}
export async function createEvaluationJob(db,reservation,snapshot,now=Date.now()) {
  // The pending submission is already durable. Insert and readback precede 202.
  const existing=await loadEvaluationJob(db,reservation.sourceEventId);
  if(existing) return existing;
  const insert=db.prepare(`INSERT OR IGNORE INTO learning_evaluation_jobs
    (source_event_id,student_id,resource_key,snapshot_json,state,first_pending_at,next_attempt_at)
    SELECT source_event_id,student_id,resource_key,?,'queued',?,?
    FROM learning_pending_submissions WHERE source_event_id=? AND student_id=? AND status!='completed'`)
    .bind(JSON.stringify(snapshot),now,now,reservation.sourceEventId,reservation.studentId);
  const base=evaluationEventBase({source_event_id:reservation.sourceEventId,student_id:reservation.studentId,
    resource_key:reservation.resourceKey,snapshot_json:JSON.stringify(snapshot)});
  await db.batch([insert,await sourceEventStatement(db,base,{action:'evaluation.pending',kind:'pending',
    parentId:await evaluationEventId(reservation.sourceEventId,'submit'),at:new Date(now).toISOString(),
    sourceContext:{jobState:'queued',reason:'awaiting_evaluation'}})]);
  const job=await loadEvaluationJob(db,reservation.sourceEventId);
  if(!job) throw new Error('durable evaluation capture unavailable');
  return job;
}
export async function claimEvaluationJob(db,id,now=Date.now()) {
  // Never reclaim an ambiguous in-flight call automatically. Journal recovery
  // after an expired lease is handled separately, without another model call.
  const updated=await db.prepare(`UPDATE learning_evaluation_jobs SET state='leased',
    lease_epoch=lease_epoch+1,lease_until=? WHERE source_event_id=? AND state='queued'
    AND next_attempt_at<=? AND NOT EXISTS (
      SELECT 1 FROM learning_evaluation_jobs prior WHERE prior.student_id=learning_evaluation_jobs.student_id
      AND prior.resource_key=learning_evaluation_jobs.resource_key AND prior.state!='completed'
      AND (prior.first_pending_at<learning_evaluation_jobs.first_pending_at OR
       (prior.first_pending_at=learning_evaluation_jobs.first_pending_at AND prior.source_event_id<learning_evaluation_jobs.source_event_id)))`)
    .bind(now+JOB_POLICY.leaseMs,id,now).run();
  return Number(updated?.meta?.changes)===1 ? loadEvaluationJob(db,id) : null;
}
export async function saveEvaluationReply(db,job,result,now=Date.now()) {
  // Preserve late replies too. A stale owner may journal, but cannot score.
  const prior=await db.prepare('SELECT * FROM learning_evaluation_replies WHERE source_event_id=? AND lease_epoch=?')
    .bind(job.source_event_id,job.lease_epoch).first();
  if(prior) {
    if(prior.answer_text!==result.answer || prior.raw_response_json!==(result.rawResponseJson||null))
      throw new Error('AI reply journal conflict');
    now=prior.received_at;
  }
  const request=await latestSourceEvent(db,job.source_event_id,'ai.request',job.lease_epoch);
  const requestContext=request?JSON.parse(request.payload_json).context.sourceContext:{};
  // The irreplaceable provider reply wins over the secondary event projection:
  // persist it first, then recover a failed projection locally from this row.
  if(!prior) await db.prepare(`INSERT OR IGNORE INTO learning_evaluation_replies
    (source_event_id,lease_epoch,request_id,answer_text,actual_model,model_version,version_status,received_at,raw_response_json)
    VALUES(?,?,?,?,?,?,?,?,?)`).bind(job.source_event_id,job.lease_epoch,result.requestId||'',
      result.answer,result.actualModel||null,result.modelVersion||null,
      result.modelVersion?'reported':'unavailable',now,result.rawResponseJson||null).run();
  const saved=await db.prepare(`SELECT * FROM learning_evaluation_replies WHERE source_event_id=? AND lease_epoch=?`)
    .bind(job.source_event_id,job.lease_epoch).first();
  if(!saved || saved.answer_text!==result.answer || saved.raw_response_json!==(result.rawResponseJson||null)
    || saved.actual_model!==(result.actualModel||null) || saved.model_version!==(result.modelVersion||null))
    throw new Error('AI reply journal readback failed');
  await (await sourceEventStatement(db,evaluationEventBase(job),{action:'assistant.reply',kind:'reply',key:job.lease_epoch,
      parentId:request?.event_id || '',actor:'assistant',status:'succeeded',at:new Date(now).toISOString(),
      content:{text:result.answer,rawResponseJson:result.rawResponseJson||null},
      sourceContext:{...requestContext,leaseEpoch:job.lease_epoch,requestId:result.requestId||null,
        originatingRequestId:requestContext.requestId||null},
      assessment:replyAssessment({actual_model:result.actualModel,model_version:result.modelVersion})})).run();
  return saved;
}
export async function latestEvaluationReply(db,id) {
  return db.prepare('SELECT * FROM learning_evaluation_replies WHERE source_event_id=? ORDER BY id DESC LIMIT 1').bind(id).first();
}
// A saved reply that fails the foreground scoring contract can never commit.
// It stays in the journal as a source record, but a later lease asks the model
// again instead of reusing it (2026-09-26: a split APIS answer saved as "{").
export function usableEvaluationReply(reply) {
  if(!reply) return false;
  try { normalizeOpenStudyGuideAssessment(extractJsonObject(reply.answer_text)); return true; }
  catch { return false; }
}
export async function latestUsableEvaluationReply(db,id) {
  const rows=await db.prepare('SELECT * FROM learning_evaluation_replies WHERE source_event_id=? ORDER BY id DESC').bind(id).all();
  return (rows.results || []).find(usableEvaluationReply) || null;
}
export async function deferEvaluationJob(db,job,error,now=Date.now()) {
  const current=await loadEvaluationJob(db,job.source_event_id);
  if(!current || current.lease_epoch!==job.lease_epoch || current.state!=='leased') return current;
  const calls=await db.prepare('SELECT COUNT(*) AS n FROM learning_evaluator_calls WHERE source_event_id=?').bind(job.source_event_id).first();
  const reply=await latestUsableEvaluationReply(db,job.source_event_id);
  // An invalid assessment is retried with a new call while the lifetime call
  // budget remains; its reply stays preserved and linked.
  const invalidReply=error?.code==='invalid_ai_assessment';
  const invalidSaved=invalidReply?await db.prepare('SELECT lease_epoch FROM learning_evaluation_replies WHERE source_event_id=? AND lease_epoch=?')
    .bind(job.source_event_id,job.lease_epoch).first():null;
  const temporary=error?.apisStatus===429 || (error?.apisStatus===503
    && ['DEADLINE_EXCEEDED','UPSTREAM_UNAVAILABLE'].includes(error?.apisCode))
    || error?.code==='learning_evaluator_budget_exhausted';
  const ambiguous=error?.name==='AbortError' || error?.name==='TypeError';
  const state=reply ? 'queued' : Number(calls?.n)>=JOB_POLICY.maxCalls ? 'blocked'
    : temporary || invalidReply ? 'queued' : ambiguous ? 'uncertain' : 'blocked';
  const delay=[60_000,300_000,900_000][Math.min(2,Math.max(0,Number(calls?.n)-1))];
  const jitter=Array.from(job.source_event_id+':'+job.lease_epoch).reduce((n,c)=>(n*31+c.charCodeAt(0))%10001,0);
  const reason=reply?'reply_saved':invalidReply?'invalid_reply':state==='blocked'?'automatic_limit_or_permanent_failure'
    :state==='uncertain'?'transport_unknown':'temporary_unavailable';
  const nextAt=now+Math.max(delay,Math.max(0,Number(error?.retryAfterSeconds)||0)*1000)+jitter;
  const statements=[db.prepare(`UPDATE learning_evaluation_jobs SET state=?,next_attempt_at=?,lease_until=0,last_error_class=?
    WHERE source_event_id=? AND state='leased' AND lease_epoch=?`)
    .bind(state,nextAt,reason,job.source_event_id,job.lease_epoch)];
  const request=await latestSourceEvent(db,job.source_event_id,'ai.request',job.lease_epoch);
  const base=evaluationEventBase(job),at=new Date(now).toISOString();
  const requestContext=request?JSON.parse(request.payload_json).context.sourceContext:{};
  const failureKind=reply?'evaluation_failure':'failure';
  const failureId=await evaluationEventId(job.source_event_id,failureKind,job.lease_epoch);
  // Re-entry after a failed downstream step must not rewrite the first failure.
  const prior=await db.prepare('SELECT event_id FROM learning_evaluation_events WHERE event_id=?').bind(failureId).first();
  if(!prior) {
    const classification=error?.code==='invalid_ai_assessment'?'invalid_ai_assessment'
      :reply?'local_commit_failure':ambiguous?'transport_unknown'
      :error?.code==='learning_evaluator_budget_exhausted'?'local_budget_exhausted'
      :Number.isInteger(error?.apisStatus)?'apis_http_failure':'local_execution_failure';
    statements.push(await sourceEventStatement(db,base,{action:reply?(state==='blocked'?'evaluation.blocked':'evaluation.pending'):'ai.failure',
      kind:failureKind,key:job.lease_epoch,parentId:reply
        ?await evaluationEventId(job.source_event_id,'reply',reply.lease_epoch)
        :invalidSaved?await evaluationEventId(job.source_event_id,'reply',invalidSaved.lease_epoch)
        :request?.event_id||await evaluationEventId(job.source_event_id,'pending'),
      status:reply&&state==='queued'?'pending':ambiguous?'partial':'failed',at,sourceContext:{...requestContext,leaseEpoch:job.lease_epoch,
        jobState:state,reason:classification,httpStatus:Number.isInteger(error?.apisStatus)?error.apisStatus:null,
        errorCode:['DEADLINE_EXCEEDED','UPSTREAM_UNAVAILABLE','NON_RETRYABLE'].includes(error?.apisCode)?error.apisCode:null,
        retryAfterSeconds:Number.isFinite(error?.retryAfterSeconds)?error.retryAfterSeconds:null}}));
    if(state==='queued') statements.push(await sourceEventStatement(db,base,{action:'ai.retry',kind:'retry',key:job.lease_epoch,
      parentId:failureId,at,sourceContext:{jobState:state,retryKind:'automatic',leaseEpoch:job.lease_epoch,
        nextAttemptAt:new Date(nextAt).toISOString(),executionKind:reply?'local_commit_only':'apis_call'}}));
  }
  await db.batch(statements);
  return loadEvaluationJob(db,job.source_event_id);
}
export async function evaluationBacklog(db,now=Date.now()) {
  const r=await db.prepare(`SELECT COUNT(*) AS pending_count,MIN(first_pending_at) AS oldest,
    SUM(state='blocked') AS blocked_count,SUM(state='uncertain') AS uncertain_count,
    SUM(first_pending_at<?) AS over_5m,SUM(first_pending_at<?) AS over_15m,SUM(first_pending_at<?) AS over_60m
    FROM learning_evaluation_jobs WHERE state!='completed'`).bind(now-300000,now-900000,now-3600000).first();
  const scheduler=await db.prepare('SELECT last_scan_at FROM learning_evaluation_scheduler WHERE id=1').first();
  const age=r?.oldest==null?0:Math.max(0,Math.floor((now-r.oldest)/1000));
  const stale=Number(r?.pending_count)>0 && (!scheduler?.last_scan_at || now-scheduler.last_scan_at>180000);
  return {event:'yw_evaluation_backlog',pending_count:Number(r?.pending_count||0),
    oldest_pending_age_seconds:age,blocked_count:Number(r?.blocked_count||0),uncertain_count:Number(r?.uncertain_count||0),
    over_5m:Number(r?.over_5m||0),over_15m:Number(r?.over_15m||0),over_60m:Number(r?.over_60m||0),
    scheduler_stale:stale,severity:age>900||stale||r?.blocked_count||r?.uncertain_count?'critical':age>300?'warning':'ok'};
}
// Reuse the existing content-free Pulse RPC contract. No new notification
// transport or user context is passed to the shared service.
export async function reportEvaluationBacklog(env,health,now=Date.now()) {
  if(env.YW_EVALUATION_ALERTS_ENABLED!=='true') return {disabled:true};
  if(typeof env.PULSE_ALERTS?.report!=='function') throw new Error('evaluation alert binding unavailable');
  const state=health.severity==='ok'?'recovered':'failure';
  const checkpoint=await env.READING_DB.prepare('SELECT * FROM learning_evaluation_alert_state WHERE id=1').first();
  const marker=state+':'+health.severity;
  if(state==='recovered' && (!checkpoint?.last_state || checkpoint.last_state===marker)) return {unchanged:true};
  if(checkpoint?.last_state===marker && now-checkpoint.last_reported_at<900000) return {unchanged:true};
  const errorCode=state==='recovered'?'YW_EVALUATION_RECOVERED'
    :health.scheduler_stale?'YW_EVALUATION_SCHEDULER_STALE'
    :health.blocked_count||health.uncertain_count?'YW_EVALUATION_NEEDS_RECONCILIATION'
    :health.oldest_pending_age_seconds>900?'YW_EVALUATION_BACKLOG_OVER_15M':'YW_EVALUATION_BACKLOG_OVER_5M';
  const result=await env.PULSE_ALERTS.report({siteKey:'yw',host:'yw.bdfz.net',
    surface:'evaluation',fingerprintKey:'pending_backlog',state,
    severity:health.severity==='critical'?'critical':'warning',errorCode,
    occurredAt:new Date(now).toISOString(),source:'yw_evaluation_jobs',
    details:{occurrenceCount:health.pending_count}});
  if(result?.accepted!==true && !(state==='recovered' && result?.delivery==='ignored_healthy')) {
    throw new Error('evaluation alert receipt unavailable');
  }
  await env.READING_DB.prepare('UPDATE learning_evaluation_alert_state SET last_state=?,last_reported_at=? WHERE id=1')
    .bind(marker,now).run();
  return {accepted:true};
}
export async function drainEvaluationJobs(env,execute,now=Date.now()) {
  const db=env.READING_DB,owner=crypto.randomUUID();
  if(env.YW_BACKGROUND_EVALUATION_ENABLED!=='true') return {disabled:true};
  const lock=await db.prepare(`UPDATE learning_evaluation_scheduler SET owner=?,lease_until=?
    WHERE id=1 AND lease_until<=?`).bind(owner,now+240000,now).run();
  if(Number(lock?.meta?.changes)!==1) return {busy:true};
  let completed=0;
  try {
    // Preserve recovery decisions too; never pretend an expired lease proves
    // that its outbound request did not execute.
    const recovering=await db.prepare(`SELECT * FROM learning_evaluation_jobs WHERE
      (state='leased' AND lease_until<?) OR (state='uncertain' AND EXISTS
        (SELECT 1 FROM learning_evaluation_replies r WHERE r.source_event_id=learning_evaluation_jobs.source_event_id))
      ORDER BY first_pending_at LIMIT ${JOB_POLICY.maxJobsPerTick}`).bind(now).all();
    for(const job of recovering.results || []) {
      const reply=await latestEvaluationReply(db,job.source_event_id);
      const request=await latestSourceEvent(db,job.source_event_id,'ai.request',job.lease_epoch);
      const state=reply?'queued':'uncertain',at=new Date(now).toISOString();
      const statement=await sourceEventStatement(db,evaluationEventBase(job),{
        action:reply?'ai.retry':'ai.failure',kind:reply?'recover_reply':'expired',key:job.lease_epoch,
        parentId:reply?await evaluationEventId(job.source_event_id,'reply',reply.lease_epoch):request?.event_id || '',
        status:reply?'pending':'partial',at,
        sourceContext:{leaseEpoch:job.lease_epoch,jobState:state,reason:'expired_execution',
          retryKind:reply?'automatic':null,executionKind:reply?'local_commit_only':'transport_unknown'}});
      await db.batch([db.prepare(`UPDATE learning_evaluation_jobs SET state=?,last_error_class='expired_execution'
        WHERE source_event_id=? AND lease_epoch=? AND state=?`).bind(state,job.source_event_id,job.lease_epoch,job.state),statement]);
    }

    // Reconciliation: before invalid replies became retryable, an invalid
    // assessment blocked its job with the reply saved (the only way to reach
    // blocked + reply_saved). Requeue such a job once while its lifetime call
    // budget remains; the invalid reply stays in the journal, is never reused,
    // and the planned retry is recorded like any other.
    const reconcilable=await db.prepare(`SELECT * FROM learning_evaluation_jobs WHERE state='blocked'
      AND last_error_class='reply_saved' ORDER BY first_pending_at LIMIT ${JOB_POLICY.maxJobsPerTick}`).all();
    for(const job of reconcilable.results || []) {
      if(await latestUsableEvaluationReply(db,job.source_event_id)) continue;
      const calls=await db.prepare('SELECT COUNT(*) AS n FROM learning_evaluator_calls WHERE source_event_id=?').bind(job.source_event_id).first();
      if(Number(calls?.n)>=JOB_POLICY.maxCalls) continue;
      const blocked=await latestSourceEvent(db,job.source_event_id,'evaluation.blocked',job.lease_epoch);
      const invalid=await latestEvaluationReply(db,job.source_event_id);
      const at=new Date(now).toISOString();
      const statement=await sourceEventStatement(db,evaluationEventBase(job),{action:'ai.retry',kind:'retry',
        key:'reconcile-'+job.lease_epoch,at,parentId:blocked?.event_id
          || (invalid?await evaluationEventId(job.source_event_id,'reply',invalid.lease_epoch):''),
        sourceContext:{leaseEpoch:job.lease_epoch,jobState:'queued',reason:'invalid_reply',retryKind:'reconciliation',
          nextAttemptAt:at,executionKind:'apis_call'}});
      await db.batch([db.prepare(`UPDATE learning_evaluation_jobs SET state='queued',next_attempt_at=?,last_error_class='invalid_reply'
        WHERE source_event_id=? AND lease_epoch=? AND state='blocked' AND last_error_class='reply_saved'`)
        .bind(now,job.source_event_id,job.lease_epoch),statement]);
    }

    for(let i=0;i<JOB_POLICY.maxJobsPerTick;i++) {
      const row=await db.prepare(`SELECT j.source_event_id FROM learning_evaluation_jobs j
        WHERE state='queued' AND next_attempt_at<=? AND NOT EXISTS (
          SELECT 1 FROM learning_evaluation_jobs prior WHERE prior.student_id=j.student_id
          AND prior.resource_key=j.resource_key AND prior.state!='completed'
          AND (prior.first_pending_at<j.first_pending_at OR
            (prior.first_pending_at=j.first_pending_at AND prior.source_event_id<j.source_event_id))) ORDER BY
        (student_id=(SELECT last_student_id FROM learning_evaluation_scheduler WHERE id=1)),first_pending_at LIMIT 1`).bind(Date.now()).first();
      if(!row) break;
      const job=await claimEvaluationJob(db,row.source_event_id);
      if(!job) break;
      try { const result=await execute(job);if(result?.status!=='pending') completed++; }
      catch(error) { await deferEvaluationJob(db,job,error); }
      await db.prepare('UPDATE learning_evaluation_scheduler SET last_student_id=? WHERE id=1 AND owner=?')
        .bind(job.student_id,owner).run();
    }
    await db.prepare('UPDATE learning_evaluation_scheduler SET last_scan_at=? WHERE id=1 AND owner=?')
      .bind(Date.now(),owner).run();
    const health=await evaluationBacklog(db);
    const emit=health.severity==='critical'?console.error:health.severity==='warning'?console.warn:console.info;
    emit(JSON.stringify(health));
    await reportEvaluationBacklog(env,health);
    return {completed};
  } finally {
    await db.prepare('UPDATE learning_evaluation_scheduler SET lease_until=0 WHERE id=1 AND owner=?').bind(owner).run();
  }
}
