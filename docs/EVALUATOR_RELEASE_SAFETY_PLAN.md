# YW evaluator 發布安全方案（設計稿；未授權執行）

本文件記錄已選定的方案 A 設計邊界、被保留的替代方案、D1 Time Travel 待授權命令，
以及 classical／非 classical 雙側驗收計畫。它不選定上限數值，不實作 schema/runtime，
不取得 bookmark，不 restore、不合併、不部署。

## 1. 不可變條件

任何方案都必須同時滿足：

1. evaluator call budget 與 8 次／10 分鐘 learner capacity 分離；上游失敗不消耗
   學生的 committed attempt／learner slot。
2. 每次對 APIS 發出 `feedback` 前先原子取得 evaluator-call reservation；取得失敗、
   budget store 不可用或身份不完整時 fail closed，不呼叫 APIS。
3. evaluator failure 可把 learner reservation 轉為短 cooldown；evaluator-call 計數
   本身不得隨 cooldown DELETE 回落。
4. budget 用盡只回結構化 503＋`Retry-After`，不寫 interaction／evaluation／outbox，
   不返回 `evaluator_retry_exhausted` 429，也不把失敗算成學生作答。
5. idempotent replay 已有 committed evidence 時不新增 evaluator call；同一 in-flight
   mutation 不得因併發重複取得兩個 call reservation。
6. 目標值、窗口與維度須經壓測和獨立審核後由 suen 批准；本文不把建議當批准值。

## 2. 設計選項

| 選項 | 核心做法 | 優點 | 主要風險／授權 |
|---|---|---|---|
| **A — YW D1 雙維 append-only call ledger（已批准設計方向）** | 新表按 `student_id + window` 記全域 call slot，並按 `student_id + client_mutation_id + window` 記 mutation slot；每次 APIS call 前 INSERT，失敗行永久留在該窗口計數，窗口外才不再計入新呼叫 | 身份在 YW 已可信；不需把學生身份傳給 APIS；可與 learner slot 明確分表；影響面最窄 | 新 migration／runtime data write；需獨立 change id、D1 Time Travel、併發證明與整體狀態機複核。上限、retention 與受管制清理方案均 TBD |
| B — YW identity-scoped Durable Object gate | 以不可逆 pseudonymous student key 定位 DO，DO 原子維護 global＋mutation budget；D1 只保存學習證據 | 原子序列天然，避免 MAX+1 競爭；可把短期 budget 與長期學習資料分開 | 新 binding／新能力／成本與恢復面；仍須持久性、逐出、故障 fail-closed 證明；獨立 YW change id |
| C — APIS identity-aware outer gate | APIS 在 project＋task＋path 外新增經簽名 caller-subject 維度，作共享外層保護 | 可防單一 caller 壓垮 YW project bucket，也能成為共享一致能力 | APIS 約 28 站扇出；身份／隱私與 spoofing contract 複雜；必須獨立 change id、全 fan-out、App 回歸，不能夾帶 `7256098` |

2026-08-24 操作者已批准 **方案 A** 作下一個獨立 change id 的設計方向；B、C 只保留為
已比較但未選的替代方案。C 即使日後另作共享外層能力，也不能取代來源站自己的
fail-closed 身份 budget。方案選定不等於批准 migration、實作、數值、Time Travel、
PR／合併或部署；本文件不批准任一上限值。

### 選項 A 的最小資料不變量（供審閱，非 migration）

- call row 不存原始作答，只存 opaque call id、student id、mutation digest、resource key、
  window、slot、created_at 及 outcome class；不得存 APIS prompt／response。
- `UNIQUE(student_id, window_start, global_call_slot_no)` 防全域競爭；
  `UNIQUE(student_id, mutation_digest, window_start, mutation_call_slot_no)` 防單 mutation
  無界重試；call reservation 建立後不可 DELETE 來回收容量。
