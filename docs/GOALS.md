# YW / yw.bdfz.net — 學習證據與評價目標台賬（審閱草案）

> 本文只使用 2026-08-24 本輪來源碼、資料檔、runtime contract 與遠端 D1
> 唯讀回讀所得的事實。它是未提交、未發布的審閱草案，不授予合併、部署、D1
> 寫入或共享樞紐變更權。

## 0. 最終目標（一句話）

**一個學生能在 yw.bdfz.net 完成與文體相稱的學習，原始證據可回指，並在
my.bdfz.net 形成可下鑽的規範化能力評價。**

## 0.1 唯一進度口徑

| 口徑 | 實測基線 | 分母／範圍 | 分子成立條件 |
|---|---:|---:|---|
| A：古詩文完整階梯 | **16 / 67** | 67 個古詩文 runtime bucket 課文 | 同一課同時具備初讀、詞級疏通、學案知能清算、考辨與章法＋遷移與追問四階 runtime contract |
| B：現當代完整階梯 | **0 / 67** | 67 個現當代 runtime bucket 課文 | G0 的現當代階梯先獲審定，再按獲准 contract 判定四階全備 |
| C：UC 可下鑽評價 | **0 課** | A+B 的 134 課；測試帳號與 env 學生永遠排除 | 真實學生在 UC 同時具備非空 competency facet、非空 normalizedValue，且 `sourceUrl`＋`sourcePayloadRef` 能回到 YW source-owned 原始互動／作答 |

`commit`、部署、題目數、通過測試數、outbox `delivered`／`enqueued` 均不增加
A、B、C 分子。學習活動另列 55 項，但不進 A/B 分母。

「現當代」在本文是為了與現行 runtime 學習軌對齊而採用的非學習活動、非古詩文
補集，不是年代學分類；其中可能包含古代小說或戲劇。G0 審定前不得把這個機器桶
誤寫成已成立的現當代教學階梯。

## 1. 分母與粒度裁決（2026-08-24）

### 1.1 三種粒度

- **lesson 實體檔**：`site/data/lessons/lesson-*.json` 的物理檔／物理 id，共 204。
- **logical lesson**：以 `derivedFrom || id` 折疊 35 個多部課文子檔後的邏輯 id，
  共 169。這個粒度適合追查來源檔家族，不適合直接代表教材目錄項。
- **taxonomy item**：`literary-taxonomy.json.lessons[]` 的教材目錄項，共 189。
  它保留多部課文各篇的目錄粒度。
- runtime 還有 `lesson-competency-manifest.json` 191 行與 reader index 191 行：兩者都
  是 189 個 taxonomy item 加上 2 個工具／歷史記錄，並不把分母擴成 191 篇教材課文。

### 1.2 兩份差集

lessons logical id 有、taxonomy 無的 15 項：

`lesson-11637`、`lesson-11705`、`lesson-1692`、`lesson-1701`、
`lesson-1704`、`lesson-1705`、`lesson-1706`、`lesson-1711`、
`lesson-1717`、`lesson-1719`、`lesson-1722`、`lesson-1726`、
`lesson-1743`、`lesson-1753`、`lesson-1755`。

taxonomy 有、logical id 無的 35 項：

`lesson-1692-p1`、`lesson-1692-p2`、`lesson-1692-p3`、`lesson-1692-p4`；
`lesson-1701-p1`、`lesson-1701-p2`；
`lesson-1704-p1`、`lesson-1704-p2`；
`lesson-1705-p1`、`lesson-1705-p2`、`lesson-1705-p3`；
`lesson-1706-p1`、`lesson-1706-p2`、`lesson-1706-p3`；
`lesson-1711-p1`、`lesson-1711-p2`；
`lesson-1717-p1`、`lesson-1717-p2`；
`lesson-1719-p1`、`lesson-1719-p2`；
`lesson-1722-p1`、`lesson-1722-p2`、`lesson-1722-p3`、`lesson-1722-p4`；
`lesson-1726-p1`、`lesson-1726-p2`、`lesson-1726-p3`；
`lesson-1743-p1`、`lesson-1743-p2`；
`lesson-1753-p1`、`lesson-1753-p2`；
`lesson-1755-p1`、`lesson-1755-p2`、`lesson-1755-p3`、`lesson-1755-p4`。

