#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const ROOT = path.resolve(import.meta.dirname, "..");
const SITE_ROOT = path.join(ROOT, "site");
const BRAVE = "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";
const SESSION_NAME = "yw-web-polish-20260811";
const ORPHAN_GUARD = "/Users/ylsuen/CF/scripts/kill-orphan-playwright.sh";
const EVIDENCE_DIR = `/private/tmp/${SESSION_NAME}-${process.pid}`;
const NOTE_ONLY = process.env.YW_QA_NOTE_ONLY === "1";
const REMOTE_ONLY = process.env.YW_QA_REMOTE_ONLY === "1";
const DIAG_ONLY = process.env.YW_QA_DIAG_ONLY === "1";
const MIME = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
  [".woff2", "font/woff2"],
]);
const checks = [];
const failures = [];
const evidenceFiles = [];

function check(name, condition, detail = "") {
  const pass = Boolean(condition);
  checks.push({ name, pass, detail });
  if (!pass) failures.push(`${name}${detail ? `: ${detail}` : ""}`);
}

function digest(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function allJsonFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return allJsonFiles(target);
    return entry.isFile() && entry.name.endsWith(".json") ? [target] : [];
  });
}

function submittedState(lessonId) {
  const asset = JSON.parse(readFileSync(path.join(SITE_ROOT, "data/classical-first-read", `${lessonId}.json`), "utf8"));
  const marks = asset.paragraphs.slice(0, 3).map((paragraph, index) => ({
    markId: `qa-mark-${index + 1}`,
    paragraphKey: paragraph.key,
    startOffset: 0,
    endOffset: Math.min(2, paragraph.text.length),
    selectedText: paragraph.text.slice(0, 2),
    guess: `測試初讀直覺 ${index + 1}`,
    resolutionStatus: "open",
  }));
  return {
    schemaVersion: "yw-classical-first-read-state-v1",
    lessonId,
    submitted: true,
    unlocked: true,
    annotatedReadCompleted: false,
    submittedAt: "2026-08-11T12:00:00.000Z",
    summary: "先辨人物處境，再核對字句與篇章推進。",
    elapsedMs: 420000,
    marks,
  };
}

