# YW 現有正式互動可靠性矩陣（2026-08-24）

本矩陣只回答現有互動是否發布、走哪條 runtime 路徑，以及已有什麼驗證；不建新課、
不改內容或 contract。分類沿用 2026-08-24 機器口徑：排除 67 個古詩文 bucket 與 55
個學習活動後，67 個補集課文中有 40 課同時發布 current-formal `structure` 和
`authorQuestion`。

## 1. 圖例與共用路徑

- `A`：正式 `a_plus_gate` 互動，經 `/api/interaction-check`、APIS `feedback`、
  learner reservation、YW `learning_interactions`＋`learning_evaluations`＋outbox。
- `A/M`：同上，且屬 server-owned 多輪；按
  `student_id + resource_key + interaction_key` 回讀最近 6 輪，prompt 使用最近 4 輪。
- `S0`：server-owned direct event，但 `scoringRole=none`，不能形成 R3 合格評價。
- `V`：server answer-key 詞級題；`wordCreation[A]` 另走正式 AI 評閱。
- 驗證 `C`：manifest／registry／通用 contract 測試；`S1`：至少一個該 mode 的
  Worker route 單輪測試。沒有任何非 classical 課具有 `S2`（雙輪 route）、live
  雙輪或 UC 下鑽驗收。

`structure` 與 `authorQuestion` 的 route、reservation、cooldown、APIS task、ledger、
outbox 及錯誤 mapping 不按 mode 分支。mode 仍會改變章法 technique，以及有作者時
`authorQuestion` 的作者口吻；所以正確結論是「狀態與傳輸共路、教學 prompt 依文體」，
不是「伺服器完全不讀 mode」。

## 2. 非古詩文／非學習活動的 40 課

