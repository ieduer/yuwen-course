import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {grammarAnalysisHash,validateGrammarSourceReview} from './dialogue_grammar_source_review.mjs';
import {validateProposal} from '../site/dialogue-policy.js';

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const taxonomy = read('site/data/literary-taxonomy.json');
const formal = read('site/data/learning-manifest.json');
const formative = read('site/data/lesson-competency-manifest.json');
const guides = read('site/data/study-guide-catalog.json');
const vocabIndex = read('site/data/vocab/index.json');
const mapping = read('docs/dialogue/requirement-map.json');
const index = read('site/dialogue-curriculum/index.json');
const curricula = taxonomy.lessons.map(meta => read(`site/dialogue-curriculum/${meta.id}.json`));
const teachingModes = ['unit-intro', 'unit-task', 'language-activity', 'whole-book', 'review'];

test('dialogue catalog covers the complete current taxonomy, not only representative lessons', () => {
  assert.equal(taxonomy.lessons.length, 189);
  assert.deepEqual(index.lessons.map(l => l.lessonId), taxonomy.lessons.map(l => l.id));
  assert.equal(new Set(index.lessons.map(l => l.lessonId)).size, 189);
  assert.deepEqual(fs.readdirSync('site/dialogue-curriculum').sort(), ['index.json', ...taxonomy.lessons.map(l => `${l.id}.json`)].sort());
  for (const [i, c] of curricula.entries()) {
    const meta = taxonomy.lessons[i], entry = index.lessons[i];
    assert.equal(c.lessonId, meta.id);
    assert.equal(entry.title, meta.title);
    assert.equal(entry.blockId, meta.blockId);
    assert.equal(entry.blockTitle, meta.blockTitle);
    assert.equal(entry.curriculumVersion, c.curriculumVersion);
    assert.equal(entry.status, c.sourceStatus);
    assert.equal(entry.sourceReviewRequired, c.sourceReviewRequired);
    assert.equal(new Set(c.objectives.map(o => o.id)).size, c.objectives.length, c.lessonId);
  }
});

test('every original reader block, annotation and guidance survives role separation without rewriting source', () => {
  for (const c of curricula) {
    const reader = read(`site/data/reader-documents/${c.lessonId}.json`);
    const blocks = [...c.passages, ...c.readingMaterials, ...c.structuralBlocks];
    assert.equal(new Set(blocks.map(b => b.id)).size, reader.main.blocks.length, c.lessonId);
    const reconstructed = blocks.sort((a, b) => Number(a.id.split(':p')[1]) - Number(b.id.split(':p')[1])).map(b => b.block);
    assert.deepEqual(reconstructed, reader.main.blocks, c.lessonId);
    assert.equal(c.sourceInventory.readerSha256, hash(reader));
    assert.deepEqual(c.annotations, reader.main.annotations);
    assert.deepEqual(c.frontMatter, reader.main.frontMatter);
    assert.deepEqual(c.guidance, reader.main.guidance);
    assert.deepEqual(c.sourceOnlyBlocks, reader.main.sourceOnlyBlocks);
    assert.deepEqual(c.media, reader.main.media);
    assert.deepEqual(c.resources, reader.resources);
    for (const reference of c.readingMaterials) {
      assert.equal(reference.blockSha256, hash(reference.block));
      assert(!c.passages.some(p => p.id === reference.id));
      assert(!c.objectives.some(o => o.sourcePassages?.includes(reference.id)), `${c.lessonId}:${reference.id}`);
    }
  }
  const long = curricula.find(c => c.lessonId === 'lesson-1471');
  assert(long.passages.length > 100, 'long original text cannot silently become an excerpt');
  const table = curricula.find(c => c.lessonId === 'lesson-1708').passages.find(p => p.block.type === 'table');
  assert(table.text.includes('调查步骤与方法'), 'source tables remain usable text');
});

