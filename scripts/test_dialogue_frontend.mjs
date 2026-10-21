import {PALETTES} from '../site/assets/dialogue-palettes.js';
import {originalRange,dialogueReadingAsset} from '../site/dialogue-reading-material.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,readdirSync} from 'node:fs';
import vm from 'node:vm';
import {parseHTML} from 'linkedom';
import {LIMITS,projectState} from '../site/dialogue-policy.js';
import {learningTurn} from '../site/dialogue-learning-turn.js';
import {dialogueOpening,dialogueIdentity,authorVoice} from '../site/dialogue-opening.js';
import {readDialogueEvents} from '../site/assets/dialogue-events.js';

const html=readFileSync(new URL('../site/dialogue.html',import.meta.url),'utf8');
const script=readFileSync(new URL('../site/assets/dialogue.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function task(inputKind='text',id='task-one'){
 return {taskId:id,objectiveId:'source-objective',kind:inputKind==='choice'?'vocabulary':inputKind==='rating'?'evaluation':'formal',inputKind,prompt:'說說這一句如何照應前文。',...(inputKind==='choice'?{options:['第一個選項','第二個選項']}: {})};
}
async function fixture({inputKind='text',hash='#lesson-189',post,get,logout,initial={},curriculumOverrides={},storage=new Map(),conversation=false,firstReading,beforeReady}={}){
 const {window,document}=parseHTML(html),calls=[],timers=new Map(),downloads=[];let timer=0;
 document.body.dataset.dialogueFlow=conversation?'conversation':'structured';
 window.Element.prototype.scrollIntoView=()=>{};
 const createElement=document.createElement.bind(document);document.createElement=(name,...args)=>{const element=createElement(name,...args);if(name==='dialog'){element.showModal=()=>{element.open=true;};element.close=()=>{element.open=false;};}return element;};
 window.localStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)};
 window.sessionStorage={getItem:()=>null,removeItem:()=>{}};
 class FixtureURL extends URL{static createObjectURL(blob){downloads.push(blob);return 'blob:fixture';}static revokeObjectURL(){}}
 const lessons=Array.from({length:189},(_,i)=>({lessonId:`lesson-${i+1}`,title:`篇目 ${i+1}`,blockId:i<90?'a':'b',blockTitle:i<90?'上冊':'下冊',status:'source-ready'}));
 const curriculum={lessonId:'lesson-189',title:'篇目 189',author:'作者',source:'https://example.test/source',mode:'modern',curriculumVersion:'v1',passages:[{id:'lesson-189:p1',text:'原文的一句話。',block:{runs:[{text:'原文的一句話。'}]}}],annotations:[],objectives:[],vocabulary:[],resources:[],...curriculumOverrides};
 let data={ownerRef:'owner-a',revision:0,turns:[],state:{next:null,objectives:[],completion:'in_progress'},learningTurn:task(inputKind),sourceSubmissions:[],readingGate:null,...initial};
 for(const dialog of document.querySelectorAll('dialog')){dialog.close=()=>{dialog.open=false;};dialog.showModal=()=>{dialog.open=true;};}
 const picker=document.getElementById('lesson');let selected='';Object.defineProperty(picker,'value',{get:()=>selected,set:value=>{selected=value;}});
 for(const element of document.querySelectorAll('*'))element.scrollIntoView=()=>{};
 const fetch=async(url,options={})=>{
  calls.push({url,options});
  if(url==='https://my.bdfz.net/api/logout')return logout?logout():Response.json({ok:true});
  if(url==='/dialogue-curriculum/index.json')return Response.json({schemaVersion:1,lessons});
  if(url.startsWith('/dialogue-curriculum/'))return Response.json({...curriculum,lessonId:url.split('/').at(-1).replace('.json','')});
  if(options.method==='POST'){
   const body=JSON.parse(options.body);if(post)return post(body,{data,setData:value=>{data=value;}});
   data={...data,revision:data.revision+1,turns:[...data.turns,{id:'saved-turn',role:'student',content:body.content,mutationId:body.mutationId,createdAt:'2026-10-13T00:00:00Z'}]};
  }
  const result=get?get(url,data):data;return result instanceof Response?result:Response.json(result);
 };
 const context=vm.createContext({PALETTES,originalRange,dialogueReadingAsset,window,document,fetch,URLSearchParams,URL:FixtureURL,Response,AbortController,AbortSignal,Blob,crypto,location:{hash},authorVoice,history:{state:null,replaceState(_state,_title,url){context.location.hash=url;}},performance:{mark(){}},queueMicrotask,setTimeout:(cb,delay)=>{timers.set(++timer,{cb,delay});return timer;},clearTimeout:id=>timers.delete(id),dialogueOpening,dialogueIdentity,readDialogueEvents,readBrowserHistory:()=>({status:'not_found'}),openFirstReading:firstReading||(()=>({dispose(){}})),localStorage:{},getSelection:()=>null});
 vm.runInContext(document.getElementById('dialogue-initial-load').textContent,context);
 vm.runInContext(script+'\nglobalThis.frontend={setAutoFollow(v){autoFollow=v;},isFollowing(){return autoFollow;},renderPartial,acknowledgeObjectives,setStatus,displayWorkTitle,renderPlates,materialText,update,refresh,refreshReadingMarks,clearPrivateView,view,renderSourceResults,renderOriginalMaterials,quotePassage,revealTurn,renderCurriculum(value){curriculum=value;snapshot={...snapshot,readingGate:{phase:"close_reading"}};renderText();},get pending(){return pending;},get composerDraft(){return composerDraft;},get snapshot(){return snapshot;}};',context);
 beforeReady?.(document,window);
 for(let i=0;i<8&&!calls.some(c=>c.url.startsWith('/api/'));i++)await tick();await tick();
 return {document,window,calls,timers,downloads,frontend:context.frontend,context,setData:value=>{data=value;},get data(){return data;},get posts(){return calls.filter(c=>c.options.method==='POST').map(c=>JSON.parse(c.options.body));},answer(value){document.getElementById('answer').value=value;document.getElementById('answer').oninput();},send:()=>document.getElementById('compose').onsubmit({preventDefault(){}})};
}

test('loads all 189 indexed lessons, groups the picker and preserves the direct lesson link without POST',async()=>{
 const f=await fixture();assert.equal(f.document.querySelectorAll('#lesson option').length,189);assert.equal(f.document.querySelectorAll('#lesson optgroup').length,2);assert.equal(f.document.getElementById('lesson').value,'lesson-189');assert.equal(f.posts.length,0);assert.match(f.document.getElementById('next').textContent,/說說這一句/);
 assert.equal(f.document.querySelectorAll('#source-draft button').length,0);assert.equal(f.document.querySelectorAll('#next button').length,0);
});

test('one Send uses the exact server task and raw answer without client scoring fields',async()=>{
 const f=await fixture();f.answer('我認為前後的意象形成呼應。');await f.send();
 assert.equal(f.posts.length,1);assert.equal(f.posts[0].taskId,'task-one');assert.equal(f.posts[0].content,'我認為前後的意象形成呼應。');assert.equal(f.posts[0].ownerRef,'owner-a');assert.equal(f.posts[0].revision,0);
 for(const key of ['score','correctness','formal','objectiveId','scoringRole','eligibilityStatus'])assert.equal(key in f.posts[0],false,key);
 assert.equal(f.document.getElementById('answer').value,'');
});

test('choice and rating use the same composer, preserving original selection and zero self rating',async()=>{
 const choice=await fixture({inputKind:'choice'});choice.document.querySelectorAll('#task-input input')[1].onchange();await choice.send();
 assert.equal(choice.posts.length,1);assert.equal(choice.posts[0].selectedIndex,1);assert.equal(choice.posts[0].content,'第二個選項');assert.equal(choice.posts[0].action,undefined);
 const rating=await fixture({inputKind:'rating'}),input=rating.document.querySelector('#task-input input');input.value='0';input.oninput();await rating.send();
 assert.equal(rating.posts.length,1);assert.equal(rating.posts[0].rating,0);assert.equal(rating.posts[0].content,'');assert.equal(rating.posts[0].score,undefined);
});

test('readback and mobile view changes preserve draft and selected quote; a newer task requires explicit draft review',async()=>{
 const f=await fixture();f.frontend.quotePassage('lesson-189:p1','原文的一句話。');f.answer('仍未送出的理解');f.frontend.view('text');f.frontend.view('conversation');await f.frontend.refresh();
 assert.equal(f.document.getElementById('answer').value,'仍未送出的理解');assert.equal(f.document.getElementById('quote').textContent,'原文的一句話。');assert.equal(f.posts.length,0);
 f.setData({...f.data,learningTurn:task('text','task-two')});await f.frontend.refresh();await f.send();assert.equal(f.posts.length,0);assert.equal(f.document.getElementById('send').disabled,true);
 f.document.querySelector('#task-context button').onclick();await f.send();assert.equal(f.posts[0].taskId,'task-two');assert.match(f.posts[0].content,/仍未送出的理解/);
});

test('uncertain response reads back once without replay and keeps the same mutation for explicit resend',async()=>{
 const f=await fixture({post:()=>{throw Error('connection interrupted');}});f.answer('需要保留的原話');await f.send();assert.equal(f.posts.length,1);assert.equal(f.document.getElementById('answer').value,'需要保留的原話');
 await f.send();assert.equal(f.posts.length,2);assert.equal(f.posts[0].mutationId,f.posts[1].mutationId);assert.equal(f.posts[0].taskId,f.posts[1].taskId);
});