| lesson | 課文 | source mode | 實際顯示 round | 既有驗證 |
|---|---|---|---|---|
| `lesson-1458` | 1、中国人民站起来了 | `speech-letter` | context[A] · read[S0] · revision[A] · structure[A/M] · evaluation[S0] · authorQuestion[A/M] | C |
| `lesson-1461` | 2、长征胜利万岁 | `journalism` | context[A] · read[S0] · revision[A] · structure[A/M] · evaluation[S0] · authorQuestion[A/M] | C |
| `lesson-1462` | * 大战中的插曲 | `journalism` | context[A] · read[S0] · revision[A] · structure[A/M] · evaluation[S0] · authorQuestion[A/M] | C |
| `lesson-1466` | 3、别了,“不列颠尼亚” | `journalism` | context[A] · read[S0] · revision[A] · structure[A/M] · evaluation[S0] · authorQuestion[A/M] | C |
| `lesson-1471` | * 县委书记的榜样——焦裕禄 | `journalism` | context[A] · read[S0] · revision[A] · structure[A/M] · evaluation[S0] · authorQuestion[A/M] | C |
| `lesson-1468` | 4、在民族复兴的历史丰碑上——2020 中国抗疫记 | `journalism` | context[A] · read[S0] · revision[A] · structure[A/M] · evaluation[S0] · authorQuestion[A/M] | C |
| `lesson-1488` | 8、大卫·科波菲尔(节选) 狄更斯 | `fiction` | context[A] · read[S0] · revision[A] · structure[A/M] · evaluation[S0] · authorQuestion[A/M] | C + S1 (`authorQuestion`) |
| `lesson-1490` | 9、复活(节选)列夫·托尔斯泰 | `fiction` | context[A] · read[S0] · revision[A] · structure[A/M] · evaluation[S0] · authorQuestion[A/M] | C |
| `lesson-1493` | 10、老人与海(节选) 海明威 | `fiction` | context[A] · read[S0] · revision[A] · structure[A/M] · evaluation[S0] · authorQuestion[A/M] | C |
| `lesson-1494` | 11、百年孤独(节选)加西亚·马尔克斯 | `fiction` | context[A] · read[S0] · revision[A] · structure[A/M] · evaluation[S0] · authorQuestion[A/M] | C |
| `lesson-1517` | 1 社会历史的决定性基础/ 恩格斯 | `argument` | context[A] · read[S0] · revision[A] · structure[A/M] · evaluation[S0] · authorQuestion[A/M] | C |
| `lesson-1518` | 2 改造我们的学习/ 毛泽东 | `argument` | context[A] · read[S0] · revision[A] · structure[A/M] · evaluation[S0] · authorQuestion[A/M] | C |
| `lesson-1519` | 人的正确思想是从哪里来的? / 毛泽东 | `argument` | context[A] · read[S0] · revision[A] · structure[A/M] · evaluation[S0] · authorQuestion[A/M] | C |
| `lesson-1520` | 3 实践是检验真理的唯一标准/《光明日报》特约评论员 | `argument` | context[A] · read[S0] · revision[A] · structure[A/M] · evaluation[S0] · authorQuestion[A/M] | C |
| `lesson-1521` | 4 * 修辞立其诚/ 张岱年 | `argument` | context[A] · read[S0] · revision[A] · structure[A/M] · evaluation[S0] · authorQuestion[A/M] | C |
| `lesson-1522` | * 怜悯是人的天性/ 卢梭 | `argument` | context[A] · read[S0] · revision[A] · structure[A/M] · evaluation[S0] · authorQuestion[A/M] | C |
| `lesson-1523` | 5 * 人应当坚持正义/ 柏拉图 | `argument` | context[A] · read[S0] · revision[A] · structure[A/M] · evaluation[S0] · authorQuestion[A/M] | C |
| `lesson-1526` | 6 记念刘和珍君/ 鲁迅 | `modern-prose` | context[A] · read[S0] · revision[A] · structure[A/M] · evaluation[S0] · authorQuestion[A/M] | C |
| `lesson-1527` | * 为了忘却的记念/ 鲁迅 | `modern-prose` | context[A] · read[S0] · revision[A] · structure[A/M] · evaluation[S0] · authorQuestion[A/M] | C |
| `lesson-1528` | 7 包身工/ 夏衍 | `journalism` | context[A] · read[S0] · revision[A] · structure[A/M] · evaluation[S0] · authorQuestion[A/M] | C |
| `lesson-1529` | 8 荷花淀/ 孙犁 | `fiction` | context[A] · read[S0] · revision[A] · structure[A/M] · evaluation[S0] · authorQuestion[A/M] | C |
| `lesson-1530` | * 小二黑结婚(节选)/ 赵树理 | `fiction` | context[A] · read[S0] · revision[A] · structure[A/M] · evaluation[S0] · authorQuestion[A/M] | C |
| `lesson-1531` | * 党费/ 王愿坚 | `fiction` | context[A] · read[S0] · revision[A] · structure[A/M] · evaluation[S0] · authorQuestion[A/M] | C |
| `lesson-1540` | 12 玩偶之家(节选)/ 易卜生 | `drama` | context[A] · read[S0] · revision[A] · structure[A/M] · evaluation[S0] · authorQuestion[A/M] | C |
| `lesson-1541` | 13 迷娘(之一)/ 歌德 | `poetry` | context[A] · vocabulary[V + wordCreation[A]] · read[S0] · revision[A] · structure[A/M] · evaluation[S0] · authorQuestion[A/M] | C |
| `lesson-1542` | 致大海/ 普希金 | `poetry` | context[A] · vocabulary[V + wordCreation[A]] · read[S0] · revision[A] · structure[A/M] · evaluation[S0] · authorQuestion[A/M] | C |
| `lesson-1543` | * 自己之歌(节选)/ 惠特曼 | `poetry` | context[A] · vocabulary[V + wordCreation[A]] · read[S0] · revision[A] · structure[A/M] · evaluation[S0] · authorQuestion[A/M] | C |
| `lesson-1544` | * 树和天空/ 特朗斯特罗姆 | `poetry` | context[A] · vocabulary[V + wordCreation[A]] · read[S0] · revision[A] · structure[A/M] · evaluation[S0] · authorQuestion[A/M] | C |
| `lesson-1565` | 5 阿Q正传(节选)/ 鲁迅 | `fiction` | context[A] · read[S0] · revision[A] · structure[A/M] · evaluation[S0] · authorQuestion[A/M] | C |
| `lesson-1566` | * 边城(节选)/ 沈从文 | `fiction` | context[A] · read[S0] · revision[A] · structure[A/M] · evaluation[S0] · authorQuestion[A/M] | C |
| `lesson-1567` | 6 大堰河——我的保姆/ 艾青 | `poetry` | context[A] · vocabulary[V + wordCreation[A]] · read[S0] · revision[A] · structure[A/M] · evaluation[S0] · authorQuestion[A/M] | C |
| `lesson-1568` | * 再别康桥/ 徐志摩 | `poetry` | context[A] · vocabulary[V + wordCreation[A]] · read[S0] · revision[A] · structure[A/M] · evaluation[S0] · authorQuestion[A/M] | C |
| `lesson-1569` | 7 一个消逝了的山村/ 冯至 | `modern-prose` | context[A] · read[S0] · revision[A] · structure[A/M] · evaluation[S0] · authorQuestion[A/M] | C |
| `lesson-1570` | 7 风景谈 | `modern-prose` | context[A] · read[S0] · revision[A] · structure[A/M] · evaluation[S0] · authorQuestion[A/M] | C |
| `lesson-1571` | * 秦腔/ 贾平凹 | `modern-prose` | context[A] · read[S0] · revision[A] · structure[A/M] · evaluation[S0] · authorQuestion[A/M] | C |
| `lesson-1572` | 聽聽那冷雨 | `modern-prose` | context[A] · read[S0] · revision[A] · structure[A/M] · evaluation[S0] · authorQuestion[A/M] | C |
| `lesson-1573` | 8 茶馆(节选)/ 老舍 | `drama` | context[A] · read[S0] · revision[A] · structure[A/M] · evaluation[S0] · authorQuestion[A/M] | C |
| `lesson-1584` | 13 自然选择的证明/ 达尔文 | `science` | context[A] · read[S0] · revision[A] · structure[A/M] · evaluation[S0] · authorQuestion[A/M] | C |
| `lesson-1585` | * 宇宙的边疆/ 卡尔· 萨根 | `science` | context[A] · read[S0] · revision[A] · structure[A/M] · evaluation[S0] · authorQuestion[A/M] | C |
| `lesson-1586` | 14 * 天文学上的旷世之争/ 关增建 | `science` | context[A] · read[S0] · revision[A] · structure[A/M] · evaluation[S0] · authorQuestion[A/M] | C |

