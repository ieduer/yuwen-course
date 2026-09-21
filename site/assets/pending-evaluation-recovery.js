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
