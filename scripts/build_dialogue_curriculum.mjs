import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const read = path => JSON.parse(fs.readFileSync(`site/data/${path}`));
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const taxonomy = read('literary-taxonomy.json');
const formal = read('learning-manifest.json');
const formative = read('lesson-competency-manifest.json');
const guides = read('study-guide-catalog.json');
const vocabIndex = read('vocab/index.json');
const pilotIds = ['lesson-1717-p2', 'lesson-1711-p1', 'lesson-1498'];
const eligibility = read('vocab-eligibility.json');
const references = JSON.parse(fs.readFileSync('scripts/dialogue-source-fixtures.json'));
// Parse the literal source table, never execute the application during generation.
const appSource = fs.readFileSync('site/assets/app.js','utf8');
const trackLiteral = appSource.match(/const MODE_TRACKS = (\{[\s\S]+?\n\});/);
assert(trackLiteral,'authoritative MODE_TRACKS missing');
const sourceTracks = JSON.parse(trackLiteral[1].replace(/^  ([a-z]+):/gm,'  "$1":').replace(/,\s*([}\]])/g,'$1'));
const formalDomains={contextWords:'context',structure:'structure',evaluation:'evaluation',authorQuestion:'authorQuestion',revision:'revision',vocabulary:'vocabulary',wordCreation:'wordCreation'};

