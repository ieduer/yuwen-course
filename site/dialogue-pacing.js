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
// Open pool (suen, 2026-11-18: no end date; the credit is renewed every month): `endsAt: null` with `monthlyMicros` and
// `monthlyFrom`. The declared ceiling grows by `monthlyMicros` at every UTC month start after `monthlyFrom`; there is no
// pace line and no end, so everything the pool has allowed so far and not spent stays available. The pool keeps its id and
// start: what was spent before the amendment still counts. The validated pool carries `endsAt` as OPEN_POOL_END (a marker
// far in the future, so the period arithmetic and the SQL window keep one shape), `open: true`, the declared ceiling as
// `baseCeilingMicros` and the ceiling of the moment as `ceilingMicros`.
export const SHARED_POOL_VERSION='yw-shared-pool-v1',OPEN_POOL_END='2100-01-01T00:00:00.000Z';
const MAX_MICROS=1000000000; // US$1,000: a typo guard, not a budget
// UTC month starts t with from < t <= now.
export function monthStartsBetween(fromMs,nowMs){
 if(!Number.isFinite(fromMs)||!Number.isFinite(nowMs)||nowMs<=fromMs)return 0;
 const from=new Date(fromMs),now=new Date(nowMs);
 return (now.getUTCFullYear()-from.getUTCFullYear())*12+now.getUTCMonth()-from.getUTCMonth();
}
const monthStartAfter=(ms,count)=>{const d=new Date(ms);return Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+count,1);};
export function validSharedPool(pool,at=Date.now()){
 if(!pool||pool.version!==SHARED_POOL_VERSION||!/^[-\w.:]{1,80}$/.test(pool.poolId||''))throw Error('invalid_shared_pool');
 // A pool already validated as open (stored with a call) is read back as the same open pool.
 const open=pool.endsAt===null||(pool.open===true&&pool.endsAt===OPEN_POOL_END);
 if(!open&&(pool.open!==undefined||pool.monthlyMicros!==undefined||pool.monthlyFrom!==undefined||pool.baseCeilingMicros!==undefined))throw Error('invalid_shared_pool');
 const start=Date.parse(pool.startsAt),end=Date.parse(open?OPEN_POOL_END:pool.endsAt);
 if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)throw Error('invalid_shared_pool');
 const declared=open&&pool.baseCeilingMicros!==undefined?pool.baseCeilingMicros:pool.ceilingMicros,from=open?Date.parse(pool.monthlyFrom):NaN;
 if(open&&(!Number.isSafeInteger(declared)||declared<1||declared>MAX_MICROS||!Number.isSafeInteger(pool.monthlyMicros)||pool.monthlyMicros<1||pool.monthlyMicros>MAX_MICROS||!Number.isFinite(from)||from<start||!Number.isFinite(at)))throw Error('invalid_shared_pool');
 if(open){
  for(const key of ['burstMicros'])if(!Number.isSafeInteger(pool[key])||pool[key]<0||pool[key]>declared)throw Error('invalid_shared_pool');
  if(typeof pool.releaseFraction!=='number'||!(pool.releaseFraction>=0&&pool.releaseFraction<1))throw Error('invalid_shared_pool');
  for(const key of ['concurrency','ratePerWindow'])if(!Number.isSafeInteger(pool[key])||pool[key]<1||pool[key]>100)throw Error('invalid_shared_pool');
  if(!Number.isSafeInteger(pool.rateWindowSeconds)||pool.rateWindowSeconds<60||pool.rateWindowSeconds>3600)throw Error('invalid_shared_pool');
  if(typeof pool.evidenceRef!=='string'||!pool.evidenceRef||!Number.isFinite(Date.parse(pool.verifiedAt)))throw Error('invalid_shared_pool');
  const ceilingMicros=declared+pool.monthlyMicros*monthStartsBetween(from,at);
  if(!Number.isSafeInteger(ceilingMicros))throw Error('invalid_shared_pool');
  return {...pool,startsAt:new Date(start).toISOString(),endsAt:OPEN_POOL_END,open:true,monthlyFrom:new Date(from).toISOString(),baseCeilingMicros:declared,ceilingMicros};
 }
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
// The ceiling of an open pool at `at` (a validated pool carries the ceiling of the moment it was validated).
export const poolCeiling=(pool,at)=>pool.open?pool.baseCeilingMicros+pool.monthlyMicros*monthStartsBetween(Date.parse(pool.monthlyFrom),Date.parse(at)):pool.ceilingMicros;
export function pacedAllowance(pool,at,{burst=true}={}){
 if(poolPhase(pool,at)!=='active')return 0;
 if(pool.open)return poolCeiling(pool,at); // no pace line: the whole ceiling of the moment
 const start=Date.parse(pool.startsAt),release=releasePoint(pool),t=Date.parse(at);
 if(t>=release)return pool.ceilingMicros;
 return Math.min(pool.ceilingMicros,Math.floor(pool.ceilingMicros*(t-start)/(release-start))+(burst?pool.burstMicros:0));
}
// The first moment at or after `at` when the allowance covers `needed` micro-USD; null when it never will in this period.
export function allowanceReachedAt(pool,needed,at,{burst=true}={}){
 if(pool.open){
  // The first UTC month start at which the grown ceiling covers `needed` (now, when it already does).
  const now=Date.parse(at),start=Date.parse(pool.startsAt),have=poolCeiling(pool,at);
  if(needed<=have)return new Date(Math.max(now,start)).toISOString();
  const months=Math.ceil((needed-have)/pool.monthlyMicros),when=monthStartAfter(Math.max(now,Date.parse(pool.monthlyFrom)),months);
  return when>=Date.parse(pool.endsAt)?null:new Date(when).toISOString();
 }
 if(needed>pool.ceilingMicros||poolPhase(pool,at)==='ended')return null;
 const start=Date.parse(pool.startsAt),release=releasePoint(pool),now=Date.parse(at),line=needed-(burst?pool.burstMicros:0);
 const t=line<=0?start:Math.min(release,start+Math.ceil((release-start)*line/pool.ceilingMicros));
 const when=Math.max(now,t);
 return when>=Date.parse(pool.endsAt)?null:new Date(when).toISOString();
}
// SQL for the atomic money condition: everything YW reserved or settled in the pool window plus this request.
export function sharedPoolAdmission(pool,reserveMicros,at,{burst=true}={}){
 return {sql:'(SELECT COALESCE(SUM(COALESCE(accounted_micros,reserved_micros)),0) FROM dialogue_calls WHERE created_at>=? AND created_at<?)+?<=?',
  args:[pool.startsAt,pool.endsAt,reserveMicros,pool.open?pacedAllowance(pool,at,{burst}):Math.min(pool.ceilingMicros,pacedAllowance(pool,at,{burst}))]};
}
export const SHARED_POOL_MESSAGES=Object.freeze({
 paced:'共用 AI 額度此刻較緊，本輪尚未呼叫 AI；文字已保存，稍後即可再送。',
 exhausted:'本期共用 AI 額度已用完，本輪尚未呼叫 AI；文字已保存，閱讀、紀錄、分數與切換篇目不受影響。',
 monthly:'本月共用 AI 額度已用完，本輪尚未呼叫 AI；文字已保存，下月初恢復，閱讀、紀錄、分數與切換篇目不受影響。',
 ended:'本期共用 AI 額度已到期，本輪尚未呼叫 AI；文字已保存，閱讀、紀錄、分數與切換篇目不受影響。',
 before:'共用 AI 額度尚未開始，本輪尚未呼叫 AI；文字已保存。',
 rate:'送出太頻繁，本輪尚未呼叫 AI；文字已保存，稍後即可再送。',
 concurrency:'其他同學的回應正在處理，本輪尚未呼叫 AI；文字已保存，稍後即可再送。',
});
