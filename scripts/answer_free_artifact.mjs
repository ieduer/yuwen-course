import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {sanitizeDialogueCurriculum} from '../site/dialogue-public-curriculum.js';

const hash=b=>createHash('sha256').update(b).digest('hex');
const exceptions=JSON.parse(fs.readFileSync(new URL('./legacy-answer-exceptions.json',import.meta.url)));
const legacy=new Map(exceptions.files.map(f=>[f.path,f.sha256]));
export const answerFields=new Set(['answerIndex','sourceAnswer','referenceAnswer','answerKey','correctAnswer','solution','studentAnswer','oldStudentAnswer']);
export function stripAnswerFields(value){
 if(Array.isArray(value))return value.map(stripAnswerFields);
 if(!value||typeof value!=='object')return value;
 const assessment=Object.keys(value).some(k=>answerFields.has(k));
 return Object.fromEntries(Object.entries(value).filter(([k])=>!answerFields.has(k)&&!(assessment&&['meaning','contextMeaning','context_meaning','explanation','variants','criteria','masteryCriteria'].includes(k))).map(([k,v])=>[k,stripAnswerFields(v)]));
}
function fields(value,pointer=''){
 if(Array.isArray(value))return value.flatMap((v,i)=>fields(v,`${pointer}/${i}`));
 if(!value||typeof value!=='object')return [];
 return Object.entries(value).flatMap(([k,v])=>[...(answerFields.has(k)?[`${pointer}/${k}`]:[]),...fields(v,`${pointer}/${k}`)]);
}
const moduleSpecifiers=text=>[...text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"]([^'"]+)['"]/g)].map(m=>m[1]);
function moduleGraph(byPath,roots,allowRemote=false){
 const seen=new Set();
 function visit(name){
  if(seen.has(name))return;
  const file=byPath.get(name);if(!file)throw Error('Missing module: '+name);
  seen.add(name);if(!/\.(?:m?js)$/.test(name))return;
  for(const spec of moduleSpecifiers(file.bytes.toString())){
   if(!spec.startsWith('.')){if(allowRemote&&spec.startsWith('https://'))continue;throw Error('Unsupported external module: '+spec);}
   const next=path.posix.normalize(path.posix.join(path.posix.dirname(name),spec.split(/[?#]/)[0]));
   if(next.startsWith('../'))throw Error('Module escaped artifact');
   visit(next);
  }
 }
 roots.forEach(visit);return seen;
}
export function answerFreeProjection(input){
 const byPath=new Map(input.map(f=>[f.path,f]));
 const privateData={};
 const worker=byPath.has('_worker.js')?moduleGraph(byPath,['_worker.js']):new Set();
 const browserRoots=input.filter(f=>/^assets\/.*\.m?js$/.test(f.path)).map(f=>f.path);
 // Include explicit HTML module entrypoints too, never remove a browser dependency.
 for(const f of input.filter(f=>/\.html?$/.test(f.path)))for(const m of f.bytes.toString().matchAll(/<script\b[^>]*src=["']([^"']+)["']/g)){
  const src=m[1].split(/[?#]/)[0];if(!/^(?:https?:)?\/\//.test(src)){
   const name=path.posix.normalize(src.startsWith('/')?src.slice(1):path.posix.join(path.posix.dirname(f.path),src));
   if(byPath.has(name))browserRoots.push(name);
  }
 }
 const browser=moduleGraph(byPath,browserRoots,true);
 const output=[];
 for(const f of input){
  if(f.path.startsWith('app-content/')){output.push(f);continue;}
  if(f.path.endsWith('.json')){
   const original=JSON.parse(f.bytes.toString());
   const value=f.path.startsWith('dialogue-curriculum/lesson-')?sanitizeDialogueCurriculum(original):original;
   const clean=stripAnswerFields(value);
   if((f.path.startsWith('dialogue-curriculum/lesson-')||JSON.stringify(clean)!==JSON.stringify(original))&&!worker.has(f.path))privateData['/'+f.path]=f.bytes.toString();
   if(worker.has(f.path)&&!browser.has(f.path))continue;
   const bytes=JSON.stringify(clean)===JSON.stringify(original)?f.bytes:Buffer.from(JSON.stringify(clean)+'\n');
   output.push({...f,bytes,sha256:hash(bytes)});
  }else if(!worker.has(f.path)||browser.has(f.path))output.push(f);
 }
 if(worker.size){
  const chunks=[];let chunk={},size=0;
  for(const [key,value] of Object.entries(privateData)){
   const n=Buffer.byteLength(JSON.stringify(value));
   if(size+n>2*1024*1024&&size){chunks.push(chunk);chunk={};size=0;}
   chunk[key]=value;size+=n;
  }
  if(size)chunks.push(chunk);
  chunks.forEach((value,i)=>{const bytes=Buffer.from('export default '+JSON.stringify(value)+';\n');output.push({path:`_worker.js/_assessment-data/${i}.js`,bytes,sha256:hash(bytes)});});
  const privateModule=chunks.map((_,i)=>`import data${i} from './_assessment-data/${i}.js';`).join('\n')+'\nexport default {'+chunks.map((_,i)=>`...data${i}`).join(',')+'};\n';
  for(const name of worker){
   const f=byPath.get(name);
   // Preserve all server modules and imported fixtures exactly; private data lives
   // under the provider-reserved directory, never a normal public JSON URL.
   const bytes=name==='assessment-private-data.js'?Buffer.from(privateModule):f.bytes;
   output.push({path:'_worker.js/'+(name==='_worker.js'?'index.js':name),bytes,sha256:hash(bytes)});
  }
 }
 return {files:output,audit:auditAnswerFreeFiles(output),privateAssetCount:Object.keys(privateData).length};
}
export function auditAnswerFreeFiles(files){
 const records=[];
 for(const f of files){
  if(f.path.startsWith('_worker.js/')||['_worker.js','_headers','_redirects','_routes.json'].includes(f.path))continue;
  const record={path:f.path,sha256:hash(f.bytes),bytes:f.bytes.length,answerFields:0,legacyException:false};
  const text=f.bytes.toString('utf8');let hits=[];
  // Inspect parseable JSON regardless of extension, then scan textual containers
  // (HTML, scripts, text aliases) for embedded answer-field assignments.
  let parsed=false;
  if(f.path.endsWith('.json')||/^[\s]*[\[{]/.test(text)){
   try{hits=fields(JSON.parse(text));parsed=true;}catch(error){if(f.path.endsWith('.json'))throw error;}
  }
  if(!parsed&&!text.includes('\0')){
   const decoded=text.replace(/\\u([0-9a-f]{4})/gi,(_,hex)=>String.fromCharCode(parseInt(hex,16))).replace(/\\(["'])/g,'$1');
   const pattern=new RegExp('(?:["\']|\\b)('+[...answerFields].join('|')+')(?:["\'])?\\s*:', 'g');
   hits=[...decoded.matchAll(pattern)].map(m=>m[1]);
  }
  record.answerFields=hits.length;record.inspection=parsed?'structured-json':'embedded-field-scan';
  if(hits.length){
   if(legacy.get(f.path)!==record.sha256)throw Error('Public answer fields: '+f.path+' '+hits[0]);
   record.legacyException=true;
  }
  records.push(record);
 }
 return {publicFiles:records.length,newPublicAnswerFields:0,legacyExceptionFiles:records.filter(r=>r.legacyException).length,files:records};
}
