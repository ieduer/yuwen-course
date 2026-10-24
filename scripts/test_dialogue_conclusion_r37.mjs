// r37 (owner 2026-10-24: "該結語就給"): Claude writes the 尚友 conclusion without the free-pool option schema; the first one
// (test account, lesson-1693, 02:51Z) was refused for an earlier-record id that was not preserved in its domain.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {validateConclusion} from '../site/dialogue-conclusion.js';

const c=JSON.parse(fs.readFileSync('site/dialogue-curriculum/lesson-1578.json','utf8')),p=c.passages.find(x=>x.id==='lesson-1578:p2');
const turns=[{id:'a',role:'student',content:'起初我只看到热闹。'},{id:'b',role:'student',content:'后来我明白，乐与悲本是一体，“死生亦大矣”。'}];
const ref={turnId:'b',quote:'乐与悲本是一体',passageId:p.id,passageQuote:'列坐其次'};
const preserved=c.objectives.find(o=>o.domain==='vocabulary'),demonstrated=c.objectives.filter(o=>o.domain==='vocabulary')[1];
const state={readyForShangyou:true,objectives:[{id:preserved.id,domain:'vocabulary',status:'preserved',evidence:['e1']},{id:demonstrated.id,domain:'vocabulary',status:'demonstrated',evidence:[]}]};
const base=()=>({studentSummary:'由樂而悲。',change:{before:{turnId:'a',quote:'起初我只看到热闹'},after:{turnId:'b',quote:'后来我明白'}},stance:ref,domains:['interpretation','vocabulary','technique','transfer','uncertainty'].map(domain=>({domain,finding:'有據。',evidence:[ref],preservedObjectives:[]}))});

test('an earlier-record id that is not preserved in its domain is dropped; a preserved one is kept',()=>{
 const raw=base();raw.domains[1].preservedObjectives=[demonstrated.id,preserved.id,'lesson-1578:not-real'];
 const out=validateConclusion(raw,{curriculum:c,state,turns});
 assert.deepEqual(out.domains[1].preservedObjectives.map(x=>x.objectiveId),[preserved.id]);
});

test('a domain keeps its first verifiable evidence; prose over the limit is clipped; quotes stay strict',()=>{
 const raw=base();raw.domains[2].evidence=[{...ref,quote:'不是学生说的话'},ref,ref];raw.domains[3].finding='很'.repeat(120);raw.studentSummary='好'.repeat(300);
 const out=validateConclusion(raw,{curriculum:c,state,turns});
 assert.equal(out.domains[2].evidence.length,1);assert.equal(out.domains[2].evidence[0].quote,'乐与悲本是一体');
 assert.equal([...out.domains[3].finding].length,90);assert.equal([...out.studentSummary].length,180);
 const bad=base();bad.domains[0].evidence=[{...ref,quote:'不是学生说的话'}];
 assert.throws(()=>validateConclusion(bad,{curriculum:c,state,turns}),/conclusion_domain_without_evidence/,'a domain with nothing verifiable still refuses');
 const stance=base();stance.stance={...ref,quote:'不是学生说的话'};
 assert.throws(()=>validateConclusion(stance,{curriculum:c,state,turns}),/unverifiable_conclusion_turn/,'the stance must be verbatim');
 const dup=base();dup.domains[4].domain='vocabulary';
 assert.throws(()=>validateConclusion(dup,{curriculum:c,state,turns}),/invalid_conclusion_domain/,'all five domains, once each');
});
