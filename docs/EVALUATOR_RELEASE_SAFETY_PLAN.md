# YW evaluator 發布安全方案（設計稿；未授權執行）

本文件記錄已選定但暫停實作的方案 A、已批准的 evaluator-call 上限、APIS 入場平滑
前置契約、被保留的替代方案、D1 Time Travel 待授權命令，以及 classical／非 classical
雙側驗收計畫。它不實作 schema/runtime，不取得 bookmark，不 restore、不合併、不部署。

## 1. 不可變條件

任何方案都必須同時滿足：

1. evaluator call budget 與 8 次／10 分鐘 learner capacity 分離；上游失敗不消耗
   學生的 committed attempt／learner slot。
2. 每次對 APIS 發出 `feedback` 前先原子取得 evaluator-call capacity hold；取得失敗、
   budget store 不可用或身份不完整時 fail closed，不呼叫 APIS。
3. 已被 APIS gate 接納的真實評閱呼叫，不論成功、評閱失敗或結果不明，都消耗一個
   evaluator-call 名額；已被**可靠辨識**為 APIS 入場拒絕的請求不消耗名額、不進
   `.002Z` cooldown，也不算學生作答。
4. evaluator failure 可把 learner reservation 轉為短 cooldown；已消耗的 evaluator-call
   計數不得隨 cooldown DELETE 回落。
5. budget 用盡只回結構化 503＋`Retry-After`，不寫 interaction／evaluation／outbox，
   不返回 `evaluator_retry_exhausted` 429，也不把失敗算成學生作答。
6. idempotent replay 已有 committed evidence 時不新增 evaluator call；同一 in-flight
   mutation 不得因併發重複取得兩個 call reservation。
7. 同一入場等待 mutation 必須重用同一 logical-call row，受 `next_eligible_at`、有界
   退避、單學生 pending-ticket 上限及過期策略約束；不得用換 mutation 或併發重送製造
   無界 APIS gate 探測。
8. suen 已批准：**每學生每 10 分鐘最多 60 次已接納 evaluator call；每 mutation 最多
   4 次**。這是實作常數，不得自行改動；仍須在合併後狀態機上做併發測試與獨立審核。

2026-08-24 的現行 APIS v6.7.0 唯讀導出證實：concurrency gate 拒絕仍沒有機器可讀
disposition。所以上述第 3、7 項目前**不可正確實作**，方案 A 維持 NO-GO。YW 不得以
`"系統繁忙"`、HTTP 429、是否缺少 `Retry-After` 或其他啟發式猜測入場結果。

## 2. 設計選項

| 選項 | 核心做法 | 優點 | 主要風險／授權 |
|---|---|---|---|
| **A — YW D1 雙維 logical-call ledger＋入場平滑（方向已批准；實作暫停）** | 新表按 `student_id + window` 與 `student_id + client_mutation_id + window` 原子控管 60／4；同一 logical call 在 `admission_waiting` 與已接納／結果不明狀態間以 CAS 轉移，APIS 入場拒絕只退避並重用原 row | 身份在 YW 已可信；不需把學生身份傳給 APIS；learner capacity、evaluator budget 與 gateway admission 三者分離；不把滿載直接翻成學生 503 | 新 migration／runtime data write 與新的 admission-wait 控制流；先依 change id `20260824-apis-yw-feedback-admission-v1` 補齊 APIS typed disposition 並完成樞紐扇出審核，才可另獲授權實作；之後仍需 D1 Time Travel、併發／公平性證明及完整狀態機複核。retention 與受管制清理方案仍 TBD |
| B — YW identity-scoped Durable Object gate | 以不可逆 pseudonymous student key 定位 DO，DO 原子維護 global＋mutation budget；D1 只保存學習證據 | 原子序列天然，避免 MAX+1 競爭；可把短期 budget 與長期學習資料分開 | 新 binding／新能力／成本與恢復面；仍須持久性、逐出、故障 fail-closed 證明；獨立 YW change id |
| C — APIS identity-aware outer gate | APIS 在 project＋task＋path 外新增經簽名 caller-subject 維度，作共享外層保護 | 可防單一 caller 壓垮 YW project bucket，也能成為共享一致能力 | 現行凍結扇出 36 個 consumer；身份／隱私與 spoofing contract 複雜；必須獨立 change id、全 fan-out、App 回歸，不能夾帶 `7256098` |

