#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CURATION_DIR = resolve(ROOT, "scripts/study-guide-curation");
const CATALOG_PATH = resolve(ROOT, "site/data/study-guide-catalog.json");
const FORMATIVE_PATH = resolve(ROOT, "site/data/lesson-competency-manifest.json");
const LEARNING_MANIFEST_PATH = resolve(ROOT, "site/data/learning-manifest.json");
const FIRST_READ_INDEX_PATH = resolve(ROOT, "site/data/classical-first-read/index.json");
const STUDY_GUIDE_SOURCE_DIR = process.env.YW_STUDY_GUIDE_SOURCE_DIR
  ? resolve(process.env.YW_STUDY_GUIDE_SOURCE_DIR)
  : resolve(ROOT, "../output/pdf_study_guides_web");
const STUDY_GUIDE_EXTRACTION_DIR = resolve(STUDY_GUIDE_SOURCE_DIR, "json");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableJson(value[key])]));
}

export function semanticRevisionForStudyGuideItem(item) {
  const semantic = {
    lessonId: String(item.lessonId || ""),
    competencyTag: String(item.competencyTag || ""),
    detailTag: String(item.detailTag || ""),
    prompt: String(item.prompt || "").normalize("NFC").replace(/\s+/g, " ").trim(),
    answerAuthority: String(item.answerAuthority || ""),
    referenceAnswer: stableJson(item.referenceAnswer ?? null),
    explanation: String(item.explanation || "").normalize("NFC").replace(/\s+/g, " ").trim(),
    rubric: stableJson(item.rubric || []),
  };
  return sha256(JSON.stringify(stableJson(semantic))).slice(0, 16);
}

function loadCurations() {
  if (!existsSync(CURATION_DIR)) throw new Error("study-guide curation directory missing");
  const files = readdirSync(CURATION_DIR).filter((name) => name.endsWith(".json")).sort();
  if (!files.length) throw new Error("no study-guide curation files");
  return files.map((name) => ({
    name,
    data: JSON.parse(readFileSync(resolve(CURATION_DIR, name), "utf8")),
  }));
}

function normalizeSourceCollection(curation) {
  const raw = Array.isArray(curation.sources) ? curation.sources : (curation.source ? [curation.source] : []);
  return raw.map((source) => ({
    ...source,
    sourceId: source.sourceId || `pdf-${String(source.sha256 || "").slice(0, 16)}`,
  }));
}

function hasReferenceAnswer(item) {
  if (!Object.hasOwn(item, "referenceAnswer") || item.referenceAnswer === null) return false;
  if (typeof item.referenceAnswer === "string") return Boolean(item.referenceAnswer.trim());
  if (Array.isArray(item.referenceAnswer)) return item.referenceAnswer.length > 0;
  if (typeof item.referenceAnswer === "object") return Object.keys(item.referenceAnswer).length > 0;
  return false;
}

