// Owner annotations preserve the original turn and its assessment. They do not
// silently amend a transcript or grant credit, and never contact a provider.
export async function recordCorrection(db,session,body,at){
 if(!/^[a-zA-Z0-9_-]{16,80}$/.test(body.mutationId||'') || typeof body.turnId!=='string'
  || typeof body.note!=='string' || !body.note.trim() || body.note.length>1200
  || typeof body.proposedText!=='string' || body.proposedText.length>3000)return {status:400,value:{code:'invalid_correction'}};
 const turn=await db.prepare('SELECT id,role FROM dialogue_turns WHERE id=? AND session_id=?').bind(body.turnId,session.id).first();
 if(!turn)return {status:404,value:{code:'turn_not_found'}};
 // A student may clarify their answer or flag an AI error; both remain notes.
 const details={turnId:turn.id,role:turn.role,note:body.note,proposedText:body.proposedText,originalPreserved:true,assessmentChanged:false,status:'owner_annotation_requires_review'};
 const id=`${session.id}:correction:${body.mutationId}`,serialized=JSON.stringify(details);
 const existing=await db.prepare('SELECT details_json FROM dialogue_events WHERE id=? AND session_id=?').bind(id,session.id).first();
 if(!existing){
  const count=await db.prepare("SELECT COUNT(*) n FROM dialogue_events WHERE session_id=? AND turn_id=? AND event_type='owner_correction_recorded'").bind(session.id,turn.id).first();
  if(count.n>=8)return {status:409,value:{code:'correction_review_required',message:'本回合已有八則更正，已是上限；原件與更正都已保存，可以匯出回看。'}};
 }
 await db.prepare("INSERT OR IGNORE INTO dialogue_events(id,session_id,turn_id,event_type,details_json,created_at) SELECT ?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM dialogue_events WHERE session_id=? AND turn_id=? AND event_type='owner_correction_recorded')<8").bind(id,session.id,turn.id,'owner_correction_recorded',serialized,at,session.id,turn.id).run();
 const stored=await db.prepare('SELECT details_json,created_at FROM dialogue_events WHERE id=? AND session_id=?').bind(id,session.id).first();
 if(!stored)return {status:409,value:{code:'correction_review_required',message:'本回合已有八則更正，已是上限；原件與更正都已保存，可以匯出回看。'}};
 if(stored.details_json!==serialized)return {status:409,value:{code:'correction_conflict',message:'同一回執已有不同更正，原件與已保存的更正均保留。'}};
 return {status:200,value:{saved:true,id,createdAt:stored.created_at,...details}};
}
