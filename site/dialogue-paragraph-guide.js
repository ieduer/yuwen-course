// Classical close reading goes through the text one paragraph at a time. Every required word belongs to the first of
// its source paragraphs whose text contains its source sentence; the focus is the first paragraph that still has a word
// to confirm, and within it the first such word in reading order. The guide only orders and reports progress: it never
// confirms a word, and a word counts as confirmed only when the server already holds verified evidence for it
// (a demonstrated dialogue assessment or a preserved original answer).
// v2 (r40): the lesson's study-guide items (古今異義、虛詞、通假、句式 and the comprehension items) are read in the same
// pass. An item belongs to the paragraph of the last sentence it quotes; an item that quotes nothing in the text (a whole-
// text summary, a cross-text comparison, a list of terms) belongs to a closing 「通篇」 stage. An item is confirmed only by
// its preserved original record (the study-guide answer key or rubric); the guide never confirms it either.
import {foldScript} from './dialogue-script-fold.js';
export const PARAGRAPH_GUIDE_VERSION='yw-paragraph-guide-v2';
const CONFIRMED=['demonstrated','preserved'];
const WAITING=['review','historical_review','pending_calibration'];
const fold=value=>String(value||'').replace(/[\s\p{P}\p{S}]/gu,'');
// A paragraph is named by its opening words (e.g. 「是日也」): passage ids and guide ordinals can differ from the
// paragraph numbers a student sees in the textbook, because a lesson may carry captions or skip paragraphs without words.
const opening=text=>{const head=String(text||'').trim().split(/[，。；：！？、,.;:!?\s]/u).find(x=>x.length>=2)||String(text||'').trim();return [...head].slice(0,8).join('');};
// An item stops being offered once its answer was shown before a pass, or after this many unsuccessful dialogue attempts.
export const STUDY_GUIDE_MAX_ATTEMPTS=3;
// An item offered for this many turns without an attempt moves to the 通篇 stage, so it never holds the reading back.
export const STUDY_GUIDE_DEFER_TURNS=3;
const QUOTE=/[“"「『‘']([^”"」』’']{2,80})[”"」』’']/gu;
// Without quotation marks, a list after the colon (；、 or circled numbers) names the sentences or terms.
const listed=prompt=>{const tail=String(prompt).split(/[：:]/u).slice(1).join('：');return tail?tail.split(/[；;、①②③④⑤⑥⑦⑧⑨⑩⑪⑫（）()]|\s+[A-D][.．]\s*/u).map(x=>x.replace(/[。.]$/u,'').trim()).filter(x=>x.length>=3):[];};
const KINDS=[[/ancient[-_]modern|semantic_shift/u,'古今異義'],[/function[-_.]word|nai_yin|\.yi$/u,'虛詞'],[/phonetic[-_]loan|tongjia/u,'通假'],[/sentence[-_.]segmentation|punctuation/u,'斷句'],[/sentence[-_.]pattern|translation/u,'句式'],[/word_class|activation/u,'詞類活用'],[/polysemy/u,'一詞多義'],[/idiom/u,'成語'],[/pronunciation/u,'讀音']];
export function studyGuideKind(item,competencyTag){
 const detail=String(item?.detailTag||'');
 for(const [pattern,label] of KINDS)if(pattern.test(detail))return label;
 return competencyTag==='syntax'?'句式':competencyTag==='comprehension'?'理解':'詞義';
}
// The study-guide items that can still be answered: active, not held for review, with a registered formative entry.
export function guideItems(curriculum){
 const formative=new Map((curriculum?.legacy?.formative||[]).map(i=>[i.itemKey,i]));
 return (curriculum?.objectives||[]).filter(o=>o.domain==='studyGuide').flatMap(o=>{
  const item=(curriculum.studyGuide||[]).find(i=>i.itemKey===o.sourceItemKey),source=formative.get(o.sourceItemKey);
  return item?.activeForSelfTest===true&&!item.reviewRequired&&source?[{objective:o,item,source,kind:studyGuideKind(item,source.competencyTag),competencyTag:source.competencyTag}]:[];
 });
}
// Where an item is read: the paragraph of the last sentence it quotes (script and punctuation folded), else 通篇.
export function studyGuidePlacement(curriculum,item){
 const passages=(curriculum?.passages||[]).map((p,i)=>({id:p.id,i,text:foldScript(fold(p.text))}));
 const quoted=[...String(item?.prompt||'').matchAll(QUOTE)].map(m=>m[1]),quotes=quoted.length?quoted:listed(item?.prompt);
 const found=quotes.flatMap(q=>{const fq=foldScript(fold(q));if(fq.length<2)return [];const p=passages.find(p=>p.text.includes(fq));return p?[{quote:q,passageId:p.id,rank:[p.i,p.text.indexOf(fq)+fq.length]}]:[];})
  .sort((a,b)=>a.rank[0]-b.rank[0]||a.rank[1]-b.rank[1]);
 const last=found.at(-1)||null;
 return last?{placement:found.length===quotes.length?'paragraph':'paragraph-partial',passageId:last.passageId,rank:last.rank,sentence:last.quote}:{placement:'whole-text',passageId:null,rank:null,sentence:null};
}

