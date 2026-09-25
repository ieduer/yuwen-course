// Private, append-only learning observations. These rows NEVER confer scoring eligibility.
// Authentication supplies userId. A caller's actor/model/time are declared provenance,
// not trusted source grading or teacher diagnosis.
export const LEARNING_OPERATION_SCHEMA = 'bdfz-learning-operation-v1';
export const MAX_OPERATION_BYTES = 262144;
const encoder = new TextEncoder();
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const fail = (code, status = 400) => ({ ok: false, code, status });
export function canonicalJson(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (object(value)) return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonicalJson(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
export async function contentDigest(value) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))].map(x => x.toString(16).padStart(2, '0')).join('');
}
export async function learningRecorderScope(userId) {
  return contentDigest('bdfz-learning-recorder-scope-v1:' + String(userId));
}
const fields = new Set(['schemaVersion','operationId','scope','siteKey','sessionKey','resourceKey','resourceVersion','action','actor','status','occurredAt','parentOperationId','revisesOperationId','content','contentArtifact','context','assessment']);
const forbiddenMetadata = /^(?:cookie|authorization|password|accessToken|refreshToken|apiKey|secret)$/i;
export function safeMetadata(x, depth = 0) {
  if (depth > 12) return false;
  if (typeof x === 'number') return Number.isFinite(x);
  if (x === null || ['string','boolean'].includes(typeof x)) return true;
  if (Array.isArray(x)) return x.every(v => safeMetadata(v, depth + 1));
  return object(x) && Object.entries(x).every(([k,v]) => !forbiddenMetadata.test(k) && safeMetadata(v, depth + 1));
}
export function normalizeLearningOperation(input, now = new Date().toISOString()) {
  if (!object(input) || Object.keys(input).some(k => !fields.has(k))) return fail('learning_operation_schema_invalid');
  if (input.schemaVersion !== LEARNING_OPERATION_SCHEMA) return fail('learning_operation_schema_invalid');
  for (const k of ['operationId','sessionKey','resourceKey','resourceVersion','action','actor','status','scope','siteKey']) {
    if (typeof input[k] !== 'string' || !input[k] || input[k].length > (k === 'resourceKey' ? 500 : 180)) return fail('learning_operation_identity_invalid');
  }
  if (!/^[a-z0-9][a-z0-9_-]{0,59}$/.test(input.siteKey) || !/^[A-Za-z0-9:_-]{12,180}$/.test(input.operationId) || !/^[a-f0-9]{64}$/.test(input.scope)) return fail('learning_operation_identity_invalid');
  if (!/^[a-z][a-z0-9_.-]{0,79}$/.test(input.action) || !['student','assistant','system'].includes(input.actor) || !['observed','pending','succeeded','failed','cancelled','partial'].includes(input.status)) return fail('learning_operation_state_invalid');
  for (const k of ['parentOperationId','revisesOperationId']) {
    if (input[k] != null && (typeof input[k] !== 'string' || (input[k] !== '' && !/^[A-Za-z0-9:_-]{12,180}$/.test(input[k])))) return fail('learning_operation_lineage_invalid');
    if (input[k] === input.operationId) return fail('learning_operation_lineage_invalid');
  }
  if (!object(input.content) || !safeMetadata(input.content) || (input.context != null && (!object(input.context) || !safeMetadata(input.context))) || (input.assessment != null && (!object(input.assessment) || !safeMetadata(input.assessment)))) return fail('learning_operation_content_invalid');
  if(input.contentArtifact && (!object(input.contentArtifact)||Object.keys(input.content).length||Object.keys(input.contentArtifact).sort().join(',')!=='byteLength,mediaType,sha256'||! /^[a-f0-9]{64}$/.test(input.contentArtifact.sha256)||!Number.isSafeInteger(input.contentArtifact.byteLength)||input.contentArtifact.byteLength<1||input.contentArtifact.mediaType!=='application/json'))return fail('learning_artifact_reference_invalid');
  if (input.occurredAt != null && typeof input.occurredAt !== 'string') return fail('learning_operation_time_invalid');
  if ((input.occurredAt || '').length > 80) return fail('learning_operation_time_invalid');
  const claimed = input.occurredAt || '';
  // Missing/invalid/future client clocks are retained as uncertainty, NEVER replaced
  // with ingestion time and reported as when the learner acted.
  const parsed = /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(claimed) ? Date.parse(claimed) : NaN;
  const usable = Number.isFinite(parsed) && parsed >= Date.UTC(2000,0,1) && parsed <= Date.parse(now) + 300000;
  const timeQuality = !claimed ? 'missing' : !Number.isFinite(parsed) ? 'invalid' : !usable ? 'clock_out_of_range' : 'client_declared';
  const canonical = canonicalJson(input);
  if (encoder.encode(canonical).byteLength > MAX_OPERATION_BYTES) return fail('learning_operation_too_large', 413);
  return { ok:true, input, canonical, occurredAt:usable ? new Date(parsed).toISOString() : null, timeQuality, receivedAt:now };
}
export async function appendLearningOperation(db, userId, input, options = {}) {
  const normalized = normalizeLearningOperation(input, options.now);
  if (!normalized.ok) return normalized;
  if (input.scope !== await learningRecorderScope(userId)) return fail('learning_operation_account_changed', 409);
  const digest = await contentDigest(normalized.canonical);
  // One UNIQUE boundary serializes double submits. Never UPDATE an observation.
  // Schema absence/storage failure propagates: no false saved receipt or scoring write.
  await db.prepare(`INSERT INTO learning_operation_journal
    (user_id,site_key,operation_id,session_key,resource_key,resource_version,action,actor,status,occurred_at,time_quality,received_at,parent_operation_id,revises_operation_id,payload_sha256,payload_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(user_id,site_key,operation_id) DO NOTHING`).bind(
    userId,input.siteKey,input.operationId,input.sessionKey,input.resourceKey,input.resourceVersion,input.action,input.actor,input.status,
    normalized.occurredAt,normalized.timeQuality,normalized.receivedAt,input.parentOperationId || null,input.revisesOperationId || null,digest,normalized.canonical
  ).run();
  const saved = await db.prepare('SELECT id,payload_sha256,received_at,occurred_at,time_quality FROM learning_operation_journal WHERE user_id=? AND site_key=? AND operation_id=?').bind(userId,input.siteKey,input.operationId).first();
  if (!saved) throw new Error('learning_operation_readback_missing');
  if (saved.payload_sha256 !== digest) return fail('learning_operation_id_conflict',409);
  return {ok:true,id:saved.id,operationId:input.operationId,digest,receivedAt:saved.received_at,occurredAt:saved.occurred_at,timeQuality:saved.time_quality,scoringEligibility:'record_only',provenance:'authenticated_client_observation'};
}
export async function readLearningOperations(db,userId,filters={}) {
  const after=Number(filters.after || 0),limit=Math.min(100,Number(filters.limit || 50));
  if (!Number.isSafeInteger(after) || after<0 || !Number.isInteger(limit) || limit<1) return fail('learning_operation_cursor_invalid');
  const where=['user_id=?','id>?'],values=[userId,after];
  if(filters.siteKey){where.push('site_key=?');values.push(filters.siteKey);}
  const {results=[]}=await db.prepare(`SELECT id,site_key,operation_id,payload_json,occurred_at,time_quality,received_at,payload_sha256 FROM learning_operation_journal WHERE ${where.join(' AND ')} ORDER BY id LIMIT ?`).bind(...values,limit+1).all();
  const more=results.length>limit,rows=results.slice(0,limit);
  return {ok:true,items:rows.map(r=>({id:r.id,siteKey:r.site_key,operationId:r.operation_id,operation:JSON.parse(r.payload_json),occurredAt:r.occurred_at,timeQuality:r.time_quality,receivedAt:r.received_at,digest:r.payload_sha256,scoringEligibility:'record_only'})),nextCursor:more ? rows.at(-1).id : null};
}