可證明的成因：13 個合篇父記錄仍保留物理檔，taxonomy 則把它們展開為 35 個教材
目錄子篇；用 logical id 折疊後，父 id 出現在第一份差集，子篇 id 出現在第二份差集。
另外，`lesson-11637`（Google site 版）與 `lesson-11705`（課堂進度記錄）沒有教材
目錄頁、正文與學習任務，是工具／歷史記錄而不是教材課文。

### 1.3 權威分母

- **教材目錄覆蓋**：taxonomy 189 項為權威。
- **可執行課文覆蓋**：taxonomy、runtime manifest、reader index 三者交集為權威；
  本輪交集也是 189 項。兩個工具記錄不計。
- A 古詩文：`mode=classical` 的 30 篇，加上 genre 祖先為
  `classical-poetry` 的 37 篇，共 67。
- B 現當代 runtime bucket：排除 55 個學習活動與 67 個古詩文後的 67 篇。
- 學習活動：`unit-intro`、`unit-task`、`whole-book`、
  `language-activity`、`review`，共 55。

## 2. 四階 runtime contract 覆蓋

覆蓋只按 schema、資料檔與 runtime contract 判定。初讀必須先拆開兩個不同謂詞：

- **A 採用的審定初讀**：只認
  `classical-first-read/index.json` 的政策
  `yw-classical-first-read-reviewed-2026-08-09-v1`。現有 30 個 taxonomy 課文檔，
  將 `-pN` 子篇折回父 id 後為 24 個 logical lessons，全部屬古詩文。
- **先前表格的廣義 runtime 初讀**：審定初讀 30 項與正式
  `contextWords` manifest 85 項的聯集。後者在 A/B 分母內為古詩文 19、現當代
  40，另有學習活動 26；所以 A+B 聯集是 89，不是 89 個
  `initial_reading_submitted` 項。`interaction-definitions.json` 雖全域註冊
  `initialReadingSubmitted`，`learning-manifest.json` 對該 question kind 實為 0 項。
- 詞級疏通：有效 vocabulary contract／正式 `vocabAnswer`，且符合 runtime eligibility。
- 學案知能清算：有效 study-guide catalog 與 server-side 評閱證據。
- 考辨與章法＋遷移與追問：正式 `structure` 與 `authorQuestion` 同時存在，並由
  server-owned evidence／多輪 runtime contract 承接。

| 初讀謂詞 | 古詩文（67） | 現當代 runtime bucket（67） | 學習活動（55） | A+B 合計 |
|---|---:|---:|---:|---:|
| 已審定帶註釋初讀 | **30 / 67**（30 檔；折疊後 24 logical lessons） | 0 / 67 | 0 / 55 | **30 / 134** |
| 先前廣義 runtime 聯集（審定初讀 ∪ 正式 `contextWords`） | 49 / 67 | 40 / 67 | 26 / 55 | **89 / 134** |

| 類別 | 初讀（A/B 分子採審定口徑） | 詞級疏通 | 學案知能清算 | 考辨與章法＋遷移與追問 | 四階全備 |
|---|---:|---:|---:|---:|---:|
| 古詩文（67） | 30 / 67（44.8%） | 67 / 67（100%） | 16 / 67（23.9%） | 35 / 67（52.2%） | **16 / 67（23.9%）** |
| 現當代 runtime bucket（67） | 0 / 67（G0 尚未審定） | 10 / 67（14.9%） | 0 / 67（0%） | 40 / 67（59.7%） | **0 / 67（0%）** |
| 學習活動（55，不進 A/B） | 0 / 55（不適用 A/B 審定口徑） | 0 / 55（0%） | 0 / 55（0%） | 26 / 55（47.3%） | 0 / 55（0%） |

古詩文四階全備 16 課：`lesson-1474`、`lesson-1476`、`lesson-1477`、
`lesson-1483`、`lesson-1484`、`lesson-1485`、`lesson-1534`、
`lesson-1535`、`lesson-1536`、`lesson-1537`、`lesson-1576`、
`lesson-1577`、`lesson-1578`、`lesson-1579`、`lesson-1580`、
`lesson-1581`。

原表所稱「僅缺學案知能清算」的 19 課為：`lesson-1497`、
`lesson-1498`、`lesson-1499`、`lesson-1500`、`lesson-1547`、
`lesson-1548`、`lesson-1550`、`lesson-1549`、`lesson-1556`、
`lesson-1557`、`lesson-1558`、`lesson-1559`、`lesson-1560`、
`lesson-1561`、`lesson-1562`、`lesson-1588`、`lesson-1589`、
`lesson-1590`、`lesson-1591`。該說法只在廣義 runtime 聯集下成立；19 課全部不在
審定初讀 30 項內，因此按 A 的嚴格口徑同時缺「已審定帶註釋初讀」與「學案知能
清算」，不能列為僅差一階。重算後，A 的「僅缺一階」課數是 **0**。

