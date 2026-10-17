import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import path from 'node:path';
import {validateGrammarSourceReview} from './dialogue_grammar_source_review.mjs';
import {materializeCalibrationOverlay} from './dialogue_calibration_import.mjs';
const read = path => JSON.parse(fs.readFileSync(`site/data/${path}`));
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const taxonomy = read('literary-taxonomy.json');
const formal = read('learning-manifest.json');
const formative = read('lesson-competency-manifest.json');
const guides = read('study-guide-catalog.json');
const vocabIndex = read('vocab/index.json');
// These three examples are calibration fixtures, never a curriculum boundary.
const representativeIds = ['lesson-1717-p2', 'lesson-1711-p1', 'lesson-1498'];
const corpusCuration = JSON.parse(fs.readFileSync('scripts/dialogue-curriculum-curation.json'));
const curricula = [];
const isTeachingUnit = meta => ['unit-intro','unit-task','language-activity','whole-book','review'].includes(meta.mode);
const eligibility = read('vocab-eligibility.json');
const references = JSON.parse(fs.readFileSync('scripts/dialogue-source-fixtures.json'));
const languageCorpus = JSON.parse(fs.readFileSync('scripts/dialogue-language-corpus.json'));
const dictionarySources = [...references.dictionary,...languageCorpus.dictionary];
assert.equal(new Set(dictionarySources.map(d=>d.id)).size,dictionarySources.length,'duplicate dictionary ids');
assert.equal(languageCorpus.scoringRole,'none');
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
function flat(block) { return block.text || (block.runs||[]).map(r=>r.text||'').join('') || (block.blocks||block.items||block.rows||[]).map(b=>Array.isArray(b)?b.map(flat).join('\n'):flat(b)).join('\n'); }
function vocabularyVariants(v){
 assert(v.question && Array.isArray(v.options) && Number.isInteger(v.answerIndex) && v.options[v.answerIndex],`missing original question contract: ${v.id}`);
 const original=`語境：「${v.sourceSentence}」\n${v.question}\n${v.options.map((text,i)=>`${String.fromCharCode(65+i)}. ${text}`).join('\n')}\n請選出答案，並用自己的話說明判斷依據。`;
 const alternate={
  discrimination:`請比較以下各項在原句中的意思：\n${v.options.map((text,i)=>`${String.fromCharCode(65+i)}. ${text}`).join('\n')}\n${v.question}。選出一項後逐一說明比較依據，不能只報字母。`,
  evidence:`根據「${v.sourceSentence}」，判斷：${v.question}\n${v.options.map((text,i)=>`${String.fromCharCode(65+i)}. ${text}`).join('\n')}\n請說明所選說法與原句如何對應。`,
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
  formal:items.map(x=>({resourceKey:x.resourceKey,canonicalUnitId:x.canonicalUnitId,resourceVersion:x.resourceVersion,questionKind:x.questionKind,scoringRole:x.evidenceRole,sourceReleaseId:x.sourceReleaseId,...(x.effectiveFrom?{effectiveFrom:x.effectiveFrom}:{}),...(x.formalScopePolicyVersion?{formalScopePolicyVersion:x.formalScopePolicyVersion}:{})})),
  formative:competencies.flatMap(c=>c.items.map(i=>({...i,competencyTag:c.competencyTag}))),
  vocabularyIds:vocabIndex.activeItemIds[meta.id]||[],
  studyGuide: (guide?.items||[]).map(i=>({itemKey:i.itemKey,active:i.activeForSelfTest,reviewRequired:i.reviewRequired,semanticRevision:i.semanticRevision,pdfPage:i.pdfPage,printedPage:i.printedPage,competencyTag:i.competencyTag})),
  sourceGaps:guide?.sourceGaps||[],
  sourceTasks:lesson.learningTasks||[],
  requirementMappings:[
   ...items.map(i=>{const domain=formalDomains[i.questionKind];assert(domain,`unknown formal kind ${i.questionKind}`);return {requirementId:i.resourceKey,sourceVersion:i.resourceVersion,source:'formal',dialogueDomain:domain,conversationEquivalent:contracts[domain][1],evidenceRule:'保留既有題意、輸入格式與服務端 rubric；新回合的引文、判準與原文必須可核對。舊達標證據不重考、不重評。',storage:'original source submissions/evaluations/outbox + dialogue turns/events; historical grades unchanged; new mastery separate',status:i.questionKind==='vocabulary'?'original-selectedIndex-answer-key-bridged':i.questionKind==='evaluation'?'original-non-scoring-self-report-bridged':'student-quote-confirmation-original-rubric-bridged'};}),
   ...competencies.flatMap(c=>c.items.map(i=>({requirementId:i.itemKey,completionKey:i.completionKey,source:i.sourceKind,dialogueDomain:i.sourceKind==='formal_learning_manifest'?formalDomains[i.interactionKey]||'review':c.competencyTag,conversationEquivalent:i.sourceKind==='formal_learning_manifest'?'引用同一 formal resource 的對話證據，不重複計分。':'以原學案題幹及原準據提問，保留獨立回答與回饋。',evidenceRule:'沿用 completionKey、answerAuthority、semanticRevision；不以次數或 AI 讚美判定。',storage:'existing formative/source records unchanged; dialogue_assessments references',status:i.sourceKind==='formal_learning_manifest'?'same-original-formal-receipt-no-duplicate-score':i.sourceKind==='classical_first_read'?'original-first-read-process-bridged-no-new-score':i.sourceKind==='study_guide'?'original-study-guide-evaluator-bridged':'preserved-source-process'}))),
   ...(guide?.items||[]).map(i=>({requirementId:i.itemKey,source:'study-guide',active:i.activeForSelfTest,sourceVersion:i.semanticRevision,dialogueDomain:i.competencyTag,conversationEquivalent:i.prompt,evidenceRule:i.rubric?.length?i.rubric:'沿用既有來源參考答案及評價規則；reviewRequired 項仍須覆核。',sourcePage:{pdf:i.pdfPage,printed:i.printedPage},storage:'existing study-guide assessment unchanged; dialogue evidence separate',status:i.activeForSelfTest?'original-study-guide-evaluator-bridged':'inactive-preserved-not-reactivated'})),
  ],
  compoundRequirements:meta.mode==='classical'?[{id:'unannotated-first-read',rule:'原初讀提交、依既有初讀門檻標記疑點且全部解惑；vocabulary/syntax 學案完成才計詞級；comprehension 學案完成才計章法。',storage:'classical_first_read_sessions/classical_first_read_marks and source study-guide records',status:'source-first-read-gate-and-original-study-guide-bridged'}]:meta.mode==='poetry'&&hasVocabulary?[{id:'poetry-word-creation',rule:contracts.wordCreation[1],storage:'original wordCreation record + separate new dialogue evidence',status:'original-word-creation-rubric-bridged-new-mastery-separate'}]:[],
  sourceLesson:`data/lessons/${meta.id}.json`,
  mapping:track.map(key=>({legacy:key,dialogueDomain:key,evidenceRule:contracts[key][1],storage:'dialogue_assessments + dialogue_turns; legacy tables unchanged'})),
 };
});
const nonVisibleSources=fs.readdirSync('site/data/lessons').filter(f=>f.endsWith('.json')&&!inventory.some(l=>f===l.lessonId+'.json')).map(f=>{const v=read('lessons/'+f);return {lessonId:v.id,title:v.title,sourcePath:'data/lessons/'+f,sha256:hash(v),disposition:'preserved_existing_nonvisible_or_composite_source; not silently assigned new requirements'};});
const mapping={schemaVersion:1,formalScopeExpansion:formal.formalScopeExpansion||null,nonVisibleSources,policy:'additive-dialogue-v2-original-source-only-no-regrade',sourcePins:{formal:formal.manifestVersion,formative:formative.manifestVersion,guides:guides.catalogVersion,taxonomy:hash(taxonomy),trackDefinitions:hash(sourceTracks),vocabularyEligibility:eligibility.policyVersion},legacyPolicy:{itemCount:formal.itemCount,thresholdPercent:formal.thresholdPercent,unchanged:true},lessons:inventory};
const write=(file,data)=>{const bytes=JSON.stringify(data,null,2)+'\n';if(process.argv.includes('--check'))assert.equal(fs.readFileSync(file,'utf8'),bytes,file);else {fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);}};
for(const {id} of taxonomy.lessons){
 const meta=taxonomy.lessons.find(l=>l.id===id), row=inventory.find(l=>l.lessonId===id);
 const lesson=read(`lessons/${id}.json`), reader=read(`reader-documents/${id}.json`);
 const vocabPath=`site/data/vocab/${id}.json`;
 const vocab=fs.existsSync(vocabPath)?JSON.parse(fs.readFileSync(vocabPath)):{inventory:[]};
 assert(!row.vocabularyIds.length||fs.existsSync(vocabPath),`active vocabulary source missing: ${id}`);
 const roles=[...(references.textRoleCuration?.lessons[id]||[]),...(corpusCuration.lessons[id]||[])];
 assert.equal(new Set(roles.map(r=>r.blockIndex)).size,roles.length,`duplicate role: ${id}`);
 for(const role of roles)assert.equal(hash(reader.main.blocks[role.blockIndex]),role.blockSha256,`text role source drift: ${id}:${role.blockIndex}`);
 const sourceBlocks=reader.main.blocks.map((block,i)=>({id:`${id}:p${i+1}`,text:flat(block),block,curation:roles.find(r=>r.blockIndex===i)}));
 const passages=sourceBlocks.filter(p=>!p.curation&&p.text.trim()).map(({curation,...p})=>p);
 const structuralBlocks=sourceBlocks.filter(p=>!p.curation&&!p.text.trim()).map(({curation,...p})=>p);
 const readingMaterials=sourceBlocks.filter(p=>p.curation).map(({curation,...p})=>({...p,...curation}));
 for(const attribution of corpusCuration.passageAttributions[id]||[]){
  assert.equal(hash(reader.main.blocks[attribution.headingBlockIndex]),attribution.headingBlockSha256,`attribution source drift: ${id}`);
  for(const index of attribution.blockIndices){const passage=passages.find(p=>p.id===`${id}:p${index+1}`);assert(passage,`attributed passage missing: ${id}:${index}`);passage.attribution={author:attribution.author,work:attribution.work,sourceHeading:`${id}:p${attribution.headingBlockIndex+1}`};}
 }
 const objectives=[...row.legacyTracks.filter(k=>k!=='vocabulary'),...(row.formal.some(i=>i.questionKind==='wordCreation')?['wordCreation']:[]),'transfer','shangyou'].map(key=>({id:`${id}:${key}`,domain:key,label:contracts[key][0],criteria:contracts[key][2],rule:contracts[key][1],prerequisites:key==='shangyou'?['other_objectives']:[],sourcePassages:passages.map(p=>p.id),misconceptions:['迎合作者不等於理解','引用不能替代解釋'],remediation:'回到一處原句，比較兩種讀法，再請學生獨立改述。'}));
 const vocabulary=vocab.inventory.filter(v=>row.vocabularyIds.includes(v.id)).map(v=>({id:v.id,word:v.word,sourceSentence:v.sourceSentence,meaning:v.contextMeaning,explanation:v.explanation,type:v.type,difficulty:v.difficulty,question:v.question,options:v.options,answerIndex:v.answerIndex,sourceAnswer:v.options[v.answerIndex],sourceRefs:v.sourceRefs,version:vocab.questionSetVersion||hash(v),dictionaryStatus:'verify-context-against-source-image',variants:vocabularyVariants(v)}));
 for(const v of vocabulary)objectives.push({id:v.id,domain:'vocabulary',label:`字詞：${v.word}`,criteria:['source_answer','context_meaning','explanation','independent'],rule:`沿用原題準據：${v.sourceAnswer}。語境義：${v.meaning}。${v.explanation||''}${v.type==='pronunciation'?' 讀音題必須核對拼音，不能僅以詞義代替。':''}`,sourcePassages:passages.filter(p=>p.text.includes(v.word)).map(p=>p.id),prerequisites:[],misconceptions:['照抄提示不算獨立掌握'],remediation:'解釋、語境比較、學生改述，然後新的等值提問；三次未掌握转教師覆核。'});
 // A lesson without registered vocabulary does not acquire an invented mastery gate.
 for(const item of row.formal)objectives.push({id:`legacy:${item.resourceKey}`,domain:'legacy',label:item.questionKind,criteria:['existing_source_assessment'],rule:'由既有來源評價讀回；對話模型不得替代、重算或直接寫舊成績。',legacy:item});
 for(const g of (guides.lessons.find(x=>x.lessonId===id)?.items||[]).filter(g=>g.activeForSelfTest)) objectives.push({id:`study:${g.itemKey}`,domain:'studyGuide',label:g.prompt,criteria:['existing_source_assessment'],rule:'保留原學案題意及評價準據；未接既有服務端評價前保留待核對。',sourceItemKey:g.itemKey});
 const languageItems=[...(references.languageItems[id]||[]),...(languageCorpus.languageItems[id]||[])];
 assert.equal(new Set(languageItems.map(i=>i.id)).size,languageItems.length,`duplicate language ids: ${id}`);
 const languagePractice=languageItems.map(item=>{
  validateGrammarSourceReview(item,{reader,passages,readingMaterials});
  if(item.sourceEvidence){assert.equal(item.sourceEvidence.readerSha256,hash(reader),`language reader drift: ${id}:${item.id}`);const source=passages.find(p=>p.id===item.sourceEvidence.passageId);assert(source,`language passage missing: ${id}:${item.id}`);assert.equal(item.sourceEvidence.passageSha256,hash(source),`language passage drift: ${id}:${item.id}`);assert.equal(item.scoringRole,'none');assert.equal(item.calibrationStatus,'pending-real-model');assert.equal(item.masteryCriteria.length,3);}
  for(const noteId of item.annotationIds)assert(reader.main.annotations.some(a=>a.noteId===noteId),`missing textbook annotation ${noteId}`);
  if(item.dictionaryId)assert(dictionarySources.some(d=>d.id===item.dictionaryId),`missing dictionary ${item.dictionaryId}`);
  const sourcePassages=passages.filter(p=>item.passageQuotes.some(q=>p.text.includes(q))).map(p=>p.id);
  for(const quote of item.passageQuotes)assert(passages.some(p=>p.text.includes(quote)),`language source drift: ${id}:${item.id}`);
  assert(item.variants.length>=2 && new Set(item.variants).size===item.variants.length,`language variants: ${item.id}`);
  const language={...item,id:`${id}:${item.id}`,sourcePassages,version:'yw-language-'+hash({item,dictionary:dictionarySources.find(d=>d.id===item.dictionaryId)||null}).slice(0,20),assessmentStatus:'separate-unscored-mastery-awaiting-calibration'};
  objectives.push({id:language.id,domain:'vocabulary',label:`語言：${item.word}${item.sourceVerification?.status==='pending-verification'?'（待核驗）':''}`,criteria:['context_meaning','explanation','independent'],rule:`${item.sourceVerification?.notice||''} ${item.meaning} ${item.explanation} 本項只記新對話證據，不改原有分數；來源或模型校準未完成時必須覆核。`,sourcePassages,prerequisites:[],misconceptions:item.misconceptions,remediation:'說明、語境比較、學生改述後再作新等值題；最多三次後保留原話供覆核。',scoringRole:'none'});
  return language;
 });
 const dictionary=dictionarySources.filter(d=>languagePractice.some(i=>i.dictionaryId===d.id));
 const authorOverride=corpusCuration.personas[id];
 const author=authorOverride?.author||(meta.authors.length?meta.authors.map(a=>a.name).join('、'):isTeachingUnit(meta)?'教材學習引導':'原作未署個人作者');
 const personaKind=authorOverride?.kind||(isTeachingUnit(meta)?'curriculum-guide':meta.authors.length===1&&meta.authors[0].evidence==='toc'?'author-simulation':'source-guide');
 const persona={kind:personaKind,notice:personaKind==='author-simulation'?'AI 教學模擬，依據作品；並非作者本人。':'AI 閱讀引導，依據原教材與已署名來源；不冒充作者。',narratorIsAuthor:false,rule:personaKind==='author-simulation'?'以作者第一人稱討論文本選擇；不得把抒情主人公、角色、引文說話者或敘述者的經歷當作作者生平。譯作須區分原作者、譯者與編者。':'以閱讀引導者身份討論來源，逐一區分作者、引文說話者、人物、譯者與教材編者；不得把代表人物或被引述者冒充作者。',source:authorOverride?.source||'data/literary-taxonomy.json',attribution:authorOverride?.reason||'保留原目錄署名；無獨立署名或多人作品採閱讀引導。'};
 const data={schemaVersion:1,lessonId:id,title:meta.title,mode:meta.mode,author,persona,passages,annotations:reader.main.annotations,resources:reader.resources,source:lesson.forumUrl,objectives,vocabulary,legacy:row,referenceVersion:references.version,languageCorpusVersion:languageCorpus.version,languagePractice,dictionary,exam:{status:'original-practice-with-publisher-cited-examples',reason:'練習仍為原創；下列僅是北京考試報引用真題的題意與能力關聯，不提供原試卷或官方評分細則。',examples:references.examExamples},curriculumVersion:''};
 data.formalScopeExpansion=formal.formalScopeExpansion||null;
 data.readingMaterials=readingMaterials;data.structuralBlocks=structuralBlocks;data.textRoleVersion=corpusCuration.version;
 data.frontMatter=reader.main.frontMatter;data.guidance=reader.main.guidance;data.media=reader.main.media;data.sourceOnlyBlocks=reader.main.sourceOnlyBlocks;
 data.studyGuide=guides.lessons.find(x=>x.lessonId===id)?.items||[];
 data.sourceInventory={lesson:row.sourceLesson,lessonSha256:hash(lesson),reader:`data/reader-documents/${id}.json`,readerSha256:hash(reader),sourcePostId:reader.main.sourcePostId,sourcePostNumber:reader.main.sourcePostNumber,blockCount:reader.main.blocks.length,annotationCount:reader.main.annotations.length,curationVersion:reader.curationVersion,roleAuditVersion:reader.roleAuditVersion};
 const classicalLanguage=meta.mode==='classical'||meta.mode==='poetry'&&!meta.genres.some(g=>['modern-poetry','foreign-poetry'].includes(g));
 const activeGuides=data.studyGuide.filter(g=>g.activeForSelfTest);
 const areaSources={vocabulary:vocabulary.map(v=>v.id).concat(activeGuides.filter(g=>g.competencyTag==='vocabulary').map(g=>g.itemKey)),functionWords:languagePractice.filter(l=>l.type==='function-word').map(l=>l.id).concat(activeGuides.filter(g=>/function[_-]word/.test(g.detailTag||'')).map(g=>g.itemKey)),grammar:languagePractice.filter(l=>l.type==='grammar').map(l=>l.id).concat(vocabulary.filter(v=>v.type==='usage').map(v=>v.id),activeGuides.filter(g=>g.competencyTag==='syntax').map(g=>g.itemKey))};
 const missingAreas=classicalLanguage?Object.entries(areaSources).filter(([,ids])=>!ids.length).map(([area])=>area):[];
 data.sourceStatus=passages.length?'source-ready':'source-unavailable';
 const completionExemption=corpusCuration.completionExemptions?.[id];
 if(completionExemption){assert.equal(id,'lesson-1572');assert.equal(completionExemption.lessonId,id);assert.equal(completionExemption.scoringRole,'none');data.completionExemption=completionExemption;}
 data.coverage={source:{status:data.sourceStatus,reason:passages.length?null:'原課只有附件或參考資料，沒有可核對正文；保留來源、既有任務與歷史，不以附件名稱作評價。'},persona:{kind:personaKind,attributionStatus:personaKind==='author-simulation'?'source-toc-attributed':'source-guide-no-impersonation'},originalObjectives:{tracks:row.legacyTracks,formalCount:row.formal.length,formativeCount:row.formative.length,activeStudyGuideCount:activeGuides.length,inactiveStudyGuideCount:data.studyGuide.length-activeGuides.length,policy:'original-identities-rubrics-grades-and-history-preserved'},classicalEssentials:{applicable:classicalLanguage,status:!classicalLanguage?'not-applicable':missingAreas.length?'source-coverage-gaps':'source-items-present-calibration-pending',areaSources,missingAreas,verifiedDictionaryIds:dictionary.filter(d=>d.verificationStatus==='source-image-verified').map(d=>d.id),dictionaryReview:'existing-references-preserved; supplemental-XC-page-scopes-visually-verified-in-dictionary-metadata',coverageScope:'per-lesson-area-presence-not-exhaustive-lexical-inventory',calibrationStatus:'not-established-by-curriculum-generation'},assessmentBridge:{status:'implementation-candidate',formal:'original-source-evaluator-and-answer-keys',studyGuide:'original-source-evaluator',firstRead:meta.mode==='classical'?'original-source-process':'not-applicable',reading:'original-non-scoring-acknowledgement'},sourceGaps:row.sourceGaps,reviewRequiredGuideIds:data.studyGuide.filter(g=>g.reviewRequired).map(g=>g.itemKey)};
 if(completionExemption)data.coverage.source.disposition='owner-approved-supplement-complete-no-score';
 row.coverage=data.coverage;
 data.sourceReviewRequired=!completionExemption&&(!passages.length||row.sourceGaps.length>0||data.coverage.reviewRequiredGuideIds.length>0||missingAreas.length>0);
 data.curriculumVersion='yw-dialogue-'+hash(data).slice(0,20);
 curricula.push(data);
}
// Optional source-controlled calibration data is reviewed with its exact
// source diff; compiling it never supplies semantic or publication authority.
const overlayPath='scripts/dialogue-calibration-overlay.json';
if(fs.existsSync(overlayPath)){
 const overlaid=await materializeCalibrationOverlay(curricula,JSON.parse(fs.readFileSync(overlayPath,'utf8')));
 curricula.splice(0,curricula.length,...overlaid);
}
// Validate the complete corpus before writing any generated curriculum.
for(const data of curricula)write(`site/dialogue-curriculum/${data.lessonId}.json`,data);
write('docs/dialogue/requirement-map.json',mapping);
const indexLessons=curricula.map(c=>{const meta=taxonomy.lessons.find(l=>l.id===c.lessonId);return {lessonId:c.lessonId,title:c.title,mode:c.mode,blockId:meta.blockId,blockTitle:meta.blockTitle,curriculumVersion:c.curriculumVersion,personaKind:c.persona.kind,status:c.sourceStatus,sourceReviewRequired:c.sourceReviewRequired,...(c.completionExemption?{completionExemption:c.completionExemption,completionLabel:'已通過（補充篇目）'}:{})};});
write('site/dialogue-curriculum/index.json',{schemaVersion:1,curriculumVersion:'yw-dialogue-catalog-'+hash(indexLessons).slice(0,20),lessons:indexLessons});
const expectedFiles=new Set(['index.json',...taxonomy.lessons.map(l=>l.id+'.json')]);
assert.deepEqual(fs.readdirSync('site/dialogue-curriculum').filter(f=>f.endsWith('.json')).sort(),[...expectedFiles].sort(),'unexpected curriculum assets require explicit disposition');
console.log(JSON.stringify({lessons:inventory.length,formalResources:inventory.reduce((n,l)=>n+l.formal.length,0),formativeResources:inventory.reduce((n,l)=>n+l.formative.length,0),activeStudyGuideItems:inventory.reduce((n,l)=>n+l.studyGuide.filter(x=>x.active).length,0),representativeIds,sourceUnavailable:curricula.filter(c=>c.sourceStatus==='source-unavailable').map(c=>c.lessonId),classicalCoverageGaps:curricula.filter(c=>c.coverage.classicalEssentials.missingAreas.length).map(c=>c.lessonId)}));
