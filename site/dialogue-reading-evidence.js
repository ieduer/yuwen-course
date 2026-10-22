// Model proposals are references to the learner's immutable words, never authority.
import {unpunctuated} from './dialogue-reading-material.js';
export const CONVERSATION_POLICY_VERSION='yw-author-conversation-v2';
function explicitStatement(turn,quote){
 // A model must not cut an affirmative word out of a negation or hypothetical.
 return (turn.content.match(/[^\n。！？!?]+[。！？!?]?/gu)||[]).filter(s=>!/[？?]$/.test(s)).map(s=>s.trim().replace(/[。！!]+$/u,'')).includes(quote.trim().replace(/[。！!]+$/u,''));
}
const finishedReading=/^(?:我)?(?:已經|已经|已)?(?:把)?(?:這篇|这篇|整篇|這一篇|这一篇)?(?:課文|课文|文章|正文)?(?:讀完|读完|看完|閱讀完|阅读完)(?:了)?[。！!\s]*$/u;
const wholeWork='(?:全詩|全诗|全文|全篇|整首詩|整首诗|(?:這|这|整)篇(?:課文|课文|文章|作品))';
const explicitCompletion='(?=我|已經|已经|已|.*了[。！!\\s]*$|(?:讀完|读完|看完|閱讀完|阅读完)了)';
const naturalFinishedReading=[
 new RegExp('^'+explicitCompletion+'(?:我)?(?:已經|已经|已)?(?:把)?'+wholeWork+'(?:讀完|读完|看完|閱讀完|阅读完)(?:了)?[。！!\\s]*$','u'),
 new RegExp('^'+explicitCompletion+'(?:我)?(?:已經|已经|已)?(?:讀完|读完|看完|閱讀完|阅读完)(?:了)?'+wholeWork+'(?:了)?[。！!\\s]*$','u'),
 // 通讀 alone may be a request or intention: require 已 or a completed 了.
 new RegExp('^(?:我)?(?:(?:已經|已经|已)(?:通讀|通读)'+wholeWork+'(?:了)?|(?:通讀|通读)'+wholeWork+'了)[。！!\\s]*$','u'),
];
function acknowledged(turn,quote){return explicitStatement(turn,quote)&&[finishedReading,...naturalFinishedReading].some(pattern=>pattern.test(quote.trim()));}
// Teaching focus is not a lock on other already demonstrated participation.
// Only the existing source-owned, non-scoring read receipt is independent of
// the current question. Original graded tasks keep their existing eligibility.
export function conversationOriginalTasks(curriculum,state,guide,originals=null){
 if(state.legacyCompletion||state.readingGate&&state.readingGate.phase!=='close_reading')return [];
 const read=curriculum.objectives.find(o=>o.domain==='read'&&state.objectives.some(s=>s.id===o.id&&!['preserved','historical_review'].includes(s.status)));
 const tasks=guide&&(['evaluation','vocabulary'].includes(guide.kind)||guide.kind==='read'&&guide.objectiveId===read?.id)?[guide]:[];
 if(read&&!tasks.some(t=>t.objectiveId===read.id))tasks.push({kind:'read',objectiveId:read.id});
 // The original answer-key item of an already demonstrated word is reachable from the conversation at any point
 // (out-of-order progress), not only after every other dialogue question has been issued and answered.
 for(const original of Array.isArray(originals)?originals:originals?[originals]:[])if(original&&['vocabulary','evaluation'].includes(original.kind)&&!tasks.some(t=>t.objectiveId===original.objectiveId))tasks.push(original);
 return tasks;
}
// The author may transcribe a selection in another script than the source (卻/却, 內/内) because it writes traditional text.
// A mark must stay the student's own words and the exact source text, so a transcription that is not in the student's
// message is replaced by the one same-length span of that message which occurs exactly once in the paragraph and differs
// from the transcription in at most a third of its characters; anything else is refused as before. No conversion table.
export function studentSpanFor(content,transcribed,paragraph){
 const want=unpunctuated(String(transcribed||'')),own=unpunctuated(String(content||''));
 if(want.length<2||!paragraph)return null;
 const limit=Math.floor(want.length/3),found=new Set();
 for(let i=0;i+want.length<=own.length;i++){
  const span=own.slice(i,i+want.length);let diff=0;
  for(let k=0;k<span.length&&diff<=limit;k++)if(span[k]!==want[k])diff++;
  if(diff>limit)continue;
  const at=paragraph.indexOf(span);if(at<0||paragraph.indexOf(span,at+1)>=0)continue;
  found.add(span);
 }
 return found.size===1?[...found][0]:null;
}
export function validateReadingEvidence(proposed,{turns,asset,state,lessonId,turnId}){
 if(!proposed)return null;
 const ref=proposed.evidence,student=turns.find(t=>t.id===ref?.turnId&&t.role==='student');
 if(!student||typeof ref.quote!=='string'||!ref.quote.trim()||!student.content.includes(ref.quote))throw Error('reading_evidence_not_student_quote');
 const common={lessonId,textVersionId:asset?.textVersionId,textDigest:asset?.textDigest,clientMutationId:`dialogue-reading:${turnId}`};
 const notes=asset?.kind==='conversation-reading';
 if(proposed.operation==='mark'){
  if(!asset||(!notes&&state?.submitted)||ref.quote.length>600)throw Error('reading_mark_not_available');
  const p=asset.paragraphs.find(p=>p.key===proposed.paragraphKey);
  let quoted=proposed.selectedText;
  const detail={operation:'mark',paragraphKey:String(proposed.paragraphKey??'').slice(0,80),paragraphKnown:!!p,selectedText:typeof quoted==='string'?quoted.slice(0,120):null,selectedInStudent:typeof quoted==='string'&&student.content.includes(quoted)};
  const refuse=code=>Object.assign(Error(code),{detail});
  if(!p||typeof quoted!=='string'||!quoted.trim()||quoted.length>120)throw refuse('reading_selection_not_verified');
  if(!student.content.includes(quoted)){quoted=studentSpanFor(student.content,quoted,p.text);if(!quoted)throw refuse('reading_selection_not_verified');}
  const text=unpunctuated(quoted);if(!text)throw refuse('reading_selection_not_verified');
  const start=p.text.indexOf(text);if(start<0||p.text.indexOf(text,start+1)>=0)throw Error('reading_selection_ambiguous');
  if(state?.marks?.some(m=>m.paragraphKey===p.key&&start<m.endOffset&&start+text.length>m.startOffset))throw Error('reading_original_mark_preserved');
  return {operation:'mark',payload:{...common,paragraphKey:p.key,startOffset:start,endOffset:start+text.length,selectedText:text,guess:ref.quote},evidence:ref};
 }
 if(proposed.operation==='submit'){
  if(!asset||(!notes&&(state?.submitted||[...ref.quote].length<12))||ref.quote.length>2000)throw Error('reading_summary_not_verified');
  return {operation:'submit',payload:{...common,summary:ref.quote},evidence:ref};
 }
 if(proposed.operation==='resolve'){
  if((!notes&&!state?.submitted)||!state?.marks?.some(m=>m.markId===proposed.markId&&(notes||m.resolutionStatus!=='resolved'&&!m.correction))||ref.quote.length>1200)throw Error('reading_correction_not_verified');
  return {operation:'resolve',payload:{...common,markId:proposed.markId,correction:ref.quote},evidence:ref};
 }
 if(proposed.operation==='acknowledge'){
  // Reading participation is not mastery. Require an explicit, positive learner statement.
  if(!asset||notes||!state?.submitted||!acknowledged(student,ref.quote))throw Error('reading_acknowledgement_not_verified');
  return {operation:'acknowledge',payload:common,evidence:ref};
 }
 throw Error('reading_operation_not_allowed');
}
export const READING_CONVERSATION_POLICY=`學生眼中只有與作者的連續談話，沒有關卡、提交表單或機械逐欄問卷。先回應對方的問題或學習偏好，再自然帶回尚未有證據的要求。開場可邀請學生選擇先讀、先問或分享感受；不要要求固定學習順序，除非後端必要條件尚未滿足。不能把學生聊天內容自動當作正在填某個欄位。已說清楚的證據直接引用，不要要求再抄一次。不得聲稱完成或保存了尚未獲後端確認的動作。
firstReading若存在，提供了同版本無標點正文和原有疑點紀錄。讀者可自由切換無標點、標點、註釋材料，看到註釋不等於獨立掌握。用作者口吻請學生引用一處疑點並說第一直覺；kind為classical-original時，涵蓋原要求至少三處互不重疊疑點及至少12字初讀感知；kind為conversation-reading時，詩詞、現代文等的疑點、猜測、初讀感知與每次訂正都另存，不硬套文言文的數量門檻，也不代替原有計分及通讀確認。任何文體都可以對照註釋並在對話中修正原猜測。不要顯示數字關卡或用三個孤立表單替代對話。
每輪至多附一個readingEvidence:{operation:"mark|submit|resolve|acknowledge",evidence:{turnId,quote},paragraphKey?,selectedText?,markId?}。所有evidence.quote逐字來自學生，不能替學生編寫或改寫猜測。mark的selectedText必須逐字來自學生回答，去除標點後能在指定無標點段落唯一定位；submit引用學生完整初讀感知；resolve引用學生自己修正的解釋及已存在markId。acknowledge僅用於classical-original，其他文體的通讀確認用originalEvidence；只引用學生明確的已讀完陳述，不把問句、否定或含糊語句判成閱讀完成。原紀錄與評價不覆寫，不更改門檻。後端決定是否接受，失敗就保留原話待核查。
conversationGuide是後端尚待核验的既有要求，只作教學參考，不照搬為選單或命令。conversationOriginalTasks列出本輪可核驗的原有動作；通讀確認不必等待當前字詞提問結束。僅從此清單選取read、evaluation、vocabulary，附originalEvidence:{objectiveId,evidence:{turnId,quote}}；只抽取學生明確表示已讀完整篇、明確0–100自評數字、明確選項原文或A/B/C/D，不推測選擇。通讀引用完整肯定陳述，不把否定、假設、問句或局部閱讀截成完成；不要求固定口令，不符合可驗證形式時自然澄清。原題選項與自評由伺服器答案鍵確定性核驗並記錄；你在 reply 裡直接肯定或指出，不要說要交給別人核對。`;

