import test from 'node:test';
import assert from 'node:assert/strict';
import {validateReadingEvidence as reading,validateOriginalEvidence as original,conversationOriginalTasks} from '../site/dialogue-reading-evidence.js';
import {validateFormalDraft} from '../site/dialogue-formal.js';
const asset={textVersionId:'v1',textDigest:'source',paragraphs:[{key:'p1',text:'學而時習之不亦說乎有朋自遠方來不亦樂乎'}]};
const context=(content,state={})=>({turns:[{id:'s1',role:'student',content}],asset,state,lessonId:'lesson',turnId:'s1'});
const evidence=quote=>({turnId:'s1',quote});
const readTask={kind:'read',objectiveId:'read'};
test('independent reading eligibility preserves historical completion and classical prerequisites',()=>{
 const curriculum={objectives:[{id:'read',domain:'read'},{id:'grade',domain:'legacy'}]};
 const state={objectives:[{id:'read',status:'not_yet_observed'}]},guide={kind:'dialogue',objectiveId:'vocabulary'};
 assert.deepEqual(conversationOriginalTasks(curriculum,state,guide),[readTask]);
 for(const patch of [{legacyCompletion:{preserved:true}},{readingGate:{phase:'initial_reading'}},{readingGate:{phase:'annotated_reading'}},{objectives:[{id:'read',status:'preserved'}]},{objectives:[{id:'read',status:'historical_review'}]},{objectives:[]}]){
  assert.deepEqual(conversationOriginalTasks(curriculum,{...state,...patch},guide),[]);
  assert.deepEqual(conversationOriginalTasks(curriculum,{...state,...patch},readTask),[]);
 }
 const c=context('我已經通讀全詩了。');
 assert.throws(()=>original({objectiveId:'grade',evidence:evidence(c.turns[0].content)},{...c,curriculum,task:guide,tasks:[readTask]}),/wrong_task/);
 assert.throws(()=>original({objectiveId:'read',evidence:evidence(c.turns[0].content)},{...c,curriculum,task:readTask,tasks:[]}),/wrong_task/);
});
for(const content of ['我還沒有已讀完','如果我已讀完','我已讀完嗎？','你要我說已讀完','我不選A','不是85分'])test('cannot turn a fragment into an affirmative source receipt: '+content,()=>{
 const c=context(content,{submitted:true});
 assert.throws(()=>reading({operation:'acknowledge',evidence:evidence('已讀完')},c));
 assert.throws(()=>original({objectiveId:'read',evidence:evidence('已讀完')},{...c,task:readTask}));
});
for(const content of ['已讀完','我已经把整篇课文读完了。','我讀完了！','這篇文章看完了','我已經通讀全詩了。','我已经通读全文了。','我讀完這篇文章了。','我把整首詩讀完了。'])test('accepts a complete explicit reading statement: '+content,()=>{
 const c=context(content,{submitted:true}),p={operation:'acknowledge',evidence:evidence(content)};
 assert.equal(reading(p,c).operation,'acknowledge');
 assert.equal(original({objectiveId:'read',evidence:p.evidence},{...c,task:readTask}).input.acknowledgement,'已讀完');
});
for(const content of ['我還沒通讀全詩。','如果我已經通讀全詩了。','我已經通讀全詩了嗎？','請通讀全詩。','我打算通讀全詩。','他說我已經通讀全詩了。','我只讀完第一段。','我通讀了幾行。','讀完這篇文章。','通讀全詩。','整首詩讀完。'])test('natural reading wording cannot imply completion: '+content,()=>{
 const c=context(content,{submitted:true});
 for(const quote of [content,'我已經通讀全詩了','通讀全詩','讀完']){
  assert.throws(()=>reading({operation:'acknowledge',evidence:evidence(quote)},c));
  assert.throws(()=>original({objectiveId:'read',evidence:evidence(quote)},{...c,task:readTask}));
 }
});
test('prior initial guess and correction cannot be overwritten through conversation',()=>{
 const marks=[{markId:'m1',paragraphKey:'p1',startOffset:0,endOffset:5,guess:'原猜測',resolutionStatus:'resolved',correction:'原訂正'}];
 assert.throws(()=>reading({operation:'mark',paragraphKey:'p1',selectedText:'學而時習',evidence:evidence('新猜測')},context('學而時習：新猜測',{marks})),/original_mark_preserved/);
 assert.throws(()=>reading({operation:'resolve',markId:'m1',evidence:evidence('新訂正')},context('新訂正',{submitted:true,marks})),/correction_not_verified/);
 assert.equal(marks[0].guess,'原猜測');assert.equal(marks[0].correction,'原訂正');
});
test('foreign speaker, unknown mark and ambiguous passage cannot provide evidence',()=>{
 assert.throws(()=>reading({operation:'submit',evidence:evidence('這是老師寫的初讀感知，並不是學生的話')},{...context('這是老師寫的初讀感知，並不是學生的話'),turns:[{id:'s1',role:'teacher',content:'這是老師寫的初讀感知，並不是學生的話'}]}));
 assert.throws(()=>reading({operation:'resolve',markId:'foreign',evidence:evidence('改正')},context('改正',{submitted:true,marks:[]})));
 assert.throws(()=>reading({operation:'mark',paragraphKey:'p1',selectedText:'不亦',evidence:evidence('不亦是疑點')},context('不亦是疑點')),/ambiguous/);
});
test('ratings and choices cannot be extracted from a negation or hypothetical',()=>{
 for(const content of ['不是85分','如果给85分','85分嗎？'])assert.throws(()=>original({objectiveId:'rate',evidence:evidence('85分')},{...context(content),task:{kind:'evaluation',objectiveId:'rate'}}));
 for(const content of ['我不選A','如果我選A','我選A嗎？'])assert.throws(()=>original({objectiveId:'v',evidence:evidence('A')},{...context(content),task:{kind:'vocabulary',objectiveId:'v',options:['第一','第二']}}));
});
test('study-guide receipt requires the actual earlier teacher reference and preserves its timestamp',()=>{
 const c={objectives:[{id:'guide',domain:'studyGuide',sourceItemKey:'one'}],studyGuide:[{itemKey:'one',activeForSelfTest:true,referenceAnswer:'正式參考內容'}],legacy:{formative:[{itemKey:'one',resourceKey:'resource',semanticRevision:'version'}]}};
 const s={id:'s1',role:'student',content:'對照後我修正原先的理解',createdAt:'2026-10-13T01:00:02Z'},proposal={objectiveId:'guide',fields:{response:evidence(s.content)}};
 assert.throws(()=>validateFormalDraft(c,[s],proposal),/reference_not_revealed/);
 const teacher={id:'t1',role:'teacher',content:'參考中說：正式參考內容',createdAt:'2026-10-13T01:00:01Z'};
 const d=validateFormalDraft(c,[teacher,s],proposal);assert.equal(d.formal.input.referenceRevealedAt,teacher.createdAt);assert.equal(d.references[1].turnId,'t1');
 assert.throws(()=>validateFormalDraft(c,[{...teacher,createdAt:'2026-10-13T01:00:03Z'},s],proposal),/reference_not_revealed/);
});

