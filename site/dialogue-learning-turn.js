import {FORMAL_FIELDS, FORMAL_LABELS, prepareFormalInput} from './dialogue-formal.js';
import {approvedSupplement} from './dialogue-completion-exemptions.js';

const completed = new Set(['preserved','historical_review']);
const questions = {
 contextWords:{words:'讀完正文，你會用哪三個有區分的詞描述這篇作品？寫出三詞與你的初步理解。'},
 authorQuestion:{answer:'挑一句讓你想追問的文字，向作者或文本提出一個有依據的問題。'},
 revision:{original:'挑一句你想試著增、刪或調整的原文，先把原句寫下來。',action:'你想怎樣調整這一句：增、刪，還是調換？',revised:'把你調整後的完整句子寫下來。',reason:'比較原句和改句：意思、語氣、節奏或表達效果發生了甚麼變化？'},
 structure:{reason:'找出正文中至少兩處彼此呼應的文字，說說它們如何共同形成表達效果。'},
 wordCreation:{word:'選一個本課新學或想活用的字詞。',creation:'用這個字詞寫一段短小的創作，可以是對白、短詩或三句小說。'},
};
export function learningTurn(curriculum,state,{revision=0,fields=[],question=null,mastery=[],submissions=[],sourceDraft=null}={}){
 const task=(kind,objectiveId,prompt,extra={})=>({taskId:`${curriculum.curriculumVersion}:${revision}:${objectiveId}:${extra.field||kind}`,objectiveId,kind,inputKind:'text',prompt,...extra});
 const exemption=approvedSupplement(curriculum);
 if(exemption)return task('exemption','owner-approved-supplement',`已通過（補充篇目）。${exemption.reason} 原有紀錄與分數保持不變。`,{inputKind:'none'});
 if(curriculum.status==='source-unavailable'||curriculum.sourceStatus==='source-unavailable'||!curriculum.passages?.length)return task('unavailable','source','本課正文來源尚待核對；已保存的紀錄保留，暫不作新的評價。',{inputKind:'none'});
 if(state.readingGate&&state.readingGate.phase!=='close_reading')return null;
 if(state.legacyCompletion)return task('dialogue','optional','原有完成紀錄已保留。你想繼續細讀哪一句？');
 if(question)return task('dialogue',question.objectiveId,question.question,{questionId:question.id,source:question.source});
 const pending=o=>!completed.has(state.objectives.find(x=>x.id===o.id)?.status);
 const reviewIds=new Set(submissions.filter(s=>s.status==='unconfirmed').map(s=>s.objectiveId));
 const read=curriculum.objectives.find(o=>o.domain==='read'&&pending(o));
 if(read)return task('read',read.id,'讀完整篇後告訴我一聲（例如「讀完了」），也說說你最先注意到的字句；通讀只是參與紀錄，不是評分。');
 if(state.next?.domain==='vocabulary'&&['needs_practice','reformulated'].includes(state.next.status))return task('dialogue',state.next.id,'用自己的話重新說說這個詞在原句中的意思，以及你判斷的依據。');
 if(sourceDraft&&!reviewIds.has(sourceDraft.formal.objectiveId))return task('sourceEvidence',sourceDraft.formal.objectiveId,'你先前的原話已涵蓋這一項要求。繼續寫下你的補充或下一個問題，原有評價會直接核對已保存的原話。',{references:sourceDraft.references});
 const originals=curriculum.objectives.filter(o=>o.domain==='legacy'&&pending(o)&&!reviewIds.has(o.id));
 for(const kind of ['contextWords','vocabulary','authorQuestion','revision','structure','wordCreation']){
  for(const o of originals.filter(o=>o.legacy.questionKind===kind)){
   if(kind==='vocabulary'){
    const v=curriculum.vocabulary.find(v=>o.legacy.resourceKey===`effect:${curriculum.lessonId}:vocab:${v.id}`);
    if(v&&state.objectives.find(o=>o.id===v.id)?.status==='demonstrated')return task('vocabulary',o.id,v.question,{inputKind:'choice',itemId:v.id,options:v.options,source:v.sourceSentence});
   }else{
    const latest=submissions.filter(s=>s.objectiveId===o.id).at(-1),after=latest?.sequence||0;
    const saved=fields.filter(f=>f.objectiveId===o.id&&f.sequence>after),keys=FORMAL_FIELDS[kind];
    const field=latest?.status==='confirmed'&&latest.input?keys.at(-1):keys.find(key=>!saved.some(f=>f.field===key))||keys[0];
    return task('formal',o.id,questions[kind][field],{field,label:FORMAL_LABELS[kind]});
   }
  }
 }
 for(const o of curriculum.objectives.filter(o=>o.domain==='studyGuide'&&pending(o)&&!reviewIds.has(o.id))){
  const item=(curriculum.studyGuide||[]).find(item=>item.itemKey===o.sourceItemKey);
  if(item?.activeForSelfTest===true&&!item.reviewRequired)return task('studyGuide',o.id,item.prompt,{itemKey:item.itemKey,label:item.answerLabel||'學習提示'});
 }
 const evaluation=originals.find(o=>o.legacy.questionKind==='evaluation');
 if(evaluation)return task('evaluation',evaluation.id,'這篇文章對你有多大意思？用 0 至 100 表達，也可以說說理由；這是自評，不計分。',{inputKind:'rating'});
 return task('dialogue',state.next?.id||'reflection',state.readyForShangyou?'回望最初的理解：哪一處改變了？你現在認同或質疑甚麼？請回到原文說明。':'繼續說說你的理解，並指出支持它的原文字句。');
}
export function collectedFormal(curriculum,task,fields,content,submissions=[]){
 const o=curriculum.objectives.find(o=>o.id===task.objectiveId),keys=FORMAL_FIELDS[o?.legacy?.questionKind];
 if(!keys?.includes(task.field))throw Error('invalid_learning_field');
 const latest=submissions.filter(s=>s.objectiveId===o.id).at(-1),after=latest?.sequence||0;
 const saved=fields.filter(f=>f.objectiveId===o.id&&f.sequence>after);
 const input={...(latest?.status==='confirmed'?latest.input:{}),...Object.fromEntries(saved.map(f=>[f.field,f.content]))};input[task.field]=content;
 return keys.every(key=>typeof input[key]==='string'&&input[key].trim())?prepareFormalInput(curriculum,{objectiveId:o.id,input}):null;
}
