#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  YW_SHARED_STATE_CONTRACT,
  buildReadingPositionMutation,
  buildTextScaleMutation,
  createSharedStateClient,
  normalizeSharedStateResponse,
} from "../site/assets/yw-shared-state.js";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";
const RECEIPT_A = "ywmr_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OWNER_A = `ywo_${"a".repeat(32)}`;
const OWNER_B = `ywo_${"b".repeat(32)}`;
const CONTENT_VERSION = "yw-3e77f0f7ffa5d042a6d06763";
const FIXED_NOW = 1_775_000_000_000;

function cryptoSequence(...uuids) {
  let index = 0;
  return {
    subtle: webcrypto.subtle,
    randomUUID() {
      return uuids[index++] || uuids.at(-1);
    },
  };
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    dump(key) {
      return JSON.parse(values.get(key) || "null");
    },
  };
}

function requestSha256(body) {
  return createHash("sha256").update(JSON.stringify(body)).digest("hex");
}

function receipt(body, overrides = {}) {
  return {
    schemaVersion: "yw-shared-state-receipt/1",
    clientMutationId: body.clientMutationId,
    ownerScope: body.ownerScope,
    durableReceiptId: RECEIPT_A,
    durableStorageVerified: true,
    requestSha256: requestSha256(body),
    ...overrides,
  };
}

function remoteState(ownerScope = OWNER_A) {
  return {
    schemaVersion: "yw-shared-state/1",
    siteKey: "yw",
    ownerScope,
    state: {
      readingPosition: {
        kind: "READING_POSITION",
        contentVersion: CONTENT_VERSION,
        lessonId: "lesson-1576",
        documentId: "body",
        stableAnchor: "lesson-root",
        updatedAtEpochMillis: FIXED_NOW,
        clientMutationId: UUID_A,
      },
      readerPreferences: {
        TEXT_SCALE: {
          value: 1.26,
          updatedAtEpochMillis: FIXED_NOW,
          clientMutationId: UUID_B,
        },
      },
    },
  };
}

function readingInput(lessonId = "lesson-1576") {
  return {
    contentVersion: CONTENT_VERSION,
    lessonId,
    documentId: "body",
    stableAnchor: "lesson-root",
  };
}

test("the GET contract accepts only the object-shaped reading position and TEXT_SCALE preference", () => {
  assert.deepEqual(normalizeSharedStateResponse(remoteState()), {
    ownerScope: OWNER_A,
    ...remoteState().state,
  });

  const missingOwner = remoteState();
  delete missingOwner.ownerScope;
  assert.equal(normalizeSharedStateResponse(missingOwner), null);

  const wrongOwner = remoteState("ywo_not-an-owner");
  assert.equal(normalizeSharedStateResponse(wrongOwner), null);

  const unknownPreference = remoteState();
  unknownPreference.state.readerPreferences.COLOR_SCHEME = {
    value: "dark",
    updatedAtEpochMillis: FIXED_NOW,
    clientMutationId: UUID_A,
  };
  assert.equal(normalizeSharedStateResponse(unknownPreference), null);

  const unknownReadingField = remoteState();
  unknownReadingField.state.readingPosition.score = 100;
  assert.equal(normalizeSharedStateResponse(unknownReadingField), null);

  const unknownReadingKind = remoteState();
  unknownReadingKind.state.readingPosition.kind = "LESSON_OPENED";
  assert.equal(normalizeSharedStateResponse(unknownReadingKind), null);

  const wrongSchema = remoteState();
  wrongSchema.schemaVersion = "yw-shared-state-v1";
  assert.equal(normalizeSharedStateResponse(wrongSchema), null);
  const wrongContentVersionOrder = remoteState();
  wrongContentVersionOrder.state.readingPosition = {
    kind: "READING_POSITION",
    lessonId: "lesson-1576",
    contentVersion: CONTENT_VERSION,
    documentId: "body",
    stableAnchor: "lesson-root",
    updatedAtEpochMillis: FIXED_NOW,
    clientMutationId: UUID_A,
  };
  assert.equal(normalizeSharedStateResponse(wrongContentVersionOrder), null);
  const wrongPreferenceOrder = remoteState();
  wrongPreferenceOrder.state.readerPreferences.TEXT_SCALE = {
    updatedAtEpochMillis: FIXED_NOW,
    value: 1.26,
    clientMutationId: UUID_B,
  };
  assert.equal(normalizeSharedStateResponse(wrongPreferenceOrder), null);
  assert.equal(typeof remoteState().state.readerPreferences.TEXT_SCALE.value, "number");
});

