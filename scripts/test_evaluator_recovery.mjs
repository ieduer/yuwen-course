import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateWithRecovery } from '../site/evaluator-recovery.js';
import { callApisPrompt } from '../site/_worker.js';
const transient = () => Object.assign(new Error('private provider text'), { apisStatus:503, apisCode:'DEADLINE_EXCEEDED' });

test('one completed transient failure recovers with distinct correlated calls and one deadline', async () => {
  let time=0, reserved=0;const options=[],events=[];
  const result=await evaluateWithRecovery({now:()=>time,reserve:async()=>{reserved++},emit:e=>events.push(e),evaluate:async(o)=>{options.push(o);if(options.length===1){time=8500;throw transient()}return 'strict result'}});
  assert.equal(result,'strict result');assert.equal(reserved,2);assert.equal(options[0].timeoutMs,45000);assert.equal(options[1].timeoutMs,36500);
  assert.notEqual(options[0].requestId,options[1].requestId);assert.equal(events[0].operationId,events[1].operationId);assert.doesNotMatch(JSON.stringify(events),/private provider/);
});

test('persistent transient failure stops after two accounted calls', async () => {
  let calls=0,reserved=0;await assert.rejects(evaluateWithRecovery({reserve:async()=>{reserved++},evaluate:async()=>{calls++;throw transient()},emit:()=>{}}));assert.equal(calls,2);assert.equal(reserved,2);
});

for(const [name,error] of [['transport',new Error('network')],['abort',new DOMException('cancelled','AbortError')],['quota',Object.assign(transient(),{apisCode:'QUOTA_EXHAUSTED'})],['circuit',Object.assign(transient(),{apisCode:'MODEL_CIRCUIT_OPEN'})],['admission',Object.assign(transient(),{apisStatus:429})]]){
  test(`${name} failure cannot be automatically resent`,async()=>{let n=0;await assert.rejects(evaluateWithRecovery({reserve:async()=>{},evaluate:async()=>{n++;throw error},emit:()=>{}}));assert.equal(n,1)});
}

test('insufficient deadline, cancellation and failed second budget prevent another provider call',async()=>{
  for(const mode of ['deadline','cancel','budget']){let time=0,calls=0,reserved=0;const c=new AbortController();await assert.rejects(evaluateWithRecovery({now:()=>time,signal:c.signal,emit:()=>{},reserve:async()=>{if(++reserved===2)throw Error('budget')},evaluate:async()=>{calls++;if(mode==='deadline')time=36000;if(mode==='cancel')c.abort();throw transient()}}));assert.equal(calls,1);assert.equal(reserved,mode==='budget'?2:1)}
});

test('gateway classification uses only structured code and omits private error text',async()=>{
  const env={APIS_CALLER_TOKEN:'fixture',APIS:{fetch:async(req)=>{assert.equal(req.headers.get('x-request-id'),'fixture-1');return Response.json({error_code:'DEADLINE_EXCEEDED',error:'private student text'},{status:503})}}};
  await assert.rejects(callApisPrompt(env,'private prompt','feedback','medium',{requestId:'fixture-1'}),e=>e.apisStatus===503&&e.apisCode==='DEADLINE_EXCEEDED'&&!e.message.includes('private'));
});

test('caller cancellation reaches the active gateway fetch',async()=>{
  const c=new AbortController();const env={APIS_CALLER_TOKEN:'fixture',APIS:{fetch:async(req)=>new Promise((_,reject)=>{req.signal.addEventListener('abort',()=>reject(new DOMException('cancelled','AbortError')));c.abort()})}};
  await assert.rejects(callApisPrompt(env,'fixture','feedback','medium',{signal:c.signal}),{name:'AbortError'});
});
