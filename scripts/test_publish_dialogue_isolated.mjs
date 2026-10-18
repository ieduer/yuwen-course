import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {FIXED,validateConfiguration,validateRegistration,validateInertConfiguration,validateInertCandidateProof,requestCeiling,requestTimeout,transact,packWorker} from './publish_dialogue_isolated.mjs';
import {FULL_OPERATION,FULL_E2E_OPERATION,ORIGINAL_RECEIPTS} from '../site/dialogue-full-language.js';
import packet from '../site/dialogue-full-language-packet.json' with {type:'json'};
const hash=x=>createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex'),H='a'.repeat(64),version='11111111-2222-4333-8444-555555555555',at=Date.parse('2026-10-17T12:00:00Z'),expiry='2026-10-17T18:00:00Z';
function inertFixture(){
 const f=fixture(),call=f.call,c=f.r.isolated.config;
 f.r.isolated.inert_candidate={version:'yw-inert-diagnostic-candidate-v1'};
 f.r.http_budget={max_requests:22,shared_configuration_max:2,deploy_timeout_ms:300000};
 f.call=async(id,...args)=>{
  const value=await call(id,...args);
  if(['baseline','target-predeploy','after'].includes(id)){
   value.deployment_configs={production:structuredClone(c),preview:structuredClone(c)};
   if(id==='baseline')f.r.base_config_digest=hash({name:value.name,production_branch:value.production_branch,deployment_configs:value.deployment_configs,domains:[...value.domains].sort()});
  }
  return value;
 };
 return f;
}
test('inert diagnostic candidate preserves expired config, performs one deploy and all preservation reads',async()=>{
 const f=inertFixture(),before=JSON.stringify(f.r.isolated.config),call=f.call;
 f.call=async(id,...args)=>{const value=await call(id,...args);if(id==='deployment-0'||id==='deployment-1')value.latest_stage.status='pending';return value;};
 const out=await transact(f.r,f);
 assert.equal(out.status,'isolated_inert_diagnostic_candidate');assert.equal(out.accepted,false);
 assert.equal(f.requests.length,22);assert.equal(JSON.stringify(f.r.isolated.config),before);
 assert(!f.requests.some(r=>r.method==='PATCH'||r.id==='config'||r.id==='upsert'||/^upload-\d/.test(r.id)));
 assert.equal(f.requests.filter(r=>r.id==='deploy').length,1);assert.equal(f.requests.filter(r=>r.id.startsWith('apis-cron')).length,3);
 assert.equal(f.requests.at(-1).id,'apis-cron-after');
});
test('inert candidate rejects missing assets before any upload or deployment',async()=>{
 const f=inertFixture(),call=f.call;f.artifact.assets=[{key:'missing-key',path:'missing.js'}];
 f.call=async(id,...args)=>{if(id==='missing'){f.requests.push({id,method:args[0]});return ['missing-key'];}return call(id,...args);};
 await assert.rejects(transact(f.r,f),/already stored/);
 assert(!f.requests.some(r=>r.method==='PATCH'||r.id==='deploy'||r.id==='upsert'||/^upload-\d/.test(r.id)));
});
test('inert candidate rejects live activation and mixed modes before transport',async()=>{
 for(const edit of [r=>r.isolated.config.env_vars.YW_ACCEPTANCE_EXPIRES_AT.value='2999-01-01T00:00:00Z',r=>r.isolated.deploy_only={},r=>r.http_budget.max_requests=21,r=>r.http_budget.shared_configuration_max=3]){
  const f=inertFixture();edit(f.r);await assert.rejects(transact(f.r,f));assert.equal(f.requests.length,0);
 }
});
function inertProof(){
 const f=inertFixture(),oldFile={path:'_worker.js/dialogue-source.js',bytes:10,sha256:'c'.repeat(64)},newFile={...oldFile,sha256:'d'.repeat(64)},staticFile={path:'dialogue.html',bytes:20,sha256:'e'.repeat(64)};
 const target={account:FIXED.account,resource:FIXED.project,environment:'isolated-acceptance',domains:['yw-acceptance.bdfz.net']};
 const prior={change_id:'prior-consumed',source_commit:f.r.source_commit,target,isolated:{config:structuredClone(f.r.isolated.config)},artifact_files:[oldFile,staticFile]};
 Object.assign(f.r,{change_id:'new-inert',target,artifact_files:[newFile,staticFile]});f.artifact.files=f.r.artifact_files;
 f.r.isolated.inert_candidate.prior_receipt={path:'/not-read-synthetic-prior',sha256:H};
 const registry={approved_releases:[{change_id:prior.change_id,consumed:true,receipt_sha256:H}]};
 return {...f,prior,registry,load:()=>prior,now:Date.parse(expiry)+1000};
}
test('inert proof binds consumed predecessor, exact unchanged expired config and only diagnostic artifact delta',()=>{
 const f=inertProof();assert.equal(validateInertCandidateProof(f.r,f.registry,f.artifact,f.now,f.load),f.prior);
 for(const mutate of [f=>f.registry.approved_releases[0].consumed=false,f=>f.r.change_id=f.prior.change_id,f=>f.r.target={...f.r.target,account:'other'},f=>f.r.isolated.config.env_vars.YW_ACCEPTANCE_ACTIVATION_SHA256.value='f'.repeat(64),f=>f.artifact.files=[{...f.artifact.files[0],path:'_worker.js/dialogue-acceptance.js'},f.artifact.files[1]],f=>f.artifact.files=[f.artifact.files[0],{...f.artifact.files[1],sha256:'f'.repeat(64)}],f=>f.artifact.files=f.prior.artifact_files]){
  const x=inertProof();mutate(x);assert.throws(()=>validateInertCandidateProof(x.r,x.registry,x.artifact,x.now,x.load));
 }
});
test('inert configuration cannot hide changed activation or price deadlines and cannot enable an expired full window',()=>{
 const f=inertProof();assert(validateInertConfiguration(f.r,f.now));assert.throws(()=>validateConfiguration(f.r.isolated.config,f.now),/expired/);
 for(const key of ['YW_CALIBRATION_FULL_LANGUAGE_JSON','YW_E2E_AUTHORITY_JSON','YW_DIALOGUE_BUDGET_JSON']){
  const x=inertProof(),v=x.r.isolated.config.env_vars[key],value=JSON.parse(v.value);value[key==='YW_DIALOGUE_BUDGET_JSON'?'validUntil':'hardExpiry']='2999-01-01T00:00:00Z';v.value=JSON.stringify(value);
  assert.throws(()=>validateInertConfiguration(x.r,x.now),/expired/);
 }
});
test('inert maintenance lease has independent bounded transport but never renews model expiry',()=>{
 const f=inertProof(),r=f.r,before=JSON.stringify(r.isolated.config);r.expires_at=new Date(f.now+1800000).toISOString();const state={startedAt:new Date(f.now).toISOString()};
 assert.equal(requestCeiling(r),22);assert.equal(requestTimeout(r,state,'deploy','POST',f.now),300000);
 assert.equal(requestTimeout(r,state,'after','GET',f.now+899000),1000);
 assert.throws(()=>requestTimeout(r,state,'after','GET',f.now+900000),/deadline/);
 r.expires_at=new Date(f.now-1).toISOString();assert.throws(()=>requestTimeout(r,state,'deploy','POST',f.now),/deadline/);
 assert.equal(JSON.stringify(r.isolated.config),before);
});
test('inert registration still requires a fresh exact channel and hashed consumed predecessor',t=>{
 const f=inertProof(),dir=fs.mkdtempSync('/private/tmp/yw-inert-proof-');
 t.after(()=>{fs.rmSync(dir,{recursive:true,force:true});assert(!fs.existsSync(dir));});
 const priorPath=dir+'/prior.json',priorBytes=JSON.stringify(f.prior);fs.writeFileSync(priorPath,priorBytes);
 const priorHash=hash(priorBytes);f.r.isolated.inert_candidate.prior_receipt={path:priorPath,sha256:priorHash};f.registry.approved_releases[0].receipt_sha256=priorHash;
 const evidence=import.meta.filename,eh=hash(fs.readFileSync(evidence,'utf8'));
 const r=Object.assign(f.r,{schema_version:1,phase:'preview_verified',authorized_task:'synthetic-only',intent:'inert-test',project_id:FIXED.projectId,receipt_path:dir+'/not-written.json',expires_at:new Date(f.now+1800000).toISOString(),preview:{source_commit:f.r.source_commit,artifact_digest:H,evidence_path:evidence,evidence_sha256:eh},tests:{source_commit:f.r.source_commit,evidence_path:evidence,evidence_sha256:eh}});
 Object.assign(r.isolated.apis,{source_commit:'f'.repeat(40),ownership_reference:'synthetic',ownership_evidence_path:evidence,ownership_evidence_sha256:eh});
 const channel={identity:r.change_id,status:'prepared_unconsumed',publisher:new URL('./publish_dialogue_isolated.mjs',import.meta.url).pathname,publisher_sha256:H,receipt_path:r.receipt_path,source_commit:r.source_commit,baseline_deployment:r.base_deployment,expires_at:r.expires_at};
 const registry={schema_version:1,default_policy:'deny',catalog_sha256:H,projects:[{project_id:FIXED.projectId,state:'isolated_unaccepted',mode:'managed_manual',repository:FIXED.repository,target:r.target,staged_manual_channel:channel},...['ai-bdfz-net','apis-bdfz-net'].map(project_id=>({project_id,state:'accepted',accepted:{version_id:version,source_commit:'f'.repeat(40)}}))],approved_releases:[...f.registry.approved_releases,{change_id:r.change_id,project_id:FIXED.projectId,consumed:false,receipt_sha256:H}]};
 const context={receiptHash:H,publisherHash:H,catalogHash:H,head:r.source_commit,dirty:'',remoteHead:r.source_commit,repository:FIXED.repository,artifact:f.artifact,now:f.now};
 assert(validateRegistration(registry,r,context));
 registry.approved_releases.at(-1).consumed=true;assert.throws(()=>validateRegistration(registry,r,context),/terminal channel/);registry.approved_releases.at(-1).consumed=false;
 assert.throws(()=>validateRegistration(registry,r,{...context,dirty:'M'}),/clean pushed/);
 fs.appendFileSync(priorPath,' ');assert.throws(()=>validateRegistration(registry,r,context),/evidence changed/);
});
function config(){const full={version:'yw-full-language-activation-v1',enabled:true,operation:FULL_OPERATION,authorityDigest:H,packetDigest:packet.sourceDigest,sourceCommit:'b'.repeat(40),artifactSha256:H,origin:FIXED.origin,ownerUserId:553,databaseId:FIXED.database,apisVersion:version,registryReceiptDigest:H,singleProviderSourceProofDigest:H,priorReceiptSetDigest:H,priorReceipts:ORIGINAL_RECEIPTS,readyAt:'2026-10-17T12:00:00Z',hardExpiry:expiry,maxAttempts:28,maxReservedMicros:2352000,maxProviderAttempts:1,reserveMicros:84000,maxConcurrency:1,recoveryReadbacks:[]};const pin={version:'yw-isolated-e2e-admission-v2',enabled:true,operation:FULL_E2E_OPERATION,authorityDigest:H,origin:FIXED.origin,ownerUserId:553,databaseId:FIXED.database,apisVersion:version,registryReceiptDigest:H,hardExpiry:expiry,maxVisibleCalls:120,maxProviderAttempts:3,reserveMicros:252000,lessonIds:['lesson-1498','lesson-1711-p1','lesson-1717-p2']};const vars={YW_ACCEPTANCE_USER_ID:'553',YW_ACCEPTANCE_EXPIRES_AT:expiry,YW_ACCEPTANCE_DATABASE_ID:FIXED.database,YW_FORMAL_APIS_VERSION:version,YW_ACCEPTANCE_ACTIVATION_SHA256:H,YW_FULL_LANGUAGE_ACTIVATION_SHA256:H,YW_CALIBRATION_FULL_LANGUAGE_JSON:JSON.stringify(full),YW_E2E_AUTHORITY_JSON:JSON.stringify(pin),YW_DIALOGUE_PROVIDER_ATTEMPTS:'3',YW_DIALOGUE_BUDGET_JSON:JSON.stringify({version:'synthetic-only',currency:'USD',validUntil:expiry,inputMicrosPerMillion:750000,outputMicrosPerMillion:3750000,lessonLifetimeMicros:50000000,model:'gemini-3.8-flash',reserveMicros:84000,globalDailyMicros:50000000,userDailyMicros:50000000})};return {compatibility_date:'2026-05-12',compatibility_flags:[],fail_open:false,d1_databases:{ACCEPTANCE_DB:{id:FIXED.database}},services:{USER_CENTER_EVIDENCE:{service:'bdfz-user-center',environment:'production',entrypoint:'YuwenEvidenceIdentity'},APIS:{service:'apis',environment:'production'}},env_vars:{...Object.fromEntries(Object.entries(vars).map(([k,value])=>[k,{type:'plain_text',value}])),APIS_CALLER_TOKEN:{type:'secret_text'}}};}
function fixture(){
 const c=config(),p={name:FIXED.project,production_branch:'acceptance',canonical_deployment:{id:'old'},deployment_configs:{production:{env_vars:{APIS_CALLER_TOKEN:{type:'secret_text',value:null}}},preview:{env_vars:{APIS_CALLER_TOKEN:{type:'secret_text',value:null}}}},domains:['yw-acceptance.bdfz.net']},formal={name:'yuwen-course',production_branch:'main',canonical_deployment:{id:'formal-old',deployment_trigger:{metadata:{commit_hash:'formal-source'}}},deployment_configs:{production:{}},domains:['yw.bdfz.net']},deployments={deployments:[{versions:[{version_id:version,percentage:100}]}]},settings={bindings:[{name:'BUDGET_LEDGER',type:'durable_object_namespace'}]},cron={schedules:[{cron:'*/10 * * * *'}]};
 const projection=p=>({name:p.name,production_branch:p.production_branch,deployment_configs:p.deployment_configs,domains:[...p.domains].sort()});
 const r={source_commit:'b'.repeat(40),base_deployment:'old',base_config_digest:hash(projection(p)),isolated:{config:c,formal:{deployment:'formal-old',source:'formal-source',config_digest:hash(projection(formal))},apis:{version,deployments_digest:hash(deployments),settings_digest:hash(settings),cron_digest:hash(cron)}}};
 const requests=[],saved=[];let deployed=false;
 const call=async(id,method,url,body)=>{requests.push({id,method,url,body});if(id==='baseline')return structuredClone(p);if(id==='domains')return [{name:'yw-acceptance.bdfz.net',status:'active'}];if(id.startsWith('formal'))return formal;if(id.startsWith('apis-settings'))return settings;if(id.startsWith('apis-cron'))return cron;if(id.startsWith('apis'))return deployments;if(id==='config'){p.deployment_configs={production:c,preview:c};return structuredClone(p);}if(id==='target-predeploy')return structuredClone(p);if(id==='upload-token')return {jwt:'synthetic-never-real-upload-key'};if(id.startsWith('missing'))return [];if(id==='deploy'){deployed=true;return {id:'11111111-2222-4333-8444-666666666666'};}if(id.startsWith('deployment-'))return {deployment_trigger:{metadata:{commit_hash:r.source_commit}},latest_stage:{status:'success'}};if(id==='after'){assert(deployed);return {...p,canonical_deployment:{id:'11111111-2222-4333-8444-666666666666'}};}throw Error('unexpected request');};
 return {r,requests,saved,call,artifact:{files:[],assets:[],sha256:H},packed:Buffer.from('synthetic pack'),save:(n,v)=>saved.push({n,v}),readAsset:()=>Buffer.from(''),delay:async()=>{}};
}
test('only existing isolated DB, owner, renewed operation and exact bindings can be configured',()=>{assert(validateConfiguration(config(),at));for(const edit of [c=>c.d1_databases={READING_DB:{id:FIXED.database}},c=>c.services.APIS.entrypoint='different',c=>c.queues={},c=>c.env_vars.OTHER={type:'plain_text',value:'x'},c=>c.env_vars.YW_ACCEPTANCE_USER_ID.value='554',c=>c.env_vars.YW_E2E_AUTHORITY_JSON.value=JSON.stringify({...JSON.parse(c.env_vars.YW_E2E_AUTHORITY_JSON.value),operation:'yw-e2e-real-dialogue-01a132c3'})]){const c=config();edit(c);assert.throws(()=>validateConfiguration(c,at));}assert.throws(()=>validateConfiguration(config(),Date.parse(expiry)));});
test('deployment is isolated pending, consumes one deployment and preserves formal/APIS/cron',async()=>{const f=fixture(),out=await transact(f.r,f);assert.equal(out.accepted,false);assert.equal(out.status,'isolated_deployed_real_acceptance_pending');assert.equal(f.requests.filter(r=>r.id==='deploy').length,1);assert(f.requests.filter(r=>r.method!=='GET').every(r=>r.url.includes(FIXED.project)||r.url.startsWith('/pages/assets/')));assert.equal(f.requests.filter(r=>r.id.startsWith('apis-cron')).length,3);assert.equal(f.saved.length,1);});
test('stale baseline or APIS settings/cron ends before any configuration write',async()=>{for(const key of ['base_config_digest','apis','cron']){const f=fixture();if(key==='base_config_digest')f.r.base_config_digest='bad';if(key==='apis')f.r.isolated.apis.settings_digest='bad';if(key==='cron')f.r.isolated.apis.cron_digest='bad';await assert.rejects(transact(f.r,f));assert(f.requests.every(r=>r.method==='GET'));}});
test('unknown asset upload, transport uncertainty and platform failure do not replay deployment',async()=>{for(const failure of ['missing','deploy','deployment-0']){const f=fixture(),call=f.call;f.call=async(id,...args)=>{if(id===failure){f.requests.push({id,method:args[0]});if(id==='missing')return ['unrecognized'];throw Error('synthetic uncertain');}return call(id,...args);};await assert.rejects(transact(f.r,f));assert(f.requests.filter(r=>r.id==='deploy').length<=1);}});
test('source recheck and target drift during assets prevent final publish',async()=>{const f=fixture();f.beforeDeploy=()=>{throw Error('source changed');};await assert.rejects(transact(f.r,f));assert(!f.requests.some(r=>r.id==='deploy'));});
test('consumed or expired channel cannot be made executable by the isolated publisher',()=>{const registry={schema_version:1,default_policy:'deny',catalog_sha256:H,projects:[{project_id:FIXED.projectId,state:'isolated_unaccepted',mode:'managed_manual',repository:FIXED.repository,target:{account:FIXED.account,resource:FIXED.project,environment:'isolated-acceptance',domains:['yw-acceptance.bdfz.net']},staged_manual_channel:{status:'consumed_deployed_acceptance_pending'}}],approved_releases:[]};assert.throws(()=>validateRegistration(registry,{schema_version:1,phase:'preview_verified',authorized_task:'synthetic',intent:'test',project_id:FIXED.projectId,target:registry.projects[0].target},{catalogHash:H,now:at}),/terminal channel/);});

