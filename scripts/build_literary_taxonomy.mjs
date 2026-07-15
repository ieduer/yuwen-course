import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";

const ROOT = path.resolve(import.meta.dirname, "..");
const SITE = path.join(ROOT, "site");
const OUTPUT_PATH = path.join(SITE, "data/literary-taxonomy.json");
const CHECK_ONLY = process.argv.includes("--check");
const existingOutput = CHECK_ONLY ? JSON.parse(await readFile(OUTPUT_PATH, "utf8")) : null;
const manifest = JSON.parse(await readFile(path.join(SITE, "data/manifest.json"), "utf8"));
const portraitManifest = JSON.parse(await readFile("/Users/ylsuen/CF/qunxian/scripts/portrait_manifest.json", "utf8"));

const GENRES = [
  ["root", "語文作品", null, "五冊教材中的文學作品、實用文本與學習活動。"],
  ["poetry", "詩歌", "root", "以節奏、意象和凝練語言構成的韻文傳統。"],
  ["classical-poetry", "中國古典詩歌", "poetry", "從《詩經》、楚辭、樂府到古體、近體與詞。"],
  ["shijing", "《詩經》四言詩", "classical-poetry", "以四言為主、重章疊唱，風雅頌構成其基本體系。"],
  ["chuci", "楚辭／騷體", "classical-poetry", "句式參差、多用兮字，形成浪漫瑰麗的楚辭傳統。"],
  ["yuefu", "樂府詩", "classical-poetry", "本由樂府機關采集或配樂，後亦包括沿用樂府舊題的作品。"],
  ["gushi", "古體詩", "classical-poetry", "不受近體格律嚴格限制，篇幅、句式和押韻較自由。"],
  ["gexing", "歌行體", "gushi", "由樂府歌辭發展而來，篇幅伸縮、換韻靈活，適合鋪敘與抒情。"],
  ["jintishi", "近體詩", "classical-poetry", "唐代成熟的格律詩，講究字數、押韻、平仄與對仗。"],
  ["lvshi", "律詩", "jintishi", "通常八句，中間兩聯講究對仗，章法嚴整。"],
  ["ci", "詞", "classical-poetry", "依詞牌填寫、長短句相間，聲律與篇章轉折緊密相連。"],
  ["modern-poetry", "中國現代詩", "poetry", "以現代漢語自由探索節奏、意象與個體經驗。"],
  ["foreign-poetry", "外國詩歌", "poetry", "經翻譯進入中文課堂的抒情詩、頌歌與自由詩傳統。"],
  ["prose", "散文／文章", "root", "以非韻文為主，涵蓋古代文體、現代散文、論述與實用文本。"],
  ["classical-prose", "中國古代文章", "prose", "依用途、寫作對象和篇章形制形成多層次文體譜系。"],
  ["philosophical-prose", "諸子散文", "classical-prose", "以語錄、對話、寓言或論辯闡述思想。"],
  ["historical-prose", "史傳散文", "classical-prose", "以歷史敘事、人物行動和褒貶寄寓史識。"],
  ["biao", "表", "classical-prose", "臣下向君主陳情、謝恩或進言的奏議文體。"],
  ["shu", "書／書信", "classical-prose", "可為上書進諫，也可為私人書信，對象與語氣決定章法。"],
  ["shu-memorial", "疏", "classical-prose", "臣下分條陳述政見、規勸君主的奏議文體。"],
  ["xu", "序", "classical-prose", "或說明著作緣起，或因宴集贈別抒懷議論。"],
  ["zhuan", "傳", "classical-prose", "敘寫人物生平行事；亦可借傳記寓言寄託政論。"],
  ["ji", "記", "classical-prose", "記人、記事、記遊、記物，常由所記之事生發議論或情感。"],
  ["lun", "論", "classical-prose", "就歷史或現實提出判斷，以材料和推理展開說理。"],
  ["shuo", "說", "classical-prose", "形式靈活的議論文體，常就一事一物闡明道理。"],
  ["ci-fu", "辭賦", "classical-prose", "介於詩與文之間，重鋪陳、聲律與抒情；包括辭、賦等分支。"],
  ["fu", "賦", "ci-fu", "鋪采摛文、體物寫志，可由漢大賦演變至抒情小賦、文賦。"],
  ["classical-ci", "辭", "ci-fu", "楚辭傳統之後的抒情韻文形制，常以兮字調節節奏。"],
  ["modern-prose", "現當代散文", "prose", "以現代漢語寫景、敘事、抒情與思考。"],
  ["lyric-prose", "抒情散文", "modern-prose", "以景物、記憶和語言節奏組織情感。"],
  ["narrative-prose", "敘事散文", "modern-prose", "由人物、事件和敘述視角推進思想與情感。"],
  ["argument", "論述文", "prose", "以概念、判斷、論據與推理建立可檢驗的主張。"],
  ["literary-criticism", "文藝隨筆／評論", "argument", "以作品、語言或文化現象為材料展開審美判斷。"],
  ["speech-letter", "演說／書信", "prose", "有明確受眾和現場目的，語氣、稱謂與行動訴求尤其重要。"],
  ["science", "科普／學術說明", "prose", "以概念、證據、模型和說明順序傳遞專業知識。"],
  ["fiction", "小說", "root", "以虛構人物、情節、視角和細節構造經驗世界。"],
  ["ancient-fiction", "中國古代小說", "fiction", "由志怪、傳奇、話本到章回小說形成的敘事傳統。"],
  ["modern-fiction", "中國現當代小說", "fiction", "以現代敘事手法呈現個體、社會與歷史。"],
  ["foreign-fiction", "外國小說", "fiction", "不同語言傳統中的長篇與短篇小說節選。"],
  ["drama", "戲劇", "root", "以角色行動、台詞、衝突和舞台調度構成。"],
  ["yuan-zaju", "元雜劇", "drama", "以折、楔子、曲牌和角色行當組織舞台敘事。"],
  ["modern-drama", "中國現代話劇", "drama", "以對話、潛台詞和舞台場面表現現代衝突。"],
  ["western-drama", "外國戲劇", "drama", "包括悲劇與現代戲劇等不同舞台傳統。"],
  ["journalism", "新聞與紀實", "root", "以事實、來源、報道角度和公共立場組織材料。"],
  ["communication", "通訊／人物報道", "journalism", "以典型事件與細節呈現人物或重大事件。"],
  ["news-report", "消息／現場報道", "journalism", "強調時效、事實層級與現場信息。"],
  ["news-comment", "新聞評論", "journalism", "由新聞事實出發形成公共判斷與價值立場。"],
  ["learning", "教材學習活動", "root", "不以單篇作品為中心，而以單元統整、任務與整本書閱讀組織學習。"],
  ["unit-intro", "單元說明", "learning", "確定人文主題、篇目關係與核心語文能力。"],
  ["unit-task", "單元研習任務", "learning", "要求跨篇整合證據、協作探究並形成可展示成果。"],
  ["whole-book", "整本書閱讀", "learning", "以長時段閱讀、問題鏈和讀書成果組織學習。"],
  ["language-activity", "語文實踐活動", "learning", "詞語、媒介、家鄉文化或邏輯等綜合實踐。"],
  ["review", "誦讀／測評／後記", "learning", "教材附錄、誦讀篇目、試題與編後內容。"],
].map(([id, label, parent, description]) => ({ id, label, parent, description }));

