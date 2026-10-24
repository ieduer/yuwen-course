// Classical close reading goes through the text one paragraph at a time. Every required word belongs to the first of
// its source paragraphs whose text contains its source sentence; the focus is the first paragraph that still has a word
// to confirm, and within it the first such word in reading order. The guide only orders and reports progress: it never
// confirms a word, and a word counts as confirmed only when the server already holds verified evidence for it
// (a demonstrated dialogue assessment or a preserved original answer).
export const PARAGRAPH_GUIDE_VERSION='yw-paragraph-guide-v1';
const CONFIRMED=['demonstrated','preserved'];
const WAITING=['review','historical_review','pending_calibration'];
const fold=value=>String(value||'').replace(/[\s\p{P}\p{S}]/gu,'');
// A paragraph is named by its opening words (e.g. 「是日也」): passage ids and guide ordinals can differ from the
// paragraph numbers a student sees in the textbook, because a lesson may carry captions or skip paragraphs without words.
const opening=text=>{const head=String(text||'').trim().split(/[，。；：！？、,.;:!?\s]/u).find(x=>x.length>=2)||String(text||'').trim();return [...head].slice(0,8).join('');};

function originalStatus(curriculum,state,objectiveId){
 const key=`effect:${curriculum.lessonId}:vocab:${objectiveId}`;
 const legacy=curriculum.objectives.find(o=>o.domain==='legacy'&&o.legacy?.questionKind==='vocabulary'&&o.legacy.resourceKey===key);
 return legacy?state.objectives.find(o=>o.id===legacy.id)?.status||'not_yet_observed':null;
}

// items: the lesson's question items (questionItems(curriculum)), passed in to keep this module free of policy imports.
// current: the objective of the question already open, if any. While its word is still open the focus stays on it, so the
// author and the server never point at different words (r35: reopened earlier words wait until the open question ends).
export function paragraphGuide(curriculum,state,items,current=null){
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
  return [{objectiveId:v.id,word:v.word,sentence:v.sourceSentence||null,passageId:home,rank:[home?index.get(home):passages.length,offset],status:st,routes:{dialogue:own,original}}];
 }).sort((a,b)=>a.rank[0]-b.rank[0]||a.rank[1]-b.rank[1]||a.objectiveId.localeCompare(b.objectiveId));
 const paragraphs=[];
 for(const w of words){
  let p=paragraphs.at(-1);
  if(!p||p.passageId!==w.passageId){p={passageId:w.passageId,ordinal:paragraphs.length+1,opening:w.passageId?opening(passages[index.get(w.passageId)].text):null,words:[]};paragraphs.push(p);}
  p.words.push(w);
 }
 for(const p of paragraphs){p.confirmed=p.words.filter(w=>w.status==='confirmed').length;p.total=p.words.length;}
 const held=current?paragraphs.find(p=>p.words.some(w=>w.objectiveId===current&&w.status==='open')):null;
 const focusParagraph=held||paragraphs.find(p=>p.words.some(w=>w.status==='open'))||null;
 const next=(held&&held.words.find(w=>w.objectiveId===current))||focusParagraph?.words.find(w=>w.status==='open')||null;
 const clean=w=>({objectiveId:w.objectiveId,word:w.word,sentence:w.sentence,status:w.status});
 return {
  version:PARAGRAPH_GUIDE_VERSION,phase:state.readingGate.phase,
  ...(state.readingGate.phase==='initial_reading'?{firstRead:{marks:state.readingGate.marks||0,required:state.readingGate.marksRequired||3,summaryWritten:!!state.readingGate.summaryWritten}}:{}),
  order:words.map(w=>w.objectiveId),
  paragraphs:paragraphs.map(p=>({passageId:p.passageId,ordinal:p.ordinal,opening:p.opening,confirmed:p.confirmed,total:p.total,words:p.words.map(clean)})),
  focus:focusParagraph?{passageId:focusParagraph.passageId,ordinal:focusParagraph.ordinal,of:paragraphs.length,opening:focusParagraph.opening,confirmed:focusParagraph.confirmed,total:focusParagraph.total,words:focusParagraph.words.map(clean),next:clean(next)}:null,
  confirmedWords:words.filter(w=>w.status==='confirmed').length,totalWords:words.length,
  waitingWords:words.filter(w=>w.status==='waiting').length,complete:!focusParagraph,
 };
}

// The model sees only the focus paragraph and the counts, not every word list, to keep the prompt small.
export function paragraphGuideContext(guide){
 if(!guide||guide.phase!=='close_reading')return null;
 return {version:guide.version,focus:guide.focus,confirmedWords:guide.confirmedWords,totalWords:guide.totalWords,complete:guide.complete};
}
