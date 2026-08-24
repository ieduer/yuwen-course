# YW / User Center — 現有互動可靠性與評價閉環台賬（審閱草案）

> 基線時間：2026-08-24。本文以來源碼、機器契約及 YW／UC D1 的 SELECT-only
> 回讀為準；不把部署、題目覆蓋、點擊、outbox 狀態或測試帳號冒充學習成效。
> 2026-08-24 的 YW evaluator candidate 已在驗收失敗後回滾。當前授權只包含：修正
> academic-year envelope 並提交／推送，以及對 APIS 做唯讀配對取樣與一項待批設計；
> 不包含 APIS 實作、YW PR／合併／部署、accept、D1／UC／Queue 寫入或 env E2E。

## 0. 最終目標

**保持 YW 現有互動模式，讓 `mode=classical` 與非 `classical` 課文的已啟用互動都能
穩定完成，多輪上下文不斷裂，並讓真實學生的計分互動在 My 形成可回指原始作答的
規範化能力評價。**

## 1. 唯一北極星：R1／R2／R3

### R1 — 現有互動可靠性

按 `sourceModeFor(lesson) === "classical"` 與非 `classical` 分列，不以新增課文為進度：

- 硬門檻一：`429 evaluator_retry_exhausted = 0`。
- 硬門檻二：成功 feedback 回應的 p95 `< 45s`；同時單列 transport failure、503
  與逾時，禁止只用成功樣本掩蓋尾部。
- 上游評閱失敗必須 fail closed：不寫假 interaction／evaluation／outbox，不消耗
  learner capacity；短 cooldown 後同一答案可重試，不阻斷學生繼續同一課。
- classical 與非 classical 都要各自有 live 驗收；任一側未驗都不能宣稱 R1 達標。

現值：**未達標**。

| 側別 | 已證實 | 尚未證實／阻斷 |
|---|---|---|
| `mode=classical` | 2026-08-24 候選 live 驗收完成詞級 12/12、學案 15/19；21 次 evaluator call／16 mutations 中沒有 429 `evaluator_retry_exhausted` | 同一第 16 個學案 mutation 連續四次 503，15 秒 cooldown 後仍未恢復；候選已回滾，R1 未達標 |
| 非 `classical` | 補集中的 40 課其正式 `structure`／`authorQuestion` 與 classical 共用 `/api/interaction-check`、APIS feedback、預約、ledger、outbox；其他 mode 亦走同一狀態路徑；`lesson-1488` 有一次非 classical server-route 單輪測試 | 沒有任一非 classical 課的正式雙輪 live 驗收，也沒有分側的生產失敗率 |

既有小樣本只作風險基線：20 次 feedback/medium 中 19 次成功、1 次 transport
failure；p50 `10.194s`、p95 `24.401s`、max `25.908s` 只按成功回應計。另 5 次外部
探測有 1 次超過 40 秒仍無回應。這不等於「503 已解決」，也不是穩態故障率。

#### R1-T1 — feedback 12 秒重試階梯與不變的 YW 45 秒硬線

2026-08-24 v6.7.0 live export 確認 APIS 對 feedback 的每次 Google 嘗試上限為 12 秒，
同一 key 最多 3 次並退避 250ms、500ms；所以單 key 全逾時階梯約為
`3 × 12s + 0.75s = 36.75s`。同一精確 prompt 先前 35.905 秒成功，以及兩次在 50 秒
client deadline 前沒有 response，均與重試／換 key 階梯相容；但公開 response 沒有
per-attempt trace，不能把單次 35.905 秒成功寫成已證明的「第三次嘗試」。10+10
feedback／chat 唯讀配對取樣及其限制另見 APIS change
`20260824-apis-feedback-timeout-30s-v1`。