const GENRE_YEARS = {
  root: -1000, poetry: -1000, "classical-poetry": -1000, shijing: -900, chuci: -300, yuefu: -120, gushi: 100, gexing: 600, jintishi: 650, lvshi: 650, ci: 850,
  "modern-poetry": 1917, "foreign-poetry": 1800, prose: -500, "classical-prose": -500, "philosophical-prose": -500, "historical-prose": -500, biao: -200, shu: -200,
  "shu-memorial": 200, xu: 300, zhuan: -100, ji: 300, lun: 200, shuo: 600, "ci-fu": -300, fu: -100, "classical-ci": -300, "modern-prose": 1917,
  "lyric-prose": 1917, "narrative-prose": 1917, argument: -400, "literary-criticism": 500, "speech-letter": -300, science: 1600, fiction: 200, "ancient-fiction": 200,
  "modern-fiction": 1917, "foreign-fiction": 1600, drama: -400, "yuan-zaju": 1270, "modern-drama": 1919, "western-drama": -400, journalism: 1800, communication: 1900,
  "news-report": 1800, "news-comment": 1800, learning: 2020, "unit-intro": 2020, "unit-task": 2020, "whole-book": 2020, "language-activity": 2020, review: 2020,
};

function eraForYear(year) {
  if (year <= -221) return "先秦";
  if (year <= 220) return "秦漢";
  if (year <= 589) return "魏晉南北朝";
  if (year <= 907) return "隋唐";
  if (year <= 1279) return "兩宋";
  if (year <= 1840) return "元明清";
  if (year <= 1949) return "近現代";
  return "當代";
}

const BOOK_DETAILS = [
  [/論語|论语/, "記錄孔子及其弟子言行的語錄體典籍，是理解先秦儒家思想、人物語氣與對話章法的核心文本。", "https://ctext.org/analects/zh"],
  [/孟子/, "以問答與論辯展開仁政、性善與人格理想，文章善用譬喻、排比和層層逼問形成浩然氣勢。", "https://ctext.org/mengzi/zh"],
  [/莊子|庄子/, "先秦道家重要典籍，以寓言、重言、卮言打開觀念邊界，想象與論辯常在同一敘述中彼此推動。", "https://ctext.org/zhuangzi/zh"],
  [/墨子/, "墨家學派論著總集，兼愛、非攻、尚賢等主張常以嚴密分類、推演和現實功用建立論證。", "https://ctext.org/mozi/zh"],
  [/荀子/, "戰國末儒家論著，以概念辨析、層遞論證和密集譬喻討論學習、人性、禮法與政治秩序。", "https://ctext.org/xunzi/zh"],
  [/禮記|礼记/, "先秦至秦漢儒家禮學文獻彙編，保存制度、教育、倫理與哲學論說，篇章形態多樣。", "https://ctext.org/liji/zh"],
  [/詩經|诗经/, "中國最早的詩歌總集，風、雅、頌與賦、比、興共同構成後世詩歌的源頭性結構。", "https://ctext.org/book-of-poetry/zh"],
  [/史記|史记/, "司馬遷撰寫的紀傳體通史，以本紀、表、書、世家、列傳組成互見而立體的歷史敘事。", "https://ctext.org/shiji/zh"],
  [/左傳|左传/, "以《春秋》年代為綱的編年體史書，擅長在戰爭、辭令與人物行動中呈現歷史因果。", "https://ctext.org/chun-qiu-zuo-zhuan/zh"],
  [/楚辭|楚辞/, "以屈原作品為中心的楚地辭章總集，句式、兮字、香草美人與神遊想象形成鮮明傳統。", "https://ctext.org/chu-ci/zh"],
  [/老子|道德經|道德经/, "道家重要典籍，以高度凝練、正反相生的章句討論道、德、無為與事物轉化。", "https://ctext.org/dao-de-jing/zh"],
].map(([pattern, description, href]) => ({ pattern, description, href }));

