// Local preparation for the real student's continuous-dialogue path.
// No transport, activation, budget grant, source mutation or completion override.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {loadCurriculum,hash,assertComplete} from './dialogue_e2e.mjs';

export const MODE_SAMPLE_IDS=Object.freeze(['lesson-1498','lesson-1711-p1','lesson-1717-p2']);

export function prepareModeSample(ids=MODE_SAMPLE_IDS,loader=loadCurriculum){
 assert(Array.isArray(ids)&&ids.length>=1&&ids.length<=3&&new Set(ids).size===ids.length,'one to three distinct representative lessons required');
 const lessons=ids.map(id=>{
  const c=loader(id);assert(c?.lessonId===id&&c.curriculumVersion&&c.sourceInventory?.readerSha256&&c.passages?.length,'exact curriculum and original material required');
  return {lessonId:id,title:c.title,mode:c.mode,curriculumVersion:c.curriculumVersion,sourceDigest:hash(c),readerSha256:c.sourceInventory.readerSha256,objectiveIds:c.objectives.map(o=>o.id)};
 });
 return {version:'yw-continuous-mode-sample-v1',status:'offline_prepared_not_accepted',productScope:189,lessons,route:'/api/dialogue/v1',conversation:true,
  scope:'same student conversation path; no per-field answer automation',
  requires:['fresh exact source and authorized finite execution','actual current original text, annotations, guides and rubrics in prompt evidence','natural adaptive learner utterances, including preference or question changes','backend original evidence, coverage and prerequisite checks','save, reload and continuation; preserved historical scores','actual source outbox to central accepted receipt to ordinary My reload','browser/mobile and human review'],
  budgetDisposition:{logicalModelCallsPerConversationalSend:1,deterministicGuideFeedback:'reserve the conversational reply; do not subtract it as a zero-call grading shortcut',providerAttemptLimit:'must bind the fresh approved policy; logical calls are not provider attempt counts',allowanceGranted:false},
  realProviderVerified:false,centralAcceptanceVerified:false,humanAcceptance:false,executionAuthorized:false};
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
 console.log(JSON.stringify(prepareModeSample(),null,2));
}
