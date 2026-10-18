import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {DatabaseSync} from 'node:sqlite';
import fixture from '../site/dialogue-synthetic-diagnostic-fixture.json' with {type:'json'};
const module=await import('../site/dialogue-single-diagnostic.js').catch(()=>null);
const OP='yw-synthetic-schema-cause-v1',origin='https://yw-acceptance.bdfz.net',path='/api/dialogue/diagnostic/v1',H='a'.repeat(64),version='11111111-1111-4111-8111-111111111111';
const accounting={version:1,policy:'yw-same-model-sequential-v1',mode:'sequential-distinct-key',fallback:false,hedge:false,backgroundCalls:0,maxProviderAttempts:1,providerAttemptCount:1,attempts:[{ordinal:1,model:'gemini-3.8-flash',outcome:'OK',brokerCompleted:true,outputStarted:true,usage:{promptTokenCount:100,totalTokenCount:110}}]};
function setup(t,{gateway,owner=553,enabled=true}={}){
 const sql=new DatabaseSync(':memory:');sql.exec('CREATE TABLE students(id INTEGER PRIMARY KEY,uc_user_id INTEGER);INSERT INTO students VALUES(7,553);');for(const f of ['0010_dialogue_pilot.sql','0011_dialogue_stream.sql','0012_dialogue_budget.sql'])sql.exec(fs.readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8'));t.after(()=>sql.close());
 const db={
  prepare:q=>({bind(...a){
   const exec=()=>({meta:{changes:Number(sql.prepare(q).run(...a).changes)}});
   return {first:async()=>sql.prepare(q).get(...a)||null,run:async()=>exec(),exec};
  }}),
  batch:async statements=>{sql.exec('BEGIN');try{const r=statements.map(s=>s.exec());sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;}}
 };
 let now=Date.now(),calls=0,identities=0;
 const activation={version:'yw-single-synthetic-diagnostic-v1',enabled,operation:OP,ownerUserId:553,origin,databaseId:'c45988a6-9094-4306-bcce-98704b3989e3',sourceCommit:'b'.repeat(40),artifactSha256:H,receiptDigest:H,priorLedgerDigest:H,apisVersion:version,apisSourceCommit:'c'.repeat(40),fixtureSourceDigest:fixture.fixtureSourceDigest,payloadDigest:fixture.provenance.payloadDigest,schemaDigest:fixture.provenance.syntheticSchemaDigest,schemaStructureDigest:fixture.provenance.schemaStructureDigest,model:'gemini-3.8-flash',maxLogicalCalls:1,maxProviderAttempts:1,reserveMicros:84000,paidMicros:0,notBefore:new Date(now-1000).toISOString(),expiresAt:new Date(now+600000).toISOString(),readbackUntil:new Date(now+1800000).toISOString()};
 const env={YW_SINGLE_DIAGNOSTIC_JSON:JSON.stringify(activation),YW_ACCEPTANCE_DATABASE_ID:activation.databaseId,ACCEPTANCE_DB:db,APIS_CALLER_TOKEN:'synthetic-caller-only',USER_CENTER_EVIDENCE:{resolveSession:async cookie=>{identities++;assert.equal(cookie,'bdfz_uc_session=synthetic-cookie');return {authenticated:true,sourceSiteKey:'yw',userId:owner,slug:'synthetic-owner'};}},APIS:{fetch:async req=>{calls++;assert.equal(req.url,'https://apis.internal/api/yw/dialogue-stream');assert.equal(req.headers.get('cookie'),null);assert.equal(req.headers.get('x-request-id'),OP);assert.deepEqual(await req.clone().json(),fixture.payload);if(gateway)return gateway(req);const answer=JSON.stringify({reply:'Synthetic diagnostic only',assessments:[]});return new Response(`id: 1\nevent: delta\ndata: ${JSON.stringify({text:answer})}\n\nid: 2\nevent: done\ndata: ${JSON.stringify({answer,model:activation.model,modelVersion:'synthetic-model',usage:accounting.attempts[0].usage,providerAttemptCount:1,providerAccounting:accounting})}\n\n`,{headers:{'content-type':'text/event-stream'}});}}};
 const request=(method='GET',body,extra={})=>new Request(origin+path,{method,headers:{cookie:'bdfz_uc_session=synthetic-cookie',origin,...extra},...(body?{body:JSON.stringify(body)}:{})});
 const handle=async req=>{assert(module,'single synthetic runtime capability missing');return module.handleSingleDiagnostic(req,env,{now:()=>now});};
 const start=async()=>{const response=await handle(request());const p=await response.json();return handle(request('POST',{operation:OP,reservationDigest:p.reservationDigest}));};
 return {sql,db,env,activation,handle,request,start,get calls(){return calls;},get identities(){return identities;},advance:ms=>{now+=ms;}};
}
test('single synthetic capability defaults OFF and wrong identity never reserves or dispatches',async t=>{
 const f=setup(t,{enabled:false});assert.equal((await f.handle(f.request())).status,404);assert.equal(f.identities,0);assert.equal(f.calls,0);
 const wrong=setup(t,{owner:554});assert.equal((await wrong.handle(wrong.request())).status,403);assert.equal(wrong.sql.prepare('SELECT count(*) n FROM dialogue_calls').get().n,0);
});
test('cause diagnostic is a separate inactive operation and cannot reuse the consumed original activation',async t=>{
 const f=setup(t);assert.equal(module.SINGLE_DIAGNOSTIC_OPERATION,'yw-synthetic-schema-cause-v1');
 f.env.YW_SINGLE_DIAGNOSTIC_JSON=JSON.stringify({...f.activation,operation:'yw-synthetic-schema-diagnostic-v1'});
 assert.equal((await f.handle(f.request())).status,404);assert.equal(f.calls,0);assert.equal(f.identities,0);
 assert.equal(f.sql.prepare('SELECT count(*) n FROM dialogue_calls').get().n,0);
});
test('one server fixture dispatch has immutable terminal receipt; duplicate POST cannot replay',async t=>{
 const f=setup(t),first=await(await f.start()).json();assert.equal(first.terminal,true);assert.equal(first.receipt.outcome,'provider_responded');assert.equal(first.receipt.unknownReservedMicros,0);assert.equal(f.calls,1);
 const again=await(await f.start()).json();assert.deepEqual(again,first);assert.equal(f.calls,1);assert.equal(f.sql.prepare('SELECT count(*) n FROM dialogue_calls').get().n,1);
 assert(!JSON.stringify(first).includes('Synthetic diagnostic only'));assert(!JSON.stringify(first).includes('synthetic-cookie'));
});
test('HTTP400 retains safe correlated classification but never raw messages or key names',async t=>{
 const f=setup(t,{gateway:async()=>Response.json({requestId:OP,providerAccounting:{...accounting,attempts:[{...accounting.attempts[0],outcome:'400',outputStarted:false,usage:null}]},error_code:'CLIENT_REQUEST_INVALID',status_code:400,google_error:{error:{code:400,status:'INVALID_ARGUMENT',message:'synthetic-sensitive-content',details:['secret']}},source_api_tried:'synthetic-key'},{status:400})});
 const result=await(await f.start()).json();assert.equal(result.receipt.outcome,'provider_error');assert.equal(result.receipt.unknownReservedMicros,84000);assert.equal(result.receipt.diagnostic.googleError.status,'INVALID_ARGUMENT');assert(!JSON.stringify(result).includes('synthetic-sensitive-content'));assert(!JSON.stringify(result).includes('synthetic-key'));await f.start();assert.equal(f.calls,1);
});
test('unknown transport and uncorrelated HTTP400 stay terminal with unknown reserve',async t=>{
 for(const gateway of [async()=>{throw Error('secret transport detail');},async()=>Response.json({requestId:'wrong',providerAccounting:accounting,google_error:{error:{status:'INVALID_ARGUMENT'}}},{status:400})]){
  const f=setup(t,{gateway}),r=await(await f.start()).json();assert.equal(r.terminal,true);assert.equal(r.receipt.unknownReservedMicros,84000);assert.equal(r.receipt.diagnostic,undefined);assert(!JSON.stringify(r).includes('secret transport'));await f.start();assert.equal(f.calls,1);
 }
});
test('concurrent POSTs reserve once; caller content and pin mutation cannot create another operation',async t=>{
 const f=setup(t),p=await(await f.handle(f.request())).json(),body={operation:OP,reservationDigest:p.reservationDigest};
 assert.equal((await f.handle(f.request('POST',{...body,prompt:'private input'}))).status,400);
 await Promise.all([f.handle(f.request('POST',body)),f.handle(f.request('POST',body))]);assert.equal(f.calls,1);
 f.env.YW_SINGLE_DIAGNOSTIC_JSON=JSON.stringify({...f.activation,receiptDigest:'d'.repeat(64)});assert.equal((await f.handle(f.request())).status,409);assert.equal(f.calls,1);
});
test('expired dispatch cannot run; delayed readback seals unknown once and late completion cannot replace it',async t=>{
 let release;const f=setup(t,{gateway:()=>new Promise(resolve=>{release=resolve;})});const p=await(await f.handle(f.request())).json();const pending=f.handle(f.request('POST',{operation:OP,reservationDigest:p.reservationDigest}));while(!release)await new Promise(r=>setImmediate(r));
 f.advance(700000);const unknown=await(await f.handle(f.request())).json();assert.equal(unknown.terminal,true);assert.equal(unknown.receipt.outcome,'transport_unknown');
 release(Response.json({error:'late'},{status:500}));assert.deepEqual(await(await pending).json(),unknown);assert.equal(f.calls,1);assert.deepEqual(await(await f.handle(f.request())).json(),unknown);
 const fresh=setup(t);fresh.advance(700000);assert.equal((await fresh.handle(fresh.request('POST',{operation:OP,reservationDigest:H}))).status,409);assert.equal(fresh.calls,0);
});
test('acceptance wrapper keeps original route expired; diagnostic default OFF and formal origin forbidden',async t=>{
 const {createAcceptanceWorker}=await import('../site/dialogue-acceptance.js');let delegated=0;const worker=createAcceptanceWorker({fetch:()=>{delegated++;throw Error('ordinary route reopened');}}),f=setup(t);
 const disabled=await worker.fetch(f.request(),{...f.env,YW_SINGLE_DIAGNOSTIC_JSON:undefined},{});assert.equal(disabled.status,404);
 const ordinary=await worker.fetch(new Request(origin+'/api/dialogue/v1'),{...f.env,YW_ACCEPTANCE_EXPIRES_AT:'2026-10-17T18:00:00Z'},{});assert.equal(ordinary.status,503);assert.equal((await ordinary.json()).code,'acceptance_expired');assert.equal(delegated,0);
 assert.equal((await f.handle(new Request('https://yw.bdfz.net'+path))).status,404);assert.equal(f.calls,0);
});
test('diagnostic creates separate rows and byte-preserves original terminal case evidence',async t=>{
 const f=setup(t);f.sql.exec("INSERT INTO dialogue_sessions(id,student_id,lesson_id,curriculum_version,curriculum_json,policy_version,created_at,updated_at) VALUES('old-session',7,'original-case23','old','{}','old','old','old'); INSERT INTO dialogue_turns(id,session_id,mutation_id,request_hash,role,content,status,policy_version,created_at) VALUES('old-turn','old-session','old-mutation','old-hash','student','synthetic prior row','review','old','old'); INSERT INTO dialogue_calls(turn_id,session_id,student_id,day,reserved_tokens,state,created_at,reserved_micros,accounted_micros,budget_policy_json) VALUES('old-turn','old-session',7,'2026-10-17',2400,'review','old',84000,NULL,'{}'); INSERT INTO dialogue_events(id,session_id,turn_id,event_type,details_json,created_at) VALUES('old-event','old-session','old-turn','original_terminal','{\"terminal\":true}','old');");
 const snapshot=()=>JSON.stringify(['dialogue_sessions','dialogue_turns','dialogue_calls','dialogue_events'].map(table=>f.sql.prepare('SELECT * FROM '+table+" WHERE "+(table==='dialogue_calls'?'turn_id':'id')+" LIKE 'old-%'").all()));const before=snapshot();await f.start();assert.equal(snapshot(),before);assert.equal(f.calls,1);
});
test('fixture is deterministic and synthetic schema preserves original structure with disjoint enum values',async()=>{
 const {makeSyntheticFixture}=await import('./build_synthetic_diagnostic_fixture.mjs');assert.deepEqual(makeSyntheticFixture(),fixture);assert.equal(fixture.provenance.originalSchemaDigest,'2f92b73663e79208c6e5d206924f6df80785d7fa50d99fccf18102a53f8c5f77');
});

const failedAccounting={...accounting,attempts:[{...accounting.attempts[0],outcome:'400',outputStarted:false,usage:null}]};
function argumentFailure(message,details=[],extra={}){
 return {requestId:OP,providerAccounting:failedAccounting,error_code:'CLIENT_REQUEST_INVALID',status_code:400,
  google_error:{error:{code:400,status:'INVALID_ARGUMENT',message,details}},...extra};
}
test('fixed synthetic failure distinguishes bounded schema and output-limit messages without persisting text',async t=>{
 for(const [message,messageCategory,field,fieldPath] of [
  ['Synthetic schema is too complex. PRIVATE_SENTINEL','schema_complexity','generation_config.response_json_schema.properties.PRIVATE_SENTINEL','responseJsonSchema'],
  ['Synthetic maxOutputTokens exceeds the limit. PRIVATE_SENTINEL','output_token_limit','generationConfig.maxOutputTokens','maxOutputTokens'],
 ]){
  const raw=argumentFailure(message,[{'@type':'type.googleapis.com/google.rpc.BadRequest',fieldViolations:[{field,description:'PRIVATE_SENTINEL'},{field:'PRIVATE_SENTINEL'}]}],{source_api_tried:'PRIVATE_SENTINEL'});
  const f=setup(t,{gateway:async()=>Response.json(raw,{status:400})});const result=await(await f.start()).json();
  assert.deepEqual(result.receipt.diagnostic.syntheticDetails,{messageCategory,fieldPaths:[fieldPath]});
  assert.equal(result.receipt.unknownReservedMicros,84000);assert.equal(result.receipt.accountedMicros,null);assert.equal(result.receipt.lessonAcceptance,false);
  assert(!JSON.stringify(result).includes('PRIVATE_SENTINEL'));assert.deepEqual(await(await f.start()).json(),result);assert.equal(f.calls,1);
 }
});
test('synthetic error field names are finite and independent of provider message wording',async t=>{
 const raw=argumentFailure('unrecognized PRIVATE_SENTINEL',[{'@type':'type.googleapis.com/google.rpc.BadRequest',fieldViolations:[
  {field:'generation_config.thinking_config.thinking_level'},{field:'generationConfig.responseJsonSchema'},
  {field:'generation_config.response_json_schema[0]'},{field:'generationConfig.responseSchema'},
  {field:'generationConfig.responseJsonSchemaPRIVATE_SENTINEL'},{field:'contents[0].parts[0].text'},
 ]}]);
 const f=setup(t,{gateway:async()=>Response.json(raw,{status:400})}),result=await(await f.start()).json();
 assert.deepEqual(result.receipt.diagnostic.syntheticDetails,{fieldPaths:['responseJsonSchema','responseSchema','thinkingConfig']});
 assert(!JSON.stringify(result).includes('PRIVATE_SENTINEL'));assert.equal(f.calls,1);
});
test('unknown, ambiguous, oversized or malformed synthetic error detail is omitted',async t=>{
 const invalid=[argumentFailure('unknown PRIVATE_SENTINEL'),argumentFailure('schema is too complex; maxOutputTokens exceeds the limit'),
  argumentFailure('schema is too complex'+'x'.repeat(2048)),argumentFailure('schema is too complex',[],{google_error:{error:{code:403,status:'PERMISSION_DENIED',message:'schema is too complex'}}}),
  argumentFailure(null,[{'@type':'wrong-type',fieldViolations:[{field:'generationConfig.responseJsonSchema'}]}]),
  argumentFailure(null,Array(9).fill({'@type':'type.googleapis.com/google.rpc.BadRequest',fieldViolations:[{field:'generationConfig.responseJsonSchema'}]})),
  argumentFailure(null,[{'@type':'type.googleapis.com/google.rpc.BadRequest',fieldViolations:Array(17).fill({field:'generationConfig.responseJsonSchema'})}]),
 ];
 for(const raw of invalid){const f=setup(t,{gateway:async()=>Response.json(raw,{status:400})}),result=await(await f.start()).json();assert.equal(result.receipt.diagnostic?.syntheticDetails,undefined);assert.equal(f.calls,1);}
});
test('synthetic error detail requires request correlation and valid failed accounting',async t=>{
 for(const extra of [{requestId:'wrong'},{providerAccounting:{...failedAccounting,providerAttemptCount:2}},{providerAccounting:{...failedAccounting,fallback:true}}]){
  const f=setup(t,{gateway:async()=>Response.json(argumentFailure('schema is too complex',[],extra),{status:400})});
  const result=await(await f.start()).json();assert.equal(result.receipt.diagnostic,undefined);assert.equal(result.receipt.unknownReservedMicros,84000);await f.start();assert.equal(f.calls,1);
 }
});
test('ordinary HTTP400 projection continues to ignore free text and synthetic-only detail',async()=>{
 const {http400Diagnostic}=await import('../site/dialogue-source.js');
 const raw=argumentFailure('schema is too complex',[{'@type':'type.googleapis.com/google.rpc.BadRequest',fieldViolations:[{field:'generationConfig.responseJsonSchema'}]}]);
 assert.deepEqual(http400Diagnostic(raw),{errorCode:'CLIENT_REQUEST_INVALID',statusCode:400,googleError:{code:400,status:'INVALID_ARGUMENT'}});
});
test('synthetic detail cannot label a response with successful or incomplete provider accounting',async t=>{
 for(const providerAccounting of [accounting,{...failedAccounting,attempts:[{...failedAccounting.attempts[0],brokerCompleted:false}]}]){
  const f=setup(t,{gateway:async()=>Response.json(argumentFailure('schema is too complex',[],{providerAccounting}),{status:400})}),result=await(await f.start()).json();
  assert.equal(result.receipt.diagnostic?.syntheticDetails,undefined);assert.equal(result.receipt.unknownReservedMicros,84000);assert.equal(f.calls,1);
 }
});
