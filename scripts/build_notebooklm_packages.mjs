#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  annotationParts,
  cleanAnnotationText,
  extractAnnotations,
  loadLesson,
  loadManifest,
  loadTaxonomy,
} from "./vocab_lib.mjs";
import {
  LESSON_TASK_GROUP_OVERRIDE,
  MODE_DECK_METHOD,
  PILOT_AUXILIARY,
  PILOT_LESSON_IDS,
  PILOT_SHARED_LEARNING_GUIDANCE,
  TASK_GROUPS,
  UNIT_TASK_GROUP,
} from "./notebooklm_config.mjs";

const ROOT = new URL("../notebooklm/selected-compulsory/", import.meta.url).pathname;
const SOURCE_STANDARD = new URL("../../curriculum-atlas/.cache/text/moe-hs-2020-02.txt", import.meta.url).pathname;
const ALL = process.argv.includes("--all");
const CLEAN = process.argv.includes("--clean");
const SELECTED_BLOCKS = new Set(["xuanbi-shang", "xuanbi-zhong", "xuanbi-xia"]);
const ACTUAL_MODES = new Set([
  "classical",
  "poetry",
  "fiction",
  "drama",
  "journalism",
  "argument",
  "science",
  "modern-prose",
  "speech-letter",
]);

const STANDARD_EXCERPTS = {
  language: [
    "在丰富的语言实践中，探究语言文字运用规律，增强语言敏感性和语言文字运用的准确性、规范性。",
    "通过观察、比较、归纳、梳理，积累语言材料，并在具体语境中理解、运用。",
  ],
  revolutionary: [
    "弄清作品的时代背景，把握作品的内涵，理解作者的创作意图，获得审美体验。",
    "阅读革命传统的新闻、通讯、报告、演讲、访谈、述评等实用性文体，深入理解其内容，学习其写作手法。",
    "重视对作品有关背景的深入了解，获取真实资料，撰写读书笔记或学习体会。",
  ],
  traditional: [
    "选择中国文化史上不同时期、不同类型的代表性作品进行精读，体会其精神内涵、审美追求和文化价值。",
    "梳理常见文言实词、虚词、特殊句式和文化常识，注意古今语言的异同。",
    "借助注释、工具书独立研读文本；就历史价值、时代意义和局限表达有证据的看法。",
  ],
  modern: [
    "精读代表性作家作品，把握其精神内涵与艺术价值。",
    "从体裁特征、题材内容、文学发展阶段等角度组织研习，保证学生独立自主阅读与个性化体验。",
    "养成撰写读书笔记的习惯，形成内容提要、阅读感受和作品评论。",
  ],
  foreign: [
    "整体把握作品的情感基调与思想内涵，认识所读作品的地位和价值。",
    "调动世界历史、地理和不同民族文化知识，理解作品中的社会生活及心灵世界。",
    "探讨不同民族文学之间的共同话题和文化差异，尊重文化多样性。",
  ],
  science: [
    "领会不同领域科学与文化论著的内容，培养科学态度和创新精神。",
    "体验概括、归纳、推理、实证等科学思维方法，把握观点明确、逻辑严密、语言准确精练等特点。",
    "借助工具书和学科资料理解基本概念和观点，理清文本结构脉络、论证逻辑。",
  ],
};

