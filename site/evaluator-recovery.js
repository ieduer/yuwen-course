// Retry only a completed, explicitly transient gateway response. A transport
// abort is ambiguous and must not create another evaluation.
const TRANSIENT_CODES = new Set(['DEADLINE_EXCEEDED', 'UPSTREAM_UNAVAILABLE']);
export const EVALUATOR_RECOVERY = Object.freeze({ maxCalls: 2, deadlineMs: 45_000, minimumRemainingMs: 10_000 });

export async function evaluateWithRecovery({ reserve, evaluate, signal, now = Date.now, emit = (event) => console.info(JSON.stringify(event)) }) {
  const started = now();
  const operationId = crypto.randomUUID();
  for (let attempt = 1; attempt <= EVALUATOR_RECOVERY.maxCalls; attempt += 1) {
    signal?.throwIfAborted();
    await reserve(); // Every outbound call consumes the existing durable budget.
    signal?.throwIfAborted();
    const remaining = EVALUATOR_RECOVERY.deadlineMs - (now() - started);
    if (remaining <= 0) throw new Error('evaluation_deadline');
    const requestId = `${operationId}-${attempt}`;
    try {
      const value = await evaluate({ timeoutMs: remaining, signal, requestId });
      emit({ event: 'yw_evaluator_attempt', operationId, requestId, attempt, outcome: 'completed' });
      return value;
    } catch (error) {
      const retry = attempt < EVALUATOR_RECOVERY.maxCalls
        && error?.apisStatus === 503 && TRANSIENT_CODES.has(error?.apisCode)
        && !signal?.aborted
        && EVALUATOR_RECOVERY.deadlineMs - (now() - started) >= EVALUATOR_RECOVERY.minimumRemainingMs;
      emit({ event: 'yw_evaluator_attempt', operationId, requestId, attempt,
        outcome: retry ? 'recovering' : 'unavailable',
        reason: TRANSIENT_CODES.has(error?.apisCode) ? error.apisCode : 'non_retryable_failure' });
      if (!retry) throw error;
    }
  }
}
