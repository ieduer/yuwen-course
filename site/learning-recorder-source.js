import { canonicalEventJson, eventDigest } from './learning-evaluation-events.js';

const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie', 'X-Content-Type-Options': 'nosniff' };
const reply = (body, status = 200) => Response.json(body, { status, headers });

// Browser-session read bridge only. Forward the original session solely to its
// issuer; never calculate scope, store credentials or create an S2S logger.
export async function readRecorderSource({ request, db, student, cookieHeader, fetchContext = fetch }) {
  if (!cookieHeader || !student) return reply({ code: 'learning_login_required' }, 401);
  const after = new URL(request.url).searchParams.get('after') || '0';
  if (!/^(0|[1-9][0-9]{0,14})$/.test(after)) return reply({ code: 'learning_cursor_invalid' }, 400);
  let context;
  try {
    const response = await fetchContext('https://my.bdfz.net/api/learning-operations?context=1', {
      headers: { Cookie: cookieHeader, Origin: 'https://yw.bdfz.net', Accept: 'application/json' },
      redirect: 'manual', signal: AbortSignal.timeout(10000),
    });
    if (response.status === 401) return reply({ code: 'learning_login_required' }, 401);
    if (!response.ok) throw new Error('context unavailable');
    context = await response.json();
    if (context?.schemaVersion !== 'bdfz-learning-operation-v1' || !/^[a-f0-9]{64}$/.test(context.scope || '')) throw new Error('context invalid');
  } catch { return reply({ code: 'learning_context_unavailable' }, 503); }
  const result = await db.prepare(`SELECT rowid AS sequence, event_id, payload_json, payload_sha256, payload_bytes
    FROM learning_evaluation_events WHERE student_id=? AND rowid>? ORDER BY rowid LIMIT 33`)
    .bind(student.id, Number(after)).all();
  const events = [];
  let bytes = 0;
  for (const row of result.results || []) {
    // Page boundaries never truncate an event, including an oversized first
    // event. The shared recorder preserves it and reports any artifact limit.
    if (events.length >= 32 || (events.length && bytes + row.payload_bytes > 2 * 1024 * 1024)) break;
    let operation;
    try {
      operation = JSON.parse(row.payload_json);
      if (canonicalEventJson(operation) !== row.payload_json || operation.operationId !== row.event_id
        || operation.siteKey !== 'yw' || Object.hasOwn(operation, 'scope')
        || new TextEncoder().encode(row.payload_json).byteLength !== row.payload_bytes
        || await eventDigest(row.payload_json) !== row.payload_sha256) throw new Error('source mismatch');
    } catch { return reply({ code: 'learning_source_integrity_failed' }, 503); }
    events.push({ sequence: row.sequence, payload: row.payload_json, sha256: row.payload_sha256, byteLength: row.payload_bytes });
    bytes += row.payload_bytes;
  }
  return reply({ ok: true, scope: context.scope, events,
    nextCursor: events.at(-1)?.sequence ?? Number(after), hasMore: events.length < (result.results || []).length });
}