function validateCuration(file, data) {
  if (data.schemaVersion !== "yw-study-guide-curation-v1") throw new Error(`${file}: schema invalid`);
  if (
    data.reviewReceipt?.authority !== "codex_pdf_curation_review"
    || !Number.isFinite(Date.parse(data.reviewReceipt?.reviewedAt || ""))
    || !String(data.reviewReceipt?.disposition || "").includes("flagged_items_inactive")
  ) throw new Error(`${file}: review receipt incomplete`);
  const sources = normalizeSourceCollection(data);
  if (!sources.length || !Array.isArray(data.lessons)) throw new Error(`${file}: sources or lessons missing`);
  for (const source of sources) {
    if (
      !source.sourceId
      || !source.fileName
      || /[\\/]/.test(source.fileName)
      || !/^[a-f0-9]{64}$/.test(source.sha256 || "")
      || !Number.isInteger(Number(source.byteLength))
      || Number(source.byteLength) <= 0
      || !source.extractionFileName
      || /[\\/]/.test(source.extractionFileName)
      || !/^[a-f0-9]{64}$/.test(source.extractionSha256 || "")
      || !Number.isInteger(Number(source.extractionByteLength))
      || Number(source.extractionByteLength) <= 0
      || !Number.isInteger(Number(source.pageCount))
      || Number(source.pageCount) <= 0
    ) {
      throw new Error(`${file}: source receipt incomplete`);
    }
  }
  for (const lesson of data.lessons) {
    if (!/^lesson-[\w-]+$/.test(lesson.lessonId || "") || !Array.isArray(lesson.items)) {
      throw new Error(`${file}: lesson contract invalid`);
    }
    for (const item of lesson.items) {
      if (!item.itemKey || !["vocabulary", "syntax", "comprehension"].includes(item.competencyTag)) {
        throw new Error(`${file}: item identity invalid`);
      }
      if (!["source_answer", "codex_reference"].includes(item.answerAuthority)) {
        throw new Error(`${file}: answer authority invalid for ${item.itemKey}`);
      }
      if (item.answerAuthority === "codex_reference" && item.answerLabel !== "Codex 參考答案") {
        throw new Error(`${file}: Codex answer label missing for ${item.itemKey}`);
      }
      if (item.answerAuthority === "source_answer" && !String(item.answerLabel || "").trim()) {
        throw new Error(`${file}: source answer label missing for ${item.itemKey}`);
      }
      if (item.reviewRequired && item.activeForSelfTest) {
        throw new Error(`${file}: review-required item cannot be active ${item.itemKey}`);
      }
      if (item.activeForSelfTest && !hasReferenceAnswer(item)) {
        throw new Error(`${file}: item without a reference answer cannot be active ${item.itemKey}`);
      }
      if (item.semanticAliases !== undefined
        && (!Array.isArray(item.semanticAliases)
          || item.semanticAliases.some((revision) => !/^[a-f0-9]{16}$/.test(String(revision))))) {
        throw new Error(`${file}: semantic alias invalid for ${item.itemKey}`);
      }
    }
  }
}

function publicSource(source) {
  return {
    sourceId: source.sourceId,
    fileName: source.fileName,
    sha256: source.sha256,
    byteLength: Number(source.byteLength),
    pageCount: Number(source.pageCount || source.pagesCount || 0),
    pageOffset: Number(source.pageOffset || 0),
    extractionFileName: source.extractionFileName,
    extractionSha256: source.extractionSha256,
    extractionByteLength: Number(source.extractionByteLength),
  };
}

export function verifyStudyGuideSourceBytes() {
  const curations = loadCurations();
  const verified = new Map();
  for (const { name, data } of curations) {
    for (const source of normalizeSourceCollection(data)) {
      const pdfPath = resolve(STUDY_GUIDE_SOURCE_DIR, source.fileName);
      const extractionPath = resolve(STUDY_GUIDE_EXTRACTION_DIR, source.extractionFileName);
      if (!existsSync(pdfPath) || !existsSync(extractionPath)) {
        throw new Error(`${name}: source bytes missing from ${STUDY_GUIDE_SOURCE_DIR}`);
      }
      const pdf = readFileSync(pdfPath);
      const extraction = readFileSync(extractionPath);
      if (pdf.length !== Number(source.byteLength) || sha256(pdf) !== source.sha256) {
        throw new Error(`${name}: PDF byte receipt mismatch for ${source.fileName}`);
      }
      if (
        extraction.length !== Number(source.extractionByteLength)
        || sha256(extraction) !== source.extractionSha256
      ) {
        throw new Error(`${name}: extraction byte receipt mismatch for ${source.extractionFileName}`);
      }
      const info = spawnSync("pdfinfo", [pdfPath], { encoding: "utf8" });
      const pageMatch = /^Pages:\s+(\d+)$/m.exec(info.stdout || "");
      if (info.status !== 0 || Number(pageMatch?.[1]) !== Number(source.pageCount)) {
        throw new Error(`${name}: PDF page-count receipt mismatch for ${source.fileName}`);
      }
      verified.set(source.sourceId, {
        sourceId: source.sourceId,
        pdfBytes: pdf.length,
        pdfSha256: source.sha256,
        extractionBytes: extraction.length,
        extractionSha256: source.extractionSha256,
        pageCount: Number(source.pageCount),
      });
    }
  }
  return [...verified.values()].sort((a, b) => a.sourceId.localeCompare(b.sourceId));
}

