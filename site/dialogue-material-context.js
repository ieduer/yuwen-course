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
 const mediaIds=(value,out=new Set())=>{if(value&&typeof value==='object'){if(value.mediaId)out.add(value.mediaId);for(const child of Object.values(value))if(child&&typeof child==='object')mediaIds(child,out);}return [...out];};
 return (curriculum.annotations||[]).map(a=>{const unavailable=mediaIds(a.blocks);return {noteId:a.noteId,text:textOf(a.blocks),passageIds:curriculum.passages.filter(p=>noteIds(p.block).has(a.noteId)).map(p=>p.id),...(unavailable.length?{unprovidedMediaIds:unavailable,notice:'此原註釋含未提供給模型的圖像／媒體；文字提取不代表已讀原圖，不能依缺失內容評閱。'}:{})};});
}
export function annotationWindow(annotations,passages,cue=''){
 const ids=new Set(passages.flatMap(p=>p.annotationIds||[]));
 return annotations.filter(a=>ids.has(a.noteId)||cue.includes(a.noteId)||(a.text.length>=3&&cue.includes(a.text.split(/[：:，,。]/u)[0])));
}
export function sourceProvenance(curriculum){return {curriculumVersion:curriculum.curriculumVersion,sourceUrl:curriculum.source,...curriculum.sourceInventory,notice:'正文及註釋均由已核對的原課資料直接抽取；段落和註釋ID可回查。未提供的附件原頁不能當作已讀。'};}

export function formalMaterials(curriculum,cue,budget){
 if(!Number.isSafeInteger(budget)||budget<=0)throw Error('source_material_budget_exceeded');
 const allPassages=sourcePassages(curriculum),allNotes=sourceAnnotations(curriculum);
 const byNote=new Map(allNotes.map(note=>[note.noteId,note]));
 const available=id=>!!byNote.get(id)?.text?.trim()&&!byNote.get(id)?.unprovidedMediaIds?.length;
 const base={sourceProvenance:sourceProvenance(curriculum),passages:allPassages,annotations:allNotes};
 const complete={...base,coverage:'complete'};
 if(allPassages.every(p=>p.annotationIds.every(available))&&JSON.stringify(complete).length<=budget)return complete;
 const terms=cue.match(/[\p{L}\p{N}]{2,}/gu)||[];
 const pinned=p=>new RegExp(`(?:^|[^\\w:-])${p.id.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?=$|[^\\w:-])`).test(cue);
 const rank=p=>terms.reduce((n,q)=>n+(p.text.includes(q)?q.length:0),0)+(pinned(p)?10000:0);
 const ranked=allPassages.map((p,i)=>({p,i,rank:rank(p)})).sort((a,b)=>b.rank-a.rank||a.i-b.i);
 const value={sourceProvenance:base.sourceProvenance,passages:[],annotations:[],coverage:'exact-excerpts',totalPassages:allPassages.length,totalAnnotations:allNotes.length,notice:'只可根據本輪正文及註釋評閱；省略部分並非已讀來源，證據不足不可推定通過。'};
 for(const {p} of ranked){
  if(value.passages.length>=3)break;
  const match=p.text.length<=1200&&cue.includes(p.text)?p.text:terms.filter(q=>p.text.includes(q)).sort((a,b)=>b.length-a.length)[0],anchor=match?p.text.indexOf(match):0;
  const minimum=Math.min(p.text.length,Math.max(1,Math.min(match?.length||80,1200)));
  let accepted=false,unavailable=false;
  // A passage and all of its referenced notes are one indivisible packet.
  // Reduce surrounding source text before considering another passage; never
  // retain a reference while silently dropping its original annotation.
  for(let length=Math.min(1200,p.text.length);length>=minimum;){
   const start=Math.max(0,anchor-Math.min(160,Math.max(0,length-(match?.length||0)))),text=p.text.slice(start,start+length);
   const annotationIds=excerptAnnotationIds(curriculum,p.id,start,start+text.length);
   const excerpt={...p,text,annotationIds,sourceOffsets:[start,start+text.length],excerpted:start!==0||text.length!==p.text.length};
   const ids=new Set([...value.annotations.map(a=>a.noteId),...annotationIds]);
   const next={...value,passages:[...value.passages,excerpt],annotations:allNotes.filter(a=>ids.has(a.noteId))};
   unavailable=annotationIds.some(id=>!available(id));
   if(!unavailable&&JSON.stringify(next).length<=budget){value.passages=next.passages;value.annotations=next.annotations;accepted=true;break;}
   if(length===minimum)break;length=Math.max(minimum,Math.floor(length/2));
  }
  if(!accepted&&pinned(p))throw Error(unavailable?'source_annotation_unavailable':'source_material_budget_exceeded');
 }
 if(!value.passages.length)throw Error('source_material_budget_exceeded');
 // Optional cue-related notes may use only the space left after every selected
 // passage's required notes. They can never displace that source evidence.
 for(const note of annotationWindow(allNotes,[],cue))if(available(note.noteId)&&!value.annotations.some(a=>a.noteId===note.noteId)&&JSON.stringify({...value,annotations:[...value.annotations,note]}).length<=budget)value.annotations.push(note);
 return value;
}
