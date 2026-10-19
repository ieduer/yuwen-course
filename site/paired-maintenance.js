// Admission only. Already-admitted work must finish before changing the caller pair.
export const CALLER_IDENTITY_PATH='/api/internal/caller-identity';
const response=(body,status)=>Response.json(body,{status,headers:{'cache-control':'private, no-store','vary':'Cookie, Authorization'}});
export function pairedMaintenanceRejection(request,env) {
 if(!Object.hasOwn(env,'YW_RELEASE_READ_ONLY')||env.YW_RELEASE_READ_ONLY!=='true') return null;
 const url=new URL(request.url);
 if(['GET','HEAD','OPTIONS'].includes(request.method)
   && !['/api/learning/health','/api/preview'].includes(url.pathname)) return null;
 return response({ok:false,code:'release_read_only',error:'網站維護中，這次內容尚未送出。請保留草稿，稍後手動重送。',retryable:false,admitted:false},503);
}
export async function checkPairedCallerIdentity(request,env,cookieHeader,now=Date.now()) {
 const url=new URL(request.url),expires=Date.parse(env.YW_DIALOGUE_ACCEPTANCE_EXPIRES_AT || '');
 const unavailable=()=>response({ok:false,code:'caller_identity_unavailable',retryable:false},404);
 if(request.method!=='GET'||url.origin!=='https://yw.bdfz.net'||url.search
   ||env.YW_RELEASE_READ_ONLY!=='true'||env.YW_DIALOGUE_ACCEPTANCE_USER_ID!=='553'
   ||!Number.isFinite(expires)||expires<=now||expires>now+600000
   ||request.headers.get('x-yw-caller-check')!=='1'
   ||(request.headers.get('origin')&&request.headers.get('origin')!==url.origin)
   ||request.headers.get('sec-fetch-site')==='cross-site'||!cookieHeader
   ||typeof env.USER_CENTER_EVIDENCE?.resolveSession!=='function') return unavailable();
 // Deliberately bypass the ordinary five-minute identity cache; never reconcile D1.
 let user;
 try {user=await env.USER_CENTER_EVIDENCE.resolveSession(cookieHeader);} catch {return unavailable();}
 if(user?.authenticated!==true||user.sourceSiteKey!=='yw'||Number(user.userId)!==553||!String(user.slug||'').trim()) return unavailable();
 const secret=env.APIS_CALLER_TOKEN;
 if(typeof secret!=='string'||!secret.trim()||secret.length>256||typeof env.APIS?.fetch!=='function') return unavailable();
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),5000);
 try {
  const upstream=await env.APIS.fetch(new Request('https://apis.bdfz.net/caller-identity',{method:'POST',redirect:'manual',signal:controller.signal,
   headers:{'X-Project-Name':'yw.bdfz.net','X-Internal-Token':secret}}));
  // Identity responses are small; do not buffer an arbitrary upstream body.
  const reader=upstream.body?.getReader();let text='',bytes=0;
  if(reader) {const decoder=new TextDecoder();try {for(;;) {const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>2048){await reader.cancel();throw new Error('oversized identity');}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}finally{reader.releaseLock();}}
  const identity=JSON.parse(text);
  if(upstream.status!==200||identity?.callerId!=='yw.bdfz.net'||identity.identityStatus!=='verified'||typeof identity.requestId!=='string'||!identity.requestId) throw new Error('identity mismatch');
  return response({ok:true,callerId:'yw.bdfz.net',identityStatus:'verified'},200);
 } catch {return response({ok:false,code:'caller_identity_unverified',retryable:false},502);}
 finally {clearTimeout(timeout);}
}
