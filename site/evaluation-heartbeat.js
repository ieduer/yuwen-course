// Scheduler heartbeat to Pulse (2026-10-22). Pulse used to pull EvaluationHealth at probe time; that cross-Worker
// read was dispatched 13-29 s late (or not within 30 s) on about one probe in ten while this cron ran normally.
// The cron now pushes the same aggregate after each tick. Never student data; a failed push is only logged.
export async function evaluationHealthSnapshot(env, backlog) {
  const health=await backlog(env.READING_DB);
  const scheduler=await env.READING_DB.prepare('SELECT last_scan_at FROM learning_evaluation_scheduler WHERE id=1').first();
  return {schema:'yw-evaluation-health-v1',version:1,asOf:new Date().toISOString(),
    backgroundEnabled:env.YW_BACKGROUND_EVALUATION_ENABLED==='true',pendingCount:health.pending_count,
    oldestPendingAgeSeconds:health.oldest_pending_age_seconds,
    lastSuccessfulScanAt:scheduler?.last_scan_at?new Date(scheduler.last_scan_at).toISOString():null};
}
export const HEARTBEAT_TIMEOUT_MS=20000;
export async function sendEvaluationHeartbeat(env,backlog,{timeoutMs=HEARTBEAT_TIMEOUT_MS,log=console.warn}={}) {
  if(typeof env.PULSE_HEARTBEAT?.record!=='function') return {sent:false,reason:'not_configured'};
  let timer;
  try {
    const snapshot=await evaluationHealthSnapshot(env,backlog);
    await Promise.race([env.PULSE_HEARTBEAT.record(snapshot),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('heartbeat_timeout')),timeoutMs);})]);
    return {sent:true};
  } catch(error) {
    const reason=error?.message==='heartbeat_timeout'?'timeout':'unavailable';
    log(JSON.stringify({event:'yw_evaluation_heartbeat',outcome:reason}));
    return {sent:false,reason};
  } finally { clearTimeout(timer); }
}
