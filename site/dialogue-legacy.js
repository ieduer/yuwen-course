// Read-only projection of source-owned historical facts; never recalculates grades.
const all=async statement=>(await statement.all()).results||[];
const domains={contextWords:'context',structure:'structure',evaluation:'evaluation',authorQuestion:'authorQuestion',revision:'revision',wordCreation:'wordCreation'};
export async function historicalEvidence(db,studentId,curriculum){
 const [events,mastery,firstRead]=await Promise.all([
  all(db.prepare(`SELECT i.source_event_id,i.resource_key,i.resource_version,i.interaction_key,i.occurred_at,e.correctness,e.eligibility_status,e.verification_method FROM learning_interactions i LEFT JOIN learning_evaluations e ON e.source_event_id=i.source_event_id WHERE i.student_id=? AND i.lesson_id=? ORDER BY i.id`).bind(studentId,curriculum.lessonId)),
  all(db.prepare('SELECT item_id,status,correct_count,wrong_count,last_at FROM vocab_mastery WHERE student_id=? AND lesson_id=? ORDER BY item_id').bind(studentId,curriculum.lessonId)),
  all(db.prepare('SELECT text_version_id,text_digest,elapsed_ms,summary_text,submitted_at,last_activity_at FROM classical_first_read_sessions WHERE student_id=? AND lesson_id=? ORDER BY last_activity_at DESC,text_version_id').bind(studentId,curriculum.lessonId)),
 ]);
 const preserved=[];
 for(const o of curriculum.objectives.filter(o=>o.domain==='legacy')){
  const event=events.find(r=>r.resource_key===o.legacy.resourceKey&&r.resource_version===o.legacy.resourceVersion&&r.correctness==='correct'&&r.eligibility_status==='eligible');
  if(event)preserved.push({objectiveId:o.id,verified:true,sourceEventId:event.source_event_id});
  else{const older=events.filter(r=>r.resource_key===o.legacy.resourceKey&&r.correctness==='correct'&&r.eligibility_status==='eligible');if(older.length)preserved.push({objectiveId:o.id,verified:false,previousCompletion:true,sourceRef:{table:'learning_evaluations',sourceEventIds:older.map(r=>r.source_event_id),policy:'historical-completion-preserved-current-version-mapping-requires-review'}});}
 }
 // Credit the corresponding old domain only if every registered formal item
 // for that domain has exact-version accepted evidence. No approximate match.
 for(const [kind,domain] of Object.entries(domains)){
  const originals=curriculum.objectives.filter(o=>o.domain==='legacy'&&o.legacy.questionKind===kind);
  const target=curriculum.objectives.find(o=>o.domain===domain);
  if(target&&originals.length&&originals.every(o=>preserved.some(p=>p.objectiveId===o.id&&p.verified)))preserved.push({objectiveId:target.id,verified:true,sourceRef:{table:'learning_evaluations',sourceEventIds:originals.map(o=>preserved.find(p=>p.objectiveId===o.id).sourceEventId),policy:'existing-exact-version-acceptance'}});
  else if(target&&originals.some(o=>preserved.some(p=>p.objectiveId===o.id&&p.previousCompletion)))preserved.push({objectiveId:target.id,verified:false,previousCompletion:true,sourceRef:{policy:'historical-completion-preserved-do-not-repeat',sourceEventIds:originals.flatMap(o=>preserved.find(p=>p.objectiveId===o.id)?.sourceRef?.sourceEventIds||[])}});
 }
 for(const row of mastery.filter(r=>r.status==='mastered')){
  if(curriculum.vocabulary.some(v=>v.id===row.item_id))preserved.push({objectiveId:row.item_id,verified:true,sourceRef:{table:'vocab_mastery',lessonId:curriculum.lessonId,itemId:row.item_id,at:row.last_at,ruleVersion:null,policy:'preserve-original-mastery-not-new-independent-test'}});
 }
 const submitted=firstRead.find(r=>r.submitted_at),initial=curriculum.objectives.find(o=>o.domain==='firstRead');
 if(submitted&&initial)preserved.push({objectiveId:initial.id,verified:true,sourceRef:{table:'classical_first_read_sessions',lessonId:curriculum.lessonId,textVersionId:submitted.text_version_id,textDigest:submitted.text_digest,at:submitted.submitted_at,policy:'preserve-original-submission-no-offset-remapping'}});
 return {preserved,records:events.length,mastery,firstRead,policy:'read-only; grades, attempts, source versions and unfinished work unchanged; absent metadata remains unknown'};
}
