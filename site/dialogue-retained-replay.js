// Owner-approved replay of retained original evidence (r38). suen, 2026-11-01: 「連補記一起做」 — record the self-ratings
// and reading statements that students plainly gave but the r37 validators refused (「我給 76／100」「60吧」「评分：85分…扣掉
// 的15分」「我已经通读完了你可以提问了」). Each entry is one exact retained part (proposal_parts_rejected, retained in
// yw-rejected-retained-v1) pinned by session, student, objective and the SHA-256 of the quoted words. When that student next
// opens the lesson, the part is re-checked with the current validators and, if it passes and the item is still open, recorded
// once through the ordinary original-task path: same evaluator, same identity, server time, no model call. Nothing else is
// replayed, nothing is rewritten, and an item already completed in another way is left as it is.
import {validateOriginalEvidence} from './dialogue-reading-evidence.js';
import {prepareOriginalInput} from './dialogue-formal.js';
import {historicalEvidence} from './dialogue-legacy.js';
export const REPLAY_RELEASE='r38';
export const REPLAY_AUTHORITY='suen 2026-11-01 「連補記一起做」 (yw-dialogue-scoring-20261031/ANALYSIS.md §四)';
const REPLAYABLE=new Set(['rating_not_explicit','reading_acknowledgement_not_verified']);
// r39 correction (suen, 2026-11-01: 「學生 8改正」): student 8 typed 100 on lesson-1458 only after eleven refusals of
// 「我給 76／100」「82／100」「我給 83／100」 (「算了，我改成100分」). Their last plainly given rating is recorded as a new attempt
// through the same path; the stored 100 stays in the ledger and is named as superseded, never rewritten.
export const CORRECTION_AUTHORITY='suen 2026-11-01 「學生 8改正」';
export const APPROVED_RETAINED_REPLAYS=Object.freeze([
 // One entry per approved student-lesson: the student's last plainly given self-rating / reading statement.
 {sessionId:'dbdf402d-6533-4576-91a1-41cd90e8b9b8',studentId:9,lessonId:'lesson-1462',eventId:'f94c62f4-ab0c-449a-b8aa-0c339bf8921e:rejected',objectiveId:'lesson-1462:read',quoteSha256:'55dbc24cd8bbf9e5e895ce65d71ebcd6e393e6e34f35b49854bb7d0d2b7c0f3b'}, // 2026-10-29T11:24 {"acknowledgement":"已讀完"}
 {sessionId:'c0ec3b72-c1b9-4a47-a1ff-17efe9994ff1',studentId:37,lessonId:'lesson-1461',eventId:'031ad6ec-f19c-436f-a92a-6e6c6c9f7134:rejected',objectiveId:'legacy:effect:lesson-1461:interaction:evaluation',quoteSha256:'c6280982ef80a947fb92e27bb17902fcf43ae997eaf8a8f3c775d2df658b6264'}, // 2026-10-26T00:03 {"rating":90
 {sessionId:'1029ebb3-460a-46a0-acd7-04c1f3b50c68',studentId:41,lessonId:'lesson-1458',eventId:'0d2c717c-aff8-4a6f-b038-6d6083f62549:rejected',objectiveId:'legacy:effect:lesson-1458:interaction:evaluation',quoteSha256:'25207073e9d58463fe717fa08054bac39c6c166107e09361dd9fd011c0f256d5'}, // 2026-10-26T12:56 {"rating":60
 {sessionId:'4dca2cec-5393-42fb-82a8-1f5c168b2d77',studentId:61,lessonId:'lesson-1458',eventId:'c491f2ba-cb30-466d-bb2c-aedb970887ee:rejected',objectiveId:'legacy:effect:lesson-1458:interaction:evaluation',quoteSha256:'95ac196141d5170e8657993a6b5a3de1d1b111fefc50768aa86052876ac48218'}, // 2026-10-26T00:21 {"rating":85
 {sessionId:'03fafb35-f905-4198-a15a-10ac89f5aba1',studentId:63,lessonId:'lesson-1458',eventId:'ac981741-a933-492e-b823-b233196e38a3:rejected',objectiveId:'legacy:effect:lesson-1458:interaction:evaluation',quoteSha256:'e6a929751d69a5d78c4e56c37698f6620394ac16ded433ad795c2da915963b9d'}, // 2026-10-24T10:11 {"rating":78
 {kind:'correction',release:'r39',sessionId:'56125bac-3f1d-4f8c-9dd1-1fe1c47bbced',studentId:8,lessonId:'lesson-1458',eventId:'45cd25ae-cb16-4845-b66a-7ab9bae96c0a:rejected',objectiveId:'legacy:effect:lesson-1458:interaction:evaluation',quoteSha256:'5a2d44fcf50592ab4702bfd591b0f6452311fd51dbc3fbfd49bf5df7d841e884',supersedesSourceEventId:'89cf9163-60cf-4c0c-8356-b17c5d0ffea4',supersededRating:100}, // 2026-10-24T11:32 {"rating":83} replaces the forced 100
].map(Object.freeze));
const sha=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(x=>x.toString(16).padStart(2,'0')).join('');
const taskFor=(curriculum,objectiveId)=>{
 const o=curriculum.objectives.find(o=>o.id===objectiveId);
 if(o?.domain==='read')return {kind:'read',objectiveId};
 if(o?.domain==='legacy'&&o.legacy?.questionKind==='evaluation')return {kind:'evaluation',objectiveId};
 return null;
};
export async function replayApprovedRetained({db,session,curriculum,student,originalAction,approved=APPROVED_RETAINED_REPLAYS,at=new Date().toISOString()}){
 const entries=approved.filter(e=>e.sessionId===session?.id&&e.studentId===student?.id&&e.studentId===session?.student_id&&e.lessonId===curriculum?.lessonId);
 const results=[];
 for(const e of entries){
  const correction=e.kind==='correction',release=e.release||REPLAY_RELEASE;
  const replayId=correction?`${e.eventId}:${release}-correction`:`${e.eventId}:${release}-replay`;
  if(await db.prepare('SELECT id FROM dialogue_events WHERE id=? AND session_id=?').bind(replayId,session.id).first()){results.push({eventId:e.eventId,status:'already_replayed'});continue;}
  const task=taskFor(curriculum,e.objectiveId);
  if(!task){results.push({eventId:e.eventId,status:'objective_absent'});continue;}
  const legacy=await historicalEvidence(db,student.id,curriculum);
  if(correction){
   // Correct only the exact record the owner named, still holding the value it was named for.
   const target=legacy.preserved.find(p=>p.objectiveId===e.objectiveId);
   const stored=target?.sourceEventId===e.supersedesSourceEventId?await db.prepare("SELECT raw_payload_json FROM learning_interactions WHERE source_event_id=? AND student_id=? AND interaction_key='evaluation'").bind(e.supersedesSourceEventId,student.id).first():null;
   let rating=null;try{rating=JSON.parse(stored?.raw_payload_json||'null')?.rating??null;}catch{}
   if(rating!==e.supersededRating){results.push({eventId:e.eventId,status:'correction_target_mismatch'});continue;}
  }else if(legacy.preserved.some(p=>p.objectiveId===e.objectiveId)){results.push({eventId:e.eventId,status:'already_complete'});continue;}
  const row=await db.prepare("SELECT turn_id,details_json FROM dialogue_events WHERE id=? AND session_id=? AND event_type='proposal_parts_rejected'").bind(e.eventId,session.id).first();
  let details=null;try{details=JSON.parse(row?.details_json||'null');}catch{}
  const retained=details?.retainedVersion==='yw-rejected-retained-v1'?details.retained?.originalEvidence:null;
  if(!retained||retained.objectiveId!==e.objectiveId||!details.parts?.some(p=>p.part==='originalEvidence'&&REPLAYABLE.has(p.code))
   ||typeof retained.evidence?.quote!=='string'||await sha(retained.evidence.quote)!==e.quoteSha256){results.push({eventId:e.eventId,status:'retained_part_mismatch'});continue;}
  const turns=await (async()=>((await db.prepare("SELECT id,role,content FROM dialogue_turns WHERE session_id=? AND role='student' ORDER BY sequence").bind(session.id).all()).results||[]))();
  let checked;try{checked=validateOriginalEvidence(retained,{turns,curriculum,task});}catch(error){results.push({eventId:e.eventId,status:'still_refused',code:String(error?.message||'').slice(0,80)});continue;}
  const formal=prepareOriginalInput(curriculum,checked.task,checked.input);
  const response=await originalAction({...formal,lessonId:curriculum.lessonId,frozenVocab:formal.interaction==='vocabAnswer'?((curriculum.vocabulary||[]).find(v=>v?.id===formal.input?.itemId)||null):null},`${row.turn_id}-${release}${correction?'c':''}`,result=>[
   db.prepare(`INSERT INTO dialogue_events(id,session_id,turn_id,event_type,details_json,created_at) VALUES(?,?,?,'${correction?'retained_correction_saved':'retained_replay_saved'}',?,?)`).bind(replayId,session.id,row.turn_id,JSON.stringify({release,authority:correction?CORRECTION_AUTHORITY:REPLAY_AUTHORITY,retainedEventId:e.eventId,objectiveId:e.objectiveId,evidence:retained.evidence,input:checked.input,...(correction?{supersedes:{sourceEventId:e.supersedesSourceEventId,rating:e.supersededRating}}:{}),...result}),at),
  ]);
  results.push({eventId:e.eventId,status:response?.ok?'recorded':'source_refused',httpStatus:response?.status??null});
 }
 return results;
}
