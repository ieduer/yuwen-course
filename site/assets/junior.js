// 初中（七至九年級）教材閱讀與細讀對話.
//
// The catalogue and page map are /data/junior-textbook-pages.v1.json; each entry's text is
// /data/junior-reading/<id>.json, read by scripts/build_junior_reading.py from the text layer of the
// same sun.bdfz.net PDF whose pages are shown below the text.  Page images, crops of them and the PDF
// are sun.bdfz.net's own files (textbook-pages.js), never a copy.  Reading needs no account.  The
// conversation uses /api/junior/dialogue with the senior dialogue's sign-in and AI budget; it keeps
// the turns for the student and produces no learning record, score or evaluation.
import {PALETTES} from './dialogue-palettes.js?v=a846366df3f1c133';
import {validTextbookPages,lessonPlates,plateUrl,plateViewerUrl,createPlateLoader,TEXTBOOK_IMAGE_ORIGIN} from './textbook-pages.js?v=91556289be7d3930';
import {readDialogueEvents} from './dialogue-events.js?v=a7e6a9d3cf526331';

const DATA_URL='/data/junior-textbook-pages.v1.json';
const READING_URL=id=>`/data/junior-reading/${id}.json`;
const DIALOGUE_URL=id=>`/api/junior/dialogue?entryId=${encodeURIComponent(id)}`;
const LOGIN_URL='https://my.bdfz.net/';
const LAST_KEY='yw-junior-last-lesson';
const ENTRY_ID=/^junior-[a-z0-9]+(?:-[a-z0-9]+){1,4}$/;
const KIND={unit:'單元導語',practice:'閱讀綜合實踐',writing:'寫作',activity:'活動',wholebook:'整本書閱讀',poems:'課外古詩詞誦讀',task:'活動·探究',oral:'口語交際'};
const $=id=>document.getElementById(id);
function node(tag,text,className){const element=document.createElement(tag);if(text!=null)element.textContent=text;if(className)element.className=className;return element;}
function store(key,value){try{window.localStorage.setItem(key,value);}catch{}}
function recall(key){try{return window.localStorage.getItem(key)||'';}catch{return '';}}

let data=null,currentId='',reading=null,generation=0,loaders=[],themeId='',allNotesExpanded=false;
let ownerRef=null,dialogue={revision:0,turns:[],pending:false},sending=false,streamAbort=null;

export function validJuniorData(value){
 if(!validTextbookPages(value)||value.track!=='junior'||value.scoring!=='none'||!Array.isArray(value.order)||!value.order.length||!value.catalog||typeof value.catalog!=='object')return false;
 const seen=new Set();
 for(const bookId of value.order){
  const book=value.books[bookId];
  if(!book||typeof book.label!=='string'||!Array.isArray(value.catalog[bookId])||!value.catalog[bookId].length)return false;
  for(const id of value.catalog[bookId]){const entry=value.lessons[id];if(!ENTRY_ID.test(id)||seen.has(id)||!entry||entry.book!==bookId||typeof entry.title!=='string'||!Array.isArray(entry.pages)||!entry.pages.length)return false;seen.add(id);}
 }
 return true;
}
export function validReading(value,id){
 return !!value&&value.schema==='yw-junior-reading-v1'&&value.id===id&&Array.isArray(value.blocks)&&Array.isArray(value.prep)&&Array.isArray(value.sections)&&Array.isArray(value.notes);
}

// The textbook's own wording; the number column carries the lesson number.
export function entryTitle(entry){
 if(entry.kind==='lesson')return `${entry.selfRead?'* ':''}${entry.title}`;
 if(entry.kind==='task')return `${entry.label} ${entry.title}`;
 if(entry.section)return `${entry.section} · ${entry.title}`;
 return entry.title;
}
function entryKind(entry){return entry.kind==='lesson'?(entry.selfRead?'自讀課文':'教讀課文'):KIND[entry.kind]||'';}
export function pageSpan(entry){
 const printed=entry.pages.map(page=>page.printed).filter(Boolean);
 if(!printed.length)return '單元頁';
 return printed.length===1?`教材第 ${printed[0]} 頁`:`教材第 ${printed[0]}–${printed.at(-1)} 頁`;
}
function allIds(){return data.order.flatMap(bookId=>data.catalog[bookId]);}
function downloadUrl(book){
 const prefix=`/files/pdf/${book.editionId}/${book.pdfSha12}/`;
 return typeof book.pdfDownload==='string'&&book.pdfDownload.startsWith(prefix)?TEXTBOOK_IMAGE_ORIGIN+book.pdfDownload:'';
}
const squash=text=>String(text||'').replace(/[\s·・]+/g,'');
export function runsText(runs){return (runs||[]).map(r=>r.t??r.e??'').join('');}

