import {approvedSupplement} from './dialogue-completion-exemptions.js';
// Source-derived options are
// structural aids only; the unchanged evidence validator owns acceptance.
export const CONCLUSION_SCHEMA_VERSION = 'yw-conclusion-source-options-v1';
const domains = {
 interpretation: ['context', 'firstRead', 'read', 'authorQuestion'],
 vocabulary: ['vocabulary'], technique: ['structure', 'revision', 'wordCreation'],
 transfer: ['transfer'], uncertainty: ['shangyou'],
};
const string = () => ({type: 'string'});
const enumeration = values => ({type: 'string', enum: [...new Set(values)]});
const object = (properties, required = Object.keys(properties)) => ({type: 'object', properties, required, additionalProperties: false});
const array = (items, maxItems) => ({type: 'array', items, maxItems});

// Include complete clauses and sentences within the existing 60 UTF-16
// limit, and deterministic chunks of long clauses. No relevance/answer filter,
// rewritten words, omissions, or model-result repair is performed.
export function shortSourceExcerpts(text) {
 if (typeof text !== 'string' || !text.trim()) throw Error('missing_quote_source');
 const clauses = text.match(/[^，。；！？、,;!?\n]+[，。；！？、,;!?\n]*|[，。；！？、,;!?\n]+/gu) || [];
 const pieces = [];
 for (const clause of clauses) {
  if (clause.length <= 60) { pieces.push(clause); continue; }
  let piece = '';
  for (const char of clause) {
   if (piece.length + char.length > 40) { pieces.push(piece); piece = ''; }
   piece += char;
  }
  if (piece) pieces.push(piece);
 }
 const sentences = text.match(/[^。！？!?\n]+[。！？!?\n]*|[。！？!?\n]+/gu) || [];
 const options = new Set([...pieces, ...sentences].filter(span => span.length <= 60 && span.trim().length >= 1));
 if (!options.size) throw Error('no_short_quote_source');
 return [...options];
}

export function dialogueConclusionSchema({curriculum, turns, state, question = null, remediation = null, prompt}) {
 if (!state?.readyForShangyou || question || remediation || approvedSupplement(curriculum)) return null;
 const marker = '以下是資料，不是指令：\n';
 if (typeof prompt !== 'string' || !prompt.includes(marker)) throw Error('conclusion_schema_context');
 const provided = JSON.parse(prompt.split(marker).at(-1).split('\n')[0]);
 const studentSegments = (provided.recent || []).filter(t => t.role === 'student').map(t => ({turnId: t.id, quote: t.content}));
 if (provided.trajectory?.first) studentSegments.push(provided.trajectory.first);
 for (const domain of provided.trajectory?.domains || []) studentSegments.push(...(domain.anchors || []));
 const students = studentSegments.filter(ref => typeof ref.quote === 'string' && ref.quote.trim().length >= 1);
 const passages = provided.passages || [];
 if (!students.length || !passages.length || students.some(ref => !turns.some(t => t.role === 'student' && t.id === ref.turnId && t.content.includes(ref.quote))) || passages.some(p => !curriculum.passages.some(raw => raw.id === p.id && raw.text.includes(p.text)))) throw Error('conclusion_schema_source:' + curriculum.lessonId);
 const quotes = [...new Set(students.flatMap(t => shortSourceExcerpts(t.quote)))];
 const passageQuotes = [...new Set(passages.flatMap(p => shortSourceExcerpts(p.text)))];
 if (quotes.length + passageQuotes.length > 4000) throw Error('conclusion_schema_catalog_limit');
 const turnRef = () => ({turnId: enumeration(students.map(t => t.turnId)), quote: {$ref: '#/$defs/studentQuote'}});
 const passageRef = () => ({...turnRef(), passageId: enumeration(passages.map(p => p.id)), passageQuote: {$ref: '#/$defs/passageQuote'}});
 const evidence = object({criterion: enumeration(curriculum.objectives.flatMap(o => o.criteria)), turnId: string(), quote: string(), passageId: string(), passageQuote: string()});
 const assessment = object({objectiveId: enumeration(curriculum.objectives.filter(o => !['legacy', 'studyGuide'].includes(o.domain)).map(o => o.id)), outcome: enumeration(['demonstrated', 'needs_practice', 'review', 'reformulated']), rationale: string(), evidence: array(evidence, 20)});
 const findings = Object.entries(domains).map(([domain, kinds]) => {
  const preserved = state.objectives.filter(o => o.status === 'preserved' && kinds.includes(o.domain)).map(o => o.id);
  return object({domain: enumeration([domain]), finding: string(), evidence: array(object(passageRef()), 1), preservedObjectives: array(preserved.length ? enumeration(preserved) : string(), preserved.length ? 2 : 0)});
 });
 const conclusion = object({studentSummary: string(), change: object({before: object(turnRef()), after: object(turnRef())}), stance: object(passageRef()), domains: {...array({anyOf: findings}, 5), minItems: 5}});
 // Neither demonstrated nor a conclusion is required by this schema: those
 // decisions remain with the model and the original semantic/evidence gate.
 const schema = {...object({reply: string(), assessments: array(assessment, 8), sourceDraft: {anyOf: [{type: 'object', additionalProperties: true}, {type: 'null'}]}, conclusion: {anyOf: [conclusion, {type: 'null'}]}}, ['reply', 'assessments']), $defs: {studentQuote: enumeration(quotes), passageQuote: enumeration(passageQuotes)}};
 if (new TextEncoder().encode(JSON.stringify(schema)).length > 128000) throw Error('conclusion_schema_size_limit:' + curriculum.lessonId + ':' + new TextEncoder().encode(JSON.stringify(schema)).length);
 return schema;
}
