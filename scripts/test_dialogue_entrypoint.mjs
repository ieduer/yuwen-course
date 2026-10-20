import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../site/_worker.js';

test('enabled dialogue takes over root and index without redirecting or discarding legacy access',async()=>{
 const paths=[];const env={YW_DIALOGUE_ENABLED:'true',ASSETS:{fetch:async request=>{paths.push(new URL(request.url).pathname);return new Response('asset');}}};
 for(const path of ['/', '/index.html']){const result=await worker.fetch(new Request(`https://yw.bdfz.net${path}`),env,{});assert.equal(await result.text(),'asset');assert.equal(paths.at(-1),'/dialogue');}
 await worker.fetch(new Request('https://yw.bdfz.net/?view=legacy'),env,{});assert.equal(paths.at(-1),'/');
 env.YW_DIALOGUE_ENABLED='false';await worker.fetch(new Request('https://yw.bdfz.net/'),env,{});assert.equal(paths.at(-1),'/');
});
