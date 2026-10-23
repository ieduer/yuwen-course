// Evidence quotes must come word for word from the text they cite. Models often copy a line with different punctuation
// or spacing (291 of the 801 vocabulary source sentences differ from their passage only that way, e.g. "," for "，"),
// so a quote that is not found as written is located with whitespace, punctuation and symbols folded away. What is
// stored is always the exact span of the cited text, never the model's copy, so every stored quote stays verbatim.
export const QUOTE_SPAN_VERSION='yw-quote-span-v1';
const skip=ch=>/[\s\p{P}\p{S}]/u.test(ch);

// The exact span of `text` that `quote` cites, or null. Exact matches are returned unchanged; a folded match needs at
// least two letters or characters, and resolves to the first occurrence, trimmed to start and end on one of them.
export function verbatimSpan(text,quote){
 const source=String(text??''),wanted=String(quote??'');
 if(!wanted.trim())return null;
 if(source.includes(wanted))return wanted;
 const want=[...wanted].filter(ch=>!skip(ch));
 if(want.length<2)return null;
 const chars=[...source],kept=[],at=[];
 chars.forEach((ch,i)=>{if(!skip(ch)){kept.push(ch);at.push(i);}});
 outer:for(let i=0;i+want.length<=kept.length;i++){
  for(let k=0;k<want.length;k++)if(kept[i+k]!==want[k])continue outer;
  return chars.slice(at[i],at[i+want.length-1]+1).join('');
 }
 return null;
}