test('ordinary conversational ratings and choices preserve the reason without inferring a negated fragment',()=>{
 const rating='我給85分，因為月色的描寫很細緻。',r=original({objectiveId:'rate',evidence:evidence('85分')},{...context(rating),task:{kind:'evaluation',objectiveId:'rate'}});
 assert.equal(r.input.rating,85);assert.equal(r.input.reason,rating);
 const choice='我選A，因為這個解釋更符合前後文。';assert.equal(original({objectiveId:'v',evidence:evidence('A')},{...context(choice),task:{kind:'vocabulary',objectiveId:'v',options:['第一','第二']}}).input.selectedIndex,0);
});

test('the original answer-key item of a demonstrated word is reachable from the conversation while another question is issued',()=>{
 const curriculum={objectives:[{id:'lesson-x:read',domain:'read'},{id:'lesson-x:v01',domain:'vocabulary'},{id:'legacy:effect:lesson-x:vocab:lesson-x:v01',domain:'legacy'}]};
 const state={objectives:[{id:'lesson-x:read',status:'preserved'},{id:'lesson-x:v01',status:'demonstrated'},{id:'legacy:effect:lesson-x:vocab:lesson-x:v01',status:'not_yet_observed'}],readingGate:null};
 const guide={kind:'dialogue',objectiveId:'lesson-x:v02',questionId:'q-2'};
 const original={objectiveId:'legacy:effect:lesson-x:vocab:lesson-x:v01',kind:'vocabulary',itemId:'lesson-x:v01',question:'「已」的意思是',options:['已经','停止'],source:'人生代代无穷已'};
 assert.deepEqual(conversationOriginalTasks(curriculum,state,guide),[]);
 assert.deepEqual(conversationOriginalTasks(curriculum,state,guide,original),[original]);
 assert.deepEqual(conversationOriginalTasks(curriculum,{...state,legacyCompletion:true},guide,original),[]);
});