const nodeById = Object.fromEntries(GENRES.map((item) => [item.id, item]));
const retired = /Google\s*site|課堂進度記錄|课堂进度记录|語雀|语雀/i;
const normal = (value) => String(value || "").replace(/\s+/g, "").replace(/[，、·]/g, "");

function has(title, pattern) {
  return pattern.test(normal(title));
}

function add(set, ...ids) {
  ids.forEach((id) => set.add(id));
}

function classify(lesson) {
  const title = `${lesson.title || ""} ${lesson.tocLabel || ""}`;
  const compact = normal(title);
  const genres = new Set();
  let mode = "modern-prose";

  if (/第[一二三四五六七八九十0-9]+[单單]元/.test(title) && !/(学习|學習|研习|研習)任务/.test(title)) {
    add(genres, "unit-intro"); mode = "unit-intro";
  }
  if (/(学习|學習|研习|研習)任务/.test(title)) { add(genres, "unit-task"); mode = "unit-task"; }
  if (/整本书阅读|整本書閱讀/.test(title)) { add(genres, "whole-book"); mode = "whole-book"; }
  if (/家乡文化生活|信息时代的语文生活|词语积累|逻辑的力量/.test(title)) { add(genres, "language-activity"); mode = "language-activity"; }
  if (/古诗词诵读|后记|後記|統練|押题|试题|答案/.test(compact)) { add(genres, "review"); mode = "review"; }
  if (genres.size) return { genres: [...genres], mode };

  if (has(title, /窦娥冤/)) add(genres, "yuan-zaju");
  if (has(title, /游园|皂罗袍/)) { add(genres, "drama"); mode = "drama"; }
  if (has(title, /雷雨|茶馆/)) add(genres, "modern-drama");
  if (has(title, /哈姆莱特|玩偶之家/)) add(genres, "western-drama");
  if ([...genres].some((id) => nodeById[id]?.parent === "drama")) mode = "drama";

  if (has(title, /促织|林教头风雪山神庙/)) add(genres, "ancient-fiction");
  if (has(title, /百合花|香雪|祝福|荷花淀|小二黑结婚|党费|阿Q正传|边城/)) add(genres, "modern-fiction");
  if (has(title, /大卫·?科波菲尔|复活|老人与海|百年孤独/)) add(genres, "foreign-fiction");
  if ([...genres].some((id) => nodeById[id]?.parent === "fiction")) mode = "fiction";

  if (has(title, /沁园春|念奴娇|永遇乐|声声慢|虞美人|鹊桥仙|桂枝香|江城子|望海潮|扬州慢/)) add(genres, "ci");
  if (has(title, /芣苢|静女|无衣|氓/)) add(genres, "shijing");
  if (has(title, /离骚/)) add(genres, "chuci");
  if (has(title, /短歌行|孔雀东南飞|拟行路难|燕歌行/)) add(genres, "yuefu");
  if (has(title, /梦游天姥吟留别|琵琶行|春江花月夜|将进酒|蜀道难|燕歌行|拟行路难|李凭箜篌引/)) add(genres, "gexing");
  if (has(title, /归园田居|插秧歌|涉江采芙蓉/)) add(genres, "gushi");
  if (has(title, /登高|锦瑟|书愤|客至|登快阁|临安春雨初霁|蜀相/)) add(genres, "lvshi");
  if (has(title, /立在地球边上放号|红烛|峨日朵雪峰之侧|大堰河|再别康桥/)) add(genres, "modern-poetry");
  if (has(title, /致云雀|迷娘|致大海|自己之歌|树和天空/)) add(genres, "foreign-poetry");
  if ([...genres].some((id) => ["classical-poetry", "poetry"].includes(nodeById[id]?.parent) || nodeById[nodeById[id]?.parent]?.parent === "classical-poetry")) {
    mode = "poetry";
  }
  if (genres.has("modern-poetry") || genres.has("foreign-poetry")) mode = "poetry";

  if (has(title, /陈情表/)) add(genres, "biao");
  if (has(title, /谏逐客书|与妻书/)) add(genres, "shu");
  if (has(title, /谏太宗十思疏/)) add(genres, "shu-memorial");
  if (has(title, /兰亭集序|五代史伶官传序/)) add(genres, "xu");
  if (has(title, /屈原列传|苏武传|种树郭橐驼传/)) add(genres, "zhuan");
  if (has(title, /登泰山记|石钟山记|项脊轩志/)) add(genres, "ji");
  if (has(title, /过秦论|六国论/)) add(genres, "lun");
  if (has(title, /师说/)) add(genres, "shuo");
  if (has(title, /赤壁赋|阿房宫赋/)) add(genres, "fu");
  if (has(title, /归去来兮辞/)) add(genres, "classical-ci");
  if (has(title, /子路曾皙冉有公西华侍坐|齐桓晋文之事|庖丁解牛|劝学|论语|大学之道|礼记|人皆有不忍人之心|老子|五石之瓠|兼爱/)) add(genres, "philosophical-prose");
  if (has(title, /烛之武退秦师|鸿门宴/)) add(genres, "historical-prose");
  if ([...genres].some((id) => nodeById[id]?.parent === "classical-prose" || nodeById[nodeById[id]?.parent]?.parent === "classical-prose")) mode = "classical";

  if (has(title, /喜看稻菽千重浪|心有一团火|探界者钟扬|长征胜利万岁|大战中的插曲|县委书记的榜样|包身工|中国抗疫记/)) add(genres, "communication");
  if (has(title, /别了不列颠尼亚/)) add(genres, "news-report");
  if (has(title, /以工匠精神雕琢时代品质/)) add(genres, "news-comment");
  if ([...genres].some((id) => nodeById[id]?.parent === "journalism")) mode = "journalism";

  if (has(title, /中国建筑的特征|青蒿素|自然选择的证明|宇宙的边疆|天文学上的旷世之争/)) { add(genres, "science"); mode = "science"; }
  if (has(title, /反对党八股|拿来主义|读书目的和前提|社会历史的决定性基础|改造我们的学习|人的正确思想|实践是检验真理|修辞立其诚|怜悯是人的天性|人应当坚持正义/)) { add(genres, "argument"); mode = "argument"; }
  if (has(title, /说木叶/)) { add(genres, "literary-criticism"); mode = "argument"; }
  if (has(title, /中国人民站起来了|人民报.*演说/)) { add(genres, "speech-letter"); mode = "speech-letter"; }
  if (has(title, /故都的秋|荷塘月色|我与地坛|一个消逝了的山村|风景谈|秦腔|听听那冷雨/)) { add(genres, "lyric-prose"); mode = "modern-prose"; }
  if (has(title, /记念刘和珍君|为了忘却的记念/)) { add(genres, "narrative-prose"); mode = "modern-prose"; }

  if (!genres.size) add(genres, "modern-prose");
  return { genres: [...genres], mode };
}

