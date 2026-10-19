import accepted from './dialogue-calibration-status.json' with {type:'json'};

export const CALIBRATION_STATUS_VERSION='yw-language-calibration-projection-v1';
export const calibrationDigest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))).map(x=>x.toString(16).padStart(2,'0')).join('');
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);

// A separate, source-owned calibration decision. No learner evidence, grade or
// original curriculum is modified, and unknown source versions stay unchanged.
export async function withCalibratedLanguage(curriculum,manifest=accepted){
 if(manifest?.version!==CALIBRATION_STATUS_VERSION||!Array.isArray(manifest.lessons))throw Error('calibration_manifest_invalid');
 const candidates=manifest.lessons.filter(l=>l.lessonId===curriculum.lessonId&&l.curriculumVersion===curriculum.curriculumVersion);
 if(!candidates.length)return curriculum;
 const sourceDigest=await calibrationDigest(curriculum),matches=candidates.filter(l=>l.sourceDigest===sourceDigest);
 if(!matches.length)return curriculum;
 if(matches.length!==1)throw Error('calibration_source_ambiguous');
 const pin=matches[0];
 if(!hex(pin.inspectionDigest)||!Array.isArray(pin.items)||!pin.items.length||new Set(pin.items.map(i=>i.objectiveId)).size!==pin.items.length)throw Error('calibration_evidence_invalid');
 for(const proof of pin.items){
  const item=(curriculum.languagePractice||[]).find(i=>i.id===proof.objectiveId);
  if(!item||item.version!==proof.itemVersion||item.calibrationStatus!=='pending-real-model'||await calibrationDigest(item)!==proof.itemDigest||!hex(proof.evidenceDigest)||!Array.isArray(proof.cases)||!proof.cases.length||new Set(proof.cases.map(c=>c.caseId)).size!==proof.cases.length||proof.cases.some(c=>!c.caseId||!hex(c.receiptDigest)||!hex(c.readbackDigest)||!hex(c.semanticReviewDigest)))throw Error('calibration_item_mismatch');
 }
 // Scope the provenance to the matching lesson. Appending an independent
 // lesson cannot invalidate a preserved partial request in this one.
 const evidence={version:CALIBRATION_STATUS_VERSION,manifestDigest:await calibrationDigest({version:manifest.version,lessons:[pin]}),sourceDigest,inspectionDigest:pin.inspectionDigest,items:pin.items.map(i=>({objectiveId:i.objectiveId,itemVersion:i.itemVersion,evidenceDigest:i.evidenceDigest}))};
 return {...curriculum,languagePractice:curriculum.languagePractice.map(item=>pin.items.some(i=>i.objectiveId===item.id)?{...item,calibrationStatus:'accepted'}:item),calibrationEvidence:evidence};
}

// Saved questions retain their original criteria. Only the current prompt gets
// the separately proven status, with its original status explicitly identified.
export function calibratedQuestion(question,curriculum){
 if(!question||!curriculum.calibrationEvidence?.items.some(i=>i.objectiveId===question.objectiveId))return question;
 return {...question,criteria:{...question.criteria,calibrationStatus:'accepted'},calibrationEvidence:{manifestDigest:curriculum.calibrationEvidence.manifestDigest,originalStatus:question.criteria?.calibrationStatus||null}};
}

export function calibrationReopensReview(question,curriculum){
 return question?.state==='review'&&question.criteria?.calibrationStatus==='pending-real-model'&&curriculum.calibrationEvidence?.items.some(i=>i.objectiveId===question.objectiveId)===true;
}
