import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {modePreflightQuery,verifyModePreflight,verifyPostDeploymentSnapshot} from './dialogue_mode_preflight.mjs';
import {loadModeCurriculum} from './dialogue_mode_sample.mjs';
import {projectModeSessionCurriculum} from './dialogue_session_compatibility.mjs';
import {sanitizeDialogueCurriculum} from '../site/dialogue-public-curriculum.js';
import {modeLedgerProjection} from '../site/dialogue-mode-admission.js';
const hash=c=>createHash('sha256').update(JSON.stringify(c)).digest('hex');
async function fixture(t){
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());sql.exec('PRAGMA foreign_keys=ON');
 for(const f of fs.readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())sql.exec(fs.readFileSync('migrations/'+f,'utf8'));
 sql.exec("INSERT INTO students(id,uc_slug,display_name,uc_user_id) VALUES(1,'synthetic-preflight','Synthetic',700001)");
 const at='2026-10-13T00:00:00Z',approvedLessons=[];
 for(const lessonId of ['lesson-1498','lesson-1578','lesson-1717-p2']){
  const current=loadModeCurriculum(lessonId),frozen=lessonId==='lesson-1717-p2'?JSON.parse(fs.readFileSync('scripts/fixtures/dialogue-historical-modern-curriculum.json')):current;
  const effective=await projectModeSessionCurriculum(current,frozen,{completed:false,pending:false});
  const entry={lessonId,allowNoSession:lessonId==='lesson-1578',frozenSourceDigest:hash(frozen),pin:{lessonId,curriculumVersion:effective.curriculumVersion,sourceDigest:hash(effective)}};
  if(!entry.allowNoSession){entry.sessionId='synthetic-'+lessonId;sql.prepare('INSERT INTO dialogue_sessions(id,student_id,lesson_id,curriculum_version,curriculum_json,policy_version,created_at,updated_at) VALUES(?,1,?,?,?,?,?,?)').run(entry.sessionId,lessonId,frozen.curriculumVersion,JSON.stringify(frozen),'old-policy',at,at);}
  approvedLessons.push(entry);
 }
 const sid=approvedLessons[0].sessionId;
 sql.prepare("INSERT INTO dialogue_turns(id,session_id,mutation_id,request_hash,role,content,status,policy_version,created_at) VALUES('prior-turn',?,'prior-mutation','prior-hash','student','SYNTHETIC preserved','needs_review','old-policy',?)").run(sid,at);
 sql.prepare("INSERT INTO dialogue_calls(turn_id,session_id,student_id,day,reserved_tokens,state,created_at,finished_at,reserved_micros,accounted_micros,budget_policy_json) VALUES('prior-turn',?,1,'2026-10-13',100,'review',?,?,84000,NULL,'{}')").run(sid,at,at);
 const expectedLedger=modeLedgerProjection(sql.prepare("SELECT c.*,s.student_id AS session_owner,s.curriculum_json,e.details_json FROM dialogue_calls c JOIN dialogue_sessions s ON s.id=c.session_id LEFT JOIN dialogue_events e ON e.id=c.turn_id||':result' ORDER BY c.turn_id").all());
 const query=modePreflightQuery(1,700001),read=()=>sql.prepare(query.sql).all(...query.params),options={ownerId:1,ucUserId:700001,expectedLedger,approvedLessons};
 return {sql,at,sid,query,read,options,verify:()=>verifyModePreflight(read(),options)};
}
test('one read-only SQL preserves complete ledger and binds existing and truly absent lesson states',async t=>{
 const f=await fixture(t),before=f.sql.prepare('SELECT total_changes() n').get().n,checked=await f.verify();
 assert.equal(checked.readyForRegistration,true);assert.equal(checked.executionAuthorized,false);assert.equal(checked.lessons.length,3);
 assert.equal(checked.lessons[1].baseline.session_id,null);assert(checked.lessons[2].curriculum.sessionSourceProjection);
 assert.equal(f.sql.prepare('SELECT total_changes() n').get().n,before);
 assert(!/\b(INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER)\b/i.test(f.query.sql));assert.equal(f.query.readOnly,true);
});
test('original unknown reservation is retained and omitting its row rejects registration',async t=>{
 const f=await fixture(t),rows=f.read();assert.equal(JSON.parse(rows.find(r=>r.kind==='ledger').payload).accounted_micros,null);
 await assert.rejects(verifyModePreflight(rows.filter(r=>r.kind!=='ledger'),f.options),/historical ledger/);
 const bad=structuredClone(rows),row=bad.find(r=>r.kind==='ledger'),v=JSON.parse(row.payload);v.accounted_micros=0;row.payload=JSON.stringify(v);
 await assert.rejects(verifyModePreflight(bad,f.options),/historical ledger/);
});
for(const kind of ['draft','issued','partial','inflight','conclusion','legacy-completion'])test('pre-deployment query detects '+kind+' and blocks without changing it',async t=>{
 const f=await fixture(t);
 if(kind==='draft')f.sql.prepare("INSERT INTO dialogue_drafts(id,session_id,mutation_id,request_hash,revision,content,created_at) VALUES('draft',?,'draft-mutation','hash',0,'unsent',?)").run(f.sid,f.at);
 if(kind==='issued')f.sql.prepare("INSERT INTO dialogue_questions(id,session_id,objective_id,attempt,instance_json,state,created_at) VALUES('issued',?,'old-question',1,'{}','issued',?)").run(f.sid,f.at);
 if(kind==='partial')f.sql.prepare("INSERT INTO dialogue_stream_chunks(turn_id,sequence,content,created_at) VALUES('prior-turn',1,'unconfirmed',?)").run(f.at);
 if(kind==='inflight')f.sql.prepare('UPDATE dialogue_sessions SET inflight=? WHERE id=?').run('prior-turn',f.sid);
 if(kind==='conclusion')f.sql.prepare("INSERT INTO dialogue_events(id,session_id,event_type,details_json,created_at) VALUES('conclusion',?,'conclusion_saved','{}',?)").run(f.sid,f.at);
 if(kind==='legacy-completion'){
  f.sql.prepare("INSERT INTO learning_interactions(source_event_id,student_id,academic_year,lesson_id,interaction_key,event_type,assessment_kind,scoring_role,resource_key,resource_version,registry_version,occurred_at) VALUES('completed',1,'2026-2027','lesson-1498','lessonCompleted','synthetic','self_report','none','old','v1','v1',?)").run(f.at);
  f.sql.prepare("INSERT INTO learning_evaluations(source_event_id,verification_method,eligibility_status,correctness,evaluated_at) VALUES('completed','synthetic','non_scoring','not_verified',?)").run(f.at);
 }
 const before=f.sql.prepare('SELECT total_changes() n').get().n;await assert.rejects(f.verify(),/unfinished|preserved work/);assert.equal(f.sql.prepare('SELECT total_changes() n').get().n,before);
});
test('owner mapping and affected revision are exact rather than guessed from a known account',async t=>{
 const f=await fixture(t);f.sql.prepare('UPDATE students SET uc_user_id=700002 WHERE id=1').run();await assert.rejects(f.verify(),/owner binding/);
 f.sql.prepare('UPDATE students SET uc_user_id=700001 WHERE id=1').run();f.options.approvedLessons[0].revision=1;await assert.rejects(f.verify(),/affected revision/);
});
test('unknown frozen sources and published-only modern pins are rejected before activation',async t=>{
 const f=await fixture(t);f.options.approvedLessons[2].frozenSourceDigest='0'.repeat(64);await assert.rejects(f.verify(),/unapproved frozen/);
});
test('existing historical state cannot be replaced by the simpler published curriculum pin',async t=>{
 const f=await fixture(t),c=loadModeCurriculum('lesson-1717-p2');f.options.approvedLessons[2].pin={lessonId:c.lessonId,curriculumVersion:c.curriculumVersion,sourceDigest:hash(c)};
 await assert.rejects(f.verify(),/effective contract differs/);
});
test('snapshot rechecks the preflight session, revision and pagination after deployment',async t=>{
 const f=await fixture(t),checked=await f.verify(),lesson=checked.lessons[0];
 const snapshot={ownerRef:checked.ownerRef,sessionId:lesson.baseline.session_id,curriculumVersion:lesson.curriculum.curriculumVersion,revision:0,turns:[{id:'prior-turn',sequence:lesson.baseline.max_sequence}],older:null,resumeCurriculum:sanitizeDialogueCurriculum(lesson.curriculum)};
 assert(verifyPostDeploymentSnapshot(snapshot,lesson,checked.ownerRef).verified);
 for(const mutate of [s=>s.revision++,s=>s.sessionId='new',s=>s.turns=[],s=>s.turns[0].sequence++,s=>s.older={sequence:1}]){const bad=structuredClone(snapshot);mutate(bad);assert.throws(()=>verifyPostDeploymentSnapshot(bad,lesson,checked.ownerRef));}
 const absent=checked.lessons[1],empty={ownerRef:checked.ownerRef,saved:false,revision:0,turns:[],older:null};assert(verifyPostDeploymentSnapshot(empty,absent,checked.ownerRef).verified);
 empty.sessionId='appeared';assert.throws(()=>verifyPostDeploymentSnapshot(empty,absent,checked.ownerRef));
});
