import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeExportPages,exportFilename} from '../site/assets/dialogue-export.js';
const s=(id,extra={})=>({sessionId:id,lessonId:'lesson-'+id,complete:true,inflight:false,turns:[{sequence:1,role:'student',confirmed:true},{sequence:2,role:'teacher',confirmed:true}],unsentDrafts:[],...extra});
test('pages merge in server order, de-duplicate, and label incomplete sessions',()=>{
 const pages=[{ownerRef:'o',total:3,sessions:[s('a'),s('b',{turns:[{sequence:1,role:'student',confirmed:false,partialReply:{content:'…',label:'incomplete_unconfirmed_stream'}}]})],older:{updatedAt:'t',id:'b'}},{ownerRef:'o',total:3,sessions:[s('b'),s('c',{reviewRequired:'transcript_over_policy_bound',unsentDrafts:[{content:'x'}]})],older:null}];
 const r=mergeExportPages(pages,{exportedAt:'2026-10-20T10:00:00.000Z',ownerRef:'o'});
 assert.deepEqual(r.sessions.map(x=>x.sessionId),['a','b','c']);assert.equal(r.sessionCount,3);assert.equal(r.expectedSessionCount,3);assert.equal(r.complete,true);
 assert.deepEqual(r.incompleteSessions,[{sessionId:'b',lessonId:'lesson-b',reasons:['unconfirmed_turns','partial_streamed_reply']},{sessionId:'c',lessonId:'lesson-c',reasons:['transcript_over_policy_bound','unsent_drafts']}]);
 assert.equal(r.scope,'own-sessions-only');assert.equal(exportFilename(r.exportedAt),'yw-dialogue-all-sessions-2026-10-20T10-00-00-000Z.json');
});
test('an unfinished cursor or a smaller count marks the export incomplete, and a changed owner aborts it',()=>{
 const r=mergeExportPages([{ownerRef:'o',total:5,sessions:[s('a')],older:{updatedAt:'t',id:'a'}}],{ownerRef:'o'});assert.equal(r.complete,false);
 assert.throws(()=>mergeExportPages([{ownerRef:'o',sessions:[s('a')]},{ownerRef:'p',sessions:[s('b')]}],{ownerRef:'o'}),/帳戶已切換/);
 assert.throws(()=>mergeExportPages([{ownerRef:'p',sessions:[s('a')]}],{ownerRef:'o'}),/帳戶已切換/);
 assert.throws(()=>mergeExportPages([]),/沒有可匯出/);
});