function startStaticServer() {
  const server = createServer((request, response) => {
    try {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      const relative = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname).replace(/^\/+/, "");
      const file = path.resolve(SITE_ROOT, relative);
      if (!file.startsWith(`${SITE_ROOT}${path.sep}`) || !statSync(file).isFile()) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, {
        "content-type": MIME.get(path.extname(file)) || "application/octet-stream",
        "cache-control": "no-store",
      });
      response.end(readFileSync(file));
    } catch {
      response.writeHead(404).end();
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function authStub() {
  return `
    window.BdfzIdentity = {
      getSession: async () => ({ authenticated: true }),
      api: async () => { throw new Error("shared-state intentionally unavailable in Web-only QA"); },
      mount: () => {}
    };
    const exposeLogin = () => { const node = document.querySelector("#auth-login"); if (node) node.hidden = false; };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", exposeLogin, { once: true });
    else exposeLogin();
  `;
}

async function configureContext(context, submitted) {
  await context.route("https://my.bdfz.net/**", async (route) => {
    const request = route.request();
    if (new URL(request.url()).pathname === "/site-auth.js") {
      await route.fulfill({ contentType: "text/javascript; charset=utf-8", body: authStub() });
      return;
    }
    if (request.resourceType() === "document") {
      await route.fulfill({ contentType: "text/html; charset=utf-8", body: "<!doctype html><title>BDFZ Login</title><main>登入</main>" });
      return;
    }
    await route.continue();
  });
  await context.route("https://nav.bdfz.net/bdfz-nav.js", (route) => route.fulfill({
    contentType: "text/javascript; charset=utf-8",
    body: "",
  }));
  await context.route("**/api/reading/first-read/state/*", async (route) => {
    const lessonId = decodeURIComponent(new URL(route.request().url()).pathname.split("/").pop() || "");
    const payload = submitted.get(lessonId);
    if (!payload) {
      await route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "login_required" }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
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
}

async function waitForLesson(page, base, lessonId) {
  const expectedTitle = {
    "lesson-1462": "大战中的插曲",
    "lesson-1534": "屈原列传",
  }[lessonId] || "";
  await page.goto(`${base}/#${lessonId}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(({ id, expected }) => (
    location.hash === `#${id}`
    && document.querySelector("#lesson-title")?.textContent.includes(expected)
    && document.querySelectorAll("#text-flow .reader-note-ref").length > 0
  ), { id: lessonId, expected: expectedTitle }, { timeout: 30000 });
  await page.waitForTimeout(250);
}

async function annotationMetrics(page) {
  return page.evaluate(() => {
    const buttons = [...document.querySelectorAll("#text-flow .reader-note-ref")];
    const bad = [];
    buttons.forEach((button, index) => {
      const anchor = button.closest(".reader-annotation-anchor");
      const sup = button.closest("sup.reader-note-sup");
      const anchorText = anchor
        ? [...anchor.childNodes].filter((node) => node.nodeType !== Node.ELEMENT_NODE || !node.matches?.("sup.reader-note-sup"))
          .map((node) => node.textContent || "").join("").trim()
        : "";
      const rect = anchor?.getBoundingClientRect();
      const parentRect = anchor?.parentElement?.getBoundingClientRect();
      const style = anchor ? getComputedStyle(anchor) : null;
      const number = (button.textContent || "").trim();
      const target = document.getElementById(button.getAttribute("aria-controls") || "");
      if (!anchor || !sup || !anchorText || !/^\d+$/.test(number)
          || style?.display !== "inline-block" || style?.whiteSpace !== "nowrap"
          || anchor.getClientRects().length !== 1
          || !rect || !parentRect || rect.left < parentRect.left - 1 || rect.right > parentRect.right + 1
          || button.getAttribute("aria-expanded") !== "false" || !target?.hidden
          || !button.getAttribute("aria-label")?.includes(number)) {
        bad.push({ index, number, anchorText, rect: rect && { left: rect.left, right: rect.right }, parent: parentRect && { left: parentRect.left, right: parentRect.right } });
      }
    });
    return {
      count: buttons.length,
      bad,
      literalMarkers: buttons.filter((button) => /[註注]/.test(button.textContent || "")).length,
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
    };
  });
}

async function verifyAnnotations(page, base, lessonId, width, height) {
  await page.setViewportSize({ width, height });
  await waitForLesson(page, base, lessonId);
  const metrics = await annotationMetrics(page);
  check(`${lessonId} ${width} 數字上標逐一綁定前字且不孤行`, metrics.count > 0 && metrics.bad.length === 0, JSON.stringify(metrics));
  check(`${lessonId} ${width} 無註字標記與頁面橫溢`, metrics.literalMarkers === 0 && !metrics.horizontalOverflow, JSON.stringify(metrics));

  let first = page.locator("#text-flow .reader-note-ref").first();
  await first.evaluate((node) => node.scrollIntoView({ block: "center" }));
  first = page.locator("#text-flow .reader-note-ref").first();
  const targetId = await first.getAttribute("aria-controls");
  const preOpen = await page.evaluate((id) => ({
    text: document.getElementById(id)?.textContent?.replace(/\s+/g, " ").trim() || "",
    reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
  }), targetId);
  await first.evaluate((node) => node.click());
  await page.waitForFunction((id) => id && !document.getElementById(id)?.hidden, targetId);
  await page.waitForFunction((id) => (document.getElementById(id)?.textContent || "").trim().length > 0, targetId, { timeout: 5000 }).catch(() => {});
  const openState = await page.evaluate((id) => {
    const note = document.getElementById(id);
    const button = document.querySelector(`[aria-controls="${CSS.escape(id)}"]`);
    return {
      text: note?.textContent?.replace(/\s+/g, " ").trim() || "",
      html: note?.innerHTML || "",
      expanded: button?.getAttribute("aria-expanded"),
      label: button?.getAttribute("aria-label") || "",
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
    };
  }, targetId);
  check(`${lessonId} ${width} 註釋展開 aria 正確且不溢出`, openState.text.length > 0 && openState.expanded === "true" && openState.label.startsWith("收起") && !openState.overflow, JSON.stringify({ preOpen, ...openState }));
  const shot = path.join(EVIDENCE_DIR, `${lessonId}-${width}-note-open.png`);
  await page.screenshot({ path: shot, fullPage: false });
  evidenceFiles.push(shot);
  await page.locator(`#${targetId}`).evaluate((node) => node.click());
  check(`${lessonId} ${width} 點註釋本體可收起`, await page.locator(`#${targetId}[hidden]`).count() === 1 && await first.getAttribute("aria-expanded") === "false");
}

async function verifySubmittedFlow(page) {
  const visible = await page.evaluate(() => {
    const first = document.querySelector("[data-first-read-submitted-review]");
    const tip = document.querySelector("[data-learning-tip]");
    const annotated = document.querySelector(".reader-primary");
    const vocab = document.querySelector('[data-round="vocabulary"]');
    const display = (node) => Boolean(node && getComputedStyle(node).display !== "none" && node.getBoundingClientRect().height > 0);
    return {
      allVisible: [first, tip, annotated].every(display),
      ordered: Boolean(first && tip && annotated && first.getBoundingClientRect().top < tip.getBoundingClientRect().top && tip.getBoundingClientRect().top < annotated.getBoundingClientRect().top),
      tipText: tip?.textContent?.replace(/\s+/g, " ").trim() || "",
      submittedText: first?.textContent?.replace(/\s+/g, " ").trim() || "",
      vocabLocked: vocab?.classList.contains("locked") === true && vocab?.getAttribute("aria-disabled") === "true",
    };
  });
  check("submitted 古文同屏顯示無注疏初讀、學習提示、帶註釋正文", visible.allVisible && visible.ordered && visible.tipText.length > 20 && visible.submittedText.includes("無注疏初讀"), JSON.stringify(visible));
  check("帶註釋正文未讀完前詞級疏通保持鎖定", visible.vocabLocked, JSON.stringify(visible));
  await page.locator("[data-annotated-read-complete]").click();
  await page.waitForFunction(() => !document.querySelector('[data-round="vocabulary"]')?.classList.contains("locked"));
  const unlocked = await page.evaluate(() => ({
    first: Boolean(document.querySelector("[data-first-read-submitted-review]")),
    tip: Boolean(document.querySelector("[data-learning-tip]")),
    annotated: Boolean(document.querySelector(".reader-primary")),
    vocabLocked: document.querySelector('[data-round="vocabulary"]')?.classList.contains("locked") === true,
    completion: document.querySelector(".annotated-read-completion.complete")?.textContent || "",
  }));
  check("確認讀完後只解鎖詞級且三段內容繼續同屏", unlocked.first && unlocked.tip && unlocked.annotated && !unlocked.vocabLocked && unlocked.completion.includes("已讀完"), JSON.stringify(unlocked));
}

async function settleRemoteFrame(frame) {
  await frame.locator(".step-type").waitFor({ state: "visible", timeout: 30000 });
  await frame.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await new Promise((resolve) => setTimeout(resolve, 500));
  });
  return frame.locator(".step-type").evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    const body = getComputedStyle(document.body);
    return {
      text: node.textContent?.replace(/\s+/g, " ").trim() || "",
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      display: style.display,
      visibility: style.visibility,
      opacity: style.opacity,
      color: style.color,
      background: style.backgroundColor,
      bodyColor: body.color,
      bodyBackground: body.backgroundColor,
    };
  });
}

