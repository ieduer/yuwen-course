import {dialogueBudget,reconciledCost} from './dialogue-budget.js';
import {validatedProviderAccounting} from './dialogue-stream.js';
import {isolatedDialogueAdmission,isolatedCallCount} from './dialogue-e2e-admission.js';
import {renewedBudgetDenial} from './dialogue-e2e-renewal.js';
import {MODE_OPERATION,modeOperationCondition} from './dialogue-mode-admission.js';

// Activation is explicit. Calibration passes its own one-attempt budget and
// never uses this wrapper. One logical learner turn reserves all three slots.
export function requestDialogueBudget(env,student,lessonId){
 const policy=dialogueBudget(env),limit=env.YW_DIALOGUE_PROVIDER_ATTEMPTS==='3'?3:1;
 // One primary attempt at the declared reserve plus (limit-1) fallback attempts at the fallback reserve (0 for the free pool).
 const reserveMicros=policy.reserveMicros+(policy.fallbackReserveMicros??policy.reserveMicros)*(limit-1);
 if(reserveMicros>Math.min(policy.globalDailyMicros,policy.userDailyMicros,policy.lessonLifetimeMicros))throw Error('retry_reserve_exceeds_budget');
 const budget={...policy,perAttemptReserveMicros:policy.reserveMicros,fallbackReserveMicros:policy.fallbackReserveMicros??policy.reserveMicros,providerAttemptLimit:limit,logicalProviderAttemptLimit:limit,reserveMicros};
 // The price policy cannot mint operation admission, even in server config.
 delete budget.isolatedAdmission;
 const admission=isolatedDialogueAdmission(env,student,lessonId,budget);
 if(limit>1&&!['gemini-3.6-flash','gemini-3.8-flash'].includes(policy.model)&&!(admission&&policy.model==='gemini-3.5-flash-lite'&&policy.version==='yw-dialogue-smoke-model35lite-20261013-v1'))throw Error('retry_model_mismatch');
 return admission?{...budget,isolatedAdmission:admission}:budget;
}

export function combinedProviderAccounting(value,budget,prior=[],success=false){
 if(!value)return null;
 const next=validatedProviderAccounting(value,{maxProviderAttempts:budget.providerAttemptLimit||1,success,model:budget.model,primaryModel:budget.primaryModel||null});
 const attempts=[...prior,...next.attempts.map(a=>({...a,ordinal:a.ordinal+prior.length}))];
 const maxProviderAttempts=budget.logicalProviderAttemptLimit||budget.providerAttemptLimit||1;
 if(attempts.length>maxProviderAttempts)throw Error('logical_provider_limit');
 return {...next,maxProviderAttempts,providerAttemptCount:attempts.length,attempts,...(prior.length?{continuedAfter:prior.length}:{})};
}

export function operatorCost(budget,result,accounting){
 if(!accounting)return (budget.logicalProviderAttemptLimit||1)===1?reconciledCost(budget,result?.usage,result?.model||null):null;
 let cost=0;
 for(const a of accounting.attempts){
  const known=reconciledCost(budget,a.usage,a.model);
  // Unknown usage retains the attempt's own reserve: the primary (or single-model) reserve, or the fallback reserve for a fallback attempt.
  const retained=budget.primaryModel&&a.model!==budget.primaryModel?(budget.fallbackReserveMicros??budget.perAttemptReserveMicros):(budget.perAttemptReserveMicros||budget.reserveMicros);
  cost+=known===null?retained:known;
 }
 return Number.isSafeInteger(cost)&&cost<=budget.reserveMicros?cost:null;
}

export function continuationDisposition(call,failure,continued=false,{noOutput=false}={}){
 const deny=code=>({allowed:false,code,requiresUserAction:true});
 if(!call||call.state!=='review')return deny('response_not_terminal');
 if(call.source_request_json)return deny('original_source_readback_required');
 if(continued)return deny('continuation_already_used');
 let policy;try{policy=JSON.parse(call.budget_policy_json);}catch{return deny('provider_budget_unverified');}
 const limit=policy.logicalProviderAttemptLimit||policy.providerAttemptLimit||1;
 if(limit!==3)return deny('continuation_not_reserved');
 // A provider result that completed but was rejected by the finish validation (proposal, original or reading evidence)
 // may be regenerated once by an explicit learner action; it is never retried silently and the OK attempt stays accounted.
 const lastOutcome=failure?.providerAccounting?.attempts?.at?.(-1)?.outcome;
 const rejectedAfterSuccess=['proposal','original_evidence','reading_evidence'].includes(failure?.stage)&&lastOutcome==='OK';
 if(lastOutcome==='OK'&&!rejectedAfterSuccess)return deny('provider_failure_not_retryable');
 let accounting;try{accounting=validatedProviderAccounting(failure?.providerAccounting,{maxProviderAttempts:limit,model:policy.model,primaryModel:policy.primaryModel||null,success:rejectedAfterSuccess});}catch{return deny('provider_completion_unconfirmed');}
 // A failed primary (Claude) attempt that reached the provider counts like a retryable free-pool failure for recovery purposes.
 // CLAUDE_TRUNCATED: the broker completed the attempt but the structured reply hit the output-token bound; the gateway never
 // relays a truncated answer, so the learner saw nothing and may ask once for a new reply (the paid attempt stays accounted).
 const failedPrimary=a=>!!policy.primaryModel&&a.model===policy.primaryModel&&a.outcome!=='OK';
 const retryable=a=>['FETCH_ERROR','TIMEOUT','UNAVAILABLE','500','502','503','504'].includes(a.outcome)||(failedPrimary(a)&&/^(CANCELLED|CLAUDE_(TIMEOUT|NETWORK_ERROR|STREAM_INCOMPLETE|TRUNCATED|HTTP_(408|429|5[0-9][0-9])))$/.test(a.outcome));
 if(!accounting.attempts.length||accounting.attempts.some(a=>!a.brokerCompleted))return deny('provider_completion_unconfirmed');
 // noOutput: every attempt ended before any learner-visible output (gateway timeout/unavailable, or a failed primary attempt whose
 // buffered output the gateway never relayed); one explicit learner-initiated retry re-dispatches the same saved turn.
 if(noOutput){if(accounting.attempts.some(a=>a.outputStarted&&!failedPrimary(a)))return deny('partial_output_present');}
 else if(accounting.attempts.at(-1).outputStarted!==true)return deny('partial_provider_mismatch');
 if(!rejectedAfterSuccess&&accounting.attempts.some(a=>!retryable(a)))return deny('provider_failure_not_retryable');
 if(rejectedAfterSuccess&&accounting.attempts.slice(0,-1).some(a=>!retryable(a)))return deny('provider_failure_not_retryable');
 const remaining=limit-accounting.providerAttemptCount;
 if(remaining<1)return deny('provider_attempt_limit');
 return {allowed:true,code:noOutput?'explicit_retry_available':rejectedAfterSuccess?'explicit_regeneration_available':'explicit_continuation_available',requiresUserAction:true,remainingProviderAttempts:remaining,providerAttemptsUsed:accounting.providerAttemptCount};
}

