// The source ledger and its lease/budgets remain authoritative. This controller
// only wakes an authenticated visible page; it never owns a result or an answer.
export function createPendingEvaluationRecovery({ context, replay,
  now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout,
  windowMs = 600_000, maxPasses = 3,
}) {
  let timer = null, running = false, generation = 0, key = null, wakeAfterRun = false;
  let windowStart = 0, passes = 0, notBefore = 0;
  const clear = () => { if (timer !== null) clearTimer(timer); timer = null; };
  const suspend = () => { clear(); generation += 1; wakeAfterRun = false; };
  function current() {
    const value = context();
    return value?.key && value.active ? value : null;
  }
  async function execute() {
    timer = null;
    const value = current();
    if (!value || value.key !== key || running || passes >= maxPasses) return;
    if (now() < notBefore) { request(); return; }
    const epoch = generation;
    const isCurrent = () => epoch === generation && current()?.key === value.key;
    passes += 1;
    running = true;
    let delay = 0;
    try { delay = Number((await replay(value, isCurrent))?.retryAfterSeconds) || 0; }
    catch { delay = 60; }
    finally { running = false; }
    if (!isCurrent()) { if (wakeAfterRun) { wakeAfterRun = false; request(); } return; }
    wakeAfterRun = false;
    if (delay > 0 && passes < maxPasses) request(Math.max(60, delay));
  }
  function request(delaySeconds = 0) {
    const value = current();
    if (!value) { suspend(); return; }
    if (key !== value.key) {
      suspend(); key = value.key; windowStart = now(); passes = 0; notBefore = 0;
    } else if (now() - windowStart >= windowMs) {
      windowStart = now(); passes = 0;
    }
    notBefore = Math.max(notBefore, now() + Math.max(0, Number(delaySeconds) || 0) * 1000);
    if (running) { wakeAfterRun = true; return; }
    if (passes >= maxPasses) return;
    clear();
    timer = setTimer(execute, Math.max(0, notBefore - now()));
  }
  return { request, suspend };
}

// A separate read-only lane. The POST and server scheduler own execution;
// polling is never allowed to resume, submit, claim or drain a job.
export function createEvaluationStatusPoller({context, read, now=Date.now,
  setTimer=setTimeout, clearTimer=clearTimeout, maxReads=20, windowMs=600_000}) {
  const jobs=new Map(); let timer=null,running=false,generation=0;
  const clear=()=>{if(timer!==null) clearTimer(timer);timer=null;};
  const current=entry=>context()?.active && context().key===entry.contextKey;
  function request() {
    clear(); if(running) return;
    const due=[...jobs.values()].filter(entry=>!entry.done && !entry.authBlocked && current(entry)
      && entry.reads<maxReads && now()-entry.started<windowMs && Number.isFinite(entry.next));
    if(due.length) timer=setTimer(run,Math.max(0,Math.min(...due.map(entry=>entry.next))-now()));
  }
  async function run() {
    timer=null;if(running)return;
    const entry=[...jobs.values()].filter(e=>!e.done && !e.authBlocked && current(e) && e.next<=now()
      && e.reads<maxReads && now()-e.started<windowMs).sort((a,b)=>a.next-b.next)[0];
    if(!entry){request();return;}
    running=true;const epoch=generation;entry.reads++;
    try {
      const result=await read(entry.mutationId,entry.pendingId);
      if(epoch!==generation || !current(entry)) return;
      if(result?.pendingId)entry.pendingId=result.pendingId;
      if(result?.status==='completed' && result.ok===true) {await entry.onResult(result);entry.done=true;}
      else if(result?.stop) entry.authBlocked=true;
      else if(result?.status==='pending') await entry.onStatus(result);
      if(!entry.done) {
        const elapsed=now()-entry.started;
        // While the immediate POST owns the request, only four probes.
        if(entry.postActive) entry.next=entry.reads<4?entry.started+[3000,8000,15000,25000][entry.reads]:Infinity;
        else {
          const seconds=result?.phase==='evaluating' && elapsed>=30_000?10
            :Math.max(3,Math.min(60,Number(result?.pollAfterSeconds)||10));
          entry.next=now()+seconds*1000;
        }
      }
    } catch {entry.next=entry.postActive && entry.reads>=4?Infinity:now()+10_000;}
    finally {running=false;request();}
  }
  function watch({mutationId,pendingId='',postActive=false,onResult,onStatus=()=>{}}) {
    const value=context();if(!value?.key || !mutationId)return;
    const key=value.key+':'+mutationId;
    let entry=jobs.get(key);
    if(!entry) {entry={contextKey:value.key,mutationId,pendingId,postActive,onResult,onStatus,
      started:now(),next:now()+(postActive?3000:0),reads:0,done:false};jobs.set(key,entry);}
    else {Object.assign(entry,{onResult,onStatus,authBlocked:false});if(pendingId)entry.pendingId=pendingId;
      if(!entry.done && now()-entry.started>=windowMs) Object.assign(entry,{started:now(),reads:0,next:now()});}
    request();
    return {settle(result) {
      entry.postActive=false;
      if(result?.ok===true || result?.stop)entry.done=true;
      else {if(result?.pendingId)entry.pendingId=result.pendingId;entry.next=Math.min(entry.next,now()+3000);}
      request();
    }};
  }
  return {watch,request,suspend(){clear();generation++;}};
}

export function evaluationStatusMessage(status) {
  return ({submitting:status?.saved?'答案已保存，等候開始評閱。':'正在提交；本機草稿已保留。',
    evaluating:'答案已保存，正在評閱。',
    waiting_retry:'AI 暫時繁忙，答案已保存；稍後會自動再試，可先做其他題。',
    waiting_previous:'上一輪尚在評閱；這一輪已保存，將按順序處理。',
    reconciling:'評閱已收到，正在保存結果。',
    needs_attention:'答案已保存，評閱需要核查；請勿重複提交。'})[status?.phase] || '答案已保留，正在查詢評閱進度。';
}