export function buildStudyGuideCatalog() {
  const curations = loadCurations();
  curations.forEach(({ name, data }) => validateCuration(name, data));
  const sourceById = new Map();
  const lessonById = new Map();
  const itemKeys = new Set();
  const reviewReceipts = curations.map(({ name, data }) => ({ file: name, ...data.reviewReceipt }));

  for (const { data } of curations) {
    for (const source of normalizeSourceCollection(data)) {
      const publicValue = publicSource(source);
      const prior = sourceById.get(publicValue.sourceId);
      if (prior && JSON.stringify(prior) !== JSON.stringify(publicValue)) {
        throw new Error(`source receipt conflict: ${publicValue.sourceId}`);
      }
      sourceById.set(publicValue.sourceId, publicValue);
    }
    for (const lesson of data.lessons) {
      const target = lessonById.get(lesson.lessonId) || {
        lessonId: lesson.lessonId,
        sourceIds: [],
        sourceGaps: [],
        items: [],
      };
      const defaultSourceIds = normalizeSourceCollection(data).map((source) => source.sourceId);
      target.sourceIds.push(...(lesson.sourceIds || defaultSourceIds));
      target.sourceGaps.push(...(lesson.sourceGaps || []));
      for (const item of lesson.items) {
        if (itemKeys.has(item.itemKey)) throw new Error(`duplicate study-guide itemKey: ${item.itemKey}`);
        itemKeys.add(item.itemKey);
        target.items.push({
          lessonId: lesson.lessonId,
          ...item,
          answerLabel: item.answerAuthority === "source_answer" ? "學案來源答案" : item.answerLabel,
          semanticRevision: semanticRevisionForStudyGuideItem({ lessonId: lesson.lessonId, ...item }),
          semanticAliases: [...new Set((item.semanticAliases || []).map(String))].sort(),
        });
      }
      lessonById.set(lesson.lessonId, target);
    }
  }

  const sources = [...sourceById.values()].sort((a, b) => a.sourceId.localeCompare(b.sourceId));
  const lessons = [...lessonById.values()]
    .map((lesson) => ({
      ...lesson,
      sourceIds: [...new Set(lesson.sourceIds)].sort(),
      sourceGaps: lesson.sourceGaps,
      items: lesson.items.sort((a, b) => a.itemKey.localeCompare(b.itemKey)),
    }))
    .sort((a, b) => a.lessonId.localeCompare(b.lessonId));
  const digestInput = JSON.stringify(stableJson({ sources, lessons, reviewReceipts }));
  const digest = sha256(digestInput);
  const itemCount = lessons.reduce((sum, lesson) => sum + lesson.items.length, 0);
  const activeItemCount = lessons.reduce(
    (sum, lesson) => sum + lesson.items.filter((item) => item.activeForSelfTest).length,
    0,
  );
  return {
    schemaVersion: "yw-study-guide-catalog-v1",
    catalogVersion: `yw-study-guides-${digest.slice(0, 16)}`,
    catalogDigest: `sha256:${digest}`,
    answerPolicy: {
      sourceAnswerLabel: "學案來源答案",
      codexReferenceLabel: "Codex 參考答案",
      codexReferencesAreNotUniqueForOpenResponses: true,
      reviewRequiredItemsAreExcludedFromSelfTest: true,
    },
    sourceCount: sources.length,
    lessonCount: lessons.length,
    itemCount,
    activeItemCount,
    sources,
    reviewReceipts,
    lessons,
  };
}

function competencyForFormalItem(item) {
  if (item.questionKind === "vocabulary" || item.questionKind === "wordCreation") return "vocabulary";
  if (item.questionKind === "revision") return "syntax";
  if (["contextWords", "structure", "authorQuestion"].includes(item.questionKind)) return "comprehension";
  return null;
}

function interactionForFormalItem(item) {
  return item.questionKind === "vocabulary" ? "vocabAnswer" : item.questionKind;
}

