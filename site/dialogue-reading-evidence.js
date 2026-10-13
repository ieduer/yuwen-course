// Model proposals are references to the learner's immutable words, never authority.
export const CONVERSATION_POLICY_VERSION='yw-author-conversation-v1';
function explicitStatement(turn,quote){
 // A model must not cut an affirmative word out of a negation or hypothetical.
 return (turn.content.match(/[^\n。！？!?]+[。！？!?]?/gu)||[]).filter(s=>!/[？?]$/.test(s)).map(s=>s.trim().replace(/[。！!]+$/u,'')).includes(quote.trim().replace(/[。！!]+$/u,''));
}
const finishedReading=/^(?:我)?(?:已經|已经|已)?(?:把)?(?:這篇|这篇|整篇|這一篇|这一篇)?(?:課文|课文|文章|正文)?(?:讀完|读完|看完|閱讀完|阅读完)(?:了)?[。！!\s]*$/u;
function acknowledged(turn,quote){return explicitStatement(turn,quote)&&finishedReading.test(quote.trim());}
export function validateReadingEvidence(proposed,{turns,asset,state,lessonId,turnId}){
 if(!proposed)return null;
 const ref=proposed.evidence,student=turns.find(t=>t.id===ref?.turnId&&t.role==='student');
 if(!student||typeof ref.quote!=='string'||!ref.quote.trim()||!student.content.includes(ref.quote))throw Error('reading_evidence_not_student_quote');
 const common={lessonId,textVersionId:asset?.textVersionId,textDigest:asset?.textDigest,clientMutationId:`dialogue-reading:${turnId}`};
 if(proposed.operation==='mark'){
  if(!asset||state?.submitted||ref.quote.length>600)throw Error('reading_mark_not_available');
  const p=asset.paragraphs.find(p=>p.key===proposed.paragraphKey),text=proposed.selectedText;
  if(!p||typeof text!=='string'||!text.trim()||text.length>120||!student.content.includes(text))throw Error('reading_selection_not_verified');
  const start=p.text.indexOf(text);if(start<0||p.text.indexOf(text,start+1)>=0)throw Error('reading_selection_ambiguous');
  if(state?.marks?.some(m=>m.paragraphKey===p.key&&start<m.endOffset&&start+text.length>m.startOffset))throw Error('reading_original_mark_preserved');
  return {operation:'mark',payload:{...common,paragraphKey:p.key,startOffset:start,endOffset:start+text.length,selectedText:text,guess:ref.quote},evidence:ref};
 }
 if(proposed.operation==='submit'){
  if(!asset||state?.submitted||[...ref.quote].length<12||ref.quote.length>2000)throw Error('reading_summary_not_verified');
  return {operation:'submit',payload:{...common,summary:ref.quote},evidence:ref};
 }
 if(proposed.operation==='resolve'){
  if(!state?.submitted||!state.marks?.some(m=>m.markId===proposed.markId&&m.resolutionStatus!=='resolved'&&!m.correction)||ref.quote.length>1200)throw Error('reading_correction_not_verified');
  return {operation:'resolve',payload:{...common,markId:proposed.markId,correction:ref.quote},evidence:ref};
 }
 if(proposed.operation==='acknowledge'){
  // Reading participation is not mastery. Require an explicit, positive learner statement.
  if(!asset||!state?.submitted||!acknowledged(student,ref.quote))throw Error('reading_acknowledgement_not_verified');
  return {operation:'acknowledge',payload:common,evidence:ref};
 }
 throw Error('reading_operation_not_allowed');
}
export const READING_CONVERSATION_POLICY=`學生眼中只有與作者的連續談話，沒有關卡、提交表單或機械逐欄問卷。先回應對方的問題或學習偏好，再自然帶回尚未有證據的要求。開場可邀請學生選擇先讀、先問或分享感受；不要要求固定學習順序，除非後端必要條件尚未滿足。不能把學生聊天內容自動當作正在填某個欄位。已說清楚的證據直接引用，不要要求再抄一次。不得聲稱完成或保存了尚未獲後端確認的動作。
firstReading若存在，提供了同版本無標點正文和原有疑點紀錄。讀者可自由切換無標點、標點、註釋材料，看到註釋不等於獨立掌握。用作者口吻請學生引用一處疑點並說第一直覺；逐步涵蓋原要求至少三處互不重疊疑點及至少12字初讀感知，之後對照註釋並在對話中修正原猜測。不要顯示數字關卡或用三個孤立表單替代對話。
每輪至多附一個readingEvidence:{operation:"mark|submit|resolve|acknowledge",evidence:{turnId,quote},paragraphKey?,selectedText?,markId?}。所有evidence.quote逐字來自學生，不能替學生編寫或改寫猜測。mark的selectedText必須同時逐字見於學生回答與指定無標點段落，唯一定位；submit引用學生完整初讀感知；resolve引用學生自己修正的解釋及已存在markId。acknowledge只引用學生明確的已讀完陳述，不把問句、否定或含糊語句判成閱讀完成。原紀錄與評價不覆寫，不更改門檻。後端決定是否接受，失敗就保留原話待核查。
conversationGuide是後端尚待核验的既有要求，只作教學參考，不照搬為選單或命令。kind為read、evaluation、vocabulary時，可附originalEvidence:{objectiveId,evidence:{turnId,quote}}；只抽取學生明確表示已讀完、明確0–100自評數字、明確選項原文或A/B/C/D，不推測選擇。不要求學生說固定口令，不符合可驗證形式時自然澄清。評分仍由原評價器核對，模型不得給原題分數。`;

