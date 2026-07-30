#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { parseHTML } from "linkedom";
import { createUrlSanitizer } from "./native_content_url_sanitizer.mjs";
import {
  extractReaderMediaTargets,
  validateReceiptLedger,
} from "./reader_media_receipts_lib.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const SITE = path.join(ROOT, "site");
const DATA = path.join(SITE, "data");
const SOURCE_MANIFEST_FILE = path.join(DATA, "manifest.json");
const CURATION_FILE = path.join(ROOT, "scripts", "reader_content_curation.v1.json");
const ROLE_AUDIT_FILE = path.join(ROOT, "scripts", "reader_role_audit.v1.json");
const MEDIA_RECEIPT_FILE = path.join(DATA, "reader-media-receipts.v1.json");
const MEDIA_ANOMALY_FILE = path.join(DATA, "reader-media-receipt-anomalies.v1.json");
const OUTPUT_ROOT = path.join(DATA, "reader-documents");
const FORUM_ORIGIN = "https://forum.rdfzer.com";
const ROLES = new Set([
  "primary",
  "supplementary",
  "resource-only",
  "discussion",
  "reply",
  "source-only",
]);
const BLOCK_ELEMENTS = new Set([
  "ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "DETAILS", "DIV", "DL",
  "FIELDSET", "FIGCAPTION", "FIGURE", "FOOTER", "FORM", "H1", "H2", "H3",
  "H4", "H5", "H6", "HEADER", "HR", "LI", "MAIN", "NAV", "OL", "P", "PRE",
  "SECTION", "TABLE", "UL",
]);
const FRONT_MATTER_PATTERN =
  /(选自|選自|作者|原题|原題|本文|人民出版社|中华书局|中華書局|生卒|年版|卷[一二三四五六七八九十\d]+)/;
const GUIDANCE_PATTERN =
  /(学习提示|學習提示|阅读提示|閱讀提示|研习任务|研習任務|学习任务|學習任務|思考与练习|思考與練習|阅读下面|閱讀下面|高考|真题|真題)/;
const PURE_URL_PATTERN = /^https?:\/\/\S+$/i;
const RESOURCE_TEXT_PATTERN =
  /^(?:https?:\/\/\S+|\S+\.(?:pdf|docx?|pptx?|xlsx?|jpe?g|png|webp|gif|svg)(?:\s*\([^)]*\))?)$/i;
const COMPANION_DISCUSSION_BOILERPLATE_PATTERN =
  /^This is a companion discussion topic for the original entry at\b/i;
const DISCUSSION_PATTERN =
  /@(?:Creative_bot|Creative|Roast|Confucius)|(?:请|請|你|为什么|為什麼|咋整|怎麼|怎么).{0,160}[?？]|[?？]$/;
const HTML_TAG_PATTERN = /<\/?(?:a|article|aside|blockquote|br|div|figure|h[1-6]|img|li|ol|p|section|span|strong|sup|table|td|th|tr|ul)\b/i;

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function json(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right, "en"))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

function serialize(value) {
  return `${JSON.stringify(canonicalize(value))}\n`;
}

function normalizeWhitespace(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function removePlatformBoilerplate(blocks) {
  const filtered = blocks.filter((block) => (
    !COMPANION_DISCUSSION_BOILERPLATE_PATTERN.test(blockText(block))
  ));
  const result = [];
  for (const block of filtered) {
    if (
      block.type === "divider"
      && (result.length === 0 || result[result.length - 1].type === "divider")
    ) {
      continue;
    }
    result.push(block);
  }
  while (result[result.length - 1]?.type === "divider") result.pop();
  return result;
}

function cleanSourceMarkup(value) {
  return String(value || "")
    .replace(/\[color=[^\]]+\]|\[\/color\]/gi, "")
    .replace(/\[(?:right|center|left)\]|\[\/(?:right|center|left)\]/gi, "")
    .replace(/↩︎/g, "");
}

function parseArgs(argv) {
  const result = { check: false, mediaStageRoot: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--check") {
      result.check = true;
      continue;
    }
    if (arg === "--stage-media-inventory") {
      const value = argv[index + 1];
      assert(value && !value.startsWith("--"), "--stage-media-inventory requires a directory");
      result.mediaStageRoot = path.resolve(value);
      index += 1;
      continue;
    }
    fail(`unexpected argument: ${arg}`);
  }
  assert(!(result.check && result.mediaStageRoot),
    "--check and --stage-media-inventory are mutually exclusive");
  return result;
}

function nodeClassNames(node) {
  return new Set(String(node?.getAttribute?.("class") || "").split(/\s+/).filter(Boolean));
}

function mergeRuns(runs) {
  const merged = [];
  for (const run of runs) {
    if (!run) continue;
    if (run.type === "text") {
      const text = cleanSourceMarkup(run.text)
        .replace(/[ \t\f\v\r]+/g, " ")
        .replace(/\n{3,}/g, "\n\n");
      if (!text) continue;
      const previous = merged.at(-1);
      if (previous?.type === "text") previous.text += text;
      else merged.push({ type: "text", text });
      continue;
    }
    merged.push(run);
  }
  if (merged[0]?.type === "text") merged[0].text = merged[0].text.trimStart();
  if (merged.at(-1)?.type === "text") merged.at(-1).text = merged.at(-1).text.trimEnd();
  return merged.filter((run) => run.type !== "text" || run.text);
}

function visibleRunsText(runs) {
  return normalizeWhitespace((runs || []).map((run) => {
    if (run.type === "text" || run.type === "link" || run.type === "resource-link") {
      return run.text || "";
    }
    if (run.type === "annotation-ref") return run.label || "";
    if (run.type === "media-ref") return run.alt || "";
    return "";
  }).join(""));
}

