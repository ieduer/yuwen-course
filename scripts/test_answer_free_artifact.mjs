import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {answerFreeProjection,auditAnswerFreeFiles,stripAnswerFields} from './answer_free_artifact.mjs';
import {projectReleaseJson} from './build_release_site.mjs';
const file=(name,value)=>({path:name,bytes:Buffer.from(typeof value==='string'?value:JSON.stringify(value))});
test('Worker aggregate remains below the 25 MiB uncompressed provider limit',()=>{
 const root=path.resolve(import.meta.dirname,'../.release/site/_worker.js');
 let bytes=0;
 function walk(dir){for(const name of fs.readdirSync(dir)){const p=path.join(dir,name);if(fs.statSync(p).isDirectory())walk(p);else bytes+=fs.statSync(p).size;}}
 walk(root);
 assert.ok(bytes<25*1024*1024,`Worker modules total ${bytes} bytes`);
});
test('nested alternate public paths cannot retain answer fields',()=>{
 const data={prompt:'Keep prompt',nested:[{answerIndex:2,sourceAnswer:'key',meaning:'key meaning',explanation:'key explanation',options:['a','b','c']}],referenceAnswer:{choice:'c'}};
 assert.deepEqual(stripAnswerFields({definitions:{vocabAnswer:{scoringRole:'formal'}}}),{definitions:{vocabAnswer:{scoringRole:'formal'}}});
 assert.throws(()=>auditAnswerFreeFiles([file('embedded.html','<script>const hidden={answerIndex:2}</script>')]),/Public answer fields/);
 const clean=stripAnswerFields(data);
 assert.deepEqual(clean,{prompt:'Keep prompt',nested:[{options:['a','b','c']}]});
 assert.equal(data.nested[0].answerIndex,2);
 for(const name of ['data/bank.json','aliases/copy.json','encoded%2fpath.json','aliases/copy.txt','assets/disguised.js'])assert.throws(()=>auditAnswerFreeFiles([file(name,data)]),/Public answer fields/);
});
test('Worker data stays private while static fail-open fallback is answer-free',async()=>{
 const source=[file('_worker.js',"import data from './assessment-private-data.js'; export default data;"),file('assessment-private-data.js','export default null;'),file('data/bank.json',{answerIndex:1,prompt:'q'})];
 const result=answerFreeProjection(source);
 assert.ok(result.files.some(f=>f.path==='_worker.js/index.js'));
 assert.ok(result.files.some(f=>f.path.startsWith('_worker.js/_assessment-data/')));
 assert.equal(result.files.some(f=>f.path==='assessment-private-data.js'),false);
 assert.deepEqual(JSON.parse(result.files.find(f=>f.path==='data/bank.json').bytes),{prompt:'q'});
 const privateFile=result.files.find(f=>f.path.startsWith('_worker.js/_assessment-data/'));
 assert.match(privateFile.bytes.toString(),/answerIndex/);
 assert.equal(result.audit.newPublicAnswerFields,0);
});
test('legacy exception cannot authorize changed bytes or renamed paths',()=>{
 const exceptions=JSON.parse(fs.readFileSync(new URL('./legacy-answer-exceptions.json',import.meta.url)));
 const item=exceptions.files[0];
 assert.throws(()=>auditAnswerFreeFiles([file(item.path,{answerIndex:1})]),/Public answer fields/);
 assert.throws(()=>auditAnswerFreeFiles([file(item.path+'.copy.json',{answerIndex:1})]),/Public answer fields/);
});
test('browser-shared module stays public; server-only module and imported packet do not',()=>{
 const result=answerFreeProjection([
  file('_worker.js',"import './server.js'; import './shared.js'; export default {};"),
  file('server.js',"import packet from './packet.json' with {type:'json'}; export default packet;"),
  file('packet.json',{studentAnswer:'fixture',answerIndex:1}),file('shared.js','export const value=1;'),
  file('assets/client.js',"import '../shared.js'; import 'https://example.test/widget.js';"),
 ]);
 assert.ok(result.files.some(f=>f.path==='shared.js'));
 assert.ok(!result.files.some(f=>['server.js','packet.json'].includes(f.path)));
 assert.ok(result.files.some(f=>f.path==='_worker.js/packet.json.js'));
});
test('full artifact every public file audited and private corpus preserves source authority',async()=>{
 const root=path.resolve(import.meta.dirname,'../.release/site');
 if(!fs.existsSync(root))throw Error('Build full artifact before this test');
 const files=[];function walk(dir,prefix=''){for(const name of fs.readdirSync(dir)){const p=path.join(dir,name),relative=prefix+name;if(fs.statSync(p).isDirectory())walk(p,relative+'/');else files.push({path:relative,bytes:fs.readFileSync(p)});}}walk(root);
 const audit=auditAnswerFreeFiles(files);assert.equal(audit.newPublicAnswerFields,0);assert.ok(audit.publicFiles>1000);
 const privateData=(await import('../.release/site/_worker.js/assessment-private-data.js')).default;
 let lessons=0;
 for(const [name,text] of Object.entries(privateData)){
  const source=fs.readFileSync(path.resolve(import.meta.dirname,'../site'+name),'utf8');
  const original=JSON.parse(source);
  assert.equal(text,projectReleaseJson(name.slice(1),source),`exact private response bytes: ${name}`);
  // Existing privacy URL projection may change retired links, not scoring keys.
  const raw=JSON.parse(text);const pairs=[];
  function keys(v,loc=''){if(Array.isArray(v))v.forEach((x,i)=>keys(x,loc+'/'+i));else if(v&&typeof v==='object')for(const [k,x]of Object.entries(v)){if(['answerIndex','referenceAnswer','sourceAnswer'].includes(k))pairs.push([loc+'/'+k,x]);keys(x,loc+'/'+k);}}
  keys(original);const expected=JSON.stringify(pairs);pairs.length=0;keys(raw);assert.equal(JSON.stringify(pairs),expected,name);
  if(name.startsWith('/dialogue-curriculum/lesson-'))lessons++;
 }
 assert.equal(lessons,189);
});

