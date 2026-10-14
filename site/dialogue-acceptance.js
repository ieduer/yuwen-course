// Used only by the separate acceptance entrypoint. Ordinary Pages never create
// this context; neither client headers nor similarly named production vars do.
const contexts = new WeakMap();
export const ACCEPTANCE_ORIGIN = 'https://yw-acceptance.bdfz.net';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHARED_DATABASES = new Set(['99c541e7-e70b-4584-b939-7e88a6dd68c5', '39ed36d9-b3f3-40fd-933a-9a68a4066302']);
const PUBLIC_ASSETS = new Set([
  '/dialogue', '/dialogue.html', '/assets/dialogue.js', '/assets/dialogue.css',
  '/assets/dialogue-events.js', '/assets/dialogue-history.js',
  '/assets/dialogue-first-read.js', '/assets/classical-first-read.js',
  '/assets/textbook-pages.js', '/data/textbook-pages.v1.json',
  '/dialogue-curriculum/index.json',
]);
const rejection = (code, status) => new Response(JSON.stringify({code}), {
  status, headers: {'content-type':'application/json', 'cache-control':'private, no-store'},
});

export function acceptanceContext(env) { return contexts.get(env) || null; }

export function acceptanceEnvironment(request, bindings, now = Date.now()) {
  const expires = Date.parse(bindings.YW_ACCEPTANCE_EXPIRES_AT);
  const userId = String(bindings.YW_ACCEPTANCE_USER_ID || '');
  const version = bindings.YW_ACCEPTANCE_APIS_VERSION;
  const databaseId = bindings.YW_ACCEPTANCE_DATABASE_ID;
  if (new URL(request.url).origin !== ACCEPTANCE_ORIGIN) throw Error('acceptance_host_required');
  if (!Number.isFinite(expires) || now >= expires) throw Error('acceptance_expired');
  if (!/^[1-9][0-9]*$/.test(userId) || !Number.isSafeInteger(Number(userId))
    || !UUID.test(version || '') || !UUID.test(databaseId || '') || SHARED_DATABASES.has(databaseId)
    || bindings.READING_DB || bindings.READING_TEST_SLUG || bindings.LEARNING_EVIDENCE_QUEUE
    || typeof bindings.ACCEPTANCE_DB?.prepare !== 'function'
    || typeof bindings.USER_CENTER_EVIDENCE?.resolveSession !== 'function'
    || typeof bindings.APIS_ACCEPTANCE?.fetch !== 'function'
    || typeof bindings.ASSETS?.fetch !== 'function') throw Error('acceptance_configuration_invalid');
  // Capability allowlist: do not pass Queue, scheduler, legacy flags or any
  // additional service/data binding through to the real dialogue handlers.
  const identity = bindings.USER_CENTER_EVIDENCE;
  const cookies = (request.headers.get('cookie') || '').split(';').map(x=>x.trim())
    .filter(x=>x.startsWith('bdfz_uc_session='));
  const cookie = cookies.length===1 && /^bdfz_uc_session=[^\s;\r\n]{1,2048}$/.test(cookies[0]) ? cookies[0] : '';
  const env = {
    ASSETS: bindings.ASSETS, READING_DB: bindings.ACCEPTANCE_DB,
    APIS: {fetch: async outgoing => {
      if(Date.now()>=expires || !cookie) throw Error('acceptance_session_required');
      const headers=new Headers(outgoing.headers);
      headers.delete('x-internal-token');
      headers.set('cookie',cookie);
      headers.set('Cloudflare-Workers-Version-Overrides',`apis="${version}"`);
      return bindings.APIS_ACCEPTANCE.fetch(new Request(outgoing,{headers}));
    }},
    YW_DIALOGUE_ENABLED: 'true', YW_DIALOGUE_BUDGET_JSON: bindings.YW_DIALOGUE_BUDGET_JSON,
    YW_CALIBRATION_AMENDMENT4_JSON: bindings.YW_CALIBRATION_AMENDMENT4_JSON,
    YW_CALIBRATION_AMENDMENT5_JSON: bindings.YW_CALIBRATION_AMENDMENT5_JSON,
    YW_DIALOGUE_PROVIDER_ATTEMPTS: bindings.YW_DIALOGUE_PROVIDER_ATTEMPTS,
    YW_E2E_AUTHORITY_JSON: bindings.YW_E2E_AUTHORITY_JSON,
    USER_CENTER_EVIDENCE: {
      resolveSession: (...args) => identity.resolveSession(...args),
      resolveNativeSession: (...args) => identity.resolveNativeSession(...args),
    },
  };
  contexts.set(env, Object.freeze({origin: ACCEPTANCE_ORIGIN, userId:Number(userId), version, databaseId,
    activationDigest: bindings.YW_ACCEPTANCE_ACTIVATION_SHA256, expires, transport:'service_binding_session'}));
  return env;
}

export function acceptanceAllowsIdentity(env, user) {
  const context = acceptanceContext(env);
  return !context || (Date.now() < context.expires && Number(user?.userId) === context.userId);
}

export function acceptanceVersionHeaders(env) {
  const context = acceptanceContext(env);
  if (!context) return {};
  if (Date.now() >= context.expires) throw Error('acceptance_expired');
  return {'Cloudflare-Workers-Version-Overrides': `apis="${context.version}"`};
}

export function createAcceptanceWorker(worker) {
  return {async fetch(request, bindings, ctx) {
    let env;
    try { env = acceptanceEnvironment(request, bindings); }
    catch (error) { return rejection(error.message, 503); }
    const url = new URL(request.url);
    if (url.pathname === '/api/dialogue/v1') {
      if (!['GET', 'POST'].includes(request.method)) return rejection('method_not_allowed', 405);
      // The native flow retains its existing credential resolver, but this
      // Web-only acceptance host still requires its exact Origin for mutations.
      if (request.method === 'POST' && request.headers.get('origin') !== ACCEPTANCE_ORIGIN) {
        return rejection('web_origin_required', 403);
      }
      return worker.fetch(request, env, ctx);
    }
    // Curriculum contains server-only answer keys. The normal worker returns
    // the same sanitized projection here; never expose the raw asset binding.
    if (['GET', 'HEAD'].includes(request.method)
      && /^\/dialogue-curriculum\/lesson-[\w-]{1,60}\.json$/.test(url.pathname)) {
      return worker.fetch(request, env, ctx);
    }
    const firstRead = url.pathname.match(/^\/data\/classical-first-read\/(lesson-[\w-]{1,60})\.json$/);
    let registeredFirstRead = false;
    if (firstRead && ['GET', 'HEAD'].includes(request.method)) {
      const catalog = await env.ASSETS.fetch(new Request(ACCEPTANCE_ORIGIN+'/dialogue-curriculum/index.json'));
      registeredFirstRead = catalog.ok && (await catalog.json()).lessons?.some(row=>row.lessonId===firstRead[1]);
    }
    if (!['GET', 'HEAD'].includes(request.method)
      || !(PUBLIC_ASSETS.has(url.pathname) || registeredFirstRead)) {
      return rejection('not_found', 404);
    }
    // Pages serves extensionless HTML itself. Rewriting to .html redirects back
    // to /dialogue and loops through this wrapper on every browser request.
    const response = await env.ASSETS.fetch(new Request(url, request));
    const headers = new Headers(response.headers);
    headers.set('cache-control', 'no-store');
    headers.set('x-robots-tag', 'noindex, nofollow');
    // The dialogue page has no shared login SDK, telemetry, or central writes.
    headers.set('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    return new Response(response.body, {status:response.status, headers});
  }};
}
