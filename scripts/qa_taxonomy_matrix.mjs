import { chromium } from "playwright";
import fs from "node:fs";

const base = process.env.BASE_URL || "http://127.0.0.1:8799";
const executablePath = "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";
const manifest = JSON.parse(fs.readFileSync(new URL("../site/data/manifest.json", import.meta.url), "utf8"));
const taxonomy = JSON.parse(fs.readFileSync(new URL("../site/data/literary-taxonomy.json", import.meta.url), "utf8"));
const atlasSource = fs.readFileSync(new URL("../site/assets/atlas.js", import.meta.url), "utf8");
const insightsSource = fs.readFileSync(new URL("../site/assets/insights.js", import.meta.url), "utf8");
const failures = [];
const checks = [];
const layoutOnly = process.env.YW_LAYOUT_ONLY === "1";

function check(name, condition, detail = "") {
  checks.push({ name, pass: Boolean(condition), detail });
  if (!condition) failures.push(`${name}${detail ? `: ${detail}` : ""}`);
}

function printResults() {
  console.log(JSON.stringify({ base, passed: checks.filter((item) => item.pass).length, total: checks.length, failures }, null, 2));
}

async function captureLessonLayout(page, width, height) {
  await page.setViewportSize({ width, height });
  await page.goto(`${base}/#lesson-1458`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector("#lesson-title")?.textContent.includes("中国人民站起来了"));
  await page.waitForFunction(() => {
    const title = document.querySelector("#lesson-title");
    return title && title.scrollWidth <= title.clientWidth + 1;
  });
  return page.evaluate(() => {
    const rect = (selector) => {
      const node = document.querySelector(selector);
      if (!node) return null;
      const box = node.getBoundingClientRect();
      return { top: box.top, right: box.right, bottom: box.bottom, left: box.left, width: box.width, height: box.height };
    };
    const panel = document.querySelector("#mastery-panel");
    const title = document.querySelector("#lesson-title");
    const titleStyle = title ? getComputedStyle(title) : null;
    return {
      viewport: { width: innerWidth, height: innerHeight },
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      orientationParent: document.querySelector("#orientation")?.parentElement?.id || "",
      railParent: document.querySelector("#learning-rail")?.parentElement?.id || "",
      mobileAnchorCount: document.querySelectorAll("#mobile-mastery-anchor").length,
      railInStudyLayout: document.querySelectorAll(".study-layout #learning-rail").length,
      collapsed: document.querySelector("#learning-rail")?.classList.contains("collapsed") === true,
      ariaExpanded: document.querySelector("#mastery-toggle")?.getAttribute("aria-expanded") || "",
      panelDisplay: panel ? getComputedStyle(panel).display : "missing",
      masthead: rect("#lesson-masthead"),
      copy: rect(".masthead-copy"),
      orientation: rect("#orientation"),
      portrait: rect("#lesson-portraits"),
      rail: rect("#learning-rail"),
      textbook: rect("#textbook-text"),
      titleSingleLine: Boolean(title && titleStyle)
        && title.scrollWidth <= title.clientWidth + 1
        && title.getBoundingClientRect().height <= parseFloat(titleStyle.lineHeight) * 1.1,
    };
  });
}

function inside(container, child, tolerance = 1) {
  return Boolean(container && child
    && child.left >= container.left - tolerance
    && child.right <= container.right + tolerance
    && child.top >= container.top - tolerance
    && child.bottom <= container.bottom + tolerance);
}

async function verifyLessonLayout(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  const desktop = await captureLessonLayout(page, 1440, 960);
  check("起始方向與本機完成度合併進篇首", desktop.orientationParent === "lesson-masthead" && desktop.railParent === "lesson-masthead", JSON.stringify(desktop));
  check("舊移動端完成度錨點已刪除", desktop.mobileAnchorCount === 0 && desktop.railInStudyLayout === 0, JSON.stringify(desktop));
  check("新訪客本機完成度默認收起", desktop.collapsed && desktop.ariaExpanded === "false" && desktop.panelDisplay === "none", JSON.stringify(desktop));
  check("1440 篇頁無橫向溢出且篇名單行", !desktop.overflow && desktop.titleSingleLine, JSON.stringify(desktop));
  check("1440 本機完成度位於肖像右側", inside(desktop.masthead, desktop.rail) && desktop.rail.left >= desktop.portrait.right - 1, JSON.stringify(desktop));

  await page.locator("#mastery-toggle").click();
  const expanded = await page.evaluate(() => ({
    collapsed: document.querySelector("#learning-rail")?.classList.contains("collapsed") === true,
    ariaExpanded: document.querySelector("#mastery-toggle")?.getAttribute("aria-expanded") || "",
    panelDisplay: getComputedStyle(document.querySelector("#mastery-panel")).display,
  }));
  check("本機完成度可展開", !expanded.collapsed && expanded.ariaExpanded === "true" && expanded.panelDisplay !== "none", JSON.stringify(expanded));
  await page.locator("#mastery-toggle").click();
  const collapsed = await page.evaluate(() => ({
    collapsed: document.querySelector("#learning-rail")?.classList.contains("collapsed") === true,
    ariaExpanded: document.querySelector("#mastery-toggle")?.getAttribute("aria-expanded") || "",
    panelDisplay: getComputedStyle(document.querySelector("#mastery-panel")).display,
  }));
  check("本機完成度可縮回", collapsed.collapsed && collapsed.ariaExpanded === "false" && collapsed.panelDisplay === "none", JSON.stringify(collapsed));

  const tablet = await captureLessonLayout(page, 1024, 768);
  check("1024 篇頁無橫向溢出", !tablet.overflow && tablet.titleSingleLine, JSON.stringify(tablet));
  check(
    "1024 完成度仍留在篇首且不佔正文欄",
    tablet.railParent === "lesson-masthead"
      && inside(tablet.masthead, tablet.rail)
      && tablet.rail.top >= Math.max(tablet.orientation.bottom, tablet.portrait.bottom) - 1
      && tablet.textbook.top >= tablet.masthead.bottom - 1,
    JSON.stringify(tablet),
  );

  const mobile = await captureLessonLayout(page, 390, 844);
  check("390 篇頁無橫向溢出且篇名單行", !mobile.overflow && mobile.titleSingleLine, JSON.stringify(mobile));
  check(
    "390 起始與完成度依序留在篇首",
    mobile.orientationParent === "lesson-masthead"
      && mobile.railParent === "lesson-masthead"
      && inside(mobile.masthead, mobile.orientation)
      && inside(mobile.masthead, mobile.rail)
      && mobile.rail.top >= mobile.orientation.bottom - 1
      && mobile.textbook.top >= mobile.masthead.bottom - 1,
    JSON.stringify(mobile),
  );
  check("版面驗證無前端運行錯誤", pageErrors.length === 0, pageErrors.join(" | "));
  await context.close();
}

