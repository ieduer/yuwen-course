import assert from "node:assert/strict";
import test from "node:test";

import {
  deterministicStudyGuideAssessment,
  normalizeOpenStudyGuideAssessment,
  studyGuideAssessmentPrompt,
} from "../site/study-guide-assessment.js";

test("source-owned single and multiple choice answers are graded without browser claims", () => {
  const single = { detailTag: "content-discrimination", referenceAnswer: "C" };
  assert.equal(deterministicStudyGuideAssessment(single, "C")?.passed, true);
  assert.equal(deterministicStudyGuideAssessment(single, "A")?.passed, false);
  assert.equal(deterministicStudyGuideAssessment(single, "C、A")?.passed, false);
  const multiple = { detailTag: "multiple_choice", referenceAnswer: ["B", "C"] };
  assert.equal(deterministicStudyGuideAssessment(multiple, "C、B")?.passed, true);
  assert.equal(deterministicStudyGuideAssessment(multiple, "B")?.passed, false);
});

test("compound objective sets retain the source answer order", () => {
  const item = {
    detailTag: "objective-question-set",
    referenceAnswer: {
      第1題: { option: "D" },
      第2題: { option: "B" },
      第3題: { option: "B" },
    },
  };
  assert.equal(deterministicStudyGuideAssessment(item, "D B B")?.passed, true);
  assert.equal(deterministicStudyGuideAssessment(item, "D B C")?.passed, false);
});

test("open Codex reference answers are routed to rubric assessment and remain non-unique", () => {
  const item = {
    detailTag: "wenyan.inquiry.value_comparison",
    prompt: "屈原與漁父的處世選擇，哪一種更有說服力？",
    answerLabel: "Codex 參考答案",
    referenceAnswer: "可選任一立場，但須結合文本證據。",
    rubric: ["明確立場", "文本證據", "回應另一立場"],
  };
  assert.equal(deterministicStudyGuideAssessment(item, "我支持漁父"), null);
  const prompt = studyGuideAssessmentPrompt(item, "我支持漁父，因為……");
  assert.match(prompt, /參考答案不是唯一答案/);
  assert.match(prompt, /Codex 參考答案/);
});

test("open assessment preserves a real zero and never invents a passing score", () => {
  const result = normalizeOpenStudyGuideAssessment({
    score: 0,
    verdict: "尚未回應題目。",
    strength: "已留下作答。",
    gap: "沒有引用文本證據。",
    nextQuestion: "哪一句原文最能支持你的判斷？",
  });
  assert.equal(result.score, 0);
  assert.equal(result.passed, false);
  assert.equal(result.correctness, "needs_revision");
});

test("open assessment fails closed on malformed or incomplete model output", () => {
  assert.throws(() => normalizeOpenStudyGuideAssessment(null), /格式無效/);
  assert.throws(() => normalizeOpenStudyGuideAssessment({ score: "80" }), /分數無效/);
  assert.throws(() => normalizeOpenStudyGuideAssessment({
    score: 80,
    verdict: "有明確立場。",
    strength: "引用了原文。",
    gap: "",
    nextQuestion: "如何回應另一種立場？",
  }), /回饋不完整/);
});
