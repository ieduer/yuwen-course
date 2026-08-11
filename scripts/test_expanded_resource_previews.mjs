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
  `${projectionSource}; return { keys: REMOVED_WEB_RESOURCE_KEYS, isRemoved: isRemovedWebResource };`,
)();
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

test("resource list maps WeChat archives, removes bdfz Yuque, and preserves source provenance", () => {
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

  assert.equal(resources.length, 3);
  assert.equal(resources.filter((item) => new URL(item.href).hostname === "mp.weixin.qq.com").length, 0);
  assert.equal(resources.filter((item) => new URL(item.href).hostname === "bdfz.yuque.com").length, 0);
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

const previewPlanSource = section("function resourcePreviewPlan", "function previewFallback");
const resourcePreviewPlan = new Function(
  "location",
  "resourcePreviewUrl",
  "previewScreenshotFor",
  `${previewPlanSource}; return resourcePreviewPlan;`,
)(
  { href: "https://yw.bdfz.net/#lesson" },
  (href) => href.startsWith("https://yw.bdfz.net/") ? href : `/api/preview?url=${encodeURIComponent(href)}`,
  () => null,
);

test("preview plan expands safe resources and gives explicit external fallbacks", () => {
  assert.equal(resourcePreviewPlan({ href: "https://yw.bdfz.net/slides/lesson.pdf", kind: "document" }).mode, "document");
  assert.equal(resourcePreviewPlan({ href: "https://xue.bdfz.net/" }).mode, "iframe");
  assert.equal(resourcePreviewPlan({ href: "https://img.bdfz.net/page.webp" }).mode, "image");

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

test("same-origin lesson pages and documents preview directly", () => {
  const previewUrlSource = section("function resourcePreviewUrl", "function openResource");
  const resourcePreviewUrl = new Function(
    "location",
    `${previewUrlSource}; return resourcePreviewUrl;`,
  )({ href: "https://yw.bdfz.net/#lesson", origin: "https://yw.bdfz.net" });

  assert.equal(resourcePreviewUrl("books.html?q=史記"), "https://yw.bdfz.net/books.html?q=%E5%8F%B2%E8%A8%98");
  assert.equal(resourcePreviewUrl("media/lesson.pdf"), "https://yw.bdfz.net/media/lesson.pdf");
  assert.match(resourcePreviewUrl("https://xue.bdfz.net/"), /^\/api\/preview\?url=/);
});

test("capability migration is expanded immediately, deduplicated, and points to exact cross-book root", () => {
  const matrixSource = section("function matrixItemsFor", "function renderMatrix");
  const activationSource = section("function activateExpandedPreviews", "function renderMastery");
  const mediaSource = section("function renderLessonMedia", "function readerMediaMap");
  const mountSource = section("function mountResourcePreview", "function isNonContentResource");
  const dialogSource = section("function openResourcePlan", "function restoreInlineNoteText");
  const eventSource = section("function bindEvents", "async function init");

  assert.match(matrixSource, /href: "https:\/\/xue\.bdfz\.net\/"/);
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
  assert.match(mountSource, /沒有經驗證的本機截圖/);
  assert.match(dialogSource, /mountResourcePreview\(els\.resourceStage, plan, title, \{ eager: true, expanded: true \}\)/);
  assert.match(eventSource, /els\.resourceStage\.replaceChildren\(\)/);
  assert.match(indexHtml, /id="resource-dialog-stage"/);
  assert.doesNotMatch(indexHtml, /id="resource-frame"/);
  assert.match(indexHtml, />簡報預覽</);
});
