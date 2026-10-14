// One exact owner disposition. This is neither learning evidence nor a score.
// It is read from the server-owned curriculum, never from a request or model.
export function approvedSupplement(curriculum){
 const e=curriculum?.completionExemption;
 return curriculum?.lessonId==='lesson-1572'&&e?.lessonId==='lesson-1572'
  &&e.kind==='owner-approved-supplement'&&e.authority==='direct-suen-instruction-01a132c3'
  &&e.scoringRole==='none'&&typeof e.reason==='string'&&!!e.reason.trim()
  &&e.approvedAt==='2026-10-13T01:41:15Z'?{...e}:null;
}