test("mutation builders emit only the two non-scoring allowlisted payloads", () => {
  const maxAnchor = "a".repeat(512);
  const reading = buildReadingPositionMutation(
    {
      ownerScope: OWNER_A,
      contentVersion: CONTENT_VERSION,
      lessonId: "lesson-1576",
      documentId: "body",
      stableAnchor: "lesson-root",
    },
    { cryptoSource: cryptoSequence(UUID_A), now: () => FIXED_NOW },
  );
  const preference = buildTextScaleMutation(
    1.12,
    {
      ownerScope: OWNER_A,
      cryptoSource: cryptoSequence(UUID_B),
      now: () => FIXED_NOW + 1,
    },
  );
  const anchoredReading = buildReadingPositionMutation(
    {
      ownerScope: OWNER_A,
      contentVersion: CONTENT_VERSION,
      lessonId: "lesson-1576",
      documentId: "document-1576",
      stableAnchor: maxAnchor,
    },
    { cryptoSource: cryptoSequence(UUID_A), now: () => FIXED_NOW },
  );

  assert.deepEqual(reading, {
    schemaVersion: "yw-shared-state-mutation/1",
    clientMutationId: UUID_A,
    ownerScope: OWNER_A,
    siteKey: "yw",
    client: "yuwen-web",
    createdAtEpochMillis: FIXED_NOW,
    mutation: {
      kind: "READING_POSITION",
      contentVersion: CONTENT_VERSION,
      lessonId: "lesson-1576",
      documentId: "body",
      stableAnchor: "lesson-root",
      updatedAtEpochMillis: FIXED_NOW,
    },
  });
  assert.deepEqual(Object.keys(reading), [
    "schemaVersion",
    "clientMutationId",
    "ownerScope",
    "siteKey",
    "client",
    "createdAtEpochMillis",
    "mutation",
  ]);
  assert.deepEqual(Object.keys(anchoredReading.mutation), [
    "kind",
    "contentVersion",
    "lessonId",
    "documentId",
    "stableAnchor",
    "updatedAtEpochMillis",
  ]);
  assert.equal(anchoredReading.mutation.stableAnchor, maxAnchor);
  assert.throws(() => buildReadingPositionMutation(
    {
      ownerScope: OWNER_A,
      contentVersion: CONTENT_VERSION,
      lessonId: "lesson-1576",
      documentId: "body",
      stableAnchor: `${maxAnchor}a`,
    },
    { cryptoSource: cryptoSequence(UUID_A), now: () => FIXED_NOW },
  ), /stableAnchor required/);
  assert.throws(() => buildReadingPositionMutation(
    {
      ownerScope: OWNER_A,
      lessonId: "lesson-1576",
      documentId: "body",
      stableAnchor: "lesson-root",
    },
    { cryptoSource: cryptoSequence(UUID_A), now: () => FIXED_NOW },
  ), /contentVersion required/);
  assert.deepEqual(preference.mutation, {
    kind: "READER_PREFERENCE",
    key: "TEXT_SCALE",
    value: 1.12,
    updatedAtEpochMillis: FIXED_NOW + 1,
  });
  assert.equal(
    /answer|correct|score|mastery|lessonOpened|progress/i.test(JSON.stringify([reading, preference])),
    false,
  );
});

