// 閱讀星圖 API 自動化測試（合成數據，全鏈路斷言）。
// 自起 wrangler pages dev（本地 D1 模擬）＋ 每輪唯一合成學生 → 斷言確定性。
// 用法：node scripts/test_reading_api.mjs   （約 40–60 秒；退出碼非 0 即失敗）
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = 8801;
const SLUG = `test-${Date.now().toString(36)}`;
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = new URL("..", import.meta.url).pathname;
const SERVER_ROOT = mkdtempSync(path.join(os.tmpdir(), "yuwen-reading-api-"));
const STATE_ROOT = path.join(SERVER_ROOT, ".wrangler-state");
for (const file of [
  "_worker.js",
  "lesson-blueprint-rules.js",
  "learning-evidence-source.js",
  "classical-first-read-source.js",
  "preview-network-policy.js",
  "reading-identity-source.js",
  "study-guide-assessment.js",
  "data/interaction-definitions.json",
  "data/learning-manifest.json",
  "data/lesson-competency-manifest.json",
  "data/study-guide-catalog.json",
  "data/preview-targets.json",
  "data/manifest.json",
  "data/literary-taxonomy.json",
  "data/lessons/lesson-1468.json",
  "data/lessons/lesson-1484.json",
  "data/classical-first-read/lesson-1484.json",
  "data/vocab/index.json",
  "data/vocab/lesson-1468.json",
  "data/vocab/lesson-1484.json",
]) {
  const destination = path.join(SERVER_ROOT, file);
  mkdirSync(path.dirname(destination), { recursive: true });
  copyFileSync(new URL(`../site/${file}`, import.meta.url), destination);
}
const firstReadAsset = JSON.parse(readFileSync(new URL("../site/data/classical-first-read/lesson-1484.json", import.meta.url), "utf8"));
const studyGuideCatalog = JSON.parse(readFileSync(new URL("../site/data/study-guide-catalog.json", import.meta.url), "utf8"));
const studyGuideItem = studyGuideCatalog.lessons
  .find((lesson) => lesson.lessonId === "lesson-1484")?.items
  .find((item) => item.activeForSelfTest && item.detailTag === "cultural_knowledge");

const migration = spawnSync("./node_modules/.bin/wrangler", [
  "d1", "migrations", "apply", "READING_DB", "--local", "--persist-to", STATE_ROOT,
], { cwd: ROOT, encoding: "utf8", input: "y\n" });
if (migration.status !== 0) {
  throw new Error(`local D1 migration failed\n${migration.stdout || ""}\n${migration.stderr || ""}`);
}
let passed = 0;
const failures = [];
let apiMutationSequence = 0;

function assert(name, condition, detail = "") {
  if (condition) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failures.push(name); console.error(`  ✗ ${name} ${detail}`); }
}

async function api(path, body) {
  const payload = body ? { ...body } : null;
  if (payload && path === "/api/reading/vocab-attempt" && !payload.clientMutationId) {
    apiMutationSequence += 1;
    payload.clientMutationId = `reading-api-${SLUG}-${apiMutationSequence}`;
  }
  const response = await fetch(`${BASE}${path}`, body ? {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://yw.bdfz.net",
    },
    body: JSON.stringify(payload),
  } : undefined);
  return { status: response.status, data: await response.json().catch(() => ({})) };
}

const server = spawn("./node_modules/.bin/wrangler", [
  "pages", "dev", SERVER_ROOT, "--port", String(PORT), "--persist-to", STATE_ROOT,
  "--binding", `READING_TEST_SLUG=${SLUG}`,
], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
let serverLog = "";
server.stdout.on("data", (chunk) => { serverLog += chunk; });
server.stderr.on("data", (chunk) => { serverLog += chunk; });

async function waitReady() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const { data } = await api("/api/reading/health");
      if (data.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

async function stopServer() {
  if (server.exitCode !== null || server.signalCode !== null) return;
  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(forceTimer);
      resolve();
    };
    const forceTimer = setTimeout(() => {
      server.kill("SIGKILL");
      finish();
    }, 5000);
    server.once("exit", finish);
    server.kill("SIGTERM");
  });
  server.stdout.destroy();
  server.stderr.destroy();
}

