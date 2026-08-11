import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const SITE_ROOT = resolve(fileURLToPath(new URL("../site/", import.meta.url)));
const BRAVE = "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";
const TEST_LESSON_ID = "lesson-1700";
const TEST_LESSON_TITLE = "以工匠精神雕琢时代品质";
const WAIT_FOR_FOCUS_RACE_MS = 12_000;
const SCROLL_TOLERANCE_PX = 5;

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

function assert(condition, message, detail = {}) {
  if (!condition) {
    throw new Error(`${message}: ${JSON.stringify(detail)}`);
  }
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

let server;
let browser;
try {
  server = await startStaticServer();
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ executablePath: BRAVE, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  let chatDocumentRequests = 0;

  await context.route("https://my.bdfz.net/site-auth.js", (route) => route.fulfill({
    contentType: "text/javascript; charset=utf-8",
    body: "window.BdfzIdentity={getSession:async()=>({authenticated:false})};",
  }));
  await context.route("https://nav.bdfz.net/bdfz-nav.js", (route) => route.fulfill({
    contentType: "text/javascript; charset=utf-8",
    body: "",
  }));
  await context.route("https://chat.bdfz.net/**", (route) => {
    chatDocumentRequests += 1;
    return route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: "<!doctype html><meta charset=utf-8><title>同讀焦點測試</title><textarea id=text>同讀已載入</textarea><script>setTimeout(()=>text.focus(),100)</script>",
    });
  });

  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(`${baseUrl}/#${TEST_LESSON_ID}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    (title) => document.querySelector("#lesson-title")?.textContent.includes(title),
    TEST_LESSON_TITLE,
  );
  await page.waitForTimeout(1_500);

  const initial = await page.evaluate(() => {
    const frame = document.querySelector("#lesson-chat-frame");
    const button = document.querySelector("#lesson-chat-load");
    return {
      frameSrc: frame?.getAttribute("src") || "",
      frameHidden: frame?.hidden === true,
      placeholderHidden: document.querySelector("#lesson-chat-placeholder")?.hidden === true,
      loadButtonVisible: Boolean(button?.getClientRects().length),
    };
  });
  assert(
    initial.frameSrc === "about:blank"
      && initial.frameHidden
      && !initial.placeholderHidden
      && initial.loadButtonVisible
      && chatDocumentRequests === 0,
    "同讀必須保持未載入狀態",
    { ...initial, chatDocumentRequests },
  );

  const beforeWait = await page.evaluate(() => {
    document.documentElement.style.scrollBehavior = "auto";
    const chat = document.querySelector("#lesson-chat");
    scrollTo(0, Math.max(0, chat.offsetTop - 1_800));
    return {
      scrollY,
      activeElement: document.activeElement?.id || document.activeElement?.tagName || "",
      chatTop: chat.getBoundingClientRect().top,
    };
  });
  await page.waitForTimeout(WAIT_FOR_FOCUS_RACE_MS);
  const afterWait = await page.evaluate(() => ({
    scrollY,
    activeElement: document.activeElement?.id || document.activeElement?.tagName || "",
    chatTop: document.querySelector("#lesson-chat")?.getBoundingClientRect().top,
    frameSrc: document.querySelector("#lesson-chat-frame")?.getAttribute("src") || "",
  }));
  assert(
    Math.abs(afterWait.scrollY - beforeWait.scrollY) <= SCROLL_TOLERANCE_PX
      && afterWait.activeElement !== "lesson-chat-frame"
      && afterWait.frameSrc === "about:blank"
      && chatDocumentRequests === 0,
    "等待期間不得自動跳到同讀",
    { beforeWait, afterWait, chatDocumentRequests },
  );

  await page.locator("#lesson-chat-load").click();
  await page.waitForFunction(() => {
    const frame = document.querySelector("#lesson-chat-frame");
    return frame?.getAttribute("src") === "https://chat.bdfz.net/#lobby" && !frame.hidden;
  });
  await page.waitForTimeout(250);
  const afterClick = await page.evaluate(() => ({
    frameSrc: document.querySelector("#lesson-chat-frame")?.getAttribute("src") || "",
    frameHidden: document.querySelector("#lesson-chat-frame")?.hidden === true,
    placeholderHidden: document.querySelector("#lesson-chat-placeholder")?.hidden === true,
    activeElement: document.activeElement?.id || document.activeElement?.tagName || "",
  }));
  assert(
    afterClick.frameSrc === "https://chat.bdfz.net/#lobby"
      && !afterClick.frameHidden
      && afterClick.placeholderHidden
      && chatDocumentRequests === 1,
    "同讀必須只在點擊後載入一次",
    { afterClick, chatDocumentRequests },
  );
  assert(pageErrors.length === 0, "頁面不應產生運行錯誤", { pageErrors });

  process.stdout.write(`${JSON.stringify({
    ok: true,
    baseUrl,
    waitMs: WAIT_FOR_FOCUS_RACE_MS,
    beforeWait,
    afterWait,
    afterClick,
    chatDocumentRequests,
  }, null, 2)}\n`);
  await context.close();
} finally {
  await browser?.close();
  if (server) await new Promise((resolvePromise) => server.close(resolvePromise));
}
