# 字詞題庫重建標準（vocab bank v2）

適用：`yw.bdfz.net` 與語文原生 App 的同源詞級疏通。

預設只有 taxonomy 模式 `classical`、`poetry` 可出題。fiction、drama、
journalism、argument、science、modern-prose、speech-letter 以及所有單元、
整本書與活動模式均不得載入、顯示或計入詞級疏通。當前 77 課有 723 個
active questions；其他 56 個曾有題目的非古詩文課已轉為 344 個精確
eligibility tombstones。另有 35 個既有質量覆核 tombstones，合計 379 個；
歷史作答與 User Center 評價／證據記錄不得刪除或改寫。

## 1. 選詞原則

對古文與古詩詞，**不以教材註釋為上限，也不機械逐詞出題。** 收錄標準：誤解該詞是否影響
文意理解、後續閱讀能力、考試表現或向陌生文本的遷移。重點類別：

- 古今異義；隨語境變化的多義詞
- 文言虛詞與高頻考點用法；通假、古字、特殊句法用法；必要時讀音
- 常見但易誤解的詞；字面義 ≠ 語境義的詞
- 影響句法、論證、敘事、人物、意象理解的關鍵詞
- 重要搭配、成語、典故、文化語詞
- 課下未註但普通閱讀仍重要的冷詞

## 2. 數據結構

`site/data/vocab/<lessonId>.json`，題數索引 `site/data/vocab/index.json`（Worker 亮度公式同源）。
範圍規則的單一事實源是 `site/data/vocab-eligibility.json`。預設模式、
例外、覆核人、時間與理由必須在此記錄；前端、learning manifest 和原生
content bundle 都只讀這一份規則。
人工覆核處置的單一事實源是
`site/data/vocab-question-dispositions.json`。處置以穩定 `itemId`、原題
`sourceItemSha256` 和不可重用 tombstone 綁定，禁止用詞面模糊匹配或在
App 端另存刪題清單。

非預設模式的例外必須逐題覆核，並同時綁定穩定 `lessonId`、`itemId` 與
原題 `sourceItemSha256`。不允許整課、文體、關鍵詞或臨時 UI 開關式例外；
來源 SHA 漂移即 fail closed。當前例外數為 0。

每條 inventory 條目：

```
id            lessonId:vNN（穩定唯一，前端/D1 掌握記錄以此為鍵）
word          詞條
annotated     是否教材已註
decision      question | note-only | excluded（後兩者必須給 reason —— 有記錄的排除）
reason        收錄/排除理由（任務書要求的 inclusion reason）
contextMeaning 語境義
sourceSentence 出處原句（逐字來自正文，location.charIndex 由腳本回填）
type          contextual-choice | gu-jin | substitution | discrimination |
              usage | pronunciation | interpretation | evidence
question / options[4] / answerIndex / explanation / difficulty(1-3) / sourceRefs[]
```

受人工處置的生成檔另包含 `questionTombstones`；只有仍屬可出題範圍的整課題集被阻斷時
才包含 `questionSetStatus`／`questionSetBlocker`，一般可交付題庫省略這兩
個欄位。範圍排除課不得顯示為「待重建」：

```text
questionSetStatus   blocked-rebuild-required
questionSetBlocker  阻斷原因和待辦，不得用空題庫冒充已完成
questionTombstones  dispositionId / itemId / sourceItemSha256 / reason
```

## 3. 生產管線

1. `npm run build:vocab`：先由 `build_vocab_bank.mjs` 裝配正文（與前端同源的 primary post 規則）＋
   抽取教材註釋（與 `app.js lessonVocabulary()` 同一套 footnote 規則）→
   經 `apis.bdfz.net` 統一網關（`X-Task-Type: authoring`）命題 → 結構硬檢＋至多兩輪整改重生成；
   再套用質量處置與 eligibility policy。只執行 source builder 不構成可發布產物。
2. 腳本兜底（不信模型）：
   - 教材註釋漏列 → 自動補 `note-only` 條目（保證「每條註釋被覆蓋或有記錄地排除」恆真）
   - `sourceSentence` 標點漂移 → 去標點掃描回寫正文逐字原句；找不到即判編造、觸發重生成
   - `location` 由腳本按正文實際定位回填
