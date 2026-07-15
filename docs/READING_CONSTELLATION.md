# 閱讀星圖：數據模型、生成規則與 API 契約

適用站點：`yw.bdfz.net`（Cloudflare Pages 項目 `yuwen-course`）。
星圖頁：`/star.html`；渲染與交互代碼直接復刻 `xt.bdfz.net`（`CF/jc-atlas/public/assets/app.js` 的
Canvas 2D marble 語言：平塗石子＋深色描邊、透視投影、拖動/雙指/滾輪、脈絡高亮、挂鐘錨定生長動畫）。
本文檔是星圖規則的單一事實源：**每顆星、每條線、每分亮度都必須能回溯到本文檔中的一條規則與一行真實數據。**

## 1. 存儲

D1 數據庫：`yuwen-reading-db`（id `99c541e7-e70b-4584-b939-7e88a6dd68c5`），綁定名 `READING_DB`，
遷移目錄 `migrations/`（wrangler.toml 已配）。

| 表 | 作用 |
| --- | --- |
| `students` | UC slug ↔ 本站學生 id；顯示名、班級（暫空）、首末見時間 |
| `submissions` | 三詞提交：每生每課多版本，`is_active` 唯一現行版；`content_hash` 冪等鍵 |
| `submission_words` | 提交拆詞（保序 1..3）：原詞、規範詞、語義簇 key |
| `word_groups` | 人工精編近義簇種子（0002 遷移，40 簇） |
| `agg_word_freq` | 增量詞頻聚合，五個尺度：student / lesson / class / block / site |
| `star_nodes` | 星點註冊表：`(student_id, node_id)` 主鍵，`seq` 出生序（只增不改） |
| `vocab_attempts` / `vocab_mastery` | 字詞題作答流水與掌握狀態 |

## 2. 身分鏈（與全站用戶體系同步）

`bdfz_uc_session` cookie（域 `.bdfz.net`）→ Pages Worker 服務端轉發
`https://my.bdfz.net/api/me` 核驗 → `students.uc_slug`。前端自報身分一律不信；
identity 緩存 5 分鐘。未登入請求一律 `401 {authRequired:true}`，前端顯示克制的空態，不偽造任何星點。

測試縫：本地 `wrangler pages dev` 可設 `--binding READING_TEST_SLUG=synthetic-tester`，
合成數據與真實數據走**完全相同**的寫入/聚合/讀取代碼路徑；生產項目嚴禁配置此變量。

## 3. 寫入規則（防重複、可追溯）

1. 僅接受恰好三個互異的詞（規範化後判互異）；規範化 = NFKC → 去標點空白 → 常用繁→簡折算 → ≤12 字。
2. `content_hash = sha256(lesson_id + "\n" + sort(words_norm))`：同詞重排、繁簡變體、刷新重發都命中
   `(student_id, lesson_id, content_hash)` 唯一索引 → 返回 `deduped:true`，不產生新記錄。
3. 換新三詞 = 新版本（version+1），舊版本 `is_active=0` 進入沿革；重提舊版三詞 = 該版重新轉正，不新增行。
4. 詞頻聚合為**累計制**（只增不減，含歷史版本），五尺度同步 +1；語義簇 key 寫入時由 `word_groups` 查定。
5. AI 評議分（`interaction-check` 的 contextWords 得分）隨提交記錄，僅作亮度加成，不決定星點存在。

## 4. 星點與連線規則（可測試）

節點 id 穩定：課文星 `lesson:<lessonId>`，詞星 `word:<word_norm>`（詞星跨課合併——同一個詞在多課出現
只有一顆星，多條課→詞連線，這就是「重複出現 → 連接更強、星更亮」的實現）。
`star_nodes.seq` 出生即領取、永不回收重排；前端生長動畫按 seq 順序重放真實閱讀路徑。

