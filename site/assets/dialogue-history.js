// Read only the central server-verified owner scope. Never adopt anonymous or
// unscoped records, never upload browser records as learning/grade authority.
export function readBrowserHistory(storage,scope,lessonId){
 if(!/^ywo_[a-f0-9]{32}$/.test(scope||''))return {status:'unavailable',reason:'owner_not_verified'};
 const key=`yw-matrix-progress-v2:scope:${scope}`;
 try{
  const raw=storage.getItem(key);if(raw===null)return {status:'not_found',authority:'browser_only'};
  if(raw.length>2000000)return {status:'unavailable',reason:'local_history_requires_original_view'};
  const values=JSON.parse(raw),record=values?.[lessonId];
  if(!record||typeof record!=='object'||Array.isArray(record))return {status:'not_found',authority:'browser_only'};
  return {status:'available',authority:'browser_only_unverified',record,notice:'本機原有紀錄，未當作服務端掌握證據；不重評、不覆寫。'};
 }catch{return {status:'unavailable',reason:'local_history_unreadable'};}
}
