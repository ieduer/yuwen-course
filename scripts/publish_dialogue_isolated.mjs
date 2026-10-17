// Project-specific implementation of the EXISTING managed_manual/schema-v1
// staged channel. Local preparation never registers or enables a publisher.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {parseEnv} from 'node:util';
import {pathToFileURL} from 'node:url';
import {acceptanceEnvironment} from '../site/dialogue-acceptance.js';
import {fullActivation} from '../site/dialogue-full-language.js';
import {isolatedDialogueAdmission,E2E_LESSONS} from '../site/dialogue-e2e-admission.js';
import packet from '../site/dialogue-full-language-packet.json' with {type:'json'};
import {prepareRenewedPlan} from './dialogue_e2e_renewal.mjs';
export const FIXED=Object.freeze({projectId:'yw-dialogue-isolated-acceptance',account:'da810f08b63347a01d3db7fd42619972',project:'yuwen-course-dialogue-acceptance',origin:'https://yw-acceptance.bdfz.net',database:'c45988a6-9094-4306-bcce-98704b3989e3',repository:'https://github.com/ieduer/yuwen-course',registry:'/Users/ylsuen/CF/platform/release-authority.json'});
const sha=b=>createHash('sha256').update(b).digest('hex'),digest=x=>sha(JSON.stringify(x)),same=(a,b,m)=>assert.deepEqual(a,b,m),read=p=>JSON.parse(fs.readFileSync(p));
const BASE=`/accounts/${FIXED.account}`,PROJECT=BASE+'/pages/projects/'+FIXED.project,FORMAL=BASE+'/pages/projects/yuwen-course';
const MIME={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.gif':'image/gif','.woff2':'font/woff2','.pdf':'application/pdf','.txt':'text/plain'};
const timestamp=()=>new Date().toISOString();
function write(file,value,exclusive=false){const fd=fs.openSync(file,exclusive?'wx':'w',0o600);try{fs.writeFileSync(fd,JSON.stringify(value,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
export function inventory(root){
 assert(path.isAbsolute(root)&&!fs.lstatSync(root).isSymbolicLink(),'exact artifact directory required');const files=[];
 function visit(dir,prefix=''){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const rel=prefix+entry.name,full=path.join(dir,entry.name);assert(!entry.isSymbolicLink()&&/^[\w./@%-]+$/.test(rel)&&!rel.split('/').some(x=>x==='..'||x.startsWith('.')),'unsupported artifact path');if(entry.isDirectory())visit(full,rel+'/');else{assert(entry.isFile());const b=fs.readFileSync(full);assert(b.length<=25*1024*1024);files.push({path:rel,bytes:b.length,sha256:sha(b)});}}}
 visit(root);files.sort((a,b)=>a.path.localeCompare(b.path,'en'));assert(files.length>189&&files.length<=2000&&files.reduce((n,f)=>n+f.bytes,0)<=256*1024*1024,'bounded all189 artifact required');
 assert(files.some(f=>f.path==='_worker.js/index.js')&&!files.some(f=>f.path==='dialogue-full-language-packet.json'),'private module directory required');
 const entry=fs.readFileSync(path.join(root,'_worker.js/index.js'),'utf8');assert(entry.includes('createAcceptanceWorker'),'restricted entrypoint required');
 const ids=read(path.join(root,'dialogue-curriculum/index.json')).lessons.map(l=>l.lessonId).sort();same(files.filter(f=>/^dialogue-curriculum\/lesson-[\w-]+\.json$/.test(f.path)).map(f=>path.basename(f.path,'.json')).sort(),ids);assert.equal(ids.length,189);
 const blake=createRequire(import.meta.url)('blake3-wasm');
 const assets=files.filter(f=>!f.path.startsWith('_worker.js/')&&!['_headers','_redirects','_routes.json'].includes(f.path)).map(f=>({...f,key:blake.hash(fs.readFileSync(path.join(root,f.path)).toString('base64')+path.extname(f.path).slice(1)).toString('hex').slice(0,32),contentType:MIME[path.extname(f.path)]||'application/octet-stream'}));
 return {files,assets,sha256:sha(files.map(f=>`${f.sha256}  ${f.path}\n`).join('')),totalBytes:files.reduce((n,f)=>n+f.bytes,0)};
}
export function validateConfiguration(config,now=Date.now()){
 same(Object.keys(config).sort(),['compatibility_date','compatibility_flags','d1_databases','env_vars','fail_open','services'],'unexpected configuration capabilities');
 same(config.d1_databases,{ACCEPTANCE_DB:{id:FIXED.database}},'isolated D1 only');assert.equal(config.fail_open,false);assert(/^\d{4}-\d{2}-\d{2}$/.test(config.compatibility_date));same(config.compatibility_flags,[]);
 same(config.services,{USER_CENTER_EVIDENCE:{service:'bdfz-user-center',environment:'production',entrypoint:'YuwenEvidenceIdentity'},APIS_ACCEPTANCE:{service:'apis',environment:'production',entrypoint:'YwDialogueAcceptance20261012'}},'existing identity/APIS service only');
 const allowed=['YW_ACCEPTANCE_USER_ID','YW_ACCEPTANCE_EXPIRES_AT','YW_ACCEPTANCE_DATABASE_ID','YW_ACCEPTANCE_APIS_VERSION','YW_ACCEPTANCE_ACTIVATION_SHA256','YW_DIALOGUE_BUDGET_JSON','YW_DIALOGUE_PROVIDER_ATTEMPTS','YW_CALIBRATION_FULL_LANGUAGE_JSON','YW_FULL_LANGUAGE_ACTIVATION_SHA256','YW_E2E_AUTHORITY_JSON'];same(Object.keys(config.env_vars).sort(),allowed.sort(),'activation variables differ');
 const vars={};for(const [k,v]of Object.entries(config.env_vars)){same(Object.keys(v).sort(),['type','value']);assert(v.type==='plain_text'&&typeof v.value==='string');vars[k]=v.value;}
 const noIO=()=>{throw Error('configuration_check_has_no_io');};const env=acceptanceEnvironment(new Request(FIXED.origin),{...vars,ASSETS:{fetch:noIO},ACCEPTANCE_DB:{prepare:noIO},APIS_ACCEPTANCE:{fetch:noIO},USER_CENTER_EVIDENCE:{resolveSession:noIO}},now),full=fullActivation(env,packet,now);assert(full,'approved current full activation required');
 const budget=JSON.parse(vars.YW_DIALOGUE_BUDGET_JSON);assert(budget.model==='gemini-3.8-flash'&&budget.reserveMicros===84000&&budget.globalDailyMicros<=50000000&&budget.userDailyMicros<=50000000&&vars.YW_DIALOGUE_PROVIDER_ATTEMPTS==='3','fixed model/budget required');
 assert(budget.currency==='USD'&&/^[-\w.]{1,80}$/.test(budget.version||'')&&Date.parse(budget.validUntil)>=Date.parse(full.hardExpiry),'price policy must cover approved window');
 for(const key of ['globalDailyMicros','userDailyMicros','lessonLifetimeMicros','inputMicrosPerMillion','outputMicrosPerMillion'])assert(Number.isSafeInteger(budget[key])&&budget[key]>0&&budget[key]<=1000000000000,'invalid budget value');
 const reserve=Number((100000n*BigInt(budget.inputMicrosPerMillion)+2400n*BigInt(budget.outputMicrosPerMillion)+999999n)/1000000n);assert(reserve<=84000&&Math.min(budget.globalDailyMicros,budget.userDailyMicros,budget.lessonLifetimeMicros)>=252000,'price or capacity exceeds bound');
 for(const id of E2E_LESSONS)isolatedDialogueAdmission(env,{ucUserId:553},id,{...budget,logicalProviderAttemptLimit:3,perAttemptReserveMicros:84000,reserveMicros:252000},now);
 return full;
}
export function packWorker(root,inv,config){
 const metadata={main_module:'index.js',compatibility_date:config.compatibility_date,compatibility_flags:config.compatibility_flags,bindings:[{type:'d1',name:'ACCEPTANCE_DB',id:FIXED.database},...Object.entries(config.services).map(([name,v])=>({type:'service',name,...v})),...Object.entries(config.env_vars).map(([name,v])=>({type:v.type,name,text:v.value}))]};
 const boundary='yw-'+digest({files:inv.files,metadata}).slice(0,48),chunks=[];
 function part(name,type,b,file=false){chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"${file?`; filename="${name}"`:''}\r\nContent-Type: ${type}\r\n\r\n`),b,Buffer.from('\r\n'));}
 part('metadata','application/json',Buffer.from(JSON.stringify(metadata)));
 for(const f of inv.files.filter(f=>f.path.startsWith('_worker.js/'))){const name=f.path.slice(11);assert(name.endsWith('.js'),'review new Worker module type before packing');const b=fs.readFileSync(path.join(root,f.path));same(sha(b),f.sha256,'module changed');part(name,'application/javascript+module',b,true);}
 chunks.push(Buffer.from(`--${boundary}--\r\n`));return Buffer.concat(chunks);
}
export function validateRegistration(registry,receipt,{receiptHash,publisherHash,catalogHash,head,dirty,remoteHead,repository,artifact,now=Date.now()}){
 assert(registry.schema_version===1&&registry.default_policy==='deny'&&registry.catalog_sha256===catalogHash,'registry/catalog changed');
 const p=registry.projects.find(p=>p.project_id===FIXED.projectId),a=registry.approved_releases.find(a=>a.change_id===receipt.change_id),ch=p?.staged_manual_channel;
 assert(p?.state==='isolated_unaccepted'&&p.mode==='managed_manual'&&p.repository===FIXED.repository,'registered isolated target required');
 same(receipt.target,{account:FIXED.account,resource:FIXED.project,environment:'isolated-acceptance',domains:['yw-acceptance.bdfz.net']});same(receipt.target,p.target);
 assert(receipt.schema_version===1&&receipt.phase==='preview_verified'&&receipt.authorized_task&&receipt.intent&&receipt.project_id===FIXED.projectId,'existing schema-v1 receipt required');
 assert(a?.project_id===FIXED.projectId&&a.consumed===false&&a.receipt_sha256===receiptHash&&ch?.identity===receipt.change_id&&ch.status==='prepared_unconsumed'&&ch.publisher_sha256===publisherHash,'unregistered or terminal channel');
 assert(ch.publisher===import.meta.filename&&ch.receipt_path===receipt.receipt_path&&ch.source_commit===receipt.source_commit&&ch.baseline_deployment===receipt.base_deployment,'registered publisher/source/baseline differs');
 assert(Date.parse(receipt.expires_at)>now&&Date.parse(receipt.expires_at)-now<=3600000&&ch.expires_at===receipt.expires_at,'expired or overlong release lease');
 assert(/^[a-f0-9]{40}$/.test(head)&&head===receipt.source_commit&&remoteHead===head&&repository===FIXED.repository&&!dirty,'exact clean pushed source required');
 same(artifact.files,receipt.artifact_files,'artifact changed');same(artifact.sha256,receipt.preview.artifact_digest,'artifact digest differs');
 assert(receipt.tests?.source_commit===head&&receipt.tests.evidence_path&&receipt.tests.evidence_sha256===sha(fs.readFileSync(receipt.tests.evidence_path)),'exact test evidence required');
 assert(receipt.preview.source_commit===head&&receipt.preview.evidence_path&&receipt.preview.evidence_sha256===sha(fs.readFileSync(receipt.preview.evidence_path)),'local artifact evidence required');
 const full=validateConfiguration(receipt.isolated.config,now);assert(full.apisVersion===receipt.isolated.apis.version,'APIS activation differs');
 if(full.sourceCommit===receipt.source_commit)same(full.artifactSha256,artifact.sha256,'calibration artifact not bound');
 else{const report=read(receipt.isolated.calibration_overlay?.path);assert(receipt.isolated.calibration_overlay.sha256===sha(fs.readFileSync(receipt.isolated.calibration_overlay.path)),'overlay evidence changed');same([report.sourceCommit,report.artifactSha256],[full.sourceCommit,full.artifactSha256],'consumed calibration source changed');}
 assert(receipt.isolated.apis.ownership_reference&&receipt.isolated.apis.source_commit&&receipt.isolated.apis.settings_digest&&receipt.isolated.apis.deployments_digest&&receipt.isolated.apis.cron_digest,'current APIS owner/source/readback required');
 for(const id of ['ai-bdfz-net','apis-bdfz-net']){const a=registry.projects.find(p=>p.project_id===id);assert(a?.state==='accepted','APIS not accepted');same([a.accepted.version_id,a.accepted.source_commit],[receipt.isolated.apis.version,receipt.isolated.apis.source_commit],'APIS accepted source changed');}
 assert(receipt.isolated.apis.ownership_evidence_path&&receipt.isolated.apis.ownership_evidence_sha256===sha(fs.readFileSync(receipt.isolated.apis.ownership_evidence_path)),'APIS ownership evidence missing');
 return {project:p,approval:a};
}
function projection(p){return {name:p.name,production_branch:p.production_branch,deployment_configs:p.deployment_configs,domains:[...(p.domains||[])].sort()};}
function assertProviderConfiguration(actual,expected){
 for(const [key,value]of Object.entries(expected))same(actual?.[key],value,'isolated configuration readback failed');
 const metadata=new Set(['always_use_latest_compatibility_date','usage_model','placement','build_image_major_version','limits']);
 for(const [key,value]of Object.entries(actual||{}))if(!(key in expected)&&!metadata.has(key))assert(value==null||value===false||typeof value==='object'&&Object.keys(value).length===0,'unexpected isolated binding: '+key);
}
function checkBaseline(receipt,p){assert(p.name===FIXED.project&&p.production_branch==='acceptance','wrong Pages target/branch');same(p.canonical_deployment?.id,receipt.base_deployment,'live deployment drift');same(digest(projection(p)),receipt.base_config_digest,'live configuration drift');assert(p.domains.includes('yw-acceptance.bdfz.net'),'domain not attached');}
export async function transact(receipt,{call,artifact,packed,readAsset,save,beforeDeploy=()=>{},delay=ms=>new Promise(r=>setTimeout(r,ms))}){
 const i=receipt.isolated,p=await call('baseline','GET',PROJECT);checkBaseline(receipt,p);
 const domains=await call('domains','GET',PROJECT+'/domains');assert(domains.some(d=>d.name==='yw-acceptance.bdfz.net'&&d.status==='active'),'isolated domain not active');
 const preserve=async suffix=>{
  const formal=await call('formal'+suffix,'GET',FORMAL);same({deployment:formal.canonical_deployment?.id,source:formal.canonical_deployment?.deployment_trigger?.metadata?.commit_hash,config_digest:digest(projection(formal))},i.formal,'formal site changed');
  const live=await call('apis'+suffix,'GET',BASE+'/workers/scripts/apis/deployments');same(digest(live),i.apis.deployments_digest,'APIS deployments changed');same(live.deployments?.[0]?.versions,[{version_id:i.apis.version,percentage:100}],'APIS active baseline differs');
  same(digest(await call('apis-settings'+suffix,'GET',BASE+'/workers/scripts/apis/settings')),i.apis.settings_digest,'APIS code/config baseline changed');
  same(digest(await call('apis-cron'+suffix,'GET',BASE+'/workers/scripts/apis/schedules')),i.apis.cron_digest,'APIS cron changed');
 };
 await preserve('-before');
 const configured=await call('config','PATCH',PROJECT,{deployment_configs:{production:i.config,preview:i.config}});
 for(const scope of ['production','preview'])assertProviderConfiguration(configured.deployment_configs?.[scope],i.config);
 const {jwt}=await call('upload-token','GET',PROJECT+'/upload-token');assert(typeof jwt==='string'&&jwt.length>20,'upload credential unavailable');
 const assets=new Map(artifact.assets.map(f=>[f.key,f])),keys=[...assets.keys()];
 const missing=await call('missing','POST','/pages/assets/check-missing',{hashes:keys},jwt);assert(Array.isArray(missing)&&new Set(missing).size===missing.length&&missing.every(k=>assets.has(k)),'unknown missing asset');
 let batch=[],size=0,n=0;
 async function flush(){if(!batch.length)return;await call('upload-'+n++,'POST','/pages/assets/upload',batch,jwt);batch=[];size=0;}
 for(const key of missing){const f=assets.get(key),b=readAsset(f.path);same(sha(b),f.sha256,'asset changed');const row={key,value:b.toString('base64'),metadata:{contentType:f.contentType},base64:true};const bytes=Buffer.byteLength(JSON.stringify(row));if(size+bytes>10*1024*1024)await flush();batch.push(row);size+=bytes;}await flush();
 if(missing.length)await call('upsert','POST','/pages/assets/upsert-hashes',{hashes:missing},jwt);
 same(await call('missing-after','POST','/pages/assets/check-missing',{hashes:keys},jwt),[],'assets not stored');
 // Repeat source-preserving dependencies immediately before the sole deploy.
 await preserve('-predeploy');
 const current=await call('target-predeploy','GET',PROJECT);same(current.canonical_deployment?.id,receipt.base_deployment,'isolated live changed during upload');same(projection(current),projection(configured),'isolated config drift during upload');await beforeDeploy();
 const form=new FormData();form.set('manifest',JSON.stringify(Object.fromEntries(artifact.assets.map(f=>['/'+f.path,f.key]))));form.set('branch','acceptance');form.set('commit_hash',receipt.source_commit);form.set('commit_dirty','false');form.set('_worker.bundle',new Blob([packed]),'_worker.bundle');
 for(const name of ['_headers','_redirects','_routes.json'])if(artifact.files.some(f=>f.path===name))form.set(name,new Blob([readAsset(name)]),name);
 const d=await call('deploy','POST',PROJECT+'/deployments',form);assert(/^[a-f0-9-]{36}$/.test(d.id),'uncertain deployment handle');save('deployment-handle.json',{id:d.id,source:receipt.source_commit});
 let checked;for(let n=0;n<3;n++){checked=await call('deployment-'+n,'GET',PROJECT+'/deployments/'+d.id);same(checked.deployment_trigger?.metadata?.commit_hash,receipt.source_commit);if(checked.latest_stage?.status==='success')break;assert(['queued','pending','active'].includes(checked.latest_stage?.status),'terminal platform compile failure');if(n<2)await delay(3000);}
 assert(checked.latest_stage?.status==='success','pending exact deployment: reconcile only, do not replay');
 const after=await call('after','GET',PROJECT);same(after.canonical_deployment?.id,d.id);for(const scope of ['production','preview'])assertProviderConfiguration(after.deployment_configs?.[scope],i.config);
 await preserve('-after');return {at:timestamp(),source:receipt.source_commit,artifact:artifact.sha256,deployment:d.id,accepted:false,status:'isolated_deployed_real_acceptance_pending',formalPreserved:true,apisPreserved:true};
}

export async function execute(receiptPath){
 assert.equal(process.versions.node,'24.18.0','pinned local transport runtime required');
 assert(path.isAbsolute(receiptPath)&&!fs.lstatSync(receiptPath).isSymbolicLink());const bytes=fs.readFileSync(receiptPath),receipt=JSON.parse(bytes),root=path.resolve(import.meta.dirname,'..');
 assert(receipt.receipt_path===receiptPath&&path.isAbsolute(receipt.artifact_root)&&path.isAbsolute(receipt.isolated.packed_worker_path));
 for(const k of ['NODE_OPTIONS','CLOUDFLARE_API_BASE_URL','CF_API_BASE_URL','HTTPS_PROXY','HTTP_PROXY','ALL_PROXY','https_proxy','http_proxy','all_proxy'])assert(!process.env[k],'unsupported publisher environment');
 const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:15000}).trim();
 const artifact=inventory(receipt.artifact_root),packed=fs.readFileSync(receipt.isolated.packed_worker_path);same(sha(packed),receipt.isolated.packed_worker_sha256);same(packed,packWorker(receipt.artifact_root,artifact,receipt.isolated.config),'packed source/config drift');
 const activation=JSON.parse(receipt.isolated.config.env_vars.YW_CALIBRATION_FULL_LANGUAGE_JSON.value);
 if(activation.sourceCommit!==receipt.source_commit){same(path.resolve(receipt.isolated.calibration_overlay.path),path.join(root,'scripts/dialogue-calibration-overlay.json'),'reviewed source overlay required');await prepareRenewedPlan(read(receipt.isolated.calibration_overlay.path));}
 const remote=git('ls-remote',FIXED.repository+'.git',receipt.source_ref);same(remote,receipt.source_commit+'\t'+receipt.source_ref);
 const {withPublisherLock}=await import('/Users/ylsuen/CF/scripts/pages-native-recovery.mjs');
 return withPublisherLock(FIXED.registry,receipt.change_id,async before=>{
  const registry=JSON.parse(before),context={receiptHash:sha(bytes),publisherHash:sha(fs.readFileSync(import.meta.filename)),catalogHash:sha(fs.readFileSync('/Users/ylsuen/CF/platform/projects.json')),head:git('rev-parse','HEAD'),dirty:git('status','--porcelain'),remoteHead:receipt.source_commit,repository:FIXED.repository,artifact};
  const {project,approval}=validateRegistration(registry,receipt,context);git('merge-base','--is-ancestor',project.staged_manual_channel.baseline_source,receipt.source_commit);
  const secrets=parseEnv(fs.readFileSync('/Users/ylsuen/.secrets.env','utf8')),token=secrets.CLOUDFLARE_API_TOKEN||secrets.CF_API_TOKEN;assert(token,'provider credential unavailable');
  const journalPath=receiptPath+'.journal.json';assert(!fs.existsSync(journalPath),'existing operation cannot replay');
  const state={startedAt:timestamp(),source:receipt.source_commit,receiptSha256:sha(bytes),requests:[],requestBytes:0,responseBytes:0,terminal:false};write(journalPath,state,true);
  assert(fs.readFileSync(FIXED.registry).equals(before)&&fs.readFileSync(receiptPath).equals(bytes),'authority changed');
  approval.consumed=true;approval.attempted_at=timestamp();project.staged_manual_channel.status='consumed_attempting';write(FIXED.registry,registry);
  const call=async(id,method,url,body,uploadToken)=>{
   assert(!state.terminal&&!state.requests.some(r=>r.id===id)&&Date.now()<Date.parse(receipt.expires_at)&&Date.now()-Date.parse(state.startedAt)<900000&&state.requests.length<160,'terminal, duplicate, deadline or request ceiling');
   assert(method==='GET'&&(url===PROJECT||url===FORMAL||url===PROJECT+'/domains'||url===PROJECT+'/upload-token'||url===BASE+'/workers/scripts/apis/deployments'||url===BASE+'/workers/scripts/apis/settings'||url===BASE+'/workers/scripts/apis/schedules'||new RegExp('^'+PROJECT+'/deployments/[a-f0-9-]{36}$').test(url))||method==='PATCH'&&id==='config'&&url===PROJECT||method==='POST'&&(url===PROJECT+'/deployments'&&id==='deploy'||['/pages/assets/check-missing','/pages/assets/upload','/pages/assets/upsert-hashes'].includes(url)),'request outside isolated allowlist');
   const headers={Authorization:'Bearer '+(uploadToken||token)};let data;if(body instanceof FormData){const encoded=new Response(body);headers['content-type']=encoded.headers.get('content-type');data=Buffer.from(await encoded.arrayBuffer());}else if(body!==undefined){headers['content-type']='application/json';data=Buffer.from(JSON.stringify(body));}
   state.requestBytes+=data?.length||0;assert(state.requestBytes<=400*1024*1024,'request byte ceiling');state.requests.push({id,method,url,at:timestamp(),requestBytes:data?.length||0,complete:false});write(journalPath,state);
   const response=await fetch('https://api.cloudflare.com/client/v4'+url,{method,headers,body:data,redirect:'error',signal:AbortSignal.timeout(method==='GET'?15000:120000)});const chunks=[];let total=0;for await(const chunk of response.body){total+=chunk.length;state.responseBytes+=chunk.length;assert(total<=8*1024*1024&&state.responseBytes<=32*1024*1024,'response byte ceiling');chunks.push(chunk);}const result=JSON.parse(Buffer.concat(chunks));Object.assign(state.requests.at(-1),{status:response.status,responseBytes:total,complete:true});write(journalPath,state);assert(response.ok&&result.success,'provider request failed or uncertain; no replay');return result.result;
  };
  try{const result=await transact(receipt,{call,artifact,packed,beforeDeploy:()=>{same(git('rev-parse','HEAD'),receipt.source_commit);same(git('status','--porcelain'),'');same(git('ls-remote',FIXED.repository+'.git',receipt.source_ref),remote);same(inventory(receipt.artifact_root).files,artifact.files);assert(fs.readFileSync(receiptPath).equals(bytes),'receipt changed');},readAsset:p=>fs.readFileSync(path.join(receipt.artifact_root,p)),save:(n,v)=>write(path.join(path.dirname(receiptPath),n),v,true)});write(receiptPath+'.result.json',result,true);Object.assign(project.staged_manual_channel,{status:'consumed_deployed_acceptance_pending',observed_source:result.source,observed_deployment:result.deployment});write(FIXED.registry,registry);return result;}
  finally{state.terminal=true;write(journalPath,state);}
 });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{assert(process.argv[2]==='--execute-once'&&process.argv.length===4,'registered schema-v1 receipt required');console.log(JSON.stringify(await execute(process.argv[3])));}
 catch{console.error('Isolated publisher stopped. Preserve the exact receipt/journal and reconcile its target; no automatic retry or production acceptance.');process.exitCode=1;}
}
