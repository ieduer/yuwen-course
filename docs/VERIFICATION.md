# 核查標準 / Verification Standard

## 2026-07-30 Web/native synchronized production release

This synchronized source graph supersedes older content-count markers below.
The complete release transaction is published in production as Pages deployment
`20be2885-5494-4b98-a130-af022c1a389b` from source
`e87c697119d7d75d01def58ff781524f73bb3ff9`; its immediate Pages rollback is
`ada922c5-62e7-46cc-bcd7-7e97dddcc522`.

- five books, 191 lessons and 1,153 posts;
- reader projection: 2,932 unique annotations / 2,933 references;
- every annotation reference is canonically renumbered by first occurrence;
  BBCode color tokens and raw reuse labels such as `[3:1]` are forbidden by
  `npm run check:content-projection`;
- media receipts: 165 unique HTTPS objects / 167 visible references, zero
  anomalies; ledger SHA-256
  `5487243dd8d14d65dfadc20ed544a999aaa318fc20c291462ea62c69e1eff320`;
- reader semantic digest:
  `sha256:d63a2d1ff847318cda6ec87791afe01c5051a102bf73d7e373901c4d6497f9e0`;
- vocabulary: 723 active questions across 77 classical/poetry lessons,
  344 exact eligibility tombstones across 56 nonclassical lessons, 35 retained
  quality tombstones and zero reviewed exceptions;
- learning manifest: `yw-7abfb37143d876fd` / 901 items;
- current derived native semantic digest:
  `sha256:3e77f0f7ffa5d042a6d06763789858ea89f5194eb4e157e80ddb95f2ac8b5543`;
- compatible `contentVersion=yw-3e77f0f7ffa5d042a6d06763`,
  `releaseReceiptId=sha256-ab04efc472f2346bccf4f7e7eb77f35ac75456a7a3af98d426b385a74524bb06`;
- exact release gate: source
  `fd7a482ac88e6baa0da79d69b2fea88c7b00d195`, preview deployment
  `54232d7c-7e6c-4a14-a6b8-d6543efc1134`, publication time
  `2026-07-30T06:18:00.123175Z`, `sourceClean=true` and
  `appDisposition=compatible-and-synced`;
- three isolated compatible builds were byte-identical at 278 files /
  33,143,783 bytes and canonical aggregate
  `7816d7b31aedafd379b13668d58e05099a3c2c458523a3c50c72dd699a9031a8`;
- stable pointer / manifest / core receipts are respectively
  `a5ccd441deb7b0111517c9c1ec597b98e16a6dac789bd32bff3daa96960285a7`,
  `a866d2a2b89877a8d511622a3f736481401cb48b0da88fc39c1c50cead7fe1c3`
  and
  `6cc5e1205de54012141a779a848939f54bd4be1370f2d81f1c7397ec90cfb823`.

Two historical old-stable App-content receipts still contain a malformed AI
Studio state payload and remain forbidden. Formal staging now parses JSON
string values, includes only the exact release referenced by `latest-stable`,
and excludes every historical release. The previously documented
`sha256-041b…` value has no reproducible pointer or release tree and must never
be used.

Release-tree acceptance is executable and mode-bound:

- `npm run test:release-site` must prove that escaped JSON payloads are caught
  only after parsing, unsafe immutable bytes fail closed, receipt drift fails,
  and historical releases/candidates cannot enter formal staging;
- `npm run prepare:preview-artifact` must produce a
  `releaseKind=preview-web-only` marker with zero native allowlist entries and
  no `app-content/` directory;
- `npm run build:release-site && npm run check:release-site` must produce and
  verify `releaseKind=formal-stable`, one exact stable prefix, a byte/SHA/path
  allowlist, and no historical or candidate path;
- a preview marker is never acceptable to the production deploy command, and a
  formal marker cannot be built from unsafe old stable bytes.

