#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createReadStream, readFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = resolve(fileURLToPath(new URL("../", import.meta.url)));
const SITE_ROOT = resolve(ROOT, "site");
const BRAVE = "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";
const ORPHAN_GUARD = "/Users/ylsuen/CF/scripts/kill-orphan-playwright.sh";
const SESSION_NAME = "yw-embed-playback-20260811";
const QX_URL = "https://qx.bdfz.net/#luxun";
const WIKISOURCE_URL = "https://zh.wikisource.org/zh-hant/%E5%88%A5%E8%B3%A6";
const REMOVED_SCDFZ_URL = "https://www.scdfz.org.cn/ztzl/hjczzsc/zzhy/content_30068";
const PRESERVED_SCDFZ_URL = "https://www.scdfz.org.cn/scdqs/sxdq/lss/jwx/content_22151";
const YOUTUBE_ID = "XSopGMoaHkU";

const MIME_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".pdf", "application/pdf"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
  [".woff2", "font/woff2"],
]);

const checks = [];
const failures = [];

function check(name, condition, detail = {}) {
  const pass = Boolean(condition);
  checks.push({ name, pass, detail });
  if (!pass) failures.push(`${name}: ${JSON.stringify(detail)}`);
}

function startStaticServer() {
  const server = createServer(async (request, response) => {
    try {
      if (!["GET", "HEAD"].includes(request.method || "")) {
        response.writeHead(404).end();
        return;
      }
      const pathname = decodeURIComponent(new URL(request.url || "/", "http://127.0.0.1").pathname);
      const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
      const filePath = resolve(SITE_ROOT, relativePath);
      if (filePath !== SITE_ROOT && !filePath.startsWith(`${SITE_ROOT}${sep}`)) {
        response.writeHead(403).end();
        return;
      }
      const fileStat = await stat(filePath);
      if (!fileStat.isFile()) throw new Error("not a file");
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-length": fileStat.size,
        "content-type": MIME_TYPES.get(extname(filePath).toLowerCase()) || "application/octet-stream",
      });
      if (request.method === "HEAD") response.end();
      else createReadStream(filePath).pipe(response);
    } catch {
      response.writeHead(404).end();
    }
  });
  return new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolvePromise(server));
  });
}

function submittedState(lessonId) {
  const asset = JSON.parse(readFileSync(resolve(SITE_ROOT, `data/classical-first-read/${lessonId}.json`), "utf8"));
  return {
    schemaVersion: "yw-classical-first-read-state-v1",
    lessonId,
    submitted: true,
    unlocked: true,
    annotatedReadCompleted: true,
    submittedAt: "2026-08-11T12:00:00.000Z",
    summary: "瀏覽器驗收用已提交初讀。",
    elapsedMs: 420_000,
    marks: asset.paragraphs.slice(0, 3).map((paragraph, index) => ({
      markId: `qa-mark-${index + 1}`,
      paragraphKey: paragraph.key,
      startOffset: 0,
      endOffset: Math.min(2, paragraph.text.length),
      selectedText: paragraph.text.slice(0, 2),
      guess: `瀏覽器驗收標記 ${index + 1}`,
      resolutionStatus: "resolved",
    })),
  };
}

async function configureContext(context) {
  await context.route("https://my.bdfz.net/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/site-auth.js") {
      await route.fulfill({
        contentType: "text/javascript; charset=utf-8",
        body: "window.BdfzIdentity={getSession:async()=>({authenticated:true}),api:async()=>({}),mount:()=>{}};",
      });
      return;
    }
    await route.fulfill({ status: 404, contentType: "text/plain", body: "not used" });
  });
  await context.route("https://nav.bdfz.net/bdfz-nav.js", (route) => route.fulfill({
    contentType: "text/javascript; charset=utf-8",
    body: "",
  }));
  await context.route("**/api/reading/first-read/state/*", async (route) => {
    const lessonId = decodeURIComponent(new URL(route.request().url()).pathname.split("/").pop() || "");
    if (lessonId === "lesson-1576") {
      await route.fulfill({
        status: 200,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify(submittedState(lessonId)),
      });
      return;
    }
    await route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "login_required" }) });
  });
  await context.route("**/api/reading/first-read/reconcile", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true }),
  }));
  await context.route("**/api/learning/interactions", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true, accepted: true }),
  }));
  await context.route("https://www.youtube-nocookie.com/**", (route) => route.fulfill({
    status: 200,
    contentType: "text/html; charset=utf-8",
    body: "<!doctype html><meta charset=utf-8><title>YouTube fixture</title><main>video player ready</main>",
  }));
  await context.route("https://i.ytimg.com/**", (route) => route.fulfill({
    status: 200,
    contentType: "image/svg+xml",
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="100%" height="100%" fill="#222"/></svg>',
  }));
}

