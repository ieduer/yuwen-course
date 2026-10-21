// Values are deployment policy, never model/browser proposals. No paid default.
// Output-token bounds: the historical per-call bound (the default and the only value for the same-model policy) and the
// gateway's Claude cap (APIS_T1_MAX_TOKENS in production, forwarded to Claude as max_tokens).
import {validSharedPool} from './dialogue-pacing.js';
export const DEFAULT_MAX_OUTPUT_TOKENS=2400,GATEWAY_CLAUDE_MAX_OUTPUT_TOKENS=8192;
export function dialogueBudget(env,at=Date.now()){
 let p;try{p=JSON.parse(env.YW_DIALOGUE_BUDGET_JSON);}catch{throw Error('budget_policy_required');}
 if(!p||!/^[-\w.]{1,80}$/.test(p.version)||!/^gemini-[-\w.]+$/.test(p.model)||p.currency!=='USD')throw Error('invalid_budget_policy');
 // Policy: the same-model sequential policy (default, model = the free Gemini pool) or Claude first with that Gemini model as
 // the fallback (owner direction 2026-10-20). The primary model carries its own prices; every cap below is money in micro-USD.
 const policyName=p.policy===undefined?'yw-same-model-sequential-v1':p.policy;
 if(!['yw-same-model-sequential-v1','yw-claude-primary-gemini-fallback-v1'].includes(policyName))throw Error('invalid_budget_policy');
 const primaryModel=policyName==='yw-claude-primary-gemini-fallback-v1'?p.primaryModel:null;
 if(primaryModel!==null){if(!/^claude-[-\w.]+$/.test(primaryModel||''))throw Error('invalid_budget_policy');for(const key of ['primaryInputMicrosPerMillion','primaryOutputMicrosPerMillion'])if(!Number.isSafeInteger(p[key])||p[key]<0||p[key]>1000000000000)throw Error('invalid_budget_policy');}
 else if(p.primaryModel!==undefined||p.primaryInputMicrosPerMillion!==undefined||p.primaryOutputMicrosPerMillion!==undefined)throw Error('invalid_budget_policy');
 if(!Number.isFinite(at)||!Number.isFinite(Date.parse(p.validUntil))||at>=Date.parse(p.validUntil))throw Error('budget_price_expired');
 // A shared pool (yw-shared-pool-v1) supersedes the fixed daily/lesson money caps: they may not be declared next to it.
 const sharedPool=p.sharedPool===undefined?null:validSharedPool(p.sharedPool),capKeys=['globalDailyMicros','userDailyMicros','lessonLifetimeMicros'];
 if(sharedPool&&capKeys.some(key=>p[key]!==undefined))throw Error('invalid_budget_policy');
 for(const key of [...(sharedPool?[]:capKeys),'reserveMicros','inputMicrosPerMillion','outputMicrosPerMillion']){
  if(!Number.isSafeInteger(p[key])||p[key]<(key.endsWith('MicrosPerMillion')?0:1)||p[key]>1000000000000)throw Error('invalid_budget_policy');
 }
 // UTF-8 bytes plus envelope reserve bound input tokens. Output includes
 // visible output and thinking; unknown observed usage retains the reservation.
 // The prompt is bounded by the gateway stream admission (32,000 characters of contents) so a policy may declare a tighter
 // input bound than the default 100k tokens; the reserve must cover the priciest model at that bound.
 // The Claude-primary policy may declare a larger `maxOutputTokens` for the structured JSON reply (reply up to 1,800 characters
 // plus assessments, sourceDraft and conclusion); a truncated answer is a failed, paid attempt that the gateway never relays.
 // Never above the gateway's Claude cap, never below the historical bound, and the reserve must cover the primary model at it.
 const maxInputTokens=p.maxInputTokens===undefined?100000:p.maxInputTokens;
 if(!Number.isSafeInteger(maxInputTokens)||maxInputTokens<8000||maxInputTokens>100000)throw Error('invalid_budget_policy');
 if(primaryModel===null&&p.maxOutputTokens!==undefined)throw Error('invalid_budget_policy');
 const maxOutputTokens=p.maxOutputTokens===undefined?DEFAULT_MAX_OUTPUT_TOKENS:p.maxOutputTokens;
 if(!Number.isSafeInteger(maxOutputTokens)||maxOutputTokens<DEFAULT_MAX_OUTPUT_TOKENS||maxOutputTokens>GATEWAY_CLAUDE_MAX_OUTPUT_TOKENS)throw Error('invalid_budget_policy');
 if(!sharedPool&&p.globalDailyMicros>50000000)throw Error('global_fifty_dollar_cap');
 const bound=(inputPrice,outputPrice)=>Number((BigInt(maxInputTokens)*BigInt(inputPrice)+BigInt(maxOutputTokens)*BigInt(outputPrice)+999999n)/1000000n);
 const minimum=Math.max(bound(p.inputMicrosPerMillion,p.outputMicrosPerMillion),primaryModel?bound(p.primaryInputMicrosPerMillion,p.primaryOutputMicrosPerMillion):0);
 if(p.reserveMicros<minimum||p.reserveMicros>(sharedPool?sharedPool.ceilingMicros:Math.min(p.globalDailyMicros,p.userDailyMicros,p.lessonLifetimeMicros)))throw Error('invalid_budget_reserve');
 // Per-attempt reserves: the declared reserve covers the priciest (primary) attempt; a fallback attempt reserves its own price bound
 // (0 for the free Gemini pool), so a call's reservation is what its attempts can actually cost.
 const fallbackReserveMicros=primaryModel?bound(p.inputMicrosPerMillion,p.outputMicrosPerMillion):p.reserveMicros;
 return {...p,sharedPool,policy:policyName,primaryModel,maxInputTokens,maxOutputTokens,fallbackReserveMicros};
}
export function reconciledCost(policy,usage,model=null){
 const input=usage?.promptTokenCount,total=usage?.totalTokenCount;
 if(!Number.isSafeInteger(input)||!Number.isSafeInteger(total)||input<0||total<input||input>policy.maxInputTokens||total-input>policy.maxOutputTokens)return null;
 // Prices follow the model that produced the usage: the primary (Claude) attempt or the fallback (free Gemini) attempt.
 const primary=!!policy.primaryModel&&model===policy.primaryModel;
 const inputPrice=primary?policy.primaryInputMicrosPerMillion:policy.inputMicrosPerMillion,outputPrice=primary?policy.primaryOutputMicrosPerMillion:policy.outputMicrosPerMillion;
 return Number((BigInt(input)*BigInt(inputPrice)+BigInt(total-input)*BigInt(outputPrice)+999999n)/1000000n);
}
