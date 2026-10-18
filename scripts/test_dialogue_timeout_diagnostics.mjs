import test from 'node:test';import assert from 'node:assert/strict';
import {timeoutMetadata,projectTimeoutWindow}from'./dialogue_timeout_diagnostics.mjs';
const version='98987159-f22f-4614-8c63-98dc29aab5fe',from=1792317789000,to=1792317805000,id='e40a6890449d42b6989eaf91b527ccdf';
const event=(details={})=>({timestamp:to-1000,$workers:{scriptName:'apis',scriptVersion:{id:version},requestId:id},$metadata:{service:'apis',id:'synthetic-event',type:'cf-worker-console'},source:{message:JSON.stringify({schema:'apis-log-v2',message:'Google provider attempt completed',details:{model:'gemini-3.8-flash',outcome:'TIMEOUT',providerStage:'awaiting_headers',allocated_provider_ms:12000,...details}})}});
const terminal=()=>({timestamp:to-1000,$workers:{scriptName:'apis',scriptVersion:{id:version},requestId:id,event:{response:{status:503}},wallTimeMs:12864},$metadata:{service:'apis',id:'synthetic-terminal',type:'cf-worker-event'}});
const response=events=>({run:{status:'COMPLETED'},events:{events,count:events.length},statistics:{abr_level:1}});
test('v2 logger is recognized and finite timeout fields are retained',()=>{const r=timeoutMetadata(event(),version);assert.equal(r.event,'Google provider attempt completed');assert.equal(r.details.providerStage,'awaiting_headers');assert.equal(r.details.allocated_provider_ms,12000);});
test('raw messages, credentials, caller IDs and arbitrary details are never projected',()=>{const x=event({requestId:'PRIVATE',callerId:'PRIVATE',key:'PRIVATE',error:'PRIVATE',payload:'PRIVATE',providerStage:'PRIVATE',durationMs:-1});x.$workers.event={request:{headers:{authorization:'PRIVATE'},url:'PRIVATE'}};assert(!JSON.stringify(timeoutMetadata(x,version)).includes('PRIVATE'));});
test('exact platform invocation can distinguish awaiting headers from reading body',()=>{for(const stage of ['awaiting_headers','reading_body']){const r=projectTimeoutWindow(response([event({providerStage:stage}),terminal()]),{version,from,to});assert.equal(r.stage,stage);assert(r.complete);}});
test('ambiguous, sampled, truncated or missing platform correlation remains unresolved',()=>{
 for(const edit of [r=>r.statistics.abr_level=2,r=>r.events.truncated=true,r=>{r.events.events.push(terminal());r.events.count++;},r=>delete r.events.events[0].$workers.requestId,r=>r.run.status='RUNNING']){const x=response([event(),terminal()]);edit(x);assert.equal(projectTimeoutWindow(x,{version,from,to}).stage,null);}
});
test('wrong version and unsupported schema cannot establish the timeout phase',()=>{const x=event();x.$workers.scriptVersion.id='other';assert.equal(timeoutMetadata(x,version).event,null);x.$workers.scriptVersion.id=version;x.source={schema:'old',message:'SECRET'};const r=timeoutMetadata(x,version);assert.equal(r.event,null);assert(!JSON.stringify(r).includes('SECRET'));});
test('bounded windows and response limits fail closed without a fetch or inference',()=>{assert.throws(()=>projectTimeoutWindow(response([]),{version,from,to:to+1}),/fixed_window_invalid/);assert.throws(()=>projectTimeoutWindow({}, {version,from,to}),/events_unavailable/);});

import fs from 'node:fs';
test('accepted logger source produces the schema and outcome consumed by this adapter',{skip:!process.env.APIS_ACCEPTED_LOGGER_SOURCE},async()=>{
 const source=fs.readFileSync(process.env.APIS_ACCEPTED_LOGGER_SOURCE,'utf8');const {createMetadataLogger}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));let logged;const logger=createMetadataLogger('accepted-source',{warn:x=>logged=x});
 logger('WARN','Google provider attempt completed','PRIVATE',{model:'gemini-3.8-flash',outcome:'TIMEOUT',timeoutMs:12000,allocated_provider_ms:12000,configured_provider_ms:12000,providerStage:'awaiting_headers',providerAttemptNumber:1,providerAttemptLimit:1});
 const x=event();x.source={message:logged};const r=projectTimeoutWindow(response([x,terminal()]),{version,from,to});assert.equal(r.stage,'awaiting_headers');assert.equal(r.rows[0].details.outcome,'TIMEOUT');assert.equal(r.rows[0].details.timeoutMs,12000);assert(!JSON.stringify(r).includes('PRIVATE'));
});

const metadataOnly=x=>{delete x.$workers.requestId;x.$metadata.requestId='platform-request:CaseSensitive';return x;};
test('metadata-only platform identity is hashed with explicit provenance',()=>{
 const rows=[metadataOnly(event()),metadataOnly(terminal())],r=projectTimeoutWindow(response(rows),{version,from,to});
 assert.equal(r.stage,'awaiting_headers');assert.equal(r.rows[0].invocationProvenance,'$metadata.requestId');assert.equal(r.rows[0].invocationDigest,r.rows[1].invocationDigest);assert(!JSON.stringify(r).includes('platform-request:CaseSensitive'));
});
test('conflicting platform fields fail closed instead of selecting a convenient ID',()=>{
 const x=event();x.$metadata.requestId='different';const r=timeoutMetadata(x,version);assert.equal(r.invocationDigest,null);assert(r.gaps.includes('platform_invocation_conflict'));
 const same=event();same.$metadata.requestId=id;assert.equal(timeoutMetadata(same,version).invocationProvenance,'$workers.requestId+$metadata.requestId');
});
test('absent or invalid platform identity does not use caller trace or event identity',()=>{
 for(const value of [undefined,'',{},'x'.repeat(257),'bad\nvalue']){const x=metadataOnly(event());x.$metadata.requestId=value;x.$metadata.traceId=id;x.$metadata.id=id;x.source.requestId=id;assert.equal(timeoutMetadata(x,version).invocationDigest,null);}
});
test('distinct requests sharing trace do not join provider completion to HTTP503',()=>{
 const a=metadataOnly(event()),b=metadataOnly(terminal());a.$metadata.traceId=b.$metadata.traceId='shared-trace';b.$metadata.requestId='different-platform-request';
 const r=projectTimeoutWindow(response([a,b]),{version,from,to});assert.notEqual(r.rows[0].invocationDigest,r.rows[1].invocationDigest);assert.equal(r.stage,null);
});