`npm run check:native-content:deploy-sync`, `npm run test:release-site` and the
formal build/check passed on 2026-07-30. The formal artifact has 852 files, 278
exact App-content paths and aggregate
`c79cad29e7ca32f2fc11391f7c3e8029f7d1c279eef5857efbfdbef90f9740f1`;
candidate and historical release paths are absent. The complete
`release:check`, artifact-manifest update, Pages deployment and public
hash/content-type readback passed for this exact release. Future releases must
repeat every gate; this record does not authorize reusing an earlier receipt.

Web publication must record exactly one App disposition and must publish/read
back immutable App content objects before moving `latest-stable`. The binary
release is separate: select registered Phone A `c5467d2b` or Phone B
`6393cccf`, then make one byte-identical signed APK pass prior-version
same-package upgrade plus user/session/outbox/content persistence on that
phone. The same phone must also pass a reversible expanded-layout check with
App-observed `AdaptiveWidth.Expanded`, `maxWidth >= 840dp`, effective smallest
width, explicit 200% font, portrait and landscape, followed by itemized
restoration of its exact size, density, rotation, font, proxy and keep-awake
baseline. The second phone is supplemental, no separate physical tablet is a
current blocker, and emulator/device-cloud evidence cannot replace the
selected phone.

The older `yw-b530d57cb873ed49` / 1,156-item clause in item 2 below is retained
only as historical production evidence and is not the current source-candidate
contract.

> 2026-07-26 evidence-loop addendum: the current source contract is governed by
> `/Users/ylsuen/CF/runbooks/bdfz_learning_evidence_integration_standard.md`.
> The source of truth now also includes migration
> `0003_learning_evidence_loop_v1.sql`, registry
> `site/data/interaction-definitions.json`, raw ledger
> `learning_interactions`, evaluation table `learning_evaluations`, and
> `evidence_outbox`. Production bindings are the named service
> `USER_CENTER_EVIDENCE` and dedicated Queue `LEARNING_EVIDENCE_QUEUE`.
> `npm run test:reading` has 30 assertions, including server-side answer-key
> correctness, rejection of browser correctness, rejection of raw/unknown
> telemetry and idempotent semantic events. `npm run test:evidence-contract`
> additionally builds an `evaluation` envelope from the YW source and validates
> it against the current User Center consumer registry.

## 2026-07-30 current production readback

- production Pages deployment:
  `20be2885-5494-4b98-a130-af022c1a389b`
  (`https://20be2885.yuwen-course.pages.dev`);
- deployed source:
  `e87c697119d7d75d01def58ff781524f73bb3ff9`;
- immediate rollback:
  `ada922c5-62e7-46cc-bcd7-7e97dddcc522`;
- `node scripts/verify_deployed_native_content.mjs https://yw.bdfz.net/`
  passed again on 2026-07-30 for
  `contentVersion=yw-3e77f0f7ffa5d042a6d06763`,
  semantic digest
  `sha256:3e77f0f7ffa5d042a6d06763789858ea89f5194eb4e157e80ddb95f2ac8b5543`
  and release receipt
  `sha256-ab04efc472f2346bccf4f7e7eb77f35ac75456a7a3af98d426b385a74524bb06`;
- public readback verified all 276 immutable objects, five approved slide
  PDFs, 70 explicit missing-deck entries, five representative textbook images
  and healthy Reading API state;
- no D1 migration or data mutation was part of this documentation correction,
  and no additional Cloudflare paid product was enabled;
- this is a Web/App content compatibility release. It does not claim a new
  signed Android binary, installation, in-place upgrade or native authenticated
  data-loop acceptance.

## 2026-07-28 release override (historical)

The following values and eligibility rules supersede every older “current”
marker retained below as historical release evidence:

- production Pages deployment:
  `33725793-42fa-437e-ab6d-bc712549e633`
  (`https://33725793.yuwen-course.pages.dev`);
