// r36 (owner, 2026-10-24): "調整為免費池只做Claude完全耗盡後的備用，該結語就給，確保用戶體驗。……不要設置任何教師審閱等環節，
// 這些線上項目就是學生自主學習的平台。" Evidence rules, answer keys and credit are unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {POLICY,POLICY_VERSION,projectState} from '../site/dialogue-policy.js';
import {requestDialogueBudget} from '../site/dialogue-recovery.js';

const load=id=>JSON.parse(fs.readFileSync(`site/dialogue-curriculum/${id}.json`,'utf8'));
const row=(objectiveId,outcome,policyVersion='yw-dialogue-policy-v21')=>({objectiveId,outcome,evidence:[],rationale:'t',ruleVersion:'t',policyVersion});
const budgetJson=fs.readFileSync('wrangler.toml','utf8').match(/YW_DIALOGUE_BUDGET_JSON\s*=\s*'([^']+)'/)?.[1];

test('Claude first: each dispatch asks for one attempt, the turn keeps three, the reserve is unchanged',()=>{
 assert.ok(budgetJson,'the production budget policy is read from wrangler.toml');
 const b=requestDialogueBudget({YW_DIALOGUE_BUDGET_JSON:budgetJson,YW_DIALOGUE_PROVIDER_ATTEMPTS:'3'},{id:1},'lesson-1578');
 assert.ok(b.primaryModel,'the production policy is Claude-primary');
 assert.equal(b.providerAttemptLimit,1,'no free-pool attempt after a failed Claude attempt in the same call');
 assert.equal(b.logicalProviderAttemptLimit,3,'the learner-visible retry still has room, and goes to Claude again');
 assert.equal(b.reserveMicros,b.perAttemptReserveMicros+b.fallbackReserveMicros*2,'the turn reserve formula is unchanged');
});

test('the 尚友 conclusion is not sent with the free-pool-only schema on the Claude-first path',()=>{
 const src=fs.readFileSync('site/dialogue-source.js','utf8');
 assert.match(src,/const responseJsonSchema=budget\.primaryModel\?null:dialogueConclusionSchema\(/);
});

test('no teacher review: the author never records review, holds and unsettled reviews never block, an earlier completion counts',()=>{
 assert.equal(POLICY_VERSION,'yw-dialogue-policy-v21');
 assert.match(POLICY,/本平台是學生自主學習，沒有教師覆核環節：不要記 review/);
 assert.doesNotMatch(POLICY,/判斷不確定則review/);assert.doesNotMatch(POLICY,/只能給 review/);assert.doesNotMatch(POLICY,/尚未達到時可討論或記review/);
 const c=load('lesson-1499'),plain=c.objectives.find(o=>o.domain==='wordCreation')||c.objectives.find(o=>o.domain==='transfer');
 const later=projectState(c,[row(plain.id,'review')],[]).objectives.find(o=>o.id===plain.id);
 assert.equal(later.requiredForCompletion,false,'an unsettled review is optional practice, not a teacher hold');assert.equal(later.reviewPath,'optional-practice');
 const shang=c.objectives.find(o=>o.domain==='shangyou');
 if(shang){const s=projectState(c,[row(shang.id,'review')],[]).objectives.find(o=>o.id===shang.id);assert.equal(s.status,'needs_practice');assert.notEqual(s.requiredForCompletion,false);}
 const held=load('lesson-1497'),item=held.languagePractice.find(v=>v.calibrationStatus!=='accepted');
 if(held.objectives.some(o=>o.id===item.id)){const h=projectState(held,[],[]).objectives.find(o=>o.id===item.id);assert.equal(h.requiredForCompletion,false,'a calibration hold never blocks completion');}
 // A preserved earlier completion counts as done for 尚友 readiness; nothing else is assumed.
 const ordinary=c.objectives.filter(o=>!['shangyou','legacy','studyGuide'].includes(o.domain));
 const legacy=ordinary.map(o=>({objectiveId:o.id,previousCompletion:true}));
 const all=projectState(c,[],legacy);
 assert.ok(all.objectives.filter(o=>ordinary.some(x=>x.id===o.id)).every(o=>o.status==='historical_review'));
 assert.equal(projectState(c,ordinary.map(o=>row(o.id,'demonstrated')),[]).readyForShangyou,projectState(c,[],legacy).readyForShangyou,'historical completions count the same as demonstrated for readiness');
});

test('no teacher wording on the student pages',()=>{
 for(const f of ['site/assets/dialogue.js','site/dialogue.html','site/dialogue-corrections.js']){
  const s=fs.readFileSync(f,'utf8');assert.doesNotMatch(s,/教師|教师|覆核/,f);
 }
 const src=fs.readFileSync('site/dialogue-source.js','utf8');assert.doesNotMatch(src.replace(/teacher_review_\w+/g,''),/交由教師|教師覆核|任課教師/);
});
