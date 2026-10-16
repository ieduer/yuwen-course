import privateData from './assessment-private-data.js';
// Full assessment authority is a Worker module, never a static asset in a release.
export async function fetchAssessmentAsset(env, request) {
 const pathname = new URL(request.url).pathname;
 if (privateData !== null) {
  const body = privateData[pathname];
  if (body !== undefined) return new Response(body, {headers:{'content-type':'application/json','cache-control':'private, no-store'}});
 }
 return env.ASSETS.fetch(request);
}
