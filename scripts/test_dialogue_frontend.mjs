import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,readdirSync} from 'node:fs';
import vm from 'node:vm';
import {parseHTML} from 'linkedom';
import {LIMITS,projectState} from '../site/dialogue-policy.js';
import {learningTurn} from '../site/dialogue-learning-turn.js';
import {dialogueOpening} from '../site/dialogue-opening.js';
import {readDialogueEvents} from '../site/assets/dialogue-events.js';

const html=readFileSync(new URL('../site/dialogue.html',import.meta.url),'utf8');
const script=readFileSync(new URL('../site/assets/dialogue.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function task(inputKind='text',id='task-one'){
 return {taskId:id,objectiveId:'source-objective',kind:inputKind==='choice'?'vocabulary':inputKind==='rating'?'evaluation':'formal',inputKind,prompt:'說說這一句如何照應前文。',...(inputKind==='choice'?{options:['第一個選項','第二個選項']}: {})};
}
async function fixture({inputKind='text',hash='#lesson-189',post,get,initial={},curriculumOverrides={},storage=new Map(),conversation=false}={}){
 const {window,document}=parseHTML(html),calls=[],timers=new Map(),downloads=[];let timer=0;
 document.body.dataset.dialogueFlow=conversation?'conversation':'structured';
 window.Element.prototype.scrollIntoView=()=>{};
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
  if(url==='/dialogue-curriculum/index.json')return Response.json({schemaVersion:1,lessons});
  if(url.startsWith('/dialogue-curriculum/'))return Response.json({...curriculum,lessonId:url.split('/').at(-1).replace('.json','')});
  if(options.method==='POST'){
   const body=JSON.parse(options.body);if(post)return post(body,{data,setData:value=>{data=value;}});
   data={...data,revision:data.revision+1,turns:[...data.turns,{id:'saved-turn',role:'student',content:body.content,mutationId:body.mutationId,createdAt:'2026-10-13T00:00:00Z'}]};
  }
  return Response.json(get?get(url,data):data);
 };
 const context=vm.createContext({window,document,fetch,URLSearchParams,URL:FixtureURL,Response,AbortController,AbortSignal,Blob,crypto,location:{hash},performance:{mark(){}},queueMicrotask,setTimeout:(cb,delay)=>{timers.set(++timer,{cb,delay});return timer;},clearTimeout:id=>timers.delete(id),dialogueOpening,readDialogueEvents,readBrowserHistory:()=>({status:'not_found'}),openFirstReading:()=>({dispose(){}}),localStorage:{},getSelection:()=>null});
 vm.runInContext(script+'\nglobalThis.frontend={update,refresh,view,renderSourceResults,quotePassage,revealTurn,renderCurriculum(value){curriculum=value;snapshot={...snapshot,readingGate:{phase:"close_reading"}};renderText();},get pending(){return pending;},get composerDraft(){return composerDraft;},get snapshot(){return snapshot;}};',context);
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
 assert.match(f.document.getElementById('turns').textContent,/作者 · AI 教學模擬/);
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
 const f=await fixture();f.document.getElementById('catalog-open').onclick();assert.equal(f.document.querySelectorAll('#catalog-results button').length,189);
 f.document.getElementById('lesson-search').value='篇目 189';f.document.getElementById('lesson-search').oninput();assert.equal(f.document.querySelectorAll('#catalog-results button').length,1);
 f.document.getElementById('lesson-search').value='不存在';f.document.getElementById('lesson-search').oninput();assert.match(f.document.getElementById('catalog-results').textContent,/沒有找到/);assert.equal(f.posts.length,0);
});

test('conversation mode never turns an ordinary greeting into a form field or choice',async()=>{
 const f=await fixture({conversation:true,inputKind:'choice'});assert.equal(f.document.querySelectorAll('#task-input input').length,0);
 f.answer('你好，我想先聊聊我不理解的地方。');await f.send();assert.equal(f.posts[0].conversation,true);assert.equal(f.posts[0].selectedIndex,undefined);assert.equal(f.posts[0].content,'你好，我想先聊聊我不理解的地方。');
});
test('classical initial reading stays conversational and all three source views remain available',async()=>{
 const f=await fixture({conversation:true,curriculumOverrides:{mode:'classical'},initial:{learningTurn:null,readingGate:{phase:'initial_reading'}}});
 assert.equal(f.document.getElementById('answer').disabled,false);assert.equal(f.document.querySelectorAll('#first-reading form').length,0);
 for(const id of ['version-unpunctuated','version-punctuated','version-annotated'])assert.ok(f.document.getElementById(id));
 f.answer('我想先試著斷句，可以嗎？');await f.send();assert.equal(f.posts[0].conversation,true);assert.match(f.posts[0].taskId,/reading-conversation$/);
});
