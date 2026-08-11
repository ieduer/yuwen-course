import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { resolve } from "node:path";
import {
  BDFZ_EMBED_ROOTS,
  DIRECT_REMOTE_APP_ROOTS,
  EXACT_PREVIEW_REDIRECT_TARGETS,
  buildPreviewTargets,
  renderPreviewTargets,
} from "./build_preview_targets.mjs";
import { previewUrlHasPublicHostname } from "../site/preview-network-policy.js";
import worker from "../site/_worker.js";
import {
  REMOVED_WEB_RESOURCE_HOSTS,
  REMOVED_WEB_RESOURCE_URLS,
  isRemovedWebResource,
  webResourceKey,
} from "./web_resource_policy.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const DOCUMENTS_DIR = resolve(ROOT, "site/data/reader-documents");
const WECHAT_MAP_PATH = resolve(ROOT, "site/data/wechat-archive-map.json");
const APP_PATH = resolve(ROOT, "site/assets/app.js");
const TAXONOMY_PATH = resolve(ROOT, "site/data/literary-taxonomy.json");
const REMOVED_EMPTY_SCDFZ_URL = "https://www.scdfz.org.cn/ztzl/hjczzsc/zzhy/content_30068";
const PRESERVED_SCDFZ_URL = "https://www.scdfz.org.cn/scdqs/sxdq/lss/jwx/content_22151";
const PRESERVED_EXTERNAL_CONDITION_URLS = Object.freeze([
  "https://j-dac.jp/infolib/meta_pub/CsvSearch.cgi",
  "https://pkuschool.yuque.com/g/qrvbic/books/folder/29416843",
  "https://pkuschool.yuque.com/qrvbic/books/29585115",
  "https://www.imdb.com/title/tt1475582/",
  PRESERVED_SCDFZ_URL,
  "https://www.shuge.org/view/lan_ting_xiu_xi_tu_juan/",
]);

function normalizedUrl(raw) {
  const url = new URL(String(raw || ""), "https://forum.rdfzer.com");
  url.hash = "";
  return url.toString();
}

function collectStudentWechatSources() {
  const sources = new Set();
  const collect = (value) => {
    if (Array.isArray(value)) {
      value.forEach(collect);
      return;
    }
    if (!value || typeof value !== "object") return;
    const source = value.sourceUrl || value.href || "";
    if (source) {
      const url = new URL(source, "https://forum.rdfzer.com");
      if (url.hostname === "mp.weixin.qq.com") sources.add(normalizedUrl(source));
    }
    Object.values(value).forEach(collect);
  };
  for (const name of readdirSync(DOCUMENTS_DIR).filter((entry) => entry.endsWith(".json")).sort()) {
    const document = JSON.parse(readFileSync(resolve(DOCUMENTS_DIR, name), "utf8"));
    collect(document.resources || []);
    collect(document.main?.blocks || []);
    collect(document.supplementary || []);
  }
  return sources;
}

test("preview proxy accepts only the generated authoritative resource registry", () => {
  const registry = buildPreviewTargets();
  assert.equal(registry.schemaVersion, "yw-preview-targets-v1");
  assert.ok(registry.targetCount > 0);
  assert.equal(new Set(registry.targets).size, registry.targetCount);
  assert.equal(registry.targets.every((entry) => entry.startsWith("https://")), true);
  assert.equal(registry.targets.some((entry) => /(?:localhost|127\.0\.0\.1|192\.168\.)/.test(entry)), false);
  assert.equal(registry.targets.some((entry) => entry.includes("BV1Zg4y1H7fK")), false);
  assert.deepEqual(REMOVED_WEB_RESOURCE_HOSTS, ["xue.bdfz.net"]);
  for (const href of [
    "https://xue.bdfz.net/",
    "https://xue.bdfz.net/template/",
    "https://xue.bdfz.net/arbitrary?lesson=1#section",
  ]) assert.equal(isRemovedWebResource(href), true, href);
  assert.equal(isRemovedWebResource("https://xue.bdfz.net.example.com/"), false);
  assert.equal(registry.targets.some((entry) => new URL(entry).hostname === "xue.bdfz.net"), false);
  assert.equal(registry.redirectTargets.some((entry) => new URL(entry).hostname === "xue.bdfz.net"), false);
  assert.equal(registry.allowedHosts.includes("xue.bdfz.net"), false);
  const targetKeys = new Set(registry.targets.map(webResourceKey));
  assert.equal(isRemovedWebResource(REMOVED_EMPTY_SCDFZ_URL), true);
  assert.equal(isRemovedWebResource(PRESERVED_SCDFZ_URL), false);
  assert.equal(targetKeys.has(webResourceKey(REMOVED_EMPTY_SCDFZ_URL)), false);
  assert.equal(targetKeys.has(webResourceKey(PRESERVED_SCDFZ_URL)), true);
  for (const href of REMOVED_WEB_RESOURCE_URLS) {
    assert.equal(targetKeys.has(webResourceKey(href)), false, href);
  }
  for (const href of PRESERVED_EXTERNAL_CONDITION_URLS) {
    assert.equal(targetKeys.has(webResourceKey(href)), true, href);
  }
  assert.equal(
    readFileSync(resolve(ROOT, "site/data/preview-targets.json"), "utf8"),
    renderPreviewTargets(),
  );
});

