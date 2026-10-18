// Prepared, isolated-only extension. No activation is supplied by request JSON.
import {acceptanceContext} from './dialogue-acceptance.js';
import {createQuestion,projectState,contextFor} from './dialogue-policy.js';
// New finite operation; no existing or expired allowance is resumed.
export const FULL_OPERATION='yw-dialogue-full-calibration-20261017-v1';
export const FULL_E2E_OPERATION='yw-e2e-real-dialogue-20261017-v1';
export const FULL_CASE_COUNT=235; // Immutable packet, including deferred cases.
export const RELEASE_CASE_COUNT=28;
export const releaseCases=packet=>packet.cases.filter(c=>c.group==='representative-28');
export const FULL_MODEL='gemini-3.8-flash';
export const FULL_MAX_WINDOW_MS=6*60*60*1000;
export const HISTORICAL_BASE='yw-dialogue-real-calibration-20261012-v1';
export const ORIGINAL_IDS=[HISTORICAL_BASE+':language-er-independent',HISTORICAL_BASE+'-amendment-1:language-er-independent',...[1,2].map(n=>HISTORICAL_BASE+'-amendment-2:attempt-'+n),...[1,2,3].map(n=>HISTORICAL_BASE+'-amendment-3:attempt-'+n)];
export const ORIGINAL_RECEIPTS=Object.freeze([{"attemptId":"yw-dialogue-real-calibration-20261012-v1-amendment-1:language-er-independent","receiptDigest":"d7b837b1b0820d482ea6408c08d4c5341076f60a758f22a69727608b6b68d31f"},{"attemptId":"yw-dialogue-real-calibration-20261012-v1-amendment-2:attempt-1","receiptDigest":"98df8ec9f3af4e92c280d39ef73ae166abf811809529d47f69ccf1c2196c2a39"},{"attemptId":"yw-dialogue-real-calibration-20261012-v1-amendment-2:attempt-2","receiptDigest":"7404cde7868c7dfc22ec29da7e1964b8eb5dcce79d86773f52c47d28bb6fe665"},{"attemptId":"yw-dialogue-real-calibration-20261012-v1-amendment-3:attempt-1","receiptDigest":"091e03039f8af60d134d3fe67bb5c077bfee91a393b518dbeee9bc0c1260b679"},{"attemptId":"yw-dialogue-real-calibration-20261012-v1-amendment-3:attempt-2","receiptDigest":"bec7f49defbb54f917cb1063552e6044ce21a2eaaf6c56aff6ee0911f6d8536d"},{"attemptId":"yw-dialogue-real-calibration-20261012-v1-amendment-3:attempt-3","receiptDigest":"6c5335944525b6971a130b66cfdd65a221c78075833e97bde3366f316609528a"},{"attemptId":"yw-dialogue-real-calibration-20261012-v1:language-er-independent","receiptDigest":"448a5d9917ec3fdda9b774655080fdff9b7e73ad955b3b1df271defbe81b848a"}]);
export const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))).map(x=>x.toString(16).padStart(2,'0')).join('');
export const fullReceipt=row=>digest({id:row.turn_id,state:row.state,reserved:row.reserved_micros,accounted:row.accounted_micros,created:row.created_at,finished:row.finished_at,source:row.curriculum_json,result:row.details_json});
// Explicit receipt-bound recoveries only; every failed charge remains immutable.
export const QUOTE_RECOVERY=Object.freeze({caseId:'language-er-independent',attemptId:FULL_OPERATION+':language-er-independent:1',receiptDigest:'77c5dccbb48ed924abfe6fa7082dd7d73cd00fdacb4010e84a3b0e69433e9252',attempt:2,reason:'unverifiable_evidence',promptDigest:'df0780d77e833d0fe64ae691edbda0689f635220c565646833d4f1b8a757dffd'});
export const QUOTE_RECOVERY_INSTRUCTION='補充引文格式要求：每一筆 evidence 的 quote 和 passageQuote 都必須是各自指定學生回合或原文段落中的一段連續原文，逐字保留字形、標點與次序。若需要引用兩處不相鄰的原文，請分成兩筆 evidence，分別填寫各自的 passageId 與 passageQuote；不得把不同位置的片段拼接、倒置、刪去中間文字或以省略號連成同一引文。這項要求只規範引文格式，不改變原有判準或預定任何評定結果。';
export const TIMEOUT_RECOVERY=Object.freeze({...QUOTE_RECOVERY,attemptId:FULL_OPERATION+':language-er-independent:2',receiptDigest:'b41d1c970dce288895d60f23cd4959289d76e1869485f7179ae78c66a144b4f3',attempt:3,reason:'gateway_unavailable'});
export const CASE2_RECOVERY=Object.freeze({caseId:'language-er-misconception',attemptId:FULL_OPERATION+':language-er-misconception:1',receiptDigest:'b0e1633c7fa1d5e4a85b2fc6bf5dbcb9c789765f0af69b39468b298a434ae901',attempt:2,reason:'gateway_unavailable',promptDigest:'ef5621bd06bc7e44a848449d40bfd589400cb3bfeb526ec36c8eddaf8cf47c6a'});
export const CASE2_QUOTE_RECOVERY=Object.freeze({...CASE2_RECOVERY,attemptId:FULL_OPERATION+':language-er-misconception:2',receiptDigest:'314599a28c92a3e84466f14ea3862b3479d3dc4d7988f4ee6503b7b61bf064c4',attempt:3,reason:'unverifiable_evidence',promptDigest:'a70280936a83592d6dcd732bc0c6d003b891bb50cbb7a3b754fd7aa92bcdee48'});
export const CASE2_FINITE_RECOVERY=Object.freeze({...CASE2_QUOTE_RECOVERY,attemptId:FULL_OPERATION+':language-er-misconception:3',receiptDigest:'c73e73d3ba5cb71871752c746d2b0428f3d52acb6ba0366dbf2c5ef9b8de1ba6',attempt:4,reason:'gateway_unavailable'});
export const needsQuotationInstruction=pin=>[QUOTE_RECOVERY,TIMEOUT_RECOVERY,CASE2_QUOTE_RECOVERY,CASE2_FINITE_RECOVERY].includes(pin);
const exactRecovery=(a,b)=>!!a&&Object.keys(a).length===Object.keys(b).length&&Object.entries(b).every(([k,v])=>a[k]===v);
export function recoveryChain(authority){
 const pins=authority?.recoveryReadbacks;
 const allowed=[QUOTE_RECOVERY,TIMEOUT_RECOVERY,CASE2_RECOVERY,CASE2_QUOTE_RECOVERY,CASE2_FINITE_RECOVERY];
 if(!Array.isArray(pins)||pins.length<1||pins.length>5||pins.some((p,i)=>!exactRecovery(p,allowed[i])))return [];
 return allowed.slice(0,pins.length);
}
export const caseRecovery=(authority,caseId)=>recoveryChain(authority).filter(p=>p.caseId===caseId).at(-1)||null;
export const quotationRecovery=authority=>caseRecovery(authority,QUOTE_RECOVERY.caseId);
export const recoveryPrompt=prompt=>prompt+'\n\n'+QUOTE_RECOVERY_INSTRUCTION;
export const recoveryFailureMatches=(r,pin=QUOTE_RECOVERY)=>r?.caseId===pin.caseId&&r.attemptId===pin.attemptId&&r.receiptDigest===pin.receiptDigest&&r.state==='review'&&r.reservedMicros===84000&&!!r.finishedAt&&!r.boundaryStop&&(pin.reason==='unverifiable_evidence'?r.accountedMicros===0&&r.finalAssessment&&r.model===FULL_MODEL&&r.modelVersion===FULL_MODEL:r.accountedMicros===null&&!r.finalAssessment&&!r.model&&!r.modelVersion&&r.chunkCount===0&&r.partialChars===0);
// All receipt-bearing fields are compared again in the atomic reservation, after
// their complete hashes have been checked. Unknown cost is never changed to zero.
export function failedReceiptCondition(rows){
 return {sql:`NOT EXISTS(SELECT 1 FROM json_each(?) p LEFT JOIN dialogue_calls f ON f.turn_id=json_extract(p.value,'$.turn_id') LEFT JOIN dialogue_sessions s ON s.id=f.session_id LEFT JOIN dialogue_events e ON e.id=f.turn_id||':result'
 WHERE f.state IS NOT json_extract(p.value,'$.state') OR f.reserved_micros IS NOT json_extract(p.value,'$.reserved_micros') OR f.accounted_micros IS NOT json_extract(p.value,'$.accounted_micros') OR f.created_at IS NOT json_extract(p.value,'$.created_at') OR f.finished_at IS NOT json_extract(p.value,'$.finished_at') OR s.curriculum_json IS NOT json_extract(p.value,'$.curriculum_json') OR e.details_json IS NOT json_extract(p.value,'$.details_json') OR f.student_id IS NOT json_extract(p.value,'$.student_id') OR s.student_id IS NOT json_extract(p.value,'$.session_owner') OR (SELECT COUNT(*) FROM dialogue_stream_chunks k WHERE k.turn_id=f.turn_id) IS NOT json_extract(p.value,'$.chunk_count') OR (SELECT COALESCE(SUM(LENGTH(content)),0) FROM dialogue_stream_chunks k WHERE k.turn_id=f.turn_id) IS NOT json_extract(p.value,'$.partial_chars'))`,args:[JSON.stringify(rows)]};
}
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const int=x=>Number.isSafeInteger(x)&&x>=0;
const stop=(code,scope='case',extra={})=>({allowed:false,code,scope,...extra});
export function fullActivation(env,packet,now=Date.now()){
 const context=acceptanceContext(env);let a;try{a=JSON.parse(env.YW_CALIBRATION_FULL_LANGUAGE_JSON);}catch{return null;}
 const keys=['version','enabled','operation','authorityDigest','packetDigest','sourceCommit','artifactSha256','origin','ownerUserId','databaseId','apisVersion','registryReceiptDigest','singleProviderSourceProofDigest','priorReceiptSetDigest','priorReceipts','readyAt','hardExpiry','maxAttempts','maxReservedMicros','maxProviderAttempts','reserveMicros','maxConcurrency','recoveryReadbacks'];
 if(!context||!a||Object.keys(a).sort().join()!==keys.sort().join()||a.version!=='yw-full-language-activation-v1'||a.enabled!==true||a.operation!==FULL_OPERATION||!hex(a.authorityDigest)||a.packetDigest!==packet.sourceDigest||!hex(a.packetDigest)||!hex(a.artifactSha256)||!/^[a-f0-9]{40}$/.test(a.sourceCommit||'')||a.origin!==context.origin||a.origin!=='https://yw-acceptance.bdfz.net'||a.ownerUserId!==context.userId||a.ownerUserId!==553||a.databaseId!==context.databaseId||a.databaseId!=='c45988a6-9094-4306-bcce-98704b3989e3'||a.apisVersion!==context.version||['66cfaab9-e1a4-4a31-a8c4-98e656db7e04','53dbb568-9c83-4685-ac82-04a64e2211e1'].includes(a.apisVersion)||!hex(a.registryReceiptDigest)||a.registryReceiptDigest!==env.YW_FULL_LANGUAGE_ACTIVATION_SHA256||a.registryReceiptDigest!==context.activationDigest||!hex(a.singleProviderSourceProofDigest)||!hex(a.priorReceiptSetDigest)||!Number.isFinite(Date.parse(a.readyAt))||!Number.isFinite(Date.parse(a.hardExpiry))||Date.parse(a.hardExpiry)>Date.parse(a.readyAt)+FULL_MAX_WINDOW_MS||Date.parse(a.hardExpiry)>context.expires||!(Date.parse(a.readyAt)<=now&&now<Date.parse(a.hardExpiry)&&now<context.expires)||a.maxAttempts!==RELEASE_CASE_COUNT+recoveryChain(a).length||a.maxReservedMicros!==(RELEASE_CASE_COUNT+recoveryChain(a).length)*84000||a.maxProviderAttempts!==1||a.reserveMicros!==84000||a.maxConcurrency!==1||!Array.isArray(a.recoveryReadbacks)||(a.recoveryReadbacks.length!==0&&!quotationRecovery(a))||!Array.isArray(a.priorReceipts)||a.priorReceipts.length<7||a.priorReceipts.length>1000)return null;
 if(!ORIGINAL_RECEIPTS.every(p=>a.priorReceipts.some(x=>x.attemptId===p.attemptId&&x.receiptDigest===p.receiptDigest)))return null;
 if(new Set(a.priorReceipts.map(x=>x.attemptId)).size!==a.priorReceipts.length||!ORIGINAL_IDS.every(id=>a.priorReceipts.some(x=>x.attemptId===id))||a.priorReceipts.some(x=>!hex(x.receiptDigest)||(!ORIGINAL_IDS.includes(x.attemptId)&&!new RegExp('^'+HISTORICAL_BASE+'-amendment-[45]:[a-z0-9-]+:[12]$').test(x.attemptId))))return null;
 return Object.freeze({...a});
}
export function fullSourceGate(source,spec){
 const item=source?.languagePractice?.find(x=>x.id===spec.objectiveId),reasons=[];
 if(source?.sourceStatus!=='source-ready'||!source?.objectives?.some(x=>x.id===spec.objectiveId))reasons.push('source_missing');
 if(item?.sourceVerification?.status==='pending-verification'||item?.type==='grammar'&&item?.sourceVerification?.status!=='source-context-reviewed')reasons.push('source_verification_pending');
 if(item?.dictionaryId&&source.dictionary?.find(x=>x.id===item.dictionaryId)?.verificationStatus!=='source-image-verified')reasons.push('dictionary_unverified');
 if(item&&(!item.sourcePassages?.length||!item.passageQuotes?.every(q=>source.passages.some(p=>p.text.includes(q)))))reasons.push('source_quote_missing');
 if(item&&item.version!==spec.itemVersion)reasons.push('item_version_drift');
 return {eligible:!reasons.length,reasons};
}
export function fullMaterialize(spec,source){
 const curriculum=structuredClone(source),item=curriculum.languagePractice.find(x=>x.id===spec.objectiveId);
 if(item&&fullSourceGate(source,spec).eligible)item.calibrationStatus='accepted';
 if(spec.fixture){const {state,turns,question}=structuredClone(spec.fixture);return {curriculum,state,turns,question,prompt:contextFor({curriculum,state,turns,question})};}
 const question=createQuestion(curriculum,{objectiveId:spec.objectiveId,random:0});question.id='calibration-question:'+spec.id+':full-language';question.createdAt='2026-10-17T00:00:00Z';question.question=spec.validationQuestion;
 const turns=[{id:'calibration-question-turn:'+spec.id,role:'teacher',content:spec.validationQuestion}];
 if(spec.teacherHint)turns.push({id:'calibration-hint:'+spec.id,role:'teacher',content:spec.teacherHint});
 turns.push({id:'calibration-answer:'+spec.id,role:'student',content:spec.studentAnswer,questionId:question.id});
 const state=projectState(curriculum,[],[]);return {curriculum,state,turns,question,prompt:contextFor({curriculum,state,turns,question})};
}
export function fullAdmission({authority,packet,caseId,rows=[],history,capacity,recoveryOf=null,now=Date.now()}){
 if(!authority)return stop('full_activation_required','operation');
 if(!Number.isFinite(now)||!Number.isFinite(Date.parse(authority.readyAt))||!Number.isFinite(Date.parse(authority.hardExpiry))||now<Date.parse(authority.readyAt)||now>=Date.parse(authority.hardExpiry))return stop('full_expired','operation');
 if(!history?.reconciled||history.receiptSetDigest!==authority.priorReceiptSetDigest)return stop('full_history_unreconciled','operation');
 const chain=recoveryChain(authority),recovery=chain.at(-1),failed=chain.map(pin=>rows.find(r=>r.attemptId===pin.attemptId)),replacement=recovery&&rows.find(r=>r.attemptId===FULL_OPERATION+':'+recovery.caseId+':'+recovery.attempt);
 const previousCases=[...new Set(chain.slice(0,-1).map(p=>p.caseId))].filter(id=>id!==recovery?.caseId);
 if(previousCases.some(id=>{const p=caseRecovery(authority,id);return !rows.some(r=>r.attemptId===FULL_OPERATION+':'+id+':'+p.attempt&&r.state==='finished');}))return stop('full_recovery_required','operation');
 if(chain.some((pin,i)=>!recoveryFailureMatches(failed[i],pin)||!failed[i].sourceValid))return stop('full_recovery_receipt_mismatch','operation');
 if(rows.some(r=>r.sourceValid!==true||!['reserved','finishing','finished','review'].includes(r.state)||r.state==='finished'&&(!r.finishedAt||r.accountedMicros===null||!r.finalAssessment||typeof r.modelVersion!=='string'||!r.modelVersion||r.model!==FULL_MODEL)||!packet.cases.some(c=>c.id===r.caseId)||(r.attemptId!==FULL_OPERATION+':'+r.caseId+':1'&&!(chain.some(p=>r.caseId===p.caseId&&r.attemptId===FULL_OPERATION+':'+r.caseId+':'+p.attempt)))||r.reservedMicros!==84000||r.accountedMicros!==null&&(!int(r.accountedMicros)||r.accountedMicros>84000))||new Set(rows.map(r=>r.attemptId)).size!==rows.length)return stop('full_ledger_invalid','operation');
 // A failed or unknown case ends this batch. Neither a new day nor another case
 // can refund its reservation or restart it; only same-attempt readback remains.
 if(new Set(rows.map(r=>r.modelVersion).filter(Boolean)).size>1||rows.some(r=>!(failed.includes(r))&&(r.boundaryStop||r.state==='review'||r.model&&r.model!==FULL_MODEL)))return stop('full_boundary_stop','operation');
 if(rows.length>=RELEASE_CASE_COUNT+chain.length||rows.reduce((n,r)=>n+r.reservedMicros,0)+84000>(RELEASE_CASE_COUNT+chain.length)*84000)return stop('full_operation_exhausted','operation');
 if(!capacity||!['globalDayCalls','reservedConcurrentCalls','operationConcurrentCalls','globalDayConservativeMicros','userDayConservativeMicros'].every(k=>int(capacity[k])))return stop('full_capacity_unknown','operation');
 if(capacity.globalDayCalls>=400||capacity.globalDayConservativeMicros+84000>50000000||capacity.userDayConservativeMicros+84000>50000000)return stop('full_shared_capacity_exhausted','operation');
 if(capacity.reservedConcurrentCalls>=4||capacity.operationConcurrentCalls>=1)return stop('full_concurrency_busy','case');
 const c=packet.cases.find(x=>x.id===caseId);if(c&&c.group!=='representative-28')return stop('full_case_deferred');
 if(!c||!c.sourceGate.eligible)return stop('full_case_source_blocked');
 if(recovery&&caseId===recovery.caseId&&recoveryOf===recovery.receiptDigest&&!replacement)return {allowed:true,attempt:recovery.attempt};
 if(recovery&&(!replacement||replacement.state!=='finished'))return stop('full_recovery_required','operation');
 if(rows.some(r=>r.caseId===caseId))return stop('full_case_already_attempted');
 return recoveryOf===null?{allowed:true,attempt:1}:stop('full_recovery_not_authorized');
}
