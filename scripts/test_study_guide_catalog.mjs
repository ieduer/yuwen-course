#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolve } from "node:path";
import {
  buildLessonCompetencyManifest,
  buildStudyGuideCatalog,
  masteryForCompleted,
  renderLessonCompetencyManifest,
  renderStudyGuideCatalog,
} from "./build_study_guide_catalog.mjs";

const ROOT = resolve(import.meta.dirname, "..");

test("study-guide catalog is deterministic, labelled, and byte-current", () => {
  const catalog = buildStudyGuideCatalog();
  assert.equal(catalog.schemaVersion, "yw-study-guide-catalog-v1");
  assert.equal(readFileSync(resolve(ROOT, "site/data/study-guide-catalog.json"), "utf8"), renderStudyGuideCatalog());
  const items = catalog.lessons.flatMap((lesson) => lesson.items);
  assert.equal(new Set(items.map((item) => item.itemKey)).size, items.length);
  assert.equal(items.some((item) => item.answerAuthority === "codex_reference" && item.answerLabel !== "Codex 參考答案"), false);
  assert.equal(items.some((item) => item.activeForSelfTest && item.referenceAnswer === null), false);
  assert.equal(catalog.lessons.some((lesson) => lesson.lessonId === "lesson-1534"), true);
  assert.equal(catalog.lessons.some((lesson) => lesson.lessonId === "lesson-1535"), true);
  assert.equal(items.every((item) => /^[a-f0-9]{16}$/.test(item.semanticRevision)), true);

  const byKey = new Map(items.map((item) => [item.itemKey, item]));
  const deterministicChoiceItems = items.filter((item) => {
    const answer = item.referenceAnswer;
    const hasChoiceAnswer = (
      typeof answer === "string" && /^\s*[A-D](?:\b|[：:。、，,])/i.test(answer)
    ) || (
      Array.isArray(answer)
      && answer.length > 0
      && answer.every((entry) => /^[A-D]$/i.test(String(entry).trim()))
    ) || (
      answer && typeof answer === "object" && !Array.isArray(answer)
      && Object.values(answer).length > 0
      && Object.values(answer).every((entry) => /^[A-D]$/i.test(String(entry?.option || "").trim()))
    );
    return item.activeForSelfTest
      && hasChoiceAnswer
      && /(?:choice|discrimination|identification|objective|knowledge)/i.test(item.detailTag || "");
  });
  assert.ok(deterministicChoiceItems.length > 10);
  for (const item of deterministicChoiceItems) {
    assert.match(item.prompt, /(?:^|[^A-Za-z])A[.．、）)]/, `${item.itemKey} must publish option A`);
    assert.match(item.prompt, /(?:^|[^A-Za-z])D[.．、）)]/, `${item.itemKey} must publish option D`);
  }
  for (const itemKey of [
    "lesson-1485-p56-evidence-identification-01",
    "lesson-1576-p65-content-discrimination-01",
    "lesson-1576-p65-content-discrimination-02",
    "lesson-1577-p72-content-discrimination-01",
    "lesson-1577-p73-content-discrimination-02",
    "lesson-1578-p79-content-discrimination-01",
    "lesson-1578-p79-function-word-03",
    "lesson-1579-p88-content-discrimination-01",
    "lesson-1579-p88-content-discrimination-02",
    "lesson-1580-p96-content-discrimination-01",
    "lesson-1581-p103-content-discrimination-01",
  ]) {
    const item = byKey.get(itemKey);
    assert.equal(item.activeForSelfTest, true);
    assert.match(item.prompt, /\nA\./);
    assert.match(item.prompt, /(?:\n|　)D\./);
  }
  const derivedNaiYin = byKey.get("sg:1535:function:nai-yin");
  assert.equal(derivedNaiYin.pdfPage, null);
  assert.match(derivedNaiYin.qualityNotes.join(" "), /並非來源 PDF 的原題/);

  assert.match(
    byKey.get("lesson-1534-p56-passive-increment-01").qualityNotes.join(" "),
    /去重摘錄/,
  );
  assert.match(
    byKey.get("lesson-1536-p71-72-text-inquiry-01").qualityNotes.join(" "),
    /第71-72頁/,
  );
  assert.match(
    byKey.get("lesson-1579-p86-sentence-pattern-01").qualityNotes.join(" "),
    /第86-87頁/,
  );
});

test("formative manifest aggregates by lesson and competency without changing scores", () => {
  const catalog = buildStudyGuideCatalog();
  const manifest = buildLessonCompetencyManifest(catalog);
  assert.equal(manifest.schemaVersion, "yw-lesson-competency-manifest-v1");
  assert.deepEqual(manifest.aggregationUnit, ["lessonId", "competencyTag"]);
  assert.equal(manifest.zeroTotalDisposition, "unavailable");
  assert.equal(manifest.scoringPolicy, "formative_projection_does_not_modify_a_to_f_or_a_plus");
  assert.equal(manifest.historyPolicy.itemKeyRole, "internal_editor_address_only");
  assert.equal(manifest.tombstones.length, catalog.itemCount - catalog.activeItemCount);
  const activeStudyItems = manifest.lessons
    .flatMap((lesson) => lesson.competencies.flatMap((competency) => competency.items))
    .filter((item) => item.sourceKind === "study_guide");
  assert.equal(
    activeStudyItems.every((item) => /^formative:lesson-[^:]+:(?:vocabulary|syntax|comprehension):[a-f0-9]{16}$/.test(item.resourceKey)),
    true,
  );
  assert.equal(readFileSync(resolve(ROOT, "site/data/lesson-competency-manifest.json"), "utf8"), renderLessonCompetencyManifest(catalog));
  const qu = manifest.lessons.find((lesson) => lesson.lessonId === "lesson-1534");
  assert.ok(qu.competencies.some((entry) => entry.competencyTag === "first_read_process"));
  assert.ok(qu.competencies.some((entry) => entry.competencyTag === "vocabulary"));
});

test("mastery uses current active intersection and treats zero total as unavailable", () => {
  const active = [
    { completionKey: "a", active: true },
    { completionKey: "b", active: true },
  ];
  assert.deepEqual(masteryForCompleted(active, ["a", "retired"]), {
    status: "available", completed: 1, total: 2, masteryRate: 0.5,
  });
  assert.deepEqual(masteryForCompleted(active.slice(0, 1), ["a", "retired"]), {
    status: "available", completed: 1, total: 1, masteryRate: 1,
  });
  assert.deepEqual(masteryForCompleted([{ completionKey: "new", completionAliases: ["old"], active: true }], ["old"]), {
    status: "available", completed: 1, total: 1, masteryRate: 1,
  });
  assert.deepEqual(masteryForCompleted([], ["retired"]), {
    status: "unavailable", completed: 0, total: 0, masteryRate: null,
  });
});
