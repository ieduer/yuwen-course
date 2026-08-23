export const LESSON_BLUEPRINT_CACHE_VERSION = "participation-matrix-v7-server-authority";

export const BLUEPRINT_MODE_TECHNIQUES = Object.freeze({
  classical: "語意轉折、敘事或論說章法",
  poetry: "意象、聲律與情感轉折",
  fiction: "敘事視角、場景次序與關鍵細節",
  drama: "人物關係、臺詞潛臺詞與場面調度",
  journalism: "事實、引語與報道角度",
  science: "概念、證據與推理邊界",
  argument: "概念界定、論據組織與推理",
  "unit-intro": "篇目關係、人文主題與學習路徑",
  "unit-task": "材料、行動與成果標準",
});

// These focuses are the reviewed NotebookLM lesson-map authority. Keeping them in
// this browser/Worker-safe module lets both runtime paths use the same wording.
export const INFOGRAPHIC_FOCUS = Object.freeze({
  "lesson-1458": "“過去—當下—未來”三層時間軸：革命勝利的歷史必然、建國議程與建設藍圖如何共同支撐“中國人民站起來了”",
  "lesson-1461": "長征勝利後的行軍與會師節點圖：以時間、地點、部隊行動和人物感受呈現“勝利萬歲”的來路",
  "lesson-1462": "聶榮臻處理日本小姑娘事件的“發現—救護—送還—致函”行動鏈及其人道立場",
  "lesson-1466": "香港政權交接的新聞時鐘：四個關鍵時間點、場景與象徵物如何完成歷史轉場",
  "lesson-1471": "焦裕祿的四種工作方法：調查、追洪水、查風口、探流沙與群眾路線之間的對應關係",
  "lesson-1468": "2020 抗疫進程中的“關鍵節點—集體行動—制度力量”證據時間軸",
  "lesson-1474": "《論語》十二章概念網絡：修身、學習、仁、義、恕與君子人格之間的關聯",
  "lesson-1476": "“三綱領—八條目”遞進階梯：從明明德到平天下的內外修養路徑",
  "lesson-1477": "“不忍人之心—四端—四德”推演圖：孟子如何從生活經驗建立道德論證",
  "lesson-1483": "《老子》四章的反常識命題對照圖：有無、知止、柔弱與自知如何互相照亮",
  "lesson-1484": "大瓠的兩種用途分叉圖：同一對象如何因思維尺度不同導向“無用”與“大用”",
  "lesson-1485": "墨子“兼愛”因果鏈：亂從何起、兼相愛如何改變關係與秩序",
  "lesson-1488": "從大衛成年後回望童工經歷的第一人稱視角切入：家庭、學校、工廠中的權力人物與關鍵事件如何塑造主人公",
  "lesson-1490": "聶赫留朵夫的內心轉折雙欄圖：審判前後的觀察、記憶、羞愧與行動意向",
  "lesson-1493": "老人同鯊魚五個回合的消耗時間線：武器、獵物損失、身體狀態與內心獨白同步變化",
  "lesson-1494": "馬孔多的“現實—神奇”並置圖：日常經驗、傳聞、科技與家族記憶如何形成魔幻真實感",
  "lesson-1497": "《無衣》三章重章疊唱結構：衣、兵器、行動和情感強度如何層層推進",
  "lesson-1498": "月亮運行與情感曲線：江、花、月、夜、遊子與思婦意象如何在全詩中流轉",
  "lesson-1499": "《將進酒》情緒與語速曲線：悲、歡、狂、憤、放達怎樣隨勸酒結構升降",
  "lesson-1500": "夢前—夢中—夢後雙時空圖：十年生死、千里孤墳與“小軒窗”如何聚合哀思",
  "lesson-1517": "經濟基礎與上層建築的雙向作用圖：決定作用、反作用及“最終決定性”的邊界",
  "lesson-1518": "“主觀主義—理論與實際分離—改造學習”問題診斷與解決路徑圖",
  "lesson-1519": "“實踐—感性認識—理性認識—再實踐”的循環上升圖",
  "lesson-1520": "“實踐是檢驗真理的唯一標準”論證鏈：命題、理由、反駁與結論邊界",
  "lesson-1521": "“修辭立其誠”失真類型圖：名實錯位、言行脫節與主觀遮蔽如何破壞表達",
  "lesson-1522": "盧梭關於憐憫的論證路徑：自然情感、理性自愛與社會關係之間的作用",
  "lesson-1523": "蘇格拉底問答階梯：從“報答”到“正義”的概念澄清與反例推進",
  "lesson-1526": "七節情感—論述結構圖：“無話可說”的反覆怎樣推動悼念、控訴與反思",
  "lesson-1527": "“記憶—遺忘—寫作”三角圖：五位青年、柔石與作者如何在敘述中彼此映照",
  "lesson-1528": "包身工的一日時鐘：起床、上工、勞動、受罰與收工中的時間控制和空間壓迫",
  "lesson-1529": "“荷花澱—水上戰鬥”意象對照圖：詩意環境、戰爭行動與女性成長如何共存",
  "lesson-1530": "小二黑、小芹、二諸葛、三仙姑與村權力的衝突關係圖",
  "lesson-1531": "“黨費”物件意義鏈：鹹菜、銀元、黨員身份與犧牲選擇之間的聯繫",
  "lesson-1534": "屈原命運與楚國興衰並行時間線：任用、被疏、被絀、放逐與自沉的因果節點",
  "lesson-1535": "蘇武十九年處境地圖：出使、受審、北海牧羊、歸漢與不變的持節選擇",
  "lesson-1536": "秦由強至亡的因果魚骨圖：地利、政策、人才、民心與統治方式",
  "lesson-1537": "“盛衰之理，雖曰天命，豈非人事哉”證據天平：得天下與失天下的對照",
  "lesson-1540": "娜拉覺醒對話階梯：稱呼、金錢、婚姻、責任與“關門聲”如何逐級改變",
  "lesson-1541": "“你可知道那地方”復沓地圖：南方意象、故鄉想象與迷娘身世之謎",
  "lesson-1542": "大海意象的情感階段圖：告別、自由、英雄記憶與現實壓抑",
  "lesson-1543": "“我”向眾生與宇宙擴展的同心圓：身體、他者、自然與民主自我",
  "lesson-1544": "兩棵樹與天空的空間關係圖：距離、風雪、等待與短暫相觸",
  "lesson-1547": "邊塞戰場縱深圖：漢家、榆關、碣石、沙場與思婦空間的交錯",
  "lesson-1548": "箜篌聲的通感轉換表：聲音如何被寫成顏色、溫度、動作、神話與空間",
  "lesson-1550": "錦瑟意象鏈：莊生夢蝶、望帝啼鵑、滄海珠淚與藍田玉煙如何組織追憶",
  "lesson-1549": "現實與夢境雙線圖：“塞上長城”的自許如何被衰老與報國無門反襯",
  "lesson-1556": "《氓》婚姻關係曲線：相戀、成婚、勞作、變心與決絕中的話語權變化",
  "lesson-1557": "香草、美人、黨人、鷙鳥意象對照圖：人格自守與政治處境",
  "lesson-1558": "《孔雀東南飛》悲劇節點時間線：遣歸、逼婚、誓別、自盡與合葬",
  "lesson-1559": "入蜀路線的垂直剖面：太白、鳥道、天梯石棧、劍閣與錦城的險度升級",
  "lesson-1560": "《蜀相》由祠堂空間到歷史人物的鏡頭推進：尋訪、景物、追憶與哀歎",
  "lesson-1561": "杭州城市全景分層圖：地理形勝、市井繁華、西湖景觀與治理願景",
  "lesson-1562": "揚州“昔盛—今衰”城市記憶對照：杜牧詩境、眼前薺麥與二十四橋冷月",
  "lesson-1565": "阿Q“精神勝利法”循環圖：受辱、自我解釋、短暫優越與再次受辱",
  "lesson-1566": "渡口、碾坊與黃狗構成的選擇空間：翠翠的生活路徑與情感猶疑",
  "lesson-1567": "“大堰河”稱謂與勞動意象群：乳母身份、日常勞作和詩人情感的層層回返",
  "lesson-1568": "《再別康橋》空間移動圖：雲彩、金柳、青荇、潭水、星輝與沉默告別",
  "lesson-1569": "山村生命共同體網絡：草木、鳥獸、村民、歷史與“我”的感應",
  "lesson-1570": "《風景談》六幅畫面的勞動者視覺中心：環境、人物位置與意義變化",
  "lesson-1571": "秦腔的聲音—動作—色彩感官圖：鄉土生活如何被舞臺節奏組織",
  "lesson-1572": "“雨”觸發的五感與記憶地圖：臺北、江南、廈門和故鄉時間層",
  "lesson-1573": "裕泰茶館人物—社會關係網：三教九流如何折射時代變遷",
  "lesson-1576": "李密“情—理—忠—孝”論證天平：身世陳述、祖母處境、朝廷恩遇與請求",
  "lesson-1577": "項脊軒平面圖與記憶標記：舊屋、庭院、門牆和人物往事",
  "lesson-1578": "蘭亭雅集到生死之思的情感轉折曲線：樂—痛—悲",
  "lesson-1579": "“歸去”動詞路線圖：辭官、歸途、入門、涉園、登山臨水與自我安頓",
  "lesson-1580": "種樹與治民的類比表：順木之天性、官吏擾民和“養人術”",
  "lesson-1581": "石鐘山得名的證據鏈：舊說、質疑、夜訪觀察與結論限度",
  "lesson-1584": "自然選擇的證據樹：變異、遺傳、生存競爭、人工選擇與物種形成",
  "lesson-1585": "宇宙尺度階梯：地球、太陽系、銀河系、星系群與可觀測宇宙",
  "lesson-1586": "日心說與地心說的證據競賽時間線：觀測、模型、爭論與認識更新",
  "lesson-1588": "《擬行路難》情感壓力曲線：命定、自解、舉杯、斷歌與吞聲躑躅",
  "lesson-1589": "客至的空間與待客路徑：舍南舍北、花徑、蓬門、盤飧與鄰翁",
  "lesson-1590": "《登快閣》視線移動圖：閣上遠眺、山水澄明、知音難覓與歸舟白鷗",
  "lesson-1591": "臨安春日五感圖：小樓、雨聲、杏花、矮紙、茶煙與客居惆悵",
});

