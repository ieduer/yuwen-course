# 閱讀星圖 v2：耐久學習記錄改基草案

狀態：**站長審閱稿；未批准實作**  
適用站點：`yw.bdfz.net`（Cloudflare Pages `yuwen-course`）  
資料庫：D1 `yuwen-reading-db`，綁定 `READING_DB`  
預定規則版本：`constellation-rules-v2`

本稿只定義改基契約，不授權程式、D1 schema、歷史資料或生產發布變更。批准後仍須另做
additive-only 遷移、來源 D1 備份、preview/backfill dry-run、測試、真實瀏覽器驗收與逐步發布。

## 1. 目的與不可變邊界

v2 把課文星的存在條件從「有現行三詞提交」改為「該課有至少一條符合本文規則的耐久學習記錄」。
三詞仍是 A+ 契約中的既有互動和星圖來源，但不再是唯一來源。

以下邊界不變：

- 每顆星、每條線、每分亮度都必須能回溯到本文規則和來源 D1 的一行真實資料。
- 空就是空；不從缺失資料、頁面瀏覽、推測興趣或全站平均補值。
- A+ 計分資格與星圖可見性分離。必修三詞可以形成個人閱讀記錄，但不得因此進入
  `learning-manifest.json`、`learning_interactions` 或 `evidence_outbox`。
- 不改 Canvas 渲染段、冊別樞紐、既有 `star_nodes.seq`、既有節點 ID 或出生序。
- 所有 D1 變更 additive-only；不得 `DROP`、清表、覆寫歷史來源列或刪除學生資料。
- `/insights` 下線不影響本契約；v2 只由 `/api/reading/constellation` 向 `/star` 提供資料。

## 2. 生產基線（2026-08-28 已核實）

| 候選來源 | 合格列 | 學生 | 課文 |
| --- | ---: | ---: | ---: |
| `submissions` 三詞 | 0 | 0 | 0 |
| `learning_interactions.interaction_key='readAcknowledged'` | 93 | 4 | 32 |
| `classical_first_read_marks.deleted_at IS NULL` | 31 | 3 | 7 |
| 上列且 `length(trim(selected_text)) BETWEEN 1 AND 12` | 24 | 3 | 6 |
| `classical_first_read_sessions.submitted_at IS NOT NULL` | 10 | 3 | 7 |
| `vocab_mastery.status='mastered'` | 46 | 4 | 6 |
| `learning_interactions.interaction_key='studyGuideItemCompleted'` | 137 | 2 | 2 |
| `learning_interactions.interaction_key='evaluation'` | 5 | 2 | 3 |

上述數字是改基候選面，不是回填命令。v2 實作前必須重新以 aggregate-only SELECT 讀回；任何差異都要
更新本節和發布 receipt，不能把舊計數當作當時的生產權威。

## 3. 節點種類與來源列

前端 `KINDS` 預定擴充為：`["冊別", "課文星", "詞星", "學習印記"]`。`kind` 的 wire value
維持英文：`vol`（前端合成）、`lesson`、`word`、`record`。

### 3.1 課文星 `lesson:<lesson_id>`

同一學生、同一課只有一顆。下列任一來源存在即顯示：

| `origin_type` | 精確來源列 | 合格條件 | `origin_key` |
| --- | --- | --- | --- |
| `three_words` | `submissions.id` | 該學生、該課的任一耐久版本；`source!='synthetic'` | 十進位 `submissions.id` |
| `read_ack` | `learning_interactions.source_event_id` | `interaction_key='readAcknowledged'` | `source_event_id` |
| `first_read` | `classical_first_read_sessions` 複合主鍵 | `submitted_at IS NOT NULL` | `<lesson_id>:<text_version_id>` |
| `study_guide` | `learning_interactions.source_event_id` | `interaction_key='studyGuideItemCompleted'` | `source_event_id` |
| `vocab_mastery` | `vocab_mastery` 複合主鍵 | `status='mastered'`，且 `item_id` 仍存在於該課 current vocab bank | `<lesson_id>:<item_id>` |
| `evaluation` | `learning_interactions.source_event_id` | `interaction_key='evaluation'` | `source_event_id` |