export function validateOriginalEvidence(proposed,{turns,curriculum,task}){
 if(!proposed)return null;
 if(!task||proposed.objectiveId!==task.objectiveId||!['read','evaluation','vocabulary'].includes(task.kind))throw Error('original_evidence_wrong_task');
 const ref=proposed.evidence,t=turns.find(t=>t.id===ref?.turnId&&t.role==='student');
 if(!t||typeof ref.quote!=='string'||!t.content.includes(ref.quote)||!ref.quote.trim())throw Error('original_evidence_not_student_quote');
 if(task.kind==='read'){
  if(!acknowledged(t,ref.quote))throw Error('reading_acknowledgement_not_verified');
  return {task,input:{acknowledgement:'已讀完'},evidence:ref};
 }
 if(task.kind==='evaluation'){
  const statement=t.content.trim(),match=/^(?:我(?:給|给|覺得|觉得|的評價是|的评价是|會給|会给)?\s*)?(\d{1,3}(?:\.\d+)?)\s*(?:分|%|％)?(?:[。！!]|[，,](?:因為|因为|理由是|理由是：).*)?$/u.exec(statement);
  if(!match||!(ref.quote.trim()===statement||ref.quote.trim()===match[1]||ref.quote.trim()===match[1]+'分'))throw Error('rating_not_explicit');
  const rating=Number(match[1]);if(rating<0||rating>100)throw Error('rating_out_of_range');
  return {task,input:{rating,reason:statement.slice(0,300)},evidence:ref};
 }
 // Only an exact option quotation or explicit option label can choose an answer.
 const text=ref.quote.trim(),index=task.options.findIndex(o=>o===text);
 const statement=t.content.trim(),labelled=/^(?:我選|我选|我認為是|我认为是|選|选)?\s*([A-Da-d])(?:[。.!！]|[，,](?:因為|因为|理由是).*)?$/u.exec(statement);
 if(index>=0&&!explicitStatement(t,ref.quote))throw Error('choice_not_explicit');
 if(index<0&&(!labelled||!(text===statement||text===labelled[1])))throw Error('choice_not_explicit');
 const selectedIndex=index>=0?index:labelled?labelled[1].toUpperCase().charCodeAt(0)-65:-1;
 if(selectedIndex<0||!task.options[selectedIndex])throw Error('choice_not_explicit');
 return {task,input:{selectedIndex},evidence:ref};
}