function blockText(block) {
  if (!block) return "";
  if (block.runs) return visibleRunsText(block.runs);
  if (block.blocks) return normalizeWhitespace(block.blocks.map(blockText).join("\n"));
  if (block.items) {
    return normalizeWhitespace(block.items.flatMap((item) => item.blocks || []).map(blockText).join("\n"));
  }
  if (block.rows) {
    return normalizeWhitespace(block.rows.flat().map((cell) => visibleRunsText(cell.runs)).join("\n"));
  }
  return normalizeWhitespace(block.text || "");
}

function collectAnnotationRefIds(value) {
  const ids = [];
  const seen = new Set();
  function visit(item) {
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    if (!item || typeof item !== "object") return;
    if (item.type === "annotation-ref") {
      assert(typeof item.noteId === "string" && item.noteId.length > 0,
        "annotation reference noteId is required");
      if (!seen.has(item.noteId)) {
        seen.add(item.noteId);
        ids.push(item.noteId);
      }
    }
    Object.values(item).forEach(visit);
  }
  visit(value);
  return ids;
}

function canonicalizeAnnotationLabels(value, noteIds) {
  const numbers = new Map(noteIds.map((noteId, index) => [noteId, index + 1]));
  function visit(item) {
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    if (!item || typeof item !== "object") return;
    if (item.type === "annotation-ref") {
      const number = numbers.get(item.noteId);
      assert(number, `annotation ${item.noteId} is missing canonical order`);
      item.label = `[${number}]`;
    }
    Object.values(item).forEach(visit);
  }
  visit(value);
}

function inferMediaType(sourceUrl) {
  let pathname = "";
  try {
    pathname = new URL(sourceUrl, FORUM_ORIGIN).pathname.toLowerCase();
  } catch {
    return null;
  }
  if (pathname.endsWith(".webp")) return "image/webp";
  if (pathname.endsWith(".png")) return "image/png";
  if (pathname.endsWith(".gif")) return "image/gif";
  if (pathname.endsWith(".svg")) return "image/svg+xml";
  if (pathname.endsWith(".jpg") || pathname.endsWith(".jpeg")) return "image/jpeg";
  return null;
}

const args = parseArgs(process.argv.slice(2));
const sourceManifestBytes = readFileSync(SOURCE_MANIFEST_FILE);
const sourceManifest = JSON.parse(sourceManifestBytes.toString("utf8"));
const sourceManifestSha256 = sha256(sourceManifestBytes);
const curationBytes = readFileSync(CURATION_FILE);
const curation = JSON.parse(curationBytes.toString("utf8"));
const curationSha256 = sha256(curationBytes);
const roleAuditBytes = readFileSync(ROLE_AUDIT_FILE);
const roleAudit = JSON.parse(roleAuditBytes.toString("utf8"));
const roleAuditSha256 = sha256(roleAuditBytes);
const {
  sanitizeUrl,
} = createUrlSanitizer();

assert(curation.schemaVersion === "yw-reader-curation-v1", "unsupported reader curation schema");
assert(typeof curation.curationVersion === "string" && curation.curationVersion.length > 0,
  "curationVersion is required");
assert(curation.sourceManifestSha256 === sourceManifestSha256,
  "reader curation source manifest receipt is stale");
assert(curation.rolePolicyVersion === "yw-reader-post-role-policy-v1",
  "reader curation role policy is unsupported");
assert(Array.isArray(curation.lessons), "reader curation lessons must be an array");
assert(roleAudit.schemaVersion === "yw-reader-role-audit-v1",
  "unsupported reader role audit schema");
assert(typeof roleAudit.auditVersion === "string" && roleAudit.auditVersion.length > 0,
  "reader role audit version is required");
assert(roleAudit.rolePolicyVersion === curation.rolePolicyVersion,
  "reader role audit policy differs from curation");
assert(roleAudit.review?.status === "reviewed",
  "reader role audit is not reviewed");
assert(roleAudit.review?.basis === "independent-reader-content-audit-v1",
  "reader role audit basis is unsupported");
assert(Array.isArray(roleAudit.decisions) && roleAudit.decisions.length > 0,
  "reader role audit decisions are required");

const activeIds = sourceManifest.lessons.map((lesson) => lesson.id);
const curationIds = curation.lessons.map((lesson) => lesson.lessonId);
assert(
  JSON.stringify(curationIds) === JSON.stringify(activeIds),
  "reader curation lesson inventory/order differs from active manifest",
);
const curationByLesson = new Map(curation.lessons.map((lesson) => [lesson.lessonId, lesson]));
const roleAuditByLesson = new Map();
const roleAuditDecisionKeys = new Set();
for (const decision of roleAudit.decisions) {
  const key = `${decision.lessonId}:${decision.postId}`;
  assert(activeIds.includes(decision.lessonId),
    `reader role audit references inactive lesson ${decision.lessonId}`);
  assert(!roleAuditDecisionKeys.has(key), `duplicate reader role audit decision ${key}`);
  assert(ROLES.has(decision.role) && decision.role !== "primary",
    `${key}: unsupported audited role ${decision.role}`);
  assert(typeof decision.reason === "string" && decision.reason.length > 0,
    `${key}: role audit reason is required`);
  assert(/^[a-f0-9]{64}$/.test(decision.plainTextSha256 || ""),
    `${key}: plain-text receipt is invalid`);
  assert(/^[a-f0-9]{64}$/.test(decision.cookedSha256 || ""),
    `${key}: cooked receipt is invalid`);
  roleAuditDecisionKeys.add(key);
  const decisions = roleAuditByLesson.get(decision.lessonId) || [];
  decisions.push(decision);
  roleAuditByLesson.set(decision.lessonId, decisions);
}

function normalizedUrl(raw) {
  const absolute = new URL(String(raw || ""), FORUM_ORIGIN).toString();
  return sanitizeUrl(absolute);
}

