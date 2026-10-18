import test from 'node:test';
import assert from 'node:assert/strict';
import {callDialogueModel} from '../site/dialogue-source.js';
import {consumeGatewayStream} from '../site/dialogue-stream.js';
import {dialogueBudget,reconciledCost} from '../site/dialogue-budget.js';
import {acceptanceEnvironment} from '../site/dialogue-acceptance.js';

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

const failedAccounting={...accounting,attempts:[{ordinal:1,model,outcome:'400',brokerCompleted:true,outputStarted:false,usage:null}]};
const safeFailure={requestId:'synthetic-request',providerAccounting:failedAccounting,error_code:'CLIENT_REQUEST_INVALID',status_code:400,google_error:{error:{code:400,status:'INVALID_ARGUMENT'}}};
function failureEnvironment(fetch,isolated){
 const bindings={APIS_CALLER_TOKEN:'synthetic-caller-only',APIS:{fetch}};
 if(!isolated)return bindings;
 const noIO=()=>{throw Error('unexpected_io');};
 return acceptanceEnvironment(new Request('https://yw-acceptance.bdfz.net'),{
  ...bindings,ASSETS:{fetch:noIO},ACCEPTANCE_DB:{prepare:noIO},USER_CENTER_EVIDENCE:{resolveSession:noIO},
  YW_ACCEPTANCE_USER_ID:'553',YW_FORMAL_APIS_VERSION:'11111111-1111-4111-8111-111111111111',
  YW_ACCEPTANCE_DATABASE_ID:'22222222-2222-4222-8222-222222222222',YW_ACCEPTANCE_ACTIVATION_SHA256:'a'.repeat(64),
  YW_ACCEPTANCE_EXPIRES_AT:new Date(Date.now()+60000).toISOString(),
 });
}
async function rejectedFailure(body=safeFailure,{isolated=true,status=400}={}){
 let calls=0;
 const env=failureEnvironment(async req=>{
  calls++;assert.equal(req.headers.get('x-request-id'),'synthetic-request');
  assert.equal((await req.json()).providerAttemptLimit,1);
  return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','retry-after':'2'}});
 },isolated);
 let failure;
 await assert.rejects(callDialogueModel(env,'synthetic prompt','synthetic-request',()=>{throw Error('unexpected_reply');},{model,providerAttemptLimit:1}),error=>{failure=error;return error.message===(status===429?'gateway_rate_limit':[401,403].includes(status)?'gateway_credential_rejected':'gateway_unavailable');});
 assert.equal(calls,1);return failure;
}
test('isolated HTTP400 retains only classified diagnostics after correlated accounting validation',async()=>{
 const failure=await rejectedFailure();
 assert.deepEqual(failure.gatewayFailure,{
  requestId:'synthetic-request',httpStatus:400,retryAfterMs:2000,providerAccounting:failedAccounting,partialOutput:false,retryable:false,
  diagnostic:{errorCode:'CLIENT_REQUEST_INVALID',statusCode:400,googleError:{code:400,status:'INVALID_ARGUMENT'}},
 });
 const saved=JSON.parse(JSON.stringify({gatewayFailure:failure.gatewayFailure}));
 assert.deepEqual(saved.gatewayFailure.diagnostic,failure.gatewayFailure.diagnostic);
});
test('isolated HTTP400 strips messages, details, keys, unknown strings and malformed types',async()=>{
 const sensitive='synthetic-private-prompt-path-credential';
 const enriched={...safeFailure,message:sensitive,body:sensitive,source_api_tried:sensitive,google_error:{error:{...safeFailure.google_error.error,message:sensitive,details:[{value:sensitive}],nested:{status:sensitive}}}};
 const retained=(await rejectedFailure(enriched)).gatewayFailure;
 assert.deepEqual(retained.diagnostic,{errorCode:'CLIENT_REQUEST_INVALID',statusCode:400,googleError:{code:400,status:'INVALID_ARGUMENT'}});
 assert(!JSON.stringify(retained).includes(sensitive));
 for(const value of [sensitive,'400',399,600,400.5,null,true,[],{},['INVALID_ARGUMENT']]){
  const error=await rejectedFailure({...safeFailure,error_code:value,status_code:value,google_error:{error:{code:value,status:value,message:sensitive}}});
  assert.equal(error.gatewayFailure.diagnostic,undefined);
  assert(!JSON.stringify(error.gatewayFailure).includes(sensitive));
 }
 for(const google_error of [sensitive,JSON.stringify(safeFailure.google_error),[],null,{status:'INVALID_ARGUMENT',code:400},{error:['INVALID_ARGUMENT'] }]){
  const error=await rejectedFailure({requestId:safeFailure.requestId,providerAccounting:failedAccounting,google_error});
  assert.equal(error.gatewayFailure.diagnostic,undefined);
 }
});
test('isolated HTTP400 never infers provider classification from the outer status',async()=>{
 const error=await rejectedFailure({requestId:safeFailure.requestId,providerAccounting:failedAccounting});
 assert.equal(error.gatewayFailure.diagnostic,undefined);assert.equal(error.gatewayFailure.httpStatus,400);
 const partial=await rejectedFailure({...safeFailure,error_code:'UNKNOWN_GATEWAY_CODE',status_code:'400',google_error:{error:{status:'FAILED_PRECONDITION',code:'400'}}});
 assert.deepEqual(partial.gatewayFailure.diagnostic,{googleError:{status:'FAILED_PRECONDITION'}});
});
test('isolated HTTP400 rejects diagnostics on mismatched correlation or invalid accounting',async()=>{
 for(const patch of [{requestId:'other-request'},{providerAccounting:null},{providerAccounting:{...failedAccounting,providerAttemptCount:2}},{providerAccounting:{...failedAccounting,attempts:[{...failedAccounting.attempts[0],model:'other-model'}]}}]){
  const error=await rejectedFailure({...safeFailure,...patch});
  assert.deepEqual(error.gatewayFailure,{requestId:'synthetic-request',httpStatus:400,retryAfterMs:2000});
 }
});
test('ordinary HTTP400 and other isolated failures keep their existing contract and dispatch count',async()=>{
 const error=await rejectedFailure(safeFailure,{isolated:false});
 assert.deepEqual(error.gatewayFailure,{requestId:'synthetic-request',httpStatus:400,providerAccounting:failedAccounting,partialOutput:false,retryable:false});
 const unavailable=await rejectedFailure(safeFailure,{status:503});
 assert.equal(unavailable.gatewayFailure.diagnostic,undefined);
 for(const status of [401,403,429])assert.equal((await rejectedFailure(safeFailure,{status})).gatewayFailure,undefined);
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