function originalStatus(curriculum,state,objectiveId){
 const key=`effect:${curriculum.lessonId}:vocab:${objectiveId}`;
 const legacy=curriculum.objectives.find(o=>o.domain==='legacy'&&o.legacy?.questionKind==='vocabulary'&&o.legacy.resourceKey===key);
 return legacy?state.objectives.find(o=>o.id===legacy.id)?.status||'not_yet_observed':null;
}

// items: the lesson's question items (questionItems(curriculum)), passed in to keep this module free of policy imports.
// current: the objective of the question already open, if any. While its word is still open the focus stays on it, so the
// author and the server never point at different words (r35: reopened earlier words wait until the open question ends).
// progress (server-computed, optional): {attempts:{id:n}, shown:{id:true}, offered:{id:n}} for the study-guide items.
export function paragraphGuide(curriculum,state,items,current=null,progress=null){
 if(curriculum?.mode!=='classical'||!state?.readingGate||!Array.isArray(curriculum.passages))return null;
 const passages=curriculum.passages,index=new Map(passages.map((p,i)=>[p.id,i]));
 const status=id=>state.objectives.find(o=>o.id===id)?.status||'not_yet_observed';
 const words=(items||[]).flatMap(v=>{
  const o=curriculum.objectives.find(x=>x.id===v.id&&x.domain==='vocabulary');
  if(!o)return [];
  const sentence=fold(v.sourceSentence),candidates=(o.sourcePassages||[]).filter(id=>index.has(id));
  const home=candidates.find(id=>sentence&&fold(passages[index.get(id)].text).includes(sentence))||candidates[0]||null;
  const offset=home&&sentence?Math.max(0,fold(passages[index.get(home)].text).indexOf(sentence)):0;
  const own=status(v.id),original=originalStatus(curriculum,state,v.id);
  const st=CONFIRMED.includes(own)||original==='preserved'?'confirmed':WAITING.includes(own)?'waiting':'open';
  return [{entry:'word',objectiveId:v.id,word:v.word,sentence:v.sourceSentence||null,passageId:home,rank:[home?index.get(home):passages.length,offset,0],status:st,routes:{dialogue:own,original}}];
 });
 const attempts=progress?.attempts||{},shown=progress?.shown||{},offered=progress?.offered||{};
 const guides=guideItems(curriculum).map((g,n)=>{
  const id=g.objective.id,own=status(id),place=studyGuidePlacement(curriculum,g.item),tried=attempts[id]||0;
  const closed=own==='preserved'?null:own==='historical_review'?'historical':shown[id]?'reference_shown':tried>=STUDY_GUIDE_MAX_ATTEMPTS?'attempts':null;
  const st=own==='preserved'?'confirmed':closed?'waiting':'open';
  const deferred=st==='open'&&!tried&&(offered[id]||0)>=STUDY_GUIDE_DEFER_TURNS;
  const passageId=deferred?null:place.passageId;
  // Within a paragraph an item follows the words of its sentence: words rank by where their sentence starts, items by where
  // their last quoted sentence ends.
  return {entry:'studyGuide',objectiveId:id,kind:g.kind,prompt:g.item.prompt,sentence:place.sentence,placement:deferred?'deferred':place.placement,passageId,rank:passageId?[index.get(passageId),place.rank[1],1]:[passages.length,n,1],status:st,attempts:tried,...(closed?{closed}:{})};
 });
 const entries=[...words,...guides].sort((a,b)=>a.rank[0]-b.rank[0]||a.rank[1]-b.rank[1]||a.rank[2]-b.rank[2]||a.objectiveId.localeCompare(b.objectiveId));
 const paragraphs=[];
 for(const e of entries){
  let p=paragraphs.at(-1);
  if(!p||p.passageId!==e.passageId){p={passageId:e.passageId,ordinal:paragraphs.length+1,opening:e.passageId?opening(passages[index.get(e.passageId)].text):'通篇',...(e.passageId?{}:{wholeText:true}),words:[],items:[],order:[]};paragraphs.push(p);}
  (e.entry==='word'?p.words:p.items).push(e);p.order.push(e);
 }
 for(const p of paragraphs){p.confirmed=p.words.filter(w=>w.status==='confirmed').length;p.total=p.words.length;p.itemsConfirmed=p.items.filter(i=>i.status==='confirmed').length;p.itemsTotal=p.items.length;}
 const held=current?paragraphs.find(p=>p.words.some(w=>w.objectiveId===current&&w.status==='open')):null;
 const focusParagraph=held||paragraphs.find(p=>p.order.some(e=>e.status==='open'))||null;
 const next=(held&&held.words.find(w=>w.objectiveId===current))||focusParagraph?.order.find(e=>e.status==='open')||null;
 const cleanWord=w=>({objectiveId:w.objectiveId,word:w.word,sentence:w.sentence,status:w.status});
 const cleanItem=i=>({objectiveId:i.objectiveId,type:i.kind,prompt:i.prompt,sentence:i.sentence,status:i.status,attempts:i.attempts,...(i.closed?{closed:i.closed}:{}),...(i.placement==='deferred'?{deferred:true}:{})});
 const cleanNext=e=>e?(e.entry==='word'?{kind:'word',...cleanWord(e)}:{kind:'studyGuide',...cleanItem(e)}):null;
 const allWords=words,allItems=guides,openWords=allWords.some(w=>w.status==='open');
 return {
  version:PARAGRAPH_GUIDE_VERSION,phase:state.readingGate.phase,
  ...(state.readingGate.phase==='initial_reading'?{firstRead:{marks:state.readingGate.marks||0,required:state.readingGate.marksRequired||3,summaryWritten:!!state.readingGate.summaryWritten}}:{}),
  order:entries.filter(e=>e.entry==='word').map(w=>w.objectiveId),
  itemOrder:entries.filter(e=>e.entry==='studyGuide').map(i=>i.objectiveId),
  paragraphs:paragraphs.map(p=>({passageId:p.passageId,ordinal:p.ordinal,opening:p.opening,...(p.wholeText?{wholeText:true}:{}),confirmed:p.confirmed,total:p.total,itemsConfirmed:p.itemsConfirmed,itemsTotal:p.itemsTotal,words:p.words.map(cleanWord),items:p.items.map(cleanItem)})),
  focus:focusParagraph?{passageId:focusParagraph.passageId,ordinal:focusParagraph.ordinal,of:paragraphs.length,opening:focusParagraph.opening,...(focusParagraph.wholeText?{wholeText:true}:{}),confirmed:focusParagraph.confirmed,total:focusParagraph.total,itemsConfirmed:focusParagraph.itemsConfirmed,itemsTotal:focusParagraph.itemsTotal,words:focusParagraph.words.map(cleanWord),items:focusParagraph.items.map(cleanItem),next:cleanNext(next)}:null,
  confirmedWords:allWords.filter(w=>w.status==='confirmed').length,totalWords:allWords.length,
  waitingWords:allWords.filter(w=>w.status==='waiting').length,wordsComplete:!openWords,
  confirmedItems:allItems.filter(i=>i.status==='confirmed').length,totalItems:allItems.length,waitingItems:allItems.filter(i=>i.status==='waiting').length,
  complete:!focusParagraph,
 };
}

// The model sees only the focus paragraph and the counts, not every word list, to keep the prompt small.
export function paragraphGuideContext(guide){
 if(!guide||guide.phase!=='close_reading')return null;
 return {version:guide.version,focus:guide.focus,confirmedWords:guide.confirmedWords,totalWords:guide.totalWords,confirmedItems:guide.confirmedItems,totalItems:guide.totalItems,complete:guide.complete};
}