function renderCatalog(){
 const query=$('lesson-search').value.trim().toLocaleLowerCase(),box=$('catalog-results');box.replaceChildren();
 const senior=node('a','高中五冊 · 尚友細讀','catalog-senior');senior.href='/';box.append(senior);
 let shown=0,total=0;
 for(const bookId of data.order){
  const book=data.books[bookId],ids=data.catalog[bookId];total+=ids.length;
  const matches=ids.filter(id=>{const entry=data.lessons[id];return !query||`${entry.title} ${entry.author||''} ${entry.unit||''} ${book.label} ${entry.section||''} ${(entry.parts||[]).map(p=>p.title).join(' ')}`.toLocaleLowerCase().includes(query);});
  if(!matches.length)continue;shown+=matches.length;
  const group=node('details',undefined,'catalog-book');group.dataset.book=bookId;group.open=!!query||matches.includes(currentId);
  group.ontoggle=()=>{if(group.open)for(const other of box.querySelectorAll('.catalog-book'))if(other!==group)other.open=false;};
  const summary=node('summary');summary.append(node('strong',book.label),node('small',`${ids.length} 項`));group.append(summary);
  const list=node('div',undefined,'book-lessons');
  for(const id of matches){
   const entry=data.lessons[id],link=node('a');link.href='#'+id;
   link.append(node('small',entry.kind==='lesson'?String(entry.number).padStart(2,'0'):'','lesson-number'),node('span',entryTitle(entry)));
   if(entry.kind==='unit')link.classList.add('unit-entry');
   if(id===currentId)link.setAttribute('aria-current','page');
   link.onclick=()=>{if(narrow())setCatalogHidden(true);};
   list.append(link);
  }
  group.append(list);box.append(group);
 }
 $('catalog-count').textContent=`初中 ${shown} / ${total} 項`;
 if(!shown)box.append(node('p','沒有找到篇目，試試篇名中的幾個字。'));
}

