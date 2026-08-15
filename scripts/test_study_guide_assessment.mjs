import assert from "node:assert/strict";
import test from "node:test";

import {
  authoritativeStudyGuideAssessment,
  deterministicStudyGuideAssessment,
  normalizeInteractionAssessment,
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
  assert.equal(deterministicStudyGuideAssessment(multiple, "BC")?.passed, true);
  assert.equal(deterministicStudyGuideAssessment(multiple, "选BC")?.passed, true);
  assert.equal(deterministicStudyGuideAssessment(multiple, "ＢＣ")?.passed, true);
  assert.equal(deterministicStudyGuideAssessment(multiple, "B和C")?.passed, true);
  assert.equal(deterministicStudyGuideAssessment(multiple, "B")?.passed, false);
  assert.equal(deterministicStudyGuideAssessment(multiple, "BCD")?.passed, false);
  assert.equal(deterministicStudyGuideAssessment(single, "C。因為 B 項的說法不成立")?.passed, true);
  assert.equal(deterministicStudyGuideAssessment(single, "A。因為 C 項正確")?.passed, false);
  assert.equal(deterministicStudyGuideAssessment(single, "我选C，B项说法没错")?.passed, true);
  assert.equal(deterministicStudyGuideAssessment(single, "我选A，C项才对")?.passed, false);
  assert.equal(deterministicStudyGuideAssessment({ detailTag: "choice", referenceAnswer: "A" }, "我选A，B项说法没错")?.passed, true);
  assert.equal(deterministicStudyGuideAssessment({ detailTag: "choice", referenceAnswer: "A" }, "我选A和B")?.passed, false);
  assert.equal(deterministicStudyGuideAssessment({ detailTag: "choice", referenceAnswer: "A" }, "我選A、B")?.passed, false);
  assert.equal(deterministicStudyGuideAssessment({ detailTag: "choice", referenceAnswer: "A" }, "答案是A或B")?.passed, false);
  assert.equal(deterministicStudyGuideAssessment({ detailTag: "choice", referenceAnswer: "A" }, "应选A与B")?.passed, false);
  assert.equal(deterministicStudyGuideAssessment({ detailTag: "choice", referenceAnswer: "A" }, "AB")?.passed, false);
  assert.equal(deterministicStudyGuideAssessment({ detailTag: "choice", referenceAnswer: "A" }, "A、B")?.passed, false);
  assert.equal(deterministicStudyGuideAssessment(multiple, "選 B 和 C。A 項是干擾項")?.passed, true);
  assert.equal(deterministicStudyGuideAssessment(multiple, "B、C、D")?.passed, false);
});

test("evidence identification accepts the exact source option or equivalent circled statements", () => {
  const item = {
    detailTag: "evidence_identification",
    referenceAnswer: "A：①②④。",
  };
  assert.equal(deterministicStudyGuideAssessment(item, "A")?.passed, true);
  assert.equal(deterministicStudyGuideAssessment(item, "①②④")?.passed, true);
  assert.equal(deterministicStudyGuideAssessment(item, "124")?.passed, true);
  assert.equal(deterministicStudyGuideAssessment(item, "1、2、4")?.passed, true);
  assert.equal(deterministicStudyGuideAssessment(item, "①②③")?.passed, false);
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
  assert.equal(deterministicStudyGuideAssessment(item, "DBB")?.passed, true);
  assert.equal(deterministicStudyGuideAssessment(item, "D、B、B")?.passed, true);
  assert.equal(deterministicStudyGuideAssessment(item, "D B C")?.passed, false);
  assert.equal(deterministicStudyGuideAssessment(item, "DBC")?.passed, false);
  assert.equal(deterministicStudyGuideAssessment(item, "DBBC")?.passed, false);
});

test("punctuation and sentence segmentation normalize speech punctuation deterministically", () => {
  const punctuation = {
    detailTag: "punctuation",
    referenceAnswer: "太夫人告之曰／汝父为吏／廉而好施与。",
  };
  assert.equal(
    deterministicStudyGuideAssessment(punctuation, "太夫人告之曰：‘汝父为吏，廉而好施与。’")?.passed,
    true,
  );
  const segmentation = {
    detailTag: "sentence-segmentation",
    referenceAnswer: "其平居教他子弟／常用此语／吾耳熟焉／故能详也",
  };
  assert.equal(
    deterministicStudyGuideAssessment(segmentation, "其平居教他子弟，常用此语；吾耳熟焉，故能详也")?.passed,
    true,
  );
  assert.equal(
    deterministicStudyGuideAssessment(segmentation, "其平居教他子弟 常用此語 吾耳熟焉 故能詳也")?.passed,
    true,
  );
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

test("legacy interaction assessment preserves zero and rejects malformed model output", () => {
  const zero = normalizeInteractionAssessment({
    score: 0,
    verdict: "尚未完成。",
    strength: "已经作答。",
    gap: "没有文本证据。",
    nextQuestion: "哪一句原文支持你的结论？",
  }, "raw");
  assert.equal(zero.score, 0);
  assert.equal(zero.raw, "raw");
  assert.throws(() => normalizeInteractionAssessment({ score: "bad" }), /分數無效/);
  assert.throws(() => normalizeInteractionAssessment(null), /格式無效/);
});

test("idempotent replay always presents the immutable stored assessment", () => {
  const presented = authoritativeStudyGuideAssessment(
    {
      score: 92,
      correctness: "passed",
      verdict: "fresh contradictory result",
      strength: "fresh strength",
      gap: "fresh gap",
      nextQuestion: "fresh question",
    },
    {
      deduped: true,
      eligibilityStatus: "ineligible",
      evaluation: {
        score: 35,
        correctness: "needs_revision",
        verdict: "stored result",
        strength: "stored strength",
        gap: "stored gap",
        nextQuestion: "stored question",
      },
    },
  );
  assert.equal(presented.passed, false);
  assert.deepEqual(presented.assessment, {
    score: 35,
    verdict: "stored result",
    strength: "stored strength",
    gap: "stored gap",
    nextQuestion: "stored question",
  });
});