export async function budgetDenial(db,session,student,budget,limits,day){
 const q=async(text,...args)=>(await db.prepare(text).bind(...args).first()).n;
 const response=(code,scope,retryable)=>({code,scope,retryable,canSave:true,canExport:true,canReview:true,...(scope==='daily'?{resetsAt:new Date(Date.parse(day+'T00:00:00Z')+86400000).toISOString()}:{}),message:scope==='lifetime'?'本課已達累計 AI 額度；明日不會自動重置。文字已保存，仍可閱讀、匯出及交由教師覆核。':scope==='daily'?'本輪尚未呼叫 AI；文字已保存，可於每日額度恢復後繼續，歷史紀錄不受影響。':scope==='concurrency'?'目前仍有回應正在處理；文字已保存，請稍後讀回。':'本輪尚未呼叫 AI；文字已保存，支出紀錄需要先核對。'});
 if(await q('SELECT COUNT(*) n FROM dialogue_calls WHERE session_id=?',session.id)>=limits.paidLessonLifetime)return response('paid_lesson_lifetime_exhausted','lifetime',false);
 if(await q("SELECT COUNT(*) n FROM dialogue_turns WHERE session_id=? AND role='student'",session.id)>=limits.lessonLifetime)return response('lesson_turn_lifetime_exhausted','lifetime',false);
 if(await q('SELECT COUNT(*) n FROM dialogue_calls WHERE budget_policy_json IS NULL'))return response('budget_accounting_review','review',false);
 if(budget.isolatedAdmission?.operation===MODE_OPERATION){
  const condition=modeOperationCondition(budget,student.id);
  if(!await q('SELECT ('+condition.sql+') n',...condition.args))return response('mode_operation_review_required','operation',false);
 }
 if(budget.isolatedAdmission&&await isolatedCallCount(db,budget.isolatedAdmission.operation)>=120)return {...response('e2e_operation_call_budget_exhausted','operation',false),operation:budget.isolatedAdmission.operation,message:'本次驗收已達累計 120 輪上限；不會按日期重置。文字與支出紀錄保留，可讀回及匯出。'};
 const renewedDenial=await renewedBudgetDenial(db,budget,student.id);
 if(renewedDenial)return response(renewedDenial,renewedDenial==='e2e_operation_concurrency_busy'?'concurrency':'operation',false);
 if(await q('SELECT COUNT(*) n FROM dialogue_calls WHERE day=?',day)>=limits.globalPerDay||(!budget.isolatedAdmission&&await q('SELECT COUNT(*) n FROM dialogue_calls WHERE student_id=? AND day=?',student.id,day)>=limits.turnsPerDay))return response('daily_call_budget_exhausted','daily',true);
 if(await q('SELECT COALESCE(SUM(COALESCE(accounted_micros,reserved_micros)),0) n FROM dialogue_calls WHERE day=?',day)+budget.reserveMicros>budget.globalDailyMicros||await q('SELECT COALESCE(SUM(COALESCE(accounted_micros,reserved_micros)),0) n FROM dialogue_calls WHERE student_id=? AND day=?',student.id,day)+budget.reserveMicros>budget.userDailyMicros)return response('daily_money_budget_exhausted','daily',true);
 if(await q('SELECT COALESCE(SUM(COALESCE(c.accounted_micros,c.reserved_micros)),0) n FROM dialogue_calls c JOIN dialogue_sessions s ON s.id=c.session_id WHERE c.student_id=? AND s.lesson_id=?',student.id,session.lesson_id)+budget.reserveMicros>budget.lessonLifetimeMicros)return response('lesson_money_lifetime_exhausted','lifetime',false);
 if(await q("SELECT COUNT(*) n FROM dialogue_calls WHERE state IN ('reserved','finishing')")>=limits.concurrency)return response('dialogue_concurrency_busy','concurrency',true);
 return response('budget_reservation_unconfirmed','review',false);
}
