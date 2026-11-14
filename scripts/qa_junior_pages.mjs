#!/usr/bin/env node
// Browser check of the junior (grades 7-9) textbook reader at /junior.
//
//   node scripts/qa_junior_pages.mjs                  serves .release/site (or site/) locally
//   BASE_URL=https://<preview-or-production> node scripts/qa_junior_pages.mjs
//
// Read-only and signed out.  Every request to another origin is blocked except
// sun.bdfz.net's page images, so no identity, analytics or learning record is
// touched; a few plates are fetched for real.  The only yw API the page may call
// is the junior dialogue (signed out: 401); any other API or My request fails.

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
const PLATE = /^https:\/\/sun\.bdfz\.net\/files\/page\/cn-[0-9a-f-]{36}-[0-9a-f]{12}\/[0-9a-f]{12}\/\d+\.webp\?w=(960|1440)$/;
const PLATE_LARGE = /^https:\/\/sun\.bdfz\.net\/files\/page\/cn-[0-9a-f-]{36}-[0-9a-f]{12}\/[0-9a-f]{12}\/\d+\.webp\?w=1440$/;
const MIME = new Map([
  [".css", "text/css; charset=utf-8"], [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"], [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"], [".webp", "image/webp"],
]);
const checks = [];
const check = (name, pass, detail = "") => checks.push({ name, pass: Boolean(pass), detail: String(detail).slice(0, 500) });

function startStaticServer() {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      // The Pages Function is not served locally: answer the junior dialogue as the Worker does when signed out.
      if (url.pathname === "/api/junior/dialogue") return void response.writeHead(401, { "content-type": "application/json" }).end('{"code":"authentication_required"}');
      let relative = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname).replace(/^\/+/, "");
      if (["junior", "dialogue"].includes(relative)) relative += ".html"; // Pages serves *.html at the clean path
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

async function open(page, url, waitFor) {
  await page.goto("about:blank");
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(waitFor, null, { timeout: 30000 });
}

const state = () => ({
  hash: location.hash,
  title: document.getElementById("title")?.textContent,
  author: document.getElementById("author")?.textContent,
  meta: document.getElementById("lesson-meta")?.textContent,
  text: document.getElementById("passages")?.textContent || "",
  toggles: document.querySelectorAll("#passages .annotation-toggle, #title-notes .annotation-toggle").length,
  crops: document.querySelectorAll("#passages .jr-figure, #after-text .jr-figure").length,
  figures: document.querySelectorAll("#plates-list figure").length,
  sources: [...document.querySelectorAll("#plates-list img, .jr-crop img")].map((img) => [img.getAttribute("src"), ...(img.getAttribute("srcset") || "").split(",").map((c) => c.trim().split(" ")[0]).filter(Boolean)]).flat(),
  firstLoaded: (() => { const img = document.querySelector("#plates-list img"); return Boolean(img?.complete && img.naturalWidth > 0); })(),
  books: document.querySelectorAll("#catalog-results .catalog-book").length,
  count: document.getElementById("catalog-count")?.textContent,
  current: document.querySelector("#catalog-results [aria-current]")?.getAttribute("href"),
  download: document.getElementById("download")?.getAttribute("href"),
  catalogHidden: document.getElementById("catalog")?.hidden,
  overflow: document.documentElement.scrollWidth - window.innerWidth,
  login: !document.getElementById("login")?.hidden,
  answerDisabled: document.getElementById("answer")?.disabled,
  page: document.body.textContent,
});

