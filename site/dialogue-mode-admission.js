// Inactive without a fresh publisher-bound capability. Historical calibration
// operations, receipts and paid expiry are never amended by this operation.
import {acceptanceContext,ACCEPTANCE_ORIGIN} from './dialogue-acceptance.js';
import {reconciledCost} from './dialogue-budget.js';

export const MODE_OPERATION='yw-continuous-mode-sample-v1';
export const MODE_LESSONS=Object.freeze(['lesson-1498','lesson-1578','lesson-1717-p2']);
const VERSION='yw-isolated-mode-admission-v1';
export const MODE_RENEWAL_VERSION='yw-isolated-mode-admission-v2';
const keys='apisVersion artifactSha256 authorityDigest databaseId enabled hardExpiry lessonPins maxProviderAttempts maxReservedMicros maxVisibleCalls model notBefore operation origin ownerUserId paidMicros priorCallCount priorLedgerDigest registryReceiptDigest reserveMicros singleProviderSourceProofDigest sourceCommit version'.split(' ').sort().join();
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const integer=(x,min,max)=>Number.isSafeInteger(x)&&x>=min&&x<=max;
const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))).map(x=>x.toString(16).padStart(2,'0')).join('');
const retained=new WeakMap();
const operation="COALESCE(json_extract(CASE WHEN json_valid(c.budget_policy_json) THEN c.budget_policy_json ELSE '{}' END,'$.isolatedAdmission.operation'),'')";
const authority="COALESCE(json_extract(CASE WHEN json_valid(c.budget_policy_json) THEN c.budget_policy_json ELSE '{}' END,'$.isolatedAdmission.authorityDigest'),'')";
// v1 keeps its original terminal operation boundary. Only an explicit v2
// publisher-bound approval starts a distinct transaction; every older call,
// including previous sampled failures and unknown costs, is frozen as history.
function currentTransaction(pin){return pin.version===MODE_RENEWAL_VERSION
 ?{sql:`(${operation}=? AND ${authority}=?)`,args:[MODE_OPERATION,pin.authorityDigest]}
 :{sql:`${operation}=?`,args:[MODE_OPERATION]};}
const priorSelect=`SELECT c.*,s.student_id AS session_owner,s.curriculum_json,e.details_json
 FROM dialogue_calls c JOIN dialogue_sessions s ON s.id=c.session_id
 LEFT JOIN dialogue_events e ON e.id=c.turn_id||':result'`;
const callFields=['turn_id','session_id','student_id','day','reserved_tokens','state','created_at','finished_at','usage_json','first_token_ms','completed_ms','reserved_micros','accounted_micros','budget_policy_json'];
const projection=row=>Object.fromEntries([...callFields,'session_owner','curriculum_json','details_json'].map(k=>[k,row[k]??null]));
export const modeLedgerProjection=rows=>rows.map(projection).sort((a,b)=>a.turn_id<b.turn_id?-1:a.turn_id>b.turn_id?1:0);
export const modeLedgerDigest=rows=>digest(modeLedgerProjection(rows));
export function modeConfigured(env){
 try{return !!acceptanceContext(env)&&JSON.parse(env.YW_E2E_AUTHORITY_JSON).operation===MODE_OPERATION;}catch{return false;}
}

export function modeDialogueAdmission(env,student,lessonId,budget,pin,at=Date.now()){
 const context=acceptanceContext(env),start=Date.parse(pin?.notBefore),end=Date.parse(pin?.hardExpiry);
 if(!context||!pin||Object.keys(pin).sort().join()!==keys||pin.enabled!==true||![VERSION,MODE_RENEWAL_VERSION].includes(pin.version)||pin.operation!==MODE_OPERATION
  ||pin.origin!==ACCEPTANCE_ORIGIN||pin.origin!==context.origin||pin.ownerUserId!==553||pin.ownerUserId!==context.userId||Number(student?.ucUserId)!==553
  ||pin.databaseId!=='c45988a6-9094-4306-bcce-98704b3989e3'||pin.databaseId!==context.databaseId||pin.apisVersion!==context.version
  ||!['artifactSha256','authorityDigest','priorLedgerDigest','registryReceiptDigest','singleProviderSourceProofDigest'].every(k=>hex(pin[k]))
  ||pin.registryReceiptDigest!==context.activationDigest||!/^[a-f0-9]{40}$/.test(pin.sourceCommit||'')
  ||!Number.isFinite(at)||!Number.isFinite(start)||!Number.isFinite(end)||start>at||at>=end||end>context.expires||end-start<=0||end-start>3600000
  ||!integer(pin.priorCallCount,1,2000)||!integer(pin.maxVisibleCalls,1,120)||pin.maxProviderAttempts!==1||pin.paidMicros!==0
  ||!integer(pin.reserveMicros,1,50000000)||pin.maxReservedMicros!==pin.maxVisibleCalls*pin.reserveMicros||pin.maxReservedMicros>50000000
  ||pin.model!=='gemini-3.8-flash'||budget.model!==pin.model||budget.logicalProviderAttemptLimit!==1||budget.providerAttemptLimit!==1
  ||budget.reserveMicros!==pin.reserveMicros||budget.perAttemptReserveMicros!==pin.reserveMicros
  ||!Array.isArray(pin.lessonPins)||pin.lessonPins.length!==3||JSON.stringify(pin.lessonPins.map(p=>p.lessonId))!==JSON.stringify(MODE_LESSONS)
  ||pin.lessonPins.some(p=>Object.keys(p).sort().join()!=='curriculumVersion,lessonId,sourceDigest'||typeof p.curriculumVersion!=='string'||!p.curriculumVersion||!hex(p.sourceDigest))
  ||!MODE_LESSONS.includes(lessonId))throw Error('mode_activation_invalid');
 return Object.freeze({...structuredClone(pin),lessonId});
}

