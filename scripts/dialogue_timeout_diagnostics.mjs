// Offline finite projection of existing apis-log-v2 telemetry. No network,
// inference, configuration, caller-controlled correlation or raw payload output.
import {createHash} from 'node:crypto';
const sha=x=>createHash('sha256').update(x).digest('hex');
const object=x=>{if(typeof x==='string'){if(Buffer.byteLength(x)>65536)return null;try{x=JSON.parse(x);}catch{return null;}}return x&&typeof x==='object'&&!Array.isArray(x)?x:null;};
const finite=(x,max=1e9)=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=max?x:null;
const events=new Set(['Calling Google API','Google provider attempt completed','Broker completion receipt','API call failed','API call timed out','Request deadline exceeded']);
const choices={providerStage:['awaiting_headers','reading_body','body_complete'],deadline_origin:['provider','request_budget','provider_timeout','request_deadline'],model:['gemini-3.8-flash'],outcome:['OK','TIMEOUT','FETCH_ERROR','DEADLINE','unrecognized'],status:['OK','TIMEOUT','FETCH_ERROR','DEADLINE','unrecognized'],finalStatus:['OK','TIMEOUT','FETCH_ERROR','DEADLINE','unrecognized']};
const numbers=['allocated_provider_ms','configured_provider_ms','remaining_ms','durationMs','timeoutMs','providerAttemptNumber','providerAttemptLimit','responseBodyCompleteMs','httpStatus','elapsedMs','responseHeadersMs','bodyCompleteMs','providerDurationMs','attempt','attemptIndex','maxAttempts'];
const identity=x=>typeof x==='string'&&x.length>0&&Buffer.byteLength(x)<=256&&!/[\u0000-\u0020\u007f]/.test(x)?sha(x):null;
function platformIdentity(w,m){
 const workers=identity(w.requestId),metadata=identity(m.requestId);
 // Only server envelopes carry correlation authority. Trace and event IDs do
 // not identify an invocation; source/caller request IDs are never fallbacks.
 if((w.requestId!=null&&!workers)||(m.requestId!=null&&!metadata))return {digest:null,provenance:null,gap:'platform_invocation_invalid'};
 if(workers&&metadata&&workers!==metadata)return {digest:null,provenance:null,gap:'platform_invocation_conflict'};
 return {digest:workers||metadata,provenance:workers&&metadata?'$workers.requestId+$metadata.requestId':workers?'$workers.requestId':metadata?'$metadata.requestId':null,gap:null};
}
export function timeoutMetadata(row,version){
 const w=object(row?.$workers)||{},m=object(row?.$metadata)||{},outer=object(row?.source),source=object(outer?.message)||outer,gaps=[];
 const correlation=platformIdentity(w,m);if(correlation.gap)gaps.push(correlation.gap);
 const matches=w.scriptVersion?.id===version&&(m.service??w.scriptName)==='apis';
 const result={timestamp:finite(row?.timestamp,Number.MAX_SAFE_INTEGER),eventDigest:typeof m.id==='string'&&m.id.length<=256?sha(m.id):null,version:matches?version:null,invocationDigest:correlation.digest,invocationProvenance:correlation.provenance,status:finite(w.event?.response?.status,599),wallTimeMs:finite(w.wallTimeMs),event:null,details:{},gaps};
 if(!matches){gaps.push('exact_version_or_service_mismatch');return result;}
 if(source?.schema==='apis-log-v2'){
  if(!events.has(source.message)){gaps.push('outside_timeout_diagnostic_scope');return result;}
  result.event=source.message;
  const d=object(source.details)||{};
  for(const [key,values] of Object.entries(choices))if(values.includes(d[key]))result.details[key]=d[key];
  for(const key of numbers)if(finite(d[key])!==null)result.details[key]=d[key];
  if(source.bounded===true)gaps.push('bounded_log_fields_omitted');
  if(!result.invocationDigest)gaps.push('platform_invocation_unavailable');
 }else if(m.type!=='cf-worker-event')gaps.push('unsupported_log_schema');
 return result;
}
export function projectTimeoutWindow(result,{version,from,to}){
 if(!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(version)||!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||to<=from||to-from>16000)throw Error('fixed_window_invalid');
 const events=result?.events?.events;if(!Array.isArray(events)||events.length>2000)throw Error('events_unavailable');
 const complete=result.run?.status==='COMPLETED'&&result.events.count===events.length&&events.length<2000&&result.statistics?.abr_level===1&&!['dropped','droppedEvents','dropped_events','truncated'].some(k=>[result,result.events,result.statistics].some(x=>x?.[k]===true||typeof x?.[k]==='number'&&x[k]>0));
 const rows=events.map(x=>timeoutMetadata(x,version));
 const terminals=rows.filter(x=>x.status===503&&x.timestamp>=from&&x.timestamp<=to&&x.invocationDigest);
 const correlated=terminals.length===1?rows.filter(x=>x.invocationDigest===terminals[0].invocationDigest):[];
 const completions=correlated.filter(x=>x.event==='Google provider attempt completed'&&x.details.outcome==='TIMEOUT');
 const stage=complete&&completions.length===1?completions[0].details.providerStage||null:null;
 return {version,from,to,complete,rows,stage,attribution:stage?'single_platform_invocation_in_exact_window':'unresolved',newInferenceCalls:0,notice:'Time/version correlation does not authenticate a caller. Missing platform correlation or phase stays unresolved; no raw payload is persisted.'};
}
