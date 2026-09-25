// Local Miniflare only. This test entrypoint is never staged or deployed.
import { runDurableEvaluationScheduler } from '../../site/_worker.js';
export default { async fetch(_request,env) {
  return Response.json(await runDurableEvaluationScheduler(env));
}};
