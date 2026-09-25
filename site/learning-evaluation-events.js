// Private source facts for the unified recorder bridge. No UC scope or transport
// is created here. Full content is inline, so replay never dereferences mutable
// jobs. The authenticated bridge must add scope and verify these hashes.
export function canonicalEventJson(value) {
  if (Array.isArray(value)) return '['+value.map(canonicalEventJson).join(',')+']';
  if (value && typeof value==='object') return '{'+Object.keys(value).sort()
    .map(key=>JSON.stringify(key)+':'+canonicalEventJson(value[key])).join(',')+'}';
  return JSON.stringify(value);
}
export async function eventDigest(text) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))]
    .map(n=>n.toString(16).padStart(2,'0')).join('');
}
export async function evaluationEventId(sourceId,kind,key='0') {
  const tuple=[String(sourceId),String(kind),String(key)];
  const readable='yw:'+tuple.join(':');
  return /^[A-Za-z0-9:_-]{12,180}$/.test(readable) ? readable
    : 'yw:'+await eventDigest(canonicalEventJson(tuple));
}
export function evaluationEventBase(job) {
  const snapshot=JSON.parse(job.snapshot_json);
  return {sourceEventId:job.source_event_id,studentId:job.student_id,
    resourceKey:job.resource_key,resourceVersion:snapshot.reservation.capturedVersions?.sourceVersion || 'not_reported',
    clientMutationId:snapshot.reservation.clientMutationId || null,
    rubricVersion:snapshot.rubricVersion || null,leafRelease:snapshot.leafRelease || null};
}
export async function sourceEventStatement(db,base,{action,kind,key='0',parentId='',actor='system',
  status='pending',at=new Date().toISOString(),content={},sourceContext={},assessment={}}) {
  const id=await evaluationEventId(base.sourceEventId,kind,key);
  const payload={schemaVersion:'bdfz-learning-operation-v1',operationId:id,siteKey:'yw',
    sessionKey:await evaluationEventId(base.sourceEventId,'session'),
    resourceKey:base.resourceKey,resourceVersion:base.resourceVersion,
    action,actor,status,occurredAt:at,parentOperationId:parentId,revisesOperationId:'',content,
    context:{contentOrigin:'yw_private_source',sourceContext:{eventSchema:'yw-learning-events-v1',
      sourceEventId:base.sourceEventId,pendingId:base.sourceEventId,
      clientMutationId:base.clientMutationId || null,contentVersion:base.resourceVersion,
      rubricVersion:base.rubricVersion || null,leafRelease:base.leafRelease || null,
      leafReleaseStatus:base.leafRelease?'reported':'not_reported',apisVersion:null,apisVersionStatus:'not_reported',
      requestId:null,attemptNumber:null,providerAttemptCount:null,providerAttemptCountStatus:'not_reported',
      clockSource:'source_server',...sourceContext}},
    assessment:{requestedModel:null,requestedModelStatus:'not_reported',reportedModel:null,
      modelVersion:null,modelVersionStatus:'not_reported',modelProvenance:'not_reported',fallback:null,
      usageMetadataStatus:'not_reported',promptTokenCount:null,candidatesTokenCount:null,thoughtsTokenCount:null,
      ...assessment}};
  const json=canonicalEventJson(payload),sha256=await eventDigest(json);
  return db.prepare(`INSERT INTO learning_evaluation_events
    (event_id,source_event_id,student_id,action,parent_event_id,occurred_at,payload_json,payload_sha256,payload_bytes)
    VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(event_id) DO NOTHING`).bind(id,base.sourceEventId,
      base.studentId,action,parentId,at,json,sha256,new TextEncoder().encode(json).byteLength);
}
export async function sourceEventJob(env,sourceId) {
  if(env.YW_DURABLE_EVALUATION_ENABLED!=='true' && env.YW_BACKGROUND_EVALUATION_ENABLED!=='true') return null;
  return env.READING_DB.prepare('SELECT * FROM learning_evaluation_jobs WHERE source_event_id=?').bind(sourceId).first();
}
export async function latestSourceEvent(db,sourceId,action,epoch=null) {
  return db.prepare(`SELECT * FROM learning_evaluation_events WHERE source_event_id=? AND action=?
    ${epoch===null?'':"AND json_extract(payload_json,'$.context.sourceContext.leaseEpoch')=?"}
    ORDER BY rowid DESC LIMIT 1`).bind(sourceId,action,...(epoch===null?[]:[epoch])).first();
}
export function replyAssessment(reply) {
  return {reportedModel:reply.actual_model || null,modelVersion:reply.model_version || null,
    modelVersionStatus:reply.model_version?'reported':'not_reported',
    modelProvenance:reply.actual_model?'apis_response':'not_reported'};
}
