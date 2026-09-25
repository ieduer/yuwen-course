import { runScheduledEvaluations } from '../../site/evaluation-scheduler.js';
export { EvaluationHealth } from '../../site/evaluation-scheduler.js';
export default {async fetch(_request,env){return Response.json(await runScheduledEvaluations(env));}};