function json(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function write(file, content) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function stripTitle(value) {
  return String(value || "")
    .replace(/^\s*\d+\s*[、.．]?\s*/, "")
    .replace(/^\s*[*＊]\s*/, "")
    .replace(/\s*\/\s*[^/]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeEntities(value) {
  const named = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: "\"",
  };
  return String(value || "").replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (_, code) => {
    if (code[0] !== "#") return named[code.toLowerCase()] ?? `&${code};`;
    const number = code[1].toLowerCase() === "x"
      ? Number.parseInt(code.slice(2), 16)
      : Number.parseInt(code.slice(1), 10);
    return Number.isFinite(number) ? String.fromCodePoint(number) : "";
  });
}

function htmlToText(html, { removeFootnotes = true } = {}) {
  let value = String(html || "");
  if (removeFootnotes) {
    value = value.replace(/<(?:ol|section)[^>]*class="[^"]*footnote[^"]*"[^>]*>[\s\S]*?<\/(?:ol|section)>/gi, "");
  }
  value = value
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, "")
    .replace(/<(?:br|hr)\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|blockquote|h[1-6]|li|tr)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "");
  return decodeEntities(value)
    .replace(/\[color=[^\]]+\]|\[\/color\]/gi, "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractSourceAnnotations(lesson) {
  const seen = new Set();
  const annotations = [];
  for (const post of lesson.posts || []) {
    const cooked = String(post.cooked || "");
    for (const match of cooked.matchAll(/<li id="(footnote-[\w-]+)" class="footnote-item">(.*?)<\/li>/gs)) {
      const parsed = annotationParts(cleanAnnotationText(match[2]));
      const key = `${parsed.word}|${parsed.note}`;
      if (!parsed.word || seen.has(key)) continue;
      seen.add(key);
      annotations.push(parsed);
    }
  }
  return annotations.length ? annotations : extractAnnotations(lesson);
}

function removeMirrorTail(value) {
  return String(value || "")
    .replace(/\n?https?:\/\/(?:sites\.google\.com|mp\.weixin\.qq\.com)\S*/g, "")
    .replace(/\n?This is a companion discussion topic[\s\S]*$/i, "")
    .trim();
}

function primaryPost(lesson) {
  return (lesson.posts || []).find((post) => String(post.plain_text || "").trim().length > 350)
    || lesson.posts?.[0]
    || null;
}

function sourceText(lesson) {
  const post = primaryPost(lesson);
  const raw = removeMirrorTail(htmlToText(post?.cooked || post?.plain_text || ""));
  const marker = raw.search(/\n?学习提示\s*/);
  if (marker < 0) return { body: raw, learningGuidance: "" };
  return {
    body: raw.slice(0, marker).trim(),
    learningGuidance: raw.slice(marker).replace(/^\s*学习提示\s*/, "").trim(),
  };
}

function markdownList(items, empty = "（无）") {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : empty;
}

function sourceVersion(lesson) {
  const textbook = lesson.textbook || {};
  return {
    sourceKind: "统编高中语文教材正文与教材页影印",
    bookId: textbook.bookId || "",
    bookTitle: textbook.bookTitle || lesson.blockTitle || "",
    tocLabel: textbook.tocLabel || lesson.title || "",
    pages: textbook.pages || [],
    pageImages: textbook.pageImages || [],
    forumTopic: lesson.topicUrl || lesson.url || "",
    extractionRule: "仅使用主帖教材正文；论坛回复、机器人回答和未核查镜像不进入正文来源。",
  };
}

function buildUnits(manifest, taxonomy) {
  const taxonomyById = new Map(taxonomy.lessons.map((lesson) => [lesson.id, lesson]));
  const units = [];
  for (const block of manifest.blocks.filter((item) => SELECTED_BLOCKS.has(item.id))) {
    let current = null;
    let number = 0;
    for (const item of block.lessons) {
      const meta = taxonomyById.get(item.id);
      if (!meta) continue;
      if (meta.mode === "unit-intro") {
        number += 1;
        current = { block, number, intro: item, items: [] };
        units.push(current);
      }
      if (!current) continue;
      current.items.push({ ...item, taxonomy: meta });
    }
  }
  return units.map((unit) => ({
    ...unit,
    task: unit.items.find((item) => item.taxonomy.mode === "unit-task") || null,
    lessons: unit.items.filter((item) => ACTUAL_MODES.has(item.taxonomy.mode)),
  }));
}

function taskGroupFor(unit, lessonId = "") {
  const key = LESSON_TASK_GROUP_OVERRIDE[lessonId]
    || UNIT_TASK_GROUP[`${unit.block.id}:${unit.number}`]
    || "language";
  return { key, ...TASK_GROUPS[key] };
}

function auxiliaryFor(lessonId) {
  return PILOT_AUXILIARY[lessonId] || [];
}

