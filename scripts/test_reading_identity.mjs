import assert from "node:assert/strict";
import test from "node:test";

import {
  nativeAuthorizationDecision,
  nativeReadingIdentityProjection,
  readingCredentialDecision,
  readingFormativeMasteryRpcDecision,
  readingIdentityDecision,
} from "../site/reading-identity-source.js";

test("native reading authorization distinguishes non-native credentials from malformed native credentials", () => {
  const token = `Bearer ywat_${"a".repeat(43)}`;
  assert.deepEqual(nativeAuthorizationDecision(""), { status: "absent", authorizationHeader: "" });
  assert.deepEqual(nativeAuthorizationDecision(token), { status: "authorized", authorizationHeader: token });
  assert.deepEqual(nativeAuthorizationDecision("Bearer unrelated"), {
    status: "non_native",
    authorizationHeader: "",
  });
  assert.deepEqual(nativeAuthorizationDecision("Basic unrelated"), {
    status: "non_native",
    authorizationHeader: "",
  });
  assert.deepEqual(nativeAuthorizationDecision(`bearer ${token.slice(7)}`), {
    status: "unauthorized",
    authorizationHeader: "",
  });
  assert.deepEqual(nativeAuthorizationDecision(`${token}x`), {
    status: "unauthorized",
    authorizationHeader: "",
  });
});

test("native session projection reuses the exact existing auth schema", () => {
  assert.deepEqual(nativeReadingIdentityProjection({
    schemaVersion: "bdfz-native-auth/1",
    status: 200,
    authenticated: true,
    sourceSiteKey: "yw",
    clientId: "yuwen-native-android",
    capability: "data",
    userId: 42,
    slug: "student-42",
    displayName: "測試學生",
  }), {
    status: "authenticated",
    user: { userId: 42, slug: "student-42", displayName: "測試學生" },
  });
  assert.deepEqual(nativeReadingIdentityProjection({
    schemaVersion: "bdfz-native-auth/1",
    status: 401,
    authenticated: false,
    sourceSiteKey: "yw",
    clientId: "yuwen-native-android",
    capability: "data",
    code: "unauthorized",
  }), { status: "unauthorized" });
});

test("dual Web and native credentials must identify the same User Center user", () => {
  const nativeUser = { userId: 42, slug: "native", displayName: "Native" };
  assert.deepEqual(readingCredentialDecision(nativeUser, null), {
    status: "authenticated",
    user: nativeUser,
  });
  assert.deepEqual(readingCredentialDecision(nativeUser, { userId: 42, slug: "web" }), {
    status: "authenticated",
    user: nativeUser,
  });
  assert.deepEqual(readingCredentialDecision(nativeUser, { userId: 41, slug: "web" }), {
    status: "unauthorized",
  });
});

test("formative mastery selects one credential-bound RPC without fallback", () => {
  const authorization = `Bearer ywat_${"a".repeat(43)}`;
  const cookie = "bdfz_uc_session=web-session";
  assert.deepEqual(readingFormativeMasteryRpcDecision("", cookie), {
    status: "web",
    rpcName: "getFormativeMastery",
    credential: cookie,
  });
  assert.deepEqual(readingFormativeMasteryRpcDecision("Bearer unrelated", cookie), {
    status: "web",
    rpcName: "getFormativeMastery",
    credential: cookie,
  });
  assert.deepEqual(readingFormativeMasteryRpcDecision("Bearer unrelated", ""), {
    status: "unauthorized",
    rpcName: "",
    credential: "",
  });
  assert.deepEqual(readingFormativeMasteryRpcDecision("", ""), {
    status: "unauthorized",
    rpcName: "",
    credential: "",
  });
  assert.deepEqual(readingFormativeMasteryRpcDecision(authorization, cookie), {
    status: "native",
    rpcName: "getNativeFormativeMastery",
    credential: authorization,
  });
  assert.deepEqual(readingFormativeMasteryRpcDecision(`${authorization}x`, cookie), {
    status: "unauthorized",
    rpcName: "",
    credential: "",
  });
});

test("stable User Center id owns identity even when the slug changes", () => {
  assert.deepEqual(
    readingIdentityDecision(
      { id: 7, uc_user_id: 42, uc_slug: "old-slug" },
      null,
      { userId: 42, slug: "new-slug" },
    ),
    { action: "rename", studentId: 7 },
  );
});

test("a verified id may link a legacy null-id row with an explicit receipt path", () => {
  assert.deepEqual(
    readingIdentityDecision(null, { id: 7, uc_user_id: null, uc_slug: "student" }, { userId: 42, slug: "student" }),
    { action: "link_legacy", studentId: 7 },
  );
});

test("slug reuse never transfers records between two non-null User Center ids", () => {
  assert.deepEqual(
    readingIdentityDecision(null, { id: 7, uc_user_id: 41, uc_slug: "student" }, { userId: 42, slug: "student" }),
    { action: "conflict" },
  );
  assert.deepEqual(
    readingIdentityDecision(
      { id: 8, uc_user_id: 42, uc_slug: "another" },
      { id: 7, uc_user_id: 41, uc_slug: "student" },
      { userId: 42, slug: "student" },
    ),
    { action: "conflict" },
  );
});

test("slug-only fallback is rejected", () => {
  assert.deepEqual(readingIdentityDecision(null, null, { userId: null, slug: "student" }), { action: "reject" });
});
