import {normalizeSharedStateResponse} from './assets/yw-shared-state.js';

// Read the existing shared state using the SAME cookie authenticated by YW.
// No session refresh, account fallback, mutation, or browser-supplied scope.
export async function readSharedHistory(cookieHeader,{fetcher=fetch}={}){
 if(!cookieHeader)return {status:'unavailable',reason:'web_session_required'};
 try{
  const response=await fetcher('https://my.bdfz.net/api/yw/v1/state',{
   method:'GET',headers:{cookie:cookieHeader,accept:'application/json'},
   redirect:'error',cache:'no-store',signal:AbortSignal.timeout(6000),
  });
  if(!response.ok)return {status:'unavailable',reason:'shared_history_unavailable'};
  const raw=await response.text();if(raw.length>16000)throw Error('oversize');
  const value=normalizeSharedStateResponse(JSON.parse(raw));
  if(!value)throw Error('invalid_shared_state');
  return {status:'available',...value,authority:'existing-shared-reading-state',scoringRole:'none'};
 }catch{return {status:'unavailable',reason:'shared_history_unavailable'};}
}
