import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const DATA = path.join(ROOT, "site/data");
const LESSONS = path.join(DATA, "lessons");

const GROUPS = [
  ["lesson-1692", [
    ["立在地球边上放号", "郭沫若", 0, "立在地球边上放号", [10, 11], true],
    ["红烛", "闻一多", 0, "红 烛", [12, 13]],
    ["峨日朵雪峰之侧", "昌耀", 0, "峨日朵雪峰之侧", [14, 15]],
    ["致云雀", "雪莱", 0, "致云雀", [16, 17], false, "<hr>"],
  ]],
  ["lesson-1701", [
    ["芣苢", "", 0, "芣苢", [59]],
    ["插秧歌", "杨万里", 0, "插秧歌", [60], false, "<blockquote>"],
  ]],
  ["lesson-1704", [
    ["短歌行", "曹操", 0, "短歌行", [64]],
    ["归园田居（其一）", "陶渊明", 0, "归园田居", [65], false, "<blockquote>"],
  ]],
  ["lesson-1705", [
    ["梦游天姥吟留别", "李白", 0, "梦游天姥吟留别", [66, 67]],
    ["登高", "杜甫", 0, "登 高", [68]],
    ["琵琶行并序", "白居易", 0, "琵琶行并序", [69, 70], false, "<blockquote>"],
  ]],
  ["lesson-1706", [
    ["念奴娇·赤壁怀古", "苏轼", 0, "念奴娇·赤壁怀古", [71]],
    ["永遇乐·京口北固亭怀古", "辛弃疾", 0, "永遇乐·京口北固亭怀古", [72, 73]],
    ["声声慢（寻寻觅觅）", "李清照", 0, "声声慢", [74], false, "<blockquote>"],
  ]],
  ["lesson-1711", [
    ["劝学", "荀子", 0, null, [90, 91]],
    ["师说", "韩愈", 1, null, [92, 93]],
  ]],
  ["lesson-1717", [
    ["故都的秋", "郁达夫", 0, null, [112, 113, 114]],
    ["荷塘月色", "朱自清", 1, null, [115, 116, 117]],
  ]],
  ["lesson-1719", [
    ["赤壁赋", "苏轼", 0, null, [124, 125, 126]],
    ["登泰山记", "姚鼐", 1, null, [127, 128]],
  ]],
  ["lesson-1722", [
    ["静女", "", 0, null, [146, 147]],
    ["涉江采芙蓉", "", 1, null, [148, 149]],
    ["虞美人（春花秋月何时了）", "李煜", 2, null, [150, 151]],
    ["鹊桥仙（纤云弄巧）", "秦观", 3, null, [152, 153]],
  ]],
  ["lesson-1726", [
    ["子路、曾皙、冉有、公西华侍坐", "孔子", 0, null, [8, 9]],
    ["齐桓晋文之事", "孟子", 1, null, [10, 11, 12, 13]],
    ["庖丁解牛", "庄子", 2, null, [14, 15]],
  ]],
  ["lesson-1743", [
    ["谏逐客书", "李斯", 0, null, [91, 92, 93]],
    ["与妻书", "林觉民", 1, null, [94, 95, 96]],
  ]],
  ["lesson-1753", [
    ["阿房宫赋", "杜牧", 0, null, [154, 155]],
    ["六国论", "苏洵", 1, null, [156, 157]],
  ]],
  ["lesson-1755", [
    ["登岳阳楼", "杜甫", 0, null, [161, 162]],
    ["桂枝香·金陵怀古", "王安石", 1, null, [163, 164]],
    ["念奴娇·过洞庭", "张孝祥", 2, null, [165, 166]],
    ["游园（皂罗袍）", "汤显祖", 3, null, [167, 168, 169]],
  ]],
].map(([sourceId, pieces]) => ({
  sourceId,
  pieces: pieces.map(([title, author, postIndex, marker, pages, keepResources = false, stopHtml = ""]) => ({
    title, author, postIndex, marker, pages, keepResources, stopHtml,
  })),
}));

function findContainingTagStart(html, marker, from = 0) {
  const markerIndex = html.indexOf(marker, from);
  if (markerIndex < 0) throw new Error(`Missing split marker: ${marker}`);
  const paragraph = html.lastIndexOf("<p", markerIndex);
  return paragraph >= 0 ? paragraph : markerIndex;
}

function footnotesOf(html) {
  const start = html.indexOf('<hr class="footnotes-sep"');
  return start >= 0 ? html.slice(start) : "";
}

function coreOf(html) {
  const start = html.indexOf('<hr class="footnotes-sep"');
  return start >= 0 ? html.slice(0, start) : html;
}