2026-08-24 操作者已批准 **方案 A** 的設計方向；B、C 只保留為已比較但未選的替代
方案。C 即使日後另作共享外層能力，也不能取代來源站自己的 fail-closed 身份 budget。
60／10 分鐘／學生與 4／mutation 已獲批准；但方案 A 依賴 APIS typed disposition，現已
暫停實作。方案選定及數值批准仍不等於批准 migration、實作、Time Travel、PR／合併
或部署。

### 選項 A 的最小資料不變量（供審閱，非 migration）

- call row 不存原始作答，只存 opaque call id、student id、mutation digest、resource key、
  window、slot、admission state、`next_eligible_at`、created_at 及 outcome class；不得存
  APIS prompt／response。本文的 state 名稱是設計語義，不是已批准 migration 欄位名。
- `UNIQUE(student_id, window_start, global_call_slot_no)` 防全域競爭；
  `UNIQUE(student_id, mutation_digest, window_start, mutation_call_slot_no)` 防單 mutation
  無界評閱；同一 logical call 的入場退避只更新原 row，不另 INSERT 新 row。
- budget check 與 capacity hold 必須在同一 D1 transaction 中原子完成。`reserved` 及已接納
  的 success／failure／unknown 都占用 60／4；只有被可靠證明為**尚未進入 evaluator**的
  APIS admission rejection 才能 CAS 為不計數的 `admission_waiting`。transport timeout、
  無法解析的 429、狀態未知或 outcome 更新失敗一律 fail closed，保留計數。
- call row 在當前窗口不可 DELETE。入場拒絕釋放的是該 row 的 budget hold，不是刪 row；
  下一次只可用同一 call id 重新原子取得 hold，避免併發超額。
- 舊窗口 row 的 retention／清理不能與呼叫路徑夾帶；即使日後獲准清理，也只能刪除
  已過審定留存期的歷史 row，不能回收當前窗口容量。
- 既有 `learning_submission_slots` 只管 learner capacity／in-flight lease，不得兼作 call
  budget；`.002Z` DELETE 不得碰新表。

### 已批准上限與推導

- **60 calls／student／10-minute window**：`lesson-1474` 完整流程約 38 個計分提交；按
  約 5% 失敗各重試一次，規劃量約 40 calls／學生／場次，60 提供約 1.5 倍餘裕；5%
  只是小樣本風險假設，不是已證明的穩態故障率。
- **4 calls／mutation／window**：必須嚴格大於舊版的事實上上界 2；4 容許兩次真實瞬時
  故障及其重試，又能終止單一答案的無限評閱迴圈。
- 名額只計 APIS 已接納或接納結果不明的 evaluator attempt。gateway admission rejection
  不計數；但不得用 admission-wait 狀態繞過 60／4，亦不得把任何已開始的上游失敗錯標
  為未接納。

### 送出側平滑：滿載不是評閱失敗

`7256098` 的 cooldown 只處理真正 evaluator failure，不能承擔共享 gateway 入場控制。
方案 A 的送出側必須增加下列行為：

1. `callApisPrompt` 不得再把所有 non-2xx 壓成普通 `Error`；它要保留 HTTP status、
   `Retry-After`、機器錯誤碼及「是否可證明未進 evaluator」的分類。
2. 只有正向匹配已確認 APIS 契約的 admission rejection 才進等待路徑。concurrency 拒絕
   作短、有界、帶 jitter 的 server-side 退避；rate 拒絕遵守 APIS `Retry-After`，不得
   緊密輪詢。仍未接納時，持久化同一 logical-call ticket，只有 ticket 寫入成功才回
   HTTP 202 `learning_evaluator_waiting`＋`retryAfterSeconds`；UI 顯示「等待評閱名額」並
   用同一答案／mutation 自動重試。這是可刷新恢復的 admission-wait ticket；若沒有背景
   consumer，不得在收據中誤稱為自主 FIFO Queue。ticket 寫入失敗則 fail closed 回 503，
   不呼叫 APIS。
3. admission waiting 不寫 interaction／evaluation／outbox、不轉 `.002Z`、不增加 60／4，
   也不得占用 committed learner attempt；client 必須先辨識 202 body code，再進 evidence
   判定，絕不能因 HTTP `ok` 把等待誤標完成。刷新後仍從 server ticket 恢復等待狀態。