該 exact-prompt、medium-thinking 配對實測為：feedback 0/10 成功、10/10 在 60 秒 client
deadline 前無 response；chat 5/10 成功，另 4 次 60 秒 deadline、1 次 25.894 秒
`fetch failed`。chat 成功 p50 51.751 秒、max 57.080 秒，五次都超過 YW 45 秒。這支持
feedback 的 task-specific timeout／admission 組合是主因，但 chat 與 feedback 使用不同
traffic gate（concurrency 10 vs 6），所以不能把差異全歸因於 12 秒，也不能把 30 秒寫
成已驗收值。

待批 APIS 提案只把 `REQUEST_TIMEOUT_MS_BY_TASK.feedback` 從 12000 調為 30000，目的是
讓實測 12–30 秒內的真實成功在第一次嘗試返回，減少重複上游 call 與典型 tail；它也
會把真正全逾時時的單 key 最壞階梯增至約 90.75 秒，因此必須 canary、測 tail 並可立即
回滾。**YW 的 `APIS_FEEDBACK_TIMEOUT_MS=45_000` 保持不變；不得放寬到 60／75 秒。**
放寬葉子 deadline 只會掩蓋 gateway retry amplification，並讓學生等待超過一分鐘，
不構成根因修復。

#### R1-C1 — APIS shared feedback admission saturation（backlog；不阻斷本次發布）

YW 全部 feedback 依 `traffic-gate:v1:<project>|<taskType>|<path>` 共用一道 APIS gate，
無 student／session／mutation 維度。2026-08-24 的 v6.7.0 唯讀 live export 已確認現值
仍是 `80/min` 與 `6 concurrency`。YW feedback 不在既有等待白名單；滿載時立即回通用
429。現行 `REQUEST_TIMEOUT_MS_BY_TASK.feedback=12000` 是單次上游嘗試控制，不是整個
gateway deadline；19–28 秒端到端成功回應不能證明它失真。

按現值 6 與成功 p50 `10.194s` 估算，理想天花板約 `35.3 calls/min`：30 人各 34 calls
的 1,020 calls 至少約 28.9 分鐘；38 calls 完整流程約 32.3 分鐘；按 40 calls 重試規劃
則約 34.0 分鐘。這是 p50 推算的樂觀上限，不是班級 SLO。獨立 APIS change
`20260824-apis-yw-feedback-admission-v1` 可另案補 typed concurrency disposition，並把
精確的 `yw.bdfz.net + feedback` 納入既有 10 秒／250ms 有界等待。這可削平短 burst，但
不提高並發 6。操作者已裁決學生不會全班同時操作，故此項不在本次關鍵路徑；仍不得在
沒有容量實測時宣稱「班級規模達標」，本輪也不改 APIS。

### R2 — 多輪對話正確性

達標條件：在一課 current-formal classical 與一課 current-formal 非 classical 上，
`structure`、`authorQuestion` 各連續至少兩輪；server-owned attempt 單調增加，下一輪
prompt 接續上一輪，刷新後對話仍由來源 ledger 恢復，且不退化為一次性聊天。

現值：**classical live 在進入多輪前被持續 503 阻斷；非 classical 未驗，整體未達標**。

- `lesson-1474` 的來源測試已讓 `structure` 與 `authorQuestion` 各走兩輪真實 Worker
  route，驗證第二輪 prompt 帶入第一輪學生輸入與追問；idempotent replay 不新增 APIS
  呼叫或 turn。
- server 以 `student_id + resource_key + interaction_key` 回讀最近 6 輪；prompt 使用
  最近 4 輪。瀏覽器合併按 `sourceEventId`／`attemptNo` 去重、單調排序並保留最近 6 輪。
- `mode` 只改變章法 technique 與作者／文本細讀教練語義；不改 route、reservation、
  conversation ledger、evidence/outbox 或錯誤映射。
- 尚無非 classical 正式雙輪 route 測試、刷新驗收或 UC 下鑽驗收；因此不得把共用
  程式路徑等同於該側已通過。
- 2026-08-24 唯一 live 驗收在 lesson-1474 學案 15/19 後失敗並回滾，故沒有生成
  classical 或非 classical 的雙輪／刷新證據；lesson-1569 未被執行。