// WCAG contrast of every visible text node container against its effective background.
const contrast = () => {
  const parse = (value) => (value.match(/[\d.]+/g) || []).map(Number);
  const lum = ([r, g, b]) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  const background = (element) => { for (let e = element; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c.length >= 3 && (c[3] ?? 1) > 0.5) return c; } return parse(getComputedStyle(document.body).backgroundColor); };
  const low = [];
  let measured = 0;
  for (const element of document.querySelectorAll("#junior-root .bar *, #catalog *, #junior-reading *, .catalog-junior *")) {
    const own = [...element.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    const rect = element.getBoundingClientRect();
    if (!own || !rect.width || !rect.height || getComputedStyle(element).visibility === "hidden") continue;
    const fg = parse(getComputedStyle(element).color), bg = background(element);
    const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x), ratio = (a + 0.05) / (b + 0.05);
    const size = parseFloat(getComputedStyle(element).fontSize), bold = Number(getComputedStyle(element).fontWeight) >= 700;
    const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
    measured += 1;
    if (ratio < need) low.push(`${element.tagName.toLowerCase()}${element.id ? "#" + element.id : ""}.${element.className || ""} ${ratio.toFixed(2)}<${need}`);
  }
  return { measured, low };
};

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
  const requests = [];
  const plates = [];
  const blocked = [];
  const context = await launched.browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 });
  await context.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith("about:") || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
    const origin = new URL(url).origin;
    if (origin === baseOrigin) { requests.push(new URL(url).pathname); return route.continue(); }
    if (PLATE.test(url)) { plates.push(url); return route.continue(); }
    blocked.push(url);
    return route.abort();
  });
  const page = await context.newPage();
  const errors = [];
  // Production answers the junior dialogue 401 signed out; a preview without YW_DIALOGUE_ENABLED answers 404.
  const dialogueStatus = [];
  page.on("response", (response) => { if (new URL(response.url()).pathname === "/api/junior/dialogue") dialogueStatus.push(response.status()); });
  page.on("pageerror", (error) => errors.push(String(error)));

  // 1. A lesson opens with its text above sun's own pages.
  await open(page, `${baseUrl}/junior#junior-g7-shang-02`, () => document.querySelectorAll("#plates-list figure").length > 0 && document.querySelectorAll("#passages .jp").length > 0);
  await page.waitForFunction(() => { const img = document.querySelector("#plates-list img"); return img?.complete && img.naturalWidth > 0; }, null, { timeout: 45000 }).catch(() => {});
  // The dialogue's sign-in check answers over the network after the text: wait for it to settle.
  await page.waitForFunction(() => !document.getElementById("login").hidden || document.getElementById("status").textContent.length > 0 || !document.getElementById("answer").disabled, null, { timeout: 20000 }).catch(() => {});
  let s = await page.evaluate(state);
  check("junior-g7-shang-02 opens 春 / 朱自清: text with 12 note toggles above its four textbook pages", s.title === "春" && s.author === "朱自清" && s.figures === 4 && /教材第 2–5 頁/.test(s.meta) && s.text.includes("盼望着，盼望着，东风来了，春天的脚步近了。") && s.toggles === 12, JSON.stringify({ title: s.title, figures: s.figures, toggles: s.toggles, text: s.text.slice(0, 40) }));
  check("every page and picture address is a sun.bdfz.net page file", s.sources.length >= 6 && s.sources.every((u) => PLATE.test(u)), JSON.stringify(s.sources.slice(0, 4)));
  check("the first page image really loads from sun.bdfz.net", s.firstLoaded, JSON.stringify(s.sources[0]));
  check("catalog lists six books and all entries", s.books === 6 && /^初中 \d+ \/ \d+ 項$/.test(s.count) && s.current === "#junior-g7-shang-02", `${s.books} ${s.count} ${s.current}`);
  check("whole-book PDF link is sun's held file", /^https:\/\/sun\.bdfz\.net\/files\/pdf\/cn-8b9c7052-add4-4744-ab04-69d6c180d5d9-83735d49f455\/83735d49f455\//.test(s.download || ""), s.download);
  check("the removed notices are gone", !/不計入 My|取自 sun\.bdfz\.net|本站不另存|只供閱讀原書|在 sun\.bdfz\.net 開啟本項/.test(s.page), "");
  const dialogueGate = dialogueStatus.at(-1);
  const statusText = await page.evaluate(() => document.getElementById("status").textContent);
  check("signed out, reading is complete and the dialogue asks for My (or is off where the feature is not enabled)", s.answerDisabled && (dialogueGate === 401 ? s.login : dialogueGate === 404 && !s.login && statusText.length > 0), JSON.stringify({ api: dialogueGate, login: s.login, disabled: s.answerDisabled, statusText }));
  await page.click("#passages .annotation-toggle");
  const noteOpen = await page.evaluate(() => { const n = document.querySelector("#passages .inline-note"); return n && !n.hidden ? n.textContent : ""; });
  check("a note toggle opens the textbook note in place", /^〔朗润〕明亮滋润/.test(noteOpen), noteOpen.slice(0, 40));
  await page.click("#plates-list .plate-open");
  const viewer = await page.evaluate(() => ({ open: document.getElementById("plate-viewer").open, src: document.getElementById("viewer-image").getAttribute("src"), label: document.getElementById("viewer-label").textContent }));
  check("a page image opens the full-screen viewer with its PDF link", viewer.open && PLATE_LARGE.test(viewer.src || "") && /1 \/ 4/.test(viewer.label), JSON.stringify(viewer));
  await page.keyboard.press("Escape");

  // 2. Next entry, book link, part jump.
  await page.click("#next-entry");
  await page.waitForFunction(() => document.getElementById("title")?.textContent === "济南的冬天");
  s = await page.evaluate(state);
  check("next link opens 济南的冬天", s.title === "济南的冬天" && s.figures > 0, JSON.stringify({ hash: s.hash, title: s.title }));
  await open(page, `${baseUrl}/junior#g9-xia`, () => location.hash === "#junior-g9-xia-01");
  s = await page.evaluate(state);
  check("a book link opens its unit page", s.title === "第一单元" && /單元頁/.test(s.meta), JSON.stringify({ hash: s.hash, meta: s.meta }));
  await open(page, `${baseUrl}/junior#junior-g7-shang-05`, () => document.querySelectorAll("#parts button").length === 4);
  await page.click("#parts button:last-child");
  await page.waitForTimeout(1200);
  const top = await page.evaluate(() => Math.round([...document.querySelectorAll("#passages .jh")].find((h) => h.dataset.plain?.startsWith("天净沙"))?.getBoundingClientRect().top ?? 9999));
  check("a part button scrolls to that poem in the text", Math.abs(top) < 60, `top=${top}`);

  // 3. Theme button cycles the shared palettes; contrast of every visible text in every palette.
  const palettes = await page.evaluate(async () => {
    const out = [];
    const button = document.getElementById("theme-cycle");
    for (let i = 0; i < 12 && button; i += 1) {
      out.push({ name: button.textContent, paper: getComputedStyle(document.documentElement).getPropertyValue("--paper").trim() });
      button.click();
      await new Promise((r) => setTimeout(r, 50));
    }
    return out;
  });
  const names = [...new Set(palettes.map((p) => p.name))];
  check("one theme button cycles every palette", names.length >= 6 && new Set(palettes.map((p) => p.paper)).size >= 6, JSON.stringify(names));
  const contrastRows = [];
  for (let i = 0; i < names.length; i += 1) {
    const row = await page.evaluate(contrast);
    contrastRows.push({ palette: await page.evaluate(() => document.getElementById("theme-cycle").textContent), ...row });
    await page.click("#theme-cycle");
  }

  // 4. Phone: catalog starts closed, no sideways scroll, a catalog link opens and closes it.
  const phone = await launched.browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await phone.route("**/*", (route) => {
    const url = route.request().url();
    const origin = url.startsWith("http") ? new URL(url).origin : "";
    if (!origin || origin === baseOrigin) { if (origin) requests.push(new URL(url).pathname); return route.continue(); }
    if (PLATE.test(url)) { plates.push(url); return route.continue(); }
    blocked.push(url);
    return route.abort();
  });
  const mobile = await phone.newPage();
  mobile.on("pageerror", (error) => errors.push(String(error)));
  await open(mobile, `${baseUrl}/junior#junior-g8-shang-03`, () => document.querySelectorAll("#plates-list figure").length > 0 && document.querySelectorAll("#passages .jp").length > 0);
  s = await mobile.evaluate(state);
  check("390×844 catalog starts closed with no sideways scroll", s.catalogHidden === true && s.overflow <= 0, JSON.stringify({ hidden: s.catalogHidden, overflow: s.overflow }));
  await mobile.click("#catalog-toggle");
  await mobile.click(".book-lessons a[href='#junior-g8-shang-04']");
  await mobile.waitForFunction(() => document.getElementById("title")?.textContent === "中国人首次进入自己的空间站"); // the hashchange handler runs after the hash moves
  s = await mobile.evaluate(state);
  check("390×844 a catalog link opens the entry and closes the catalog", s.catalogHidden === true && s.title === "中国人首次进入自己的空间站" && s.overflow <= 0, JSON.stringify({ hidden: s.catalogHidden, title: s.title, overflow: s.overflow }));
  await mobile.waitForFunction(() => !document.getElementById("login").hidden || document.getElementById("status").textContent.length > 0 || !document.getElementById("answer").disabled, null, { timeout: 20000 }).catch(() => {});
  await mobile.click("#conversation-tab");
  const talk = await mobile.evaluate(() => ({ view: document.querySelector(".workspace").dataset.view, login: !document.getElementById("login").hidden, overflow: document.documentElement.scrollWidth - window.innerWidth }));
  check("390×844 the 對話 tab shows the conversation (My sign-in where the dialogue is enabled)", talk.view === "conversation" && (talk.login || dialogueGate === 404) && talk.overflow <= 0, JSON.stringify(talk));
  await mobile.click("#text-tab");
  const mobileContrast = await mobile.evaluate(contrast);

  const juniorRequests = [...new Set(requests)];
  // The production zone injects Cloudflare Web Analytics / Zaraz into every yw page (not the page's code);
  // they are listed, blocked, and do not fail the check.  Anything else off-origin, any yw API call or My fails it.
  const EDGE = (u) => /^https:\/\/static\.cloudflareinsights\.com\//.test(u);
  const edgeInjected = [...new Set([...blocked.filter(EDGE).map((u) => new URL(u).host), ...juniorRequests.filter((p) => p.startsWith("/cdn-cgi/"))])];
  const juniorBlocked = blocked.filter((u) => !EDGE(u));
  check("the junior page called only the junior dialogue, nothing in My and no origin but sun.bdfz.net (zone analytics aside)", juniorRequests.filter((p) => p.startsWith("/api/")).every((p) => p === "/api/junior/dialogue") && juniorBlocked.length === 0, JSON.stringify({ requests: juniorRequests.filter((p) => !p.startsWith("/assets/") && !p.startsWith("/data/junior-reading/")), blocked: juniorBlocked.slice(0, 5), edgeInjected }));

  // 5. The senior entry links the six junior books and carries no persona notice.
  const dialogue = `${baseUrl}/dialogue`;
  await open(page, dialogue, () => document.querySelectorAll(".catalog-junior a").length > 0);
  const senior = await page.evaluate(() => ({
    links: [...document.querySelectorAll(".catalog-junior a")].map((a) => a.getAttribute("href")),
    persona: Boolean(document.getElementById("persona-label")),
    notice: document.body.textContent.includes("不是作者本人"),
    removed: /不計入 My|取自 sun\.bdfz\.net/.test(document.body.textContent),
  }));
  check("senior catalog links the six junior books", JSON.stringify(senior.links) === JSON.stringify(["/junior#g7-shang", "/junior#g7-xia", "/junior#g8-shang", "/junior#g8-xia", "/junior#g9-shang", "/junior#g9-xia"]), JSON.stringify(senior.links));
  check("lesson heading carries no 「不是作者本人」 notice and the junior links no 不計入 My note", !senior.persona && !senior.notice && !senior.removed, JSON.stringify(senior));
  const seniorContrast = await page.evaluate(contrast);

  check("no page error", errors.length === 0, errors.slice(0, 3).join(" | "));
  const failed = checks.filter((c) => !c.pass);
  console.log(JSON.stringify({ baseUrl, siteRoot: REQUESTED_BASE_URL ? null : SITE_ROOT, plateRequests: plates.length, blockedRequests: blocked.length, contrast: { desktop: contrastRows, phone: mobileContrast, senior: seniorContrast }, juniorRequests, edgeInjected, checks, ok: failed.length === 0 }, null, 2));
  process.exitCode = failed.length ? 1 : 0;
} catch (error) {
  console.error(error?.stack || String(error));
  process.exitCode = 1;
} finally {
  await closeBrowser().catch(() => {});
  if (server) await new Promise((resolve) => server.close(resolve));
}
