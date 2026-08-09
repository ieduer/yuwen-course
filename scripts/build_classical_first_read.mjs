import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const POLICY_PATH = resolve(ROOT, "scripts/classical_first_read_policy.v1.json");
const TAXONOMY_PATH = resolve(ROOT, "site/data/literary-taxonomy.json");
const READER_DIRECTORY = resolve(ROOT, "site/data/reader-documents");
const OUTPUT_DIRECTORY = resolve(ROOT, "site/data/classical-first-read");
const INDEX_FILENAME = "index.json";

const POLICY_SCHEMA = "yw-classical-first-read-policy-v1";
const OUTPUT_SCHEMA = "yw-classical-first-read-v1";
const INDEX_SCHEMA = "yw-classical-first-read-index-v1";
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const FORBIDDEN_TEXT_PATTERN = /[\uE000-\uF8FF\uFFFD]/u;
const PUNCTUATION_OR_SPACE_PATTERN = /[\p{P}\p{Z}\s]/u;

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stableCanonical(value) {
  if (Array.isArray(value)) return `[${value.map(stableCanonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableCanonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function renderedJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function visibleRunText(run, lessonId, blockIndex) {
  if (!run || typeof run !== "object") {
    throw new Error(`${lessonId} block ${blockIndex} contains an invalid run`);
  }
  if (run.type === "text" || run.type === "link") {
    if (typeof run.text !== "string") {
      throw new Error(`${lessonId} block ${blockIndex} ${run.type} run lacks text`);
    }
    return run.text;
  }
  if (run.type === "annotation-ref" || run.type === "media-ref") return "";
  throw new Error(`${lessonId} block ${blockIndex} contains unsupported run type ${String(run.type)}`);
}

function normalizedVisibleParagraph(block, lessonId, blockIndex) {
  if (block?.type !== "paragraph" || !Array.isArray(block.runs)) {
    throw new Error(`${lessonId} approved block ${blockIndex} must be a paragraph with runs`);
  }
  return block.runs
    .map((run) => visibleRunText(run, lessonId, blockIndex))
    .join("")
    .replace(/\r/g, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function selectedBlockIndices(entry, blockCount) {
  if (!Array.isArray(entry.segments) || entry.segments.length === 0) {
    throw new Error(`${entry.lessonId} requires at least one approved segment`);
  }
  const indices = [];
  let previousEnd = -1;
  for (const segment of entry.segments) {
    const start = Number(segment?.startBlock);
    const end = Number(segment?.endBlock);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) {
      throw new Error(`${entry.lessonId} has an invalid block segment`);
    }
    if (start <= previousEnd) throw new Error(`${entry.lessonId} block segments overlap or are unsorted`);
    if (end >= blockCount) throw new Error(`${entry.lessonId} block segment exceeds reader main blocks`);
    for (let index = start; index <= end; index += 1) indices.push(index);
    previousEnd = end;
  }
  return indices;
}

function replaceAllExact(value, token, replacement) {
  if (!token) throw new Error("cleanup token must not be empty");
  return value.split(token).join(replacement);
}

function applyReviewedCleanup(paragraphs, entry) {
  const cleaned = paragraphs.map((paragraph) => ({ ...paragraph }));
  const dropPrefix = String(entry.dropPrefix || "");
  if (dropPrefix) {
    if (!cleaned[0]?.text.startsWith(dropPrefix)) {
      throw new Error(`${entry.lessonId} reviewed dropPrefix no longer matches`);
    }
    cleaned[0].text = cleaned[0].text.slice(dropPrefix.length).trim();
  }

  const replacements = Array.isArray(entry.replaceTokens) ? entry.replaceTokens : [];
  for (const replacement of replacements) {
    const from = String(replacement?.from || "");
    const to = String(replacement?.to ?? "");
    if (!from) throw new Error(`${entry.lessonId} contains an empty replacement token`);
    for (const paragraph of cleaned) paragraph.text = replaceAllExact(paragraph.text, from, to);
  }

  const stripTokens = Array.isArray(entry.stripTokens) ? entry.stripTokens : [];
  for (const rawToken of stripTokens) {
    const token = String(rawToken || "");
    if (!token) throw new Error(`${entry.lessonId} contains an empty strip token`);
    for (const paragraph of cleaned) paragraph.text = replaceAllExact(paragraph.text, token, "");
  }

  for (const paragraph of cleaned) {
    paragraph.text = paragraph.text.replace(/\s+/gu, " ").trim();
    if (!paragraph.text) throw new Error(`${entry.lessonId} block ${paragraph.sourceBlockIndex} became empty after cleanup`);
    if (FORBIDDEN_TEXT_PATTERN.test(paragraph.text)) {
      throw new Error(`${entry.lessonId} block ${paragraph.sourceBlockIndex} retains a private-use or replacement character`);
    }
  }
  return cleaned;
}

export function extractCanonicalParagraphs(readerDocument, entry, { verifyDigest = true } = {}) {
  if (readerDocument?.schemaVersion !== "yw-reader-document-v1") {
    throw new Error(`${entry.lessonId} reader schema mismatch`);
  }
  if (readerDocument.lessonId !== entry.lessonId) throw new Error(`${entry.lessonId} reader lesson identity mismatch`);
  if (readerDocument.title !== entry.title) throw new Error(`${entry.lessonId} reader title mismatch`);
  if (!Array.isArray(readerDocument.main?.blocks)) throw new Error(`${entry.lessonId} reader main blocks unavailable`);

  const indices = selectedBlockIndices(entry, readerDocument.main.blocks.length);
  const rawParagraphs = indices.map((sourceBlockIndex) => ({
    sourceBlockIndex,
    text: normalizedVisibleParagraph(readerDocument.main.blocks[sourceBlockIndex], entry.lessonId, sourceBlockIndex),
  }));
  const paragraphs = applyReviewedCleanup(rawParagraphs, entry);
  const punctuatedText = paragraphs.map((paragraph) => paragraph.text).join("\n");
  const canonicalPunctuatedDigest = `sha256:${sha256(punctuatedText)}`;
  if (verifyDigest && canonicalPunctuatedDigest !== entry.canonicalPunctuatedDigest) {
    throw new Error(
      `${entry.lessonId} canonical punctuated digest mismatch: expected ${entry.canonicalPunctuatedDigest}, got ${canonicalPunctuatedDigest}`,
    );
  }
  return { paragraphs, punctuatedText, canonicalPunctuatedDigest };
}

export function removeUnicodePunctuationAndWhitespace(value) {
  return String(value || "").normalize("NFC").replace(/[\p{P}\p{Z}\s]+/gu, "");
}

export function isUnpunctuatedText(value) {
  return Boolean(value) && !PUNCTUATION_OR_SPACE_PATTERN.test(value);
}

function validatePolicy(policy, classicalLessons) {
  if (policy?.schema !== POLICY_SCHEMA || Number(policy.schemaVersion) !== 1) {
    throw new Error("classical first-read policy schema mismatch");
  }
  if (policy.readerSchemaVersion !== "yw-reader-document-v1") throw new Error("reader schema policy mismatch");
  if (!policy.curationVersion || !/^[a-f0-9]{64}$/.test(String(policy.curationManifestSha256 || ""))) {
    throw new Error("policy lacks a reviewed reader curation authority");
  }
  if (!Array.isArray(policy.lessons)) throw new Error("policy lessons must be an array");

  const expectedIds = classicalLessons.map((lesson) => lesson.id);
  const policyIds = policy.lessons.map((entry) => String(entry?.lessonId || ""));
  if (new Set(policyIds).size !== policyIds.length) throw new Error("policy contains duplicate lesson ids");
  if (JSON.stringify(policyIds) !== JSON.stringify(expectedIds)) {
    throw new Error("policy must cover every classical lesson in taxonomy order and no other lesson");
  }

  for (let index = 0; index < policy.lessons.length; index += 1) {
    const entry = policy.lessons[index];
    const taxonomyLesson = classicalLessons[index];
    if (entry.title !== taxonomyLesson.title) throw new Error(`${entry.lessonId} policy title differs from taxonomy`);
    if (!DIGEST_PATTERN.test(String(entry.canonicalPunctuatedDigest || ""))) {
      throw new Error(`${entry.lessonId} lacks a reviewed canonical punctuated digest`);
    }
    if (!Array.isArray(entry.stripTokens) || !Array.isArray(entry.replaceTokens)) {
      throw new Error(`${entry.lessonId} cleanup arrays are required`);
    }
  }
}

function buildLessonArtifact(policy, entry) {
  const sourcePath = resolve(READER_DIRECTORY, `${entry.lessonId}.json`);
  if (!existsSync(sourcePath)) throw new Error(`${entry.lessonId} reader document missing`);
  const readerDocument = readJson(sourcePath);
  if (readerDocument.curationVersion !== policy.curationVersion) {
    throw new Error(`${entry.lessonId} reader curation version mismatch`);
  }
  if (readerDocument.curationManifestSha256 !== policy.curationManifestSha256) {
    throw new Error(`${entry.lessonId} reader curation manifest mismatch`);
  }

  const canonical = extractCanonicalParagraphs(readerDocument, entry);
  const keyOccurrences = new Map();
  const paragraphs = canonical.paragraphs.map((paragraph, index) => {
    const text = removeUnicodePunctuationAndWhitespace(paragraph.text);
    if (!isUnpunctuatedText(text)) {
      throw new Error(`${entry.lessonId} block ${paragraph.sourceBlockIndex} did not produce valid unpunctuated text`);
    }
    const contentHash = sha256(`${entry.lessonId}\u0000${text}`);
    const occurrence = (keyOccurrences.get(contentHash) || 0) + 1;
    keyOccurrences.set(contentHash, occurrence);
    return {
      key: `cfrp:${entry.lessonId}:${contentHash.slice(0, 16)}:${String(occurrence).padStart(2, "0")}`,
      ordinal: index + 1,
      sourceBlockIndex: paragraph.sourceBlockIndex,
      text,
      charCount: Array.from(text).length,
    };
  });
  const text = paragraphs.map((paragraph) => paragraph.text).join("");
  if (!isUnpunctuatedText(text)) throw new Error(`${entry.lessonId} combined first-read text is invalid`);
  const textDigest = `sha256:${sha256(text)}`;
  const textVersionId = `cfr-${entry.lessonId}-${textDigest.slice(7, 23)}`;

  return {
    schema: OUTPUT_SCHEMA,
    schemaVersion: 1,
    offsetUnit: "utf16_code_unit",
    lessonId: entry.lessonId,
    title: entry.title,
    textVersionId,
    textDigest,
    canonicalPunctuatedDigest: canonical.canonicalPunctuatedDigest,
    source: {
      readerDocument: `data/reader-documents/${entry.lessonId}.json`,
      curationVersion: readerDocument.curationVersion,
      curationManifestSha256: readerDocument.curationManifestSha256,
      segments: entry.segments,
    },
    paragraphCount: paragraphs.length,
    charCount: Array.from(text).length,
    paragraphs,
    text,
  };
}

export function buildClassicalFirstReadArtifacts() {
  const taxonomy = readJson(TAXONOMY_PATH);
  const classicalLessons = (taxonomy.lessons || []).filter((lesson) => lesson.mode === "classical");
  const policy = readJson(POLICY_PATH);
  validatePolicy(policy, classicalLessons);

  const lessons = policy.lessons.map((entry) => buildLessonArtifact(policy, entry));
  if (lessons.length !== 30) throw new Error(`expected 30 classical lessons, got ${lessons.length}`);
  const paragraphKeys = lessons.flatMap((lesson) => lesson.paragraphs.map((paragraph) => paragraph.key));
  if (new Set(paragraphKeys).size !== paragraphKeys.length) throw new Error("duplicate stable paragraph key");

  const policyDigest = `sha256:${sha256(stableCanonical(policy))}`;
  const index = {
    schema: INDEX_SCHEMA,
    schemaVersion: 1,
    offsetUnit: "utf16_code_unit",
    policyId: policy.policyId,
    policyDigest,
    lessonCount: lessons.length,
    lessons: lessons.map((lesson) => ({
      lessonId: lesson.lessonId,
      title: lesson.title,
      dataUrl: `data/classical-first-read/${lesson.lessonId}.json`,
      textVersionId: lesson.textVersionId,
      textDigest: lesson.textDigest,
      paragraphCount: lesson.paragraphCount,
      charCount: lesson.charCount,
    })),
  };

  return { policy, index, lessons };
}

function expectedFiles(artifacts) {
  return new Map([
    [INDEX_FILENAME, renderedJson(artifacts.index)],
    ...artifacts.lessons.map((lesson) => [`${lesson.lessonId}.json`, renderedJson(lesson)]),
  ]);
}

export function checkClassicalFirstReadArtifacts(artifacts = buildClassicalFirstReadArtifacts()) {
  if (!existsSync(OUTPUT_DIRECTORY)) throw new Error("classical first-read output directory missing");
  const expected = expectedFiles(artifacts);
  const actualNames = readdirSync(OUTPUT_DIRECTORY).sort();
  const expectedNames = [...expected.keys()].sort();
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
    throw new Error("classical first-read output file set is stale");
  }
  for (const [name, content] of expected) {
    const path = resolve(OUTPUT_DIRECTORY, name);
    if (readFileSync(path, "utf8") !== content) throw new Error(`${name} is stale`);
  }
  return artifacts;
}

export function writeClassicalFirstReadArtifacts(artifacts = buildClassicalFirstReadArtifacts()) {
  mkdirSync(OUTPUT_DIRECTORY, { recursive: true });
  const expected = expectedFiles(artifacts);
  const extraFiles = readdirSync(OUTPUT_DIRECTORY).filter((name) => !expected.has(name));
  if (extraFiles.length) throw new Error(`refusing to overwrite output directory with extra files: ${extraFiles.join(", ")}`);
  for (const [name, content] of expected) writeFileSync(resolve(OUTPUT_DIRECTORY, name), content);
  return artifacts;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--check")) throw new Error(`unknown argument: ${args.join(" ")}`);
  const artifacts = buildClassicalFirstReadArtifacts();
  if (args.includes("--check")) {
    checkClassicalFirstReadArtifacts(artifacts);
    console.log(`classical first-read artifacts verified: ${artifacts.lessons.length} lessons`);
    return;
  }
  writeClassicalFirstReadArtifacts(artifacts);
  console.log(`classical first-read artifacts written: ${artifacts.lessons.length} lessons`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
