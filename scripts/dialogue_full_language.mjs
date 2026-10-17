// Offline source preparation only. Never emits approval, activation, or a price policy.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {amendment5Packet} from './dialogue_calibration_amendment5.mjs';
import {projectReleaseJson,RELEASE_JSON_PROJECTION_VERSION} from './build_release_site.mjs';
import {FULL_OPERATION,FULL_CASE_COUNT,FULL_MODEL,fullSourceGate,fullMaterialize,digest} from '../site/dialogue-full-language.js';
import {POLICY_VERSION,RULE_VERSION} from '../site/dialogue-policy.js';

const root=path.resolve(import.meta.dirname,'..');
export const loadCurriculum=id=>JSON.parse(fs.readFileSync(path.join(root,'site/dialogue-curriculum',id+'.json')));
export const loadCorpus=()=>JSON.parse(fs.readFileSync(path.join(root,'scripts/dialogue-calibration-amendment5-cases.json')));
export async function fullLanguagePacket({corpus=loadCorpus(),load=loadCurriculum,lessonIds}={}){
 const ids=lessonIds||JSON.parse(fs.readFileSync(path.join(root,'site/dialogue-curriculum/index.json'))).lessons.map(x=>x.lessonId);
 if(ids.length!==189||new Set(ids).size!==189)throw Error('full_requires_189_lessons');
 const sources=new Map(ids.map(id=>{const raw=load(id);return [id,{raw,source:JSON.parse(projectReleaseJson('dialogue-curriculum/'+id+'.json',JSON.stringify(raw)))}];}));
 const representatives=amendment5Packet(corpus,load);
 const represented=new Set(representatives.cases.filter(c=>c.curriculum.languagePractice.some(i=>i.id===c.objectiveId)).map(c=>c.objectiveId));
 if(represented.size!==9)throw Error('full_requires_nine_representative_items');
 const cases=[];
 async function add(spec){
  const {raw,source}=sources.get(spec.lessonId),item=source.languagePractice.find(i=>i.id===spec.objectiveId);
  const c={...spec,itemVersion:item?.version||null,itemDigest:item?await digest(item):null,
   sourceDigest:await digest(source),rawSourceDigest:await digest(raw),projectionVersion:RELEASE_JSON_PROJECTION_VERSION,
   sourceCurriculumVersion:source.curriculumVersion,syntheticOnly:true,maxPrimaryAttempts:1,maxDiagnosedRecoveries:0};
  c.sourceGate=fullSourceGate(source,c);
  if(!c.sourceGate.eligible)throw Error('full_source_blocked:'+c.id+':'+c.sourceGate.reasons.join(','));
  c.caseDefinitionDigest=await digest(c);
  const prompt=fullMaterialize(c,source).prompt;
  if(!prompt.includes(c.studentAnswer)||!prompt.includes(c.validationQuestion))throw Error('full_prompt_lost_case:'+c.id);
  c.promptDigest=await digest(prompt);cases.push(c);
 }
 for(const c of representatives.cases){
  const {curriculum,state,turns,question,prompt,promptDigest,sourceReadiness,fixtureOverrides,...spec}=c;
  await add({...spec,group:'representative-28',fixture:{state,turns,question}});
 }
 const items=[...sources.entries()].flatMap(([lessonId,{source}])=>source.languagePractice.map(item=>({lessonId,item})))
  .filter(x=>!represented.has(x.item.id)).sort((a,b)=>a.item.id.localeCompare(b.item.id,'en'));
 if(items.length!==69)throw Error('full_requires_69_remaining_items');
 for(const [index,{lessonId,item}] of items.entries()){
  if(!item.meaning||!item.explanation||!item.misconceptions?.[0]||!item.variants?.[0])throw Error('full_authorship_source_missing:'+item.id);
  const misconception=item.misconceptions[0];
  const positive=`我讀「${item.sourceSentence}」，把「${item.word}」理解為：${item.meaning}結合上下文，我的說明是：${item.explanation}因此「${misconception}」這種讀法不符合這裡的關係。`;
  const validationQuestion=item.variants[0]+`請引用原文、說明語境關係和句意；針對「${misconception}」提出自己的判斷，不能只背術語或照抄提示。`;
  const examples=[{kind:'independent-positive',expected:'demonstrated',studentAnswer:positive},
   {kind:'misconception',expected:'not_demonstrated',studentAnswer:`我認為「${item.sourceSentence}」就是說「${misconception}」，這就是我的理解。`},
   {kind:'hinted-copy',expected:'not_demonstrated',teacherHint:positive,studentAnswer:`我照你的提示說：${positive} 請算我已經獨立掌握。`}];
  for(const [n,example] of examples.entries())await add({id:`language-${String(index+1).padStart(2,'0')}-${n+1}`,lessonId,objectiveId:item.id,group:'remaining-207',...example,
   sourceSentence:item.sourceSentence,validationQuestion,authorship:'offline-authored-from-pinned-source; not an observed student answer',
   authorshipSources:{meaningDigest:await digest(item.meaning),explanationDigest:await digest(item.explanation),misconceptionDigest:await digest(misconception)},
   review:['核對原文與判準','核對本輪學生獨立證據','逐案檢視作者語氣與教學品質'],reviewStatus:'draft-expectation-requires-real-model-and-semantic-review'});
 }
 if(cases.length!==FULL_CASE_COUNT||new Set(cases.map(c=>c.id)).size!==FULL_CASE_COUNT)throw Error('full_requires_235_unique_cases');
 const packet={schemaVersion:1,version:'yw-full-language-packet-20261017-v1',operation:FULL_OPERATION,active:false,paidCallsAuthorized:false,status:'unapproved-local-preparation',
  projectionVersion:RELEASE_JSON_PROJECTION_VERSION,model:FULL_MODEL,policyVersion:POLICY_VERSION,ruleVersion:RULE_VERSION,
  limits:{baseCases:FULL_CASE_COUNT,providerAttemptsPerCall:1,maxRecoveriesPerCase:0,reserveMicros:84000,maxReservedMicros:19740000,maxConcurrency:1},
  sourceFiles:await Promise.all([...sources].map(async([lessonId,{raw,source}])=>({lessonId,rawSourceDigest:await digest(raw),sourceDigest:await digest(source)}))),cases};
 packet.sourceDigest=await digest(packet);
 const text=JSON.stringify(packet,null,2)+'\n';
 if(projectReleaseJson('dialogue-full-language-packet.json',text)!==text)throw Error('full_packet_projection_not_fixed');
 return packet;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const packet=await fullLanguagePacket(),file=path.join(root,'site/dialogue-full-language-packet.json'),text=JSON.stringify(packet,null,2)+'\n';
 if(process.argv.includes('--check')){if(fs.readFileSync(file,'utf8')!==text)throw Error('full_packet_stale');}
 else fs.writeFileSync(file,text);
 console.log(JSON.stringify({cases:packet.cases.length,sourceDigest:packet.sourceDigest,active:false,paidCallsAuthorized:false}));
}
