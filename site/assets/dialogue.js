import {PALETTES} from './dialogue-palettes.js?v=a846366df3f1c133';
import {originalRange,dialogueReadingAsset} from '../dialogue-reading-material.js?v=4735efcb1a2af88a';
import {dialogueOpening,dialogueIdentity} from '../dialogue-opening.js?v=e7aeb2b0bf74cc7f';
import {readDialogueEvents} from './dialogue-events.js?v=a7e6a9d3cf526331';
import {readBrowserHistory} from './dialogue-history.js?v=4e50ee7bee866e26';
import {openFirstReading} from './dialogue-first-read.js?v=04d04aafd8657321';
const $=id=>document.getElementById(id);
// Server permits 360 learner turns with one reply each; history pages contain 30 records.
const MAX_TRANSCRIPT_RECORDS=720,MAX_HISTORY_PAGES=24;
let streamAbort=null;
let reconnectNeeded=false;
let continuationRequest=null;
let firstReadView=null;
let correctionTarget=null,correctionMutation=null,sharedHistory=null,originalDraft=null;
let composerDraft=null,lessonIndex=null,materialMode='annotated',readingNotes=null;
const conversationFlow=document.body.dataset.dialogueFlow==='conversation';
let curriculum, snapshot, generation=0, selected=null, pending=null, pendingDraft=null, pollTimer=null, lastFocus=null, ownerRef=null;
const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const api=async(body,cursor,records=false,onEvent,correctionsFor,shared=false,firstReading=false,sessions=false)=>{
 const gen=generation,expectedOwner=ownerRef;
 const current=()=>{if(gen!==generation)throw Object.assign(new Error('帳戶或篇目已切換，已忽略舊回應。'),{code:'stale_context'});};
 const q=new URLSearchParams({lessonId:curriculum.lessonId,...(cursor?{beforeSeq:cursor.sequence}:{}),...(records?{records:'1'}:{}),...(correctionsFor?{correctionsFor}:{}),...(shared?{sharedHistory:'1'}:{}),...(firstReading?{firstReadingState:'1'}:{}),...(sessions?{sessions:'1'}:{})});
 const streamed=body&&(typeof body.content==='string'||body.action==='continue');
 if(streamed)streamAbort=new AbortController();
 const response=await fetch(`/api/dialogue/v1?${q}`,{credentials:'same-origin',cache:'no-store',...(streamed?{signal:streamAbort.signal}:body?.action==='first_read'?{signal:AbortSignal.timeout(12000)}:{}),...(body?{method:'POST',headers:{'content-type':'application/json',...(streamed?{accept:'text/event-stream'}:{})},body:JSON.stringify({...body,ownerRef})}:{})});
 current();
 if(response.ok&&response.headers.get('content-type')?.includes('text/event-stream')){const result=await readDialogueEvents(response,(event,data)=>{current();onEvent?.(event,data);});current();return result;}
 const value=await response.json().catch(()=>{throw Error('伺服器回應未完整讀取；請保留文字，讀回紀錄再繼續。');});current();
 if(expectedOwner&&value.ownerRef&&expectedOwner!==value.ownerRef){clearPrivateView({preserveReading:true});ownerRef=null;queueMicrotask(()=>void refresh());throw Object.assign(new Error('帳戶已切換，已清除舊紀錄；請重新查看或匯出。'),{code:'account_changed'});}
 if(!response.ok&&value.code==='account_changed'){clearPrivateView({preserveReading:true});ownerRef=null;queueMicrotask(()=>void refresh());}
 if(!response.ok)throw Object.assign(new Error(value.message||value.error||'暫時無法連線，文字仍保留在本頁。'),{status:response.status,code:value.code,draftSaved:value.draftSaved});return value;
};
function renderPartial(partial){
 let n=document.getElementById('partial-reply');
 if(!partial){n?.remove();return;}
 if(!n){n=node('div',undefined,'turn teacher');n.id='partial-reply';n.append(node('small'),node('span'));$('turns').append(n);}
 n.dataset.turnId=partial.turnId;n.querySelector('small').textContent=partial.status==='unconfirmed'?(partial.disposition?.received?'回應已收到但未通過核驗 · 已保留文字，尚未計入評閱':'回應中斷 · 已保留文字，尚未計入評閱'):'正在回應…';n.querySelector('span').textContent=partial.content;
 n.querySelector('button')?.remove();
 if(partial.continuation?.allowed&&!snapshot?.pending){
  const button=node('button',partial.continuation.code==='explicit_regeneration_available'?'重新生成回應':'續答');button.type='button';
  button.onclick=async()=>{
   if(snapshot?.pending||snapshot?.partial?.digest!==partial.digest||!snapshot.partial.continuation?.allowed)return;
   button.disabled=true;
   if(!continuationRequest||continuationRequest.turnId!==partial.turnId||continuationRequest.partialDigest!==partial.digest)continuationRequest={action:'continue',mutationId:crypto.randomUUID(),turnId:partial.turnId,partialDigest:partial.digest,revision:snapshot.revision};
   await sendTurn(continuationRequest,null);
  };
  n.append(button);
 }
}
// A saved turn whose provider attempts all ended before any output: one explicit learner action re-dispatches it (no new student turn, no silent retry).
function renderReplyRetry(data){
 document.getElementById('reply-retry')?.remove();
 const retry=data?.replyRetry;if(!retry||!retry.allowed||data.partial||data.pending)return;
 const box=node('div',undefined,'reply-retry');box.id='reply-retry';
 box.append(node('small','上一次未取得回應（AI 服務逾時）；你的回答已保存。可再試一次取得回應，不會重複保存或重複評閱。'));
 const button=node('button','再試一次取得回應');button.type='button';
 button.onclick=async()=>{
  if(snapshot?.pending||snapshot?.replyRetry?.turnId!==retry.turnId||!snapshot.replyRetry.allowed)return;
  button.disabled=true;
  if(!continuationRequest||continuationRequest.turnId!==retry.turnId||continuationRequest.partialDigest!=='')continuationRequest={action:'continue',mutationId:crypto.randomUUID(),turnId:retry.turnId,partialDigest:'',revision:snapshot.revision};
  await sendTurn(continuationRequest,null);
 };
 box.append(button);$('turns').append(box);
}
async function revealTurn(turnId){
 for(let i=0;i<=MAX_HISTORY_PAGES;i++){
  const target=document.getElementById('turn-'+turnId);if(target){if(target.closest('#turn-review-list')){$('materials').showModal();$('turn-review-list').closest('details').open=true;target.open=true;}else{$('materials').close();view('conversation');}target.scrollIntoView({block:'center'});return;}
  if(!snapshot?.older||i===MAX_HISTORY_PAGES)break;
  const data=await api(null,snapshot.older);renderTurns(data.turns,true);snapshot.older=data.older;$('older').hidden=!data.older;
 }
 throw Error('這份原話尚未載入；可匯出完整紀錄核對。');
}
function renderEvidence(report){
 const box=$('evidence-summary');box.replaceChildren(node('p',report.student.notice));
 if(report.conclusion){
  const c=report.conclusion;box.append(node('h3','這次尚友的理解與回望'),node('p',c.studentSummary),node('p','這是依據本課紀錄形成的教學總結，仍可請教師覆核；不替代原對話或成績。'));
  const jump=(label,ref)=>{const b=node('button',`${label}：「${ref.quote}」`);b.onclick=()=>void revealTurn(ref.turnId).catch(e=>{$('export-status').textContent=e.message;});return b;};
  box.append(jump('較早的理解',c.change.before),jump('現在的理解',c.change.after),jump('你的認同或質疑',c.stance));
  const detail=node('details');detail.append(node('summary','查看逐項分析與依據'));
  const labels={interpretation:'理解與文本',vocabulary:'字詞語境',technique:'寫法與效果',transfer:'遷移與應用',uncertainty:'仍待釐清'};
  for(const row of c.domains){detail.append(node('h4',labels[row.domain]),node('p',row.finding));for(const ref of row.evidence)detail.append(jump('查看原話',ref));if(row.preservedObjectives.length)detail.append(node('p','沿用下方已保留的原有學習證據，本次未重新評分。'));}
  box.append(detail);
 }
 const first=report.student.trajectory?.first;if(first){const b=node('button',`初讀摘錄：「${first.quote}」${first.truncated?'…':''}`);b.onclick=()=>void revealTurn(first.turnId).catch(e=>{$('export-status').textContent=e.message;});box.append(b);}
 for(const item of report.student.summary||[]){box.append(node('p',item.text));for(const ref of item.references){const b=node('button',`查看原話：「${ref.quote}」`);b.onclick=()=>void revealTurn(ref.turnId).catch(e=>{$('export-status').textContent=e.message;});box.append(b);}}
 for(const o of report.student.observed)box.append(node('p',`已有證據：${o.label}`));
 for(const o of report.student.remaining)box.append(node('p',`${o.status==='pending_calibration'?'待校準（不影響本課完成，可請老師覆核）':o.status==='historical_review'?'原有完成已保留，版本對應待核對':o.status==='review'?'待覆核':'尚待觀察'}：${o.label}`));
}
function view(name){document.querySelector('.workspace').dataset.view=name;for(const id of ['text','conversation'])$(id+'-tab').setAttribute('aria-pressed',String(id===name));}
function authorAvatar(){
 const identity=dialogueIdentity(curriculum),box=node('span',undefined,'author-avatar');box.setAttribute('aria-hidden','true');box.append(node('b',identity.name.slice(0,1)));
 if(identity.portraitUrl){const img=node('img');img.src=identity.portraitUrl;img.alt='';img.loading='lazy';img.onerror=()=>img.remove();box.append(img);}return box;
}
function mediaFigure(item){
 const url=item.src||item.sourceUrl||item.finalUrl||item.href;if(!url)return null;
 let parsed;try{parsed=new URL(url);}catch{return null;}if(!['https:','http:'].includes(parsed.protocol))return null;
 const figure=node('figure',undefined,'source-media'),image=/\.(?:png|jpe?g|webp|gif|avif)(?:[?#]|$)/i.test(url)||item.mediaType?.startsWith('image/');
 if(image){const img=node('img');img.src=url;img.alt=item.alt||'';img.loading='lazy';img.decoding='async';figure.append(img);}
 else if(/\.(?:mp3|wav|m4a|ogg|mp4|webm)(?:[?#]|$)/i.test(url)){const media=node(/\.(?:mp4|webm)(?:[?#]|$)/i.test(url)?'video':'audio');media.src=url;media.controls=true;media.preload='none';figure.append(media);}
 else return null;
 if(item.alt)figure.append(node('figcaption',item.alt));appendSourceLink(figure,url,'開啟原件','資料');return figure;
}
let materialTextSequence=0;
// Rebuild exported rich text from a small inert allowlist. Never insert source HTML into the live document.
function materialText(text,cooked){
 const content=node('div',undefined,'reading-prose');
 if(!cooked){for(const paragraph of String(text||'').split(/\n\s*\n/))if(paragraph.trim())content.append(node('p',paragraph));return content;}
 content.classList.add('rich-source');const template=document.createElement('template');template.innerHTML=cooked;const prefix=`material-text-${++materialTextSequence}-`,rendered=new Map();
 const allowed=new Set('p br hr h1 h2 h3 h4 h5 h6 strong b em i u s del small sup sub blockquote ul ol li dl dt dd pre code table thead tbody tfoot tr th td caption a img div span figure figcaption details summary ruby rt rp'.split(' '));
 const safeUrl=value=>{try{const url=new URL(value,'https://forum.rdfzer.com/');return ['https:','http:'].includes(url.protocol)?url.href:null;}catch{return null;}};
 const copy=(source,parent)=>{
  if(source.nodeType===3){parent.append(document.createTextNode(source.textContent));return;}
  if(source.nodeType!==1)return;
  const tag=source.tagName.toLowerCase();if(['script','style','iframe','object','embed','form','input','button','svg','math'].includes(tag))return;
  if(!allowed.has(tag)){for(const child of source.childNodes)copy(child,parent);return;}
  const target=node(/^h[1-6]$/.test(tag)?'h4':tag);rendered.set(source,target);
  if(source.id)target.id=prefix+source.id;
  if(tag==='a'){const href=source.getAttribute('href');if(href?.startsWith('#')){const id=prefix+href.slice(1);target.href='#'+id;target.onclick=event=>{event.preventDefault();const destination=document.getElementById(id);if(destination){destination.tabIndex=-1;destination.focus();destination.scrollIntoView({block:'center'});}};}else if(href){const url=safeUrl(href);if(url){target.href=url;target.target='_blank';target.rel='noopener noreferrer';}}}
  if(tag==='img'){const url=safeUrl(source.getAttribute('src')||'');if(!source.getAttribute('src')||!url)return;target.src=url;target.alt=source.getAttribute('alt')||'';target.loading='lazy';target.decoding='async';}
  if(tag==='ol'&&/^\d+$/.test(source.getAttribute('start')||''))target.setAttribute('start',source.getAttribute('start'));
  if(['td','th'].includes(tag))for(const attr of ['colspan','rowspan'])if(/^[1-9]\d?$/.test(source.getAttribute(attr)||''))target.setAttribute(attr,source.getAttribute(attr));
  for(const child of source.childNodes)copy(child,target);
  if(tag==='table'){const scroll=node('div',undefined,'table-scroll');scroll.tabIndex=0;scroll.setAttribute('role','region');scroll.setAttribute('aria-label','資料表格');scroll.append(target);parent.append(scroll);}else parent.append(target);
 };
 for(const child of template.content.childNodes)copy(child,content);
 // Associate notes only through the source's explicit footnote links.
 const moved=new Set();
 for(const sourceRef of template.content.querySelectorAll('.footnote-ref a[href^="#"]')){
  const sourceId=sourceRef.getAttribute('href').slice(1),sourceNote=template.content.getElementById(sourceId);
  const ref=rendered.get(sourceRef),original=rendered.get(sourceNote);
  if(!sourceNote||!ref||!original)continue;
  const note=node('span',undefined,'inline-note'),button=node('button',sourceRef.textContent,'annotation-toggle');
  note.id=prefix+'inline-'+sourceRef.id;note.dataset.sourceFootnote=sourceId;note.hidden=true;
  const body=sourceNote.cloneNode(true);for(const back of body.querySelectorAll('.footnote-backref'))back.remove();
  for(const child of body.childNodes)copy(child,note);
  button.type='button';button.setAttribute('aria-controls',note.id);button.setAttribute('aria-expanded','false');button.setAttribute('aria-label','註釋 '+sourceRef.textContent);
  button.onclick=()=>{const open=note.hidden;if(!allNotesExpanded)closeIndividualNotes();note.hidden=!open;button.setAttribute('aria-expanded',String(open));};
  const marker=ref.closest('sup')||ref;marker.replaceWith(button,note);moved.add(original);
 }
 for(const note of moved)note.remove();
 for(const list of template.content.querySelectorAll('.footnotes-list')){
  const target=rendered.get(list);if(target&&!target.children.length){target.remove();const separator=list.previousElementSibling;if(separator?.matches('hr.footnotes-sep'))rendered.get(separator)?.remove();}
 }
 return content;
}
function referenceGallery(items){
 const section=node('section',undefined,'reference-gallery'),images=node('div',undefined,'reference-images'),toolbar=node('nav',undefined,'reference-gallery-toolbar');
 section.setAttribute('aria-label','課程圖片');images.dataset.layout='continuous';toolbar.setAttribute('aria-label','圖片閱讀方式');
 section.append(node('h3',`圖片 · ${items.length}`),images,toolbar);
 const open=index=>{const host=node('div',undefined,'reference-viewer-host');document.body.append(host);const viewer=renderPlates(host,{notes:[],pages:items},{initialIndex:index,label:'參考圖片閱讀器',unit:'張',onClose:()=>host.remove()});viewer.expand();};
 items.forEach((item,index)=>{
  const figure=node('figure'),button=node('button',undefined,'reference-image-open'),img=node('img'),caption=node('figcaption');
  button.type='button';button.setAttribute('aria-label',`放大第 ${index+1} 張圖片`);img.src=item.src;img.alt=item.label;img.loading='lazy';img.decoding='async';
  img.onerror=()=>{if(!figure.querySelector('.image-error'))figure.insertBefore(node('p','圖片暫時無法載入，可開啟原圖。','image-error'),caption);};
  button.append(img);button.onclick=()=>open(index);caption.append(node('span',`${index+1} / ${items.length}${/^第 \d+ 張圖片$/.test(item.label)?'':' · '+item.label}`));const original=node('a','原圖');original.href=item.src;original.target='_blank';original.rel='noopener noreferrer';caption.append(original);figure.append(button,caption);images.append(figure);
 });
 const continuous=node('button','連續閱讀'),overview=node('button','縮圖一覽'),fullscreen=node('button','全屏閱讀');
 const layout=value=>{images.dataset.layout=value;continuous.setAttribute('aria-pressed',String(value==='continuous'));overview.setAttribute('aria-pressed',String(value==='overview'));};
 for(const button of [continuous,overview,fullscreen])button.type='button';continuous.onclick=()=>layout('continuous');overview.onclick=()=>layout('overview');fullscreen.onclick=()=>open(0);toolbar.append(continuous,overview,fullscreen);layout('continuous');return section;
}
function renderOriginalMaterials(source,c=curriculum){
 closeExpandedPlate?.();
 const box=$('original-materials');box.replaceChildren();
 const nav=node('div',undefined,'material-tabs');nav.setAttribute('role','tablist');nav.setAttribute('aria-label','學習資料類型');box.append(nav);
 const groups=new Map(),labels={guide:'閱讀提示',extra:'拓展閱讀',media:'圖片影音',study:'學案',links:'參考資料',plates:'教材圖版'};
 for(const [key,label] of Object.entries(labels)){const panel=node('section',undefined,'material-panel');panel.id='material-'+key;panel.setAttribute('role','tabpanel');panel.setAttribute('aria-label',label);panel.hidden=true;groups.set(key,panel);box.append(panel);}
 const seen=new Set(),links=new Map(),referenceImages=[],imagesByUrl=new Map();
 const knownImages=new Set([...(source.forumImages||[]),...(source.posts||[]).flatMap(post=>post.images||[])].map(item=>item.src||item.href||item.sourceUrl).filter(Boolean));
 const addMedia=item=>{
  const sourceUrl=item.src||item.sourceUrl||item.finalUrl||item.href;let url;try{const parsed=new URL(sourceUrl);if(!['https:','http:'].includes(parsed.protocol))return false;url=parsed.href;}catch{return false;}
  if(seen.has(url)){const image=imagesByUrl.get(url),label=item.alt||item.label||item.text||item.title;if(image&&/^第 \d+ 張圖片$/.test(image.label)&&label&&label!=='參考資料'&&label!==url)image.label=label;return true;}
  if(/\.(?:png|jpe?g|webp|gif|avif)(?:[?#]|$)/i.test(url)||item.mediaType?.startsWith('image/')||knownImages.has(sourceUrl)){
   const label=item.alt||item.label||item.text||item.title,image={src:url,label:!label||label==='參考資料'||label===url?`第 ${referenceImages.length+1} 張圖片`:label};referenceImages.push(image);imagesByUrl.set(url,image);
  }else{const media=mediaFigure({...item,src:url});if(!media)return false;groups.get('media').append(media);}
  seen.add(url);links.get(url)?.remove();links.delete(url);return true;
 };
 const addLink=(url,label,item={})=>{if(!url)return;if(addMedia({...item,src:url,label}))return;let key;try{key=new URL(url).href;}catch{return;}if(links.has(key))return;const row=node('div',undefined,'resource-row');if(appendSourceLink(row,url,label,'參考資料')){links.set(key,row);const kind=/\.pdf(?:[?#]|$)/i.test(url)?'PDF':/youtube|youtu.be/i.test(url)?'影音':'網頁';row.prepend(node('small',kind));groups.get('links').append(row);}};
 const addText=(key,title,text,cooked)=>{if(!text&&!cooked)return;const section=node('section',undefined,'material-entry');section.append(node('h3',title),materialText(text,cooked));groups.get(key).append(section);};
 for(const [key,label,group] of [['frontMatter','篇前','guide'],['guidance','學習提示','guide'],['sourceOnlyBlocks','補充閱讀','extra']])addText(group,label,referenceText(c[key]));
 for(const item of c.readingMaterials||[])addText(item.role==='commentary'?'guide':'links',item.label||'補充閱讀',item.text||referenceText(item.block));
 for(const item of c.media||[])addMedia(item);
 for(const [index,post] of (source.posts||[]).entries()){
  const text=post.plain_text||'',heading=text.trim().split('\n').find(Boolean)?.slice(0,48)||`補充資料 ${post.post_number||index+1}`;
  addText('extra',index===0?'原課內容':heading,text,post.cooked);
  for(const img of post.images||[])addMedia(img);
  for(const item of [...(post.links||[]),...(post.attachments||[])]){const url=typeof item==='string'?item:item.href||item.url||item.src;addMedia({...item,src:url});addLink(url,item.text||item.title||item.label||'參考資料',item);}
 }
 for(const item of source.forumImages||[])addMedia(item);
 for(const item of c.resources||[]){addMedia({...item,src:item.href||item.sourceUrl});addLink(item.href||item.sourceUrl,item.label,item);}
 if(referenceImages.length)groups.get('media').prepend(referenceGallery(referenceImages));
 for(const item of c.studyGuide||[]){const section=node('section',undefined,'material-entry');section.append(materialText(item.prompt));if(item.referenceAnswer||item.explanation){const answer=node('details');answer.append(node('summary',item.answerLabel||'參考解說'),materialText([item.referenceAnswer,item.explanation].filter(Boolean).join('\n\n')));section.append(answer);}groups.get('study').append(section);}
 for(const task of source.learningTasks||[])addText('study','學習任務',typeof task==='string'?task:task.prompt||task.text||task.title);
 const pages=groups.get('plates');pages.dataset.lazy='true';
 const entries=[...groups].filter(([key,panel])=>panel.childNodes.length||key==='plates');
 const select=key=>{for(const [id,panel] of groups)panel.hidden=id!==key;for(const button of nav.children){const active=button.dataset.material===key;button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;}if(key==='plates'&&pages.dataset.lazy==='true'){delete pages.dataset.lazy;void loadPlates(pages);}};
 for(const [key,panel] of entries){const button=node('button',labels[key]);button.type='button';button.dataset.material=key;button.setAttribute('role','tab');button.setAttribute('aria-controls',panel.id);button.onclick=()=>select(key);button.onkeydown=event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const index=entries.findIndex(([id])=>id===key),next=event.key==='Home'?0:event.key==='End'?entries.length-1:(index+(event.key==='ArrowRight'?1:-1)+entries.length)%entries.length;select(entries[next][0]);nav.children[next].focus();};nav.append(button);}
 select(entries[0][0]);
}
async function loadOriginalMaterials(c,gen){
 renderOriginalMaterials({},c);
 try{const response=await fetch(`/data/lessons/${c.lessonId}.json`,{cache:'no-cache'});if(!response.ok)throw Error();const source=await response.json();if(gen===generation&&curriculum?.lessonId===c.lessonId)renderOriginalMaterials(source,c);}
 catch{if(gen===generation)$('original-materials').append(node('p','補充資料暫時未能載入，可由「資料與紀錄」開啟原課。'));}
}
let catalogInitialized=false,catalogManual=null;
const catalogMedia=typeof window.matchMedia==='function'?window.matchMedia('(min-width: 1100px)'):null;
// The first passage still visible on screen is kept at the same offset when the layout columns change.
function readingAnchor(){try{for(const el of document.querySelectorAll('#reading [data-passage]')){const r=el.getBoundingClientRect();if(r.bottom>0)return {el,top:r.top};}}catch{}return null;}
function restoreReadingAnchor(anchor){if(!anchor)return;try{const delta=anchor.el.getBoundingClientRect().top-anchor.top;if(Math.abs(delta)>1)window.scrollBy(0,delta);}catch{}}
function setCatalogHidden(hidden,{manual=false}={}){
 if(manual){catalogManual=hidden;try{window.sessionStorage.setItem('yw-dialogue-catalog',hidden?'hidden':'shown');}catch{}}
 if($('catalog').hidden===hidden)return;
 const anchor=readingAnchor();
 $('catalog').hidden=hidden;document.querySelector('.page-shell').classList.toggle('catalog-hidden',hidden);$('catalog-toggle').setAttribute('aria-expanded',String(!hidden));
 restoreReadingAnchor(anchor);
}
function autoCatalog(){if(catalogManual!==null||!catalogMedia)return;setCatalogHidden(!catalogMedia.matches);}
$('catalog-toggle').onclick=()=>{const hidden=!$('catalog').hidden;setCatalogHidden(hidden,{manual:true});if(!hidden&&(window.innerWidth||1024)<900){try{$('catalog').scrollIntoView({block:'start'});$('lesson-search').focus({preventScroll:true});}catch{}}};
if(catalogMedia){
 try{const saved=window.sessionStorage.getItem('yw-dialogue-catalog');if(saved==='hidden'||saved==='shown')catalogManual=saved==='hidden';}catch{}
 let frame=0;const schedule=()=>{if(typeof window.cancelAnimationFrame==='function')window.cancelAnimationFrame(frame);frame=(typeof window.requestAnimationFrame==='function'?window.requestAnimationFrame:fn=>setTimeout(fn,16))(autoCatalog);};
 if(typeof catalogMedia.addEventListener==='function')catalogMedia.addEventListener('change',schedule);else catalogMedia.addListener?.(schedule);
 window.addEventListener('orientationchange',schedule);autoCatalog();
}
function renderAccount(){
 $('account-login').href='https://my.bdfz.net/?returnTo='+encodeURIComponent(location.href);
 $('account-login').hidden=!!ownerRef;$('account-logout').hidden=!ownerRef;
}
$('account-logout').onclick=async()=>{
 if(!persistComposer()){$('status').textContent='草稿尚未保存，請先複製文字再登出。';return;}
 $('account-logout').disabled=true;
 try{
  const response=await fetch('https://my.bdfz.net/api/logout',{method:'POST',credentials:'include',signal:AbortSignal.timeout(10000)});
  const result=await response.json();
  if(!response.ok||result.ok!==true)throw Error('登出尚未確認，請到 My 帳戶頁核對；學習紀錄與草稿保留。');
  clearPrivateView({preserveReading:true});ownerRef=null;renderAccount();$('answer').disabled=true;$('send').disabled=true;
  $('status').textContent='已登出，原有學習紀錄與此帳戶草稿保留。';
 }catch(error){$('status').textContent=error.message||'登出尚未確認，請稍後核對。';}
 finally{$('account-logout').disabled=false;}
};
function quotePassage(id,quote){const p=curriculum.passages.find(p=>p.id===id);if(!p)return;selected={id,text:quote||p.text.slice(0,600)};$('quote').textContent=selected.text;$('quote').hidden=false;view('conversation');$('answer').focus();}
let allNotesExpanded=false;
function closeIndividualNotes(){for(const note of document.querySelectorAll('.inline-note'))note.hidden=true;for(const ref of document.querySelectorAll('.annotation-toggle'))ref.setAttribute('aria-expanded','false');}
$('notes-toggle').onclick=()=>{allNotesExpanded=!allNotesExpanded;for(const note of document.querySelectorAll('.inline-note'))note.hidden=!allNotesExpanded;for(const ref of document.querySelectorAll('.annotation-toggle'))ref.setAttribute('aria-expanded',String(allNotesExpanded));$('notes-toggle').textContent=allNotesExpanded?'收起全部註釋':'展開全部註釋';$('notes-toggle').setAttribute('aria-pressed',String(allNotesExpanded));};
document.addEventListener('click',event=>{if(!event.target.closest('.appearance'))document.querySelector('.appearance').open=false;if(!allNotesExpanded&&!event.target.closest('.annotation-toggle,.inline-note'))closeIndividualNotes();});
document.addEventListener('keydown',event=>{if(event.key==='Escape'){const appearance=document.querySelector('.appearance');if(appearance.open){const restoreFocus=appearance.contains(document.activeElement);appearance.open=false;if(restoreFocus)appearance.querySelector('summary').focus();}if(!allNotesExpanded)closeIndividualNotes();}});
function annotationText(value){if(!value)return '';if(Array.isArray(value))return value.map(annotationText).filter(Boolean).join('');if(typeof value.text==='string')return value.text;for(const key of ['runs','blocks','children','items','rows','cells'])if(value[key])return annotationText(value[key]);return '';}
function displayWorkTitle(value){
 const title=String(value.title||''),author=String(value.author||'');
 const separator=Math.max(title.lastIndexOf('/'),title.lastIndexOf('／'));
 if(separator<1||!author.trim())return title;
 const sameAuthor=title.slice(separator+1).replace(/\s/g,'')===author.replace(/\s/g,'');
 return sameAuthor?title.slice(0,separator).trimEnd():title;
}
function renderText(){
 const locked=false;
 $('title').textContent=displayWorkTitle(curriculum);$('author').textContent=dialogueIdentity(curriculum).name==='作者'?'':dialogueIdentity(curriculum).name;$('source').href=curriculum.source;$('legacy').href=`/?view=legacy#${curriculum.lessonId}`;
 $('source').hidden=locked;$('plates-details').hidden=locked;$('dictionary-details').hidden=locked;
 $('passages').replaceChildren();
 for(const p of locked?[]:curriculum.passages){const paragraph=node('p');paragraph.id=p.id;paragraph.dataset.passage=p.id;paragraph.tabIndex=-1;
  if(p.block.runs){for(const run of p.block.runs){if(run.type==='annotation-ref'){
   const a=curriculum.annotations.find(a=>a.noteId===run.noteId),number=String(run.label||'').replace(/[^0-9]/g,'')||String(curriculum.annotations.findIndex(a=>a.noteId===run.noteId)+1);
   const ref=node('button',undefined,'annotation-toggle');ref.type='button';ref.append(node('sup',number,'annotation-number'));ref.setAttribute('aria-label',`註釋 ${number}`);
   const note=node('span',annotationText(a?.blocks)||'注釋待核查','inline-note');note.id=`note-${p.id}-${paragraph.childNodes.length}`;note.dataset.annotationId=run.noteId;note.setAttribute('role','note');note.setAttribute('aria-label',`注釋 ${number}`);note.hidden=!allNotesExpanded;
   ref.setAttribute('aria-controls',note.id);ref.setAttribute('aria-expanded',String(allNotesExpanded));ref.onclick=()=>{const open=note.hidden;if(!allNotesExpanded)closeIndividualNotes();note.hidden=!open;ref.setAttribute('aria-expanded',String(open));};paragraph.append(ref,note);
  }else paragraph.append(document.createTextNode(run.text||''));}}
  else paragraph.append(document.createTextNode(p.text));
  $('passages').append(paragraph);
 }
 if(!curriculum.passages.length)$('passages').append(node('p','本課正文來源尚待核對。原有資料與已保存紀錄仍可查閱；不以未核實的正文進行新評閱。'));
 if(locked){$('requirements').replaceChildren(node('p','先自行斷句，保存至少三處疑點與猜測，再寫下初讀感知。原要求及原始紀錄保留。'));$('references').replaceChildren(node('p','完成無注疏初讀後，展開正文註釋與參考資料。'));return;}
 $('requirements').replaceChildren(...curriculum.objectives.map(o=>{const n=node('div',undefined,'requirement');n.append(node('strong',o.label),node('span',o.domain==='vocabulary'?'結合原句說明詞義、語境與判斷依據；看過提示的回答與獨立新題分別保存。':o.rule));return n;}));
 $('references').replaceChildren(node('p','原課導讀與參考連結列在下方；其他補充資料、學案與教材原圖仍可由上方原有課程入口查看。'),...curriculum.annotations.map(a=>node('p',(a.blocks||[]).flatMap(b=>(b.runs||[]).map(r=>r.text||'')).join('\n'))));
 if(lessonIndex?.lessons.find(lesson=>lesson.lessonId===curriculum.lessonId)?.sourceReviewRequired)$('references').prepend(node('p','本課有來源項目待核對；未核實的內容不會當作已通過的學習證據。'));
 for(const [key,label] of [['frontMatter','篇目前言'],['guidance','原課閱讀提示'],['sourceOnlyBlocks','原課補充資料']]){const text=referenceText(curriculum[key]);if(text){const details=node('details');details.append(node('summary',label),node('p',text));$('references').append(details);}}
 for(const material of curriculum.readingMaterials||[]){
  const section=node('section');section.id=material.id;section.dataset.sourceRole=material.role||'reference';section.append(node('h3',material.label||'原課補充資料'),node('p',material.text||referenceText(material.block)));$('references').append(section);
 }
 const sourceLinks=new Set();
 for(const resource of curriculum.resources||[]){
  const href=resource.href||resource.sourceUrl;if(!href||sourceLinks.has(href))continue;
  const kind={document:'原課文件',video:'原課影片',upload:'原課附件',link:'原課參考資料'}[resource.kind]||'原課資料';
  if(appendSourceLink($('references'),href,resource.label,kind))sourceLinks.add(href);
 }
 if(curriculum.media?.length){
  const media=node('details');media.append(node('summary','原課插圖與媒體'),node('p','開啟原有來源查閱；圖說保留在上方。'));
  for(const [index,item] of curriculum.media.entries())appendSourceLink(media,item.sourceUrl||item.finalUrl,item.alt,`原課${item.mediaType?.startsWith('image/')?'插圖':'媒體'} ${index+1}`);
  $('references').append(media);
 }
 for(const entry of curriculum.dictionary||[]){
  const section=node('section');section.append(node('h3',`虛詞詞典：「${entry.headword}」`),node('p',`${entry.edition}。已核對以下例句的原書頁。`));
  for(const page of entry.pages){const link=node('a',`原書第 ${page.printedPage} 頁：${page.example}`);link.href=page.url;link.target='_blank';link.rel='noopener noreferrer';const paragraph=node('p');paragraph.append(link);section.append(paragraph);}
  $('references').append(section);
 }
 if(curriculum.exam?.examples?.length){
  const section=node('section');section.append(node('h3','北京高考的能力關聯'),node('p',curriculum.exam.reason));
  for(const example of curriculum.exam.examples){const link=node('a',`${example.year} ${example.paper}第 ${example.questionNumber} 題：《${example.work}》`);link.href=example.url;link.target='_blank';link.rel='noopener noreferrer';section.append(link,node('p',`${example.questionParaphrase} 對應練習：${example.skill}。來源：${example.publisher}第 ${example.issue} 期第 ${example.printedPage} 版。`));}
  $('references').append(section);
 }
 paintReadingMarks();renderReadingVariant();performance.mark('dialogue-readable-text');
}
function paintReadingMarks(){
 if(!curriculum)return;
 for(const p of curriculum.passages){
  const paragraph=document.getElementById(p.id);if(!paragraph)continue;
  const parts=[...paragraph.childNodes].filter(n=>n.nodeType===3||n.nodeType===1&&n.dataset?.readingMark);
  if(parts.map(n=>n.textContent).join('')!==p.text)continue;
  const marks=readingNotes?.kind==='conversation-reading'?(readingNotes.marks||[]).filter(m=>m.paragraphKey===p.id).sort((a,b)=>a.startOffset-b.startOffset):[];
  let offset=0;
  for(const part of parts){
   const text=part.textContent,fragment=document.createDocumentFragment();let used=0;
   for(const mark of marks){
    const range=originalRange(p.text,mark.startOffset,mark.endOffset);if(!range)continue;
    const start=Math.max(0,range[0]-offset),end=Math.min(text.length,range[1]-offset);if(start<used||start>=end)continue;
    fragment.append(document.createTextNode(text.slice(used,start)));
    const n=node('mark',text.slice(start,end));n.dataset.readingMark=mark.markId;n.tabIndex=0;n.setAttribute('role','button');n.setAttribute('aria-label',`討論疑點：${mark.selectedText}`);n.title=`原猜測：${mark.guess}`+(mark.correction?`\n訂正：${mark.correction}`:'');
    n.onclick=()=>quotePassage(p.id,p.text.slice(...range));n.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();n.onclick();}};fragment.append(n);used=end;
   }
   fragment.append(document.createTextNode(text.slice(used)));part.replaceWith(fragment);offset+=text.length;
  }
 }
}
function renderReadingVariant(){
 const classical=curriculum.mode==='classical';
 $('notes-toggle').hidden=materialMode==='unpunctuated'||!curriculum.annotations.length;
 $('version-unpunctuated').hidden=!classical;
 document.querySelector('.reading-versions').hidden=!classical;
 if(!classical&&materialMode==='unpunctuated')materialMode='annotated';
 for(const mode of ['unpunctuated','annotated'])$('version-'+mode).setAttribute('aria-pressed',String(mode===materialMode));
 $('first-reading').hidden=materialMode!=='unpunctuated';$('passages').hidden=materialMode==='unpunctuated';
 if(materialMode==='unpunctuated'&&!firstReadView){const gen=generation;firstReadView=openFirstReading({lessonId:curriculum.lessonId,curriculum,root:$('first-reading'),isCurrent:()=>gen===generation,onSelect:(id,text)=>{if(text.length>600)return;selected={id,text};$('quote').textContent=text;$('quote').hidden=false;$('discuss').hidden=false;$('discuss').onclick=()=>{view('conversation');$('answer').focus();$('discuss').hidden=true;};}});}
 if(ownerRef){if(firstReadView&&readingNotes)void firstReadView.setMarks?.(readingNotes);}
}
async function refreshReadingMarks(){
 const gen=generation;if(!ownerRef)return;
 try{const state=await api(null,null,false,null,null,false,true);if(gen===generation){if(curriculum.mode!=='classical'){const asset=await dialogueReadingAsset(curriculum);if(gen!==generation||asset.textDigest!==state.textDigest||asset.textVersionId!==state.textVersionId)return;}readingNotes=state;if(firstReadView)await firstReadView.setMarks?.(state);paintReadingMarks();}}catch{/* Saved chat remains authoritative; a missing readback never fabricates marks. */}
}
for(const mode of ['unpunctuated','annotated'])$('version-'+mode).onclick=()=>{if(mode==='unpunctuated'&&curriculum?.mode!=='classical')return;materialMode=mode;renderText();};
function renderTurns(turns,prepend=false){
 const fragment=document.createDocumentFragment(),records=document.createDocumentFragment();
 for(const t of turns){
  const existing=document.getElementById('turn-'+t.id);
  if(existing){
   const notice=existing.querySelector('.turn-status');
   if(t.status==='needs_review'&&!notice)existing.append(node('small','回答已保存，回應待確認。','turn-status'));
   else if(t.status!=='needs_review')notice?.remove();
   continue;
  }
  const sourceReceipt=t.role!=='student'&&t.model==='source-owned';
  const label=t.role==='student'?'你':dialogueIdentity(curriculum).name;
  const stamp=new Date(t.createdAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
  const record=node('details');record.append(node('summary',`${sourceReceipt?'保存紀錄':label} · ${stamp}`));
  const correction=node('button','查看／補充更正');correction.type='button';correction.onclick=()=>void openCorrection(t);
  record.append(node('p',t.content),correction);records.append(record);
  if(sourceReceipt){record.id='turn-'+t.id;continue;}
  const n=node('div',undefined,'turn '+t.role);n.id='turn-'+t.id;if(t.role!=='student')n.append(authorAvatar());n.append(node('small',`${label} · ${stamp}`),node('span',t.content));
  const refs=t.content.match(/\[(lesson-[\w-]+:p\d+)\]/g)||[];
  for(const ref of new Set(refs)){const id=ref.slice(1,-1);if(!curriculum.passages.some(p=>p.id===id))continue;const a=node('a','回到原文');a.href='#'+encodeURIComponent(id);a.onclick=e=>{e.preventDefault();view('text');document.getElementById(id)?.scrollIntoView({block:'center',behavior:'auto'});document.getElementById(id)?.focus();};n.append(a);}
  if(t.status==='needs_review')n.append(node('small','回答已保存，回應待確認。','turn-status'));
  fragment.append(n);
 }
 if(prepend){$('turns').prepend(fragment);$('turn-review-list').prepend(records);}else{$('turns').append(fragment);$('turn-review-list').append(records);}
}
function clearPrivateView({preserveReading=false}={}){reconnectNeeded=false;closeExpandedPlate?.();persistComposer();generation++;streamAbort?.abort();streamAbort=null;continuationRequest=null;
 firstReadView?.dispose();firstReadView=null;
 $('correction').close();correctionTarget=null;correctionMutation=null;$('correction-original').textContent='';$('correction-history').replaceChildren();$('correction-note').value='';$('correction-proposed').value='';$('turns').replaceChildren();$('turn-review-list').replaceChildren();$('answer').value='';$('quote').hidden=true;
 selected=null;pending=null;pendingDraft=null;originalDraft=null;composerDraft=null;snapshot=null;readingNotes=null;paintReadingMarks();clearTimeout(pollTimer);
 $('task-input').replaceChildren();$('task-context').replaceChildren();$('record-receipt').replaceChildren();$('source-results').replaceChildren();
 $('lesson-outcome').textContent='';$('draft-status').textContent='';
 $('next').replaceChildren(node('span',''));
 $('source-draft').replaceChildren();$('source-draft').hidden=true;$('export-status').textContent='';$('evidence-summary').replaceChildren();sharedHistory=null;$('old-history').replaceChildren();$('old-history-load').disabled=true;
 if(preserveReading&&curriculum)renderReadingVariant();
}
function renderSourceDraft(data){
 const box=$('source-draft');box.replaceChildren();box.hidden=true;
 if(conversationFlow)return;
 const deferred=data.draft?.formal?data.draft:null;
 if(data.draft?.learningRequest)return;
 if(data.learningTurn&&!deferred)return;
 const draft=deferred?{formal:deferred.formal,label:'原有要求',references:[]}:data.sourceDraft;
 if(data.pending||data.question)return;
 if(!draft){renderOriginalTask(data,box);return;}
 box.hidden=false;box.append(node('h3',`核對「${draft.label}」的作答`),node('p','這些是你已寫出的內容。確認後，會按本篇原有判準評閱並保存；不改動過去的成績。'));
 if(draft.rule){const detail=node('details'),summary=node('summary','查看原有判準');detail.append(summary,node('p',draft.rule));box.append(detail);}
 if(draft.references.length){
  for(const ref of draft.references){const quote=node('blockquote',`${ref.label}：${ref.quote}`),link=node('button','查看這段原話');link.type='button';link.onclick=()=>void revealTurn(ref.turnId).catch(e=>{$('status').textContent=e.message;});quote.append(link);box.append(quote);}
 }else box.append(node('p',draft.formal.content));
 const gen=generation,owner=ownerRef,button=node('button',deferred?'配額恢復後送出這份答案':'確認內容，按原判準評閱');button.type='button';
 button.onclick=async()=>{
  if(gen!==generation||owner!==ownerRef||snapshot?.pending)return;
  if($('answer').value.trim()||pending&&!pending.formal){$('status').textContent='本頁還有待送文字，請先保存或送出，再核對這份答案。';return;}
  if(deferred&&deferred.revision!==snapshot.revision){$('status').textContent='這份草稿屬於較早的對話位置；請保留原文並繼續對話核對，不自動重送。';return;}
  pending||={mutationId:deferred?.mutationId||crypto.randomUUID(),revision:deferred?.revision??snapshot.revision,content:draft.formal.content,questionId:null,formal:{objectiveId:draft.formal.objectiveId,input:draft.formal.input}};
  pendingDraft=null;button.disabled=true;try{await sendTurn(pending,null,gen);}finally{if(gen===generation&&button.isConnected)button.disabled=!!snapshot?.pending;}
 };
 box.append(button,node('p','若內容有缺漏，直接在對話中補充；不必重寫已清楚表達的部分。'));
}
function renderOriginalTask(data,box){
 const task=data.originalTask;if(!task)return;
 box.hidden=false;
 const form=node('form'),input=originalDraft?.objectiveId===task.objectiveId?{...originalDraft.input}:{};
 const remember=()=>{originalDraft={objectiveId:task.objectiveId,input:{...input}};};
 if(task.kind==='vocabulary'){
  box.append(node('h3','把剛才的理解對照原題'),node('p',task.source),node('p',task.question));
  if(task.originalMastery?.wrongCount)box.append(node('p',`按原有規則，曾答錯需累計兩次答對；目前 ${task.originalMastery.correctCount} 次答對。新對話中的語境說明另存，原分數不重算。`));
  const choices=node('fieldset');choices.append(node('legend','選擇原題選項；沿用原有答案鍵與作答紀錄'));
  task.options.forEach((text,index)=>{const label=node('label'),radio=node('input');radio.type='radio';radio.name='original-choice';radio.required=true;radio.value=String(index);radio.checked=input.selectedIndex===index;radio.onchange=()=>{input.selectedIndex=index;remember();};label.append(radio,document.createTextNode(text));choices.append(label);});form.append(choices);
 }else{
  box.append(node('h3','你覺得這篇有意思嗎？'),node('p','0 到 100 表達你自己的感受；不喜歡也可以，不計入成績。'));
  const label=node('label','有意思程度（0–100）'),rating=node('input');rating.type='number';rating.min='0';rating.max='100';rating.step='1';rating.required=true;rating.value=input.rating??'';rating.oninput=()=>{input.rating=rating.value===''?null:Number(rating.value);remember();};label.append(rating);
  const reasonLabel=node('label','理由（可留空）'),reason=node('textarea');reason.maxLength=300;reason.value=input.reason||'';reason.oninput=()=>{input.reason=reason.value;remember();};reasonLabel.append(reason);form.append(label,reasonLabel);
 }
 const gen=generation,owner=ownerRef,button=node('button','保存這次作答');button.type='submit';form.append(button);box.append(form);
 form.onsubmit=async event=>{
  event.preventDefault();if(gen!==generation||owner!==ownerRef||snapshot?.pending)return;
  if($('answer').value.trim()||pending&&(pending.action!=='original'||pending.objectiveId!==task.objectiveId)){$('status').textContent='請先保存或送出本頁待送文字，再核對原題。';return;}
  if(task.kind==='evaluation')input.reason||='';remember();
  const submitted=pending||{action:'original',objectiveId:task.objectiveId,input:{...input},revision:snapshot.revision,mutationId:crypto.randomUUID()};
  if(pending&&JSON.stringify(pending.input)!==JSON.stringify(input)){$('status').textContent='正在核對上一份選擇是否保存；請先讀回紀錄，避免改寫原回執。';await refresh(gen);return;}
  pending=submitted;button.disabled=true;try{await sendTurn(submitted,null,gen);}finally{if(gen===generation&&button.isConnected)button.disabled=!!snapshot?.pending;}
 };
}
function hasComposerDraft(){return !!($('answer').value.trim()||composerDraft&&(composerDraft.selectedIndex!==undefined||composerDraft.rating!==undefined));}
function rememberComposer(){
 if(!snapshot?.learningTurn)return;
 composerDraft||={taskId:snapshot.learningTurn.taskId};
}
// Keep an owner-scoped device draft; restore only after server identity confirmation.
function draftKey(){return ownerRef&&curriculum?`yw-dialogue-draft:${ownerRef}:${curriculum.lessonId}`:null;}
function persistComposer(){
 const key=draftKey();if(!key)return false;
 try{
  if(!hasComposerDraft()&&!pending){window.localStorage.removeItem(key);window.sessionStorage.removeItem(key);$('draft-status').textContent='';return true;}
  window.localStorage.setItem(key,JSON.stringify({version:1,curriculumVersion:curriculum.curriculumVersion,content:$('answer').value,composerDraft,selected,pending,pendingDraft}));
  $('draft-status').textContent='草稿已保存在此裝置；離開後可繼續。';return true;
 }catch{$('draft-status').textContent='此瀏覽器無法保存草稿；離開前請先複製文字。';return false;}
}
function restoreComposer(){
 const key=draftKey();if(!key||hasComposerDraft()||pending)return;
 try{
  const draft=JSON.parse(window.localStorage.getItem(key)||window.sessionStorage.getItem(key)||'null');
  if(!draft||draft.version!==1||typeof draft.content!=='string'||draft.content.length>3000)return;
  if(draft.pending&&snapshot?.turns?.some(t=>t.role==='student'&&t.mutationId===draft.pending.mutationId)){window.localStorage.removeItem(key);window.sessionStorage.removeItem(key);return;}
  $('answer').value=draft.content;composerDraft=draft.composerDraft||null;
  if(draft.curriculumVersion===curriculum.curriculumVersion){selected=draft.selected||null;pending=draft.pending||null;pendingDraft=draft.pendingDraft??null;}
  else if(composerDraft)composerDraft={...composerDraft,taskId:'restored-older-curriculum'};
  if(selected){$('quote').textContent=selected.text;$('quote').hidden=false;}
  $('draft-status').textContent='已恢復此帳戶在此裝置的草稿；尚未送出。';
 }catch{$('draft-status').textContent='草稿暫時無法讀取，已保存的學習紀錄不受影響。';}
}
function switchLesson(id){
 if(id===curriculum?.lessonId)return true;
 if(pending||originalDraft||hasFirstReadDraft()||(hasComposerDraft()&&!persistComposer())){$('lesson').value=curriculum.lessonId;$('status').textContent='請先完成保存中的作答，或複製尚未保存的文字，再切換篇目。';return false;}
 $('lesson').value=id;void loadLesson();return true;
}
// Fragment navigation (including Back/Forward) uses the same draft guard as the catalogue.
window.addEventListener('hashchange',()=>{
 const id=location.hash.slice(1);
 if(!lessonIndex?.lessons.some(lesson=>lesson.lessonId===id)||id===$('lesson').value)return;
 if(!switchLesson(id))history.replaceState(history.state,'','#'+$('lesson').value);
});
function renderCatalog(){
 const query=$('lesson-search').value.trim().toLocaleLowerCase(),box=$('catalog-results');box.replaceChildren();
 const lessons=lessonIndex?.lessons.filter(l=>`${l.title} ${l.blockTitle}`.toLocaleLowerCase().includes(query))||[];
 $('catalog-count').textContent=`${lessons.length} / ${lessonIndex?.lessons.length||0} 篇`;
 if(!lessons.length){box.append(node('p','沒有找到篇目，試試篇名中的幾個字。'));return;}
 const groups=new Map();
 for(const lesson of lessons){const key=lesson.blockId||'other';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(lesson);}
 for(const [key,bookLessons] of groups){
  const book=node('details',undefined,'catalog-book');book.dataset.book=key;book.ontoggle=()=>{if(book.open)for(const other of box.querySelectorAll('.catalog-book'))if(other!==book)other.open=false;};book.open=!!query||bookLessons.some(l=>l.lessonId===curriculum?.lessonId);
  const heading=node('summary');heading.append(node('strong',bookLessons[0].blockTitle||'課文'),node('small',`${bookLessons.length} 篇`));book.append(heading);
  const list=node('div',undefined,'book-lessons');
  for(const [index,lesson] of bookLessons.entries()){
   const b=node('button');b.type='button';b.append(node('small',String(index+1).padStart(2,'0'),'lesson-number'),node('span',lesson.title));
   if(lesson.lessonId===curriculum?.lessonId)b.setAttribute('aria-current','page');
   if(lesson.mode==='unit-intro')b.classList.add('unit-entry');
   b.onclick=()=>{if(switchLesson(lesson.lessonId)){if((window.innerWidth||1024)<900)setCatalogHidden(true);$('title').focus();}};list.append(b);
  }
  book.append(list);box.append(book);
 }
}
function renderLearningTurn(data){
 const task=data.learningTurn,controls=$('task-input'),context=$('task-context');controls.replaceChildren();context.replaceChildren();
 if(conversationFlow){
  $('answer').placeholder='想和我談些什麼？';
  $('send').disabled=!!data.pending||['unavailable','exemption'].includes(task?.kind);$('answer').disabled=$('send').disabled;
  const hasTeacher=data.turns?.some(t=>t.role==='teacher'&&t.model!=='source-owned');
  $('next').hidden=hasTeacher;
  if(!hasTeacher)$('next').replaceChildren(authorAvatar(),node('small',dialogueIdentity(curriculum).name),node('p',dialogueOpening(curriculum).content));
  return;
 }

 if(!task){$('answer').placeholder='哪一句讓你停下來？';return;}
 $('send').disabled=!!data.pending;
 $('next').replaceChildren(node('span',task.prompt));
 if(data.state?.legacyCompletion)$('next').prepend(node('p','原課已完成，原有紀錄與成績保留；繼續細讀由你決定。'));
 if(task.source)$('next').append(node('blockquote',task.source));
 appendSourceReferences($('next'),task.references);
 if(task.inputKind==='none'){$('answer').disabled=true;$('send').disabled=true;return;}
 if(!hasComposerDraft())composerDraft=null;
 if(composerDraft&&composerDraft.taskId!==task.taskId){
  context.append(node('p','目前問題已更新。這段尚未送出的文字仍保留，請先核對是否要用它回應這一問。'));
  const adopt=node('button','保留文字，回應這一問');adopt.type='button';adopt.onclick=()=>{composerDraft={taskId:task.taskId};renderLearningTurn(snapshot);$('answer').focus();};context.append(adopt);
  $('send').disabled=true;return;
 }
 $('answer').placeholder=task.inputKind==='choice'?'也可以補充你選擇的理由（可留空）':task.inputKind==='rating'?'說說你的感受（可留空）':'直接寫下你的回應；已說清楚的部分不必重寫。';
 if(task.inputKind==='choice'){
  const choices=node('fieldset');choices.append(node('legend','你的選擇'));
  for(const [index,text] of (task.options||[]).entries()){
   const label=node('label'),radio=node('input');radio.type='radio';radio.name='dialogue-choice';radio.value=String(index);radio.checked=composerDraft?.selectedIndex===index;radio.disabled=!!data.pending;
   radio.onchange=()=>{rememberComposer();composerDraft.selectedIndex=index;persistComposer();};label.append(radio,document.createTextNode(text));choices.append(label);
  }
  controls.append(choices);
 }else if(task.inputKind==='rating'){
  const label=node('label','有意思程度（0–100；自評不計分）'),rating=node('input');rating.type='number';rating.min='0';rating.max='100';rating.step='1';rating.inputMode='numeric';rating.value=composerDraft?.rating??'';rating.disabled=!!data.pending;
  rating.oninput=()=>{rememberComposer();if(rating.value==='')delete composerDraft.rating;else composerDraft.rating=rating.value;persistComposer();};label.append(rating);controls.append(label);
 }
}
function renderSourceResults(data){
 const rows=data.sourceSubmissions||[],box=$('source-results'),receipt=$('record-receipt');box.replaceChildren();receipt.replaceChildren();
 for(const row of rows){
  const item=node('section'),objective=curriculum.objectives.find(o=>o.id===row.objectiveId),label=row.label||objective?.label||'本次作答';let result='答案已保留，評閱尚未確認；尚未計分。';
  if(row.status==='confirmed')result=row.scoringRole==='none'?(row.interaction==='readAcknowledged'||objective?.domain==='read'?'閱讀確認已保存，不計入成績。':'自評已保存，不計入成績。'):Number.isFinite(row.score)?`原判準評閱：${row.score} 分。`:row.correctness==='correct'?'原題作答已保存：答對。':row.correctness==='incorrect'?'原題作答已保存：仍需核對。':'原有作答紀錄已保存。';
  item.append(node('h4',label),node('p',result));
  appendSourceReferences(item,row.references);
  if(row.reference){const reference=node('details');reference.append(node('summary','對照原有參考答案'),node('p',referenceText(row.reference)));item.append(reference);}
  if(row.turnId){const jump=node('button','查看這次原話');jump.type='button';jump.onclick=()=>void revealTurn(row.turnId).catch(e=>{$('status').textContent=e.message;});item.append(jump);}
  box.append(item);
 }
 if(rows.length)receipt.textContent=rows.some(row=>row.status!=='confirmed')?'回答已保存 · 評閱待確認':'已保存';
}
function appendSourceReferences(parent,references){
 if(!Array.isArray(references)||!references.length)return;
 const details=node('details');details.append(node('summary','查看本次沿用的原話'));
 for(const ref of references){const paragraph=node('blockquote',ref.quote||''),jump=node('button','回到這段對話');jump.type='button';jump.onclick=()=>void revealTurn(ref.turnId).catch(e=>{$('status').textContent=e.message;});paragraph.append(jump);details.append(paragraph);}
 parent.append(details);
}
function referenceText(value){
 if(typeof value==='string')return value;
 if(Array.isArray(value))return value.map(referenceText).filter(Boolean).join('\n');
 if(!value||typeof value!=='object')return '';
 if(typeof value.text==='string')return value.text;
 if(Array.isArray(value.runs))return value.runs.map(referenceText).join('');
 for(const key of ['block','blocks','content','answer','paragraphs'])if(value[key])return referenceText(value[key]);
 return Object.entries(value).filter(([key])=>!['type','id','sourceIndex'].includes(key)).map(([,v])=>referenceText(v)).filter(Boolean).join('\n');
}
function appendSourceLink(parent,href,label,kind){
 let url;try{url=new URL(href);if(!['https:','http:'].includes(url.protocol))return false;}catch{return false;}
 const text=typeof label==='string'&&label.trim()&&!/^https?:/.test(label)?label.trim():url.hostname;
 const link=node('a',`${kind}：${text}`);link.setAttribute('href',url.href);link.target='_blank';link.rel='noopener noreferrer';const paragraph=node('p');paragraph.append(link);parent.append(paragraph);return true;
}
let progressTimer=null,progressStartedAt=0,progressStage='';
const PROGRESS_STAGES={saving:'正在保存你的回應',generating:'回應生成中',streaming:'回應顯示中',saved:'這一輪已保存',unconfirmed:'回應未能確認，文字已保留'};
function renderProgressLine(){
 const box=$('progress');if(!box)return;box.replaceChildren();
 if(progressStage&&PROGRESS_STAGES[progressStage]){const seconds=Math.max(0,Math.round((Date.now()-progressStartedAt)/1000));const stage=node('b',PROGRESS_STAGES[progressStage]);box.append(stage,node('span',['saving','generating','streaming'].includes(progressStage)?`已 ${seconds} 秒`:''));box.hidden=false;return;}
 const objectives=(snapshot?.state?.objectives||[]).filter(o=>o.requiredForCompletion!==false&&o.domain!=='shangyou');
 if(!objectives.length){box.hidden=true;return;}
 const done=objectives.filter(o=>['demonstrated','preserved'].includes(o.status)).length;
 box.append(node('span',`本課目標：${done}／${objectives.length} 項已有伺服器評估`),node('small','依已保存的對話判定；對話長短本身不代表掌握'));box.hidden=false;
}
function progressTick(){renderProgressLine();if(['saving','generating','streaming'].includes(progressStage))progressTimer=setTimeout(progressTick,1000);}
function progress(stage){progressStage=stage;clearTimeout(progressTimer);progressTimer=null;if(['saving','generating','streaming'].includes(stage)){if(!progressStartedAt)progressStartedAt=Date.now();progressTimer=setTimeout(progressTick,1000);}else{progressStartedAt=0;if(stage==='saved'||stage==='unconfirmed')setTimeout(()=>{if(progressStage===stage){progressStage='';renderProgressLine();}},4000);}renderProgressLine();}
function update(data){
 let previousPhase=snapshot?.readingGate?.phase;
 if(ownerRef && data.ownerRef && ownerRef!==data.ownerRef){clearPrivateView();previousPhase=null;}
 ownerRef=data.ownerRef||ownerRef;renderAccount();
 $('lesson-outcome').textContent=data.state?.completion==='owner_approved_supplement'?`${data.state.completionLabel||'已通過（補充篇目）'}。這是課程擁有者對補充篇目的決定，不新增分數。`:'';
 if(data.resumeCurriculum && data.resumeCurriculum.curriculumVersion!==curriculum.curriculumVersion){curriculum=data.resumeCurriculum;renderText();}
 if(pending && data.turns?.some(t=>t.role==='student' && t.mutationId===pending.mutationId)){
  if($('answer').value===pendingDraft){$('answer').value='';selected=null;composerDraft=null;$('quote').hidden=true;persistComposer();}
  if(pending.action==='original')originalDraft=null;pending=null;pendingDraft=null;persistComposer();
 }
 snapshot=data;void refreshReadingMarks();$('old-history-load').disabled=false;renderPartial(data.partial);renderReplyRetry(data);if(data.report)renderEvidence(data.report);if(data.legacy?.completion)$('evidence-summary').append(node('p','原課已完成（原有自報紀錄，非新增成績）；新增對話另存。'));if(data.legacy?.firstRead?.length)$('evidence-summary').append(node('p','原有初讀及未完成的標記仍保留，可由「原有課程」繼續；原文版本不同時不自動套用舊位置。'));renderTurns(data.turns||[]);$('older').hidden=!data.older;$('status').textContent=data.pending?'你的回答已保存，正在等候回應。':data.saved===false?'':data.statusNotice||'已讀取伺服器保存紀錄。';$('answer').disabled=false;$('send').disabled=!!data.pending;const next=data.state?.next;$('next').replaceChildren(node('span',data.state?.legacyCompletion?'原課的完成紀錄已保留。你可以自願繼續細讀，不必重做；新對話不改寫原成績。':next?`接下來：${next.domain==='vocabulary'?next.label+'。回到原句，用自己的話解釋語境與判斷依據；可以先查閱註釋，獨立掌握需另作新題。':next.rule}`:data.state?.completion==='evidence_ready_for_review'?'證據已齊，等待教師覆核。':data.state?.objectives.some(o=>o.status==='review')?'有證據待覆核，請保留原話與來源；不用為此反覆作答。':'原有完成紀錄待核對，無需重做已完成內容。'));
 if(data.draft&&(!data.draft.formal||data.draft.learningRequest)&&!hasComposerDraft()&&!pending){
  const draft=data.draft,request=draft.learningRequest||{content:draft.content,questionId:draft.questionId};
  $('answer').value=request.content;selected=null;$('quote').hidden=true;
  if(draft.revision===data.revision){pending={mutationId:draft.mutationId,revision:draft.revision,...request};pendingDraft=request.content;}
  composerDraft=request.taskId?{taskId:request.taskId,...(request.selectedIndex!==undefined?{selectedIndex:request.selectedIndex}:{}),...(request.rating!==undefined?{rating:request.rating}:{})}:null;
  $('status').textContent='已恢復伺服器保存的待送草稿；尚未呼叫 AI。';
 }
 if(data.question){$('next').replaceChildren(node('span',data.question.question));}
 else if(!data.learningTurn&&next && [...curriculum.vocabulary,...(curriculum.languagePractice||[])].some(v=>v.id===next.id)){const b=node('button','開始這項語言練習');b.onclick=async()=>{try{update(await api({action:'question',objectiveId:next.id}));}catch(e){$('status').textContent=e.message;}};$('next').append(b);}
 restoreComposer();renderLearningTurn(data);renderSourceResults(data);$('login').hidden=true;
 if(data.report?.conclusion){const b=node('button','查看這次尚友小結');b.onclick=()=>{$('evidence-summary').closest('details').open=true;$('materials').showModal();$('evidence-summary').scrollIntoView({block:'start'});};$('next').append(b);}
  renderSourceDraft(data);
 if(!progressStage)renderProgressLine();
 performance.mark('dialogue-records-ready');
}
async function refresh(gen=generation){
 try{const data=await api();if(gen!==generation)return;reconnectNeeded=false;update(data);return data;}
 catch(e){
  if(gen!==generation)return;
  const terminal=e.status===401||e.status===404;
  $('status').textContent=e.status===404?'對話試點尚未開放。原文、注釋與原有課程仍可閱讀。':e.message;$('login').hidden=e.status!==401;
  if(terminal){clearPrivateView({preserveReading:true});ownerRef=null;}else reconnectNeeded=true;
  renderAccount();$('login').href='https://my.bdfz.net/?returnTo='+encodeURIComponent(location.href);
  $('answer').disabled=true;$('send').disabled=true;
  // A transport failure does not invalidate the last confirmed account or its draft.
  if(!terminal&&ownerRef&&snapshot){$('answer').disabled=false;renderLearningTurn(snapshot);}
 }
}
window.addEventListener('online',()=>{
 if(!reconnectNeeded||!curriculum||document.hidden)return;
 reconnectNeeded=false;
 // Reconcile once. Only an explicit learner action may submit or resume a turn.
 void refresh();
});
function waitForReply(gen,deadline=Date.now()+25000){clearTimeout(pollTimer);pollTimer=setTimeout(async()=>{if(gen!==generation||document.hidden)return;const data=await refresh(gen);if(data?.pending && Date.now()<deadline)waitForReply(gen,deadline);else if(data?.pending)$('status').textContent='回答已保存；回應仍在處理。稍後回到此頁讀取，不需重送。';},2000);}
async function loadLesson(){clearPrivateView();ownerRef=null;const gen=generation;clearTimeout(pollTimer);snapshot=null;pending=null;pendingDraft=null;selected=null;$('turns').replaceChildren();$('quote').hidden=true;$('answer').value='';$('answer').disabled=true;$('send').disabled=true;const id=$('lesson').value;location.hash=id;try{window.localStorage.setItem('yw-dialogue-last-lesson',id);}catch{}try{const initialLoad=window.ywDialogueInitialLoad;delete window.ywDialogueInitialLoad;const r=await(initialLoad?.id===id?initialLoad.response:fetch(`/dialogue-curriculum/${id}.json`,{cache:'no-cache'}));if(!r?.ok)throw new Error();const data=await r.json();if(gen!==generation)return;curriculum=data;allNotesExpanded=false;$('notes-toggle').textContent='展開全部註釋';$('notes-toggle').setAttribute('aria-pressed','false');renderCatalog();$('catalog-panel').open=true;if(!catalogInitialized){setCatalogHidden((window.innerWidth||1024)<900);catalogInitialized=true;}void loadOriginalMaterials(data,gen);materialMode=curriculum.mode==='classical'?'unpunctuated':'annotated';renderText();void refresh(gen).then(data=>{if(data?.pending)waitForReply(gen);});}catch{$('title').textContent='課文暫時無法載入';$('status').textContent='請稍後再試，或回原有課程閱讀。';}}
$('compose').onsubmit=async e=>{
 e.preventDefault();if(!snapshot||snapshot.pending)return;
 const task=snapshot.learningTurn,text=$('answer').value.trim(),input={};
 if(!conversationFlow&&task?.inputKind==='none')return;
 if(!conversationFlow&&task&&composerDraft&&composerDraft.taskId!==task.taskId){$('status').textContent='問題已更新；請先核對保留的草稿，再送出。';return;}
 if(!conversationFlow&&task?.inputKind==='choice'){
  if(!Number.isInteger(composerDraft?.selectedIndex)||!task.options?.[composerDraft.selectedIndex]){$('status').textContent='先選擇你的回答，再送出。';return;}
  input.selectedIndex=composerDraft.selectedIndex;
 }else if(!conversationFlow&&task?.inputKind==='rating'){
  const rating=Number(composerDraft?.rating);
  if(composerDraft?.rating===undefined||!Number.isFinite(rating)||rating<0||rating>100){$('status').textContent='請用 0 到 100 表達你的感受；高低都不影響成績。';return;}
  input.rating=rating;
 }else if(!text)return;
 const content=selected?`[${selected.id}] ${selected.text}\n\n${text}`:text||(task?.inputKind==='choice'?task.options[input.selectedIndex]:'');
 const limit=conversationFlow?3000:task?.kind==='formal'?1800:task?.inputKind==='rating'?300:3000;
 if(content.length>limit){$('status').textContent=`這一輪的引文與回應合計請少於 ${limit} 字；其餘文字可留到下一輪補充。`;return;}
 const gen=generation,taskId=task?.taskId||(conversationFlow?`${curriculum.curriculumVersion}:${snapshot.revision}:reading-conversation`:undefined);
 if(pending && (pending.content!==content||pending.taskId!==taskId||pending.selectedIndex!==input.selectedIndex||pending.rating!==input.rating)){
  $('status').textContent='正在核對上一輪是否送達；本頁新文字保留。';
  await refresh(gen);if(pending)return;
 }
 pending||={mutationId:crypto.randomUUID(),revision:snapshot.revision,content,questionId:snapshot.question?.id||null,...(conversationFlow?{conversation:true,taskId}:task?{taskId:task.taskId,...input}:{})};
 pendingDraft=$('answer').value;
 await sendTurn(pending,pendingDraft,gen);
};
async function sendTurn(submitted,submittedDraft,gen=generation){
 persistComposer();
 $('send').disabled=true;$('status').textContent='正在保存你的回應…';progress('saving');$('stop').hidden=false;
 for(const input of $('task-input').querySelectorAll('input'))input.disabled=true;
 try{
  let visibleReply=submitted.action==='continue'?snapshot?.partial?.content||'':'';
  const result=await api(submitted,null,false,(event,data)=>{
   if(gen!==generation)return;
   if(event==='saved'){
    if(pending===submitted){pending=null;pendingDraft=null;}
    if(submittedDraft!==null&&$('answer').value===submittedDraft){$('answer').value='';selected=null;composerDraft=null;$('quote').hidden=true;persistComposer();}
    snapshot={...snapshot,revision:data.revision,pending:true};
    if(!data.continuation)renderTurns([{id:data.turnId,role:'student',content:submitted.content,status:'saved',createdAt:data.createdAt}]);
    $('status').textContent=data.continuation?'正在接續回應…':'你的回答已保存，正在生成回應…';progress('generating');
   }else if(event==='delta'){
    visibleReply+=data.text;renderPartial({turnId:data.turnId,content:visibleReply,status:'streaming'});if(progressStage!=='streaming')progress('streaming');
   }else if(event==='unconfirmed'){
    renderPartial({turnId:data.turnId,content:visibleReply,status:'unconfirmed'});progress('unconfirmed');
   }else if(event==='done'){progress('saved');}
  });if(gen!==generation)return;
  if(pending===submitted){pending=null;pendingDraft=null;if(submitted.action==='original')originalDraft=null;}
  if(submittedDraft!==null&&$('answer').value===submittedDraft){$('answer').value='';selected=null;composerDraft=null;$('quote').hidden=true;persistComposer();}
  $('stop').hidden=true;if(progressStage&&progressStage!=='saved'&&progressStage!=='unconfirmed')progress(result.pending?'generating':'saved');
  await refresh(gen);if(result.pending)waitForReply(gen);
 }catch(error){
  $('stop').hidden=true;
  if(gen!==generation)return;
  if(error?.name==='AbortError'){progress('');await refresh(gen);if(gen!==generation)return;$('status').textContent='已停止顯示；伺服器仍會保存這一輪的回應，稍後自動讀回，不會重送。';if(snapshot?.pending)waitForReply(gen);return;}
  progress('');
  if(error.code==='stale_revision'||error.code==='turn_in_progress'||error.code==='learning_task_changed'||error.status===400){
   pending=null;pendingDraft=null;persistComposer();await refresh(gen);$('status').textContent=error.message;
  }else if(error.draftSaved){$('status').textContent=error.message;}
  else if(error.code==='account_changed'||error.status===401||error.status===404){clearPrivateView({preserveReading:true});ownerRef=null;await refresh();}
  else{await refresh(gen);if(gen!==generation)return;$('status').textContent=error.code?error.message:pending?'尚未確認保存；文字保留在本頁。重送會使用同一回執。':'連線中斷，已讀回保存紀錄；AI 不會自動重跑。';if(snapshot?.pending)waitForReply(gen);}
  $('send').disabled=!ownerRef||!snapshot||!!snapshot.pending||(conversationFlow?['unavailable','exemption'].includes(snapshot?.learningTurn?.kind):snapshot?.learningTurn?.inputKind==='none'||!!(composerDraft&&snapshot?.learningTurn&&composerDraft.taskId!==snapshot.learningTurn.taskId));
 }
}
const hasFirstReadDraft=()=>[...$('first-reading').querySelectorAll('textarea,input')].some(input=>input.value.trim());
function autoGrowComposer(){const a=$('answer');try{a.style.height='auto';a.style.height=Math.min(Math.max(a.scrollHeight,44),220)+'px';}catch{}}
$('answer').oninput=()=>{rememberComposer();persistComposer();autoGrowComposer();};
$('answer').onkeydown=event=>{if(event.key==='Enter'&&(event.metaKey||event.ctrlKey)&&!$('send').disabled){event.preventDefault();const handler=$('compose').onsubmit;if(handler)void handler({preventDefault(){}});}};
$('stop').onclick=()=>{if(!streamAbort)return;streamAbort.abort();$('stop').hidden=true;$('status').textContent='已停止顯示；伺服器仍會保存這一輪的回應，稍後自動讀回，不會重送。';};
$('lesson').onchange=()=>switchLesson($('lesson').value);
$('lesson-search').oninput=renderCatalog;
$('text-tab').onclick=()=>view('text');$('conversation-tab').onclick=()=>view('conversation');
$('materials-open').onclick=()=>{lastFocus=document.activeElement;$('materials').showModal();};$('materials-close').onclick=()=>{$('materials').close();lastFocus?.focus();};
$('older').onclick=async()=>{if(!snapshot?.older)return;const cursor=snapshot.older;try{const data=await api(null,cursor);renderTurns(data.turns,true);snapshot.older=data.older;$('older').hidden=!data.older;}catch(e){$('status').textContent=e.message;}};
$('sessions-load').onclick=async()=>{
 const list=$('sessions-list');list.replaceChildren();$('sessions-load').disabled=true;
 try{
  const data=await api(null,null,false,null,null,false,false,true);
  if(!data.sessions?.length){list.append(node('li','本帳戶尚無對話。'));return;}
  const lines=[];
  for(const s of data.sessions){
   const title=lessonIndex?.lessons.find(l=>l.lessonId===s.lessonId)?.title||s.lessonId;
   lines.push(`${title}｜${s.turnCount} 則｜${s.lastTurnAt||'—'}｜${location.origin||''}/dialogue#${s.lessonId}`);
   const li=node('li'),open=node('button',s.lessonId===curriculum?.lessonId?'目前篇目':'開啟');open.type='button';open.disabled=s.lessonId===curriculum?.lessonId;
   open.onclick=()=>{if(switchLesson(s.lessonId)){$('materials').close();lastFocus?.focus();}};
   const when=s.lastTurnAt?new Date(s.lastTurnAt).toLocaleString([],{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'';
   li.append(node('span',title),node('small',`${s.turnCount} 則${when?' · '+when:''}`),open);list.append(li);
  }
  sessionsCopyText=lines.join('\n');$('sessions-copy').hidden=false;$('sessions-status').textContent='';
 }catch(e){list.append(node('li',e.message));}
 finally{$('sessions-load').disabled=false;}
};
let sessionsCopyText='';
$('sessions-copy').onclick=async()=>{
 if(!sessionsCopyText)return;
 try{await navigator.clipboard.writeText(sessionsCopyText);$('sessions-status').textContent='已複製全部對話清單（每行：篇目｜則數｜最後時間｜連結）。';return;}catch{}
 let box=document.getElementById('sessions-copy-text');if(!box){box=node('pre');box.id='sessions-copy-text';$('sessions-list').after(box);}
 box.textContent=sessionsCopyText;$('sessions-status').textContent='此瀏覽器無法自動複製；清單已列出，可手動選取複製。';
};
$('review').onclick=async()=>{try{const r=await api({action:'review'});$('export-status').textContent=r.message;}catch(e){$('export-status').textContent=e.message;}};
async function completeRecord(){
 const expected=generation;let page=await api(null,null,true),turns=[...page.turns],cursor=page.older;
 for(let n=0;cursor&&n<MAX_HISTORY_PAGES;n++){const older=await api(null,cursor);turns.unshift(...older.turns);cursor=older.older;}
 if(expected!==generation||cursor||turns.length>MAX_TRANSCRIPT_RECORDS)throw Error('紀錄尚未完整讀回，請稍後再試。');
 return {...page,opening:dialogueOpening(curriculum),turns,additionalHistory:sharedHistory,exportedAt:new Date().toISOString(),privacy:'僅供本人及獲授權教師核對'};
}
$('copy-transcript').onclick=async()=>{try{const record=await completeRecord();const text=[curriculum.title,record.opening.content,...record.turns.map(t=>`${t.role==='student'?'你':dialogueIdentity(curriculum).name} · ${t.createdAt}\n${t.content}`)].join('\n\n');await navigator.clipboard.writeText(text);$('export-status').textContent='全部對話已複製；原有紀錄仍保留。';}catch(e){$('export-status').textContent='複製未完成：'+e.message+' 可改用匯出。';}};
$('export').onclick=async()=>{try{const record=await completeRecord(),blob=new Blob([JSON.stringify(record,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=node('a');a.href=url;a.download=`${curriculum.lessonId}-learning-record.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),0);$('export-status').textContent='已產生本課私人紀錄，請妥善保存。';}catch(e){$('export-status').textContent=e.message;}};
document.addEventListener('selectionchange',()=>{
 const selection=getSelection(),p=selection?.anchorNode?.parentElement?.closest('[data-passage]'),end=selection?.focusNode?.parentElement?.closest('[data-passage]');
 let text='';
 if(p&&p===end&&selection.rangeCount&&$('reading').contains(p)){
  const fragment=selection.getRangeAt(0).cloneContents();fragment.querySelectorAll('.inline-note,.annotation-toggle,.annotation-number,.passage-anchor').forEach(n=>n.remove());text=fragment.textContent.trim();
 }
 const source=curriculum?.passages.find(item=>item.id===p?.dataset.passage);
 const valid=text.length>1&&text.length<=600&&source?.text.includes(text);$('discuss').hidden=!valid;
 if(valid)$('discuss').onclick=()=>{quotePassage(p.dataset.passage,text);selection.removeAllRanges();$('discuss').hidden=true;};
});
document.addEventListener('visibilitychange',()=>{if(document.hidden)clearTimeout(pollTimer);else if(curriculum)void refresh().then(d=>{if(d?.pending)waitForReply(generation);});});window.addEventListener('focus',()=>{if(curriculum)void refresh();});window.addEventListener('bdfz:session-invalidated',()=>{clearPrivateView({preserveReading:true});ownerRef=null;renderAccount();$('answer').disabled=true;$('send').disabled=true;});window.addEventListener('pagehide',()=>{persistComposer();clearTimeout(pollTimer);});window.addEventListener('beforeunload',e=>{if((hasComposerDraft()&&!persistComposer())||pending||originalDraft||hasFirstReadDraft()){e.preventDefault();e.returnValue='';}});
async function loadLessonIndex(){
 try{
  const response=await fetch('/dialogue-curriculum/index.json',{cache:'no-cache'});if(!response.ok)throw Error();
  const index=await response.json(),ids=new Set();
  if(index.schemaVersion!==1||!Array.isArray(index.lessons)||!index.lessons.length)throw Error();
  for(const lesson of index.lessons){if(!/^lesson-[a-zA-Z0-9_-]+$/.test(lesson.lessonId)||typeof lesson.title!=='string'||!lesson.title.trim()||ids.has(lesson.lessonId))throw Error();ids.add(lesson.lessonId);}
  lessonIndex=index;const groups=new Map();$('lesson').replaceChildren();
  for(const lesson of index.lessons){const key=lesson.blockId||'',parent=groups.get(key)||node('optgroup');if(!groups.has(key)){parent.label=lesson.blockTitle||'課文';groups.set(key,parent);$('lesson').append(parent);}const option=node('option',lesson.title);option.value=lesson.lessonId;parent.append(option);}
  const requested=location.hash.slice(1);let recent='';try{recent=window.localStorage.getItem('yw-dialogue-last-lesson')||'';}catch{}$('lesson').value=ids.has(requested)?requested:ids.has(recent)?recent:index.lessons[0].lessonId;$('lesson').disabled=false;await loadLesson();renderCatalog();
 }catch{$('title').textContent='篇目目錄暫時無法載入';$('status').textContent='請稍後重新開啟，或由原有課程繼續閱讀；學習紀錄沒有改動。';}
}
renderAccount();
view(conversationFlow?'conversation':'text');
void loadLessonIndex();

let dictionaryModule=null, dictionaryGeneration=0;
$('dictionary-lookup').onclick=async()=>{
 const word=$('dictionary-word').value.trim();if(!word||word.length>12)return;
 const token=++dictionaryGeneration;$('dictionary-result').textContent='正在讀取指定詞典…';
 try{dictionaryModule||=import('https://dict.bdfz.net/v1/c41ff5236bdbd65171a719a90c4a23593b06fc8d/src/component.mjs').catch(e=>{dictionaryModule=null;throw e;});await dictionaryModule;if(token!==dictionaryGeneration||!$('materials').open)return;
 const reader=document.createElement('student-dictionary');reader.setAttribute('presentation','embedded');reader.setAttribute('endpoint','https://dict.bdfz.net/api/v1/read');reader.setAttribute('link-sources','zi');$('dictionary-result').replaceChildren(reader);await reader.lookup(word,{source:'xc'});
 }catch{if(token===dictionaryGeneration)$('dictionary-result').textContent='詞條或原書頁尚未可靠取得，這項解釋待核查；請使用原站核對。';}
};
$('materials').addEventListener('close',()=>{dictionaryGeneration++;$('dictionary-result').replaceChildren();});
let closeExpandedPlate=null;
function renderPlates(box,plates,{initialIndex=0,label='本課教材閱讀器',unit='頁',onClose=null}={}){
 closeExpandedPlate?.();
 box.replaceChildren();for(const note of plates.notes||[])box.append(node('p',note));
 if(!plates.pages.length){box.append(node('p','本課尚無已核實的對應原圖，請到原有課程查閱。'));return;}
 const reader=node('div',undefined,'plate-reader'),stage=node('div',undefined,'plate-stage'),toolbar=node('nav',undefined,'plate-toolbar');
 reader.setAttribute('role','region');reader.setAttribute('aria-label',label);stage.tabIndex=0;stage.setAttribute('aria-label','圖頁，左右方向鍵翻頁');
 toolbar.setAttribute('aria-label',unit==='張'?'圖片翻閱':'教材翻頁');
 const previous=node('button','上一'+unit),next=node('button','下一'+unit),choice=node('select'),status=node('span',undefined,'plate-count'),original=node('a','原圖');
 previous.type=next.type='button';choice.setAttribute('aria-label',unit==='張'?'本課參考圖片序號':'本課教材頁碼');status.setAttribute('role','status');status.setAttribute('aria-live','polite');original.target='_blank';original.rel='noopener noreferrer';
 plates.pages.forEach((page,i)=>{const option=node('option',page.label);option.value=String(i);choice.append(option);});
 const expand=node('button','全屏');expand.type='button';expand.className='plate-expand';expand.setAttribute('aria-expanded','false');
 toolbar.append(previous,choice,next,expand,status,original);reader.append(stage,toolbar);box.append(reader);
 let index=0,start=null,suppressClick=false,overlay=null;
 const toggleExpanded=()=>{
  if(overlay){closeExpandedPlate?.();return;}
  const marker=document.createComment('textbook position'),focus=document.activeElement,overflow=document.body.style.overflow,position={top:window.scrollY||0,left:window.scrollX||0,behavior:'instant'};
  reader.before(marker);overlay=node('dialog',undefined,'plate-fullscreen');overlay.setAttribute('aria-label',label+'全屏');document.body.append(overlay);overlay.append(reader);
  const close=()=>{if(!overlay)return;const dialog=overlay;overlay=null;marker.replaceWith(reader);dialog.remove();document.body.style.overflow=overflow;expand.textContent='全屏';expand.setAttribute('aria-expanded','false');closeExpandedPlate=null;onClose?.();if(focus?.isConnected)focus.focus({preventScroll:true});window.scrollTo?.(position);};
  closeExpandedPlate=close;overlay.oncancel=event=>{event.preventDefault();close();};overlay.onclose=close;
  document.body.style.overflow='hidden';expand.textContent='縮回';expand.setAttribute('aria-expanded','true');overlay.showModal();stage.focus();
 };
 expand.onclick=toggleExpanded;
 stage.onclick=()=>{if(suppressClick){suppressClick=false;return;}toggleExpanded();};
 stage.setAttribute('aria-label','圖頁，點擊全屏或縮回，左右方向鍵翻頁');
 const show=value=>{
  index=Math.max(0,Math.min(plates.pages.length-1,value));const page=plates.pages[index],img=node('img'),message=node('p','圖頁載入中…','plate-message');
  message.setAttribute('role','status');img.alt=page.label;img.decoding='async';img.draggable=false;
  img.onload=()=>message.remove();img.onerror=()=>{message.textContent='圖頁暫時無法載入，可切換其他頁或開啟原圖。';};img.src=page.src;
  stage.replaceChildren(img,message);choice.value=String(index);previous.disabled=index===0;next.disabled=index===plates.pages.length-1;status.textContent=`${index+1} / ${plates.pages.length}`;original.href=page.src;
 };
 previous.onclick=()=>show(index-1);next.onclick=()=>show(index+1);choice.onchange=()=>show(Number(choice.value));
 reader.onkeydown=event=>{if(event.key==='Escape'&&overlay){event.preventDefault();closeExpandedPlate?.();return;}if(event.target===stage&&['Enter',' '].includes(event.key)){event.preventDefault();toggleExpanded();return;}if(event.target===choice||event.altKey||event.ctrlKey||event.metaKey)return;if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();show(event.key==='Home'?0:event.key==='End'?plates.pages.length-1:index+(event.key==='ArrowRight'?1:-1));};
 stage.onpointerdown=event=>{suppressClick=false;start=event.isPrimary===false?null:{x:event.clientX,y:event.clientY};};
 stage.onpointercancel=()=>{start=null;};stage.onpointerup=event=>{if(!start)return;const dx=event.clientX-start.x,dy=event.clientY-start.y;start=null;if(Math.abs(dx)>48&&Math.abs(dx)>Math.abs(dy)*1.5){suppressClick=true;show(index+(dx<0?1:-1));}};
 show(initialIndex);return {expand:toggleExpanded};
}
async function loadPlates(box){const gen=generation;box.textContent='正在讀取教材原圖索引…';try{const [{lessonPlates},response]=await Promise.all([import('./textbook-pages.js'),fetch('/data/textbook-pages.v1.json')]);if(!response.ok)throw new Error();const data=await response.json();if(gen!==generation)return;renderPlates(box,lessonPlates(data,curriculum.lessonId));}catch{if(gen===generation)box.textContent='教材原圖索引暫時無法讀取；正文仍可閱讀。';}}
$('plates-details').ontoggle=()=>{if($('plates-details').open&&curriculum)void loadPlates($('plates'));};

async function openCorrection(turn){
 const gen=generation;correctionTarget=turn.id;correctionMutation=null;
 $('correction-original').textContent=turn.content;$('correction-note').value='';$('correction-proposed').value='';$('correction-status').textContent='正在讀取已保存的更正…';$('correction-history').replaceChildren();$('correction').showModal();
 try{const result=await api(null,null,false,null,turn.id);if(gen!==generation||correctionTarget!==turn.id)return;
 for(const note of result.corrections){const row=node('div');row.append(node('p',`${new Date(note.createdAt).toLocaleString()} · ${note.note}`));if(note.proposedText)row.append(node('p','補充文字：'+note.proposedText));$('correction-history').append(row);}
 $('correction-status').textContent=result.corrections.length?'原件及所有已保存更正都保留。':'尚無更正。';
 }catch(e){if(gen===generation)$('correction-status').textContent=e.message;}
}
$('correction-close').onclick=()=>$('correction').close();
$('correction-form').onsubmit=async e=>{
 e.preventDefault();if(!correctionTarget)return;const gen=generation;
 const body={action:'correction',turnId:correctionTarget,note:$('correction-note').value,proposedText:$('correction-proposed').value};
 const hash=JSON.stringify(body);if(!correctionMutation||correctionMutation.hash!==hash)correctionMutation={hash,id:crypto.randomUUID()};
 $('correction-save').disabled=true;
 try{const result=await api({...body,mutationId:correctionMutation.id});if(gen!==generation)return;
 $('correction-status').textContent=result.saved?'更正已保存，原件與原評價保留；尚未由教師覆核。':'尚未確認保存。';
 }catch(error){if(gen===generation)$('correction-status').textContent=error.message;}finally{if(gen===generation)$('correction-save').disabled=false;}
};

$('old-history-load').onclick=async()=>{
 const gen=generation;if(!ownerRef)return;$('old-history-load').disabled=true;$('old-history').textContent='正在核對本帳戶的舊紀錄…';
 try{const data=await api(null,null,false,null,null,true);if(gen!==generation)return;const shared=data.sharedHistory;
 const box=$('old-history');box.replaceChildren();
 if(shared.status!=='available'){box.append(node('p','共享閱讀位置暫時無法核對；沒有把缺失當作未完成。請由原有課程繼續。'));return;}
 const local=readBrowserHistory(localStorage,shared.ownerScope,curriculum.lessonId);sharedHistory={shared,browser:local,readAt:new Date().toISOString()};
 if(shared.readingPosition){const a=node('a','回到原有課程的最近閱讀篇目');a.href='/#'+encodeURIComponent(shared.readingPosition.lessonId);a.target='_blank';a.rel='noopener noreferrer';box.append(a,node('p','原閱讀位置保留在原課程；本文不跨版本套用舊段落位置。'));}
 else box.append(node('p','沒有共享閱讀位置，這不表示沒有學習紀錄。'));
 if(local.status==='available'){box.append(node('p',local.notice));const labels={context:'初讀感悟',read:'通讀正文',revision:'字句之改',structure:'文章技法',evaluation:'篇目評價',authorQuestion:'叩問作者',vocabulary:'字詞累積',wordCreation:'字詞創作',firstRead:'無注疏初讀'};
 for(const [key,label] of Object.entries(labels)){const r=local.record[key];if(r!==undefined)box.append(node('p',`${label}：${r===true||r?.done===true?'本機記錄為已完成':'本機有進行中紀錄'}（僅保留，不重評）。`));}
 if(local.record.completionEventSent)box.append(node('p','本機保留了原課完成回執標記；服務端成果仍按原來源核對。'));
 }else box.append(node('p',local.status==='not_found'?'此瀏覽器沒有本帳戶的舊紀錄；其他裝置及原服務端紀錄不受影響。':'本機紀錄目前無法讀取；原資料未修改。'));
 }catch(error){if(gen===generation)$('old-history').textContent=error.message;}finally{if(gen===generation)$('old-history-load').disabled=false;}
};

for(const palette of PALETTES){const option=node('option',palette.name);option.value=palette.id;$('reading-theme').append(option);}
function applyReadingTheme(id){const palette=PALETTES.find(p=>p.id===id)||PALETTES.find(p=>p.id==='qingque')||PALETTES[0];for(const [token,key] of Object.entries({paper:'background',surface:'surface',wash:'wash',reply:'commentSurface',ink:'text',muted:'textMuted',accent:'link',line:'border',note:'link'}))document.documentElement.style.setProperty('--'+token,palette[key]);$('reading-theme').value=palette.id;try{window.localStorage.setItem('yw-reading-theme',palette.id);}catch{}}
$('reading-theme').onchange=()=>applyReadingTheme($('reading-theme').value);
try{applyReadingTheme(window.localStorage.getItem('yw-reading-theme'));}catch{applyReadingTheme(null);}