test('all formal source identities, roles, grade policy and task content are preserved', () => {
  assert.equal(mapping.legacyPolicy.itemCount, formal.itemCount);
  assert.equal(mapping.legacyPolicy.thresholdPercent, formal.thresholdPercent);
  assert.equal(mapping.sourcePins.formal, formal.manifestVersion);
  assert.equal(mapping.sourcePins.formative, formative.manifestVersion);
  assert.equal(mapping.sourcePins.guides, guides.catalogVersion);
  assert.equal(mapping.lessons.reduce((n, l) => n + l.formal.length, 0), formal.items.length);
  assert.equal(mapping.lessons.reduce((n, l) => n + l.formative.length, 0), 1697);
  for (const c of curricula) {
    const originals = formal.items.filter(i => i.sourceId === c.lessonId).map(i => ({resourceKey:i.resourceKey, canonicalUnitId:i.canonicalUnitId, resourceVersion:i.resourceVersion, questionKind:i.questionKind, scoringRole:i.evidenceRole, sourceReleaseId:i.sourceReleaseId, ...(i.effectiveFrom?{effectiveFrom:i.effectiveFrom}:{}), ...(i.formalScopePolicyVersion?{formalScopePolicyVersion:i.formalScopePolicyVersion}:{})}));
    assert.deepEqual(c.legacy.formal, originals, c.lessonId);
    assert.deepEqual(c.formalScopeExpansion,formal.formalScopeExpansion);
    for(const item of c.legacy.formal.filter(i=>i.formalScopePolicyVersion))assert.notEqual(item.scoringRole,'a_plus_gate');
    assert.deepEqual(c.objectives.filter(o => o.domain === 'legacy').map(o => o.legacy), originals);
    const competencies = formative.lessons.find(l => l.lessonId === c.lessonId)?.competencies || [];
    assert.deepEqual(c.legacy.formative, competencies.flatMap(k => k.items.map(i => ({...i,competencyTag:k.competencyTag}))));
    assert.deepEqual(c.legacy.sourceTasks, read(`site/data/lessons/${c.lessonId}.json`).learningTasks || []);
    assert.deepEqual(c.legacy, mapping.lessons.find(l => l.lessonId === c.lessonId));
    assert.equal(c.coverage.assessmentBridge.status, 'implementation-candidate');
  }
});

test('study guide references retain exact prompts, answers, rubric, semantic revision and inactive tombstones', () => {
  let active = 0;
  for (const c of curricula) {
    const original = guides.lessons.find(l => l.lessonId === c.lessonId)?.items || [];
    assert.deepEqual(c.studyGuide, original, c.lessonId);
    assert.deepEqual(c.objectives.filter(o => o.domain === 'studyGuide').map(o => o.sourceItemKey), original.filter(i => i.activeForSelfTest).map(i => i.itemKey));
    active += original.filter(i => i.activeForSelfTest).length;
    for (const i of original.filter(i => !i.activeForSelfTest)) {
      assert.equal(c.legacy.requirementMappings.find(m => m.source === 'study-guide' && m.requirementId === i.itemKey).status, 'inactive-preserved-not-reactivated');
    }
  }
  assert.equal(active, 193);
});

test('vocabulary expansion reuses all eight original question types and invents no item for 55 source-less lessons', () => {
  let absent = 0;
  const types = new Set();
  for (const c of curricula) {
    const file = `site/data/vocab/${c.lessonId}.json`;
    const original = fs.existsSync(file) ? read(file).inventory : [];
    if (!fs.existsSync(file)) absent++;
    const expected = original.filter(v => (vocabIndex.activeItemIds[c.lessonId] || []).includes(v.id));
    assert.deepEqual(c.vocabulary.map(v => v.id), expected.map(v => v.id));
    for (const v of c.vocabulary) {
      const source = expected.find(i => i.id === v.id);
      for (const key of ['word','sourceSentence','question','options','answerIndex','type','difficulty','sourceRefs']) assert.deepEqual(v[key], source[key], `${v.id}:${key}`);
      assert.equal(v.meaning, source.contextMeaning);
      assert.equal(v.sourceAnswer, source.options[source.answerIndex]);
      assert.equal(v.variants.length, 2);
      assert.equal(new Set(v.variants).size, 2);
      assert(v.variants[0].includes(source.question));
      assert(v.variants[0].includes(source.options[source.answerIndex]));
      types.add(v.type);
    }
    if (!expected.length) assert(!c.objectives.some(o => o.id === `${c.lessonId}:vocabulary`));
  }
  assert.equal(absent, 55);
  assert.deepEqual([...types].sort(), ['contextual-choice','discrimination','evidence','gu-jin','interpretation','pronunciation','substitution','usage']);
});