#### R2-Q1 — `modern-prose` 被歸一化為 `argument`（既有品質缺陷）

`normalizeBlueprintMode()` 在現行線上來源 `fa93ca8` 已把 `speech-letter` 與
`modern-prose` 映射為 `argument`，未知 mode 也 fallback 到 `argument`；
`fa93ca8..7256098` 對 `site/lesson-blueprint-rules.js` 零差異，所以這不是 evaluator
修復引入的回歸。今天線上的 6 個 current-formal `modern-prose` 課已被送入
「概念界定、論據組織與推理」技術語的評閱 prompt。prompt 同時仍帶原始 genre，故已
證實的是文體訊號衝突與判錯風險，不是在未實測前宣稱每次輸出必然錯誤。

此項獨立掛為 **R2-Q1 既有品質缺陷**，不併入 evaluator 發布 change id，也不阻斷該
修復本身；但非 classical 驗收必須明確記錄評語是否出現論證文／抒情散文錯位。任何
映射修正都屬另一個 runtime／教學 contract 變更，須另行授權。

### R3 — 真實學生計分事件與 UC 合格評價

R3 同時報兩個分子，測試帳號與 env 學生永遠排除：

1. YW source ledger 中真實學生產生的 `a_plus_gate`／`formative` 計分事件數；
2. 其中在 UC 同時具備非空 competency facet、非空 `normalizedValue`，並可用
   `sourceUrl + sourcePayloadRef` 回到同一 YW source event 原始作答的合格評價數。

2026-08-24 SELECT-only 即時基線：**0 個計分事件／0 個 UC 合格評價**，覆蓋 0 課、
0 名真實學生。這是實測零值，不是 measurement blocked。

排除口徑：從 `/Users/ylsuen/.secrets.env` 取得 1 個 env 學生鍵與 5 個測試帳號鍵；
5 個鍵經 UC `seiue_accounts.email` 映射為 UC user id，查詢同時按 UC id 與直接 YW
帳號鍵排除。查詢只輸出聚合值，不輸出帳號、ID 或原始作答。

#### 48 條真實學生舊事件的精確分布

YW 的 48 條 v1 outbox 行與 UC 的同一批 48 條 evidence 完全一致；它們只落在
19 個註冊定義中 `scoringRole=none` 的 5 種，而不是 11 種 non-scoring 定義全都有：

| interactionKey | event_type | scoring_role | eligibility | 行 | 課 | 學生 | normalized 非空 |
|---|---|---|---|---:|---:|---:|---:|
| `lessonOpened` | `lesson_opened` | `none` | `non_scoring` | 20 | 3 | 2 | 0 |
| `noteOpened` | `note_opened` | `none` | `non_scoring` | 19 | 1 | 1 | 0 |
| `readAcknowledged` | `text_read_acknowledged` | `none` | `non_scoring` | 6 | 1 | 1 | 0 |
| `initialReadingSubmitted` | `initial_reading_submitted` | `none` | `non_scoring` | 2 | 2 | 1 | 0 |
| `chatOpened` | `chat_opened` | `none` | `non_scoring` | 1 | 1 | 1 | 0 |
| **合計** |  |  |  | **48** | **3** | **2** | **0** |

UC 中只有兩條 `initialReadingSubmitted` 帶 competency facet；其 normalizedValue 仍為
空，所以仍不是合格評價。註冊表中能形成計分事件的是 6 個 `a_plus_gate` 與 2 個
`formative` 定義；真實學生目前一條也沒有完成並落入 source ledger。

已證實的因果只到這一步：**現有 48 條 trace／participation 事件在契約上不能增加
R3；R3 只能由 8 個計分定義的實際完成產生。** 資料沒有記錄學生是否曾嘗試但在寫入
前失敗，因此「0 完全由學案 evaluator 故障造成」不是這 48 條資料本身能證明的結論。
舊 env E2E 確曾重現 classical 學案卡住與後續鎖未解，但該帳號被 R3 排除。

