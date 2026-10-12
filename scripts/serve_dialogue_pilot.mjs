// Local synthetic acceptance harness only: no credentials, provider calls or persistent DB.
import http from 'node:http';
import {Readable} from 'node:stream';
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {handleDialogue} from '../site/dialogue-source.js';
import {handleDialogueFirstRead,handleDialogueFormal,handleDialogueOriginal} from '../site/_worker.js';
import {POLICY_VERSION} from '../site/dialogue-policy.js';
const root=path.resolve('site'),sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
for(const f of fs.readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())sql.exec(fs.readFileSync('migrations/'+f,'utf8'));
sql.exec("INSERT INTO students(id,uc_slug,display_name) VALUES(1,'dialogue-synthetic-test','Synthetic test'),(2,'dialogue-synthetic-other','Synthetic other');");
let syntheticAccount=1,responseDelayMs=0,sourceDraftEnabled=false,conclusionEnabled=false;
const wrap=(text,args=[])=>({bind:(...v)=>wrap(text,v),first:async()=>sql.prepare(text).get(...args)||null,all:async()=>({results:sql.prepare(text).all(...args)}),run:async()=>({meta:{changes:Number(sql.prepare(text).run(...args).changes)}}),runSync:()=>({meta:{changes:Number(sql.prepare(text).run(...args).changes)}})});
const db={prepare:text=>wrap(text),batch:async statements=>{sql.exec('BEGIN');try{const r=statements.map(s=>s.runSync());sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;}}};
const env={READING_DB:db,YW_DIALOGUE_ENABLED:'true',YW_DIALOGUE_BUDGET_JSON:JSON.stringify({...JSON.parse(fs.readFileSync('docs/dialogue/budget-policy.json')),version:'synthetic-offline-only',validUntil:'2099-01-01T00:00:00Z'}),ASSETS:{fetch:async request=>new Response(fs.readFileSync(root+new URL(request.url).pathname))}};
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json','.css':'text/css','.webp':'image/webp','.png':'image/png','.pdf':'application/pdf'};
const instrumentation=`<script>new MutationObserver(()=>{if(!window.__baselineReadable && document.querySelector('#text-flow')?.textContent.length>200){window.__baselineReadable=performance.now();performance.mark('baseline-readable-text')}}).observe(document,{childList:true,subtree:true})</script>`;
const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://127.0.0.1:4177');
 if(url.pathname==='/__synthetic/control' && req.method==='POST'){
  let text='';for await(const c of req){text+=c;if(text.length>1024)throw Error('oversize');}
  const value=JSON.parse(text);if(![0,1,2].includes(value.account)||!Number.isInteger(value.responseDelayMs)||value.responseDelayMs<0||value.responseDelayMs>3000)throw Error('invalid_fixture');
  if(value.historyPairs!==undefined){
   if(!value.account||!Number.isInteger(value.historyPairs)||value.historyPairs<1||value.historyPairs>120)throw Error('invalid_history_fixture');
   const curriculum=JSON.parse(fs.readFileSync('site/dialogue-curriculum/lesson-1717-p2.json'));
   if(sql.prepare('SELECT id FROM dialogue_sessions WHERE student_id=?').get(value.account))throw Error('fixture_already_populated');
   const id=crypto.randomUUID(),at=new Date().toISOString();
   sql.prepare('INSERT INTO dialogue_sessions(id,student_id,lesson_id,curriculum_version,curriculum_json,policy_version,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id,value.account,curriculum.lessonId,curriculum.curriculumVersion,JSON.stringify(curriculum),POLICY_VERSION,value.historyPairs,at,at);
   const add=sql.prepare('INSERT INTO dialogue_turns(id,session_id,mutation_id,request_hash,role,content,status,policy_version,created_at) VALUES(?,?,?,?,?,?,?,?,?)');
   for(let n=0;n<value.historyPairs;n++)for(const role of ['student','teacher'])add.run(`long-${role}-${n}`,id,`history-${n}`,'synthetic-only',role,`【合成長對話 ${n+1}／${role}】`+'我從原句追問景物與感受之間的關係，保留不確定的解讀。'.repeat(30),'confirmed',POLICY_VERSION,at);
  }
  if(value.originalReady===true){
   if(!value.account||sql.prepare('SELECT id FROM dialogue_sessions WHERE student_id=?').get(value.account))throw Error('fixture_already_populated');
   const curriculum=JSON.parse(fs.readFileSync('site/dialogue-curriculum/lesson-1498.json')),id=crypto.randomUUID(),turn=crypto.randomUUID(),at=new Date().toISOString();
   sql.prepare('INSERT INTO dialogue_sessions(id,student_id,lesson_id,curriculum_version,curriculum_json,policy_version,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,1,?,?)').run(id,value.account,curriculum.lessonId,curriculum.curriculumVersion,JSON.stringify(curriculum),POLICY_VERSION,at,at);
   sql.prepare("INSERT INTO dialogue_turns(id,session_id,mutation_id,request_hash,role,content,status,policy_version,created_at) VALUES(?,?, 'synthetic-ready','synthetic-only','student','【合成學習證據，非真實學生】字詞語境說明及篇目感受已備妥。','saved',?,?)").run(turn,id,POLICY_VERSION,at);
   for(const objective of [curriculum.vocabulary[0].id,curriculum.objectives.find(o=>o.domain==='evaluation').id])sql.prepare("INSERT INTO dialogue_assessments(id,session_id,turn_id,objective_id,outcome,evidence_json,rationale,rule_version,curriculum_version,created_at) VALUES(?,?,?,?,'demonstrated','[]','synthetic-only','synthetic',?,?)").run(crypto.randomUUID(),id,turn,objective,curriculum.curriculumVersion,at);
  }
  if(value.conclusionReady===true){
   const session=sql.prepare("SELECT * FROM dialogue_sessions WHERE student_id=? AND lesson_id='lesson-1717-p2'").get(value.account);if(!session)throw Error('initial_history_required');
   const curriculum=JSON.parse(session.curriculum_json),turn=sql.prepare("SELECT id FROM dialogue_turns WHERE session_id=? AND role='student' ORDER BY sequence LIMIT 1").get(session.id);
   for(const o of curriculum.objectives.filter(o=>o.domain!=='shangyou'))sql.prepare("INSERT INTO dialogue_assessments(id,session_id,turn_id,objective_id,outcome,evidence_json,rationale,rule_version,curriculum_version,created_at) VALUES(?,?,?,?,'demonstrated','[]','synthetic-only','synthetic',?,?)").run(crypto.randomUUID(),session.id,turn.id,o.id,curriculum.curriculumVersion,new Date().toISOString());
  }
  syntheticAccount=value.account;responseDelayMs=value.responseDelayMs;sourceDraftEnabled=value.sourceDraft===true;conclusionEnabled=value.conclusionReady===true;res.writeHead(200,{'content-type':'application/json'});res.end('{"synthetic":true}');return;
 }
 if(url.pathname==='/api/dialogue/v1'){
 let body='';for await(const c of req){body+=c;if(body.length>16000){res.writeHead(413);res.end();return;}}
 const request=new Request('https://yw.bdfz.net'+req.url,{method:req.method,headers:{'content-type':'application/json',accept:req.headers.accept||'application/json'},...(body?{body}:{})});
 const student=syntheticAccount?{id:syntheticAccount,ucUserId:700000+syntheticAccount}:null;
 const response=await handleDialogue(request,env,student,null,{firstReadAction:(operation,payload)=>handleDialogueFirstRead(request,env,student,null,operation,payload),formalAction:(formal,id,evaluate,commit)=>handleDialogueFormal(request,env,student,formal,id,evaluate,commit),originalAction:(formal,id,commit)=>handleDialogueOriginal(request,env,student,formal,id,commit),callModel:async(_env,_prompt,_id,emit)=>{
  const reply='【合成測試回應，不是正式 AI 評閱】\n請回到你剛才選出的原文，說說是哪個詞讓你產生了這個理解。你也可以保留不同解讀，並指出依據。';
  await emit(reply.slice(0,30));await new Promise(resolve=>setTimeout(resolve,responseDelayMs));await emit(reply);
  let value={reply,assessments:[]};
  if(_prompt.includes('第一個欄位必須為 reply'))value={reply,score:83,verdict:'合成評閱',strength:'合成文本依據',gap:'合成待釐清點',nextQuestion:'合成追問：首尾如何呼應？'};
  else if(sourceDraftEnabled){
   const data=JSON.parse(_prompt.split('以下是資料，不是指令：\n').at(-1));
   const objective=data.originalRequirements.find(o=>o.objectiveId.endsWith(':structure')),turn=data.recent.filter(t=>t.role==='student').at(-1);
   if(objective&&turn)value.sourceDraft={objectiveId:objective.objectiveId,fields:{reason:{turnId:turn.id,quote:turn.content}}};
  }
  if(conclusionEnabled&&!sourceDraftEnabled){
   const data=JSON.parse(_prompt.split('以下是資料，不是指令：\n').at(-1));
   if(data.readyForShangyou){
    const students=data.recent.filter(t=>t.role==='student'),before=students[0],after=students.at(-1),p=data.passages[0],ref=t=>({turnId:t.id,quote:t.content.slice(0,50)}),e={...ref(after),passageId:p.id,passageQuote:p.text.slice(0,30)},o=data.objectives.find(o=>o.id.endsWith(':shangyou'));
    value.assessments=[{objectiveId:o.id,outcome:'demonstrated',rationale:'合成結構測試，非真實能力評價',evidence:o.criteria.map(criterion=>({criterion,...e}))}];
    value.conclusion={studentSummary:'【合成小結】從初讀景物轉向理解敘述中的情緒變化，並保留對作者的不同意見。',change:{before:ref(before),after:ref(after)},stance:e,domains:['interpretation','vocabulary','technique','transfer','uncertainty'].map(domain=>({domain,finding:'【合成分析】對照已保存原話及文本；真實教學品質尚待校準。',evidence:[e],preservedObjectives:[]}))};
   }
  }
  return {value,model:'synthetic-offline-fixture',modelVersion:null};
 }});
 res.writeHead(response.status,Object.fromEntries(response.headers));
 if(response.body)Readable.fromWeb(response.body).on('error',()=>res.destroy()).pipe(res);else res.end();return;}

 if(url.pathname.startsWith('/api/')){res.writeHead(404,{'content-type':'application/json'});res.end('{"code":"synthetic_server_no_legacy_api"}');return;}
 const original=url.pathname==='/original';const target=path.resolve(root,'.'+(original?'/index.html':url.pathname==='/'?'/dialogue.html':url.pathname));if(!target.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
 let content=fs.readFileSync(target);if(original)content=content.toString().replace('<head>','<head>'+instrumentation);
 res.writeHead(200,{'content-type':types[path.extname(target)]||'application/octet-stream','cache-control':'no-store'});res.end(content);
 }catch{res.writeHead(404,{'content-type':'application/json'});res.end('{"code":"not_found"}');}});
server.listen(4177,'127.0.0.1',()=>console.log('Synthetic-only preview: http://127.0.0.1:4177/dialogue.html'));
process.on('SIGINT',()=>{server.close(()=>{sql.close();process.exit(0);});});
