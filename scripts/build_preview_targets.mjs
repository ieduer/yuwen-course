#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { previewUrlHasPublicHostname } from "../site/preview-network-policy.js";
import { isRemovedWebResource } from "./web_resource_policy.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DOCUMENTS_DIR = resolve(ROOT, "site/data/reader-documents");
const REDIRECTS_PATH = resolve(ROOT, "site/data/resource_redirects.json");
const WECHAT_ARCHIVE_MAP_PATH = resolve(ROOT, "site/data/wechat-archive-map.json");
const OUTPUT_PATH = resolve(ROOT, "site/data/preview-targets.json");
const FORUM_ORIGIN = "https://forum.rdfzer.com";
const WECHAT_SOURCE_HOST = "mp.weixin.qq.com";
const WECHAT_ARCHIVE_HOST = "wx.bdfz.net";

export const DIRECT_REMOTE_APP_ROOTS = Object.freeze([
  "https://coread.bdfz.net/",
  "https://flx.bdfz.net/",
  "https://gk.bdfz.net/",
  "https://gks.bdfz.net/",
  "https://gksw.bdfz.net/",
  "https://gwyw.bdfz.net/",
  "https://kz.bdfz.net/",
  "https://ly.bdfz.net/",
  "https://mf.bdfz.net/",
  "https://qx.bdfz.net/",
  "https://recite.bdfz.net/",
  "https://shi.bdfz.net/",
  "https://sy.bdfz.net/",
  "https://voice.bdfz.net/",
  "https://wygame.bdfz.net/",
  "https://yyjc.bdfz.net/",
  "https://zw.bdfz.net/",
]);

// Backward-compatible export for the existing verification suite. The registry
// field below is the browser/runtime authority for direct remote app embeds.
export const BDFZ_EMBED_ROOTS = DIRECT_REMOTE_APP_ROOTS;

export const EXACT_PREVIEW_REDIRECT_TARGETS = Object.freeze([]);

function normalize(raw) {
  const url = new URL(String(raw || ""), FORUM_ORIGIN);
  if (!previewUrlHasPublicHostname(url)) return "";
  url.hash = "";
  return url.toString();
}

function loadWechatArchiveMap() {
  const document = JSON.parse(readFileSync(WECHAT_ARCHIVE_MAP_PATH, "utf8"));
  if (document?.schemaVersion !== "yw-wechat-archive-map-v1" || !Array.isArray(document.entries)) {
    throw new Error("invalid WeChat archive map schema");
  }
  const mappings = new Map();
  for (const entry of document.entries) {
    const sourceUrl = normalize(entry?.sourceUrl);
    const archiveUrl = normalize(entry?.archiveUrl);
    if (!sourceUrl || new URL(sourceUrl).hostname !== WECHAT_SOURCE_HOST) {
      throw new Error(`invalid WeChat source URL: ${entry?.sourceUrl || "missing"}`);
    }
    if (!archiveUrl || new URL(archiveUrl).hostname !== WECHAT_ARCHIVE_HOST) {
      throw new Error(`invalid WeChat archive URL: ${entry?.archiveUrl || "missing"}`);
    }
    if (!String(entry?.title || "").trim()) {
      throw new Error(`missing WeChat archive title: ${sourceUrl}`);
    }
    if (mappings.has(sourceUrl)) throw new Error(`duplicate WeChat source URL: ${sourceUrl}`);
    mappings.set(sourceUrl, { sourceUrl, archiveUrl, title: String(entry.title).trim() });
  }
  return mappings;
}

const WECHAT_ARCHIVES = loadWechatArchiveMap();

function previewTarget(rawHref) {
  const href = normalize(rawHref);
  if (!href || new URL(href).hostname !== WECHAT_SOURCE_HOST) return href;
  const mapped = WECHAT_ARCHIVES.get(href);
  if (!mapped) throw new Error(`unmapped WeChat preview source: ${href}`);
  return mapped.archiveUrl;
}

function acceptedResource(resource) {
  if (!resource?.href || resource.disposition === "source-only" || resource.disposition === "blocked-http") return "";
  const href = previewTarget(resource.href);
  if (!href) return "";
  const url = new URL(href);
  if (url.hostname === "bdfz.yuque.com") return "";
  if (isRemovedWebResource(href)) return "";
  if (url.hostname === new URL(FORUM_ORIGIN).hostname && /^\/u(?:\/|$)/i.test(url.pathname)) return "";
  return href;
}

function collectResourceLinks(value, output) {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectResourceLinks(entry, output));
    return;
  }
  if (!value || typeof value !== "object") return;
  if (value.type === "resource-link") {
    const target = acceptedResource(value);
    if (target) output.add(target);
  }
  Object.values(value).forEach((entry) => collectResourceLinks(entry, output));
}

export function buildPreviewTargets() {
  const targets = new Set(DIRECT_REMOTE_APP_ROOTS);
  for (const entry of WECHAT_ARCHIVES.values()) targets.add(entry.archiveUrl);
  for (const name of readdirSync(DOCUMENTS_DIR).filter((entry) => entry.endsWith(".json")).sort()) {
    const document = JSON.parse(readFileSync(resolve(DOCUMENTS_DIR, name), "utf8"));
    for (const resource of document.resources || []) {
      const target = acceptedResource(resource);
      if (target) targets.add(target);
    }
    collectResourceLinks(document.main?.blocks || [], targets);
    collectResourceLinks(document.supplementary || [], targets);
  }

  const redirects = existsSync(REDIRECTS_PATH)
    ? JSON.parse(readFileSync(REDIRECTS_PATH, "utf8"))?.redirects || {}
    : {};
  const redirectTargets = [...new Set([
    ...Object.values(redirects).map(normalize).filter((entry) => entry && !isRemovedWebResource(entry)),
    ...EXACT_PREVIEW_REDIRECT_TARGETS,
  ])].sort();
  const sortedTargets = [...targets].sort();
  const allowedHosts = [...new Set([...sortedTargets, ...redirectTargets].map((entry) => new URL(entry).hostname))].sort();
  const directRemoteAppRoots = [...DIRECT_REMOTE_APP_ROOTS].sort();
  const digestInput = JSON.stringify({ targets: sortedTargets, redirectTargets, allowedHosts, directRemoteAppRoots });
  const digest = createHash("sha256").update(digestInput).digest("hex");
  return {
    schemaVersion: "yw-preview-targets-v1",
    targetDigest: `sha256:${digest}`,
    targetCount: sortedTargets.length,
    redirectTargetCount: redirectTargets.length,
    allowedHostCount: allowedHosts.length,
    directRemoteAppRootCount: directRemoteAppRoots.length,
    directRemoteAppRoots,
    targets: sortedTargets,
    redirectTargets,
    allowedHosts,
  };
}

export function renderPreviewTargets() {
  return `${JSON.stringify(buildPreviewTargets(), null, 2)}\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rendered = renderPreviewTargets();
  if (process.argv.includes("--check")) {
    if (!existsSync(OUTPUT_PATH) || readFileSync(OUTPUT_PATH, "utf8") !== rendered) {
      throw new Error("site/data/preview-targets.json is stale");
    }
    process.stdout.write("preview target registry current\n");
  } else {
    writeFileSync(OUTPUT_PATH, rendered, "utf8");
    process.stdout.write(`generated ${buildPreviewTargets().targetCount} preview targets\n`);
  }
}
