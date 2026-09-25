// All content belongs only in the authenticated source database, never logs.
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
  await db.prepare(`INSERT OR IGNORE INTO learning_evaluation_jobs
    (source_event_id,student_id,resource_key,snapshot_json,state,first_pending_at,next_attempt_at)
    SELECT source_event_id,student_id,resource_key,?,'queued',?,?
    FROM learning_pending_submissions WHERE source_event_id=? AND student_id=? AND status!='completed'`)
    .bind(JSON.stringify(snapshot),now,now,reservation.sourceEventId,reservation.studentId).run();
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
  await db.prepare(`INSERT OR IGNORE INTO learning_evaluation_replies
    (source_event_id,lease_epoch,request_id,answer_text,actual_model,model_version,version_status,received_at)
    VALUES(?,?,?,?,?,?,?,?)`).bind(job.source_event_id,job.lease_epoch,result.requestId||'',
      result.answer,result.actualModel||null,result.modelVersion||null,
      result.modelVersion?'reported':'unavailable',now).run();
  const saved=await db.prepare(`SELECT * FROM learning_evaluation_replies WHERE source_event_id=? AND lease_epoch=?`)
    .bind(job.source_event_id,job.lease_epoch).first();
  if(!saved || saved.answer_text!==result.answer) throw new Error('AI reply journal readback failed');
  return saved;
}
export async function latestEvaluationReply(db,id) {
  return db.prepare('SELECT * FROM learning_evaluation_replies WHERE source_event_id=? ORDER BY id DESC LIMIT 1').bind(id).first();
}
export async function deferEvaluationJob(db,job,error,now=Date.now()) {
  const calls=await db.prepare('SELECT COUNT(*) AS n FROM learning_evaluator_calls WHERE source_event_id=?').bind(job.source_event_id).first();
  const reply=await latestEvaluationReply(db,job.source_event_id);
  const temporary=error?.apisStatus===429 || (error?.apisStatus===503
    && ['DEADLINE_EXCEEDED','UPSTREAM_UNAVAILABLE'].includes(error?.apisCode))
    || error?.code==='learning_evaluator_budget_exhausted';
  const ambiguous=error?.name==='AbortError' || error?.name==='TypeError';
  const state=error?.code==='invalid_ai_assessment' ? 'blocked' : reply ? 'queued' : Number(calls?.n)>=JOB_POLICY.maxCalls ? 'blocked'
    : temporary ? 'queued' : ambiguous ? 'uncertain' : 'blocked';
  const delay=[60_000,300_000,900_000][Math.min(2,Math.max(0,Number(calls?.n)-1))];
  const jitter=Array.from(job.source_event_id+':'+job.lease_epoch).reduce((n,c)=>(n*31+c.charCodeAt(0))%10001,0);
  const reason=reply?'reply_saved':state==='blocked'?'automatic_limit_or_permanent_failure'
    :state==='uncertain'?'transport_unknown':'temporary_unavailable';
  await db.prepare(`UPDATE learning_evaluation_jobs SET state=?,next_attempt_at=?,lease_until=0,last_error_class=?
    WHERE source_event_id=? AND state='leased' AND lease_epoch=?`)
    .bind(state,now+Math.max(delay,Math.max(0,Number(error?.retryAfterSeconds)||0)*1000)+jitter,reason,job.source_event_id,job.lease_epoch).run();
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
    // A crashed execution with a saved reply needs only a local commit retry.
    await db.prepare(`UPDATE learning_evaluation_jobs SET state=CASE WHEN EXISTS
      (SELECT 1 FROM learning_evaluation_replies r WHERE r.source_event_id=learning_evaluation_jobs.source_event_id)
      THEN 'queued' ELSE 'uncertain' END,last_error_class='expired_execution'
      WHERE (state='leased' AND lease_until<?) OR (state='uncertain' AND EXISTS
        (SELECT 1 FROM learning_evaluation_replies r WHERE r.source_event_id=learning_evaluation_jobs.source_event_id))`).bind(now).run();
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
      try { await execute(job); completed++; }
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
