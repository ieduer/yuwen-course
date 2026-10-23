import { WorkerEntrypoint, DurableObject } from 'cloudflare:workers';
import { drainEvaluationJobs, evaluationBacklog } from './durable-evaluation-jobs.js';
import { executeEvaluationRemotely } from './evaluation-machine.js';
import { reconcileEvidenceOutbox } from './learning-evidence-source.js';
import { evaluationHealthSnapshot, sendEvaluationHeartbeat } from './evaluation-heartbeat.js';
export class EvaluationHealth extends WorkerEntrypoint {
  async read() {
    return evaluationHealthSnapshot(this.env,evaluationBacklog);
  }
}
export async function runScheduledEvaluations(env) {
  try {
    return await drainEvaluationJobs(env,job=>executeEvaluationRemotely(env,job));
  } finally {
    // The learner can close the page after submission. Read back existing
    // central receipts even on idle ticks; never resend or create evidence.
    // Existing per-row CAS and 15-minute leases also deduplicate page drains.
    if(env.YW_BACKGROUND_EVALUATION_ENABLED==='true') {
      try {
        const result=await reconcileEvidenceOutbox(env,20);
        if(result.checked) console.info(JSON.stringify({event:'yw_evaluation_receipts',...result}));
      } catch {
        console.warn(JSON.stringify({event:'yw_evaluation_receipts',outcome:'unavailable'}));
      }
    }
  }
}
// Evaluation clock (2026-10-23, owner: fix the missing heartbeats). Over 24 h the minute cron ran 1,374 of 1,440 times
// (late or bunched dispatch, one 8-minute gap) and overlapping ticks lost beats to Pulse's as_of guard. A Durable Object
// alarm is the primary clock: one instance, ticks never overlap, the heartbeat goes first so a long or cut-off tick never
// loses its beat, and the next alarm is set for the next minute whatever happened. The minute cron is the watchdog: it
// (re)arms the alarm and runs the tick itself only when the clock cannot be reached or is overdue. The jobs themselves
// keep their per-row CAS and 15-minute leases, so a tick run by both paths does no work twice.
// Kill switch: YW_EVALUATION_CLOCK other than "on" -> the alarm does nothing and the cron runs every tick as before.
// Module-private: every named export of a Worker's main module must be a handler, class or function (workerd).
const CLOCK_NAME='yw-evaluation-clock',CLOCK_PERIOD_MS=60000,CLOCK_OVERDUE_MS=150000;
const nextClockAt=(now)=>Math.floor(now/CLOCK_PERIOD_MS)*CLOCK_PERIOD_MS+CLOCK_PERIOD_MS+1000;
const clockOn=(env)=>env.YW_EVALUATION_CLOCK==='on'&&typeof env.EVALUATION_CLOCK?.idFromName==='function';
export async function evaluationTick(env){
  await sendEvaluationHeartbeat(env,evaluationBacklog);
  await runScheduledEvaluations(env);
}
export class EvaluationClock extends DurableObject {
  async alarm() {
    if(this.env.YW_EVALUATION_CLOCK!=='on') return;
    const started=Date.now();
    try { await evaluationTick(this.env); }
    catch { console.warn(JSON.stringify({event:'yw_evaluation_clock',outcome:'tick_failed'})); }
    finally {
      await this.ctx.storage.put('lastTickAt',started);
      await this.ctx.storage.setAlarm(nextClockAt(Date.now()));
    }
  }
  async ensure() {
    const now=Date.now(),[alarm,last]=await Promise.all([this.ctx.storage.getAlarm(),this.ctx.storage.get('lastTickAt')]);
    const lastTickAt=Number.isFinite(last)?last:null;
    if(alarm===null) await this.ctx.storage.setAlarm(nextClockAt(now));
    const overdue=lastTickAt===null||now-lastTickAt>CLOCK_OVERDUE_MS||(alarm!==null&&now-alarm>CLOCK_OVERDUE_MS);
    return {armed:alarm!==null,overdue,lastTickAt};
  }
}
export async function watchdogTick(env){
  let state=null;
  try { state=await env.EVALUATION_CLOCK.get(env.EVALUATION_CLOCK.idFromName(CLOCK_NAME)).ensure(); } catch { state=null; }
  if(state&&!state.overdue) return {ran:false,state};
  console.warn(JSON.stringify({event:'yw_evaluation_clock',outcome:state?'overdue':'unreachable'}));
  await evaluationTick(env);
  return {ran:true,state};
}
export default {
  async fetch() { return new Response('Not found',{status:404}); },
  async scheduled(_event,env,ctx) {
    if(clockOn(env)) { ctx.waitUntil(watchdogTick(env)); return; }
    // Clock off: the heartbeat follows the tick (so it carries this tick's scan time) and is sent even if the tick failed.
    ctx.waitUntil((async()=>{ try { await runScheduledEvaluations(env); } finally { await sendEvaluationHeartbeat(env,evaluationBacklog); } })());
  },
};
