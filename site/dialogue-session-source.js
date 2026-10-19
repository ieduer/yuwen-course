// Supplement missing source metadata for future turns only. This is not a
// curriculum migration: original objectives, rubrics and stored rows stay exact.
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))).map(x=>x.toString(16).padStart(2,'0')).join('');
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const fields=['sourceInventory','structuralBlocks','frontMatter','guidance','media','sourceOnlyBlocks','studyGuide','languageCorpusVersion','sourceStatus','sourceReviewRequired'];

export async function withSessionSourceMaterials(curriculum,published,{completed,pending,historicalCurriculum=curriculum}={}){
 if(completed!==false||pending!==false||Object.hasOwn(curriculum,'sourceInventory')||curriculum.sessionSourceProjection)return curriculum;
 if(!published.sourceInventory||!hex(published.sourceInventory.readerSha256)||!hex(published.sourceInventory.lessonSha256)
  ||published.sourceStatus!=='source-ready'||published.sourceReviewRequired!==false)return curriculum;
 // Compare content and source identities, not just titles or version strings.
 if(['lessonId','title','author','source','mode'].some(k=>!same(curriculum[k],published[k]))
  ||['passages','annotations','vocabulary','languagePractice'].some(k=>!same(curriculum[k]||[],published[k]||[])))return curriculum;
 // New original-scoring tasks must already have been admitted by their own
 // future-answer policy. Never add tasks, remove old ones or replace criteria.
 if(!published.objectives.every(next=>curriculum.objectives.some(old=>same(old,next))))return curriculum;
 if(fields.some(key=>Object.hasOwn(curriculum,key)&&!same(curriculum[key],published[key])))return curriculum;
 if(historicalCurriculum.lessonId!==curriculum.lessonId||historicalCurriculum.curriculumVersion!==curriculum.curriculumVersion)return curriculum;
 const additions=Object.fromEntries(fields.filter(key=>!Object.hasOwn(curriculum,key)&&Object.hasOwn(published,key)).map(key=>[key,published[key]]));
 const sessionSourceProjection={version:'yw-session-source-materials-v1',
  historicalCurriculumVersion:historicalCurriculum.curriculumVersion,historicalSourceDigest:await digest(historicalCurriculum),
  publishedCurriculumVersion:published.curriculumVersion,publishedSourceDigest:await digest(published),
  priorEffectiveDigest:await digest(curriculum),materialFields:Object.keys(additions),materialDigest:await digest(additions)};
 return {...curriculum,...additions,sessionSourceProjection};
}