async function loadQxAuthors() {
  const parts = "/Users/ylsuen/CF/qunxian/public/data/parts";
  const context = { window: { QX_FIGURES: [], QX_EXTRA_FIGURES: [] } };
  try {
    vm.createContext(context);
    for (const filename of (await readdir(parts)).sort()) {
      if (!filename.endsWith(".js")) continue;
      const source = await readFile(path.join(parts, filename), "utf8");
      vm.runInContext(source, context, { filename });
    }
    const matrixFilename = "/Users/ylsuen/CF/qunxian/public/data/matrix.js";
    vm.runInContext(await readFile(matrixFilename, "utf8"), context, { filename: matrixFilename });
  } catch {
    return [];
  }
  const authors = [...(context.window.QX_FIGURES || []), ...(context.window.QX_EXTRA_FIGURES || [])].map((figure) => {
    const firstYear = String(figure.dates || "").match(/前\s*(\d{2,4})|(?:約|约)?\s*(\d{3,4})/);
    const year = firstYear ? (firstYear[1] ? -Number(firstYear[1]) : Number(firstYear[2])) : null;
    return { id: figure.id, name: figure.name, era: figure.era || "", dates: figure.dates || "", year };
  });
  return authors.filter((item, index, all) => all.findIndex((other) => other.id === item.id) === index);
}

const qxAuthors = await loadQxAuthors();
const qxAuthorByName = new Map(qxAuthors.map((author) => [normal(author.name), author]));
const qxAuthorById = new Map(qxAuthors.map((author) => [author.id, author]));
const AUTHOR_NAME_ALIASES = new Map([["魏征", "魏徵"]]);

function withPortraitMetadata(person) {
  const portrait = portraitManifest[person.id];
  if (!portrait?.file) throw new Error(`QX portrait manifest missing for ${person.id}`);
  return {
    ...person,
    portraitKind: portrait.kind || (portrait.src ? "legacy-source" : "documented-no-reliable-portrait"),
  };
}

