function clean(value, max = 4000) {
  return String(value || "").normalize("NFC").trim().slice(0, max);
}

// Shared, deliberately bounded traditional-to-simplified folding used by both
// study-guide comparison and the three-word reading analysis. Characters not
// present in the established project table remain unchanged.
const T2S_PAIRS = "愛爱蒼苍傷伤憂忧鬱郁懷怀舊旧憶忆戀恋靜静麗丽華华絢绚濃浓豔艳質质樸朴潔洁簡简練练煉炼縝缜嚴严謹谨轉转蘊蕴壯壮闊阔渾浑開开細细膩腻銳锐鋒锋潑泼諧谐風风謔谑誠诚摯挚懇恳熱热揚扬熾炽寧宁適适詳详謐谧閒闲沖冲遠远雋隽剛刚堅坚韌韧頑顽強强執执獨独遙遥飄飘達达灑洒脫脱羈羁縛缚諷讽貶贬擊击評评讚赞頌颂憫悯憐怜惻恻隱隐關关實实錄录觀观莊庄肅肃鄭郑暢畅曉晓順顺張张對对節节韻韵聲声鏗铿鏘锵徵征託托結结構构佈布鋪铺墊垫筆笔應应畫画點点負负國国報报濟济願愿夢梦靈灵動动傳传鮮鲜涼凉淒凄愴怆蕭萧邁迈曠旷淨净學学讀读書书語语詞词課课見见覺觉說说話话寫写體体為为這这們们裡里後后發发經经過过還还沒没來来時时間间長长門门問问聞闻氣气電电車车馬马鳥鸟魚鱼龍龙鳳凤廣广慶庆億亿儀仪價价優优傑杰稱称藝艺術术歷历樂乐藥药醫医難难嘆叹觸触顯显現现圖图詩诗賦赋";
const T2S = new Map();
for (let index = 0; index + 1 < T2S_PAIRS.length; index += 2) {
  T2S.set(T2S_PAIRS[index], T2S_PAIRS[index + 1]);
}

export function toSimplifiedText(value) {
  let output = "";
  for (const character of String(value || "")) output += T2S.get(character) || character;
  return output;
}

function answerLead(value) {
  return clean(value)
    .normalize("NFKC")
    .split(/(?:\r?\n|[。！？!?；;])/u, 1)[0]
    .split(/(?:因為|因为|理由|解析|依據|依据|原因|而|至於|至于|其餘|其余|其他三項|其他三项)/u, 1)[0]
    .trim();
}

function choiceLetters(value) {
  return answerLead(value).toUpperCase().match(/[A-D]/g) || [];
}

const CIRCLED_NUMBERS = [..."①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳"];

function circledNumbers(value, allowArabic = false) {
  const lead = clean(value)
    .split(/(?:\r?\n|[。！？!?；;])/u, 1)[0]
    .split(/(?:因為|因为|理由|解析|依據|依据|原因|而|至於|至于|其餘|其余|其他三項|其他三项)/u, 1)[0]
    .trim();
  const circled = [...lead.matchAll(/[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]/gu)]
    .map((match) => String(CIRCLED_NUMBERS.indexOf(match[0]) + 1));
  if (circled.length > 0 || !allowArabic) return circled;
  const groups = lead.normalize("NFKC").match(/\d+/g) || [];
  if (groups.length === 1 && /^[1-9]+$/.test(groups[0])) return [...groups[0]];
  return groups
    .map((entry) => Number(entry))
    .filter((entry) => Number.isInteger(entry) && entry >= 1 && entry <= 20)
    .map(String);
}

function explicitSingleChoice(value) {
  const lead = answerLead(value).toUpperCase();
  const match = lead.match(
    /(?:^|[^A-Z])(?:我\s*)?(?:選擇|选择|應選|应选|選|选|答案(?:是|為|为)?)[\s：:]*([A-D])/,
  );
  if (!match) return "";
  const tail = lead.slice(Number(match.index || 0) + match[0].length);
  if (/^\s*(?:和|與|与|或|、|[/／]|[&＆])\s*[A-D]/u.test(tail)) return "";
  if (/^\s*[,，]\s*[A-D](?!\s*(?:項|项))/u.test(tail)) return "";
  return match[1];
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
  return toSimplifiedText(clean(value).normalize("NFKC"))
    .replace(/[「」『』“”‘’"'《》〈〉（）()【】\[\]]/g, "")
    .replace(/[：:，,。；;！？!?、／/]+/g, "|")
    .replace(/[—–－…·]+/g, "")
    .replace(/\s+/g, "|")
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
    const expectedCircled = circledNumbers(item?.referenceAnswer);
    const actualCircled = circledNumbers(response, expectedCircled.length > 0);
    if (expectedCircled.length > 0 && actualCircled.length > 0) {
      const normalizedExpectedCircled = [...new Set(expectedCircled)].sort();
      const normalizedActualCircled = [...new Set(actualCircled)].sort();
      const correct = normalizedActualCircled.length === normalizedExpectedCircled.length
        && normalizedActualCircled.every((entry, index) => entry === normalizedExpectedCircled[index]);
      return correct
        ? assessment(100, "答案鍵核對正確。")
        : assessment(0, "答案鍵核對未通過。", `應選 ${expected.join("、")}（${expectedCircled.join("、")}）。`);
    }
    let actual = choiceLetters(response);
    if (mode === "single" && actual.length > 1) {
      const explicit = explicitSingleChoice(response);
      if (explicit) actual = [explicit];
    }
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
  if (/(?:punctuation|sentence[-_]segmentation)/i.test(detailTag)
      && typeof item?.referenceAnswer === "string") {
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

export function normalizeInteractionAssessment(value, fallbackText = "") {
  const normalized = normalizeOpenStudyGuideAssessment(value);
  return {
    score: normalized.score,
    verdict: normalized.verdict,
    strength: normalized.strength,
    gap: normalized.gap,
    nextQuestion: normalized.nextQuestion,
    raw: clean(fallbackText, 2000),
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
