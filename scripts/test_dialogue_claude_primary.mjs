// Claude first, free Gemini fallback (owner direction 2026-10-20): budget policy v2, stream accounting, cost and request opt-in.
import test from 'node:test';
import assert from 'node:assert/strict';
import {dialogueBudget,reconciledCost} from '../site/dialogue-budget.js';
import {validatedProviderAccounting,consumeGatewayStream} from '../site/dialogue-stream.js';
import {operatorCost,requestDialogueBudget,continuationDisposition} from '../site/dialogue-recovery.js';
import {callDialogueModel} from '../site/dialogue-source.js';
const CLAUDE='claude-sonnet-5-5',GEMINI='gemini-3.8-flash';
const policy={version:'yw-claude-primary-20261020-v1',policy:'yw-claude-primary-gemini-fallback-v1',model:GEMINI,primaryModel:CLAUDE,primaryInputMicrosPerMillion:2000000,primaryOutputMicrosPerMillion:10000000,inputMicrosPerMillion:0,outputMicrosPerMillion:0,maxInputTokens:32000,reserveMicros:88000,globalDailyMicros:20000000,userDailyMicros:2000000,lessonLifetimeMicros:4000000,currency:'USD',validUntil:'2026-11-09T22:00:00Z'};
const legacy={version:'yw-formal-free-pool-20261019-v1',currency:'USD',model:GEMINI,validUntil:'2026-11-03T02:49:50.013Z',inputMicrosPerMillion:0,outputMicrosPerMillion:0,reserveMicros:84000,globalDailyMicros:50000000,userDailyMicros:4200000,lessonLifetimeMicros:8400000};
const at=Date.parse('2026-10-20T06:00:00Z');
const claudeUsage={promptTokenCount:12000,candidatesTokenCount:700,totalTokenCount:12700},geminiUsage={promptTokenCount:12000,candidatesTokenCount:600,totalTokenCount:12600};
const attempt=(ordinal,model,outcome,extra={})=>({ordinal,model,outcome,brokerCompleted:true,outputStarted:outcome==='OK',usage:outcome==='OK'?(model===CLAUDE?claudeUsage:geminiUsage):null,...extra});
const accounting=(attempts,policyName='yw-claude-primary-gemini-fallback-v1')=>({version:1,policy:policyName,mode:'sequential-distinct-key',fallback:false,hedge:false,backgroundCalls:0,maxProviderAttempts:3,providerAttemptCount:attempts.length,attempts});

test('policy v2 parses the Claude primary with its own prices and a reserve that covers the priciest model; legacy policies are unchanged',()=>{
 const b=dialogueBudget({YW_DIALOGUE_BUDGET_JSON:JSON.stringify(policy)},at);
 assert.equal(b.primaryModel,CLAUDE);assert.equal(b.policy,'yw-claude-primary-gemini-fallback-v1');assert.equal(b.maxInputTokens,32000);
 const l=dialogueBudget({YW_DIALOGUE_BUDGET_JSON:JSON.stringify(legacy)},at);assert.equal(l.primaryModel,null);assert.equal(l.policy,'yw-same-model-sequential-v1');assert.equal(l.maxInputTokens,100000);
 assert.throws(()=>dialogueBudget({YW_DIALOGUE_BUDGET_JSON:JSON.stringify({...policy,reserveMicros:87000})},at),/invalid_budget_reserve/);
 assert.throws(()=>dialogueBudget({YW_DIALOGUE_BUDGET_JSON:JSON.stringify({...policy,primaryModel:'gemini-3.8-flash'})},at),/invalid_budget_policy/);
 assert.throws(()=>dialogueBudget({YW_DIALOGUE_BUDGET_JSON:JSON.stringify({...legacy,primaryModel:CLAUDE})},at),/invalid_budget_policy/);
 assert.throws(()=>dialogueBudget({YW_DIALOGUE_BUDGET_JSON:JSON.stringify({...policy,policy:'yw-other'})},at),/invalid_budget_policy/);
 assert.throws(()=>dialogueBudget({YW_DIALOGUE_BUDGET_JSON:JSON.stringify({...policy,maxInputTokens:4000})},at),/invalid_budget_policy/);
 assert.throws(()=>dialogueBudget({YW_DIALOGUE_BUDGET_JSON:JSON.stringify(policy)},Date.parse('2026-11-09T22:00:01Z')),/budget_price_expired/);
});

