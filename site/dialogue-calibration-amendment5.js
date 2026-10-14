// Pure admission/accounting policy for an unapproved operation. No network,
// timers, database mutation, fallback, provider retry or activation side effects.
import {AMENDMENT5_CONTRACT as contract} from './dialogue-calibration-amendment5-contract.js';
import {LIMITS} from './dialogue-policy.js';
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const integer=value=>Number.isSafeInteger(value)&&value>=0;
const date=value=>typeof value==='string'?Date.parse(value):NaN;
const stop=(code,scope='case',extra={})=>({allowed:false,code,scope,...extra});

export function amendment5Budget(baseCases=28,recoveryCases=0,providerAttemptsPerRequest=1){
 if(!integer(baseCases)||baseCases<28||!integer(recoveryCases)||recoveryCases>baseCases||![1,3].includes(providerAttemptsPerRequest))throw Error('amendment5_budget_invalid');
 const attempts=baseCases+recoveryCases,extraAttempts=Math.max(0,attempts-contract.remainingAttempts);
 return {baseCases,recoveryCases,newAttempts:attempts,newReservedMicros:attempts*contract.reserveMicros*providerAttemptsPerRequest,
  inheritedRemainingAttempts:contract.remainingAttempts,inheritedRemainingReservedMicros:contract.remainingReservedMicros,
  extraAttempts,extraReservedMicros:extraAttempts*contract.reserveMicros,
  cumulativeAttempts:contract.priorAttempts+attempts,cumulativeReservedMicros:contract.priorReservedMicros+attempts*contract.reserveMicros*providerAttemptsPerRequest};
}

export function amendment5ConservativeMicros(rows){
 return rows.reduce((sum,row)=>{
  if(row.reservedMicros!==contract.reserveMicros||!(row.accountedMicros===null||integer(row.accountedMicros)))throw Error('amendment5_ledger_invalid');
  // Completion, partial text or a small later invoice does not refund the
  // reservation for an earlier call whose usage is still unknown.
  return sum+(row.accountedMicros===null?row.reservedMicros:row.accountedMicros);
 },0);
}

export function amendment5TerminalDisposition(row,readbacks=[]){
 if(!row||row.state!=='review'||!Number.isFinite(date(row.finishedAt))||row.boundaryStop||!hex(row.receiptDigest))return null;
 const fact=readbacks.find(f=>f.attemptId===row.attemptId&&f.receiptDigest===row.receiptDigest&&f.caseId===row.caseId);
 if(!fact||fact.requestId!==row.attemptId||!fact.evidenceRef||!hex(fact.evidenceSha256)||!hex(fact.invocationHash)||fact.brokerCompleted!==true||
  fact.providerAttemptCount!==1||fact.model!==contract.model||fact.fallback!==false||fact.hedge!==false||fact.backgroundCalls!==0||
  !integer(fact.retryAfterMs)||!integer(row.chunkCount)||!integer(row.partialChars))return null;
 const noOutput=row.chunkCount===0&&row.partialChars===0&&fact.noOutput===true;
 if(fact.kind==='provider503'&&fact.providerStatus===503&&noOutput&&row.finalAssessment===false)return fact;
 if(fact.kind==='fetch_error'&&fact.providerStatus==='FETCH_ERROR'&&row.finalAssessment===false&&
  (noOutput||(fact.noOutput===false&&row.chunkCount>0&&row.partialChars>0&&fact.partialOutput===true)))return fact;
 if(fact.kind==='stream_interrupted'&&fact.terminal===true&&fact.noOutput===false&&fact.partialOutput===true&&row.chunkCount>0&&row.partialChars>0&&row.finalAssessment===false)return fact;
 // A question/rubric fix changes the packet digest. It is never a disguised
 // same-packet replay of the earlier failed answer.
 if(fact.kind==='semantic_correction'&&fact.noOutput===false&&typeof fact.diagnosis==='string'&&fact.diagnosis.trim()&&
  typeof fact.correction==='string'&&fact.correction.trim()&&fact.changesPinnedCase===false&&row.finalAssessment===true&&integer(row.accountedMicros))return fact;
 return null;
}

// A model batch cannot verify its own source. Pending/missing grammar source
// authority blocks only cases about that item, before any reservation or call.
export function amendment5CaseSourceReadiness(c){
 const item=c?.curriculum?.languagePractice?.find(x=>x.id===c.objectiveId);
 const blockers=[];
 if(item){
  const status=item.sourceVerification?.status;
  if(status==='pending-verification')blockers.push('source_verification_pending');
  else if(/:grammar-/.test(item.id)&&status!=='source-context-reviewed')blockers.push('grammar_source_verification_missing_or_unknown');
  if(item.dictionaryId&&c.curriculum.dictionary?.find(x=>x.id===item.dictionaryId)?.verificationStatus!=='source-image-verified')blockers.push('dictionary_source_verification_required');
 }
 return {eligible:blockers.length===0,status:blockers.length?'source-blocked':'source-ready-for-semantic-calibration',objectiveId:c?.objectiveId||null,blockers,sourceVerification:item?.sourceVerification||null,doesNotApproveRealMastery:true};
}

