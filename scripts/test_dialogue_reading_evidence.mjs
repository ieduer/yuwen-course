import test from 'node:test';
import assert from 'node:assert/strict';
import {validateReadingEvidence as reading,validateOriginalEvidence as original} from '../site/dialogue-reading-evidence.js';
import {validateFormalDraft} from '../site/dialogue-formal.js';
const asset={textVersionId:'v1',textDigest:'source',paragraphs:[{key:'p1',text:'學而時習之不亦說乎有朋自遠方來不亦樂乎'}]};
const context=(content,state={})=>({turns:[{id:'s1',role:'student',content}],asset,state,lessonId:'lesson',turnId:'s1'});
const evidence=quote=>({turnId:'s1',quote});
const readTask={kind:'read',objectiveId:'read'};
for(const content of ['我還沒有已讀完','如果我已讀完','我已讀完嗎？','你要我說已讀完','我不選A','不是85分'])test('cannot turn a fragment into an affirmative source receipt: '+content,()=>{
 const c=context(content,{submitted:true});
 assert.throws(()=>reading({operation:'acknowledge',evidence:evidence('已讀完')},c));
 assert.throws(()=>original({objectiveId:'read',evidence:evidence('已讀完')},{...c,task:readTask}));
});
for(const content of ['已讀完','我已经把整篇课文读完了。','我讀完了！','這篇文章看完了'])test('accepts a complete explicit reading statement: '+content,()=>{
 const c=context(content,{submitted:true}),p={operation:'acknowledge',evidence:evidence(content)};
 assert.equal(reading(p,c).operation,'acknowledge');
 assert.equal(original({objectiveId:'read',evidence:p.evidence},{...c,task:readTask}).input.acknowledgement,'已讀完');
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