function compactHeading(value) {
  return String(value || "")
    .replace(/\[\d+(?::\d+)*\]/g, "")
    .replace(/并序/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function localAuthorId(name) {
  return `local-${[...name].map((character) => character.codePointAt(0).toString(16)).join("-")}`;
}

function authorRecord(name, evidence) {
  const known = qxAuthorByName.get(normal(AUTHOR_NAME_ALIASES.get(name) || name));
  return known
    ? { ...withPortraitMetadata(known), name, url: `https://qx.bdfz.net/#${known.id}`, evidence }
    : { id: localAuthorId(name), name, url: "", evidence };
}

const SUPPLEMENTAL_AUTHOR_NAMES = [
  "昌耀", "雪莱", "朱自清", "姚鼐", "林觉民", "苏洵",
  "周婷", "杨兴", "穆青", "冯健", "周原",
];
const authorCandidates = [
  ...qxAuthors,
  ...SUPPLEMENTAL_AUTHOR_NAMES.map((name) => ({ id: localAuthorId(name), name })),
];
const segmentNames = authorCandidates.map((author) => author.name).sort((a, b) => b.length - a.length);

const REPRESENTATIVE_GROUPS = [
  { lessonIds: ["lesson-1690", "lesson-1695"], figureId: "maozedong", role: "單元代表人物", evidenceLessonIds: ["lesson-1691"], reason: "以本單元首篇演說的核心人物代表青春、勞動與公共表達。" },
  { lessonIds: ["lesson-1696", "lesson-1702"], figureId: "yuanlongping", role: "單元代表人物", evidenceLessonIds: ["lesson-1697"], reason: "以本單元人物通訊中的科學實踐者代表勞動精神。" },
  { lessonIds: ["lesson-1701-p1"], figureId: "kongzi", role: "《詩經》傳承代表", evidenceLessonIds: ["lesson-1701-p1"], reason: "篇目無可證直接作者；以先秦詩教傳統的代表人物標示文學脈絡。" },
  { lessonIds: ["lesson-1703", "lesson-1707"], figureId: "taoyuanming", role: "單元代表人物", evidenceLessonIds: ["lesson-1704-p2"], reason: "以本單元古典詩歌作者代表生命選擇與詩意傳統。" },
  { lessonIds: ["lesson-1708"], figureId: "luxun", role: "鄉土書寫代表", evidenceLessonIds: ["lesson-1713"], reason: "以教材中的鄉土敘事與文化反思代表人物提示活動方向。" },
  { lessonIds: ["lesson-1709"], figureId: "feixiaotong", role: "整本書作者", evidenceLessonIds: ["lesson-1709"], reason: "《鄉土中國》的作者與該整本書閱讀任務直接對應。" },
  { lessonIds: ["lesson-1710", "lesson-1715"], figureId: "xunzi", role: "單元代表人物", evidenceLessonIds: ["lesson-1711-p1"], reason: "以《勸學》作者代表本單元的學習、師道與思辨主題。" },
  { lessonIds: ["lesson-1716", "lesson-1720"], figureId: "zhuziqing", role: "單元代表人物", evidenceLessonIds: ["lesson-1717-p2"], reason: "以《荷塘月色》作者代表本單元的自然書寫與審美體驗。" },
  { lessonIds: ["lesson-1721"], figureId: "kongzi", role: "漢語學習傳統代表", evidenceLessonIds: ["lesson-1721"], reason: "活動無直接作者；以經典語言教育傳統的代表人物提示詞語積累。" },
  { lessonIds: ["lesson-1722-p1"], figureId: "kongzi", role: "《詩經》傳承代表", evidenceLessonIds: ["lesson-1722-p1"], reason: "篇目無可證直接作者；以先秦詩教傳統的代表人物標示文學脈絡。" },
  { lessonIds: ["lesson-1722-p2"], figureId: "bangu", role: "東漢文學史代表", evidenceLessonIds: ["lesson-1722-p2"], reason: "《古詩十九首》作者不詳；以東漢文化史人物標示時代而非冒稱作者。" },
  { lessonIds: ["lesson-1723"], figureId: "zhuziqing", role: "冊別回望代表人物", evidenceLessonIds: ["lesson-1717-p2"], reason: "以本冊重要作者代表閱讀回望，不作後記作者歸屬。" },
  { lessonIds: ["lesson-1725", "lesson-1729"], figureId: "kongzi", role: "單元代表人物", evidenceLessonIds: ["lesson-1726-p1"], reason: "以單元首篇中的孔子代表士人擔當與政治論辯。" },
  { lessonIds: ["lesson-1727"], figureId: "zuoqiuming", role: "《左傳》傳世歸名人物", evidenceLessonIds: ["lesson-1727"], reason: "教材題署典籍而非現代作者；沿用《左傳》的傳世歸名並明示其角色。" },
  { lessonIds: ["lesson-1730", "lesson-1734"], figureId: "guanhanqing", role: "單元代表人物", evidenceLessonIds: ["lesson-1731"], reason: "以《竇娥冤》作者代表本單元的戲劇衝突與舞台傳統。" },
  { lessonIds: ["lesson-1735", "lesson-1739"], figureId: "tuyouyou", role: "單元代表人物", evidenceLessonIds: ["lesson-1736"], reason: "以本單元科學發現的核心人物代表求真與實證。" },
  { lessonIds: ["lesson-1740"], figureId: "kaersagen", role: "科學傳播代表", evidenceLessonIds: ["lesson-1740"], reason: "活動無直接作者；以現代科學傳播人物提示信息辨析與公共表達。" },
  { lessonIds: ["lesson-1741", "lesson-1744"], figureId: "marx", role: "單元代表人物", evidenceLessonIds: ["lesson-1742"], reason: "以本單元演說中的思想家代表使命、責任與公共論述。" },
  { lessonIds: ["lesson-1745", "lesson-1749"], figureId: "luxun", role: "單元代表人物", evidenceLessonIds: ["lesson-1746"], reason: "以本單元小說作者代表人物塑造與社會觀察。" },
  { lessonIds: ["lesson-1750", "lesson-1756"], figureId: "caoxueqin", role: "整本書與冊別代表人物", evidenceLessonIds: ["lesson-1750"], reason: "《紅樓夢》的作者直接對應整本書閱讀，並代表本冊回望。" },
  { lessonIds: ["lesson-1751", "lesson-1754"], figureId: "weizheng", role: "單元代表人物", evidenceLessonIds: ["lesson-1752"], reason: "以《諫太宗十思疏》作者代表諫諍、責任與理性論述。" },
  { lessonIds: ["lesson-1460", "lesson-1472"], figureId: "maozedong", role: "單元代表人物", evidenceLessonIds: ["lesson-1458"], reason: "以本單元首篇演說者代表歷史現場與家國擔當。" },
  { lessonIds: ["lesson-1473", "lesson-1486"], figureId: "mengzi", role: "單元代表人物", evidenceLessonIds: ["lesson-1477"], reason: "以本單元儒家論辯人物代表仁義、同情與思想對話。" },
  { lessonIds: ["lesson-1474"], figureId: "kongzi", role: "篇中思想人物", evidenceLessonIds: ["lesson-1474"], reason: "《論語》為弟子後學編錄；以篇中思想人物標示，不冒稱篇目作者。" },
  { lessonIds: ["lesson-1476"], figureId: "kongzi", role: "儒家經典傳承代表", evidenceLessonIds: ["lesson-1476"], reason: "《大學》篇作者說法複雜；以儒家傳統代表人物標示脈絡。" },
  { lessonIds: ["lesson-1483"], figureId: "laozi", role: "傳世歸名人物", evidenceLessonIds: ["lesson-1483"], reason: "沿用《老子》的傳世歸名並明示其角色，不作現代著作權式作者判定。" },
  { lessonIds: ["lesson-1487", "lesson-1495"], figureId: "digengsi", role: "單元代表人物", evidenceLessonIds: ["lesson-1488"], reason: "以本單元長篇小說作者代表成長敘事與世界文學閱讀。" },
  { lessonIds: ["lesson-1496"], figureId: "bailatu", role: "邏輯傳統代表", evidenceLessonIds: ["lesson-1496"], reason: "活動無直接作者；以西方論辯與邏輯傳統代表人物提示推理訓練。" },
  { lessonIds: ["lesson-1497"], figureId: "kongzi", role: "《詩經》傳承代表", evidenceLessonIds: ["lesson-1497"], reason: "篇目無可證直接作者；以先秦詩教傳統的代表人物標示文學脈絡。" },
  { lessonIds: ["lesson-1501"], figureId: "mengzi", role: "冊別回望代表人物", evidenceLessonIds: ["lesson-1477"], reason: "以本冊思想閱讀代表人物作回望，不作後記作者歸屬。" },
  { lessonIds: ["lesson-1502", "lesson-1524"], figureId: "endeqisi", role: "單元代表人物", evidenceLessonIds: ["lesson-1517"], reason: "以本單元首篇論述作者代表社會歷史、理論與實踐的關係。" },
  { lessonIds: ["lesson-1525", "lesson-1532"], figureId: "luxun", role: "單元代表人物", evidenceLessonIds: ["lesson-1526"], reason: "以本單元重要作家代表現代文學中的記憶、批判與抉擇。" },
  { lessonIds: ["lesson-1533", "lesson-1538"], figureId: "simaqian", role: "單元代表人物", evidenceLessonIds: ["lesson-1534"], reason: "以《屈原列傳》作者代表史傳書寫、人格與歷史判斷。" },
  { lessonIds: ["lesson-1539", "lesson-1545"], figureId: "yibusheng", role: "單元代表人物", evidenceLessonIds: ["lesson-1541"], reason: "以本單元戲劇作者代表現代舞台衝突與個體覺醒。" },
  { lessonIds: ["lesson-1546"], figureId: "gaoshi", role: "唐詩代表人物", evidenceLessonIds: ["lesson-1547"], reason: "誦讀組合無單一作者；以其中歌行名篇作者代表本組詩歌。" },
  { lessonIds: ["lesson-1551"], figureId: "simaqian", role: "冊別回望代表人物", evidenceLessonIds: ["lesson-1534"], reason: "以本冊史傳閱讀代表人物作回望，不作後記作者歸屬。" },
  { lessonIds: ["lesson-1554", "lesson-1563"], figureId: "quyuan", role: "單元代表人物", evidenceLessonIds: ["lesson-1557"], reason: "以《離騷》作者代表古典詩歌中的人格、抒情與家國。" },
  { lessonIds: ["lesson-1556"], figureId: "kongzi", role: "《詩經》傳承代表", evidenceLessonIds: ["lesson-1556"], reason: "篇目無可證直接作者；以先秦詩教傳統的代表人物標示文學脈絡。" },
  { lessonIds: ["lesson-1558"], figureId: "caocao", role: "漢末樂府時代代表", evidenceLessonIds: ["lesson-1558"], reason: "《孔雀東南飛》作者不詳；以漢末樂府時代人物標示歷史脈絡而非冒稱作者。" },
  { lessonIds: ["lesson-1564", "lesson-1574"], figureId: "luxun", role: "單元代表人物", evidenceLessonIds: ["lesson-1565"], reason: "以本單元現代小說作者代表人性觀察與敘事批判。" },
  { lessonIds: ["lesson-1575", "lesson-1582"], figureId: "wangxizhi", role: "單元代表人物", evidenceLessonIds: ["lesson-1578"], reason: "以《蘭亭集序》作者代表本單元對生命、記憶與文字的思考。" },
  { lessonIds: ["lesson-1583", "lesson-1587"], figureId: "dawerwen", role: "單元代表人物", evidenceLessonIds: ["lesson-1586"], reason: "以自然選擇理論人物代表本單元的科學論證與證據意識。" },
];

const REPRESENTATIVE_BY_LESSON = new Map(REPRESENTATIVE_GROUPS.flatMap((group) => group.lessonIds.map((lessonId) => [lessonId, group])));

function representativeFigureFor(lessonId) {
  const spec = REPRESENTATIVE_BY_LESSON.get(lessonId);
  if (!spec) return null;
  const figure = qxAuthorById.get(spec.figureId);
  if (!figure) throw new Error(`QX representative ${spec.figureId} missing for ${lessonId}`);
  return {
    ...withPortraitMetadata(figure),
    url: `https://qx.bdfz.net/#${figure.id}`,
    role: spec.role,
    reason: spec.reason,
    evidenceLessonIds: spec.evidenceLessonIds,
  };
}

function segmentKnownAuthors(value) {
  const memo = new Map();
  function visit(rest) {
    if (!rest) return [];
    if (memo.has(rest)) return memo.get(rest);
    for (const name of segmentNames) {
      if (!rest.startsWith(name)) continue;
      const tail = visit(rest.slice(name.length));
      if (tail) {
        const result = [name, ...tail];
        memo.set(rest, result);
        return result;
      }
    }
    memo.set(rest, null);
    return null;
  }
  const result = visit(value);
  return result?.length > 1 ? result : null;
}

function tocAuthorNames(meta) {
  const label = String(meta.tocLabel || meta.title || "");
  if (!label.includes("/")) return [];
  const attribution = label.slice(label.lastIndexOf("/") + 1)
    .replace(/^[\[［【][^\]］】]+[\]］】]/, "")
    .replace(/[（(](?:译|譯|编|編|整理|选注|選注)[^）)]*[）)]/g, "")
    .trim();
  const bookMatch = attribution.match(/^《([^》]+)》$/);
  if (bookMatch) return qxAuthorByName.has(normal(bookMatch[1])) ? [bookMatch[1]] : [];
  return attribution.split(/[、，,；;]/)
    .flatMap((name) => {
      const compact = name.replace(/\s+/g, "").trim();
      return segmentKnownAuthors(compact) || [compact];
    })
    .filter((name) => /^[\p{L}·]{2,18}$/u.test(name));
}

