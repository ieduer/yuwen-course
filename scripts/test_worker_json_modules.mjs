import test from 'node:test';
import assert from 'node:assert/strict';
import {answerFreeProjection} from './answer_free_artifact.mjs';
const file=(path,text)=>({path,bytes:Buffer.from(text)});
test('Worker JSON is emitted as native ESM with equal private values and redirected imports',async()=>{
 const value=JSON.parse('{"answerIndex":2,"studentAnswer":"漢字\\n😀","nested":[null,false,1],"__proto__":{"safe":true}}');
 const input=[file('_worker.js',"import packet from './packet.json' with {type:'json'}; export default packet;"),file('packet.json',JSON.stringify(value))];
 const before=input.map(f=>f.bytes.toString());
 const a=answerFreeProjection(input),b=answerFreeProjection(input);
 assert.deepEqual(a.files,b.files,'deterministic');assert.deepEqual(input.map(f=>f.bytes.toString()),before,'source unchanged');
 assert(!a.files.some(f=>f.path==='_worker.js/packet.json'));
 const mod=a.files.find(f=>f.path==='_worker.js/packet.json.js');assert(mod);
 assert.deepEqual((await import('data:text/javascript;base64,'+mod.bytes.toString('base64'))).default,value);
 const entry=a.files.find(f=>f.path==='_worker.js/index.js').bytes.toString();
 assert.match(entry,/from '.\/packet.json.js'/);assert.doesNotMatch(entry,/with\s*\{/);
 assert.equal(a.audit.newPublicAnswerFields,0);
});
test('public browser JSON stays public and sanitized while Worker copy remains private ESM',()=>{
 const a=answerFreeProjection([file('_worker.js',"import x from './shared.json' with {type:'json'}; export default x;"),file('assets/app.js',"import x from '../shared.json' with {type:'json'};"),file('shared.json','{"prompt":"q","answerIndex":1}')]);
 assert.deepEqual(JSON.parse(a.files.find(f=>f.path==='shared.json').bytes),{prompt:'q'});
 assert(a.files.some(f=>f.path==='_worker.js/shared.json.js'));
 assert.match(a.files.find(f=>f.path==='assets/app.js').bytes.toString(),/shared.json/);
});

test('Worker JSON conversion rejects output collisions and unsupported imports',()=>{
 assert.throws(()=>answerFreeProjection([
  file('_worker.js',"import a from './p.json' with {type:'json'}; import './p.json.js';"),
  file('p.json','{}'),file('p.json.js','export default {};')
 ]),/output collision/);
 assert.throws(()=>answerFreeProjection([
  file('_worker.js',"import a from './p.json'; export default a;"),file('p.json','{}')
 ]),/Unsupported Worker JSON import/);
});