test('same-owner saved readback settles an interrupted response without resubmitting',async()=>{
 const f=await fixture({post:(body,{data,setData})=>{setData({...data,revision:1,turns:[{id:'saved-turn',role:'student',mutationId:body.mutationId,content:body.content,createdAt:'2026-10-13T00:00:00Z'}]});throw Error('lost acknowledgement');}});f.answer('已送達的原話');await f.send();
 assert.equal(f.posts.length,1);assert.equal(f.frontend.pending,null);assert.equal(f.document.getElementById('answer').value,'');assert.match(f.document.getElementById('turns').textContent,/已送達的原話/);
});

test('account invalidation clears raw drafts, choices, source grades and pending requests',async()=>{
 const f=await fixture({inputKind:'choice'});f.document.querySelector('#task-input input').onchange();f.answer('私人草稿');f.frontend.renderSourceResults({sourceSubmissions:[{label:'原評閱',status:'confirmed',score:82}]});
 f.frontend.update({...f.data,learningTurn:{...task('choice'),references:[{turnId:'old-private-turn',quote:'上一位使用者的私人原話'}]}});
 f.window.dispatchEvent(new f.window.Event('bdfz:session-invalidated'));assert.equal(f.document.getElementById('answer').value,'');assert.equal(f.document.getElementById('task-input').textContent,'');assert.equal(f.document.getElementById('source-results').textContent,'');assert.equal(f.frontend.composerDraft,null);assert.equal(f.posts.length,0);
 assert.doesNotMatch(f.document.getElementById('next').textContent,/私人原話/);
});

test('only confirmed numeric source grades render as scores; unknown is never zero and self rating is never a grade',async()=>{
 const f=await fixture();f.frontend.renderSourceResults({sourceSubmissions:[{label:'未確認',status:'pending',score:88},{label:'原零分',status:'confirmed',score:0},{label:'自評',status:'confirmed',score:90,scoringRole:'none'},{label:'原題',status:'confirmed',score:null,correctness:'correct'}]});
 const text=f.document.getElementById('source-results').textContent;assert.match(text,/尚未確認；尚未計分/);assert.match(text,/0 分/);assert.match(text,/自評已保存，不計入成績/);assert.match(text,/答對/);assert.doesNotMatch(text,/88 分|90 分/);
});

test('restores a server-deferred task with the original mutation and raw request, without automatic formal submission',async()=>{
 const original={taskId:'task-one',content:'原始回應，不是重新組裝的表單'};
 const f=await fixture({initial:{draft:{mutationId:'original-mutation-1234',revision:0,content:'不要改用此組裝內容',formal:{objectiveId:'source-objective',input:{reason:'另一種內容'}},learningRequest:original}}});
 assert.equal(f.posts.length,0);assert.equal(f.document.getElementById('answer').value,original.content);assert.equal(f.document.querySelectorAll('#source-draft button').length,0);
 await f.send();assert.equal(f.posts.length,1);assert.equal(f.posts[0].mutationId,'original-mutation-1234');assert.equal(f.posts[0].taskId,original.taskId);assert.equal(f.posts[0].content,original.content);assert.equal(f.posts[0].formal,undefined);
});

test('a definite validation rejection allows correction without freezing or replaying the rejected payload',async()=>{
 let n=0;const f=await fixture({post:()=>++n===1?Response.json({code:'invalid_source_input',message:'請補充完整字句'},{status:400}):Response.json({pending:false})});
 f.answer('第一份');await f.send();assert.equal(f.document.getElementById('answer').value,'第一份');assert.equal(f.frontend.pending,null);
 f.answer('補充後的完整字句');await f.send();assert.equal(f.posts.length,2);assert.notEqual(f.posts[0].mutationId,f.posts[1].mutationId);assert.equal(f.posts[1].content,'補充後的完整字句');
});

test('source unavailable blocks new submission while preserving original access and completed-history wording',async()=>{
 const f=await fixture({initial:{learningTurn:{...task(),'kind':'unavailable',inputKind:'none',prompt:'正文來源尚待核對'}},curriculumOverrides:{passages:[],sourceStatus:'source-unavailable'}});
 assert.match(f.document.getElementById('passages').textContent,/尚待核對/);assert.equal(f.document.getElementById('answer').disabled,true);f.answer('不能評分的回應');await f.send();assert.equal(f.posts.length,0);assert.equal(f.document.getElementById('legacy').getAttribute('href'),'/?view=legacy#lesson-189');
 const old=await fixture({initial:{state:{legacyCompletion:true,next:null,objectives:[],completion:'in_progress'}}});assert.match(old.document.getElementById('next').textContent,/原課已完成/);assert.match(old.document.getElementById('next').textContent,/繼續細讀由你決定/);
});

test('criteria stay understandable without rendering vocabulary answer keys, and saved rich references remain plain text',async()=>{
 const f=await fixture({curriculumOverrides:{objectives:[{id:'vocab-one',domain:'vocabulary',label:'語境字詞',rule:'秘密答案與詳細解析不應顯示'}]}});
 const criteria=f.document.getElementById('requirements').textContent;assert.match(criteria,/詞義、語境與判斷依據/);assert.doesNotMatch(criteria,/秘密答案/);
 f.frontend.renderSourceResults({sourceSubmissions:[{status:'confirmed',score:75,reference:[{type:'paragraph',runs:[{text:'原有答案：'},{text:'<script>不要執行</script>'}]}]}]});
 assert.match(f.document.getElementById('source-results').textContent,/原有答案：<script>/);assert.equal(f.document.querySelectorAll('#source-results script').length,0);
});

test('choice keeps the optional explanation and selected passage in the raw submitted turn',async()=>{
 const f=await fixture({inputKind:'choice'});f.document.querySelector('#task-input input').onchange();f.frontend.quotePassage('lesson-189:p1','原文的一句話。');f.answer('我選第一項，因為前後語境互相照應。');await f.send();
 assert.equal(f.posts[0].selectedIndex,0);assert.equal(f.posts[0].content,'[lesson-189:p1] 原文的一句話。\n\n我選第一項，因為前後語境互相照應。');
});

test('all 360 paired turns can be exported and earliest quoted evidence remains reachable with bounded reads',async()=>{
 const turns=Array.from({length:LIMITS.lessonLifetime*2},(_,i)=>({id:`record-${i+1}`,sequence:i+1,role:i%2?'teacher':'student',content:`保存的原話 ${i+1}`,createdAt:'2026-10-13T00:00:00Z'}));
 const f=await fixture({get:(url,data)=>{const before=Number(new URL(url,'https://example.test').searchParams.get('beforeSeq'))||turns.length+1,page=turns.filter(t=>t.sequence<before).slice(-LIMITS.historyPage);return {...data,turns:page,older:page[0]?.sequence>1?{sequence:page[0].sequence}:null};}});
 await f.frontend.revealTurn('record-1');assert.match(f.document.getElementById('turn-record-1').textContent,/保存的原話 1/);assert.equal(f.document.querySelectorAll('#turns .turn').length,turns.length);
 const before=f.calls.length;await f.document.getElementById('export').onclick();assert.equal(f.downloads.length,1);const record=JSON.parse(await f.downloads[0].text());assert.equal(record.turns.length,turns.length);assert.equal(record.turns[0].id,'record-1');assert.equal(record.turns.at(-1).id,turns.at(-1).id);assert.ok(f.calls.length-before<=Math.ceil(turns.length/LIMITS.historyPage)+1);assert.equal(f.posts.length,0);
});

test('all189 actual curricula keep every source-role material and original media or resource URL accessible on demand',async()=>{
 const f=await fixture(),root=new URL('../site/dialogue-curriculum/',import.meta.url),files=readdirSync(root).filter(name=>/^lesson-.*\.json$/.test(name));assert.equal(files.length,189);
 const counts={annotation:0,'image-caption':0,'reference-metadata':0,'reference-title':0,media:0,resources:0};
 for(const file of files){
  const curriculum=JSON.parse(readFileSync(new URL(file,root),'utf8'));f.frontend.renderCurriculum(curriculum);
  const panel=f.document.getElementById('references'),links=new Set([...panel.querySelectorAll('a')].map(a=>new URL(a.getAttribute('href')).href));
  for(const material of curriculum.readingMaterials||[]){const rendered=f.document.getElementById(material.id);assert.ok(rendered&&panel.contains(rendered),`${file} ${material.id}`);assert.equal(rendered.dataset.sourceRole,material.role);assert.ok(rendered.textContent.includes(material.text),`${file} material text preserved`);assert.equal(f.document.getElementById('passages').contains(rendered),false);if(material.role in counts)counts[material.role]++;}
  for(const item of curriculum.media||[]){const url=new URL(item.sourceUrl||item.finalUrl);assert.ok(links.has(url.href),`${file} media ${item.id}`);counts.media++;}
  for(const item of curriculum.resources||[]){const href=item.href||item.sourceUrl;let url;try{url=new URL(href);}catch{continue;}if(!['http:','https:'].includes(url.protocol))continue;assert.ok(links.has(url.href),`${file} resource ${item.kind}`);counts.resources++;}
 }
 assert.ok(counts.annotation>=9);assert.ok(counts['image-caption']>=19);assert.ok(counts['reference-metadata']>=24);assert.ok(counts['reference-title']>=1);assert.ok(counts.media>=159);assert.ok(counts.resources>=602);assert.equal(f.posts.length,0);
});