function hasTitleHeadingEvidence(meta, first, authorName) {
  const title = compactHeading(meta.title).replace(/^\d+/, "");
  const body = compactHeading(first);
  const author = compactHeading(authorName);
  if (!title || !body || !author) return false;
  let position = body.indexOf(author);
  while (position >= 0) {
    const before = body.slice(Math.max(0, position - 28), position);
    const longest = Math.min(18, before.length);
    for (let length = longest; length >= 2; length -= 1) {
      if (title.includes(before.slice(-length))) return true;
    }
    position = body.indexOf(author, position + author.length);
  }
  return false;
}

function lessonAuthors(meta, posts, mode) {
  if (["unit-intro", "unit-task", "whole-book", "language-activity", "review"].includes(mode)) return [];
  const primaryText = (posts || []).map((post) => post.plain_text || "").join("\n");
  const found = new Map();
  for (const name of tocAuthorNames(meta)) found.set(normal(name), authorRecord(name, "toc"));
  if (String(meta.title || "").includes("/") && found.size) return [...found.values()];
  for (const author of authorCandidates) {
    if (!hasTitleHeadingEvidence(meta, primaryText, author.name)) continue;
    const key = normal(author.name);
    if (!found.has(key)) found.set(key, authorRecord(author.name, "heading"));
  }
  return [...found.values()];
}

