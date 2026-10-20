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
 assert.equal(operatorCost(budget,{model:CLAUDE,usage:claudeUsage},accounting([attempt(1,CLAUDE,'OK')])),31000);
 // A failed Claude attempt without authoritative usage keeps its per-attempt reservation (conservative, as for any unknown usage); the free Gemini answer adds 0.
 assert.equal(operatorCost(budget,{model:GEMINI,usage:geminiUsage},accounting([attempt(1,CLAUDE,'CLAUDE_HTTP_529'),attempt(2,GEMINI,'OK')])),budget.perAttemptReserveMicros);
 assert.equal(budget.perAttemptReserveMicros,88000);
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
