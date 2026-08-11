import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { INFOGRAPHIC_FOCUS as NOTEBOOKLM_INFOGRAPHIC_FOCUS } from "./notebooklm_config.mjs";
import worker from "../site/_worker.js";
import {
  BLUEPRINT_MODE_TECHNIQUES,
  INFOGRAPHIC_FOCUS,
  deterministicLessonBlueprint,
  inspectLessonBlueprint,
  lessonBlueprintPromptAnchor,
  normalizeBlueprintMode,
  normalizeLessonBlueprint,
} from "../site/lesson-blueprint-rules.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const taxonomy = JSON.parse(fs.readFileSync(path.join(root, "site/data/literary-taxonomy.json"), "utf8"));
const bannedStudentPrompt = /我是|抽掉|換序|换序|最關鍵的材料|最关键的材料|我把全文|你看見了嗎|你看见了吗/u;

function lessonData(lessonId) {
  return JSON.parse(fs.readFileSync(path.join(root, `site/data/lessons/${lessonId}.json`), "utf8"));
}

function lessonExcerpt(lesson) {
  return String(
    lesson.posts?.find((post) => post.kind === "primary")?.plain_text
      || lesson.posts?.[0]?.plain_text
      || lesson.excerpt
      || "",
  );
}

function contextFor(taxonomyLesson) {
  const lesson = lessonData(taxonomyLesson.id);
  return {
    lessonId: taxonomyLesson.id,
    lessonTitle: taxonomyLesson.title,
    blockTitle: taxonomyLesson.blockTitle,
    mode: taxonomyLesson.mode,
    excerpt: lessonExcerpt(lesson),
  };
}

test("all 189 student lessons receive unique, text-anchored, mode-specific structure prompts", () => {
  assert.equal(taxonomy.lessons.length, 189, "student-visible taxonomy count drifted");
  assert.deepEqual(
    Object.keys(INFOGRAPHIC_FOCUS).sort(),
    Object.keys(NOTEBOOKLM_INFOGRAPHIC_FOCUS).sort(),
    "runtime reviewed-focus coverage drifted from NotebookLM authority",
  );
  const prompts = new Set();
  let reviewedFocusCount = 0;

  for (const taxonomyLesson of taxonomy.lessons) {
    const context = contextFor(taxonomyLesson);
    const blueprint = deterministicLessonBlueprint(context);
    const quality = inspectLessonBlueprint(blueprint.structureFocus, context);

    assert.equal(quality.ok, true, `${taxonomyLesson.id}: ${quality.failures.join(", ")}`);
    assert.doesNotMatch(blueprint.structureFocus, bannedStudentPrompt, taxonomyLesson.id);
    assert.ok(
      blueprint.structureFocus.includes(BLUEPRINT_MODE_TECHNIQUES[normalizeBlueprintMode(taxonomyLesson.mode)]),
      `${taxonomyLesson.id}: missing mode technique`,
    );
    assert.equal(blueprint.structureFocus.includes(lessonBlueprintPromptAnchor(context)), true);
    assert.equal(prompts.has(blueprint.structureFocus), false, `${taxonomyLesson.id}: duplicate prompt`);
    prompts.add(blueprint.structureFocus);

    if (INFOGRAPHIC_FOCUS[taxonomyLesson.id]) {
      reviewedFocusCount += 1;
      assert.ok(blueprint.structureFocus.includes(INFOGRAPHIC_FOCUS[taxonomyLesson.id]));
    }
  }

  assert.equal(prompts.size, 189);
  assert.equal(reviewedFocusCount, 75, "reviewed INFOGRAPHIC_FOCUS coverage drifted");
});

test("Dickens prompt targets retrospective child-labour narration instead of a generic rearrangement question", () => {
  const taxonomyLesson = taxonomy.lessons.find((lesson) => lesson.id === "lesson-1488");
  assert.ok(taxonomyLesson);
  const prompt = deterministicLessonBlueprint(contextFor(taxonomyLesson)).structureFocus;

  assert.match(prompt, /大[卫衛]/u);
  assert.match(prompt, /回望/u);
  assert.match(prompt, /童工/u);
  assert.match(prompt, /敘事視角/u);
  assert.doesNotMatch(prompt, bannedStudentPrompt);
});

test("normalizer rejects author impersonation and accepts only anchored mode-specific API output", () => {
  const taxonomyLesson = taxonomy.lessons.find((lesson) => lesson.id === "lesson-1488");
  const context = contextFor(taxonomyLesson);
  const fallback = deterministicLessonBlueprint(context);
  const generic = normalizeLessonBlueprint({
    structureFocus: "我是狄更斯。我把最關鍵的材料放在這裡；你能說清若抽掉或換序，全文會失去什麼嗎？",
  }, context);
  assert.deepEqual(generic, fallback);

  const anchor = lessonBlueprintPromptAnchor(context);
  const technique = BLUEPRINT_MODE_TECHNIQUES[normalizeBlueprintMode(context.mode)];
  const acceptedText = `定位正文「${anchor}」，比較前後兩處原文，說明${technique}如何形成《${context.blockTitle} · ${context.lessonTitle}》中大衛成年後回望童工生活的複調效果。`;
  assert.equal(inspectLessonBlueprint(acceptedText, context).ok, true);
  assert.deepEqual(normalizeLessonBlueprint({ structureFocus: acceptedText }, context), { structureFocus: acceptedText });
});

test("lesson-blueprint endpoint fails closed to deterministic prompt when APIS returns the old template", async () => {
  const originalFetch = globalThis.fetch;
  const originalCaches = globalThis.caches;
  const cache = new Map();
  let sentPrompt = "";
  globalThis.caches = {
    default: {
      async match(request) { return cache.get(request.url) || null; },
      async put(request, response) { cache.set(request.url, response); },
    },
  };
  globalThis.fetch = async (_url, init) => {
    sentPrompt = JSON.parse(init.body).prompt;
    return new Response(JSON.stringify({
      answer: JSON.stringify({
        structureFocus: "我是狄更斯。我把最关键的材料放在这里；你能说清若抽掉或换序，全文会失去什么吗？",
      }),
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const taxonomyLesson = taxonomy.lessons.find((lesson) => lesson.id === "lesson-1488");
    const context = contextFor(taxonomyLesson);
    const response = await worker.fetch(new Request("https://yw.bdfz.net/api/lesson-blueprint", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(context),
    }), {}, { waitUntil() {} });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.provider, "local-fallback");
    assert.equal(inspectLessonBlueprint(payload.blueprint.structureFocus, context).ok, true);
    assert.doesNotMatch(payload.blueprint.structureFocus, bannedStudentPrompt);
    assert.match(sentPrompt, /不得冒充作者/u);
    assert.match(sentPrompt, /前後至少兩處原文/u);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.caches = originalCaches;
  }
});

test("structure assessment rubric requires two located passages and no rearrangement shortcut", () => {
  const workerSource = fs.readFileSync(path.join(root, "site/_worker.js"), "utf8");
  assert.match(workerSource, /正文定位至少兩處證據/u);
  assert.doesNotMatch(workerSource, /核查學生選出的章法機關是否能在正文定位，並能說清若抽掉或換序會損失什麼/u);
});
