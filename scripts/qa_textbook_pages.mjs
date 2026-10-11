#!/usr/bin/env node
// Browser check of the textbook plates ("原圖").
//
//   node scripts/qa_textbook_pages.mjs                 serves .release/site (or site/) locally
//   BASE_URL=https://<preview-or-production> node scripts/qa_textbook_pages.mjs
//
// Read-only: it opens lessons and the plate dialog while signed out.  Every
// request to another origin is blocked except the plates on sun.bdfz.net, so no
// identity, analytics or learning record is touched.  A handful of plates are
// fetched for real.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { launchTestBrowser } from "./playwright_macos_launcher.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const STAGED = path.join(ROOT, ".release", "site");
const SITE_ROOT = process.env.YW_QA_SITE_ROOT
  ? path.resolve(process.env.YW_QA_SITE_ROOT)
  : (existsSync(path.join(STAGED, "index.html")) ? STAGED : path.join(ROOT, "site"));
const REQUESTED_BASE_URL = process.env.BASE_URL?.replace(/\/$/, "") || "";
const DEFAULT_EXECUTABLE = "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH
  || (existsSync(DEFAULT_EXECUTABLE) ? DEFAULT_EXECUTABLE : undefined);
const PLATE = /^https:\/\/sun\.bdfz\.net\/files\/page\/cn-[0-9a-f-]{36}-[0-9a-f]{12}\/[0-9a-f]{12}\/\d+\.webp\?w=(240|960|1440)$/;
const LEGACY = /img\.rdfzer\.com\/pages\//;
const MIME = new Map([
  [".css", "text/css; charset=utf-8"], [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"], [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"], [".webp", "image/webp"], [".jpg", "image/jpeg"],
]);
const checks = [];
const check = (name, pass, detail = "") => checks.push({ name, pass: Boolean(pass), detail: String(detail).slice(0, 400) });

function startStaticServer() {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      const relative = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname).replace(/^\/+/, "");
      const file = path.resolve(SITE_ROOT, relative);
      if (!file.startsWith(`${SITE_ROOT}${path.sep}`)) return void response.writeHead(403).end();
      const body = await readFile(file);
      response.writeHead(200, { "content-type": MIME.get(path.extname(file)) || "application/octet-stream", "cache-control": "no-store" });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function openLesson(page, baseUrl, lessonId) {
  await page.goto("about:blank");
  await page.goto(`${baseUrl}/#${lessonId}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction((id) => (
    document.querySelector(`#lesson-index .lesson-link[data-lesson="${id}"].active`)
      && document.querySelector("#lesson-title")?.textContent.trim() !== "課文"
  ), lessonId, { timeout: 30_000 });
}

async function dialogState(page) {
  return page.evaluate(() => {
    const image = document.querySelector("#page-image");
    const link = document.querySelector("#page-pdf-link");
    return {
      open: document.querySelector("#page-dialog").open,
      imageHidden: image.hidden,
      imageSrc: image.getAttribute("src") || "",
      naturalWidth: image.naturalWidth,
      caption: document.querySelector("#page-caption").textContent,
      note: document.querySelector("#page-note").textContent,
      link: link.hidden ? "" : link.href,
      retryHidden: document.querySelector("#page-retry").hidden,
      thumbs: [...document.querySelectorAll("#page-strip img")].map((item) => item.getAttribute("src") || ""),
      labels: [...document.querySelectorAll("#page-strip span")].map((item) => item.textContent),
    };
  });
}

async function openPlates(page, { expectImage }) {
  await page.waitForFunction(() => !document.querySelector("#page-open").disabled, null, { timeout: 20_000 });
  await page.click("#page-open");
  await page.waitForFunction(() => document.querySelector("#page-dialog").open, null, { timeout: 5_000 });
  if (expectImage) {
    await page.waitForFunction(() => {
      const image = document.querySelector("#page-image");
      return !image.hidden && image.complete && image.naturalWidth > 0;
    }, null, { timeout: 45_000 });
  }
  return dialogState(page);
}

