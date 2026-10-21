// Shared-budget pacing (suen, 2026-10-21): YW's Claude spend is paced over the verified promotional-credit period as ONE
// shared pool instead of fixed per-user, per-site and per-lesson daily caps.
// - One cumulative pace line rises from 0 at `startsAt` to the whole ceiling at the release point (1 - releaseFraction of the
//   period); allowance not used yet stays available later (carry-over is the cumulative line itself).
// - Ordinary learning may run `burstMicros` ahead of the line (a class or a busy evening); automated test admissions get the
//   line without the burst, so learning wins when capacity is tight.
// - In the final release window the whole remaining ceiling is open so usable credit is not left idle before expiry.
// - Admission is atomic in D1: settled + outstanding reservations (UNKNOWN keeps its reservation) + this request's bounded
//   maximum must fit under min(ceiling, allowance(now)). The ceiling is the hard stop; the provider credit and the APIS
//   claude_credit period cap are further hard stops outside YW.
export const SHARED_POOL_VERSION='yw-shared-pool-v1';
const MAX_MICROS=1000000000; // US$1,000: a typo guard, not a budget
export function validSharedPool(pool){
 if(!pool||pool.version!==SHARED_POOL_VERSION||!/^[-\w.:]{1,80}$/.test(pool.poolId||''))throw Error('invalid_shared_pool');
 const start=Date.parse(pool.startsAt),end=Date.parse(pool.endsAt);
 if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)throw Error('invalid_shared_pool');
 for(const key of ['ceilingMicros','burstMicros'])if(!Number.isSafeInteger(pool[key])||pool[key]<0||pool[key]>MAX_MICROS)throw Error('invalid_shared_pool');
 if(pool.ceilingMicros<1||pool.burstMicros>pool.ceilingMicros)throw Error('invalid_shared_pool');
 if(typeof pool.releaseFraction!=='number'||!(pool.releaseFraction>=0&&pool.releaseFraction<1))throw Error('invalid_shared_pool');
 for(const key of ['concurrency','ratePerWindow'])if(!Number.isSafeInteger(pool[key])||pool[key]<1||pool[key]>100)throw Error('invalid_shared_pool');
 if(!Number.isSafeInteger(pool.rateWindowSeconds)||pool.rateWindowSeconds<60||pool.rateWindowSeconds>3600)throw Error('invalid_shared_pool');
 if(typeof pool.evidenceRef!=='string'||!pool.evidenceRef||!Number.isFinite(Date.parse(pool.verifiedAt)))throw Error('invalid_shared_pool');
 return {...pool,startsAt:new Date(start).toISOString(),endsAt:new Date(end).toISOString()};
}
export function poolPhase(pool,at){const t=Date.parse(at);return t<Date.parse(pool.startsAt)?'before':t>=Date.parse(pool.endsAt)?'ended':'active';}
const releasePoint=pool=>{const start=Date.parse(pool.startsAt),end=Date.parse(pool.endsAt);return start+(end-start)*(1-pool.releaseFraction);};
export function pacedAllowance(pool,at,{burst=true}={}){
 if(poolPhase(pool,at)!=='active')return 0;
 const start=Date.parse(pool.startsAt),release=releasePoint(pool),t=Date.parse(at);
 if(t>=release)return pool.ceilingMicros;
 return Math.min(pool.ceilingMicros,Math.floor(pool.ceilingMicros*(t-start)/(release-start))+(burst?pool.burstMicros:0));
}
// The first moment at or after `at` when the allowance covers `needed` micro-USD; null when it never will in this period.
export function allowanceReachedAt(pool,needed,at,{burst=true}={}){
 if(needed>pool.ceilingMicros||poolPhase(pool,at)==='ended')return null;
 const start=Date.parse(pool.startsAt),release=releasePoint(pool),now=Date.parse(at),line=needed-(burst?pool.burstMicros:0);
 const t=line<=0?start:Math.min(release,start+Math.ceil((release-start)*line/pool.ceilingMicros));
 const when=Math.max(now,t);
 return when>=Date.parse(pool.endsAt)?null:new Date(when).toISOString();
}
// SQL for the atomic money condition: everything YW reserved or settled in the pool window plus this request.
export function sharedPoolAdmission(pool,reserveMicros,at,{burst=true}={}){
 return {sql:'(SELECT COALESCE(SUM(COALESCE(accounted_micros,reserved_micros)),0) FROM dialogue_calls WHERE created_at>=? AND created_at<?)+?<=?',
  args:[pool.startsAt,pool.endsAt,reserveMicros,Math.min(pool.ceilingMicros,pacedAllowance(pool,at,{burst}))]};
}
export const SHARED_POOL_MESSAGES=Object.freeze({
 paced:'共用 AI 額度此刻較緊，本輪尚未呼叫 AI；文字已保存，稍後即可再送。',
 exhausted:'本期共用 AI 額度已用完，本輪尚未呼叫 AI；文字已保存，閱讀、紀錄、分數與切換篇目不受影響。',
 ended:'本期共用 AI 額度已到期，本輪尚未呼叫 AI；文字已保存，閱讀、紀錄、分數與切換篇目不受影響。',
 before:'共用 AI 額度尚未開始，本輪尚未呼叫 AI；文字已保存。',
 rate:'送出太頻繁，本輪尚未呼叫 AI；文字已保存，稍後即可再送。',
 concurrency:'其他同學的回應正在處理，本輪尚未呼叫 AI；文字已保存，稍後即可再送。',
});