function htmlToText(html) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>|<\/blockquote>|<\/h[1-6]>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function segmentPost(source, piece, nextPiece) {
  const post = source.posts[piece.postIndex];
  if (!post) throw new Error(`${source.id}: missing post ${piece.postIndex}`);
  const sourceCore = coreOf(post.cooked || "");
  let start = 0;
  let end = sourceCore.length;
  if (piece.marker) start = findContainingTagStart(sourceCore, piece.marker);
  if (nextPiece?.postIndex === piece.postIndex && nextPiece.marker) {
    end = findContainingTagStart(sourceCore, nextPiece.marker, start + 1);
  } else if (piece.stopHtml) {
    const stop = sourceCore.indexOf(piece.stopHtml, start + 1);
    if (stop >= 0) end = stop;
  }
  const cookedCore = sourceCore.slice(start, end).trim();
  const cooked = `${cookedCore}\n${footnotesOf(post.cooked || "")}`.trim();
  return {
    ...post,
    post_number: 1,
    cooked,
    plain_text: htmlToText(cookedCore),
  };
}

function textbookFor(source, pages) {
  const textbook = structuredClone(source.textbook || {});
  const pageSet = new Set(pages);
  textbook.startPage = pages[0] || textbook.startPage;
  textbook.pages = pages;
  textbook.pageImages = (textbook.pageImages || []).filter((image) => pageSet.has(image.page));
  return textbook;
}

function lessonMeta(sourceMeta, source, piece, pieceIndex, post) {
  const id = `${source.id}-p${pieceIndex + 1}`;
  const textbook = textbookFor(source, piece.pages);
  const tocLabel = piece.author ? `${piece.title}/${piece.author}` : piece.title;
  const resources = piece.keepResources
    ? source.resources || []
    : (source.resources || []).filter((resource) => Number(resource.postNumber) === Number(source.posts[piece.postIndex]?.post_number));
  const forumImages = (source.forumImages || []).filter((image) => Number(image.postNumber) === Number(source.posts[piece.postIndex]?.post_number));
  const lesson = {
    ...source,
    id,
    title: piece.title,
    sourceTitle: piece.title,
    derivedFrom: source.id,
    derivedAuthor: piece.author || "",
    tocLabel,
    excerpt: post.plain_text.slice(0, 900),
    postCount: 1,
    posts: [{ ...post, id: `${post.id}-${pieceIndex + 1}` }],
    resources,
    forumImages,
    resourceCounts: {},
    textbook: { ...textbook, tocLabel },
  };
  const meta = {
    ...sourceMeta,
    id,
    title: piece.title,
    sourceTitle: piece.title,
    derivedFrom: source.id,
    derivedAuthor: piece.author || "",
    postCount: 1,
    imageCount: forumImages.length,
    resourceCount: resources.length,
    textbookPageCount: piece.pages.length,
    textbookPageImageCount: textbook.pageImages.length,
    textbookStartPage: piece.pages[0] || null,
    tocLabel,
    excerpt: lesson.excerpt,
    dataUrl: `data/lessons/${id}.json`,
  };
  return { lesson, meta };
}

const manifestPath = path.join(DATA, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
let created = 0;

for (const group of GROUPS) {
  const source = JSON.parse(await readFile(path.join(LESSONS, `${group.sourceId}.json`), "utf8"));
  const block = manifest.blocks.find((item) => item.lessons.some((lesson) => lesson.id === group.sourceId || lesson.derivedFrom === group.sourceId));
  if (!block) throw new Error(`Manifest has no placement for ${group.sourceId}`);
  const matches = block.lessons
    .map((lesson, index) => ({ lesson, index }))
    .filter(({ lesson }) => lesson.id === group.sourceId || lesson.derivedFrom === group.sourceId);
  const insertAt = matches[0].index;
  const sourceMeta = matches.find(({ lesson }) => lesson.id === group.sourceId)?.lesson || matches[0].lesson;
  const replacement = [];
  for (let index = 0; index < group.pieces.length; index += 1) {
    const piece = group.pieces[index];
    const post = segmentPost(source, piece, group.pieces[index + 1]);
    const { lesson, meta } = lessonMeta(sourceMeta, source, piece, index, post);
    await writeFile(path.join(LESSONS, `${lesson.id}.json`), `${JSON.stringify(lesson, null, 2)}\n`);
    replacement.push(meta);
    created += 1;
  }
  const removeIds = new Set(matches.map(({ lesson }) => lesson.id));
  block.lessons = block.lessons.filter((lesson) => !removeIds.has(lesson.id));
  block.lessons.splice(insertAt, 0, ...replacement);
}

manifest.lessons = manifest.blocks.flatMap((block) => block.lessons);
manifest.totals = {
  ...manifest.totals,
  lessons: manifest.lessons.length,
  posts: manifest.lessons.reduce((sum, lesson) => sum + Number(lesson.postCount || 0), 0),
  forumImages: manifest.lessons.reduce((sum, lesson) => sum + Number(lesson.imageCount || 0), 0),
  resources: manifest.lessons.reduce((sum, lesson) => sum + Number(lesson.resourceCount || 0), 0),
  textbookPageRefs: manifest.lessons.reduce((sum, lesson) => sum + Number(lesson.textbookPageCount || 0), 0),
  mappedLessons: manifest.lessons.filter((lesson) => Number(lesson.textbookPageCount || 0) > 0).length,
};
manifest.generatedAt = new Date().toISOString();
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Split 13 composite entries into ${created} independent lessons; manifest now has ${manifest.lessons.length} entries.`);