test("a failed PUT survives client reconstruction and replays the exact same UUID and canonical body", async () => {
  const storage = memoryStorage();
  const calls = [];
  let online = false;
  const options = {
    api: async (route, options) => {
      calls.push({ route, options });
      if (route === "/api/yw/v1/state") return remoteState();
      if (!online) throw new TypeError("offline");
      return receipt(options.body);
    },
    storage,
    storageKey: "outbox:test",
    ownerScope: OWNER_A,
    cryptoSource: cryptoSequence(UUID_A),
    now: () => FIXED_NOW,
  };
  const client = createSharedStateClient(options);

  await client.hydrate();
  const mutationId = client.queueReadingPosition(readingInput());
  assert.equal(mutationId, UUID_A);
  await client.flush();
  assert.equal(client.pendingCount(), 1);
  const stored = storage.dump("outbox:test");
  assert.equal(stored.mutations[0].clientMutationId, UUID_A);

  online = true;
  const restarted = createSharedStateClient(options);
  await restarted.hydrate();
  assert.equal(restarted.pendingCount(), 0);
  const putCalls = calls.filter((call) => call.options?.method === "PUT");
  assert.equal(putCalls.at(-1).route, `/api/yw/v1/mutations/${UUID_A}`);
  assert.equal(
    JSON.stringify(putCalls.at(-1).options.body),
    JSON.stringify(putCalls[0].options.body),
  );
});

test("a receipt must match exact owner, ywmr UUID, durable proof, and canonical request hash", async () => {
  let responseIndex = 0;
  const client = createSharedStateClient({
    api: async (route, options) => {
      if (route === "/api/yw/v1/state") return remoteState();
      const candidates = [
        receipt(options.body, { clientMutationId: UUID_B }),
        receipt(options.body, { ownerScope: OWNER_B }),
        receipt(options.body, { durableStorageVerified: false }),
        receipt(options.body, { durableReceiptId: "x" }),
        receipt(options.body, { requestSha256: "0".repeat(64) }),
        { ...receipt(options.body), unexpected: true },
        {
          clientMutationId: options.body.clientMutationId,
          schemaVersion: "yw-shared-state-receipt/1",
          ownerScope: options.body.ownerScope,
          durableReceiptId: RECEIPT_A,
          durableStorageVerified: true,
          requestSha256: requestSha256(options.body),
        },
        receipt(options.body),
      ];
      return candidates[responseIndex++];
    },
    storage: memoryStorage(),
    storageKey: "outbox:receipt",
    ownerScope: OWNER_A,
    cryptoSource: cryptoSequence(UUID_A),
    now: () => FIXED_NOW,
  });

  await client.hydrate();
  client.queueTextScale(1.26);
  for (let attempt = 0; attempt < 7; attempt += 1) {
    await client.flush();
    assert.equal(client.pendingCount(), 1);
  }
  await client.flush();
  assert.equal(client.pendingCount(), 0);
});

test("pending local fields win during hydration without blocking valid remote fields", async () => {
  let applied;
  const client = createSharedStateClient({
    api: async (route, options) => (
      route === "/api/yw/v1/state" ? remoteState() : receipt(options.body)
    ),
    storage: memoryStorage(),
    storageKey: "outbox:hydrate",
    ownerScope: OWNER_A,
    cryptoSource: cryptoSequence(UUID_A),
    now: () => FIXED_NOW,
    onRemoteState(state, context) {
      applied = { state, pendingKinds: [...context.pendingKinds] };
    },
  });
  client.queueReadingPosition(readingInput("lesson-1458"));
  await client.hydrate();
  assert.deepEqual(applied.state, {
    ownerScope: OWNER_A,
    ...remoteState().state,
  });
  assert.deepEqual(applied.pendingKinds, ["READING_POSITION"]);
});

test("a supplied discovery projection uses exactly bounded pre-apply and final owner checks", async () => {
  let stateGets = 0;
  const client = createSharedStateClient({
    api: async (route) => {
      assert.equal(route, "/api/yw/v1/state");
      stateGets += 1;
      return remoteState();
    },
    storage: memoryStorage(),
    storageKey: "outbox:request-budget",
    ownerScope: OWNER_A,
  });
  const result = await client.hydrate({ initialState: remoteState() });
  assert.equal(result.ok, true);
  assert.equal(stateGets, 2);
});

