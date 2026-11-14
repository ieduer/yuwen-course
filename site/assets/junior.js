// 初中（七至九年級）教材閱讀：lesson -> pages of the textbook held by sun.bdfz.net.
//
// The only data is /data/junior-textbook-pages.v1.json (written by
// scripts/resolve_junior_textbook_pages.py): contents titles and page numbers.
// Every page image, the page viewer and the whole-book PDF are sun.bdfz.net's own
// files, addressed through textbook-pages.js exactly as the senior plates are.
// This page has no account, sends nothing to the yw API and keeps no learning record.
import {PALETTES} from './dialogue-palettes.js?v=a846366df3f1c133';
import {validTextbookPages,lessonPlates,plateUrl,plateViewerUrl,createPlateLoader,TEXTBOOK_IMAGE_ORIGIN} from './textbook-pages.js?v=91556289be7d3930';

const DATA_URL='/data/junior-textbook-pages.v1.json';
const LAST_KEY='yw-junior-last-lesson';
const ENTRY_ID=/^junior-[a-z0-9]+(?:-[a-z0-9]+){1,4}$/;
const KIND={unit:'單元導語',practice:'閱讀綜合實踐',writing:'寫作',activity:'活動',wholebook:'整本書閱讀',poems:'課外古詩詞誦讀',task:'活動·探究',oral:'口語交際'};
const $=id=>document.getElementById(id);
function node(tag,text,className){const element=document.createElement(tag);if(text!=null)element.textContent=text;if(className)element.className=className;return element;}
function store(key,value){try{window.localStorage.setItem(key,value);}catch{}}
function recall(key){try{return window.localStorage.getItem(key)||'';}catch{return '';}}

let data=null,currentId='',loaders=[],themeId='';

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

function pageFigure(entry,page,index,book){
 const figure=node('figure',undefined,'junior-page');figure.id=`page-${page.pdf}`;
 const [width,height]=Array.isArray(book.pagePoints)?book.pagePoints:[521.6,737];
 const img=node('img');img.alt=`${book.label} ${page.label}`;img.width=960;img.height=Math.round(960*height/width);
 img.decoding='async';img.loading=index<1?'eager':'lazy';img.draggable=false;
 const large=plateUrl(data,entry.book,page.pdf,data.widths.large);
 if(large)img.srcset=`${page.src} 960w, ${large} 1440w`;img.sizes='(max-width: 899px) 100vw, 860px';
 const status=node('p','圖頁載入中…','plate-message');status.setAttribute('role','status');
 const caption=node('figcaption');caption.append(node('span',page.label));
 const open=node('a','放大');open.href=large||page.src;open.target='_blank';open.rel='noopener noreferrer';
 const viewer=node('a','在 sun.bdfz.net 開啟此頁');viewer.href=page.viewer;viewer.target='_blank';viewer.rel='noopener noreferrer';
 const retry=node('button','重新載入');retry.type='button';retry.hidden=true;
 caption.append(open,viewer,retry);figure.append(img,status,caption);
 const loader=createPlateLoader({image:img,isHidden:()=>document.hidden,onState:state=>{
  status.hidden=state==='loaded';retry.hidden=state!=='failed';
  status.textContent=state==='failed'?'圖頁暫時無法載入，可重新載入或到 sun.bdfz.net 開啟此頁。':state==='retrying'?'圖頁正在生成，稍候自動重試…':'圖頁載入中…';
 }});
 retry.onclick=()=>loader.retry();loaders.push(loader);loader.show(page.src);
 return figure;
}

function show(id){
 for(const loader of loaders)loader.cancel();loaders=[];
 currentId=id;store(LAST_KEY,id);
 const entry=data.lessons[id],book=data.books[entry.book],plates=lessonPlates(data,id);
 document.title=`${entry.title} · 初中 · 尚友`;
 $('crumb').textContent=[book.label,entry.unit&&entry.kind!=='unit'?entry.unit:''].filter(Boolean).join(' · ');
 $('title').textContent=entryTitle(entry);
 $('author').textContent=[entry.subtitle,entry.author].filter(Boolean).join(' ');
 $('lesson-meta').textContent=[entryKind(entry),pageSpan(entry),`共 ${plates.pages.length} 頁`].filter(Boolean).join(' · ');
 const parts=$('parts');parts.replaceChildren();parts.hidden=!entry.parts?.length;
 for(const part of entry.parts||[]){
  const button=node('button',[part.title,part.author].filter(Boolean).join(' · '));button.type='button';
  if(Number.isInteger(part.pdf)){const page=plates.pages.find(p=>p.pdf===part.pdf);if(page)button.append(node('small',page.label));button.onclick=()=>$(`page-${part.pdf}`)?.scrollIntoView({block:'start',behavior:'smooth'});}
  else button.disabled=true;
  parts.append(button);
 }
 const pages=$('pages');pages.replaceChildren();
 if(plates.state!=='ready'||!plates.pages.length)pages.append(node('p','本項目前沒有可顯示的教材圖頁，請到 sun.bdfz.net 查閱整冊。'));
 plates.pages.forEach((page,index)=>pages.append(pageFigure(entry,page,index,book)));
 const ids=allIds(),at=ids.indexOf(id);
 for(const [anchor,target,prefix] of [[$('previous'),ids[at-1],'上一項'],[$('next'),ids[at+1],'下一項']]){
  anchor.hidden=!target;if(!target)continue;
  const other=data.lessons[target];anchor.href='#'+target;anchor.textContent=`${prefix}：${entryTitle(other)}`;
 }
 const first=plates.pages[0];
 $('open-first').href=first?first.viewer:plateViewerUrl(data,entry.book,1);
 const download=downloadUrl(book);$('download').hidden=!download;if(download)$('download').href=download;
 $('edition').textContent=`教材：${book.title}（${book.publisher}，${book.editionLabel}）。`;
 renderCatalog();
 window.scrollTo?.(0,0);$('title').focus({preventScroll:true});
}

function route(){
 if(!data)return;
 const requested=location.hash.slice(1);
 if(data.books[requested]){history.replaceState(null,'','#'+data.catalog[requested][0]);show(data.catalog[requested][0]);return;}
 if(data.lessons[requested]&&ENTRY_ID.test(requested)){show(requested);return;}
 const recent=recall(LAST_KEY),fallback=data.lessons[recent]?recent:data.catalog[data.order[0]][0];
 history.replaceState(null,'','#'+fallback);show(fallback);
}

function narrow(){try{return window.matchMedia('(max-width: 899px)').matches;}catch{return (window.innerWidth||1024)<900;}}
function setCatalogHidden(hidden){
 $('catalog').hidden=hidden;document.querySelector('.page-shell').classList.toggle('catalog-hidden',hidden);$('catalog-toggle').setAttribute('aria-expanded',String(!hidden));
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
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)for(const loader of loaders)loader.resume();});
 try{
  const response=await fetch(DATA_URL,{cache:'no-cache'});if(!response.ok)throw new Error();
  const value=await response.json();if(!validJuniorData(value))throw new Error();
  data=value;window.addEventListener('hashchange',route);route();
 }catch{
  $('title').textContent='初中篇目暫時無法載入';$('lesson-meta').textContent='請稍後重新開啟；也可直接到 sun.bdfz.net 閱讀教材。';
 }
}

if(typeof document!=='undefined'&&document.getElementById('junior-root'))void start();
