import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {buildPublicResponseManifest} from './public_response_manifest.mjs';
const root=process.env.YW_PUBLIC_ARTIFACT_ROOT;
if(!path.isAbsolute(root||''))throw Error('Exact full preview artifact path required');
const sourceCommit=process.env.YW_PUBLIC_SOURCE_COMMIT;
const {loadDialogueCurriculum}=await import(pathToFileURL(path.join(root,'dialogue-source.js')));
const {sanitizeDialogueCurriculum}=await import(pathToFileURL(path.join(root,'dialogue-public-curriculum.js')));
const hash=b=>createHash('sha256').update(b).digest('hex');
const asset=async req=>new Response(fs.readFileSync(path.join(root,new URL(req.url).pathname.slice(1))));
test('all 189 actual load/sanitize/serialize responses and both entrypoint flags',async()=>{
 const off=await buildPublicResponseManifest({artifactRoot:root,sourceCommit,dialogueEnabled:false});
 const on=await buildPublicResponseManifest({artifactRoot:root,sourceCommit,dialogueEnabled:true});
 const lessons=off.files.filter(f=>/^dialogue-curriculum\/lesson-.*\.json$/.test(f.path));assert.equal(lessons.length,189);
 let redacted=0;
 for(const f of lessons){
  const id=path.basename(f.path,'.json'),raw=JSON.parse(fs.readFileSync(path.join(root,f.path)));
  const loaded=await loadDialogueCurriculum({ASSETS:{fetch:asset}},id);assert.deepEqual(loaded,raw);
  const clean=sanitizeDialogueCurriculum(loaded);const bytes=Buffer.from(JSON.stringify(clean));
  assert.equal(f.sha256,hash(bytes));assert.equal(f.bytes,bytes.length);assert.equal(f.upload_sha256,hash(fs.readFileSync(path.join(root,f.path))));
  if(JSON.stringify(raw)!==JSON.stringify(clean))redacted++;
  for(const item of [...clean.vocabulary,...clean.languagePractice])for(const key of ['answerIndex','sourceAnswer','meaning','explanation','variants','referenceAnswer','criteria','masteryCriteria'])assert.equal(Object.hasOwn(item,key),false);
  for(const item of clean.studyGuide)for(const key of ['referenceAnswer','explanation'])assert.equal(Object.hasOwn(item,key),false);
 }
 assert(redacted>=77);assert.equal(on.files.find(f=>f.path==='index.html').sha256,off.files.find(f=>f.path==='dialogue.html').sha256);
 assert.deepEqual(on.files.filter(f=>f.path!=='index.html'),off.files.filter(f=>f.path!=='index.html'));
 assert.equal(off.provider_only_files.length,3);
});
for(const [name,change]of[['wrong lesson',v=>({...v,lessonId:'lesson-wrong'})],['wrong schema',v=>({...v,schemaVersion:9})],['missing version',v=>({...v,curriculumVersion:null})]])test('actual loader rejects '+name,async()=>{
 const index=JSON.parse(fs.readFileSync(path.join(root,'dialogue-curriculum/index.json'))),id=index.lessons[0].lessonId;
 await assert.rejects(()=>loadDialogueCurriculum({ASSETS:{fetch:async req=>{const r=await asset(req);if(new URL(req.url).pathname.endsWith('/index.json'))return r;return new Response(JSON.stringify(change(await r.json())))}}},id));
});
test('actual loader rejects a non-index lesson rather than returning arbitrary bytes',async()=>{
 await assert.rejects(()=>loadDialogueCurriculum({ASSETS:{fetch:asset}},'lesson-not-in-authority'),/lesson_not_available/);
});