async function settledRemoteSnapshot(frameLocator) {
  let lastError = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      await frameLocator.waitFor({ state: "attached", timeout: 30000 });
      const handle = await frameLocator.elementHandle();
      const frame = await handle?.contentFrame();
      if (!frame) throw new Error("remote iframe has no current content frame");
      await frame.waitForLoadState("domcontentloaded", { timeout: 30000 }).catch(() => {});
      const step = await settleRemoteFrame(frame);
      const text = await frame.locator("body").innerText({ timeout: 30000 });
      const paint = await frame.evaluate(() => {
        const visible = [...document.querySelectorAll("body *")].filter((node) => {
          const style = getComputedStyle(node);
          const rect = node.getBoundingClientRect();
          return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0
            && rect.width > 2 && rect.height > 2 && rect.bottom > 0 && rect.top < innerHeight;
        });
        return {
          visibleElements: visible.length,
          visibleText: visible.map((node) => node.childElementCount ? "" : node.textContent || "").join(" ").replace(/\s+/g, " ").trim(),
          background: getComputedStyle(document.body).backgroundColor,
        };
      });
      return { attempt, frame, step, text, paint };
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  return {
    attempt: 4,
    frame: null,
    step: { error: lastError?.message || "remote iframe did not settle" },
    text: "",
    paint: { visibleElements: 0, visibleText: "", background: "unavailable" },
  };
}