function linkRecord(rawHref, text = "", title = "") {
  let sourceUrl;
  try {
    sourceUrl = normalizedUrl(rawHref);
  } catch {
    return null;
  }
  const url = new URL(sourceUrl);
  const secure = url.protocol === "https:";
  const sameSite = secure && (
    url.hostname === "yw.bdfz.net"
    || url.hostname === "forum.rdfzer.com"
  );
  return canonicalize({
    sourceUrl,
    href: secure ? sourceUrl : null,
    text: normalizeWhitespace(text) || sourceUrl,
    title: normalizeWhitespace(title) || null,
    disposition: secure
      ? (sameSite ? "internal" : "system-browser")
      : "blocked-http",
  });
}

function mediaRecord(rawSource, {
  alt = "",
  width = null,
  height = null,
} = {}) {
  let sourceUrl;
  try {
    sourceUrl = normalizedUrl(rawSource);
  } catch {
    return null;
  }
  const url = new URL(sourceUrl);
  const secure = url.protocol === "https:";
  return canonicalize({
    id: `media-${sha256(sourceUrl).slice(0, 20)}`,
    sourceUrl,
    alt: normalizeWhitespace(alt),
    width: Number(width) || null,
    height: Number(height) || null,
    bytes: null,
    sha256: null,
    mediaType: inferMediaType(sourceUrl),
    receiptRequired: true,
    nativeDisposition: secure ? "blocked-missing-receipt" : "blocked-http",
    webDisposition: secure ? "source-url" : "source-only",
  });
}

