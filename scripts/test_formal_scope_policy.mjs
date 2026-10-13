import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {FORMAL_SCOPE_POLICY,ORIGINAL_FORMAL_RELEASE,validateFormalScopeExpansion,formalDefinitionForResource,assertNewFormalAnswerTime,withProspectiveFormalScope} from '../site/formal-scope-policy.js';
import {validateAPlusCompatibilityContract} from '../site/learning-evidence-source.js';
import {validateFormalDraft} from '../site/dialogue-formal.js';
const read=path=>JSON.parse(fs.readFileSync(new URL('../'+path,import.meta.url)));
const manifest=read('site/data/learning-manifest.json'),registry=read('site/data/interaction-definitions.json'),formative=read('site/data/lesson-competency-manifest.json');
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
const digest=value=>createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const additions=manifest.items.filter(item=>item.formalScopePolicyVersion),original=manifest.items.filter(item=>!item.formalScopePolicyVersion);
const fixture=()=>{
 const item=additions.find(item=>item.sourceId==='lesson-1717-p2'&&item.questionKind==='contextWords');
 const objective={id:'legacy:'+item.resourceKey,domain:'legacy',legacy:{...item}};
 const frozen={lessonId:item.sourceId,curriculumVersion:'old-frozen',objectives:[],legacy:{formal:[]}};
 return {objective,frozen,published:{...frozen,formalScopeExpansion:FORMAL_SCOPE_POLICY,objectives:[objective],legacy:{formal:[item]}}};
};
test('all 764 new compulsory resources stay outside A-plus while 869 old identities remain exact',()=>{
 assert.equal(manifest.lessonCount,189);assert.equal(additions.length,764);assert.equal(new Set(additions.map(i=>i.sourceId)).size,88);
 assert.equal(original.length,869);
 assert.equal(digest(original.slice().sort((a,b)=>a.resourceKey.localeCompare(b.resourceKey))),'42888a94de1460c12c66554eb93d21444857c30d8914823a6a4a3459e28310f4');
 assert.equal(original.filter(i=>i.evidenceRole==='a_plus_gate').length,768);
 assert.equal(additions.filter(i=>i.evidenceRole==='formative').length,676);
 assert.equal(additions.filter(i=>i.evidenceRole==='non_scoring').length,88);
 assert(additions.every(i=>i.evidenceRole!=='a_plus_gate'&&i.sourceId!=='lesson-1572'));
 assert(original.every(i=>i.sourceReleaseId===ORIGINAL_FORMAL_RELEASE.sourceReleaseId));
 validateFormalScopeExpansion(manifest);validateAPlusCompatibilityContract(registry,manifest);
 const compatibility=registry.compatibilityContracts.aPlusGate;
 assert.equal(compatibility.eligibleItemCount,768);assert.equal(compatibility.excludedItemCount,865);
 assert.equal(compatibility.thresholdCount,692);assert.equal(compatibility.academicYearPolicy.requiredDistinctCreditUnits,692);
});
test('1697 mastery items preserve all 1021 old rows and add only formative compulsory performance',()=>{
 const items=formative.lessons.flatMap(l=>l.competencies.flatMap(c=>c.items));
 const addedKeys=new Set(additions.map(i=>i.resourceKey));
 const prior=items.filter(i=>!addedKeys.has(i.resourceKey)),newItems=items.filter(i=>addedKeys.has(i.resourceKey));
 assert.equal(items.length,1697);assert.equal(prior.length,1021);assert.equal(newItems.length,676);
 assert.equal(digest(prior.sort((a,b)=>a.completionKey.localeCompare(b.completionKey))),'20176ad08a74794e9e296827ea93273ca5f350420d8f498744beb262f8ef295f');
 assert(newItems.every(i=>i.scoringRole==='formative'&&i.sourceKind==='formal_learning_manifest'));
});
test('only source-owned published policy may override an original performance role',()=>{
 for(const item of additions){
  const key=item.questionKind==='vocabulary'?'vocabAnswer':item.questionKind;
  const originalDefinition=registry.definitions[key],result=formalDefinitionForResource(originalDefinition,item,manifest);
  assert.equal(result.scoringRole,item.questionKind==='evaluation'?'none':'formative');
  assert.equal(result.assessmentKind,originalDefinition.assessmentKind);
  assert.equal(result.verificationMethod,originalDefinition.verificationMethod);
  assert.deepEqual(result.allowedPayloadKeys,originalDefinition.allowedPayloadKeys);
 }
 const bad=structuredClone(manifest);bad.items.find(i=>i.formalScopePolicyVersion&&i.questionKind!=='evaluation').evidenceRole='a_plus_gate';
 assert.throws(()=>validateAPlusCompatibilityContract(registry,bad),/formal scope inventory invalid/);
 const forged=structuredClone(manifest);forged.formalScopeExpansion.includeInExistingAPlusGate=true;
 assert.throws(()=>validateFormalScopeExpansion(forged),/formal scope admission policy invalid/);
 const selected=original.find(i=>i.questionKind==='structure');assert.equal(formalDefinitionForResource(registry.definitions.structure,selected,manifest),registry.definitions.structure);
});
test('activation boundary rejects prior answers and old quoted history without changing future rubrics',()=>{
 const {objective,published}=fixture(),item=objective.legacy;
 assert.throws(()=>assertNewFormalAnswerTime(item,new Date(Date.parse(FORMAL_SCOPE_POLICY.effectiveFrom)-1).toISOString()),error=>error.code==='formal_scope_not_active_for_answer');
 assert.doesNotThrow(()=>assertNewFormalAnswerTime(item,FORMAL_SCOPE_POLICY.effectiveFrom));
 const turn={id:'student-old',role:'student',content:'寂靜、自由、惆悵',createdAt:'2026-10-12T00:00:00Z'};
 const draft={objectiveId:objective.id,fields:{words:{turnId:turn.id,quote:turn.content}}};
 assert.throws(()=>validateFormalDraft(published,[turn],draft),error=>error.code==='formal_scope_not_active_for_answer');
 assert(validateFormalDraft(published,[{...turn,createdAt:FORMAL_SCOPE_POLICY.effectiveFrom}],draft));
});
test('completed work and unfinished drafts are preserved while fresh future tasks append without a history rewrite',()=>{
 const {frozen,published,objective}=fixture(),before=structuredClone(frozen);
 assert.equal(withProspectiveFormalScope(frozen,published,{completed:true}),frozen);
 assert.equal(withProspectiveFormalScope(frozen,published,{pending:true}),frozen);
 const projected=withProspectiveFormalScope(frozen,published);
 assert.deepEqual(frozen,before);assert.equal(projected.curriculumVersion,frozen.curriculumVersion);
 assert.deepEqual(projected.objectives,[objective]);assert.equal(projected.objectives[0].legacy.evidenceRole,'formative');
});
