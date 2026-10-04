import { WorkerEntrypoint } from 'cloudflare:workers';
import { drainEvaluationJobs, evaluationBacklog } from './durable-evaluation-jobs.js';
import { executeEvaluationRemotely } from './evaluation-machine.js';
import { reconcileEvidenceOutbox } from './learning-evidence-source.js';
export class EvaluationHealth extends WorkerEntrypoint {
  async read() {
    const health=await evaluationBacklog(this.env.READING_DB);
    const scheduler=await this.env.READING_DB.prepare('SELECT last_scan_at FROM learning_evaluation_scheduler WHERE id=1').first();
    return {schema:'yw-evaluation-health-v1',version:1,asOf:new Date().toISOString(),
      backgroundEnabled:this.env.YW_BACKGROUND_EVALUATION_ENABLED==='true',pendingCount:health.pending_count,
      oldestPendingAgeSeconds:health.oldest_pending_age_seconds,
      lastSuccessfulScanAt:scheduler?.last_scan_at?new Date(scheduler.last_scan_at).toISOString():null};
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
    ctx.waitUntil(runScheduledEvaluations(env));
  },
};