export function buildLessonCompetencyManifest(catalog = buildStudyGuideCatalog()) {
  const learning = JSON.parse(readFileSync(LEARNING_MANIFEST_PATH, "utf8"));
  const firstRead = JSON.parse(readFileSync(FIRST_READ_INDEX_PATH, "utf8"));
  const items = [];

  for (const item of learning.items || []) {
    const competencyTag = competencyForFormalItem(item);
    if (!competencyTag) continue;
    const interactionKey = interactionForFormalItem(item);
    items.push({
      lessonId: item.sourceId,
      competencyTag,
      itemKey: `formal:${item.resourceKey}`,
      completionKey: `${item.resourceKey}#${interactionKey}`,
      interactionKey,
      resourceKey: item.resourceKey,
      sourceKind: "formal_learning_manifest",
      answerAuthority: item.questionKind === "vocabulary" ? "source_answer" : "source_assessment",
      scoringRole: "a_plus_gate",
      active: true,
    });
  }
  for (const lesson of firstRead.lessons || []) {
    for (const [itemKey, interactionKey] of [
      ["first-read:submitted", "initialReadingSubmitted"],
      ["first-read:resolved", "initialReadingResolved"],
    ]) {
      const resourceKey = `lesson:${lesson.lessonId}`;
      items.push({
        lessonId: lesson.lessonId,
        competencyTag: "first_read_process",
        itemKey,
        completionKey: `${resourceKey}#${interactionKey}`,
        interactionKey,
        resourceKey,
        sourceKind: "classical_first_read",
        answerAuthority: "process_evidence",
        scoringRole: "none",
        active: true,
      });
    }
  }
  for (const lesson of catalog.lessons) {
    for (const item of lesson.items.filter((entry) => entry.activeForSelfTest)) {
      const resourceKey = `formative:${lesson.lessonId}:${item.competencyTag}:${item.semanticRevision}`;
      const resourceAliases = (item.semanticAliases || []).map(
        (revision) => `formative:${lesson.lessonId}:${item.competencyTag}:${revision}`,
      );
      items.push({
        lessonId: lesson.lessonId,
        competencyTag: item.competencyTag,
        itemKey: item.itemKey,
        semanticRevision: item.semanticRevision,
        completionKey: `${resourceKey}#studyGuideItemCompleted`,
        interactionKey: "studyGuideItemCompleted",
        resourceKey,
        resourceAliases,
        completionAliases: resourceAliases.map((alias) => `${alias}#studyGuideItemCompleted`),
        sourceKind: "study_guide",
        answerAuthority: item.answerAuthority,
        scoringRole: "formative",
        active: true,
      });
    }
  }

  const uniqueCompletionKeys = new Set(items.map((item) => item.completionKey));
  if (uniqueCompletionKeys.size !== items.length) throw new Error("duplicate formative completion key");
  const grouped = new Map();
  for (const item of items) {
    const lesson = grouped.get(item.lessonId) || new Map();
    const competency = lesson.get(item.competencyTag) || [];
    competency.push(item);
    lesson.set(item.competencyTag, competency);
    grouped.set(item.lessonId, lesson);
  }
  const lessons = [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([lessonId, competencies]) => ({
    lessonId,
    competencies: [...competencies.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([competencyTag, activeItems]) => ({
      competencyTag,
      activeItemCount: activeItems.length,
      activeSetHash: `sha256:${sha256(activeItems.map((item) => item.completionKey).sort().join("\n"))}`,
      items: activeItems.sort((a, b) => a.completionKey.localeCompare(b.completionKey)),
    })),
  }));
  const descriptorRows = lessons.flatMap((lesson) => lesson.competencies.flatMap((competency) => (
    competency.items.map((item) => ({ lessonId: lesson.lessonId, competencyTag: competency.competencyTag, ...item }))
  )));
  const tombstones = catalog.lessons.flatMap((lesson) => lesson.items
    .filter((item) => !item.activeForSelfTest)
    .map((item) => ({
      lessonId: lesson.lessonId,
      competencyTag: item.competencyTag,
      semanticRevision: item.semanticRevision,
      resourceKey: `formative:${lesson.lessonId}:${item.competencyTag}:${item.semanticRevision}`,
      disposition: item.reviewRequired ? "review_required_inactive" : "inactive",
    }))).sort((a, b) => a.resourceKey.localeCompare(b.resourceKey));
  const historyPolicy = {
    identityUnit: "lesson_competency_semantic_revision",
    itemKeyRole: "internal_editor_address_only",
    renameWithUnchangedSemantics: "preserve_completion_via_same_semantic_revision",
    changedPromptAnswerRubricOrCompetency: "new_active_resource_old_completion_excluded",
    retiredOrReviewRequired: "ledger_preserved_but_excluded_from_active_denominator",
    reviewedEquivalentRevision: "explicit_semantic_alias_only",
  };
  const digest = sha256(JSON.stringify(stableJson({ descriptorRows, historyPolicy, tombstones })));
  return {
    schemaVersion: "yw-lesson-competency-manifest-v1",
    sourceSiteKey: "yw",
    manifestVersion: `yw-formative-${digest.slice(0, 16)}`,
    manifestDigest: `sha256:${digest}`,
    registryVersion: "yw-interactions-2026-08-09-v2",
    formalLearningManifestVersion: learning.manifestVersion,
    formalLearningManifestDigest: learning.resourceKeyHash,
    studyGuideCatalogVersion: catalog.catalogVersion,
    studyGuideCatalogDigest: catalog.catalogDigest,
    firstReadPolicyDigest: firstRead.policyDigest,
    aggregationUnit: ["lessonId", "competencyTag"],
    completionRule: "completed_completion_keys_intersect_current_active_completion_keys",
    historyPolicy,
    tombstones,
    zeroTotalDisposition: "unavailable",
    scoringPolicy: "formative_projection_does_not_modify_a_to_f_or_a_plus",
    itemCount: descriptorRows.length,
    lessonCount: lessons.length,
    lessons,
  };
}

