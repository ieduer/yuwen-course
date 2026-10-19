import test,{beforeEach,afterEach,mock} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {acceptanceEnvironment,ACCEPTANCE_ORIGIN as origin} from '../site/dialogue-acceptance.js';
import {MODE_OPERATION,MODE_LESSONS,modeLedgerDigest,prepareModeLedger,modeOperationCondition} from '../site/dialogue-mode-admission.js';
import {requestDialogueBudget} from '../site/dialogue-recovery.js';
import {handleDialogue} from '../site/dialogue-source.js';
import {FIXED,validateConfiguration,validateModeConfiguration,validateModeProof,validateRegistration,configurationPatch,requestTimeout,requestCeiling,transact} from './publish_dialogue_isolated.mjs';
import {registerRollbackCopy,validateRollbackRegistration,rollbackConfigurationPatch} from './publish_dialogue_rollback.mjs';

const H='a'.repeat(64),at=Date.parse('2026-10-18T12:00:00Z'),expiry='2026-10-18T13:00:00Z';
const student={id:1,ucUserId:553},lesson='lesson-1717-p2',version='11111111-2222-4333-8444-555555555555';
const hash=x=>createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
const ownerRef=hash('dialogue-owner:1'),load=id=>JSON.parse(fs.readFileSync('site/dialogue-curriculum/'+id+'.json'));
const policy={version:'synthetic-mode-only',validUntil:expiry,currency:'USD',model:'gemini-3.8-flash',globalDailyMicros:50000000,userDailyMicros:50000000,lessonLifetimeMicros:50000000,reserveMicros:84000,inputMicrosPerMillion:750000,outputMicrosPerMillion:3750000};
const req=body=>new Request(origin+'/api/dialogue/v1?lessonId='+lesson,body?{method:'POST',body:JSON.stringify({ownerRef,...body})}:{});
const usage={promptTokenCount:100,totalTokenCount:200};
const result=()=>({value:{reply:'先從你在意的原句談起。',assessments:[]},model:policy.model,modelVersion:'synthetic-only-version',usage,providerAccounting:{version:1,policy:'yw-same-model-sequential-v1',mode:'sequential-distinct-key',fallback:false,hedge:false,backgroundCalls:0,maxProviderAttempts:1,providerAttemptCount:1,attempts:[{ordinal:1,model:policy.model,outcome:'OK',brokerCompleted:true,outputStarted:true,usage}]}});
beforeEach(()=>mock.timers.enable({apis:['Date'],now:at}));afterEach(()=>mock.timers.reset());
async function fixture(t){
 const sql=new DatabaseSync(':memory:');for(const f of fs.readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())sql.exec(fs.readFileSync('migrations/'+f,'utf8'));t.after(()=>sql.close());
 sql.exec("INSERT INTO students(id,uc_slug,display_name) VALUES(1,'synthetic-mode','Synthetic')");
 sql.exec("INSERT INTO dialogue_sessions VALUES('historical',1,'calibration:old','old','{}','old',0,NULL,'2026-10-17','2026-10-17')");
 sql.prepare("INSERT INTO dialogue_turns(id,session_id,mutation_id,request_hash,role,content,status,policy_version,created_at) VALUES('prior','historical','prior',?,'student','synthetic','needs_review','old','2026-10-17')").run(H);
 sql.exec("INSERT INTO dialogue_calls(turn_id,session_id,student_id,day,reserved_tokens,state,created_at,finished_at,reserved_micros,accounted_micros,budget_policy_json) VALUES('prior','historical',1,'2026-10-17',2400,'review','2026-10-17','2026-10-17',84000,NULL,'{}')");
 sql.exec("INSERT INTO dialogue_events VALUES('prior:result','historical','prior','synthetic_failure','{\"status\":503}','2026-10-17')");
 const wrap=(text,args=[])=>({bind:(...v)=>wrap(text,v),first:async()=>sql.prepare(text).get(...args)||null,all:async()=>({results:sql.prepare(text).all(...args)}),run:async()=>({meta:{changes:Number(sql.prepare(text).run(...args).changes)}}),runSync:()=>({meta:{changes:Number(sql.prepare(text).run(...args).changes)}})});
 const db={prepare:text=>wrap(text),batch:async rows=>{sql.exec('BEGIN');try{const r=rows.map(s=>s.runSync());sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 const priorRows=()=>sql.prepare("SELECT c.*,s.student_id session_owner,s.curriculum_json,e.details_json FROM dialogue_calls c JOIN dialogue_sessions s ON s.id=c.session_id LEFT JOIN dialogue_events e ON e.id=c.turn_id||':result' WHERE c.turn_id='prior'").all();
 const pin={version:'yw-isolated-mode-admission-v1',enabled:true,operation:MODE_OPERATION,origin,ownerUserId:553,databaseId:'c45988a6-9094-4306-bcce-98704b3989e3',apisVersion:version,registryReceiptDigest:H,authorityDigest:H,sourceCommit:'b'.repeat(40),artifactSha256:H,singleProviderSourceProofDigest:H,notBefore:new Date(at).toISOString(),hardExpiry:expiry,lessonPins:MODE_LESSONS.map(id=>({lessonId:id,curriculumVersion:load(id).curriculumVersion,sourceDigest:hash(load(id))})),maxVisibleCalls:2,maxProviderAttempts:1,reserveMicros:84000,maxReservedMicros:168000,paidMicros:0,model:policy.model,priorCallCount:1,priorLedgerDigest:await modeLedgerDigest(priorRows())};
 const bindings={ASSETS:{fetch:async r=>new Response(fs.readFileSync('site'+new URL(r.url).pathname))},ACCEPTANCE_DB:db,USER_CENTER_EVIDENCE:{resolveSession:async()=>({userId:553})},APIS_CALLER_TOKEN:'synthetic-caller-only',APIS:{fetch:()=>{throw Error('network_forbidden');}},YW_ACCEPTANCE_USER_ID:'553',YW_FORMAL_APIS_VERSION:version,YW_ACCEPTANCE_DATABASE_ID:pin.databaseId,YW_ACCEPTANCE_ACTIVATION_SHA256:H,YW_ACCEPTANCE_EXPIRES_AT:expiry,YW_DIALOGUE_BUDGET_JSON:JSON.stringify(policy),YW_DIALOGUE_PROVIDER_ATTEMPTS:'1',YW_E2E_AUTHORITY_JSON:JSON.stringify(pin)};
 const env=acceptanceEnvironment(req(),bindings);let calls=0;
 const options={callModel:async()=>{calls++;return result();}};
 const read=async()=>await(await handleDialogue(req(),env,student,null,options)).json();
 const body=async()=>{const s=await read();return {conversation:true,taskId:s.learningTurn.taskId,revision:s.revision,content:'我想先討論月光這一句，請慢慢說。',mutationId:crypto.randomUUID()};};
 const send=async b=>{const response=await handleDialogue(req(b||await body()),env,student,null,options);return {status:response.status,data:await response.json()};};
 return {sql,db,pin,bindings,env,options,priorRows,read,body,send,calls:()=>calls,refresh:()=>{env.YW_E2E_AUTHORITY_JSON=JSON.stringify(pin);}};
}

test('new sampled mode admits actual conversational backend without fixed28 and preserves old unknown reserve',async t=>{
 const f=await fixture(t),prior=f.priorRows(),b=await f.body();const r=await f.send(b);
 assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(f.calls(),1);assert.deepEqual(f.priorRows(),prior);
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM learning_evaluations').get().n,0);
 assert.equal((await f.send(b)).status,200);assert.equal(f.calls(),1);
 assert.equal((await f.send({...b,content:'另一個問題'})).status,409);assert.equal(f.calls(),1);
 assert.equal((await f.send()).status,200);assert.equal(f.calls(),2);
 const stopped=await f.send();assert.equal(stopped.status,429);assert.equal(stopped.data.code,'mode_operation_review_required');assert.equal(f.calls(),2);
 assert.deepEqual(f.priorRows(),prior);
});

test('new sampled capability is absent on ordinary Pages and cannot grant retries, paid allowance or a different scope',async t=>{
 const f=await fixture(t);const ordinary={...f.bindings,READING_DB:f.db,YW_DIALOGUE_ENABLED:'true'};
 assert.equal(requestDialogueBudget(ordinary,student,lesson).isolatedAdmission,undefined);
 for(const patch of [{enabled:false},{ownerUserId:554},{operation:'old-terminal'},{sourceCommit:'bad'},{registryReceiptDigest:'c'.repeat(64)},{maxVisibleCalls:121},{maxProviderAttempts:3},{paidMicros:1},{hardExpiry:'2026-10-18T14:00:00Z'},{maxReservedMicros:1},{priorCallCount:0},{lessonPins:f.pin.lessonPins.slice(1)}]){
  f.env.YW_E2E_AUTHORITY_JSON=JSON.stringify({...f.pin,...patch});assert.throws(()=>requestDialogueBudget(f.env,student,lesson));
 }
 f.refresh();assert.throws(()=>requestDialogueBudget(f.env,{...student,ucUserId:554},lesson));assert.throws(()=>requestDialogueBudget(f.env,student,'lesson-1711-p1'));
 f.env.YW_DIALOGUE_PROVIDER_ATTEMPTS='3';assert.throws(()=>requestDialogueBudget(f.env,student,lesson));assert.equal(f.calls(),0);
});

test('source and frozen historical ledger changes stop before dispatch',async t=>{
 for(const change of [f=>{f.pin.lessonPins.find(p=>p.lessonId===lesson).sourceDigest='c'.repeat(64);f.refresh();},f=>f.sql.exec("UPDATE dialogue_calls SET accounted_micros=0 WHERE turn_id='prior'"),f=>f.sql.exec("UPDATE dialogue_events SET details_json='{}' WHERE id='prior:result'"),f=>f.sql.exec("UPDATE dialogue_calls SET state='reserved' WHERE turn_id='prior'")]){
  const f=await fixture(t);change(f);assert.equal((await f.send()).status,429);assert.equal(f.calls(),0);
 }
});

test('historical receipt race is checked again in the same D1 reservation',async t=>{
 const f=await fixture(t),batch=f.db.batch;f.db.batch=async rows=>{f.sql.exec("UPDATE dialogue_calls SET reserved_micros=1 WHERE turn_id='prior'");return batch(rows);};
 assert.equal((await f.send()).status,429);assert.equal(f.calls(),0);
});

test('unfinished provider and missing usage stop the operation without a new logical request or reset',async t=>{
 for(const outcome of ['failure','usage']){
  const f=await fixture(t);let calls=0;f.options.callModel=async()=>{calls++;if(outcome==='failure')throw Error('gateway_unavailable');return {...result(),usage:null};};
  await f.send();assert.equal(calls,1);assert.equal(f.sql.prepare("SELECT state FROM dialogue_calls WHERE turn_id<>'prior'").get().state,'review');
  assert.equal((await f.send()).status,429);assert.equal(calls,1);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM dialogue_calls').get().n,2);
 }
});

test('cross-date quota, expired activation and absent ledger preparation fail closed',async t=>{
 const f=await fixture(t);await f.send();await f.send();f.sql.exec("UPDATE dialogue_calls SET day='2026-10-17' WHERE turn_id<>'prior'");
 assert.equal((await f.send()).status,429);assert.equal(f.calls(),2);
 const budget=requestDialogueBudget(f.env,student,lesson);assert.equal(modeOperationCondition(budget,1).sql,'0');
 assert(await prepareModeLedger(f.db,budget,1,load(lesson)));const c=modeOperationCondition(budget,1);assert.equal(f.sql.prepare('SELECT ('+c.sql+') allowed').get(...c.args).allowed,0);
 mock.timers.tick(3600000);assert.throws(()=>requestDialogueBudget(f.env,student,lesson));
});

test('mode rejects per-field and direct original shortcuts before any original scoring write',async t=>{
 const f=await fixture(t),b=await f.body();delete b.conversation;
 assert.equal((await f.send(b)).status,400);assert.equal(f.calls(),0);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM learning_interactions').get().n,0);
 assert.equal((await f.send({...b,conversation:true,action:'original'})).status,400);assert.equal(f.calls(),0);
});

test('publisher mode configuration is independent, exact and keeps central writes unavailable',async t=>{
 const f=await fixture(t),vars=Object.fromEntries(Object.entries(f.bindings).filter(([k,v])=>typeof v==='string').map(([k,value])=>[k,k==='APIS_CALLER_TOKEN'?{type:'secret_text'}:{type:'plain_text',value}]));
 const config={compatibility_date:'2026-05-12',compatibility_flags:[],fail_open:false,d1_databases:{ACCEPTANCE_DB:{id:FIXED.database}},services:{USER_CENTER_EVIDENCE:{service:'bdfz-user-center',environment:'production',entrypoint:'YuwenEvidenceIdentity'},APIS:{service:'apis',environment:'production'}},env_vars:vars};
 assert.deepEqual(validateModeConfiguration(config,at),f.pin);assert.throws(()=>validateConfiguration(config,at));
 assert.equal(f.env.LEARNING_EVIDENCE_QUEUE,undefined);assert.equal(f.env.USER_CENTER_EVIDENCE.submitEvidence,undefined);
 for(const change of [c=>{c.queues={LEARNING_EVIDENCE_QUEUE:'q'};},c=>{c.env_vars.YW_CALIBRATION_FULL_LANGUAGE_JSON={type:'plain_text',value:'{}'};},c=>{c.env_vars.YW_DIALOGUE_PROVIDER_ATTEMPTS.value='3';},c=>{c.services.APIS.service='another';}]){const c=structuredClone(config);change(c);assert.throws(()=>validateModeConfiguration(c,at));}
 assert.throws(()=>validateModeConfiguration(config,at+3600000));
 const patch=configurationPatch(config);assert.equal(patch.env_vars.APIS_CALLER_TOKEN,undefined);assert.equal(patch.env_vars.YW_CALIBRATION_FULL_LANGUAGE_JSON,null);assert.equal(patch.env_vars.YW_FULL_LANGUAGE_ACTIVATION_SHA256,null);
 const dir=fs.mkdtempSync('/private/tmp/cf-task-yw-mode-fixture-');
 try{
  const ledgerPath=dir+'/ledger.json',authorizationPath=dir+'/authorization.json',priorPath=dir+'/prior.json',proofPath=dir+'/provider-proof.json';fs.writeFileSync(ledgerPath,JSON.stringify({rows:f.priorRows()}));
  const fileHash=p=>hash(fs.readFileSync(p,'utf8')),evidence=import.meta.filename,eh=fileHash(evidence);
  fs.writeFileSync(proofPath,JSON.stringify({version:'yw-mode-single-provider-source-v1',apisVersion:version,apisSourceCommit:'c'.repeat(40),providerAttemptLimit:1,automaticRetry:false,evidence:[{path:evidence,sha256:eh}]}));f.pin.singleProviderSourceProofDigest=fileHash(proofPath);
  const {authorityDigest,...approvedPin}=f.pin;fs.writeFileSync(authorizationPath,JSON.stringify({version:'yw-mode-human-authorization-v1',status:'approved',operation:MODE_OPERATION,pin:approvedPin}));
  config.env_vars.YW_E2E_AUTHORITY_JSON.value=JSON.stringify({...f.pin,authorityDigest:fileHash(authorizationPath)});
  const r={schema_version:1,phase:'preview_verified',authorized_task:'synthetic-unit-only',intent:'synthetic',project_id:FIXED.projectId,receipt_path:dir+'/not-written.json',change_id:'synthetic-mode',target:{account:FIXED.account,resource:FIXED.project,environment:'isolated-acceptance',domains:['yw-acceptance.bdfz.net']},source_commit:f.pin.sourceCommit,base_deployment:'old',expires_at:expiry,artifact_files:[],tests:{source_commit:f.pin.sourceCommit,evidence_path:evidence,evidence_sha256:eh},preview:{source_commit:f.pin.sourceCommit,artifact_digest:H,evidence_path:evidence,evidence_sha256:eh},isolated:{config,sample_mode:{version:'yw-sampled-mode-publication-v1',single_provider_source_proof:{path:proofPath,sha256:fileHash(proofPath)},authorization:{path:authorizationPath,sha256:fileHash(authorizationPath)},prior_ledger:{path:ledgerPath,sha256:fileHash(ledgerPath)}},apis:{version,source_commit:'c'.repeat(40),ownership_reference:'synthetic',settings_digest:H,deployments_digest:H,cron_digest:H,ownership_evidence_path:evidence,ownership_evidence_sha256:eh}}};
  const priorConfig=structuredClone(config);priorConfig.env_vars.YW_E2E_AUTHORITY_JSON.value=JSON.stringify({operation:'historical-terminal'});priorConfig.env_vars.YW_ACCEPTANCE_EXPIRES_AT.value='2026-10-17T12:00:00Z';
  const prior={change_id:'old-consumed',target:r.target,source_commit:'d'.repeat(40),preview:{artifact_digest:H},isolated:{config:priorConfig,packed_worker_sha256:H}};fs.writeFileSync(priorPath,JSON.stringify(prior));r.isolated.sample_mode.prior_receipt={path:priorPath,sha256:fileHash(priorPath)};
  assert(validateModeProof(r,{sha256:H},at));const missingProof=structuredClone(r);delete missingProof.isolated.sample_mode.single_provider_source_proof;assert.throws(()=>validateModeProof(missingProof,{sha256:H},at),/evidence changed/);assert.throws(()=>validateModeProof({...r,source_commit:'d'.repeat(40)},{sha256:H},at));
  const channel={identity:r.change_id,status:'prepared_unconsumed',publisher:new URL('./publish_dialogue_isolated.mjs',import.meta.url).pathname,publisher_sha256:H,receipt_path:r.receipt_path,source_commit:r.source_commit,baseline_deployment:r.base_deployment,expires_at:expiry};
  const registry={schema_version:1,default_policy:'deny',catalog_sha256:H,projects:[{project_id:FIXED.projectId,state:'isolated_unaccepted',mode:'managed_manual',repository:FIXED.repository,target:r.target,staged_manual_channel:channel},...['ai-bdfz-net','apis-bdfz-net'].map(project_id=>({project_id,state:'accepted',accepted:{version_id:version,source_commit:'c'.repeat(40)}}))],approved_releases:[{change_id:r.change_id,project_id:FIXED.projectId,consumed:false,receipt_sha256:H}]};
  registry.approved_releases.push({change_id:prior.change_id,consumed:true,receipt_sha256:fileHash(priorPath)});
  const context={receiptHash:H,publisherHash:H,catalogHash:H,head:r.source_commit,dirty:'',remoteHead:r.source_commit,repository:FIXED.repository,artifact:{files:[],sha256:H},now:at};
  assert(validateRegistration(registry,r,context));registry.approved_releases[0].consumed=true;assert.throws(()=>validateRegistration(registry,r,context),/terminal/);registry.approved_releases[0].consumed=false;
  assert.throws(()=>validateRegistration(registry,r,{...context,dirty:'M file'}),/clean pushed/);
  r.isolated.calibration_overlay={path:'not-allowed'};assert.throws(()=>validateModeProof(r,{sha256:H},at));delete r.isolated.calibration_overlay;
  r.http_budget={deploy_timeout_ms:300000,max_requests:23};assert.equal(requestTimeout(r,{startedAt:new Date(at).toISOString()},'deploy','POST',at),300000);assert.equal(requestCeiling(r),23);
  const formal={name:'yuwen-course',production_branch:'main',canonical_deployment:{id:'formal-unchanged',deployment_trigger:{metadata:{commit_hash:'formal-source'}}},deployment_configs:{production:{}},domains:['yw.bdfz.net']},deployments={deployments:[{versions:[{version_id:version,percentage:100}]}]},settings={bindings:[]},cron={schedules:[]};
  const projection=p=>({name:p.name,production_branch:p.production_branch,deployment_configs:p.deployment_configs,domains:[...p.domains].sort()});
  r.isolated.formal={deployment:'formal-unchanged',source:'formal-source',config_digest:hash(projection(formal))};Object.assign(r.isolated.apis,{deployments_digest:hash(deployments),settings_digest:hash(settings),cron_digest:hash(cron)});
  const simulate=async uncertain=>{
   const current={name:FIXED.project,production_branch:'acceptance',canonical_deployment:{id:'old'},deployment_configs:{production:priorConfig,preview:priorConfig},domains:['yw-acceptance.bdfz.net']},requests=[];
   r.base_config_digest=hash(projection(current));const call=async(id,method,url,body)=>{
    requests.push({id,method});if(id==='baseline')return structuredClone(current);if(id==='domains')return [{name:'yw-acceptance.bdfz.net',status:'active'}];
    if(id.startsWith('formal'))return formal;if(id.startsWith('apis-settings'))return settings;if(id.startsWith('apis-cron'))return cron;if(id.startsWith('apis'))return deployments;
    if(id==='config'){assert.equal(body.deployment_configs.production.env_vars.YW_CALIBRATION_FULL_LANGUAGE_JSON,null);assert.equal(body.deployment_configs.production.env_vars.APIS_CALLER_TOKEN,undefined);current.deployment_configs={production:config,preview:config};if(uncertain)throw Error('synthetic transport unknown');return structuredClone(current);}
    if(id==='config-uncertain-readback'||id==='target-predeploy')return structuredClone(current);if(id==='upload-token')return {jwt:'synthetic-never-real-upload-key'};if(id==='missing')return [];
    if(id==='deploy')return {id:'11111111-2222-4333-8444-666666666666'};if(id.startsWith('deployment-'))return {deployment_trigger:{metadata:{commit_hash:r.source_commit}},latest_stage:{status:id==='deployment-2'?'success':'pending'}};
    if(id==='after')return {...current,canonical_deployment:{id:'11111111-2222-4333-8444-666666666666'}};throw Error('unexpected mode request '+id);
   };
   const execution=transact(r,{call,artifact:{files:[],assets:[],sha256:H},packed:Buffer.from('synthetic-only'),readAsset:()=>{throw Error('no static upload');},save:()=>{},delay:async()=>{}});
   if(uncertain){await assert.rejects(execution,/terminal readback only/);assert.equal(requests.filter(x=>x.id==='config').length,1);assert(!requests.some(x=>x.id==='deploy'));}
   else{assert.equal((await execution).accepted,false);assert.equal(requests.length,23);assert.equal(requests.filter(x=>x.id==='deploy').length,1);assert(!requests.some(x=>/^upload-\d|upsert/.test(x.id)));}
  };
  await simulate(false);await simulate(true);
  const put=(name,data)=>{const p=dir+'/'+name;fs.writeFileSync(p,JSON.stringify(data));return {path:p,sha256:fileHash(p)};};
  const forward=put('forward.json',r),handle='11111111-2222-4333-8444-666666666666';registry.approved_releases[0].consumed=true;registry.approved_releases[0].receipt_sha256=forward.sha256;
  const rb={...r,change_id:'new-mode-rollback',receipt_path:dir+'/rollback-not-written.json',intent:'rollback_isolated_sample_mode',base_deployment:handle,http_budget:{max_requests:13,shared_configuration_max:3},preservation:{formal:r.isolated.formal,apis:r.isolated.apis},rollback:{version:'yw-controlled-isolated-rollback-v1',restore_configuration:true,restore_source:prior.source_commit,restore_deployment:'old',restore_artifact:H,restore_pack:H,restore_config:priorConfig,restore_receipt:r.isolated.sample_mode.prior_receipt,forward_receipt:forward,forward_journal:put('journal.json',{source:r.source_commit,receiptSha256:forward.sha256,terminal:true,requests:[{id:'config',method:'PATCH'},{id:'deploy',method:'POST'}]}),deployment_handle:put('handle.json',{id:handle,source:r.source_commit})}};
  const copy=registerRollbackCopy(registry,rb,context);assert(validateRollbackRegistration(copy,rb,context));copy.approved_releases.at(-1).consumed=true;assert.throws(()=>validateRollbackRegistration(copy,rb,context),/fresh registered/);
  assert.equal(rollbackConfigurationPatch(priorConfig).env_vars.YW_SINGLE_DIAGNOSTIC_JSON,null);assert.equal(rollbackConfigurationPatch(priorConfig).env_vars.APIS_CALLER_TOKEN,undefined);
  fs.appendFileSync(authorizationPath,' ');assert.throws(()=>validateModeProof(r,{sha256:H},at),/evidence changed/);
 }finally{fs.rmSync(dir,{recursive:true});assert(!fs.existsSync(dir));}
});