function learningGuidanceFor(lesson, extracted) {
  if (extracted.learningGuidance) {
    return {
      text: extracted.learningGuidance,
      sharedWith: "",
      sourcePages: lesson.textbook?.pageImages?.slice(-1).map((page) => page.src) || [],
      reviewStatus: "教材正文抽取；需与影印页逐字核查",
    };
  }
  const shared = PILOT_SHARED_LEARNING_GUIDANCE[lesson.id];
  if (shared) return { ...shared, reviewStatus: "人工对照教材影印页核查" };
  return {
    text: "本篇的学习提示与同组篇目合并编排，当前扩展批次须在上传 NotebookLM 前从相邻教材页逐字核入。",
    sharedWith: "",
    sourcePages: lesson.textbook?.pageImages?.slice(-1).map((page) => page.src) || [],
    reviewStatus: "待扩展批次核查",
  };
}

function lessonRecord(unit, item) {
  const lesson = loadLesson(item.id);
  const extracted = sourceText(lesson);
  const sharedGuidance = PILOT_SHARED_LEARNING_GUIDANCE[item.id];
  if (sharedGuidance) {
    const marker = sharedGuidance.text.split("\n")[0].slice(0, 24);
    const markerAt = extracted.body.indexOf(marker);
    if (markerAt > 0) extracted.body = extracted.body.slice(0, markerAt).trim();
  }
  if (item.id === "lesson-1559") {
    const poemAt = extracted.body.indexOf("噫吁嚱");
    const sourceLine = extracted.body.match(/^选自《李白集校注》[^\n]*/)?.[0] || "";
    if (poemAt > 0) extracted.body = `${sourceLine}\n\n${extracted.body.slice(poemAt)}`.trim();
  }
  const introLesson = loadLesson(unit.intro.id);
  const taskLesson = unit.task ? loadLesson(unit.task.id) : null;
  const introText = sourceText(introLesson).body;
  const taskText = taskLesson ? sourceText(taskLesson).body : "";
  const guidance = learningGuidanceFor(lesson, extracted);
  const group = taskGroupFor(unit, item.id);
  const annotations = extractSourceAnnotations(lesson);
  const authorNames = item.taxonomy.authors.map((author) => author.name).filter(Boolean);
  const title = authorNames.reduce(
    (value, author) => value.replace(new RegExp(`\\s*${author.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`), "").trim(),
    stripTitle(item.title),
  );
  return {
    lesson,
    item,
    unit,
    title,
    extracted,
    introText,
    taskText,
    guidance,
    group,
    sectionLabel: LESSON_TASK_GROUP_OVERRIDE[item.id] ? "古诗词诵读" : `第 ${unit.number} 单元`,
    annotations,
    auxiliary: auxiliaryFor(item.id),
    pilot: PILOT_LESSON_IDS.includes(item.id),
  };
}

function sourceReadme(record, generatedAt, commit) {
  const status = record.pilot ? "试点来源包已建立，待 NotebookLM 生成物逐项审核" : "扩展批次模板，待试点验收后补齐共享学习提示与辅助资料核查";
  return `# ${record.title} · NotebookLM 来源包

- 课文 ID：\`${record.item.id}\`
- 册次：${record.item.blockTitle}
- 教材分组：${record.sectionLabel}
- 文体模式：\`${record.item.taxonomy.mode}\`
- 教材版本：${record.lesson.textbook?.bookTitle || record.item.blockTitle}
- 教材页：${(record.lesson.textbook?.pages || []).join("、") || "未标页"}
- 课程标准：${record.group.label}；同时落实${TASK_GROUPS.language.label}
- 生成日期：${generatedAt.slice(0, 10)}
- 源代码版本：\`${commit}\`
- 状态：${status}

## 上传 NotebookLM 的来源

1. \`sources/01-text-and-annotations.md\`：课文正文、教材出处、课下注释、学习提示。
2. \`sources/02-unit-guide-and-learning-task.md\`：单元导语与课后单元研习任务。
3. \`sources/03-curriculum-standard.md\`：对应课程标准任务群要求。
4. \`sources/04-verified-auxiliary.md\`：经过核查且确有必要的辅助资料；不得替代教材证据。
5. \`sources/05-textbook-facsimile.pdf\`：试点上传时生成，保留教材版式、注释和学习提示的视觉真值。

## 生成纪律

- Slide Deck 使用 \`prompts/slide-deck.md\` 中的本课专门指令。
- 只允许逐字引用来源包中可定位的文字；无法定位的引文删除。
- 图片必须可核实对象、时代和版权来源；不能确认时使用抽象结构图、地图、时间轴或文本排版。
- 下载产物后填写 \`resource-record.json\` 的生成日期、审核状态、文件哈希和问题记录。
`;
}

