import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';

const source=readFileSync(new URL('../site/durable-evaluation-jobs.js',import.meta.url),'utf8');
const start=source.indexOf('export async function evaluationBacklog(');
const end=source.indexOf('// Reuse the existing content-free Pulse RPC contract.',start);
assert(start>=0 && end>start);
const implementation=source.slice(start,end).replace('export ','');
const current=Function(implementation+'; return evaluationBacklog;')();
const legacy=Function(implementation.replace("(state<'completed' OR state>'completed')","state!='completed'")+'; return evaluationBacklog;')();
const now=1_800_000_000_000;
function fixture(rows,lastScan=now) {
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE learning_evaluation_jobs(state TEXT, next_attempt_at INTEGER, first_pending_at INTEGER); CREATE INDEX learning_jobs_due ON learning_evaluation_jobs(state,next_attempt_at,first_pending_at); CREATE TABLE learning_evaluation_scheduler(id INTEGER PRIMARY KEY,last_scan_at INTEGER);');
  sqlite.prepare('INSERT INTO learning_evaluation_scheduler VALUES(1,?)').run(lastScan);
  const insert=sqlite.prepare('INSERT INTO learning_evaluation_jobs VALUES(?,?,?)');
  for(const [state,age] of rows)insert.run(state,now,now-age);
  const queries=[];
  const db={prepare(sql){queries.push(sql);return {bind(...args){return {first:async()=>sqlite.prepare(sql).get(...args)};},first:async()=>sqlite.prepare(sql).get()};}};
  return {sqlite,db,queries,close:()=>sqlite.close()};
}
test('backlog preserves every state, age boundary and stale scheduler decision',async()=>{
  const ages=[0,299999,300000,300001,899999,900000,900001,3599999,3600000,3600001];
  // Include an unknown state and NULL to preserve SQL inequality semantics
  // if the schema later expands; no finite state whitelist is assumed.
  for(const state of ['queued','leased','completed','blocked','uncertain','future_state',null]) {
    for(const scan of [now,now-180001,null]) {
      const f=fixture(ages.map(age=>[state,age]),scan);
      try{assert.deepEqual(await current(f.db,now),await legacy(f.db,now));}finally{f.close();}
    }
  }
});
test('empty, all completed, and mixed history preserve the public aggregate',async()=>{
  for(const rows of [[],Array.from({length:10000},()=>['completed',7200000]),[['queued',1000],['leased',600000],['blocked',3700000],['uncertain',400000],['completed',7200000]]]) {
    const f=fixture(rows);
    try{assert.deepEqual(await current(f.db,now),await legacy(f.db,now));}finally{f.close();}
  }
});
test('completed history is excluded by the existing state index',async()=>{
  const f=fixture([...Array.from({length:10000},()=>['completed',7200000]),['queued',1000]]);
  try {
    await current(f.db,now);
    const plan=f.sqlite.prepare('EXPLAIN QUERY PLAN '+f.queries[0]).all(now-300000,now-900000,now-3600000).map(row=>row.detail).join('\n');
    assert.match(plan,/SEARCH learning_evaluation_jobs USING COVERING INDEX learning_jobs_due/);
    assert.doesNotMatch(plan,/SCAN learning_evaluation_jobs/);
    assert.equal(f.queries.length,2);
  }finally{f.close();}
});