原 A=16 的程式使用了廣義聯集；以審定初讀重算後仍為 16，且同一 16 課逐一都在
審定 30 項內，故 A 分子不變。這是集合交集相同，不是沿用錯誤代理口徑。

## 3. UC 三層唯讀基線（2026-08-24T08:32:47Z）

排除集由 `/Users/ylsuen/.secrets.env` 的 1 個 env 學生鍵與 5 個測試帳號鍵建立；
不輸出帳號、UC id 或原始作答。6 個鍵互異，5 個可在 UC 權威身份表映射為 5 個
UC user；餘下 1 個沒有 UC 身份，也沒有 YW 直接帳號命中，因此不可能產生現行
authenticated evidence。YW／UC 聚合查詢同時按映射 user id 與直接帳號鍵排除。

### 3.1 傳輸層：YW `evidence_outbox`

未排除前有 529 行：`delivered/(null)` 2、`enqueued/(null)` 277、
`enqueued/accepted` 67、`enqueued/quarantined` 183。排除 env／測試帳號後只剩：

| delivery_status | central disposition | 行 | 課文 | 真實學生 | 最舊建立 | 最新活動 |
|---|---|---:|---:|---:|---|---|
| `enqueued` | null | **48** | **3** | **2** | 2026-07-29 06:29:13Z | 2026-08-17T09:32:22.702Z |

按 lesson＋competencyTag：

| 類別 | lesson | competencyTag | 行 | 真實學生 |
|---|---|---|---:|---:|
| 古詩文 | `lesson-1711-p2` | 無 | 21 | 1 |
| 古詩文 | `lesson-1711-p2` | `first_read_process` | 1 | 1 |
| 古詩文 | `lesson-1727` | 無 | 15 | 1 |
| 古詩文 | `lesson-1727` | `first_read_process` | 1 | 1 |
| 現當代 runtime bucket | `lesson-1458` | 無 | 10 | 2 |

真實學生沒有任何 `learning_evidence_deliveries` 或 terminal receipt 行；單看
outbox，48 條 `enqueued` 當然不能證明 UC 已接收。但 2026-08-24 的精確
`source_event_id` 交叉回讀證明，UC `learning_evidence` 已有同一批 **48 / 48** v1
證據，落庫時間為 2026-07-29 06:29:19Z 至 2026-08-17 09:32:27Z。最後一筆只比
YW 最新 transport activity 晚約 5 秒，因此不是 Queue consumer 一週未工作；缺的是
v1 回執／評價投影閉環。`delivered`、`enqueued` 或 outbox 行數仍不得代替評價成立。

### 3.2 評價層：UC `learning_evidence`

UC 可回讀到 48 條排除後的 `source_system=yuwen-course`、`source_site_key=yw`
舊式證據，覆蓋 2 名真實學生：

- 48 / 48 均為 `event_schema=bdfz-learning-evidence-v1`、`non_scoring`；
- 48 / 48 的 normalizedValue 為空；
- 2 / 48 有非空 competency facet，46 / 48 沒有；
- 48 / 48 有 lesson facet、sourceUrl 與 sourcePayloadRef；
- 同時具備「非空 competency facet＋非空 normalizedValue」者為 **0 條、0 課、0 名
  真實學生**；古詩文 0、現當代 0。

### 3.3 可下鑽層

本層的分母只能是 3.2 中已成立的合格評價。合格評價為 0，因此能再由
`sourceUrl`＋`sourcePayloadRef` 回到 YW `learning_interactions.raw_payload_json`
原始互動／作答者也是 **0 條、0 課、0 名真實學生**。這是實測零值，不是把
`enqueued` 當評價，也不是因 join key 或權限不足而估算。

## 4. 目標與阻斷

### G0 — 現當代階梯定義【必須先由 suen 審定】

- 古文「三詞猜義」不得複製到現當代課文。
- 現當代初讀先產生「整體感知＋思路脈絡」的可觀察證據。
- 詞級疏通只有在證據有效性獲核准後才可與古文共用。
- 學案知能清算、考辨與章法、遷移與追問都須按現當代文體重新定義。
- `classical_first_read_*` 舊表是復用並提升為通用 contract，還是另立現當代 schema，
  是 suen 必須拍板的 schema 決策；本草案不自行選擇。

