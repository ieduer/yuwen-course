import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import worker from '../site/_worker.js';
import {callDialogueModel} from '../site/dialogue-source.js';
import {ACCEPTANCE_ORIGIN, acceptanceEnvironment, acceptanceContext, createAcceptanceWorker} from '../site/dialogue-acceptance.js';

const entry = createAcceptanceWorker(worker);
const version = '11111111-2222-4333-8444-555555555555';
const request = (path='/api/dialogue/v1?lessonId=lesson-1717-p2', init={}) => new Request(ACCEPTANCE_ORIGIN+path, init);
function fixture(t) {
  const sql = new DatabaseSync(':memory:');
  for (const name of fs.readdirSync('migrations').filter(x=>x.endsWith('.sql')).sort()) sql.exec(fs.readFileSync('migrations/'+name,'utf8'));
  t.after(()=>sql.close());
  const calls = {db:0, identity:0, assets:0, model:0};
  const wrap=(text,args=[])=>({bind:(...values)=>wrap(text,values), first:async()=>sql.prepare(text).get(...args)||null,
    all:async()=>({results:sql.prepare(text).all(...args)}), run:async()=>({meta:{changes:Number(sql.prepare(text).run(...args).changes)}})});
  const user={sourceSiteKey:'yw',authenticated:true,userId:700001,slug:'synthetic-acceptance',displayName:'Synthetic'};
  const bindings={
    YW_ACCEPTANCE_EXPIRES_AT:new Date(Date.now()+3600000).toISOString(), YW_ACCEPTANCE_USER_ID:'700001',
    YW_ACCEPTANCE_APIS_VERSION:version, YW_ACCEPTANCE_DATABASE_ID:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    ACCEPTANCE_DB:{prepare:text=>{calls.db++;return wrap(text);}, batch:async statements=>Promise.all(statements.map(s=>s.run()))},
    ASSETS:{fetch:async req=>{calls.assets++;const pathname=new URL(req.url).pathname;
      if(pathname==='/dialogue.html')return new Response(null,{status:308,headers:{location:'/dialogue'}});
      return new Response(fs.readFileSync('site'+(pathname==='/dialogue'?'/dialogue.html':pathname)));}},
    USER_CENTER_EVIDENCE:{resolveSession:async()=>{calls.identity++;return user;},resolveNativeSession:async()=>({
      ...user,schemaVersion:'bdfz-native-auth/1',status:200,clientId:'yuwen-native-android',capability:'data',
    })},
    APIS_ACCEPTANCE:{fetch:async()=>{calls.model++;return new Response(null,{status:503});}},
  };
  const authenticated = (path,init={}) => request(path,{...init,headers:{cookie:'bdfz_uc_session=synthetic-'+crypto.randomUUID(),...init.headers}});
  return {sql,calls,bindings,user,authenticated};
}


import {CALIBRATION_CONTRACT as amendment} from '../site/dialogue-calibration-contract.js';
import {handleCalibration} from '../site/dialogue-calibration.js';
import packet from '../site/dialogue-calibration-packet.json' with {type:'json'};
const policy=JSON.parse(fs.readFileSync('docs/dialogue/budget-policy.json'));
// Reconstruct the recorded source, not today's curriculum, for the consumed
// operation's regression tests. The digest proves every restored field.
function recordedSource(id){
 const c=packet.cases.find(c=>c.lessonId===id),source=structuredClone(c.curriculum);
 for(const item of source.languagePractice||[])item.calibrationStatus='pending-real-model';
 assert.equal(createHash('sha256').update(JSON.stringify(source)).digest('hex'),c.sourceDigest);
 return source;
}