4. 同一學生只允許有界數量的 pending tickets；同 mutation 併發 loser 只讀既有 ticket。
   `next_eligible_at` 與 bounded exponential backoff 防止全班同步重試形成 thundering herd。
5. APIS timeout、5xx、空答案、格式錯誤、已接納後的上游 429，以及任何無法可靠分類的
   non-2xx 都是真實或結果不明的 evaluator attempt：消耗 60／4，才可進 15 秒 cooldown。

### 方案 A 不是外掛：合併後完整狀態機必須重審

先區分兩種 reservation：方案 A 要求當前窗口不得 DELETE 回收的是**新的
evaluator-call ledger row**；`7256098` 在 15 秒後 DELETE 的是
`learning_submission_slots` 中的 learner／in-flight row。兩者不是同一張表或同一行，
所以方案 A 不應字面刪除 `.002Z` cooldown 機制。

但它們在控制流上直接耦合：`.002Z` learner row 被 DELETE 後，同一
`client_mutation_id` 會重新預約 learner slot，並在下一次 APIS call 前再次取得 call
reservation；此時先前**已接納**的 call row 必須持續計數，admission-wait retry 則必須
重用原 row，且兩者都不能因 learner row 的負 rowid、`MAX(slot_no)+1`、併發 loser 重讀
或 idempotent replay 而漏算、重算或錯拒。
因此方案 A 是對同一個**組合預約狀態機**的第二次改動，不得當作互不相干的增量外掛。

實作後，Phase 0 五問必須在**合併後的完整狀態機**上全部重做，而非只審方案 A diff：

1. `.002Z` DELETE 與 call row 不可刪不變量在所有交錯序列下是否同時成立；
2. learner `MAX(slot_no)+1`／負 rowid 與 call-slot 分配是否可能碰撞、漏算或重複取得；
3. 三條 route 的 admission-wait／cooldown／budget-exhausted／budget-store-unavailable
   mapping 是否完整，且 UI 在刷新及自動重試後仍保留同一答案與 mutation；
4. 棄置 lease、waiting ticket、同 mutation 重試、換 mutation 及併發重送，是否能繞過
   pending-ticket、per-mutation 或 per-student budget；
5. 任一 DELETE／retention／admission-state／outcome update 是否可能碰到 interaction、
   原始作答或當前窗口 call capacity；結果不明是否始終計數；上線前 D1 bookmark／
   restore authority 是否充分。

若 rollout gate 仍 BLOCK，主代理複核仍須標
`non-independent, pending independent confirmation`，但被複核對象必須是合併後的完整
learner＋evaluator-call 狀態機。任一 P0 立即停止發布路徑。

## 3. APIS 現值、NO-GO 與獨立樞紐變更設計

### 3.1 v6.7.0 唯讀 live authority

2026-08-24T11:37:00Z 的現行唯讀導出保存在
`/Users/ylsuen/CF/reports/worker_exports/2026-08-24/apis/`。health 是 `v6.7.0`／schema
`2026-07-21.v3`；當前 deployment 是 `f87fd4a2-e34b-452c-a8dc-bba7edd63d18`，100% immutable
version 是 `21adf19d-4eb6-478f-bad1-7ea73b486b7a`。現行來源證實：

1. gate key 是 `traffic-gate:v1:<project>|<taskType>|<path>`，無 student／session／
   mutation；`RATE_LIMIT_BY_TASK.feedback = 80`，`CONCURRENCY_LIMIT_BY_TASK.feedback = 6`。
2. `shouldUseOcrQueue()` 仍只接受 `taskType === "ocr"`，白名單仍恰為
   `mx.bdfz.net`、`moxie-functions`。只有 Durable Object gate 的 `concurrency_limit` 才會
   在同一請求內輪詢，預設上限 10 秒、間隔 250ms；YW `feedback` 走不到這條路徑。
3. rate gate 拒絕回 HTTP 429、`retry_after_seconds` 與 `Retry-After`。concurrency gate
   拒絕仍只回 HTTP 429 與 `{ error: "系統繁忙，請稍後再試", task_type }`，沒有 typed
   code 或 retry hint。上游 key pool 失敗也可能浮成 HTTP 429。