`lesson_id` 必須存在於 `site/data/manifest.json` 的權威課文目錄。這是星圖課文權威，不是 A+
`site/data/learning-manifest.json`；兩者不得混用。找不到權威課文時 fail closed，不建節點，健康報告只增加
`unmappedOrigins` 數字。

### 3.2 詞星 `word:<word_norm>`

同一學生、同一規範詞跨課合併成一顆。詞形規範仍沿用 v1：NFKC、去標點空白、既有繁簡折算、長度
1 至 12 字。來源只有三類：

| `origin_type` | 精確來源列 | 詞形來源 | 合格條件 |
| --- | --- | --- | --- |
| `three_words` | `submission_words.id` | `word_norm` | 父 `submissions.source!='synthetic'` |
| `first_read_mark` | `classical_first_read_marks.mark_id` | `selected_text` 規範化結果 | `deleted_at IS NULL`；長度 1..12；同一 `text_version_id` 的 session 已提交 |
| `vocab_mastery` | `vocab_mastery` 複合主鍵 | current `site/data/vocab/<lesson>.json.inventory[]` 中同 `item_id` 的 `word` | `status='mastered'` 且能唯一對回非空詞形 |

長於 12 字的初讀標記本版不產生詞星，也不轉成「疑難句」星。題庫 item 找不到、重複或沒有可規範詞形時
不產生詞星；寧可缺星，不猜詞。

### 3.3 學習印記 `record:<type>:<origin_key>`

印記用來讓學生看見「確實做過的一步」，不宣稱能力分數。每一顆只對應一行來源資料：

| `type` | 精確來源列 | 顯示條件 | 顯示名稱 |
| --- | --- | --- | --- |
| `submission` | `submissions.id` | 非 synthetic | 三詞記錄 |
| `read` | `learning_interactions.source_event_id` | `readAcknowledged` | 通讀正文 |
| `first-read` | session 複合主鍵 | `submitted_at IS NOT NULL` | 無注疏初讀 |
| `study-guide` | `learning_interactions.source_event_id` | `studyGuideItemCompleted` | 學案完成 |
| `mastery` | mastery 複合主鍵 | current bank 中 `status='mastered'` | 字詞掌握 |
| `evaluation` | `learning_interactions.source_event_id` | `evaluation` | 本篇評價 |

印記 metadata 只回 `type`、`lessonId`、來源時間、狀態和安全顯示標籤；不回學生原文、猜測、訂正、
`raw_payload_json`、評價正文或任何 UC 識別欄位。評價印記只表示「已評價」，不能畫成掌握度。

## 4. 可追溯投影（additive-only 設計）

批准後新增兩張投影表；來源表仍是事實權威，投影可重建但不得虛構：

```sql
CREATE TABLE star_node_origins (
  student_id INTEGER NOT NULL,
  node_id TEXT NOT NULL,
  origin_type TEXT NOT NULL,
  origin_key TEXT NOT NULL,
  lesson_id TEXT NOT NULL,
  word_norm TEXT NOT NULL DEFAULT '',
  source_occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (student_id, node_id, origin_type, origin_key)
);

CREATE TABLE star_node_layout (
  student_id INTEGER NOT NULL,
  node_id TEXT NOT NULL,
  layout_version TEXT NOT NULL,
  volume_index INTEGER,
  lesson_ordinal INTEGER,
  anchor_lesson_id TEXT NOT NULL DEFAULT '',
  position_seed TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (student_id, node_id)
);
```

`star_node_origins` 的每行必須能以 `(origin_type, origin_key)` 精確 SELECT 回唯一來源列；投影生成器若
讀不到或讀到多行就 fail closed。`star_node_layout` 只凍結佈局輸入，不是學習證據。

新增來源時，同一 D1 transaction 依序 `INSERT OR IGNORE star_nodes`、`star_node_origins`、
`star_node_layout`。`GET /constellation` 不建星、不補表，避免 read-on-GET 的隱性寫入。

## 5. 出生序與星位穩定契約

