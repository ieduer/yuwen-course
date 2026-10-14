// Source-owned admission of new work; never a regrading or backfill policy.
export const ORIGINAL_FORMAL_RELEASE = Object.freeze({
  manifestVersion:'yw-e310d45b1d81e9ad',
  sourceReleaseId:'yw-release-f78c3cae78ac3ac3',
  resourceKeyHash:'sha256:e310d45b1d81e9adf6182bd50ea02842daf69a8981aa29ff03b2da30b0846aca',
  itemCount:869,
});
export const FORMAL_SCOPE_POLICY = Object.freeze({
  policyVersion:'yw-formal-scope-20261013-v2',
  authority:'direct-suen-instruction-01a132c3',
  authorizedAt:'2026-10-13T02:03:44.252Z',
  effectiveFrom:'2026-10-13T02:03:44.252Z',
  newAnswersOnly:true,
  performanceScoringRole:'formative',
  includeInExistingAPlusGate:false,
  historicalWork:'preserve_no_backfill_or_regrade',
  addedBooks:['bixiu-shang','bixiu-xia'],
  annualPolicyVersion:'yw-aplus-2026-2027-v1',
  requiredDistinctCreditUnits:692,
});
export function validateFormalScopeExpansion(manifest){
  const policy=manifest?.formalScopeExpansion;
  if(!policy)return null;
  if(JSON.stringify(policy)!==JSON.stringify(FORMAL_SCOPE_POLICY)
    ||JSON.stringify(manifest.priorReleases)!==JSON.stringify([ORIGINAL_FORMAL_RELEASE]))throw Error('formal scope admission policy invalid');
  const prior=manifest.items.filter(item=>item.sourceReleaseId===ORIGINAL_FORMAL_RELEASE.sourceReleaseId);
  const added=manifest.items.filter(item=>item.sourceReleaseId!==ORIGINAL_FORMAL_RELEASE.sourceReleaseId);
  if(prior.length!==869||added.length!==764||new Set(added.map(item=>item.sourceId)).size!==88
    ||prior.some(item=>item.formalScopePolicyVersion||item.effectiveFrom!=='2026-08-12T00:00:00+08:00')
    ||prior.filter(item=>item.evidenceRole==='a_plus_gate').length!==768
    ||added.some(item=>item.evidenceRole!==(item.questionKind==='evaluation'?'non_scoring':'formative')||item.formalScopePolicyVersion!==policy.policyVersion||item.effectiveFrom!==policy.effectiveFrom||item.sourceReleaseId!==manifest.sourceReleaseId))throw Error('formal scope inventory invalid');
  return policy;
}
export function assertNewFormalAnswerTime(item,occurredAt){
  if(!item?.formalScopePolicyVersion)return;
  if(item.formalScopePolicyVersion!==FORMAL_SCOPE_POLICY.policyVersion
    ||item.effectiveFrom!==FORMAL_SCOPE_POLICY.effectiveFrom
    ||!Number.isFinite(Date.parse(occurredAt))||Date.parse(occurredAt)<Date.parse(item.effectiveFrom)){
    const error=new Error('新正式評分只接受啟用後的新作答；歷史練習保留。');
    error.code='formal_scope_not_active_for_answer';throw error;
  }
}
export function withProspectiveFormalScope(frozen,published,{completed=false,pending=false}={}){
  if(completed||pending||frozen.lessonId!==published.lessonId
    ||JSON.stringify(published.formalScopeExpansion)!==JSON.stringify(FORMAL_SCOPE_POLICY))return frozen;
  const additions=published.objectives.filter(o=>o.domain==='legacy'
    &&o.legacy?.formalScopePolicyVersion===FORMAL_SCOPE_POLICY.policyVersion
    &&!frozen.objectives.some(old=>old.id===o.id));
  if(!additions.length)return frozen;
  return {...frozen,formalScopeExpansion:published.formalScopeExpansion,
    objectives:[...frozen.objectives,...additions],
    legacy:{...frozen.legacy,formal:[...(frozen.legacy?.formal||[]),...published.legacy.formal.filter(item=>additions.some(o=>o.legacy.resourceKey===item.resourceKey))]}};
}

// An existing performance interaction may have a different role only through
// this exact server-owned admission. Client payloads never choose a role.
export function formalDefinitionForResource(definition,item,manifest){
  if(!item?.formalScopePolicyVersion)return definition;
  const policy=validateFormalScopeExpansion(manifest);
  if(!policy||item.formalScopePolicyVersion!==policy.policyVersion)throw Error('formal resource role is not authorized');
  if(item.questionKind==='evaluation'){
    if(definition.assessmentKind!=='self_report'||definition.scoringRole!=='none')throw Error('formal self-report role invalid');
    return definition;
  }
  if(definition.assessmentKind!=='performance'||definition.scoringRole!=='a_plus_gate'||item.evidenceRole!=='formative')throw Error('formal performance role invalid');
  return {...definition,scoringRole:'formative'};
}
