#!/usr/bin/env node

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { launchTestBrowser } from "./playwright_macos_launcher.mjs";

const SITE_ROOT = path.resolve(import.meta.dirname, "../site");
const REQUESTED_BASE_URL = process.env.BASE_URL?.replace(/\/$/, "") || "";
const DEFAULT_EXECUTABLE = "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH
  || (existsSync(DEFAULT_EXECUTABLE) ? DEFAULT_EXECUTABLE : undefined);
const failures = [];
const checks = [];
const MIME = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
]);
let baseUrl = REQUESTED_BASE_URL;

function startStaticServer() {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      const relative = url.pathname === "/"
        ? "index.html"
        : decodeURIComponent(url.pathname).replace(/^\/+/, "");
      const file = path.resolve(SITE_ROOT, relative);
      if (!file.startsWith(`${SITE_ROOT}${path.sep}`)) {
        response.writeHead(403).end();
        return;
      }
      const body = await readFile(file);
      response.writeHead(200, {
        "content-type": MIME.get(path.extname(file)) || "application/octet-stream",
        "cache-control": "no-store",
      });
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

function check(name, condition, detail = "") {
  checks.push({ name, pass: Boolean(condition), detail });
  if (!condition) failures.push(`${name}${detail ? `: ${detail}` : ""}`);
}

async function waitForLesson(page) {
  await page.goto(`${baseUrl}/#lesson-1727`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => (
    document.querySelector("#lesson-index .lesson-link")
      && document.querySelector("#lesson-title")?.textContent.trim() !== "課文"
  ), null, { timeout: 20_000 });
}

async function drawerState(page) {
  return page.evaluate(() => {
    const body = document.body;
    const atlas = document.querySelector("#atlas");
    const toggle = document.querySelector("#atlas-open");
    return {
      open: body.classList.contains("atlas-open"),
      inert: Boolean(atlas?.inert),
      ariaHidden: atlas?.getAttribute("aria-hidden") || "",
      expanded: toggle?.getAttribute("aria-expanded") || "",
      viewport: [innerWidth, innerHeight],
    };
  });
}

function isOpen(state) {
  return state.open && state.inert === false && state.ariaHidden === "false" && state.expanded === "true";
}

async function openDrawer(page) {
  if (!isOpen(await drawerState(page))) {
    await page.locator("#atlas-open").click();
  }
  await page.waitForFunction(() => (
    document.body.classList.contains("atlas-open")
      && document.querySelector("#atlas")?.getAttribute("aria-hidden") === "false"
      && document.querySelector("#atlas-open")?.getAttribute("aria-expanded") === "true"
      && Math.abs(document.querySelector("#atlas")?.getBoundingClientRect().x || 0) < 1
  ));
}

async function touchScrollToEnd(page) {
  const before = await page.locator("#lesson-index").evaluate((node) => {
    node.scrollTop = 0;
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return {
      scrollTop: node.scrollTop,
      max: node.scrollHeight - node.clientHeight,
      touchAction: style.touchAction,
      overflowY: style.overflowY,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    };
  });

  assert.ok(before.rect.height > 100, `lesson index has no usable touch area: ${JSON.stringify(before)}`);
  const session = await page.context().newCDPSession(page);
  const x = before.rect.x + before.rect.width / 2;
  const startY = before.rect.y + before.rect.height - 24;
  const endY = before.rect.y + 24;
  const samples = [];

  for (let swipe = 0; swipe < 7; swipe += 1) {
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y: startY, radiusX: 5, radiusY: 5, force: 1, id: 1 }],
    });
    for (let step = 1; step <= 12; step += 1) {
      await session.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{
          x,
          y: startY + ((endY - startY) * step) / 12,
          radiusX: 5,
          radiusY: 5,
          force: 1,
          id: 1,
        }],
      });
      await page.waitForTimeout(16);
    }
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.waitForTimeout(160);
    samples.push(await page.locator("#lesson-index").evaluate((node) => node.scrollTop));
  }

  await session.detach();
  const after = await page.locator("#lesson-index").evaluate((node) => {
    const last = node.querySelector(".lesson-link:last-of-type");
    const viewport = node.getBoundingClientRect();
    const lastRect = last?.getBoundingClientRect();
    return {
      scrollTop: node.scrollTop,
      max: node.scrollHeight - node.clientHeight,
      lastVisible: Boolean(lastRect
        && lastRect.top >= viewport.top - 1
        && lastRect.bottom <= viewport.bottom + 1),
    };
  });

  return { before, samples, after };
}