test('exact owner-approved supplementary lesson displays passed without a score, while ordinary missing source remains blocked',async()=>{
 const base={lessonId:'lesson-1572',curriculumVersion:'fixture-supplement',passages:[],objectives:[],vocabulary:[],mode:'modern',sourceStatus:'source-unavailable'};
 const exemption={kind:'owner-approved-supplement',lessonId:'lesson-1572',authority:'direct-suen-instruction-01a132c3',scoringRole:'none',reason:'此篇為課程擁有者補充，依明確決定視為通過。',approvedAt:'2026-10-13T01:41:15Z'};
 const curriculum={...base,completionExemption:exemption},state=projectState(curriculum,[]),next=learningTurn(curriculum,state),f=await fixture({initial:{state,learningTurn:next},curriculumOverrides:curriculum});
 assert.match(f.document.getElementById('lesson-outcome').textContent,/已通過（補充篇目）/);assert.match(f.document.getElementById('lesson-outcome').textContent,/不新增分數/);assert.equal(f.document.getElementById('send').disabled,true);assert.equal(f.document.getElementById('source-results').textContent,'');assert.equal(state.completionExemption.scoringRole,'none');assert.equal(curriculum.sourceStatus,'source-unavailable');
 const other={...curriculum,lessonId:'lesson-other'},otherState=projectState(other,[]),blocked=await fixture({initial:{state:otherState,learningTurn:learningTurn(other,otherState)},curriculumOverrides:other});assert.equal(otherState.completion,'in_progress');assert.equal(blocked.document.getElementById('lesson-outcome').textContent,'');assert.equal(blocked.document.getElementById('send').disabled,true);
});


test('source receipts stay in the drawer while the conversation has one teacher and discreet save status',async()=>{
 const f=await fixture({initial:{turns:[{id:'source-receipt',role:'teacher',model:'source-owned',content:'已保存你的閱讀確認。繼續說說…',createdAt:'2026-10-13T00:00:00Z'},{id:'teacher-one',role:'teacher',model:'gemini-3.6-flash',content:'這句話讓你想到什麼？',createdAt:'2026-10-13T00:00:01Z'}]}});
 assert.doesNotMatch(f.document.getElementById('turns').textContent,/原題紀錄|已保存你的閱讀確認|查看／補充更正/);
 assert.match(f.document.getElementById('turns').textContent,/作者/);
 assert.match(f.document.getElementById('turn-review-list').textContent,/已保存你的閱讀確認/);
 assert.equal(f.document.querySelectorAll('#turn-review-list button').length,2);
 f.frontend.renderSourceResults({sourceSubmissions:[{status:'confirmed',score:83}]});
 assert.equal(f.document.getElementById('record-receipt').textContent,'已保存');
 assert.equal(f.document.querySelectorAll('#record-receipt button').length,0);
 await f.frontend.revealTurn('source-receipt');assert.equal(f.document.getElementById('materials').open,true);
 f.window.dispatchEvent(new f.window.Event('bdfz:session-invalidated'));assert.equal(f.document.getElementById('turn-review-list').textContent,'');
});

test('partial readback offers explicit continuation and preserves its mutation on uncertain delivery',async()=>{
 const partial={turnId:'student-one',content:'已保留的開頭',digest:'a'.repeat(64),status:'unconfirmed',continuation:{allowed:true}};
 const f=await fixture({initial:{revision:3,partial},post:()=>{throw Error('connection interrupted');}});
 assert.equal(f.posts.length,0);assert.equal(f.document.querySelector('#partial-reply button').textContent,'續答');
 f.answer('尚未送出的下一個問題');
 await f.document.querySelector('#partial-reply button').onclick();
 assert.equal(f.posts.length,1);const first=f.posts[0];
 assert.equal(first.action,'continue');assert.equal(first.turnId,partial.turnId);assert.equal(first.partialDigest,partial.digest);assert.equal(first.revision,3);assert.equal(first.ownerRef,'owner-a');assert.equal(first.content,undefined);
 assert.match(f.calls.find(c=>c.options.method==='POST').options.headers.accept,/text\/event-stream/);
 assert.equal(f.document.getElementById('answer').value,'尚未送出的下一個問題');
 assert.match(f.document.getElementById('partial-reply').textContent,/已保留的開頭/);
 await f.document.querySelector('#partial-reply button').onclick();
 assert.equal(f.posts.length,2);assert.equal(f.posts[1].mutationId,first.mutationId);
 f.setData({...f.data,partial:{...partial,continuation:{allowed:false}}});await f.frontend.refresh();
 assert.equal(f.document.querySelector('#partial-reply button'),null);
 f.window.dispatchEvent(new f.window.Event('bdfz:session-invalidated'));assert.equal(f.document.getElementById('partial-reply'),null);
});

test('continuation SSE appends the teacher reply without duplicating the student turn or clearing a new draft',async()=>{
 const partial={turnId:'student-one',content:'先看這一句，',digest:'b'.repeat(64),status:'unconfirmed',continuation:{allowed:true}};
 const student={id:'student-one',role:'student',content:'我的原答案',createdAt:'2026-10-13T00:00:00Z'};
 const f=await fixture({initial:{revision:1,partial,turns:[student]},post:(body,{data,setData})=>{
  setData({...data,revision:2,partial:null,turns:[student,{id:'teacher-one',role:'teacher',content:partial.content+'它如何照應前文？',createdAt:'2026-10-13T00:00:01Z'}]});
  const frame=(event,value)=>`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`;
  return new Response(frame('saved',{saved:true,continuation:true,turnId:partial.turnId,mutationId:body.mutationId,revision:2})+frame('delta',{turnId:partial.turnId,text:'它如何照應前文？'})+frame('done',{turnId:partial.turnId}),{headers:{'content-type':'text/event-stream'}});
 }});
 f.answer('我另外想到的問題');await f.document.querySelector('#partial-reply button').onclick();
 assert.equal(f.posts.length,1);assert.equal(f.document.querySelectorAll('#turns .student').length,1);
 assert.match(f.document.getElementById('turns').textContent,/我的原答案/);assert.match(f.document.getElementById('turns').textContent,/先看這一句，它如何照應前文？/);
 assert.equal(f.document.getElementById('answer').value,'我另外想到的問題');assert.equal(f.document.getElementById('partial-reply'),null);
});


test('unsent draft survives reload only for the confirmed owner and matching lesson',async()=>{
 const storage=new Map();const first=await fixture({storage});first.answer('重新整理仍須保留的私密草稿');
 const other=await fixture({storage,initial:{ownerRef:'owner-b'}});assert.equal(other.document.getElementById('answer').value,'');
 const restored=await fixture({storage});assert.equal(restored.document.getElementById('answer').value,'重新整理仍須保留的私密草稿');assert.equal(restored.posts.length,0);
 await restored.send();const again=await fixture({storage});assert.equal(again.document.getElementById('answer').value,'');
});

test('uncertain request survives reload with the same mutation and does not auto replay',async()=>{
 const storage=new Map();const first=await fixture({storage,post:()=>{throw Error('offline');}});first.answer('原始待確認作答');await first.send();
 const restored=await fixture({storage});assert.equal(restored.posts.length,0);await restored.send();assert.equal(restored.posts[0].mutationId,first.posts[0].mutationId);
});

test('search covers the whole catalogue without AI calls and handles no result',async()=>{
 const f=await fixture();f.document.getElementById('lesson-search').oninput();assert.equal(f.document.querySelectorAll('#catalog-results button').length,189);
 f.document.getElementById('lesson-search').value='篇目 189';f.document.getElementById('lesson-search').oninput();assert.equal(f.document.querySelectorAll('#catalog-results button').length,1);
 f.document.getElementById('lesson-search').value='不存在';f.document.getElementById('lesson-search').oninput();assert.match(f.document.getElementById('catalog-results').textContent,/沒有找到/);assert.equal(f.posts.length,0);
});

test('conversation mode never turns an ordinary greeting into a form field or choice',async()=>{
 const f=await fixture({conversation:true,inputKind:'choice'});assert.equal(f.document.querySelectorAll('#task-input input').length,0);
 f.answer('你好，我想先聊聊我不理解的地方。');await f.send();assert.equal(f.posts[0].conversation,true);assert.equal(f.posts[0].selectedIndex,undefined);assert.equal(f.posts[0].content,'你好，我想先聊聊我不理解的地方。');
});
test('classical initial reading stays conversational and unpunctuated and merged annotated source views remain available',async()=>{
 const f=await fixture({conversation:true,curriculumOverrides:{mode:'classical'},initial:{learningTurn:null,readingGate:{phase:'initial_reading'}}});
 assert.equal(f.document.getElementById('answer').disabled,false);assert.equal(f.document.querySelectorAll('#first-reading form').length,0);
 for(const id of ['version-unpunctuated','version-annotated'])assert.ok(f.document.getElementById(id));
 assert.equal(f.document.getElementById('version-unpunctuated').hidden,false);
 f.answer('我想先試著斷句，可以嗎？');await f.send();assert.equal(f.posts[0].conversation,true);assert.match(f.posts[0].taskId,/reading-conversation$/);
});

for(const mode of ['modern','poetry'])test(mode+' keeps punctuation and annotations without an unpunctuated option',async()=>{
 const f=await fixture({conversation:true,curriculumOverrides:{mode}});
 const unpunctuated=f.document.getElementById('version-unpunctuated');
 assert.equal(unpunctuated.hidden,true);
 unpunctuated.onclick();
 assert.equal(f.document.getElementById('first-reading').hidden,true);
 assert.equal(f.document.getElementById('passages').hidden,false);
 for(const version of ['annotated']){
  f.document.getElementById('version-'+version).onclick();
  assert.equal(f.document.getElementById('version-'+version).getAttribute('aria-pressed'),'true');
  assert.equal(unpunctuated.hidden,true);
 }
});


