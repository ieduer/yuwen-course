import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const APP_PATH = new URL("../site/assets/app.js", import.meta.url);
const INDEX_PATH = new URL("../site/index.html", import.meta.url);
const source = await readFile(APP_PATH, "utf8");
const indexHtml = await readFile(INDEX_PATH, "utf8");

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

const resourcesSource = section("function resourcesFor", "function renderSupplementaryMaterials");
const resourcesFor = new Function(
  "absoluteResourceUrl",
  "resourceTitle",
  "resourceIdentity",
  `${resourcesSource}; return resourcesFor;`,
)(
  (value) => value,
  (resource) => resource.text || resource.title || resource.label || "學習資料",
  resourceIdentity,
);

test("resource list keeps unavailable fallbacks and distinct WeChat article indices", () => {
  const resources = resourcesFor({
    resources: [
      { href: "https://mp.weixin.qq.com/s?mid=7&idx=1&utm_source=a", text: "微信一" },
      { href: "https://mp.weixin.qq.com/s?mid=7&idx=1&utm_medium=b#dup", text: "微信一重複" },
      { href: "https://mp.weixin.qq.com/s?mid=7&idx=2", text: "微信二" },
      { sourceUrl: "http://example.test/source", disposition: "source-only", text: "原始出處" },
      { href: "https://www.yuque.com/example/lesson", text: "語雀資料" },
    ],
  });

  assert.equal(resources.length, 4);
  assert.equal(resources.filter((item) => item.href.includes("mp.weixin.qq.com")).length, 2);
  assert.ok(resources.some((item) => item.href === "http://example.test/source"));
  assert.ok(resources.some((item) => item.href.includes("yuque.com")));
});

const previewPlanSource = section("function resourcePreviewPlan", "function previewFallback");
const resourcePreviewPlan = new Function(
  "location",
  "resourcePreviewUrl",
  `${previewPlanSource}; return resourcePreviewPlan;`,
)(
  { href: "https://yw.bdfz.net/#lesson" },
  (href) => href.startsWith("https://yw.bdfz.net/") ? href : `/api/preview?url=${encodeURIComponent(href)}`,
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

  assert.match(matrixSource, /href: "https:\/\/xue\.bdfz\.net\/"/);
  assert.doesNotMatch(matrixSource, /此刻同讀|原帖共讀|kind: "together"/);
  assert.match(activationSource, /frames\.forEach\(load\)/);
  assert.doesNotMatch(activationSource, /IntersectionObserver/);
  assert.match(mediaSource, /data-slide-preview/);
  assert.match(mediaSource, /mountResourcePreview/);
  assert.doesNotMatch(mediaSource, /data-slide-open/);
  assert.match(indexHtml, />簡報預覽</);
});
