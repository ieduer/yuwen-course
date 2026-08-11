#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const browserSource = readFileSync(resolve(ROOT, "site/assets/classical-first-read.js"), "utf8");
const appSource = readFileSync(resolve(ROOT, "site/assets/app.js"), "utf8");
const styles = readFileSync(resolve(ROOT, "site/assets/styles.css"), "utf8");

const anchorHelperStart = appSource.indexOf("function cleanReaderVisibleText");
const anchorHelperEnd = appSource.indexOf("function renderReaderAnnotations");
assert.ok(anchorHelperStart >= 0 && anchorHelperEnd > anchorHelperStart);
const anchorSandbox = {
  esc: (value) => String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;"),
  projectStudentResourceHref: (value) => value,
  renderReaderMedia: () => '<span class="reader-media-unavailable">圖片註釋</span>',
};
vm.runInNewContext(`${appSource.slice(anchorHelperStart, anchorHelperEnd)}
globalThis.splitAnchor = splitReaderAnnotationAnchor;
globalThis.annotationNumberMapForTest = annotationNumberMap;
globalThis.inlineAnnotationBodiesForTest = inlineAnnotationBodies;
globalThis.renderReaderBlocksForTest = renderReaderBlocks;`, anchorSandbox);
const splitAnchor = anchorSandbox.splitAnchor;

const window = {};
vm.runInNewContext(browserSource, {
  window,
  performance: { now: () => 0 },
  localStorage: { removeItem() {} },
  location: { href: "https://yw.bdfz.net/#lesson-1534" },
  crypto: { randomUUID: () => "test-mutation" },
  fetch: async () => { throw new Error("network must not be used while rendering submitted reading"); },
  FormData,
  Node: { ELEMENT_NODE: 1 },
});

const api = window.YwClassicalFirstRead;
assert.equal(typeof api?.renderSubmittedReading, "function");

const paragraphs = [
  { key: "cfrp:lesson-test:0000000000000001:01", ordinal: 1, text: "屈原者名平楚之同姓也" },
  { key: "cfrp:lesson-test:0000000000000002:02", ordinal: 2, text: "博闻强志明于治乱娴于辞令" },
];
const submitted = {
  submitted: true,
  asset: { lessonId: "lesson-test", textVersionId: "cfr-lesson-test-1", paragraphs },
  summary: "先看见人物处境，再判断叙事如何推进。<script>alert(1)</script>",
  marks: [{
    markId: "mark-1",
    paragraphKey: paragraphs[0].key,
    startOffset: 0,
    endOffset: 2,
    selectedText: "屈原",
    guess: "也许是传主姓名<&>",
    resolutionStatus: "open",
  }],
};

const html = api.renderSubmittedReading(submitted);
assert.match(html, /data-first-read-submitted-review/);
assert.match(html, />起始</);
assert.match(html, /<h3 id="first-read-submitted-heading">無注疏初讀<\/h3>/);
assert.match(html, /已提交 · 保留第一次閱讀/);
assert.match(html, />屈原<\/mark>者名平楚之同姓也/);
assert.match(html, /博闻强志明于治乱娴于辞令/);
assert.match(html, /<mark class="first-read-mark [^"]*"[^>]*>屈原<\/mark>/);
assert.match(html, /先看见人物处境，再判断叙事如何推进。&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
assert.match(html, /也许是传主姓名&lt;&amp;&gt;/);
assert.doesNotMatch(html, /<details\b|\shidden(?:\s|=|>)/i);
assert.doesNotMatch(html, /<(?:form|input|textarea|button)\b/i);
assert.equal(api.renderSubmittedReading({ ...submitted, submitted: false }), "");

const anchorRules = [...styles.matchAll(/\.reader-annotation-anchor\s*\{([^}]+)\}/g)]
  .map((match) => match[1]).join("\n");
assert.match(anchorRules, /display:\s*inline-block/);
assert.match(anchorRules, /white-space:\s*nowrap/);

const noteRefRules = [...styles.matchAll(/\.reader-note-ref\s*\{([^}]+)\}/g)]
  .map((match) => match[1]).join("\n");
assert.match(noteRefRules, /font-variant-numeric:\s*tabular-nums/);
assert.match(noteRefRules, /vertical-align:\s*super/);
assert.match(noteRefRules, /appearance:\s*none/);
assert.match(noteRefRules, /border:\s*0/);
assert.match(noteRefRules, /background:\s*transparent/);
assert.doesNotMatch(noteRefRules, /inline-grid|min-width|min-height|999px/);
assert.match(styles, /\.reader-note-sup\s*\{[^}]*vertical-align:\s*super[^}]*white-space:\s*nowrap[^}]*\}/);
assert.match(styles, /\.reader-note-sup \.reader-note-ref\s*\{[^}]*vertical-align:\s*baseline[^}]*\}/);
assert.match(styles, /\.reader-inline-note-content\s*\{[^}]*white-space:\s*normal[^}]*overflow-wrap:\s*anywhere[^}]*\}/);
assert.match(styles, /\.reader-inline-note-paragraph\s*\{[^}]*display:\s*inline[^}]*\}/);