- immediate rollback:
  `8c3cb13e-a954-4f79-a342-f072b0a950b4`;
- D1 migration state is unchanged; never drop or rewrite the evidence tables as
  a Pages rollback;
- artifact manifest: 850 files, aggregate
  `acb2daaadc5cfe358f6ccbc94798a68be5812ab31519f867c02f75be93fca491`;
- release gates: learning manifest `8 / 8`, source contract `8 / 8`, local
  Pages + D1 integration `37 / 37`, and complete `release:check` passed;
- AI completion requires the server-normalized `score >= 60` and correctness
  `passed`; vocabulary completion requires the source-owned `mastered` verdict;
- failed or learning attempts remain in source ledgers and synchronize as
  `ineligible` evidence. They are connected records, not scoring completion;
- eight scoring submissions per authenticated user/resource are accepted in
  ten minutes and the ninth is `429`; exact mutation replay is idempotent and
  cross-resource mutation-id reuse is `409`;
- production D1 aggregate readback remained two interactions for one resource,
  two non-scoring evaluations and two delivered historical outbox rows. No
  student row, schema, attempt or completion was created or modified by this
  release verification.

## 2026-07-27 release override (historical)

The following values supersede older “current” markers retained later in this
file as historical release evidence:

- production Pages deployment:
  `46e3c87f-69a4-4fe4-99bd-9602ed8ffbba`
  (`https://46e3c87f.yuwen-course.pages.dev`);
- reviewed preview:
  `40994e9e-4631-46b6-926e-975c09440769`
  (`https://codex-yw-evaluation-nonscori.yuwen-course.pages.dev`);
- immediate rollback:
  `54117eae-2d7a-495a-b3b2-234855225cee`;
- pre-evidence-loop rollback:
  `18aa0c62-5f37-4a0f-9bdf-a145fc7e2279`;
- post-loop, pre-label-clarification rollback:
  `6686fe9e-2d14-4f40-9e3c-cb21c0d928de`;
- D1 migration `0003_learning_evidence_loop_v1.sql` is applied; it
  is additive and must not be destructively rolled back;
- artifact manifest: 850 files, aggregate
  `4f5e79d1589b05f003ab5cc4545b096282211e54de631636b53677cc0287bc85`;
- release gate: learning-manifest 8/8, source-to-consumer contract 2/2,
  reading API 30/30, and five approved self-hosted Slide Deck PDFs return
  `200 application/pdf`;
- production operations canary `7da148e9-8120-4a31-adf7-8e6e17053532`
  executed the real source module for `lessonOpened`: one source interaction,
  one evaluation and one outbox row historically labelled `delivered`; User
  Center consumed one matching `non_scoring` evidence row with three facets
  and zero queue backlog. Under the corrected producer semantics, Queue
  acceptance is labelled `enqueued`.
  The isolated canary Worker was deleted immediately after readback;
- authenticated browser canary
  `e3627e1f-c27b-476b-902f-a370d3ff7a02` used the locally stored Year-2028
  student credential exactly once: Passport login and User Center session
  succeeded, the same browser opened `lesson-1458`, YW stored and enqueued the
  event, and User Center consumed and displayed the matching lesson-title trace at 390x844
  and 1280x900. It remained `non_scoring` and created no pending outbox row;
- the browser writes only semantic interactions to the source endpoint.
  Source-side D1 records raw interactions and server results, then enqueues a
  privacy-minimized envelope through `bdfz-learning-evidence-yw-v1`.
  The old browser-to-User-Center progress/event wording in item 3 below is
  superseded and must not be reintroduced.
- `evaluation` is an explicitly non-scoring `self_report`; it remains visible
  in the process dossier but cannot affect a dimension or A+. Queue producer
  success is recorded as `enqueued`, not `delivered`, because the current
  one-way Queue has no per-message consumer receipt.

