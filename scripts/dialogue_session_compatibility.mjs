// Offline acceptance preparation. Never changes a session or grants execution.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {withProspectiveFormalScope} from '../site/formal-scope-policy.js';
import {approvedSupplement} from '../site/dialogue-completion-exemptions.js';
import {withCalibratedLanguage} from '../site/dialogue-calibration-status.js';
import {sanitizeDialogueCurriculum} from '../site/dialogue-public-curriculum.js';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const pin=c=>({lessonId:c.lessonId,curriculumVersion:c.curriculumVersion,sourceDigest:hash(c)});

// State must come from the existing server-owned session, not a guessed default.
// Unknown completion/pending state is reported as all four possible branches.
// This mirrors the runtime projection order without introducing migration policy.
export async function inspectSessionCompatibility(published,frozen,{completed,pending}={}){
 assert(published?.lessonId&&published.curriculumVersion&&Array.isArray(published.objectives),'published curriculum required');
 assert(frozen?.lessonId===published.lessonId&&frozen.curriculumVersion&&Array.isArray(frozen.objectives),'matching frozen curriculum required');
 for(const value of [completed,pending])assert(value===undefined||typeof value==='boolean','explicit server state required');
 const current=await withCalibratedLanguage(published),branches=[];
 for(const done of completed===undefined?[false,true]:[completed])for(const unfinished of pending===undefined?[false,true]:[pending]){
  let effective=frozen;
  if(published.formalScopeExpansion&&!effective.formalScopeExpansion)effective=withProspectiveFormalScope(effective,published,{completed:done,pending:unfinished});
  const exemption=approvedSupplement(published);
  if(exemption)effective={...effective,completionExemption:exemption};
  effective=await withCalibratedLanguage(effective);
  const keys=[...new Set([...Object.keys(effective),...Object.keys(current)])].sort();
  const changedKeys=keys.filter(key=>!same(effective[key],current[key]));
  const missingObjectives=current.objectives.filter(o=>!effective.objectives.some(old=>same(old,o))).map(o=>o.id);
  const historicalOnlyObjectives=effective.objectives.filter(o=>!current.objectives.some(next=>next.id===o.id)).map(o=>o.id);
  branches.push({completed:done,pending:unfinished,effectivePin:pin(effective),matchesPublishedPin:same(pin(effective),pin(current)),changedKeys,missingObjectives,historicalOnlyObjectives,
   appendedObjectiveIds:effective.objectives.filter(o=>!frozen.objectives.some(old=>old.id===o.id)).map(o=>o.id),
   currentSourceEquivalent:changedKeys.length===0});
 }
 return {version:'yw-session-compatibility-v1',lessonId:published.lessonId,frozenPin:pin(frozen),publishedPin:pin(current),
  stateVerified:typeof completed==='boolean'&&typeof pending==='boolean',branches,
  currentSourceCompatible:branches.every(b=>b.currentSourceEquivalent),
  executionAuthorized:false,realProviderVerified:false,historicalDataChanged:false,
  disposition:branches.every(b=>b.currentSourceEquivalent)?'source_matches_still_requires_current_snapshot':'preserved_session_requires_explicit_source_and_coverage_disposition'};
}

// Use only with the exact effective curriculum and independently approved pin.
// resumeCurriculum may represent ordinary calibration, not version drift.
export function validateSessionSnapshot(snapshot,{curriculum,approvedPin,ownerRef,previous=null}){
 assert.equal(snapshot?.ownerRef,ownerRef,'owner drift');
 assert(typeof ownerRef==='string'&&/^[a-f0-9]{64}$/.test(ownerRef),'bound owner required');
 assert.deepEqual(pin(curriculum),approvedPin,'unapproved effective curriculum');
 assert(!snapshot.pending&&!snapshot.partial&&!snapshot.draft,'unfinished prior work');
 assert(Number.isSafeInteger(snapshot.revision)&&snapshot.revision>=0&&Array.isArray(snapshot.turns),'current snapshot required');
 if(snapshot.curriculumVersion)assert.equal(snapshot.curriculumVersion,curriculum.curriculumVersion,'snapshot version drift');
 else assert(snapshot.saved===false&&snapshot.revision===0&&snapshot.turns.length===0&&!snapshot.sessionId,'missing existing version');
 if(snapshot.resumeCurriculum)assert.deepEqual(snapshot.resumeCurriculum,sanitizeDialogueCurriculum(curriculum),'public curriculum projection drift');
 else assert(!curriculum.calibrationEvidence,'missing calibration projection');
 if(previous){
  assert.equal(previous.ownerRef,ownerRef,'historical owner drift');
  assert.equal(snapshot.sessionId,previous.sessionId,'historical session replacement');
  assert.equal(snapshot.curriculumVersion,previous.curriculumVersion,'historical version drift');
  assert.equal(snapshot.revision,previous.revision,'historical revision drift');
  assert.deepEqual(snapshot.turns,previous.turns,'historical visible turns changed or absent');
 }
 return {validated:true,executionAuthorized:false,historyScope:'exact supplied snapshot page only; full ledger preservation remains required'};
}