async function setup(t,{seed=true}={}){
 const f=fixture(t);f.bindings.YW_DIALOGUE_BUDGET_JSON=JSON.stringify(policy);
 const initial=await(await entry.fetch(f.authenticated(),f.bindings)).json();
 const id=f.sql.prepare('SELECT id FROM students WHERE uc_user_id=?').get(700001).id;
 const env=acceptanceEnvironment(f.authenticated(),f.bindings),student={id,ucUserId:700001};
 const priorId=amendment.priorOperation+':'+amendment.priorCase,priorSession=priorId+':session';
 if(seed){
  const at=amendment.priorCreatedAt,meta=JSON.stringify({syntheticOnly:true,caseId:amendment.priorCase,sourceDigest:amendment.priorSourceDigest,promptDigest:amendment.priorPromptDigest});
  f.sql.prepare('INSERT INTO dialogue_sessions(id,student_id,lesson_id,curriculum_version,curriculum_json,policy_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(priorSession,id,'calibration:lesson-1711-p1',amendment.priorOperation,meta,'yw-dialogue-policy-v5',at,at);
  f.sql.prepare('INSERT INTO dialogue_turns(id,session_id,mutation_id,request_hash,role,content,status,policy_version,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(priorId,priorSession,'original',amendment.priorPromptDigest,'student','Synthetic preserved failed original','synthetic_calibration','yw-dialogue-policy-v5',at);
  f.sql.prepare('INSERT INTO dialogue_calls(turn_id,session_id,student_id,day,reserved_tokens,state,created_at,reserved_micros,accounted_micros,budget_policy_json) VALUES(?,?,?,?,?,?,?,?,?,?)').run(priorId,priorSession,id,at.slice(0,10),2400,'review',at,84000,4678,JSON.stringify(policy));
  f.sql.prepare('INSERT INTO dialogue_events(id,session_id,turn_id,event_type,details_json,created_at) VALUES(?,?,?,?,?,?)').run(priorId+':result',priorSession,priorId,'synthetic_calibration_unconfirmed',JSON.stringify({reason:'missing_criterion',received:JSON.parse(fs.readFileSync('scripts/fixtures/dialogue-calibration-missing-criteria.json')).value}),at);
 }
 if(seed){
  const q=amendment.secondPrior,pid=q.operation+':'+q.caseId,sid=pid+':session',at=q.createdAt;
  f.sql.prepare('INSERT INTO dialogue_sessions(id,student_id,lesson_id,curriculum_version,curriculum_json,policy_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(sid,id,'calibration:lesson-1711-p1',q.operation,JSON.stringify({syntheticOnly:true,caseId:q.caseId,sourceDigest:q.sourceDigest,promptDigest:q.promptDigest}),'yw-dialogue-policy-v6',at,at);
  f.sql.prepare('INSERT INTO dialogue_turns(id,session_id,mutation_id,request_hash,role,content,status,policy_version,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(pid,sid,'second',q.promptDigest,'student','Synthetic preserved second','synthetic_calibration','yw-dialogue-policy-v6',at);
  f.sql.prepare('INSERT INTO dialogue_calls(turn_id,session_id,student_id,day,reserved_tokens,state,created_at,finished_at,reserved_micros,accounted_micros,budget_policy_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(pid,sid,id,at.slice(0,10),2400,q.state,at,q.finishedAt,q.reservedMicros,null,JSON.stringify(policy));
  f.sql.prepare('INSERT INTO dialogue_events(id,session_id,turn_id,event_type,details_json,created_at) VALUES(?,?,?,?,?,?)').run(pid+':result',sid,pid,'synthetic_calibration_unconfirmed',JSON.stringify({reason:q.reason,received:null,syntheticOnly:true,expectedVerdictMatches:false}),q.finishedAt);
 }
 const receiptFor=n=>{
  const row=f.sql.prepare("SELECT c.*,s.curriculum_json,e.details_json FROM dialogue_calls c JOIN dialogue_sessions s ON s.id=c.session_id LEFT JOIN dialogue_events e ON e.id=c.turn_id||':result' WHERE c.turn_id=?").get(amendment.operation+':attempt-'+n);
  return row?createHash('sha256').update(JSON.stringify({id:row.turn_id,state:row.state,reserved:row.reserved_micros,accounted:row.accounted_micros,created:row.created_at,finished:row.finished_at,source:row.curriculum_json,result:row.details_json})).digest('hex'):null;
 };
 if(seed)f.sql.prepare('UPDATE dialogue_calls SET finished_at=?,usage_json=? WHERE turn_id=?').run(amendment.priorFinishedAt,JSON.stringify(amendment.priorUsage),priorId);
 const req=(index=0,extra={},method='POST',attempt=index+1)=>f.authenticated('/api/dialogue/v1?lessonId='+packet.cases[index].lessonId+'&calibration='+packet.cases[index].id+'&attempt='+attempt,{method,headers:{origin:ACCEPTANCE_ORIGIN,'content-type':'application/json'},...(method==='POST'?{body:JSON.stringify({action:amendment.action,ownerRef:initial.ownerRef,...(attempt>1?{previousReceipt:receiptFor(attempt-1)}:{}),...extra})}:{})});
 env.ASSETS={fetch:async request=>Response.json(recordedSource(new URL(request.url).pathname.split('/').at(-1).replace(/\.json$/,'')))};
 return {...f,env,student,req,priorId,priorSession};
}
function response(index=0,demonstrated=true){
 const c=packet.cases[index],o=c.curriculum.objectives.find(o=>o.id===c.objectiveId),t=c.turns.at(-1),p=c.curriculum.passages[0];
 return {value:{reply:'你區分了語境關係。可以再說說句子如何支持這個判斷嗎？',assessments:demonstrated?[{objectiveId:o.id,outcome:'demonstrated',rationale:'Synthetic transport fixture only',evidence:o.criteria.map(criterion=>({criterion,turnId:t.id,quote:t.content,passageId:p.id,passageQuote:p.text.slice(0,10)}))}]:[]},model:policy.model,modelVersion:'synthetic',usage:{promptTokenCount:100,totalTokenCount:200},firstTokenMs:12,totalDurationMs:40};
}
test('calibration requires acceptance capability and fixed owner/input; no arbitrary prompts or reordering',async t=>{
 const f=await setup(t),model=()=>{throw Error('must not call')};
 assert.equal((await handleCalibration(f.req(),{...f.env},f.student,model)).status,404);
 assert.equal((await handleCalibration(f.req(),f.env,{...f.student,ucUserId:700002},model)).status,404);
 assert.equal((await handleCalibration(f.req(0,{prompt:'injected'}),f.env,f.student,model)).status,400);
 assert.equal((await handleCalibration(f.req(0,{ownerRef:'wrong'}),f.env,f.student,model)).status,400);
 assert.equal((await handleCalibration(f.req(1),f.env,f.student,model)).status,409);
 assert.equal(f.sql.prepare('SELECT count(*) n FROM dialogue_calls').get().n,2);
});
test('fixed case uses exact prompt and normal reservation, readback, partial persistence without scores; duplicate never retries',async t=>{
 const f=await setup(t);let calls=0;const model=async(env,prompt,id,onReply,budget)=>{calls++;assert.equal(prompt,packet.cases[0].prompt);assert.equal(budget.reserveMicros,84000);assert.equal(f.sql.prepare('SELECT state FROM dialogue_calls WHERE turn_id=?').get(id).state,'reserved');await onReply('你區分了語境關係。');return response();};
 const r=await handleCalibration(f.req(),f.env,f.student,model),v=await r.json();assert.equal(r.status,200);assert.equal(v.call.state,'finished');assert.equal(v.result.expectedVerdictMatches,true);assert.equal(v.result.semanticReviewRequired,true);assert.equal(v.chunks.length,1);
 assert.equal((await handleCalibration(f.req(),f.env,f.student,model)).status,200);assert.equal(calls,1);
 const read=await(await handleCalibration(f.req(0,{},'GET'),f.env,f.student,model)).json();assert.deepEqual(read,v);
 assert.equal(f.sql.prepare('SELECT count(*) n FROM dialogue_assessments').get().n,0);assert.equal(f.sql.prepare("SELECT count(*) n FROM dialogue_sessions WHERE lesson_id LIKE 'calibration:%'").get().n,3);
 assert.equal((await entry.fetch(f.authenticated('/api/dialogue/v1?lessonId=lesson-1711-p1'),f.bindings)).status,200,'normal session selector never adopts fixture');
});
for(const failure of ['throw','usage','model','verdict'])test('failure '+failure+' is retained and reconciled before continuation',async t=>{
 const f=await setup(t);let calls=0;const model=async()=>{calls++;if(failure==='throw')throw Error('unknown');const r=response(0,failure!=='verdict');if(failure==='usage')r.usage=null;if(failure==='model')r.model='wrong';return r;};
 const r=await handleCalibration(f.req(),f.env,f.student,model);assert.equal(r.status,409);const v=await r.json();assert.equal(v.call.state,'review');assert.equal(v.call.reserved_micros,84000);
 assert.equal((await handleCalibration(f.req(),f.env,f.student,model)).status,409);assert.equal(calls,1);
 assert.equal((await handleCalibration(f.req(1,{previousReceipt:'bad'}),f.env,f.student,model)).status,409);assert.equal(calls,1);
 const next=await handleCalibration(f.req(1),f.env,f.student,async()=>{calls++;return response(1,false);});
 assert.equal(next.status,failure==='model'?409:200);assert.equal(calls,failure==='model'?1:2);
});
test('real source drift stops before reservation; packet does not mark source accepted',async t=>{
 const f=await setup(t);f.env.ASSETS={fetch:async()=>Response.json({wrong:true})};assert.equal((await handleCalibration(f.req(),f.env,f.student,()=>{throw Error('no')})).status,409);assert.equal(f.sql.prepare('SELECT count(*) n FROM dialogue_calls').get().n,2);
 const original=JSON.parse(fs.readFileSync('site/dialogue-curriculum/lesson-1711-p1.json'));assert(original.languagePractice.every(v=>v.calibrationStatus==='pending-real-model'));
});
test('operation deadline survives a new request and prevents the next model call',async t=>{
 const f=await setup(t);assert.equal((await handleCalibration(f.req(),f.env,f.student,async()=>response())).status,200);
 f.sql.prepare("UPDATE dialogue_sessions SET created_at='2020-01-01T00:00:00Z' WHERE id=?").run(amendment.operation+':intent');assert.equal((await handleCalibration(f.req(1),f.env,f.student,()=>{throw Error('no')})).status,409);
});

test('duplicate concurrent POST reserves at most one provider attempt',async t=>{
 const f=await setup(t);let calls=0;const model=async()=>{calls++;return response();};
 await Promise.all([handleCalibration(f.req(),f.env,f.student,model),handleCalibration(f.req(),f.env,f.student,model)]);assert.equal(calls,1);assert.equal(f.sql.prepare('SELECT count(*) n FROM dialogue_calls').get().n,3);
});
test('cost reserve and expiry remain enforced',async t=>{
 const f=await setup(t);const blocked=()=>{throw Error('no')};
 f.env.YW_DIALOGUE_BUDGET_JSON=JSON.stringify({...policy,reserveMicros:84001});assert.equal((await handleCalibration(f.req(),f.env,f.student,blocked)).status,503);
 const now=Date.now(),expired=acceptanceEnvironment(f.authenticated(),{...f.bindings,YW_ACCEPTANCE_EXPIRES_AT:new Date(now+1000).toISOString()},now);t.mock.method(Date,'now',()=>now+1001);assert.equal((await handleCalibration(f.req(),expired,f.student,blocked)).status,404);
});

test('both consumed packets remain byte pinned and new packet reproduces exact current source',async()=>{
 const {calibrationPacket}=await import('./dialogue_calibration.mjs');
 assert.equal(createHash('sha256').update(fs.readFileSync('scripts/fixtures/dialogue-calibration-stopped-packet.json')).digest('hex'),'3abb6baa1af51b56d8a17013568f7b8a40fd1d61fdfb71c28bfca2f7e72f2ff7');
 assert.equal(createHash('sha256').update(fs.readFileSync('scripts/fixtures/dialogue-calibration-amendment1-packet.json')).digest('hex'),'2f106a61cbc381f40bde2824037c22207b98333cb28b5dbfec258d24ea190274');
 const generated=JSON.parse(JSON.stringify(calibrationPacket(JSON.parse(fs.readFileSync('scripts/dialogue-calibration-cases.json')),id=>JSON.parse(fs.readFileSync('site/dialogue-curriculum/'+id+'.json')),policy)));
 assert.deepEqual(packet,generated);assert.equal(packet.sourceDigest,'4fb2ac792516d95c00022ad08bda42063e8606bec4989b3d46bc6b86c6a67317');
});

for(const corruption of ['absent','cost','state','owner','source','reason','extra-original'])test('amendment refuses '+corruption+' parent receipt without model call',async t=>{
 const f=await setup(t,{seed:corruption!=='absent'});let calls=0;
 if(corruption==='cost')f.sql.prepare('UPDATE dialogue_calls SET accounted_micros=0').run();
 if(corruption==='state')f.sql.prepare("UPDATE dialogue_calls SET state='finished'").run();
 if(corruption==='owner')f.sql.prepare('UPDATE dialogue_calls SET student_id=999').run();
 if(corruption==='source')f.sql.prepare("UPDATE dialogue_sessions SET curriculum_json='{}' WHERE id=?").run(f.priorSession);
 if(corruption==='reason')f.sql.prepare("UPDATE dialogue_events SET details_json='{}'").run();
 if(corruption==='extra-original'){f.sql.prepare("INSERT INTO dialogue_turns(id,session_id,mutation_id,request_hash,role,content,status,policy_version,created_at) SELECT id||':extra',session_id,mutation_id||':extra',request_hash,role,content,status,policy_version,created_at FROM dialogue_turns WHERE id=?").run(f.priorId);f.sql.prepare('INSERT INTO dialogue_calls(turn_id,session_id,student_id,day,reserved_tokens,state,created_at,finished_at,reserved_micros,accounted_micros,budget_policy_json) SELECT turn_id||?,session_id,student_id,day,reserved_tokens,state,created_at,finished_at,reserved_micros,accounted_micros,budget_policy_json FROM dialogue_calls WHERE turn_id=?').run(':extra',f.priorId);}
 const result=await handleCalibration(f.req(),f.env,f.student,async()=>{calls++;return response();});assert.equal(result.status,409);assert.equal(calls,0);
});
test('amendment preserves failed prior rows byte-for-byte and old action cannot launch continuation',async t=>{
 const f=await setup(t),snapshot=()=>JSON.stringify({call:f.sql.prepare('SELECT * FROM dialogue_calls WHERE turn_id=?').get(f.priorId),event:f.sql.prepare('SELECT * FROM dialogue_events WHERE id=?').get(f.priorId+':result')});const before=snapshot();
 assert.equal((await handleCalibration(f.req(0,{action:'calibration'}),f.env,f.student,()=>{throw Error('no')})).status,400);
 const r=await handleCalibration(f.req(),f.env,f.student,async()=>response());assert.equal(r.status,200);assert.equal(snapshot(),before);
 const v=await r.json();assert.equal(v.prior.accountedMicros,4678);assert.equal(v.amendment.maxTotalAttempts,26);
 assert.equal(f.sql.prepare('SELECT SUM(reserved_micros) n FROM dialogue_calls').get().n,252000);
});

test('24 new attempts plus both prior failures exhaust the cumulative allowance',async t=>{
 const f=await setup(t);let calls=0;
 for(let i=0;i<24;i++){
  const r=await handleCalibration(f.req(i),f.env,f.student,async()=>{calls++;return response(i,packet.cases[i].expected==='demonstrated');});assert.equal(r.status,i===22?409:200,'case '+i); // Fixture omits required conclusion: retain rejection and continue.
 }
 const sums=f.sql.prepare('SELECT COUNT(*) n,SUM(reserved_micros) micros FROM dialogue_calls').get();assert.equal(sums.n,26);assert.equal(sums.micros,2184000);assert.equal(calls,24);
 assert.equal((await handleCalibration(f.req(23,{},'POST',25),f.env,f.student,()=>{throw Error('no')})).status,400);
});

for(const corruption of ['absent','accounted','usage','finished','owner','source','reason','extra'])test('second prior receipt rejects '+corruption,async t=>{
 const f=await setup(t),id=amendment.secondPrior.operation+':'+amendment.secondPrior.caseId;
 if(corruption==='absent')f.sql.prepare('DELETE FROM dialogue_events WHERE turn_id=?').run(id);
 if(corruption==='accounted')f.sql.prepare('UPDATE dialogue_calls SET accounted_micros=0 WHERE turn_id=?').run(id);
 if(corruption==='usage')f.sql.prepare("UPDATE dialogue_calls SET usage_json='{}' WHERE turn_id=?").run(id);
 if(corruption==='finished')f.sql.prepare("UPDATE dialogue_calls SET finished_at='wrong' WHERE turn_id=?").run(id);
 if(corruption==='owner')f.sql.prepare('UPDATE dialogue_calls SET student_id=999 WHERE turn_id=?').run(id);
 if(corruption==='source')f.sql.prepare("UPDATE dialogue_sessions SET curriculum_json='{}' WHERE id=?").run(id+':session');
 if(corruption==='reason')f.sql.prepare("UPDATE dialogue_events SET details_json='{}' WHERE turn_id=?").run(id);
 if(corruption==='extra'){
  f.sql.prepare("INSERT INTO dialogue_turns(id,session_id,mutation_id,request_hash,role,content,status,policy_version,created_at) SELECT id||':extra',session_id,mutation_id||':extra',request_hash,role,content,status,policy_version,created_at FROM dialogue_turns WHERE id=?").run(id);
  f.sql.prepare("INSERT INTO dialogue_calls(turn_id,session_id,student_id,day,reserved_tokens,state,created_at,reserved_micros,budget_policy_json) SELECT turn_id||':extra',session_id,student_id,day,reserved_tokens,state,created_at,reserved_micros,budget_policy_json FROM dialogue_calls WHERE turn_id=?").run(id);
 }
 let calls=0;assert.equal((await handleCalibration(f.req(),f.env,f.student,async()=>{calls++;return response();})).status,409);assert.equal(calls,0);
});
test('diagnosed semantic recovery is a new charged attempt; original never changes',async t=>{
 const f=await setup(t);let calls=0;
 const first=await(await handleCalibration(f.req(),f.env,f.student,async()=>{calls++;const r=response();r.value.assessments[0].evidence.pop();return r;})).json();assert.equal(first.result.reason,'missing_criterion');
 const second=await(await handleCalibration(f.req(0,{},'POST',2),f.env,f.student,async()=>{calls++;return response();})).json();assert.equal(second.call?.state,'finished',JSON.stringify(second));assert.equal(second.totals.attempts,4);assert.equal(calls,2);
 const original=await(await handleCalibration(f.req(0,{},'GET'),f.env,f.student,()=>{throw Error('no')})).json();assert.equal(original.receiptDigest,first.receiptDigest);
 assert.equal((await handleCalibration(f.req(0,{},'POST',3),f.env,f.student,()=>{throw Error('no')})).status,409);
});
test('unknown provider outcomes cannot be retried even with a receipt',async t=>{
 const f=await setup(t);let calls=0;await handleCalibration(f.req(),f.env,f.student,async()=>{calls++;throw Error('gateway_unavailable');});
 assert.equal((await handleCalibration(f.req(0,{},'POST',2),f.env,f.student,()=>{calls++;throw Error('no')})).status,409);assert.equal(calls,1);
});
test('hard expiry cannot be extended by environment or replay',async t=>{
 const f=await setup(t);t.mock.method(Date,'now',()=>Date.parse(amendment.hardExpiry)+1);
 assert.equal((await handleCalibration(f.req(),f.env,f.student,()=>{throw Error('no')})).status,404);
});
for(const status of [401,403,429])test('gateway '+status+' is a durable boundary stop',async t=>{
 const f=await setup(t);f.env.APIS.fetch=async()=>new Response(null,{status});
 const v=await(await handleCalibration(f.req(),f.env,f.student,callDialogueModel)).json();assert.equal(v.result.boundaryStop,true);
 assert.equal((await handleCalibration(f.req(1),f.env,f.student,()=>{throw Error('no')})).status,409);
});

test('concurrent recovery and next case cannot bind one attempt to two prompts',async t=>{
 const f=await setup(t);await handleCalibration(f.req(),f.env,f.student,async()=>response(0,false));let calls=0;
 const results=await Promise.all([0,1].map(i=>handleCalibration(f.req(i,{},'POST',2),f.env,f.student,async(env,prompt,id)=>{
  calls++;const stored=f.sql.prepare('SELECT curriculum_json FROM dialogue_sessions WHERE id=?').get(id+':session');assert.equal(JSON.parse(stored.curriculum_json).promptDigest,createHash('sha256').update(JSON.stringify(prompt)).digest('hex'));return response(i,i===0);
 })));
 assert.equal(calls,1);assert.equal(results.filter(r=>r.status===200).length,1);
});
