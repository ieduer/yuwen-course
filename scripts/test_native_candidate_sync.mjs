import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCandidateIdentity} from './check_native_content_deploy_sync.mjs';
const graph={semanticDigest:'sha256:'+'a'.repeat(64),contentVersion:'yw-'+ 'a'.repeat(24),counts:{lessons:189,annotations:2932}};
const pointer={...graph,schemaVersion:'yw-native-content-pointer-v1',siteKey:'yw',appDisposition:'blocked',deploymentId:null,publishedAt:null,sourceClean:true,sourceRevision:'b'.repeat(40)};
test('exact blocked candidate is local-verifiable without pretending it is published',()=>validateCandidateIdentity(pointer,graph));
for(const [key,value] of Object.entries({semanticDigest:'sha256:'+'c'.repeat(64),contentVersion:'yw-stale',counts:{lessons:188},appDisposition:'compatible-and-synced',deploymentId:'made-up',publishedAt:'2026-10-15T00:00:00Z',sourceClean:false,sourceRevision:'HEAD',siteKey:'other'})) {
  test(`reject candidate drift or false authority at ${key}`,()=>assert.throws(()=>validateCandidateIdentity({...pointer,[key]:value},graph)));
}