const BANNED_BLUEPRINT_PATTERNS = Object.freeze([
  /我是/u,
  /抽掉/u,
  /換序/u,
  /换序/u,
  /最關鍵的材料/u,
  /最关键的材料/u,
  /我把全文/u,
  /你看見了嗎/u,
  /你看见了吗/u,
]);

const META_SENTENCE_PATTERN = /(?:節選自|节选自|選自|选自|選入教材|选入教材|這裡節選|这里节选|出自|原載|原载|語出|语出|學習提示|学习提示|作者簡介|作者简介|小說前面的情節|小说前面的情节|形勢簡圖|形势简图|示意圖|示意图|譯(?:本|者|。|$)|译(?:本|者|。|$)|有改動|有改动|題目是編者加的|题目是编者加的|詞牌名|词牌名|樂府舊題|乐府旧题|作於|作于|作此詞|作此词|寫於|写于|收錄|收录|代表作|代表劇作|代表剧作|全劇|全剧|著有|曾主持|原名|今屬|今属|\d{4}\s*[—-]\s*\d{4}|\s攝(?:\s|$)|\s摄(?:\s|$)|英國小說家|英国小说家|美國小說家|美国小说家|劇作家|剧作家|詩人|诗人|作家|學者|学者|共\s*\d+\s*分|閱讀下面|阅读下面|Search this site|Page updated|20\d{2}\s*年版本|本課|本课|本單元|本单元|以下是經過格式調整|以下是经过格式调整)/u;

