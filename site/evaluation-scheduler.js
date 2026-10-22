import { WorkerEntrypoint } from 'cloudflare:workers';
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
export default {
  async fetch() { return new Response('Not found',{status:404}); },
  async scheduled(_event,env,ctx) {
    // The heartbeat follows the tick (so it carries this tick's scan time) and is sent even if the tick failed.
    ctx.waitUntil((async()=>{ try { await runScheduledEvaluations(env); } finally { await sendEvaluationHeartbeat(env,evaluationBacklog); } })());
  },
};