- success／failure outcome 可以後補，但計數以 reservation row 存在為準；outcome 更新失敗
  不能讓 budget 回落。
- 舊窗口 row 的 retention／清理不能與呼叫路徑夾帶；即使日後獲准清理，也只能刪除
  已過審定留存期的歷史 row，不能回收當前窗口容量。
- 既有 `learning_submission_slots` 只管 learner capacity／in-flight lease，不得兼作 call
  budget；`.002Z` DELETE 不得碰新表。

### 方案 A 不是外掛：合併後完整狀態機必須重審

先區分兩種 reservation：方案 A 要求當前窗口不得 DELETE 回收的是**新的
evaluator-call ledger row**；`7256098` 在 15 秒後 DELETE 的是
`learning_submission_slots` 中的 learner／in-flight row。兩者不是同一張表或同一行，
所以方案 A 不應字面刪除 `.002Z` cooldown 機制。

但它們在控制流上直接耦合：`.002Z` learner row 被 DELETE 後，同一
`client_mutation_id` 會重新預約 learner slot，並在下一次 APIS call 前再次取得 call
reservation；此時新的 append-only call row 必須持續計數，且不能因 learner row 的
負 rowid、`MAX(slot_no)+1`、併發 loser 重讀或 idempotent replay 而漏算、重算或錯拒。
因此方案 A 是對同一個**組合預約狀態機**的第二次改動，不得當作互不相干的增量外掛。

實作後，Phase 0 五問必須在**合併後的完整狀態機**上全部重做，而非只審方案 A diff：

1. `.002Z` DELETE 與 call row 不可刪不變量在所有交錯序列下是否同時成立；
2. learner `MAX(slot_no)+1`／負 rowid 與 call-slot 分配是否可能碰撞、漏算或重複取得；
3. 三條 route 的 cooldown／budget-exhausted／budget-store-unavailable mapping 是否完整；
4. 棄置 lease、同 mutation 重試及換 mutation 是否能繞過 per-mutation 或 per-student budget；
5. 任一 DELETE／retention／outcome update 是否可能碰到 interaction、原始作答或當前窗口
   call capacity，以及上線前 D1 bookmark／restore authority 是否充分。

若 rollout gate 仍 BLOCK，主代理複核仍須標
`non-independent, pending independent confirmation`，但被複核對象必須是合併後的完整
learner＋evaluator-call 狀態機。任一 P0 立即停止發布路徑。

## 3. APIS 現值證據邊界

已確認 gate key 的架構粒度是 `project + taskType + path`，無 student／session／mutation。
`80/min`、`6 concurrency` 只來自 2026-06-13 的 v6.5.2 導出，未經現行 v6.7.0
線上確認；該導出的 feedback timeout=12 秒已與 19–28 秒成功回應矛盾。因此本方案不把
80 或 6 當現行發布輸入。

若需要現行數字，應另獲 APIS read-only live export 授權；不得改 APIS 或 Secrets Store。

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

- evaluator-call budget 已選定、實作、獨立審核；D1 bookmark 收據已建立。
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
- 若自然遇到 503，UI 必須保存同一 mutation／答案，依 server `Retry-After` 有界重試並
  恢復；不能刷新修復、不能消耗 learner capacity。若未自然遇到 503，live 收據只能寫
  「未觀測」，故障注入的 cooldown／budget 行為由 pre-deploy executable tests 承擔。
- feedback p95 `<45s` 需要另行批准的有界樣本數；兩課 canary 不能被冒充穩態 p95。
- classical 或非 classical 任一側失敗，整體驗收失敗；依故障面選 Pages rollback 或
  D1 事故流程，不得把另一側成功寫成通過。

## 6. 本稿未授權的動作

未實作 evaluator budget、未新增 migration、未執行 Time Travel info／restore、未跑 env
E2E、未 accept／merge／deploy、未改 UC／APIS／D1／Queue、未操作 Secrets Store。