4. `REQUEST_TIMEOUT_MS_BY_TASK.feedback = 12000` 也仍是現行值。19–28 秒端到端成功回應
   不證明它失真；12 秒是多 key gateway 路徑中的單次上游嘗試控制，不是已證明的整體
   gateway deadline。舊文件對此欄位的推論在本稿更正。

按成功 p50 `10.194s` 與現行 concurrency 6，理想中位數吞吐約
`6 × 60 / 10.194 ≈ 35.3 calls/min`。30 人 × 34 calls = 1,020 calls 至少約
**28.9 分鐘**；38-call 完整流程是 1,140 calls／約 **32.3 分鐘**；40-call 重試規劃是
1,200 calls／約 **34.0 分鐘**。這是樂觀容量天花板，不是 SLO；短等待只減少瞬時拒絕，
不會提高並發 6 或持續吞吐。

### 3.2 方案 A 的硬門

現行對外契約無法可靠區分 concurrency admission rejection 與其他 HTTP 429；所以
**方案 A 暫停實作**。它的「admission rejection 不計 60／4、不進 `.002Z`」規則必須
以前置 typed disposition 為條件。不得在 YW 比對 `"系統繁忙"`，不得把「429 無
`Retry-After`」當類型，也不得把所有 429 都免計。無法分類的 429 仍須 fail closed，視為
已嘗試或 outcome unknown 並保留計數。

### 3.3 待審 APIS shared-hub change

獨立 change id：**`20260824-apis-yw-feedback-admission-v1`**。本輪只設計，不改 APIS。
若另獲實作授權，範圍嚴格限制為兩項：

1. **typed concurrency disposition（加法相容）**：保留 HTTP 429、既有 `error` 與
   `task_type`，只在 shared traffic gate 的 `concurrency_limit` 分支新增
   `code: "traffic_gate_concurrency_limit"`、`retry_after_seconds: 1`，並加
   `Retry-After: 1` header。rate-limit 與 upstream/key-pool 429 不改形狀，確保 typed code
   只能證明「尚未進 evaluator」。
2. **精確擴充既有有界等待**：保留 OCR 的現行 predicate、白名單及設定語義，只把
   `sourceProject === "yw.bdfz.net" && taskType === "feedback"` 納入
   `admitTrafficGateWithQueue` 的既有 Durable Object concurrency 等待路徑。建議首個
   canary 沿用 **10 秒 wait cap／250ms poll**；不要全域開 feedback queue，不新增 binding、
   secret 或限額調整。10 秒加成功 p95 基線 24.401 秒仍低於 45 秒規劃門檻，但這只是
   canary 預算依據，不是尾部保證。

這個「queue」是請求內的有界 admission polling，不是耐久 FIFO、背景 Queue 或公平排程；
若 gate 不是 Durable Object mode，或 10 秒內仍無槽位，就以 typed concurrency 429
結束。它可削平短 burst，不能解決 6-slot 班級容量，R1-C1 仍保持開放。任何提高 6、改
80、延長全域 timeout 或建立真正 Queue 的提案都是第三個變更面，不能夾帶。

### 3.4 扇出凍結與相容性

2026-08-24 新鮮 Cloudflare settings scan 完成 96／96 Workers，確認 21 個現行
`APIS -> apis` service-binding consumer；再與 2026-08-22 已審定 HTTP／App caller inventory
取聯集，本 change 的凍結扇出是下列 **36 個**：

- 現行 21 個 service bindings：`arena`、`bdfz-curriculum-atlas`、
  `bdfz-curriculum-atlas-preview`、`bdfz-user-center`、`daofa`、`flx`、
  `gaokao-sanwen`、`gaokao-wenyan`、`gaokao-yuyong`、`gks`、`jks-ai`、`learn`、
  `mohen`、`moxie-peer`、`qunxian`、`quote`、`recite`、`recite-gk`、`sy`、
  `yue-auto-mark`、`zhongkao`。
- 已登記的 15 個 HTTP／App callers：`750`、`bdfz-companion`、`chendu-reader`、
  `gaokao`、`gaokao-trend`、`k12media-web`、`lunyu-yizhu-android`、`moxie`、`plato`、
  `shici`、`voice-reader`、`xss`、`yuwen-course`、`zw`、`zw-gemini`。

