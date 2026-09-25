import { runDurableEvaluationScheduler } from './_worker.js';
export default {
  async fetch() { return new Response('Not found',{status:404}); },
  async scheduled(_event,env,ctx) {
    ctx.waitUntil(runDurableEvaluationScheduler(env));
  },
};
