// Owner/session-scoped append-only projection. These notes never award marks,
// replace original completion requirements, or emit a central receipt.
export function projectReadingNotes(asset,events){
 const marks=[],summaries=[];
 for(const event of events){
  const {action}=typeof event.details_json==='string'?JSON.parse(event.details_json):event.details;
  const p=action?.payload;
  if(p?.textVersionId!==asset.textVersionId||p.textDigest!==asset.textDigest)continue;
  if(action.operation==='mark'){
   const paragraph=asset.paragraphs.find(x=>x.key===p.paragraphKey);
   if(!paragraph||paragraph.text.slice(p.startOffset,p.endOffset)!==p.selectedText||marks.some(m=>m.markId===event.id))continue;
   marks.push({markId:event.id,paragraphKey:p.paragraphKey,startOffset:p.startOffset,endOffset:p.endOffset,selectedText:p.selectedText,guess:p.guess,evidence:action.evidence,correction:'',corrections:[],resolutionStatus:'open',createdAt:event.created_at});
  }else if(action.operation==='submit')summaries.push({summary:p.summary,evidence:action.evidence,createdAt:event.created_at});
  else if(action.operation==='resolve'){
   const mark=marks.find(m=>m.markId===p.markId);if(!mark)continue;
   mark.corrections.push({text:p.correction,evidence:action.evidence,createdAt:event.created_at});mark.correction=p.correction;mark.resolutionStatus='resolved';
  }
 }
 return {ok:true,kind:asset.kind,textVersionId:asset.textVersionId,textDigest:asset.textDigest,marks,summaries,summary:summaries.at(-1)?.summary||'',submitted:summaries.length>0,markCount:marks.length,scoringRole:'none'};
}
export async function readDialogueNotes(db,session,asset){
 const rows=session?(await db.prepare("SELECT e.id,e.details_json,e.created_at FROM dialogue_events e JOIN dialogue_turns t ON t.id=e.turn_id WHERE e.session_id=? AND e.event_type='reading_evidence_saved' ORDER BY t.sequence,e.created_at,e.id").bind(session.id).all()).results:[];
 return projectReadingNotes(asset,rows||[]);
}
