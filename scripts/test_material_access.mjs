import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
const source=readFileSync(new URL('../site/assets/app.js',import.meta.url),'utf8');
const part=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
function harness(fetch){
 const calls={renders:0,timers:0};
 const state={current:{id:'lesson-fixture'},vocabBanks:new Map(),vocabBankLoading:new Set(),vocabBankStatus:new Map(),studyGuideLessons:new Map(),studyGuideCatalogStatus:'loading'};
 const helpers=source.includes('function vocabularyAnswerAvailable')?part('function vocabularyAnswerAvailable','async function fetchStudyGuideCatalog'):'';
 return new Function('fetch','state','calls',`
 let progressOwnerScope='owner-a',interactionIdentityResolved=true,materialGeneration=0;
 const ANONYMOUS_UI_SCOPE='anonymous', STUDY_GUIDE_CATALOG_TIMEOUT_MS=1000, STUDY_GUIDE_CATALOG_RETRY_DELAYS_MS=[100];
 let studyGuideCatalogRefreshPromise=null,studyGuideCatalogRetryTimer=null,studyGuideCatalogRetryAttempt=0;
 const setTimeout=()=>{calls.timers++;return 1},clearTimeout=()=>{};
 const renderCheckStage=()=>calls.renders++,renderMatrix=()=>{},renderMastery=()=>{},lessonHasVocabulary=()=>true;
 const esc=x=>String(x),userCenterLoginUrl=()=>'/login';
 ${helpers}
 ${part('async function fetchStudyGuideCatalog','function hexDigest')}
 ${part('async function ensureVocabBank','function quizRecord')}
 return {state,calls,refresh:refreshStudyGuideCatalog,install:installStudyGuideCatalog,vocab:ensureVocabBank,
  reset:typeof resetAssessmentMaterials==='function'?resetAssessmentMaterials:null,
  resume:typeof refreshAssessmentMaterials==='function'?refreshAssessmentMaterials:null,
  notice:typeof materialAccessNotice==='function'?materialAccessNotice:null,
  identity(owner){progressOwnerScope=owner;interactionIdentityResolved=true;}};
 `)(fetch,state,calls);
}
const catalog=(answer=true)=>({schemaVersion:'yw-study-guide-catalog-v1',catalogVersion:'yw-study-guides-'+'a'.repeat(16),catalogDigest:'sha256:'+'b'.repeat(64),lessonCount:1,lessons:[{lessonId:'lesson-fixture',items:[{itemKey:'fixture',activeForSelfTest:true,...(answer?{referenceAnswer:'synthetic reference'}:{})}]}]});
const bank=(answer=true)=>({lessonId:'lesson-fixture',inventory:[{id:'fixture',decision:'question',options:['a','b'],...(answer?{answerIndex:1}:{})}]});
test('401 is login-required, not a retryable catalog outage',async()=>{
 const h=harness(async()=>new Response('',{status:401}));await h.refresh();assert.equal(h.state.studyGuideCatalogStatus,'login_required');assert.equal(h.calls.timers,1,'only request deadline, no retry');
});
test('missing reference answer cannot be installed as a valid catalog',()=>{
 const h=harness(()=>{});assert.equal(h.install(catalog(false)),false);assert.equal(h.state.studyGuideLessons.size,0);
});
test('valid authoritative catalog still installs without changing original data',()=>{
 const actual=JSON.parse(readFileSync(new URL('../site/data/study-guide-catalog.json',import.meta.url),'utf8'));
 const before=JSON.stringify(actual);const h=harness(()=>{});assert.equal(h.install(actual),true);assert.equal(JSON.stringify(actual),before);
});
test('vocabulary401 remains a login gate, not an absent bank',async()=>{
 let requests=0;const h=harness(async()=>{requests++;return new Response('',{status:401})});await h.vocab(h.state.current);await h.vocab(h.state.current);
 assert.equal(requests,1);assert.equal(h.state.vocabBankStatus.get('lesson-fixture'),'login_required');assert.equal(h.state.vocabBanks.has('lesson-fixture'),false);
 assert.match(h.notice('login_required'),/登入 My/);assert.doesNotMatch(h.notice('login_required'),/暫時無法/);
});
test('login resumes both protected material reads after prior401',async()=>{
 let loggedIn=false;const paths=[];const h=harness(async url=>{paths.push(url);return loggedIn?Response.json(url.includes('/vocab/')?bank():catalog()):new Response('',{status:401})});
 await h.refresh();await h.vocab(h.state.current);loggedIn=true;h.resume();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.state.studyGuideCatalogStatus,'available');assert.equal(h.state.vocabBanks.get('lesson-fixture').questions[0].answerIndex,1);assert.equal(paths.length,4);assert(paths.every(p=>p.startsWith('/api/reading/materials/')));
});
test('missing or invalid vocabulary answer stops before bank is exposed',async()=>{
 for(const value of [undefined,-1,2,'1']){
  const b=bank(false);if(value!==undefined)b.inventory[0].answerIndex=value;
  const h=harness(async()=>Response.json(b));await h.vocab(h.state.current);
  assert.equal(h.state.vocabBankStatus.get('lesson-fixture'),'update_required');assert.equal(h.state.vocabBanks.has('lesson-fixture'),false);
 }
});
test('missing catalog answers produce update notice without automatic retry',async()=>{
 const h=harness(async()=>Response.json(catalog(false)));await h.refresh();assert.equal(h.state.studyGuideCatalogStatus,'update_required');assert.equal(h.calls.timers,1);assert.match(h.notice('update_required'),/重新載入/);assert.doesNotMatch(h.notice('update_required'),/人工複核/);
});
test('logout clears protected materials and makes no anonymous request',async()=>{
 let requests=0;const h=harness(async url=>{requests++;return Response.json(url.includes('/vocab/')?bank():catalog())});await h.refresh();await h.vocab(h.state.current);
 h.identity('anonymous');h.reset();h.resume();await h.vocab(h.state.current);
 assert.equal(requests,2);assert.equal(h.state.studyGuideLessons.size,0);assert.equal(h.state.vocabBanks.size,0);assert.equal(h.state.studyGuideCatalogStatus,'login_required');
});
test('old account pending responses cannot replace new-account materials',async()=>{
 const pending=[];let phase=0;const h=harness(url=>phase?Promise.resolve(Response.json(url.includes('/vocab/')?bank():catalog())):new Promise(resolve=>pending.push(resolve)));
 const oldCatalog=h.refresh(),oldBank=h.vocab(h.state.current);h.identity('owner-b');h.reset();phase=1;await h.refresh();await h.vocab(h.state.current);
 pending.forEach(resolve=>resolve(new Response('',{status:401})));await Promise.all([oldCatalog,oldBank]);
 assert.equal(h.state.studyGuideCatalogStatus,'available');assert.equal(h.state.vocabBanks.size,1);assert.equal(h.state.vocabBankStatus.size,0);
});
test('403 is terminal access refusal, not an automatic retry loop',async()=>{
 const h=harness(async()=>new Response('',{status:403}));await h.refresh();await h.vocab(h.state.current);assert.equal(h.state.studyGuideCatalogStatus,'forbidden');assert.equal(h.state.vocabBankStatus.get('lesson-fixture'),'forbidden');assert.equal(h.calls.timers,1);
});
test('legacy browser blueprint survives packing without restoring answers',async()=>{
 const {answerFreeProjection}=await import('./answer_free_artifact.mjs');
 const file=(path,bytes)=>({path,bytes:Buffer.from(bytes)});
 const result=answerFreeProjection([
  file('_worker.js',"import rules from './lesson-blueprint-rules.js'; import data from './assessment-private-data.js'; export default {rules,data};"),
  file('assessment-private-data.js','export default null;'),
  file('assets/app.js',source),
  file('lesson-blueprint-rules.js',readFileSync(new URL('../site/lesson-blueprint-rules.js',import.meta.url),'utf8')),
  file('data/bank.json','{"answerIndex":1,"prompt":"synthetic"}')]);
 assert(result.files.some(f=>f.path==='lesson-blueprint-rules.js'),'browser required module must remain public');
 assert.equal(result.audit.newPublicAnswerFields,0);
 assert.deepEqual(JSON.parse(result.files.find(f=>f.path==='data/bank.json').bytes),{prompt:'synthetic'});
});