export function normalizeBlueprintMode(mode) {
  const value = String(mode || "").trim();
  if (["language-activity", "whole-book", "review"].includes(value)) return "unit-task";
  if (["speech-letter", "modern-prose"].includes(value)) return "argument";
  return Object.hasOwn(BLUEPRINT_MODE_TECHNIQUES, value) ? value : "argument";
}

function normalizeExcerpt(value) {
  return String(value || "")
    .replace(/\[[0-9]{1,3}\]/g, "")
    .replace(/[\t\r\n ]+/g, " ")
    .trim();
}

function trimAnchor(value, max = 22) {
  const cleaned = String(value || "")
    .replace(/^[\s，。；：、！？,.!?;:“”‘’'"（）()《》—-]+|[\s，。；：、！？,.!?;:“”‘’'"（）()《》—-]+$/gu, "")
    .trim();
  if (cleaned.length <= max) return cleaned;
  const firstClause = cleaned.split(/[，,；;：:]/u).find((part) => (part.match(/[\p{Script=Han}A-Za-z]/gu) || []).length >= 6);
  return String(firstClause || cleaned).trim().slice(0, max);
}

export function lessonBlueprintAnchor(excerpt, lessonTitle = "") {
  const normalized = normalizeExcerpt(excerpt);
  const normalizedTitle = normalizeExcerpt(lessonTitle).replace(/^\d+\s*/u, "");
  const candidates = normalized
    .split(/[。！？!?]+/u)
    .map((raw) => ({ raw, anchor: trimAnchor(raw) }))
    .filter((item) => (item.anchor.match(/[\p{Script=Han}A-Za-z]/gu) || []).length >= 10);
  const contentCandidate = candidates.find((item) => (
    !META_SENTENCE_PATTERN.test(item.raw)
    && !BANNED_BLUEPRINT_PATTERNS.some((pattern) => pattern.test(item.raw))
    && !(normalizedTitle && normalizeExcerpt(item.raw).startsWith(normalizedTitle))
  ));
  if (contentCandidate) return contentCandidate.anchor;
  return trimAnchor(lessonTitle, 18) || "本課正文";
}

export function lessonBlueprintPromptAnchor({ lessonId = "", lessonTitle = "", excerpt = "" } = {}) {
  return INFOGRAPHIC_FOCUS[String(lessonId || "")] || lessonBlueprintAnchor(excerpt, lessonTitle);
}

export function deterministicLessonBlueprint({ lessonId = "", lessonTitle = "", blockTitle = "", mode = "", excerpt = "" } = {}) {
  const normalizedMode = normalizeBlueprintMode(mode);
  const technique = BLUEPRINT_MODE_TECHNIQUES[normalizedMode];
  const reviewedFocus = INFOGRAPHIC_FOCUS[String(lessonId || "")] || "";
  const anchor = reviewedFocus || lessonBlueprintAnchor(excerpt, lessonTitle);
  const lessonLabel = [String(blockTitle || "").trim(), String(lessonTitle || "").trim() || "本文"].filter(Boolean).join(" · ");
  const focus = reviewedFocus
    ? `圍繞「${anchor}」，在正文定位至少兩處證據`
    : `先定位正文「${anchor}」，向前後追蹤至少兩處證據`;
  return {
    structureFocus: `${focus}，核查${technique}如何共同形成《${lessonLabel}》的表達效果；請用原文說明。`,
  };
}

export function inspectLessonBlueprint(structureFocus, context = {}) {
  const text = String(structureFocus || "").replace(/\s+/g, " ").trim();
  const mode = normalizeBlueprintMode(context.mode);
  const technique = BLUEPRINT_MODE_TECHNIQUES[mode];
  const anchor = lessonBlueprintPromptAnchor(context);
  const lessonLabel = [String(context.blockTitle || "").trim(), String(context.lessonTitle || "").trim()].filter(Boolean).join(" · ");
  const failures = [];
  if (text.length < 42 || text.length > 300) failures.push("length");
  if (BANNED_BLUEPRINT_PATTERNS.some((pattern) => pattern.test(text))) failures.push("generic_or_impersonated");
  if (!text.includes(anchor)) failures.push("missing_text_anchor");
  if (!text.includes(technique)) failures.push("missing_mode_technique");
  if (lessonLabel && !text.includes(lessonLabel)) failures.push("missing_lesson_label");
  if (!/(原文|正文)/u.test(text)) failures.push("missing_evidence_instruction");
  return { ok: failures.length === 0, failures, anchor, technique, mode };
}

export function normalizeLessonBlueprint(value, context = {}) {
  const candidate = String(value?.structureFocus || "").replace(/\s+/g, " ").trim().slice(0, 300);
  if (inspectLessonBlueprint(candidate, context).ok) return { structureFocus: candidate };
  return deterministicLessonBlueprint(context);
}
