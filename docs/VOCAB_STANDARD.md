# 字詞題庫重建標準（vocab bank v1）

適用：`yw.bdfz.net` 全部可出題課文（taxonomy 模式為
classical / poetry / fiction / drama / journalism / argument / science / modern-prose / speech-letter，
共 135 篇；unit-intro、unit-task、whole-book、language-activity、review 不出題）。

## 1. 選詞原則

**不以教材註釋為上限，也不機械逐詞出題。** 收錄標準：誤解該詞是否影響
文意理解、後續閱讀能力、考試表現或向陌生文本的遷移。重點類別：

- 古今異義；隨語境變化的多義詞
- 文言虛詞與高頻考點用法；通假、古字、特殊句法用法；必要時讀音
- 常見但易誤解的詞；字面義 ≠ 語境義的詞
- 影響句法、論證、敘事、人物、意象理解的關鍵詞
- 重要搭配、成語、典故、文化語詞
- 課下未註但普通閱讀仍重要的冷詞

## 2. 數據結構

`site/data/vocab/<lessonId>.json`，題數索引 `site/data/vocab/index.json`（Worker 亮度公式同源）。
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

## 3. 生產管線

1. `node scripts/build_vocab_bank.mjs`：裝配正文（與前端同源的 primary post 規則）＋
   抽取教材註釋（與 `app.js lessonVocabulary()` 同一套 footnote 規則）→
   經 `apis.bdfz.net` 統一網關（`X-Task-Type: authoring`）命題 → 結構硬檢＋至多兩輪整改重生成。
2. 腳本兜底（不信模型）：
   - 教材註釋漏列 → 自動補 `note-only` 條目（保證「每條註釋被覆蓋或有記錄地排除」恆真）
   - `sourceSentence` 標點漂移 → 去標點掃描回寫正文逐字原句；找不到即判編造、觸發重生成
   - `location` 由腳本按正文實際定位回填
3. `node scripts/validate_vocab_bank.mjs --strict-coverage`：發佈閘門。

## 4. 核查項（validate_vocab_bank.mjs 硬性執行）

| 代號 | 任務書要求 | 實現 |
| --- | --- | --- |
| C0 | 每課都已對照完整正文審過 | strict-coverage：135 篇缺一即 FAIL（正文過短者記錄豁免） |
| C1 | 答案與課文語境一致的前提：出處真實 | sourceSentence 必須逐字在正文中 |
| C2 | 註釋全覆蓋或有記錄的排除 | 每條註釋在 inventory 有 decision＋reason |
| C3 | 補收未註而重要的詞 | 正文 ≥600 字的課，未註條目 ≥3 |
| C4 | 題目結構有效 | 型別合法、四選項互異、answerIndex 有效、有解析 |
| C5 | 去重 | 同課題幹去重；同詞同題型禁止重複 |
| C6 | 難度分佈合理 | ≥6 題的課至少覆蓋兩個難度檔 |
| C7 | 文言對照可靠辭書 | classical 條目必須帶 sourceRefs（辭書/文獻名） |
| C8 | 標識穩定 | id 格式/唯一；index.json 與檔案一致 |

內容層面（答案正確性）由網關命題模型負責初稿、抽樣人工複核；
發現錯題直接改 JSON 後重跑 validator（腳本不覆蓋既有檔，`--force` 才重生成）。

## 5. 前端行為（app.js）

- 有題庫 → 詞級疏通變為逐題過關：原句（標記本詞）＋題幹＋四選一；答錯可重試
  （第二次錯後亮出正解與解析）；答對顯示解析後「下一題」推進；全部答對 → checkpoint 完成。
- 作答、錯誤、重試、掌握全記錄：本地 `progress.vocabularyQuiz.answers[itemId] = {attempts, correct, mastered}`；
  登入態同步 D1（`/api/reading/vocab-attempt`，首答對即 mastered，否則需兩次答對）；
  完課發 UC 事件 `vocab-quiz:<lessonId>`，納入 my.bdfz.net 統一活動數據。
- 掌握度反哺閱讀星圖：課文星亮度含 `1.5·(已掌握/題數)` 項（見 READING_CONSTELLATION.md §4）。
- 無題庫課文回退舊的註詞逐查流程，不阻塞上線；題庫增量補齊。
