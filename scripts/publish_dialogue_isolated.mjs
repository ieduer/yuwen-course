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
import {MODE_OPERATION,MODE_LESSONS,modeDialogueAdmission,modeLedgerProjection} from '../site/dialogue-mode-admission.js';
import {dialogueBudget} from '../site/dialogue-budget.js';
import syntheticFixture from '../site/dialogue-synthetic-diagnostic-fixture.json' with {type:'json'};
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
 same(config.services,{USER_CENTER_EVIDENCE:{service:'bdfz-user-center',environment:'production',entrypoint:'YuwenEvidenceIdentity'},APIS:{service:'apis',environment:'production'}},'existing identity/APIS service only');
 const allowed=['APIS_CALLER_TOKEN','YW_ACCEPTANCE_USER_ID','YW_ACCEPTANCE_EXPIRES_AT','YW_ACCEPTANCE_DATABASE_ID','YW_FORMAL_APIS_VERSION','YW_ACCEPTANCE_ACTIVATION_SHA256','YW_DIALOGUE_BUDGET_JSON','YW_DIALOGUE_PROVIDER_ATTEMPTS','YW_CALIBRATION_FULL_LANGUAGE_JSON','YW_FULL_LANGUAGE_ACTIVATION_SHA256','YW_E2E_AUTHORITY_JSON'];same(Object.keys(config.env_vars).sort(),allowed.sort(),'activation variables differ');
 const vars={};for(const [k,v]of Object.entries(config.env_vars)){if(k==='APIS_CALLER_TOKEN'){same(v,{type:'secret_text'},'caller must be an inherited secret, never a receipt value');vars[k]='offline-validation-only';continue;}same(Object.keys(v).sort(),['type','value']);assert(v.type==='plain_text'&&typeof v.value==='string');vars[k]=v.value;}
 const noIO=()=>{throw Error('configuration_check_has_no_io');};const env=acceptanceEnvironment(new Request(FIXED.origin),{...vars,ASSETS:{fetch:noIO},ACCEPTANCE_DB:{prepare:noIO},APIS:{fetch:noIO},USER_CENTER_EVIDENCE:{resolveSession:noIO}},now),full=fullActivation(env,packet,now);assert(full,'approved current full activation required');
 const budget=JSON.parse(vars.YW_DIALOGUE_BUDGET_JSON);assert(budget.model==='gemini-3.8-flash'&&budget.reserveMicros===84000&&budget.globalDailyMicros<=50000000&&budget.userDailyMicros<=50000000&&vars.YW_DIALOGUE_PROVIDER_ATTEMPTS==='3','fixed model/budget required');
 assert(budget.currency==='USD'&&/^[-\w.]{1,80}$/.test(budget.version||'')&&Date.parse(budget.validUntil)>=Date.parse(full.hardExpiry),'price policy must cover approved window');
 for(const key of ['globalDailyMicros','userDailyMicros','lessonLifetimeMicros','inputMicrosPerMillion','outputMicrosPerMillion'])assert(Number.isSafeInteger(budget[key])&&budget[key]>=(key.endsWith('MicrosPerMillion')?0:1)&&budget[key]<=1000000000000,'invalid budget value');
 const reserve=Number((100000n*BigInt(budget.inputMicrosPerMillion)+2400n*BigInt(budget.outputMicrosPerMillion)+999999n)/1000000n);assert(reserve<=84000&&Math.min(budget.globalDailyMicros,budget.userDailyMicros,budget.lessonLifetimeMicros)>=252000,'price or capacity exceeds bound');
 for(const id of E2E_LESSONS)isolatedDialogueAdmission(env,{ucUserId:553},id,{...budget,logicalProviderAttemptLimit:3,perAttemptReserveMicros:84000,reserveMicros:252000},now);
 return full;
}
// Separate opt-in branch; the legacy configuration validator above stays exact.
export function validateModeConfiguration(config,now=Date.now()){
 same(Object.keys(config).sort(),['compatibility_date','compatibility_flags','d1_databases','env_vars','fail_open','services'],'unexpected mode capabilities');
 same(config.d1_databases,{ACCEPTANCE_DB:{id:FIXED.database}});assert.equal(config.fail_open,false);assert(/^\d{4}-\d{2}-\d{2}$/.test(config.compatibility_date));same(config.compatibility_flags,[]);
 same(config.services,{USER_CENTER_EVIDENCE:{service:'bdfz-user-center',environment:'production',entrypoint:'YuwenEvidenceIdentity'},APIS:{service:'apis',environment:'production'}});
 const allowed=['APIS_CALLER_TOKEN','YW_ACCEPTANCE_USER_ID','YW_ACCEPTANCE_EXPIRES_AT','YW_ACCEPTANCE_DATABASE_ID','YW_FORMAL_APIS_VERSION','YW_ACCEPTANCE_ACTIVATION_SHA256','YW_DIALOGUE_BUDGET_JSON','YW_DIALOGUE_PROVIDER_ATTEMPTS','YW_E2E_AUTHORITY_JSON'];
 same(Object.keys(config.env_vars).sort(),allowed.sort(),'mode activation variables differ');
 const vars={};for(const [k,v]of Object.entries(config.env_vars)){if(k==='APIS_CALLER_TOKEN'){same(v,{type:'secret_text'});vars[k]='offline-validation-only';continue;}same(Object.keys(v).sort(),['type','value']);assert(v.type==='plain_text'&&typeof v.value==='string');vars[k]=v.value;}
 assert.equal(vars.YW_DIALOGUE_PROVIDER_ATTEMPTS,'1');const noIO=()=>{throw Error('configuration_check_has_no_io');};
 const env=acceptanceEnvironment(new Request(FIXED.origin),{...vars,ASSETS:{fetch:noIO},ACCEPTANCE_DB:{prepare:noIO},APIS:{fetch:noIO},USER_CENTER_EVIDENCE:{resolveSession:noIO}},now);
 const policy=JSON.parse(vars.YW_DIALOGUE_BUDGET_JSON),pin=JSON.parse(vars.YW_E2E_AUTHORITY_JSON);
 const checked=dialogueBudget(env,now);assert(Date.parse(policy.validUntil)>=Date.parse(pin.hardExpiry),'mode price window mismatch');
 const budget={...checked,validUntil:policy.validUntil,perAttemptReserveMicros:checked.reserveMicros,logicalProviderAttemptLimit:1,providerAttemptLimit:1};
 for(const id of MODE_LESSONS)modeDialogueAdmission(env,{ucUserId:553},id,budget,pin,now);
 return pin;
}
export function validateModeProof(receipt,artifact,now=Date.now()){
 const mode=receipt.isolated.sample_mode;assert(mode?.version==='yw-sampled-mode-publication-v1','explicit sampled-mode receipt required');
 assert(!receipt.isolated.inert_candidate&&!receipt.isolated.single_diagnostic&&!receipt.isolated.deploy_only&&!receipt.isolated.calibration_overlay,'mode cannot reuse another operation');
 const pin=validateModeConfiguration(receipt.isolated.config,now),bound=ref=>{assert(ref?.path&&ref.sha256===sha(fs.readFileSync(ref.path)),'mode approval evidence changed');return read(ref.path);};
 const authority=bound(mode.authorization),ledger=bound(mode.prior_ledger),prior=bound(mode.prior_receipt),providerProof=bound(mode.single_provider_source_proof);
 same(mode.single_provider_source_proof.sha256,pin.singleProviderSourceProofDigest,'mode provider proof digest differs');
 assert(providerProof.version==='yw-mode-single-provider-source-v1'&&providerProof.apisVersion===pin.apisVersion&&providerProof.apisSourceCommit===receipt.isolated.apis.source_commit&&providerProof.providerAttemptLimit===1&&providerProof.automaticRetry===false,'mode single-provider source proof differs');
 assert(Array.isArray(providerProof.evidence)&&providerProof.evidence.length>0,'mode source proof evidence required');for(const ref of providerProof.evidence)assert(ref?.path&&ref.sha256===sha(fs.readFileSync(ref.path)),'mode source proof evidence changed');
 same(prior.target,receipt.target,'mode restore target differs');assert(/^[a-f0-9]{40}$/.test(prior.source_commit||'')&&/^[a-f0-9]{64}$/.test(prior.preview?.artifact_digest||''),'mode restore source/artifact required');
 const priorEnv=prior.isolated?.config?.env_vars,priorActivation=JSON.parse(priorEnv?.YW_E2E_AUTHORITY_JSON?.value||'null');
 assert(priorActivation&&priorActivation.operation!==MODE_OPERATION&&Date.parse(priorEnv.YW_ACCEPTANCE_EXPIRES_AT.value)<=Date.parse(pin.notBefore)&&!priorEnv.YW_SINGLE_DIAGNOSTIC_JSON,'mode restore must keep the prior inactive baseline');
 assert(authority.status==='approved'&&authority.operation===MODE_OPERATION&&authority.version==='yw-mode-human-authorization-v1','fresh explicit mode authority required');
 const {authorityDigest,...approvedPin}=pin;
 same(authority.pin,approvedPin,'mode authority does not cover exact policy/source/window');same(authorityDigest,mode.authorization.sha256,'mode authority digest differs');
 same([pin.sourceCommit,pin.artifactSha256],[receipt.source_commit,artifact.sha256],'mode exact source/artifact required');
 assert(Date.parse(receipt.expires_at)<=Date.parse(pin.hardExpiry),'mode release exceeds dispatch window');
 assert(Array.isArray(ledger.rows)&&ledger.rows.length===pin.priorCallCount&&new Set(ledger.rows.map(r=>r.turn_id)).size===ledger.rows.length,'complete unique prior ledger required');
 same(digest(modeLedgerProjection(ledger.rows)),pin.priorLedgerDigest,'prior mode ledger differs');
 return pin;
}
export function packWorker(root,inv,config){
 const metadata={main_module:'index.js',compatibility_date:config.compatibility_date,compatibility_flags:config.compatibility_flags,bindings:[{type:'d1',name:'ACCEPTANCE_DB',id:FIXED.database},...Object.entries(config.services).map(([name,v])=>({type:'service',name,...v})),...Object.entries(config.env_vars).map(([name,v])=>v.type==='secret_text'?{type:'inherit',name}:{type:v.type,name,text:v.value})]};
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
 if(receipt.http_budget?.deploy_timeout_ms!==undefined)assert(receipt.http_budget.deploy_timeout_ms===300000,'bounded deployment transport override required');
 const inert=!!receipt.isolated.inert_candidate,single=!!receipt.isolated.single_diagnostic,mode=!!receipt.isolated.sample_mode;
 assert([inert,single,mode,!!receipt.isolated.deploy_only].filter(Boolean).length<=1,'conflicting isolated modes');
 const full=mode?validateModeProof(receipt,artifact,now):single?validateSingleDiagnosticConfiguration(receipt,now):inert?validateInertConfiguration(receipt,now):validateConfiguration(receipt.isolated.config,now);
 if(!inert&&!single)assert(full.apisVersion===receipt.isolated.apis.version,'APIS activation differs');
 if(mode){
  same(full.sourceCommit,receipt.source_commit,'mode source cannot use a calibration overlay');
  const ref=receipt.isolated.sample_mode.prior_receipt,prior=read(ref.path),old=registry.approved_releases.find(x=>x.change_id===prior.change_id);
  assert(old?.consumed===true&&old.receipt_sha256===ref.sha256&&prior.change_id!==receipt.change_id,'mode restore authority must remain consumed');
 }
 else if(single)validateSingleDiagnosticProof(receipt,registry,artifact,now);
 else if(inert)validateInertCandidateProof(receipt,registry,artifact,now);
 else if(receipt.isolated.deploy_only)validateDeployOnlyProof(receipt,registry,now);
 else if(full.sourceCommit===receipt.source_commit)same(full.artifactSha256,artifact.sha256,'calibration artifact not bound');
 else{const report=read(receipt.isolated.calibration_overlay?.path);assert(receipt.isolated.calibration_overlay.sha256===sha(fs.readFileSync(receipt.isolated.calibration_overlay.path)),'overlay evidence changed');same([report.sourceCommit,report.artifactSha256],[full.sourceCommit,full.artifactSha256],'consumed calibration source changed');}
 assert(receipt.isolated.apis.ownership_reference&&receipt.isolated.apis.source_commit&&receipt.isolated.apis.settings_digest&&receipt.isolated.apis.deployments_digest&&receipt.isolated.apis.cron_digest,'current APIS owner/source/readback required');
 for(const id of ['ai-bdfz-net','apis-bdfz-net']){const a=registry.projects.find(p=>p.project_id===id);assert(a?.state==='accepted','APIS not accepted');same([a.accepted.version_id,a.accepted.source_commit],[receipt.isolated.apis.version,receipt.isolated.apis.source_commit],'APIS accepted source changed');}
 assert(receipt.isolated.apis.ownership_evidence_path&&receipt.isolated.apis.ownership_evidence_sha256===sha(fs.readFileSync(receipt.isolated.apis.ownership_evidence_path)),'APIS ownership evidence missing');
 return {project:p,approval:a};
}
export function validateSingleDiagnosticConfiguration(receipt,now=Date.now()){
 const i=receipt.isolated,d=i.single_diagnostic;
 assert(d?.version==='yw-single-synthetic-publisher-v1'&&!i.inert_candidate&&!i.deploy_only,'exclusive single diagnostic mode required');
 assert(receipt.http_budget?.max_requests===23&&receipt.http_budget.shared_configuration_max===3&&receipt.http_budget.deploy_timeout_ms===300000,'bounded single diagnostic policy required');
 const config=structuredClone(i.config),setting=config.env_vars.YW_SINGLE_DIAGNOSTIC_JSON;
 same(Object.keys(setting||{}).sort(),['type','value']);assert(setting.type==='plain_text'&&typeof setting.value==='string');delete config.env_vars.YW_SINGLE_DIAGNOSTIC_JSON;
 const preserved={...receipt,http_budget:{max_requests:22,shared_configuration_max:2,deploy_timeout_ms:300000},isolated:{...i,config,single_diagnostic:undefined,inert_candidate:{version:'yw-inert-diagnostic-candidate-v1'}}};
 const full=validateInertConfiguration(preserved,now),a=JSON.parse(setting.value);
 same(Object.keys(a).sort(),'version enabled operation ownerUserId origin databaseId sourceCommit artifactSha256 receiptDigest priorLedgerDigest apisVersion apisSourceCommit fixtureSourceDigest payloadDigest schemaDigest schemaStructureDigest model maxLogicalCalls maxProviderAttempts reserveMicros paidMicros notBefore expiresAt readbackUntil'.split(' ').sort(),'unexpected diagnostic capabilities');
 same({version:a.version,enabled:a.enabled,operation:a.operation,owner:a.ownerUserId,origin:a.origin,database:a.databaseId,model:a.model,logical:a.maxLogicalCalls,provider:a.maxProviderAttempts,reserve:a.reserveMicros,paid:a.paidMicros},{version:'yw-single-synthetic-diagnostic-v1',enabled:true,operation:'yw-synthetic-schema-cause-v1',owner:553,origin:FIXED.origin,database:FIXED.database,model:'gemini-3.8-flash',logical:1,provider:1,reserve:84000,paid:0});
 same([a.sourceCommit,a.artifactSha256,a.apisVersion,a.apisSourceCommit],[receipt.source_commit,receipt.preview.artifact_digest,i.apis.version,i.apis.source_commit],'diagnostic source/artifact/APIS pins differ');
 same([a.fixtureSourceDigest,a.payloadDigest,a.schemaDigest,a.schemaStructureDigest],[syntheticFixture.fixtureSourceDigest,syntheticFixture.provenance.payloadDigest,syntheticFixture.provenance.syntheticSchemaDigest,syntheticFixture.provenance.schemaStructureDigest],'synthetic fixture drift');
 for(const k of ['receiptDigest','priorLedgerDigest'])assert(/^[a-f0-9]{64}$/.test(a[k]),'approval/ledger pin missing');
 const start=Date.parse(a.notBefore),end=Date.parse(a.expiresAt),readEnd=Date.parse(a.readbackUntil),lease=Date.parse(receipt.expires_at);
 assert([start,end,readEnd,lease,now].every(Number.isFinite)&&start<=now&&now<end&&end-start<=900000&&readEnd>=end&&readEnd-start<=2400000&&lease<=readEnd&&lease>now,'diagnostic window invalid');
 return full;
}
export function validateSingleDiagnosticProof(receipt,registry,artifact,now=Date.now(),load=pin=>{assert(pin?.path&&pin.sha256===sha(fs.readFileSync(pin.path)),'single diagnostic evidence changed');return read(pin.path);}){
 validateSingleDiagnosticConfiguration(receipt,now);const d=receipt.isolated.single_diagnostic,prior=load(d.prior_receipt),a=JSON.parse(receipt.isolated.config.env_vars.YW_SINGLE_DIAGNOSTIC_JSON.value),authority=load(d.approval),ledger=load(d.prior_ledger);
 const consumed=registry.approved_releases.find(x=>x.change_id===prior.change_id);assert(consumed?.consumed===true&&consumed.receipt_sha256===d.prior_receipt.sha256&&prior.change_id!==receipt.change_id,'consumed original remains terminal');
 same(prior.target,receipt.target);const base=structuredClone(receipt.isolated.config);delete base.env_vars.YW_SINGLE_DIAGNOSTIC_JSON;same(base,prior.isolated.config,'only diagnostic setting may differ');
 same([a.receiptDigest,a.priorLedgerDigest],[d.approval.sha256,d.prior_ledger.sha256]);
 assert(authority.approved===true&&authority.operation===a.operation&&authority.source_commit===receipt.source_commit&&authority.artifact_digest===artifact.sha256&&authority.notBefore===a.notBefore&&authority.expiresAt===a.expiresAt&&authority.readbackUntil===a.readbackUntil&&authority.max_provider_attempts===1&&authority.zero_retry===true,'explicit one-shot approval missing');
 assert(ledger.terminal===true&&ledger.case23_retry_permitted===false,'original ledger must remain terminal');
 const allowed=new Set(['_worker.js/dialogue-acceptance.js','_worker.js/dialogue-source.js','_worker.js/dialogue-single-diagnostic.js','_worker.js/dialogue-synthetic-diagnostic-fixture.json.js']);
 const old=new Map(prior.artifact_files.map(f=>[f.path,f])),fresh=new Map(artifact.files.map(f=>[f.path,f]));
 for(const [p,f]of old){assert(fresh.has(p),'old module/asset removed');if(!allowed.has(p))same(fresh.get(p),f,'unrelated runtime/static asset changed');}
 for(const p of fresh.keys())assert(old.has(p)||allowed.has(p),'unreviewed new asset/module');
 for(const p of allowed)assert(fresh.has(p),'diagnostic private module missing');
 same(artifact.files,receipt.artifact_files);return prior;
}
export function registerSingleDiagnosticCopy(registry,receipt,context){
 const copy=structuredClone(registry),p=copy.projects.find(p=>p.project_id===FIXED.projectId);assert(p&&!copy.approved_releases.some(x=>x.change_id===receipt.change_id),'fresh target/channel required');
 p.staged_manual_channel={identity:receipt.change_id,status:'prepared_unconsumed',publisher:import.meta.filename,publisher_sha256:context.publisherHash,receipt_path:receipt.receipt_path,source_commit:receipt.source_commit,baseline_deployment:receipt.base_deployment,baseline_source:receipt.baseline_source,expires_at:receipt.expires_at};
 copy.approved_releases.push({change_id:receipt.change_id,project_id:FIXED.projectId,consumed:false,receipt_sha256:context.receiptHash});validateRegistration(copy,receipt,context);return copy;
}
export function validateInertConfiguration(receipt,now=Date.now()){
 const i=receipt.isolated,v=i.config.env_vars;
 assert(i.inert_candidate?.version==='yw-inert-diagnostic-candidate-v1'&&!i.deploy_only,'exact inert-only mode required');
 assert(receipt.http_budget?.max_requests===22&&receipt.http_budget.shared_configuration_max===2&&receipt.http_budget.deploy_timeout_ms===300000,'bounded inert candidate policy required');
 const full=JSON.parse(v.YW_CALIBRATION_FULL_LANGUAGE_JSON.value),e2e=JSON.parse(v.YW_E2E_AUTHORITY_JSON.value),budget=JSON.parse(v.YW_DIALOGUE_BUDGET_JSON.value);
 const expiry=Date.parse(v.YW_ACCEPTANCE_EXPIRES_AT.value);
 assert(Number.isFinite(now)&&Number.isFinite(expiry)&&expiry<=now&&[full.hardExpiry,e2e.hardExpiry,budget.validUntil].every(x=>Date.parse(x)===expiry),'all model admission windows must remain expired');
 // Validate the preserved configuration at its original start, never renew it.
 return validateConfiguration(i.config,Date.parse(full.readyAt));
}
export function validateInertCandidateProof(receipt,registry,artifact,now=Date.now(),load=pin=>{
 assert(pin?.path&&pin.sha256===sha(fs.readFileSync(pin.path)),'inert predecessor evidence changed');return read(pin.path);
}){
 const full=validateInertConfiguration(receipt,now),pin=receipt.isolated.inert_candidate.prior_receipt,prior=load(pin);
 const consumed=registry.approved_releases.find(x=>x.change_id===prior.change_id);
 assert(consumed?.consumed===true&&consumed.receipt_sha256===pin.sha256&&prior.change_id!==receipt.change_id,'consumed predecessor must remain terminal');
 same(prior.target,receipt.target);same(prior.isolated.config,receipt.isolated.config,'inert configuration must remain byte-equivalent');
 same(full.sourceCommit,prior.source_commit,'historical activation source must stay unchanged');
 same(artifact.files.map(f=>f.path),prior.artifact_files.map(f=>f.path),'inert artifact file set changed');
 const changed=artifact.files.filter((f,n)=>JSON.stringify(f)!==JSON.stringify(prior.artifact_files[n])).map(f=>f.path);
 same(changed,['_worker.js/dialogue-source.js'],'only the reviewed diagnostic runtime module may change');
 same(artifact.files,receipt.artifact_files,'inert artifact evidence differs');
 return prior;
}
export function validateDeployOnlyProof(receipt,registry,now=Date.now(),load=read){
 const d=receipt.isolated.deploy_only;assert(d?.version==='yw-isolated-deploy-only-v1','exact deployment-only mode required');
 const bound=pin=>{assert(pin?.path&&pin.sha256===sha(fs.readFileSync(pin.path)),'deployment-only evidence changed');return load(pin.path);};
 const prior=bound(d.prior_receipt),journal=bound(d.prior_journal),absent=bound(d.absence),reconciled=bound(d.configuration_readback);
 const consumed=registry.approved_releases.find(x=>x.change_id===prior.change_id);
 assert(consumed?.consumed===true&&consumed.receipt_sha256===d.prior_receipt.sha256&&prior.change_id!==receipt.change_id,'consumed predecessor must remain terminal');
 assert(journal.source===prior.source_commit&&journal.terminal===true&&journal.receiptSha256===d.prior_receipt.sha256,'exact terminal predecessor required');
 const last=journal.requests.at(-1);assert(last?.id==='deploy'&&last.method==='POST'&&last.complete===false,'only unknown single deploy can be reconciled');
 assert(journal.requests.filter(x=>x.id==='deploy').length===1&&journal.requests.some(x=>x.id==='missing-after'&&x.complete&&x.status===200),'stored asset proof required');
 same(prior.target,receipt.target);same(prior.isolated.config,receipt.isolated.config,'configuration must remain byte-equivalent');
 same(prior.artifact_files,receipt.artifact_files);same(prior.preview.artifact_digest,receipt.preview.artifact_digest);same(prior.isolated.packed_worker_sha256,receipt.isolated.packed_worker_sha256,'packed artifact changed');
 const full=JSON.parse(receipt.isolated.config.env_vars.YW_CALIBRATION_FULL_LANGUAGE_JSON.value);same(full.sourceCommit,prior.source_commit,'runtime source pin changed');
 assert(absent.status===200&&absent.body?.success===true&&absent.body.result_info?.total_pages===1&&absent.body.result_info.total_count===absent.body.result.length,'complete absence inventory required');
 assert(Date.parse(absent.at)>Date.parse(last.at)&&now>=Date.parse(absent.at)&&now-Date.parse(absent.at)<=1800000,'absence proof expired');
 assert(absent.body.result.every(x=>x.deployment_trigger?.metadata?.commit_hash!==prior.source_commit&&Date.parse(x.created_on)<Date.parse(last.at)),'unknown deployment exists; read back instead of deploying');
 assert(reconciled.project?.name===FIXED.project&&reconciled.status===200&&reconciled.differences?.length===0&&reconciled.deployment===receipt.base_deployment,'exact prior configuration readback required');
 assert(receipt.http_budget?.max_requests===17&&receipt.http_budget.shared_configuration_max===0&&d.deploy_timeout_ms===300000,'bounded deployment-only policy required');
 return prior;
}
export function requestCeiling(receipt){const cap=receipt.http_budget?.max_requests;assert(Number.isInteger(cap)&&cap>0&&cap<=160,'finite receipt request ceiling required');return Math.min(receipt.isolated.deploy_only?17:receipt.isolated.inert_candidate?22:receipt.isolated.single_diagnostic||receipt.isolated.sample_mode?23:160,cap);}
export function requestTimeout(receipt,state,id,method,now=Date.now()){
 const boundedDeploy=receipt.isolated.deploy_only||receipt.http_budget?.deploy_timeout_ms===300000;const base=method==='GET'?15000:boundedDeploy&&id==='deploy'?300000:120000;
 if(!boundedDeploy)return base;const full=JSON.parse(receipt.isolated.config.env_vars[receipt.isolated.sample_mode?'YW_E2E_AUTHORITY_JSON':'YW_CALIBRATION_FULL_LANGUAGE_JSON'].value);if(receipt.isolated.inert_candidate)validateInertConfiguration(receipt,now);const remaining=Math.min(Date.parse(receipt.expires_at),Date.parse(state.startedAt)+900000,receipt.isolated.inert_candidate||receipt.isolated.single_diagnostic?Infinity:Date.parse(full.hardExpiry))-now;assert(remaining>0,'deadline expired');return Math.min(base,remaining);
}
export function configurationPatch(config){
 const patch=structuredClone(config);delete patch.env_vars.APIS_CALLER_TOKEN;
 // Pages merges env_vars. Remove only the retired activation keys explicitly;
 // omitting a key preserves its previous value even when it is disabled.
 patch.services.APIS_ACCEPTANCE=null;patch.env_vars.YW_ACCEPTANCE_APIS_VERSION=null;
 patch.env_vars.YW_CALIBRATION_AMENDMENT5_JSON=null;
 if(JSON.parse(config.env_vars.YW_E2E_AUTHORITY_JSON.value).operation===MODE_OPERATION){
  patch.env_vars.YW_CALIBRATION_FULL_LANGUAGE_JSON=null;patch.env_vars.YW_FULL_LANGUAGE_ACTIVATION_SHA256=null;
 }
 return patch;
}
function projection(p){return {name:p.name,production_branch:p.production_branch,deployment_configs:p.deployment_configs,domains:[...(p.domains||[])].sort()};}
function assertProviderConfiguration(actual,expected){
 const projected=structuredClone(actual);if(projected?.env_vars?.APIS_CALLER_TOKEN?.type==='secret_text')projected.env_vars.APIS_CALLER_TOKEN={type:'secret_text'};
 for(const map of ['services','env_vars'])for(const key of Object.keys(projected?.[map]||{}))if(projected[map][key]===null)delete projected[map][key];
 for(const [key,value]of Object.entries(expected))same(projected?.[key],value,'isolated configuration readback failed');
 const metadata=new Set(['always_use_latest_compatibility_date','usage_model','placement','build_image_major_version','limits']);
 for(const [key,value]of Object.entries(actual||{}))if(!(key in expected)&&!metadata.has(key))assert(value==null||value===false||typeof value==='object'&&Object.keys(value).length===0,'unexpected isolated binding: '+key);
}
function checkBaseline(receipt,p){assert(p.name===FIXED.project&&p.production_branch==='acceptance','wrong Pages target/branch');same(p.canonical_deployment?.id,receipt.base_deployment,'live deployment drift');same(digest(projection(p)),receipt.base_config_digest,'live configuration drift');assert(p.domains.includes('yw-acceptance.bdfz.net'),'domain not attached');}
export async function transact(receipt,{call,artifact,packed,readAsset,save,beforeDeploy=()=>{},delay=ms=>new Promise(r=>setTimeout(r,ms))}){
 const i=receipt.isolated,deployOnly=!!i.deploy_only,inert=!!i.inert_candidate,single=!!i.single_diagnostic,mode=!!i.sample_mode;
 if(inert)validateInertConfiguration(receipt);
 if(single)validateSingleDiagnosticConfiguration(receipt);
 if(mode)validateModeProof(receipt,artifact);
 const p=await call('baseline','GET',PROJECT);checkBaseline(receipt,p);
 const domains=await call('domains','GET',PROJECT+'/domains');assert(domains.some(d=>d.name==='yw-acceptance.bdfz.net'&&d.status==='active'),'isolated domain not active');
 const preserve=async suffix=>{
  const formal=await call('formal'+suffix,'GET',FORMAL);same({deployment:formal.canonical_deployment?.id,source:formal.canonical_deployment?.deployment_trigger?.metadata?.commit_hash,config_digest:digest(projection(formal))},i.formal,'formal site changed');
  const live=await call('apis'+suffix,'GET',BASE+'/workers/scripts/apis/deployments');same(digest(live),i.apis.deployments_digest,'APIS deployments changed');same(live.deployments?.[0]?.versions,[{version_id:i.apis.version,percentage:100}],'APIS active baseline differs');
  same(digest(await call('apis-settings'+suffix,'GET',BASE+'/workers/scripts/apis/settings')),i.apis.settings_digest,'APIS code/config baseline changed');
  same(digest(await call('apis-cron'+suffix,'GET',BASE+'/workers/scripts/apis/schedules')),i.apis.cron_digest,'APIS cron changed');
 };
 await preserve('-before');
 // Caller credential is pre-provisioned through its existing secret authority.
 // PATCH merges env_vars (as pinned Wrangler pages secret does); never copy a redacted secret back.
 for(const scope of ['production','preview'])assert(p.deployment_configs?.[scope]?.env_vars?.APIS_CALLER_TOKEN?.type==='secret_text','formal caller secret not provisioned; no configuration write');
 let configured=p;
 if(!deployOnly&&!inert){try{configured=await call('config','PATCH',PROJECT,{deployment_configs:{production:configurationPatch(i.config),preview:configurationPatch(i.config)}});}catch(error){
  if(single||mode){const reconciled=await call('config-uncertain-readback','GET',PROJECT);save('config-uncertain-readback.json',{deployment:reconciled.canonical_deployment?.id,configDigest:digest(projection(reconciled))});throw Error('configuration write uncertain: terminal readback only, no deploy/replay');}throw error;
 }}
 for(const scope of ['production','preview'])assertProviderConfiguration(configured.deployment_configs?.[scope],i.config);
 const {jwt}=await call('upload-token','GET',PROJECT+'/upload-token');assert(typeof jwt==='string'&&jwt.length>20,'upload credential unavailable');
 const assets=new Map(artifact.assets.map(f=>[f.key,f])),keys=[...assets.keys()];
 const missing=await call('missing','POST','/pages/assets/check-missing',{hashes:keys},jwt);assert(Array.isArray(missing)&&new Set(missing).size===missing.length&&missing.every(k=>assets.has(k)),'unknown missing asset');
 if(deployOnly||inert||single||mode)same(missing,[],'deployment-only requires all assets already stored; no upload retry');
 let batch=[],size=0,n=0;
 async function flush(){if(!batch.length)return;await call('upload-'+n++,'POST','/pages/assets/upload',batch,jwt);batch=[];size=0;}
 for(const key of missing){const f=assets.get(key),b=readAsset(f.path);same(sha(b),f.sha256,'asset changed');const row={key,value:b.toString('base64'),metadata:{contentType:f.contentType},base64:true};const bytes=Buffer.byteLength(JSON.stringify(row));if(size+bytes>10*1024*1024)await flush();batch.push(row);size+=bytes;}await flush();
 if(missing.length)await call('upsert','POST','/pages/assets/upsert-hashes',{hashes:missing},jwt);
 if(!deployOnly&&!inert&&!single&&!mode)same(await call('missing-after','POST','/pages/assets/check-missing',{hashes:keys},jwt),[],'assets not stored');
 // Repeat source-preserving dependencies immediately before the sole deploy.
 if(!deployOnly){await preserve('-predeploy');const current=await call('target-predeploy','GET',PROJECT);same(current.canonical_deployment?.id,receipt.base_deployment,'isolated live changed during upload');same(projection(current),projection(configured),'isolated config drift during upload');}await beforeDeploy();
 const form=new FormData();form.set('manifest',JSON.stringify(Object.fromEntries(artifact.assets.map(f=>['/'+f.path,f.key]))));form.set('branch','acceptance');form.set('commit_hash',receipt.source_commit);form.set('commit_dirty','false');form.set('_worker.bundle',new Blob([packed]),'_worker.bundle');
 for(const name of ['_headers','_redirects','_routes.json'])if(artifact.files.some(f=>f.path===name))form.set(name,new Blob([readAsset(name)]),name);
 const d=await call('deploy','POST',PROJECT+'/deployments',form);assert(/^[a-f0-9-]{36}$/.test(d.id),'uncertain deployment handle');save('deployment-handle.json',{id:d.id,source:receipt.source_commit});
 let checked;for(let n=0;n<3;n++){checked=await call('deployment-'+n,'GET',PROJECT+'/deployments/'+d.id);same(checked.deployment_trigger?.metadata?.commit_hash,receipt.source_commit);if(checked.latest_stage?.status==='success')break;assert(['queued','pending','active'].includes(checked.latest_stage?.status),'terminal platform compile failure');if(n<2)await delay(3000);}
 assert(checked.latest_stage?.status==='success','pending exact deployment: reconcile only, do not replay');
 const after=await call('after','GET',PROJECT);same(after.canonical_deployment?.id,d.id);for(const scope of ['production','preview'])assertProviderConfiguration(after.deployment_configs?.[scope],i.config);
 await preserve('-after');return {at:timestamp(),source:receipt.source_commit,artifact:artifact.sha256,deployment:d.id,accepted:false,status:inert?'isolated_inert_diagnostic_candidate':single?'isolated_single_synthetic_diagnostic_candidate':'isolated_deployed_real_acceptance_pending',formalPreserved:true,apisPreserved:true};
}

