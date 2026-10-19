import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';import {parseEnv} from 'node:util';import {pathToFileURL} from 'node:url';
import {FIXED,configurationPatch,validateModeProof} from './publish_dialogue_isolated.mjs';
const sha=x=>createHash('sha256').update(typeof x==='string'||Buffer.isBuffer(x)?x:JSON.stringify(x)).digest('hex'),same=(a,b,m)=>assert.deepEqual(a,b,m),read=p=>JSON.parse(fs.readFileSync(p));
const BASE=`/accounts/${FIXED.account}`,PROJECT=BASE+'/pages/projects/'+FIXED.project,FORMAL=BASE+'/pages/projects/yuwen-course';
const projection=p=>({name:p.name,production_branch:p.production_branch,deployment_configs:p.deployment_configs,domains:[...(p.domains||[])].sort()});
const pinRead=p=>{assert(p?.path&&sha(fs.readFileSync(p.path))===p.sha256,'rollback evidence changed');return read(p.path);};
function write(file,value,exclusive=false){const fd=fs.openSync(file,exclusive?'wx':'w',0o600);try{fs.writeFileSync(fd,JSON.stringify(value,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function normalizedConfig(config){const c=structuredClone(config);if(c.env_vars?.APIS_CALLER_TOKEN?.type==='secret_text')c.env_vars.APIS_CALLER_TOKEN={type:'secret_text'};for(const k of ['env_vars','services'])for(const n of Object.keys(c[k]||{}))if(c[k][n]===null)delete c[k][n];for(const k of ['always_use_latest_compatibility_date','usage_model','placement','build_image_major_version','limits'])delete c[k];return c;}
export function rollbackConfigurationPatch(config){const p=configurationPatch(config);p.env_vars.YW_SINGLE_DIAGNOSTIC_JSON=null;assert(!Object.hasOwn(p.env_vars,'APIS_CALLER_TOKEN'),'never write a redacted secret');return p;}
export function validateRollbackRegistration(registry,r,c,{load=pinRead}={}){
 assert(registry.schema_version===1&&registry.default_policy==='deny'&&registry.catalog_sha256===c.catalogHash,'registry/catalog drift');
 const project=registry.projects.find(p=>p.project_id===FIXED.projectId),channel=project?.staged_manual_channel,approval=registry.approved_releases.find(a=>a.change_id===r.change_id);
 assert(project?.state==='isolated_unaccepted'&&project.mode==='managed_manual'&&project.repository===FIXED.repository,'isolated target required');same(r.target,project.target);same(r.target,{account:FIXED.account,resource:FIXED.project,environment:'isolated-acceptance',domains:['yw-acceptance.bdfz.net']});
 assert(r.schema_version===1&&r.phase==='preview_verified'&&r.project_id===FIXED.projectId&&['rollback_isolated_diagnostic','rollback_isolated_sample_mode'].includes(r.intent)&&r.authorized_task&&r.rollback?.version==='yw-controlled-isolated-rollback-v1','exact rollback receipt required');
 assert(approval?.consumed===false&&approval.receipt_sha256===c.receiptHash&&approval.project_id===FIXED.projectId&&channel?.identity===r.change_id&&channel.status==='prepared_unconsumed'&&channel.publisher===import.meta.filename&&channel.publisher_sha256===c.publisherHash&&channel.receipt_path===r.receipt_path&&channel.source_commit===r.source_commit&&channel.baseline_deployment===r.base_deployment,'fresh registered rollback channel required');
 assert(c.head===r.source_commit&&c.remoteHead===c.head&&!c.dirty&&c.repository===FIXED.repository&&/^[a-f0-9]{40}$/.test(c.head),'clean exact pushed guard source required');
 assert(channel.expires_at===r.expires_at&&Date.parse(r.expires_at)>c.now&&Date.parse(r.expires_at)-c.now<=3600000,'expired rollback lease');
 assert(r.tests?.source_commit===c.head&&sha(fs.readFileSync(r.tests.evidence_path))===r.tests.evidence_sha256,'rollback test evidence differs');
 const forward=load(r.rollback.forward_receipt),journal=load(r.rollback.forward_journal),prior=load(r.rollback.restore_receipt);
 const consumed=registry.approved_releases.find(a=>a.change_id===forward.change_id);assert(consumed?.consumed===true&&consumed.receipt_sha256===r.rollback.forward_receipt.sha256&&r.change_id!==forward.change_id&&journal.terminal===true&&journal.receiptSha256===consumed.receipt_sha256&&journal.source===forward.source_commit,'forward receipt must stay consumed/terminal');
 same(prior.target,r.target);same(forward.target,r.target);assert(prior.source_commit===r.rollback.restore_source&&forward.base_deployment===r.rollback.restore_deployment,'exact restore anchor required');same(prior.preview.artifact_digest,r.rollback.restore_artifact);same(prior.isolated.packed_worker_sha256,r.rollback.restore_pack);same(prior.isolated.config,r.rollback.restore_config);
 const mode=!!forward.isolated.sample_mode;
 assert([!!forward.isolated.single_diagnostic,!!forward.isolated.inert_candidate,mode].filter(Boolean).length===1,'only one reviewed isolated forward may roll back');
 assert(r.intent===(mode?'rollback_isolated_sample_mode':'rollback_isolated_diagnostic'),'rollback intent differs');
 const priorPin=(forward.isolated.single_diagnostic||forward.isolated.inert_candidate||forward.isolated.sample_mode).prior_receipt;same(priorPin,r.rollback.restore_receipt,'restore must be the forward predecessor');
 const historical=registry.approved_releases.find(x=>x.change_id===prior.change_id);assert(historical?.consumed===true&&historical.receipt_sha256===r.rollback.restore_receipt.sha256,'restore authority changed');
 const diagnostic=!!forward.isolated.single_diagnostic,configOnly=r.rollback.configuration_only===true;
 if(mode){const pin=JSON.parse(forward.isolated.config.env_vars.YW_E2E_AUTHORITY_JSON.value);validateModeProof(forward,{sha256:forward.preview.artifact_digest},Date.parse(pin.notBefore));}
 else if(diagnostic){const base=structuredClone(forward.isolated.config);delete base.env_vars.YW_SINGLE_DIAGNOSTIC_JSON;same(base,prior.isolated.config,'only one diagnostic setting may differ');}
 else same(forward.isolated.config,prior.isolated.config,'inert rollback config changed');
 const deploys=journal.requests.filter(x=>x.id==='deploy');
 if(configOnly){assert((diagnostic||mode)&&deploys.length===0&&journal.requests.some(x=>x.id==='config'&&x.method==='PATCH'),'configuration-only restore requires a config attempt and no deploy');assert(r.base_deployment===r.rollback.restore_deployment,'configuration-only live anchor differs');}
 else{const handle=load(r.rollback.deployment_handle);assert(deploys.length===1&&handle.source===forward.source_commit&&handle.id===r.base_deployment&&/^[a-f0-9-]{36}$/.test(handle.id),'exact forward deployment handle required');}
 assert(r.rollback.restore_configuration===(diagnostic||mode)&&r.http_budget?.max_requests===((diagnostic||mode)?13:12)&&r.http_budget.shared_configuration_max===((diagnostic||mode)?3:2),'exact rollback request/class cap required');
 same(r.preservation,forward.isolated.formal?{formal:forward.isolated.formal,apis:forward.isolated.apis}:null,'preservation pins differ');
 for(const id of ['ai-bdfz-net','apis-bdfz-net']){const p=registry.projects.find(p=>p.project_id===id);assert(p?.state==='accepted');same([p.accepted.version_id,p.accepted.source_commit],[r.preservation.apis.version,r.preservation.apis.source_commit],'APIS source changed');}
 return {project,approval,forward,prior};
}
export function registerRollbackCopy(registry,r,context,options){
 const copy=structuredClone(registry),p=copy.projects.find(p=>p.project_id===FIXED.projectId);assert(p,'target missing');assert(!copy.approved_releases.some(x=>x.change_id===r.change_id),'rollback identity already used');
 p.staged_manual_channel={identity:r.change_id,status:'prepared_unconsumed',publisher:import.meta.filename,publisher_sha256:context.publisherHash,receipt_path:r.receipt_path,source_commit:r.source_commit,baseline_deployment:r.base_deployment,expires_at:r.expires_at};copy.approved_releases.push({change_id:r.change_id,project_id:FIXED.projectId,consumed:false,receipt_sha256:context.receiptHash});validateRollbackRegistration(copy,r,context,options);return copy;
}
export async function transactRollback(r,{call,save=()=>{},beforeWrite=()=>{}}){
 const current=await call('target-before','GET',PROJECT);assert(current.name===FIXED.project&&current.production_branch==='acceptance');same(current.canonical_deployment?.id,r.base_deployment,'forward handle drift');same(sha(projection(current)),r.base_config_digest,'rollback baseline drift');
 const restore=await call('restore-deployment','GET',PROJECT+'/deployments/'+r.rollback.restore_deployment);same(restore.id,r.rollback.restore_deployment);same(restore.deployment_trigger?.metadata?.commit_hash,r.rollback.restore_source,'restore source drift');
 const preserve=async suffix=>{
  const formal=await call('formal-'+suffix,'GET',FORMAL);same({deployment:formal.canonical_deployment?.id,source:formal.canonical_deployment?.deployment_trigger?.metadata?.commit_hash,config_digest:sha(projection(formal))},r.preservation.formal,'formal drift');
  const apis=r.preservation.apis;const dep=await call('apis-'+suffix,'GET',BASE+'/workers/scripts/apis/deployments');same(sha(dep),apis.deployments_digest);same(dep.deployments?.[0]?.versions,[{version_id:apis.version,percentage:100}]);same(sha(await call('apis-settings-'+suffix,'GET',BASE+'/workers/scripts/apis/settings')),apis.settings_digest);same(sha(await call('apis-cron-'+suffix,'GET',BASE+'/workers/scripts/apis/schedules')),apis.cron_digest);
 };
 await preserve('before');
 let rollbackUncertain=false,configUncertain=false;
 if(!r.rollback.configuration_only){await beforeWrite();try{await call('rollback','POST',PROJECT+'/deployments/'+r.rollback.restore_deployment+'/rollback');}catch{rollbackUncertain=true;}}
 // Once a write is uncertain, do not issue a different write until same-target
 // readback has resolved it. The ordinary target-after slot is used, not a replay.
 if(rollbackUncertain){const after=await call('target-after','GET',PROJECT);save('uncertain-rollback-readback',{deployment:after.canonical_deployment?.id,configDigest:sha(projection(after))});throw Error('rollback_write_uncertain_reconcile_only');}
 if(r.rollback.restore_configuration){await beforeWrite();try{const patch=rollbackConfigurationPatch(r.rollback.restore_config);await call('config-restore','PATCH',PROJECT,{deployment_configs:{production:patch,preview:patch}});}catch{configUncertain=true;}}
 const after=await call('target-after','GET',PROJECT);same(after.canonical_deployment?.id,r.rollback.restore_deployment,'rollback not confirmed');for(const scope of ['production','preview'])same(normalizedConfig(after.deployment_configs?.[scope]),r.rollback.restore_config,'restored config differs');
 await preserve('after');return {status:'isolated_rollback_readback_confirmed',deployment:r.rollback.restore_deployment,source:r.rollback.restore_source,formalPreserved:true,apisPreserved:true,configWriteTransportUncertain:configUncertain,configRestoredByReadback:true,accepted:false};
}
export async function executeRollback(receiptPath){
 assert.equal(process.versions.node,'24.18.0');assert(path.isAbsolute(receiptPath)&&!fs.lstatSync(receiptPath).isSymbolicLink());
 for(const key of ['NODE_OPTIONS','CLOUDFLARE_API_BASE_URL','CF_API_BASE_URL','HTTPS_PROXY','HTTP_PROXY','ALL_PROXY','https_proxy','http_proxy','all_proxy'])assert(!process.env[key],'unsupported transport environment');
 const bytes=fs.readFileSync(receiptPath),r=JSON.parse(bytes),source=path.resolve(import.meta.dirname,'..');assert(r.receipt_path===receiptPath);
 const git=(...args)=>execFileSync('git',args,{cwd:source,encoding:'utf8',timeout:15000}).trim();
 const {withPublisherLock}=await import('/Users/ylsuen/CF/scripts/pages-native-recovery.mjs');
 return withPublisherLock(FIXED.registry,r.change_id,async original=>{
  const registry=JSON.parse(original),context={receiptHash:sha(bytes),publisherHash:sha(fs.readFileSync(import.meta.filename)),catalogHash:sha(fs.readFileSync('/Users/ylsuen/CF/platform/projects.json')),head:git('rev-parse','HEAD'),remoteHead:r.source_commit,dirty:git('status','--porcelain'),repository:FIXED.repository,now:Date.now()};
  const {project,approval}=validateRollbackRegistration(registry,r,context);same(git('ls-remote',FIXED.repository+'.git',r.source_ref),r.source_commit+'\t'+r.source_ref,'remote source differs');
  const journalPath=receiptPath+'.journal.json';assert(!fs.existsSync(journalPath),'rollback cannot replay');const secrets=parseEnv(fs.readFileSync('/Users/ylsuen/.secrets.env','utf8')),token=secrets.CLOUDFLARE_API_TOKEN||secrets.CF_API_TOKEN;assert(token);
  const state={startedAt:new Date().toISOString(),receiptSha256:sha(bytes),source:r.source_commit,requests:[],terminal:false};write(journalPath,state,true);assert(fs.readFileSync(FIXED.registry).equals(original)&&fs.readFileSync(receiptPath).equals(bytes));approval.consumed=true;approval.attempted_at=state.startedAt;project.staged_manual_channel.status='consumed_rollback_attempting';write(FIXED.registry,registry);
  const call=async(id,method,url,body)=>{
   assert(!state.terminal&&!state.requests.some(x=>x.id===id)&&state.requests.length<r.http_budget.max_requests&&Date.now()<Date.parse(r.expires_at)&&Date.now()-Date.parse(state.startedAt)<900000,'rollback budget/deadline/duplicate');
   const gets=[PROJECT,FORMAL,PROJECT+'/deployments/'+r.rollback.restore_deployment,...['deployments','settings','schedules'].map(x=>BASE+'/workers/scripts/apis/'+x)];
   assert(method==='GET'&&gets.includes(url)||method==='POST'&&id==='rollback'&&!r.rollback.configuration_only&&url===PROJECT+'/deployments/'+r.rollback.restore_deployment+'/rollback'||method==='PATCH'&&id==='config-restore'&&r.rollback.restore_configuration&&url===PROJECT,'outside rollback allowlist');
   const entry={id,method,url,at:new Date().toISOString(),complete:false};state.requests.push(entry);write(journalPath,state);
   try{const response=await fetch('https://api.cloudflare.com/client/v4'+url,{method,headers:{Authorization:'Bearer '+token,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(Math.min(method==='GET'?15000:120000,Math.min(Date.parse(r.expires_at),Date.parse(state.startedAt)+900000)-Date.now()))});const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;assert(size<=8*1024*1024,'bounded rollback response');chunks.push(chunk);}const result=JSON.parse(Buffer.concat(chunks));entry.complete=true;entry.status=response.status;write(journalPath,state);assert(response.ok&&result.success,'rollback provider refused');return result.result;}catch(error){entry.outcome=method==='GET'?'read_unconfirmed':'write_unknown_no_replay';write(journalPath,state);throw Error(entry.outcome);}
  };
  try{const result=await transactRollback(r,{call,beforeWrite:()=>{same(git('rev-parse','HEAD'),r.source_commit);same(git('status','--porcelain'),'');assert(fs.readFileSync(receiptPath).equals(bytes)&&sha(fs.readFileSync(import.meta.filename))===context.publisherHash,'rollback source/receipt drift');},save:(name,value)=>write(path.join(path.dirname(receiptPath),name+'.json'),value,true)});write(receiptPath+'.result.json',result,true);Object.assign(project.staged_manual_channel,{status:'consumed_rollback_confirmed',observed_deployment:result.deployment,observed_source:result.source});write(FIXED.registry,registry);return result;}finally{state.terminal=true;write(journalPath,state);}
 });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){try{assert(process.argv[2]==='--execute-once'&&process.argv.length===4);console.log(JSON.stringify(await executeRollback(process.argv[3])));}catch{console.error('Controlled isolated rollback stopped; preserve receipt/journal and reconcile exact target. No replay.');process.exitCode=1;}}