let server;
let closeBrowser = async () => {};
try {
  let baseUrl = REQUESTED_BASE_URL;
  if (!baseUrl) {
    server = await startStaticServer();
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  }
  const baseOrigin = new URL(baseUrl).origin;
  const launched = await launchTestBrowser({ executablePath });
  closeBrowser = launched.close;
  const context = await launched.browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 });
  const requested = [];
  let failPlates = false;
  await context.route("**/*", (route) => {
    const url = route.request().url();
    requested.push(url);
    if (url.startsWith("about:") || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
    const origin = new URL(url).origin;
    if (origin === baseOrigin) return route.continue();
    if (PLATE.test(url)) return failPlates ? route.abort() : route.continue();
    return route.abort();
  });
  const page = await context.newPage();

  // 1. An ordinary lesson: exact rows, printed labels, PDF link, thumbnails.
  await openLesson(page, baseUrl, "lesson-1523");
  check("課文清單顯示已核實的印刷頁而非舊序號", await page.evaluate(() => document.querySelector('#lesson-index .lesson-link[data-lesson="lesson-1523"] small')?.textContent === "頁 29"));
  let state = await openPlates(page, { expectImage: true });
  check("lesson-1523 首頁取自 SUN 的 PDF 34（960）", /\/efe51d7a6773\/34\.webp\?w=960$/.test(state.imageSrc) && state.naturalWidth > 0, state.imageSrc);
  check("lesson-1523 說明列為印刷頁 1/6", state.caption.includes("第 29 頁") && state.caption.endsWith("1/6"), state.caption);
  check("lesson-1523 PDF 連結", state.link === "https://sun.bdfz.net/?view=pdf&edition=cn-da694670-f25b-46a0-9c3f-a31f5a2f131a-efe51d7a6773&p=34", state.link);
  await page.waitForFunction(() => [...document.querySelectorAll("#page-strip img")].every((item) => item.complete && item.naturalWidth > 0), null, { timeout: 45_000 });
  state = await dialogState(page);
  check("lesson-1523 六張縮圖均為 240", state.thumbs.length === 6 && state.thumbs.every((src) => PLATE.test(src) && src.endsWith("w=240")), state.thumbs.join(" "));
  await page.click("#page-next");
  await page.waitForFunction(() => /\/35\.webp/.test(document.querySelector("#page-image").getAttribute("src") || "") && document.querySelector("#page-image").naturalWidth > 0, null, { timeout: 45_000 });
  check("下一頁載入 PDF 35", true);
  await page.keyboard.press("Escape");
  const cleared = await page.waitForFunction(() => (
    !document.querySelector("#page-dialog").open && !document.querySelector("#page-image").getAttribute("src")
  ), null, { timeout: 5_000 }).then(() => true, () => false);
  check("關閉後不保留圖址", cleared);

  // 2. Lesson anchored to the current edition from the PDF text layer.
  await openLesson(page, baseUrl, "lesson-1570");
  state = await openPlates(page, { expectImage: true });
  check("lesson-1570 顯示現行版 PDF 52（印刷頁 47），共 4 頁", /\/7da9104e683d\/52\.webp\?w=960$/.test(state.imageSrc) && state.caption.includes("第 47 頁") && state.caption.endsWith("1/4"), `${state.imageSrc} ${state.caption}`);
  check("lesson-1570 說明圖頁已依現行版校定", state.note.includes("依現行版教材的目錄與課題位置校定"), state.note);
  await page.keyboard.press("Escape");

  // 2b. Inherited wrong pages replaced by the proven range; a skipped inside page shown.
  await openLesson(page, baseUrl, "lesson-1722-p3");
  state = await openPlates(page, { expectImage: true });
  check("lesson-1722-p3《虞美人》顯示自己的 PDF 149，且不稱現行版無對應頁", /\/e635902fe131\/149\.webp\?w=960$/.test(state.imageSrc) && state.caption.endsWith("1/1") && !state.note.includes("沒有對應頁"), `${state.imageSrc} ${state.caption} ${state.note}`);
  await page.keyboard.press("Escape");
  await openLesson(page, baseUrl, "lesson-1520");
  state = await openPlates(page, { expectImage: true });
  check("lesson-1520 共 8 頁，含課內的 PDF 23", state.caption.endsWith("1/8") && state.thumbs.length === 8 && state.labels[3] === "第 18 頁", `${state.caption} ${state.labels.join(",")}`);
  await page.keyboard.press("Escape");

  // 3. Lessons absent from the current edition: words, no image, no request.
  for (const [lessonId, name] of [["lesson-1569", "《一个消逝了的山村》"], ["lesson-1572", "《聽聽那冷雨》"]]) {
    await openLesson(page, baseUrl, lessonId);
    const before = requested.filter((url) => PLATE.test(url)).length;
    state = await openPlates(page, { expectImage: false });
    check(`${lessonId}${name} 無圖、無連結，說明不在現行版`, state.imageHidden && !state.imageSrc && !state.link && state.thumbs.length === 0 && state.note.startsWith("本課不在現行版教材中"), JSON.stringify(state));
    check(`${lessonId} 未發出任何圖頁請求`, requested.filter((url) => PLATE.test(url)).length === before);
    await page.keyboard.press("Escape");
  }

  // 4. Absent lesson with a content-revised page at the same position: pointer only.
  await openLesson(page, baseUrl, "lesson-1522");
  const beforePointer = requested.filter((url) => PLATE.test(url)).length;
  state = await openPlates(page, { expectImage: false });
  check("lesson-1522 無圖；指出相同位置為 PDF 38（內容已修訂）並可在 SUN 打開", state.imageHidden && !state.imageSrc && state.thumbs.length === 0
    && state.note.includes("本課不在現行版教材中") && state.note.includes("相同位置為 PDF 第 38 頁（內容已修訂）")
    && state.link === "https://sun.bdfz.net/?view=pdf&edition=cn-da694670-f25b-46a0-9c3f-a31f5a2f131a-efe51d7a6773&p=38", JSON.stringify(state));
  check("lesson-1522 未發出任何圖頁請求", requested.filter((url) => PLATE.test(url)).length === beforePointer);
  await page.keyboard.press("Escape");

  // 5. A failing plate says "retrying", which is not the "no counterpart" text.
  failPlates = true;
  await openLesson(page, baseUrl, "lesson-1521");
  state = await openPlates(page, { expectImage: false });
  await page.waitForFunction(() => document.querySelector("#page-note").textContent.includes("正在自動重試"), null, { timeout: 15_000 });
  state = await dialogState(page);
  check("載入失敗顯示自動重試而非「沒有對應頁」", state.note.includes("正在自動重試") && !state.note.includes("沒有對應頁"), state.note);
  await page.keyboard.press("Escape");
  failPlates = false;

  const plates = requested.filter((url) => PLATE.test(url));
  check("全程沒有任何舊教材頁圖請求", requested.every((url) => !LEGACY.test(url)), requested.filter((url) => LEGACY.test(url)).slice(0, 3).join(" "));
  check("對 sun.bdfz.net 只請求頁圖", requested.filter((url) => url.startsWith("https://sun.bdfz.net/")).every((url) => PLATE.test(url)));
  const failed = checks.filter((item) => !item.pass);
  console.log(JSON.stringify({ baseUrl, siteRoot: REQUESTED_BASE_URL ? null : SITE_ROOT, plateRequests: plates.length, checks, ok: failed.length === 0 }, null, 2));
  process.exitCode = failed.length ? 1 : 0;
} catch (error) {
  console.error(error?.stack || String(error));
  process.exitCode = 1;
} finally {
  await closeBrowser().catch(() => {});
  if (server) await new Promise((resolve) => server.close(resolve));
}