第一里程碑是「現當代階梯定義獲審定」，不是新增若干課。G0 未通過前，B 分子保持 0。

### G1 — 古詩文以完整整包為建設單位

一個完整整包的確切構成：

1. 課文在 taxonomy、reader、manifest 三個 authority 間身份一致；
2. 與古詩文相稱的 server-owned 初讀；
3. 詞級疏通 contract 與作答證據；
4. 學案知能清算、server-side 評閱與明確 competency；
5. 考辨與章法，以及遷移與追問的 AI 多輪互動；
6. 四階無刷新推進、原始互動留在 YW、UC 形成 normalized competency evaluation，
   並能用 `sourceUrl`＋`sourcePayloadRef` 回指；
7. schema／runtime／mobile 驗證與可回滾發布收據。

本輪沒有建構新課，故沒有可冒充「單包製作工時」的新樣本；已知基線仍是
**19 小時／單課**。按 A 的審定初讀重算後沒有「僅缺一階」的古詩文包；原列 19 課
同時缺審定初讀與學案知能清算。G1 排程不得再把這 19 課當成單階補齊候選；即使補課，
也仍須整包驗收，不能把局部完成直接當成 A 分子。

### G2 — 評估可靠性與 evaluator 發布門【硬阻斷】

兩條量化驗收門同時成立才可談發布：

- 成功回應的 feedback p95 **< 45 秒**；
- `429 evaluator_retry_exhausted = 0`。

既有小樣本必須完整保留：20 次中 19 次成功、1 次 transport failure；p50
10.194 秒、p95 24.401 秒、max 25.908 秒只按成功回應計。另一組 5 次外部探測有
1 次超過 40 秒仍無回應。不得寫成「503 已解決」。修復的預期作用只是把單次上游
評閱失敗的學生代價由 10 分鐘窗口鎖降為 15 秒 cooldown。

`7256098` 同時新移除了唯一的 evaluator 呼叫上界：修復前第二次失敗會以懲罰學生的
方式鎖住同一 mutation；修復後 `.002Z` cooldown 行可刪除並重新預約，learner
capacity 會回落。APIS live `traffic_gate` 只按 project＋task type＋path，沒有
student／session／mutation 粒度。因此 evaluator 版在新增「與 learner capacity
分離、fail-closed 的 evaluator-call 上限」前不得發布。

APIS 的 `80/min`、`6 concurrency` 只來自 2026-06-13 Worker `v6.5.2` 導出，
**未經現行線上數值確認**。該導出的 feedback request timeout 為 12 秒，已與本輪
19–28 秒成功回應觀測矛盾；現行 `/health` 是 `v6.7.0`。數值不作發布裁決輸入；
硬阻斷只依賴已確認的架構事實：gate key 沒有學生／session／mutation 維度。

該限流屬 APIS 約 28 個依賴站的共享扇出新能力，必須使用新的 change id、獨立授權、
完整扇出與回滾；不得夾帶進 `7256098`。runtime DELETE 上線前另須建立 D1 Time
Travel bookmark／備份點並取得相應資料變更授權。

### G3 — UC 評價鏈三層目標【待 suen 審定】

建議審定值，尚未獲批准：

- 傳輸：合格 scoring evidence 100% 在 5 分鐘內得到中央 disposition；超過 15 分鐘
  仍為 `pending`／`enqueued` 者為 0。
- 評價：中央 accepted 的合格 scoring evidence 100% 形成非空 competency facet 與
  normalizedValue；錯配／quarantine 不得計入。
- 可下鑽：上述合格評價 100% 以精確 `sourceUrl`＋`sourcePayloadRef` 回到同一真實
  學生、同一課、同一 source event 的 YW 原始互動。

三層必須分開回報；`delivered`、`enqueued`、題目完成或點擊都不等於評價。

### G3a — v1 回執／評價投影斷層【P1；C 收口硬阻斷；在線獨立缺陷】

這項缺陷與 evaluator 修復無關，須另行授權處置；唯讀裁決如下：

- consumer 是 live `bdfz-user-center` Worker（`git-665ca51e28e084307100910a254453aac2a36948`），
  同時掛載 v1、v1 DLQ、v2、v2 DLQ。現行 v2 鏈仍活著：YW 最近成功取得中央
  disposition 的時間是 `2026-08-24T01:17:39.902Z`。
- 這 48 條全部為 `bdfz-learning-evidence-v1`，envelope、YW raw payload 與 YW
  evaluation 各 48 / 48 尚在；UC 也已 48 / 48 落成 v1 `non_scoring` evidence。
