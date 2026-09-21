import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createPendingEvaluationRecovery} from '../site/assets/pending-evaluation-recovery.js';
function fixture(replay) {
  let at=0, id=0; const timers=new Map();
  const state={key:'owner-a:lesson-a',active:true};
  const controller=createPendingEvaluationRecovery({context:()=>({...state}),replay,now:()=>at,
    setTimer:(callback,delay)=>{timers.set(++id,{callback,at:at+delay});return id;},clearTimer:id=>timers.delete(id)});
  return {state,controller,timers,setTime:value=>{at=value;},async advance(ms){at+=ms;for(const [key,t]of [...timers])if(t.at<=at){timers.delete(key);await t.callback();}}};
}
test('temporary failure resumes after cooldown and successful result stops',async()=>{
 let calls=0;const f=fixture(async()=>++calls===1?{retryAfterSeconds:15}:{});
 f.controller.request();await f.advance(0);assert.equal(calls,1);
 await f.advance(59_999);assert.equal(calls,1);await f.advance(1);assert.equal(calls,2);assert.equal(f.timers.size,0);
});
test('focus and render never shorten a server rate window',async()=>{
 let calls=0;const f=fixture(async()=>{calls++;return {retryAfterSeconds:500};});
 f.controller.request();await f.advance(0);await f.advance(50_000);f.controller.request();
 await f.advance(449_999);assert.equal(calls,1);await f.advance(1);assert.equal(calls,2);
});
test('at most three passes run in a ten minute window',async()=>{
 let calls=0;const f=fixture(async()=>{calls++;return {retryAfterSeconds:60};});
 f.controller.request();await f.advance(0);await f.advance(60_000);await f.advance(60_000);
 assert.equal(calls,3);f.controller.request();await f.advance(60_000);assert.equal(calls,3);assert.equal(f.timers.size,0);
 await f.advance(420_000);f.controller.request();await f.advance(0);assert.equal(calls,4);
});
test('hidden or offline pages make no retry, reopening can continue',async()=>{
 let calls=0;const f=fixture(async()=>{calls++;return {retryAfterSeconds:60};});
 f.controller.request();await f.advance(0);f.state.active=false;f.controller.suspend();await f.advance(60_000);assert.equal(calls,1);
 f.controller.request();assert.equal(f.timers.size,0);f.state.active=true;f.controller.request();await f.advance(0);assert.equal(calls,2);
});
test('overlapping wakes cannot start concurrent passes',async()=>{
 let calls=0,finish;const f=fixture(()=>{calls++;return new Promise(resolve=>{finish=resolve;});});
 f.controller.request();const running=f.advance(0);f.controller.request();f.controller.request();assert.equal(calls,1);assert.equal(f.timers.size,0);
 finish({});await running;assert.equal(calls,1);
});
test('account or lesson changes invalidate old asynchronous callbacks',async()=>{
 let finish,isCurrent;const f=fixture((_,check)=>{isCurrent=check;return new Promise(resolve=>{finish=resolve;});});
 f.controller.request();const running=f.advance(0);assert(isCurrent());f.state.key='owner-b:lesson-b';assert(!isCurrent());
 finish({retryAfterSeconds:60});await running;assert.equal(f.timers.size,0);
});
test('identity suspension invalidates a callback even when the same account returns',async()=>{
 let finish,isCurrent;const f=fixture((_,check)=>{isCurrent=check;return new Promise(resolve=>{finish=resolve;});});
 f.controller.request();const running=f.advance(0);f.controller.suspend();assert(!isCurrent());finish({retryAfterSeconds:60});await running;assert.equal(f.timers.size,0);
});
test('a new owner waits for the old pass to settle and then starts its own pass',async()=>{
 let finish;const keys=[];const f=fixture(({key})=>{keys.push(key);return keys.length===1?new Promise(resolve=>{finish=resolve;}):{};});
 f.controller.request();const running=f.advance(0);f.state.key='owner-b:lesson-b';f.controller.request();assert.equal(keys.length,1);
 finish({retryAfterSeconds:60});await running;await f.advance(0);assert.deepEqual(keys,['owner-a:lesson-a','owner-b:lesson-b']);
});