// ---------- text ----------
function closeIndividualNotes(){for(const n of document.querySelectorAll('#junior-reading .inline-note'))n.hidden=true;for(const b of document.querySelectorAll('#junior-reading .annotation-toggle'))b.setAttribute('aria-expanded','false');}
function noteParts(note,prefix){
 const button=node('button',undefined,'annotation-toggle'),number=node('sup',note.label,'annotation-number');
 button.type='button';button.append(number);button.setAttribute('aria-label',`註釋 ${note.label}`);
 const body=node('span',undefined,'inline-note');body.id=`${prefix}-${note.id}`;body.setAttribute('role','note');body.setAttribute('aria-label',`註釋 ${note.label}`);body.hidden=!allNotesExpanded;
 appendRuns(body,note.runs,null,prefix);
 button.setAttribute('aria-controls',body.id);button.setAttribute('aria-expanded',String(allNotesExpanded));
 button.onclick=()=>{const open=body.hidden;if(!allNotesExpanded)closeIndividualNotes();body.hidden=!open;button.setAttribute('aria-expanded',String(open));};
 return [button,body];
}
let noteSequence=0;
function appendRuns(parent,runs,notes,prefix='jn'){
 for(const run of runs||[]){
  if(run.n){const note=notes?.get(run.n);if(note)parent.append(...noteParts(note,`${prefix}-${++noteSequence}`));continue;}
  if(run.e!=null){const em=node('em',run.e,'dot');parent.append(em);continue;}
  parent.append(document.createTextNode(run.t||''));
 }
}
function paragraph(block,notes){
 const tag=block.type==='heading'?(block.level===1?'h2':block.level===2?'h3':'h4'):'p';
 const element=node(tag,undefined,block.type==='heading'?`jh jh${block.level}${block.tint?' tint':''}`:`jp ${block.style||'song'}`);
 if(block.type==='para'){
  if(block.align==='center')element.classList.add('center');
  if(Number.isFinite(block.left)&&block.left>0)element.style.setProperty('--left',String(Math.min(block.left,12)));
  if(Number.isFinite(block.indent)&&block.indent!==0)element.style.setProperty('--indent',String(Math.max(-6,Math.min(block.indent,6))));
 }
 appendRuns(element,block.runs,notes);
 return element;
}
function cropFigure(block,book,openAt){
 const [x0,y0,x1,y1]=block.box,bw=Math.max(.02,x1-x0),bh=Math.max(.02,y1-y0);
 const [pw,ph]=Array.isArray(book.pagePoints)?book.pagePoints:[521.6,737];
 const figure=node('figure',undefined,`jr-figure${block.textImage?' text-image':''}`);figure.dataset.page=String(block.page);
 const frame=node('button',undefined,'jr-crop');frame.type='button';
 const caption=runsText(block.caption).trim();
 frame.setAttribute('aria-label',`${block.textImage?'教材原版':'教材插圖'}${caption?'：'+caption:''}，放大第 ${block.page} 頁`);
 frame.style.aspectRatio=`${(bw*pw).toFixed(1)} / ${(bh*ph).toFixed(1)}`;
 frame.style.maxWidth=`min(100%, ${Math.round(bw*pw*1.55)}px)`;
 const img=node('img');img.alt=block.alt?String(block.alt).slice(0,300):caption;img.loading='lazy';img.decoding='async';img.draggable=false;
 img.src=plateUrl(data,reading.book,block.page,bw>0.45||block.textImage?data.widths.large:data.widths.full);
 img.style.width=`${(100/bw).toFixed(3)}%`;img.style.left=`${(-x0/bw*100).toFixed(3)}%`;img.style.top=`${(-y0/bh*100).toFixed(3)}%`;
 img.onerror=()=>{figure.classList.add('failed');};
 frame.append(img);frame.onclick=()=>openAt(block.page);
 figure.append(frame);
 if(caption)figure.append(node('figcaption',caption));
 return figure;
}
function blockElements(blocks,notes,book,openAt,{skipTitle=false}={}){
 const out=[];let titleSkipped=!skipTitle;
 for(const block of blocks){
  if(!titleSkipped&&block.type==='heading'&&block.level===1){titleSkipped=true;continue;}
  if(block.type==='figure'){out.push(cropFigure(block,book,openAt));continue;}
  const element=paragraph(block,notes);
  if(block.type==='heading'){element.dataset.plain=squash(runsText(block.runs));element.id='h-'+element.dataset.plain.slice(0,24);}
  out.push(element);
  for(const side of block.side||[]){const aside=node('aside',undefined,'jr-side');aside.setAttribute('aria-label','旁批');appendRuns(aside,side,notes);out.push(aside);}
 }
 return out;
}