test("an explicit drain sends both mutations only after both are durably admitted", async () => {
  const storage = memoryStorage();
  const putKinds = [];
  const client = createSharedStateClient({
    api: async (route, options) => {
      if (route === "/api/yw/v1/state") return remoteState();
      putKinds.push(options.body.mutation.kind);
      return receipt(options.body);
    },
    storage,
    storageKey: "outbox:batch",
    ownerScope: OWNER_A,
    cryptoSource: cryptoSequence(UUID_A, UUID_B),
    now: () => FIXED_NOW,
  });
  await client.hydrate();
  client.queueReadingPosition(readingInput("lesson-1458"));
  client.queueTextScale(1.12);
  assert.deepEqual(putKinds, []);
  assert.deepEqual(
    storage.dump("outbox:batch").mutations.map((item) => item.mutation.kind),
    ["READING_POSITION", "READER_PREFERENCE"],
  );
  const drained = await client.flush();
  assert.deepEqual(putKinds, ["READING_POSITION", "READER_PREFERENCE"]);
  assert.deepEqual(drained, { ok: true, acknowledged: 2, pending: 0 });
});

test("after acknowledgement a later server projection wins despite a lower client clock", async () => {
  const appliedLessons = [];
  let projection = remoteState();
  projection.state.readingPosition.updatedAtEpochMillis = 100;
  const client = createSharedStateClient({
    api: async (route, options) => {
      if (route === "/api/yw/v1/state") return projection;
      return receipt(options.body);
    },
    storage: memoryStorage(),
    storageKey: "outbox:server-order",
    ownerScope: OWNER_A,
    cryptoSource: cryptoSequence(UUID_A),
    now: () => Number.MAX_SAFE_INTEGER - 1,
    onRemoteState(state, { pendingKinds }) {
      if (!pendingKinds.has("READING_POSITION")) {
        appliedLessons.push(state.readingPosition?.lessonId);
      }
    },
  });
  client.queueReadingPosition(readingInput("lesson-local-future-clock"));

  await client.hydrate();
  assert.equal(client.pendingCount(), 0);
  assert.deepEqual(appliedLessons, []);

  projection = remoteState();
  projection.state.readingPosition = {
    kind: "READING_POSITION",
    contentVersion: CONTENT_VERSION,
    lessonId: "lesson-web-later-server-order",
    documentId: "body",
    stableAnchor: "lesson-root",
    updatedAtEpochMillis: 50,
    clientMutationId: UUID_B,
  };
  await client.hydrate();

  assert.deepEqual(appliedLessons, ["lesson-web-later-server-order"]);
});

test("a later schema drift disables mutation delivery instead of partially continuing", async () => {
  let validContract = true;
  let putCount = 0;
  const client = createSharedStateClient({
    api: async (route, options) => {
      if (route === "/api/yw/v1/state") {
        const state = remoteState();
        if (!validContract) state.schemaVersion = "yw-shared-state/2";
        return state;
      }
      putCount += 1;
      return receipt(options.body);
    },
    storage: memoryStorage(),
    storageKey: "outbox:drift",
    ownerScope: OWNER_A,
    cryptoSource: cryptoSequence(UUID_A),
    now: () => FIXED_NOW,
  });
  await client.hydrate();
  validContract = false;
  await client.hydrate();
  client.queueReadingPosition(readingInput("lesson-1458"));
  await client.flush();
  assert.equal(putCount, 0);
  assert.equal(client.pendingCount(), 1);
});