3. `npm run check:vocab-policy`：按原題 SHA 驗證所有質量處置與範圍
   tombstone 已精確套用；來源漂移即失敗，不自動猜測替代題。
4. `npm run test:vocab-policy`：驗證 723／344／35／379 精確計數、被刪題
   不在 active 集合、tombstone 完整且 ID 不可重用。
5. `npm run verify:vocab:release`：發佈閘門；Web、App 或 learning
   manifest 任一仍帶非古詩文詞級題即失敗。

## 4. 核查項（validate_vocab_bank.mjs 硬性執行）

| 代號 | 任務書要求 | 實現 |
| --- | --- | --- |
| C0 | 每課都已對照完整正文審過 | strict-coverage：134 份來源 bank 缺一即 FAIL；出題資格另由 policy 決定 |
| C1 | 答案與課文語境一致的前提：出處真實 | sourceSentence 必須逐字在正文中 |
| C2 | 註釋全覆蓋或有記錄的排除 | 每條註釋在 inventory 有 decision＋reason |
| C3 | 補收未註而重要的詞 | 正文 ≥600 字的課，未註條目 ≥3 |
| C4 | 題目結構有效 | 型別合法、四選項互異、answerIndex 有效、有解析 |
| C5 | 去重 | 同課題幹去重；同詞同題型禁止重複 |
| C6 | 難度分佈合理 | ≥6 題的課至少覆蓋兩個難度檔 |
| C7 | 文言對照可靠辭書 | classical 條目必須帶 sourceRefs（辭書/文獻名） |
| C8 | 標識穩定 | id 格式/唯一；index.json 與檔案一致 |
| C9 | 人工處置不可漂移 | sourceItemSha256 精確匹配；active ID 與 tombstone ID 不相交；blocked 課不得交付題目 |
| C10 | 質量覆核歷史完整 | 35 個 reviewed dispositions 必須都有 exact tombstone |
| C11 | 範圍規則同源 | active 僅限 classical／poetry 或逐題 SHA 例外；範圍排除課不得偽裝成 rebuild blocker |

內容層面（答案正確性）由網關命題模型負責初稿、抽樣人工複核；
發現錯題直接改 JSON 後重跑 validator（腳本不覆蓋既有檔，`--force` 才重生成）。

現當代課文預設不設詞級疏通。範圍策略可以批量停用呈現，但每一道既有題
仍必須生成綁定原題 SHA 的 exact tombstone，且不可清除歷史。Web 與 App
必須從同一生成圖同步生效。

當前覆核基線（2026-07-30）：723 個 active questions、344 個 eligibility
tombstones、35 個 quality tombstones、0 個例外。正式發布仍須通過完整
Web/App 同步交易與 User Center 評價契約回歸。

## 5. 前端行為（app.js）

- 可出題且有題庫 → 詞級疏通逐題過關：原句（標記本詞）＋題幹＋四選一；
  答錯留在原題重試（第二次錯後亮出正解與解析）；答對後自動進入本課下一題；
  本課末題只完成本課，絕不切換篇目。
- 非古文／古詩詞課不建立詞級階段、不 fetch bank、不顯示新詞創作；古詩詞
  完成題庫後可顯示新詞活用，古文不顯示。
- 作答、錯誤、重試、掌握全記錄：本地 `progress.vocabularyQuiz.answers[itemId] = {attempts, correct, mastered}`；
  登入態同步 D1（`/api/reading/vocab-attempt`，首答對即 mastered，否則需兩次答對）；
  完課發 UC 事件 `vocab-quiz:<lessonId>`，納入 my.bdfz.net 統一活動數據。
- 掌握度反哺閱讀星圖：課文星亮度含 `1.5·(已掌握/題數)` 項（見 READING_CONSTELLATION.md §4）。
- 只有 eligibility 允許但題庫缺失的課可回退註詞逐查；非 eligibility 課
  不得藉回退路徑重新出現詞級疏通。