function createPostParser(post, lessonId) {
  const { document } = parseHTML(
    `<!doctype html><html><body><main id="reader-root">${post.cooked || ""}</main></body></html>`,
  );
  const root = document.querySelector("#reader-root");
  assert(root, `${lessonId}/${post.id}: cooked HTML root missing`);
  root.querySelectorAll("script, style, object, embed").forEach((node) => node.remove());

  const mediaBySource = new Map();
  const linksBySource = new Map();

  function registerLink(rawHref, text = "", title = "") {
    if (!rawHref || String(rawHref).startsWith("#")) return null;
    const record = linkRecord(rawHref, text, title);
    if (!record) return null;
    const existing = linksBySource.get(record.sourceUrl);
    if (!existing || (!existing.title && record.title)) linksBySource.set(record.sourceUrl, record);
    return record;
  }

  function registerMedia(node) {
    const raw = node.getAttribute?.("src") || node.src || "";
    if (!raw) return null;
    const record = mediaRecord(raw, {
      alt: node.getAttribute?.("alt") || "",
      width: node.getAttribute?.("width"),
      height: node.getAttribute?.("height"),
    });
    if (!record) return null;
    const { sourceUrl } = record;
    if (mediaBySource.has(sourceUrl)) return mediaBySource.get(sourceUrl);
    mediaBySource.set(sourceUrl, record);
    return record;
  }

  function registerEmbed(node) {
    const rawSource = node.getAttribute?.("src") || "";
    const fallback = {
      type: "resource-link",
      provider: "unknown",
      text: "嵌入資料暫不可用",
      sourceUrl: null,
      href: null,
      disposition: "blocked-invalid",
    };
    if (!rawSource) return canonicalize(fallback);
    let sourceUrl;
    try {
      sourceUrl = normalizedUrl(rawSource);
    } catch {
      return canonicalize(fallback);
    }
    const url = new URL(sourceUrl);
    const hostname = url.hostname.toLowerCase();
    let destination = null;
    let provider = hostname;
    let text = normalizeWhitespace(node.getAttribute?.("title") || "");
    if (
      (hostname === "youtube.com" || hostname === "www.youtube.com"
        || hostname === "youtube-nocookie.com" || hostname === "www.youtube-nocookie.com")
      && /^\/embed\/[A-Za-z0-9_-]{6,20}$/.test(url.pathname)
    ) {
      const videoId = url.pathname.split("/").at(-1);
      destination = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
      provider = "youtube";
      text ||= "觀看課文影片";
    } else if (
      hostname === "ctext.org"
      && (url.pathname === "/library.pl" || url.pathname === "/wiki.pl")
    ) {
      destination = sourceUrl;
      provider = "ctext";
      text ||= "開啟中國哲學書電子化計劃原文";
    }
    if (!destination) {
      return canonicalize({
        ...fallback,
        provider,
        sourceUrl,
        disposition: url.protocol === "http:" ? "blocked-http" : "blocked-unsupported",
      });
    }
    const link = registerLink(destination, text);
    assert(link, `${lessonId}/${post.id}: approved iframe link did not normalize`);
    return canonicalize({
      type: "resource-link",
      provider,
      text,
      sourceUrl: link.sourceUrl,
      href: link.href,
      disposition: link.disposition,
    });
  }

  const footnoteItems = new Map();
  root.querySelectorAll(".footnotes-list li[id], ol.footnotes li[id], section.footnotes li[id]").forEach((item) => {
    footnoteItems.set(item.id, item);
  });

  function inlineRuns(node) {
    const runs = [];
    for (const child of [...(node.childNodes || [])]) {
      if (child.nodeType === 3) {
        runs.push({ type: "text", text: child.textContent || "" });
        continue;
      }
      if (child.nodeType !== 1) continue;
      const tag = child.tagName;
      const classes = nodeClassNames(child);
      if (tag === "BR") {
        runs.push({ type: "text", text: "\n" });
        continue;
      }
      if (tag === "IFRAME") {
        runs.push(registerEmbed(child));
        continue;
      }
      if (tag === "IMG") {
        const media = registerMedia(child);
        if (media) runs.push({ type: "media-ref", mediaId: media.id, alt: media.alt || "" });
        continue;
      }
      if (tag === "A") {
        const href = child.getAttribute("href") || "";
        if (classes.has("anchor") && href.startsWith("#")) continue;
        if (href.startsWith("#")) {
          const noteId = href.slice(1);
          if (
            footnoteItems.has(noteId)
            || classes.has("footnote-ref")
            || classes.has("footnote")
            || nodeClassNames(child.parentElement).has("footnote-ref")
          ) {
            runs.push({
              type: "annotation-ref",
              noteId,
              label: normalizeWhitespace(child.textContent || "") || noteId,
            });
            continue;
          }
          continue;
        }
        const nestedImages = [...child.querySelectorAll("img[src]")];
        if (nestedImages.length > 0) {
          for (const image of nestedImages) {
            const media = registerMedia(image);
            if (media) runs.push({
              type: "media-ref",
              mediaId: media.id,
              alt: media.alt || "",
            });
          }
          continue;
        }
        const link = registerLink(
          href,
          child.textContent || "",
          child.getAttribute("title") || "",
        );
        if (link) {
          runs.push({
            type: "link",
            text: normalizeWhitespace(child.textContent || "") || link.sourceUrl,
            sourceUrl: link.sourceUrl,
            href: link.href,
            disposition: link.disposition,
          });
        }
        continue;
      }
      if (BLOCK_ELEMENTS.has(tag)) {
        runs.push(...inlineRuns(child));
        continue;
      }
      runs.push(...inlineRuns(child));
    }
    return mergeRuns(runs);
  }

  function blocksFromContainer(container) {
    const blocks = [];
    let looseRuns = [];
    function appendParagraphRuns(inputRuns) {
      let paragraphRuns = [];
      function flushParagraphRuns() {
        const runs = mergeRuns(paragraphRuns);
        paragraphRuns = [];
        if (runs.length) blocks.push({ type: "paragraph", runs });
      }
      for (const run of inputRuns) {
        if (run.type !== "resource-link") {
          paragraphRuns.push(run);
          continue;
        }
        flushParagraphRuns();
        blocks.push(run);
      }
      flushParagraphRuns();
    }
    function flushLooseRuns() {
      const runs = mergeRuns(looseRuns);
      looseRuns = [];
      appendParagraphRuns(runs);
    }

    for (const child of [...(container.childNodes || [])]) {
      if (child.nodeType === 3) {
        if (normalizeWhitespace(child.textContent || "")) {
          looseRuns.push({ type: "text", text: child.textContent || "" });
        }
        continue;
      }
      if (child.nodeType !== 1) continue;
      const tag = child.tagName;
      if (tag === "SCRIPT" || tag === "STYLE") continue;
      if (tag === "IFRAME") {
        flushLooseRuns();
        blocks.push(registerEmbed(child));
        continue;
      }
      if (tag === "IMG") {
        flushLooseRuns();
        const media = registerMedia(child);
        if (media) blocks.push({ type: "image", mediaId: media.id, alt: media.alt || "" });
        continue;
      }
      if (/^H[1-6]$/.test(tag)) {
        flushLooseRuns();
        const runs = inlineRuns(child);
        const level = Number(tag.slice(1));
        let headingRuns = [];
        const flushHeadingRuns = () => {
          const normalized = mergeRuns(headingRuns);
          headingRuns = [];
          if (normalized.length) blocks.push({
            type: "heading",
            level,
            runs: normalized,
          });
        };
        for (const run of runs) {
          if (run.type !== "media-ref" && run.type !== "resource-link") {
            headingRuns.push(run);
            continue;
          }
          flushHeadingRuns();
          if (run.type === "media-ref") {
            blocks.push({
              type: "image",
              mediaId: run.mediaId,
              alt: run.alt || "",
            });
          } else {
            blocks.push(run);
          }
        }
        flushHeadingRuns();
        continue;
      }
      if (tag === "P" || tag === "FIGCAPTION" || tag === "DT" || tag === "DD") {
        flushLooseRuns();
        appendParagraphRuns(inlineRuns(child));
        continue;
      }
      if (tag === "BLOCKQUOTE") {
        flushLooseRuns();
        const nested = blocksFromContainer(child);
        if (nested.length) blocks.push({ type: "quote", blocks: nested });
        continue;
      }
      if (tag === "UL" || tag === "OL") {
        flushLooseRuns();
        const items = [...child.children]
          .filter((item) => item.tagName === "LI")
          .map((item) => ({ blocks: blocksFromContainer(item) }))
          .filter((item) => item.blocks.length);
        if (items.length) blocks.push({
          type: "list",
          ordered: tag === "OL",
          items,
        });
        continue;
      }
      if (tag === "PRE") {
        flushLooseRuns();
        const text = normalizeWhitespace(child.textContent || "");
        if (text) blocks.push({ type: "code", text });
        continue;
      }
      if (tag === "TABLE") {
        flushLooseRuns();
        const rows = [...child.querySelectorAll("tr")].map((row) => (
          [...row.querySelectorAll(":scope > th, :scope > td")].map((cell) => ({
            header: cell.tagName === "TH",
            runs: inlineRuns(cell),
          }))
        )).filter((row) => row.length);
        if (rows.length) blocks.push({ type: "table", rows });
        continue;
      }
      if (tag === "HR") {
        flushLooseRuns();
        blocks.push({ type: "divider" });
        continue;
      }
      if (
        tag === "DIV" || tag === "SECTION" || tag === "ARTICLE" || tag === "ASIDE"
        || tag === "HEADER" || tag === "FOOTER" || tag === "FIGURE"
        || tag === "DETAILS" || tag === "MAIN" || tag === "DL"
      ) {
        flushLooseRuns();
        blocks.push(...blocksFromContainer(child));
        continue;
      }
      looseRuns.push(...inlineRuns(child));
    }
    flushLooseRuns();
    return blocks.filter((block) => blockText(block) || block.type === "image" || block.type === "divider");
  }

  root.querySelectorAll(".footnotes-list, ol.footnotes, section.footnotes").forEach((node) => node.remove());
  const parsedBlocks = removePlatformBoilerplate(blocksFromContainer(root));
  const referencedNoteIds = collectAnnotationRefIds(parsedBlocks);
  canonicalizeAnnotationLabels(parsedBlocks, referencedNoteIds);
  const annotations = referencedNoteIds.map((noteId) => {
    const item = footnoteItems.get(noteId);
    assert(item, `${lessonId}/${post.id}: annotation ${noteId} does not resolve`);
    const clone = item.cloneNode(true);
    clone.querySelectorAll(".footnote-backref, a[href^=\"#fnref\"]").forEach((node) => node.remove());
    const blocks = blocksFromContainer(clone);
    if (blocks.length === 0) {
      for (const image of clone.querySelectorAll("img[src]")) {
        const media = registerMedia(image);
        if (media) blocks.push({ type: "image", mediaId: media.id, alt: media.alt || "" });
      }
    }
    return canonicalize({
      noteId,
      blocks,
    });
  });
  for (const annotation of annotations) {
    assert(annotation.blocks.length > 0, `${lessonId}/${post.id}: annotation ${annotation.noteId} is empty`);
  }
  assert(
    JSON.stringify(annotations.map((annotation) => annotation.noteId))
      === JSON.stringify(referencedNoteIds),
    `${lessonId}/${post.id}: annotations differ from first-reference order`,
  );

  const frontMatter = [];
  const guidance = [];
  const blocks = [...parsedBlocks];
  while (blocks.length > 0 && blocks[0].type === "quote") {
    const text = blockText(blocks[0]);
    if (GUIDANCE_PATTERN.test(text)) guidance.push(blocks.shift());
    else if (FRONT_MATTER_PATTERN.test(text)) frontMatter.push(blocks.shift());
    else break;
  }
  while (blocks.length > 0 && blocks[0].type === "heading" && GUIDANCE_PATTERN.test(blockText(blocks[0]))) {
    guidance.push(blocks.shift());
  }

  return canonicalize({
    postId: post.id,
    postNumber: post.post_number,
    frontMatter,
    guidance,
    blocks,
    annotations,
    links: [...linksBySource.values()].sort((left, right) => left.sourceUrl.localeCompare(right.sourceUrl, "en")),
    media: [...mediaBySource.values()].sort((left, right) => left.sourceUrl.localeCompare(right.sourceUrl, "en")),
  });
}

