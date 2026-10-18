import test from 'node:test';
import assert from 'node:assert/strict';
import {callDialogueModel} from '../site/dialogue-source.js';
import {consumeGatewayStream} from '../site/dialogue-stream.js';
import {dialogueBudget,reconciledCost} from '../site/dialogue-budget.js';

const model='gemini-3.8-flash';
const usage={promptTokenCount:1000,totalTokenCount:1100,cachedContentTokenCount:700};
const answer=JSON.stringify({reply:'試讀這一句。'});
const accounting={version:1,policy:'yw-same-model-sequential-v1',mode:'sequential-distinct-key',fallback:false,hedge:false,backgroundCalls:0,maxProviderAttempts:1,providerAttemptCount:1,attempts:[{ordinal:1,model,outcome:'OK',brokerCompleted:true,outputStarted:true,usage}]};
const frame=(id,event,data)=>`id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const done={answer,model,modelVersion:'synthetic-model-version',usage,providerAttemptCount:1,providerAccounting:accounting,firstTokenMs:10,totalDurationMs:30};
const stream=s=>new Response(s,{headers:{'content-type':'text/event-stream'}});

test('formal caller sends the production contract and keeps usage/cache/model evidence',async()=>{
 let calls=0;const env={APIS_CALLER_TOKEN:'synthetic-caller-only',APIS:{fetch:async req=>{
  calls++;assert.equal(req.url,'https://apis.internal/api/yw/dialogue-stream');
  assert.equal(req.headers.get('x-internal-token'),env.APIS_CALLER_TOKEN);
  assert.equal(req.headers.get('x-project-name'),'yw.bdfz.net');
  assert.equal(req.headers.get('cookie'),null);assert.equal(req.headers.get('Cloudflare-Workers-Version-Overrides'),null);
  assert.equal(req.headers.get('x-request-id'),'synthetic-request');assert(req.signal);
  const body=await req.json();assert.equal(body.providerAttemptLimit,1);assert.equal(body.model,model);
  assert.equal(body.stream,true);assert.equal(body.taskType,'chat');assert.equal(body.generationConfig.maxOutputTokens,2400);
  assert.deepEqual(body.contents,[{role:'user',parts:[{text:'原文與註釋'}]}]);
  return stream(frame(1,'delta',{text:answer})+frame(2,'done',done));
 }}};
 const r=await callDialogueModel(env,'原文與註釋','synthetic-request',()=>{},{model,providerAttemptLimit:1});
 assert.equal(calls,1);assert.deepEqual(r.usage,usage);assert.deepEqual(r.providerAccounting,accounting);assert.equal(r.modelVersion,done.modelVersion);
});

test('formal credential and rate refusals stop without automatic replay',async()=>{
 for(const status of [401,403,429]){
  let calls=0;const env={APIS_CALLER_TOKEN:'synthetic-caller-only',APIS:{fetch:async()=>{calls++;return new Response(null,{status});}}};
  await assert.rejects(callDialogueModel(env,'p','id',()=>{},{model}),status===429?/gateway_rate_limit/:/gateway_credential_rejected/);assert.equal(calls,1);
 }
});

test('broken, wrong-model, wrong-usage and partial-error streams cannot become accepted',async()=>{
 const delta=frame(1,'delta',{text:answer});
 for(const bytes of [delta,delta+frame(2,'done',{...done,model:'claude-synthetic'}),delta+frame(2,'done',{...done,usage:{...usage,totalTokenCount:999}}),delta+frame(2,'error',{code:'STREAM_BROKEN'})])
  await assert.rejects(consumeGatewayStream(stream(bytes),()=>{},{model}));
});

test('cancellation aborts stream reading and preserves partial reply without another fetch',async()=>{
 let cancelled=0;const controller=new AbortController();
 const body=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(frame(1,'delta',{text:answer})));},cancel(){cancelled++;}});
 await assert.rejects(consumeGatewayStream(new Response(body,{headers:{'content-type':'text/event-stream'}}),()=>controller.abort(),{model,signal:controller.signal}),e=>e.message==='gateway_stream_timeout'&&e.partialReply==='試讀這一句。');assert.equal(cancelled,1);
});

test('free-pool price is zero, unknown usage stays unknown, reservations remain positive',()=>{
 const policy={version:'synthetic-free-pool',model,currency:'USD',validUntil:new Date(Date.now()+60000).toISOString(),globalDailyMicros:32592000,userDailyMicros:32592000,lessonLifetimeMicros:32592000,reserveMicros:84000,inputMicrosPerMillion:0,outputMicrosPerMillion:0};
 const parsed=dialogueBudget({YW_DIALOGUE_BUDGET_JSON:JSON.stringify(policy)});
 assert.equal(reconciledCost(parsed,usage),0);assert.equal(reconciledCost(parsed,{}),null);
 for(const edit of [{reserveMicros:0},{inputMicrosPerMillion:-1},{validUntil:'2000-01-01'}])assert.throws(()=>dialogueBudget({YW_DIALOGUE_BUDGET_JSON:JSON.stringify({...policy,...edit})}));
});
