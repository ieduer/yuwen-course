// A grounded model synthesis for human review, never an official grade.
import {verbatimSpan} from './dialogue-quote.js';
export const CONCLUSION_VERSION='yw-dialogue-conclusion-v1';
const domains={interpretation:['context','firstRead','read','authorQuestion'],vocabulary:['vocabulary'],technique:['structure','revision','wordCreation'],transfer:['transfer'],uncertainty:['shangyou']};
const text=(value,max)=>typeof value==='string'&&value.trim()&&value.length<=max;
export function validateConclusion(raw,{curriculum,state,turns}){
 if(!raw)return null;
 if(!state?.readyForShangyou||!text(raw.studentSummary,180)||!Array.isArray(raw.domains)||raw.domains.length!==5)throw Error('conclusion_not_ready');
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
  if(!Object.hasOwn(domains,row.domain)||seen.has(row.domain)||!text(row.finding,90)||!Array.isArray(row.evidence)||row.evidence.length>1||!Array.isArray(row.preservedObjectives)||row.preservedObjectives.length>2)throw Error('invalid_conclusion_domain');
  seen.add(row.domain);
  const evidence=row.evidence.map(ref=>reference(ref,true));
  const preservedObjectives=row.preservedObjectives.map(id=>{
   const o=state.objectives.find(o=>o.id===id&&o.status==='preserved'&&domains[row.domain].includes(o.domain));
   if(!o)throw Error('unverified_conclusion_history');return {objectiveId:o.id,sourceRef:o.evidence};
  });
  if(!evidence.length&&!preservedObjectives.length)throw Error('conclusion_domain_without_evidence');
  return {domain:row.domain,finding:row.finding,evidence,preservedObjectives};
 });
 return {version:CONCLUSION_VERSION,kind:'model-synthesis-for-review',studentSummary:raw.studentSummary,change:{before,after},stance,domains:findings};
}
