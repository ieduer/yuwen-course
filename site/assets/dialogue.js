import {readDialogueEvents} from './dialogue-events.js';
import {readBrowserHistory} from './dialogue-history.js';
import {openFirstReading} from './dialogue-first-read.js';
const $=id=>document.getElementById(id);
let streamAbort=null;
let firstReadView=null;
let correctionTarget=null,correctionMutation=null,sharedHistory=null,originalDraft=null;
let curriculum, snapshot, generation=0, selected=null, pending=null, pendingDraft=null, pollTimer=null, lastFocus=null, ownerRef=null;
const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const api=async(body,cursor,records=false,onEvent,correctionsFor,shared=false)=>{
 const gen=generation,expectedOwner=ownerRef;
 const current=()=>{if(gen!==generation)throw Object.assign(new Error('帳戶或篇目已切換，已忽略舊回應。'),{code:'stale_context'});};
 const q=new URLSearchParams({lessonId:curriculum.lessonId,...(cursor?{beforeSeq:cursor.sequence}:{}),...(records?{records:'1'}:{}),...(correctionsFor?{correctionsFor}:{}),...(shared?{sharedHistory:'1'}:{})});
 const streamed=body&&typeof body.content==='string';
 if(streamed)streamAbort=new AbortController();
 const response=await fetch(`/api/dialogue/v1?${q}`,{credentials:'same-origin',cache:'no-store',...(streamed?{signal:streamAbort.signal}:body?.action==='first_read'?{signal:AbortSignal.timeout(12000)}:{}),...(body?{method:'POST',headers:{'content-type':'application/json',...(streamed?{accept:'text/event-stream'}:{})},body:JSON.stringify({...body,ownerRef})}:{})});
 current();
 if(response.ok&&response.headers.get('content-type')?.includes('text/event-stream')){const result=await readDialogueEvents(response,(event,data)=>{current();onEvent?.(event,data);});current();return result;}
 const value=await response.json().catch(()=>{throw Error('伺服器回應未完整讀取；請保留文字，讀回紀錄再繼續。');});current();
 if(expectedOwner&&value.ownerRef&&expectedOwner!==value.ownerRef){clearPrivateView();ownerRef=null;queueMicrotask(()=>void refresh());throw Object.assign(new Error('帳戶已切換，已清除舊紀錄；請重新查看或匯出。'),{code:'account_changed'});}
 if(!response.ok&&value.code==='account_changed'){clearPrivateView();ownerRef=null;queueMicrotask(()=>void refresh());}
 if(!response.ok)throw Object.assign(new Error(value.message||value.error||'暫時無法連線，文字仍保留在本頁。'),{status:response.status,code:value.code,draftSaved:value.draftSaved});return value;
};
function renderPartial(partial){
 let n=document.getElementById('partial-reply');
 if(!partial){n?.remove();return;}
 if(!n){n=node('div',undefined,'turn teacher');n.id='partial-reply';n.append(node('small'),node('span'));$('turns').append(n);}
 n.dataset.turnId=partial.turnId;n.querySelector('small').textContent=partial.status==='unconfirmed'?'回應中斷 · 已保留文字，尚未計入評閱':'AI 教學模擬 · 正在生成，尚未計入評閱';n.querySelector('span').textContent=partial.content;
}
async function revealTurn(turnId){
 for(let i=0;i<9;i++){
  const target=document.getElementById('turn-'+turnId);if(target){$('materials').close();view('conversation');target.scrollIntoView({block:'center'});return;}
  if(!snapshot?.older)break;
  const data=await api(null,snapshot.older);renderTurns(data.turns,true);snapshot.older=data.older;$('older').hidden=!data.older;
 }
 throw Error('這份原話尚未載入；可匯出完整紀錄核對。');
}
function renderEvidence(report){
 const box=$('evidence-summary');box.replaceChildren(node('p',report.student.notice));
 const first=report.student.trajectory?.first;if(first){const b=node('button',`初讀摘錄：「${first.quote}」${first.truncated?'…':''}`);b.onclick=()=>void revealTurn(first.turnId).catch(e=>{$('export-status').textContent=e.message;});box.append(b);}
 for(const item of report.student.summary||[]){box.append(node('p',item.text));for(const ref of item.references){const b=node('button',`查看原話：「${ref.quote}」`);b.onclick=()=>void revealTurn(ref.turnId).catch(e=>{$('export-status').textContent=e.message;});box.append(b);}}
 for(const o of report.student.observed)box.append(node('p',`已有證據：${o.label}`));
 for(const o of report.student.remaining)box.append(node('p',`${o.status==='historical_review'?'原有完成已保留，版本對應待核對':o.status==='review'?'待覆核':'尚待觀察'}：${o.label}`));
}
function view(name){document.querySelector('.workspace').dataset.view=name;for(const id of ['text','conversation'])$(id+'-tab').setAttribute('aria-pressed',String(id===name));}
function quotePassage(id,quote){const p=curriculum.passages.find(p=>p.id===id);if(!p)return;selected={id,text:quote||p.text.slice(0,600)};$('quote').textContent=selected.text;$('quote').hidden=false;view('conversation');$('answer').focus();}
function renderText(){
 const locked=curriculum.mode==='classical'&&(!snapshot||snapshot.readingGate?.phase==='initial_reading');
 $('title').textContent=curriculum.title;$('author').textContent=curriculum.author;$('source').href=curriculum.source;$('legacy').href=`/#${curriculum.lessonId}`;
 $('source').hidden=locked;$('plates-details').hidden=locked;$('dictionary-details').hidden=locked;
 $('passages').replaceChildren();
 for(const p of locked?[]:curriculum.passages){const paragraph=node('p');paragraph.id=p.id;paragraph.dataset.passage=p.id;
  if(p.block.runs){for(const run of p.block.runs){if(run.type==='annotation-ref'){const b=node('button',run.label||'注','passage-anchor');b.setAttribute('aria-label','查看注釋');b.onclick=()=>{const existing=paragraph.querySelector('.note');if(existing){existing.remove();return;}const a=curriculum.annotations.find(a=>a.noteId===run.noteId);paragraph.append(node('span',(a?.blocks||[]).flatMap(b=>(b.runs||[]).map(r=>r.text||'')).join('\n')||'注釋待核查','note'));};paragraph.append(b);}else paragraph.append(document.createTextNode(run.text||''));}}
  else paragraph.append(document.createTextNode(p.text));
  const discuss=node('button','↗','passage-anchor');discuss.setAttribute('aria-label','討論這一段');discuss.onclick=()=>quotePassage(p.id);paragraph.append(discuss);$('passages').append(paragraph);
 }
 if(locked){$('requirements').replaceChildren(node('p','先自行斷句，保存至少三處疑點與猜測，再寫下初讀感知。原要求及原始紀錄保留。'));$('references').replaceChildren(node('p','完成無注疏初讀後，展開正文註釋與參考資料。'));return;}
 $('requirements').replaceChildren(...curriculum.objectives.map(o=>{const n=node('div',undefined,'requirement');n.append(node('strong',o.label),node('span',o.rule));return n;}));
 $('references').replaceChildren(node('p','原有補充資料、學案與教材原圖保留在上方的原有課程入口。'),...curriculum.annotations.map(a=>node('p',(a.blocks||[]).flatMap(b=>(b.runs||[]).map(r=>r.text||'')).join('\n'))));
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
 performance.mark('dialogue-readable-text');
}
function renderTurns(turns,prepend=false){const fragment=document.createDocumentFragment();for(const t of turns){if(document.getElementById('turn-'+t.id))continue;const n=node('div',undefined,'turn '+t.role);n.id='turn-'+t.id;n.append(node('small',`${t.role==='student'?'你':t.model==='source-owned'?'原題紀錄':curriculum.author+' · AI 教學模擬'} · ${new Date(t.createdAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}`),node('span',t.content));
 const refs=t.content.match(/\[(lesson-[\w-]+:p\d+)\]/g)||[];for(const ref of new Set(refs)){const id=ref.slice(1,-1);if(!curriculum.passages.some(p=>p.id===id))continue;const a=node('a','回到原文');a.href='#'+encodeURIComponent(id);a.onclick=e=>{e.preventDefault();view('text');document.getElementById(id)?.scrollIntoView({block:'center',behavior:'auto'});document.getElementById(id)?.focus();};n.append(a);}if(t.status==='needs_review')n.append(node('small','回答已保存；AI 回應未確認，保留待覆核。'));const correction=node('button','查看／補充更正');correction.type='button';correction.onclick=()=>void openCorrection(t);n.append(correction);fragment.append(n);}if(prepend)$('turns').prepend(fragment);else $('turns').append(fragment);}