export async function execute(receiptPath){
 assert.equal(process.versions.node,'24.18.0','pinned local transport runtime required');
 assert(path.isAbsolute(receiptPath)&&!fs.lstatSync(receiptPath).isSymbolicLink());const bytes=fs.readFileSync(receiptPath),receipt=JSON.parse(bytes),root=path.resolve(import.meta.dirname,'..');
 assert(receipt.receipt_path===receiptPath&&path.isAbsolute(receipt.artifact_root)&&path.isAbsolute(receipt.isolated.packed_worker_path));
 for(const k of ['NODE_OPTIONS','CLOUDFLARE_API_BASE_URL','CF_API_BASE_URL','HTTPS_PROXY','HTTP_PROXY','ALL_PROXY','https_proxy','http_proxy','all_proxy'])assert(!process.env[k],'unsupported publisher environment');
 const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:15000}).trim();
 const artifact=inventory(receipt.artifact_root),packed=fs.readFileSync(receipt.isolated.packed_worker_path);same(sha(packed),receipt.isolated.packed_worker_sha256);same(packed,packWorker(receipt.artifact_root,artifact,receipt.isolated.config),'packed source/config drift');
 const activation=JSON.parse(receipt.isolated.config.env_vars[receipt.isolated.sample_mode?'YW_E2E_AUTHORITY_JSON':'YW_CALIBRATION_FULL_LANGUAGE_JSON'].value);
 if(receipt.isolated.sample_mode){validateModeProof(receipt,artifact);same(activation.sourceCommit,receipt.source_commit,'mode source must be exact');}
 else if(receipt.isolated.single_diagnostic){const prior=read(receipt.isolated.single_diagnostic.prior_receipt.path);git('merge-base','--is-ancestor',prior.source_commit,receipt.source_commit);const delta=git('diff','--name-only',prior.source_commit,receipt.source_commit).split('\n');assert(delta.every(p=>['site/dialogue-source.js','site/dialogue-acceptance.js','site/dialogue-single-diagnostic.js','site/dialogue-synthetic-diagnostic-fixture.json','scripts/build_synthetic_diagnostic_fixture.mjs','scripts/test_single_synthetic_diagnostic.mjs','scripts/test_single_diagnostic_publishers.mjs','scripts/publish_dialogue_rollback.mjs','scripts/test_dialogue_formal_gateway.mjs','scripts/publish_dialogue_isolated.mjs','scripts/test_publish_dialogue_isolated.mjs','docs/MAINTENANCE_MANUAL.md','PROJECT_STATE.md'].includes(p)),'single diagnostic source scope changed');}
 else if(receipt.isolated.inert_candidate){const prior=read(receipt.isolated.inert_candidate.prior_receipt.path);git('merge-base','--is-ancestor',prior.source_commit,receipt.source_commit);const delta=git('diff','--name-only',prior.source_commit,receipt.source_commit).split('\n');assert(delta.includes('site/dialogue-source.js')&&delta.every(p=>['site/dialogue-source.js','scripts/test_dialogue_formal_gateway.mjs','scripts/publish_dialogue_isolated.mjs','scripts/test_publish_dialogue_isolated.mjs','docs/MAINTENANCE_MANUAL.md','PROJECT_STATE.md'].includes(p)),'inert candidate source scope changed');}
 else if(receipt.isolated.deploy_only){const prior=read(receipt.isolated.deploy_only.prior_receipt.path);git('merge-base','--is-ancestor',prior.source_commit,receipt.source_commit);const delta=git('diff','--name-only',prior.source_commit,receipt.source_commit).split('\n');assert(delta.length>0&&delta.every(p=>['scripts/publish_dialogue_isolated.mjs','scripts/test_isolated_deploy_only.mjs','docs/MAINTENANCE_MANUAL.md'].includes(p)),'deployment-only tool patch must not change runtime');}
 else if(activation.sourceCommit!==receipt.source_commit){same(path.resolve(receipt.isolated.calibration_overlay.path),path.join(root,'scripts/dialogue-calibration-overlay.json'),'reviewed source overlay required');await prepareRenewedPlan(read(receipt.isolated.calibration_overlay.path));}
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
   assert(!state.terminal&&!state.requests.some(r=>r.id===id)&&Date.now()<Date.parse(receipt.expires_at)&&Date.now()-Date.parse(state.startedAt)<900000&&state.requests.length<requestCeiling(receipt),'terminal, duplicate, deadline or request ceiling');
   assert(method==='GET'&&(url===PROJECT||url===FORMAL||url===PROJECT+'/domains'||url===PROJECT+'/upload-token'||url===BASE+'/workers/scripts/apis/deployments'||url===BASE+'/workers/scripts/apis/settings'||url===BASE+'/workers/scripts/apis/schedules'||new RegExp('^'+PROJECT+'/deployments/[a-f0-9-]{36}$').test(url))||!receipt.isolated.deploy_only&&!receipt.isolated.inert_candidate&&method==='PATCH'&&id==='config'&&url===PROJECT||method==='POST'&&(url===PROJECT+'/deployments'&&id==='deploy'||(receipt.isolated.deploy_only||receipt.isolated.inert_candidate||receipt.isolated.single_diagnostic||receipt.isolated.sample_mode?['/pages/assets/check-missing']:['/pages/assets/check-missing','/pages/assets/upload','/pages/assets/upsert-hashes']).includes(url)),'request outside isolated allowlist');
   const headers={Authorization:'Bearer '+(uploadToken||token),...(receipt.isolated.deploy_only?{'accept-encoding':'identity'}:{})};let data;if(body instanceof FormData){const encoded=new Response(body);headers['content-type']=encoded.headers.get('content-type');data=Buffer.from(await encoded.arrayBuffer());}else if(body!==undefined){headers['content-type']='application/json';data=Buffer.from(JSON.stringify(body));}
   state.requestBytes+=data?.length||0;assert(state.requestBytes<=400*1024*1024,'request byte ceiling');state.requests.push({id,method,url,at:timestamp(),requestBytes:data?.length||0,complete:false});write(journalPath,state);
   let response;try{response=await fetch('https://api.cloudflare.com/client/v4'+url,{method,headers,body:data,redirect:'error',signal:AbortSignal.timeout(requestTimeout(receipt,state,id,method))});}catch(error){Object.assign(state.requests.at(-1),{errorName:error.name,failedAt:timestamp(),outcome:'unknown_no_replay'});write(journalPath,state);throw error;}const chunks=[];let total=0;for await(const chunk of response.body){total+=chunk.length;state.responseBytes+=chunk.length;assert(total<=8*1024*1024&&state.responseBytes<=32*1024*1024,'response byte ceiling');chunks.push(chunk);}const result=JSON.parse(Buffer.concat(chunks));Object.assign(state.requests.at(-1),{status:response.status,responseBytes:total,complete:true});write(journalPath,state);assert(response.ok&&result.success,'provider request failed or uncertain; no replay');return result.result;
  };
  try{const result=await transact(receipt,{call,artifact,packed,beforeDeploy:()=>{same(git('rev-parse','HEAD'),receipt.source_commit);same(git('status','--porcelain'),'');same(git('ls-remote',FIXED.repository+'.git',receipt.source_ref),remote);same(inventory(receipt.artifact_root).files,artifact.files);assert(fs.readFileSync(receiptPath).equals(bytes),'receipt changed');},readAsset:p=>fs.readFileSync(path.join(receipt.artifact_root,p)),save:(n,v)=>write(path.join(path.dirname(receiptPath),n),v,true)});write(receiptPath+'.result.json',result,true);Object.assign(project.staged_manual_channel,{status:receipt.isolated.inert_candidate?'consumed_inert_candidate':'consumed_deployed_acceptance_pending',observed_source:result.source,observed_deployment:result.deployment});write(FIXED.registry,registry);return result;}
  finally{state.terminal=true;write(journalPath,state);}
 });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{assert(process.argv[2]==='--execute-once'&&process.argv.length===4,'registered schema-v1 receipt required');console.log(JSON.stringify(await execute(process.argv[3])));}
 catch{console.error('Isolated publisher stopped. Preserve the exact receipt/journal and reconcile its target; no automatic retry or production acceptance.');process.exitCode=1;}
}