function resourceFromSource(resource, postId = null) {
  const link = linkRecord(resource.href, resource.text || resource.title || "", resource.title || "");
  if (!link) return null;
  return canonicalize({
    sourceUrl: link.sourceUrl,
    href: link.href,
    label: normalizeWhitespace(resource.text || resource.title || "") || link.sourceUrl,
    kind: resource.kind || "link",
    postId,
    postNumber: resource.postNumber || null,
    disposition: link.disposition === "blocked-http" ? "source-only" : link.disposition,
  });
}

function pureResourceBody(parsed) {
  const text = normalizeWhitespace(parsed.blocks.map(blockText).join("\n"));
  if (!text) return parsed.links.length > 0 || parsed.media.length > 0;
  if (PURE_URL_PATTERN.test(text)) return true;
  const withoutUrls = text
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\([^)]*(?:KB|MB|GB)\)/gi, "")
    .replace(/\b\d+(?:\.\d+)?\s*(?:KB|MB|GB)\b/gi, "")
    .replace(/[\s,，.。;；:：()（）[\]【】_-]+/g, "");
  return withoutUrls.length <= 8 && (parsed.links.length > 0 || parsed.media.length > 0);
}

function sourcePostsReceipt(posts) {
  return sha256(serialize(posts.map((post) => ({
    postId: post.id,
    postNumber: post.post_number,
    replyToPostNumber: post.reply_to_post_number ?? null,
    plainTextSha256: sha256(String(post.plain_text || "")),
    cookedSha256: sha256(String(post.cooked || "")),
    linkCount: (post.links || []).length,
    imageCount: (post.images || []).length,
    attachmentCount: (post.attachments || []).length,
  }))));
}

function defaultPostRole(post, primaryPostId, discussionOpen = false) {
  if (String(post.id) === String(primaryPostId)) return "primary";
  if (post.reply_to_post_number != null) return "reply";
  const text = normalizeWhitespace(post.plain_text || "");
  const hasResource = (
    (post.links || []).length > 0
    || (post.images || []).length > 0
    || (post.attachments || []).length > 0
  );
  if (
    RESOURCE_TEXT_PATTERN.test(text)
    || (!text && hasResource)
  ) return "resource-only";
  if (DISCUSSION_PATTERN.test(text) && text.length < 700) return "discussion";
  if (hasResource && text.length < 80) return "resource-only";
  if (discussionOpen) return "discussion";
  if (text.length >= 180) return "supplementary";
  return "source-only";
}

