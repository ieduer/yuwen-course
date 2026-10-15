import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {buildPublicResponseManifest} from './public_response_manifest.mjs';
async function fixture(fn){const root=fs.mkdtempSync(path.join(os.tmpdir(),'response-fixture-'));try{
 fs.writeFileSync(path.join(root,'index.html'),'legacy');fs.writeFileSync(path.join(root,'dialogue.html'),'dialogue');
 fs.writeFileSync(path.join(root,'_headers'),'/*\n X-Test: yes');
 fs.writeFileSync(path.join(root,'_worker.js'),`export default {fetch(req,env){return env.ASSETS.fetch(new Request(new URL(env.YW_DIALOGUE_ENABLED==='true'&&new URL(req.url).pathname==='/'?'/dialogue.html':new URL(req.url).pathname,req.url)))}}`);
 await fn(root);
}finally{fs.rmSync(root,{recursive:true,force:true})}}
const opts=root=>({artifactRoot:root,sourceCommit:'a'.repeat(40)});
test('manifest separates upload and actual response and binds root flag',()=>fixture(async root=>{
 const off=await buildPublicResponseManifest(opts(root)),on=await buildPublicResponseManifest({...opts(root),dialogueEnabled:true});
 const old=off.files.find(f=>f.path==='index.html'),fresh=on.files.find(f=>f.path==='index.html');
 assert.equal(old.sha256,old.upload_sha256);assert.notEqual(fresh.sha256,fresh.upload_sha256);assert.equal(fresh.sha256,on.files.find(f=>f.path==='dialogue.html').sha256);
 assert.equal(off.provider_only_files.length,2);assert.equal(off.files.length,2);
 assert.deepEqual(await buildPublicResponseManifest(opts(root)),off);
}));
for(const [name,code]of[['network',`fetch('https://example.invalid')`],['D1',`env.READING_DB.prepare('SELECT 1')`],['caught network',`(()=>{try{fetch('https://example.invalid')}catch{};return env.ASSETS.fetch(req)})()`]])test('offline runner rejects '+name,()=>fixture(async root=>{
 fs.writeFileSync(path.join(root,'_worker.js'),`export default {fetch(req,env){return ${code}}}`);
 await assert.rejects(()=>buildPublicResponseManifest(opts(root)),/forbidden|Forbidden/);
}));
test('duplicate Pages clean route fails closed',()=>fixture(async root=>{
 fs.writeFileSync(path.join(root,'dialogue'),'collision');await assert.rejects(()=>buildPublicResponseManifest(opts(root)),/Duplicate public route/);
}));
