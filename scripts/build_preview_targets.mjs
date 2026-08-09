#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { previewUrlHasPublicHostname } from "../site/preview-network-policy.js";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DOCUMENTS_DIR = resolve(ROOT, "site/data/reader-documents");
const REDIRECTS_PATH = resolve(ROOT, "site/data/resource_redirects.json");
const OUTPUT_PATH = resolve(ROOT, "site/data/preview-targets.json");
const FORUM_ORIGIN = "https://forum.rdfzer.com";

function normalize(raw) {
  const url = new URL(String(raw || ""), FORUM_ORIGIN);
  if (!previewUrlHasPublicHostname(url)) return "";
  url.hash = "";
  return url.toString();
}

function acceptedResource(resource) {
  if (!resource?.href || resource.disposition === "source-only" || resource.disposition === "blocked-http") return false;
  const href = normalize(resource.href);
  return Boolean(href && !/sites\.google\.com|yuque\.com|\/u\//i.test(href));
}

function collectResourceLinks(value, output) {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectResourceLinks(entry, output));
    return;
  }
  if (!value || typeof value !== "object") return;
  if (value.type === "resource-link" && acceptedResource(value)) output.add(normalize(value.href));
  Object.values(value).forEach((entry) => collectResourceLinks(entry, output));
}

export function buildPreviewTargets() {
  const targets = new Set();
  for (const name of readdirSync(DOCUMENTS_DIR).filter((entry) => entry.endsWith(".json")).sort()) {
    const document = JSON.parse(readFileSync(resolve(DOCUMENTS_DIR, name), "utf8"));
    for (const resource of document.resources || []) {
      if (acceptedResource(resource)) targets.add(normalize(resource.href));
    }
    collectResourceLinks(document.main?.blocks || [], targets);
    collectResourceLinks(document.supplementary || [], targets);
  }

  const redirects = existsSync(REDIRECTS_PATH)
    ? JSON.parse(readFileSync(REDIRECTS_PATH, "utf8"))?.redirects || {}
    : {};
  const redirectTargets = [...new Set(Object.values(redirects).map(normalize).filter(Boolean))].sort();
  const sortedTargets = [...targets].sort();
  const allowedHosts = [...new Set([...sortedTargets, ...redirectTargets].map((entry) => new URL(entry).hostname))].sort();
  const digestInput = JSON.stringify({ targets: sortedTargets, redirectTargets, allowedHosts });
  const digest = createHash("sha256").update(digestInput).digest("hex");
  return {
    schemaVersion: "yw-preview-targets-v1",
    targetDigest: `sha256:${digest}`,
    targetCount: sortedTargets.length,
    redirectTargetCount: redirectTargets.length,
    allowedHostCount: allowedHosts.length,
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