test('cost follows the model that produced the usage: Claude priced, free Gemini at zero',()=>{
 const b=dialogueBudget({YW_DIALOGUE_BUDGET_JSON:JSON.stringify(policy)},at);
 assert.equal(reconciledCost(b,claudeUsage,CLAUDE),Math.ceil(12000*2+700*10));
 assert.equal(reconciledCost(b,geminiUsage,GEMINI),0);
 assert.equal(reconciledCost(b,geminiUsage,null),0);
 const env={YW_DIALOGUE_BUDGET_JSON:JSON.stringify(policy),YW_DIALOGUE_PROVIDER_ATTEMPTS:'3'};
 const budget=requestDialogueBudget(env,{id:1},'lesson-1717-p2');
 assert.equal(budget.primaryModel,CLAUDE);assert.equal(budget.providerAttemptLimit,3);
 // The call reserves one Claude attempt plus two free fallback attempts: 88,000 + 0 + 0.
 assert.equal(budget.reserveMicros,88000);assert.equal(budget.fallbackReserveMicros,0);
 const legacyBudget=requestDialogueBudget({YW_DIALOGUE_BUDGET_JSON:JSON.stringify(legacy),YW_DIALOGUE_PROVIDER_ATTEMPTS:'3'},{id:1},'lesson-1717-p2');assert.equal(legacyBudget.reserveMicros,252000);
 assert.equal(operatorCost(budget,{model:CLAUDE,usage:claudeUsage},accounting([attempt(1,CLAUDE,'OK')])),31000);
 // A failed Claude attempt without authoritative usage keeps its per-attempt reservation (conservative, as for any unknown usage); the free Gemini answer adds 0.
 assert.equal(operatorCost(budget,{model:GEMINI,usage:geminiUsage},accounting([attempt(1,CLAUDE,'CLAUDE_HTTP_529'),attempt(2,GEMINI,'OK')])),budget.perAttemptReserveMicros);
 assert.equal(budget.perAttemptReserveMicros,88000);
 // A failed free fallback attempt retains its own (zero) reserve; the Claude answer is priced from its usage.
 assert.equal(operatorCost(budget,{model:GEMINI,usage:geminiUsage},accounting([attempt(1,CLAUDE,'CLAUDE_TIMEOUT'),attempt(2,GEMINI,'TIMEOUT',{outputStarted:false}),attempt(3,GEMINI,'OK')])),88000);
 assert.equal(operatorCost(budget,{model:GEMINI,usage:geminiUsage},accounting([attempt(1,CLAUDE,'CLAUDE_TRUNCATED',{usage:claudeUsage}),attempt(2,GEMINI,'OK')])),31000);
});

test('accounting validator: the primary attempt is first, may fail with or without output, and the fallback attempts stay on the Gemini model',()=>{
 const ok=validatedProviderAccounting(accounting([attempt(1,CLAUDE,'OK')]),{maxProviderAttempts:3,success:true,model:GEMINI,primaryModel:CLAUDE});
 assert.equal(ok.policy,'yw-claude-primary-gemini-fallback-v1');assert.equal(ok.attempts[0].model,CLAUDE);
 const fb=validatedProviderAccounting(accounting([attempt(1,CLAUDE,'CLAUDE_STREAM_INCOMPLETE',{outputStarted:true}),attempt(2,GEMINI,'OK')]),{maxProviderAttempts:3,success:true,model:GEMINI,primaryModel:CLAUDE});
 assert.deepEqual(fb.attempts.map(a=>a.model),[CLAUDE,GEMINI]);
 assert.throws(()=>validatedProviderAccounting(accounting([attempt(1,GEMINI,'OK')]),{maxProviderAttempts:3,success:true,model:GEMINI,primaryModel:CLAUDE}),/gateway_accounting_mismatch/);
 assert.throws(()=>validatedProviderAccounting(accounting([attempt(1,CLAUDE,'OK'),attempt(2,GEMINI,'OK')]),{maxProviderAttempts:3,success:true,model:GEMINI,primaryModel:CLAUDE}),/gateway_retry_mismatch/);
 assert.throws(()=>validatedProviderAccounting(accounting([attempt(1,CLAUDE,'CLAUDE_HTTP_529'),attempt(2,CLAUDE,'OK')]),{maxProviderAttempts:3,success:true,model:GEMINI,primaryModel:CLAUDE}),/gateway_accounting_mismatch/);
 assert.throws(()=>validatedProviderAccounting(accounting([attempt(1,CLAUDE,'OK')]),{maxProviderAttempts:3,success:true,model:GEMINI}),/gateway_accounting_mismatch/);
 const same=validatedProviderAccounting(accounting([attempt(1,GEMINI,'OK')],'yw-same-model-sequential-v1'),{maxProviderAttempts:3,success:true,model:GEMINI,primaryModel:CLAUDE});
 assert.equal(same.attempts[0].model,GEMINI);
});