const authorEvidenceErrors = taxonomy.lessons.flatMap((lesson) => {
  if (["unit-intro", "unit-task", "whole-book", "language-activity", "review"].includes(lesson.mode) && lesson.authors.length) return [`${lesson.id}:學習活動帶作者`];
  return lesson.authors.filter((author) => !["toc", "heading"].includes(author.evidence)).map((author) => `${lesson.id}:${author.name}`);
});
const authorNames = (id) => taxonomy.lessons.find((lesson) => lesson.id === id)?.authors.map((author) => author.name) || [];
const splitLessons = manifest.lessons.filter((lesson) => lesson.derivedFrom);
const splitSources = new Set(splitLessons.map((lesson) => lesson.derivedFrom));
check("必修上下合併篇目拆為獨立目錄", splitLessons.length === 35 && splitSources.size === 13 && taxonomy.stats.lessons === 189, JSON.stringify({ splitLessons: splitLessons.length, splitSources: splitSources.size, taxonomyLessons: taxonomy.stats.lessons }));
check("拆分篇目均有獨立資料與教材頁", splitLessons.every((lesson) => fs.existsSync(new URL(`../site/${lesson.dataUrl}`, import.meta.url)) && lesson.postCount === 1 && lesson.textbookPageCount > 0), splitLessons.filter((lesson) => !lesson.dataUrl || lesson.postCount !== 1 || lesson.textbookPageCount < 1).map((lesson) => lesson.id).join(" / "));
check("全篇目作者均有教材題署證據", authorEvidenceErrors.length === 0, authorEvidenceErrors.join(" / "));
const allAuthors = [...new Map(taxonomy.lessons.flatMap((lesson) => lesson.authors).map((author) => [author.id, author])).values()];
const linkedPortraits = allAuthors.filter((author) => author.url);
const missingPortraitAssets = linkedPortraits.filter((author) => !fs.existsSync(`/Users/ylsuen/CF/qunxian/public/img/figures/${author.id}.webp`));
const representativeLessons = taxonomy.lessons.filter((lesson) => !lesson.authors.length && lesson.representativeFigure);
const authorlessWithoutRepresentative = taxonomy.lessons.filter((lesson) => !lesson.authors.length && !lesson.representativeFigure);
const representativeContractFailures = representativeLessons.filter((lesson) => {
  const person = lesson.representativeFigure;
  return !person.id || !person.name || !person.url?.endsWith(`#${person.id}`) || !person.role || !person.reason || !person.portraitKind || !person.evidenceLessonIds?.length;
});
const missingRepresentativeAssets = representativeLessons.filter((lesson) => !fs.existsSync(`/Users/ylsuen/CF/qunxian/public/img/figures/${lesson.representativeFigure.id}.webp`));
const prohibitedBookVisuals = taxonomy.lessons.filter((lesson) => lesson.visual || ["textbook-cover", "textbook-page"].includes(lesson.visual?.kind));
check("全部署名作者均連通群賢", linkedPortraits.length === allAuthors.length, allAuthors.filter((author) => !author.url).map((author) => author.name).join(" / "));
check("全部群賢作者肖像資產存在", missingPortraitAssets.length === 0, missingPortraitAssets.map((author) => author.name).join(" / "));
check("全部無署名篇目有明示角色的代表人物", representativeLessons.length === 65 && authorlessWithoutRepresentative.length === 0 && representativeContractFailures.length === 0, [...authorlessWithoutRepresentative, ...representativeContractFailures].map((lesson) => lesson.id).join(" / "));
check("全部代表人物肖像資產存在", missingRepresentativeAssets.length === 0, missingRepresentativeAssets.map((lesson) => `${lesson.id}:${lesson.representativeFigure.id}`).join(" / "));
check("篇首不再使用書封或教材頁", prohibitedBookVisuals.length === 0, prohibitedBookVisuals.map((lesson) => lesson.id).join(" / "));
check("雪萊連通群賢人物檔案", taxonomy.lessons.find((lesson) => lesson.id === "lesson-1692-p4")?.authors[0]?.url === "https://qx.bdfz.net/#shelley");
check("喜看稻菽千重浪作者為沈英甲", JSON.stringify(authorNames("lesson-1697")) === JSON.stringify(["沈英甲"]), authorNames("lesson-1697").join("、"));
check("春江花月夜只署張若虛", JSON.stringify(authorNames("lesson-1498")) === JSON.stringify(["张若虚"]), authorNames("lesson-1498").join("、"));
check("文體書目默認尺度可見全貌", /const BASE_ZOOM = \.56;/.test(atlasSource) && /const MIN_ZOOM = \.32;/.test(atlasSource));
check("文體書目具時代與關係資料", taxonomy.genres.every((item) => item.era && Number.isFinite(item.year) && item.detail && Array.isArray(item.relatedIds)) && taxonomy.books.every((item) => item.era && Number.isFinite(item.year) && item.description && Array.isArray(item.relatedTitles)));

const browser = await chromium.launch({ executablePath, headless: true });
await verifyLessonLayout(browser);
if (layoutOnly) {
  await browser.close();
  printResults();
  process.exit(failures.length ? 1 : 0);
}
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.message));

await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.querySelector("#lesson-title")?.textContent.includes("中国人民站起来了"));
const defaultState = await page.evaluate(() => ({
  hash: location.hash,
  block: document.querySelector("#book-switcher [data-block].active")?.dataset.block || "",
  title: document.querySelector("#lesson-title")?.textContent || "",
}));
check("新訪客默認進入選必上", defaultState.block === "xuanbi-shang" && defaultState.hash === "#lesson-1458", JSON.stringify(defaultState));

await page.goto(`${base}/#lesson-1709`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.querySelector("#lesson-title")?.textContent.includes("整本书阅读"));
const representativeState = await page.evaluate(() => ({
  href: document.querySelector("#lesson-portraits .representative-choice")?.href || "",
  role: document.querySelector("#lesson-portraits .representative-choice small")?.textContent || "",
  orientation: document.querySelector(".orientation-line")?.textContent || "",
  sourcePortraits: document.querySelectorAll("#lesson-portraits .source-portrait").length,
}));
check("鄉土中國使用費孝通本人作整本書代表", representativeState.href === "https://qx.bdfz.net/#feixiaotong" && representativeState.role === "整本書作者", JSON.stringify(representativeState));
check("代表人物明示不作課文作者歸屬且無書封", representativeState.orientation.includes("不作課文作者歸屬") && representativeState.sourcePortraits === 0, JSON.stringify(representativeState));