test('poem red marks retain source punctuation, survive view switches and clear on account exit',async()=>{
 const text='山，光！𠮷水。',passages=[{id:'lesson-189:p1',text,block:{runs:[{text:'山，光！'},{text:'𠮷水。'}]}}];
 const asset=await dialogueReadingAsset({lessonId:'lesson-189',passages});
 const mark={markId:'poem-mark',paragraphKey:'lesson-189:p1',startOffset:1,endOffset:4,selectedText:'光𠮷',guess:'最初理解',correction:'後來的訂正'};
 let notes={...asset,marks:[mark]};
 const f=await fixture({conversation:true,curriculumOverrides:{mode:'poetry',passages},get:(url,data)=>url.includes('firstReadingState')?notes:data});
 await f.frontend.refreshReadingMarks();
 const p=f.document.getElementById('lesson-189:p1'),labels=[...p.querySelectorAll('[data-reading-mark]')];
 assert.equal(labels.map(n=>n.textContent).join(''),'光！𠮷');assert(labels.every(n=>n.title.includes('最初理解')&&n.title.includes('後來的訂正')));
 labels[0].onclick();assert.equal(f.document.getElementById('quote').textContent,'光！𠮷');
 f.document.getElementById('version-annotated').onclick();assert.equal([...f.document.querySelectorAll('[data-reading-mark]')].map(n=>n.textContent).join(''),'光！𠮷');
 f.frontend.clearPrivateView();assert.equal(f.document.querySelectorAll('[data-reading-mark]').length,0);assert(p.textContent.includes(text));
 notes={...notes,textDigest:'different-source'};f.frontend.update(f.data);await f.frontend.refreshReadingMarks();assert.equal(f.document.querySelectorAll('[data-reading-mark]').length,0);
});

 test('author introduces themselves before input without changing saved turns',async()=>{
 const f=await fixture({conversation:true,curriculumOverrides:{author:'朱自清',title:'荷塘月色',persona:{kind:'author-simulation'}}});
 assert.equal(f.document.getElementById('conversation-title'),null);assert.equal(f.document.getElementById('author').textContent,'朱自清');
 assert.match(f.document.getElementById('next').textContent,/我是朱自清/);
 assert.equal(f.posts.length,0);assert.equal(f.data.turns.length,0);
 assert.doesNotMatch(f.document.querySelector('.conversation').textContent,/尚未開始對話|選取原文，即可帶入對話|AI 教學模擬|回應會保存，評閱沿用原有判準/);
});
 test('foreign author introductions contain original language and Chinese without invented biography',()=>{
 const intro=dialogueOpening({author:'海明威',title:'老人與海',persona:{kind:'author-simulation'}});
 assert.match(intro.content,/I’m Ernest Hemingway/);assert.match(intro.content,/我是海明威/);
 const guide=dialogueOpening({author:'教材學習引導',title:'單元導讀',persona:{kind:'curriculum-guide'}});assert.doesNotMatch(guide.content,/我是|吾乃/);
});

test('account logout clears the visible private session but retains the owner draft and server history',async()=>{
 const storage=new Map(),f=await fixture({storage,initial:{turns:[{id:'old',role:'student',content:'既有紀錄'}]}});
 f.answer('尚未送出的文字');
 await f.document.getElementById('account-logout').onclick();
 assert.equal(f.document.getElementById('account-login').hidden,false);assert.equal(f.document.getElementById('account-logout').hidden,true);
 assert.equal(f.document.getElementById('turns').textContent,'');assert.equal(f.document.getElementById('answer').value,'');assert.equal(f.document.getElementById('send').disabled,true);
 assert.equal(f.data.turns[0].content,'既有紀錄');assert([...storage.values()].some(v=>v.includes('尚未送出的文字')));
 assert.equal(f.calls.filter(c=>c.url==='https://my.bdfz.net/api/logout').length,1);
});
test('unconfirmed logout keeps the visible session and never retries',async()=>{
 const f=await fixture({logout:()=>Response.json({ok:false},{status:503})});f.answer('保留草稿');await f.document.getElementById('account-logout').onclick();
 assert.equal(f.document.getElementById('account-logout').hidden,false);assert.equal(f.document.getElementById('answer').value,'保留草稿');
 assert.match(f.document.getElementById('status').textContent,/登出尚未確認/);assert.equal(f.calls.filter(c=>c.url==='https://my.bdfz.net/api/logout').length,1);
});

