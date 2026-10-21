// Only the separate acceptance entrypoint can mint the WeakMap capability.
// Deployment pins are installed by the registered publisher after readback;
// copying these variables to ordinary Pages never grants this allowance.
import {acceptanceContext,ACCEPTANCE_ORIGIN} from './dialogue-acceptance.js';
import {RENEWED_E2E_OPERATION,renewedDialogueAdmission,renewedOperationCondition,renewedE2ECallLimit} from './dialogue-e2e-renewal.js';
import {MODE_OPERATION,modeDialogueAdmission,modeOperationCondition} from './dialogue-mode-admission.js';

export const E2E_OPERATION='yw-e2e-real-dialogue-01a132c3';
export const E2E_HARD_EXPIRY='2026-10-14T12:00:00Z';
export const E2E_AUTHORITY_DIGEST='97e5ab009b49ad7bd293f0762bcc8d63bc72f2458708a1f931da372a421cf8b4';
export const E2E_LESSONS=Object.freeze(['lesson-1498','lesson-1711-p1','lesson-1717-p2']);
const VERSION='yw-isolated-e2e-admission-v2';
const DIGEST=/^[a-f0-9]{64}$/;
const KEYS='apisVersion,authorityDigest,databaseId,enabled,hardExpiry,lessonIds,maxProviderAttempts,maxVisibleCalls,operation,origin,ownerUserId,registryReceiptDigest,reserveMicros,version';

export function isolatedDialogueAdmission(env,student,lessonId,budget,at=Date.now()){
 const context=acceptanceContext(env);
 // No activation configured preserves the ordinary limits, including on the
 // isolated host. Malformed configured activation must never fall back to 40.
 if(!context||env.YW_E2E_AUTHORITY_JSON===undefined)return null;
 let pin;try{pin=JSON.parse(env.YW_E2E_AUTHORITY_JSON);}catch{throw Error('e2e_activation_invalid');}
 if(pin?.operation===MODE_OPERATION)return modeDialogueAdmission(env,student,lessonId,budget,pin,at);
 if(pin?.operation===RENEWED_E2E_OPERATION)return renewedDialogueAdmission(env,student,lessonId,budget,pin,at);
 if(!pin||Array.isArray(pin)||Object.keys(pin).sort().join(',')!==KEYS
   ||pin.enabled!==true||pin.version!==VERSION||pin.operation!==E2E_OPERATION
   ||pin.authorityDigest!==E2E_AUTHORITY_DIGEST||pin.hardExpiry!==E2E_HARD_EXPIRY
   ||pin.origin!==ACCEPTANCE_ORIGIN||pin.origin!==context.origin
   ||pin.ownerUserId!==context.userId||Number(student?.ucUserId)!==context.userId
   ||pin.databaseId!==context.databaseId||pin.apisVersion!==context.version
   ||!DIGEST.test(pin.registryReceiptDigest||'')||pin.registryReceiptDigest!==context.activationDigest
   ||pin.maxVisibleCalls!==120||pin.maxProviderAttempts!==3||pin.reserveMicros!==252000
   ||!Array.isArray(pin.lessonIds)||JSON.stringify([...pin.lessonIds].sort())!==JSON.stringify(E2E_LESSONS)
   ||!E2E_LESSONS.includes(lessonId))throw Error('e2e_activation_invalid');
 if(!Number.isFinite(at)||at>=Math.min(context.expires,Date.parse(E2E_HARD_EXPIRY)))throw Error('e2e_activation_expired');
 const smokeLite=budget.model==='gemini-3.5-flash-lite'&&budget.version==='yw-dialogue-smoke-model35lite-20261013-v1';
 if((budget.model!=='gemini-3.8-flash'&&!smokeLite)||budget.logicalProviderAttemptLimit!==3
   ||budget.perAttemptReserveMicros!==84000||budget.reserveMicros!==252000)throw Error('e2e_budget_mismatch');
 return Object.freeze({version:VERSION,operation:E2E_OPERATION,ownerUserId:context.userId,
  databaseId:context.databaseId,registryReceiptDigest:pin.registryReceiptDigest,
  hardExpiry:E2E_HARD_EXPIRY,maxVisibleCalls:120,lessonId});
}

// Keep the count in the same D1 CAS/batch that reserves the logical call.
// No day, lesson, owner, deployment or status partition can reset this namespace.
const OPERATION_COUNT="(SELECT COUNT(*) FROM dialogue_calls WHERE json_extract(CASE WHEN json_valid(budget_policy_json) THEN budget_policy_json ELSE '{}' END,'$.isolatedAdmission.operation')=?)";
export function dialogueCallAdmission(budget,student,limits,day,at=new Date().toISOString()){
 const daily='(SELECT COUNT(*) FROM dialogue_calls WHERE day=?)<?';
 if(budget.isolatedAdmission?.operation===MODE_OPERATION){
  const condition=modeOperationCondition(budget,student.id);
  return {sql:`${daily} AND (${condition.sql})`,args:[day,limits.globalPerDay,...condition.args]};
 }
 if(budget.isolatedAdmission?.operation===RENEWED_E2E_OPERATION){
  const condition=renewedOperationCondition(budget,student.id);
  return {sql:`${daily} AND ${OPERATION_COUNT}<? AND ${condition.sql}`,args:[day,limits.globalPerDay,RENEWED_E2E_OPERATION,renewedE2ECallLimit(budget.isolatedAdmission),...condition.args]};
 }
 if(budget.isolatedAdmission?.operation===E2E_OPERATION)return {
  sql:`${daily} AND ${OPERATION_COUNT}<?`,args:[day,limits.globalPerDay,E2E_OPERATION,120],
 };
 // Shared pool: no daily call caps for ordinary learning; only short-term rate protection against runaway automation.
 if(budget.sharedPool)return {sql:'(SELECT COUNT(*) FROM dialogue_calls WHERE student_id=? AND created_at>=?)<?',args:[student.id,new Date(Date.parse(at)-budget.sharedPool.rateWindowSeconds*1000).toISOString(),budget.sharedPool.ratePerWindow]};
 return {sql:`${daily} AND (SELECT COUNT(*) FROM dialogue_calls WHERE student_id=? AND day=?)<?`,
  args:[day,limits.globalPerDay,student.id,day,limits.turnsPerDay]};
}
export async function isolatedCallCount(db,operation=E2E_OPERATION){
 if(![E2E_OPERATION,RENEWED_E2E_OPERATION,MODE_OPERATION].includes(operation))throw Error('e2e_operation_unknown');
 return (await db.prepare(`SELECT ${OPERATION_COUNT} AS n`).bind(operation).first()).n;
}
export function assertIsolatedCallCurrent(env,budget){
 if(!budget.isolatedAdmission)return;
 const prior=budget.isolatedAdmission;
 const current=isolatedDialogueAdmission(env,{ucUserId:prior.ownerUserId},prior.lessonId,budget);
 if(JSON.stringify(current)!==JSON.stringify(prior))throw Error('e2e_activation_changed');
}