### 5.1 既有節點

- 所有既有 `star_nodes.node_id`、`kind`、`ref`、`seq` 原樣保留。
- 課文星先把當前 `site/data/manifest.json` 的冊別與篇序寫入 `star_node_layout`。
- 詞星先用 v1 的精確規則 `MIN(submission_words.id)` 凍結 `anchor_lesson_id`；之後新來源即使時間更早，
  也不得改 anchor。
- 舊星在 v2 的 `(x,y,z)` 必須逐顆與 v1 fixture 相等；任何位移都阻擋發布。

### 5.2 新節點

- 課文星：沿用冊別、教材篇序的黃金角螺旋；輸入一出生就凍結。
- 詞星：錨定「第一個被納入投影的合格來源課文」；同一批 backfill 以
  `(source_occurred_at, origin_type 固定順位, origin_key)` 排序選第一個；再沿用 `FNV-1a(word_norm)` 偏移。
- 印記：錨定其課文星，以 `FNV-1a(node_id)` 決定角度、高度和固定 68..96 的外圈半徑；不參與
  `wordPos()`，避免與詞星混淆。
- backfill 的新 `seq` 從每名學生現有 `MAX(seq)+1` 起，按
  `(source_occurred_at, origin_type 固定順位, origin_key, node_id)` 排序追加。線上新事件仍按 transaction
  的出生次序追加。不得重排既有 seq。

因此 v2 對舊星的承諾是：**位置不變、ID 不變、出生序不變**。允許的變化只有新增節點、線和因新增真實
來源造成的可解釋亮度變化。

## 6. 連線

| 線型 | 兩端 | 真實依據 |
| --- | --- | --- |
| `hub` | 冊別 → 課文 | 課文的凍結冊別/篇序 |
| `record` | 課文 → 學習印記 | 印記對應的唯一來源列 |
| `use` | 課文 → 詞 | `star_node_origins` 中該課、該詞的合格來源 |
| `group:<key>` | 詞 → 詞 | 既有 `word_groups`；該學生兩詞均有合格來源 |

一條課→詞線只要至少一個 origin 存在；API metadata 另回 aggregate-only `originTypes`，不為同一詞的多條
來源重複畫平行線。刪除/失效來源只改投影的 active 可見集合；來源本身保留稽核。

## 7. 亮度（服務端計算）

所有輸入均由當前學生的合格來源列聚合；公式常數寫死在 rules v2 並由測試固定。

### 課文星

```text
c = 1
  + 0.5 * log2(1 + threeWordVersionCount)
  + threeWordScoreBonus
  + 1.0 * vocabMasteryRatio
  + 0.25 * I(readAcknowledged)
  + 0.25 * I(firstReadSubmitted)
  + 0.25 * I(studyGuideCompleted)
  + 0.15 * I(evaluation)
```

- `threeWordScoreBonus` 沿用 v1：最佳權威評議分 ≥80 加 0.5，≥60 加 0.25，否則 0。
- `vocabMasteryRatio = currentBankMastered/currentBankTotal`；無 current bank 時為 0，不用舊題或全站均值。
- 四個 indicator 只看是否至少有一行合格來源；大量 trace 不可把一顆課文星無限增亮。
- `evaluation` 權重僅代表留下反思，不代表答對或能力。

### 詞星

沿用 v1：

```text
c = 0.6 + 0.5 * log2(1 + distinctLessonCount) + 0.2 * I(hasVisibleGroupPeer)
```

`distinctLessonCount` 是 `star_node_origins` 中此詞的不同 `lesson_id`，不按同課重複來源加亮。

### 學習印記

印記採類別固定亮度，避免把自報、trace 和答題混成單一能力分：三詞 0.90、通讀 0.70、初讀 0.80、
學案 0.80、字詞掌握 0.85、評價 0.65。卡片必須直接顯示其類型和來源時間，不顯示百分比。

## 8. 冊別樞紐與 UI 文案

