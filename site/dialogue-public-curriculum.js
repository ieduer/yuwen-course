// The immutable full curriculum is Worker-only assessment authority. Public
// lessons retain learning criteria and sources without publishing answer keys.
export function sanitizeDialogueCurriculum(value){
 const curriculum=structuredClone(value);
 const redact=item=>{for(const key of ['answerIndex','sourceAnswer','meaning','explanation','variants','referenceAnswer','criteria','masteryCriteria'])delete item[key];return item;};
 curriculum.vocabulary=(curriculum.vocabulary||[]).map(redact);
 curriculum.languagePractice=(curriculum.languagePractice||[]).map(redact);
 curriculum.studyGuide=(curriculum.studyGuide||[]).map(item=>{delete item.referenceAnswer;delete item.explanation;return item;});
 curriculum.objectives=(curriculum.objectives||[]).map(o=>o.domain==='vocabulary'?{...o,rule:'依原句說明語境義、判斷依據，並在未提示的新題中獨立解釋。'}:o);
 return curriculum;
}