test("every student-visible WeChat source has one reviewed wx archive and no direct preview target", () => {
  const document = JSON.parse(readFileSync(WECHAT_MAP_PATH, "utf8"));
  assert.equal(document.schemaVersion, "yw-wechat-archive-map-v1");
  assert.equal(document.entries.length, 9);

  const sourceUrls = document.entries.map((entry) => normalizedUrl(entry.sourceUrl));
  const archiveUrls = document.entries.map((entry) => normalizedUrl(entry.archiveUrl));
  assert.equal(new Set(sourceUrls).size, document.entries.length);
  assert.equal(new Set(archiveUrls).size, document.entries.length);
  assert.deepEqual(new Set(sourceUrls), collectStudentWechatSources());
  const bySource = new Map(document.entries.map((entry) => [normalizedUrl(entry.sourceUrl), entry]));
  const pairedIssue = (index) => normalizedUrl(
    `https://mp.weixin.qq.com/s?__biz=Mzg3NzA4Mzc1NQ%3D%3D&mid=2247484112&idx=${index}&lang=zh_CN#rd`,
  );
  assert.deepEqual(
    [bySource.get(pairedIssue(1))?.archiveUrl, bySource.get(pairedIssue(1))?.title],
    ["https://wx.bdfz.net/wx-17bfb2fe", "中国人民从此站起来了！（上）"],
  );
  assert.deepEqual(
    [bySource.get(pairedIssue(2))?.archiveUrl, bySource.get(pairedIssue(2))?.title],
    ["https://wx.bdfz.net/wx-0a6b4105", "中国人民从此站起来了！（下）"],
  );
  assert.equal(
    bySource.get(normalizedUrl("https://mp.weixin.qq.com/s/tYH4zeFK6M7oo0RxVp-EKg"))?.archiveUrl,
    "https://wx.bdfz.net/20-28363bfb",
  );
  for (const entry of document.entries) {
    assert.equal(new URL(entry.sourceUrl).hostname, "mp.weixin.qq.com");
    assert.equal(new URL(entry.archiveUrl).hostname, "wx.bdfz.net");
    assert.ok(String(entry.title || "").trim(), entry.sourceUrl);
  }

  const registry = buildPreviewTargets();
  assert.equal(
    registry.targets.some((entry) => new URL(entry).hostname === "mp.weixin.qq.com"),
    false,
  );
  for (const archiveUrl of archiveUrls) assert.ok(registry.targets.includes(archiveUrl), archiveUrl);
});