test('valid staged registration keeps isolated state and rejects production, source, cost and receipt drift',()=>{
 const f=fixture(),evidence=import.meta.filename,eh=createHash('sha256').update(fs.readFileSync(evidence)).digest('hex'),target={account:FIXED.account,resource:FIXED.project,environment:'isolated-acceptance',domains:['yw-acceptance.bdfz.net']};
 const receipt={...f.r,schema_version:1,phase:'preview_verified',change_id:'synthetic-unapproved',authorized_task:'unit-test',intent:'synthetic only',project_id:FIXED.projectId,receipt_path:'/private/tmp/synthetic-receipt-not-created.json',target,expires_at:'2026-10-17T12:30:00Z',artifact_files:[],preview:{source_commit:f.r.source_commit,artifact_digest:H,evidence_path:evidence,evidence_sha256:eh},tests:{source_commit:f.r.source_commit,evidence_path:evidence,evidence_sha256:eh}};
 Object.assign(receipt.isolated.apis,{source_commit:'f'.repeat(40),ownership_reference:'synthetic only',ownership_evidence_path:evidence,ownership_evidence_sha256:eh});
 const channel={identity:receipt.change_id,status:'prepared_unconsumed',publisher:new URL('./publish_dialogue_isolated.mjs',import.meta.url).pathname,publisher_sha256:H,receipt_path:receipt.receipt_path,source_commit:receipt.source_commit,baseline_deployment:receipt.base_deployment,expires_at:receipt.expires_at};
 const registry={schema_version:1,default_policy:'deny',catalog_sha256:H,projects:[{project_id:FIXED.projectId,state:'isolated_unaccepted',mode:'managed_manual',repository:FIXED.repository,target,staged_manual_channel:channel},...['ai-bdfz-net','apis-bdfz-net'].map(project_id=>({project_id,state:'accepted',accepted:{version_id:version,source_commit:'f'.repeat(40)}}))],approved_releases:[{change_id:receipt.change_id,project_id:FIXED.projectId,consumed:false,receipt_sha256:H}]};
 const context={receiptHash:H,publisherHash:H,catalogHash:H,head:receipt.source_commit,dirty:'',remoteHead:receipt.source_commit,repository:FIXED.repository,artifact:f.artifact,now:at};
 assert(validateRegistration(registry,receipt,context));assert.equal(registry.projects[0].state,'isolated_unaccepted');assert.equal(registry.approved_releases[0].consumed,false);
 for(const edit of [r=>r.target.environment='production',r=>r.expires_at='2026-10-17T11:00:00Z',r=>r.isolated.apis.version='old',r=>r.preview.artifact_digest='bad',r=>r.isolated.config.env_vars.YW_DIALOGUE_BUDGET_JSON.value=JSON.stringify({model:'gemini-3.8-flash',reserveMicros:84000,globalDailyMicros:-1,userDailyMicros:-1})]){const changed=structuredClone(receipt);edit(changed);assert.throws(()=>validateRegistration(registry,changed,context));}
 for(const change of [{dirty:'unrelated'}, {remoteHead:'c'.repeat(40)}, {receiptHash:'c'.repeat(64)}, {publisherHash:'c'.repeat(64)}])assert.throws(()=>validateRegistration(registry,receipt,{...context,...change}));
});