// ---------- page images ----------
function plateFigure(entry,page,index,book,openAt){
 const figure=node('figure',undefined,'junior-page');figure.id=`page-${page.pdf}`;
 const [width,height]=Array.isArray(book.pagePoints)?book.pagePoints:[521.6,737];
 const open=node('button',undefined,'plate-open');open.type='button';open.setAttribute('aria-label',`放大${page.label}`);
 const img=node('img');img.alt=`${book.label} ${page.label}`;img.width=960;img.height=Math.round(960*height/width);
 img.decoding='async';img.loading=index<1?'eager':'lazy';img.draggable=false;
 const large=plateUrl(data,entry.book,page.pdf,data.widths.large);
 if(large)img.srcset=`${page.src} 960w, ${large} 1440w`;img.sizes='(max-width: 899px) 100vw, 760px';
 open.append(img);open.onclick=()=>openAt(page.pdf);
 const status=node('p','圖頁載入中…','plate-message');status.setAttribute('role','status');
 const caption=node('figcaption');caption.append(node('span',page.label));
 const zoom=node('button','放大');zoom.type='button';zoom.onclick=()=>openAt(page.pdf);
 const pdf=node('a','PDF 此頁');pdf.href=page.viewer;pdf.target='_blank';pdf.rel='noopener noreferrer';
 const retry=node('button','重新載入');retry.type='button';retry.hidden=true;
 caption.append(zoom,pdf,retry);figure.append(open,status,caption);
 const loader=createPlateLoader({image:img,isHidden:()=>document.hidden,onState:state=>{
  status.hidden=state==='loaded';retry.hidden=state!=='failed';
  status.textContent=state==='failed'?'圖頁暫時無法載入，可重新載入或開啟 PDF。':state==='retrying'?'圖頁正在生成，稍候自動重試…':'圖頁載入中…';
 }});
 retry.onclick=()=>loader.retry();loaders.push(loader);loader.show(page.src);
 return figure;
}
let viewer=null;
function openViewer(plates,book,pdf){
 const dialog=$('plate-viewer');if(!dialog||!plates.pages.length)return;
 let index=Math.max(0,plates.pages.findIndex(p=>p.pdf===pdf));
 const show=i=>{
  index=Math.max(0,Math.min(plates.pages.length-1,i));const page=plates.pages[index];
  const img=$('viewer-image');img.removeAttribute('src');img.alt=`${book.label} ${page.label}`;img.src=plateUrl(data,reading.book,page.pdf,data.widths.large)||page.src;
  $('viewer-label').textContent=`${page.label} · ${index+1} / ${plates.pages.length}`;
  $('viewer-pdf').href=page.viewer;$('viewer-prev').disabled=index===0;$('viewer-next').disabled=index===plates.pages.length-1;
 };
 viewer={show:i=>show(i),step:d=>show(index+d)};
 $('viewer-prev').onclick=()=>viewer.step(-1);$('viewer-next').onclick=()=>viewer.step(1);
 show(index);
 if(typeof dialog.showModal==='function'&&!dialog.open)dialog.showModal();else dialog.setAttribute('open','');
}

