import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ROOT = new URL("../", import.meta.url);

test("manifest distinguishes forum images from textbook page images", async () => {
  const manifest = JSON.parse(await readFile(new URL("site/data/manifest.json", ROOT), "utf8"));
  let textbookPageImages = 0;
  for (const meta of manifest.lessons || []) {
    const lesson = JSON.parse(await readFile(new URL(`site/${meta.dataUrl}`, ROOT), "utf8"));
    const expected = Array.isArray(lesson.textbook?.pageImages) ? lesson.textbook.pageImages.length : 0;
    assert.equal(meta.textbookPageImageCount, expected, `${meta.id} textbook page-image count`);
    assert.equal(Number(meta.imageCount || 0), (lesson.forumImages || []).length, `${meta.id} forum image count`);
    if (Number(meta.textbookPageCount || 0) > 0) assert.ok(expected > 0, `${meta.id} has page refs without images`);
    textbookPageImages += expected;
  }
  assert.equal(manifest.totals.textbookPageImages, textbookPageImages);
});