#### R3 的工程邊界

R3 永遠排除 env／測試帳號，因此發布驗收無論成功與否都不增加 R3 分子。工程交付的
直接終點是以測試身份證實三段均可用：YW source ledger 落庫、投遞／UC projection、
`sourceUrl + sourcePayloadRef` 下鑽。只有三段已通過後，真實學生仍沒有新計分事件時，
後續增量才主要取決於真實課堂使用；在此之前，落庫、投遞或下鑽故障仍是工程責任。
不得用 env canary 冒充 R3，也不得為了「推分子」製造測試或追溯性評價。

2026-08-24 env canary 的工程讀回同樣未閉環：YW 保存了 12 條
`a_plus_gate` 與 15 條 `formative`，27 條 normalized value 非空；UC 卻把同期 28
條 envelope 全部以 `academic_year_invalid` 隔離，新增合格評價為 0。這些 env 行永遠
不增加 R3 真實學生分子，但此結果證明工程側的投遞／評價門仍未通過，不能轉稱為純課堂
使用問題。

根因已定位為 YW 曾按 `occurredAt` 的上海月份推算 academic year：8 月產出
`2025-2026`，而同一 compatibility contract 的 active policy 明確要求 `2026-2027`。
來源修正 `7f401d7` 已刪除日期 fallback，改為只使用通過完整 contract 驗證的
`academicYearPolicy.academicYear`；政策缺失或版本錯配直接 fail closed。Node 24.18.0
與 22.21.1 的 focused evidence-contract 測試各 69/69，但此 commit 尚未 PR／合併／部署，
故 live R3 與工程鏈路狀態仍未改變。

## 2. 現有互動機器契約

完整的 40 課清單、round 與驗證狀態見
[`docs/INTERACTION_RELIABILITY_MATRIX.md`](INTERACTION_RELIABILITY_MATRIX.md)。核心裁決：

- 40 個非古詩文、非學習活動的 current-formal 課都發布了 `structure` 與
  `authorQuestion`，兩者都走同一 `/api/interaction-check` 和同一多輪 ledger。
- 前端 `classicalRoundLocked` 只對 `mode=classical` 生效；這 40 課的多輪 round
  直接開放，不是「因沒有 classical 學案而永遠解不開」。
- `poetry` 有詞級疏通資格，但不受 classical 解鎖鏈約束。依 2026-08-24 操作者
  「保持 YW 現有互動模式」的指示，本輪把它列為需保留的現行 contract：詞級疏通是
  可用 round，不是 `structure`／`authorQuestion` prerequisite；不自行改 runtime。
- 共用程式路徑只能降低差異風險，不能代替雙側 live 驗收。

## 3. G3a — v1 孤兒回執帳務收口（與 R3 分開）

48 條事件早已在 UC 落庫；consumer 沒有一週中斷。它們仍停在 YW
`delivery_status=enqueued`、`central_disposition IS NULL`，是因現行 retry／reconcile
SQL 只選 v2 schema＋`yw-aplus-e310-v2`，v1 行永遠選不中。

G3a 是需另行授權的歷史回執／可觀測性 P1：應精確收口帳務，禁止 Queue 盲重放，也
禁止把舊 trace 事後改寫為 scoring。它**不是 R3 分子的生成路徑，也不是 evaluator
發布的技術依賴**；即使 48 條全部補上 receipt，R3 仍是 0／0。

## 4. 發布安全控制

### G2 — evaluator-call budget

`7256098` 讓 evaluator failure 不再消耗 learner capacity，卻同時移除了舊版每
mutation／窗口約兩次的事實上呼叫上界。APIS gate 以
`project + taskType + path` 聚合，沒有 student／session／mutation 維度；因此修復版
在另有 fail-closed、與 learner capacity 分離的 evaluator-call budget 前不得發布。

