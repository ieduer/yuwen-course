import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {verbatimSpan} from '../site/dialogue-quote.js';
import {validateProposal,projectState,questionItems,POLICY} from '../site/dialogue-policy.js';
import {validateConclusion} from '../site/dialogue-conclusion.js';
import {paragraphGuide} from '../site/dialogue-paragraph-guide.js';

const load=id=>JSON.parse(fs.readFileSync(`site/dialogue-curriculum/${id}.json`,'utf8'));
const CLOSE={phase:'close_reading',unresolvedMarks:0};

test('a quote is located without punctuation or spacing and resolves to the exact cited span',()=>{
 const text='带左右，引以为流觞曲水，列坐其次。虽无丝竹管弦之盛';
 assert.equal(verbatimSpan(text,'列坐其次'),'列坐其次','an exact quote is returned unchanged');
 assert.equal(verbatimSpan(text,'引以为流觞曲水,列坐其次'),'引以为流觞曲水，列坐其次','ASCII comma for 「，」');
 assert.equal(verbatimSpan(text,'引以为流觞曲水 列坐其次。'),'引以为流觞曲水，列坐其次','spaces and a trailing stop');
 assert.equal(verbatimSpan('我觉得，“次”是旁边的意思','"次"是旁边的意思'),'次”是旁边的意思','the span starts and ends on a character of the text');
 assert.equal(verbatimSpan(text,'列坐其旁'),null,'different words are still refused');
 assert.equal(verbatimSpan(text,'。次'),null,'a single folded character is too little to locate');
 assert.equal(verbatimSpan(text,'  '),null);
 assert.equal(verbatimSpan('𠀋字，與𠀋字','𠀋字與'),'𠀋字，與','characters outside the basic plane keep their place');
});

test('an assessment whose passage quote differs only in punctuation is kept, with the passage text stored (2026-10-23 refusal)',()=>{
 const c=load('lesson-1578'),passage=c.passages.find(p=>p.id==='lesson-1578:p2');
 const o=c.objectives.find(x=>x.id==='lesson-1578:v02');
 const turns=[{id:'t1',role:'student',content:'我选A。次是旁边、水边的意思，现在说次多指顺序；这句是说大家依次坐在曲水的旁边。'}];
 const evidence=o.criteria.map(criterion=>({criterion,turnId:'t1',quote:'大家依次坐在曲水的旁边',passageId:passage.id,passageQuote:'引以为流觞曲水,列坐其次'}));
 const out=validateProposal({reply:'好。',assessments:[{objectiveId:o.id,outcome:'needs_practice',rationale:'test',evidence}]},{curriculum:c,turns});
 assert.ok(passage.text.includes('引以为流觞曲水，列坐其次'));
 for(const e of out.assessments[0].evidence){assert.equal(e.passageQuote,'引以为流觞曲水，列坐其次');assert.ok(passage.text.includes(e.passageQuote));assert.ok(turns[0].content.includes(e.quote));}
 const wrong=evidence.map(e=>({...e,passageQuote:'登临送目，正故国晚秋'}));
 assert.throws(()=>validateProposal({reply:'好。',assessments:[{objectiveId:o.id,outcome:'needs_practice',rationale:'test',evidence:wrong}]},{curriculum:c,turns}),/unverifiable_evidence/);
 const invented=evidence.map(e=>({...e,quote:'我认为次是次序'}));
 assert.throws(()=>validateProposal({reply:'好。',assessments:[{objectiveId:o.id,outcome:'needs_practice',rationale:'test',evidence:invented}]},{curriculum:c,turns}),/unverifiable_evidence/);
});

test('a conclusion stores the exact student and passage spans',()=>{
 const c=load('lesson-1578'),p=c.passages.find(x=>x.id==='lesson-1578:p2');
 const turns=[{id:'a',role:'student',content:'起初我只看到热闹。'},{id:'b',role:'student',content:'后来我明白，乐与悲本是一体，“死生亦大矣”。'}];
 const ref={turnId:'b',quote:'乐与悲本是一体',passageId:p.id,passageQuote:'引以为流觞曲水,列坐其次'};
 const domains=['interpretation','vocabulary','technique','transfer','uncertainty'].map(domain=>({domain,finding:'有據。',evidence:[ref],preservedObjectives:[]}));
 const out=validateConclusion({studentSummary:'由樂而悲。',change:{before:{turnId:'a',quote:'起初我只看到热闹'},after:{turnId:'b',quote:'后来我明白,乐与悲本是一体'}},stance:ref,domains},{curriculum:c,state:{readyForShangyou:true,objectives:[]},turns});
 assert.equal(out.change.after.quote,'后来我明白，乐与悲本是一体');
 assert.equal(out.stance.passageQuote,'引以为流觞曲水，列坐其次');
 assert.throws(()=>validateConclusion({studentSummary:'x',change:{before:{turnId:'a',quote:'起初我只看到热闹'},after:{turnId:'b',quote:'乐与哀'}},stance:ref,domains},{curriculum:c,state:{readyForShangyou:true,objectives:[]},turns}),/unverifiable_conclusion_turn/);
});

test('paragraphs carry their opening words and the author is told to name them that way',()=>{
 const c=load('lesson-1578'),g=paragraphGuide(c,projectState(c,[],[],null,CLOSE),questionItems(c));
 assert.deepEqual(g.paragraphs.map(p=>p.opening),['永和九年','是日也','夫人之相与','每览昔人兴感之由']);
 assert.equal(g.focus.opening,'永和九年');
 for(const p of g.paragraphs)assert.ok(c.passages.find(x=>x.id===p.passageId).text.startsWith(p.opening));
 assert.match(POLICY,/提到段落時用段首幾字稱呼（focus\.opening/);
});