// An offline planning function: even an allowed result cannot invoke a model.
// authority is trusted server configuration after approval, never request JSON.
export function amendment5Admission({packet,rows=[],history,capacity,caseId,recoveryOf=null,readbacks=[],now=Date.now(),authority=contract}){
 if(authority.status!=='approved'||authority.active!==true||authority.paidCallsAuthorized!==true||!hex(authority.approvalDigest)||!hex(authority.registryReceiptDigest))return stop('amendment5_approval_required','operation');
 if(!packet||packet.operation!==contract.operation||!hex(packet.sourceDigest)||packet.sourceDigest!==authority.packetDigest||packet.sourceDigest!==contract.packetDigest||packet.cases.length<28||new Set(packet.cases.map(c=>c.id)).size!==packet.cases.length)return stop('amendment5_packet_mismatch','operation');
 const index=packet.cases.findIndex(c=>c.id===caseId);if(index<0)return stop('amendment5_case_invalid');
 const sourceReadiness=amendment5CaseSourceReadiness(packet.cases[index]);if(!sourceReadiness.eligible)return stop('amendment5_case_source_verification_required','case',{caseId,sourceReadiness});
 if(!integer(authority.approvedNewAttempts)||authority.approvedNewAttempts<packet.cases.length||authority.approvedNewAttempts>packet.cases.length*2||
  authority.approvedNewReservedMicros!==authority.approvedNewAttempts*contract.reserveMicros)return stop('amendment5_budget_approval_insufficient','operation');
 // New direct cost authority permits starting when the exact candidate is
 // ready; the former 04-08Z suggestion is not a timer or a reason to idle.
 if(!Number.isFinite(date(authority.readyAt))||date(authority.readyAt)<date(contract.authorizedAt)||!Number.isFinite(now)||now<date(authority.readyAt))return stop('amendment5_candidate_not_ready','operation');
 if(now>=Date.parse(contract.hardExpiry))return stop('amendment5_window_closed','operation');
 if(!history||history.attempts!==contract.priorAttempts||history.reservedMicros!==contract.priorReservedMicros||history.knownMicros!==contract.priorKnownMicros||history.unknownReservedMicros!==contract.priorUnknownReservedMicros||
  history.allReceiptsReconciled!==true||!hex(history.receiptSetDigest)||history.receiptSetDigest!==authority.priorReceiptSetDigest)return stop('amendment5_history_reconciliation_required','operation');
 if(!Array.isArray(rows)||new Set(rows.map(r=>r.attemptId)).size!==rows.length||rows.some(r=>typeof r.attemptId!=='string'||!r.attemptId.startsWith(contract.operation+':')||!['reserved','finishing','finished','review'].includes(r.state)||rows.filter(x=>x.caseId===r.caseId).length>2))return stop('amendment5_ledger_invalid','operation');
 try{amendment5ConservativeMicros(rows);}catch{return stop('amendment5_ledger_invalid','operation');}
 if(rows.some(r=>!packet.cases.some(c=>c.id===r.caseId)||r.boundaryStop||r.model&&r.model!==contract.model))return stop('amendment5_boundary_stop','operation');
 if(rows.length>=authority.approvedNewAttempts||(rows.length+1)*contract.reserveMicros>authority.approvedNewReservedMicros)return stop('amendment5_budget_exhausted','operation');
 if(!capacity||!['userDayCalls','globalDayCalls','reservedConcurrentCalls','userDayConservativeMicros','globalDayConservativeMicros'].every(k=>integer(capacity[k])))return stop('amendment5_capacity_readback_required','operation');
 // The authorized synthetic operation has its own finite 56-call allowance.
 // It does not raise the 40/day limit on the ordinary student dialogue route.
 if(capacity.globalDayCalls>=LIMITS.globalPerDay||capacity.reservedConcurrentCalls>=LIMITS.concurrency||capacity.userDayConservativeMicros+contract.reserveMicros>50000000||capacity.globalDayConservativeMicros+contract.reserveMicros>50000000)return stop('amendment5_shared_capacity_exhausted','operation');
 const same=rows.filter(r=>r.caseId===caseId);
 // Other cases may be unfinished, semantically rejected or awaiting terminal
 // telemetry. Only this case needs a reconciled predecessor for its recovery.
 if(!same.length){if(recoveryOf!==null)return stop('amendment5_recovery_target_invalid');return {allowed:true,caseId,index,attempt:same.length+1,recoveryOf:null,reserveMicros:contract.reserveMicros,maxProviderAttempts:1};}
 if(same.length>=2)return stop('amendment5_case_recovery_exhausted');
 const prior=same[0];
 if(prior.state==='finished')return stop('amendment5_case_already_finished');
 if(recoveryOf!==prior.attemptId)return stop('amendment5_same_case_receipt_required');
 const fact=amendment5TerminalDisposition(prior,readbacks);
 if(!fact)return stop('amendment5_terminal_readback_required');
 const resumeAt=date(prior.finishedAt)+Math.max(fact.retryAfterMs,fact.kind==='semantic_correction'?0:contract.providerCooldownMs);
 if(now<resumeAt)return stop('amendment5_case_cooldown','case',{resumeAt:new Date(resumeAt).toISOString()});
 return {allowed:true,caseId,index,attempt:2,recoveryOf:prior.attemptId,previousReceipt:prior.receiptDigest,reserveMicros:contract.reserveMicros,maxProviderAttempts:1};
}

// A routable preparation endpoint has no activation argument. Even copied
// approval fields or a model callback supplied by a caller cannot spend money.
export function handleAmendment5Calibration(){
 return Response.json({code:'amendment5_activation_required',operation:contract.operation,status:contract.status,active:false,paidCallsAuthorized:contract.paidCallsAuthorized},
  {status:409,headers:{'cache-control':'private, no-store'}});
}
