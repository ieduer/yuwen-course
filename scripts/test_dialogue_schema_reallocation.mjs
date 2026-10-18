import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {E2ERunner} from './dialogue_e2e.mjs';
import {acceptanceEnvironment} from '../site/dialogue-acceptance.js';
import {isolatedDialogueAdmission,dialogueCallAdmission} from '../site/dialogue-e2e-admission.js';
import {FULL_OPERATION,FULL_E2E_OPERATION,ORIGINAL_RECEIPTS,QUOTE_RECOVERY,TIMEOUT_RECOVERY,CASE2_RECOVERY,CASE2_QUOTE_RECOVERY,CASE2_FINITE_RECOVERY,CASE23_RECOVERY,CASE23_SCHEMA_RECOVERY} from '../site/dialogue-full-language.js';
import packet from '../site/dialogue-full-language-packet.json' with {type:'json'};
const H='a'.repeat(64),version='9f0d3759-d74e-4dc4-8879-f7be61ae79e6',origin='https://yw-acceptance.bdfz.net',database='c45988a6-9094-4306-bcce-98704b3989e3',at=Date.parse('2026-10-18T14:50:00Z');
const chain=[QUOTE_RECOVERY,TIMEOUT_RECOVERY,CASE2_RECOVERY,CASE2_QUOTE_RECOVERY,CASE2_FINITE_RECOVERY,CASE23_RECOVERY,CASE23_SCHEMA_RECOVERY];
function fixture(count=7,cap=count===7?119:120){
 const full={version:'yw-full-language-activation-v1',enabled:true,operation:FULL_OPERATION,authorityDigest:H,packetDigest:packet.sourceDigest,sourceCommit:'b'.repeat(40),artifactSha256:H,origin,ownerUserId:553,databaseId:database,apisVersion:version,registryReceiptDigest:H,singleProviderSourceProofDigest:H,priorReceiptSetDigest:H,priorReceipts:ORIGINAL_RECEIPTS,readyAt:'2026-10-18T07:14:55.135Z',hardExpiry:'2026-10-18T15:00:00.000Z',maxAttempts:28+count,maxReservedMicros:(28+count)*84000,maxProviderAttempts:1,reserveMicros:84000,maxConcurrency:1,recoveryReadbacks:chain.slice(0,count)};
 const pin={version:'yw-isolated-e2e-admission-v2',enabled:true,operation:FULL_E2E_OPERATION,authorityDigest:H,origin,ownerUserId:553,databaseId:database,apisVersion:version,registryReceiptDigest:H,hardExpiry:full.hardExpiry,maxVisibleCalls:cap,maxProviderAttempts:3,reserveMicros:252000,lessonIds:['lesson-1498','lesson-1711-p1','lesson-1717-p2']};
 const noIO=()=>{throw Error('no_io');};
 const env=acceptanceEnvironment(new Request(origin),{ASSETS:{fetch:noIO},ACCEPTANCE_DB:{prepare:noIO},APIS:{fetch:noIO},APIS_CALLER_TOKEN:'synthetic-caller-only',USER_CENTER_EVIDENCE:{resolveSession:noIO},YW_ACCEPTANCE_USER_ID:'553',YW_FORMAL_APIS_VERSION:version,YW_ACCEPTANCE_DATABASE_ID:database,YW_ACCEPTANCE_ACTIVATION_SHA256:H,YW_ACCEPTANCE_EXPIRES_AT:full.hardExpiry,YW_CALIBRATION_FULL_LANGUAGE_JSON:JSON.stringify(full),YW_FULL_LANGUAGE_ACTIVATION_SHA256:H,YW_E2E_AUTHORITY_JSON:JSON.stringify(pin)},at);
 const budget={model:'gemini-3.8-flash',logicalProviderAttemptLimit:3,perAttemptReserveMicros:84000,reserveMicros:252000};
 return{full,pin,env,budget,admit:()=>isolatedDialogueAdmission(env,{ucUserId:553},'lesson-1498',budget,at)};
}
test('seven exact failure pins admit119 and preserve total154 logical cap',()=>{
 const f=fixture(),admission=f.admit();assert.equal(admission.maxVisibleCalls,119);assert.equal(f.full.maxAttempts+admission.maxVisibleCalls,154);assert.equal(f.full.maxAttempts+admission.maxVisibleCalls*3,392);assert(392<=394);
});
test('six-pin predecessor keeps120; mismatched caps fail closed',()=>{
 assert.equal(fixture(6).admit().maxVisibleCalls,120);
 for(const [count,cap]of [[7,120],[7,118],[6,119],[6,121]])assert.throws(()=>fixture(count,cap).admit(),/e2e_renewal_activation_invalid/);
});
test('actual SQL count projection admits119th and refuses120th across days; retained-failure gate stays closed',()=>{
 const f=fixture(),budget={...f.budget,isolatedAdmission:f.admit()};
 const condition=dialogueCallAdmission(budget,{id:1},{globalPerDay:400},'2026-10-18');
 assert(condition.sql.endsWith(' AND 0'),'missing retained failure evidence must still deny full admission');
 const sql=new DatabaseSync(':memory:');
 try{
  sql.exec('CREATE TABLE dialogue_calls(day TEXT,budget_policy_json TEXT)');
  const put=sql.prepare('INSERT INTO dialogue_calls VALUES(?,?)');
  for(let i=0;i<118;i++)put.run(i%2?'2026-10-17':'2026-10-18',JSON.stringify({isolatedAdmission:{operation:FULL_E2E_OPERATION}}));
  const countProjection=condition.sql.slice(0,-' AND 0'.length);
  assert.equal(sql.prepare('SELECT '+countProjection+' AS allowed').get(...condition.args).allowed,1);
  put.run('2026-10-18',JSON.stringify({isolatedAdmission:{operation:FULL_E2E_OPERATION}}));
  assert.equal(sql.prepare('SELECT '+countProjection+' AS allowed').get(...condition.args).allowed,0);
  assert.equal(sql.prepare('SELECT '+condition.sql+' AS allowed').get(...condition.args).allowed,0);
 }finally{sql.close();}
});
test('driver refuses a120th model intent before recording or transport; legacy120 remains available',async()=>{
 const events=Array.from({length:119},(_,i)=>[{type:'intent',possibleProvider:true,mutationId:String(i)},{type:'settled',mutationId:String(i)}]).flat();
 let recorded=0;
 const state={config:{maxVisibleCalls:119},events,emit:async()=>{recorded++;throw Error('intent_reached');}};
 await assert.rejects(()=>E2ERunner.prototype.mutate.call(state,'lesson-1498',{}, {possibleProvider:true}),/e2e_call_ceiling_exhausted/);assert.equal(recorded,0);
 state.config.maxVisibleCalls=120;
 await assert.rejects(()=>E2ERunner.prototype.mutate.call(state,'lesson-1498',{}, {possibleProvider:true}),/intent_reached/);assert.equal(recorded,1);
});
