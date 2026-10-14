import {FORMAL_FIELDS} from './dialogue-formal.js';

// Budget for one full remediation path plus 50% headroom. Daily and monetary
// budgets remain separate; historical calls are never reset by this policy.
export function lessonCallLimit(curriculum, minimum=120){
 const formal=(curriculum.objectives||[]).filter(o=>o.domain==='legacy');
 const mapped={contextWords:'context',authorQuestion:'authorQuestion',revision:'revision',structure:'structure',wordCreation:'wordCreation',evaluation:'evaluation'};
 const covered=new Set(formal.map(o=>mapped[o.legacy?.questionKind]).filter(Boolean));
 const questionCount=(curriculum.vocabulary||[]).length+(curriculum.languagePractice||[]).length;
 const sourceCalls=formal.filter(o=>FORMAL_FIELDS[o.legacy?.questionKind]).length;
 const guideCalls=(curriculum.studyGuide||[]).filter(g=>g.activeForSelfTest).length;
 const dialogueCalls=(curriculum.objectives||[]).filter(o=>!['legacy','studyGuide','vocabulary','read','firstRead'].includes(o.domain)&&!covered.has(o.domain)).length;
 return Math.max(minimum,Math.ceil((questionCount*5+sourceCalls+guideCalls+dialogueCalls)*1.5));
}
