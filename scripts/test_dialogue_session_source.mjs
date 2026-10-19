import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {withSessionSourceMaterials} from '../site/dialogue-session-source.js';
import {withProspectiveFormalScope} from '../site/formal-scope-policy.js';
import {sourceProvenance} from '../site/dialogue-material-context.js';
import {loadModeCurriculum} from './dialogue_mode_sample.mjs';
import {projectState,validateProposal} from '../site/dialogue-policy.js';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
function fixture(){
 const frozen=JSON.parse(fs.readFileSync('scripts/fixtures/dialogue-historical-modern-curriculum.json'));
 const published=loadModeCurriculum(frozen.lessonId),prior=withProspectiveFormalScope(frozen,published,{completed:false,pending:false});
 return {frozen,published,prior,options:{completed:false,pending:false,historicalCurriculum:frozen}};
}
test('exact historical source gets only missing metadata; all objectives and source contracts remain unchanged',async()=>{
 const {frozen,published,prior,options}=fixture(),before=JSON.stringify({frozen,published,prior});
 const next=await withSessionSourceMaterials(prior,published,options),proof=next.sessionSourceProjection;
 assert(proof);assert.equal(proof.historicalSourceDigest,hash(frozen));assert.equal(proof.publishedSourceDigest,hash(published));assert.equal(proof.priorEffectiveDigest,hash(prior));
 assert.equal(next.curriculumVersion,frozen.curriculumVersion);assert.deepEqual(next.objectives,prior.objectives);assert.deepEqual(next.legacy,prior.legacy);
 assert.deepEqual(next.persona,frozen.persona);assert.equal(next.referenceVersion,frozen.referenceVersion);assert.equal(next.textRoleVersion,frozen.textRoleVersion);
 assert.equal(next.sourceInventory.readerSha256,published.sourceInventory.readerSha256);
 for(const key of Object.keys(prior))assert.deepEqual(next[key],prior[key],key+' must stay immutable');
 assert.equal(JSON.stringify({frozen,published,prior}),before);
 assert.deepEqual(sourceProvenance(next).sessionSourceProjection,proof);
 assert.equal(await withSessionSourceMaterials(next,published,options),next);
});
test('completed, unfinished and unknown states do not adopt future material metadata',async()=>{
 const {prior,published,options}=fixture();
 for(const state of [{completed:true,pending:false},{completed:false,pending:true},{completed:undefined,pending:false},{completed:false,pending:undefined}])assert.equal(await withSessionSourceMaterials(prior,published,{...options,...state}),prior);
});
for(const [name,change] of Object.entries({lesson:c=>c.lessonId='other',author:c=>c.author='other',source:c=>c.source='other',text:c=>c.passages[0].text+='changed',annotation:c=>c.annotations[0].noteId='changed',rubric:c=>c.objectives[0].criteria=['changed'],missingObjective:c=>c.objectives.push({id:'unadmitted',domain:'studyGuide'}),review:c=>c.sourceReviewRequired=true,unavailable:c=>c.sourceStatus='source-unavailable',missingReaderDigest:c=>delete c.sourceInventory.readerSha256})){
 test('incompatible '+name+' is not silently supplemented',async()=>{const {prior,published,options}=fixture();change(published);assert.equal(await withSessionSourceMaterials(prior,published,options),prior);});
}
test('existing provenance and conflicting material metadata are never overwritten',async()=>{
 const {prior,published,options}=fixture();
 for(const addition of [{sourceInventory:{readerSha256:'old'}},{media:[{id:'historical-unique-image'}]}]){const existing={...prior,...addition};assert.equal(await withSessionSourceMaterials(existing,published,options),existing);}
});
test('new formal requirements cannot be smuggled in through source supplementation',async()=>{
 const {frozen,published,options}=fixture();assert.equal(await withSessionSourceMaterials(frozen,published,options),frozen);
});
test('historical aggregate vocabulary is still assessable under its unchanged original criteria',async()=>{
 const {frozen,published,prior,options}=fixture(),next=await withSessionSourceMaterials(prior,published,options);
 const objective=next.objectives.find(o=>o.id===frozen.lessonId+':vocabulary'),p=next.passages[0],turn={id:'synthetic-vocabulary',role:'student',content:'我依原句解釋語境義，並指出判斷的文字依據。'};
 assert(objective);assert.equal(next.vocabulary.length,0);
 const proposal={reply:'我們回到文字檢查。',assessments:[{objectiveId:objective.id,outcome:'demonstrated',rationale:'synthetic original-criteria verification',evidence:objective.criteria.map(criterion=>({criterion,turnId:turn.id,quote:turn.content,passageId:p.id,passageQuote:p.text.slice(0,12)}))}]};
 const checked=validateProposal(proposal,{curriculum:next,turns:[turn]});assert.equal(checked.assessments[0].outcome,'demonstrated');
 const state=projectState(next,checked.assessments);assert.equal(state.objectives.find(o=>o.id===objective.id).status,'demonstrated');
 assert.equal(state.completion,'in_progress');assert.equal(next.objectives.length,prior.objectives.length);
});
