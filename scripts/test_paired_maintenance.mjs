import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../site/_worker.js';
const origin='https://yw.bdfz.net';
const path='/api/internal/caller-identity';
const blocked=['/api/chat','/api/learning-check','/api/lesson-blueprint','/api/interaction-check','/api/learning/pending-interactions/resume','/api/learning/interactions','/api/reading/submission','/api/reading/study-guide-attempt','/api/internal/evaluation-jobs/execute','/api/discussions/lesson-1458'];
const deny=new Proxy({}, {get(){throw new Error('downstream access forbidden');}});
for(const route of blocked) test(`maintenance rejects ${route} before any dependency`,async()=>{
 const r=await worker.fetch(new Request(origin+route,{method:'POST',body:'{}'}),{YW_RELEASE_READ_ONLY:'true',READING_DB:deny,APIS:deny,USER_CENTER_EVIDENCE:deny},deny);
 assert.equal(r.status,503);assert.deepEqual(await r.json(),{ok:false,code:'release_read_only',error:'網站維護中，這次內容尚未送出。請保留草稿，稍後手動重送。',retryable:false,admitted:false});
});
for(const route of ['/api/learning/health','/api/preview?url=https://fixture.invalid']) test(`maintenance suppresses side-effect GET ${route}`,async()=>{
 const r=await worker.fetch(new Request(origin+route),{YW_RELEASE_READ_ONLY:'true',READING_DB:deny,APIS:deny,PREVIEW_LOGS:deny},deny);assert.equal(r.status,503);
});
test('maintenance preserves ordinary asset reads',async()=>{
 const r=await worker.fetch(new Request(origin+'/'),{YW_RELEASE_READ_ONLY:'true',ASSETS:{fetch:()=>new Response('old textbook')}},deny);assert.equal(await r.text(),'old textbook');
});
function env(overrides={}) {return {YW_RELEASE_READ_ONLY:'true',YW_DIALOGUE_ACCEPTANCE_USER_ID:'553',YW_DIALOGUE_ACCEPTANCE_EXPIRES_AT:new Date(Date.now()+300000).toISOString(),APIS_CALLER_TOKEN:'fixture-only',USER_CENTER_EVIDENCE:{resolveSession:async()=>({authenticated:true,sourceSiteKey:'yw',userId:553,slug:'fixture'})},READING_DB:deny,...overrides};}
function request(headers={}) {return new Request(origin+path,{headers:{cookie:'bdfz_uc_session=fixture','x-yw-caller-check':'1',...headers}});}
test('operator identity check is one zero-model APIS request, never D1, no raw response leakage',async()=>{
 let calls=0;const r=await worker.fetch(request(),env({APIS:{fetch:async req=>{calls++;assert.equal(new URL(req.url).pathname,'/caller-identity');assert.equal(req.headers.get('x-project-name'),'yw.bdfz.net');assert.equal(req.headers.get('x-internal-token'),'fixture-only');assert.equal(await req.text(),'');return Response.json({callerId:'yw.bdfz.net',identityStatus:'verified',mode:'log-only',requestId:'fixture-request',privateField:'not-returned'});}}}),deny);
 assert.equal(r.status,200);assert.equal(calls,1);assert.deepEqual(await r.json(),{ok:true,callerId:'yw.bdfz.net',identityStatus:'verified'});assert.equal(r.headers.get('cache-control'),'private, no-store');
});
for(const [name,overrides,headers] of [
 ['off',{YW_RELEASE_READ_ONLY:'false'},{}],['expired',{YW_DIALOGUE_ACCEPTANCE_EXPIRES_AT:'2000-01-01T00:00:00Z'},{}],['too long',{YW_DIALOGUE_ACCEPTANCE_EXPIRES_AT:new Date(Date.now()+3600000).toISOString()},{}],['missing expiry',{YW_DIALOGUE_ACCEPTANCE_EXPIRES_AT:undefined},{}],['wrong config owner',{YW_DIALOGUE_ACCEPTANCE_USER_ID:'554'},{}],['anonymous',{}, {cookie:''}],['cross origin',{}, {origin:'https://evil.invalid'}],['missing header',{}, {'x-yw-caller-check':''}],['revoked',{USER_CENTER_EVIDENCE:{resolveSession:async()=>({authenticated:false})}},{}],['wrong owner',{USER_CENTER_EVIDENCE:{resolveSession:async()=>({authenticated:true,sourceSiteKey:'yw',userId:554,slug:'other'})}},{}],['wrong site',{USER_CENTER_EVIDENCE:{resolveSession:async()=>({authenticated:true,sourceSiteKey:'other',userId:553,slug:'fixture'})}},{}],
]) test(`caller check rejects ${name} without APIS`,async()=>{const r=await worker.fetch(request(headers),env({APIS:deny,...overrides}),deny);assert.notEqual(r.status,200);});
test('fresh identity resolution prevents stale owner cache accepting a revoked session',async()=>{
 let n=0,calls=0;const e=env({USER_CENTER_EVIDENCE:{resolveSession:async()=>++n===1?{authenticated:true,sourceSiteKey:'yw',userId:553,slug:'fixture'}:{authenticated:false}},APIS:{fetch:async()=>{calls++;return Response.json({callerId:'yw.bdfz.net',identityStatus:'verified',requestId:'fixture-request'});}}});
 assert.equal((await worker.fetch(request(),e,deny)).status,200);assert.notEqual((await worker.fetch(request(),e,deny)).status,200);assert.equal(calls,1);
});
for(const body of [{callerId:'other',identityStatus:'verified',requestId:'fixture'},{callerId:'yw.bdfz.net',identityStatus:'unverified',requestId:'fixture'},null]) test(`APIS mismatch stays terminal and does not echo response ${JSON.stringify(body)}`,async()=>{
 let calls=0;const r=await worker.fetch(request(),env({APIS:{fetch:async()=>{calls++;return Response.json(body);}}}),deny);assert.equal(r.status,502);assert.equal(calls,1);assert.deepEqual(await r.json(),{ok:false,code:'caller_identity_unverified',retryable:false});
});

test('disabled maintenance retains the accepted chat response',async()=>{
 const r=await worker.fetch(new Request(origin+'/api/chat',{method:'POST'}),{YW_RELEASE_READ_ONLY:'false'},deny);assert.notEqual(r.status,503);
});
for(const [name,respond] of [['rejected',()=>new Response('private upstream text',{status:401})],['oversized',()=>new Response('x'.repeat(2049))],['transport',()=>{throw new Error('private transport detail');}]]) test(`identity ${name} has one attempt and sanitized terminal result`,async()=>{
 let calls=0;const r=await worker.fetch(request(),env({APIS:{fetch:async()=>{calls++;return respond();}}}),deny);assert.equal(r.status,502);assert.equal(calls,1);assert.deepEqual(await r.json(),{ok:false,code:'caller_identity_unverified',retryable:false});
});