async function verifyTouchViewport(browser, {
  label,
  width,
  height,
  resizedHeight,
}) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  try {
    await waitForLesson(page);
    const initiallyClosed = await drawerState(page);
    await page.locator("#lesson-search").focus();
    const hiddenSearchFocused = await page.evaluate(() => document.activeElement?.id === "lesson-search");
    check(
      `${label} 關閉目錄不可進入鍵盤焦點`,
      !initiallyClosed.open
        && initiallyClosed.inert === true
        && initiallyClosed.ariaHidden === "true"
        && hiddenSearchFocused === false,
      JSON.stringify({ initiallyClosed, hiddenSearchFocused }),
    );
    await openDrawer(page);
    const opened = await drawerState(page);
    check(`${label} 目錄可打開`, isOpen(opened), JSON.stringify(opened));

    await page.locator("#atlas-close").focus();
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => !document.body.classList.contains("atlas-open"));
    const focusAfterClose = await page.evaluate(() => document.activeElement?.id || "");
    check(
      `${label} 關閉目錄後焦點回到開啟按鈕`,
      focusAfterClose === "atlas-open",
      JSON.stringify({ focusAfterClose }),
    );
    await openDrawer(page);

    await page.setViewportSize({ width, height: resizedHeight });
    await page.waitForTimeout(120);
    const afterHeightChange = await drawerState(page);
    check(
      `${label} 純高度變化不關閉目錄`,
      isOpen(afterHeightChange)
        && afterHeightChange.viewport[0] === width
        && afterHeightChange.viewport[1] === resizedHeight,
      JSON.stringify({ opened, afterHeightChange }),
    );

    // Reopen after a pre-fix failure so the touch assertion still diagnoses
    // whether the scroll container itself accepts a trusted touch gesture.
    await openDrawer(page);
    const touch = await touchScrollToEnd(page);
    check(
      `${label} 真觸控滑動可推動目錄並到達末篇`,
      touch.before.max > 0
        && touch.before.touchAction === "pan-y"
        && touch.before.overflowY === "auto"
        && touch.samples.some((value) => value > touch.before.scrollTop)
        && touch.after.scrollTop >= touch.after.max - 2
        && touch.after.lastVisible,
      JSON.stringify(touch),
    );

    if (width <= 900) {
      const target = page.locator("#lesson-index .lesson-link:last-of-type");
      const targetLessonId = await target.getAttribute("data-lesson");
      await target.click();
      await page.waitForFunction((lessonId) => (
        location.hash === `#${lessonId}`
          && !document.body.classList.contains("atlas-open")
      ), targetLessonId);
      const selectedState = await drawerState(page);
      const focusAfterSelection = await page.evaluate(() => document.activeElement?.id || "");
      check(
        `${label} 選課載入後收合目錄並把焦點交回開啟按鈕`,
        !selectedState.open
          && selectedState.inert === true
          && selectedState.ariaHidden === "true"
          && selectedState.expanded === "false"
          && focusAfterSelection === "atlas-open",
        JSON.stringify({ targetLessonId, selectedState, focusAfterSelection }),
      );
    }
  } finally {
    await context.close();
  }
}

async function verifyBreakpointTransition(browser) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  try {
    await waitForLesson(page);
    await openDrawer(page);
    const wide = await drawerState(page);
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.waitForTimeout(120);
    const compact = await drawerState(page);
    check(
      "1280→1024 跨入緊湊斷點仍關閉目錄",
      isOpen(wide)
        && !compact.open
        && compact.inert === true
        && compact.ariaHidden === "true"
        && compact.expanded === "false",
      JSON.stringify({ wide, compact }),
    );
  } finally {
    await context.close();
  }
}

async function verifyToolsBreakpointAccessibility(browser) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  try {
    await waitForLesson(page);
    const state = () => page.evaluate(() => ({
      inert: document.querySelector("#topbar-actions")?.inert,
      expanded: document.querySelector("#mobile-tools-toggle")?.getAttribute("aria-expanded"),
      open: document.body.classList.contains("tools-open"),
    }));
    const compactClosed = await state();
    await page.locator("#mobile-tools-toggle").click();
    await page.locator("#topbar-actions a").first().focus();
    await page.locator("#topbar-actions").dispatchEvent("click");
    const compactFocusAfterClose = await page.evaluate(() => document.activeElement?.id || "");
    await page.setViewportSize({ width: 1000, height: 844 });
    await page.waitForTimeout(120);
    const desktop = await state();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(120);
    const compactAgain = await state();
    check(
      "390→1000→390 工具列 inert 隨斷點即時重算",
      compactClosed.inert === true
        && compactClosed.expanded === "false"
        && compactFocusAfterClose === "mobile-tools-toggle"
        && desktop.inert === false
        && desktop.expanded === "false"
        && compactAgain.inert === true
        && compactAgain.expanded === "false",
      JSON.stringify({ compactClosed, compactFocusAfterClose, desktop, compactAgain }),
    );
  } finally {
    await context.close();
  }
}

let localServer = null;
let browser = null;
let closeBrowser = null;

try {
  if (!baseUrl) {
    localServer = await startStaticServer();
    const address = localServer.address();
    assert.ok(address && typeof address === "object");
    baseUrl = `http://127.0.0.1:${address.port}`;
  }
  const launched = await launchTestBrowser({ executablePath });
  browser = launched.browser;
  closeBrowser = launched.close;
  await verifyTouchViewport(browser, {
    label: "390×844",
    width: 390,
    height: 844,
    resizedHeight: 780,
  });
  await verifyTouchViewport(browser, {
    label: "iPad 1024×768",
    width: 1024,
    height: 768,
    resizedHeight: 700,
  });
  await verifyBreakpointTransition(browser);
  await verifyToolsBreakpointAccessibility(browser);
} finally {
  await closeBrowser?.();
  if (localServer) {
    await new Promise((resolve, reject) => {
      localServer.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

process.stdout.write(`${JSON.stringify({
  baseUrl,
  passed: checks.filter((item) => item.pass).length,
  total: checks.length,
  failures,
  checks,
}, null, 2)}\n`);

if (failures.length) process.exitCode = 1;