`HUB_LIT_MIN=3` 保留；`stats.volumes[blockId]` 改為「該冊中至少有一條合格耐久學習來源的不同課文數」。
UI 必須寫「本冊已有 N 篇留下可追溯學習記錄」，不能再寫「有現行三詞」。

空態改為：

> 回到任何一篇課文，完成通讀、無注疏初讀、學案、字詞掌握、評價或三詞記錄；星圖只顯示已保存的真實學習足跡。

古文空態不得引導不存在的三詞欄位。課文卡片分列來源計數，不把缺失來源顯示為 0% 能力。

## 9. API 與健康契約

`GET /api/reading/constellation` 保持既有外框，新增：

- `nodes[].kind='record'`；所有節點 metadata 含 aggregate-only `originTypes`。
- `stats.records`、`stats.volumes` 新語義和 `rulesVersion='constellation-rules-v2'`。
- 不回任何來源原文、學生識別或 raw payload。

`GET /api/reading/health` 必須在所有環境回純數字：

```json
{
  "ok": true,
  "schemaVersion": "reading-schema-v7",
  "rulesVersion": "constellation-rules-v2",
  "students": 0,
  "submissions": 0,
  "activeSubmissions": 0,
  "submissionWords": 0,
  "starNodes": 0,
  "starNodeOrigins": 0,
  "unmappedOrigins": 0
}
```

只回 aggregate counts。新增 `verify:reading:live` 在 release gate 輸出 `starNodes`/`unmappedOrigins` 警告；
開學初 `starNodes=0` 不 fail closed，但 `ok!=true`、schema/rules 不符、欄位非整數或 `unmappedOrigins>0`
必須清楚失敗。

## 10. 三個獨立 bug 的批准後驗收

本節是實作規格，不代表本稿已修改程式。

1. **必修 local 三詞**：`contextWords` local 分支先保留既有 local progress，再呼叫
   `saveReadingSubmission(input, "", requestLessonId)`。`getAuthoritativeLessonMeta()` 以
   `site/data/manifest.json` 查課文，因此批准後需用一篇必修 fixture 證明非 null。不得新增 A+ interaction/outbox。
2. **失敗可見與補送**：每個非 2xx 將安全的 `{status, code}` 寫入
   `progress.context.readingSubmissionError`，`[data-auto-status="contextWords"]` 顯示「未同步到星圖」；
   `silent` 只壓 toast。課文載入時對已存在的三詞補送一次，依 `content_hash` 冪等。
3. **health 漂移**：按 §9 補回 aggregate counts，更新 v1 文件的失實契約，新增 live warning。

## 11. 批准後實作與發布門

1. 重讀生產 aggregate counts；匯出 `yuwen-reading-db` 到受控 backup，記錄 hash/readback。
2. 在 preview D1 套用 additive migration；生成來源→origin dry-run 清單，只輸出各類計數和 unmapped 數。
3. 凍結全部既有節點 layout；斷言 v1/v2 的舊節點位置逐顆相等。
4. 用 synthetic fixture 覆蓋六種 lesson origin、三種 word origin、record nodes、跨課合詞、長標記拒絕、
   題庫無法映射拒絕、backfill 冪等和 no-write-on-GET。
5. 先跑一名合成學生 preview backfill，再跑一名站長指定真實帳號 canary；未另行批准不得全量 backfill。
6. `npm run precontent:check`、`npm run test:reading`、artifact manifest、真實瀏覽器三模式和 rollback
   演練全綠後，才可提交生產發布批准。

## 12. 回滾

- 程式：恢復上一個已驗證 Pages deployment。
- D1：additive 新表保留；舊 Worker 不讀取即可。不得 DROP 新表作為回滾。
- backfill：來源表從未改寫；若 v2 投影有錯，先回滾程式並停止投影生成。任何投影修正都以新 migration/
  任務處理，不能借「重來」刪來源資料。

## 13. 站長待決議

- 是否批准新增「學習印記」節點種類及本文的固定亮度常數。
- 是否批准 additive `star_node_origins` / `star_node_layout` 投影模型。
- 是否批准按 §11 進入 preview 實作；批准設計不等於批准真實帳號 canary、全量 backfill 或生產發布。
