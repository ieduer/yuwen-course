// Deterministic local execution of the exact uploaded Worker. No provider runtime
// acceptance is implied; Pages controls are separately listed, never skipped.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createHash, webcrypto} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const hash=b=>createHash('sha256').update(b).digest('hex');
const need=(v,m)=>{if(!v)throw Error(m)};
export const providerOnly=p=>['_worker.js','_headers','_redirects','_routes.json'].includes(p)||p.startsWith('_worker.js/');
export function publicPath(p){
 if(p==='index.html')return '/';
 if(p.endsWith('/index.html'))return '/'+p.slice(0,-10);
 if(p.endsWith('.html'))return '/'+p.slice(0,-5);
 return '/'+p.split('/').map(encodeURIComponent).join('/');
}
export function inventory(root){
 need(path.isAbsolute(root)&&!fs.lstatSync(root).isSymbolicLink(),'Exact real artifact root required');
 const out=[];function walk(rel=''){for(const name of fs.readdirSync(path.join(root,rel)).sort()){
  const p=rel+name,s=fs.lstatSync(path.join(root,p));need(!s.isSymbolicLink(),'Symlink forbidden');
  if(s.isDirectory())walk(p+'/');else {need(s.isFile(),'Special file forbidden');const b=fs.readFileSync(path.join(root,p));out.push({path:p,sha256:hash(b),bytes:b.length});}
 }}walk();return out;
}
export async function buildPublicResponseManifest({artifactRoot,sourceCommit,dialogueEnabled=false}){
 need(/^[a-f0-9]{40}$/.test(sourceCommit),'Exact source commit required');
 need(typeof dialogueEnabled==='boolean','Exact dialogue flag required');
 need(typeof vm.SourceTextModule==='function','Use --experimental-vm-modules');
 const files=inventory(artifactRoot),byPath=new Map(files.map(f=>[f.path,f])),routes=new Map();
 for(const f of files.filter(f=>!providerOnly(f.path))){const p=publicPath(f.path);need(!routes.has(p),'Duplicate public route: '+p);routes.set(p,f.path)}
 let forbidden=0;const deny=()=>{forbidden++;throw Error('External fetch, binding or asynchronous work forbidden')};
 const sandbox=vm.createContext({Request,Response,Headers,URL,URLSearchParams,TextEncoder,TextDecoder,ReadableStream,TransformStream,AbortController,AbortSignal,structuredClone,crypto:webcrypto,atob,btoa,fetch:deny,setTimeout:deny,console:{log:deny,warn:deny,error:deny}});
 const modules=new Map();
 function load(name){
  need(byPath.has(name),'Unbound Worker module: '+name);if(modules.has(name))return modules.get(name);
  const source=fs.readFileSync(path.join(artifactRoot,name),'utf8');
  const mod=name.endsWith('.json')?new vm.SyntheticModule(['default'],function(){this.setExport('default',JSON.parse(source))},{context:sandbox,identifier:name}):new vm.SourceTextModule(source,{context:sandbox,identifier:name});modules.set(name,mod);return mod;
 }
 const worker=load('_worker.js');
 await worker.link((specifier,parent)=>{need(specifier.startsWith('./')||specifier.startsWith('../'),'External module forbidden');const name=path.posix.normalize(path.posix.join(path.posix.dirname(parent.identifier),specifier));need(!name.startsWith('../')&&!path.isAbsolute(name),'Module escaped artifact');return load(name)});
 await worker.evaluate({timeout:5000});
 const contentType=p=>p.endsWith('.json')?'application/json':p.endsWith('.pdf')?'application/pdf':p.endsWith('.html')?'text/html':'application/octet-stream';
 const ASSETS={fetch:async req=>{
  const url=new URL(req.url);need(req.method==='GET','Non-read asset request');
  let name=routes.get(url.pathname);if(!name){try{name=decodeURIComponent(url.pathname).slice(1)}catch{}}
  need(byPath.has(name)&&!providerOnly(name),'Missing local asset: '+url.pathname);
  return new Response(fs.readFileSync(path.join(artifactRoot,name)),{headers:{'content-type':contentType(name)}});
 }};
 const env=new Proxy({ASSETS,YW_DIALOGUE_ENABLED:String(dialogueEnabled)},{get:(target,key)=>key in target?target[key]:deny()});
 const responses=[];
 for(const f of files.filter(f=>!providerOnly(f.path))){
  const response=await worker.namespace.default.fetch(new Request('https://yw.bdfz.net'+publicPath(f.path)),env,{waitUntil:deny});
  need(response.status===200&&!response.redirected,'Non-200 local response: '+f.path);
  const bytes=Buffer.from(await response.arrayBuffer());need(bytes.length<25*1024*1024,'Response size limit');
  responses.push({path:f.path,request_path:publicPath(f.path),upload_sha256:f.sha256,upload_bytes:f.bytes,sha256:hash(bytes),bytes:bytes.length,...(f.path.startsWith('dialogue-curriculum/lesson-')?{content_type:'application/json',cache_control:'no-store'}:{})});
 }
 need(forbidden===0,'Forbidden capability attempted');
 need(JSON.stringify(inventory(artifactRoot))===JSON.stringify(files),'Artifact changed during response computation');
 return {source_commit:sourceCommit,artifact_digest:hash(JSON.stringify(files.map(({path,sha256})=>({path,sha256})))),dialogue_enabled:dialogueEnabled,files:responses,provider_only_files:files.filter(f=>providerOnly(f.path)),upload_bytes:files.reduce((n,f)=>n+f.bytes,0),response_bytes:responses.reduce((n,f)=>n+f.bytes,0)};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const [artifactRoot,sourceCommit,flag]=process.argv.slice(2);need(['true','false'].includes(flag),'Explicit flag required');
 process.stdout.write(JSON.stringify(await buildPublicResponseManifest({artifactRoot,sourceCommit,dialogueEnabled:flag==='true'}))+'\n');
}
