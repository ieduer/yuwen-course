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
