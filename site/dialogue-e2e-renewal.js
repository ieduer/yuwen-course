// Inactive continuation of the existing E2E schema. The publisher must supply
// both approved pins; no request or default value can mint this capability.
import packet from './dialogue-full-language-packet.json' with {type:'json'};
import {FULL_OPERATION,FULL_E2E_OPERATION,FULL_MODEL,FULL_CASE_COUNT,fullActivation} from './dialogue-full-language.js';
import {acceptanceContext,ACCEPTANCE_ORIGIN} from './dialogue-acceptance.js';
import {reconciledCost} from './dialogue-budget.js';
export const RENEWED_E2E_OPERATION=FULL_E2E_OPERATION;
const lessons=['lesson-1498','lesson-1711-p1','lesson-1717-p2'];
const keys='apisVersion,authorityDigest,databaseId,enabled,hardExpiry,lessonIds,maxProviderAttempts,maxVisibleCalls,operation,origin,ownerUserId,registryReceiptDigest,reserveMicros,version';
const prefix=FULL_OPERATION+':';
const expectedCases=JSON.stringify(packet.cases.map(c=>({id:c.id,sourceDigest:c.sourceDigest,promptDigest:c.promptDigest})));
const extract=(column,key)=>`json_extract(CASE WHEN json_valid(${column}) THEN ${column} ELSE '{}' END,'$.${key}')`;
const op=extract('c.budget_policy_json','isolatedAdmission.operation');
export function renewedDialogueAdmission(env,student,lessonId,budget,pin,at){
 const context=acceptanceContext(env),full=fullActivation(env,packet,at);
 if(!context||!full||Object.keys(pin).sort().join(',')!==keys||pin.version!=='yw-isolated-e2e-admission-v2'||pin.enabled!==true
  ||pin.operation!==FULL_E2E_OPERATION||pin.authorityDigest!==full.authorityDigest||pin.hardExpiry!==full.hardExpiry
  ||pin.origin!==ACCEPTANCE_ORIGIN||pin.origin!==context.origin||pin.ownerUserId!==553||pin.ownerUserId!==context.userId||Number(student?.ucUserId)!==553
  ||pin.databaseId!==context.databaseId||pin.apisVersion!==context.version||pin.registryReceiptDigest!==context.activationDigest
  ||pin.maxVisibleCalls!==120||pin.maxProviderAttempts!==3||pin.reserveMicros!==252000
  ||!Array.isArray(pin.lessonIds)||JSON.stringify([...pin.lessonIds].sort())!==JSON.stringify(lessons)||!lessons.includes(lessonId))throw Error('e2e_renewal_activation_invalid');
 if(budget.model!==FULL_MODEL||budget.logicalProviderAttemptLimit!==3||budget.perAttemptReserveMicros!==84000||budget.reserveMicros!==252000)throw Error('e2e_budget_mismatch');
 return Object.freeze({version:pin.version,operation:FULL_E2E_OPERATION,ownerUserId:context.userId,databaseId:context.databaseId,
  registryReceiptDigest:pin.registryReceiptDigest,hardExpiry:pin.hardExpiry,maxVisibleCalls:120,lessonId,
  calibrationPacketDigest:packet.sourceDigest,sourceCommit:full.sourceCommit,artifactSha256:full.artifactSha256,authorityDigest:full.authorityDigest});
}
export function calibrationReadyCondition(studentId){
 return {sql:`(SELECT COUNT(*) FROM dialogue_calls WHERE substr(turn_id,1,?)=?)=?
 AND NOT EXISTS(SELECT 1 FROM json_each(?) p
  LEFT JOIN dialogue_calls c ON c.turn_id=?||json_extract(p.value,'$.id')||':1'
  LEFT JOIN dialogue_sessions s ON s.id=c.session_id
  LEFT JOIN dialogue_events e ON e.id=c.turn_id||':result'
  WHERE c.state IS NOT 'finished' OR c.finished_at IS NULL OR c.accounted_micros IS NULL OR c.accounted_micros<0 OR c.accounted_micros>84000 OR c.reserved_micros IS NOT 84000
   OR c.student_id IS NOT ? OR s.student_id IS NOT ?
   OR ${extract('s.curriculum_json','packetDigest')} IS NOT ?
   OR ${extract('s.curriculum_json','caseId')} IS NOT json_extract(p.value,'$.id')
   OR ${extract('s.curriculum_json','sourceDigest')} IS NOT json_extract(p.value,'$.sourceDigest')
   OR ${extract('s.curriculum_json','promptDigest')} IS NOT json_extract(p.value,'$.promptDigest')
   OR ${extract('e.details_json','model')} IS NOT ? OR ${extract('e.details_json','expectedVerdictMatches')} IS NOT 1
   OR typeof(${extract('e.details_json','modelVersion')})<>'text' OR length(${extract('e.details_json','modelVersion')})=0)
 AND (SELECT COUNT(DISTINCT ${extract('e.details_json','modelVersion')}) FROM dialogue_calls c JOIN dialogue_events e ON e.id=c.turn_id||':result' WHERE substr(c.turn_id,1,?)=?)=1`,
 args:[prefix.length,prefix,FULL_CASE_COUNT,expectedCases,prefix,studentId,studentId,packet.sourceDigest,FULL_MODEL,prefix.length,prefix]};
}
export function renewedConcurrencyCondition(){
 return {sql:`(SELECT COUNT(*) FROM dialogue_calls c WHERE (substr(c.turn_id,1,?)=? OR ${op}=?) AND c.state IN ('reserved','finishing'))<1`,args:[prefix.length,prefix,FULL_E2E_OPERATION]};
}
export function renewedReviewCondition(excludeTurn=''){
 return {sql:`NOT EXISTS(SELECT 1 FROM dialogue_calls c WHERE ${op}=? AND (c.reserved_micros<>252000 OR c.state NOT IN ('reserved','finishing','finished','review') OR c.state='finished' AND c.accounted_micros IS NULL OR c.state='review' AND c.turn_id<>?))`,args:[FULL_E2E_OPERATION,excludeTurn]};
}
export function renewedOperationCondition(budget,studentId,{continuingTurn=''}={}){
 if(budget.isolatedAdmission?.operation!==FULL_E2E_OPERATION)return {sql:'1',args:[]};
 const parts=[calibrationReadyCondition(studentId),renewedConcurrencyCondition(),renewedReviewCondition(continuingTurn)];
 return {sql:parts.map(p=>'('+p.sql+')').join(' AND '),args:parts.flatMap(p=>p.args)};
}
export async function renewedBudgetDenial(db,budget,studentId){
 if(budget.isolatedAdmission?.operation!==FULL_E2E_OPERATION)return null;
 for(const [condition,code] of [[calibrationReadyCondition(studentId),'e2e_calibration_not_complete'],[renewedReviewCondition(),'e2e_operation_review_required'],[renewedConcurrencyCondition(),'e2e_operation_concurrency_busy']]){
  const row=await db.prepare('SELECT '+condition.sql+' AS allowed').bind(...condition.args).first();if(!row.allowed)return code;
 }
 return null;
}
export async function validateRenewedResult(db,budget,result,accounting){
 if(budget.isolatedAdmission?.operation!==FULL_E2E_OPERATION)return;
 if(result.model!==FULL_MODEL||typeof result.modelVersion!=='string'||!result.modelVersion)throw Error('e2e_model_version_required');
 const expected=await db.prepare(`SELECT ${extract('e.details_json','modelVersion')} AS version FROM dialogue_calls c JOIN dialogue_events e ON e.id=c.turn_id||':result' WHERE substr(c.turn_id,1,?)=? LIMIT 1`).bind(prefix.length,prefix).first();
 if(result.modelVersion!==expected?.version)throw Error('e2e_model_version_mismatch');
 if(!accounting||reconciledCost(budget,result.usage)===null)throw Error('e2e_usage_required');
}
