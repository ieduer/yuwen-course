// Source-owned admission of new work; never a regrading or backfill policy.
export const ORIGINAL_FORMAL_RELEASE = Object.freeze({
  manifestVersion:'yw-e310d45b1d81e9ad',
  sourceReleaseId:'yw-release-f78c3cae78ac3ac3',
  resourceKeyHash:'sha256:e310d45b1d81e9adf6182bd50ea02842daf69a8981aa29ff03b2da30b0846aca',
  itemCount:869,
});
// The 2026-10-13 expansion release, kept as a prior release once a revision
// release supersedes individual item versions (append-only lineage).
export const EXPANSION_FORMAL_RELEASE = Object.freeze({
  manifestVersion:'yw-e8a6b72248be1cd8',
  sourceReleaseId:'yw-release-5bcdbb23da04c33d',
  resourceKeyHash:'sha256:e8a6b72248be1cd8af86d37ec66bd4381d1546e8306b36023b145decbf044866',
  itemCount:1633,
});
// Owner-authorized content corrections of existing items (suen 2026-11-04,
// bank-qa-openai-20261104). A corrected item keeps its canonical unit, role and
// effective date; only its resource version moves to the release that revised it.
// Earlier evidence keeps its own release and version; nothing is regraded.
export const FORMAL_REVISION_POLICY = Object.freeze({
  policyVersion:'yw-formal-revision-20261104-v1',
  authority:'suen-20261104-bank-qa-full-fix',
  authorizedAt:'2026-11-04T00:00:00.000Z',
  revisedItemCount:180,
  historicalWork:'preserve_prior_versions_no_regrade',
  creditUnit:'canonicalUnitId',
  priorVersionPolicy:'prior_release_versions_remain_valid_evidence_identities',
});
// The first revision release; immutable once a later revision release exists.
// Its 180 items keep this release as their identity.
export const REVISION_1_FORMAL_RELEASE = Object.freeze({
  manifestVersion:'yw-e8a6b72248be1cd8',
  sourceReleaseId:'yw-release-6ceed2f673344492',
  resourceKeyHash:'sha256:e8a6b72248be1cd8af86d37ec66bd4381d1546e8306b36023b145decbf044866',
  itemCount:1633,
});
// Second correction batch (suen 2026-11-04 「還沒做的一併做完」): a whole-item
// redesign of lesson-1722-p2:v05. Each item is revised at most once (one level).
export const FORMAL_REVISION_POLICY_V2 = Object.freeze({
  policyVersion:'yw-formal-revision-20261104-v2',
  authority:'suen-20261104-complete-remaining',
  authorizedAt:'2026-11-04T00:00:00.000Z',
  revisedItemCount:1,
  historicalWork:'preserve_prior_versions_no_regrade',
  creditUnit:'canonicalUnitId',
  priorVersionPolicy:'prior_release_versions_remain_valid_evidence_identities',
});
// Every revision policy names the release that introduced it. The last one is
// the current release (the manifest's own sourceReleaseId).
export function formalRevisionPolicies(currentReleaseId){
  return [
    Object.freeze({...FORMAL_REVISION_POLICY,sourceReleaseId:REVISION_1_FORMAL_RELEASE.sourceReleaseId}),
    Object.freeze({...FORMAL_REVISION_POLICY_V2,sourceReleaseId:currentReleaseId}),
  ];
}
export const FORMAL_PRIOR_RELEASES = Object.freeze([ORIGINAL_FORMAL_RELEASE,EXPANSION_FORMAL_RELEASE,REVISION_1_FORMAL_RELEASE]);
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
  const revisions=manifest.formalRevisions||null;
  const expectedPrior=revisions?FORMAL_PRIOR_RELEASES:[ORIGINAL_FORMAL_RELEASE];
  if(JSON.stringify(policy)!==JSON.stringify(FORMAL_SCOPE_POLICY)
    ||manifest.formalRevision!==undefined
    ||(revisions&&JSON.stringify(revisions)!==JSON.stringify(formalRevisionPolicies(manifest.sourceReleaseId)))
    ||JSON.stringify(manifest.priorReleases)!==JSON.stringify(expectedPrior))throw Error('formal scope admission policy invalid');
  const revisionFor=item=>(revisions||[]).find(entry=>entry.policyVersion===item.formalRevisionPolicyVersion)||null;
  const homes=[ORIGINAL_FORMAL_RELEASE.sourceReleaseId,EXPANSION_FORMAL_RELEASE.sourceReleaseId];
  const revised=manifest.items.filter(item=>item.formalRevisionPolicyVersion);
  if((revisions||[]).some(entry=>revised.filter(item=>item.formalRevisionPolicyVersion===entry.policyVersion).length!==entry.revisedItemCount)
    ||revised.some(item=>{const entry=revisionFor(item);return !entry||item.sourceReleaseId!==entry.sourceReleaseId
      ||!item.revisionOf||!homes.includes(item.revisionOf.sourceReleaseId)
      ||!/^sha256:[a-f0-9]{64}$/.test(String(item.revisionOf.resourceVersion||''))||item.revisionOf.resourceVersion===item.resourceVersion;}))throw Error('formal revision inventory invalid');
  const addedRelease=revisions?EXPANSION_FORMAL_RELEASE.sourceReleaseId:manifest.sourceReleaseId;
  const prior=manifest.items.filter(item=>!item.formalScopePolicyVersion);
  const added=manifest.items.filter(item=>item.formalScopePolicyVersion);
  if(prior.length!==869||added.length!==764||new Set(added.map(item=>item.sourceId)).size!==88
    ||prior.some(item=>item.effectiveFrom!=='2026-08-12T00:00:00+08:00'
      ||item.sourceReleaseId!==(item.formalRevisionPolicyVersion?revisionFor(item).sourceReleaseId:ORIGINAL_FORMAL_RELEASE.sourceReleaseId)
      ||(item.formalRevisionPolicyVersion&&item.revisionOf.sourceReleaseId!==ORIGINAL_FORMAL_RELEASE.sourceReleaseId))
    ||prior.filter(item=>item.evidenceRole==='a_plus_gate').length!==768
    ||added.some(item=>item.evidenceRole!==(item.questionKind==='evaluation'?'non_scoring':'formative')||item.formalScopePolicyVersion!==policy.policyVersion||item.effectiveFrom!==policy.effectiveFrom
      ||item.sourceReleaseId!==(item.formalRevisionPolicyVersion?revisionFor(item).sourceReleaseId:addedRelease)
      ||(item.formalRevisionPolicyVersion&&item.revisionOf.sourceReleaseId!==EXPANSION_FORMAL_RELEASE.sourceReleaseId)))throw Error('formal scope inventory invalid');
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
