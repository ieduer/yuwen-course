import assert from "node:assert/strict";
import test from "node:test";

import { readingIdentityDecision } from "../site/reading-identity-source.js";

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
