// Reading variants are materials, not a separate form or a progression gate.
// Preserve the canonical first-read offsets whenever that source exists.
export function openFirstReading({lessonId,root,isCurrent,curriculum,onSelect}){
 const abort=new AbortController();
 let sourceAsset=null,marks=[];
 const render=()=>{
  if(!sourceAsset||!isCurrent()||abort.signal.aborted)return;
  root.replaceChildren();
  for(const p of sourceAsset.paragraphs){
   const line=document.createElement('p');line.dataset.readingKey=p.key;line.tabIndex=0;let offset=0;
   for(const m of marks.filter(m=>m.paragraphKey===p.key).sort((a,b)=>a.startOffset-b.startOffset)){
    if(m.startOffset<offset||p.text.slice(m.startOffset,m.endOffset)!==m.selectedText)continue;
    line.append(document.createTextNode(p.text.slice(offset,m.startOffset)));
    const mark=document.createElement('mark');mark.textContent=m.selectedText;mark.tabIndex=0;mark.setAttribute('role','button');mark.setAttribute('aria-label',`討論疑點：${m.selectedText}`);mark.title=m.correction?`原猜測：${m.guess}\n訂正：${m.correction}`:`原猜測：${m.guess}`;
    const discuss=()=>onSelect(p.key,m.selectedText);mark.addEventListener('click',discuss);mark.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();discuss();}});
    line.append(mark);offset=m.endOffset;
   }
   line.append(document.createTextNode(p.text.slice(offset)));root.append(line);
  }
 };
 const ready=(async()=>{
  try{
   let paragraphs;
   if(curriculum.mode==='classical'){
    const response=await fetch(`/data/classical-first-read/${lessonId}.json`,{signal:abort.signal});
    if(!response.ok)throw Error('無標點版本暫時無法讀取；仍可閱讀標點版。');
    const asset=await response.json();sourceAsset=asset;paragraphs=asset.paragraphs;
   }else paragraphs=curriculum.passages.map(p=>({key:p.id,text:p.text.replace(/[\p{P}\s]/gu,'')}));
   if(!isCurrent()||abort.signal.aborted)return;
   sourceAsset||={paragraphs};render();
   const select=()=>{
    const selection=getSelection(),parent=selection?.anchorNode?.parentElement?.closest('[data-reading-key]');
    if(parent&&root.contains(selection.focusNode)&&selection.toString().trim())onSelect(parent.dataset.readingKey,selection.toString().trim());
   };
   root.addEventListener('pointerup',select,{signal:abort.signal});
   root.addEventListener('keyup',select,{signal:abort.signal});
  }catch(error){if(!abort.signal.aborted&&isCurrent())root.textContent=error.message;}
 })();
 return {ready,setMarks:async state=>{await ready;if(!sourceAsset||state.textVersionId!==sourceAsset.textVersionId||state.textDigest!==sourceAsset.textDigest)return;const next=state.marks||[];if(JSON.stringify(next)!==JSON.stringify(marks)){marks=next;render();}},dispose:()=>{abort.abort();marks=[];root.replaceChildren();}};
}