方案 A（YW D1 獨立 evaluator-call ledger）已按最新授權實作。不可變條件、完整狀態機
複核與歷史 APIS 設計沿革見
[`docs/EVALUATOR_RELEASE_SAFETY_PLAN.md`](EVALUATOR_RELEASE_SAFETY_PLAN.md)。任何 APIS
身份粒度新能力都屬共享樞紐變更，必須使用獨立 change id；不得夾帶進 `7256098`。
常數為每學生每 10 分鐘 60 次、每 mutation 4 次。採保守計數：成功、逾時、5xx、無效
JSON、gateway 429 與 outcome unknown 全部在 APIS 前 append 並不退款；因此不依賴 typed
disposition 或 admission smoothing，也禁止按 HTTP／header／中文字串猜測 gateway 類型。
額度滿或 D1／可信身份不可用時不呼叫 APIS，回結構化 503＋`Retry-After`，不消耗正數
learner slot，也不寫 interaction／evaluation／outbox。完整狀態機 Phase 0 結論為無 P0，
標籤 `non-independent, pending independent confirmation`。

### D1 runtime DELETE 與 Time Travel

`.002Z` cooldown 的 runtime DELETE 是受管制 D1 data mutation，雖不含學生原始作答
且有 `source_event_id + created_at + LIKE + NOT EXISTS interaction` 守衛，上線前仍須
取得 D1 備份／還原授權。Wrangler 4.100.0 沒有「create bookmark」子命令；本輪已用
`d1 time-travel info` 取得 `2026-08-24T12:21:39Z` pre-migration bookmark，隨後成功套用
additive migration 0006。新表與兩個索引存在、row count 0，既有五項聚合不變；restore
命令已記錄但未執行，只有事故授權、寫入隔離與 rescue bookmark 後才可使用。

## 5. A／B 覆蓋率只保留為背景

以下數字描述既有資料覆蓋，**不是北極星、不是本輪目標，也不觸發內容編寫**：

| 舊口徑 | 2026-08-24 基線 | 本輪用途 |
|---|---:|---|
| A：古詩文四階全備 | 16 / 67 | 背景風險分層，不作進度分子 |
| B：原稱「現當代 runtime bucket」四階全備 | 0 / 67 | 背景；該桶是機器補集，不是年代學分類 |
| 學習活動 | 55 項 | 不進 A/B，也不影響 R1/R2/R3 |

物理 lesson 檔 204、折疊 logical lesson 169、taxonomy item 189 的粒度裁決仍有效；
但不得用「新增第 17 課」、題目數、commit、測試數或部署數代表學生互動可靠性。

## 6. 發布後雙側驗收

下一次另獲發布與 env 驗收授權後，必須使用 current-formal `lesson-1474`（classical）與
`lesson-1569`《一個消逝了的山村》（taxonomy genre `lyric-prose`、
`mode=modern-prose`），不用 `lesson-1458`（`speech-letter`，映射到 `argument` 本就
合理，不能暴露 R2-Q1）。兩課各跑 `structure`、`authorQuestion` 兩輪以上、刷新恢復、
YW ledger／evaluation／outbox、UC competency＋normalizedValue＋下鑽；`lesson-1569`
另須逐輪記錄評語是否把抒情散文錯當論證文。完整步驟見安全方案。env canary 永遠不
增加 R3；它只證明工程鏈路可用。

## 7. 每輪 closeout 紀律

此後 YW closeout 只以 R1／R2／R3 為主：

1. R1：classical／非 classical 各自新增多少可靠性證據；429、503、逾時與 p95。
2. R2：兩側各自新增多少已驗多輪／刷新證據；共用程式碼不算另一側通過。
3. R3：真實學生計分事件與 UC 合格可下鑽評價各增加多少；為 0 必須寫原因。
4. 同時列時間四分法、臨時樹、rollout bytes、Git dirty tree、測試、live 版本、
   rollback 與所有未獲授權／未執行動作。
