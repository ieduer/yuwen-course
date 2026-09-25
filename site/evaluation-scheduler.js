import { WorkerEntrypoint } from 'cloudflare:workers';
import { drainEvaluationJobs, evaluationBacklog } from './durable-evaluation-jobs.js';
import { executeEvaluationRemotely } from './evaluation-machine.js';
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
export function runScheduledEvaluations(env) {
  return drainEvaluationJobs(env,job=>executeEvaluationRemotely(env,job));
}
export default {
  async fetch() { return new Response('Not found',{status:404}); },
  async scheduled(_event,env,ctx) {
    ctx.waitUntil(runScheduledEvaluations(env));
  },
};
