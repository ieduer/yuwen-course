// Reusable offline preparation/readback for the real, governed APIS calibration.
// This tool cannot send a provider request, change a flag or award learner credit.
import fs from 'node:fs';
import {CALIBRATION_CONTRACT as amendment} from '../site/dialogue-calibration-contract.js';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {POLICY_VERSION,RULE_VERSION,contextFor,projectState,createQuestion,validateProposal,LIMITS} from '../site/dialogue-policy.js';
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function calibrationPacket(corpus,loadCurriculum,budget){
 const ids=new Set();
 const cases=corpus.cases.map(spec=>{
  if(ids.has(spec.id))throw Error('duplicate_calibration_case');ids.add(spec.id);
  const source=loadCurriculum(spec.lessonId),curriculum=structuredClone(source);
  const objective=curriculum.objectives.find(o=>o.id===spec.objectiveId);if(!objective)throw Error('missing_calibration_objective');
  // This explicit hypothetical fixture lets us test positive AND negative
  // semantic decisions before production calibration approval exists. Source
  // statuses and runtime curriculum are never changed by this tool.
  for(const item of curriculum.languagePractice||[])item.calibrationStatus='accepted';
  for(const entry of curriculum.dictionary||[])if(entry.verificationStatus==='image-review-pending')entry.verificationStatus='source-image-verified';
  const question=objective.domain==='vocabulary'?createQuestion(curriculum,{objectiveId:objective.id,random:0}):null;
  if(question){question.id=`calibration-question:${spec.id}`;question.createdAt='2026-10-12T00:00:00Z';}
  const turns=(spec.priorTurns||[]).map(t=>({...t,id:`calibration-${spec.id}:${t.id}`}));
  if(spec.teacherHint)turns.push({id:`calibration-hint:${spec.id}`,role:'teacher',content:spec.teacherHint});
  turns.push({id:`calibration-answer:${spec.id}`,role:'student',content:spec.studentAnswer,questionId:question?.id||null});
  const preserved=spec.readyFixture?curriculum.objectives.filter(o=>o.domain!=='shangyou').map(o=>({objectiveId:o.id,verified:true,sourceRef:{kind:'synthetic-calibration-fixture-only'}})):[];
  const state=projectState(curriculum,[],preserved),prompt=contextFor({curriculum,state,turns,question});
  return {...spec,sourceCurriculumVersion:source.curriculumVersion,sourceDigest:digest(source),fixtureOverrides:'hypothetical calibration/source acceptance only; does not approve sources or mastery',curriculum,state,turns,question,prompt,promptDigest:digest(prompt)};
 });
 if(cases.length!==24)throw Error('fixed_calibration_budget_requires_24_cases');
 const sourceDigest=digest(cases.map(c=>({id:c.id,sourceDigest:c.sourceDigest,promptDigest:c.promptDigest})));
 const recordedSourceMatches=sourceDigest===amendment.packetDigest;
 return {version:corpus.version,operation:recordedSourceMatches?amendment.operation:'unapproved-source-preview',amendment:recordedSourceMatches?amendment:null,policyVersion:POLICY_VERSION,ruleVersion:RULE_VERSION,model:budget.model,transport:'authenticated isolated YW acceptance -> APIS /api/yw/dialogue-stream -> Gemini single stream',limits:{totalAttempts:24,attemptsPerCase:2,retries:amendment.retries,deadlineMinutes:20,reservedMicros:24*budget.reserveMicros,requestTimeoutMs:LIMITS.timeoutMs},stop:'Reconcile every failed attempt; continue diagnosed cases within cumulative budget and original window. Same-attempt POST only reads back. Recovery uses a new reserved attempt and receipt acknowledgement; unknown provider outcomes cannot be retried. Credential rejection, lockout, budget or expiry stops admission.',dataClass:'synthetic-only',sourceDigest,cases};
}
export function evaluateCalibrationCase(c,result){
 if(result.caseId!==c.id||result.promptDigest!==c.promptDigest)throw Error('calibration_source_mismatch');
 const proposal=validateProposal(result.value,{curriculum:c.curriculum,state:c.state,turns:c.turns,question:c.question,hints:c.turns.filter(t=>t.role==='teacher').map(t=>t.content)});
 const outcome=proposal.assessments.find(a=>a.objectiveId===c.objectiveId)?.outcome||'no_assessment';
 const expectedVerdictMatches=c.expected==='demonstrated'?outcome==='demonstrated':outcome!=='demonstrated';
 const unrelatedMastery=proposal.assessments.some(a=>a.outcome==='demonstrated'&&a.objectiveId!==c.objectiveId);
 return {caseId:c.id,outcome,expectedVerdictMatches:expectedVerdictMatches&&!unrelatedMastery,structurallyValid:true,semanticReviewRequired:true,review:c.review,notice:'Machine checks do not certify teaching quality, provider execution, billing or source images.'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [action,input,output]=process.argv.slice(2);
 if(action!=='prepare'||!input||output)throw Error('Usage: node scripts/dialogue_calibration.mjs prepare EXACT_NEW_OUTPUT_PATH');
 const packet=calibrationPacket(JSON.parse(fs.readFileSync('scripts/dialogue-calibration-cases.json')),id=>JSON.parse(fs.readFileSync(`site/dialogue-curriculum/${id}.json`)),JSON.parse(fs.readFileSync('docs/dialogue/budget-policy.json')));
 fs.writeFileSync(input,JSON.stringify(packet,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log(JSON.stringify({operation:packet.operation,cases:packet.cases.length,sourceDigest:packet.sourceDigest,maxReservedMicros:packet.limits.reservedMicros,paidCalls:0}));
}