async function verifyGoogleAndRemote(page, base, frameDiagnostics) {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto(`${base}/#lesson-1458`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector("#lesson-title")?.textContent.includes("中国人民站起来了"));

  const googleCard = page.locator(".material-preview-card").filter({ has: page.locator('a.preview-open[href*="sites.google.com"]') }).first();
  await googleCard.locator(".material-preview-frame img").waitFor({ state: "visible", timeout: 30000 });
  const google = await googleCard.evaluate((card) => {
    const frame = card.querySelector(".material-preview-frame");
    const image = frame?.querySelector("img");
    const expand = frame?.querySelector(".preview-expand");
    const box = expand?.getBoundingClientRect();
    return {
      state: frame?.dataset.previewState,
      imageSrc: image?.getAttribute("src") || "",
      natural: [image?.naturalWidth || 0, image?.naturalHeight || 0],
      iframes: frame?.querySelectorAll("iframe").length || 0,
      giantButton: Boolean(box && (box.width > 180 || box.height > 60)),
    };
  });
  check("Google Sites 使用完整截圖而非巨大網頁按鈕", google.state === "screenshot" && google.imageSrc.includes("/assets/preview-screenshots/") && google.natural[0] > 500 && google.natural[1] > 300 && google.iframes === 0 && !google.giantButton, JSON.stringify(google));
  const googleInlineSrc = await googleCard.locator(".material-preview-frame img").getAttribute("src");
  await googleCard.locator(".preview-expand").click();
  await page.locator("#resource-dialog[open] #resource-dialog-stage img").waitFor({ state: "visible" });
  check("Google Sites 截圖可放大並縮回原卡", await page.locator("#resource-dialog-stage img").getAttribute("src") === googleInlineSrc);
  await page.locator('#resource-dialog button[value="close"]').click();
  check("Google Sites 放大層已關閉且原截圖仍在", await page.locator("#resource-dialog[open]").count() === 0 && await googleCard.locator(".material-preview-frame img").count() === 1);

  const remoteRoot = "https://zw.bdfz.net/";
  const remoteFrame = page.locator(`.matrix-preview-frame iframe[src="${remoteRoot}"]`).first();
  await remoteFrame.waitFor({ state: "attached", timeout: 30000 });
  await remoteFrame.scrollIntoViewIfNeeded();
  const inline = await settledRemoteSnapshot(remoteFrame);
  const inlineStep = inline.step;
  const inlineText = inline.text;
  const inlinePaint = inline.paint;
  const remoteAttrs = await remoteFrame.evaluate((iframe) => ({ src: iframe.src, sandbox: iframe.getAttribute("sandbox") || "" }));
  check("BDFZ 卡片直接載入遠站而非 preview 骨架", remoteAttrs.src === remoteRoot && remoteAttrs.sandbox.includes("allow-same-origin") && inlineText.replace(/\s+/g, "").length > 80 && inlineStep.rect?.width > 20 && inlineStep.rect?.height > 10 && inlineStep.visibility !== "hidden" && inlineStep.opacity !== "0" && !/url is not registered|preview upstream unavailable/i.test(inlineText), JSON.stringify({ remoteAttrs, attempt: inline.attempt, textLength: inlineText.length, inlinePaint, inlineStep, frameDiagnostics }));
  await remoteFrame.locator("xpath=..").locator(".preview-expand").click();
  const dialogFrame = page.locator(`#resource-dialog-stage iframe[src="${remoteRoot}"]`);
  await dialogFrame.waitFor({ state: "attached" });
  const dialogHandle = await dialogFrame.elementHandle();
  const dialogContent = await dialogHandle.contentFrame();
  await dialogContent.waitForLoadState("domcontentloaded", { timeout: 30000 }).catch(() => {});
  const dialogStep = await settleRemoteFrame(dialogContent).catch((error) => ({ error: error.message }));
  const dialogText = await dialogContent.locator("body").innerText({ timeout: 30000 }).catch(() => "");
  check("BDFZ 放大層仍載入同一遠站且非骨架", await dialogFrame.getAttribute("src") === remoteRoot && dialogText.replace(/\s+/g, "").length > 80 && dialogStep.rect?.width > 20 && dialogStep.rect?.height > 10 && dialogStep.visibility !== "hidden" && dialogStep.opacity !== "0", JSON.stringify({ textLength: dialogText.length, dialogStep, frameDiagnostics }));
  const shot = path.join(EVIDENCE_DIR, "bdfz-remote-frame-expanded.png");
  await dialogFrame.screenshot({ path: shot });
  evidenceFiles.push(shot);
  await page.locator('#resource-dialog button[value="close"]').click();
}

