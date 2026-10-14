// Exact source text projections, with stable note/passages and source hashes.
// A linked PDF/image is inventory only; its URL is never treated as read content.
function textOf(value){
 if(!value)return '';
 if(typeof value==='string')return value;
 if(Array.isArray(value))return value.map(textOf).filter(Boolean).join('\n');
 if(typeof value.text==='string')return value.text;
 if(value.runs)return value.runs.map(r=>r.type==='annotation-ref'?'':textOf(r)).join('');
 for(const key of ['blocks','children','items','rows','cells'])if(value[key])return textOf(value[key]);
 return '';
}
function noteIds(value,out=new Set()){
 if(!value||typeof value!=='object')return out;
 if(value.type==='annotation-ref'&&value.noteId)out.add(value.noteId);
 for(const child of Object.values(value))if(child&&typeof child==='object'){
  if(Array.isArray(child))child.forEach(v=>noteIds(v,out));else noteIds(child,out);
 }
 return out;
}
export function sourcePassages(curriculum){return curriculum.passages.map(p=>({id:p.id,text:p.text,annotationIds:[...noteIds(p.block)]}));}
export function excerptAnnotationIds(curriculum,id,start,end){
 const p=curriculum.passages.find(p=>p.id===id),runs=p?.block?.runs;
 if(!runs||runs.map(r=>r.type==='annotation-ref'?'':r.text||'').join('')!==p.text)return [...noteIds(p?.block)];
 let offset=0;const ids=[];
 for(const run of runs){if(run.type==='annotation-ref'){if(offset>=start&&offset<=end)ids.push(run.noteId);}else offset+=(run.text||'').length;}
 return [...new Set(ids)];
}
export function sourceAnnotations(curriculum){
 return (curriculum.annotations||[]).map(a=>({noteId:a.noteId,text:textOf(a.blocks),passageIds:curriculum.passages.filter(p=>noteIds(p.block).has(a.noteId)).map(p=>p.id)}));
}
export function annotationWindow(annotations,passages,cue=''){
 const ids=new Set(passages.flatMap(p=>p.annotationIds||[]));
 return annotations.filter(a=>ids.has(a.noteId)||cue.includes(a.noteId)||(a.text.length>=3&&cue.includes(a.text.split(/[：:，,。]/u)[0])));
}
export function sourceProvenance(curriculum){return {curriculumVersion:curriculum.curriculumVersion,sourceUrl:curriculum.source,...curriculum.sourceInventory,notice:'正文及註釋均由已核對的原課資料直接抽取；段落和註釋ID可回查。未提供的附件原頁不能當作已讀。'};}

export function formalMaterials(curriculum,cue,budget){
 const allPassages=sourcePassages(curriculum),allNotes=sourceAnnotations(curriculum);
 const base={sourceProvenance:sourceProvenance(curriculum),passages:allPassages,annotations:allNotes};
 if(JSON.stringify(base).length<=budget-24)return {...base,coverage:'complete'};
 const terms=cue.match(/[\p{L}\p{N}]{2,}/gu)||[];
 const rank=p=>terms.reduce((n,q)=>n+(p.text.includes(q)?q.length:0),0)+(cue.includes(p.id)?10000:0);
 const ranked=allPassages.map((p,i)=>({p,i,rank:rank(p)})).sort((a,b)=>b.rank-a.rank||a.i-b.i);
 const value={sourceProvenance:base.sourceProvenance,passages:[],annotations:[],coverage:'exact-excerpts',totalPassages:allPassages.length,totalAnnotations:allNotes.length,notice:'只可根據本輪正文及註釋評閱；省略部分並非已讀來源，證據不足不可推定通過。'};
 for(const {p} of ranked){
  if(value.passages.length>=3)break;
  const match=terms.find(q=>p.text.includes(q)),start=Math.max(0,(match?p.text.indexOf(match):0)-160),text=p.text.slice(start,start+1200);
  const excerpt={...p,text,annotationIds:excerptAnnotationIds(curriculum,p.id,start,start+text.length),sourceOffsets:[start,start+text.length],excerpted:start!==0||text.length!==p.text.length};
  const next={...value,passages:[...value.passages,excerpt]};
  if(JSON.stringify(next).length>budget-500)continue;
  value.passages=next.passages;
  const notes=annotationWindow(allNotes,[excerpt],cue);
  for(const note of notes){if(value.annotations.some(a=>a.noteId===note.noteId))continue;if(JSON.stringify({...value,annotations:[...value.annotations,note]}).length<=budget)value.annotations.push(note);}
 }
 if(!value.passages.length)throw Error('source_material_budget_exceeded');
 return value;
}
