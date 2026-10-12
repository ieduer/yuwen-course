// Prepare a separate restricted entrypoint from the verified formal artifact.
// No upload, configuration mutation, identity fixture, or deployment authority.
import {cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {verifyReleaseStaging} from './build_release_site.mjs';

const root=path.resolve(import.meta.dirname,'..');
const source=path.join(root,'.release/site'), target=path.join(root,'.acceptance/site');
verifyReleaseStaging({releaseRoot:source,releaseKind:'formal-stable'});
if(existsSync(target))throw Error('Acceptance artifact already exists; reconcile ownership before rebuilding');
mkdirSync(path.dirname(target),{recursive:true});
cpSync(source,target,{recursive:true});
renameSync(path.join(target,'_worker.js'),path.join(target,'dialogue-production-worker.js'));
writeFileSync(path.join(target,'_worker.js'),"import worker from './dialogue-production-worker.js';\nimport {createAcceptanceWorker} from './dialogue-acceptance.js';\nexport default createAcceptanceWorker(worker);\n");
// Never label the changed entrypoint as a formal production artifact.
rmSync(path.join(target,'.bdfz-release-artifact.json'));
const files=[];
function collect(dir,prefix=''){
  for(const entry of readdirSync(dir,{withFileTypes:true})){
    const relative=prefix+entry.name,full=path.join(dir,entry.name);
    if(entry.isDirectory())collect(full,relative+'/');
    else if(entry.isFile()){
      const bytes=readFileSync(full);files.push({path:relative,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
    }else throw Error('Unsupported artifact entry');
  }
}
collect(target);files.sort((a,b)=>a.path.localeCompare(b.path,'en'));
const sha256=createHash('sha256').update(files.map(x=>`${x.sha256}  ${x.path}\n`).join('')).digest('hex');
const receipt={purpose:'restricted-dialogue-acceptance-only',origin:'https://yw-acceptance.bdfz.net',files,totalBytes:files.reduce((sum,x)=>sum+x.bytes,0),sha256};
writeFileSync(path.join(root,'.acceptance/artifact.json'),JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify({files:files.length,totalBytes:receipt.totalBytes,sha256}));
