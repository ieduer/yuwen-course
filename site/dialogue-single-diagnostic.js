import fixture from './dialogue-synthetic-diagnostic-fixture.json' with {type:'json'};
import {consumeGatewayStream,validatedProviderAccounting} from './dialogue-stream.js';
import {http400Diagnostic} from './dialogue-source.js';
import {reconciledCost} from './dialogue-budget.js';
export const SINGLE_DIAGNOSTIC_OPERATION='yw-synthetic-schema-diagnostic-v1';
export const SINGLE_DIAGNOSTIC_PATH='/api/dialogue/diagnostic/v1';
const OP=SINGLE_DIAGNOSTIC_OPERATION,ORIGIN='https://yw-acceptance.bdfz.net',DATABASE='c45988a6-9094-4306-bcce-98704b3989e3',MODEL='gemini-3.8-flash',RESERVE=84000;
const FIELDS='version enabled operation ownerUserId origin databaseId sourceCommit artifactSha256 receiptDigest priorLedgerDigest apisVersion apisSourceCommit fixtureSourceDigest payloadDigest schemaDigest schemaStructureDigest model maxLogicalCalls maxProviderAttempts reserveMicros paidMicros notBefore expiresAt readbackUntil'.split(' ').sort();
const hex=(v,n)=>typeof v==='string'&&new RegExp(`^[a-f0-9]{${n}}$`).test(v);
const json=(v,status=200)=>Response.json(v,{status,headers:{'cache-control':'private, no-store','x-content-type-options':'nosniff'}});
export const diagnosticDigest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(typeof value==='string'?value:JSON.stringify(value))))).map(x=>x.toString(16).padStart(2,'0')).join('');
export async function singleDiagnosticActivation(bindings,now=Date.now()){
 let a;try{a=JSON.parse(bindings.YW_SINGLE_DIAGNOSTIC_JSON||'null');}catch{return null;}
 if(!a||a.enabled!==true)return null;
 if(JSON.stringify(Object.keys(a).sort())!==JSON.stringify(FIELDS)||a.version!=='yw-single-synthetic-diagnostic-v1'||a.operation!==OP||a.ownerUserId!==553||a.origin!==ORIGIN||a.databaseId!==DATABASE||bindings.YW_ACCEPTANCE_DATABASE_ID!==DATABASE||a.model!==MODEL||a.maxLogicalCalls!==1||a.maxProviderAttempts!==1||a.reserveMicros!==RESERVE||a.paidMicros!==0)return null;
 if(!hex(a.sourceCommit,40)||!hex(a.apisSourceCommit,40)||!['artifactSha256','receiptDigest','priorLedgerDigest'].every(k=>hex(a[k],64))||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(a.apisVersion))return null;
 const start=Date.parse(a.notBefore),end=Date.parse(a.expiresAt),readEnd=Date.parse(a.readbackUntil);
 if(![start,end,readEnd,now].every(Number.isFinite)||start>=end||end-start>900000||readEnd<end||readEnd-start>2400000||now<start||now>=readEnd)return null;
 if(a.fixtureSourceDigest!==fixture.fixtureSourceDigest||a.payloadDigest!==fixture.provenance.payloadDigest||a.schemaDigest!==fixture.provenance.syntheticSchemaDigest||a.schemaStructureDigest!==fixture.provenance.schemaStructureDigest)return null;
 if(await diagnosticDigest(fixture.payload)!==a.payloadDigest||await diagnosticDigest(fixture.payload.generationConfig.responseJsonSchema)!==a.schemaDigest||await diagnosticDigest({payload:fixture.payload,provenance:fixture.provenance})!==a.fixtureSourceDigest)return null;
 if(bindings.READING_DB||bindings.READING_TEST_SLUG||bindings.LEARNING_EVIDENCE_QUEUE||typeof bindings.ACCEPTANCE_DB?.prepare!=='function'||typeof bindings.ACCEPTANCE_DB?.batch!=='function'||typeof bindings.USER_CENTER_EVIDENCE?.resolveSession!=='function'||typeof bindings.APIS?.fetch!=='function'||typeof bindings.APIS_CALLER_TOKEN!=='string'||!/^[^\s\x00-\x1f\x7f]{16,256}$/.test(bindings.APIS_CALLER_TOKEN))return null;
 return {...a,reservationDigest:await diagnosticDigest(a)};
}
function usageProjection(value){
 if(!value||!Number.isSafeInteger(value.promptTokenCount)||!Number.isSafeInteger(value.totalTokenCount)||value.promptTokenCount<0||value.totalTokenCount<value.promptTokenCount)return null;
 const out={};for(const key of ['promptTokenCount','totalTokenCount','candidatesTokenCount','cachedContentTokenCount','thoughtsTokenCount'])if(Number.isSafeInteger(value[key])&&value[key]>=0&&value[key]<=1000000000)out[key]=value[key];
 return out.promptTokenCount===undefined||out.totalTokenCount===undefined?null:out;
}
function safeAccounting(value){
 const a=validatedProviderAccounting(value,{maxProviderAttempts:1,model:MODEL,success:value?.attempts?.[0]?.outcome==='OK'});
 if(a.providerAttemptCount!==1)throw Error('accounting');
 const row=a.attempts[0],outcomes=['OK','400','401','403','408','429','500','502','503','504','TIMEOUT','FETCH_ERROR','UNAVAILABLE'];
 return {...a,attempts:[{ordinal:1,model:MODEL,outcome:outcomes.includes(row.outcome)?row.outcome:'UNAVAILABLE',brokerCompleted:row.brokerCompleted,outputStarted:row.outputStarted,usage:usageProjection(row.usage)}]};
}
async function boundedFailure(response){
 const reader=response.body?.getReader();if(!reader)return null;const chunks=[];let bytes=0;
 try{while(true){const r=await reader.read();if(r.done)break;bytes+=r.value.length;if(bytes>65536)throw Error('bounded_failure');chunks.push(r.value);}const buffer=new Uint8Array(bytes);let at=0;for(const c of chunks){buffer.set(c,at);at+=c.length;}return JSON.parse(new TextDecoder().decode(buffer));}finally{await reader.cancel().catch(()=>{});}
}
async function gateway(bindings){
 const signal=AbortSignal.timeout(60000);
 const response=await bindings.APIS.fetch(new Request('https://apis.internal/api/yw/dialogue-stream',{method:'POST',headers:{'content-type':'application/json',accept:'text/event-stream','x-project-name':'yw.bdfz.net','x-task-type':'chat','x-thinking-level':'low','x-internal-token':bindings.APIS_CALLER_TOKEN,'x-request-id':OP},body:JSON.stringify(fixture.payload),signal}));
 if(!response.ok){
  let evidence={outcome:[401,403].includes(response.status)?'credential_refusal':response.status===429?'rate_refusal':'provider_error',httpStatus:response.status,accountedMicros:null,providerAttempts:null};
  try{const raw=await boundedFailure(response);if(raw?.requestId===OP){const providerAccounting=safeAccounting(raw.providerAccounting);evidence={...evidence,providerAccounting,providerAttempts:1};if(response.status===400){const diagnostic=http400Diagnostic(raw);if(diagnostic)evidence.diagnostic=diagnostic;}}}catch{}
  return evidence;
 }
 const result=await consumeGatewayStream(response,()=>{},{model:MODEL,maxProviderAttempts:1,maxReplyChars:1800,signal});
 const providerAccounting=safeAccounting(result.providerAccounting),usage=usageProjection(result.usage);
 if(result.model!==MODEL||result.providerAttemptCount!==1||!usage||!result.value||typeof result.value.reply!=='string'||!Array.isArray(result.value.assessments)||result.value.assessments.length!==0)throw Error('response_unconfirmed');
 const accountedMicros=reconciledCost({inputMicrosPerMillion:0,outputMicrosPerMillion:0},usage);if(accountedMicros!==0)throw Error('cost_unconfirmed');
 return {outcome:'provider_responded',providerAttempts:1,providerAccounting,accountedMicros,modelVersionDigest:typeof result.modelVersion==='string'&&result.modelVersion.length<=160?await diagnosticDigest(result.modelVersion):null};
}
async function identity(request,bindings){
 if(request.headers.has('authorization'))return false;
 const cookies=String(request.headers.get('cookie')||'').split(';').map(x=>x.trim()).filter(x=>x.startsWith('bdfz_uc_session='));if(cookies.length!==1)return false;
 const value=cookies[0].slice('bdfz_uc_session='.length);if(!value||value.length>2048||/[\s;\r\n]/.test(value))return false;
 try{const user=await bindings.USER_CENTER_EVIDENCE.resolveSession(cookies[0]);return user?.authenticated===true&&user.sourceSiteKey==='yw'&&user.userId===553&&typeof user.slug==='string'&&!!user.slug.trim();}catch{return false;}
}
export async function handleSingleDiagnostic(request,bindings,{now=Date.now}={}){
 const url=new URL(request.url);if(url.origin!==ORIGIN||url.pathname!==SINGLE_DIAGNOSTIC_PATH||url.search||!['GET','POST'].includes(request.method))return json({code:'not_found'},404);
 let a;try{a=await singleDiagnosticActivation(bindings,now());}catch{}if(!a)return json({code:'diagnostic_off'},404);
 if(request.method==='POST'&&request.headers.get('origin')!==ORIGIN)return json({code:'origin_required'},403);
 if(!await identity(request,bindings))return json({code:'owner_identity_required'},403);
 const db=bindings.ACCEPTANCE_DB,student=await db.prepare('SELECT id FROM students WHERE uc_user_id=?').bind(553).first();if(!student)return json({code:'existing_owner_required'},403);
 const sessionId=OP+':session',turnId=OP+':turn',eventId=OP+':receipt';
 const stored=()=>db.prepare('SELECT budget_policy_json FROM dialogue_calls WHERE turn_id=?').bind(turnId).first();
 const terminal=()=>db.prepare('SELECT details_json FROM dialogue_events WHERE id=?').bind(eventId).first();
 const finish=async(policy,evidence)=>{
  const receipt={version:'yw-single-synthetic-receipt-v1',operation:OP,requestId:OP,reservationDigest:policy.reservationDigest,sourceCommit:policy.sourceCommit,artifactSha256:policy.artifactSha256,approvalReceiptDigest:policy.receiptDigest,priorLedgerDigest:policy.priorLedgerDigest,payloadDigest:policy.payloadDigest,schemaDigest:policy.schemaDigest,schemaStructureDigest:policy.schemaStructureDigest,fixtureSourceDigest:policy.fixtureSourceDigest,model:MODEL,apisVersion:policy.apisVersion,apisSourceCommit:policy.apisSourceCommit,syntheticOnly:true,lessonAcceptance:false,...evidence,unknownReservedMicros:evidence.accountedMicros===null?RESERVE:0,completedAt:new Date(now()).toISOString()};
  const value={operation:OP,reservationDigest:policy.reservationDigest,terminal:true,receipt,receiptDigest:await diagnosticDigest(receipt)};
  await db.batch([
   db.prepare('INSERT OR IGNORE INTO dialogue_events(id,session_id,turn_id,event_type,details_json,created_at) VALUES(?,?,?,?,?,?)').bind(eventId,sessionId,turnId,'single_synthetic_terminal',JSON.stringify(value),receipt.completedAt),
   db.prepare("UPDATE dialogue_calls SET state=CASE WHEN json_extract((SELECT details_json FROM dialogue_events WHERE id=?),'$.receipt.outcome')='provider_responded' THEN 'finished' ELSE 'review' END,accounted_micros=json_extract((SELECT details_json FROM dialogue_events WHERE id=?),'$.receipt.accountedMicros'),finished_at=(SELECT created_at FROM dialogue_events WHERE id=?) WHERE turn_id=?").bind(eventId,eventId,eventId,turnId),
  ]);
 };
 const readback=async()=>{
  const row=await stored();if(!row)return json({operation:OP,reservationDigest:a.reservationDigest,state:'not_started',terminal:false,syntheticOnly:true});
  const policy=JSON.parse(row.budget_policy_json);if(policy.reservationDigest!==a.reservationDigest)return json({code:'operation_pins_changed'},409);
  let event=await terminal();if(!event&&now()>=policy.dispatchUntil){await finish(policy,{outcome:'transport_unknown',providerAttempts:null,accountedMicros:null});event=await terminal();}
  if(event){const value=JSON.parse(event.details_json);return json(value,value.receipt.outcome==='provider_responded'?200:409);}
  return json({operation:OP,reservationDigest:a.reservationDigest,state:'pending',terminal:false,dispatchUntil:policy.dispatchUntil},202);
 };
 if(request.method==='GET')return readback();
 if(await stored())return readback();
 if(now()>=Date.parse(a.expiresAt))return json({code:'diagnostic_dispatch_expired'},409);
 let body;try{const text=await request.text();if(text.length>300)throw Error();body=JSON.parse(text);}catch{return json({code:'invalid_input'},400);}
 if(!body||Object.keys(body).sort().join(',')!=='operation,reservationDigest'||body.operation!==OP||body.reservationDigest!==a.reservationDigest)return json({code:'invalid_input'},400);
 const at=new Date(now()).toISOString(),policy={...a,dispatchUntil:Math.min(Date.parse(a.expiresAt),now()+65000)},budget=JSON.stringify(policy);
 const reserved=await db.batch([
  db.prepare('INSERT OR IGNORE INTO dialogue_sessions(id,student_id,lesson_id,curriculum_version,curriculum_json,policy_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(sessionId,student.id,'synthetic-diagnostic:no-lesson',OP,JSON.stringify({syntheticOnly:true,fixtureSourceDigest:a.fixtureSourceDigest}),OP,at,at),
  db.prepare("INSERT OR IGNORE INTO dialogue_turns(id,session_id,mutation_id,request_hash,role,content,status,policy_version,created_at) VALUES(?,?,?,?,'student',?,'synthetic_diagnostic',?,?)").bind(turnId,sessionId,OP,a.reservationDigest,'Fixed entirely synthetic diagnostic; payload digest '+a.payloadDigest,OP,at),
  db.prepare("INSERT OR IGNORE INTO dialogue_calls(turn_id,session_id,student_id,day,reserved_tokens,state,created_at,reserved_micros,accounted_micros,budget_policy_json) SELECT ?,?,?,?,2400,'reserved',?,84000,NULL,? WHERE EXISTS(SELECT 1 FROM dialogue_turns t JOIN dialogue_sessions s ON s.id=t.session_id WHERE t.id=? AND t.request_hash=? AND s.student_id=?) AND NOT EXISTS(SELECT 1 FROM dialogue_calls WHERE state IN ('reserved','finishing') AND turn_id<>?)").bind(turnId,sessionId,student.id,at.slice(0,10),at,budget,turnId,a.reservationDigest,student.id,turnId),
 ]);
 if(!reserved[2].meta.changes)return await stored()?readback():json({code:'another_call_inflight'},409);
 let evidence;
 try{if(now()>=Date.parse(a.expiresAt))evidence={outcome:'not_dispatched',providerAttempts:0,accountedMicros:0};else evidence=await gateway(bindings);}catch{evidence={outcome:'transport_unknown',providerAttempts:null,accountedMicros:null};}
 if(now()>=policy.dispatchUntil)evidence={outcome:'transport_unknown',providerAttempts:null,accountedMicros:null};
 await finish(policy,evidence);return readback();
}