function buildReaderDocument(meta, source, reviewed) {
  const review = reviewed.review || curation.review;
  assert(review?.status === "reviewed", `${meta.id}: curation is not reviewed`);
  assert(review?.basis === "explicit-post-role-review-v1", `${meta.id}: review basis missing`);
  const sourcePosts = source.posts || [];
  const sourcePostById = new Map(sourcePosts.map((post) => [String(post.id), post]));
  assert(reviewed.sourcePostsSha256 === sourcePostsReceipt(sourcePosts),
    `${meta.id}: reviewed source-post receipt is stale`);
  const auditedDecisions = roleAuditByLesson.get(meta.id) || [];
  const auditedOverrides = {};
  for (const decision of auditedDecisions) {
    const post = sourcePostById.get(String(decision.postId));
    assert(post, `${meta.id}: role audit references missing post ${decision.postId}`);
    assert(Number(post.post_number) === Number(decision.postNumber),
      `${meta.id}/${decision.postId}: audited post number is stale`);
    assert(sha256(String(post.plain_text || "")) === decision.plainTextSha256,
      `${meta.id}/${decision.postId}: audited plain-text receipt is stale`);
    assert(sha256(String(post.cooked || "")) === decision.cookedSha256,
      `${meta.id}/${decision.postId}: audited cooked receipt is stale`);
    auditedOverrides[String(decision.postId)] = decision.role;
  }
  const embeddedOverrides = reviewed.roleOverrides || {};
  for (const [postId, role] of Object.entries(auditedOverrides)) {
    assert(!embeddedOverrides[postId] || embeddedOverrides[postId] === role,
      `${meta.id}/${postId}: role audit conflicts with embedded curation`);
  }
  const overrides = {
    ...embeddedOverrides,
    ...auditedOverrides,
  };
  for (const [postId, role] of Object.entries(overrides)) {
    assert(sourcePostById.has(String(postId)), `${meta.id}: role override references missing post ${postId}`);
    assert(ROLES.has(role), `${meta.id}/${postId}: unsupported override role ${role}`);
    assert(role !== "primary", `${meta.id}/${postId}: primary must use primaryPostId`);
  }
  assert(sourcePostById.has(String(reviewed.primaryPostId)), `${meta.id}: primary post missing`);
  let discussionOpen = false;
  const assignments = sourcePosts.map((post) => {
    const explicitRole = overrides[String(post.id)] || null;
    const role = explicitRole
      || defaultPostRole(post, reviewed.primaryPostId, discussionOpen);
    if (!explicitRole && role === "discussion") discussionOpen = true;
    return { postId: post.id, role };
  });
  const assignedIds = assignments.map((post) => String(post.postId));
  assert(
    JSON.stringify([...sourcePostById.keys()].sort()) === JSON.stringify([...assignedIds].sort()),
    `${meta.id}: curation post inventory differs from source`,
  );
  assert(reviewed.sourcePostCount === sourcePosts.length, `${meta.id}: reviewed source post count is stale`);
  for (const assignment of assignments) {
    assert(ROLES.has(assignment.role), `${meta.id}/${assignment.postId}: unsupported role ${assignment.role}`);
  }
  const primaryAssignments = assignments.filter((post) => post.role === "primary");
  assert(primaryAssignments.length === 1, `${meta.id}: expected exactly one primary post`);
  const primaryPost = sourcePostById.get(String(primaryAssignments[0].postId));
  assert(primaryPost, `${meta.id}: primary post missing`);
  assert(primaryPost.reply_to_post_number == null, `${meta.id}: reply cannot be the primary post`);

  const parsedPrimary = createPostParser(primaryPost, meta.id);
  const primaryWasResourceOnly = pureResourceBody(parsedPrimary);
  const mainBlocks = primaryWasResourceOnly ? [] : parsedPrimary.blocks;
  const sourceOnlyBlocks = primaryWasResourceOnly ? parsedPrimary.blocks : [];

  const supplementary = assignments
    .filter((assignment) => assignment.role === "supplementary")
    .map((assignment) => {
      const post = sourcePostById.get(String(assignment.postId));
      const parsed = createPostParser(post, meta.id);
      return canonicalize({
        postId: post.id,
        postNumber: post.post_number,
        blocks: parsed.blocks,
        annotations: parsed.annotations,
        links: parsed.links,
        media: parsed.media,
      });
    });

  const resourcesByUrl = new Map();
  for (const resource of source.resources || []) {
    const normalized = resourceFromSource(resource);
    if (normalized) resourcesByUrl.set(normalized.sourceUrl, normalized);
  }
  for (const assignment of assignments.filter((post) => (
    post.role === "resource-only" || post.role === "source-only"
  ))) {
    const post = sourcePostById.get(String(assignment.postId));
    for (const resource of [
      ...(post.links || []),
      ...(post.attachments || []),
    ]) {
      const normalized = resourceFromSource(resource, post.id);
      if (normalized) resourcesByUrl.set(normalized.sourceUrl, normalized);
    }
  }
  if (primaryWasResourceOnly) {
    for (const link of parsedPrimary.links) {
      resourcesByUrl.set(link.sourceUrl, canonicalize({
        sourceUrl: link.sourceUrl,
        href: link.href,
        label: link.text || link.sourceUrl,
        kind: "link",
        postId: primaryPost.id,
        postNumber: primaryPost.post_number,
        disposition: link.disposition === "blocked-http" ? "source-only" : link.disposition,
      }));
    }
  }

  const provenancePosts = assignments.map((assignment) => {
    const post = sourcePostById.get(String(assignment.postId));
    return canonicalize({
      postId: post.id,
      postNumber: post.post_number,
      replyToPostNumber: post.reply_to_post_number ?? null,
      role: assignment.role,
      createdAt: post.created_at || null,
      updatedAt: post.updated_at || null,
      plainTextSha256: sha256(String(post.plain_text || "")),
      cookedSha256: sha256(String(post.cooked || "")),
    });
  });
  const roleByPostId = new Map(assignments.map((assignment) => (
    [String(assignment.postId), assignment.role]
  )));
  const provenanceMedia = sourcePosts.flatMap((post) => (post.images || []).map((image) => {
    const media = mediaRecord(image.src, image);
    if (!media) return null;
    return canonicalize({
      ...media,
      postId: post.id,
      postNumber: post.post_number,
      postRole: roleByPostId.get(String(post.id)),
    });
  })).filter(Boolean);
  const provenanceLinks = sourcePosts.flatMap((post) => (post.links || []).map((link) => {
    const normalized = linkRecord(link.href, link.text || "", link.title || "");
    if (!normalized) return null;
    return canonicalize({
      ...normalized,
      postId: post.id,
      postNumber: post.post_number,
      postRole: roleByPostId.get(String(post.id)),
    });
  })).filter(Boolean);

  const result = canonicalize({
    schemaVersion: "yw-reader-document-v1",
    curationVersion: curation.curationVersion,
    curationManifestSha256: curationSha256,
    roleAuditVersion: roleAudit.auditVersion,
    roleAuditSha256,
    lessonId: meta.id,
    title: source.title || meta.title,
    main: {
      sourcePostId: primaryPost.id,
      sourcePostNumber: primaryPost.post_number,
      frontMatter: parsedPrimary.frontMatter,
      guidance: parsedPrimary.guidance,
      blocks: mainBlocks,
      sourceOnlyBlocks,
      annotations: parsedPrimary.annotations,
      links: parsedPrimary.links,
      media: parsedPrimary.media,
    },
    supplementary,
    resources: [...resourcesByUrl.values()].sort((left, right) => (
      left.sourceUrl.localeCompare(right.sourceUrl, "en")
    )),
    provenance: {
      sourceLessonPath: meta.dataUrl,
      sourceLessonUpdatedAt: source.updatedAt || null,
      sourcePostCount: sourcePosts.length,
      roleAuditDecisions: auditedDecisions.map((decision) => ({
        postId: decision.postId,
        role: decision.role,
        reason: decision.reason,
      })),
      posts: provenancePosts,
      media: provenanceMedia,
      links: provenanceLinks,
    },
  });

  assert(result.provenance.posts.length === sourcePosts.length, `${meta.id}: provenance post loss`);
  assert(result.provenance.posts.filter((post) => post.role === "primary").length === 1,
    `${meta.id}: provenance primary count`);
  assert(!HTML_TAG_PATTERN.test(JSON.stringify(result)), `${meta.id}: cooked HTML leaked into reader document`);
  return result;
}