function textSource(record) {
  const source = sourceVersion(record.lesson);
  const authors = record.item.taxonomy.authors.map((author) => `${author.name}${author.dates ? `（${author.dates}）` : ""}`);
  return `# ${record.title}：课文、注释与学习提示

## 来源版本

- 教材：${source.bookTitle}
- 目录题名：${source.tocLabel}
- 教材页：${source.pages.join("、")}
- 教材影印：${source.pageImages.map((page) => `[${page.label}](${page.src})`).join("、")}
- 作者：${authors.join("、") || "教材未署个人作者"}
- 抽取规则：${source.extractionRule}

## 课文

${record.extracted.body}

## 课下注释

${record.annotations.length
    ? record.annotations.map((annotation, index) => `${index + 1}. **${annotation.word}**：${annotation.note}`).join("\n")
    : "本篇在当前教材数据中未抽取到独立脚注；须以教材影印页为准。"}

## 学习提示

${record.guidance.sharedWith ? `> 本提示与${record.guidance.sharedWith}合并编排。\n\n` : ""}${record.guidance.text}

### 学习提示核查

- 状态：${record.guidance.reviewStatus}
- 对应教材页：${record.guidance.sourcePages.map((url) => `[影印页](${url})`).join("、") || "见本篇教材影印页"}
`;
}

function unitSource(record) {
  return `# ${record.title}：单元导语与课后学习任务

## 单元定位

- 册次：${record.item.blockTitle}
- 教材分组：${record.sectionLabel}
- 单元导语条目：${record.unit.intro.title}
- 单元研习任务条目：${record.unit.task?.title || "本单元未独立拆出研习任务页"}

## 单元导语

${record.introText || "当前教材数据未抽取到单元导语正文；上传前须以教材影印页补齐。"}

## 课后学习任务

${record.taskText || "本册采用单元研习任务统整课后学习；当前单元未独立拆出任务条目，扩展时须核对相邻教材页。"}

## 与本篇的使用方式

生成课堂材料时，不要把整个单元的所有任务平均分配到本篇。只选择能够由《${record.title}》原文证据完成的任务，并明确学生最终要提交的可观察成果。
`;
}

function standardSource(record) {
  const excerpts = [...STANDARD_EXCERPTS.language, ...(STANDARD_EXCERPTS[record.group.key] || [])];
  return `# ${record.title}：对应课程标准要求

## 标准版本

- 文件：中华人民共和国教育部《普通高中语文课程标准（2017年版2020年修订）》
- 发布依据：教材〔2020〕3号
- 本地核查文本：\`${SOURCE_STANDARD}\`
- 对应任务群：${record.group.label}
- 共同要求：${TASK_GROUPS.language.label}
- 适用层级：选择性必修；学业质量水平三、四

## 本课需要落实的要求

${markdownList(excerpts)}

## 本课转化

- 结构理解：能用可核查的层次图说明《${record.title}》如何组织材料。
- 文本证据：每个判断至少对应一处可定位原句，不以背景资料替代文本。
- 阅读方法：${MODE_DECK_METHOD[record.item.taxonomy.mode]}
- 学习成果：完成一项可展示、可互评、可修改的阅读任务，并说明证据与结论的边界。

> 说明：以上为课标要求的课堂转化，不是对课程标准原文的替换；生成材料不得虚构页码或把转化语句标成课标原文。
`;
}