await page.goto(`${base}/#lesson-1576`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("#lesson-title", { state: "visible" });
await page.waitForFunction(() => document.querySelector("#lesson-title")?.textContent.includes("陈情表"));

const chenqing = await page.evaluate(() => ({
  title: document.querySelector("#lesson-title")?.textContent || "",
  metaRemoved: document.querySelector("#lesson-meta") === null,
  mastheadPath: document.querySelector(".masthead-path")?.textContent || "",
  authorHref: document.querySelector('.orientation-line a[href*="qx.bdfz.net"]')?.href || "",
  bookText: document.querySelector(".orientation-line")?.textContent || "",
  portraits: document.querySelectorAll("#lesson-portraits .portrait-choice img").length,
  portraitNameCard: document.querySelector("#lesson-portraits .portrait-choice.name-card")?.getAttribute("aria-label") || "",
  portraitShape: (() => { const node = document.querySelector("#lesson-portraits .portrait-choice"); if (!node) return null; const rect = node.getBoundingClientRect(); return { width: rect.width, height: rect.height, radius: getComputedStyle(node).borderRadius }; })(),
  titleLayout: (() => { const node = document.querySelector("#lesson-title"); if (!node) return null; const style = getComputedStyle(node); return { whiteSpace: style.whiteSpace, width: node.clientWidth, scrollWidth: node.scrollWidth, height: node.getBoundingClientRect().height, lineHeight: parseFloat(style.lineHeight) }; })(),
  annotationRefs: document.querySelectorAll("#text-flow .reader-note-ref").length,
  annotationItems: document.querySelectorAll("#text-flow .reader-annotations li").length,
  annotationResidue: /\[\/?color|\[\d+:\d+\]/i.test(document.querySelector("#text-flow")?.textContent || ""),
  footnoteLists: document.querySelectorAll("#text-flow .footnotes-list").length,
  forumFragmentLinks: [...document.querySelectorAll('#text-flow a[href*="forum.rdfzer.com/#footnote"]')].length,
  repeatedHeadings: [...document.querySelectorAll("#text-flow h1,#text-flow h2,#text-flow h3")].filter((node) => /陈情表/.test(node.textContent || "")).length,
  checkLabels: [...document.querySelectorAll("#check-stage h3")].map((node) => node.textContent.trim()),
  stageMarks: [...document.querySelectorAll("#check-stage .check-round > header > .stage-wadang")].map((node) => node.textContent.trim()),
  stageSvgCount: document.querySelectorAll("#check-stage .stage-wadang svg").length,
  noteStyle: (() => { const node = document.querySelector("#text-flow .reader-note-ref"); if (!node) return null; const style = getComputedStyle(node); return { border: style.borderStyle, radius: style.borderRadius }; })(),
  orientationParent: document.querySelector("#orientation")?.parentElement?.id || "",
  railParent: document.querySelector("#learning-rail")?.parentElement?.id || "",
  mobileMasteryAnchors: document.querySelectorAll("#mobile-mastery-anchor").length,
  kickerCount: document.querySelectorAll("#lesson-kicker").length,
}));
check("篇名下不再重複文體", chenqing.metaRemoved, String(chenqing.metaRemoved));
check("篇首改為冊別與篇次路徑", chenqing.mastheadPath.includes("選必下") && /第\s*\d+\s*篇/.test(chenqing.mastheadPath), chenqing.mastheadPath);
check("陳情表起始仍說明文體", chenqing.bookText.includes("表"), chenqing.bookText);
check("李密跳群賢新頁", chenqing.authorHref === "https://qx.bdfz.net/#limi", chenqing.authorHref);
check("來源書目文選", chenqing.bookText.includes("文选"), chenqing.bookText);
check("頁首引入李密肖像", chenqing.portraits > 0, String(chenqing.portraits));
check("無可靠李密肖像明示為姓名卡", chenqing.portraitNameCard.includes("無可靠肖像姓名卡"), chenqing.portraitNameCard);
check("作者肖像為正圓", chenqing.portraitShape?.radius === "50%" && Math.abs(chenqing.portraitShape.width - chenqing.portraitShape.height) < 1, JSON.stringify(chenqing.portraitShape));
check("篇名保持單行", chenqing.titleLayout?.whiteSpace === "nowrap" && chenqing.titleLayout.scrollWidth <= chenqing.titleLayout.width + 1 && chenqing.titleLayout.height <= chenqing.titleLayout.lineHeight * 1.1, JSON.stringify(chenqing.titleLayout));
check("古文註釋全部改為隨文數字按鈕", chenqing.annotationRefs > 20 && chenqing.annotationItems === 0, JSON.stringify({ refs: chenqing.annotationRefs, items: chenqing.annotationItems }));
check("註釋無 color 或原始複用編碼殘片", chenqing.annotationResidue === false, String(chenqing.annotationResidue));
check("頁末註釋移除", chenqing.footnoteLists === 0, String(chenqing.footnoteLists));
check("註釋不跳論壇", chenqing.forumFragmentLinks === 0, String(chenqing.forumFragmentLinks));
check("正文不重複篇名", chenqing.repeatedHeadings === 0, String(chenqing.repeatedHeadings));
check("篇首合併起始、肖像與本機完成度", chenqing.kickerCount === 0 && chenqing.orientationParent === "lesson-masthead" && chenqing.railParent === "lesson-masthead" && chenqing.mobileMasteryAnchors === 0, JSON.stringify(chenqing));
check("見效以瓦當紋甲乙丙丁編目", chenqing.stageMarks.join("") === "甲乙丙丁戊己庚" && chenqing.stageSvgCount === 7, JSON.stringify({ marks: chenqing.stageMarks, svg: chenqing.stageSvgCount }));
check("註釋數字取消圓圈", chenqing.noteStyle?.border === "none" && chenqing.noteStyle?.radius === "0px", JSON.stringify(chenqing.noteStyle));
check("叩問作者移至見效最後", chenqing.checkLabels.at(-1) === "叩問作者" && chenqing.checkLabels.slice(0, 5).join("/") === "初讀評議/詞級疏通/通讀正文/字句之改/章法機關", chenqing.checkLabels.join(" / "));
check("學習效果確認改名見效", await page.locator("#check-title", { hasText: "見效" }).count() === 1 && await page.getByText("學習效果確認", { exact: true }).count() === 0);
check("正文三段標題精簡", (await page.locator("#orientation-title").innerText()) === "起始" && (await page.locator("#textbook-title").innerText()) === "細讀" && (await page.locator("#materials-title").innerText()) === "延伸");
check("閱讀起點鏈接新頁打開", await page.locator("#orientation-content a:not([target='_blank'])").count() === 0);
check("文體書目星圖己身登入均在新頁", await page.locator("#topbar-actions a[href]:not([target='_blank'])").count() === 0 && await page.locator("#topbar-actions a[data-same-tab]").count() === 0);
check(
  "其餘鏈接均新頁打開",
  await page.locator("a[href]:not([target='_blank']):not([data-same-tab]):not([href^='#'])").count() === 0,
);

const firstNote = page.locator("#text-flow .reader-note-ref").first();
const noteTarget = await firstNote.getAttribute("aria-controls");
const pageBeforeNote = page.url();
await firstNote.click();
check("數字上標展開隨文註釋", Boolean(noteTarget) && await page.locator(`#${noteTarget}:not([hidden])`).count() === 1 && page.url() === pageBeforeNote, `${page.url()} ${noteTarget}`);
await firstNote.click();
check("數字上標再次點擊收起註釋", await page.locator(`#${noteTarget}[hidden]`).count() === 1 && await firstNote.getAttribute("aria-expanded") === "false");
check("註釋定位不切換課文", (await page.locator("#lesson-title").innerText()).includes("陈情表"));

check("非專注模式不顯示正文縮放", await page.locator("#font-up").isHidden() && await page.locator("#font-down").isHidden() && await page.locator("#font-label").isHidden());
await page.locator("#focus-button").click();
check("專注模式顯示正文縮放", await page.locator("#font-up").isVisible() && await page.locator("#font-down").isVisible());
check("專注 A+ 排版正常", await page.locator("#font-up").textContent() === "A+" && await page.locator("#font-up").evaluate((node) => node.scrollWidth <= node.clientWidth));
check("專注模式顯示閱讀彩條", await page.locator(".read-progress").evaluate((node) => parseFloat(getComputedStyle(node).height) >= 5));
const fontBefore = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--reader-scale"));
await page.locator("#font-up").click();
const fontAfter = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--reader-scale"));
check("正文可放大", fontBefore !== fontAfter, `${fontBefore} -> ${fontAfter}`);
await page.locator("#focus-button").click();
check("專注功能位於課文細讀", await page.locator(".reader-size #focus-button").count() === 1);

check("初讀評議使用三個獨立詞格", await page.locator('[data-context-word]').count() === 3 && await page.locator('[data-ai-check="contextWords"]').count() === 0);
const masteryBefore = Number(await page.locator("#mastery-value").textContent());
let contextAuthors = [];
await page.route("**/api/interaction-check", async (route) => {
  const body = route.request().postDataJSON?.() || {};
  if (body.interaction !== "contextWords") return route.continue();
  contextAuthors = body.authors || [];
  await route.fulfill({ contentType: "application/json", body: JSON.stringify({ provider: "apis", assessment: { verdict: "貼近", score: 88, strength: "三詞各有區分。", gap: "尚可落到字句。", nextQuestion: "哪一詞最能由原文證明？" } }) });
});
for (const [index, word] of ["克制", "至情", "機敏"].entries()) await page.locator('[data-context-word]').nth(index).fill(word);
await page.waitForFunction(() => JSON.parse(localStorage.getItem("yw-matrix-progress-v2") || "{}")?.["lesson-1576"]?.context?.score === 88);
check("三詞輸入後自動核對", await page.locator('[data-round="context"] .interaction-result').count() === 1);
check("AI 對話使用當前作者身分", contextAuthors.join("、") === "李密" && await page.locator('[data-round="context"] .author-dialog[data-author-dialog="李密"]').count() === 1, contextAuthors.join("、"));
const masteryAfterContext = Number(await page.locator("#mastery-value").textContent());
check("AI 對話後掌握度同步", masteryAfterContext > masteryBefore, `${masteryBefore} -> ${masteryAfterContext}`);

const chenqingHasBank = fs.existsSync(new URL("../site/data/vocab/lesson-1576.json", import.meta.url));
if (chenqingHasBank) {
  await page.waitForFunction(() => document.querySelectorAll('[data-round="vocabulary"] [data-quiz-option]').length === 4, null, { timeout: 20000 });
  const quizShape = await page.evaluate(() => ({
    options: document.querySelectorAll('[data-round="vocabulary"] [data-quiz-option]').length,
    progressBars: document.querySelectorAll('[data-round="vocabulary"] .vocabulary-progress').length,
    sentence: !!document.querySelector('[data-round="vocabulary"] .quiz-sentence'),
    lookup: document.querySelector('[data-round="vocabulary"] .quiz-lookup')?.dataset.quizLookup || "",
  }));
  check("詞級疏通逐題過關並有彩條", quizShape.options === 4 && quizShape.progressBars === 1 && quizShape.sentence, JSON.stringify(quizShape));
  await page.locator('[data-round="vocabulary"] .quiz-lookup').click();
  await page.waitForFunction(() => document.querySelector("#lexicon-dock")?.classList.contains("open"));
  check("查看單詞必定打開綜合辭典", (await page.locator("#selection-word").textContent()) === quizShape.lookup && (await page.locator("#lexicon-frame").getAttribute("src"))?.startsWith("https://sun.bdfz.net/dict.html?q="));
  check("辭典移除縮放功能", await page.locator("#lexicon-zoom-in,#lexicon-zoom-out,#lexicon-scale").count() === 0);
  await page.waitForTimeout(360);
  await page.locator("#lexicon-close").click();
  check("文言詞級不設新詞創作", await page.locator('[data-round="wordCreation"]').count() === 0 && await page.locator('[data-round="vocabulary"] .word-creation-prompt').count() === 0);
} else {
  const vocabularyState = await page.evaluate(() => ({
    visibleWords: document.querySelectorAll('[data-round="vocabulary"] [data-vocabulary]').length,
    progressBars: document.querySelectorAll('[data-round="vocabulary"] .vocabulary-progress').length,
    text: document.querySelector('[data-round="vocabulary"]')?.innerText || "",
  }));
  const vocabularyWord = await page.locator('[data-round="vocabulary"] [data-vocabulary]').getAttribute("data-vocabulary");
  check("詞級疏通逐一載入並有彩條", vocabularyState.visibleWords === 1 && vocabularyState.progressBars === 1 && /^[\p{Script=Han}A-Za-z·]{1,4}$/u.test(vocabularyWord || ""), JSON.stringify({ ...vocabularyState, vocabularyWord }));
  await page.locator('[data-round="vocabulary"] [data-vocabulary]').click();
  await page.waitForFunction(() => document.querySelector("#lexicon-dock")?.classList.contains("open"));
  check("查看單詞必定打開綜合辭典", (await page.locator("#selection-word").textContent()) === vocabularyWord && (await page.locator("#lexicon-frame").getAttribute("src"))?.startsWith("https://sun.bdfz.net/dict.html?q="));
  check("辭典移除縮放功能", await page.locator("#lexicon-zoom-in,#lexicon-zoom-out,#lexicon-scale").count() === 0);
  await page.waitForTimeout(360);
  await page.locator("#lexicon-close").click();

  let vocabularyGuard = 0;
  while (await page.locator('[data-round="vocabulary"] [data-vocabulary]').count()) {
    await page.locator('[data-round="vocabulary"] [data-vocabulary]').click({ force: true });
    if (await page.locator("#lexicon-close").isVisible()) await page.locator("#lexicon-close").click({ force: true });
    vocabularyGuard += 1;
    if (vocabularyGuard > 120) throw new Error("vocabulary loop exceeded guard");
  }
  check("文言詞級完成後不設新詞創作", await page.locator('[data-round="wordCreation"]').count() === 0 && await page.locator('[data-round="vocabulary"] .word-creation-prompt').count() === 0);
}

const readCheck = page.locator("[data-read-check]");
const masteryBeforeRead = Number(await page.locator("#mastery-value").textContent());
await readCheck.check();
check("通讀正文不再生成對話與回應", await page.locator('[data-round="read"] .author-dialog,[data-round="read"] .interaction-result,[data-field="read.feedback"]').count() === 0);
check("通讀勾選即更新掌握度", Number(await page.locator("#mastery-value").textContent()) > masteryBeforeRead);
check("本課掌握度目錄默認收起", await page.locator("#learning-rail").evaluate((node) => node.classList.contains("collapsed")) && await page.locator("#mastery-toggle").getAttribute("aria-expanded") === "false");
await page.locator("#mastery-toggle").click();
check("本課掌握度目錄可展開", !await page.locator("#learning-rail").evaluate((node) => node.classList.contains("collapsed")) && await page.locator("#mastery-toggle").getAttribute("aria-expanded") === "true");
await page.locator("#mastery-toggle").click();
check("本課掌握度目錄可縮回", await page.locator("#learning-rail").evaluate((node) => node.classList.contains("collapsed")) && await page.locator("#mastery-toggle").getAttribute("aria-expanded") === "false");
check("掌握度目錄與見效節點同序", await page.locator("#checkpoint-list li").count() === chenqing.checkLabels.length);
check("掌握度移除用戶中心與卡住說明", await page.locator("#progress-login,#progress-status,#coach-open,#coach-dialog").count() === 0);
const authorQuestion = await page.evaluate(() => ({ placeholder: document.querySelector('[data-field="authorQuestion.answer"]')?.getAttribute("placeholder"), prefaced: document.querySelectorAll(".defense-question").length }));
check("叩問作者提示精確", authorQuestion.prefaced === 0 && authorQuestion.placeholder === "你最想我的問題是什麼，你問，我答。", JSON.stringify(authorQuestion));
const structureState = await page.evaluate(() => ({ text: document.querySelector(".structure-focus")?.textContent.trim() || "", options: document.querySelectorAll(".structure-options,input[name='structure-option']").length, placeholder: document.querySelector('[data-field="structure.reason"]')?.getAttribute("placeholder") }));
check("章法機關直接由作者發問", structureState.text.startsWith("我") && structureState.options === 0 && !structureState.placeholder, JSON.stringify(structureState));
check("字句之改要求說明緣由", await page.locator('[data-field="revision.reason"]').getAttribute("placeholder") === "請說明如何修改的緣由");
check("所有核對動作在作者對話框右下", await page.locator(".check-action").count() === await page.locator(".author-dialog .dialog-action-row .check-action").count());
check("篇目評價沒有對話框與 AI 回應", await page.locator('[data-round="evaluation"] .author-dialog,[data-round="evaluation"] .interaction-result').count() === 0);
check("篇目評價只保留 1 至 5", await page.locator('[data-round="evaluation"] [data-rating]').count() === 5 && await page.locator('[data-round="evaluation"] textarea,[data-round="evaluation"] .auto-save-status,[data-round="evaluation"] [data-rating] span').count() === 0 && (await page.locator('[data-round="evaluation"] [data-rating] strong').allTextContents()).join("") === "12345");
const forbiddenCopy = ["先讀，不做題", "讓 AI 核對三詞是否貼近本文", "作者開口", "體悟起承轉合或情感變奏", "說明詩對你的價值", "用新詞寫三句短詩"];
const visibleText = await page.locator("body").innerText();
check("冗餘提示全部移除", forbiddenCopy.every((text) => !visibleText.includes(text)) && await page.locator(".round-detail").count() === 0, forbiddenCopy.filter((text) => visibleText.includes(text)).join(" / "));

const rating = page.locator('[data-rating="4"]');
await rating.click();
await page.waitForTimeout(80);
const savedRating = await page.evaluate(() => JSON.parse(localStorage.getItem("yw-matrix-progress-v2") || "{}")["lesson-1576"]?.evaluation?.rating);
check("篇目評價點擊即自動保存", savedRating === 4 && await page.getByText("保存篇目評價", { exact: false }).count() === 0, String(savedRating));
check("能力遷移自然接入時聊", await page.locator('.matrix-route a[href="https://chat.bdfz.net/"]').count() === 1);
check("每篇課文嵌入實時聊天", await page.locator('#lesson-chat-frame[src="https://chat.bdfz.net/#lobby"]').count() === 1 && (await page.locator("#lesson-chat-title").innerText()).includes("陈情表"));
check("閱讀起點不再重複文體與學習路線", await page.locator(".reading-contract").count() === 0);
check("右上角個人圖入口命名為己身", await page.locator('.topbar-actions a[href="insights.html"]', { hasText: "己身" }).count() === 1);

await page.locator("#text-flow .primary-text").evaluate((node) => {
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  let text = walker.nextNode();
  while (text && !text.textContent?.trim()) text = walker.nextNode();
  if (!text?.textContent) throw new Error("paragraph has no selectable text");
  const range = document.createRange();
  const start = Math.max(0, text.textContent.search(/\S/));
  range.setStart(text, start);
  range.setEnd(text, Math.min(start + 2, text.textContent.length));
  const selection = getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  node.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
});
await page.waitForFunction(() => document.querySelector("#lexicon-dock")?.classList.contains("open"));
const lexicon = await page.evaluate(() => ({
  src: document.querySelector("#lexicon-frame")?.src || "",
  moe: document.querySelector("#moe-external")?.href || "",
  word: document.querySelector("#selection-word")?.textContent || "",
}));
check("選詞打開綜合辭典", lexicon.src.startsWith("https://sun.bdfz.net/dict.html?q="), lexicon.src);
check("選詞提供教育部原頁", lexicon.moe.startsWith("https://dict.revised.moe.edu.tw/search.jsp"), lexicon.moe);
await page.locator("#lexicon-close").click();
check("查詞頁可關閉", await page.locator("#lexicon-dock.open").count() === 0);

const material = page.locator(".material-row", { hasText: "038.pdf" });
check("陳情表 PDF 投影入口存在", await material.count() > 0);
if (await material.count()) {
  await material.first().click();
  const resource = await page.evaluate(() => ({
    open: document.querySelector("#resource-dialog")?.open,
    src: document.querySelector("#resource-frame")?.src || "",
    sandbox: document.querySelector("#resource-frame")?.getAttribute("sandbox"),
  }));
  check("PDF 投影對話框打開", resource.open === true);
  check("PDF 使用預覽代理", resource.src.includes("/api/preview?url="), resource.src);
  check("PDF 不受 iframe sandbox 阻斷", resource.sandbox === null, String(resource.sandbox));
  await page.locator("#resource-dialog form button").click();
}
await page.screenshot({ path: "output/playwright/yw-audit/chenqingbiao-desktop.png", fullPage: true });

await page.goto(`${base}/#lesson-1577`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => localStorage.getItem("yw-matrix-last-lesson-v1") === "lesson-1577");
await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.querySelector("#lesson-title")?.textContent.includes("项脊轩志"));
check("返回首頁保留上次篇目", await page.evaluate(() => location.hash === "#lesson-1577"));

const modernPoetrySplits = [
  ["lesson-1692-p1", "立在地球边上放号", "郭沫若"],
  ["lesson-1692-p2", "红烛", "闻一多"],
  ["lesson-1692-p3", "峨日朵雪峰之侧", "昌耀"],
  ["lesson-1692-p4", "致云雀", "雪莱"],
];
for (const [id, title, author] of modernPoetrySplits) {
  await page.goto(`${base}/#${id}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction((expected) => document.querySelector("#lesson-title")?.textContent.includes(expected), title);
  const splitState = await page.evaluate(() => ({
    title: document.querySelector("#lesson-title")?.textContent || "",
    text: document.querySelector("#text-flow")?.textContent || "",
    portraits: [...document.querySelectorAll("#lesson-portraits .portrait-choice")].map((node) => node.getAttribute("aria-label")),
    finalStage: document.querySelector("#check-stage .check-round:last-child h3")?.textContent || "",
    finalAuthor: document.querySelector("#check-stage .check-round:last-child .author-dialog-head strong")?.textContent || "",
  }));
  const otherTitles = modernPoetrySplits.filter((item) => item[0] !== id).map((item) => item[1]);
  const portraitKind = taxonomy.lessons.find((lesson) => lesson.id === id)?.authors[0]?.portraitKind;
  const expectedPortraitLabel = portraitKind === "documented-no-reliable-portrait" ? `${author}無可靠肖像姓名卡` : `切換至${author}`;
  check(`${title} 已成獨立篇目`, splitState.title === title && splitState.portraits.length === 1 && splitState.portraits[0] === expectedPortraitLabel && otherTitles.every((other) => !splitState.text.includes(other)), JSON.stringify(splitState));
  check(`${title} 以叩問作者收束`, splitState.finalStage === "叩問作者" && splitState.finalAuthor === author, JSON.stringify({ stage: splitState.finalStage, author: splitState.finalAuthor }));
}
await page.screenshot({ path: "output/playwright/yw-audit/split-lesson-desktop.png", fullPage: false });

await page.goto(`${base}/#lesson-1498`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.querySelector("#lesson-title")?.textContent.includes("春江花月夜"));
const springRiverAuthors = await page.locator(".orientation-line").innerText();
check("春江花月夜前端不混入資料作者", springRiverAuthors.includes("张若虚") && !springRiverAuthors.includes("贺知章") && !springRiverAuthors.includes("闻一多"), springRiverAuthors);
check("詩歌不再另列新詞入詩階段", await page.locator('[data-round="wordCreation"]').count() === 0);

await page.goto(`${base}/#lesson-1484`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.querySelector("#lesson-title")?.textContent.includes("五石之瓠"));
const fiveStoneHasBank = fs.existsSync(new URL("../site/data/vocab/lesson-1484.json", import.meta.url));
if (fiveStoneHasBank) {
  await page.waitForFunction(() => document.querySelectorAll('[data-round="vocabulary"] [data-quiz-option]').length === 4 || document.querySelector('[data-round="vocabulary"] .vocabulary-complete'), null, { timeout: 20000 });
  const fiveStoneQuiz = await page.evaluate(() => {
    const bankCount = Number((document.querySelector('[data-round="vocabulary"] .vocabulary-progress b')?.textContent || "0 / 0").split("/")[1]);
    return {
      annotationRefs: document.querySelectorAll("#text-flow .reader-note-ref").length,
      annotationItems: document.querySelectorAll("#text-flow .reader-annotations li").length,
      bankCount,
      wordCreation: document.querySelectorAll('[data-round="vocabulary"] .word-creation-prompt').length,
    };
  });
  check("五石之瓠十五條 canonical 註釋與題庫並存", fiveStoneQuiz.annotationRefs === 15 && fiveStoneQuiz.annotationItems === 15 && fiveStoneQuiz.bankCount >= 8, JSON.stringify(fiveStoneQuiz));
  check("五石之瓠文言詞級不設創作", fiveStoneQuiz.wordCreation === 0, String(fiveStoneQuiz.wordCreation));
} else {
  const fiveStoneVocabulary = await page.evaluate(() => ({
    annotationRefs: document.querySelectorAll("#text-flow .reader-note-ref").length,
    annotationItems: document.querySelectorAll("#text-flow .reader-annotations li").length,
    progress: document.querySelector('[data-round="vocabulary"] .vocabulary-progress')?.getAttribute("aria-label") || "",
    empty: document.querySelector('[data-round="vocabulary"] .vocabulary-empty')?.textContent || "",
    wordCreation: document.querySelectorAll('[data-round="vocabulary"] .word-creation-prompt').length,
    firstWord: document.querySelector('[data-round="vocabulary"] [data-vocabulary]')?.getAttribute("data-vocabulary") || "",
  }));
  check("五石之瓠十五條 canonical 註釋全部進入疏通", fiveStoneVocabulary.annotationRefs === 15 && fiveStoneVocabulary.annotationItems === 15 && /0 \/ 15/.test(fiveStoneVocabulary.progress) && !fiveStoneVocabulary.empty && Boolean(fiveStoneVocabulary.firstWord), JSON.stringify(fiveStoneVocabulary));
  check("五石之瓠文言詞級不設創作", fiveStoneVocabulary.wordCreation === 0, String(fiveStoneVocabulary.wordCreation));
}

const modeExpectations = {
  poetry: "詩脈轉折",
  fiction: "敘事機關",
  drama: "場面調度",
  journalism: "材料編排",
  argument: "論證骨架",
  science: "說明次序",
  "unit-intro": "繪製路徑",
  "unit-task": "成果路徑",
};
for (const [mode, expected] of Object.entries(modeExpectations)) {
  const lesson = taxonomy.lessons.find((item) => item.mode === mode);
  if (!lesson) { check(`${mode} 有代表篇目`, false); continue; }
  await page.goto(`${base}/#${lesson.id}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction((id) => localStorage.getItem("yw-matrix-last-lesson-v1") === id, lesson.id);
  const labels = await page.locator("#check-stage h3").allTextContents();
  check(`${mode} 使用專屬確認模式`, labels.includes(expected), labels.join(" / "));
  if (!mode.startsWith("unit")) check(`${mode} 保留共同細讀骨架並以叩問收束`, labels.slice(0, 4).join("/") === "初讀評議/詞級疏通/通讀正文/字句之改" && labels.at(-1) === "叩問作者", labels.join(" / "));
  else check(`${mode} 以提問收束`, labels.at(-1) === (mode === "unit-intro" ? "提出總問題" : "提出問題"), labels.join(" / "));
}

const sweepContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
await sweepContext.route("**/api/lesson-blueprint", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ provider: "qa", blueprint: { structureFocus: "我把全文最關鍵的轉折放在這裡；你看見了嗎？" } }) }));
await sweepContext.route("https://my.bdfz.net/site-auth.js", (route) => route.fulfill({ contentType: "application/javascript", body: "window.BdfzIdentity={getSession:async()=>({authenticated:false})};" }));
await sweepContext.route("https://nav.bdfz.net/bdfz-nav.js", (route) => route.fulfill({ contentType: "application/javascript", body: "" }));
const sweepPage = await sweepContext.newPage();
const sweepErrors = [];
sweepPage.on("pageerror", (error) => sweepErrors.push(error.message));
const overflowLessons = [];
const portraitLessons = [];
const representativeLessonsNotVisible = [];
const vocabularyMismatchLessons = [];
const classicalCreationLessons = [];
for (const [index, lesson] of taxonomy.lessons.entries()) {
  if (index === 0) await sweepPage.goto(`${base}/#${lesson.id}`, { waitUntil: "domcontentloaded" });
  else await sweepPage.evaluate((id) => { location.hash = id; }, lesson.id);
  await sweepPage.waitForFunction((id) => localStorage.getItem("yw-matrix-last-lesson-v1") === id, lesson.id);
  await sweepPage.waitForTimeout(16);
  // 字詞題庫異步載入：等 app 內部 bank 狀態落定（set 與重渲染同步發生）再量測
  await sweepPage.waitForFunction((id) => {
    try {
      if (!document.querySelector('[data-round="vocabulary"]')) return true;
      return state.vocabBanks.has(id);
    } catch { return true; }
  }, lesson.id, { timeout: 15000 }).catch(() => {});
  const state = await sweepPage.evaluate((expectedAuthors) => {
    const portraits = [...document.querySelectorAll("#lesson-portraits .portrait-choice")];
    const representativeVisual = document.querySelector("#lesson-portraits .representative-choice img");
    const text = document.querySelector("#text-flow");
    return {
      overflow: document.documentElement.scrollWidth > innerWidth + 1 || Boolean(text && text.scrollWidth > text.clientWidth + 1),
      portraitCount: portraits.length,
      portraitsVisible: portraits.every((node) => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 40 && rect.height > 40 && rect.right > 0 && rect.left < innerWidth && rect.bottom > 0;
      }),
      representativeVisual: (() => {
        if (!representativeVisual) return false;
        const rect = representativeVisual.getBoundingClientRect();
        const style = getComputedStyle(representativeVisual);
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 40 && rect.height > 40 && rect.right > 0 && rect.left < innerWidth;
      })(),
      annotationRefs: document.querySelectorAll("#text-flow .reader-note-ref").length,
      vocabularyRound: Boolean(document.querySelector('[data-round="vocabulary"]')),
      vocabularyTotal: Number((document.querySelector('[data-round="vocabulary"] .vocabulary-progress')?.getAttribute("aria-label") || "").match(/\/\s*(\d+)/)?.[1] || 0),
      vocabularyEmpty: Boolean(document.querySelector('[data-round="vocabulary"] .vocabulary-empty')),
      wordCreation: document.querySelectorAll('[data-round="vocabulary"] .word-creation-prompt').length,
      expectedAuthors,
    };
  }, lesson.authors.length);
  if (state.overflow) overflowLessons.push(lesson.id);
  const expectedPortraitCount = lesson.authors.length || (lesson.representativeFigure ? 1 : 0);
  if (state.portraitCount !== expectedPortraitCount || !state.portraitsVisible) portraitLessons.push(`${lesson.id}:${state.portraitCount}/${expectedPortraitCount}`);
  if (!lesson.authors.length && !state.representativeVisual) representativeLessonsNotVisible.push(lesson.id);
  const hasVocabularyRound = ["classical", "poetry"].includes(lesson.mode);
  if (hasVocabularyRound && state.annotationRefs > 0 && (state.vocabularyTotal === 0 || state.vocabularyEmpty)) vocabularyMismatchLessons.push(`${lesson.id}:${state.annotationRefs}/${state.vocabularyTotal}`);
  if (!hasVocabularyRound && state.vocabularyRound) vocabularyMismatchLessons.push(`${lesson.id}:out-of-scope`);
  if (lesson.mode === "classical" && state.wordCreation > 0) classicalCreationLessons.push(lesson.id);
}
check("全 189 篇移動端無鏈接或正文溢出", overflowLessons.length === 0, overflowLessons.join(" / "));
check("全部作者與代表人物肖像完整可見", portraitLessons.length === 0, portraitLessons.join(" / "));
check("全部無作者篇目代表人物完整可見", representativeLessonsNotVisible.length === 0, representativeLessonsNotVisible.join(" / "));
check("所有含詞級疏通的篇目均接入正文註釋", vocabularyMismatchLessons.length === 0, vocabularyMismatchLessons.join(" / "));
check("全部文言篇目不設新詞創作", classicalCreationLessons.length === 0, classicalCreationLessons.join(" / "));
check("全篇巡檢無前端錯誤", sweepErrors.length === 0, sweepErrors.join(" | "));
await sweepContext.close();

for (const atlas of ["genres.html#biao", "books.html?q=文选"]) {
  await page.goto(`${base}/${atlas}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#atlas-canvas");
  await page.waitForTimeout(3400);
  const state = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > innerWidth + 1,
    detailVisible: !document.querySelector("#atlas-detail")?.hidden,
    detailTitle: document.querySelector("#detail-title")?.textContent || "",
    canvasReady: document.querySelector("#atlas-canvas")?.width > 1000,
    threeDimensionalHint: document.querySelector(".atlas-hint")?.textContent.includes("旋轉"),
  }));
  check(`${atlas} 無桌面橫向溢出`, !state.overflow);
  check(`${atlas} 可由 URL 定位節點`, state.detailVisible, state.detailTitle);
  check(`${atlas} 啟用 3D 星圖畫布`, state.canvasReady && state.threeDimensionalHint, JSON.stringify(state));
  check(`${atlas} 三圖互鏈留在當前頁`, await page.locator(".atlas-topbar nav a[data-same-tab]:not([target])").count() === 3);
  check(`${atlas} 其餘鏈接新頁打開`, await page.locator("a[href]:not([target='_blank']):not([data-same-tab])").count() === 0);
  check(`${atlas} 詳情呈現時代與關係`, (await page.locator("#detail-kicker").innerText()).length > 2 && await page.locator("#detail-description p").count() === 1);
  await page.screenshot({ path: `output/playwright/yw-audit/${atlas.startsWith("genres") ? "genres-galaxy" : "books-galaxy"}.png`, fullPage: true });
}

await page.setViewportSize({ width: 390, height: 844 });
for (const atlas of ["genres.html", "books.html"]) {
  await page.goto(`${base}/${atlas}`, { waitUntil: "domcontentloaded" });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  check(`${atlas} 移動端無橫向溢出`, !overflow);
}
await page.goto(`${base}/#lesson-1576`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.querySelector("#lesson-title")?.textContent.includes("陈情表"));
await page.locator("#atlas-open").click();
await page.waitForFunction(() => Math.abs(document.querySelector("#atlas")?.getBoundingClientRect().x || 0) < 1);
const atlasBox = await page.locator("#lesson-index").boundingBox();
const atlasBefore = await page.locator("#lesson-index").evaluate((node) => ({ scrollTop: node.scrollTop, max: node.scrollHeight - node.clientHeight, touchAction: getComputedStyle(node).touchAction }));
if (atlasBox) {
  await page.mouse.move(atlasBox.x + atlasBox.width / 2, atlasBox.y + atlasBox.height / 2);
  await page.mouse.wheel(0, 5000);
  await page.waitForTimeout(180);
}
const atlasAfter = await page.locator("#lesson-index").evaluate((node) => ({ scrollTop: node.scrollTop, max: node.scrollHeight - node.clientHeight }));
check("移動端目錄可用真實手勢下拉至末篇", atlasBefore.max > 0 && atlasAfter.scrollTop >= atlasAfter.max - 2 && atlasBefore.touchAction === "pan-y", JSON.stringify({ atlasBox, atlasBefore, atlasAfter }));
await page.locator("#atlas-close").click();
check("移動端起始與掌握度均留在篇首", await page.locator("#lesson-masthead > #orientation").count() === 1 && await page.locator("#lesson-masthead > #learning-rail").count() === 1 && await page.locator("#mobile-mastery-anchor").count() === 0);
check("移動端篇首工具收為單一入口", await page.locator("#mobile-tools-toggle").isVisible() && await page.locator("#topbar-actions").evaluate((node) => getComputedStyle(node).pointerEvents === "none"));
await page.locator("#mobile-tools-toggle").click();
check("移動端工具展開完整標籤", await page.locator("#topbar-actions").evaluate((node) => getComputedStyle(node).pointerEvents === "auto") && (await page.locator("#topbar-actions").innerText()).includes("文體") && (await page.locator("#topbar-actions").innerText()).includes("原圖"));
await page.locator("#mobile-tools-toggle").click();
const mobileTitle = await page.evaluate(() => { const node = document.querySelector("#lesson-title"); const style = getComputedStyle(node); return { width: node.clientWidth, scrollWidth: node.scrollWidth, height: node.getBoundingClientRect().height, lineHeight: parseFloat(style.lineHeight) }; });
check("移動端篇名保持單行", mobileTitle.scrollWidth <= mobileTitle.width + 1 && mobileTitle.height <= mobileTitle.lineHeight * 1.1, JSON.stringify(mobileTitle));
const transferLayout = await page.evaluate(() => {
  const section = document.querySelector("#transfer-matrix");
  const links = [...document.querySelectorAll("#matrix-links .matrix-route > a")];
  const sectionRect = section.getBoundingClientRect();
  return {
    title: document.querySelector("#transfer-title")?.textContent?.trim(),
    overflow: links.some((link) => link.scrollWidth > link.clientWidth + 1),
    leftSqueeze: links.some((link) => link.getBoundingClientRect().left < sectionRect.left - 1 || link.querySelector("strong")?.clientWidth < 120),
  };
});
check("能力遷移改名高考且移動端不再左側擠壓", transferLayout.title === "高考" && !transferLayout.overflow && !transferLayout.leftSqueeze, JSON.stringify(transferLayout));
await page.screenshot({ path: "output/playwright/yw-audit/chenqingbiao-mobile.png", fullPage: true });

const identityContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
await identityContext.route("https://my.bdfz.net/site-auth.js", (route) => route.fulfill({
  contentType: "application/javascript",
  body: `window.BdfzIdentity={
    buildAuthUrl:(url)=>"https://my.bdfz.net/#/auth?returnTo="+encodeURIComponent(url),
    getSession:async()=>({authenticated:true,user:{displayName:"測試學生"}}),
    api:async()=>({items:[{itemKey:"lesson-1576",progressPercent:45,meta:{checkpoints:{context:true,read:true,evaluation:{rating:5,reason:"這篇讓語言與現實目的同時可見。",done:true},wordCreation:{word:"險釁",creation:"夜色壓低城牆。\\n他攜著險釁歸來。\\n晨鐘仍未響。",done:true}}}}]}),
    syncProgress:async()=>({ok:true}),recordEvent:async()=>({ok:true})
  };`,
}));
const identityPage = await identityContext.newPage();
await identityPage.goto(`${base}/#lesson-1576`, { waitUntil: "domcontentloaded" });
await identityPage.waitForFunction(() => JSON.parse(localStorage.getItem("yw-matrix-progress-v2") || "{}")?.["lesson-1576"]?.evaluation?.rating === 5);
const identityState = await identityPage.evaluate(() => ({
  progressUi: document.querySelectorAll("#progress-status,#progress-login").length,
  stored: JSON.parse(localStorage.getItem("yw-matrix-progress-v2") || "{}")?.["lesson-1576"] || {},
}));
check("User Center 登入後回灌進度", identityState.stored.context === true && identityState.stored.read === true, JSON.stringify(identityState));
check("課文不重複顯示用戶中心狀態", identityState.progressUi === 0, String(identityState.progressUi));
await identityPage.goto(`${base}/insights.html`, { waitUntil: "domcontentloaded" });
await identityPage.waitForFunction(() => document.querySelector("#sync-status")?.textContent.includes("已連接 User Center"));
const insightState = await identityPage.evaluate(() => ({
  values: document.querySelectorAll(".value-row").length,
  words: document.querySelectorAll("#word-chart button").length,
  mastery: document.querySelectorAll(".mastery-item").length,
  overflow: document.documentElement.scrollWidth > innerWidth + 1,
  canvasReady: document.querySelector("#insight-canvas")?.width > 300,
}));
check("我的閱讀圖呈現篇目評價與新詞", insightState.values > 0 && insightState.words > 0 && insightState.mastery > 0, JSON.stringify(insightState));
check("我的閱讀圖移動端無橫向溢出", !insightState.overflow);
check("我的閱讀圖啟用個人星圖畫布", insightState.canvasReady);
check("己身三圖互鏈留在當前頁", await identityPage.locator(".insight-nav nav a[data-same-tab]:not([target])").count() === 3);
check("己身其餘鏈接新頁打開", await identityPage.locator("a[href]:not([target='_blank']):not([data-same-tab])").count() === 0);
await identityPage.screenshot({ path: "output/playwright/yw-audit/insights-mobile.png", fullPage: true });
await identityContext.close();

const api = await page.request.post(`${base}/api/interaction-check`, {
  data: {
    lessonTitle: "陳情表",
    blockTitle: "選必下",
    mode: "classical",
    authors: ["李密"],
    interaction: "revision",
    excerpt: "臣密言：臣以險釁，夙遭閔凶。生孩六月，慈父見背。",
    input: { original: "險釁", action: "調", revised: "不幸", reason: "原詞更凝練且含艱難禍患，不幸會削弱奏表語體與命運壓力。" },
  },
  timeout: 30000,
});
const apiBody = await api.json().catch(() => ({}));
check("Gemini 細讀判定走 APIS", api.ok() && apiBody.provider === "apis" && Number(apiBody.assessment?.score) > 0, `${api.status()} ${JSON.stringify(apiBody).slice(0, 180)}`);

// ---------- 閱讀星圖與字詞題庫 ----------
const readingHealth = await page.request.get(`${base}/api/reading/health`, { timeout: 20000 });
const readingHealthBody = await readingHealth.json().catch(() => ({}));
check("閱讀星圖健康探針", readingHealth.ok() && readingHealthBody.ok === true && readingHealthBody.rulesVersion === "constellation-rules-v1", `${readingHealth.status()} ${JSON.stringify(readingHealthBody).slice(0, 120)}`);

const starContext = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const starPage = await starContext.newPage();
const starErrors = [];
starPage.on("pageerror", (error) => starErrors.push(error.message));
await starPage.goto(`${base}/star.html`, { waitUntil: "domcontentloaded" });
await starPage.waitForFunction(() => document.querySelector("#loading")?.classList.contains("done"), null, { timeout: 30000 });
const starState = await starPage.evaluate(() => ({
  canvasReady: document.querySelector("#gl")?.width > 300,
  chips: document.querySelectorAll("#chips .chip").length,
  statLessons: document.querySelector("#stat-lessons")?.textContent.trim(),
  emptyVisible: !document.querySelector("#empty-state")?.hidden,
  emptyAction: document.querySelector("#empty-action")?.getAttribute("href") || "",
  overflow: document.documentElement.scrollWidth > innerWidth + 1,
}));
check("星圖頁畫布與五冊籤就緒", starState.canvasReady && starState.chips === 5, JSON.stringify(starState));
check("星圖有數據或顯示克制空態", (Number(starState.statLessons) > 0 && !starState.emptyVisible) || (starState.emptyVisible && starState.emptyAction.length > 0), JSON.stringify(starState));
check("星圖頁無橫向溢出", !starState.overflow);
check("星圖頁無運行錯誤", starErrors.length === 0, starErrors.join(" | "));
await starPage.setViewportSize({ width: 390, height: 760 });
const starMobileOverflow = await starPage.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
check("星圖移動端無橫向溢出", !starMobileOverflow);
await starPage.screenshot({ path: "output/playwright/yw-audit/star-mobile.png", fullPage: true });
await starContext.close();
check("課文頂欄含星圖入口", await page.request.get(`${base}/`).then(async (r) => (await r.text()).includes('href="star.html"')));

const vocabIndexResponse = await page.request.get(`${base}/data/vocab/index.json`, { timeout: 15000 });
const vocabIndex = vocabIndexResponse.ok() ? await vocabIndexResponse.json().catch(() => ({ lessons: {} })) : { lessons: {} };
const vocabLessonIds = Object.keys(vocabIndex.lessons || {}).filter((lessonId) => Number(vocabIndex.lessons[lessonId]) > 0);
check("字詞題庫索引可達", vocabIndexResponse.ok(), String(vocabIndexResponse.status()));
if (vocabLessonIds.length) {
  const sampleId = vocabLessonIds[0];
  const sampleBank = await page.request.get(`${base}/data/vocab/${sampleId}.json`, { timeout: 15000 }).then((response) => response.json());
  const sampleQuestion = sampleBank.inventory.find((item) => item.decision === "question");
  const quizContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const quizPage = await quizContext.newPage();
  await quizPage.goto(`${base}/#${sampleId}`, { waitUntil: "domcontentloaded" });
  await quizPage.waitForFunction(() => document.querySelectorAll(".quiz-options button").length === 4, null, { timeout: 30000 });
  const beforeText = await quizPage.evaluate(() => document.querySelector("[data-quiz-item]")?.dataset.quizItem);
  const wrongPick = sampleQuestion.options.findIndex((_option, index) => index !== sampleQuestion.answerIndex);
  await quizPage.locator(`[data-quiz-option="${wrongPick}"]`).click();
  const retryState = await quizPage.evaluate((itemId) => {
    const stored = JSON.parse(localStorage.getItem("yw-matrix-progress-v2") || "{}");
    const lessonId = location.hash.slice(1);
    const answers = stored[lessonId]?.vocabularyQuiz?.answers || {};
    return {
      attempt: answers[itemId]?.attempts || 0,
      current: document.querySelector("[data-quiz-item]")?.dataset.quizItem,
      feedback: !!document.querySelector(".quiz-options .wrong"),
    };
  }, beforeText);
  check("字詞題錯答有反饋並停留重試", retryState.attempt === 1 && retryState.feedback && retryState.current === beforeText, JSON.stringify(retryState));
  await quizPage.locator(`[data-quiz-option="${sampleQuestion.answerIndex}"]`).click();
  await quizPage.waitForFunction((itemId) => {
    const current = document.querySelector("[data-quiz-item]")?.dataset.quizItem;
    return current !== itemId || document.querySelector(".vocabulary-complete");
  }, beforeText, { timeout: 3000 });
  const advanceState = await quizPage.evaluate((itemId) => {
    const stored = JSON.parse(localStorage.getItem("yw-matrix-progress-v2") || "{}");
    const lessonId = location.hash.slice(1);
    const answer = stored[lessonId]?.vocabularyQuiz?.answers?.[itemId] || {};
    return {
      attempt: answer.attempts || 0,
      correct: answer.correct === true,
      current: document.querySelector("[data-quiz-item]")?.dataset.quizItem || "complete",
      manualNext: !!document.querySelector("[data-quiz-next]"),
    };
  }, beforeText);
  check("字詞題答對後自動平滑推進且無手動下一題", advanceState.attempt === 2 && advanceState.correct && advanceState.current !== beforeText && !advanceState.manualNext, JSON.stringify(advanceState));
  await quizContext.close();
} else {
  check("字詞題庫尚未發佈時課文回退註詞流程", true);
}

check("瀏覽器無前端運行錯誤", pageErrors.length === 0, pageErrors.join(" | "));
await page.screenshot({ path: "output/playwright/yw-audit/taxonomy-matrix-mobile.png", fullPage: true });
await browser.close();

printResults();
if (failures.length) process.exitCode = 1;
