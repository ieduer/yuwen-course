import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function grammarAnalysisHash(item) {
  return hash({word:item.word,meaning:item.meaning,explanation:item.explanation,
    variants:item.variants,misconceptions:item.misconceptions,
    masteryCriteria:item.masteryCriteria ?? null});
}

// These pins verify a reviewed interpretation's source identity. They do not
// establish model calibration, a student's mastery, or a publisher edition.
export function validateGrammarSourceReview(item, {reader, passages, readingMaterials}) {
  if (item.type !== 'grammar') return;
  const review = item.sourceVerification;
  assert(review, `grammar source review missing: ${item.id}`);
  assert(['source-context-reviewed','pending-verification'].includes(review.status), `grammar source status: ${item.id}`);
  assert.equal(review.analysisStatus, 'authored-contextual-interpretation');
  assert.equal(review.analysisSha256, grammarAnalysisHash(item), `grammar analysis drift: ${item.id}`);
  assert(review.scope && review.notice && review.reviewId && review.authority);
  const evidence = review.evidence;
  assert(evidence && evidence.passages?.length, `grammar source pins missing: ${item.id}`);
  assert.equal(evidence.readerPath, `data/reader-documents/${reader.lessonId}.json`);
  assert.equal(evidence.readerSha256, hash(reader), `grammar reader drift: ${item.id}`);
  for (const pin of evidence.passages) {
    const passage = passages.find(p => p.id === pin.id);
    assert(passage, `grammar passage missing: ${pin.id}`);
    assert.equal(pin.sha256, hash(passage), `grammar passage drift: ${pin.id}`);
    assert(pin.quotes.length && pin.quotes.every(q => passage.text.includes(q)), `grammar quotation drift: ${pin.id}`);
  }
  assert(item.passageQuotes.every(q => evidence.passages.some(p => p.quotes.includes(q))), `grammar quotation unpinned: ${item.id}`);
  for (const pin of evidence.annotations) {
    const annotation = reader.main.annotations.find(n => n.noteId === pin.noteId);
    assert(annotation, `grammar annotation missing: ${pin.noteId}`);
    assert.equal(pin.sha256, hash(annotation), `grammar annotation drift: ${pin.noteId}`);
  }
  for (const pin of evidence.readingMaterials) {
    const material = readingMaterials.find(m => m.id === pin.id);
    assert(material, `grammar reading material missing: ${pin.id}`);
    assert.equal(pin.role, material.role);
    assert.equal(pin.sha256, hash(material), `grammar reading material drift: ${pin.id}`);
  }
  if (review.status === 'source-context-reviewed') {
    assert(evidence.annotations.length || evidence.readingMaterials.length || review.primaryReferences.length,
      `grammar scoped support missing: ${item.id}`);
  }
}