- `OUTBOX_RETRY_SELECTION_SQL` 與 `OUTBOX_RECONCILE_SELECTION_SQL` 都硬性只選
  `bdfz-learning-evidence-event-v2 + yw-aplus-e310-v2`；48 條的兩個 selection
  命中均為 0，所以現行自動 drain 永遠選不中它們，也永遠補不上中央 disposition。
- 資料未過期，也沒有依事件年齡淘汰的來源規則；但「直接重放即可修復」不成立：
  其中 39 條是 v1 schema 搭配 `yw-interactions-2026-08-09-v2` registry，現行 v1
  legacy adapter 不接受；而 48 條本就已在 UC，重送只會重複／拒絕，不能把
  `non_scoring + normalizedValue=null` 變成合格評價。需要另行設計並授權精確的
  v1 歷史 receipt reconciliation，以及 forward-only 的合格 v2 evaluation 路徑；
  不得做 Queue 盲重放，更不得把舊 trace／點擊事後改寫成 scoring evaluation。

因此 C=0 必須拆成兩層：第一，已到 UC 的 48 條全是舊式 non-scoring evidence，
沒有合格 competency evaluation；第二，YW v1 outbox 沒有可進入現行 v2 回執輪詢的
狀態遷移。第二層是在線閉環／可觀測性缺陷，但不是「48 條尚未送到 UC」。

### G4 — 成本收斂【待 suen 審定】

- 已知不可持續基線：19 小時／單課。
- 本輪是審核與測量，沒有建構新課；由 rollout／action-log 時戳按主要活動互斥
  歸類，`2026-08-24T07:29:56Z` 至 closeout 前驗證凍結點 `08:46:36Z` 的
  wall time 為 76 分 40 秒：

  | 定位 | 建構測量手段 | 修正 | 治理 | 合計 |
  |---:|---:|---:|---:|---:|
  | 31 分 | 17 分 | 15 分 | 13 分 40 秒 | 76 分 40 秒 |

  這個樣本不能換算為單包工時。
- 本輪 Phase 0–4 closeout 的 rollout 增量更正為 **17,712,726 bytes**；rollout
  gate 仍為約 74 GiB，超過 64 GiB 閘門。`archived_sessions` 的任何治理均待獨立
  授權，本輪未夾帶處置。
- 建議下一個 5 包批次的收斂目標：完整包中位數 **≤ 6 小時／課**、P90
  **≤ 8 小時／課**；任一包到 **8 小時**仍未滿足七項整包 contract 即 fail closed，
  停止把殘缺包算進 A，另請 suen 決定拆阻斷或追加投入。這些數字只是待審建議。

## 5. 古詩文／現當代差距表

| 階段 | 古詩文阻斷 | 現當代阻斷 | 目標 |
|---|---|---|---|
| 初讀 | 審定初讀僅 30 / 67；37 / 67 尚無審定 contract | G0 未審定；現有審定口徑 0 / 67（廣義 runtime 聯集 40 / 67 不計 B 分子） | G0、G1 |
| 詞級疏通 | 67 / 67 有 contract，但仍須整包證據驗收 | 僅 10 / 67 有現行 contract，且共用有效性未審 | G0、G1 |
| 學案知能清算 | 僅 16 / 67；原列 19 課還同時缺審定初讀，嚴格口徑沒有僅差此階者 | 0 / 67，知能清算定義亦未審 | G0、G1 |
| 考辨與章法＋遷移與追問 | 僅 35 / 67；多輪與 server evidence 仍須逐包驗 | 40 / 67 有機器 contract，但文體適切性未審 | G0、G1 |
| 評估可靠性 | evaluator-call 無獨立上限；發布硬阻斷 | 同一共享 evaluator／APIS 風險 | G2 |
| UC 評價與下鑽 | 真實學生合格評價 0 課；v1 outbox 回執永遠選不中 | 真實學生合格評價 0 課；同一 v1 投影／回執斷層 | G3、G3a |

## 6. 記錄紀律

每輪 YW closeout 必答：

1. A、B、C 哪個分子推進多少；為 0 時寫出原因。
2. 時間分為「定位／建構測量手段／修正／治理」四段。
3. 本輪建立與刪除的臨時樹數、rollout 增量 bytes、所有保留／刪除／歸檔／阻塞路徑。
4. Git dirty tree、測試、線上版本、回滾點與未解風險。
5. 未獲授權的動作列為未執行，不得用計畫語氣冒充完成。