test("bdfz embedded-app registry exposes only the 17 reviewed exact roots", () => {
  assert.equal(BDFZ_EMBED_ROOTS, DIRECT_REMOTE_APP_ROOTS);
  assert.equal(DIRECT_REMOTE_APP_ROOTS.length, 17);
  assert.equal(new Set(BDFZ_EMBED_ROOTS).size, BDFZ_EMBED_ROOTS.length);
  const appSource = readFileSync(APP_PATH, "utf8");
  const matrixSource = appSource.slice(
    appSource.indexOf("function matrixItemsFor"),
    appSource.indexOf("function renderMatrix"),
  );
  const taxonomy = JSON.parse(readFileSync(TAXONOMY_PATH, "utf8"));
  const exactConsumers = new Set(
    [...matrixSource.matchAll(/https:\/\/[a-z0-9-]+\.bdfz\.net\//g)].map((match) => match[0]),
  );
  for (const author of taxonomy.authors || []) {
    if (!author.url) continue;
    const url = new URL(author.url);
    if (url.hostname === "qx.bdfz.net") exactConsumers.add(`${url.origin}/`);
  }
  assert.deepEqual([...BDFZ_EMBED_ROOTS].sort(), [...exactConsumers].sort());
  const registry = buildPreviewTargets();
  assert.equal(registry.directRemoteAppRootCount, 17);
  assert.deepEqual(registry.directRemoteAppRoots, [...DIRECT_REMOTE_APP_ROOTS].sort());
  for (const root of BDFZ_EMBED_ROOTS) {
    assert.equal(new URL(root).pathname, "/");
    assert.equal(new URL(root).search, "");
    assert.equal(new URL(root).hash, "");
    assert.ok(registry.targets.includes(root), root);
    assert.ok(registry.directRemoteAppRoots.includes(root), root);
    const url = new URL(root);
    for (const nonRoot of [
      new URL("unregistered-path", url).toString(),
      `${root}?unregistered=1`,
      `${root}#unregistered`,
    ]) assert.equal(registry.directRemoteAppRoots.includes(nonRoot), false, nonRoot);
  }
  assert.equal(registry.targets.includes("https://unregistered.bdfz.net/"), false);
  assert.equal(registry.targets.includes("https://gwyw.bdfz.net/unregistered-sensitive-path"), false);
  assert.deepEqual(EXACT_PREVIEW_REDIRECT_TARGETS, []);
});

test("exact Google Sites and non-BDFZ Yuque lessons are previewable without reopening blocked links", () => {
  const registry = buildPreviewTargets();
  const googleSite = registry.targets.find((entry) => new URL(entry).hostname === "sites.google.com");
  const schoolYuque = registry.targets.find((entry) => new URL(entry).hostname === "pkuschool.yuque.com");
  assert.ok(googleSite, "expected one exact Google Sites lesson target");
  assert.ok(schoolYuque, "expected one exact PKU School Yuque lesson target");
  assert.equal(registry.targets.some((entry) => new URL(entry).hostname === "bdfz.yuque.com"), false);

  const arbitraryGoogle = new URL(googleSite);
  arbitraryGoogle.pathname = "/view/pkuschool/unregistered-preview-path";
  arbitraryGoogle.search = "";
  assert.equal(registry.targets.includes(arbitraryGoogle.toString()), false);

  const arbitraryYuque = new URL(schoolYuque);
  arbitraryYuque.pathname = "/unregistered/preview-path";
  arbitraryYuque.search = "";
  assert.equal(registry.targets.includes(arbitraryYuque.toString()), false);
});

test("preview network policy rejects every address literal and non-public hostname form", () => {
  for (const target of [
    "https://127.0.0.1/x",
    "https://10.0.0.1/x",
    "https://169.254.169.254/latest/meta-data",
    "https://[::1]/x",
    "https://[::ffff:7f00:1]/x",
    "https://[::ffff:a00:1]/x",
    "https://[fe90::1]/x",
    "https://[febf::1]/x",
    "https://service.internal/x",
    "https://singlelabel/x",
  ]) assert.equal(previewUrlHasPublicHostname(new URL(target)), false, target);
  assert.equal(previewUrlHasPublicHostname(new URL("https://ctext.org/pre-qin-and-han/zh")), true);
});

test("preview Worker denies unregistered targets and never emits wildcard CORS", async () => {
  const registry = buildPreviewTargets();
  const target = registry.targets.find((entry) => new URL(entry).hostname === "zh.wikipedia.org")
    || registry.targets[0];
  const env = {
    ASSETS: {
      async fetch(request) {
        const pathname = new URL(request.url).pathname;
        if (pathname === "/data/preview-targets.json") return Response.json(registry);
        if (pathname === "/data/resource_redirects.json") return Response.json({ redirects: {} });
        return new Response("not found", { status: 404 });
      },
    },
  };
  const denied = await worker.fetch(
    new Request("https://yw.bdfz.net/api/preview?url=https%3A%2F%2Fexample.com%2Funregistered"),
    env,
    {},
  );
  assert.equal(denied.status, 403);

  for (const exactBdfzDenial of [
    "https://unregistered.bdfz.net/",
    "https://gwyw.bdfz.net/unregistered-sensitive-path",
    "https://sites.google.com/view/pkuschool/unregistered-preview-path",
    "https://pkuschool.yuque.com/unregistered/preview-path",
    "https://bdfz.yuque.com/org-wiki/blocked",
    "https://xue.bdfz.net/",
    "https://xue.bdfz.net/template/",
    REMOVED_EMPTY_SCDFZ_URL,
  ]) {
    const response = await worker.fetch(
      new Request(`https://yw.bdfz.net/api/preview?url=${encodeURIComponent(exactBdfzDenial)}`),
      env,
      {},
    );
    assert.equal(response.status, 403, exactBdfzDenial);
  }

  for (const privateTarget of [
    "https://[::ffff:7f00:1]/x",
    "https://[fe90::1]/x",
    "https://[febf::1]/x",
  ]) {
    const privateRegistry = {
      ...registry,
      targets: [privateTarget],
      targetCount: 1,
      redirectTargets: [],
      allowedHosts: [new URL(privateTarget).hostname],
    };
    const privateEnv = {
      ASSETS: {
        async fetch(request) {
          return new URL(request.url).pathname === "/data/preview-targets.json"
            ? Response.json(privateRegistry)
            : Response.json({ redirects: {} });
        },
      },
    };
    const blockedPrivate = await worker.fetch(
      new Request(`https://yw.bdfz.net/api/preview?url=${encodeURIComponent(privateTarget)}`),
      privateEnv,
      {},
    );
    assert.equal(blockedPrivate.status, 400, privateTarget);
  }

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response("%PDF-1.4", {
      headers: {
        "content-type": "application/pdf",
        "access-control-allow-origin": "*",
        "access-control-allow-credentials": "true",
      },
    });
    const allowed = await worker.fetch(
      new Request(`https://yw.bdfz.net/api/preview?url=${encodeURIComponent(target)}`),
      env,
      {},
    );
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get("access-control-allow-origin"), null);
    assert.equal(allowed.headers.get("access-control-allow-credentials"), null);
    assert.equal(allowed.headers.get("cross-origin-resource-policy"), "same-origin");

    for (const [contentType, body] of [
      ["application/javascript", "globalThis.previewPwned = true"],
      ["image/svg+xml", "<svg xmlns=\"http://www.w3.org/2000/svg\"><script>alert(1)</script></svg>"],
    ]) {
      globalThis.fetch = async () => new Response(body, { headers: { "content-type": contentType } });
      const rejected = await worker.fetch(
        new Request(`https://yw.bdfz.net/api/preview?url=${encodeURIComponent(target)}`),
        env,
        {},
      );
      assert.equal(rejected.status, 415);
      assert.equal(rejected.headers.get("x-content-type-options"), "nosniff");
      assert.match(rejected.headers.get("content-security-policy") || "", /default-src 'none'/);
      assert.doesNotMatch(await rejected.text(), /previewPwned|<svg/i);
    }

    const sameAllowedHost = new URL(target);
    sameAllowedHost.pathname = "/unregistered-sensitive-path";
    sameAllowedHost.search = "";
    globalThis.fetch = async () => new Response(null, {
      status: 302,
      headers: { location: sameAllowedHost.toString() },
    });
    const redirected = await worker.fetch(
      new Request(`https://yw.bdfz.net/api/preview?url=${encodeURIComponent(target)}`),
      env,
      {},
    );
    assert.equal(redirected.status, 502);
  } finally {
    globalThis.fetch = originalFetch;
  }

  const removedStaticProxy = await worker.fetch(
    new Request("https://yw.bdfz.net/static/unregistered-active-content.html"),
    env,
    {},
  );
  assert.equal(removedStaticProxy.status, 404);

  const workerSource = readFileSync(resolve(ROOT, "site/_worker.js"), "utf8");
  assert.doesNotMatch(workerSource, /access-control-allow-origin["']\s*,\s*["']\*["']/i);
  assert.doesNotMatch(workerSource, /function\s+rewritePreviewHtml/);
  assert.doesNotMatch(workerSource, /handleCtextStatic|pathname\.startsWith\(["']\/static\//);
  assert.match(workerSource, /new HTMLRewriter\(\)/);
});