async function waitForLesson(page, baseUrl, lessonId) {
  await page.goto(`${baseUrl}/#${lessonId}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction((id) => (
    location.hash === `#${id}`
      && document.querySelector("#lesson-title")?.textContent.trim().length > 1
      && typeof window.resourcePreviewPlan === "function"
      && typeof window.mountResourcePreview === "function"
  ), lessonId, { timeout: 30_000 });
  await page.waitForTimeout(250);
}

async function mountFixture(page, { id, url, title }) {
  return page.evaluate(({ fixtureId, href, fixtureTitle }) => {
    document.getElementById(fixtureId)?.remove();
    const article = document.createElement("article");
    article.id = fixtureId;
    article.innerHTML = '<div class="material-preview-frame"></div><p data-preview-note></p>';
    document.body.append(article);
    const host = article.querySelector(".material-preview-frame");
    const plan = window.resourcePreviewPlan({ href });
    window.mountResourcePreview(host, plan, fixtureTitle);
    return {
      mode: plan.mode,
      src: plan.src || "",
      externalHref: plan.externalHref || "",
      screenshot: plan.screenshot === true,
      posterSrc: plan.posterSrc || "",
      reason: plan.reason || "",
    };
  }, { fixtureId: id, href: url, fixtureTitle: title });
}

async function inspectQxFrame(frameLocator) {
  await frameLocator.waitFor({ state: "visible", timeout: 30_000 });
  const handle = await frameLocator.elementHandle();
  const frame = await handle.contentFrame();
  await frame.waitForLoadState("domcontentloaded", { timeout: 30_000 }).catch(() => {});
  await frame.waitForFunction(() => {
    const text = document.body?.innerText || "";
    return document.title.includes("群贤")
      && text.includes("思想广场")
      && text.replace(/\s+/g, "").length > 150
      && !/url is not registered|preview upstream unavailable/i.test(text);
  }, null, { timeout: 45_000 });
  return {
    frameUrl: frame.url(),
    title: await frame.title(),
    bodyText: await frame.locator("body").innerText(),
    bodyBox: await frame.locator("body").boundingBox(),
    dossierText: await frame.locator("#dossier").innerText().catch(() => ""),
    dossierBox: await frame.locator("#dossier").boundingBox().catch(() => null),
  };
}

async function verifyNoHorizontalOverflow(page, width, height, baseUrl, lessonId) {
  await page.setViewportSize({ width, height });
  await waitForLesson(page, baseUrl, lessonId);
  const metrics = await page.evaluate(() => ({
    viewportWidth: innerWidth,
    documentClientWidth: document.documentElement.clientWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
  }));
  check(
    `${width}px 頁面無橫向溢出`,
    metrics.documentScrollWidth <= metrics.documentClientWidth + 1
      && metrics.bodyScrollWidth <= metrics.documentClientWidth + 1,
    metrics,
  );
}

const previewTargets = JSON.parse(readFileSync(resolve(SITE_ROOT, "data/preview-targets.json"), "utf8"));
const previewScreenshots = JSON.parse(readFileSync(resolve(SITE_ROOT, "data/preview-screenshots.json"), "utf8"));
const youtubeTargets = previewTargets.targets.filter((url) => {
  const hostname = new URL(url).hostname.toLowerCase();
  return hostname === "youtube.com" || hostname === "www.youtube.com" || hostname === "youtu.be";
});
const targetText = JSON.stringify(previewTargets);
const screenshotText = JSON.stringify(previewScreenshots);

check("registry 恰有五條 YouTube", youtubeTargets.length === 5, { youtubeTargets });
check("30068 已從 registry 與 screenshot manifest 清零", !targetText.includes("content_30068") && !screenshotText.includes("content_30068"), {
  registry: targetText.includes("content_30068"),
  manifest: screenshotText.includes("content_30068"),
});
check("22151 仍保留於 registry 與 screenshot manifest", targetText.includes(PRESERVED_SCDFZ_URL) && screenshotText.includes(PRESERVED_SCDFZ_URL), {
  registry: targetText.includes(PRESERVED_SCDFZ_URL),
  manifest: screenshotText.includes(PRESERVED_SCDFZ_URL),
});

let server;
let browser;
let orphanDryRun = "not-run";

