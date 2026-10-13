// Deterministic offline case correction. Old packets/receipts are read-only.
import fs from 'node:fs';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {amendment4CaseSourceReadiness} from '../site/dialogue-calibration-amendment4.js';
import {AMENDMENT4_CONTRACT as contract} from '../site/dialogue-calibration-amendment4-contract.js';
import {POLICY_VERSION,RULE_VERSION,contextFor,projectState,createQuestion} from '../site/dialogue-policy.js';
export const digest=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function amendment4Packet(corpus,loadCurriculum){
 if(corpus.cases.length!==28||new Set(corpus.cases.map(c=>c.id)).size!==28)throw Error('amendment4_requires_28_unique_cases');
 const cases=corpus.cases.map(spec=>{
  const source=loadCurriculum(spec.lessonId),curriculum=structuredClone(source);
  const objective=curriculum.objectives.find(o=>o.id===spec.objectiveId);if(!objective)throw Error('missing_calibration_objective');
  if(!spec.validationQuestion||JSON.stringify(spec.rubricCoverage.criteria)!==JSON.stringify(objective.criteria)||
   objective.criteria.some(k=>!spec.rubricCoverage.questionEvidence[k]||!spec.validationQuestion.includes(spec.rubricCoverage.questionEvidence[k])))throw Error('amendment4_question_rubric_coverage_missing');
  if(spec.rubricCoverage.sourceAnchors.some(a=>!curriculum.passages.some(p=>p.id===a.passageId&&p.text.includes(a.quote))))throw Error('amendment4_unverified_source_anchor');
  const sourceReadiness=amendment4CaseSourceReadiness({...spec,curriculum});
  // Test the target model rubric only after independent source review. Never
  // promote source/dictionary status or unrelated language mastery in a fixture.
  const targetLanguage=curriculum.languagePractice?.find(x=>x.id===spec.objectiveId);
  const calibrationProjection=targetLanguage&&sourceReadiness.eligible?{objectiveId:targetLanguage.id,from:targetLanguage.calibrationStatus,to:'accepted'}:null;
  if(calibrationProjection)targetLanguage.calibrationStatus='accepted';
  const question=objective.domain==='vocabulary'?createQuestion(curriculum,{objectiveId:objective.id,random:0}):null;
  if(question){question.id=`calibration-question:${spec.id}:amendment4`;question.createdAt='2026-10-13T00:00:00Z';question.question=spec.validationQuestion;}
  const turns=(spec.priorTurns||[]).map(t=>({...t,id:`calibration-${spec.id}:${t.id}`}));
  // Explicitly asks the target rubric even when the domain has no vocabulary
  // question object. Asking a question is not an answer-bearing teacher hint.
  turns.push({id:`calibration-question-turn:${spec.id}`,role:'teacher',content:spec.validationQuestion});
  if(spec.teacherHint)turns.push({id:`calibration-hint:${spec.id}`,role:'teacher',content:spec.teacherHint});
  turns.push({id:`calibration-answer:${spec.id}`,role:'student',content:spec.studentAnswer,questionId:question?.id||null});
  const preserved=spec.readyFixture?curriculum.objectives.filter(o=>o.domain!=='shangyou').map(o=>({objectiveId:o.id,verified:true,sourceRef:{kind:'synthetic-calibration-fixture-only'}})):[];
  const state=projectState(curriculum,[],preserved),prompt=contextFor({curriculum,state,turns,question});
  if(!prompt.includes(spec.studentAnswer)||!prompt.includes(spec.validationQuestion))throw Error('amendment4_prompt_lost_case');
  return {...spec,sourceCurriculumVersion:source.curriculumVersion,sourceDigest:digest(source),caseDefinitionDigest:digest(spec),sourceReadiness,fixtureOverrides:{calibrationProjection,sourceStatusPreserved:true,realMastery:false},curriculum,state,turns,question,prompt,promptDigest:digest(prompt)};
 });
 const sourceDigest=digest(cases.map(c=>({id:c.id,sourceDigest:c.sourceDigest,promptDigest:c.promptDigest,caseDefinitionDigest:c.caseDefinitionDigest,sourceReadiness:c.sourceReadiness})));
 return {version:corpus.version,operation:contract.operation,status:'authorized-preparation',active:false,paidCallsAuthorized:true,authorityRef:contract.authorityRef,authorityDigest:contract.authorityDigest,
  policyVersion:POLICY_VERSION,ruleVersion:RULE_VERSION,model:contract.model,sourceDigest,caseCorrection:corpus.caseCorrection,
  limits:{baseCases:28,maxRecoveriesPerCase:1,reserveMicros:84000,approvedNewAttempts:56,approvedNewReservedMicros:4704000,providerAttemptsPerCall:1},
  window:{start:contract.start,hardExpiry:contract.hardExpiry},dataClass:'synthetic-only',sourceReadiness:{eligibleCases:cases.filter(c=>c.sourceReadiness.eligible).map(c=>c.id),blockedCases:cases.filter(c=>!c.sourceReadiness.eligible).map(c=>({id:c.id,objectiveId:c.objectiveId,blockers:c.sourceReadiness.blockers})),sourceReviewDoesNotEqualModelPass:true},cases};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [action,output,extra]=process.argv.slice(2);
 if(!['prepare','refresh-proposal'].includes(action)||!output||extra)throw Error('Usage: node scripts/dialogue_calibration_amendment4.mjs prepare EXACT_NEW_OUTPUT_PATH | refresh-proposal site/dialogue-calibration-amendment4-packet.json');
 const corpus=JSON.parse(fs.readFileSync('scripts/dialogue-calibration-amendment4-cases.json'));
 const packet=amendment4Packet(corpus,id=>JSON.parse(fs.readFileSync(`site/dialogue-curriculum/${id}.json`)));
 if(action==='refresh-proposal'){
  if(output!=='site/dialogue-calibration-amendment4-packet.json')throw Error('amendment4_refresh_exact_proposal_only');
  const old=JSON.parse(fs.readFileSync(output));
  if(old.operation!==contract.operation||!['proposed','authorized-preparation'].includes(old.status)||old.active!==false||old.sourceDigest!==contract.packetDigest||contract.active)throw Error('amendment4_consumed_or_unpinned_packet');
  const path='site/dialogue-calibration-amendment4-contract.js',text=fs.readFileSync(path,'utf8');
  const marker=`packetDigest:'${old.sourceDigest}'`;
  if(!text.includes(marker))throw Error('amendment4_contract_pin_missing');
  fs.writeFileSync(output,JSON.stringify(packet,null,2)+'\n',{mode:0o600});
  fs.writeFileSync(path,text.replace(marker,`packetDigest:'${packet.sourceDigest}'`));
 }else fs.writeFileSync(output,JSON.stringify(packet,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log(JSON.stringify({operation:packet.operation,cases:packet.cases.length,sourceDigest:packet.sourceDigest,active:false,paidCalls:0}));
}
