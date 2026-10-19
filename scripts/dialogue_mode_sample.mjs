// Local preparation for the real student's continuous-dialogue path.
// No transport, activation, budget grant, source mutation or completion override.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {loadCurriculum,hash,assertComplete} from './dialogue_e2e.mjs';
import {MODE_LESSONS} from '../site/dialogue-mode-admission.js';
import {projectReleaseJson,RELEASE_JSON_PROJECTION_VERSION} from './build_release_site.mjs';
import {withCalibratedLanguage} from '../site/dialogue-calibration-status.js';

// Three genres, including active source-owned study-guide assessment. The
// historical Quanxue selection had no active guide and missed that branch.
export const MODE_SAMPLE_IDS=MODE_LESSONS;

// The Worker reads the private release module. Its established URL/resource
// projection can differ from the source JSON; admission must bind those exact
// served materials without weakening the runtime digest check.
export function loadModeCurriculum(id,loader=loadCurriculum){
 assert(/^lesson-[\w-]{1,60}$/.test(id),'exact lesson id required');
 return JSON.parse(projectReleaseJson('dialogue-curriculum/'+id+'.json',JSON.stringify(loader(id))));
}

export function modeCoverage(curricula){
 const covers={poetry:[],classical:[],modernProse:[],originalModelGrading:[],studyGuide:[]};
 for(const c of curricula){
  const genre={poetry:'poetry',classical:'classical','modern-prose':'modernProse'}[c.mode];
  if(genre)covers[genre].push(c.lessonId);
  if(c.objectives.some(o=>o.domain==='legacy'&&['contextWords','authorQuestion','revision','structure','wordCreation'].includes(o.legacy?.questionKind)))covers.originalModelGrading.push(c.lessonId);
  if(c.objectives.some(o=>o.domain==='studyGuide'&&c.studyGuide?.some(g=>g.itemKey===o.sourceItemKey&&g.activeForSelfTest===true&&!g.reviewRequired)))covers.studyGuide.push(c.lessonId);
 }
 const missing=Object.keys(covers).filter(key=>!covers[key].length);
 return {covers,missing,complete:missing.length===0,evidence:'source_inventory_only_not_mode_acceptance'};
}

export function prepareModeSample(ids=MODE_SAMPLE_IDS,loader=loadCurriculum){
 assert(Array.isArray(ids)&&ids.length>=1&&ids.length<=3&&new Set(ids).size===ids.length,'one to three distinct representative lessons required');
 const curricula=[];
 const lessons=ids.map(id=>{
  const c=loadModeCurriculum(id,loader);assert(c?.lessonId===id&&c.curriculumVersion&&c.sourceInventory?.readerSha256&&c.passages?.length,'exact curriculum and original material required');
  curricula.push(c);
  const activeGuides=(c.studyGuide||[]).filter(g=>g.activeForSelfTest===true&&!g.reviewRequired&&c.objectives.some(o=>o.domain==='studyGuide'&&o.sourceItemKey===g.itemKey));
  return {lessonId:id,title:c.title,mode:c.mode,curriculumVersion:c.curriculumVersion,sourceDigest:hash(c),readerSha256:c.sourceInventory.readerSha256,objectiveIds:c.objectives.map(o=>o.id),studyGuideItemKeys:activeGuides.map(g=>g.itemKey)};
 });
 return {version:'yw-continuous-mode-sample-v3',sourceProjection:RELEASE_JSON_PROJECTION_VERSION,status:'offline_prepared_not_accepted',productScope:189,lessons,coverage:modeCoverage(curricula),route:'/api/dialogue/v1',conversation:true,
  scope:'same student conversation path; no per-field answer automation',
  requires:['fresh exact source and authorized finite execution','actual current original text, annotations, guides and rubrics in prompt evidence','natural adaptive learner utterances, including preference or question changes','backend original evidence, coverage and prerequisite checks','save, reload and continuation; preserved historical scores','actual source outbox to central accepted receipt to ordinary My reload','browser/mobile and human review'],
  budgetDisposition:{logicalModelCallsPerConversationalSend:1,deterministicGuideFeedback:'reserve the conversational reply; do not subtract it as a zero-call grading shortcut',providerAttemptLimit:'must bind the fresh approved policy; logical calls are not provider attempt counts',allowanceGranted:false},
  realProviderVerified:false,centralAcceptanceVerified:false,humanAcceptance:false,executionAuthorized:false};
}

// New exact-source plans must pin the effective runtime projection as well as
// the unchanged source contract. Existing consumed plans are never rewritten.
export async function prepareCalibratedModeSample(ids=MODE_SAMPLE_IDS,loader=loadCurriculum){
 const plan=prepareModeSample(ids,loader);
 for(const lesson of plan.lessons){
  const original=loadModeCurriculum(lesson.lessonId,loader),effective=await withCalibratedLanguage(original);
  lesson.baseSourceDigest=lesson.sourceDigest;lesson.sourceDigest=hash(effective);
  lesson.calibrationManifestDigest=effective.calibrationEvidence?.manifestDigest||null;
 }
 return {...plan,version:'yw-continuous-mode-sample-v4',calibrationProjection:'source-owned-exact-version',
  sessionCompatibilityVerified:false,
  requires:[...plan.requires,'before activation compare existing frozen session, completion and unfinished state with these published pins using dialogue_session_compatibility; a source-only plan does not prove the effective learner contract']};
}

export function prepareModeTurn(snapshot,curriculum,utterance,{selected=null,mutationId=crypto.randomUUID()}={}){
 assert(snapshot&&Number.isSafeInteger(snapshot.revision)&&snapshot.revision>=0,'current snapshot required');
 assert(!snapshot.pending&&!snapshot.partial&&!snapshot.draft,'existing unfinished turn requires reconciliation, not another send');
 assert(!['unavailable','exemption'].includes(snapshot.learningTurn?.kind),'lesson cannot accept a new learning turn');
 assert(!snapshot.curriculumVersion||snapshot.curriculumVersion===curriculum.curriculumVersion,'curriculum version drift');
 assert(typeof utterance==='string'&&utterance.trim(),'authored learner utterance required');
 let content=utterance.trim();
 if(selected){assert(typeof selected.id==='string'&&typeof selected.text==='string'&&selected.text.length>0&&curriculum.passages.some(p=>p.id===selected.id&&p.text.includes(selected.text)),'selected quotation must match the current original');content=`[${selected.id}] ${selected.text}\n\n${content}`;}
 assert(content.length<=3000,'student composer length exceeded');
 assert(/^[a-zA-Z0-9_-]{16,80}$/.test(mutationId),'stable mutation identity required');
 return {mutationId,revision:snapshot.revision,content,questionId:snapshot.question?.id||null,conversation:true,
  taskId:snapshot.learningTurn?.taskId||`${curriculum.curriculumVersion}:${snapshot.revision}:reading-conversation`};
}

// Accept only real server evidence under the unchanged original completion
// checker. A convincing reply or this local helper never grants completion.
export function checkModeLesson(snapshot,curriculum){
 const result=assertComplete(snapshot,curriculum);
 return {...result,modeEvidence:'backend_completion_only',browserVerified:false,centralAcceptanceVerified:false,humanAcceptance:false};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 assert(process.argv[2]==='plan'&&process.argv.length===3,'local plan only; live execution requires a separate approved transaction');
 console.log(JSON.stringify(await prepareCalibratedModeSample(),null,2));
}
