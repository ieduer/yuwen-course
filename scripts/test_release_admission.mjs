import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../site/_worker.js';
import {releaseAdmissionResponse} from '../site/release-admission.js';
import {drainEvaluationJobs} from '../site/durable-evaluation-jobs.js';
const paths=['/api/interaction-check','/api/learning/pending-interactions/resume','/api/learning/interactions','/api/learning/ai-readiness','/api/reading/submission','/api/reading/vocab-attempt','/api/reading/study-guide-attempt','/api/reading/first-read/mark','/api/reading/first-read/mark/delete','/api/reading/first-read/submit','/api/reading/first-read/resolve','/api/reading/first-read/reconcile','/api/dialogue/v1'];
function guardedEnv(){return {YW_RELEASE_READ_ONLY:'true',YW_DIALOGUE_ENABLED:'true',get READING_DB(){throw Error('must not reach database');},get APIS(){throw Error('must not reach provider');}};}
for(const [client,origin,headers] of [['web','https://yw.bdfz.net',{'origin':'https://yw.bdfz.net'}],['native','https://yuwen-course.pages.dev',{'authorization':'Bearer ywat_'+ 'x'.repeat(43)}]]) {
 for(const path of paths)test(`${client} ${path} denies before consuming body or touching stores`,async()=>{
   const request=new Request(origin+path,{method:'POST',headers:{...headers,'content-type':'application/json'},body:'{invalid'});
   const response=await worker.fetch(request,guardedEnv(),{});assert.equal(response.status,503);assert.equal(request.bodyUsed,false);
   assert.deepEqual(await response.json(),{ok:false,code:'release_read_only',error:'網站維護中，這次內容尚未送出。請保留草稿，稍後手動重送。',retryable:false,admitted:false});
 });
}
test('existing content-type and cross-origin rejection precede maintenance policy',async()=>{
 for(const [headers,status] of [[{},415],[{'content-type':'application/json','origin':'https://untrusted.invalid'},403]]){
  const env={get YW_RELEASE_READ_ONLY(){throw Error('must reject hostile request first');}};
  const response=await worker.fetch(new Request('https://yw.bdfz.net/api/reading/submission',{method:'POST',headers,body:'{}'}),env,{});assert.equal(response.status,status);
 }
});
test('machine dispatch and side-effecting health never start while closed',async()=>{
 for(const [path,method] of [['/api/internal/evaluation-jobs/execute','POST'],['/api/learning/health','GET']]){
  const response=await worker.fetch(new Request('https://yw.bdfz.net'+path,{method}),guardedEnv(),{waitUntil(){throw Error('must not schedule');}});assert.equal(response.status,503);
 }
});
test('ordinary reading, explicit legacy workspace and native static assets remain readable',async()=>{
 const paths=[];const env={YW_RELEASE_READ_ONLY:'true',YW_DIALOGUE_ENABLED:'true',ASSETS:{fetch:async req=>{paths.push(new URL(req.url).pathname);return new Response('readable');}}};
 for(const url of ['https://yw.bdfz.net/?view=legacy','https://yw.bdfz.net/','https://yw.bdfz.net/data/catalog.json'])assert.equal(await (await worker.fetch(new Request(url),env,{})).text(),'readable');
 assert.deepEqual(paths,['/','/dialogue.html','/data/catalog.json']);
});
test('absent/false flags keep previous behavior; closing is reversible and exact',()=>{
 for(const value of [undefined,'false',true,'TRUE'])assert.equal(releaseAdmissionResponse({YW_RELEASE_READ_ONLY:value}),null);
 assert.equal(releaseAdmissionResponse({YW_RELEASE_READ_ONLY:'true'}).status,503);
});
test('existing scheduler disabled flag performs no SQL or dispatch; scheduler source unchanged',async()=>{
 const result=await drainEvaluationJobs({YW_BACKGROUND_EVALUATION_ENABLED:'false',READING_DB:{prepare(){throw Error('noSQL');}}},()=>{throw Error('noDispatch');});assert.deepEqual(result,{disabled:true});
});