// ---------- entry ----------
function sectionTitleId(title){return 'sec-'+squash(title).slice(0,16);}
async function show(id){
 const gen=++generation;
 for(const loader of loaders)loader.cancel();loaders=[];
 currentId=id;store(LAST_KEY,id);allNotesExpanded=false;
 const entry=data.lessons[id],book=data.books[entry.book],plates=lessonPlates(data,id);
 document.title=`${entry.title} · 初中 · 尚友`;
 $('crumb').textContent=[book.label,entry.unit&&entry.kind!=='unit'?entry.unit:''].filter(Boolean).join(' · ');
 $('title').textContent=entryTitle(entry);
 $('author').textContent=[entry.subtitle,entry.author].filter(Boolean).join(' ');
 $('title-notes').replaceChildren();
 $('lesson-meta').textContent=[entryKind(entry),pageSpan(entry)].filter(Boolean).join(' · ');
 $('notes-toggle').textContent='展開全部註釋';$('notes-toggle').setAttribute('aria-pressed','false');
 const ids=allIds(),at=ids.indexOf(id);
 for(const [anchor,target,prefix] of [[$('previous'),ids[at-1],'上一項'],[$('next-entry'),ids[at+1],'下一項']]){
  anchor.hidden=!target;if(!target)continue;
  const other=data.lessons[target];anchor.href='#'+target;anchor.textContent=`${prefix}：${entryTitle(other)}`;
 }
 renderCatalog();
 window.scrollTo?.(0,0);$('title').focus({preventScroll:true});
 const openAt=pdf=>openViewer(plates,book,pdf);
 renderPlates(entry,plates,book,openAt);
 $('passages').replaceChildren(node('p','正在讀取課文…','jr-loading'));$('prep').hidden=true;$('after-text').replaceChildren();$('parts').hidden=true;$('notes-toggle').hidden=true;
 reading=null;
 try{
  const response=await fetch(READING_URL(id),{cache:'no-cache'});if(!response.ok)throw new Error();
  const value=await response.json();if(gen!==generation)return;if(!validReading(value,id))throw new Error();
  reading=value;renderReading(entry,book,openAt);
 }catch{if(gen===generation)$('passages').replaceChildren(node('p','課文文字暫時無法讀取；下方教材圖版可直接閱讀。','jr-loading'));}
 void loadDialogue(gen);
}
function renderReading(entry,book,openAt){
 const notes=new Map(reading.notes.map(n=>[n.id,n]));noteSequence=0;
 // The entry's own title line (and its source note) heads the page instead of repeating it.
 const first=reading.blocks[0];
 if(first&&first.type==='heading'&&first.level===1){const titleRuns=first.runs.filter(r=>r.n);if(titleRuns.length)appendRuns($('title-notes'),titleRuns,notes,'jt');}
 let blocks=reading.blocks;
 const second=blocks[1];
 if(entry.author&&second&&second.type==='para'&&squash(runsText(second.runs))===squash(entry.author)){
  if(second.runs.some(r=>r.n))appendRuns($('title-notes'),second.runs.filter(r=>r.n),notes,'ja');
  blocks=[blocks[0],...blocks.slice(2)];
 }
 const prep=$('prep');prep.replaceChildren();
 if(reading.prep.length){prep.append(node('h3',reading.prepTitle||'预习','jh jh3 tint'),...blockElements(reading.prep,notes,book,openAt));prep.hidden=false;}
 $('passages').replaceChildren(...blockElements(blocks,notes,book,openAt,{skipTitle:true}));
 const after=$('after-text');after.replaceChildren();
 for(const section of reading.sections){
  const box=node('section',undefined,'jr-section');box.id=sectionTitleId(section.title);
  box.append(node('h3',section.title,'jh jh3 tint'),...blockElements(section.blocks,notes,book,openAt));after.append(box);
 }
 $('notes-toggle').hidden=!reading.notes.length;
 const parts=$('parts');parts.replaceChildren();
 const headings=[...$('passages').querySelectorAll('.jh')];
 for(const part of entry.parts||[]){
  const target=headings.find(h=>(h.dataset.plain||'').includes(squash(part.title)));if(!target)continue;
  const button=node('button',[part.title,part.author].filter(Boolean).join(' · '));button.type='button';
  button.onclick=()=>target.scrollIntoView({block:'start',behavior:'smooth'});parts.append(button);
 }
 parts.hidden=!parts.children.length;
}
function renderPlates(entry,plates,book,openAt){
 const box=$('plates-list');box.replaceChildren();
 if(plates.state!=='ready'||!plates.pages.length){box.append(node('p','本項目前沒有可顯示的教材圖頁。'));}
 plates.pages.forEach((page,index)=>box.append(plateFigure(entry,page,index,book,openAt)));
 const download=downloadUrl(book);$('download').hidden=!download;if(download)$('download').href=download;
 const first=plates.pages[0];$('open-pdf').href=first?first.viewer:plateViewerUrl(data,entry.book,1);
 $('plates-all').onclick=()=>openAt(first?.pdf);$('plates-all').disabled=!first;
}

