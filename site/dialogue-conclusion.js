// A grounded model synthesis for the student's own record, never an official grade.
// Since r37 Claude writes it without the free-pool option schema, so format slips that the schema used to prevent are tolerated
// where nothing unverified is kept: over-long prose is clipped, an earlier-record id that is not a preserved objective of its
// domain is dropped, and a domain keeps its first verifiable evidence. Quotes stay verbatim and within 60 units.
import {verbatimSpan} from './dialogue-quote.js';
export const CONCLUSION_VERSION='yw-dialogue-conclusion-v1';
const domains={interpretation:['context','firstRead','read','authorQuestion'],vocabulary:['vocabulary'],technique:['structure','revision','wordCreation'],transfer:['transfer'],uncertainty:['shangyou']};
const text=(value,max)=>typeof value==='string'&&value.trim()&&value.length<=max;
const clip=(value,max)=>typeof value==='string'&&value.trim()?[...value.trim()].slice(0,max).join(''):null;
export function validateConclusion(raw,{curriculum,state,turns}){
 if(!raw)return null;
 const summary=clip(raw.studentSummary,180);
 if(!state?.readyForShangyou||!summary||!Array.isArray(raw.domains)||raw.domains.length!==5)throw Error('conclusion_not_ready');
 const reference=(ref,passageRequired=false)=>{
  const turn=turns.find(t=>t.id===ref?.turnId&&t.role==='student');
  const quote=turn&&text(ref.quote,60)?verbatimSpan(turn.content,ref.quote):null;
  if(!quote)throw Error('unverifiable_conclusion_turn');
  const result={turnId:turn.id,quote};
  if(passageRequired){const p=curriculum.passages.find(p=>p.id===ref.passageId),passageQuote=p&&text(ref.passageQuote,60)?verbatimSpan(p.text,ref.passageQuote):null;if(!passageQuote)throw Error('unverifiable_conclusion_passage');Object.assign(result,{passageId:p.id,passageQuote});}
  return result;
 };
 const before=reference(raw.change?.before),after=reference(raw.change?.after);
 if(turns.findIndex(t=>t.id===before.turnId)>=turns.findIndex(t=>t.id===after.turnId))throw Error('conclusion_change_requires_earlier_turn');
 const stance=reference(raw.stance,true),seen=new Set();
 const findings=raw.domains.map(row=>{
  const finding=clip(row?.finding,90);
  if(!Object.hasOwn(domains,row?.domain)||seen.has(row.domain)||!finding||row.evidence!==undefined&&!Array.isArray(row.evidence)||row.preservedObjectives!==undefined&&!Array.isArray(row.preservedObjectives))throw Error('invalid_conclusion_domain');
  seen.add(row.domain);
  const evidence=[];
  for(const ref of row.evidence||[]){if(evidence.length)break;try{evidence.push(reference(ref,true));}catch{}}
  const preservedObjectives=(row.preservedObjectives||[]).flatMap(id=>{
   const o=state.objectives.find(o=>o.id===id&&o.status==='preserved'&&domains[row.domain].includes(o.domain));
   return o?[{objectiveId:o.id,sourceRef:o.evidence}]:[];
  }).slice(0,2);
  if(!evidence.length&&!preservedObjectives.length)throw Error('conclusion_domain_without_evidence');
  return {domain:row.domain,finding,evidence,preservedObjectives};
 });
 return {version:CONCLUSION_VERSION,kind:'model-synthesis-for-review',studentSummary:summary,change:{before,after},stance,domains:findings};
}
