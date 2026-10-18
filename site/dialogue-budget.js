// Values are deployment policy, never model/browser proposals. No paid default.
export function dialogueBudget(env){
 let p;try{p=JSON.parse(env.YW_DIALOGUE_BUDGET_JSON);}catch{throw Error('budget_policy_required');}
 if(!p||!/^[-\w.]{1,80}$/.test(p.version)||!/^gemini-[-\w.]+$/.test(p.model)||p.currency!=='USD')throw Error('invalid_budget_policy');
 if(!Number.isFinite(Date.parse(p.validUntil))||Date.now()>=Date.parse(p.validUntil))throw Error('budget_price_expired');
 for(const key of ['globalDailyMicros','userDailyMicros','lessonLifetimeMicros','reserveMicros','inputMicrosPerMillion','outputMicrosPerMillion']){
  if(!Number.isSafeInteger(p[key])||p[key]<(key.endsWith('MicrosPerMillion')?0:1)||p[key]>1000000000000)throw Error('invalid_budget_policy');
 }
 // UTF-8 bytes plus envelope reserve bound input tokens. Output includes
 // visible output and thinking; unknown observed usage retains the reservation.
 const maxInputTokens=100000,maxOutputTokens=2400;
 if(p.globalDailyMicros>50000000)throw Error('global_fifty_dollar_cap');
 const minimum=Number((BigInt(maxInputTokens)*BigInt(p.inputMicrosPerMillion)+BigInt(maxOutputTokens)*BigInt(p.outputMicrosPerMillion)+999999n)/1000000n);
 if(p.reserveMicros<minimum||p.reserveMicros>Math.min(p.globalDailyMicros,p.userDailyMicros,p.lessonLifetimeMicros))throw Error('invalid_budget_reserve');
 return {...p,maxInputTokens,maxOutputTokens};
}
export function reconciledCost(policy,usage){
 const input=usage?.promptTokenCount,total=usage?.totalTokenCount;
 if(!Number.isSafeInteger(input)||!Number.isSafeInteger(total)||input<0||total<input||input>policy.maxInputTokens||total-input>policy.maxOutputTokens)return null;
 return Number((BigInt(input)*BigInt(policy.inputMicrosPerMillion)+BigInt(total-input)*BigInt(policy.outputMicrosPerMillion)+999999n)/1000000n);
}
