// Local synthetic acceptance harness only: no credentials, provider calls or persistent DB.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {handleDialogue} from '../site/dialogue-source.js';
const root=path.resolve('site'),sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
for(const f of fs.readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())sql.exec(fs.readFileSync('migrations/'+f,'utf8'));
sql.exec("INSERT INTO students(id,uc_slug,display_name) VALUES(1,'dialogue-synthetic-test','Synthetic test'),(2,'dialogue-synthetic-other','Synthetic other');");
let syntheticAccount=1,responseDelayMs=0;
const wrap=(text,args=[])=>({bind:(...v)=>wrap(text,v),first:async()=>sql.prepare(text).get(...args)||null,all:async()=>({results:sql.prepare(text).all(...args)}),run:async()=>({meta:{changes:Number(sql.prepare(text).run(...args).changes)}}),runSync:()=>({meta:{changes:Number(sql.prepare(text).run(...args).changes)}})});
const db={prepare:text=>wrap(text),batch:async statements=>{sql.exec('BEGIN');try{const r=statements.map(s=>s.runSync());sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;}}};
const env={READING_DB:db,YW_DIALOGUE_ENABLED:'true',YW_DIALOGUE_PILOT_USER_IDS:'700001,700002',ASSETS:{fetch:async request=>new Response(fs.readFileSync(root+new URL(request.url).pathname))}};
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json','.css':'text/css','.webp':'image/webp','.png':'image/png','.pdf':'application/pdf'};
const instrumentation=`<script>new MutationObserver(()=>{if(!window.__baselineReadable && document.querySelector('#text-flow')?.textContent.length>200){window.__baselineReadable=performance.now();performance.mark('baseline-readable-text')}}).observe(document,{childList:true,subtree:true})</script>`;
const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://127.0.0.1:4177');
 if(url.pathname==='/__synthetic/control' && req.method==='POST'){
  let text='';for await(const c of req){text+=c;if(text.length>1024)throw Error('oversize');}
  const value=JSON.parse(text);if(![0,1,2].includes(value.account)||!Number.isInteger(value.responseDelayMs)||value.responseDelayMs<0||value.responseDelayMs>3000)throw Error('invalid_fixture');
  syntheticAccount=value.account;responseDelayMs=value.responseDelayMs;res.writeHead(200,{'content-type':'application/json'});res.end('{"synthetic":true}');return;
 }
 if(url.pathname==='/api/dialogue/v1'){
 let body='';for await(const c of req){body+=c;if(body.length>16000){res.writeHead(413);res.end();return;}}
 const request=new Request('https://yw.bdfz.net'+req.url,{method:req.method,headers:{'content-type':'application/json'},...(body?{body}:{})});
 const response=await handleDialogue(request,env,syntheticAccount?{id:syntheticAccount,ucUserId:700000+syntheticAccount}:null,null,{callModel:async()=>{await new Promise(resolve=>setTimeout(resolve,responseDelayMs));return {value:{reply:'【合成測試回應，不是正式 AI 評閱】\n我在「不寧靜」與眼前景物之間留下了距離。你讀到「但熱鬧是它們的，我什麼也沒有」時，覺得這個距離發生了什麼變化？ [lesson-1717-p2:p7]',assessments:[]},model:'synthetic-offline-fixture',modelVersion:null};}});res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());return;}
 if(url.pathname.startsWith('/api/')){res.writeHead(404,{'content-type':'application/json'});res.end('{"code":"synthetic_server_no_legacy_api"}');return;}
 const original=url.pathname==='/original';const target=path.resolve(root,'.'+(original?'/index.html':url.pathname==='/'?'/dialogue.html':url.pathname));if(!target.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
 let content=fs.readFileSync(target);if(original)content=content.toString().replace('<head>','<head>'+instrumentation);
 res.writeHead(200,{'content-type':types[path.extname(target)]||'application/octet-stream','cache-control':'no-store'});res.end(content);
 }catch{res.writeHead(404,{'content-type':'application/json'});res.end('{"code":"not_found"}');}});
server.listen(4177,'127.0.0.1',()=>console.log('Synthetic-only preview: http://127.0.0.1:4177/dialogue.html'));
process.on('SIGINT',()=>{server.close(()=>{sql.close();process.exit(0);});});