const contracts = {
 context: ['初讀感受／粗讀感悟', '說出初讀印象、問題或困難；可質疑，不要求指定情感。', ['initial_response']],
 firstRead: ['無注疏初讀', '保留原無注疏初讀、疑點標記與解惑紀錄；在對話引用原記錄。', ['initial_response','uncertainty']],
 vocabulary: ['字詞累積／詞級疏通', '回到原句，自述語境義及依據；每個必考詞分別核對。', ['context_meaning','explanation']],
 read: ['通讀正文', '學生確認通讀，只作參與紀錄，不推論掌握。', ['reading_confirmation']],
 revision: ['字句之改', '原句、增刪調後的句子及效果比較。', ['original','revision','effect']],
 structure: ['文章技法／章法', '指出具體文本選擇、至少兩處證據、效果及目的；技法名稱不足。', ['choice','effect','purpose','textual_evidence']],
 evaluation: ['篇目評價', '保留自評；不要求正面感受，不加分。', ['personal_evaluation']],
 authorQuestion: ['叩問作者／遷移追問', '回應或質疑作品立場，並用文本及當代情境說明。', ['position','evidence','transfer']],
 transfer: ['高考關聯', '以原創練習檢驗解釋、整合、分析與遷移；真題須有已核實年份、卷名、題號、原頁。', ['interpretation','integration','transfer']],
 wordCreation: ['字詞創作', '選一個剛疏通的詞，用於三行短詩（詩歌）、三句對白（戲劇）、三句微型敘事（小說）或三句話；核對詞義、語境及搭配。', ['context_meaning','creation','fit']],
 shangyou: ['尚友', '初讀與現在理解的變化、支持證據、認同或質疑；不以同意作者為完成條件。', ['change','evidence','challenge']],
};
function flat(block) { return (block.runs||[]).map(r=>r.text||'').join('') || (block.blocks||block.items||[]).map(b=>Array.isArray(b)?b.map(flat).join('\n'):flat(b)).join('\n'); }
function vocabularyVariants(v){
 assert(v.question && Array.isArray(v.options) && Number.isInteger(v.answerIndex) && v.options[v.answerIndex],`missing original question contract: ${v.id}`);
 const original=`語境：「${v.sourceSentence}」\n${v.question}\n${v.options.map((text,i)=>`${String.fromCharCode(65+i)}. ${text}`).join('\n')}\n請選出答案，並用自己的話說明判斷依據。`;
 const alternate={
  pronunciation:`「${v.sourceSentence}」中的「${v.word}」應如何讀（請寫拼音）？它在此處是甚麼意思？請說明依據。`,
  'gu-jin':`回到「${v.sourceSentence}」：「${v.word}」在這裡是甚麼意思？比較它與你熟悉的現代用法，說明照搬現代義會出現甚麼問題。`,
  substitution:`請用恰當的現代說法替換「${v.sourceSentence}」中的「${v.word}」，並解釋這個替換如何保留原句的意思。`,
  usage:`請改寫「${v.sourceSentence}」的句意，解釋「${v.word}」在句中的用法及語境依據；只報詞性名稱不足以說明。`,
  interpretation:`「${v.sourceSentence}」中的「${v.word}」如何幫助你理解這句話？請解釋它的語境義，並說明你的理由。`,
  'contextual-choice':`請解釋「${v.sourceSentence}」中「${v.word}」的意思，再用自己的話改寫這句話，說明語境依據。`,
 }[v.type];
 assert(alternate,`unmapped vocabulary type: ${v.type}`);
 return [original,alternate];
}
const inventory = taxonomy.lessons.map(meta => {
 const lesson=read(`lessons/${meta.id}.json`);
 const mode=['whole-book','language-activity','review'].includes(meta.mode)?'unit-task':['speech-letter','modern-prose'].includes(meta.mode)?'argument':meta.mode;
 const activeVocabulary=vocabIndex.activeItemIds[meta.id]||[];
 const hasVocabulary=activeVocabulary.length>0 && (eligibility.defaultEligibleModes.includes(meta.mode)||eligibility.exceptions.some(e=>e.lessonId===meta.id&&activeVocabulary.includes(e.itemId)));
 const definitions=(sourceTracks[mode]||sourceTracks.argument).filter(([key])=>key!=='vocabulary'||hasVocabulary);
 const track=definitions.map(([key])=>key);
 const items=formal.items.filter(x=>x.sourceId===meta.id);
 const competencies=formative.lessons.find(x=>x.lessonId===meta.id)?.competencies||[];
 const guide=guides.lessons.find(x=>x.lessonId===meta.id);
 return {lessonId:meta.id,title:meta.title,mode:meta.mode,legacyTracks:track,legacyTrackDefinitions:definitions,
  formal:items.map(x=>({resourceKey:x.resourceKey,canonicalUnitId:x.canonicalUnitId,resourceVersion:x.resourceVersion,questionKind:x.questionKind,scoringRole:x.evidenceRole})),
  formative:competencies.flatMap(c=>c.items.map(i=>({...i,competencyTag:c.competencyTag}))),
  vocabularyIds:vocabIndex.activeItemIds[meta.id]||[],
  studyGuide: (guide?.items||[]).map(i=>({itemKey:i.itemKey,active:i.activeForSelfTest,reviewRequired:i.reviewRequired,semanticRevision:i.semanticRevision,pdfPage:i.pdfPage,printedPage:i.printedPage,competencyTag:i.competencyTag})),
  sourceGaps:guide?.sourceGaps||[],
  sourceTasks:lesson.learningTasks||[],
  requirementMappings:[
   ...items.map(i=>{const domain=formalDomains[i.questionKind];assert(domain,`unknown formal kind ${i.questionKind}`);return {requirementId:i.resourceKey,sourceVersion:i.resourceVersion,source:'formal',dialogueDomain:domain,conversationEquivalent:contracts[domain][1],evidenceRule:'保留既有題意、輸入格式與服務端 rubric；新回合的引文、判準與原文必須可核對。舊達標證據不重考、不重評。',storage:pilotIds.includes(meta.id)?'original source submissions/evaluations/outbox + dialogue turns/events committed together; historical grades unchanged; new mastery separate':'legacy learning_interactions/learning_evaluations unchanged; new dialogue_turns/dialogue_assessments separate',status:pilotIds.includes(meta.id)?(i.questionKind==='vocabulary'?'original-selectedIndex-answer-key-bridged':i.questionKind==='evaluation'?'original-non-scoring-self-report-bridged':'student-quote-confirmation-original-rubric-bridged'):'inventory-complete; consequential-equivalence-bridge-not-implemented'};}),
   ...competencies.flatMap(c=>c.items.map(i=>({requirementId:i.itemKey,completionKey:i.completionKey,source:i.sourceKind,dialogueDomain:i.sourceKind==='formal_learning_manifest'?formalDomains[i.interactionKey]||'review':c.competencyTag,conversationEquivalent:i.sourceKind==='formal_learning_manifest'?'引用同一 formal resource 的對話證據，不重複計分。':'以原學案題幹及原準據提問，保留獨立回答與回饋。',evidenceRule:'沿用 completionKey、answerAuthority、semanticRevision；不以次數或 AI 讚美判定。',storage:'existing formative/source records unchanged; dialogue_assessments references',status:pilotIds.includes(meta.id)&&i.sourceKind==='formal_learning_manifest'?'same-original-formal-receipt-no-duplicate-score':'preserved-source; dialogue-bridge-not-implemented'}))),
   ...(guide?.items||[]).map(i=>({requirementId:i.itemKey,source:'study-guide',active:i.activeForSelfTest,sourceVersion:i.semanticRevision,dialogueDomain:i.competencyTag,conversationEquivalent:i.prompt,evidenceRule:i.rubric?.length?i.rubric:'沿用既有來源參考答案及評價規則；reviewRequired 項仍須覆核。',sourcePage:{pdf:i.pdfPage,printed:i.printedPage},storage:'existing study-guide assessment unchanged; dialogue evidence separate',status:i.activeForSelfTest?'preserved-source; dialogue-bridge-not-implemented':'inactive-preserved-not-reactivated'})),
  ],
  compoundRequirements:meta.mode==='classical'?[{id:'unannotated-first-read',rule:'原初讀提交、至少一個疑點且全部解惑；vocabulary/syntax 學案完成才計詞級；comprehension 學案完成才計章法。',storage:'classical_first_read_sessions/classical_first_read_marks and source study-guide records',status:pilotIds.includes(meta.id)?'source-first-read-gate-bridged; formal-study-guide-bridge-pending':'preserved-in-original-flow; new-flow-bridge-not-implemented'}]:meta.mode==='poetry'&&hasVocabulary?[{id:'poetry-word-creation',rule:contracts.wordCreation[1],storage:'original wordCreation record + separate new dialogue evidence',status:pilotIds.includes(meta.id)?'original-word-creation-rubric-bridged-new-mastery-separate':'dialogue-proposal-no-grade-write'}]:[],
  sourceLesson:`data/lessons/${meta.id}.json`,
  mapping:track.map(key=>({legacy:key,dialogueDomain:key,evidenceRule:contracts[key][1],storage:'dialogue_assessments + dialogue_turns; legacy tables unchanged'})),
 };
});
const nonVisibleSources=fs.readdirSync('site/data/lessons').filter(f=>f.endsWith('.json')&&!inventory.some(l=>f===l.lessonId+'.json')).map(f=>{const v=read('lessons/'+f);return {lessonId:v.id,title:v.title,sourcePath:'data/lessons/'+f,sha256:hash(v),disposition:'preserved_existing_nonvisible_or_composite_source; not silently assigned new requirements'};});
const mapping={schemaVersion:1,nonVisibleSources,policy:'additive-dialogue-v2-original-source-only-no-regrade',sourcePins:{formal:formal.manifestVersion,formative:formative.manifestVersion,guides:guides.catalogVersion,taxonomy:hash(taxonomy),trackDefinitions:hash(sourceTracks),vocabularyEligibility:eligibility.policyVersion},legacyPolicy:{itemCount:formal.itemCount,thresholdPercent:formal.thresholdPercent,unchanged:true},lessons:inventory};
const write=(path,data)=>{const bytes=JSON.stringify(data,null,2)+'\n';if(process.argv.includes('--check'))assert.equal(fs.readFileSync(path,'utf8'),bytes,path);else fs.writeFileSync(path,bytes);};
write('docs/dialogue/requirement-map.json',mapping);
for(const id of pilotIds){
 const meta=taxonomy.lessons.find(l=>l.id===id), row=inventory.find(l=>l.lessonId===id);
 const lesson=read(`lessons/${id}.json`), reader=read(`reader-documents/${id}.json`), vocab=read(`vocab/${id}.json`);
 const roles=references.textRoleCuration?.lessons[id]||[];
 for(const role of roles)assert.equal(hash(reader.main.blocks[role.blockIndex]),role.blockSha256,`text role source drift: ${id}:${role.blockIndex}`);
 const sourceBlocks=reader.main.blocks.map((block,i)=>({id:`${id}:p${i+1}`,text:flat(block),block,curation:roles.find(r=>r.blockIndex===i)})).filter(p=>p.text.trim());
 const passages=sourceBlocks.filter(p=>!p.curation).map(({curation,...p})=>p);
 const readingMaterials=sourceBlocks.filter(p=>p.curation).map(({curation,...p})=>({...p,...curation}));
 const objectives=[...row.legacyTracks.filter(k=>k!=='vocabulary'),...(row.formal.some(i=>i.questionKind==='wordCreation')?['wordCreation']:[]),'transfer','shangyou'].map(key=>({id:`${id}:${key}`,domain:key,label:contracts[key][0],criteria:contracts[key][2],rule:contracts[key][1],prerequisites:key==='shangyou'?['other_objectives']:[],sourcePassages:passages.map(p=>p.id),misconceptions:['迎合作者不等於理解','引用不能替代解釋'],remediation:'回到一處原句，比較兩種讀法，再請學生獨立改述。'}));
 const vocabulary=vocab.inventory.filter(v=>row.vocabularyIds.includes(v.id)).map(v=>({id:v.id,word:v.word,sourceSentence:v.sourceSentence,meaning:v.contextMeaning,explanation:v.explanation,type:v.type,difficulty:v.difficulty,question:v.question,options:v.options,answerIndex:v.answerIndex,sourceAnswer:v.options[v.answerIndex],sourceRefs:v.sourceRefs,version:vocab.questionSetVersion||hash(v),dictionaryStatus:'verify-context-against-source-image',variants:vocabularyVariants(v)}));
 for(const v of vocabulary)objectives.push({id:v.id,domain:'vocabulary',label:`字詞：${v.word}`,criteria:['source_answer','context_meaning','explanation','independent'],rule:`沿用原題準據：${v.sourceAnswer}。語境義：${v.meaning}。${v.explanation||''}${v.type==='pronunciation'?' 讀音題必須核對拼音，不能僅以詞義代替。':''}`,sourcePassages:passages.filter(p=>p.text.includes(v.word)).map(p=>p.id),prerequisites:[],misconceptions:['照抄提示不算獨立掌握'],remediation:'解釋、語境比較、學生改述，然後新的等值提問；三次未掌握转教師覆核。'});
 if(!vocabulary.length)objectives.push({id:`${id}:vocabulary`,domain:'vocabulary',label:contracts.vocabulary[0],criteria:contracts.vocabulary[2],rule:contracts.vocabulary[1],sourcePassages:passages.map(p=>p.id),prerequisites:[]});
 for(const item of row.formal)objectives.push({id:`legacy:${item.resourceKey}`,domain:'legacy',label:item.questionKind,criteria:['existing_source_assessment'],rule:'由既有來源評價讀回；對話模型不得替代、重算或直接寫舊成績。',legacy:item});
 for(const g of (guides.lessons.find(x=>x.lessonId===id)?.items||[]).filter(g=>g.activeForSelfTest)) objectives.push({id:`study:${g.itemKey}`,domain:'studyGuide',label:g.prompt,criteria:['existing_source_assessment'],rule:'保留原學案題意及評價準據；未接既有服務端評價前保留待核對。',sourceItemKey:g.itemKey});
 const languagePractice=(references.languageItems[id]||[]).map(item=>{
  for(const noteId of item.annotationIds)assert(reader.main.annotations.some(a=>a.noteId===noteId),`missing textbook annotation ${noteId}`);
  if(item.dictionaryId)assert(references.dictionary.some(d=>d.id===item.dictionaryId),`missing dictionary ${item.dictionaryId}`);
  return {...item,assessmentStatus:'teaching-reference-only-awaiting-calibration'};
 });
 const dictionary=references.dictionary.filter(d=>languagePractice.some(i=>i.dictionaryId===d.id));
 const data={schemaVersion:1,lessonId:id,title:meta.title,mode:meta.mode,author:meta.authors[0]?.name||'作品傳統',persona:{kind:meta.authors.length===1?'author-simulation':'collective-simulation',notice:'AI 教學模擬，依據作品；並非作者本人。',narratorIsAuthor:false,rule:'以作者第一人稱討論文本選擇；不得把抒情主人公或敘述者的經歷當作作者生平。'},passages,annotations:reader.main.annotations,resources:reader.resources,source:lesson.forumUrl,objectives,vocabulary,legacy:row,referenceVersion:references.version,languagePractice,dictionary,exam:{status:'original-practice-with-publisher-cited-examples',reason:'練習仍為原創；下列僅是北京考試報引用真題的題意與能力關聯，不提供原試卷或官方評分細則。',examples:references.examExamples},curriculumVersion:''};
 data.readingMaterials=readingMaterials;data.textRoleVersion=references.textRoleCuration?.version||null;
 data.curriculumVersion='yw-dialogue-'+hash(data).slice(0,20);
 write(`site/dialogue-curriculum/${id}.json`,data);
}
console.log(JSON.stringify({lessons:inventory.length,formalResources:inventory.reduce((n,l)=>n+l.formal.length,0),formativeResources:inventory.reduce((n,l)=>n+l.formative.length,0),activeStudyGuideItems:inventory.reduce((n,l)=>n+l.studyGuide.filter(x=>x.active).length,0),pilots:pilotIds}));