try {
  server = await startStaticServer();
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ executablePath: BRAVE, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, reducedMotion: "reduce" });
  await configureContext(context);
  const page = await context.newPage();
  await waitForLesson(page, baseUrl, "lesson-1713");

  const qxPlan = await mountFixture(page, { id: "qa-qx", url: QX_URL, title: "魯迅 · 群賢" });
  await page.locator("#qa-qx").scrollIntoViewIfNeeded();
  const qxInlineLocator = page.locator(`#qa-qx iframe[src="${QX_URL}"]`);
  const qxInline = await inspectQxFrame(qxInlineLocator);
  check("qx #luxun 使用 exact direct remote-app plan", qxPlan.mode === "remote-app" && qxPlan.src === QX_URL && qxPlan.externalHref === QX_URL, qxPlan);
  check("qx inline 保留 hash 且顯示真實遠站正文", qxInline.frameUrl === QX_URL
    && qxInline.title.includes("群贤")
    && qxInline.bodyText.includes("思想广场")
    && qxInline.bodyText.replace(/\s+/g, "").length > 150
    && qxInline.bodyBox?.width > 100
    && qxInline.bodyBox?.height > 100
    && !/url is not registered|preview upstream unavailable/i.test(qxInline.bodyText), {
    frameUrl: qxInline.frameUrl,
    title: qxInline.title,
    bodyLength: qxInline.bodyText.length,
    dossierLength: qxInline.dossierText.length,
    bodyBox: qxInline.bodyBox,
    dossierBox: qxInline.dossierBox,
  });
  await page.locator("#qa-qx .preview-expand").click();
  await page.locator("#resource-dialog[open]").waitFor({ state: "visible" });
  const qxFullscreenLocator = page.locator(`#resource-dialog-stage iframe[src="${QX_URL}"]`);
  const qxFullscreen = await inspectQxFrame(qxFullscreenLocator);
  check("qx fullscreen 保留同一 hash 且非骨架", qxFullscreen.frameUrl === QX_URL
    && qxFullscreen.title.includes("群贤")
    && qxFullscreen.bodyText.includes("思想广场")
    && qxFullscreen.bodyText.replace(/\s+/g, "").length > 150
    && !/url is not registered|preview upstream unavailable/i.test(qxFullscreen.bodyText), {
    frameUrl: qxFullscreen.frameUrl,
    bodyLength: qxFullscreen.bodyText.length,
    dossierLength: qxFullscreen.dossierText.length,
  });
  await page.locator('#resource-dialog button[value="close"]').click();

  const wikisourcePlan = await mountFixture(page, { id: "qa-wikisource", url: WIKISOURCE_URL, title: "別賦" });
  const wikisourceInline = await page.locator("#qa-wikisource").evaluate((article) => {
    const image = article.querySelector("img");
    return {
      imageSrc: image?.getAttribute("src") || "",
      imageUrl: image?.src || "",
      imageLoaded: Boolean(image?.complete && image.naturalWidth > 0),
      iframeCount: article.querySelectorAll("iframe").length,
    };
  });
  check("維基文庫別賦為 reviewed screenshot-first", wikisourcePlan.mode === "image"
    && wikisourcePlan.screenshot
    && wikisourcePlan.src.startsWith("/assets/preview-screenshots/")
    && wikisourcePlan.reason.includes("正文截圖"), wikisourcePlan);
  check("維基文庫 inline 僅用本機圖且無 iframe", wikisourceInline.imageSrc.startsWith("/assets/preview-screenshots/")
    && wikisourceInline.imageUrl.startsWith(`${baseUrl}/assets/preview-screenshots/`)
    && wikisourceInline.imageLoaded
    && wikisourceInline.iframeCount === 0, wikisourceInline);
  await page.locator("#qa-wikisource .preview-expand").click();
  await page.locator("#resource-dialog[open]").waitFor({ state: "visible" });
  const wikisourceFullscreen = await page.locator("#resource-dialog-stage").evaluate((stage) => {
    const image = stage.querySelector("img");
    return {
      imageSrc: image?.getAttribute("src") || "",
      imageUrl: image?.src || "",
      imageLoaded: Boolean(image?.complete && image.naturalWidth > 0),
      iframeCount: stage.querySelectorAll("iframe").length,
    };
  });
  check("維基文庫 fullscreen 仍為同一本機圖且無 iframe", wikisourceFullscreen.imageSrc === wikisourceInline.imageSrc
    && wikisourceFullscreen.imageUrl.startsWith(`${baseUrl}/assets/preview-screenshots/`)
    && wikisourceFullscreen.imageLoaded
    && wikisourceFullscreen.iframeCount === 0, wikisourceFullscreen);
  await page.locator('#resource-dialog button[value="close"]').click();

  const youtubePlans = [];
  for (const [index, url] of youtubeTargets.entries()) {
    youtubePlans.push(await mountFixture(page, { id: `qa-youtube-${index}`, url, title: `YouTube ${index + 1}` }));
  }
  const initialYoutube = await page.evaluate((count) => Array.from({ length: count }, (_, index) => {
    const article = document.getElementById(`qa-youtube-${index}`);
    return {
      playButtons: article?.querySelectorAll(".youtube-preview-play").length || 0,
      iframeCount: article?.querySelectorAll("iframe").length || 0,
    };
  }), youtubeTargets.length);
  check("五條 YouTube 初始均為播放按鈕且未預載 iframe", youtubePlans.every((plan) => plan.mode === "youtube")
    && initialYoutube.every((item) => item.playButtons === 1 && item.iframeCount === 0), { youtubePlans, initialYoutube });

  const xsopIndex = youtubeTargets.findIndex((url) => url.includes(YOUTUBE_ID));
  await page.locator(`#qa-youtube-${xsopIndex} .youtube-preview-play`).click();
  const xsopFrame = page.locator(`#qa-youtube-${xsopIndex} iframe`);
  await xsopFrame.waitFor({ state: "visible" });
  const xsopAttrs = await xsopFrame.evaluate((frame) => ({
    src: frame.src,
    allow: frame.getAttribute("allow") || "",
    allowFullscreen: frame.allowFullscreen,
    hasAllowFullscreenAttribute: frame.hasAttribute("allowfullscreen"),
  }));
  check("XSop 點擊後使用 youtube-nocookie 可全屏 iframe", new URL(xsopAttrs.src).hostname === "www.youtube-nocookie.com"
    && xsopAttrs.src.includes(`/embed/${YOUTUBE_ID}`)
    && new URL(xsopAttrs.src).searchParams.get("autoplay") === "1"
    && xsopAttrs.allow.includes("autoplay")
    && xsopAttrs.allowFullscreen
    && xsopAttrs.hasAllowFullscreenAttribute, xsopAttrs);
  await page.locator(`#qa-youtube-${xsopIndex} .preview-expand`).click();
  await page.locator("#resource-dialog[open]").waitFor({ state: "visible" });
  const youtubeFullscreen = await page.locator("#resource-dialog-stage iframe").evaluate((frame) => ({
    src: frame.src,
    allowFullscreen: frame.allowFullscreen,
  }));
  check("YouTube fullscreen 保留同一 video ID", youtubeFullscreen.src.includes(`/embed/${YOUTUBE_ID}`)
    && youtubeFullscreen.allowFullscreen, youtubeFullscreen);
  await page.locator('#resource-dialog button[value="close"]').click();

  await waitForLesson(page, baseUrl, "lesson-1461");
  const removedRuntime = await page.evaluate((url) => ({
    exactHrefCount: document.querySelectorAll(`a[href="${CSS.escape(url)}"]`).length,
    fragmentCount: Array.from(document.querySelectorAll("a, iframe, [data-preview-src]")).filter((node) => (
      [node.getAttribute("href"), node.getAttribute("src"), node.getAttribute("data-preview-src")]
        .some((value) => String(value || "").includes("content_30068"))
    )).length,
    htmlContains: document.documentElement.innerHTML.includes("content_30068"),
  }), REMOVED_SCDFZ_URL);
  check("30068 runtime DOM 清零", removedRuntime.exactHrefCount === 0 && removedRuntime.fragmentCount === 0 && !removedRuntime.htmlContains, removedRuntime);

  await waitForLesson(page, baseUrl, "lesson-1576");
  await page.waitForFunction((url) => Array.from(document.querySelectorAll("a")).some((anchor) => anchor.href === url), PRESERVED_SCDFZ_URL, { timeout: 30_000 });
  const preservedRuntimeCount = await page.locator(`a[href="${PRESERVED_SCDFZ_URL}"]`).count();
  check("22151 runtime DOM 保留", preservedRuntimeCount > 0, { preservedRuntimeCount });

  await verifyNoHorizontalOverflow(page, 1440, 960, baseUrl, "lesson-1466");
  await verifyNoHorizontalOverflow(page, 390, 844, baseUrl, "lesson-1458");

  await context.close();
} catch (error) {
  check("embed browser acceptance completed", false, { error: error?.stack || String(error) });
} finally {
  await browser?.close().catch(() => {});
  if (server) {
    server.closeAllConnections?.();
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
  try {
    orphanDryRun = execFileSync(ORPHAN_GUARD, ["--dry-run", "--session", SESSION_NAME], { encoding: "utf8" }).trim();
  } catch (error) {
    orphanDryRun = error?.stdout?.toString().trim() || error?.message || "failed";
    check("orphan browser dry-run", false, { orphanDryRun });
  }
}

const result = {
  schemaVersion: "yw-embed-playback-browser-acceptance-v1",
  node: process.version,
  session: SESSION_NAME,
  passed: checks.filter((item) => item.pass).length,
  total: checks.length,
  failures,
  orphanDryRun,
  checks,
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exitCode = failures.length ? 1 : 0;