export function masteryForCompleted(activeItems, completedKeys) {
  const active = (activeItems || []).filter((item) => item.active !== false);
  if (active.length === 0) return { status: "unavailable", completed: 0, total: 0, masteryRate: null };
  const completed = new Set(completedKeys || []);
  let completedCount = 0;
  active.forEach((item) => {
    if (completed.has(item.completionKey)
      || (item.completionAliases || []).some((alias) => completed.has(alias))) completedCount += 1;
  });
  return {
    status: "available",
    completed: completedCount,
    total: active.length,
    masteryRate: completedCount / active.length,
  };
}

export function renderStudyGuideCatalog() {
  return `${JSON.stringify(buildStudyGuideCatalog(), null, 2)}\n`;
}

export function renderLessonCompetencyManifest(catalog = buildStudyGuideCatalog()) {
  return `${JSON.stringify(buildLessonCompetencyManifest(catalog), null, 2)}\n`;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  if (args.some((arg) => !["--check", "--verify-sources"].includes(arg))) {
    throw new Error(`unknown argument: ${args.join(" ")}`);
  }
  if (args.includes("--verify-sources")) {
    const verified = verifyStudyGuideSourceBytes();
    process.stdout.write(`verified ${verified.length} PDF and extraction byte receipts\n`);
  }
  const catalog = buildStudyGuideCatalog();
  const catalogRendered = `${JSON.stringify(catalog, null, 2)}\n`;
  const formativeRendered = `${JSON.stringify(buildLessonCompetencyManifest(catalog), null, 2)}\n`;
  if (args.includes("--check")) {
    if (!existsSync(CATALOG_PATH) || readFileSync(CATALOG_PATH, "utf8") !== catalogRendered) {
      throw new Error("site/data/study-guide-catalog.json is stale");
    }
    if (!existsSync(FORMATIVE_PATH) || readFileSync(FORMATIVE_PATH, "utf8") !== formativeRendered) {
      throw new Error("site/data/lesson-competency-manifest.json is stale");
    }
    process.stdout.write(`study-guide catalog current: ${catalog.itemCount} items\n`);
  } else {
    writeFileSync(CATALOG_PATH, catalogRendered, "utf8");
    writeFileSync(FORMATIVE_PATH, formativeRendered, "utf8");
    process.stdout.write(`generated ${catalog.itemCount} study-guide items and formative manifest\n`);
  }
}