test('continuation policy treats a failed Claude attempt followed by Gemini timeouts as retryable, and a completed Claude reply as not retryable',()=>{
 const call={state:'review',source_request_json:null,budget_policy_json:JSON.stringify({...policy,logicalProviderAttemptLimit:3})};
 const noOutput=continuationDisposition(call,{stage:'provider_request',providerAccounting:accounting([attempt(1,CLAUDE,'CLAUDE_HTTP_529'),attempt(2,GEMINI,'TIMEOUT')])},false,{noOutput:true});
 assert.equal(noOutput.code,'explicit_retry_available');assert.equal(noOutput.remainingProviderAttempts,1);
 assert.equal(continuationDisposition(call,{stage:'provider_request',providerAccounting:accounting([attempt(1,CLAUDE,'CLAUDE_REQUEST_REJECTED'),attempt(2,GEMINI,'TIMEOUT')])},false,{noOutput:true}).code,'provider_failure_not_retryable');
 assert.equal(continuationDisposition(call,{stage:'proposal',code:'invalid_assessment',providerAccounting:accounting([attempt(1,CLAUDE,'OK')])}).code,'explicit_regeneration_available');
});

test('gateway stream consumer accepts a Claude-served done event and the worker sends the claude-primary opt-in',async()=>{
 const answer='{"reply":"先說說你在意的那一句。","assessments":[]}';
 const frames=[['delta',{text:answer,requestId:'r1'}],['done',{requestId:'r1',answer,model:CLAUDE,modelVersion:null,usage:claudeUsage,providerAttemptCount:1,providerAccounting:accounting([attempt(1,CLAUDE,'OK')]),firstTokenMs:900,totalDurationMs:950}]];
 const body=frames.map(([e,d],i)=>`id: ${i+1}\nevent: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('');
 const response=()=>new Response(body,{headers:{'content-type':'text/event-stream'}});
 const replies=[];const result=await consumeGatewayStream(response(),async r=>{replies.push(r);},{maxReplyChars:1800,maxProviderAttempts:3,model:GEMINI,primaryModel:CLAUDE});
 assert.equal(result.model,CLAUDE);assert.equal(result.providerAccounting.attempts[0].model,CLAUDE);assert.equal(replies.at(-1),'先說說你在意的那一句。');
 await assert.rejects(()=>consumeGatewayStream(response(),null,{maxReplyChars:1800,maxProviderAttempts:3,model:GEMINI}),/gateway_(stream|accounting)_mismatch/);
 let sent=null;const env={YW_DIALOGUE_BUDGET_JSON:JSON.stringify(policy),YW_DIALOGUE_PROVIDER_ATTEMPTS:'3',APIS_CALLER_TOKEN:'synthetic',APIS:{fetch:async req=>{sent=JSON.parse(await req.text());return response();}}};
 const budget=requestDialogueBudget(env,{id:1},'lesson-1717-p2');
 const out=await callDialogueModel(env,'提示',crypto.randomUUID(),async()=>{},budget);
 assert.equal(sent.tier,'claude-primary');assert.equal(sent.model,GEMINI);assert.equal(sent.providerAttemptLimit,3);assert.equal(out.model,CLAUDE);
 const legacyEnv={...env,YW_DIALOGUE_BUDGET_JSON:JSON.stringify(legacy)};sent=null;
 const geminiBody=[['delta',{text:answer,requestId:'r2'}],['done',{requestId:'r2',answer,model:GEMINI,modelVersion:null,usage:geminiUsage,providerAttemptCount:1,providerAccounting:accounting([attempt(1,GEMINI,'OK')],'yw-same-model-sequential-v1'),firstTokenMs:900,totalDurationMs:950}]].map(([e,d],i)=>`id: ${i+1}\nevent: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('');
 legacyEnv.APIS={fetch:async req=>{sent=JSON.parse(await req.text());return new Response(geminiBody,{headers:{'content-type':'text/event-stream'}});}};
 await callDialogueModel(legacyEnv,'提示',crypto.randomUUID(),async()=>{},requestDialogueBudget(legacyEnv,{id:1},'lesson-1717-p2'));
 assert.equal(sent.tier,undefined);
});

// 2026-10-20 acceptance finding (account 553, structure flow): the fixed 2,400-token output bound truncated the structured reply
// (CLAUDE_TRUNCATED, paid) and the learner was left with replyRetry code provider_completion_unconfirmed / unclassified.
const v2={...policy,version:'yw-claude-primary-20261020-v2',maxOutputTokens:8192,reserveMicros:145920};
const truncatedUsage={promptTokenCount:15600,candidatesTokenCount:8192,totalTokenCount:23792};

test('policy v2 may declare the structured-reply output bound up to the gateway Claude cap; the reserve must cover it; legacy stays at 2,400',()=>{
 const b=dialogueBudget({YW_DIALOGUE_BUDGET_JSON:JSON.stringify(v2)},at);
 assert.equal(b.maxOutputTokens,8192);assert.equal(b.reserveMicros,145920);assert.equal(b.fallbackReserveMicros,0);
 // Cap derivation: ceil((32,000 input × US$2 + 8,192 output × US$10) per million) = 64,000 + 81,920 micro-dollars per primary attempt.
 assert.throws(()=>dialogueBudget({YW_DIALOGUE_BUDGET_JSON:JSON.stringify({...v2,reserveMicros:145919})},at),/invalid_budget_reserve/);
 // The production reserve (88,000) covers only the 2,400 bound: raising the bound without the reserve is refused.
 assert.throws(()=>dialogueBudget({YW_DIALOGUE_BUDGET_JSON:JSON.stringify({...policy,maxOutputTokens:8192})},at),/invalid_budget_reserve/);
 assert.equal(dialogueBudget({YW_DIALOGUE_BUDGET_JSON:JSON.stringify({...policy,maxOutputTokens:4096,reserveMicros:104960})},at).maxOutputTokens,4096);
 for(const bad of [8193,2399,0,-1,'8192',4096.5,null])assert.throws(()=>dialogueBudget({YW_DIALOGUE_BUDGET_JSON:JSON.stringify({...v2,maxOutputTokens:bad})},at),/invalid_budget_policy/,String(bad));
 // The same-model (free pool) policy keeps the historical bound and may not declare another.
 assert.throws(()=>dialogueBudget({YW_DIALOGUE_BUDGET_JSON:JSON.stringify({...legacy,maxOutputTokens:8192})},at),/invalid_budget_policy/);
 assert.throws(()=>dialogueBudget({YW_DIALOGUE_BUDGET_JSON:JSON.stringify({...legacy,maxOutputTokens:2400})},at),/invalid_budget_policy/);
 assert.equal(dialogueBudget({YW_DIALOGUE_BUDGET_JSON:JSON.stringify(legacy)},at).maxOutputTokens,2400);
 assert.equal(dialogueBudget({YW_DIALOGUE_BUDGET_JSON:JSON.stringify(policy)},at).maxOutputTokens,2400);
});

test('v2 reservation bound: one primary attempt at the output bound plus two free fallback attempts stays under the US$2/user/day and US$4/lesson caps; usage up to the bound is priced',()=>{
 const env={YW_DIALOGUE_BUDGET_JSON:JSON.stringify(v2),YW_DIALOGUE_PROVIDER_ATTEMPTS:'3'};
 const budget=requestDialogueBudget(env,{id:1},'lesson-1717-p2');
 // reserve = primary + fallback × (limit − 1) = 145,920 + 0 × 2
 assert.equal(budget.reserveMicros,145920);assert.equal(budget.perAttemptReserveMicros,145920);assert.equal(budget.fallbackReserveMicros,0);assert.equal(budget.providerAttemptLimit,3);assert.equal(budget.maxOutputTokens,8192);
 assert.equal(budget.userDailyMicros,2000000);assert.equal(budget.lessonLifetimeMicros,4000000);assert.ok(budget.reserveMicros<=Math.min(budget.globalDailyMicros,budget.userDailyMicros,budget.lessonLifetimeMicros));
 // The reservation may equal a cap but never exceed it.
 assert.equal(requestDialogueBudget({YW_DIALOGUE_BUDGET_JSON:JSON.stringify({...v2,userDailyMicros:145920,lessonLifetimeMicros:145920}),YW_DIALOGUE_PROVIDER_ATTEMPTS:'3'},{id:1},'lesson-1717-p2').reserveMicros,145920);
 assert.throws(()=>requestDialogueBudget({YW_DIALOGUE_BUDGET_JSON:JSON.stringify({...v2,userDailyMicros:145919}),YW_DIALOGUE_PROVIDER_ATTEMPTS:'3'},{id:1},'lesson-1717-p2'),/invalid_budget_reserve/);
 // The current production policy object keeps its arithmetic: 88,000 + 0 + 0.
 assert.equal(requestDialogueBudget({YW_DIALOGUE_BUDGET_JSON:JSON.stringify(policy),YW_DIALOGUE_PROVIDER_ATTEMPTS:'3'},{id:1},'lesson-1717-p2').reserveMicros,88000);
 // A reply that used the whole bound is priced from its usage; one token more is unknown usage (reservation retained).
 assert.equal(reconciledCost(budget,truncatedUsage,CLAUDE),15600*2+8192*10);
 assert.equal(reconciledCost(budget,{promptTokenCount:15600,candidatesTokenCount:8193,totalTokenCount:23793},CLAUDE),null);
 assert.equal(reconciledCost(dialogueBudget({YW_DIALOGUE_BUDGET_JSON:JSON.stringify(policy)},at),{promptTokenCount:15600,candidatesTokenCount:2401,totalTokenCount:18001},CLAUDE),null);
 // A truncated Claude attempt with authoritative usage is settled from it (never free); the free fallback adds 0.
 assert.equal(operatorCost(budget,{model:GEMINI,usage:geminiUsage},accounting([attempt(1,CLAUDE,'CLAUDE_TRUNCATED',{outputStarted:true,usage:truncatedUsage}),attempt(2,GEMINI,'OK')])),15600*2+8192*10);
});

test('the worker forwards the policy output bound to the gateway (max_tokens) and keeps 2,400 for policies without one',async()=>{
 const answer='{"reply":"先說說你在意的那一句。","assessments":[]}';
 const frames=[['delta',{text:answer,requestId:'r1'}],['done',{requestId:'r1',answer,model:CLAUDE,modelVersion:null,usage:claudeUsage,providerAttemptCount:1,providerAccounting:accounting([attempt(1,CLAUDE,'OK')]),firstTokenMs:900,totalDurationMs:950}]];
 const body=frames.map(([e,d],i)=>`id: ${i+1}\nevent: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('');
 let sent=null;const env={YW_DIALOGUE_BUDGET_JSON:JSON.stringify(v2),YW_DIALOGUE_PROVIDER_ATTEMPTS:'3',APIS_CALLER_TOKEN:'synthetic',APIS:{fetch:async req=>{sent=JSON.parse(await req.text());return new Response(body,{headers:{'content-type':'text/event-stream'}});}}};
 await callDialogueModel(env,'提示',crypto.randomUUID(),async()=>{},requestDialogueBudget(env,{id:1},'lesson-1717-p2'));
 assert.equal(sent.generationConfig.maxOutputTokens,8192);assert.equal(sent.tier,'claude-primary');
 const current={...env,YW_DIALOGUE_BUDGET_JSON:JSON.stringify(policy)};sent=null;
 await callDialogueModel(current,'提示',crypto.randomUUID(),async()=>{},requestDialogueBudget(current,{id:1},'lesson-1717-p2'));
 assert.equal(sent.generationConfig.maxOutputTokens,2400);
});

test('recovery disposition: a truncated Claude attempt has no learner-visible output and allows one explicit retry within the attempt limit',()=>{
 const call={state:'review',source_request_json:null,budget_policy_json:JSON.stringify({...v2,logicalProviderAttemptLimit:3})};
 const truncated=attempt(1,CLAUDE,'CLAUDE_TRUNCATED',{outputStarted:true,usage:{promptTokenCount:15600,candidatesTokenCount:2400,totalTokenCount:18000}});
 const failure=attempts=>({stage:'provider_request',code:'gateway_stream_unconfirmed',providerAccounting:accounting(attempts)});
 const retry=continuationDisposition(call,failure([truncated,attempt(2,GEMINI,'TIMEOUT')]),false,{noOutput:true});
 assert.deepEqual(retry,{allowed:true,code:'explicit_retry_available',requiresUserAction:true,remainingProviderAttempts:1,providerAttemptsUsed:2});
 assert.equal(continuationDisposition(call,failure([truncated]),false,{noOutput:true}).code,'explicit_retry_available');
 assert.equal(continuationDisposition(call,failure([truncated,attempt(2,GEMINI,'TIMEOUT'),attempt(3,GEMINI,'503')]),false,{noOutput:true}).code,'provider_attempt_limit');
 // A fallback attempt the broker has not completed (still in flight when the gateway reported) stays unconfirmed.
 assert.equal(continuationDisposition(call,failure([truncated,attempt(2,GEMINI,'TIMEOUT',{brokerCompleted:false})]),false,{noOutput:true}).code,'provider_completion_unconfirmed');
 // Learner-visible free-pool output still blocks the no-output retry; a refused Claude answer is never retried.
 assert.equal(continuationDisposition(call,failure([truncated,attempt(2,GEMINI,'FETCH_ERROR',{outputStarted:true})]),false,{noOutput:true}).code,'partial_output_present');
 assert.equal(continuationDisposition(call,failure([attempt(1,CLAUDE,'CLAUDE_REFUSED',{outputStarted:true}),attempt(2,GEMINI,'TIMEOUT')]),false,{noOutput:true}).code,'provider_failure_not_retryable');
 assert.equal(continuationDisposition(call,failure([attempt(1,CLAUDE,'CLAUDE_JSON_INVALID',{outputStarted:true})]),false,{noOutput:true}).code,'provider_failure_not_retryable');
 // Without any accounting (the gateway's terminal frame never reached the worker) nothing can be bounded: unchanged.
 assert.equal(continuationDisposition(call,{stage:'provider_request',code:'unclassified',providerAccounting:null},false,{noOutput:true}).code,'provider_completion_unconfirmed');
 // A legacy same-model attempt that produced output is still partial output.
 const legacyCall={...call,budget_policy_json:JSON.stringify({...legacy,logicalProviderAttemptLimit:3})};
 assert.equal(continuationDisposition(legacyCall,{stage:'provider_request',providerAccounting:accounting([attempt(1,GEMINI,'TIMEOUT',{outputStarted:true})],'yw-same-model-sequential-v1')},false,{noOutput:true}).code,'partial_output_present');
});

test('the production policy var (wrangler.toml) is the v2 policy: 8,192 output bound with the exact covering reserve and unchanged caps',async()=>{
 const {readFileSync}=await import('node:fs');
 const toml=readFileSync(new URL('../wrangler.toml',import.meta.url),'utf8');
 const line=/^YW_DIALOGUE_BUDGET_JSON = '(\{.*\})'$/m.exec(toml.slice(toml.indexOf('[env.production.vars]')));assert.ok(line,'production budget policy var');
 const production=JSON.parse(line[1]);
 assert.deepEqual({...production,validUntil:undefined},{...policy,version:'yw-claude-primary-20261020-v2',maxOutputTokens:8192,reserveMicros:145920,validUntil:undefined});
 const budget=requestDialogueBudget({YW_DIALOGUE_BUDGET_JSON:line[1],YW_DIALOGUE_PROVIDER_ATTEMPTS:'3'},{id:1},'lesson-1717-p2');
 assert.equal(budget.maxOutputTokens,8192);assert.equal(budget.reserveMicros,145920);assert.equal(budget.fallbackReserveMicros,0);
 // The declared reserve is exactly the bound for the primary model (no slack, no shortfall).
 assert.throws(()=>dialogueBudget({YW_DIALOGUE_BUDGET_JSON:JSON.stringify({...production,reserveMicros:production.reserveMicros-1})},at),/invalid_budget_reserve/);
 assert.deepEqual([budget.globalDailyMicros,budget.userDailyMicros,budget.lessonLifetimeMicros,budget.validUntil],[20000000,2000000,4000000,'2026-11-09T22:00:00Z']);
});