export function validateOriginalEvidence(proposed,{turns,curriculum,task,tasks=null}){
 if(!proposed)return null;
 if(tasks!==null)task=tasks.find(t=>t.objectiveId===proposed.objectiveId);
 if(!task||proposed.objectiveId!==task.objectiveId||!['read','evaluation','vocabulary'].includes(task.kind))throw Error('original_evidence_wrong_task');
 const ref=proposed.evidence,t=turns.find(t=>t.id===ref?.turnId&&t.role==='student');
 if(!t||typeof ref.quote!=='string'||!t.content.includes(ref.quote)||!ref.quote.trim())throw Error('original_evidence_not_student_quote');
 if(task.kind==='read'){
  if(!acknowledged(t,ref.quote))throw Error('reading_acknowledgement_not_verified');
  return {task,input:{acknowledgement:'已讀完'},evidence:ref};
 }
 if(task.kind==='evaluation'){
  const statement=t.content.trim(),rating=explicitRating(statement,ref.quote);
  if(rating===null)throw Error('rating_not_explicit');
  if(rating<0||rating>100)throw Error('rating_out_of_range');
  return {task,input:{rating,reason:statement.slice(0,300)},evidence:ref};
 }
 // A choice is explicit when the quoted part of the student's own words names exactly one option, as an option
 // text or an option letter in a choosing clause (我選 C / 答案是 C / C 停止); hedging between options is not a choice.
 const selectedIndex=explicitChoice(task.options,t.content,ref.quote);
 if(selectedIndex<0||!task.options[selectedIndex])throw Error('choice_not_explicit');
 return {task,input:{selectedIndex},evidence:ref};
}
const CLAUSE=/[，,。！？!?；;：:\n]+/u;
const clausesOf=text=>text.split(CLAUSE).map(c=>c.trim()).filter(Boolean);
const unquote=c=>c.replace(/^[「『"'“‘《]+|[」』"'”’》]+$/gu,'').trim();
// A negated, hypothetical or questioning clause never states a choice or a rating.
const HEDGED=/(不|沒|没|未|非|別|别|如果|假如|要是|若是|倘若|萬一|万一|可能|也許|也许|或許|或许|或者|還是|还是|猶豫|犹豫|嗎|吗|呢)/u;
const CHOOSING=/^(?:原題|原题|這題|这题|這一題|这一题|那題|那题|題目|题目)?\s*(?:的)?(?:答案)?\s*(?:我|我的|我會|我会)?\s*(?:選|选|答|選擇|选择|認為是|认为是|覺得是|觉得是|答案是|是|選了|选了)?\s*([A-Da-d])(?:\s*[．.、]?\s*(.+))?$/u;
export function explicitChoice(options,content,quote){
 const text=String(quote||'').trim().replace(/[。！!]+$/u,'');if(!text)return -1;
 const own=clausesOf(content),parts=clausesOf(text);
 if(!parts.length||!parts.every(q=>own.some(c=>c===q||c.includes(q))))return -1;
 const found=new Set(),plain=x=>String(x).replace(/[\s\p{P}]/gu,'');
 // A clause that only reproduces an option's own words (e.g. 「…离人无限的别愁」) is not a hedge, whatever characters it contains.
 const optionWords=c=>{const p=plain(unquote(c));return p.length>=2&&options.some(o=>plain(o).includes(p));};
 for(const q of parts){
  if(own.some(c=>(c===q||c.includes(q))&&!optionWords(c)&&HEDGED.test(c)))return -1;
  const oi=options.findIndex(o=>unquote(q)===o);if(oi>=0){found.add(oi);continue;}
  const m=CHOOSING.exec(q);if(!m)continue;
  const li=m[1].toUpperCase().charCodeAt(0)-65,tail=m[2]?unquote(m[2]):'';
  if(!options[li])continue;
  found.add(li);
 }
 // Every option mentioned anywhere in the quoted words must be the chosen one.
 for(const q of parts)for(const [i,o] of options.entries())if(q.includes(o))found.add(i);
 return found.size===1?[...found][0]:-1;
}
const RATING=/(?:^|[^\d.])(\d{1,3}(?:\.\d+)?)\s*(?:分|%|％)(?![\d])/u;
export function explicitRating(content,quote){
 const text=String(quote||'').trim().replace(/[。！!]+$/u,'');if(!text)return null;
 const own=clausesOf(content),parts=clausesOf(text);
 if(!parts.length||!parts.every(q=>own.some(c=>c===q||c.includes(q))))return null;
 const rated=own.filter(c=>RATING.test(c));if(rated.length!==1||HEDGED.test(rated[0]))return null;
 const value=Number(RATING.exec(rated[0])[1]);
 const bare=/^(?:我(?:給|给|覺得|觉得|的評價是|的评价是|會給|会给|打)?\s*)?(\d{1,3}(?:\.\d+)?)\s*(?:分|%|％)?$/u.exec(text);
 if(bare)return Number(bare[1])===value?value:null;
 return parts.some(q=>q===rated[0]||rated[0].includes(q)&&RATING.test(q))?value:null;
}