test('packed Worker keeps private material authenticated and never falls back to public answers',async()=>{
 const worker=(await import('../.release/site/_worker.js/index.js')).default;
 const data=(await import('../.release/site/_worker.js/assessment-private-data.js')).default;
 const body=data['/data/vocab/lesson-1474.json'];assert.equal(typeof body,'string');
 const env={ASSETS:{fetch:()=>{throw Error('Private material reached public assets');}}};
 const url='https://yw.test/api/reading/materials/vocab/lesson-1474.json';
 assert.equal((await worker.fetch(new Request(url),env,{})).status,401);
 assert.equal((await worker.fetch(new Request(url,{method:'POST'}),env,{})).status,405);
 const db={prepare:()=>({bind:()=>({run:async()=>({}),first:async()=>({id:1,uc_slug:'local-fixture'})})})};
 const response=await worker.fetch(new Request(url),{...env,READING_TEST_SLUG:'local-fixture',READING_DB:db},{});
 assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');
 assert.equal(await response.text(),body);
});

test('private material route denies anonymous/method misuse; authenticated fixture retains original scoring data',async()=>{
 const worker=(await import('../site/_worker.js')).default;
 let assetReads=0;const body=JSON.stringify({answerIndex:2,referenceAnswer:'fixture-only'});
 const env={ASSETS:{fetch:async()=>{assetReads++;return new Response(body);}}};
 const url='https://yw.test/api/reading/materials/vocab/lesson-1474.json';
 const anonymous=await worker.fetch(new Request(url),env,{});assert.equal(anonymous.status,401);assert.equal(assetReads,0);
 assert.equal((await worker.fetch(new Request(url,{method:'POST'}),env,{})).status,405);assert.equal(assetReads,0);
 const db={prepare:()=>({bind:()=>({run:async()=>({}),first:async()=>({id:1,uc_slug:'local-fixture'})})})};
 const authenticated=await worker.fetch(new Request(url),{...env,READING_TEST_SLUG:'local-fixture',READING_DB:db},{});
 assert.equal(authenticated.status,200);assert.equal(authenticated.headers.get('cache-control'),'private, no-store');assert.deepEqual(await authenticated.json(),JSON.parse(body));assert.equal(assetReads,1);
});
