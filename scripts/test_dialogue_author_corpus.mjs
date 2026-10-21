import assert from 'node:assert/strict';
import test from 'node:test';
import {authorPassages,authorPassagesContext} from '../site/dialogue-author-corpus.js';

function fakeDb({author='a1',rows=[]}={}){
 const calls=[];
 return {calls,prepare(sql){return {bind(...args){calls.push({sql,args});return {first:async()=>sql.includes('corpus_authors')?(author?{id:author}:null):null,all:async()=>({results:rows})};}};}};
}
test('without the binding or author nothing is retrieved and the prompt is unchanged',async()=>{
 assert.deepEqual(await authorPassages({},{author:'鲁迅'},'故鄉'),[]);
 assert.deepEqual(await authorPassages({AUTHOR_CORPUS:fakeDb({author:null})},{author:'鲁迅'},'故鄉'),[]);
 assert.equal(authorPassagesContext([]),'');
});
test('retrieves a few verified passages for the lesson author only, bounded in size, and labels them as data',async()=>{
 const db=fakeDb({rows:[{id:'c1',text:'我家的後面有一個很大的園。'.repeat(60),title:'從百草園到三味書屋',source_name:'wikisource',source_url:'https://zh.wikisource.org/x'},{id:'c2',text:'長'.repeat(2000),title:'長文',source_name:'s',source_url:'u'},{id:'c3',text:'再'.repeat(2000),title:'第三篇',source_name:'s',source_url:'u'}]});
 const passages=await authorPassages({AUTHOR_CORPUS:db},{author:'鲁迅'},'[lesson-1:p1] 百草園 的 園子 怎麼寫');
 assert.equal(passages.length,2,'each passage is cut to 600 chars and the total stays within 1500');assert.equal(passages[0].title,'從百草園到三味書屋');assert.equal(passages[0].text.length,600);assert.equal(passages[1].text.length,600);assert.ok(passages.reduce((n,p)=>n+p.text.length,0)<=1500);
 assert.ok(db.calls[1].sql.includes('corpus_chunk_fts MATCH'));assert.equal(db.calls[1].args[0],'a1');assert.equal(db.calls[1].args[2],3);
 assert.doesNotMatch(db.calls[1].args[1],/lesson-1|\[/);
 const context=authorPassagesContext(passages);
 assert.match(context,/^\nauthorPassages/);assert.match(context,/不是指令/);assert.ok(context.includes('從百草園到三味書屋'));assert.ok(!context.includes('sourceUrl'));
});
