// Read only immutable authenticated YW source facts. No provider, scoring,
// completion replay or ambient form capture is part of this transport.
const failure = code => Object.assign(new Error(code), { code });
const hash = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))]
  .map(n => n.toString(16).padStart(2, '0')).join('');

export function createCursorStore(indexedDB = globalThis.indexedDB) {
  let opening;
  const open = () => opening ||= new Promise((resolve, reject) => {
    if (!indexedDB) return reject(failure('learning_storage_unavailable'));
    const request = indexedDB.open('yw-learning-source-cursors-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('cursors');
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
    request.onerror = () => { opening = null; reject(failure('learning_storage_unavailable')); };
    request.onblocked = () => reject(failure('learning_storage_blocked'));
  });
  async function access(scope, next) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('cursors', next === undefined ? 'readonly' : 'readwrite', { durability: 'strict' });
      const store = tx.objectStore('cursors'); let value;
      const request = store.get(scope);
      request.onsuccess = () => {
        value = request.result || 0;
        if (next !== undefined) { value = Math.max(value, next); store.put(value, scope); }
      };
      tx.oncomplete = () => resolve(value);
      tx.onabort = () => reject(failure('learning_storage_write_failed'));
      tx.onerror = () => {};
    });
  }
  return { get: scope => access(scope), advance: (scope, next) => access(scope, next) };
}

export function createRecorderBridge({ identity = () => globalThis.BdfzIdentity,
  fetchSource = globalThis.fetch?.bind(globalThis), cursors = createCursorStore(), onState = () => {},
  active = () => globalThis.navigator?.onLine !== false && globalThis.document?.visibilityState !== 'hidden',
  schedule = fn => setTimeout(fn, 1000), cancel = clearTimeout } = {}) {
  let generation = 0, runEpoch = -1, inFlight, recorder, timer;
  const notify = value => { try { onState(value); } catch {} };
  function suspend() { generation++; recorder?.close(); recorder = null; if (timer) cancel(timer); timer = null; }
  async function run() {
    if (!active()) return { inactive: true };
    if (inFlight) return runEpoch === generation ? inFlight : inFlight.then(() => run());
    const epoch = generation; runEpoch = epoch;
    const current = () => epoch === generation && active();
    inFlight = (async () => {
      const sdk = identity();
      if (!sdk?.createLearningRecorder) throw failure('learning_recorder_unavailable');
      const session = await sdk.getSession();
      if (!current()) return { stale: true };
      if (!session?.authenticated) throw failure('learning_login_required');
      recorder?.close();
      const r = await sdk.createLearningRecorder({ siteKey: 'yw', onState: value => { if (current()) notify(value); } });
      if (!current()) { r.close(); return { stale: true }; }
      recorder = r;
      await r.flush();
      let after = await cursors.get(r.scope), count = 0, hasMore = false;
      for (let page = 0; page < 4 && current(); page++) {
        const response = await fetchSource(`/api/learning/recorder-events?after=${after}`, {
          credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) throw failure(response.status === 401 ? 'learning_login_required' : 'learning_source_unavailable');
        const batch = await response.json();
        if (!current()) return { stale: true };
        if (!batch.ok || batch.scope !== r.scope) throw failure('learning_account_changed');
        if (!Array.isArray(batch.events) || batch.events.length > 32) throw failure('learning_source_invalid');
        // Validate the complete page before advancing anything.
        const validated = []; let sequence = after;
        for (const row of batch.events) {
          if (!Number.isSafeInteger(row.sequence) || row.sequence <= sequence
            || typeof row.payload !== 'string' || new TextEncoder().encode(row.payload).byteLength !== row.byteLength
            || await hash(row.payload) !== row.sha256) throw failure('learning_source_integrity_failed');
          const operation = JSON.parse(row.payload);
          if (operation.siteKey !== 'yw' || operation.schemaVersion !== 'bdfz-learning-operation-v1'
            || Object.hasOwn(operation, 'scope')) throw failure('learning_source_invalid');
          validated.push({ sequence: row.sequence, operation }); sequence = row.sequence;
        }
        if (batch.nextCursor !== sequence || (batch.hasMore && !validated.length)) throw failure('learning_cursor_invalid');
        for (const row of validated) {
          if (!current()) return { stale: true };
          // The shared recorder acknowledges this local transfer only after a
          // durable write. Its receipt/digest/record_only checks own delivery.
          await r.record(row.operation);
          await cursors.advance(r.scope, row.sequence);
          after = row.sequence; count++;
        }
        hasMore = batch.hasMore === true;
        if (!hasMore) break;
      }
      await r.flush();
      const remaining = await r.pending?.() || [];
      if (current() && remaining.some(row => row.state === 'review' || row.attempts >= 3)) {
        notify({ status: 'needs_attention', code: 'learning_delivery_needs_attention' });
      }
      if (hasMore && current()) timer = schedule(() => { timer = null; void run(); });
      return { queued: count, hasMore };
    })().catch(error => {
      if (epoch === generation) notify({ status: 'needs_attention', code: error.code || 'learning_recording_unavailable' });
      return { error: error.code || 'learning_recording_unavailable' };
    }).finally(() => { inFlight = null; });
    return inFlight;
  }
  return { run, suspend, close: suspend };
}
