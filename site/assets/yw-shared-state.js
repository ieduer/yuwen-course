const STATE_SCHEMA = "yw-shared-state/1";
const MUTATION_SCHEMA = "yw-shared-state-mutation/1";
const RECEIPT_SCHEMA = "yw-shared-state-receipt/1";
const OUTBOX_SCHEMA = "yw-shared-state-outbox/2";
const SITE_KEY = "yw";
const CLIENT = "yuwen-web";
const READING_POSITION = "READING_POSITION";
const READER_PREFERENCE = "READER_PREFERENCE";
const TEXT_SCALE = "TEXT_SCALE";
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const OWNER_SCOPE = /^ywo_[0-9a-f]{32}$/;
const DURABLE_RECEIPT_ID = /^ywmr_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA_256 = /^[0-9a-f]{64}$/;

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeyOrder(value, keys) {
  return isRecord(value)
    && Object.keys(value).length === keys.length
    && Object.keys(value).every((key, index) => key === keys[index]);
}

function boundedString(value, maxLength) {
  const text = typeof value === "string" ? value.trim() : "";
  return text && text.length <= maxLength ? text : "";
}

function validEpoch(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function validTextScale(value) {
  return Number.isFinite(value) && value >= 0.75 && value <= 2;
}

function normalizeReadingPosition(value) {
  if (value === null) return null;
  if (!hasExactKeyOrder(
    value,
    [
      "kind",
      "contentVersion",
      "lessonId",
      "documentId",
      "stableAnchor",
      "updatedAtEpochMillis",
      "clientMutationId",
    ],
  )) return undefined;

  const contentVersion = boundedString(value.contentVersion, 180);
  const lessonId = boundedString(value.lessonId, 180);
  const documentId = boundedString(value.documentId, 180);
  const stableAnchor = boundedString(value.stableAnchor, 512);
  if (
    value.kind !== READING_POSITION
    || !contentVersion
    || !lessonId
    || !documentId
    || !stableAnchor
    || !validEpoch(value.updatedAtEpochMillis)
    || !UUID_V4.test(value.clientMutationId)
  ) {
    return undefined;
  }

  const normalized = {
    kind: READING_POSITION,
    contentVersion,
    lessonId,
    documentId,
    stableAnchor,
    updatedAtEpochMillis: value.updatedAtEpochMillis,
    clientMutationId: value.clientMutationId,
  };
  return normalized;
}

function normalizeReaderPreferences(value) {
  if (!isRecord(value) || Object.keys(value).some((key) => key !== TEXT_SCALE)) {
    return undefined;
  }
  if (!Object.hasOwn(value, TEXT_SCALE)) return {};
  const preference = value[TEXT_SCALE];
  if (!hasExactKeyOrder(
    preference,
    ["value", "updatedAtEpochMillis", "clientMutationId"],
  )) return undefined;
  if (
    !validTextScale(preference.value)
    || !validEpoch(preference.updatedAtEpochMillis)
    || !UUID_V4.test(preference.clientMutationId)
  ) return undefined;
  return {
    [TEXT_SCALE]: {
      value: preference.value,
      updatedAtEpochMillis: preference.updatedAtEpochMillis,
      clientMutationId: preference.clientMutationId,
    },
  };
}

export function normalizeSharedStateResponse(value) {
  if (
    !hasExactKeyOrder(value, ["schemaVersion", "siteKey", "ownerScope", "state"])
    || value.schemaVersion !== STATE_SCHEMA
    || value.siteKey !== SITE_KEY
    || !OWNER_SCOPE.test(value.ownerScope)
    || !hasExactKeyOrder(value.state, ["readingPosition", "readerPreferences"])
  ) return null;

  const readingPosition = normalizeReadingPosition(value.state.readingPosition);
  const readerPreferences = normalizeReaderPreferences(value.state.readerPreferences);
  if (readingPosition === undefined || readerPreferences === undefined) return null;
  return {
    ownerScope: value.ownerScope,
    readingPosition,
    readerPreferences,
  };
}

export function createUuidV4(cryptoSource = globalThis.crypto) {
  const nativeUuid = cryptoSource?.randomUUID?.().toLowerCase();
  if (nativeUuid && UUID_V4.test(nativeUuid)) return nativeUuid;
  if (!cryptoSource?.getRandomValues) throw new Error("secure UUID unavailable");
  const bytes = new Uint8Array(16);
  cryptoSource.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function buildReadingPositionMutation(
  input,
  { cryptoSource = globalThis.crypto, now = Date.now } = {},
) {
  const ownerScope = boundedString(input?.ownerScope, 36);
  const contentVersion = boundedString(input?.contentVersion, 180);
  const lessonId = boundedString(input?.lessonId, 180);
  const documentId = boundedString(input?.documentId, 180);
  const stableAnchor = boundedString(input?.stableAnchor, 512);
  if (!OWNER_SCOPE.test(ownerScope)) throw new Error("ownerScope required");
  if (!contentVersion) throw new Error("contentVersion required");
  if (!lessonId) throw new Error("lessonId required");
  if (!documentId) throw new Error("documentId required");
  if (!stableAnchor) throw new Error("stableAnchor required");
  const createdAtEpochMillis = now();
  if (!validEpoch(createdAtEpochMillis)) throw new Error("valid time required");
  const clientMutationId = createUuidV4(cryptoSource);
  const mutation = {
    kind: READING_POSITION,
    contentVersion,
    lessonId,
    documentId,
    stableAnchor,
    updatedAtEpochMillis: createdAtEpochMillis,
  };
  return {
    schemaVersion: MUTATION_SCHEMA,
    clientMutationId,
    ownerScope,
    siteKey: SITE_KEY,
    client: CLIENT,
    createdAtEpochMillis,
    mutation,
  };
}

export function buildTextScaleMutation(
  value,
  {
    ownerScope,
    cryptoSource = globalThis.crypto,
    now = Date.now,
  } = {},
) {
  if (!OWNER_SCOPE.test(String(ownerScope || ""))) {
    throw new Error("ownerScope required");
  }
  if (!validTextScale(value)) throw new Error("invalid text scale");
  const createdAtEpochMillis = now();
  if (!validEpoch(createdAtEpochMillis)) throw new Error("valid time required");
  const clientMutationId = createUuidV4(cryptoSource);
  return {
    schemaVersion: MUTATION_SCHEMA,
    clientMutationId,
    ownerScope,
    siteKey: SITE_KEY,
    client: CLIENT,
    createdAtEpochMillis,
    mutation: {
      kind: READER_PREFERENCE,
      key: TEXT_SCALE,
      value,
      updatedAtEpochMillis: createdAtEpochMillis,
    },
  };
}

function validMutation(value) {
  if (
    !hasExactKeyOrder(value, [
      "schemaVersion",
      "clientMutationId",
      "ownerScope",
      "siteKey",
      "client",
      "createdAtEpochMillis",
      "mutation",
    ])
    || value.schemaVersion !== MUTATION_SCHEMA
    || !OWNER_SCOPE.test(value.ownerScope)
    || value.siteKey !== SITE_KEY
    || value.client !== CLIENT
    || !UUID_V4.test(value.clientMutationId)
    || !validEpoch(value.createdAtEpochMillis)
    || !isRecord(value.mutation)
  ) return false;

  const { kind } = value.mutation;
  if (kind === READING_POSITION) {
    if (!hasExactKeyOrder(
      value.mutation,
      [
        "kind",
        "contentVersion",
        "lessonId",
        "documentId",
        "stableAnchor",
        "updatedAtEpochMillis",
      ],
    )) return false;
    if (
      !boundedString(value.mutation.contentVersion, 180)
      || !boundedString(value.mutation.lessonId, 180)
      || !boundedString(value.mutation.documentId, 180)
      || !boundedString(value.mutation.stableAnchor, 512)
      || !validEpoch(value.mutation.updatedAtEpochMillis)
    ) {
      return false;
    }
    return true;
  }

  if (kind === READER_PREFERENCE) {
    return hasExactKeyOrder(
      value.mutation,
      ["kind", "key", "value", "updatedAtEpochMillis"],
    )
      && value.mutation.key === TEXT_SCALE
      && validTextScale(value.mutation.value)
      && validEpoch(value.mutation.updatedAtEpochMillis);
  }
  return false;
}

function mutationKey(value) {
  if (value.mutation.kind === READER_PREFERENCE) {
    return `${READER_PREFERENCE}:${value.mutation.key}`;
  }
  return value.mutation.kind;
}

async function sha256Hex(value, cryptoSource = globalThis.crypto) {
  if (!cryptoSource?.subtle) throw new Error("secure digest unavailable");
  const bytes = new TextEncoder().encode(value);
  const digest = new Uint8Array(await cryptoSource.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizeReceipt(
  value,
  {
    expectedMutationId,
    expectedOwnerScope,
    expectedRequestSha256,
  },
) {
  if (
    !hasExactKeyOrder(value, [
      "schemaVersion",
      "clientMutationId",
      "ownerScope",
      "durableReceiptId",
      "durableStorageVerified",
      "requestSha256",
    ])
    || value.schemaVersion !== RECEIPT_SCHEMA
    || value.clientMutationId !== expectedMutationId
    || !UUID_V4.test(value.clientMutationId)
    || value.ownerScope !== expectedOwnerScope
    || !OWNER_SCOPE.test(value.ownerScope)
    || !DURABLE_RECEIPT_ID.test(value.durableReceiptId)
    || value.durableStorageVerified !== true
    || value.requestSha256 !== expectedRequestSha256
    || !SHA_256.test(value.requestSha256)
  ) return null;
  return value;
}

function loadOutbox(storage, storageKey) {
  if (
    typeof storage?.getItem !== "function"
    || typeof storage?.setItem !== "function"
  ) {
    throw new Error("durable storage required");
  }
  const raw = storage.getItem(storageKey);
  if (raw === null) return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("durable outbox unreadable");
  }
  if (
    !hasExactKeyOrder(parsed, ["schemaVersion", "mutations"])
    || parsed.schemaVersion !== OUTBOX_SCHEMA
    || !Array.isArray(parsed.mutations)
    || parsed.mutations.length > 32
    || !parsed.mutations.every(validMutation)
  ) {
    throw new Error("durable outbox invalid");
  }
  return parsed.mutations;
}

function saveOutbox(storage, storageKey, mutations) {
  const serialized = JSON.stringify({
    schemaVersion: OUTBOX_SCHEMA,
    mutations,
  });
  storage.setItem(storageKey, serialized);
  if (storage.getItem(storageKey) !== serialized) {
    throw new Error("durable outbox readback failed");
  }
}

export function createSharedStateClient({
  api,
  storage,
  storageKey,
  ownerScope,
  cryptoSource = globalThis.crypto,
  now = Date.now,
  onRemoteState = () => {},
}) {
  if (typeof api !== "function") throw new Error("api required");
  if (!boundedString(storageKey, 300)) throw new Error("storageKey required");
  if (!OWNER_SCOPE.test(String(ownerScope || ""))) {
    throw new Error("ownerScope required");
  }

  let mutations = loadOutbox(storage, storageKey);
  if (mutations.some((mutation) => mutation.ownerScope !== ownerScope)) {
    throw new Error("durable outbox owner mismatch");
  }
  let flushPromise = null;
  let hydratePromise = null;
  let contractReady = false;

  const readOwnedState = async () => {
    const payload = await api("/api/yw/v1/state");
    const remoteState = normalizeSharedStateResponse(payload);
    if (!remoteState || remoteState.ownerScope !== ownerScope) return null;
    return remoteState;
  };
  const verifyOwnerCurrent = async () => {
    try {
      return Boolean(await readOwnedState());
    } catch {
      return false;
    }
  };
  const enqueue = (mutation) => {
    if (!validMutation(mutation)) throw new Error("invalid mutation");
    if (mutation.ownerScope !== ownerScope) throw new Error("owner mismatch");
    const key = mutationKey(mutation);
    const nextMutations = mutations.filter((item) => mutationKey(item) !== key);
    nextMutations.push(mutation);
    saveOutbox(storage, storageKey, nextMutations);
    mutations = nextMutations;
    return mutation.clientMutationId;
  };

  const flush = () => {
    if (!contractReady) {
      return Promise.resolve({ ok: false, acknowledged: 0, pending: mutations.length });
    }
    if (flushPromise) return flushPromise;
    flushPromise = (async () => {
      let acknowledged = 0;
      while (contractReady && mutations.length) {
        const mutation = mutations[0];
        if (!await verifyOwnerCurrent()) {
          contractReady = false;
          break;
        }
        const requestText = JSON.stringify(mutation);
        let requestSha256;
        let receipt;
        try {
          requestSha256 = await sha256Hex(requestText, cryptoSource);
          receipt = await api(
            `/api/yw/v1/mutations/${mutation.clientMutationId}`,
            { method: "PUT", body: mutation },
          );
        } catch {
          break;
        }
        if (!await verifyOwnerCurrent()) {
          contractReady = false;
          break;
        }
        if (!normalizeReceipt(receipt, {
          expectedMutationId: mutation.clientMutationId,
          expectedOwnerScope: ownerScope,
          expectedRequestSha256: requestSha256,
        })) break;
        const nextMutations = mutations.filter(
          (item) => item.clientMutationId !== mutation.clientMutationId,
        );
        try {
          saveOutbox(storage, storageKey, nextMutations);
        } catch {
          break;
        }
        mutations = nextMutations;
        acknowledged += 1;
      }
      return { ok: mutations.length === 0, acknowledged, pending: mutations.length };
    })().finally(() => {
      flushPromise = null;
    });
    return flushPromise;
  };

  return {
    hydrate({ pendingKinds: externalPendingKinds = [], initialState = null } = {}) {
      if (hydratePromise) return hydratePromise;
      hydratePromise = (async () => {
        contractReady = false;
        let remoteState;
        if (initialState) {
          remoteState = normalizeSharedStateResponse(initialState);
          if (!remoteState || remoteState.ownerScope !== ownerScope) {
            return { ok: false, pending: mutations.length };
          }
        } else {
          try {
            remoteState = await readOwnedState();
          } catch {
            return { ok: false, pending: mutations.length };
          }
        }
        if (!remoteState) return { ok: false, pending: mutations.length };
        if (!await verifyOwnerCurrent()) {
          return { ok: false, pending: mutations.length };
        }
        const pendingKinds = new Set([
          ...mutations.map(mutationKey),
          ...externalPendingKinds,
        ]);
        await onRemoteState(remoteState, {
          ownerScope,
          pendingKinds,
          verifyOwnerCurrent,
        });
        if (!await verifyOwnerCurrent()) {
          return { ok: false, pending: mutations.length };
        }
        contractReady = true;
        const flushed = await flush();
        return { ok: true, ...flushed };
      })().finally(() => {
        hydratePromise = null;
      });
      return hydratePromise;
    },
    queueReadingPosition(input) {
      return enqueue(buildReadingPositionMutation(
        { ...input, ownerScope },
        { cryptoSource, now },
      ));
    },
    queueTextScale(value) {
      return enqueue(buildTextScaleMutation(
        value,
        { ownerScope, cryptoSource, now },
      ));
    },
    flush,
    ownerScope,
    pendingCount() {
      return mutations.length;
    },
    verifyOwnerCurrent,
  };
}

export const YW_SHARED_STATE_CONTRACT = Object.freeze({
  STATE_SCHEMA,
  MUTATION_SCHEMA,
  RECEIPT_SCHEMA,
  SITE_KEY,
  CLIENT,
  READING_POSITION,
  READER_PREFERENCE,
  TEXT_SCALE,
  OWNER_SCOPE,
  DURABLE_RECEIPT_ID,
});