const baseDocuments = [];
for (const meta of sourceManifest.lessons) {
  const sourceFile = path.join(SITE, meta.dataUrl);
  const source = json(sourceFile);
  assert(source.id === meta.id, `${meta.id}: source identity mismatch`);
  baseDocuments.push(buildReaderDocument(meta, source, curationByLesson.get(meta.id)));
}

const readerSemanticDigest = `sha256:${sha256(serialize({
  schemaVersion: "yw-reader-projection-semantic-v1",
  curationVersion: curation.curationVersion,
  documents: baseDocuments,
}))}`;
if (args.mediaStageRoot) {
  assert(args.mediaStageRoot !== OUTPUT_ROOT,
    "media inventory staging must not overwrite canonical reader documents");
  const stagedFiles = new Map(baseDocuments.map((document) => (
    [`${document.lessonId}.json`, serialize(document)]
  )));
  const stagedIndex = canonicalize({
    schemaVersion: "yw-reader-document-index-v1",
    curationVersion: curation.curationVersion,
    curationManifestSha256: curationSha256,
    roleAuditVersion: roleAudit.auditVersion,
    roleAuditSha256,
    roleOverrideCount: roleAudit.decisions.length,
    sourceManifestSha256,
    readerSemanticDigest,
    lessonCount: baseDocuments.length,
    mediaReceiptStatus: "staged-for-explicit-collection",
    documents: Object.fromEntries(baseDocuments.map((document) => {
      const body = stagedFiles.get(`${document.lessonId}.json`);
      return [document.lessonId, {
        path: `reader-documents/${document.lessonId}.json`,
        sha256: sha256(body),
        bytes: Buffer.byteLength(body),
        sourcePostCount: document.provenance.sourcePostCount,
        primaryPostId: document.main.sourcePostId,
      }];
    })),
  });
  stagedFiles.set("index.json", serialize(stagedIndex));
  mkdirSync(args.mediaStageRoot, { recursive: true });
  const staleNames = readdirSync(args.mediaStageRoot)
    .filter((name) => name.endsWith(".json") && !stagedFiles.has(name));
  assert(staleNames.length === 0,
    `media inventory staging has unrelated JSON files: ${staleNames.join(", ")}`);
  for (const [name, body] of stagedFiles) {
    writeFileSync(path.join(args.mediaStageRoot, name), body);
  }
  process.stdout.write(`${JSON.stringify({
    schemaVersion: stagedIndex.schemaVersion,
    mode: "stage-media-inventory",
    outputRoot: args.mediaStageRoot,
    readerSemanticDigest,
    lessons: baseDocuments.length,
    networkUsed: false,
  })}\n`);
  process.exit(0);
}
assert(existsSync(MEDIA_RECEIPT_FILE), "reader media receipt ledger is missing");
assert(existsSync(MEDIA_ANOMALY_FILE), "reader media anomaly report is missing");
const mediaReceiptBytes = readFileSync(MEDIA_RECEIPT_FILE);
const mediaReceiptLedger = JSON.parse(mediaReceiptBytes.toString("utf8"));
const mediaAnomalyReport = json(MEDIA_ANOMALY_FILE);
const mediaInventory = extractReaderMediaTargets({ repoRoot: ROOT });
assert(mediaInventory.issues.length === 0,
  `reader media inventory is invalid: ${mediaInventory.issues.map((issue) => issue.code).join(", ")}`);
assert(mediaInventory.readerSemanticDigest === readerSemanticDigest,
  "reader media inventory is bound to a stale reader semantic digest");
const mediaReceiptIssues = validateReceiptLedger({
  ledger: mediaReceiptLedger,
  inventory: mediaInventory,
  anomalyReport: mediaAnomalyReport,
});
assert(mediaReceiptIssues.length === 0,
  `reader media receipt ledger is invalid: ${mediaReceiptIssues.join("; ")}`);