function clearPrivateView(){generation++;streamAbort?.abort();streamAbort=null;
 firstReadView?.dispose();firstReadView=null;
 $('correction').close();correctionTarget=null;correctionMutation=null;$('correction-original').textContent='';$('correction-history').replaceChildren();$('correction-note').value='';$('correction-proposed').value='';$('turns').replaceChildren();$('answer').value='';$('quote').hidden=true;
 selected=null;pending=null;pendingDraft=null;originalDraft=null;snapshot=null;clearTimeout(pollTimer);
 $('source-draft').replaceChildren();$('source-draft').hidden=true;$('export-status').textContent='';$('evidence-summary').replaceChildren();sharedHistory=null;$('old-history').replaceChildren();$('old-history-load').disabled=true;
}
function renderSourceDraft(data){
 const box=$('source-draft');box.replaceChildren();box.hidden=true;
 const deferred=data.draft?.formal?data.draft:null;
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
function update(data){
 let previousPhase=snapshot?.readingGate?.phase;
 if(ownerRef && data.ownerRef && ownerRef!==data.ownerRef){clearPrivateView();previousPhase=null;}
 ownerRef=data.ownerRef||ownerRef;
 if(data.resumeCurriculum && data.resumeCurriculum.curriculumVersion!==curriculum.curriculumVersion){curriculum=data.resumeCurriculum;renderText();}
 if(pending && data.turns?.some(t=>t.role==='student' && t.mutationId===pending.mutationId)){
  if($('answer').value===pendingDraft){$('answer').value='';selected=null;$('quote').hidden=true;}
  if(pending.action==='original')originalDraft=null;pending=null;pendingDraft=null;
 }
 snapshot=data;$('old-history-load').disabled=false;renderPartial(data.partial);if(data.report)renderEvidence(data.report);if(data.legacy?.completion)$('evidence-summary').append(node('p','原課已完成（原有自報紀錄，非新增成績）；新增對話另存。'));if(data.legacy?.firstRead?.length)$('evidence-summary').append(node('p','原有初讀及未完成的標記仍保留，可由「原有課程」繼續；原文版本不同時不自動套用舊位置。'));renderTurns(data.turns||[]);$('older').hidden=!data.older;$('status').textContent=data.pending?'你的回答已保存，正在等候回應。':data.saved===false?'尚未開始對話；原有學習紀錄保持不變。':'已讀取伺服器保存紀錄。';$('answer').disabled=false;$('send').disabled=!!data.pending;const next=data.state?.next;$('next').replaceChildren(node('span',data.state?.legacyCompletion?'原課的完成紀錄已保留。你可以自願繼續細讀，不必重做；新對話不改寫原成績。':next?`接下來：${next.rule}`:data.state?.completion==='evidence_ready_for_review'?'證據已齊，等待教師覆核。':'原有完成紀錄待核對，無需重做已完成內容。'));
 if(data.draft && !data.draft.formal && !$('answer').value && !pending){$('answer').value=data.draft.content;selected=null;$('quote').hidden=true;if(data.draft.revision===data.revision){pending={mutationId:data.draft.mutationId,revision:data.draft.revision,content:data.draft.content,questionId:data.draft.questionId};pendingDraft=data.draft.content;}$('status').textContent='已恢復伺服器保存的待送草稿；尚未呼叫 AI。';}
 if(data.question){$('next').replaceChildren(node('span',data.question.question));}
 else if(next && curriculum.vocabulary.some(v=>v.id===next.id)){const b=node('button','開始這個詞的語境提問');b.onclick=async()=>{try{update(await api({action:'question',objectiveId:next.id}));}catch(e){$('status').textContent=e.message;}};$('next').append(b);}
 if(curriculum.mode==='classical'){
  if(previousPhase!==data.readingGate?.phase)renderText();
  const gen=generation,owner=ownerRef;
  if(!firstReadView)firstReadView=openFirstReading({lessonId:curriculum.lessonId,root:$('first-reading'),isCurrent:()=>gen===generation&&owner===ownerRef,gate:()=>snapshot?.readingGate,action:(operation,payload)=>{if(gen!==generation||owner!==ownerRef)throw Error('帳戶或篇目已切換，請重新讀回。');return api({action:'first_read',operation,payload});},onStatus:message=>{$('status').textContent=message;},onUnlock:()=>void refresh(gen)});
  if(data.readingGate?.phase==='annotated_reading')$('next').textContent='先讀完正文與隨文註釋，保存閱讀確認後，再進入字詞練習。';
  if(data.readingGate?.phase==='initial_reading'){$('answer').disabled=true;$('send').disabled=true;$('next').textContent='先在左側正文標記疑點並保存初讀感知；完成後在這裡繼續細讀對話。';}
 }
 renderSourceDraft(data);
 performance.mark('dialogue-records-ready');
}
async function refresh(gen=generation){try{const data=await api();if(gen!==generation)return;update(data);return data;}catch(e){if(gen!==generation)return;$('status').textContent=e.status===404?'對話試點尚未開放。原文、注釋與原有課程仍可閱讀。':e.message;$('login').hidden=e.status!==401;if(e.status===401||e.status===404){clearPrivateView();ownerRef=null;}$('answer').disabled=true;$('send').disabled=true;}}
function waitForReply(gen,deadline=Date.now()+25000){clearTimeout(pollTimer);pollTimer=setTimeout(async()=>{if(gen!==generation||document.hidden)return;const data=await refresh(gen);if(data?.pending && Date.now()<deadline)waitForReply(gen,deadline);else if(data?.pending)$('status').textContent='回答已保存；回應仍在處理。稍後回到此頁讀取，不需重送。';},2000);}
async function loadLesson(){clearPrivateView();ownerRef=null;const gen=generation;clearTimeout(pollTimer);snapshot=null;pending=null;pendingDraft=null;selected=null;$('turns').replaceChildren();$('quote').hidden=true;$('answer').value='';$('answer').disabled=true;$('send').disabled=true;const id=$('lesson').value;location.hash=id;try{const r=await fetch(`/dialogue-curriculum/${id}.json`,{cache:'no-cache'});if(!r.ok)throw new Error();const data=await r.json();if(gen!==generation)return;curriculum=data;renderText();view('text');void refresh(gen).then(data=>{if(data?.pending)waitForReply(gen);});}catch{$('title').textContent='課文暫時無法載入';$('status').textContent='請稍後再試，或回原有課程閱讀。';}}
$('compose').onsubmit=async e=>{
 e.preventDefault();if(!snapshot||snapshot.pending)return;
 const text=$('answer').value.trim();if(!text)return;
 const content=selected?`[${selected.id}] ${selected.text}\n\n${text}`:text;
 if(content.length>3000){$('status').textContent='引文與回應合計請少於 3000 字。';return;}
 const gen=generation;
 if(pending && pending.content!==content){
  $('status').textContent='正在核對上一輪是否送達；本頁新文字保留。';
  await refresh(gen);if(pending)return;
 }
 pending||={mutationId:crypto.randomUUID(),revision:snapshot.revision,content,questionId:snapshot.question?.id||null};
 pendingDraft=$('answer').value;
 await sendTurn(pending,pendingDraft,gen);
};
async function sendTurn(submitted,submittedDraft,gen=generation){
 $('send').disabled=true;$('status').textContent='正在保存你的回應…';
 try{
  let visibleReply='';
  const result=await api(submitted,null,false,(event,data)=>{
   if(gen!==generation)return;
   if(event==='saved'){
    if(pending===submitted){pending=null;pendingDraft=null;}
    if(submittedDraft!==null&&$('answer').value===submittedDraft){$('answer').value='';selected=null;$('quote').hidden=true;}
    snapshot={...snapshot,revision:data.revision,pending:true};
    renderTurns([{id:data.turnId,role:'student',content:submitted.content,status:'saved',createdAt:data.createdAt}]);
    $('status').textContent='你的回答已保存，正在生成回應…';
   }else if(event==='delta'){
    visibleReply+=data.text;renderPartial({turnId:data.turnId,content:visibleReply,status:'streaming'});
   }else if(event==='unconfirmed'){
    renderPartial({turnId:data.turnId,content:visibleReply,status:'unconfirmed'});
   }
  });if(gen!==generation)return;
  if(pending===submitted){pending=null;pendingDraft=null;if(submitted.action==='original')originalDraft=null;}
  if(submittedDraft!==null&&$('answer').value===submittedDraft){$('answer').value='';selected=null;$('quote').hidden=true;}
  await refresh(gen);if(result.pending)waitForReply(gen);
 }catch(error){
  if(gen!==generation)return;
  if(error.code==='stale_revision'||error.code==='turn_in_progress'){
   pending=null;pendingDraft=null;await refresh(gen);$('status').textContent=error.message;
  }else if(error.draftSaved){$('status').textContent=error.message;}
  else if(error.code==='account_changed'||error.status===401||error.status===404){clearPrivateView();ownerRef=null;await refresh(gen);}
  else{await refresh(gen);if(gen!==generation)return;$('status').textContent=error.code?error.message:pending?'尚未確認保存；文字保留在本頁。重送會使用同一回執。':'連線中斷，已讀回保存紀錄；AI 不會自動重跑。';if(snapshot?.pending)waitForReply(gen);}
  $('send').disabled=!!snapshot?.pending;
 }
}
const hasFirstReadDraft=()=>[...$('first-reading').querySelectorAll('textarea,input')].some(input=>input.value.trim());
$('lesson').onchange=()=>{if($('answer').value.trim()||pending||originalDraft||hasFirstReadDraft()){$('lesson').value=curriculum.lessonId;$('status').textContent='請先送出或自行保存本頁尚未送出的文字，再切換篇目。';return;}loadLesson();};
$('text-tab').onclick=()=>view('text');$('conversation-tab').onclick=()=>view('conversation');
$('materials-open').onclick=()=>{lastFocus=document.activeElement;$('materials').showModal();};$('materials-close').onclick=()=>{$('materials').close();lastFocus?.focus();};
$('older').onclick=async()=>{if(!snapshot?.older)return;const cursor=snapshot.older;try{const data=await api(null,cursor);renderTurns(data.turns,true);snapshot.older=data.older;$('older').hidden=!data.older;}catch(e){$('status').textContent=e.message;}};
$('review').onclick=async()=>{try{const r=await api({action:'review'});$('export-status').textContent=r.message;}catch(e){$('export-status').textContent=e.message;}};
$('export').onclick=async()=>{try{let page=await api(null,null,true),turns=[...page.turns],cursor=page.older;for(let n=0;cursor && n<20;n++){const older=await api(null,cursor);turns.unshift(...older.turns);cursor=older.older;}if(cursor)throw new Error('紀錄超出單次匯出範圍，尚未完成匯出。');const blob=new Blob([JSON.stringify({...page,turns,additionalHistory:sharedHistory,exportedAt:new Date().toISOString(),privacy:'僅供本人及獲授權教師核對'},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=node('a');a.href=url;a.download=`${curriculum.lessonId}-learning-record.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),0);$('export-status').textContent='已產生本課私人紀錄，請妥善保存。';}catch(e){$('export-status').textContent=e.message;}};
document.addEventListener('selectionchange',()=>{const selection=getSelection();const p=selection?.anchorNode?.parentElement?.closest('[data-passage]');const valid=p&&selection.toString().trim().length>1&&selection.toString().length<=600&&$('reading').contains(selection.focusNode);$('discuss').hidden=!valid;if(valid)$('discuss').onclick=()=>{quotePassage(p.dataset.passage,selection.toString().trim());selection.removeAllRanges();$('discuss').hidden=true;};});
document.addEventListener('visibilitychange',()=>{if(document.hidden)clearTimeout(pollTimer);else if(curriculum)void refresh().then(d=>{if(d?.pending)waitForReply(generation);});});window.addEventListener('focus',()=>{if(curriculum)void refresh();});window.addEventListener('bdfz:session-invalidated',()=>{clearPrivateView();ownerRef=null;$('answer').disabled=true;$('send').disabled=true;});window.addEventListener('pagehide',()=>clearTimeout(pollTimer));window.addEventListener('beforeunload',e=>{if($('answer').value.trim()||pending||originalDraft||hasFirstReadDraft()){e.preventDefault();e.returnValue='';}});
const id=location.hash.slice(1);if([...$('lesson').options].some(o=>o.value===id))$('lesson').value=id;void loadLesson();

let dictionaryModule=null, dictionaryGeneration=0;
$('dictionary-lookup').onclick=async()=>{
 const word=$('dictionary-word').value.trim();if(!word||word.length>12)return;
 const token=++dictionaryGeneration;$('dictionary-result').textContent='正在讀取指定詞典…';
 try{dictionaryModule||=import('https://dict.bdfz.net/v1/c41ff5236bdbd65171a719a90c4a23593b06fc8d/src/component.mjs').catch(e=>{dictionaryModule=null;throw e;});await dictionaryModule;if(token!==dictionaryGeneration||!$('materials').open)return;
 const reader=document.createElement('student-dictionary');reader.setAttribute('presentation','embedded');reader.setAttribute('endpoint','https://dict.bdfz.net/api/v1/read');reader.setAttribute('link-sources','zi');$('dictionary-result').replaceChildren(reader);await reader.lookup(word,{source:'xc'});
 }catch{if(token===dictionaryGeneration)$('dictionary-result').textContent='詞條或原書頁尚未可靠取得，這項解釋待核查；請使用原站核對。';}
};
$('materials').addEventListener('close',()=>{dictionaryGeneration++;$('dictionary-result').replaceChildren();});
$('plates-details').ontoggle=async()=>{if(!$('plates-details').open||!curriculum)return;const gen=generation;$('plates').textContent='正在讀取教材原圖索引…';try{const [{lessonPlates},response]=await Promise.all([import('./textbook-pages.js'),fetch('/data/textbook-pages.v1.json')]);if(!response.ok)throw new Error();const data=await response.json();if(gen!==generation)return;const plates=lessonPlates(data,curriculum.lessonId);$('plates').replaceChildren();for(const note of plates.notes)$('plates').append(node('p',note));if(!plates.pages.length){$('plates').append(node('p','本課尚無已核實的對應原圖，請到原有課程查閱。'));return;}for(const page of plates.pages){const figure=node('figure'),img=document.createElement('img');img.loading='lazy';img.src=page.src;img.alt=page.label;img.style.width='100%';img.onerror=()=>{img.replaceWith(node('p','圖頁暫時無法載入；可從原有課程核對。'));};figure.append(img,node('figcaption',page.label));$('plates').append(figure);}}catch{$('plates').textContent='教材原圖索引暫時無法讀取；正文仍可閱讀。';}};

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
