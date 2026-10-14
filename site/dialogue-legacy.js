// Read-only projection of source-owned historical facts; never recalculates grades.
const all=async statement=>(await statement.all()).results||[];
const domains={contextWords:'context',structure:'structure',evaluation:'evaluation',authorQuestion:'authorQuestion',revision:'revision',wordCreation:'wordCreation'};
// These values are stored by normalizeServerEvaluation, not model proposals.
const performancePassed=row=>row.eligibility_status==='eligible' && ['passed','correct'].includes(row.correctness);
const selfReport=row=>row.scoring_role==='none' && row.assessment_kind==='self_report' && row.eligibility_status==='non_scoring';
const sourceRef=(rows,policy)=>({table:'learning_evaluations',sourceEventIds:rows.map(r=>r.source_event_id),policy});
export async function historicalEvidence(db,studentId,curriculum){
 const [events,mastery,firstRead,firstReadMarks]=await Promise.all([
  all(db.prepare(`SELECT i.source_event_id,i.resource_key,i.resource_version,i.interaction_key,i.assessment_kind,i.scoring_role,i.occurred_at,CASE WHEN i.interaction_key='studyGuideItemCompleted' AND json_valid(i.raw_payload_json) THEN json_extract(i.raw_payload_json,'$.itemKey') END AS item_key,e.correctness,e.eligibility_status,e.verification_method,
   CASE WHEN json_valid(o.envelope_json) THEN CASE WHEN
    json_extract(o.envelope_json,'$.sourceEventId')=i.source_event_id
    AND json_extract(o.envelope_json,'$.resourceKey')=i.resource_key
    AND json_extract(o.envelope_json,'$.sourceVersion')=i.resource_version
    AND json_extract(o.envelope_json,'$.sourceSiteKey')='yw'
    AND json_extract(o.envelope_json,'$.sourceSystem')='yuwen-course'
    THEN json_extract(o.envelope_json,'$.resourceVersion') END END AS item_resource_version
   FROM learning_interactions i LEFT JOIN learning_evaluations e ON e.source_event_id=i.source_event_id
   LEFT JOIN evidence_outbox o ON o.source_event_id=i.source_event_id WHERE i.student_id=? AND i.lesson_id=? ORDER BY i.id`).bind(studentId,curriculum.lessonId)),
  all(db.prepare('SELECT item_id,status,correct_count,wrong_count,last_at FROM vocab_mastery WHERE student_id=? AND lesson_id=? ORDER BY item_id').bind(studentId,curriculum.lessonId)),
  all(db.prepare('SELECT text_version_id,text_digest,elapsed_ms,summary_text,submitted_at,last_activity_at FROM classical_first_read_sessions WHERE student_id=? AND lesson_id=? ORDER BY last_activity_at DESC,text_version_id').bind(studentId,curriculum.lessonId)),
  all(db.prepare('SELECT mark_id,text_version_id,text_digest,paragraph_key,start_offset,end_offset,selected_text,guess_text,correction_text,resolution_status,deleted_at,created_at,updated_at FROM classical_first_read_marks WHERE student_id=? AND lesson_id=? ORDER BY created_at,mark_id').bind(studentId,curriculum.lessonId)),
 ]);
 const preserved=[];
 for(const o of curriculum.objectives.filter(o=>o.domain==='legacy')){
  const accepted=r=>r.resource_key===o.legacy.resourceKey && (o.legacy.questionKind==='evaluation'?r.interaction_key==='evaluation'&&selfReport(r):performancePassed(r));
  // The source ledger stores the manifest release in resource_version; the
  // same-event outbox pins the individual resource. Never guess from a title
  // or accept an envelope whose event/resource/source version does not match.
  const event=events.find(r=>accepted(r)&&(r.resource_version===o.legacy.resourceVersion||r.item_resource_version===o.legacy.resourceVersion));
  if(event)preserved.push({objectiveId:o.id,verified:true,sourceEventId:event.source_event_id});
  else{const older=events.filter(accepted);if(older.length)preserved.push({objectiveId:o.id,verified:false,previousCompletion:true,sourceRef:sourceRef(older,'historical-completion-preserved-current-version-mapping-requires-review')});}
 }
 // Credit the corresponding old domain only if every registered formal item
 // for that domain has exact-version accepted evidence. No approximate match.
 for(const [kind,domain] of Object.entries(domains)){
  const originals=curriculum.objectives.filter(o=>o.domain==='legacy'&&o.legacy.questionKind===kind);
  const target=curriculum.objectives.find(o=>o.domain===domain);
  if(target&&originals.length&&originals.every(o=>preserved.some(p=>p.objectiveId===o.id&&p.verified)))preserved.push({objectiveId:target.id,verified:true,sourceRef:{table:'learning_evaluations',sourceEventIds:originals.map(o=>preserved.find(p=>p.objectiveId===o.id).sourceEventId),policy:'existing-exact-version-acceptance'}});
  else if(target&&originals.some(o=>preserved.some(p=>p.objectiveId===o.id&&p.previousCompletion)))preserved.push({objectiveId:target.id,verified:false,previousCompletion:true,sourceRef:{policy:'historical-completion-preserved-do-not-repeat',sourceEventIds:originals.flatMap(o=>preserved.find(p=>p.objectiveId===o.id)?.sourceRef?.sourceEventIds||[])}});
  else if(target&&!originals.length){
   const older=events.filter(r=>r.interaction_key===kind&&(kind==='evaluation'?selfReport(r):performancePassed(r)));
   if(older.length)preserved.push({objectiveId:target.id,verified:false,previousCompletion:true,sourceRef:sourceRef(older,'historical-source-result-preserved-no-current-formal-version')});
  }
 }
 // A reading acknowledgement is participation, never a performance grade.
 const reading=events.filter(r=>r.interaction_key==='readAcknowledged'&&r.scoring_role==='none'&&r.assessment_kind==='participation'&&r.eligibility_status==='non_scoring');
 const read=curriculum.objectives.find(o=>o.domain==='read');
 if(read&&reading.length)preserved.push({objectiveId:read.id,verified:true,sourceRef:sourceRef(reading,'preserve-original-reading-acknowledgement-not-mastery')});
 for(const o of curriculum.objectives.filter(o=>o.domain==='studyGuide')){
  const item=curriculum.legacy.formative.find(i=>i.itemKey===o.sourceItemKey&&i.interactionKey==='studyGuideItemCompleted');
  if(!item)continue;
  const accepted=events.filter(r=>r.interaction_key==='studyGuideItemCompleted'&&performancePassed(r));
  // Formative resource keys contain the semantic revision. resource_version is
  // a digest derived from manifest release + key, NOT the item's semanticRevision.
  const exact=accepted.filter(r=>[item.resourceKey,...(item.resourceAliases||[])].includes(r.resource_key));
  if(exact.length)preserved.push({objectiveId:o.id,verified:true,sourceRef:sourceRef(exact,'existing-source-study-guide-semantic-revision')});
  else{const older=accepted.filter(r=>r.item_key===o.sourceItemKey);if(older.length)preserved.push({objectiveId:o.id,verified:false,previousCompletion:true,sourceRef:sourceRef(older,'historical-study-guide-version-requires-review')});}
 }
 for(const row of mastery.filter(r=>r.status==='mastered')){
  if(curriculum.vocabulary.some(v=>v.id===row.item_id))preserved.push({objectiveId:row.item_id,verified:true,sourceRef:{table:'vocab_mastery',lessonId:curriculum.lessonId,itemId:row.item_id,at:row.last_at,ruleVersion:null,policy:'preserve-original-mastery-not-new-independent-test'}});
  const formal=curriculum.objectives.find(o=>o.domain==='legacy'&&o.legacy.questionKind==='vocabulary'&&o.legacy.resourceKey===`effect:${curriculum.lessonId}:vocab:${row.item_id}`);
  if(formal&&!preserved.some(p=>p.objectiveId===formal.id))preserved.push({objectiveId:formal.id,verified:false,previousCompletion:true,sourceRef:{table:'vocab_mastery',lessonId:curriculum.lessonId,itemId:row.item_id,at:row.last_at,ruleVersion:null,policy:'original-mastery-preserved-missing-formal-version-requires-review'}});
 }
 const submitted=firstRead.find(r=>r.submitted_at),initial=curriculum.objectives.find(o=>o.domain==='firstRead');
 if(submitted&&initial)preserved.push({objectiveId:initial.id,verified:true,sourceRef:{table:'classical_first_read_sessions',lessonId:curriculum.lessonId,textVersionId:submitted.text_version_id,textDigest:submitted.text_digest,at:submitted.submitted_at,policy:'preserve-original-submission-no-offset-remapping'}});
 const completed=events.filter(r=>r.interaction_key==='lessonCompleted'&&selfReport(r));
 const completion=completed.length?{status:'preserved',kind:'self_report',scoringRole:'none',sourceRef:sourceRef(completed,'original-course-completion-preserved-not-new-dialogue-mastery')}:null;
 return {preserved,completion,records:events.length,mastery,firstRead,firstReadMarks,policy:'read-only; grades, attempts, source versions and unfinished work unchanged; absent metadata remains unknown'};
}