// Hash the entire frozen pre-operation call ledger, including terminal failures
// and unknown-cost reservations. Repeat raw comparisons inside the D1 CAS; the
// pre-read cannot authorize a race, deletion, refund or a new historical call.
export async function prepareModeLedger(db,budget,studentId,curriculum){
 if(budget.isolatedAdmission?.operation!==MODE_OPERATION)return true;
 retained.delete(budget);
 const a=budget.isolatedAdmission,pin=a.lessonPins.find(p=>p.lessonId===curriculum?.lessonId);
 if(!pin||curriculum.curriculumVersion!==pin.curriculumVersion||await digest(curriculum)!==pin.sourceDigest)return false;
 const current=currentTransaction(a);
 const rows=(await db.prepare(priorSelect+` WHERE NOT (${current.sql}) ORDER BY c.turn_id LIMIT 2001`).bind(...current.args).all()).results||[];
 if(rows.length!==a.priorCallCount||rows.some(r=>!['finished','review'].includes(r.state)||!r.finished_at||!integer(r.reserved_micros,0,50000000)||r.accounted_micros!==null&&!integer(r.accounted_micros,0,r.reserved_micros))||await modeLedgerDigest(rows)!==a.priorLedgerDigest)return false;
 retained.set(budget,{rows:rows.map(projection),studentId});return true;
}

export function modeOperationCondition(budget,studentId){
 if(budget.isolatedAdmission?.operation!==MODE_OPERATION)return {sql:'1',args:[]};
 const a=budget.isolatedAdmission,saved=retained.get(budget),current=currentTransaction(a);
 if(!saved||saved.studentId!==studentId)return {sql:'0',args:[]};
 const compare=callFields.map(k=>`c.${k} IS NOT json_extract(p.value,'$.${k}')`).concat(["s.student_id IS NOT json_extract(p.value,'$.session_owner')","s.curriculum_json IS NOT json_extract(p.value,'$.curriculum_json')","e.details_json IS NOT json_extract(p.value,'$.details_json')"]).join(' OR ');
 return {sql:`(SELECT COUNT(*) FROM dialogue_calls c WHERE NOT (${current.sql}))=?
 AND NOT EXISTS(SELECT 1 FROM json_each(?) p LEFT JOIN dialogue_calls c ON c.turn_id=json_extract(p.value,'$.turn_id') LEFT JOIN dialogue_sessions s ON s.id=c.session_id LEFT JOIN dialogue_events e ON e.id=c.turn_id||':result' WHERE ${compare})
 AND (SELECT COUNT(*) FROM dialogue_calls c WHERE ${current.sql})<?
 AND (SELECT COALESCE(SUM(c.reserved_micros),0) FROM dialogue_calls c WHERE ${current.sql})+?<=?
 AND NOT EXISTS(SELECT 1 FROM dialogue_calls c WHERE ${current.sql} AND (c.state<>'finished' OR c.accounted_micros IS NULL OR c.accounted_micros<0 OR c.accounted_micros>c.reserved_micros OR c.reserved_micros<>? OR c.student_id<>?))
 AND NOT EXISTS(SELECT 1 FROM dialogue_calls WHERE state IN ('reserved','finishing'))`,
 args:[...current.args,a.priorCallCount,JSON.stringify(saved.rows),...current.args,a.maxVisibleCalls,...current.args,a.reserveMicros,a.maxReservedMicros,...current.args,a.reserveMicros,studentId]};
}

export function validateModeResult(budget,result,accounting){
 if(budget.isolatedAdmission?.operation!==MODE_OPERATION)return;
 if(result.model!==budget.isolatedAdmission.model||typeof result.modelVersion!=='string'||!result.modelVersion||!accounting||accounting.providerAttemptCount!==1||reconciledCost(budget,result.usage)===null)throw Error('mode_provider_result_unconfirmed');
}