function auxiliarySource(record) {
  if (!record.auxiliary.length) {
    return `# ${record.title}：必要辅助资料

试点验收后再进入本篇扩展批次。当前不上传未经逐项核查的论坛回复、机器人回答、社交媒体截图或 NotebookLM 分享页。

扩展前必须补齐：

- 版本或作者事实的第一方/权威来源；
- 仅为理解关键历史、地理、体裁或科学概念所必需的资料；
- 每项资料的用途、证据边界和核查日期。
`;
  }
  return `# ${record.title}：经过核查的必要辅助资料

${record.auxiliary.map((source, index) => `## ${index + 1}. ${source.title}

- 发布者/版本：${source.publisher}
- 地址：${source.url}
- 使用目的：${source.purpose}
- 核查日期：2026-07-25
`).join("\n")}
## 排除项

- 不采用论坛中的机器人回答、戏仿文本、未经核实的社交媒体内容。
- 不采用 NotebookLM 分享页面作为本站接入资源。
- 辅助资料只能补足背景或版本核查，不能取代教材原文、注释、单元导语和学习任务。
`;
}

function slidePrompt(record) {
  return `你正在为高中语文选择性必修课堂制作《${record.title}》Slide Deck。只使用本 Notebook 中勾选的来源，面向已经读过课文的高中生和授课教师。

本课专门方法：
${MODE_DECK_METHOD[record.item.taxonomy.mode]}

必须呈现：
1. 课文结构：用一张总图标出各部分功能和推进关系，不按段落机械复述。
2. 关键问题：提出 2–3 个必须回到文本才能回答的问题；问题要由单元导语、学习提示和课后任务共同限定。
3. 文本证据：每个关键判断至少放一处短引文，并标出可定位的段落或诗句；逐字核对，不得拼接或改写成“引文”。
4. 阅读方法：显性示范本课文体所需的方法，而不是只给结论。
5. 学习任务：最后给一个 8–12 分钟可完成、可提交、可互评的任务，写清产出格式和评价标准。

建议 9–12 页：
- 封面与学习目标 1页；
- 结构总览 1页；
- 关键问题与证据 5–7页；
- 方法迁移 1页；
- 课堂任务与退出条 1页。

事实与视觉约束：
- 历史日期、人物身份、地名、作品版本先同教材和辅助资料交叉核查。
- 不生成或误用人物肖像、历史照片、书影；不能确认时使用时间轴、空间图、关系图、文本排版和简洁示意。
- 所有中文使用简体，专名、标点、古诗文和外文拼写逐字核对。
- 保持16:9课堂投影安全区，正文每页不超过90个汉字，字号足以让教室后排阅读。
- 不使用二维码，不引导访问 NotebookLM 分享页。

输出前自检：结构、关键问题、文本证据、阅读方法、学习任务五项是否齐全；每处引文能否在来源中定位；每张图片是否必要且可核实。
`;
}

function emptyResourceRecord(record, generatedAt, commit) {
  const packageStatus = record.pilot ? "source-package-reviewed" : "source-package-generated-pending-review";
  return {
    lessonId: record.item.id,
    title: record.title,
    blockId: record.item.blockId,
    unit: record.sectionLabel === "古诗词诵读" ? null : record.unit.number,
    sectionLabel: record.sectionLabel,
    mode: record.item.taxonomy.mode,
    notebook: {
      title: `${record.title}｜选择性必修${record.item.blockTitle.replace("選必", "")}｜来源核查版`,
      sourcePackageVersion: `yw-nlm-source-v1-${generatedAt.slice(0, 10)}`,
      sourceCommit: commit,
      packageStatus,
      generatedAt,
    },
    slideDeck: {
      promptVersion: "yw-slide-v1",
      generatedAt: null,
      file: null,
      sha256: null,
      reviewStatus: "not-generated",
      review: {
        facts: null,
        textAndQuotes: null,
        images: null,
        layout: null,
        teachingFit: null,
        notes: [],
      },
    },
  };
}