assert(mediaReceiptLedger.readerSemanticDigest === readerSemanticDigest,
  "reader media receipt ledger is bound to a stale reader semantic digest");
const mediaReceiptByUrl = new Map(mediaReceiptLedger.receipts.map((receipt) => (
  [receipt.sourceUrl, receipt]
)));

function attachVerifiedMediaReceipt(media, context) {
  const receipt = mediaReceiptByUrl.get(media.sourceUrl);
  assert(receipt, `${context}: verified media receipt is missing for ${media.sourceUrl}`);
  assert(media.nativeDisposition === "blocked-missing-receipt",
    `${context}: media receipt cannot override ${media.nativeDisposition}`);
  return canonicalize({
    ...media,
    bytes: receipt.bytes,
    sha256: receipt.sha256,
    mediaType: receipt.mime,
    width: receipt.width,
    height: receipt.height,
    finalUrl: receipt.finalUrl,
    receiptCollectedAt: receipt.collectedAt,
    rightsBasis: receipt.rightsBasis,
    nativeDisposition: "verified-in-app",
  });
}

const documents = baseDocuments.map((document) => canonicalize({
  ...document,
  mediaReceiptLedgerVersion: mediaReceiptLedger.ledgerVersion,
  mediaReceiptLedgerSha256: sha256(mediaReceiptBytes),
  main: {
    ...document.main,
    media: document.main.media.map((media) => (
      attachVerifiedMediaReceipt(media, `${document.lessonId}/primary`)
    )),
  },
  supplementary: document.supplementary.map((post) => ({
    ...post,
    media: post.media.map((media) => (
      attachVerifiedMediaReceipt(media, `${document.lessonId}/${post.postId}`)
    )),
  })),
  provenance: {
    ...document.provenance,
    media: document.provenance.media.map((media) => (
      media.postRole === "primary" || media.postRole === "supplementary"
        ? attachVerifiedMediaReceipt(media, `${document.lessonId}/${media.postId}`)
        : media
    )),
  },
}));

const documentFiles = new Map();
for (const document of documents) {
  documentFiles.set(`${document.lessonId}.json`, serialize(document));
}
const index = canonicalize({
  schemaVersion: "yw-reader-document-index-v1",
  curationVersion: curation.curationVersion,
  curationManifestSha256: curationSha256,
  roleAuditVersion: roleAudit.auditVersion,
  roleAuditSha256,
  roleOverrideCount: roleAudit.decisions.length,
  sourceManifestSha256,
  readerSemanticDigest,
  mediaReceiptLedger: {
    schemaVersion: mediaReceiptLedger.schemaVersion,
    ledgerVersion: mediaReceiptLedger.ledgerVersion,
    sha256: sha256(mediaReceiptBytes),
    sourceInventorySha256: mediaReceiptLedger.sourceInventorySha256,
    receiptCount: mediaReceiptLedger.receiptCount,
    totalBytes: mediaReceiptLedger.totalBytes,
    rightsBasis: mediaReceiptLedger.rightsBasis,
  },
  lessonCount: documents.length,
  documents: Object.fromEntries(documents.map((document) => {
    const body = documentFiles.get(`${document.lessonId}.json`);
    return [document.lessonId, {
      path: `reader-documents/${document.lessonId}.json`,
      sha256: sha256(body),
      bytes: Buffer.byteLength(body),
      sourcePostCount: document.provenance.sourcePostCount,
      primaryPostId: document.main.sourcePostId,
    }];
  })),
});
documentFiles.set("index.json", serialize(index));

const expectedNames = [...documentFiles.keys()].sort((left, right) => left.localeCompare(right, "en"));
if (args.check) {
  assert(existsSync(OUTPUT_ROOT), "reader document output directory is missing");
  const actualNames = readdirSync(OUTPUT_ROOT)
    .filter((name) => name.endsWith(".json"))
    .sort((left, right) => left.localeCompare(right, "en"));
  assert(
    JSON.stringify(actualNames) === JSON.stringify(expectedNames),
    "reader document output inventory is stale",
  );
  for (const name of expectedNames) {
    assert(
      readFileSync(path.join(OUTPUT_ROOT, name), "utf8") === documentFiles.get(name),
      `${name}: generated reader document is stale`,
    );
  }
} else {
  mkdirSync(OUTPUT_ROOT, { recursive: true });
  const staleNames = readdirSync(OUTPUT_ROOT)
    .filter((name) => name.endsWith(".json") && !documentFiles.has(name));
  assert(staleNames.length === 0, `stale reader documents require explicit review: ${staleNames.join(", ")}`);
  for (const name of expectedNames) {
    writeFileSync(path.join(OUTPUT_ROOT, name), documentFiles.get(name));
  }
}

process.stdout.write(`${JSON.stringify({
  schemaVersion: index.schemaVersion,
  mode: args.check ? "check" : "write",
  curationVersion: curation.curationVersion,
  roleAuditVersion: roleAudit.auditVersion,
  roleOverrides: roleAudit.decisions.length,
  readerSemanticDigest,
  lessons: documents.length,
  posts: documents.reduce((sum, document) => sum + document.provenance.posts.length, 0),
  annotations: documents.reduce((sum, document) => (
    sum
    + document.main.annotations.length
    + document.supplementary.reduce((subtotal, post) => subtotal + post.annotations.length, 0)
  ), 0),
  media: documents.reduce((sum, document) => (
    sum
    + document.main.media.length
    + document.supplementary.reduce((subtotal, post) => subtotal + post.media.length, 0)
  ), 0),
  mainBodies: documents.filter((document) => document.main.blocks.length > 0).length,
  resourceOnlyMainBodies: documents.filter((document) => document.main.sourceOnlyBlocks.length > 0).length,
})}\n`);