const lessons = [];
const bookMap = new Map();
const authorMap = new Map();

for (const block of manifest.blocks) {
  for (const meta of block.lessons) {
    if (retired.test(meta.title || "")) continue;
    const lesson = JSON.parse(await readFile(path.join(SITE, meta.dataUrl), "utf8"));
    const first = lesson.posts?.[0]?.plain_text || "";
    const sourceBooks = [];
    const sourceHaystack = `${first.slice(0, 900)} ${meta.tocLabel || ""}`;
    for (const match of sourceHaystack.matchAll(/(?:选自|選自|出自)《([^》]{2,60})》/g)) sourceBooks.push(match[1].trim());
    for (const match of String(meta.tocLabel || "").matchAll(/《([^》]{2,60})》/g)) sourceBooks.push(match[1].trim());
    const uniqueBooks = [...new Set(sourceBooks)].filter((name) => !normal(meta.title).includes(normal(name)) || /论语|孟子|庄子|荀子|礼记|老子|墨子|诗经|左传|史记/.test(name));
    const classified = classify(meta);
    const authors = lessonAuthors(meta, lesson.posts, classified.mode);
    const record = {
      id: meta.id,
      title: meta.title,
      tocLabel: meta.tocLabel || "",
      blockId: block.id,
      blockTitle: block.title,
      page: meta.textbookStartPage || meta.textbook?.startPage || null,
      genres: classified.genres,
      mode: classified.mode,
      authors,
      sourceBooks: uniqueBooks,
      representativeFigure: authors.length ? null : representativeFigureFor(meta.id),
      visual: null,
    };
    lessons.push(record);
    for (const book of uniqueBooks) {
      if (!bookMap.has(book)) bookMap.set(book, []);
      bookMap.get(book).push(record.id);
    }
    for (const author of authors) {
      if (!authorMap.has(author.id)) authorMap.set(author.id, { ...author, lessons: [] });
      authorMap.get(author.id).lessons.push(record.id);
    }
  }
}

