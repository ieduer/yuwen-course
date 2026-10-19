// No transport, credentials, activation or writes. Run the returned SELECT only
// under a separately approved finite read budget; compare before publication.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {MODE_LESSONS,modeLedgerProjection,modeLedgerDigest} from '../site/dialogue-mode-admission.js';
import {withCalibratedLanguage} from '../site/dialogue-calibration-status.js';
import {LIMITS} from '../site/dialogue-policy.js';
import {loadModeCurriculum} from './dialogue_mode_sample.mjs';
import {projectModeSessionCurriculum,validateSessionSnapshot} from './dialogue_session_compatibility.mjs';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const integer=value=>Number.isSafeInteger(value)&&value>0;
const flags=['drafts','issued_questions','partial_responses','conclusions','legacy_completions'];

export function modePreflightQuery(ownerId,ucUserId){
 assert(integer(ownerId)&&integer(ucUserId),'exact owner identities required');
 const columns=Object.keys(modeLedgerProjection([{}])[0]);
 const ledgerJson=columns.map(k=>`'${k}',p.${k}`).join(',');
 const sql=`WITH wanted(lesson_id) AS (VALUES (?),(?),(?)),
 owner AS (SELECT id,uc_user_id FROM students WHERE id=? AND uc_user_id=?),
 prior AS (SELECT c.*,s.student_id AS session_owner,s.curriculum_json,e.details_json FROM dialogue_calls c JOIN dialogue_sessions s ON s.id=c.session_id LEFT JOIN dialogue_events e ON e.id=c.turn_id||':result' ORDER BY c.turn_id LIMIT 2001)
 SELECT 'ledger' AS kind,p.turn_id AS item, json_object(${ledgerJson}) AS payload FROM prior p
 UNION ALL
 SELECT 'session',w.lesson_id,json_object(
 'lesson_id',w.lesson_id,'owner_id',o.id,'uc_user_id',o.uc_user_id,
 'session_id',s.id,'curriculum_version',s.curriculum_version,'curriculum_json',s.curriculum_json,'revision',s.revision,'inflight',s.inflight,
 'turn_count',(SELECT COUNT(*) FROM dialogue_turns t WHERE t.session_id=s.id),
 'max_sequence',(SELECT MAX(sequence) FROM dialogue_turns t WHERE t.session_id=s.id),
 'drafts',(SELECT COUNT(*) FROM dialogue_drafts d WHERE d.session_id=s.id AND d.submitted_turn_id IS NULL),
 'issued_questions',(SELECT COUNT(*) FROM dialogue_questions q WHERE q.session_id=s.id AND q.state='issued'),
 'partial_responses',(SELECT COUNT(*) FROM dialogue_turns t WHERE t.session_id=s.id AND t.id=(SELECT id FROM dialogue_turns WHERE session_id=s.id AND role='student' ORDER BY sequence DESC LIMIT 1) AND EXISTS(SELECT 1 FROM dialogue_stream_chunks c WHERE c.turn_id=t.id) AND NOT EXISTS(SELECT 1 FROM dialogue_turns r WHERE r.reply_to=t.id AND r.role='teacher')),
 'conclusions',(SELECT COUNT(*) FROM dialogue_events e WHERE e.session_id=s.id AND e.event_type='conclusion_saved'),
 'legacy_completions',(SELECT COUNT(*) FROM learning_interactions i JOIN learning_evaluations e ON e.source_event_id=i.source_event_id WHERE i.student_id=o.id AND i.lesson_id=w.lesson_id AND i.interaction_key='lessonCompleted' AND i.scoring_role='none' AND i.assessment_kind='self_report' AND e.eligibility_status='non_scoring'))
 FROM wanted w CROSS JOIN owner o LEFT JOIN dialogue_sessions s ON s.id=(SELECT id FROM dialogue_sessions WHERE student_id=o.id AND lesson_id=w.lesson_id ORDER BY created_at DESC,id DESC LIMIT 1)
 ORDER BY kind,item`;
 return {sql,params:[...MODE_LESSONS,ownerId,ucUserId],readOnly:true,maxRows:2004};
}

