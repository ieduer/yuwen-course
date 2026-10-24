import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {projectState,questionItems,pendingSupplement,LIMITS} from '../site/dialogue-policy.js';
import {lessonCallLimit} from '../site/dialogue-lesson-limits.js';
import {countPaths,loadCurriculum} from './dialogue_e2e.mjs';

test('all 69 pending supplemental items remain visible without blocking the 52 lessons',()=>{
 let count=0,lessons=0;
 for(const f of fs.readdirSync('site/dialogue-curriculum').filter(f=>/^lesson-.*\.json$/.test(f))){
  const c=JSON.parse(fs.readFileSync('site/dialogue-curriculum/'+f));
  const deferred=c.languagePractice.filter(pendingSupplement);if(!deferred.length)continue;
  count+=deferred.length;lessons++;
  const ids=new Set(deferred.map(i=>i.id));
  const prior=c.objectives.filter(o=>o.domain!=='shangyou'&&!ids.has(o.id)).map(o=>({objectiveId:o.id,verified:true}));
  const state=projectState(c,[],prior,null,{phase:'close_reading',unresolvedMarks:0});
  assert.equal(state.readyForShangyou,true,c.lessonId);
  assert(!questionItems(c).some(i=>ids.has(i.id)),c.lessonId);
  for(const id of ids){const row=state.objectives.find(o=>o.id===id);assert.equal(row.status,'pending_calibration');assert.equal(row.requiredForCompletion,false);assert.equal(row.reviewPath,'optional-practice');}
 }
 assert.equal(count,69);assert.equal(lessons,52);
});

test('the nine representative language requirements still require actual calibration',()=>{
 const cs=['lesson-1711-p1','lesson-1498'].map(loadCurriculum);
 assert.equal(cs.reduce((n,c)=>n+c.languagePractice.length,0),9);
 for(const c of cs)for(const item of c.languagePractice)assert(questionItems(c).some(q=>q.id===item.id));
});

test('long lessons retain 50 percent room beyond the complete planned remediation path',()=>{
 for(const id of ['lesson-1477','lesson-1534']){
  const c=loadCurriculum(id),path=countPaths(c);
  assert(lessonCallLimit(c)>=Math.ceil(path.boundedRemediationCallRows*1.5));
  assert(lessonCallLimit(c)>120);
  assert(path.boundedRemediationStudentTurns<LIMITS.lessonLifetime);
 }
});

test('accepted supplements return to the ordinary independent-question requirement',()=>{
 const c=JSON.parse(fs.readFileSync('site/dialogue-curriculum/lesson-1589.json'));
 const item=c.languagePractice.find(pendingSupplement);assert(item);
 item.calibrationStatus='accepted';
 assert(questionItems(c).some(i=>i.id===item.id));
 const state=projectState(c,[]);
 assert.notEqual(state.objectives.find(o=>o.id===item.id).requiredForCompletion,false);
});
