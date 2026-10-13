// Display-derived reading text; never a second textbook asset or a new rubric.
export const READING_MATERIAL_VERSION='yw-reading-material-v1';
export const unpunctuated=text=>text.replace(/[\p{P}\s]/gu,'');
export async function dialogueReadingAsset(curriculum){
 const paragraphs=curriculum.passages.map(p=>({key:p.id,text:unpunctuated(p.text)}));
 const identity=JSON.stringify({version:READING_MATERIAL_VERSION,lessonId:curriculum.lessonId,readerSha256:curriculum.sourceInventory?.readerSha256||null,paragraphs});
 const textDigest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(identity)))).map(n=>n.toString(16).padStart(2,'0')).join('');
 return {kind:'conversation-reading',textVersionId:`${READING_MATERIAL_VERSION}:${textDigest}`,textDigest,paragraphs};
}
// Keep UTF-16 offsets, matching DOM selections and existing source contracts.
export function originalRange(text,start,end){
 const offsets=[];let offset=0;
 for(const char of text){if(!/[\p{P}\s]/u.test(char))for(let i=0;i<char.length;i++)offsets.push(offset+i);offset+=char.length;}
 if(start<0||end<=start||end>offsets.length)return null;
 return [offsets[start],offsets[end-1]+1];
}