test('a clause-level choice or rating in the student\'s own words is explicit; hedging and unrelated letters are not',()=>{
 const options=['已经','太、甚','停止','罢了'];
 const turn=content=>({id:'t1',role:'student',content});
 const task={objectiveId:'legacy:effect:lesson-x:vocab:lesson-x:v01',kind:'vocabulary',options};
 const choose=(content,quote)=>original({objectiveId:task.objectiveId,evidence:{turnId:'t1',quote}},{turns:[turn(content)],curriculum:{},task});
 assert.equal(choose('原題「人生代代无穷已」的「已」，我選 C，停止。','我選 C，停止').input.selectedIndex,2);
 assert.equal(choose('原題「人生代代无穷已」的「已」，我選 C，停止。','C').input.selectedIndex,2);
 assert.equal(choose('這題答案是C。','答案是C').input.selectedIndex,2);
 assert.equal(choose('停止。','停止').input.selectedIndex,2);
 assert.throws(()=>choose('我在 B 和 C 之間猶豫。','我在 B 和 C 之間猶豫'),/choice_not_explicit/);
 assert.throws(()=>choose('不是 C，我覺得是 A。','不是 C'),/choice_not_explicit/);
 assert.throws(()=>choose('我選 C，就是已经的意思。','我選 C，就是已经的意思'),/choice_not_explicit/,'the letter contradicts the option text');
 assert.throws(()=>choose('我選 C。','我選 D'),/not_student_quote|choice_not_explicit/,'the quote must be the student\'s own words');
 const rate=(content,quote)=>original({objectiveId:'legacy:effect:lesson-x:interaction:evaluation',evidence:{turnId:'t1',quote}},{turns:[turn(content)],curriculum:{},task:{objectiveId:'legacy:effect:lesson-x:interaction:evaluation',kind:'evaluation'}});
 assert.equal(rate('這篇我覺得有 85 分，因為結尾很安靜。','這篇我覺得有 85 分').input.rating,85);
 assert.equal(rate('80分','80分').input.rating,80);
 assert.throws(()=>rate('第 3 段我給 80 分，第 5 段給 60 分。','我給 80 分'),/rating_not_explicit/);
 assert.throws(()=>rate('大概 120 分吧。','大概 120 分吧'),/rating_out_of_range/);
});

test('a clause that only reproduces an option is not a hedge, even when the option itself contains 別/不/未 (摇: 「…离人无限的别愁」)',async()=>{
 const {explicitChoice}=await import('../site/dialogue-reading-evidence.js');
 const o=['落月把情思摇动，洒满了江边的树木。','落月摇晃着，把深情全部倾注在江边的树木上。','月光在树影间摇曳，使人产生离别的愁绪。','落月的光辉与江树交织，引起了离人无限的别愁。'];
 const c='回到「落月摇情满江樹」那一道原題：我選 D，落月的光辉与江树交织，引起了离人无限的别愁。';
 assert.equal(explicitChoice(o,c,'我選 D，落月的光辉与江树交织，引起了离人无限的别愁'),3);assert.equal(explicitChoice(o,c,'我選 D'),3);
 assert.equal(explicitChoice(o,'我不選 D','我不選 D'),-1,'a negated choice is still refused');assert.equal(explicitChoice(o,'可能是 D','可能是 D'),-1,'a hedged choice is still refused');
 assert.equal(explicitChoice(o,'我選 D，不過也可能是 C','我選 D，不過也可能是 C'),-1,'a hedge in the student own words still refuses');
 const v=['勝任','不能承受','美好','超過'];assert.equal(explicitChoice(v,'我選 B，不能承受。','我選 B，不能承受'),1,'an option containing 不 is not a negation');
});
