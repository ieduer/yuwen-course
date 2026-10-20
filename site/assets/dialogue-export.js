// Merges the pages of a full-account transcript export (GET /api/dialogue/v1?exportAll=1&before=…&beforeId=…)
// into one record. Pure; no DOM. Sessions keep their server order (newest first); incomplete sessions are listed.
export function mergeExportPages(pages,{exportedAt,ownerRef}={}){
 if(!Array.isArray(pages)||!pages.length)throw new Error('沒有可匯出的對話。');
 const owners=new Set(pages.map(p=>p.ownerRef).filter(Boolean));
 if(owners.size>1||(ownerRef&&owners.size&&!owners.has(ownerRef)))throw Object.assign(new Error('帳戶已切換，匯出已中止。'),{code:'account_changed'});
 const seen=new Set(),sessions=[];
 for(const page of pages)for(const s of page.sessions||[]){if(seen.has(s.sessionId))continue;seen.add(s.sessionId);sessions.push(s);}
 const incompleteSessions=sessions.filter(s=>s.complete===false||s.inflight||s.turns.some(t=>!t.confirmed||t.partialReply)||s.unsentDrafts?.length).map(s=>({sessionId:s.sessionId,lessonId:s.lessonId,reasons:[...(s.complete===false?[s.incomplete||'incomplete']:[]),...(s.inflight?['inflight']:[]),...(s.turns.some(t=>!t.confirmed)?['unconfirmed_turns']:[]),...(s.turns.some(t=>t.partialReply)?['partial_streamed_reply']:[]),...(s.unsentDrafts?.length?['unsent_drafts']:[])]}));
 const total=pages.find(p=>Number.isSafeInteger(p.total))?.total??sessions.length;
 return {schemaVersion:'yw-dialogue-account-export-v1',scope:'own-sessions-only',ownerRef:ownerRef||[...owners][0]||null,exportedAt:exportedAt||new Date().toISOString(),sessionCount:sessions.length,expectedSessionCount:total,complete:sessions.length===total&&!pages.at(-1)?.older,sessions,incompleteSessions,privacy:'僅供本人及獲授權教師核對；不含他人資料，也不含模型內部推理'};
}
export function exportFilename(exportedAt){return `yw-dialogue-all-sessions-${String(exportedAt||'').replace(/[:.]/g,'-')||'export'}.json`;}
