export const EVALUATION_MACHINE_PATH='/api/internal/evaluation-jobs/execute';
const ORIGIN='https://yw.bdfz.net';
const encoder=new TextEncoder();
const unavailable=()=>new Response('Not found',{status:404,headers:{'Cache-Control':'no-store'}});
const message=(body,timestamp,nonce)=>['POST',EVALUATION_MACHINE_PATH,timestamp,nonce,body].join('\n');
async function key(secret,usage) {
  if(!/^[a-f0-9]{64}$/.test(secret || '')) throw new Error('machine credential unavailable');
  const bytes=Uint8Array.from(secret.match(/../g),x=>parseInt(x,16));
  return crypto.subtle.importKey('raw',bytes,{name:'HMAC',hash:'SHA-256'},false,[usage]);
}
export async function signedEvaluationRequest(secret,job,{now=Date.now(),nonce=crypto.randomUUID().replaceAll('-','')}={}) {
  const body=JSON.stringify({jobId:job.source_event_id,leaseEpoch:job.lease_epoch});
  const timestamp=String(now);
  const signature=[...new Uint8Array(await crypto.subtle.sign('HMAC',await key(secret,'sign'),encoder.encode(message(body,timestamp,nonce))))]
    .map(x=>x.toString(16).padStart(2,'0')).join('');
  return new Request(ORIGIN+EVALUATION_MACHINE_PATH,{method:'POST',redirect:'manual',headers:{'content-type':'application/json',
    'x-yw-evaluation-timestamp':timestamp,'x-yw-evaluation-nonce':nonce,'x-yw-evaluation-signature':signature},body});
}
async function boundedBody(request) {
  const reader=request.body?.getReader();if(!reader) return null;
  const chunks=[];let length=0;
  try {
    for(;;) {
      const {done,value}=await reader.read();if(done) break;
      length+=value.byteLength;if(length>256) {await reader.cancel();return null;}
      chunks.push(value);
    }
  } finally {reader.releaseLock();}
  const bytes=new Uint8Array(length);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  try {return new TextDecoder('utf-8',{fatal:true}).decode(bytes);} catch{return null;}
}
export async function authenticateEvaluationRequest(request,env,now=Date.now()) {
  const url=new URL(request.url);
  if(request.method!=='POST'||url.origin!==ORIGIN||url.pathname!==EVALUATION_MACHINE_PATH||url.search
    ||request.headers.get('content-type')!=='application/json'
    ||['origin','cookie','referer','authorization','sec-fetch-site','sec-fetch-mode','sec-fetch-dest'].some(h=>request.headers.has(h))) return null;
  const timestamp=request.headers.get('x-yw-evaluation-timestamp')||'',nonce=request.headers.get('x-yw-evaluation-nonce')||'';
  const signature=request.headers.get('x-yw-evaluation-signature')||'';
  if(!/^\d{13}$/.test(timestamp)||Math.abs(now-Number(timestamp))>60000
    ||!/^[a-f0-9]{32}$/.test(nonce)||!/^[a-f0-9]{64}$/.test(signature)) return null;
  const body=await boundedBody(request);if(body===null) return null;
  try {
    const verified=await crypto.subtle.verify('HMAC',await key(env.YW_EVALUATION_MACHINE_SECRET,'verify'),
      Uint8Array.from(signature.match(/../g),x=>parseInt(x,16)),encoder.encode(message(body,timestamp,nonce)));
    if(!verified) return null;
    const parsed=JSON.parse(body);
    if(!parsed||Array.isArray(parsed)||Object.keys(parsed).sort().join(',')!=='jobId,leaseEpoch'
      ||typeof parsed.jobId!=='string'||!/^[A-Za-z0-9:_-]{12,100}$/.test(parsed.jobId)
      ||!Number.isSafeInteger(parsed.leaseEpoch)||parsed.leaseEpoch<1) return null;
    const inserted=await env.READING_DB.prepare('INSERT OR IGNORE INTO learning_evaluation_machine_nonces(nonce,used_at) VALUES(?,?)').bind(nonce,now).run();
    return Number(inserted?.meta?.changes)===1?parsed:null;
  } catch {return null;}
}
export async function handleEvaluationMachine(request,env,execute) {
  if(env.YW_DURABLE_EVALUATION_ENABLED!=='true'||!env.READING_DB) return unavailable();
  const input=await authenticateEvaluationRequest(request,env);
  if(!input) return unavailable();
  const job=await env.READING_DB.prepare('SELECT * FROM learning_evaluation_jobs WHERE source_event_id=?').bind(input.jobId).first();
  if(!job || job.lease_epoch!==input.leaseEpoch) return unavailable();
  let snapshot;
  try {snapshot=JSON.parse(job.snapshot_json);} catch{return unavailable();}
  if(snapshot.reservation?.sourceEventId!==job.source_event_id || snapshot.reservation?.studentId!==job.student_id
    ||snapshot.completion?.student?.id!==job.student_id || snapshot.reservation?.resourceKey!==job.resource_key) return unavailable();
  if(job.state==='completed') return Response.json({ok:true,status:'completed',jobId:input.jobId,leaseEpoch:input.leaseEpoch},{headers:{'Cache-Control':'no-store'}});
  if(job.state!=='leased'||job.lease_until<Date.now()) return unavailable();
  // execute owns the existing source failure/retry policy. Responses contain no
  // student input, prompt, assessment or provider content.
  const status=await execute(job);
  return Response.json({ok:true,status,jobId:input.jobId,leaseEpoch:input.leaseEpoch},{headers:{'Cache-Control':'no-store'}});
}
export async function executeEvaluationRemotely(env,job,send=fetch) {
  const request=await signedEvaluationRequest(env.YW_EVALUATION_MACHINE_SECRET,job);
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),35000);
  try {
    const response=await send(new Request(request,{signal:controller.signal}));
    if(response.status!==200) throw new TypeError('machine execution outcome unknown');
    let result;try {const body=await boundedBody(response);if(body===null) throw new Error();result=JSON.parse(body);} catch {throw new TypeError('machine receipt invalid');}
    if(!result||Object.keys(result).sort().join(',')!=='jobId,leaseEpoch,ok,status'||result.ok!==true
      ||result.jobId!==job.source_event_id||result.leaseEpoch!==job.lease_epoch
      ||!['completed','pending'].includes(result.status)) throw new TypeError('machine receipt invalid');
    return result;
  } finally {clearTimeout(timer);}
}
