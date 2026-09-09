import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  REMOVED_WEB_RESOURCE_KEYS,
  REMOVED_WEB_RESOURCE_URLS,
} from "./web_resource_policy.mjs";

const APP_PATH = new URL("../site/assets/app.js", import.meta.url);
const INDEX_PATH = new URL("../site/index.html", import.meta.url);
const WECHAT_MAP_PATH = new URL("../site/data/wechat-archive-map.json", import.meta.url);
const source = await readFile(APP_PATH, "utf8");
const indexHtml = await readFile(INDEX_PATH, "utf8");
const wechatArchiveMap = JSON.parse(await readFile(WECHAT_MAP_PATH, "utf8"));
const previewScreenshots = JSON.parse(await readFile(new URL("../site/data/preview-screenshots.json", import.meta.url), "utf8"));
const ctextLesson = JSON.parse(await readFile(new URL("../site/data/reader-documents/lesson-1474.json", import.meta.url), "utf8"));

function section(start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing ${start}`);
  assert.notEqual(endIndex, -1, `missing ${end}`);
  return source.slice(startIndex, endIndex);
}

const identitySource = section("function resourceIdentity", "function resourcePreviewPlan");
const resourceIdentity = new Function(
  "FORUM_ORIGIN",
  "RESOURCE_TRACKING_KEYS",
  `${identitySource}; return resourceIdentity;`,
)(
  "https://forum.rdfzer.com",
  new Set(["spm", "fbclid", "gclid", "dclid", "msclkid", "mc_cid", "mc_eid"]),
);

test("resource identity removes only tracking and hash while preserving semantic query", () => {
  const first = resourceIdentity("https://mp.weixin.qq.com/s?__biz=abc&mid=7&idx=1&sn=x&utm_source=course#rd");
  const duplicate = resourceIdentity("https://mp.weixin.qq.com/s?__biz=abc&mid=7&idx=1&sn=x&utm_medium=web#other");
  const second = resourceIdentity("https://mp.weixin.qq.com/s?__biz=abc&mid=7&idx=2&sn=x&utm_source=course#rd");

  assert.equal(first, duplicate);
  assert.notEqual(first, second);
  assert.match(first, /idx=1/);
  assert.doesNotMatch(first, /utm_|#/);
});

const projectionSource = section("const REMOVED_WEB_RESOURCE_KEYS", "function resourcePreviewPlan");
const resourcesSource = section("function isNonContentResource", "function renderSupplementaryMaterials");
const runtimePolicy = new Function(
  "location",
  `${projectionSource}; return { keys: REMOVED_WEB_RESOURCE_KEYS, isRemoved: isRemovedWebResource };`,
)({ href: "https://yw.bdfz.net/#lesson", origin: "https://yw.bdfz.net" });
const wechatArchiveBySource = new Map(
  wechatArchiveMap.entries.map((entry) => [resourceIdentity(entry.sourceUrl), entry]),
);
const resourcesFor = new Function(
  "absoluteResourceUrl",
  "resourceTitle",
  "resourceIdentity",
  "state",
  "location",
  `${projectionSource}\n${resourcesSource}; return resourcesFor;`,
)(
  (value) => value,
  (resource) => resource.text || resource.title || resource.label || "學習資料",
  resourceIdentity,
  { wechatArchiveBySource },
  { href: "https://yw.bdfz.net/#lesson", origin: "https://yw.bdfz.net" },
);

test("resource list maps WeChat archives, removes bdfz Yuque and xue, and preserves provenance", () => {
  const mapped = wechatArchiveMap.entries[0];
  const trackedDuplicate = new URL(mapped.sourceUrl);
  trackedDuplicate.hash = "other";
  trackedDuplicate.searchParams.set("utm_source", "duplicate");
  const resources = resourcesFor({
    resources: [
      { href: mapped.sourceUrl, text: "微信原文" },
      { href: trackedDuplicate.toString(), text: "微信追蹤重複" },
      { href: mapped.archiveUrl, text: "微信存檔重複" },
      { href: "https://bdfz.yuque.com/org-wiki/blocked", text: "BDFZ 語雀資料" },
      ...REMOVED_WEB_RESOURCE_URLS.map((href) => ({ href, text: "已刪除資源" })),
      { href: "https://pkuschool.yuque.com/example/lesson", text: "其他語雀資料" },
      { href: "https://xue.bdfz.net/", text: "全科自學平台" },
    ],
  });

  assert.equal(resources.length, 2);
  assert.equal(resources.filter((item) => new URL(item.href).hostname === "mp.weixin.qq.com").length, 0);
  assert.equal(resources.filter((item) => new URL(item.href).hostname === "bdfz.yuque.com").length, 0);
  assert.equal(resources.filter((item) => new URL(item.href).hostname === "xue.bdfz.net").length, 0);
  assert.equal(resources.some((item) => runtimePolicy.isRemoved(item.href)), false);
  assert.ok(resources.some((item) => item.href === "https://pkuschool.yuque.com/example/lesson"));
  const archive = resources.find((item) => item.href === mapped.archiveUrl);
  assert.equal(archive?.title, mapped.title);
  assert.equal(archive?.sourceUrl, mapped.sourceUrl);
});

test("student runtime uses the exact reviewed deletion set and preserves neighboring URLs", () => {
  assert.deepEqual([...runtimePolicy.keys], [...REMOVED_WEB_RESOURCE_KEYS]);
  for (const href of REMOVED_WEB_RESOURCE_URLS) {
    assert.equal(runtimePolicy.isRemoved(href), true, href);
  }
  assert.equal(
    runtimePolicy.isRemoved("https://www.bilibili.com/video/BV1Zg4y1H7fK/?vd_source=legacy"),
    true,
  );
  assert.equal(runtimePolicy.isRemoved("https://xue.bdfz.net/"), true);
  assert.equal(runtimePolicy.isRemoved("https://xue.bdfz.net/arbitrary/path?lesson=1"), true);
  assert.equal(runtimePolicy.isRemoved("https://xue.bdfz.net.example.com/"), false);
  assert.equal(
    runtimePolicy.isRemoved("https://www.scdfz.org.cn/ztzl/hjczzsc/zzhy/content_30068"),
    true,
  );
  assert.equal(
    runtimePolicy.isRemoved("https://www.scdfz.org.cn/scdqs/sxdq/lss/jwx/content_22151"),
    false,
  );
  for (const href of [
    "https://baike.baidu.com/item/%E6%97%A0%E9%A2%98",
    "https://forum.rdfzer.com/c/general/5",
    "https://pkuschool.yuque.com/g/qrvbic/books/folder/29416843",
    "https://sites.google.com/view/pkuschool/cover3/xbs1/xbs5",
    "https://zh.wikisource.org/wiki/Author:%E9%AD%AF%E8%BF%85",
  ]) assert.equal(runtimePolicy.isRemoved(href), false, href);
});

test("reader body links use the same fail-closed student projection", () => {
  const readerRunsSource = section("function renderReaderRuns", "function inlineAnnotationBodies");
  const readerBlocksSource = section("function renderReaderBlocks", "function renderReaderAnnotations");
  assert.match(readerRunsSource, /projectStudentResourceHref\(run\.href \|\| run\.sourceUrl/);
  assert.match(readerBlocksSource, /projectStudentResourceHref\(block\.href \|\| block\.sourceUrl/);
  assert.doesNotMatch(readerRunsSource, /href="\$\{esc\(run\.href\)\}"/);
  assert.doesNotMatch(readerBlocksSource, /href="\$\{esc\(block\.href\)\}"/);
});

const previewPlanSource = section("function directRemoteAppRootFor", "function previewFallback");
const reviewedGoogleSite = "https://sites.google.com/view/pkuschool/cover3/xbs1/xbs5";
const reviewedWikisource = "https://zh.wikisource.org/zh-hant/%E5%88%A5%E8%B3%A6";
const reviewedWikisourceScreenshot = "/assets/preview-screenshots/d7fd59e2b134dd5e9de56a65.webp";
const resourcePreviewPlan = new Function(
  "location",
  "resourcePreviewUrl",
  "previewScreenshotFor",
  "state",
  `${previewPlanSource}; return resourcePreviewPlan;`,
)(
  { href: "https://yw.bdfz.net/#lesson" },
  (href) => href.startsWith("https://yw.bdfz.net/") ? href : `/api/preview?url=${encodeURIComponent(href)}`,
  (href) => href === reviewedGoogleSite
    ? { screenshotUrl: "/assets/preview-screenshots/reviewed-google.webp" }
    : href === reviewedWikisource
      ? { screenshotUrl: reviewedWikisourceScreenshot }
    : null,
  { directRemoteAppRoots: new Set(["https://coread.bdfz.net/", "https://qx.bdfz.net/"]) },
);

test("preview plan uses safe qx fragments, screenshot-first Wikisource, clickable YouTube, and explicit fallbacks", () => {
  assert.equal(resourcePreviewPlan({ href: "https://yw.bdfz.net/slides/lesson.pdf", kind: "document" }).mode, "document");
  assert.equal(resourcePreviewPlan({ href: "https://img.bdfz.net/page.webp" }).mode, "image");

  const direct = resourcePreviewPlan({ href: "https://coread.bdfz.net/" });
  assert.equal(direct.mode, "remote-app");
  assert.equal(direct.src, "https://coread.bdfz.net/");
  assert.equal(direct.externalHref, "https://coread.bdfz.net/");

  const qxAuthor = resourcePreviewPlan({ href: "https://qx.bdfz.net/#luxun" });
  assert.equal(qxAuthor.mode, "remote-app");
  assert.equal(qxAuthor.src, "https://qx.bdfz.net/#luxun");
  assert.equal(qxAuthor.externalHref, "https://qx.bdfz.net/#luxun");
  for (const nonRoot of [
    "https://coread.bdfz.net/private-path",
    "https://coread.bdfz.net/?query=1",
    "https://coread.bdfz.net/#fragment",
    "https://qx.bdfz.net/private-path#luxun",
    "https://qx.bdfz.net/?author=luxun",
    "https://qx.bdfz.net/#bad/route",
    "https://unregistered.bdfz.net/",
  ]) assert.notEqual(resourcePreviewPlan({ href: nonRoot }).mode, "remote-app", nonRoot);

  const google = resourcePreviewPlan({ href: reviewedGoogleSite });
  assert.equal(google.mode, "image");
  assert.equal(google.src, "/assets/preview-screenshots/reviewed-google.webp");
  assert.equal(google.screenshot, true);
  assert.match(google.reason, /Google Sites/);

  const wikisource = resourcePreviewPlan({ href: reviewedWikisource });
  assert.equal(wikisource.mode, "image");
  assert.equal(wikisource.src, reviewedWikisourceScreenshot);
  assert.equal(wikisource.externalHref, reviewedWikisource);
  assert.equal(wikisource.screenshot, true);
  assert.match(wikisource.reason, /維基文庫/);

  const youtube = resourcePreviewPlan({ href: "https://www.youtube.com/watch?v=XSopGMoaHkU" });
  assert.equal(youtube.mode, "youtube");
  assert.equal(
    youtube.src,
    "https://www.youtube-nocookie.com/embed/XSopGMoaHkU?rel=0&playsinline=1",
  );
  assert.equal(youtube.posterSrc, "https://i.ytimg.com/vi/XSopGMoaHkU/hqdefault.jpg");
  assert.match(youtube.reason, /點擊畫面即可直接播放/);
  assert.equal(
    resourcePreviewPlan({ href: "https://www.youtube.com/watch?v=bad" }).mode,
    "external-only",
  );

  const http = resourcePreviewPlan({ href: "http://example.test/material" });
  assert.equal(http.mode, "external-only");
  assert.match(http.reason, /HTTP/);
  assert.equal(http.externalHref, "http://example.test/material");

  const sourceOnly = resourcePreviewPlan({ href: "https://example.test/source", disposition: "source-only" });
  assert.equal(sourceOnly.mode, "external-only");
  assert.match(sourceOnly.reason, /原始出處/);

  const missing = resourcePreviewPlan({});
  assert.equal(missing.mode, "unavailable");
  assert.match(missing.reason, /仍予保留/);
});

const ctextReferences = ctextLesson.resources.filter((resource) => new URL(resource.href, "https://yw.bdfz.net").hostname === "ctext.org");
const screenshotStateSource = section("    state.previewScreenshotBySource =", "    state.directRemoteAppRoots =");
const screenshotLookupSource = section("function previewScreenshotFor", "function directRemoteAppRootFor");

function ctextPreviewPlanner(screenshots = previewScreenshots) {
  return new Function(
    "location", "resourcePreviewUrl", "resourceIdentity", "state", "previewScreenshots",
    `${screenshotStateSource}\n${screenshotLookupSource}\n${previewPlanSource}; return resourcePreviewPlan;`,
  )(
    { href: "https://yw.bdfz.net/#lesson-1474", origin: "https://yw.bdfz.net" },
    (href) => `/api/preview?url=${encodeURIComponent(href)}`,
    resourceIdentity,
    { directRemoteAppRoots: new Set() },
    screenshots,
  );
}

test("the four reviewed CText references use dated first-viewport images and retain full source URLs", () => {
  const planFor = ctextPreviewPlanner();
  assert.equal(ctextReferences.length, 4);
  for (const resource of ctextReferences) {
    const entry = previewScreenshots.entries.find((entry) => resourceIdentity(entry.sourceUrl) === resourceIdentity(resource.href));
    assert.ok(entry);
    const plan = planFor(resource);
    assert.equal(plan.mode, "image");
    assert.equal(plan.src, entry.screenshotUrl);
    assert.equal(plan.externalHref, resource.href);
    assert.equal(plan.screenshot, true);
    assert.equal(plan.ctextSnapshot, true);
    assert.equal(plan.fallbackScreenshotSrc, "");
    assert.match(plan.reason, /2026-08-11 保存的首屏截圖，並非全文/);
    assert.match(plan.reason, /另頁開啟原站/);
  }
  assert.ok(ctextReferences.some((resource) => resource.href.endsWith("#n9662")));
  assert.equal(ctextReferences.filter((resource) => new URL(resource.href).search).length, 2);
});

test("CText local plans still obey source, protocol and screenshot-availability guards", () => {
  const planFor = ctextPreviewPlanner();
  const missingImagePlanFor = ctextPreviewPlanner({ ...previewScreenshots, entries: [] });
  for (const resource of ctextReferences) {
    for (const disposition of ["source-only", "blocked-external"]) {
      const plan = planFor({ ...resource, disposition });
      assert.equal(plan.mode, "external-only");
      assert.equal(plan.ctextSnapshot, undefined);
    }
    const http = planFor({ ...resource, href: resource.href.replace("https:", "http:") });
    assert.equal(http.mode, "external-only");
    assert.equal(http.ctextSnapshot, undefined);
    const missingImage = missingImagePlanFor(resource);
    assert.equal(missingImage.mode, "iframe");
    assert.match(missingImage.src, /^\/api\/preview\?/);
    assert.equal(missingImage.ctextSnapshot, undefined);
  }
  assert.equal(planFor({ href: "javascript:alert(1)" }).mode, "unavailable");
  for (const capturedAt of [null, undefined, [previewScreenshots.capturedAt]]) {
    const missingDate = ctextPreviewPlanner({ ...previewScreenshots, capturedAt })(ctextReferences[0]);
    assert.match(missingDate.reason, /^已保存的首屏截圖，並非全文/);
    assert.doesNotMatch(missingDate.reason, /2026|undefined|null/);
  }
});

test("other CText references and future semantic queries retain the existing remote-first policy", () => {
  const future = "https://ctext.org/analects/zh?searchu=%E5%AD%B8";
  const screenshots = {
    ...previewScreenshots,
    entries: [...previewScreenshots.entries, { sourceUrl: future, screenshotUrl: "/assets/preview-screenshots/future.webp" }],
  };
  const planFor = ctextPreviewPlanner(screenshots);
  const other = previewScreenshots.entries.find((entry) => entry.sourceUrl === "https://ctext.org/shiji/li-sheng-lu-jia-lie-zhuan/zh");
  assert.ok(other);
  for (const href of [other.sourceUrl, future, "https://ctext.org/analects/zh?searchu=%E6%95%8F&searchmode=showall"]) {
    const plan = planFor({ href });
    assert.equal(plan.mode, "iframe");
    assert.match(plan.src, /^\/api\/preview\?/);
    assert.equal(plan.externalHref, href);
    assert.equal(plan.ctextSnapshot, undefined);
  }
  assert.equal(planFor({ href: other.sourceUrl }).fallbackScreenshotSrc, other.screenshotUrl);
});

function previewMountFixture() {
  const requests = [];
  const dialogs = [];
  const makeHost = (inDialog = false) => {
    const note = { textContent: "" };
    const host = {
      isConnected: true, dataset: {}, children: [], innerHTML: "", note,
      closest: () => inDialog ? null : { querySelector: () => note },
      classList: { add() {} },
      append(element) { this.children.push(element); },
      replaceChildren(...elements) { this.children = elements; },
    };
    return host;
  };
  const document = {
    createElement(tag) {
      return {
        tag, events: new Map(),
        setAttribute() {},
        addEventListener(event, handler) { this.events.set(event, handler); },
      };
    },
  };
  const mountSource = section("function previewPlaceholder", "function isNonContentResource");
  const mount = new Function(
    "document", "fetch", "esc", "openResourcePlan",
    `${mountSource}; return mountResourcePreview;`,
  )(
    document,
    async (url) => { requests.push(url); return new Response("upstream unavailable", { status: 521 }); },
    (value) => String(value),
    (plan, title) => {
      const host = makeHost(true);
      dialogs.push({ host, plan });
      mount(host, plan, title, { eager: true, expanded: true });
    },
  );
  return { mount, makeHost, requests, dialogs };
}

test("actual CText image mounting and enlargement issue no automatic proxy requests", async () => {
  const fixture = previewMountFixture();
  const planFor = ctextPreviewPlanner();
  for (const resource of ctextReferences) {
    const plan = planFor(resource);
    const host = fixture.makeHost();
    fixture.mount(host, plan, resource.label);
    assert.equal(host.children[0].tag, "img");
    assert.equal(host.children[0].src, plan.src);
    host.children[0].events.get("load")();
    assert.equal(host.dataset.previewState, "screenshot");
    host.children.find((element) => element.tag === "button").events.get("click")({ preventDefault() {}, stopPropagation() {} });
  }
  await new Promise(setImmediate);
  assert.equal(fixture.requests.length, 0);
  assert.equal(fixture.dialogs.length, 4);
  fixture.dialogs.forEach(({ host, plan }, index) => {
    assert.equal(host.children[0].tag, "img");
    assert.equal(host.children[0].src, plan.src);
    assert.equal(plan.externalHref, ctextReferences[index].href);
  });
});

test("a missing CText snapshot displays a failure in both card and dialog without retrying the proxy", async () => {
  const fixture = previewMountFixture();
  const plan = ctextPreviewPlanner()(ctextReferences[0]);
  for (const inDialog of [false, true]) {
    const host = fixture.makeHost(inDialog);
    fixture.mount(host, plan, "CText", { expanded: inDialog });
    host.children[0].events.get("error")();
    assert.equal(host.dataset.previewState, "failed");
    assert.match(host.innerHTML, /首屏截圖目前無法載入/);
    assert.match(host.innerHTML, /原頁連結/);
  }
  await new Promise(setImmediate);
  assert.equal(fixture.requests.length, 0);
});

test("an unrelated CText 521 still follows the existing screenshot fallback", async () => {
  const fixture = previewMountFixture();
  const plan = ctextPreviewPlanner()({ href: "https://ctext.org/shiji/li-sheng-lu-jia-lie-zhuan/zh" });
  const host = fixture.makeHost();
  fixture.mount(host, plan, "史記");
  await new Promise(setImmediate);
  assert.equal(fixture.requests.length, 1);
  assert.match(fixture.requests[0], /^\/api\/preview\?/);
  assert.equal(host.children[0].tag, "img");
  assert.equal(host.children[0].src, plan.fallbackScreenshotSrc);
});

test("same-origin lesson pages and documents preview directly", () => {
  const previewUrlSource = section("function resourcePreviewUrl", "function openResource");
  const resourcePreviewUrl = new Function(
    "location",
    `${previewUrlSource}; return resourcePreviewUrl;`,
  )({ href: "https://yw.bdfz.net/#lesson", origin: "https://yw.bdfz.net" });

  assert.equal(resourcePreviewUrl("books.html?q=史記"), "https://yw.bdfz.net/books.html?q=%E5%8F%B2%E8%A8%98");
  assert.equal(resourcePreviewUrl("media/lesson.pdf"), "https://yw.bdfz.net/media/lesson.pdf");
  assert.match(resourcePreviewUrl("https://pkuschool.yuque.com/example/lesson"), /^\/api\/preview\?url=/);
});

test("reviewed embeds expand immediately, use real remote sites, and never restore xue", () => {
  const matrixSource = section("function matrixItemsFor", "function renderMatrix");
  const activationSource = section("function activateExpandedPreviews", "function renderMastery");
  const mediaSource = section("function renderLessonMedia", "function readerMediaMap");
  const mountSource = section("function mountResourcePreview", "function isNonContentResource");
  const dialogSource = section("function openResourcePlan", "function restoreInlineNoteText");
  const eventSource = section("function bindEvents", "async function init");

  assert.doesNotMatch(matrixSource, /xue\.bdfz\.net/);
  assert.doesNotMatch(matrixSource, /此刻同讀|原帖共讀|kind: "together"/);
  assert.match(activationSource, /frames\.forEach\(load\)/);
  assert.doesNotMatch(activationSource, /IntersectionObserver/);
  assert.match(mediaSource, /data-slide-preview/);
  assert.match(mediaSource, /mountResourcePreview/);
  assert.doesNotMatch(mediaSource, /data-slide-open/);
  assert.match(mountSource, /className = "preview-expand"/);
  assert.match(mountSource, /openResourcePlan\(plan, title\)/);
  assert.match(mountSource, /inlinePreviewUsable\(plan\.src\)/);
  assert.match(mountSource, /screenshotFallbackPlan\(plan\)/);
  assert.match(mountSource, /element\.loading = eager \? "eager" : "lazy"/);
  assert.doesNotMatch(mountSource, /eager \|\| plan\.mode === "remote-app"/);
  assert.match(mountSource, /plan\.mode === "youtube" && !eager/);
  assert.match(mountSource, /className = "youtube-preview-play"/);
  assert.match(mountSource, /autoplay\.searchParams\.set\("autoplay", "1"\)/);
  assert.match(mountSource, /\["remote-app", "youtube"\]\.includes\(plan\.mode\)/);
  assert.match(mountSource, /allow-scripts allow-same-origin allow-forms[^"]*allow-presentation/);
  assert.match(mountSource, /element\.referrerPolicy = "strict-origin-when-cross-origin"/);
  assert.match(mountSource, /element\.allowFullscreen = true/);
  assert.match(mountSource, /沒有經驗證的本機截圖/);
  assert.match(dialogSource, /mountResourcePreview\(els\.resourceStage, plan, title, \{ eager: true, expanded: true \}\)/);
  assert.match(eventSource, /els\.resourceStage\.replaceChildren\(\)/);
  assert.match(indexHtml, /id="resource-dialog-stage"/);
  assert.doesNotMatch(indexHtml, /id="resource-frame"/);
  assert.match(indexHtml, />簡報預覽</);
});