mode 分布：argument 7、drama 2、fiction 9、journalism 6、modern-prose 6、poetry
6、science 3、speech-letter 1。34 課因現行 vocab eligibility／active item 判定不顯示
詞級 round；6 課 `mode=poetry` 顯示詞級疏通與 `wordCreation`。

## 3. Poetry 解鎖裁決

已證實的 code contract：

1. `vocab-eligibility.json` 明確把 `classical` 與 `poetry` 都列為詞級疏通合格 mode；
2. `MODE_TRACKS.poetry` 排列 vocabulary、structure、authorQuestion；
3. `classicalRoundLocked` 首行對非 `classical` 直接返回空字串，所以 poetry 的
   structure／authorQuestion 不以 vocabulary 完成為 prerequisite。

這不是執行時自相矛盾：eligibility 表示「該 round 可用」，不自動表示「它是後續
round 的 gate」。但既有 policy 沒有留下「poetry 必須非阻塞」的獨立教學審定收據。
依本輪操作者明示的「保持現有互動模式」，本輪裁決為 **preserve-current-contract**：
不改鎖鏈；將 poetry 非阻塞行為列入 regression acceptance。若日後要把 vocabulary
提升為 prerequisite，屬新的 runtime／教學 contract 變更，需另行設計與授權。

## 4. 尚缺的驗證

- `lesson-1474` 已有 classical 的 `structure`／`authorQuestion` 各兩輪來源 route 測試；
  非 classical 只有 `lesson-1488 authorQuestion` 的單輪 route 測試。
- 通用前端測試證明 conversation merge 去重、單調排序、保留最近 6 輪；它不證明
  任一非 classical 課已在 live 保存並刷新恢復。
- `lesson-1569` 是後續唯一非 classical canary：其 `modern-prose` 在現行線上來源即
  normalize 為 `argument`，須逐輪檢查評語是否錯用論證文技術語；這是獨立 R2 既有
  品質缺陷，不是 evaluator 修復回歸。
- 40 課均缺 production 雙輪、刷新、YW source ledger、UC qualified evaluation 與
  drilldown 的整條驗收。因此非 classical 的狀態是 **正式全開但未經雙輪 live 驗證**。
