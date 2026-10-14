import {dialogueReadingAsset,originalRange} from '../site/dialogue-reading-material.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {parseHTML} from 'linkedom';
const source=fs.readFileSync('site/assets/dialogue-first-read.js','utf8').replace(/^import .*;\n/gm,'').replace('export function','function');
test('canonical doubt marks display in red with original guesses and version-safe positions, without forms',async()=>{
 const {document}=parseHTML('<html><body><div id="reader"></div></body></html>'),root=document.getElementById('reader'),selected=[];
 const asset={textVersionId:'v1',textDigest:'digest',paragraphs:[{key:'p1',text:'學而時習之不亦說乎'}]};
 const ctx=vm.createContext({dialogueReadingAsset,document,AbortController,fetch:async()=>new Response(JSON.stringify(asset)),getSelection:()=>null});vm.runInContext(source+'\nthis.open=openFirstReading;',ctx);
 const reader=ctx.open({lessonId:'lesson-test',curriculum:{mode:'classical'},root,isCurrent:()=>true,onSelect:(...v)=>selected.push(v)});await reader.ready;
 const marks=[{markId:'m1',paragraphKey:'p1',startOffset:0,endOffset:5,selectedText:'學而時習之',guess:'原先的猜測',correction:'後來的訂正'}];
 await reader.setMarks({textVersionId:'v1',textDigest:'digest',marks});assert.equal(root.querySelectorAll('mark').length,1);assert.equal(root.textContent,asset.paragraphs[0].text);assert.match(root.querySelector('mark').title,/原先的猜測/);assert.match(root.querySelector('mark').title,/後來的訂正/);assert.equal(root.querySelectorAll('input,textarea,form').length,0);
 root.querySelector('mark').click();assert.equal(selected[0][0],'p1');assert.equal(selected[0][1],'學而時習之');
 await reader.setMarks({textVersionId:'foreign',textDigest:'other',marks:[]});assert.equal(root.querySelectorAll('mark').length,1);
 reader.dispose();assert.equal(root.textContent,'');
});

test('poem display and notes share canonical UTF-16 offsets while retaining punctuation mapping',async()=>{
 const curriculum={lessonId:'poem',mode:'poetry',sourceInventory:{readerSha256:'source'},passages:[{id:'p1',text:'春江潮水，𫐓影明。'}]};
 const asset=await dialogueReadingAsset(curriculum);assert.equal(asset.paragraphs[0].text,'春江潮水𫐓影明');assert.deepEqual(originalRange(curriculum.passages[0].text,4,7),[5,8]);
 assert.deepEqual(await dialogueReadingAsset(curriculum),asset);
 assert.notEqual((await dialogueReadingAsset({...curriculum,sourceInventory:{readerSha256:'changed'}})).textDigest,asset.textDigest);
});