test('all original lesson text, images and supplements remain available in the reading surface',async()=>{
 const f=await fixture();let posts=0,images=0;
 for(const file of readdirSync(new URL('../site/dialogue-curriculum/',import.meta.url)).filter(n=>/^lesson-.*\.json$/.test(n))){
  const c=JSON.parse(readFileSync(new URL('../site/dialogue-curriculum/'+file,import.meta.url),'utf8'));
  const source=JSON.parse(readFileSync(new URL('../site/data/lessons/'+file,import.meta.url),'utf8'));
  f.frontend.renderOriginalMaterials(source,c);const box=f.document.getElementById('original-materials');
  for(const p of source.posts||[]){
   // cooked is the original structured source; plain_text has normalized punctuation and rewritten URLs.
   let expected=p.plain_text||'';
   if(p.cooked){const template=f.document.createElement('template');template.innerHTML=p.cooked;for(const unsafe of template.content.querySelectorAll('script,style,iframe,object,embed,form,input,button,svg,math'))unsafe.remove();for(const note of template.content.querySelectorAll('.footnote-item')){const body=note.cloneNode(true);for(const back of body.querySelectorAll('.footnote-backref'))back.remove();assert(box.textContent.replace(/\s/g,'').includes(body.textContent.replace(/\s/g,'')),`${file} note ${note.id}`);}for(const item of template.content.querySelectorAll('.footnotes-list,.footnote-ref'))item.remove();expected=[...template.content.childNodes].map(n=>n.textContent||'').join('');}
   const body=box.cloneNode(true);for(const note of body.querySelectorAll('.inline-note,.annotation-toggle'))note.remove();if(expected)assert(body.textContent.replace(/\s/g,'').includes(expected.replace(/\s/g,'')),`${file} post ${p.post_number}`);posts++;
  }
  const urls=new Set([...box.querySelectorAll('img')].map(n=>n.getAttribute('src')));
  for(const item of source.forumImages||[]){if(/^https?:\/\//.test(item.src)&&/\.(png|jpe?g|webp|gif|avif)([?#]|$)/i.test(item.src)){assert(urls.has(item.src),`${file} ${item.src}`);images++;}}
  for(const item of c.studyGuide||[])if(item.prompt)assert(box.textContent.includes(item.prompt),`${file} study guide`);
 }
 assert(posts>189);assert(images>100);
});

test('traditional Analects voices leave source authorship unchanged and remove UI AI labels',async()=>{
 const c={title:'《论语》十二章',author:'原作未署個人作者',persona:{kind:'source-guide'}};
 const f=await fixture({conversation:true,curriculumOverrides:c});
 assert.equal(f.document.getElementById('conversation-title'),null);assert.equal(f.document.getElementById('author').textContent,'孔子及孔門弟子');
 assert.match(f.document.getElementById('next').textContent,/孔子：吾名丘/);
 assert.doesNotMatch(f.document.querySelector('.conversation').textContent,/AI 模擬|原作未署個人作者/);
 assert.equal(c.author,'原作未署個人作者');assert.match(f.document.querySelector('.author-avatar img').getAttribute('src'),/kongzi\.webp/);
 f.document.getElementById('catalog-toggle').onclick();assert.equal(f.document.getElementById('catalog').hidden,true);
 f.document.getElementById('catalog-toggle').onclick();assert.equal(f.document.getElementById('catalog').hidden,false);
 assert(f.document.querySelector('.composer-box').contains(f.document.getElementById('send')));
});

test('all registered palettes keep every reading surface legible',()=>{
 const luminance=hex=>{const c=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4);return c[0]*.2126+c[1]*.7152+c[2]*.0722;};
 const contrast=(a,b)=>{const values=[luminance(a),luminance(b)].sort((x,y)=>x-y);return (values[1]+.05)/(values[0]+.05);};
 assert.equal(PALETTES.length,17);
 for(const p of PALETTES)for(const bg of ['background','surface','commentSurface','wash']){
  assert(contrast(p.text,p[bg])>=7,`${p.id} body/${bg}`);
  for(const ink of ['textMuted','link'])assert(contrast(p[ink],p[bg])>=4.5,`${p.id} ${ink}/${bg}`);
 }
});

test('notes default closed, close on outside click, and explicit expand-all survives outside clicks',async()=>{
 const f=await fixture({curriculumOverrides:{passages:[{id:'lesson-189:p1',text:'原文。',block:{runs:[{text:'原文'},{type:'annotation-ref',noteId:'n',label:'1'},{text:'。'}]}}],annotations:[{noteId:'n',blocks:[{runs:[{text:'字義。'}]}]}]}});
 const note=f.document.querySelector('.inline-note'),ref=f.document.querySelector('.annotation-toggle');assert.equal(note.hidden,true);ref.onclick();assert.equal(note.hidden,false);
 f.document.getElementById('title').dispatchEvent(new f.window.Event('click',{bubbles:true}));assert.equal(note.hidden,true);
 f.document.getElementById('notes-toggle').onclick();assert.equal(note.hidden,false);f.document.getElementById('title').dispatchEvent(new f.window.Event('click',{bubbles:true}));assert.equal(note.hidden,false);
 f.document.getElementById('notes-toggle').onclick();assert.equal(note.hidden,true);
 const menu=f.document.querySelector('.appearance');menu.open=true;f.document.getElementById('title').dispatchEvent(new f.window.Event('click',{bubbles:true}));assert.equal(menu.open,false);
});
test('material categories use one direct selection and retain full source text',async()=>{
 const f=await fixture();f.frontend.renderOriginalMaterials({posts:[{post_number:1,plain_text:'原有資料全文'}],forumImages:[{src:'https://example.test/p.jpg'}]}, {resources:[],media:[],studyGuide:[{prompt:'學案題目',referenceAnswer:'原答案'}]});
 const tabs=[...f.document.querySelectorAll('.material-tabs button')];assert(tabs.some(b=>b.textContent==='圖片影音'));tabs.find(b=>b.textContent==='圖片影音').onclick();
 assert.equal(f.document.getElementById('material-media').hidden,false);assert.equal(f.document.getElementById('material-extra').hidden,true);assert.match(f.document.getElementById('original-materials').textContent,/原有資料全文/);
});

test('exported material keeps paragraphs, quotes, lists and tables without executable HTML',async()=>{
 const f=await fixture(),content=f.frontend.materialText('', '<h2>閱讀題</h2><p>第一段<br>續行</p><blockquote><p>引文</p></blockquote><ol start="3"><li>問題</li></ol><table><tr><th>人物</th><td>項羽</td></tr></table><script>bad()</script><img src="https://example.test/a.png" onerror="bad()"><a href="javascript:bad()">危險連結</a>');
 assert.equal(content.querySelectorAll('p').length,2);assert(content.querySelector('br'));assert(content.querySelector('blockquote'));assert.equal(content.querySelector('ol').getAttribute('start'),'3');assert(content.querySelector('.table-scroll table'));
 assert.equal(content.querySelector('script'),null);assert.equal(content.querySelector('[onerror]'),null);assert.equal(content.querySelector('a').getAttribute('href'),null);
 const source=JSON.parse(readFileSync(new URL('../site/data/lessons/lesson-1728.json',import.meta.url),'utf8'));
 f.frontend.renderOriginalMaterials(source,{resources:[]});const extra=f.document.getElementById('material-extra');assert(extra.querySelectorAll('p').length>=102,'Hongmenyan original paragraphs');assert.equal(extra.querySelectorAll('br').length,7,'Hongmenyan original line breaks');assert.equal(extra.querySelectorAll('.inline-note').length,89);assert.equal(extra.querySelectorAll('.annotation-toggle').length,89);assert.equal(extra.querySelector('ol'),null);const note=extra.querySelector('.inline-note'),ref=extra.querySelector('.annotation-toggle');assert.equal(note.hidden,true);ref.onclick();assert.equal(note.hidden,false);assert.equal(ref.nextElementSibling,note);f.document.getElementById('title').dispatchEvent(new f.window.Event('click',{bubbles:true}));assert.equal(note.hidden,true);
});

test('textbook reader reaches every lesson page with bottom controls, keyboard and swipe',async()=>{
 const f=await fixture(),box=f.document.createElement('div');f.document.body.append(box);
 const pages=Array.from({length:5},(_,i)=>({label:`第 ${i+13} 頁`,src:`https://sun.bdfz.net/registered/${i}.webp`}));
 f.frontend.renderPlates(box,{notes:[],pages});const reader=box.querySelector('.plate-reader'),stage=box.querySelector('.plate-stage'),bar=box.querySelector('.plate-toolbar'),[previous,next]=bar.querySelectorAll('button'),choice=bar.querySelector('select');
 assert.equal(reader.lastElementChild,bar);assert.equal(choice.children.length,5);assert.equal(previous.disabled,true);
 for(let i=1;i<5;i++){next.onclick();assert.equal(stage.querySelector('img').getAttribute('src'),pages[i].src);assert.equal(stage.querySelectorAll('img').length,1);}assert.equal(next.disabled,true);
 reader.onkeydown({key:'Home',target:stage,preventDefault(){}});assert.equal(stage.querySelector('img').alt,pages[0].label);
 stage.onpointerdown({clientX:150,clientY:100});stage.onpointerup({clientX:50,clientY:105});assert.equal(stage.querySelector('img').alt,pages[1].label);
 stage.onpointerdown({clientX:150,clientY:100});stage.onpointerup({clientX:140,clientY:220});assert.equal(stage.querySelector('img').alt,pages[1].label,'vertical scroll does not turn page');
 stage.querySelector('img').onerror();assert.match(stage.textContent,/暫時無法載入/);previous.onclick();assert.equal(stage.querySelector('img').alt,pages[0].label,'failed image does not block navigation');
 stage.onclick();assert(f.document.querySelector('.plate-fullscreen'));assert.equal(stage.querySelector('img').alt,pages[0].label);stage.onclick();assert.equal(f.document.querySelector('.plate-fullscreen'),null);assert.equal(box.querySelector('.plate-reader'),reader);stage.onclick();reader.onkeydown({key:'Escape',target:stage,preventDefault(){}});assert.equal(f.document.querySelector('.plate-fullscreen'),null);stage.onclick();f.frontend.renderPlates(box,{notes:[],pages:[]});assert.equal(f.document.querySelector('.plate-fullscreen'),null);assert.equal(box.querySelector('.plate-toolbar'),null);
});

test('image references display together in source order and share one navigable fullscreen reader',async()=>{
 const f=await fixture(),urls=['https://example.test/one.jpg','https://example.test/two.png?original=1','https://example.test/opaque'];
 f.frontend.renderOriginalMaterials({posts:[{links:[{href:urls[0],text:'第一張'},{href:urls[1],text:'第二張'},{href:urls[0],text:'重複連結'},{href:'https://example.test/reading.pdf',text:'參考PDF'}]}],forumImages:[{src:urls[2]}]}, {resources:[{href:urls[2],label:'第三張'}]});
 const panel=f.document.getElementById('material-links'),gallery=f.document.getElementById('material-media').querySelector('.reference-gallery'),images=gallery.querySelector('.reference-images');
 assert.deepEqual([...images.querySelectorAll('img')].map(img=>img.getAttribute('src')),urls);assert.equal(images.dataset.layout,'continuous');assert([...images.querySelectorAll('img')].every(img=>img.loading==='lazy'));assert.match(panel.querySelector('.resource-row').textContent,/參考PDF/);
 const buttons=gallery.querySelectorAll('.reference-gallery-toolbar button');buttons[1].onclick();assert.equal(images.dataset.layout,'overview');buttons[0].onclick();assert.equal(images.dataset.layout,'continuous');
 images.querySelectorAll('.reference-image-open')[1].onclick();const dialog=f.document.querySelector('.plate-fullscreen'),stage=dialog.querySelector('.plate-stage');assert.equal(stage.querySelector('img').getAttribute('src'),urls[1]);dialog.querySelector('.plate-reader').onkeydown({key:'ArrowRight',target:stage,preventDefault(){}});assert.equal(stage.querySelector('img').getAttribute('src'),urls[2]);stage.onclick();assert.equal(f.document.querySelector('.plate-fullscreen'),null);assert.equal(f.document.querySelector('.reference-viewer-host'),null);
 const source=JSON.parse(readFileSync(new URL('../site/data/lessons/lesson-1458.json',import.meta.url),'utf8')),c=JSON.parse(readFileSync(new URL('../site/dialogue-curriculum/lesson-1458.json',import.meta.url),'utf8'));
 f.frontend.renderOriginalMaterials(source,c);const actual=[...f.document.querySelectorAll('#material-media .reference-images img')].map(img=>img.getAttribute('src'));
 const expected=[...new Set((source.posts||[]).flatMap(post=>[...(post.links||[]),...(post.attachments||[])]).map(item=>typeof item==='string'?item:item.href||item.url||item.src).filter(url=>/\.(?:png|jpe?g|webp|gif|avif)(?:[?#]|$)/i.test(url)))];assert.equal(expected.length,69);for(const url of expected)assert(actual.includes(url),url);
});

test('every lesson keeps media and reference destinations disjoint without losing media',async t=>{
 const f=await fixture(),duplicates=[];let lessons=0,mediaCount=0;
 const href=value=>{try{return new URL(value).href;}catch{return null;}};
 for(const file of readdirSync(new URL('../site/dialogue-curriculum/',import.meta.url)).filter(n=>/^lesson-.*\.json$/.test(n))){
  const c=JSON.parse(readFileSync(new URL('../site/dialogue-curriculum/'+file,import.meta.url),'utf8')),source=JSON.parse(readFileSync(new URL('../site/data/lessons/'+file,import.meta.url),'utf8'));
  f.frontend.renderOriginalMaterials(source,c);const panel=f.document.getElementById('material-media'),references=f.document.getElementById('material-links');
  const media=[...panel.querySelectorAll('img,audio,video')].map(el=>href(el.getAttribute('src')||el.src)).filter(Boolean),destinations=new Set([...references.querySelectorAll('a[href],img[src],audio[src],video[src]')].map(el=>href(el.getAttribute('href')||el.getAttribute('src'))).filter(Boolean));
  for(const url of new Set(media))if(destinations.has(url))duplicates.push({file,url});
  assert.equal(media.length,new Set(media).size,`${file} duplicate media objects`);
  const originals=[...(c.media||[]),...(source.forumImages||[]),...(source.posts||[]).flatMap(post=>[...(post.images||[]),...(post.links||[]),...(post.attachments||[])]),...(c.resources||[])];
  for(const item of originals){const url=href(typeof item==='string'?item:item.src||item.sourceUrl||item.finalUrl||item.href||item.url);if(url&&/\.(?:png|jpe?g|webp|gif|avif|mp3|wav|m4a|ogg|mp4|webm)(?:[?#]|$)/i.test(url))assert(media.includes(url),`${file} media lost: ${url}`);}
  lessons++;mediaCount+=media.length;
 }
 t.diagnostic(JSON.stringify({lessons,mediaCount,duplicateDestinations:duplicates.length}));assert.equal(lessons,189);assert(mediaCount>0);assert.equal(duplicates.length,0,JSON.stringify({duplicateDestinations:duplicates.length,affectedLessons:new Set(duplicates.map(item=>item.file)).size,samples:duplicates.slice(0,3)}));
});


test('offline draft stays editable and reconnect reads once without replaying the pending turn',async()=>{
 let offline=false;
 const f=await fixture({conversation:true,get:(url,data)=>{if(offline)throw Error('offline');return data;},post:()=>{throw Error('offline');}});
 offline=true;f.answer('離線時的原話');await f.send();
 const mutation=f.frontend.pending.mutationId;
 assert.equal(f.document.getElementById('answer').disabled,false);
 assert.equal(f.document.getElementById('answer').value,'離線時的原話');
 const reads=()=>f.calls.filter(c=>c.url.startsWith('/api/')&&!c.url.includes('firstReadingState')&&!c.options.method).length;
 offline=false;const before=reads();f.window.dispatchEvent(new f.window.Event('online'));await tick();await tick();
 assert.equal(reads(),before+1);assert.equal(f.posts.length,1);
 assert.equal(f.frontend.pending.mutationId,mutation);assert.equal(f.document.getElementById('answer').value,'離線時的原話');
 f.window.dispatchEvent(new f.window.Event('online'));await tick();assert.equal(reads(),before+1);
});

test('reconnect settles a saved turn after lost acknowledgement without another POST',async()=>{
 let offline=false;
 const f=await fixture({conversation:true,get:(url,data)=>{if(offline)throw Error('offline');return data;},post:(body,{data,setData})=>{setData({...data,revision:1,turns:[{id:'saved-offline',role:'student',mutationId:body.mutationId,content:body.content}]});offline=true;throw Error('lost acknowledgement');}});
 f.answer('已保存的原話');await f.send();assert.ok(f.frontend.pending);
 offline=false;f.window.dispatchEvent(new f.window.Event('online'));await tick();await tick();
 assert.equal(f.posts.length,1);assert.equal(f.frontend.pending,null);assert.equal(f.document.getElementById('answer').value,'');assert.match(f.document.getElementById('turns').textContent,/已保存的原話/);
});


test('expired account disables submission and shows login without network-triggered authentication replay',async()=>{
 let expired=false;
 const f=await fixture({conversation:true,get:(url,data)=>expired?Response.json({code:'authentication_required',error:'請先登入 My。'},{status:401}):data,post:()=>{expired=true;return Response.json({code:'authentication_required',error:'請先登入 My。'},{status:401});}});
 f.answer('過期前草稿');await f.send();
 assert.equal(f.document.getElementById('answer').disabled,true);assert.equal(f.document.getElementById('send').disabled,true);assert.equal(f.document.getElementById('login').hidden,false);assert.equal(f.document.getElementById('answer').value,'');
 const before=f.calls.length;f.window.dispatchEvent(new f.window.Event('online'));await tick();assert.equal(f.calls.length,before);assert.equal(f.posts.length,1);
});


test('readback reconciles interrupted-turn status without duplicating or rewriting original text',async()=>{
 const turn={id:'status-turn',role:'student',content:'不可改寫的原話',status:'saved',createdAt:'2026-10-13T00:00:00Z'};
 const f=await fixture({conversation:true,initial:{turns:[turn]}});
 const element=f.document.getElementById('turn-status-turn');
 f.frontend.update({...f.data,turns:[{...turn,status:'needs_review'}]});
 assert.equal(element.querySelectorAll('.turn-status').length,1);assert.match(element.textContent,/回應待確認/);
 f.frontend.update({...f.data,turns:[{...turn,status:'needs_review'}]});assert.equal(element.querySelectorAll('.turn-status').length,1);
 f.frontend.update({...f.data,turns:[turn]});
 assert.equal(f.document.querySelectorAll('#turns .student').length,1);assert.equal(f.document.getElementById('turn-status-turn'),element);assert.equal(element.querySelector('.turn-status'),null);assert.equal(element.querySelector('span').textContent,turn.content);assert.equal(f.posts.length,0);
});


test('early public lesson load is reused even without an HTTP cache, before catalogue load',async()=>{
 const f=await fixture();
 assert.equal(f.calls[0].url,'/dialogue-curriculum/lesson-189.json');
 assert.equal(f.calls.filter(c=>c.url==='/dialogue-curriculum/lesson-189.json').length,1);
 assert.equal(f.document.getElementById('title').textContent,'篇目 189');
 assert.equal(f.window.ywDialogueInitialLoad,undefined);
});

test('unknown early lesson never overrides the validated catalogue selection',async()=>{
 const f=await fixture({hash:'#lesson-unknown',storage:new Map([['yw-dialogue-last-lesson','lesson-188']])});
 assert.equal(f.document.getElementById('lesson').value,'lesson-188');
 assert.equal(f.calls.filter(c=>c.url==='/dialogue-curriculum/lesson-188.json').length,1);
 assert.equal(f.posts.length,0);
});

test('malformed deep links cannot turn early loading into an arbitrary request',async()=>{
 for(const hash of ['#../../api/private','#https://outside.example/','#lesson-a?x=1','#lesson-a%2fb']){
  const f=await fixture({hash,storage:new Map()});
  assert.equal(f.calls[0].url,'/dialogue-curriculum/index.json');
  assert.equal(f.document.getElementById('lesson').value,'lesson-1');
 }
});


test('fragment navigation switches lessons once and follows browser Back/Forward destinations',async()=>{
 const f=await fixture();
 for(const id of ['lesson-188','lesson-187','lesson-188','lesson-187']){
  const before=f.calls.length;f.context.location.hash='#'+id;f.window.dispatchEvent(new f.window.Event('hashchange'));
  for(let i=0;i<8;i++)await tick();
  assert.equal(f.document.getElementById('lesson').value,id);
  assert.equal(f.calls.slice(before).filter(c=>c.url==='/dialogue-curriculum/'+id+'.json').length,1);
 }
});

test('fragment navigation preserves an unsaved draft when local storage fails',async()=>{
 const f=await fixture();f.window.localStorage.setItem=()=>{throw Error('storage unavailable');};f.answer('不能遺失的未保存作答');
 const before=f.calls.length;f.context.location.hash='#lesson-188';f.window.dispatchEvent(new f.window.Event('hashchange'));await tick();
 assert.equal(f.context.location.hash,'#lesson-189');assert.equal(f.document.getElementById('lesson').value,'lesson-189');
 assert.equal(f.document.getElementById('answer').value,'不能遺失的未保存作答');assert.equal(f.calls.length,before);
});

test('same-lesson and non-lesson anchors do not request or clear reading state',async()=>{
 const f=await fixture();const before=f.calls.length;
 for(const hash of ['#lesson-189','#reading','#lesson-unknown']){f.context.location.hash=hash;f.window.dispatchEvent(new f.window.Event('hashchange'));await tick();}
 assert.equal(f.calls.length,before);assert.equal(f.document.getElementById('lesson').value,'lesson-189');
});


test('expired authentication clears private state while rebuilding public classical reading',async()=>{
 let created=0,disposed=0;
 const f=await fixture({curriculumOverrides:{mode:'classical'},get:()=>Response.json({error:'unauthorized'},{status:401}),firstReading:({root})=>{created++;root.textContent='仍可閱讀的公開正文';return {dispose(){disposed++;root.replaceChildren();}};}});
 assert.equal(created,2);assert.equal(disposed,1);
 assert.equal(f.document.getElementById('first-reading').textContent,'仍可閱讀的公開正文');
 assert.equal(f.document.getElementById('answer').disabled,true);assert.equal(f.document.getElementById('turns').textContent,'');assert.equal(f.document.getElementById('quote').hidden,true);
 f.window.dispatchEvent(new f.window.Event('bdfz:session-invalidated'));
 assert.equal(created,3);assert.equal(disposed,2);assert.equal(f.document.getElementById('first-reading').textContent,'仍可閱讀的公開正文');
});


test('an explicit text view chosen during initial loading survives completion and later lesson changes',async()=>{
 const f=await fixture({conversation:true,beforeReady:document=>document.getElementById('text-tab').onclick()});
 assert.equal(f.document.querySelector('.workspace').dataset.view,'text');
 f.context.location.hash='#lesson-188';f.window.dispatchEvent(new f.window.Event('hashchange'));for(let i=0;i<8;i++)await tick();
 assert.equal(f.document.getElementById('lesson').value,'lesson-188');assert.equal(f.document.querySelector('.workspace').dataset.view,'text');
 f.document.getElementById('conversation-tab').onclick();assert.equal(f.document.querySelector('.workspace').dataset.view,'conversation');
});

test('conversation entry keeps its default when the learner has not chosen another pane',async()=>{
 const f=await fixture({conversation:true});assert.equal(f.document.querySelector('.workspace').dataset.view,'conversation');
});


test('heading renders exact author attribution once without changing source identity',async()=>{
 for(const [title,author,expected] of [['9 屈原列传/ 司马迁','司马迁','9 屈原列传'],['将进酒/李 白','李白','将进酒'],['* 宇宙的边疆/ 卡尔· 萨根','卡尔·萨根','* 宇宙的边疆']]){
  const source={title,author};const f=await fixture({curriculumOverrides:source});
  assert.equal(f.document.getElementById('title').textContent,expected);assert.equal(f.document.getElementById('author').textContent,author);assert.equal(source.title,title);assert.equal(source.author,author);
 }
});

test('heading preserves book attribution, non-author suffixes and unslashed work titles',async()=>{
 const f=await fixture();
 for(const [title,author] of [['兼爱/《墨子》','墨子'],['无衣/《诗经·秦风》','原作未署個人作者'],['作品/补充资料','作者'],['《论语》十二章','孔子'],['题名中的/斜线','甲'],['/作者','作者']])assert.equal(f.frontend.displayWorkTitle({title,author}),title);
});

test('progress line reports the stage with elapsed seconds and server-based coverage, never an invented percentage',async()=>{
 const objectives=[{id:'o1',label:'一',domain:'read',status:'demonstrated'},{id:'o2',label:'二',domain:'read',status:'not_yet_observed'},{id:'o3',label:'三',domain:'shangyou',status:'demonstrated'},{id:'o4',label:'四',domain:'read',status:'demonstrated',requiredForCompletion:false}];
 let release=null;
 const f=await fixture({initial:{state:{next:null,objectives,completion:'in_progress'}},post:(body,{data,setData})=>{
  setData({...data,revision:data.revision+1,turns:[...data.turns,{id:'t1',role:'student',content:body.content,createdAt:'2026-10-19T00:00:00Z'},{id:'t2',role:'teacher',content:'請再指出一處原文。',createdAt:'2026-10-19T00:00:01Z'}]});
  const frame=(event,value)=>`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`;
  return new Promise(resolve=>{release=()=>resolve(new Response(frame('saved',{saved:true,turnId:'t1',mutationId:body.mutationId,revision:data.revision+1,createdAt:'2026-10-19T00:00:00Z'})+frame('delta',{turnId:'t1',text:'請再指出一處原文。'})+frame('done',{turnId:'t1'}),{headers:{'content-type':'text/event-stream'}}));});
 }});
 const progress=f.document.getElementById('progress'),stop=f.document.getElementById('stop');
 assert.equal(progress.hidden,false);assert.match(progress.textContent,/本課目標：1／2 項已由伺服器評估確認/);assert.doesNotMatch(progress.textContent,/%|預計/);
 f.answer('我注意到原句的對照。');const sent=f.send();
 for(let i=0;i<4&&!release;i++)await tick();
 assert.equal(stop.hidden,false);assert.match(progress.textContent,/正在保存你的回應/);assert.match(progress.textContent,/已 0 秒/);
 release();await sent;
 assert.equal(stop.hidden,true);assert.match(progress.textContent,/這一輪已保存/);assert.equal(f.posts.length,1);
 const settle=[...f.timers.values()].filter(t=>t.delay===4000);assert.equal(settle.length,1);settle[0].cb();
 assert.match(progress.textContent,/本課目標：1／2 項已由伺服器評估確認/);assert.doesNotMatch(progress.textContent,/%|預計/);
});

test('stop ends only the display: one POST, an explicit status, and the readback continues without a resend',async()=>{
 let controller=null;const encoder=new TextEncoder();
 const f=await fixture({post:(body,{data,setData})=>{
  setData({...data,revision:data.revision+1,pending:true,turns:[...data.turns,{id:'t1',role:'student',content:body.content,createdAt:'2026-10-19T00:00:00Z'}]});
  const frame=(event,value)=>`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`;
  return new Response(new ReadableStream({start(c){controller=c;c.enqueue(encoder.encode(frame('saved',{saved:true,turnId:'t1',mutationId:body.mutationId,revision:data.revision+1,createdAt:'2026-10-19T00:00:00Z'})));}}),{headers:{'content-type':'text/event-stream'}});
 }});
 f.answer('我注意到原句的對照。');const sent=f.send();
 for(let i=0;i<6&&!controller;i++)await tick();
 const signal=f.calls.find(c=>c.options.method==='POST').options.signal;assert.ok(signal&&!signal.aborted);
 signal.addEventListener('abort',()=>controller.error(new DOMException('The operation was aborted.','AbortError')));
 for(let i=0;i<4&&!/回應生成中/.test(f.document.getElementById('progress').textContent);i++)await tick();
 assert.equal(f.document.getElementById('stop').hidden,false);assert.match(f.document.getElementById('progress').textContent,/回應生成中/);
 const before=f.calls.length;
 f.document.getElementById('stop').onclick();await sent;
 assert.equal(f.posts.length,1);assert.equal(f.document.getElementById('stop').hidden,true);
 assert.match(f.document.getElementById('status').textContent,/已停止顯示/);assert.match(f.document.getElementById('status').textContent,/不會重送/);
 assert.ok(f.calls.slice(before).some(c=>!c.options.method&&c.url.startsWith('/api/dialogue')));
 assert.equal(f.frontend.pending,null);assert.equal(f.frontend.snapshot.pending,true);
});

test('personal history lists every lesson of the account from the server and opens one without posting',async()=>{
 const f=await fixture({get:(url,data)=>url.includes('sessions=1')?Response.json({ownerRef:'owner-a',scope:'own-sessions-only',sessions:[{lessonId:'lesson-189',curriculumVersion:'v1',revision:4,turnCount:4,lastTurnAt:'2026-10-19T10:00:00Z'},{lessonId:'lesson-5',curriculumVersion:'v1',revision:2,turnCount:2,lastTurnAt:null}]}):data});
 await f.document.getElementById('sessions-load').onclick();
 const items=[...f.document.querySelectorAll('#sessions-list li')];assert.equal(items.length,2);
 assert.match(items[0].textContent,/篇目 189/);assert.match(items[0].textContent,/4 則/);assert.equal(items[0].querySelector('button').disabled,true);
 assert.match(items[1].textContent,/篇目 5/);assert.equal(items[1].querySelector('button').textContent,'開啟');
 const listCall=f.calls.find(c=>c.url.includes('sessions=1'));assert.ok(listCall);assert.equal(listCall.options.method,undefined);assert.equal(f.posts.length,0);
 items[1].querySelector('button').onclick();await tick();await tick();
 assert.ok(f.calls.some(c=>c.url==='/dialogue-curriculum/lesson-5.json'));assert.equal(f.context.location.hash,'lesson-5');assert.equal(f.posts.length,0);
});

test('catalogue toggle is explicit, keeps aria state and the conversation heading stays removed',async()=>{
 const f=await fixture();const toggle=f.document.getElementById('catalog-toggle'),catalog=f.document.getElementById('catalog'),shell=f.document.querySelector('.page-shell');
 assert.equal(catalog.hidden,false);
 toggle.onclick();assert.equal(catalog.hidden,true);assert.equal(toggle.getAttribute('aria-expanded'),'false');assert.ok(shell.classList.contains('catalog-hidden'));
 toggle.onclick();assert.equal(catalog.hidden,false);assert.equal(toggle.getAttribute('aria-expanded'),'true');assert.ok(!shell.classList.contains('catalog-hidden'));
 assert.equal(f.posts.length,0);assert.equal(f.document.getElementById('conversation-title'),null);assert.equal(f.document.querySelectorAll('.conversation h2').length,0);
});

test('the personal history can be copied as one list, with a visible fallback when the clipboard is unavailable',async()=>{
 const sessions=[{lessonId:'lesson-189',turnCount:4,lastTurnAt:'2026-10-19T10:00:00Z'},{lessonId:'lesson-5',turnCount:2,lastTurnAt:null}];
 const f=await fixture({get:(url,data)=>url.includes('sessions=1')?Response.json({ownerRef:'owner-a',scope:'own-sessions-only',sessions}):data});
 assert.equal(f.document.getElementById('sessions-copy').hidden,true);
 await f.document.getElementById('sessions-load').onclick();
 assert.equal(f.document.getElementById('sessions-copy').hidden,false);
 let copied=null;f.context.navigator={clipboard:{writeText:async text=>{copied=text;}}};
 await f.document.getElementById('sessions-copy').onclick();
 assert.deepEqual(copied.split('\n').map(l=>l.split('｜').slice(0,3)),[['篇目 189','4 則','2026-10-19T10:00:00Z'],['篇目 5','2 則','—']]);
 assert.match(copied,/\/dialogue#lesson-5$/m);assert.match(f.document.getElementById('sessions-status').textContent,/已複製/);
 f.context.navigator={};
 await f.document.getElementById('sessions-copy').onclick();
 assert.equal(f.document.getElementById('sessions-copy-text').textContent,copied);assert.match(f.document.getElementById('sessions-status').textContent,/手動/);
 assert.equal(f.posts.length,0);
});

test('a saved turn without any reply shows one explicit retry that re-dispatches it without a new student turn or silent retry',async()=>{
 const student={id:'student-one',role:'student',content:'我的原答案',status:'needs_review',createdAt:'2026-10-20T03:28:42Z'};
 const f=await fixture({conversation:true,initial:{revision:1,turns:[student],partial:null,replyRetry:{turnId:'student-one',allowed:true,code:'explicit_retry_available',requiresUserAction:true,remainingProviderAttempts:1,providerAttemptsUsed:2,stage:'provider_request'}},post:(body,{data,setData})=>{
  setData({...data,revision:2,replyRetry:null,turns:[student,{id:'teacher-one',role:'teacher',content:'先說說你在意的那一句吧。',createdAt:'2026-10-20T03:40:00Z'}]});
  const frame=(event,value)=>`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`;
  return new Response(frame('saved',{saved:true,continuation:true,turnId:'student-one',mutationId:body.mutationId,revision:2})+frame('delta',{turnId:'student-one',text:'先說說你在意的那一句吧。'})+frame('done',{turnId:'student-one'}),{headers:{'content-type':'text/event-stream'}});
 }});
 const box=f.document.getElementById('reply-retry');assert.ok(box);assert.match(box.textContent,/再試一次取得回應/);assert.match(box.textContent,/不會重複保存/);
 assert.equal(f.posts.length,0);
 await box.querySelector('button').onclick();
 assert.equal(f.posts.length,1);assert.deepEqual([f.posts[0].action,f.posts[0].turnId,f.posts[0].partialDigest,f.posts[0].revision],['continue','student-one','',1]);
 assert.equal(f.document.querySelectorAll('#turns .student').length,1);assert.match(f.document.getElementById('turns').textContent,/先說說你在意的那一句吧。/);
 assert.equal(f.document.getElementById('reply-retry'),null);
});

// 2026-10-20 acceptance finding: the server's originalTask of kind 'evaluation' never received a form in the conversation flow.
test('conversation flow renders only the non-scoring self-rating original task and submits it through the original action',async()=>{
 const evaluation={objectiveId:'legacy:lesson-189:evaluation',kind:'evaluation'};
 const f=await fixture({conversation:true,initial:{originalTask:evaluation},post:(body,{data,setData})=>{
  const next={...data,revision:data.revision+1,originalTask:null,statusNotice:'你的篇目自評已保存；高低都不計入成績。',turns:[...data.turns,{id:'evaluation-turn',role:'student',content:'本篇有意思程度：80%（自評，不計分）\n理由：結尾的轉折出乎意料。',mutationId:body.mutationId,createdAt:'2026-10-20T00:00:00Z'}]};
  setData(next);return Response.json(next);
 }});
 const box=f.document.getElementById('source-draft');assert.equal(box.hidden,false);assert.match(box.textContent,/你覺得這篇有意思嗎/);assert.match(box.textContent,/不計入成績/);
 // The conversation composer is untouched: no rating field or choice, same placeholder, send enabled.
 assert.equal(f.document.querySelectorAll('#task-input input').length,0);assert.equal(f.document.getElementById('answer').placeholder,'想和我談些什麼？');assert.equal(f.document.getElementById('send').disabled,false);
 const form=box.querySelector('form'),rating=form.querySelector('input[type=number]'),reason=form.querySelector('textarea');
 rating.value='80';rating.oninput();reason.value='結尾的轉折出乎意料。';reason.oninput();
 await form.onsubmit({preventDefault(){}});
 assert.equal(f.posts.length,1);assert.equal(f.posts[0].action,'original');assert.equal(f.posts[0].objectiveId,evaluation.objectiveId);assert.deepEqual(f.posts[0].input,{rating:80,reason:'結尾的轉折出乎意料。'});assert.equal(f.posts[0].revision,0);assert.equal(f.posts[0].ownerRef,'owner-a');assert.match(f.posts[0].mutationId,/^[a-f0-9-]{36}$/);
 for(const key of ['content','conversation','taskId','formal','score','scoringRole'])assert.equal(key in f.posts[0],false,key);
 assert.equal(f.document.getElementById('source-draft').hidden,true);assert.equal(f.frontend.pending,null);assert.match(f.document.getElementById('status').textContent,/自評已保存/);
 // Everything else stays inside the conversation: a vocabulary original, a pending turn, an open question or an unavailable source renders no form.
 for(const initial of [
  {originalTask:{objectiveId:'legacy:lesson-189:vocab',kind:'vocabulary',itemId:'v1',question:'原題',source:'原句',options:['甲','乙'],originalMastery:null}},
  {originalTask:evaluation,pending:true},
  {originalTask:evaluation,question:{id:'q1',objectiveId:'v1',question:'這個詞在原句裡是什麼意思？'}},
  {originalTask:evaluation,learningTurn:{taskId:'v1:0:source:unavailable',objectiveId:'source',kind:'unavailable',inputKind:'none',prompt:'本課正文來源尚待核對。'}},
 ]){const g=await fixture({conversation:true,initial});assert.equal(g.document.getElementById('source-draft').hidden,true,JSON.stringify(initial));assert.equal(g.document.querySelectorAll('#source-draft form').length,0);assert.equal(g.posts.length,0);}
 // The structured flow is unchanged: the evaluation original still renders only when no learning turn is open.
 const structured=await fixture({initial:{originalTask:evaluation,learningTurn:null}});assert.equal(structured.document.getElementById('source-draft').hidden,false);assert.equal(structured.document.querySelectorAll('#source-draft form').length,1);
});

// ---- 2026-10-21 conversation candidate (B1–B5) ----
const keyEvent=(overrides={})=>({key:'Enter',shiftKey:false,altKey:false,metaKey:false,ctrlKey:false,isComposing:false,keyCode:13,prevented:false,preventDefault(){this.prevented=true;},...overrides});

test('B3: Enter sends once; Shift+Enter keeps a newline; an IME composition and an empty composer never send; a second Enter while in flight is ignored',async()=>{
 let release=null;
 const f=await fixture({post:(body,{data,setData})=>new Promise(resolve=>{release=()=>{setData({...data,revision:data.revision+1,turns:[...data.turns,{id:'t1',role:'student',content:body.content,mutationId:body.mutationId,createdAt:'2026-10-21T00:00:00Z'}]});resolve(Response.json(data));};})});
 const answer=f.document.getElementById('answer');
 const shift=keyEvent({shiftKey:true});answer.onkeydown(shift);assert.equal(shift.prevented,false);assert.equal(f.posts.length,0);
 const empty=keyEvent();answer.onkeydown(empty);await tick();assert.equal(empty.prevented,true);assert.equal(f.posts.length,0);
 f.answer('第一句理解');
 const composing=keyEvent({isComposing:true});answer.onkeydown(composing);await tick();assert.equal(composing.prevented,false);assert.equal(f.posts.length,0);
 const ime229=keyEvent({keyCode:229});answer.onkeydown(ime229);await tick();assert.equal(f.posts.length,0);
 answer.onkeydown(keyEvent());for(let i=0;i<6&&!release;i++)await tick();
 assert.equal(f.posts.length,1);
 answer.onkeydown(keyEvent());answer.onkeydown(keyEvent({metaKey:true}));await tick();await tick();
 assert.equal(f.posts.length,1,'duplicate Enter while in flight must not send again');
 release();await tick();await tick();await tick();
 assert.equal(f.document.getElementById('send').getAttribute('aria-label'),'送出（Enter）');
});

test('B1: status messages share one compact dock; real errors keep an alert role until the next message',async()=>{
 const f=await fixture();const status=f.document.getElementById('status');
 assert.ok(status.closest('.status-dock'));assert.ok(f.document.getElementById('progress').closest('.status-dock'));
 f.frontend.setStatus('連線中斷，已讀回保存紀錄；AI 不會自動重跑。',{error:true});
 assert.equal(status.getAttribute('role'),'alert');assert.ok(status.classList.contains('status-error'));
 f.frontend.setStatus('已恢復伺服器保存的待送草稿；尚未呼叫 AI。');
 assert.equal(status.getAttribute('role'),'status');assert.equal(status.classList.contains('status-error'),false);
});

test('B2: a streamed reply is followed while the reader is at the latest position; after scrolling away a single return control appears',async()=>{
 const f=await fixture();
 f.frontend.renderPartial({turnId:'t9',content:'回應的第一段',status:'streaming'});
 assert.equal(f.document.getElementById('latest-jump'),null);
 f.frontend.setAutoFollow(false);
 f.frontend.renderPartial({turnId:'t9',content:'回應的第一段，第二段',status:'streaming'});
 const jump=f.document.getElementById('latest-jump');assert.ok(jump);assert.equal(jump.hidden,false);assert.match(jump.textContent,/回到最新/);
 jump.onclick();assert.equal(jump.hidden,true);assert.equal(f.frontend.isFollowing(),true);
 assert.equal(f.document.getElementById('partial-reply').textContent.includes('第二段'),true);
});

test('B5: objectives render in friendly groups from server statuses and a newly confirmed objective is acknowledged once; nothing is confirmed client-side',async()=>{
 const objectives=[{id:'r1',label:'讀完全文',domain:'read',status:'demonstrated'},{id:'v1',label:'「慍」',domain:'vocabulary',status:'needs_practice'},{id:'l1',label:'三詞',domain:'legacy',status:'not_yet_observed'},{id:'s1',label:'尚友',domain:'shangyou',status:'not_yet_observed'}];
 const f=await fixture({initial:{state:{next:null,objectives,completion:'in_progress'}}});
 const progress=f.document.getElementById('progress');
 assert.match(progress.textContent,/本課目標：1／3 項已由伺服器評估確認/);assert.match(progress.textContent,/先讀完全文 1／1/);assert.match(progress.textContent,/字詞 0／1（待：「慍」）/);assert.match(progress.textContent,/本課要求 0／1/);assert.doesNotMatch(progress.textContent,/尚友/);
 const status=f.document.getElementById('status');const before=status.textContent;
 f.frontend.update({...f.data,state:{...f.data.state,objectives:objectives.map(o=>o.id==='v1'?{...o,status:'reformulated'}:o)}});
 assert.equal(status.textContent,before,'a non-confirmed status change is not celebrated');
 f.frontend.update({...f.data,state:{...f.data.state,objectives:objectives.map(o=>o.id==='v1'?{...o,status:'demonstrated'}:o)}});
 assert.match(status.textContent,/太好了——「「慍」」已由伺服器評估確認。還有 1 項/);
 assert.match(progress.textContent,/本課目標：2／3 項已由伺服器評估確認/);
});

test('opening carries a source-grounded author introduction built from curriculum data',async()=>{
 const frontMatter=[{type:'quote',blocks:[{type:'paragraph',runs:[{type:'text',text:'（一九二七年七月）朱自清\n\n选自《朱自清全集》第一卷（江苏教育出版社1988年版）。'}]}]}];
 const f=await fixture({conversation:true,curriculumOverrides:{author:'朱自清',title:'荷塘月色',persona:{kind:'author-simulation'},frontMatter}});
 const next=f.document.getElementById('next').textContent;
 assert.match(next,/我是朱自清/);assert.match(next,/是教學對話，不是作者本人/);assert.match(next,/教材出處：选自《朱自清全集》第一卷/);
 assert.equal(f.document.querySelectorAll('#next .author-intro').length,1);
 const guide=await fixture({conversation:true,curriculumOverrides:{author:'教材學習引導',title:'單元導讀',persona:{kind:'curriculum-guide'}}});
 assert.equal(guide.document.querySelectorAll('#next .author-intro').length,0);
 assert.equal(guide.document.getElementById('persona-label').hidden,true);
});