export async function verifyModePreflight(rows,{ownerId,ucUserId,expectedLedger,approvedLessons,loader=loadModeCurriculum}){
 assert(integer(ownerId)&&integer(ucUserId)&&Array.isArray(rows)&&rows.length<=2004,'bounded owner read required');
 assert(Array.isArray(expectedLedger)&&expectedLedger.length>0&&expectedLedger.length<=2000,'complete retained ledger required');
 assert.deepEqual(approvedLessons.map(p=>p.lessonId),MODE_LESSONS,'exact approved lesson order required');
 assert(rows.every(r=>['ledger','session'].includes(r.kind)&&typeof r.payload==='string'),'unexpected read result');
 const ledger=rows.filter(r=>r.kind==='ledger').map(r=>JSON.parse(r.payload));
 assert.deepEqual(modeLedgerProjection(ledger),modeLedgerProjection(expectedLedger),'historical ledger changed or missing');
 assert(ledger.every(r=>r.session_owner===ownerId&&['finished','review'].includes(r.state)&&r.finished_at&&Number.isSafeInteger(r.reserved_micros)&&r.reserved_micros>=0&&(r.accounted_micros===null||Number.isSafeInteger(r.accounted_micros)&&r.accounted_micros>=0&&r.accounted_micros<=r.reserved_micros)),'prior owner, nonterminal work or invalid accounting');
 const sessions=rows.filter(r=>r.kind==='session').map(r=>JSON.parse(r.payload));
 assert.equal(sessions.length,3,'missing owner binding or session coverage');
 assert.equal(new Set(sessions.map(s=>s.lesson_id)).size,3,'duplicate session read');
 const lessons=[];
 for(const allowed of approvedLessons){
  const s=sessions.find(s=>s.lesson_id===allowed.lessonId);assert(s&&s.owner_id===ownerId&&s.uc_user_id===ucUserId,'owner binding drift');
  assert(!s.inflight,'unfinished inflight work');
  for(const key of flags)assert(s[key]===0,'preserved work requires review: '+key);
  assert(Number.isSafeInteger(s.turn_count)&&s.turn_count>=0,'invalid turn count');
  assert(s.turn_count===0?s.max_sequence===null:integer(s.max_sequence),'invalid latest sequence');
  const published=loader(allowed.lessonId);let effective;
  if(s.session_id===null){
   assert(allowed.allowNoSession===true&&s.curriculum_json===null&&s.curriculum_version===null&&s.revision===null&&s.turn_count===0&&s.max_sequence===null,'unapproved absent session');
   effective=await withCalibratedLanguage(published);
  }else{
   assert(typeof s.session_id==='string'&&s.session_id&&Number.isSafeInteger(s.revision)&&s.revision>=0,'invalid existing session');
   if(allowed.sessionId)assert.equal(s.session_id,allowed.sessionId,'existing session replaced');
   if(allowed.revision!==undefined)assert.equal(s.revision,allowed.revision,'affected revision drift');
   const frozen=JSON.parse(s.curriculum_json);assert.equal(frozen.lessonId,allowed.lessonId);assert.equal(frozen.curriculumVersion,s.curriculum_version);
   assert.equal(hash(frozen),allowed.frozenSourceDigest,'unapproved frozen contract');
   effective=await projectModeSessionCurriculum(published,frozen,{completed:false,pending:false});
  }
  const pin={lessonId:effective.lessonId,curriculumVersion:effective.curriculumVersion,sourceDigest:hash(effective)};
  assert.deepEqual(pin,allowed.pin,'effective contract differs from approval');
  lessons.push({lessonId:allowed.lessonId,pin,curriculum:effective,baseline:s,baselineDigest:hash(s)});
 }
 return {version:'yw-mode-state-preflight-v1',readyForRegistration:true,executionAuthorized:false,
  ownerRef:createHash('sha256').update('dialogue-owner:'+ownerId).digest('hex'),priorLedgerDigest:await modeLedgerDigest(ledger),lessons};
}

export function verifyPostDeploymentSnapshot(snapshot,preflightLesson,ownerRef,previous=null){
 const {baseline:s,curriculum,pin}=preflightLesson;
 validateSessionSnapshot(snapshot,{curriculum,approvedPin:pin,ownerRef,previous});
 if(s.session_id===null)assert(snapshot.saved===false&&!snapshot.sessionId&&snapshot.revision===0,'new session appeared after preflight');
 else{assert.equal(snapshot.sessionId,s.session_id,'session changed after preflight');assert.equal(snapshot.revision,s.revision,'revision changed after preflight');}
 assert.equal(snapshot.turns.length,Math.min(s.turn_count,LIMITS.historyPage),'visible history size changed');
 assert.equal(snapshot.turns.at(-1)?.sequence??null,s.max_sequence,'latest turn changed');
 assert.equal(!!snapshot.older,s.turn_count>LIMITS.historyPage,'history pagination changed');
 return {verified:true,executionAuthorized:false};
}