async function verifyTopLinks(page) {
  const selectors = [
    ["文體", '#topbar-actions a[href="genres.html"]'],
    ["書目", '#topbar-actions a[href="books.html"]'],
    ["星圖", '#topbar-actions a[href="star.html"]'],
    ["己身", '#topbar-actions a[href="insights.html"]'],
    ["登入", "#auth-login"],
  ];
  for (const [label, selector] of selectors) {
    const link = page.locator(selector);
    const attrs = await link.evaluate((node) => ({ target: node.target, rel: node.rel, href: node.href }));
    const before = page.url();
    const popupPromise = page.waitForEvent("popup");
    await link.click({ force: true });
    const popup = await popupPromise;
    await popup.waitForURL((url) => url.href !== "about:blank", { timeout: 15000 }).catch(() => {});
    await popup.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
    const openerNull = await popup.evaluate(() => window.opener === null).catch(() => false);
    const originalUnchanged = page.url() === before;
    check(`${label} 新 tab、noopener、原頁不變`, attrs.target === "_blank" && attrs.rel.includes("noopener") && openerNull && originalUnchanged, JSON.stringify({ ...attrs, openerNull, originalUnchanged, popupUrl: popup.url() }));
    await popup.close();
  }
}

let browser;
let server;
let orphanDryRun = "not-run";
mkdirSync(EVIDENCE_DIR, { recursive: true });