**星位穩定契約**：佈局只由穩定輸入推導，與提交次序無關——
冊別樞紐：五冊固定圓環（半徑 430）；課文星：`(冊別, 教材篇序)` 黃金角螺旋；
詞星：錨定「該詞最早出現的課文」（`MIN(submission_words.id)`，一經產生永不改變）＋詞形 FNV 哈希偏移。
新增星點不移動任何舊星。

連線三類：`use`（課→詞，現行版三詞）、`hub`（冊→課）、`group:<key>`（同語義簇詞星間，虛線；
僅當簇內 ≥2 個成員在該生星空中同時存在時出現——即「解鎖附加結構」）。

**亮度公式（服務端計算，constellation-rules-v1）**：
- 課文星 `c = 1 + 0.5·log2(1+版本數) + 評議分加成(≥80:+0.5 / ≥60:+0.25) + 1.5·(字詞題已掌握/該課題數)`
- 詞星 `c = 0.6 + 0.5·log2(1+出現課數) + (有同簇夥伴 ? 0.2 : 0)`
- 冊別樞紐解鎖：該冊 ≥3 篇有現行三詞 → `c` 由 1.15 升至 2.1（HUB_LIT_MIN=3）。

**空態**：無任何提交時只顯示五冊骨架＋引導文案；未登入顯示登入引導。不顯示任何虛構星點、
不推斷興趣、不偽造進度。

## 5. API 契約（均在 `site/_worker.js`，前綴 `/api/reading/`）

| 端點 | 方法 | 鑒權 | 說明 |
| --- | --- | --- | --- |
| `/health` | GET | 無 | `{ok, students, submissions, nodes, rulesVersion}`，健康探針 |
| `/submission` | POST | UC | `{lessonId, words[3], aiScore?, aiVerdict?}` → `{ok, deduped, version, born[]}` |
| `/constellation` | GET | UC | 全量星圖：`nodes[]`（id/kind/seq/c/meta）、`links[]`、`stats`、`groupLabels` |
| `/lesson/<id>` | GET | UC | 該課三詞沿革（全版本）、字詞掌握、課級高頻詞 |
| `/history` | GET | UC | 最近 200 條提交流水 |
| `/vocab-attempt` | POST | UC | `{lessonId, itemId, correct, answer}` → 掌握狀態（首答對即 mastered，否則兩次答對） |
| `/vocab-state/<id>` | GET | UC | 該課逐題掌握狀態 |

前端寫入點：`app.js` 的 contextWords 評議成功後 `saveReadingSubmission()`；
字詞題每次作答 `recordVocabAttempt()`。均 fire-and-forget，未登入時僅保留本地進度。
User Center 側繼續走既有 `identity.syncProgress / recordEvent`（`vocab-quiz:<lessonId>` 完課事件），
供 my.bdfz.net 統一活動數據使用。

## 6. 遷移與回滾

- 應用遷移：`source ~/.secrets.env && ./node_modules/.bin/wrangler d1 migrations apply yuwen-reading-db --remote`
  （本地開發用 `--local`）。遷移只增不破壞；新遷移文件按 `000N_名稱.sql` 遞增。
- 回滾代碼：Pages deployment history 重發上一個已驗證 production（見 docs/VERIFICATION.md §7）。
  D1 數據無需回滾——舊 Worker 不識別的新表可以留存；**禁止 DROP TABLE 作為回滾手段**。
- 備份：`wrangler d1 export yuwen-reading-db --remote --output backups/yuwen-reading-<date>.sql`
  （學生提交是不可再生數據，發佈重大變更前先導出）。

## 7. 驗證

- 合成數據鏈路：本地起 `wrangler pages dev site --binding READING_TEST_SLUG=synthetic-tester`，
  跑 `node scripts/test_reading_api.mjs`（提交/去重/版本/星圖/字詞全鏈路斷言）。
- 真實數據鏈路與合成完全同代碼路徑（僅身分核驗來源不同），上線後以真實帳號在課文提交三詞 →
  `star.html` 應長出對應星點。
- 生產探針：`curl -fsS https://yw.bdfz.net/api/reading/health | jq -e '.ok == true'`。
