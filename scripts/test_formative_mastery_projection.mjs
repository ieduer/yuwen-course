#!/usr/bin/env node

import assert from "node:assert/strict";
import test from "node:test";
import { publicFormativeMastery } from "../site/_worker.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const workerSource = readFileSync(resolve(import.meta.dirname, "../site/_worker.js"), "utf8");

function projection() {
  return {
    schemaVersion: "bdfz-yw-formative-mastery-v1",
    status: "available",
    unit: "lesson_competency",
    manifestVersion: "yw-formative-52b574175221646f",
    nonScoring: true,
    affectsGrowthScore: false,
    affectsAPlus: false,
    summary: {
      lessonCount: 1,
      competencyUnitCount: 2,
      completedItems: 2,
      totalItems: 4,
      masteryRate: 50,
    },
    lessons: [{
      lessonId: "lesson-1534",
      lessonTitle: "屈原列傳",
      competencies: [
        { competencyTag: "first_read_process", status: "available", completedItems: 1, totalItems: 2, masteryRate: 50 },
        { competencyTag: "vocabulary", status: "available", completedItems: 1, totalItems: 2, masteryRate: 50 },
        { competencyTag: "syntax", status: "unavailable", completedItems: 0, totalItems: 0, masteryRate: null },
      ],
    }],
  };
}

function currentManifest() {
  return {
    schemaVersion: "yw-lesson-competency-manifest-v1",
    sourceSiteKey: "yw",
    registryVersion: "yw-interactions-2026-08-09-v2",
    aggregationUnit: ["lessonId", "competencyTag"],
    manifestVersion: "yw-formative-52b574175221646f",
    manifestDigest: "sha256:52b574175221646f466a1f55c64730195a99e2756c59a6ea83717da8811832c9",
    itemCount: 4,
    lessonCount: 1,
    lessons: [{
      lessonId: "lesson-1534",
      competencies: [
        { competencyTag: "first_read_process", activeItemCount: 2, items: [{}, {}] },
        { competencyTag: "vocabulary", activeItemCount: 2, items: [{}, {}] },
        { competencyTag: "syntax", activeItemCount: 0, items: [] },
      ],
    }],
  };
}

test("the public projection preserves unavailable as null and adds only latest lesson interest", () => {
  const value = publicFormativeMastery(projection(), [
    {
      lesson_id: "lesson-1534",
      raw_payload_json: JSON.stringify({ rating: 87, reason: "不應外露" }),
      occurred_at: "2026-08-09T03:00:00.000Z",
    },
  ], currentManifest());
  const syntax = value.lessons[0].competencies.find((item) => item.competencyTag === "syntax");
  assert.equal(syntax.masteryRate, null);
  assert.equal(syntax.status, "unavailable");
  assert.equal(value.lessons[0].interestRating, 87);
  assert.equal(value.lessons[0].interestRatedAt, "2026-08-09T03:00:00.000Z");
  assert.doesNotMatch(JSON.stringify(value), /itemKey|resourceKey|interactionKey|不應外露/);
  assert.equal(value.affectsGrowthScore, false);
  assert.equal(value.affectsAPlus, false);
});

test("the dynamic denominator is recomputed and inconsistent projections fail closed", () => {
  const changed = projection();
  const changedManifest = currentManifest();
  changed.lessons[0].competencies[0] = {
    competencyTag: "first_read_process",
    status: "available",
    completedItems: 1,
    totalItems: 1,
    masteryRate: 100,
  };
  changed.summary = {
    lessonCount: 1,
    competencyUnitCount: 2,
    completedItems: 2,
    totalItems: 3,
    masteryRate: 66.67,
  };
  changedManifest.lessons[0].competencies[0].activeItemCount = 1;
  changedManifest.lessons[0].competencies[0].items = [{}];
  changedManifest.itemCount = 3;
  const value = publicFormativeMastery(changed, [], changedManifest);
  assert.equal(value.summary.totalItems, 3);
  assert.equal(value.summary.masteryRate, 66.67);

  changed.summary.masteryRate = 50;
  assert.throws(() => publicFormativeMastery(changed, [], changedManifest), /summary invalid/);
});

test("a stale projection or stale denominator cannot be presented as current mastery", () => {
  const staleVersion = projection();
  staleVersion.manifestVersion = "yw-formative-0000000000000000";
  assert.throws(() => publicFormativeMastery(staleVersion, [], currentManifest()), /projection invalid/);

  const staleDenominator = projection();
  staleDenominator.lessons[0].competencies[0].totalItems = 1;
  staleDenominator.lessons[0].competencies[0].masteryRate = 100;
  assert.throws(() => publicFormativeMastery(staleDenominator, [], currentManifest()), /denominator invalid/);
});

test("the Web proxy maps only serialized 401 and 503 User Center wrappers", () => {
  assert.match(workerSource, /result\?\.status === "unauthorized"/);
  assert.match(workerSource, /result\?\.httpStatus === 401/);
  assert.match(workerSource, /result\?\.status === "unavailable"/);
  assert.match(workerSource, /result\?\.httpStatus === 503/);
  assert.doesNotMatch(workerSource, /FORMATIVE_MASTERY_AUTH_REQUIRED/);
});