typed 欄位只加在既有 concurrency 429 body/header；status、舊欄位與成功契約不變，故
忽略未知 JSON 欄位的 caller 相容。仍須對 strict decoder 做契約測試，不能只以理論相容
代替。等待 predicate 只命中 `yw.bdfz.net + feedback`；其他 35 個 caller 的 admission
時序不變，既有 `mx.bdfz.net`／`moxie-functions` OCR 等待也不得漂移。因 APIS 是共享
樞紐，實作時 36 個 consumer 仍須在同步變更收據中逐一標 `updated`、
`verified_no_change`、`blocked` 或 `not_applicable`，並納入 Companion App 代表性回歸。

### 3.5 待授權驗證與回滾

- 單元／契約測試必須證明：rate rejection 未變；gate concurrency 才有 exact typed code
  與 header；upstream 429 無該 code；只有 YW feedback 與既有兩個 OCR 專案等待；其他
  project/task/path 負例立即保持原行為。
- 以 preview／immutable version 先驗 exact response，禁止在 production 造併發洪峰。
  canary 記錄 wait time、poll count、最終 disposition、p95 與拒絕數；10 秒耗盡仍應 typed
  fail closed。若其他 caller schema、OCR queue、APIS health 或 YW 45 秒預算漂移即停止。
- 新版若獲准部署，第一回滾錨是本次 pre-change immutable version
  `21adf19d-4eb6-478f-bad1-7ea73b486b7a`；第二層是
  `eb8d9082-d899-4362-a6c9-c7c43781a61d`。回滾後重讀 APIS health/version、rate／
  concurrency error contract、既有 OCR queue、YW feedback 與代表性 service-binding／
  HTTP／Companion caller。

本設計不授權 APIS source edit、PR、deployment、Secrets Store、binding、limit 或 Queue
變更；也不授權方案 A 的 migration/runtime 實作。

## 4. D1 Time Travel：待授權精確命令

本 worktree 的權威 CLI 是 Wrangler `4.100.0`。其 help 只有：

- `d1 time-travel info <database> [--timestamp] [--json]`：取得指定時點 bookmark；
- `d1 time-travel restore <database> (--bookmark|--timestamp) [--json]`：遠端 restore。

所以不存在「create bookmark」命令。以下全部是**待授權模板，本輪未執行**。

### 4.1 部署前取得 bookmark（read-only，但仍須單獨授權與收據）

```bash
set -a
source /Users/ylsuen/.secrets.env
set +a
cd /private/tmp/yw-evaluator-fix-20260823
./node_modules/.bin/wrangler d1 time-travel info yuwen-reading-db \
  --timestamp <PRE_DEPLOY_RFC3339_UTC> --json
```

收據必須保存：database name/id、請求 timestamp、返回 bookmark、Wrangler 版本、執行 UTC、
候選 final SHA、部署 change id；bookmark 本身不是學生資料，但收據不得含 token。

### 4.2 bookmark 後的只讀基線

只允許 SELECT，至少記錄以下聚合並確認 `rows_written=0`：

```bash
./node_modules/.bin/wrangler d1 execute yuwen-reading-db --remote --json \
  --command "SELECT COUNT(*) AS n FROM students; SELECT COUNT(*) AS n FROM learning_interactions; SELECT COUNT(*) AS n FROM learning_evaluations; SELECT COUNT(*) AS n FROM evidence_outbox; SELECT COUNT(*) AS n FROM learning_submission_slots;"
```

### 4.3 restore（破壞性；只在另有精確事故授權後）

先停止／隔離 YW 學生寫入並再次用 `time-travel info` 取得「restore 前現況」rescue
bookmark；確認事故點、目標 bookmark、資料丟失窗口與 operator 都已簽字，才可：

```bash
set -a
source /Users/ylsuen/.secrets.env
set +a
cd /private/tmp/yw-evaluator-fix-20260823
./node_modules/.bin/wrangler d1 time-travel restore yuwen-reading-db \
  --bookmark <AUTHORIZED_TARGET_BOOKMARK> --json
```

restore 後重跑 4.2、身份／first-read／interaction health readback 與代表性 source-event
關聯檢查；任何不符立即停寫，按另行授權用 rescue bookmark 回復。不得把 Pages rollback
冒充 D1 restore，也不得在沒有寫入隔離時 restore。