test('unexpected retained Queue binding in provider readback blocks upload and deploy',async()=>{const f=fixture(),original=f.call;f.call=async(id,...args)=>{const r=await original(id,...args);if(id==='config')r.deployment_configs.production.queues={CENTRAL:'forbidden'};return r;};await assert.rejects(transact(f.r,f),/unexpected isolated binding/);assert(!f.requests.some(r=>['upload-token','deploy'].includes(r.id)));});


test('caller secret is inherited, never patched or serialized as receipt plaintext',async()=>{
 const f=fixture();await transact(f.r,f);
 const patch=f.requests.find(x=>x.id==='config').body;
 for(const scope of ['production','preview']){
  assert.equal(Object.hasOwn(patch.deployment_configs[scope].env_vars,'APIS_CALLER_TOKEN'),false);
  assert.equal(patch.deployment_configs[scope].services.APIS_ACCEPTANCE,null);
 }
 const c=config();c.env_vars.APIS_CALLER_TOKEN={type:'plain_text',value:'synthetic-do-not-serialize'};assert.throws(()=>validateConfiguration(c,at));
});
test('missing inherited credential refuses before configuration mutation',async()=>{
 const f=fixture(),original=f.call;f.call=async(id,...args)=>{const x=await original(id,...args);if(id==='baseline'){delete x.deployment_configs.production.env_vars.APIS_CALLER_TOKEN;f.r.base_config_digest=hash({name:x.name,production_branch:x.production_branch,deployment_configs:x.deployment_configs,domains:[...x.domains].sort()});}return x;};
 await assert.rejects(transact(f.r,f),/secret not provisioned/);assert(f.requests.every(x=>x.method==='GET'));
});
test('zero free-pool price remains bounded by positive reservation and attempt caps',()=>{
 const c=config(),p=JSON.parse(c.env_vars.YW_DIALOGUE_BUDGET_JSON.value);p.inputMicrosPerMillion=0;p.outputMicrosPerMillion=0;c.env_vars.YW_DIALOGUE_BUDGET_JSON.value=JSON.stringify(p);assert(validateConfiguration(c,at));
 p.reserveMicros=0;c.env_vars.YW_DIALOGUE_BUDGET_JSON.value=JSON.stringify(p);assert.throws(()=>validateConfiguration(c,at));
});
