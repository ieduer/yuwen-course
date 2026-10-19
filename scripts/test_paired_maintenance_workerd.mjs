import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {Miniflare,Log,LogLevel} from 'miniflare';
const root=resolve(import.meta.dirname,'..');
test('actual workerd maintenance gate blocks machine and foreground writes; operator identity uses Service Binding without provider/D1',async()=>{
 let calls=0;
 const mf=new Miniflare({log:new Log(LogLevel.NONE),workers:[
 {name:'yw',compatibilityDate:'2026-05-12',modules:true,modulesRoot:root,modulesRules:[{type:'ESModule',include:['**/*.js']}],scriptPath:resolve(root,'site/_worker.js'),
 bindings:{YW_RELEASE_READ_ONLY:'true',YW_DIALOGUE_ACCEPTANCE_USER_ID:'553',YW_DIALOGUE_ACCEPTANCE_EXPIRES_AT:new Date(Date.now()+300000).toISOString(),APIS_CALLER_TOKEN:'fixture-only'},
 serviceBindings:{ASSETS:()=>new Response('baseline content'),APIS:async request=>{calls++;assert.equal(new URL(request.url).pathname,'/caller-identity');assert.equal(request.headers.get('x-internal-token'),'fixture-only');return Response.json({callerId:'yw.bdfz.net',identityStatus:'verified',requestId:'fixture-request'});},USER_CENTER_EVIDENCE:{name:'identity',entrypoint:'Identity'}},outboundService(){throw new Error('unexpected external network');}},
 {name:'identity',compatibilityDate:'2026-05-12',modules:true,script:"import {WorkerEntrypoint} from 'cloudflare:workers'; export class Identity extends WorkerEntrypoint {resolveSession(cookie){return {authenticated:cookie==='bdfz_uc_session=fixture',sourceSiteKey:'yw',userId:553,slug:'fixture'};}} export default {fetch(){return new Response('not found',{status:404});}}"},
 ]});
 try {
  for(const path of ['/api/internal/evaluation-jobs/execute','/api/interaction-check','/api/reading/first-read/submit','/api/learning/pending-interactions/resume']) {
   const r=await mf.dispatchFetch('https://yw.bdfz.net'+path,{method:'POST',body:'{}'});assert.equal(r.status,503);assert.equal((await r.json()).admitted,false);
  }
  assert.equal(calls,0);assert.equal(await (await mf.dispatchFetch('https://yw.bdfz.net/')).text(),'baseline content');
  const r=await mf.dispatchFetch('https://yw.bdfz.net/api/internal/caller-identity',{headers:{cookie:'bdfz_uc_session=fixture','x-yw-caller-check':'1'}});
  assert.equal(r.status,200);assert.equal((await r.json()).identityStatus,'verified');assert.equal(calls,1);
 } finally {await mf.dispose();}
});