test('personas distinguish teaching units, anonymous and multiple sources from an attributed author', () => {
  for (const [i, c] of curricula.entries()) {
    const meta = taxonomy.lessons[i];
    assert.equal(c.persona.narratorIsAuthor, false);
    if (teachingModes.includes(meta.mode)) assert.equal(c.persona.kind, 'curriculum-guide');
    if (meta.authors.length !== 1) assert.notEqual(c.persona.kind, 'author-simulation');
    assert(c.persona.rule.includes('編者'));
  }
  const disputed = curricula.find(c => c.lessonId === 'lesson-1520');
  assert.equal(disputed.author, '《光明日报》特约评论员');
  assert.equal(disputed.persona.kind, 'source-guide');
  const composite = curricula.find(c => c.lessonId === 'lesson-1742');
  assert.equal(composite.persona.kind, 'source-guide');
  assert.equal(composite.passages.find(p => p.id === 'lesson-1742:p2').attribution.author, '馬克思');
  assert.equal(composite.passages.find(p => p.id === 'lesson-1742:p7').attribution.author, '恩格斯');
});

test('missing primary text retains provenance and original records under the owner exemption', () => {
  assert.deepEqual(curricula.filter(c => c.sourceStatus === 'source-unavailable').map(c => c.lessonId), ['lesson-1572']);
  const c = curricula.find(c => c.lessonId === 'lesson-1572');
  assert.deepEqual(c.passages, []);
  assert(c.readingMaterials.some(r => r.text.includes('32638357.pdf')));
  assert.equal(c.sourceReviewRequired, false);
  assert(c.source.startsWith('https://'));
  assert(c.coverage.source.reason.includes('沒有可核對正文'));
});

test('classical essentials report exact existing evidence and gaps without claiming generated pedagogical acceptance', () => {
  let applicable = 0, incomplete = 0;
  for (const c of curricula) {
    const coverage = c.coverage.classicalEssentials;
    const ids = new Set([...c.vocabulary.map(v => v.id), ...c.languagePractice.map(v => v.id), ...c.studyGuide.filter(i => i.activeForSelfTest).map(i => i.itemKey)]);
    for (const list of Object.values(coverage.areaSources)) for (const id of list) assert(ids.has(id), id);
    assert.equal(coverage.calibrationStatus, 'not-established-by-curriculum-generation');
    if (coverage.applicable) {
      applicable++;
      assert.deepEqual(coverage.missingAreas, Object.entries(coverage.areaSources).filter(([,a]) => !a.length).map(([k]) => k));
      if (coverage.missingAreas.length) {
        incomplete++;
        assert.equal(c.sourceReviewRequired, true);
        assert.equal(coverage.status, 'source-coverage-gaps');
      }
    }
    for (const id of coverage.verifiedDictionaryIds) assert(c.dictionary.some(d => d.id === id && d.verificationStatus === 'source-image-verified'));
  }
  assert(applicable > 60);
  assert.equal(applicable,67);
  assert.equal(incomplete,0,'every classical lesson has source-bound tasks in all three areas');
});

test('nonvisible and composite sources retain explicit original dispositions and hashes', () => {
  const visible = new Set(taxonomy.lessons.map(l => l.id));
  const absent = fs.readdirSync('site/data/lessons').filter(f => f.endsWith('.json') && !visible.has(f.slice(0,-5)));
  assert.deepEqual(mapping.nonVisibleSources.map(s => s.lessonId).sort(), absent.map(f => read(`site/data/lessons/${f}`).id).sort());
  for (const s of mapping.nonVisibleSources) {
    assert.equal(s.sha256, hash(read(`site/${s.sourcePath}`)));
    assert.equal(s.disposition, 'preserved_existing_nonvisible_or_composite_source; not silently assigned new requirements');
  }
});

test('complete generator outputs are deterministic against the exact current source', () => {
  const summary = JSON.parse(execFileSync(process.execPath, ['scripts/build_dialogue_curriculum.mjs','--check'], {encoding:'utf8'}));
  assert.equal(summary.lessons, 189);
  assert.equal(summary.formalResources, formal.items.length);
  assert.equal(summary.formativeResources, 1697);
  assert.deepEqual(summary.sourceUnavailable, ['lesson-1572']);
});


test('the owner exemption is exact, singular, source-honest and never a score', () => {
  const exempt=curricula.filter(c=>c.completionExemption);
  assert.equal(exempt.length,1);
  const c=exempt[0];
  assert.deepEqual(c.completionExemption,{kind:'owner-approved-supplement',reason:'使用者補充篇目，經課程所有者明確核准直接通過',lessonId:'lesson-1572',approvedAt:'2026-10-13T01:41:15Z',authority:'direct-suen-instruction-01a132c3',scoringRole:'none'});
  assert.equal(c.sourceStatus,'source-unavailable');
  assert.equal(c.passages.length,0);
  assert.equal(c.sourceReviewRequired,false);
  assert.equal(c.coverage.source.disposition,'owner-approved-supplement-complete-no-score');
  assert.deepEqual(index.lessons.find(l=>l.lessonId===c.lessonId).completionExemption,c.completionExemption);
  assert(!Object.hasOwn(c.completionExemption,'score'));
});