test("durable admission fails closed when storage cannot retain and read back the outbox", async () => {
  let putCount = 0;
  const storage = {
    getItem() {
      return null;
    },
    setItem() {
      throw new DOMException("quota", "QuotaExceededError");
    },
  };
  const client = createSharedStateClient({
    api: async (route) => {
      if (route === "/api/yw/v1/state") return remoteState();
      putCount += 1;
      throw new Error("PUT must not run");
    },
    storage,
    storageKey: "outbox:unavailable",
    ownerScope: OWNER_A,
    cryptoSource: cryptoSequence(UUID_A),
    now: () => FIXED_NOW,
  });
  await client.hydrate();
  assert.throws(
    () => client.queueReadingPosition(readingInput("lesson-1458")),
    /quota/,
  );
  await client.flush();
  assert.equal(client.pendingCount(), 0);
  assert.equal(putCount, 0);
});

test("an owner-mismatched durable outbox is rejected before any remote request", () => {
  const storage = memoryStorage();
  const mutation = buildReadingPositionMutation(
    {
      ownerScope: OWNER_B,
      ...readingInput("lesson-1458"),
    },
    { cryptoSource: cryptoSequence(UUID_A), now: () => FIXED_NOW },
  );
  storage.setItem("outbox:mismatched-owner", JSON.stringify({
    schemaVersion: "yw-shared-state-outbox/2",
    mutations: [mutation],
  }));
  let apiCount = 0;
  assert.throws(() => createSharedStateClient({
    api: async () => {
      apiCount += 1;
      return remoteState();
    },
    storage,
    storageKey: "outbox:mismatched-owner",
    ownerScope: OWNER_A,
  }), /durable outbox owner mismatch/);
  assert.equal(apiCount, 0);
});

test("an A outbox never sends under B and remains replayable only after A returns", async () => {
  let currentOwner = OWNER_A;
  let online = false;
  const putOwners = [];
  const client = createSharedStateClient({
    api: async (route, options) => {
      if (route === "/api/yw/v1/state") return remoteState(currentOwner);
      putOwners.push(currentOwner);
      if (!online) throw new TypeError("offline");
      if (options.body.ownerScope !== currentOwner) {
        const conflict = new Error("web_owner_scope_mismatch");
        conflict.status = 409;
        throw conflict;
      }
      return receipt(options.body);
    },
    storage: memoryStorage(),
    storageKey: "outbox:owner-a",
    ownerScope: OWNER_A,
    cryptoSource: cryptoSequence(UUID_A),
    now: () => FIXED_NOW,
  });
  await client.hydrate();
  client.queueReadingPosition(readingInput("lesson-1458"));
  await client.flush();
  assert.equal(client.pendingCount(), 1);

  currentOwner = OWNER_B;
  online = true;
  await client.flush();
  assert.equal(client.pendingCount(), 1);
  assert.deepEqual(putOwners, [OWNER_A]);

  currentOwner = OWNER_A;
  await client.hydrate();
  assert.equal(client.pendingCount(), 0);
  assert.deepEqual(putOwners, [OWNER_A, OWNER_A]);
});

test("app integration uses the versioned state routes and removes generic progress hydration", () => {
  const source = fs.readFileSync(
    path.resolve(import.meta.dirname, "../site/assets/app.js"),
    "utf8",
  );
  const index = fs.readFileSync(
    path.resolve(import.meta.dirname, "../site/index.html"),
    "utf8",
  );
  assert.match(source, /BdfzIdentity/);
  assert.match(source, /hydrateSharedStateOnce/);
  assert.doesNotMatch(source, /\/api\/progress\?site=yw/);
  assert.doesNotMatch(source, /session\.user\??\.slug|deriveOwnerScope/);
  assert.match(source, /sharedContentVersion/);
  assert.match(source, /documentId:\s*"body"/);
  assert.match(source, /stableAnchor:\s*"lesson-root"/);
  assert.match(source, /recordEvidence:\s*false/);
  assert.match(source, /SHARED_STATE_ASSET_VERSION = "20260730-owner-v1"/);
  assert.match(index, /assets\/app\.js\?v=20260809-self-study-loop-v2/);
  assert.equal(YW_SHARED_STATE_CONTRACT.CLIENT, "yuwen-web");
});