const app=readFileSync(new URL('../site/assets/app.js',import.meta.url),'utf8');
function replayFixture(fetcher){
 const lesson={id:'lesson-a'},progress={studyGuide:{item:{clientMutationId:'capture-a',pendingSync:true,completed:false}}};
 const state={current:lesson,pendingReplayAttempted:new Set()};let saved=0;
 const body=app.slice(app.indexOf('function pendingEvaluationRetryDelay'),app.indexOf('\nfunction mergeInteractionConversation'));
 const f=new Function('state','progressOwnerScope','interactionIdentityResolved','ANONYMOUS_UI_SCOPE','lessonProgress','studyGuideProgress','saveStoredProgress','renderCheckStage','submitInteraction','fetch','flushSharedState','pendingReplayErrorIsRetryable',body+'; return {replay:replayCapturedLearningSubmissions,reconcile:reconcileResumedStudyGuide};')(
 state,'owner-a',true,'anonymous',()=>progress,x=>x.studyGuide,()=>{saved++;},()=>{},()=>{},fetcher,()=>{},e=>e.status>=500);
 return {...f,lesson,progress,state,saved:()=>saved};
}
test('captured resume keeps its mutation across503 and reconciles the eventual source result',async()=>{
 let attempts=0;const sent=[];const f=replayFixture(async(url,options)=>{
  if(url.includes('?'))return Response.json({submissions:[{clientMutationId:'capture-a',interaction:'studyGuideItemCompleted'}]});
  sent.push(JSON.parse(options.body));attempts++;
  return attempts===1?Response.json({code:'learning_evaluator_unavailable',retryAfterSeconds:90},{status:503}):Response.json({ok:true,passed:true,assessment:{score:80},evidence:{sourceEventId:'source-a',eligibilityStatus:'eligible'}});
 });
 assert.equal((await f.replay(f.lesson,()=>true)).retryAfterSeconds,90);assert.equal(f.progress.studyGuide.item.pendingSync,true);
 await f.replay(f.lesson,()=>true);assert.deepEqual(sent,[{clientMutationId:'capture-a'},{clientMutationId:'capture-a'}]);
 assert.equal(f.progress.studyGuide.item.pendingSync,false);assert.equal(f.progress.studyGuide.item.completed,true);assert.equal(f.saved(),1);
});
test('an account switch while the pending list loads prevents any resume POST',async()=>{
 let finish,calls=0,active=true;const f=replayFixture(()=>{calls++;return new Promise(resolve=>{finish=resolve;});});
 const running=f.replay(f.lesson,()=>active);active=false;finish(Response.json({submissions:[{clientMutationId:'capture-a',interaction:'studyGuideItemCompleted'}]}));
 await running;assert.equal(calls,1);assert.equal(f.saved(),0);
});
test('an aborted response body stays pending and permits the same captured retry',async()=>{
 let calls=0;const f=replayFixture(async url=>{
  if(url.includes('?'))return Response.json({submissions:[{clientMutationId:'capture-a',interaction:'studyGuideItemCompleted'}]});
  calls++;return {ok:true,status:200,json:async()=>{throw new DOMException('body aborted','AbortError');}};
 });
 assert.equal((await f.replay(f.lesson,()=>true)).retryAfterSeconds,60);
 assert.equal(f.progress.studyGuide.item.pendingSync,true);assert.equal(f.saved(),0);
 assert.equal(f.state.pendingReplayAttempted.has('capture-a'),false);
 await f.replay(f.lesson,()=>true);assert.equal(calls,2);
});
test('expired authentication stops the pass before the next capture',async()=>{
 let posts=0;const f=replayFixture(async url=>{
  if(url.includes('?'))return Response.json({submissions:[{clientMutationId:'capture-a'},{clientMutationId:'capture-b'}]});
  posts++;return Response.json({code:'authenticated_evaluation_required'},{status:401});
 });
 assert.deepEqual(await f.replay(f.lesson,()=>true),{});assert.equal(posts,1);assert.equal(f.saved(),0);
 assert.equal(f.state.pendingReplayAttempted.has('capture-a'),false);
});
test('an old resume response cannot update the new owner or send the next item',async()=>{
 let finish,calls=0,active=true;const f=replayFixture(async url=>{
  calls++;if(url.includes('?'))return Response.json({submissions:[{clientMutationId:'capture-a',interaction:'studyGuideItemCompleted'},{clientMutationId:'capture-b',interaction:'studyGuideItemCompleted'}]});
  return new Promise(resolve=>{finish=resolve;});
 });
 const running=f.replay(f.lesson,()=>active);while(!finish)await new Promise(resolve=>setImmediate(resolve));active=false;
 finish(Response.json({ok:true,passed:true,assessment:{score:90},evidence:{sourceEventId:'source-a',eligibilityStatus:'eligible'}}));
 await running;assert.equal(calls,2);assert.equal(f.saved(),0);assert.equal(f.state.pendingReplayAttempted.has('capture-a'),false);
});
test('pending remains unscored without a receipt and a real ineligible result remains incomplete',()=>{
 const f=replayFixture(()=>{});assert.equal(f.reconcile('lesson-a','capture-a',{ok:true,passed:true}),false);assert.equal(f.progress.studyGuide.item.pendingSync,true);
 assert.equal(f.reconcile('lesson-a','capture-a',{ok:true,passed:false,assessment:{score:40},evidence:{sourceEventId:'source-a',eligibilityStatus:'ineligible'}}),true);
 assert.equal(f.progress.studyGuide.item.pendingSync,false);assert.equal(f.progress.studyGuide.item.completed,false);
});
