function clean(value, max = 4000) {
  return String(value || "").normalize("NFC").trim().slice(0, max);
}

function choiceLetters(value) {
  return [...clean(value).toUpperCase().matchAll(/[A-D]/g)].map((match) => match[0]);
}

function expectedChoiceSpec(referenceAnswer) {
  if (Array.isArray(referenceAnswer)
    && referenceAnswer.length > 0
    && referenceAnswer.every((entry) => /^[A-D]$/i.test(clean(entry)))) {
    return { choices: referenceAnswer.map((entry) => clean(entry).toUpperCase()), mode: "set" };
  }
  if (referenceAnswer && typeof referenceAnswer === "object" && !Array.isArray(referenceAnswer)) {
    const choices = Object.values(referenceAnswer).map((entry) => clean(entry?.option).toUpperCase());
    if (choices.length > 0 && choices.every((entry) => /^[A-D]$/.test(entry))) {
      return { choices, mode: "sequence" };
    }
  }
  if (typeof referenceAnswer === "string") {
    const first = clean(referenceAnswer).match(/^\s*([A-D])(?:\b|[：:。、，,])/i);
    if (first) return { choices: [first[1].toUpperCase()], mode: "single" };
  }
  return { choices: [], mode: "none" };
}

function punctuationSignature(value) {
  return clean(value)
    .replace(/[「」『』“”‘’"']/g, "")
    .replace(/[，,。；;！？!?、／/]+/g, "|")
    .replace(/\s+/g, "")
    .replace(/^\|+|\|+$/g, "")
    .replace(/\|+/g, "|");
}

function assessment(score, verdict, gap = "") {
  const passed = score >= 60;
  return {
    provider: "study-guide-answer-key",
    score,
    correctness: passed ? "correct" : "incorrect",
    verdict,
    strength: passed ? "答案與來源答案鍵一致。" : "已完成一次可核對的作答。",
    gap,
    nextQuestion: passed ? "請說明你判定時依據的原句或規則。" : "請對照參考答案，找出第一處不同後再答一次。",
    passed,
  };
}

export function deterministicStudyGuideAssessment(item, response) {
  const detailTag = clean(item?.detailTag, 100);
  const { choices: expected, mode } = expectedChoiceSpec(item?.referenceAnswer);
  if (expected.length > 0 && /(?:choice|discrimination|identification|objective|knowledge)/i.test(detailTag)) {
    const actual = choiceLetters(response);
    const normalizedExpected = mode === "set" ? [...expected].sort() : expected;
    const normalizedActual = mode === "set"
      ? [...new Set(actual)].sort()
      : actual;
    const correct = normalizedActual.length === normalizedExpected.length
      && normalizedActual.every((entry, index) => entry === normalizedExpected[index]);
    return correct
      ? assessment(100, "答案鍵核對正確。")
      : assessment(0, "答案鍵核對未通過。", `應選 ${expected.join("、")}。`);
  }
  if (detailTag === "punctuation" && typeof item?.referenceAnswer === "string") {
    const expectedSignature = punctuationSignature(item.referenceAnswer);
    const actualSignature = punctuationSignature(response);
    const correct = Boolean(actualSignature && actualSignature === expectedSignature);
    return correct
      ? assessment(100, "斷句與來源參考答案一致。")
      : assessment(0, "斷句尚未與來源參考答案一致。", "請逐一核對語意停頓與人物言語邊界。");
  }
  return null;
}

export function normalizeOpenStudyGuideAssessment(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("開放題評閱格式無效");
  }
  const score = value.score;
  if (!Number.isInteger(score) || score < 0 || score > 100) {
    throw new Error("開放題評閱分數無效");
  }
  const verdict = clean(value.verdict, 120);
  const strength = clean(value.strength, 500);
  const gap = clean(value.gap, 500);
  const nextQuestion = clean(value.nextQuestion, 500);
  if (!verdict || !strength || !gap || !nextQuestion) {
    throw new Error("開放題評閱回饋不完整");
  }
  const passed = score >= 60;
  return {
    provider: "apis",
    score,
    correctness: passed ? "passed" : "needs_revision",
    verdict,
    strength,
    gap,
    nextQuestion,
    passed,
  };
}

export function authoritativeStudyGuideAssessment(attemptedAssessment, recorded) {
  const authoritative = recorded?.deduped === true && recorded?.evaluation
    ? recorded.evaluation
    : attemptedAssessment;
  const score = Number(authoritative?.score);
  const correctness = clean(authoritative?.correctness, 32).toLowerCase();
  const passed = recorded?.eligibilityStatus === "eligible"
    && Number.isFinite(score)
    && score >= 60
    && (correctness === "passed" || correctness === "correct");
  return {
    passed,
    assessment: {
      score: Number.isFinite(score) ? score : null,
      verdict: clean(authoritative?.verdict, 240),
      strength: clean(authoritative?.strength, 500),
      gap: clean(authoritative?.gap, 500),
      nextQuestion: clean(authoritative?.nextQuestion, 500),
    },
  };
}

export function studyGuideAssessmentPrompt(item, response) {
  return [
    "你是高中語文學案形成性評閱員。只評學生這一次作答，不代寫，不改變其價值立場。",
    "先核對題目要求，再核對參考答案與量規中的必要證據。開放考辨題的參考答案不是唯一答案；立場不同但證據充分仍可通過。",
    "不得因篇幅或術語給高分。沒有回應核心要求或沒有文本依據，最高59分。",
    "只輸出 JSON：score(0-100整數)、verdict(一句)、strength(已做到的一點)、gap(最關鍵缺口)、nextQuestion(一個促使重答的問題)。不要 Markdown。",
    `題目：${clean(item?.prompt)}`,
    `答案權威：${clean(item?.answerLabel || item?.answerAuthority, 80)}`,
    `參考答案：${JSON.stringify(item?.referenceAnswer ?? null)}`,
    `說明：${clean(item?.explanation)}`,
    `量規：${JSON.stringify(item?.rubric || [])}`,
    `學生作答：${clean(response)}`,
  ].join("\n");
}