function catalogMarkdown(records, generatedAt) {
  const blocks = ["xuanbi-shang", "xuanbi-zhong", "xuanbi-xia"];
  const labels = { "xuanbi-shang": "选择性必修上", "xuanbi-zhong": "选择性必修中", "xuanbi-xia": "选择性必修下" };
  const sourcePackageVersion = `yw-nlm-source-v1-${generatedAt.slice(0, 10)}`;
  return `# 选择性必修上、中、下 NotebookLM 课文目录

- 生成日期：${generatedAt.slice(0, 10)}
- 来源包格式版本：${sourcePackageVersion}
- 课文总数：${records.length}
- 册次统计：上 ${records.filter((item) => item.item.blockId === "xuanbi-shang").length}；中 ${records.filter((item) => item.item.blockId === "xuanbi-zhong").length}；下 ${records.filter((item) => item.item.blockId === "xuanbi-xia").length}
- 边界：不计单元导语、单元研习任务、古诗词诵读栏目标题、后记和旧镜像条目。
- 全量来源包生成：\`node scripts/build_notebooklm_packages.mjs --all\`，生成后仍须逐课核查才可投入课堂。

${blocks.map((blockId) => `## ${labels[blockId]}

${records.filter((record) => record.item.blockId === blockId).map((record, index) => `${index + 1}. ${record.title}（\`${record.item.id}\`，${record.item.taxonomy.mode}，教材页 ${record.lesson.textbook?.pages?.join("、") || "待核"}）— 任务群：${record.group.label}`).join("\n")}`).join("\n\n")}
`;
}

function main() {
  const manifest = loadManifest();
  const taxonomy = loadTaxonomy();
  const units = buildUnits(manifest, taxonomy);
  const records = units.flatMap((unit) => unit.lessons.map((item) => lessonRecord(unit, item)));
  const generatedAt = new Date().toISOString();
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const sourcePackageVersion = `yw-nlm-source-v1-${generatedAt.slice(0, 10)}`;

  if (records.length !== 75) throw new Error(`expected 75 selected-compulsory texts, got ${records.length}`);
  if (CLEAN) rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(ROOT, { recursive: true });

  const catalog = records.map((record) => ({
    lessonId: record.item.id,
    title: record.title,
    blockId: record.item.blockId,
    blockTitle: record.item.blockTitle,
    unit: record.sectionLabel === "古诗词诵读" ? null : record.unit.number,
    sectionLabel: record.sectionLabel,
    mode: record.item.taxonomy.mode,
    authors: record.item.taxonomy.authors.map((author) => author.name),
    textbookPages: record.lesson.textbook?.pages || [],
    taskGroup: record.group.label,
    sourceVersion: {
      package: sourcePackageVersion,
      ...sourceVersion(record.lesson),
    },
    curriculumStandard: {
      taskGroupId: record.group.id,
      taskGroupLabel: record.group.label,
      sourceSection: record.group.sourceSection,
    },
    pilot: record.pilot,
    packageStatus: record.pilot || ALL ? "generated" : "cataloged",
  }));
  write(path.join(ROOT, "catalog.json"), `${JSON.stringify({
    schemaVersion: "yw-notebooklm-catalog-v2",
    generatedAt,
    sourcePackageVersion,
    total: records.length,
    lessons: catalog,
  }, null, 2)}\n`);
  write(path.join(ROOT, "CATALOG.md"), catalogMarkdown(records, generatedAt));

  const selected = ALL ? records : records.filter((record) => record.pilot);
  for (const record of selected) {
    const dir = path.join(ROOT, record.item.id);
    write(path.join(dir, "README.md"), sourceReadme(record, generatedAt, commit));
    write(path.join(dir, "sources", "01-text-and-annotations.md"), textSource(record));
    write(path.join(dir, "sources", "02-unit-guide-and-learning-task.md"), unitSource(record));
    write(path.join(dir, "sources", "03-curriculum-standard.md"), standardSource(record));
    write(path.join(dir, "sources", "04-verified-auxiliary.md"), auxiliarySource(record));
    write(path.join(dir, "prompts", "slide-deck.md"), slidePrompt(record));
    write(path.join(dir, "resource-record.json"), `${JSON.stringify(emptyResourceRecord(record, generatedAt, commit), null, 2)}\n`);
  }

  const result = {
    generatedAt,
    totalTexts: records.length,
    generatedPackages: selected.length,
    pilots: PILOT_LESSON_IDS,
    all: ALL,
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main();