// ---------- conversation ----------
function setStatus(text,{error=false}={}){const s=$('status');s.textContent=text||'';s.classList.toggle('status-error',!!error&&!!text);s.setAttribute('role',error&&text?'alert':'status');}
function avatarText(){const author=data?.lessons[currentId]?.author||'';return author.trim()?author.trim()[0]:'師';}
function turnElement(turn){
 const box=node('div',undefined,`turn ${turn.role==='student'?'student':'teacher'}`);
 if(turn.role!=='student'){const avatar=node('span',avatarText(),'author-avatar');avatar.setAttribute('aria-hidden','true');box.append(avatar);}
 const when=turn.createdAt?new Date(turn.createdAt):null;
 const label=turn.role==='student'?'你':(data?.lessons[currentId]?.author||'導讀');
 box.append(node('small',`${label}${when&&!Number.isNaN(+when)?' · '+when.toLocaleString([],{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):''}${turn.unanswered?' · 未取得回應':''}`));
 box.append(node('span',turn.content));
 return box;
}
function renderTurns(){
 const list=$('turns');list.replaceChildren(...dialogue.turns.map(turnElement));
 $('next').hidden=!!dialogue.turns.length;
 const t=$('thread');try{t.scrollTop=t.scrollHeight;}catch{}
}
function setSignedIn(signedIn){
 $('account-login').hidden=signedIn;$('account-logout').hidden=!signedIn;$('login').hidden=signedIn;
 $('answer').disabled=!signedIn||sending;$('send').disabled=!signedIn||sending;
}
function loginHref(){return LOGIN_URL+'?returnTo='+encodeURIComponent(location.href);}
async function loadDialogue(gen){
 dialogue={revision:0,turns:[],pending:false};renderTurns();
 $('account-login').href=loginHref();$('login').href=loginHref();
 try{
  const response=await fetch(DIALOGUE_URL(currentId),{credentials:'same-origin',cache:'no-store'});
  if(gen!==generation)return;
  if(response.status===401){ownerRef=null;setSignedIn(false);setStatus('');return;}
  const value=await response.json().catch(()=>({}));
  if(gen!==generation)return;
  if(!response.ok){setSignedIn(false);$('login').hidden=true;setStatus(value.message||'對話暫時無法使用；原文與教材圖版照常閱讀。');return;}
  ownerRef=value.ownerRef;dialogue={revision:value.revision||0,turns:value.turns||[],pending:!!value.pending};
  setSignedIn(true);renderTurns();setStatus(dialogue.pending?'上一輪回應還在處理，稍後重新整理即可看到。':'');
 }catch{if(gen===generation){setSignedIn(false);$('login').hidden=true;setStatus('對話暫時無法連線；原文與教材圖版照常閱讀。');}}
}
async function send(event){
 event?.preventDefault?.();
 const content=$('answer').value.trim();if(!content||sending||!ownerRef)return;
 sending=true;setSignedIn(true);$('stop').hidden=false;setStatus('');
 const gen=generation,id=currentId,mutationId=crypto.randomUUID();
 const mine={role:'student',content,createdAt:new Date().toISOString()};
 dialogue.turns.push(mine);renderTurns();
 const live=turnElement({role:'teacher',content:'',createdAt:null});live.querySelector('small').textContent='正在回應…';$('turns').append(live);
 const liveText=live.querySelector('span:last-child');
 streamAbort=new AbortController();
 try{
  const response=await fetch(DIALOGUE_URL(id),{method:'POST',credentials:'same-origin',cache:'no-store',signal:streamAbort.signal,headers:{'content-type':'application/json',accept:'text/event-stream'},body:JSON.stringify({content,mutationId,revision:dialogue.revision,ownerRef})});
  if(!response.headers.get('content-type')?.includes('text/event-stream')){
   const value=await response.json().catch(()=>({}));
   dialogue.turns.pop();live.remove();renderTurns();
   if(response.status===401){ownerRef=null;setSignedIn(false);}
   setStatus(value.message||'這一輪未送出；文字仍在輸入框。',{error:true});return;
  }
  $('answer').value='';
  let reply='';
  await readDialogueEvents(response,(name,payload)=>{
   if(gen!==generation)return;
   if(name==='saved'){dialogue.revision=payload.revision;}
   else if(name==='delta'){reply+=payload.text||'';liveText.textContent=reply;const t=$('thread');try{t.scrollTop=t.scrollHeight;}catch{}}
   else if(name==='done'){dialogue.turns.push({role:'teacher',content:payload.reply||reply,createdAt:payload.createdAt});}
   else if(name==='unconfirmed'){mine.unanswered=true;setStatus(payload.message||'這一輪沒有取得回應；你的話已保存。',{error:true});}
  });
 }catch(error){
  if(error?.name==='AbortError')setStatus('已停止等待；回應若已產生，重新整理後可以看到。');
  else setStatus('連線中斷；你的話若已送出會保留，重新整理後可以核對。',{error:true});
 }finally{
  if(gen===generation)renderTurns();
  sending=false;streamAbort=null;$('stop').hidden=true;setSignedIn(!!ownerRef);
 }
}