function ancestors(id) {
  const result = [];
  let current = nodeById[id];
  while (current) {
    result.push(current.id);
    current = current.parent ? nodeById[current.parent] : null;
  }
  return result;
}

const counts = Object.fromEntries(GENRES.map((item) => [item.id, 0]));
for (const lesson of lessons) {
  const seen = new Set(lesson.genres.flatMap(ancestors));
  seen.forEach((id) => { counts[id] += 1; });
}

const genreRecords = GENRES.map((item) => {
  const year = GENRE_YEARS[item.id] ?? 1900;
  const parent = item.parent ? nodeById[item.parent] : null;
  const children = GENRES.filter((candidate) => candidate.parent === item.id);
  const relationText = [parent ? `上承「${parent.label}」` : "總攝五冊教材的文體與學習活動", children.length ? `下分${children.map((child) => `「${child.label}」`).join("、")}` : "以具體篇目呈現其形式選擇"].join("；");
  return {
    ...item,
    count: counts[item.id],
    year,
    era: item.id === "root" ? "跨時代" : eraForYear(year),
    detail: `${item.description}${relationText}。本教材有 ${counts[item.id]} 個目錄項落在這條文體關係中。`,
    relatedIds: [...(item.parent ? [item.parent] : []), ...children.map((child) => child.id)],
    authorityLinks: [],
  };
});

const bookRecords = [...bookMap].map(([title, lessonIds]) => {
  const linkedLessons = lessonIds.map((id) => lessons.find((lesson) => lesson.id === id)).filter(Boolean);
  const authors = [...new Map(linkedLessons.flatMap((lesson) => lesson.authors || []).map((author) => [author.id, author])).values()];
  const genreIds = [...new Set(linkedLessons.flatMap((lesson) => lesson.genres || []))];
  const volumes = [...new Set(linkedLessons.map((lesson) => lesson.blockTitle).filter(Boolean))];
  const yearCandidates = authors.map((author) => author.year).filter(Number.isFinite);
  if (!yearCandidates.length) yearCandidates.push(...genreIds.map((id) => GENRE_YEARS[id]).filter(Number.isFinite));
  const sortedYears = yearCandidates.sort((a, b) => a - b);
  const year = sortedYears.length ? sortedYears[Math.floor(sortedYears.length / 2)] : 1900;
  const curated = BOOK_DETAILS.find((item) => item.pattern.test(title));
  const genreLabels = genreIds.map((id) => nodeById[id]?.label).filter(Boolean);
  const authorNames = authors.map((author) => author.name);
  const derived = `《${title}》在五冊教材中是 ${lessonIds.length} 個目錄項的明確來源，涉及${genreLabels.slice(0, 5).join("、") || "跨文體閱讀"}${authorNames.length ? `，並與${authorNames.slice(0, 5).join("、")}的篇目相連` : ""}。星圖依相關篇目與作者的時代座標定位，並保留跨冊互文關係。`;
  const authorityLinks = [
    ...(curated ? [{ label: "中國哲學書電子化計劃", href: curated.href }] : []),
    ...authors.filter((author) => author.url).slice(0, 3).map((author) => ({ label: `${author.name} · 群賢`, href: author.url })),
  ];
  return { title, lessonIds, authors, genreIds, volumes, year, era: eraForYear(year), description: curated?.description || derived, authorityLinks, relatedTitles: [] };
}).sort((a, b) => a.year - b.year || b.lessonIds.length - a.lessonIds.length || a.title.localeCompare(b.title, "zh"));

for (const book of bookRecords) {
  const lessonSet = new Set(book.lessonIds);
  const authorSet = new Set(book.authors.map((author) => author.id));
  book.relatedTitles = bookRecords.filter((candidate) => candidate !== book).map((candidate) => ({
    title: candidate.title,
    score: candidate.lessonIds.filter((id) => lessonSet.has(id)).length * 3 + candidate.authors.filter((author) => authorSet.has(author.id)).length,
  })).filter((candidate) => candidate.score > 0).sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, "zh")).slice(0, 6).map((candidate) => candidate.title);
}

const output = {
  generatedAt: existingOutput?.generatedAt || new Date().toISOString(),
  stats: {
    lessons: lessons.length,
    genres: GENRES.length - 1,
    sourceBooks: bookMap.size,
    authors: authorMap.size,
    volumes: manifest.blocks.length,
  },
  genres: genreRecords,
  lessons,
  books: bookRecords,
  authors: [...authorMap.values()].sort((a, b) => b.lessons.length - a.lessons.length || a.name.localeCompare(b.name, "zh")),
};

const serialized = `${JSON.stringify(output)}\n`;
if (CHECK_ONLY) {
  const current = await readFile(OUTPUT_PATH, "utf8");
  if (current !== serialized) {
    console.error("literary taxonomy is stale; run npm run build:taxonomy");
    process.exit(1);
  }
  console.log("literary taxonomy is current");
  process.exit(0);
}
await writeFile(OUTPUT_PATH, serialized);
console.log(`taxonomy: ${output.stats.lessons} lessons, ${output.stats.genres} genre nodes, ${output.stats.sourceBooks} source books, ${output.stats.authors} linked authors`);