## 5. evaluator 版雙側驗收計畫（只寫不跑）

### 5.1 前提

- APIS change `20260824-apis-yw-feedback-admission-v1` 已另行獲准、實作、完成 36-consumer
  扇出收據並 live 證實 typed concurrency disposition；之後 evaluator-call budget 與
  admission smoothing 才可另獲授權實作，並在完整合併狀態機上獨立審核；D1 bookmark
  收據已建立。
- final merged SHA 的 Node 24.18.0、22.21.1 全套與 mobile-atlas 通過。
- 新 YW-only one-use executor 綁定 final SHA、新 change id、新 journal；UC／APIS／Queue
  配置不在該 deploy 內。
- `2471f1e4` 是第一回滾 Pages 錨，`619024c7` 是第二層；舊 journal 不重用。

### 5.2 唯一 env canary：兩課、兩種 mode

env 學生只在新版上線後使用一次，永遠排除 R3：

1. **classical：`lesson-1474`**。依現行模式完成 first read、帶註釋正文、詞級／學案
   prerequisite；同頁進入 `structure` 與 `authorQuestion`。
2. **非 classical：`lesson-1569`《一個消逝了的山村》**。其 taxonomy genre 為
   `lyric-prose`、`mode=modern-prose`，可直接進入既有 round；不用
   `lesson-1458`，因 `speech-letter → argument` 本就合理，不能暴露文體錯位風險。
3. 每課對 `structure`、`authorQuestion` 各提交至少兩輪；第二輪必須接續上一輪追問。
4. 每個 interaction 第一輪後刷新一次；刷新後由 server ledger 恢復 turn，attemptNo
   單調、不重複、不退化為單輪。
5. 每一輪核對 YW `learning_interactions` 原始 payload、`learning_evaluations`、outbox
   identity；不得在回執前把 UI 標成完成。
6. 每課至少一條 eligible `a_plus_gate` 在 UC 形成非空 competency facet、非空
   normalizedValue、非空 `sourceUrl`／`sourcePayloadRef`，並精確回到同一 YW source
   event 原始作答。只輸出脫敏聚合與 receipt hash。
7. `lesson-1569` 每一輪另記錄評語使用的文體技術語，判斷是否把抒情散文錯套為
   「概念界定、論據組織與推理」；該既有 R2 品質缺陷不與 evaluator 故障合併歸因。
8. 本次 canary 的所有行在 R3 查詢中按 env 身份排除；canary 成功只推進 R1／R2，
   不推進 R3。

### 5.3 可靠性判定

- 整個 canary 中 `evaluator_retry_exhausted` 429 必須為 0。
- pre-deploy executable tests 必須模擬 typed concurrency admission rejection：相同 answer／
  mutation 進 `learning_evaluator_waiting`，UI 顯示等待而非失敗，刷新後恢復；不增 60／4、
  不進 `.002Z`、不寫 interaction／evaluation／outbox。模擬 upstream 429 則必須相反：
  視為已嘗試、保留 evaluator 計數並進 cooldown，證明兩種 429 不會混淆。
- 若自然遇到 503，UI 必須保存同一 mutation／答案，依 server `Retry-After` 有界重試並
  恢復；不能刷新修復、不能消耗 learner capacity。若未自然遇到 503，live 收據只能寫
  「未觀測」，故障注入的 cooldown／budget 行為由 pre-deploy executable tests 承擔。
- 若 canary 自然遇到 admission waiting，須記錄 server ticket、退避次數、等待總時長及
  最終同 mutation 成功；未自然遇到時只能由上述可執行測試證明語義，不能宣稱已量到
  班級容量。R1-C1 在另有班級規模容量實測前保持開放。
- feedback p95 `<45s` 需要另行批准的有界樣本數；兩課 canary 不能被冒充穩態 p95。
- classical 或非 classical 任一側失敗，整體驗收失敗；依故障面選 Pages rollback 或
  D1 事故流程，不得把另一側成功寫成通過。

## 6. 本稿未授權的動作

未實作 evaluator budget／admission smoothing、未新增 migration、未執行 Time Travel
info／restore、未跑 env E2E、未 accept／merge／deploy、未改 UC／APIS／D1／Queue、
未操作 Secrets Store。只取得並保存一份 APIS v6.7.0 唯讀 live export；它不是變更授權。