try {
  const generatedJson = allJsonFiles(path.join(SITE_ROOT, "data"));
  const xueFiles = generatedJson.filter((file) => /https?:\/\/xue\.bdfz\.net/i.test(readFileSync(file, "utf8")));
  check("全量 generated data 無 xue.bdfz.net 資源", xueFiles.length === 0, xueFiles.map((file) => path.relative(ROOT, file)).join(", "));

  server = await startStaticServer();
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  const submitted = new Map([
    ["lesson-1534", submittedState("lesson-1534")],
    ["lesson-1576", submittedState("lesson-1576")],
  ]);
  browser = await chromium.launch({ executablePath: BRAVE, headless: true });
  const context = await browser.newContext({ reducedMotion: "reduce" });
  await configureContext(context, submitted);
  const page = await context.newPage();
  const pageErrors = [];
  const pageDiagnostics = { console: [], pageErrors };
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    const location = message.location();
    if (/\.bdfz\.net/i.test(location.url || "") || message.type() === "error") {
      pageDiagnostics.console.push({ type: message.type(), text: message.text(), location });
    }
  });

  if (DIAG_ONLY) {
    await page.setViewportSize({ width: 1440, height: 960 });
    await waitForLesson(page, base, "lesson-1462");
    const diagnostic = await page.evaluate(() => {
      const documentAsset = state.current.readerDocument;
      const annotations = documentAsset.main.annotations || [];
      const media = readerMediaMap(documentAsset.main.media || []);
      const numbers = annotationNumberMap(annotations);
      const direct = renderReaderBlocks(annotations[0].blocks, media, {
        annotationNumbers: numbers,
        annotationBodies: new Map(),
      });
      const mapped = inlineAnnotationBodies(annotations, media, numbers).get("footnote-9899-1");
      return {
        helperType: typeof inlineAnnotationBodies,
        annotationCount: annotations.length,
        firstAnnotation: annotations[0],
        mapped,
        direct,
        renderedNote: document.querySelector('#reader-inline-note-footnote-9899-1-1 .reader-inline-note-content')?.innerHTML || "",
      };
    });
    check("annotation helper diagnostic captured", true, JSON.stringify(diagnostic));
  }
  const annotationCases = (REMOTE_ONLY || DIAG_ONLY) ? [] : NOTE_ONLY ? [
    ["lesson-1462", 1440, 960],
  ] : [
    ["lesson-1462", 1440, 960],
    ["lesson-1462", 390, 844],
    ["lesson-1534", 1440, 960],
    ["lesson-1534", 390, 844],
  ];
  for (const [lessonId, width, height] of annotationCases) {
    await verifyAnnotations(page, base, lessonId, width, height);
  }
  if (!NOTE_ONLY && !REMOTE_ONLY && !DIAG_ONLY) {
    await verifySubmittedFlow(page);
    await verifyGoogleAndRemote(page, base, pageDiagnostics);
    await verifyTopLinks(page);
    const xueDomCount = await page.locator('a[href*="xue.bdfz.net"],iframe[src*="xue.bdfz.net"],[data-preview-src*="xue.bdfz.net"]').count();
    check("代表頁 DOM 無 xue 卡片、鏈接或預覽", xueDomCount === 0, String(xueDomCount));
  } else if (REMOTE_ONLY) await verifyGoogleAndRemote(page, base, pageDiagnostics);
  check("瀏覽器驗收無未捕獲前端錯誤", pageErrors.length === 0, pageErrors.join(" | "));
  await context.close();
} catch (error) {
  check("browser acceptance completed", false, error?.stack || String(error));
} finally {
  await browser?.close().catch(() => {});
  if (server) await new Promise((resolve) => server.close(resolve));
  try {
    orphanDryRun = execFileSync(ORPHAN_GUARD, ["--dry-run", "--session", SESSION_NAME], { encoding: "utf8" }).trim();
  } catch (error) {
    orphanDryRun = error?.stdout?.toString().trim() || error?.message || "failed";
    check("orphan browser dry-run", false, orphanDryRun);
  }
}

const result = {
  schemaVersion: "yw-web-polish-browser-acceptance-v1",
  session: SESSION_NAME,
  node: process.version,
  passed: checks.filter((item) => item.pass).length,
  total: checks.length,
  failures,
  evidence: evidenceFiles.map((file) => ({ file, bytes: statSync(file).size, sha256: digest(file) })),
  orphanDryRun,
  checks,
};
console.log(JSON.stringify(result, null, 2));
process.exitCode = failures.length ? 1 : 0;