const annotationFixture = [{
  noteId: "note-1",
  blocks: [{ type: "paragraph", runs: [{ type: "text", text: "正文註釋內容" }] }],
}];
const fixtureNumbers = anchorSandbox.annotationNumberMapForTest(annotationFixture);
const fixtureBodies = anchorSandbox.inlineAnnotationBodiesForTest(annotationFixture, new Map(), fixtureNumbers);
assert.equal(
  fixtureBodies.get("note-1"),
  '<span class="reader-inline-note-paragraph">正文註釋內容</span>',
);
const renderedFixture = anchorSandbox.renderReaderBlocksForTest([
  { type: "paragraph", runs: [{ type: "text", text: "正文末字" }, { type: "annotation-ref", noteId: "note-1" }] },
], new Map(), {
  annotationNumbers: fixtureNumbers,
  annotationBodies: fixtureBodies,
  annotationOccurrences: new Map(),
});
assert.match(renderedFixture, /reader-inline-note-content"><span class="reader-inline-note-paragraph">正文註釋內容<\/span><\/span>/);
assert.doesNotMatch(renderedFixture, /reader-inline-note-content"><p>/);

const submittedReviewRules = [...styles.matchAll(/\.first-read-submitted-review\s*\{([^}]+)\}/g)]
  .map((match) => match[1]).join("\n");
assert.match(submittedReviewRules, /display:\s*block/);
assert.doesNotMatch(submittedReviewRules, /display:\s*none|visibility:\s*hidden/);

assert.match(appSource, /const markerMarkup = annotationParts\.map\(\(part\) => part\.marker\)\.join\(""\)/);
assert.match(appSource, /<span class="reader-annotation-anchor">\$\{renderValue\(anchor\)\}\$\{markerMarkup\}<\/span>\$\{noteMarkup\}/);
assert.match(appSource, /<button class="reader-note-ref"[^>]+>\$\{number\}<\/button>/);
assert.doesNotMatch(appSource, />注<\/button>/);
assert.match(appSource, /點上標數字展開/);
assert.match(appSource, /replace\(\/\^展開\/, "收起"\)/);
assert.match(appSource, /replace\(\/\^收起\/, "展開"\)/);
assert.match(appSource, /YwClassicalFirstRead\.renderSubmittedReading\(firstRead\)/);
assert.match(appSource, /data-learning-tip/);
assert.match(appSource, /classical-learning-tips\.json/);

const readerIndex = JSON.parse(readFileSync(resolve(ROOT, "site/data/reader-documents/index.json"), "utf8"));
let annotationReferenceCount = 0;
let anchoredReferenceCount = 0;
function scanRuns(value, sourcePath = "root") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanRuns(item, `${sourcePath}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value.runs)) {
    const pairedIndexes = new Set();
    for (let index = 0; index < value.runs.length; index += 1) {
      const run = value.runs[index];
      if (run?.type !== "text" && run?.type !== "link") continue;
      let annotationIndex = index + 1;
      while (value.runs[annotationIndex]?.type === "annotation-ref") {
        pairedIndexes.add(annotationIndex);
        const visible = String(run.text || run.sourceUrl || "外部資料")
          .replace(/\[color=[^\]]+\]|\[\/color\]/gi, "")
          .replace(/\[\d+:\d+\]/g, "")
          .replace(/\s+([，。；：！？])/g, "$1");
        const result = splitAnchor(visible);
        assert.ok(result.anchor, `${sourcePath}.runs[${annotationIndex}] must bind to a visible preceding character or word`);
        assert.equal(`${result.prefix}${result.anchor}${result.suffix}`, visible);
        anchoredReferenceCount += 1;
        annotationIndex += 1;
      }
    }
    value.runs.forEach((run, index) => {
      if (run?.type !== "annotation-ref") return;
      annotationReferenceCount += 1;
      assert.ok(pairedIndexes.has(index), `${sourcePath}.runs[${index}] is an orphan annotation reference`);
    });
  }
  Object.entries(value).forEach(([key, item]) => {
    if (key !== "runs") scanRuns(item, `${sourcePath}.${key}`);
  });
}
for (const [lessonId, receipt] of Object.entries(readerIndex.documents)) {
  const document = JSON.parse(readFileSync(resolve(ROOT, "site/data", receipt.path), "utf8"));
  scanRuns(document, lessonId);
}
assert.equal(annotationReferenceCount, 2933);
assert.equal(anchoredReferenceCount, annotationReferenceCount);

console.log(`annotation layout tests passed: ${anchoredReferenceCount} numeric no-orphan references and submitted first-read review`);