try {
  if (!await waitReady()) throw new Error(`dev server did not become ready\n${serverLog.slice(-2000)}`);

  console.log(`synthetic student: ${SLUG}`);

  // 1. 提交
  const first = await api("/api/reading/submission", {
    lessonId: "lesson-1484",
    words: ["逍遙", "質樸", "蓬之心"],
    aiScore: 100,
    aiVerdict: "browser-forged-perfect",
    source: "live",
  });
  assert("first submission accepted", first.data.ok && first.data.deduped === false && first.data.version === 1, JSON.stringify(first.data));
  assert("nodes born (1 lesson + 3 words)", (first.data.born || []).length === 4);
  const firstDetail = await api("/api/reading/lesson/lesson-1484");
  assert(
    "browser score, verdict and source cannot forge reading authority",
    firstDetail.data.history?.[0]?.aiScore === null
      && firstDetail.data.history?.[0]?.aiVerdict === ""
      && firstDetail.data.history?.[0]?.source === "synthetic",
    JSON.stringify(firstDetail.data.history?.[0]),
  );

  // 2. 冪等：原樣重發 / 重排 / 繁簡變體
  const dup = await api("/api/reading/submission", { lessonId: "lesson-1484", words: ["逍遙", "質樸", "蓬之心"] });
  assert("exact duplicate deduped", dup.data.deduped === true && dup.data.version === 1);
  const reorder = await api("/api/reading/submission", { lessonId: "lesson-1484", words: ["蓬之心", "逍遙", "質樸"] });
  assert("reordered duplicate deduped", reorder.data.deduped === true);
  const variant = await api("/api/reading/submission", { lessonId: "lesson-1484", words: ["逍遥", "质朴", "蓬之心"] });
  assert("simplified-variant duplicate deduped", variant.data.deduped === true);

  // 3. 修訂 → 新版本；舊版入沿革
  const revision = await api("/api/reading/submission", { lessonId: "lesson-1484", words: ["旷达", "无用之用", "诙谐"], aiScore: 75 });
  assert("revision creates version 2", revision.data.version === 2 && revision.data.deduped === false);
  const detail = await api("/api/reading/lesson/lesson-1484");
  assert("history has 2 versions", detail.data.history?.length === 2);
  assert("only latest active", detail.data.history?.[0].active === true && detail.data.history?.[1].active === false);

  // 4. 跨課同詞 → 詞星合併（不再新生詞點）
  const cross = await api("/api/reading/submission", { lessonId: "lesson-1466", words: ["旷达", "苍凉", "豪迈"] });
  assert("cross-lesson word not reborn", !(cross.data.born || []).includes("word:旷达"), JSON.stringify(cross.data.born));

  // 5. 校驗拒絕
  const bad = await api("/api/reading/submission", { lessonId: "lesson-1484", words: ["一", "二"] });
  assert("two words rejected", bad.status === 400);
  const same = await api("/api/reading/submission", { lessonId: "lesson-1484", words: ["好", "好", "妙"] });
  assert("duplicate words rejected", same.status === 400);
  const unknownLessonSubmission = await api("/api/reading/submission", {
    lessonId: "lesson-hostile-unknown",
    words: ["越權", "偽造", "課文"],
  });
  assert(
    "unknown lesson cannot enter reading submissions",
    unknownLessonSubmission.status === 400
      && unknownLessonSubmission.data.error === "lesson absent from authoritative catalog",
    JSON.stringify(unknownLessonSubmission),
  );
  const forgedAssessmentLink = await api("/api/reading/submission", {
    lessonId: "lesson-1484",
    words: ["挪用", "來源", "偽造"],
    sourceEventId: "browser-forged-source-event",
    aiScore: 100,
  });
  assert(
    "unmatched source event cannot authorize a reading score",
    forgedAssessmentLink.status === 422
      && forgedAssessmentLink.data.error === "source assessment does not match submission",
    JSON.stringify(forgedAssessmentLink),
  );

  // 6. 星圖載荷不變量
  const constellation = (await api("/api/reading/constellation")).data;
  const lessonNodes = constellation.nodes.filter((node) => node.kind === "lesson");
  const wordNodes = constellation.nodes.filter((node) => node.kind === "word");
  assert("2 lesson stars", lessonNodes.length === 2);
  assert("5 word stars (merged 旷达)", wordNodes.length === 5, String(wordNodes.length));
  const kuangda = wordNodes.find((node) => node.ref === "旷达");
  assert("merged word spans 2 lessons", kuangda?.meta.lessons.length === 2);
  assert("word anchor stable (first lesson)", kuangda?.meta.firstLessonId === "lesson-1484");
  const useLinks = constellation.links.filter((link) => link[2] === "use");
  assert("6 use links", useLinks.length === 6, String(useLinks.length));
  const groupLinks = constellation.links.filter((link) => String(link[2]).startsWith("group:"));
  assert("semantic group link 旷达–豪迈", groupLinks.length >= 1);
  const lesson1484 = lessonNodes.find((node) => node.ref === "lesson-1484");
  assert("brightness excludes browser-forged scores", Math.abs(lesson1484.c - (1 + 0.5 * Math.log2(3))) < 0.01, String(lesson1484.c));

  // 7. 星點穩定：再提交其他課後 seq 不變
  const seqBefore = Object.fromEntries(constellation.nodes.map((node) => [node.id, node.seq]));
  await api("/api/reading/submission", { lessonId: "lesson-1690", words: ["青春", "理想", "意象"] });
  const after = (await api("/api/reading/constellation")).data;
  const seqStable = after.nodes.filter((node) => seqBefore[node.id] !== undefined)
    .every((node) => node.seq === seqBefore[node.id]);
  assert("existing star seq unchanged after growth", seqStable);

  // 8. 古文無標點初讀：伺服器關卡、原子提交、不可變猜測與證據補償。
  const beforeGate = await api("/api/learning/interactions", {
    lessonId: "lesson-1484",
    interactionKey: "noteOpened",
    clientMutationId: `before-first-read-${SLUG}`,
    data: { noteRef: "1" },
  });
  assert("classical follow-up evidence blocked before first read", beforeGate.status === 422, JSON.stringify(beforeGate));

  const firstReadState = await api("/api/reading/first-read/state/lesson-1484");
  assert("first-read state uses current text version", firstReadState.data.textVersionId === firstReadAsset.textVersionId);
  assert("annotated reading starts incomplete", firstReadState.data.annotatedReadCompleted === false);
  const firstReadParagraph = firstReadAsset.paragraphs[0];
  let nextUtf16Offset = 0;
  const markRanges = Array.from(firstReadParagraph.text).slice(0, 3).map((character) => {
    const startOffset = nextUtf16Offset;
    nextUtf16Offset += character.length;
    return { startOffset, endOffset: nextUtf16Offset, selectedText: character };
  });
  const markBodies = markRanges.map((range, index) => ({
    lessonId: "lesson-1484",
    textVersionId: firstReadAsset.textVersionId,
    textDigest: firstReadAsset.textDigest,
    paragraphKey: firstReadParagraph.key,
    startOffset: range.startOffset,
    endOffset: range.endOffset,
    selectedText: range.selectedText,
    guess: `第${index + 1}處第一直覺猜測`,
    elapsedMs: 1000 + index,
    clientMutationId: `first-read-mark-${index}-${SLUG}`,
  }));
  const mark1 = await api("/api/reading/first-read/mark", markBodies[0]);
  const mark1Replay = await api("/api/reading/first-read/mark", markBodies[0]);
  const overlappingMark = await api("/api/reading/first-read/mark", {
    ...markBodies[0],
    endOffset: markRanges[1].endOffset,
    selectedText: firstReadParagraph.text.slice(markRanges[0].startOffset, markRanges[1].endOffset),
    clientMutationId: `first-read-overlap-${SLUG}`,
  });
  const mark2 = await api("/api/reading/first-read/mark", markBodies[1]);
  assert("first-read mark is idempotent", mark1.data.ok && mark1Replay.data.deduped === true);
  assert("overlapping first-read mark is rejected by the API", overlappingMark.status === 500);
  assert("two first-read marks accepted", mark2.data.ok === true);
  const stateAfterOverlap = await api("/api/reading/first-read/state/lesson-1484");
  assert("rejected overlap does not increase the difficulty count", stateAfterOverlap.data.markCount === 2);
  const tooEarlySubmit = await api("/api/reading/first-read/submit", {
    lessonId: "lesson-1484",
    textVersionId: firstReadAsset.textVersionId,
    textDigest: firstReadAsset.textDigest,
    summary: "我大概讀懂了文章先寫逍遙之境",
  });
  assert("submit with fewer than three guesses rejected", tooEarlySubmit.status === 500);
  const mark3 = await api("/api/reading/first-read/mark", markBodies[2]);
  assert("third first-read mark accepted", mark3.data.ok === true);

  const initialSummary = "我大概讀懂了文章先寫逍遙之境再辨大小之別";
  const submitBody = {
    lessonId: "lesson-1484",
    textVersionId: firstReadAsset.textVersionId,
    textDigest: firstReadAsset.textDigest,
    summary: initialSummary,
    elapsedMs: 9000,
  };
  const racingUpdate = {
    ...markBodies[0],
    guess: "併發時的新猜測",
    clientMutationId: `first-read-racing-update-${SLUG}`,
  };
  const [submitted, raced] = await Promise.all([
    api("/api/reading/first-read/submit", submitBody),
    api("/api/reading/first-read/mark", racingUpdate),
  ]);
  assert("submit wins or serializes with racing mark update", submitted.data.ok === true && [200, 500].includes(raced.status));
  const submittedState = await api("/api/reading/first-read/state/lesson-1484");
  assert("submitted state has exactly three immutable active marks", submittedState.data.submitted === true && submittedState.data.markCount === 3);
  assert("first-read submit does not skip annotated reading", submittedState.data.annotatedReadCompleted === false);
  const vocabBeforeAnnotatedRead = await api("/api/reading/vocab-attempt", {
    lessonId: "lesson-1484",
    itemId: "lesson-1484:v01",
    selectedIndex: 1,
    clientMutationId: `vocab-before-annotated-${SLUG}`,
  });
  assert("vocabulary remains locked until annotated reading is acknowledged", vocabBeforeAnnotatedRead.status === 422, JSON.stringify(vocabBeforeAnnotatedRead));
  const annotatedReadBody = {
    lessonId: "lesson-1484",
    interactionKey: "readAcknowledged",
    clientMutationId: `annotated-read:lesson-1484:${firstReadAsset.textVersionId}`.slice(0, 100),
    lessonPhase: "annotated_reading",
    data: { threshold: 1 },
  };
  const annotatedRead = await api("/api/learning/interactions", annotatedReadBody);
  const annotatedReadReplay = await api("/api/learning/interactions", annotatedReadBody);
  const stateAfterAnnotatedRead = await api("/api/reading/first-read/state/lesson-1484");
  assert("annotated reading acknowledgement is idempotent", annotatedRead.data.ok === true && annotatedReadReplay.data.deduped === true);
  assert("annotated reading receipt unlocks vocabulary", stateAfterAnnotatedRead.data.annotatedReadCompleted === true);
  const frozenGuess = submittedState.data.marks.find((mark) => mark.markId === mark1.data.mark.markId)?.guess;
  const lateUpdate = await api("/api/reading/first-read/mark", {
    ...markBodies[0],
    guess: "提交後不應寫入",
    elapsedMs: 12 * 60 * 60 * 1000,
    clientMutationId: `first-read-late-update-${SLUG}`,
  });
  assert("guess cannot change after submit", lateUpdate.status === 500);
  const replaySubmit = await api("/api/reading/first-read/submit", {
    ...submitBody,
    summary: "重播不得覆寫原始初讀總結內容",
    elapsedMs: 12 * 60 * 60 * 1000,
  });
  const replayState = await api("/api/reading/first-read/state/lesson-1484");
  assert("submit replay is idempotent and preserves summary", replaySubmit.data.deduped === true && replayState.data.summary === initialSummary);
  assert("submitted elapsed time is immutable after rejected or replayed writes", replayState.data.elapsedMs === submittedState.data.elapsedMs);
  assert("racing guess has one serialized final value", [markBodies[0].guess, racingUpdate.guess].includes(frozenGuess));
  const lateDelete = await api("/api/reading/first-read/mark/delete", {
    lessonId: "lesson-1484",
    textVersionId: firstReadAsset.textVersionId,
    textDigest: firstReadAsset.textDigest,
    markId: mark1.data.mark.markId,
  });
  assert("mark cannot be deleted after submit", lateDelete.status === 500);

  let finalResolve = null;
  for (const [index, mark] of submittedState.data.marks.entries()) {
    finalResolve = await api("/api/reading/first-read/resolve", {
      lessonId: "lesson-1484",
      textVersionId: firstReadAsset.textVersionId,
      textDigest: firstReadAsset.textDigest,
      markId: mark.markId,
      correction: `第${index + 1}處細讀訂正`,
    });
  }
  assert("all red marks receive blue corrections", finalResolve.data.allResolved === true && finalResolve.data.evidence?.sourceEventId);
  const reconcile1 = await api("/api/reading/first-read/reconcile", {
    lessonId: "lesson-1484",
    textVersionId: firstReadAsset.textVersionId,
    textDigest: firstReadAsset.textDigest,
  });
  const reconcile2 = await api("/api/reading/first-read/reconcile", {
    lessonId: "lesson-1484",
    textVersionId: firstReadAsset.textVersionId,
    textDigest: firstReadAsset.textDigest,
  });
  assert("first-read evidence reconciliation is idempotent", reconcile1.data.ok && reconcile2.data.ok);

  assert("lesson has an active study-guide item fixture", Boolean(studyGuideItem));
  const bypassStudyEvidence = await api("/api/learning/interactions", {
    lessonId: "lesson-1484",
    interactionKey: "studyGuideItemCompleted",
    clientMutationId: `study-bypass-${SLUG}`,
    data: {
      itemKey: studyGuideItem.itemKey,
      response: "A",
      referenceRevealedAt: new Date().toISOString(),
    },
  });
  assert("generic evidence route cannot bypass study-guide assessment", bypassStudyEvidence.status === 400);
  const emptyStudyEvidence = await api("/api/reading/study-guide-attempt", {
    lessonId: "lesson-1484",
    clientMutationId: `study-complete-${SLUG}`,
    itemKey: studyGuideItem.itemKey,
    response: "",
    referenceRevealedAt: new Date().toISOString(),
  });
  assert("empty study-guide response cannot enter mastery numerator", emptyStudyEvidence.status === 400);
  const wrongStudyEvidence = await api("/api/reading/study-guide-attempt", {
    lessonId: "lesson-1484",
    itemKey: studyGuideItem.itemKey,
    clientMutationId: `study-wrong-${SLUG}`,
    response: "B",
    referenceRevealedAt: new Date().toISOString(),
  });
  assert(
    "wrong objective study-guide answer is retained but ineligible",
    wrongStudyEvidence.data.ok === true
      && wrongStudyEvidence.data.passed === false
      && wrongStudyEvidence.data.evidence?.eligibilityStatus === "ineligible",
    JSON.stringify(wrongStudyEvidence),
  );
  const studyRevealAt = new Date().toISOString();
  const studyEvidence = await api("/api/reading/study-guide-attempt", {
    lessonId: "lesson-1484",
    itemKey: studyGuideItem.itemKey,
    clientMutationId: `study-correct-${SLUG}`,
    response: "A",
    referenceRevealedAt: studyRevealAt,
  });
  assert(
    "source-graded study-guide answer enters non-grade mastery evidence",
    studyEvidence.data.ok === true
      && studyEvidence.data.passed === true
      && studyEvidence.data.evidence?.eligibilityStatus === "eligible",
    JSON.stringify(studyEvidence),
  );
  const studyEvidenceReplay = await api("/api/reading/study-guide-attempt", {
    lessonId: "lesson-1484",
    itemKey: studyGuideItem.itemKey,
    clientMutationId: `study-correct-${SLUG}`,
    response: "A",
    referenceRevealedAt: studyRevealAt,
  });
  assert(
    "study-guide replay returns the immutable stored assessment",
    studyEvidenceReplay.data.ok === true
      && studyEvidenceReplay.data.deduped === true
      && studyEvidenceReplay.data.passed === studyEvidence.data.passed
      && studyEvidenceReplay.data.assessment?.score === studyEvidence.data.assessment?.score
      && studyEvidenceReplay.data.evidence?.sourceEventId === studyEvidence.data.evidence?.sourceEventId,
    JSON.stringify(studyEvidenceReplay),
  );

  // 9. 字詞題掌握規則
  const firstTry = await api("/api/reading/vocab-attempt", { lessonId: "lesson-1484", itemId: "lesson-1484:v01", selectedIndex: 1 });
  assert("first-try correct => mastered", firstTry.data.status === "mastered", JSON.stringify(firstTry));
  assert("server computes correctness from answer key", firstTry.data.correct === true, JSON.stringify(firstTry));
  const forged = await api("/api/reading/vocab-attempt", { lessonId: "lesson-1484", itemId: "lesson-1484:v02", correct: true, answer: "forged" });
  assert("browser correctness without selectedIndex rejected", forged.status === 400);
  const beforeExcludedAttempt = (await api("/api/reading/health")).data.learningInteractions;
  const excludedAttempt = await api("/api/reading/vocab-attempt", {
    lessonId: "lesson-1468",
    itemId: "lesson-1468:v01",
    selectedIndex: 0,
  });
  const afterExcludedAttempt = (await api("/api/reading/health")).data.learningInteractions;
  assert(
    "non-classical tombstone cannot enter evaluator",
    excludedAttempt.status === 400
      && excludedAttempt.data.error === "vocabulary item absent from authoritative bank",
    JSON.stringify(excludedAttempt),
  );
  assert(
    "rejected tombstone creates no learning evidence",
    afterExcludedAttempt === beforeExcludedAttempt,
    `${beforeExcludedAttempt} -> ${afterExcludedAttempt}`,
  );
  const vocabRetryMutationId = `vocab-retry-${SLUG}`;
  const wrong = await api("/api/reading/vocab-attempt", {
    lessonId: "lesson-1484",
    itemId: "lesson-1484:v02",
    selectedIndex: 0,
    clientMutationId: vocabRetryMutationId,
  });
  assert("wrong => learning", wrong.data.status === "learning", JSON.stringify(wrong));
  assert("wrong answer synchronizes as ineligible", wrong.data.evidence?.delivery?.endsWith("_ineligible"));
  const wrongRetry = await api("/api/reading/vocab-attempt", {
    lessonId: "lesson-1484",
    itemId: "lesson-1484:v02",
    selectedIndex: 0,
    clientMutationId: vocabRetryMutationId,
  });
  assert("same mutation id replays without a new attempt", wrongRetry.data.deduped === true && wrongRetry.data.wrongCount === 1);
  const retry1 = await api("/api/reading/vocab-attempt", { lessonId: "lesson-1484", itemId: "lesson-1484:v02", selectedIndex: 2 });
  assert("one correct after wrong => still learning", retry1.data.status === "learning");
  assert("correct retry remains synchronized but ineligible until mastered", retry1.data.evidence?.delivery?.endsWith("_ineligible"));
  const retry2 = await api("/api/reading/vocab-attempt", { lessonId: "lesson-1484", itemId: "lesson-1484:v02", selectedIndex: 2 });
  assert("two corrects => mastered", retry2.data.status === "mastered");
  assert("mastered answer is eligible for delivery", !retry2.data.evidence?.delivery?.endsWith("_ineligible"));
  const state = await api("/api/reading/vocab-state/lesson-1484");
  assert("vocab-state lists 2 items", state.data.items?.length === 2);

  const sameConcurrentMutation = `vocab-concurrent-same-${SLUG}`;
  const sameConcurrent = await Promise.all([
    api("/api/reading/vocab-attempt", {
      lessonId: "lesson-1484",
      itemId: "lesson-1484:v04",
      selectedIndex: 1,
      clientMutationId: sameConcurrentMutation,
    }),
    api("/api/reading/vocab-attempt", {
      lessonId: "lesson-1484",
      itemId: "lesson-1484:v04",
      selectedIndex: 1,
      clientMutationId: sameConcurrentMutation,
    }),
  ]);
  assert(
    "concurrent same mutation creates exactly one authoritative attempt",
    sameConcurrent.every((item) => item.status === 200)
      && sameConcurrent.filter((item) => item.data.deduped === true).length === 1
      && sameConcurrent.every((item) => item.data.attemptNo === 1),
    JSON.stringify(sameConcurrent),
  );

  const distinctConcurrent = await Promise.all([
    api("/api/reading/vocab-attempt", {
      lessonId: "lesson-1484",
      itemId: "lesson-1484:v05",
      selectedIndex: 1,
      clientMutationId: `vocab-concurrent-a-${SLUG}`,
    }),
    api("/api/reading/vocab-attempt", {
      lessonId: "lesson-1484",
      itemId: "lesson-1484:v05",
      selectedIndex: 1,
      clientMutationId: `vocab-concurrent-b-${SLUG}`,
    }),
  ]);
  assert(
    "concurrent distinct mutations serialize attempt numbers without loss",
    distinctConcurrent.every((item) => item.status === 200)
      && distinctConcurrent.map((item) => item.data.attemptNo).sort((a, b) => a - b).join(",") === "1,2",
    JSON.stringify(distinctConcurrent),
  );
  const concurrentState = await api("/api/reading/vocab-state/lesson-1484");
  const concurrentItem = concurrentState.data.items?.find((item) => item.item_id === "lesson-1484:v05");
  assert("concurrent mastery increment retains both correct attempts", concurrentItem?.correct_count === 2);

  // 10. 每人每資源短時提交邊界：八次正常修訂可保留，第九次拒絕且不新增嘗試。
  const boundedAttempts = [];
  for (let i = 0; i < 8; i += 1) {
    boundedAttempts.push(await api("/api/reading/vocab-attempt", {
      lessonId: "lesson-1484",
      itemId: "lesson-1484:v03",
      selectedIndex: i === 0 ? 1 : 0,
    }));
  }
  assert("eight bounded revisions accepted", boundedAttempts.every((item) => item.status === 200));
  const rateBlocked = await api("/api/reading/vocab-attempt", {
    lessonId: "lesson-1484",
    itemId: "lesson-1484:v03",
    selectedIndex: 0,
  });
  assert(
    "ninth same-resource submission rate-limited",
    rateBlocked.status === 429 && rateBlocked.data.code === "learning_submission_rate_limited",
  );

  // 11. 互動註冊表：未知事件拒絕；已註冊語義事件進入源端賬本。
  const unknown = await api("/api/learning/interactions", { lessonId: "lesson-1484", interactionKey: "mousemove" });
  assert("unknown/raw telemetry rejected", unknown.status === 400);
  const unknownLessonInteraction = await api("/api/learning/interactions", {
    lessonId: "lesson-hostile-unknown",
    interactionKey: "noteOpened",
    clientMutationId: `unknown-lesson-${SLUG}`,
    data: { noteRef: "forged" },
  });
  assert(
    "unknown lesson cannot enter semantic evidence",
    unknownLessonInteraction.status === 400
      && unknownLessonInteraction.data.error === "lesson absent from authoritative catalog",
    JSON.stringify(unknownLessonInteraction),
  );
  const trace = await api("/api/learning/interactions", {
    lessonId: "lesson-1484",
    interactionKey: "noteOpened",
    clientMutationId: `trace-${SLUG}`,
    data: { noteRef: "1" },
  });
  assert("registered semantic interaction recorded", trace.data.ok && trace.data.sourceEventId, JSON.stringify(trace));
  const traceDup = await api("/api/learning/interactions", {
    lessonId: "lesson-1484",
    interactionKey: "noteOpened",
    clientMutationId: `trace-${SLUG}`,
    data: { noteRef: "1" },
  });
  assert("client mutation id is idempotent", traceDup.data.ok && traceDup.data.deduped === true);

  // 12. 健康探針
  const health = (await api("/api/reading/health")).data;
  assert("health counts grow", health.ok && health.submissions >= 4 && health.nodes >= 9);
  assert("eligible and ineligible attempts remain in source ledger", health.learningInteractions >= 13);
} catch (error) {
  failures.push(String(error.message || error));
  console.error(error);
} finally {
  await stopServer();
  rmSync(SERVER_ROOT, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