test('supplemental language tasks preserve exact primary quotations, distinct variants and unscored pending criteria', () => {
  const source=read('scripts/dialogue-language-corpus.json');
  assert.equal(Object.keys(source.languageItems).length,52);
  let count=0;
  for(const [id,items] of Object.entries(source.languageItems)){
    const c=curricula.find(c=>c.lessonId===id);
    for(const item of items){
      count++;
      assert.equal(item.scoringRole,'none');
      assert.equal(item.calibrationStatus,'pending-real-model');
      assert.equal(item.masteryCriteria.length,3);
      assert.equal(new Set(item.variants).size,2);
      const p=c.passages.find(p=>p.id===item.sourceEvidence.passageId);
      assert.equal(item.sourceEvidence.passageSha256,hash(p));
      assert.equal(item.sourceEvidence.readerSha256,c.sourceInventory.readerSha256);
      for(const q of item.passageQuotes)assert(p.text.includes(q));
      const generated=c.languagePractice.find(l=>l.id===id+':'+item.id);
      assert(generated);
      assert.deepEqual(generated.masteryCriteria,item.masteryCriteria);
      assert.equal(c.objectives.find(o=>o.id===generated.id).scoringRole,'none');
      if(item.type==='function-word'){const d=c.dictionary.find(d=>d.id===item.dictionaryId);assert(d);assert.equal(item.sourceVerification.xcEntryId,d.entryId);assert.deepEqual(item.sourceVerification.printedPages,d.pages.map(p=>p.printedPage));}else{
        assert.equal(item.sourceVerification.analysisStatus,'authored-contextual-interpretation');
        assert.equal(/待核驗/.test(c.objectives.find(o=>o.id===generated.id).label),item.sourceVerification.status==='pending-verification');
      }
    }
    assert.equal(c.coverage.classicalEssentials.coverageScope,'per-lesson-area-presence-not-exhaustive-lexical-inventory');
  }
  assert.equal(count,69);
  assert.equal(source.dictionary.length,19);
  assert.equal(new Set(source.dictionary.flatMap(d=>d.pages.map(p=>p.pdfPage))).size,27);
  for(const d of source.dictionary){
    assert.equal(d.sourcePdfSha256,'a60dcbdca401b2445eeca3e09d6db0fb879d9f5d641781bc2b27c7757249cfaa');
    assert(d.verification.includes('不宣稱'));
    assert(d.localSources.length);
    assert.equal(d.entryId,'e-'+d.entryLocator.columnPath.split('/').at(-1).replace('.txt','')+'-'+d.entryLocator.zeroBasedLine);
    assert(d.entryLocator.observedHeading.startsWith(d.headword));
    assert.match(d.entryLocator.columnSha256,/^[a-f0-9]{64}$/);
    for(const p of d.pages){assert.match(p.imageSha256,/^[a-f0-9]{64}$/);assert(p.verifiedScope);assert.equal(p.pdfPage-p.printedPage,12);}
    for(const s of d.localSources)assert.match(s.sha256,/^[a-f0-9]{64}$/);
  }
});

