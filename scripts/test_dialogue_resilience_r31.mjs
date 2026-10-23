import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {projectState,contextFor,promptParts,CONTEXT_DATA_MARKER,POLICY,LIMITS} from '../site/dialogue-policy.js';
import {READING_CONVERSATION_POLICY} from '../site/dialogue-reading-evidence.js';
import {reconciledCost,dialogueBudget} from '../site/dialogue-budget.js';
import {retainedRejected,RETAINED_MAX_CHARS} from '../site/dialogue-source.js';

const load=id=>JSON.parse(fs.readFileSync(`site/dialogue-curriculum/${id}.json`,'utf8'));
const prompt=(c,turns)=>READING_CONVERSATION_POLICY+'\n'+contextFor({curriculum:c,state:projectState(c,[],[],null,c.mode==='classical'?{phase:'close_reading',unresolvedMarks:0}:null),turns,question:null})+'\n';
const turn=(id,content)=>({id,role:'student',content,createdAt:'2026-10-23T00:00:00Z'});

test('the prompt is sent as three byte-identical parts: policies, lesson material, turn data',()=>{
 for(const id of ['lesson-1578','lesson-1498','lesson-1717-p2']){
  const c=load(id),p=prompt(c,[turn('t1','這一句怎麼理解？')]),parts=promptParts(p);
  assert.equal(parts.length,3,id);assert.equal(parts.join(''),p,id+' joins back exactly');
  assert.ok(parts[0].endsWith(CONTEXT_DATA_MARKER));assert.ok(parts[1].startsWith('{"curriculumVersion"'));assert.ok(parts[2].startsWith(',"originalRequirements":'));
 }
 const a=promptParts(prompt(load('lesson-1578'),[turn('t1','甲')])),b=promptParts(prompt(load('lesson-1498'),[turn('t2','乙')]));
 assert.equal(a[0],b[0],'the policy part is the same for every lesson and student');
 const c1=promptParts(prompt(load('lesson-1578'),[turn('t1','第一問')])),c2=promptParts(prompt(load('lesson-1578'),[turn('t1','第一問'),{id:'t2',role:'teacher',content:'回應',createdAt:'2026-10-23T00:00:01Z'},turn('t3','第二問')]));
 assert.equal(c1[1],c2[1],'the lesson material is the same on the next turn');assert.notEqual(c1[2],c2[2]);
 assert.ok(c1[0].length>2000&&c1[1].length>2000,'both cached parts are well above the 512-token minimum');
 assert.deepEqual(promptParts('no marker here'),['no marker here']);
 assert.deepEqual(promptParts(CONTEXT_DATA_MARKER+'not json'),[CONTEXT_DATA_MARKER+'not json']);
});

test('the gateway-priced cost of a Claude attempt is used when it is within that attempt price bound',()=>{
 const policy=dialogueBudget({YW_DIALOGUE_BUDGET_JSON:fs.readFileSync('wrangler.toml','utf8').match(/^YW_DIALOGUE_BUDGET_JSON = '(.*)'$/m)[1],YW_DIALOGUE_PROVIDER_ATTEMPTS:'3'});
 assert.equal(policy.maxOutputTokens,6144);assert.equal(policy.reserveMicros,141440);
 const usage={promptTokenCount:18000,candidatesTokenCount:2000,totalTokenCount:20000,cachedContentTokenCount:14000,costMicros:31400};
 assert.equal(reconciledCost(policy,usage,'claude-sonnet-5-5'),31400);
 assert.equal(reconciledCost(policy,{...usage,costMicros:10**9},'claude-sonnet-5-5'),null,'an impossible cost is never accepted');
 assert.equal(reconciledCost(policy,{...usage,costMicros:-1},'claude-sonnet-5-5'),null);
 const {costMicros,...plain}=usage;
 assert.equal(reconciledCost(policy,plain,'claude-sonnet-5-5'),18000*2+2000*10,'without the gateway cost the old price formula applies');
 assert.equal(reconciledCost(policy,{...usage,costMicros:5},'gemini-3.8-flash'),0,'the fallback model keeps its own (free) price');
});

test('a rejected proposal part is retained privately and bounded, never credited',()=>{
 const value={reply:'r',assessments:[{objectiveId:'o',outcome:'demonstrated'}],formalAssessments:[{objectiveId:'f',score:80}],originalEvidence:{objectiveId:'x'}};
 assert.deepEqual(retainedRejected(value,[{part:'formalAssessments',code:'classical_first_read_required'}]),{retained:{formalAssessments:value.formalAssessments},retainedVersion:'yw-rejected-retained-v1'});
 assert.deepEqual(Object.keys(retainedRejected(value,[{part:'assessments',code:'unverifiable_evidence'},{part:'originalEvidence',code:'choice_not_explicit'}]).retained),['assessments','originalEvidence']);
 assert.deepEqual(retainedRejected(value,[]),{});assert.deepEqual(retainedRejected(null,[{part:'assessments'}]),{});
 const big={assessments:[{rationale:'字'.repeat(RETAINED_MAX_CHARS)}]};
 const r=retainedRejected(big,[{part:'assessments',code:'x'}]);assert.equal(r.retainedTruncated,true);assert.equal(r.retained,undefined);
});

test('the author speaks in the author style, as teacher and friend, and wisely; the gateway window is respected',()=>{
 assert.match(POLICY,/說話要像作者本人/);assert.match(POLICY,/亦師亦友/);assert.match(POLICY,/偶爾開個有分寸的玩笑/);assert.match(POLICY,/玩笑不取笑學生/);
 assert.match(POLICY,/也不為省字而省掉關鍵的解釋/);assert.match(POLICY,/回覆長短依教學需要/);assert.doesNotMatch(POLICY,/約三五百字/);
 assert.equal(LIMITS.timeoutMs,90000,'above the gateway yw stream deadline of 78 s');
});

test('only the Claude-first path splits the prompt for the gateway cache; a Gemini-only request keeps one part',async()=>{
 const {callDialogueModel}=await import('../site/dialogue-source.js');
 const c=load('lesson-1578'),p=prompt(c,[turn('t1','這一句怎麼理解？')]);let body;
 const env={APIS_CALLER_TOKEN:'synthetic',APIS:{fetch:async r=>{body=await r.json();return new Response(null,{status:400});}}};
 await assert.rejects(()=>callDialogueModel(env,p,'r31-split',()=>{},{model:'gemini-3.8-flash',primaryModel:'claude-sonnet-5-5',providerAttemptLimit:3,maxOutputTokens:6144}),/gateway_unavailable/);
 assert.equal(body.contents[0].parts.length,3);assert.equal(body.contents[0].parts.map(x=>x.text).join(''),p);assert.deepEqual(body.cacheBreakpoints,[0,1]);assert.equal(body.generationConfig.maxOutputTokens,6144);
 await assert.rejects(()=>callDialogueModel(env,p,'r31-plain',()=>{},{model:'gemini-3.8-flash',providerAttemptLimit:1}),/gateway_unavailable/);
 assert.equal(body.contents[0].parts.length,1);assert.equal(body.contents[0].parts[0].text,p);assert.equal(body.cacheBreakpoints,undefined);
});
