import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {inspectSessionCompatibility,validateSessionSnapshot} from './dialogue_session_compatibility.mjs';
import {loadModeCurriculum,prepareCalibratedModeSample} from './dialogue_mode_sample.mjs';
import {withCalibratedLanguage} from '../site/dialogue-calibration-status.js';
import {sanitizeDialogueCurriculum} from '../site/dialogue-public-curriculum.js';
import {FORMAL_SCOPE_POLICY} from '../site/formal-scope-policy.js';
const hash=c=>createHash('sha256').update(JSON.stringify(c)).digest('hex');
const ownerRef='a'.repeat(64);
async function fixture(){
 const curriculum=await withCalibratedLanguage(loadModeCurriculum('lesson-1498'));
 const approvedPin={lessonId:curriculum.lessonId,curriculumVersion:curriculum.curriculumVersion,sourceDigest:hash(curriculum)};
 const snapshot={ownerRef,sessionId:'SYNTHETIC-preserved',curriculumVersion:curriculum.curriculumVersion,revision:2,turns:[{id:'SYNTHETIC-turn',role:'student',content:'SYNTHETIC original answer'}],resumeCurriculum:sanitizeDialogueCurriculum(curriculum)};
 return {curriculum,approvedPin,snapshot,options:{curriculum,approvedPin,ownerRef,previous:structuredClone(snapshot)}};
}
test('normal calibration projection accepts unchanged source and history, without granting execution',async()=>{
 const {snapshot,options}=await fixture(),before=JSON.stringify(snapshot);
 const result=validateSessionSnapshot(snapshot,options);
 assert.equal(result.validated,true);assert.equal(result.executionAuthorized,false);assert.equal(JSON.stringify(snapshot),before);
});
for(const [name,change] of Object.entries({owner:s=>s.ownerRef='b'.repeat(64),version:s=>s.curriculumVersion='changed',projection:s=>s.resumeCurriculum.title+=' changed',calibration:s=>s.resumeCurriculum.calibrationEvidence.sourceDigest='0'.repeat(64),missingProjection:s=>delete s.resumeCurriculum,session:s=>s.sessionId='replacement',revision:s=>s.revision++,missingTurn:s=>s.turns=[],changedTurn:s=>s.turns[0].content='altered',pending:s=>s.pending=true,partial:s=>s.partial={content:'unfinished'},draft:s=>s.draft={content:'unfinished'}})){
 test('snapshot rejects '+name,async()=>{const {snapshot,options}=await fixture();change(snapshot);assert.throws(()=>validateSessionSnapshot(snapshot,options));});
}
test('effective private source and historical owner must independently match the bound inputs',async()=>{
 const {snapshot,options}=await fixture();
 assert.throws(()=>validateSessionSnapshot(snapshot,{...options,curriculum:{...options.curriculum,title:'changed'}}),/unapproved/);
 assert.throws(()=>validateSessionSnapshot(snapshot,{...options,previous:{...options.previous,ownerRef:'b'.repeat(64)}}),/historical owner/);
});
test('a genuine unsaved lesson snapshot is distinguished from missing existing-session identity',async()=>{
 const {snapshot,options}=await fixture();delete snapshot.curriculumVersion;delete snapshot.sessionId;snapshot.revision=0;snapshot.turns=[];snapshot.saved=false;
 assert(validateSessionSnapshot(snapshot,{...options,previous:null}).validated);
 snapshot.sessionId='existing';assert.throws(()=>validateSessionSnapshot(snapshot,{...options,previous:null}),/missing existing version/);
});
test('unknown state cannot silently select the prospective branch or authorize new calls',async()=>{
 const published=loadModeCurriculum('lesson-1498'),before=JSON.stringify(published);
 const result=await inspectSessionCompatibility(published,published);
 assert.equal(result.stateVerified,false);assert.equal(result.branches.length,4);assert.equal(result.currentSourceCompatible,true);
 assert.equal(result.executionAuthorized,false);assert.equal(result.realProviderVerified,false);assert.equal(JSON.stringify(published),before);
});
test('prospective additions are reported without rewriting frozen history or claiming published coverage',async()=>{
 const frozen={lessonId:'SYNTHETIC',curriculumVersion:'old',objectives:[{id:'old',domain:'context'}],legacy:{formal:[]}};
 const addition={id:'new',domain:'legacy',legacy:{resourceKey:'new-key',formalScopePolicyVersion:FORMAL_SCOPE_POLICY.policyVersion}};
 const published={...frozen,curriculumVersion:'new',sourceInventory:{readerSha256:'b'.repeat(64)},formalScopeExpansion:FORMAL_SCOPE_POLICY,objectives:[...frozen.objectives,addition],legacy:{formal:[{resourceKey:'new-key'}]}};
 const bytes=JSON.stringify({frozen,published}),result=await inspectSessionCompatibility(published,frozen);
 assert.deepEqual(result.branches[0].appendedObjectiveIds,['new']);assert(result.branches.slice(1).every(b=>b.appendedObjectiveIds.length===0));
 assert(result.branches.every(b=>!b.matchesPublishedPin&&b.changedKeys.includes('sourceInventory')));
 assert(result.branches.slice(1).every(b=>b.missingObjectives.includes('new')));
 assert.equal(result.currentSourceCompatible,false);assert.equal(JSON.stringify({frozen,published}),bytes);
});
test('different criteria on an existing objective remain a coverage gap even when its ID matches',async()=>{
 const frozen={lessonId:'SYNTHETIC',curriculumVersion:'v1',objectives:[{id:'one',criteria:['old']}]},published={...frozen,objectives:[{id:'one',criteria:['new']}]};
 const result=await inspectSessionCompatibility(published,frozen,{completed:false,pending:false});
 assert.equal(result.stateVerified,true);assert.equal(result.branches.length,1);assert.deepEqual(result.branches[0].missingObjectives,['one']);assert.equal(result.currentSourceCompatible,false);
});
test('mismatched lesson and untrusted state coercion are rejected',async()=>{
 const c=loadModeCurriculum('lesson-1498');
 await assert.rejects(inspectSessionCompatibility(c,{...c,lessonId:'other'}),/matching frozen/);
 await assert.rejects(inspectSessionCompatibility(c,c,{pending:'false'}),/explicit server state/);
});
test('published sample preparation explicitly leaves session compatibility unverified',async()=>{
 const plan=await prepareCalibratedModeSample();
 assert.equal(plan.sessionCompatibilityVerified,false);assert.equal(plan.executionAuthorized,false);
 assert(plan.requires.some(r=>r.includes('before activation compare existing frozen session')));
});
