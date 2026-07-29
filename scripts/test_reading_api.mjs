// 閱讀星圖 API 自動化測試（合成數據，全鏈路斷言）。
// 自起 wrangler pages dev（本地 D1 模擬）＋ 每輪唯一合成學生 → 斷言確定性。
// 用法：node scripts/test_reading_api.mjs   （約 40–60 秒；退出碼非 0 即失敗）
import { spawn } from "node:child_process";

const PORT = 8801;
const SLUG = `test-${Date.now().toString(36)}`;
const BASE = `http://127.0.0.1:${PORT}`;
let passed = 0;
const failures = [];

function assert(name, condition, detail = "") {
  if (condition) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failures.push(name); console.error(`  ✗ ${name} ${detail}`); }
}

async function api(path, body) {
  const response = await fetch(`${BASE}${path}`, body ? {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  } : undefined);
  return { status: response.status, data: await response.json().catch(() => ({})) };
}

const server = spawn("./node_modules/.bin/wrangler", [
  "pages", "dev", "site", "--port", String(PORT), "--binding", `READING_TEST_SLUG=${SLUG}`,
], { cwd: new URL("..", import.meta.url).pathname, stdio: ["ignore", "pipe", "pipe"] });
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
  const first = await api("/api/reading/submission", { lessonId: "lesson-1484", words: ["逍遙", "質樸", "蓬之心"], aiScore: 88, aiVerdict: "ok" });
  assert("first submission accepted", first.data.ok && first.data.deduped === false && first.data.version === 1, JSON.stringify(first.data));
  assert("nodes born (1 lesson + 3 words)", (first.data.born || []).length === 4);

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
  assert("brightness reflects versions+score", Math.abs(lesson1484.c - (1 + 0.5 * Math.log2(3) + 0.5)) < 0.01, String(lesson1484.c));

  // 7. 星點穩定：再提交其他課後 seq 不變
  const seqBefore = Object.fromEntries(constellation.nodes.map((node) => [node.id, node.seq]));
  await api("/api/reading/submission", { lessonId: "lesson-1690", words: ["青春", "理想", "意象"] });
  const after = (await api("/api/reading/constellation")).data;
  const seqStable = after.nodes.filter((node) => seqBefore[node.id] !== undefined)
    .every((node) => node.seq === seqBefore[node.id]);
  assert("existing star seq unchanged after growth", seqStable);

  // 8. 字詞題掌握規則
  const firstTry = await api("/api/reading/vocab-attempt", { lessonId: "lesson-1484", itemId: "lesson-1484:v01", selectedIndex: 1 });
  assert("first-try correct => mastered", firstTry.data.status === "mastered");
  assert("server computes correctness from answer key", firstTry.data.correct === true);
  const forged = await api("/api/reading/vocab-attempt", { lessonId: "lesson-1484", itemId: "lesson-1484:v02", correct: true, answer: "forged" });
  assert("browser correctness without selectedIndex rejected", forged.status === 400);
  const vocabRetryMutationId = `vocab-retry-${SLUG}`;
  const wrong = await api("/api/reading/vocab-attempt", {
    lessonId: "lesson-1484",
    itemId: "lesson-1484:v02",
    selectedIndex: 0,
    clientMutationId: vocabRetryMutationId,
  });
  assert("wrong => learning", wrong.data.status === "learning");
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

  // 9. 每人每資源短時提交邊界：八次正常修訂可保留，第九次拒絕且不新增嘗試。
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

  // 10. 互動註冊表：未知事件拒絕；已註冊語義事件進入源端賬本。
  const unknown = await api("/api/learning/interactions", { lessonId: "lesson-1484", interactionKey: "mousemove" });
  assert("unknown/raw telemetry rejected", unknown.status === 400);
  const trace = await api("/api/learning/interactions", {
    lessonId: "lesson-1484",
    interactionKey: "noteOpened",
    clientMutationId: `trace-${SLUG}`,
    data: { noteRef: "1" },
  });
  assert("registered semantic interaction recorded", trace.data.ok && trace.data.sourceEventId);
  const traceDup = await api("/api/learning/interactions", {
    lessonId: "lesson-1484",
    interactionKey: "noteOpened",
    clientMutationId: `trace-${SLUG}`,
    data: { noteRef: "1" },
  });
  assert("client mutation id is idempotent", traceDup.data.ok && traceDup.data.deduped === true);

  // 11. 健康探針
  const health = (await api("/api/reading/health")).data;
  assert("health counts grow", health.ok && health.submissions >= 4 && health.nodes >= 9);
  assert("eligible and ineligible attempts remain in source ledger", health.learningInteractions >= 13);
} catch (error) {
  failures.push(String(error.message || error));
  console.error(error);
} finally {
  await stopServer();
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