// ---------- page ----------
function route(){
 if(!data)return;
 const requested=location.hash.slice(1);
 if(data.books[requested]){history.replaceState(null,'','#'+data.catalog[requested][0]);void show(data.catalog[requested][0]);return;}
 if(data.lessons[requested]&&ENTRY_ID.test(requested)){void show(requested);return;}
 const recent=recall(LAST_KEY),fallback=data.lessons[recent]?recent:data.catalog[data.order[0]][0];
 history.replaceState(null,'','#'+fallback);void show(fallback);
}
function narrow(){try{return window.matchMedia('(max-width: 899px)').matches;}catch{return (window.innerWidth||1024)<900;}}
function setCatalogHidden(hidden){
 $('catalog').hidden=hidden;document.querySelector('.page-shell').classList.toggle('catalog-hidden',hidden);$('catalog-toggle').setAttribute('aria-expanded',String(!hidden));
}
function view(name){
 document.querySelector('.workspace').dataset.view=name;
 $('text-tab').setAttribute('aria-pressed',String(name==='text'));$('conversation-tab').setAttribute('aria-pressed',String(name==='conversation'));
}
// One button cycles the shared palettes (same storage key as the senior page).
function applyReadingTheme(id){
 const palette=PALETTES.find(p=>p.id===id)||PALETTES.find(p=>p.id==='qingque')||PALETTES[0];
 for(const [token,key] of Object.entries({paper:'background',surface:'surface',wash:'wash',reply:'commentSurface',ink:'text',muted:'textMuted',accent:'link',line:'border',note:'link'}))document.documentElement.style.setProperty('--'+token,palette[key]);
 themeId=palette.id;$('theme-name').textContent=palette.name;$('theme-cycle').setAttribute('aria-label',`閱讀配色：${palette.name}，按一下換下一套`);store('yw-reading-theme',palette.id);
}
function nextTheme(){const at=PALETTES.findIndex(p=>p.id===themeId);applyReadingTheme(PALETTES[(at+1)%PALETTES.length].id);}

async function start(){
 $('theme-cycle').onclick=nextTheme;applyReadingTheme(recall('yw-reading-theme'));
 $('catalog-toggle').onclick=()=>setCatalogHidden(!$('catalog').hidden);
 setCatalogHidden(narrow());
 $('lesson-search').oninput=renderCatalog;
 $('text-tab').onclick=()=>view('text');$('conversation-tab').onclick=()=>{view('conversation');$('answer').focus?.();};
 $('notes-toggle').onclick=()=>{allNotesExpanded=!allNotesExpanded;for(const n of document.querySelectorAll('#junior-reading .inline-note'))n.hidden=!allNotesExpanded;for(const b of document.querySelectorAll('#junior-reading .annotation-toggle'))b.setAttribute('aria-expanded',String(allNotesExpanded));$('notes-toggle').textContent=allNotesExpanded?'收起全部註釋':'展開全部註釋';$('notes-toggle').setAttribute('aria-pressed',String(allNotesExpanded));};
 document.addEventListener('click',event=>{if(!allNotesExpanded&&!event.target.closest?.('.annotation-toggle,.inline-note'))closeIndividualNotes();});
 $('compose').onsubmit=send;
 $('answer').onkeydown=event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();void send();}};
 $('stop').onclick=()=>streamAbort?.abort();
 $('viewer-close').onclick=()=>$('plate-viewer').close?.();
 $('plate-viewer').onkeydown=event=>{if(event.key==='ArrowLeft'){event.preventDefault();viewer?.step(-1);}else if(event.key==='ArrowRight'){event.preventDefault();viewer?.step(1);}};
 $('plate-viewer').onclick=event=>{if(event.target===$('plate-viewer'))$('plate-viewer').close?.();};
 $('account-logout').onclick=async()=>{
  $('account-logout').disabled=true;
  try{const response=await fetch(LOGIN_URL+'api/logout',{method:'POST',credentials:'include',signal:AbortSignal.timeout(10000)});const result=await response.json();if(!response.ok||result.ok!==true)throw Error();ownerRef=null;setSignedIn(false);dialogue.turns=[];renderTurns();setStatus('已登出；對話紀錄保留在你的帳戶。');}
  catch{setStatus('登出尚未確認，請到 My 帳戶頁核對。',{error:true});}
  finally{$('account-logout').disabled=false;}
 };
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)for(const loader of loaders)loader.resume();});
 try{
  const response=await fetch(DATA_URL,{cache:'no-cache'});if(!response.ok)throw new Error();
  const value=await response.json();if(!validJuniorData(value))throw new Error();
  data=value;window.addEventListener('hashchange',route);route();
 }catch{
  $('title').textContent='初中篇目暫時無法載入';$('lesson-meta').textContent='請稍後重新開啟。';
 }
}

if(typeof document!=='undefined'&&document.getElementById('junior-root'))void start();