test('all grammar source reviews bind exact interpretation, original passages, notes and scoped support', () => {
  const corpus=read('scripts/dialogue-language-corpus.json'),representatives=read('scripts/dialogue-source-fixtures.json');
  const reviews=[];
  for(const source of [corpus,representatives])for(const [id,items] of Object.entries(source.languageItems)){
    const c=curricula.find(c=>c.lessonId===id),reader=read(`site/data/reader-documents/${id}.json`);
    for(const item of items.filter(x=>x.type==='grammar')){
      validateGrammarSourceReview(item,{reader,passages:c.passages,readingMaterials:c.readingMaterials});
      const generated=c.languagePractice.find(x=>x.id===`${id}:${item.id}`);
      assert.deepEqual(generated.sourceVerification,item.sourceVerification);
      assert.equal(item.sourceVerification.analysisSha256,grammarAnalysisHash(item));
      assert(!/\/Users\/|\/private\//.test(JSON.stringify(item.sourceVerification)));
      assert.equal(item.calibrationStatus,'pending-real-model');
      assert.equal(item.scoringRole,'none');
      reviews.push({id:generated.id,status:item.sourceVerification.status});
    }
  }
  assert.equal(reviews.length,22);
  assert.equal(reviews.filter(x=>x.status==='source-context-reviewed').length,19);
  assert.deepEqual(reviews.filter(x=>x.status==='pending-verification').map(x=>x.id).sort(),[
    'lesson-1500:corpus-grammar','lesson-1560:corpus-grammar',
    'lesson-1701-p2:corpus-grammar',
  ].sort());
  const modifier=representatives.languageItems['lesson-1711-p1'].find(x=>x.id==='grammar-modifier');
  const scholarly=modifier.sourceVerification.primaryReferences.find(x=>x.publisher?.includes('東海'));
  assert.equal(scholarly.page,7);assert.equal(scholarly.pdfPage,7);assert.equal(scholarly.zeroBasedPdfPage,6);
  assert.match(scholarly.url,/01%E5%91%82%E7%8F%8D%E7%8E%89\.pdf#page=7$/);
  assert.match(modifier.explanation,/不要求唯一「定語後置」/);
});

test('grammar review cannot survive interpretation or original evidence drift', () => {
  const original=read('scripts/dialogue-source-fixtures.json').languageItems['lesson-1711-p1'].find(x=>x.id==='grammar-water');
  const c=curricula.find(c=>c.lessonId==='lesson-1711-p1');
  const context={reader:read('site/data/reader-documents/lesson-1711-p1.json'),passages:c.passages,readingMaterials:c.readingMaterials};
  const altered=structuredClone(original);altered.meaning='水只是江水，沒有動作義。';
  assert.throws(()=>validateGrammarSourceReview(altered,context),/grammar analysis drift/);
  const staleNote=structuredClone(original);staleNote.sourceVerification.evidence.annotations[0].sha256='0'.repeat(64);
  assert.throws(()=>validateGrammarSourceReview(staleNote,context),/grammar annotation drift/);
  const missingSource=structuredClone(original);delete missingSource.sourceVerification;
  assert.throws(()=>validateGrammarSourceReview(missingSource,context),/grammar source review missing/);
  const unboundQuote=structuredClone(original);unboundQuote.passageQuotes=['不存在的詩句'];
  assert.throws(()=>validateGrammarSourceReview(unboundQuote,context),/grammar quotation unpinned/);
});

test('revised poetic grammar accepts defensible readings without a mandatory unique parse', () => {
  const source=read('scripts/dialogue-language-corpus.json');
  const old=source.languageItems['lesson-1755-p1'].find(x=>x.type==='grammar');
  const scene=source.languageItems['lesson-1755-p2'].find(x=>x.type==='grammar');
  assert.equal(old.word,'語境主體與處境');
  assert.match(old.explanation,/也接受把老病理解為老病之身/);
  assert.match(old.masteryCriteria.find(x=>x.id==='context_analysis').requirement,/不要求唯一省略主語/);
  assert(!old.variants.some(x=>x.includes('說明「省略主語」')));
  assert.match(scene.masteryCriteria.find(x=>x.id==='context_analysis').requirement,/不把寒煙衰草同作凝綠主語設為唯一正解/);
  assert.match(scene.variants[0],/不要求唯一主謂劃分/);
  for(const item of [old,scene])assert.equal(item.sourceVerification.evidence.readingMaterials[0].role,'commentary');
});

test('source acceptance never substitutes for model calibration and pending syntax still fails a hypothetical calibrated verdict', () => {
  for(const original of curricula)for(const item of original.languagePractice.filter(x=>x.type==='grammar')){
    const c=structuredClone(original),v=c.languagePractice.find(x=>x.id===item.id),o=c.objectives.find(x=>x.id===v.id);
    const p=c.passages.find(p=>p.id===v.sourcePassages[0]);
    const q={id:'synthetic-source-guard-question',objectiveId:v.id,state:'issued',hinted:false};
    const t={id:'synthetic-source-guard-answer',role:'student',questionId:q.id,content:'這是離線測試的自述，不能當作真實學習或模型校準證據。'};
    const a={objectiveId:v.id,outcome:'demonstrated',rationale:'離線測試來源與校準分離',evidence:o.criteria.map(criterion=>({criterion,turnId:t.id,quote:t.content,passageId:p.id,passageQuote:p.text.slice(0,12)}))};
    const verify=()=>validateProposal({reply:'離線測試',assessments:[a]},{curriculum:c,turns:[t],question:q});
    assert.throws(verify,/language_calibration_required/);
    if(v.sourceVerification.status==='pending-verification'){
      // Negative test only: a hypothetical calibration flag cannot clear a source gap.
      v.calibrationStatus='accepted';
      assert.throws(verify,/language_calibration_required/);
    }
  }
});
