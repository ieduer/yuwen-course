// Operational flag only; no account, rubric, budget or source-authority change.
// Closing admission does not cancel work already admitted before the flag became effective.
export function releaseReadOnly(env) {
  return env.YW_RELEASE_READ_ONLY === 'true';
}
export function releaseAdmissionResponse(env) {
  if (!releaseReadOnly(env)) return null;
  return Response.json({
    ok: false,
    code: 'release_read_only',
    error: '網站維護中，這次內容尚未送出。請保留草稿，稍後手動重送。',
    retryable: false,
    admitted: false,
  }, {status: 503, headers: {'cache-control': 'no-store'}});
}

// Optional, deployment-owned restriction for formal-source acceptance. It only
// narrows the existing dialogue switch; it cannot authenticate a user, override
// maintenance, grant a model budget, or alter the ordinary learning routes.
export function dialogueAcceptanceScope(env, now = Date.now()) {
  const id = env.YW_DIALOGUE_ACCEPTANCE_USER_ID;
  const expiry = env.YW_DIALOGUE_ACCEPTANCE_EXPIRES_AT;
  if (id === undefined && expiry === undefined) return null;
  const expires = typeof expiry === 'string' ? Date.parse(expiry) : NaN;
  if (typeof id !== 'string' || !/^[1-9][0-9]*$/.test(id)
    || !Number.isSafeInteger(Number(id)) || !Number.isFinite(expires)
    || expires <= now || expires > now + 6 * 60 * 60 * 1000) return {valid: false};
  return {valid: true, userId: Number(id), expires};
}
export function dialogueAdmissionAllowed(env, userId) {
  if (env.YW_DIALOGUE_ENABLED !== 'true') return false;
  const scope = dialogueAcceptanceScope(env);
  return scope === null || scope.valid && Number(userId) === scope.userId;
}
export function dialogueAcceptanceRejection(env, userId) {
  const scope = dialogueAcceptanceScope(env);
  if (scope === null || scope.valid && Number(userId) === scope.userId) return null;
  return Response.json({ok: false, code: scope.valid ? 'dialogue_acceptance_restricted' : 'dialogue_acceptance_unavailable', admitted: false},
    {status: scope.valid ? 403 : 503, headers: {'cache-control': 'private, no-store'}});
}