1. Source of truth：本機源码为 `/Users/ylsuen/CF/yuwen-course`；GitHub `ieduer/yuwen-course` branch `main`；當前發布記錄 commit `ab6c9eec08a4de9b9a28cb96cc9ebc0bcf92b42a`（內容基線 `185f781f39b302e34f052e3250755fe597c51987`，後續只補不可變資產 cache-bust）；Cloudflare Pages 项目 `yuwen-course`；发布目录 `site/`；生产域名 `https://yw.bdfz.net/`；Pages Worker 为 `site/_worker.js`。自 2026-07-14 起本站持有 D1 `yuwen-reading-db`（id `99c541e7-e70b-4584-b939-7e88a6dd68c5`，綁定 `READING_DB`，遷移在 `migrations/`）——**學生三詞提交與字詞作答是不可再生數據**。閱讀星圖規則文檔 `docs/READING_CONSTELLATION.md`、字詞題庫標準 `docs/VOCAB_STANDARD.md` 為對應子系統的單一事實源。
2. 健康探针：`curl -fsSI https://yw.bdfz.net/` 期望 `200`；`curl -fsS https://yw.bdfz.net/data/manifest.json | jq -e '(.blocks | length == 5) and (.totals.lessons == 191) and ([.lessons[] | select(.derivedFrom)] | length == 35)'`；`curl -fsS https://yw.bdfz.net/data/literary-taxonomy.json | jq -e '(.stats.lessons == 189) and (.stats.sourceBooks == 84) and (.stats.authors == 106) and ([.genres[] | select(.era and .year and .detail)] | length == 52) and ([.lessons[] | select((.authors | length) == 0 and .representativeFigure.id and .representativeFigure.role and (.visual == null))] | length == 65) and ((.lessons[] | select(.id == "lesson-1692-p4") | .authors[0].url) == "https://qx.bdfz.net/#shelley")'`；`curl -fsS https://yw.bdfz.net/api/reading/health | jq -e '.ok == true and .rulesVersion == "constellation-rules-v1"'`；匿名 `curl -s -o /dev/null -w '%{http_code}' https://yw.bdfz.net/api/reading/constellation` 期望 `401`（未登入不得出數據）；選必上中下「見效題目」清單以 `npm run check:learning-manifest && npm run test:learning-manifest` 為闸門，當前精確契約為 `yw-7abfb37143d876fd`／901 題／101 個教材條目／90% 門檻；關鍵互動以 `BASE_URL=https://yw.bdfz.net npm run verify:ui` 為生產闸門；星圖/字詞後端以 `npm run test:reading` 為合成數據闸門（25 斷言）；字詞題庫以 `npm run verify:vocab:release` 為發布內容闸門；完整靜態包以 `npm run check:artifact-manifest` 驗證逐檔 SHA-256。
3. 關鍵契約核查：HTML 必須加載 `https://my.bdfz.net/site-auth.js`，`siteKey` 為 `yw`；AI 僅由 Pages Worker按 `runbooks/gemini_gateway_policy.md` 調用 `https://apis.bdfz.net`，響應使用 `data.answer`；所有可見 AI 回應必須以當前課文作者第一人稱生成。A+ 見效證據僅包括選必上中下教材目錄內真正有服務端核驗結果的題目：AI 互動成功返回或字詞選項提交後，才以 manifest 中的穩定 `resourceKey` 寫受信作答；篇目 `evaluation` 評價是 `self_report + none`，只記錄而不計分、不作 A+ 條件；匿名狀態不得載入清單、排隊或寫入；錯答仍是已記錄的嘗試，但只同步為 `ineligible`，不得視為計分完成，且 `score`／`correctness` 必須保留真值；正文通讀勾選、查詞、導航、頁面瀏覽和教師課堂進度不是 A+ 題目。`npm run test:evidence-contract` 必須用 YW 真實生產函數構造投影，經 Queue producer mock 後由當前 User Center consumer registry 接受，並證明舊 `self_report + a_plus_gate` 投影會 fail closed。`npm run verify:ui` 覆蓋 User Center 回灌、APIS 細讀判定、QX 作者鏈接、教材 PDF 預覽和本地進度記憶，並固定核查：必修上下 13 個合併項必須穩定生成 35 個獨立篇目且舊合併 ID 不在 manifest；三段標題必須是「起始／細讀／延伸」；篇名下不得再顯示文體籤；所有模式的「叩問作者／提出問題」必須同時位於見效與掌握度最後；叩問作者提示必須是「你最想我的問題是什麼，你問，我答。」；篇目評價只顯示 `1–5` 且無對話框；手機端掌握度必須緊接見效、頂部工具必須收為單一完整標籤入口；目錄必須在側欄展開動畫完成後以真實滾動手勢到達末篇；能力遷移區標題只顯示「高考」且 390px 不得左側擠壓；106 位署名作者必須全部有 QX 深鏈與圖像資產，65 個無署名篇目必須有與單元／作品／時代直接相關的 QX 代表人物、明示 `role`／`reason`／`evidenceLessonIds` 且不得冒充作者；無可靠肖像者必須標明「姓名卡」，篇首禁止書封與教材頁；`lesson-1484` 的 15 個正文註詞必須全部進入詞級疏通；所有設有詞級疏通的篇目不得錯報無獨立註詞；全部文言篇目不得出現新詞創作；全 189 篇作者／代表人物肖像可見性及 390px 移動端橫向溢出必須逐篇巡檢。另保留選必上默認及上次篇目記憶、詞級逐詞查典和彩條、答對自動前進且錯答留在原題重試、通讀無 AI 對話、註釋無圓圈且逐字展開、A+ 與專注閱讀彩條、`chat.bdfz.net` 課內嵌入、三圖內部同頁切換而其他鏈接新頁、文體／書目時代和關係資料、星圖 `0.56` 全貌尺度。閱讀星圖契約（2026-07-14 起）：頂欄必須含 `star.html` 入口；`/star.html` 渲染與交互直接復刻 `jc-atlas`；三詞提交必須冪等（同詞重排/繁簡變體不生新記錄）、換詞生成新版本並保留沿革；星點 id/seq 穩定，佈局只由冊別／教材篇序／詞形哈希推導；未登入 401＋克制空態，嚴禁偽造星點或推斷進度；有題庫課文的詞級疏通必須走逐題過關並記錄作答／重試／掌握（本地＋D1＋UC 事件 `vocab-quiz:<lessonId>`），無題庫課文回退註詞逐查。
4. 部署命令 + 禁止事项：先应用未落库迁移 `source ~/.secrets.env && ./node_modules/.bin/wrangler d1 migrations apply yuwen-reading-db --remote`，再从项目根目录运行 `npm run deploy`。不得从 `.cache/`、临时目录或旧镜像发布；不得为本站新增 Gemini 密钥；数据源未变时不得运行 `build:data`；修改不可变前端资产后必须提升 `index.html` / `star.html` 的查询版本。**严禁在生产 Pages 项目配置 `READING_TEST_SLUG`**（本地测试缝，见 READING_CONSTELLATION.md §2）；**严禁以 DROP TABLE 作为回滚手段**；重大变更前先 `wrangler d1 export yuwen-reading-db --remote` 备份。
5. 依賴回歸：本站依賴 `my.bdfz.net`、`apis.bdfz.net`、`nav.bdfz.net`、`img.bdfz.net`、`qx.bdfz.net`、`jc.bdfz.net`、`chat.bdfz.net`；改動若不觸碰樞紐契約，至少驗證這些入口仍可達並運行本站生產 UI 闸門。若修改會話或 APIS 契約，須按項目矩陣重掃扇出，並回歸 `bdfz-companion` App。
6. 备份 / 恢复：课文 JSON、taxonomy、字词题库 `site/data/vocab/`、前端与 Worker 均由 Git 工作树及 Pages 历史保存；本輪 pre-commit 完整 source archive 為 `/Users/ylsuen/CF/backups/yuwen-production-baseline-precommit-20260714/yuwen-course-source.tar.gz`，SHA-256 `a03b3b76f5e54db98a37a0103daa135afb183e7da96225a5a0a354f8b6faf7b7`。D1 `yuwen-reading-db` 为不可再生学生数据：重大变更前 `wrangler d1 export yuwen-reading-db --remote --output backups/yuwen-reading-<date>.sql` 备份，恢复用 `wrangler d1 execute yuwen-reading-db --remote --file <backup>`；恢复数据文件时从 Git/本机备份恢复后重新生成 taxonomy，并先在 `pages.dev` 预览验证。2026-07-26 已在私有限制权限目录保存远端导出；迁移 0003 为纯增量，代码回滚时保留新增表，不执行 DROP TABLE。
7. 回滾：先運行 `./node_modules/.bin/wrangler pages deployment list --project-name yuwen-course` 確認目標；在 Cloudflare Pages deployment history 將上一個已驗證 production deployment 重新部署。當前 production 為 `46e3c87f-69a4-4fe4-99bd-9602ed8ffbba`（`https://46e3c87f.yuwen-course.pages.dev`）；立即回滾錨點為 `54117eae-2d7a-495a-b3b2-234855225cee`，回滾會恢復舊 `evaluation=self_report+a_plus_gate` 來源宣告和舊的 `delivered` 佇列標籤，因此只在整站故障時使用。更早的完整回滾仍有 `6686fe9e-2d14-4f40-9e3c-cb21c0d928de` 和 pre-loop `18aa0c62-5f37-4a0f-9bdf-a145fc7e2279`；任何程式碼回滾都保留 additive D1 表與歷史行。回滾後重跑第 2、3、5 條。
8. 最後驗證人 / 日期：Codex / 2026-07-27 PDT。`release:check` 全通：作者 189/106/65/0 unsupported、字詞 134/134 課 1102 題、learning manifest 8/8、source-to-consumer contract 2/2、reading API 30/30、850-file artifact aggregate `4f5e79d1589b05f003ab5cc4545b096282211e54de631636b53677cc0287bc85`。Preview `40994e9e-4631-46b6-926e-975c09440769` 和 production `46e3c87f-69a4-4fe4-99bd-9602ed8ffbba` 的兩個任務資產雜湊與本地完全一致；custom domain registry 明示 `evaluation=self_report+none`，Worker 只把 Queue producer 成功標成 `enqueued`，health 通過，匿名 evaluation POST 為 401。Production D1 聚合讀回沒有既有 `evaluation` 行；沒有製造學生互動、改 D1、改 User Center、改共享 SDK 或改身份契約。

YW A+ manifest 与 User Center evaluator 现已固定为同一来源版本；新 YW A+ 只接受 `bdfz-learning-evidence-v1`、当前注册表和发布资源键。匿名负向验证为 401。2026-07-27 先以明确标记的毕业测试映射验证后端源账本、Queue、中心消费者和幂等读回；随后用本机密钥文件中的 28 届学生账号一次通过希悦 Passport 与 User Center session，在同一浏览器打开 `lesson-1458`，完成 YW interaction / evaluation / outbox、Queue、User Center evidence / facets 与过程档案页面的全链路读回。事件仍为 `lessonOpened`／`scoring_role=none`／`eligibility_status=non_scoring`，不会改变 A—F 分数；正文、账号、密码、Cookie 和 token 均未进入运维记录。

本地完整核查：

```zsh
cd /Users/ylsuen/CF/yuwen-course
npm run build:lessons
npm run build:taxonomy
npm run verify:authors
npx wrangler pages dev site --port 8799
# 另一个终端：
BASE_URL=http://127.0.0.1:8799 npm run verify:ui
```
