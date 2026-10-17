import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {loadFixtures,loadCurriculum,preparePlan,countPaths,selectAnswer,validateFixture,validateExecutionConfig,E2ERunner,assertComplete,hash,ORIGIN,OPERATION,CAPS,ROOT} from './dialogue_e2e.mjs';
const fixtures=loadFixtures(),plan=preparePlan(),clock=()=>Date.parse('2026-10-13T03:00:00Z');
const owner='a'.repeat(64),id='lesson-1717-p2',c=loadCurriculum(id),s=fixtures.lessons[id];
const config=()=>({operation:OPERATION,origin:ORIGIN,planDigest:hash(plan),fixtureDigest:plan.fixtureDigest,expiresAt:CAPS.hardExpiry,ownerRef:owner,sourceCommit:'synthetic-offline-test-only',pagesDeploymentId:'synthetic',isolatedDatabaseId:'synthetic',apisVersion:'synthetic',syntheticOnly:true,centralWritesDisabled:true,checks:Object.fromEntries(['staticChecks','ci','isolatedSourceReadback','sameOwnerAuthentication','providerAttemptContract','isolated120AdmissionReadback'].map(k=>[k,'accepted'])),isolatedAdmission:{...plan.isolatedAdmission,origin:ORIGIN,ownerRef:owner,databaseId:'synthetic',apisVersion:'synthetic',registryReceiptDigest:'b'.repeat(64)},lessonIds:[id],providerAttemptLimit:3,reserveMicrosPerCall:252000,maxVisibleCalls:120,maxReserveMicros:30240000});
test('all three authored lessons cover exact current objectives, original fields and grounded source anchors',()=>{
 assert.deepEqual(Object.keys(fixtures.lessons),['lesson-1717-p2','lesson-1711-p1','lesson-1498']);
 for(const [id,s]of Object.entries(fixtures.lessons))assert(validateFixture(loadCurriculum(id),s));
 assert.equal(Object.values(fixtures.lessons).reduce((n,s)=>n+Object.keys(s.vocabulary).length+Object.keys(s.language).length,0),27);
});
test('nine exact pending language objectives are blockers, never upgraded by E2E fixtures',()=>{
 const blockers=plan.lessons.flatMap(l=>l.calibrationBlockers);assert.equal(blockers.length,9);
 assert(blockers.every(b=>b.itemVersion.startsWith('yw-language-')&&b.calibrationStatus==='pending-real-model'));
 assert.equal(plan.lessons.flatMap(l=>l.sourceBlockers).length,0);
 assert.equal(plan.readiness,'blocked_by_exact_language_calibration');
 const cfg=config();cfg.lessonIds=['lesson-1711-p1'];assert.throws(()=>validateExecutionConfig(cfg,plan,clock()),/language_calibration_required/);
});
test('44 first-pass calls fit trusted operation120, not ordinary40;152 remediation calls still exceed120',()=>{
 assert.equal(plan.budget.firstPassCallRows,44);assert.equal(plan.budget.boundedRemediationCallRows,152);
 assert.equal(plan.budget.firstPassFits120,true);assert.equal(plan.budget.remediationFits120,false);
 assert.equal(plan.budget.firstPassFitsOrdinaryDailyCount,false);assert.equal(plan.budget.firstPassFitsTrustedIsolatedOperationCount,true);
 assert.equal(plan.isolatedAdmission.ordinaryDailyLimit,40);assert.equal(plan.isolatedAdmission.globalDailyLimit,400);
 assert.equal(plan.isolatedAdmission.status,'trusted-activation-readback-required-not-established-by-offline-plan');assert.equal(CAPS.totalReserveMicros,120*3*84000);
});
test('long128/132 are student-turn cores, not provider counts; exact source evaluator distinguishes zero-provider guides',()=>{
 const a=countPaths(loadCurriculum('lesson-1477')),b=countPaths(loadCurriculum('lesson-1534'));
 assert.deepEqual([a.prior128Or132Core,b.prior128Or132Core],[128,132]);
 assert.deepEqual([a.boundedRemediationStudentTurns,b.boundedRemediationStudentTurns],[130,134]);
 assert.deepEqual([a.boundedRemediationCallRows,b.boundedRemediationCallRows],[90,91]);
 assert.deepEqual([a.exactReferenceDeterministicGuides,b.exactReferenceDeterministicGuides],[21,1]);
 assert.deepEqual([a.boundedRemediationProviderCallsRange,b.boundedRemediationProviderCallsRange],[[69,90],[90,91]]);
});
test('first-read fixture uses actual UTF16 offsets, three non-overlapping marks and retained independent guesses',()=>{
 const id='lesson-1711-p1',s=fixtures.lessons[id],a=JSON.parse(fs.readFileSync(`${ROOT}/site/data/classical-first-read/${id}.json`));
 assert.equal(s.firstRead.textVersionId,a.textVersionId);assert.equal(s.firstRead.textDigest,a.textDigest);
 const marks=s.firstRead.marks;assert.equal(marks.length,3);
 for(const m of marks){assert.equal(a.paragraphs.find(p=>p.key===m.paragraphKey).text.slice(m.startOffset,m.endOffset),m.selectedText);assert.notEqual(m.guess,m.correction);}
 for(let i=0;i<marks.length;i++)for(let j=i+1;j<marks.length;j++)assert(marks[i].paragraphKey!==marks[j].paragraphKey||marks[i].endOffset<=marks[j].startOffset||marks[j].endOffset<=marks[i].startOffset);
});
test('typed formal fields send only ordinary learner content and no assessment proposals',()=>{
 const o=c.objectives.find(o=>o.legacy?.questionKind==='revision');
 for(const field of ['original','action','revised','reason']){const selected=selectAnswer({learningTurn:{taskId:'server-owned',kind:'formal',objectiveId:o.id,field}},c,s);assert.equal(selected.body.content,s.formal.revision[field]);assert.equal(selected.possibleProvider,field==='reason');assert.deepEqual(Object.keys(selected.body),['taskId','content']);}
});
test('vocabulary independent answer needs issued identity; source option selection preserves written explanation',()=>{
 const id='lesson-1498',c=loadCurriculum(id),s=fixtures.lessons[id],v=c.vocabulary[0];
 assert.throws(()=>selectAnswer({learningTurn:{kind:'dialogue',objectiveId:v.id}},c,s),/independent_question_not_issued/);
 const independent=selectAnswer({learningTurn:{taskId:'task',kind:'dialogue',objectiveId:v.id,questionId:'issued'},question:{id:'issued',objectiveId:v.id}},c,s);
 assert(independent.body.content.includes(s.vocabulary[v.id].answer));assert(!('answerIndex'in independent.body));
 const choice=selectAnswer({learningTurn:{taskId:'source-task',kind:'vocabulary',itemId:v.id,options:v.options,prompt:v.question}},c,s);
 assert.equal(choice.body.selectedIndex,v.answerIndex);assert.equal(choice.body.content,s.vocabulary[v.id].answer);assert.equal(choice.possibleProvider,false);
});
test('source drift and missing authored answers fail before execution',()=>{
 const changed=structuredClone(c);changed.sourceInventory.readerSha256='changed';assert.throws(()=>validateFixture(changed,s),/fixture_reader_drift/);
 const metadata=structuredClone(c);metadata.curriculumVersion='changed';assert.throws(()=>validateFixture(metadata,s),/fixture_curriculum_version_drift/);
 const missing=structuredClone(s);delete missing.formal.revision.reason;assert.throws(()=>validateFixture(c,missing),/fixture_formal_field_missing/);
});
test('execution receipt rejects formal host, missing checks, changed cap and invalid or expired deadlines',()=>{
 assert(validateExecutionConfig(config(),plan,clock()));
 for(const change of [{origin:'https://yw.bdfz.net'},{maxVisibleCalls:121},{expiresAt:'not-a-date'},{expiresAt:'2026-10-13T02:00:00Z'},{checks:{}}])assert.throws(()=>validateExecutionConfig({...config(),...change},plan,clock()));
});
test('trusted120 requires exact root readback receipt; accepted checks alone cannot broaden or mint admission',()=>{
 const absent=config();delete absent.isolatedAdmission;assert.throws(()=>validateExecutionConfig(absent,plan,clock()),/isolated_admission_receipt_not_exact/);
 for(const change of [{authorityDigest:'c'.repeat(64)},{ownerRef:'c'.repeat(64)},{databaseId:'different'},{apisVersion:'different'},{registryReceiptDigest:'missing'},{hardExpiry:'2026-10-15T12:00:00Z'},{maxVisibleCalls:121},{maxProviderAttempts:4},{reserveMicros:1},{lessonIds:[...plan.isolatedAdmission.lessonIds,'lesson-1477']},{lessonIds:120}]){
  const cfg=config();Object.assign(cfg.isolatedAdmission,change);assert.throws(()=>validateExecutionConfig(cfg,plan,clock()),/isolated_admission_receipt_not_exact/);
 }
});
test('independent source block remains distinct even when semantic calibration is hypothetically accepted',()=>{
 const blocked=structuredClone(plan);blocked.lessons.find(l=>l.lessonId===id).sourceBlockers=[{objectiveId:'synthetic-pending-source'}];
 const cfg=config();cfg.planDigest=hash(blocked);assert.throws(()=>validateExecutionConfig(cfg,blocked,clock()),/language_source_review_required/);
});
test('fresh preflight fails closed on previous session; no history reset or POST is attempted',async()=>{
 let calls=0;const events=[];
 const runner=new E2ERunner({config:config(),plan,clock,cookie:'bdfz_uc_session=synthetic-offline-only',record:e=>events.push(e),fetchImpl:async url=>{calls++;return new Response(JSON.stringify(url.includes('dialogue-curriculum')?loadCurriculum(id):{ownerRef:owner,turns:[],sessionId:'prior-session'}));}});
 await assert.rejects(runner.preflight(),/existing_records_preserved/);assert.equal(calls,2);assert.equal(events.length,0);
});
test('even unfinished first-read source rows remain untouched during fresh-run preflight',async()=>{
 let posted=false;
 const runner=new E2ERunner({config:config(),plan,clock,cookie:'bdfz_uc_session=synthetic-offline-only',record:()=>{},fetchImpl:async(url,options)=>{posted ||= options.method==='POST';return new Response(JSON.stringify(url.includes('dialogue-curriculum')?loadCurriculum(id):{ownerRef:owner,turns:[],legacy:{records:0,firstRead:[{submitted_at:null,summary_text:''}]}}));}});
 await assert.rejects(runner.preflight(),/existing_records_preserved/);assert.equal(posted,false);
});
test('intent is durable before POST; transport failure does readback only and never retries provider call',async()=>{
 const journal=[],runner=new E2ERunner({config:config(),plan,clock,cookie:'bdfz_uc_session=synthetic-offline-only',record:e=>journal.push(e),delay:async()=>{},fetchImpl:async(_url,opt)=>{if(opt.method==='POST'){assert.equal(journal[0].type,'intent');throw Error('synthetic_network_loss');}return new Response(JSON.stringify({ownerRef:owner,turns:[],pending:false}));}});
 await assert.rejects(runner.mutate(id,{taskId:'normal',content:'這是合成作答',revision:0},{possibleProvider:true}),/outcome_unknown/);
 assert.equal(journal.filter(e=>e.type==='intent').length,1);assert(journal.some(e=>e.type==='readback'));assert(!journal.some(e=>e.type==='settled'));
 await assert.rejects(runner.mutate(id,{content:'禁止自動再送'},{possibleProvider:true}),/outcome_unknown/);
});
test('120 prior call intents stop the next call and reserve cannot reset inside runner',async()=>{
 const events=Array.from({length:120},(_,i)=>[{type:'intent',possibleProvider:true,mutationId:String(i)},{type:'settled',mutationId:String(i)}]).flat();let fetched=0;
 const runner=new E2ERunner({config:config(),plan,clock,events,cookie:'bdfz_uc_session=synthetic-offline-only',record:()=>{},fetchImpl:async()=>{fetched++;}});
 await assert.rejects(runner.mutate(id,{content:'不可超額'},{possibleProvider:true}),/e2e_call_ceiling_exhausted/);assert.equal(fetched,0);
});
test('complete result requires every source receipt and all objective confirmations; no optimistic final verdict',()=>{
 assert.throws(()=>assertComplete({state:{completion:'in_progress'}},c),/not_complete/);
 assert.throws(()=>assertComplete({state:{completion:'evidence_ready_for_review',hasConclusion:true,objectives:c.objectives.map(o=>({...o,status:'demonstrated'}))},sourceSubmissions:[]},c),/original_source_receipt_missing/);
});
test('same-owner mismatch never permits accepting readback from another account',async()=>{
 const runner=new E2ERunner({config:config(),plan,clock,cookie:'bdfz_uc_session=synthetic-offline-only',record:()=>{},fetchImpl:async()=>new Response(JSON.stringify({ownerRef:'b'.repeat(64),turns:[]}))});
 await assert.rejects(runner.snapshot(id),/same_owner_readback_failed/);
});

test('historical executable entrypoint is terminal even with missing config and journal',()=>{const r=spawnSync(process.execPath,['scripts/dialogue_e2e.mjs','execute','DO-NOT-READ','DO-NOT-CREATE','DO-NOT-READ'],{encoding:'utf8'});assert.notEqual(r.status,0);assert.match(r.stderr,/historical_operation_terminal/);assert(!fs.existsSync('DO-NOT-CREATE'));});
