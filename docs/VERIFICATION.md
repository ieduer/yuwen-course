# 核查標準 / Verification Standard

## 2026-08-11 Web reading release gate

This current Web-only gate supersedes the 2026-08-09 pre-migration/503 release
disposition below. It does not authorize App or User Center work.

### Required commands

```zsh
cd /Users/ylsuen/CF/yuwen-course
PATH=/Users/ylsuen/.nvm/versions/node/v24.18.0/bin:$PATH npm ci
YW_STUDY_GUIDE_SOURCE_DIR=/Users/ylsuen/CF/output/pdf_study_guides_web \
  PATH=/Users/ylsuen/.nvm/versions/node/v24.18.0/bin:/opt/homebrew/bin:$PATH \
  npm run verify:study-guide-sources
PATH=/Users/ylsuen/.nvm/versions/node/v24.18.0/bin:$PATH npm run precontent:check
PATH=/Users/ylsuen/.nvm/versions/node/v24.18.0/bin:$PATH npm run qa:web-polish
PATH=/Users/ylsuen/.nvm/versions/node/v24.18.0/bin:$PATH npm run qa:chat-no-autoload
PATH=/Users/ylsuen/.nvm/versions/node/v24.18.0/bin:$PATH npm run qa:embed-playback
PATH=/Users/ylsuen/.nvm/versions/node/v24.18.0/bin:$PATH npm run build:release-site
PATH=/Users/ylsuen/.nvm/versions/node/v24.18.0/bin:$PATH npm run check:release-site
PATH=/Users/ylsuen/.nvm/versions/node/v24.18.0/bin:$PATH npm run build:artifact-manifest
PATH=/Users/ylsuen/.nvm/versions/node/v24.18.0/bin:$PATH npm run check:artifact-manifest
git diff --check
```

The current run must prove:

- 189 student-visible lesson units render the merged masthead/orientation/
  portrait layout at 1440, 1024 and 390 CSS pixels without horizontal overflow;
  the source manifest retains 191 records including two hidden system records,
  and the local-step disclosure begins collapsed beside the portrait;
- 30 classical lessons / 102 first-read paragraphs remain source-bound; after
  first-read submission, the submitted no-note text, source-bound learning tip
  and annotated canonical text remain visible together. The 30 tips derive
  deterministically from 18 exact source groups. Inline annotations begin
  hidden and type once; the server and browser both block vocabulary until the
  stable `annotated_reading` acknowledgment succeeds;
- all 2,933 annotation references across 191 reader documents bind to the
  preceding visible character or Latin word and render as numeric superscript
  buttons. Classical and modern text must have zero orphan marker, zero
  visible `注／註` word button and zero horizontal overflow at 1440/1024/390;
- all 189 student lessons have a unique, text-anchored, mode-specific structure
  prompt; author impersonation and `我是／抽掉／換序／最關鍵的材料` templates
  must be rejected. The Dickens prompt must name the adult retrospective,
  child-labour experience and first-person narrative perspective;
- all nine WeChat sources project to exact `wx.bdfz.net` archives; direct
  `mp.weixin.qq.com` and `bdfz.yuque.com` student targets are zero;
- every supported embed can expand and shrink, with Escape/focus restoration;
  after the exact deletion set, the audited 351 page resources resolve to 334
  screenshots + 11 direct presentations + 6 stopped embeds, all six due to
  an external condition. The screenshots include 49 reviewed authenticated
  pages and deduplicate to 328 WebP assets / 12,795,016 logical bytes;
- preview targets are exactly 538 / 118 redirects / 75 hosts with digest
  `sha256:887931515ae55b93d579a6892b5146ef68466c1e2c3ae5ed0c8022e00f2e84b7`;
  arbitrary same-host paths and unregistered redirects remain 403;
- screenshot manifest SHA-256 is
  `30193e813611eb5e9ec09e2da99f81e5bca50597ed8b16839097eb70458333af`;
  confirmed-dead Bilibili `BV1Zg4y1H7fK` is absent from the Web projection,
  preview registry and screenshot manifest. E01 and all 16 permanent/remove
  resources and exact empty Sichuan gazetteer `content_30068` page are likewise
  absent and are not counted among the six; `content_22151` remains;
- all 99 exact Google Sites targets use reviewed screenshot-first rendering;
  17 BDFZ exact roots load the same real remote URL in their card and full-page
  view. `xue.bdfz.net` has zero student resource, target, redirect, host,
  screenshot, resolved or blocked record, and its preview requests return 403;
- safe QX figure fragments load the exact remote profile; all 17 Wikisource
  targets are screenshot-first; all five registered YouTube resources expose
  click-to-play `youtube-nocookie.com` players and fullscreen playback;
- `先找方向` is absent while `起始` remains. With no saved preference the
  reader scale is 126%; saved local/remote values win. Chat remains
  `about:blank`, hidden and request-free for at least 12 seconds before an
  explicit `進入同讀` click, without scroll or focus movement;
- 文體、書目、星圖、己身 and 登入 all open a new tab with
  `noopener noreferrer`; the original lesson URL remains unchanged;
- the study-guide catalog is 241 / 191 active / 50 inactive and the formative
  manifest is 1,019 / 115 lessons / 50 tombstones; A+/A--F bytes and behavior
  do not change;
- live pre-deploy readback requires Reading 200 (`reading-schema-v4`). Reading
  health checks four tables/eight key indexes; a separate
  read-only `sqlite_schema` query confirms all four tables/ten named indexes
  from migration 0004. D1 migrations 0001--0004 are present exactly once and
  must not be replayed during this Web deployment. Learning-health is recorded
  as compatibility evidence but, while User Center follow-up is deliberately
  paused, it does not gate these Web-only presentation changes and must not be
  used to claim an outage in three-word submission, vocabulary progress or the
  durable evidence queue.

The completed local precontent run reports: preview targets 6/6, resource and
screenshot policy 12/12, authenticated importer 5/5,
learning manifest 9/9, study-guide catalog 3/3, assessment 6/6, frontend 3/3,
evidence 15/15, formative projection 4/4, shared state 13/13 plus real browser,
Reading API 70/70, native candidate 21/21 and release-site 5/5. Layout
acceptance passed 25/25, the dedicated Web-polish browser matrix passed 32/32,
and the embed-playback matrix passed 16/16. The `lesson-1534` browser flow rendered 98 initially hidden notes,
retained type-once/collapse behavior, blocked vocabulary before the receipt and
unlocked it only after the exact stable mutation succeeded.

The formal staging/check and artifact-manifest check pass at 1,223 files. The
release marker is `formal-stable`, 1,222 projected files, projected aggregate
`a22ab92d0dc6193921a87fe7aee7340edf35ff18530206bb7bca0b0c23b76eac`,
marker SHA-256
`ef1856ce0622f2a0ceeada513465ab48ef5947a3a9150e5b5115785062ed9ad2`
and artifact-manifest aggregate
`53dd53198cfbf9ede9ec8155597303a0732e0c6aa8ca2b0d70221f048278102e`
(163,876,162 bytes).
It includes the unchanged stable App release only (278 exact paths) and no new
App candidate or pointer.

Production deployment
`8da16237-ac91-47e1-afe2-7843e2d4c8a4` was published from clean GitHub `main`
carrier commit `0ff5d5604ceefef92c99c07033f1e900d9edaaed` at
2026-08-11T15:43:46.808208Z. The atomic deployment URL and `yw.bdfz.net` return the
same marker SHA-256 above. Live Reading and compound learning health are 200;
the online source/taxonomy counts are 191/189, preview registry is 538/118/75,
and the screenshot manifest is 351/334/11/6. All seven fetched production
authorities match the carrier byte-for-byte. The production 390-pixel,
read-only browser smoke confirms an expanding numeric note with content, no
horizontal overflow, five safe new-tab links and zero `xue.bdfz.net` DOM
references; the complete exact-carrier Web-polish matrix passed 32/32.
Immediate Pages rollback is `a257af4c-78a1-483d-bc9e-57e34e1d2dbe`; D1 and the
App pointer remain in place.

### Deliberate App pause

`npm run check:native-content:deploy-sync` remains fail-closed because this Web
graph has no new App audit receipt. That result is expected and must not be
rewritten as a pass. Per the current user direction, keep the existing App
stable pointer byte-identical, mint no App receipt/schema, and publish only the
checksum-verified `formal-stable` Web artifact from a committed clean tree.
Rollback is the pre-release Pages deployment
`a257af4c-78a1-483d-bc9e-57e34e1d2dbe`; D1 is preserved.

## 2026-08-09 self-study-loop candidate gate (historical)

This was the executable acceptance standard for the 2026-08-09 candidate. It
is retained for provenance and does not supersede the current Web-only release
standard above.

### Source/content checks

```zsh
cd /Users/ylsuen/CF/yuwen-course
npm ci
npm run verify:study-guide-sources
npm run precontent:check
git diff --check
```

Required readback:

- five PDF and five extraction receipts match actual bytes and page counts;
- 30 classical assets declare `yw-classical-first-read-v1`, numeric version 1,
  UTF-16 offsets, no punctuation or annotation, and exact reader-text binding;
- catalog `yw-study-guides-f4c48caf4acbabb4` has 241 items / 193 active / 48
  inactive; every missing source answer is labelled `Codex 參考答案`, every
  open reference is non-unique, and review-required items cannot self-complete;
- formative `yw-formative-52b574175221646f` has 1,021 active items / 115 lessons
  / 48 tombstones and validates its exact active-set hashes, semantic history,
  authority and formal-manifest binding;
- reader projection remains 191 documents and the media ledger remains 165
  objects / 28,066,373 bytes with zero unreviewed anomaly;
- preview network policy rejects unregistered redirects, IP literals and active
  MIME, strips upstream CORS/cookies/frame controls, and the workerd
  HTMLRewriter test passes;
- isolated blocked native-content candidate builds are byte-identical, report
  the stale audit receipt as `review-required`, and carry the exact
  `canonical_graph_review_required` blocker. The test must not create or move
  `latest-stable.json`. A later App import additionally requires a new
  independent three-build audit receipt bound to the clean Web carrier; this
  Web-only candidate deliberately does not mint that receipt early.

### Browser acceptance

At desktop width and 390x844, verify at least one modern lesson and
`lesson-1534` / `lesson-1535`:

1. a logged-out classical first read does not retain guesses on a shared
   browser or unlock later stages;
2. an authenticated student can add three non-overlapping marks by pointer and
   keyboard, submit a summary, reload the immutable submitted state, then mark
   each difficulty resolved during close reading;
3. `注` stays inline, types once, opens with a unique occurrence ID, closes on
   a second click or blank-text click and respects reduced motion;
4. wrong -> correct -> correct vocabulary follows the server status and does
   not unlock early;
5. study-guide objective answers are graded by source logic; an open answer
   shows the explicit `Codex 參考答案` rubric and only the server result can mark
   completion;
6. classical pages have no duplicate `通讀正文`/`字句之改`; a modern page still
   has the three-word response and `字句之改`;
7. materials/slides/migration previews are expanded, unsupported items show an
   explicit fallback, there is no duplicate `此刻同讀`, and cross-book lookup
   targets exactly `https://xue.bdfz.net/`;
8. the interest slider distinguishes `已同步` from `本機已存／尚未同步`; local
   step progress is owner-scoped and never labelled as authoritative mastery;
9. `star.html` retains the three-word constellation and, when authenticated
   formative data is available, shows lesson/competency dynamic percentages;
   401/503 is unavailable rather than zero.

Close every task-owned browser/server and run the workspace orphan-browser
dry-run before closeout.

### Paired production gate

Production is prohibited until all items below are evidenced together:

1. independently reviewed and release-authorized User Center consumer deployed;
2. `GET /api/learning/health` returns the exact compound formal + registry +
   formative receipt and explicitly says it cannot affect scoring/A+;
3. authenticated formative read returns 200, unauthenticated returns 401, and
   manifest/ledger unavailability returns 503 without displaying 0%;
4. a fresh D1 export/bookmark exists, remote duplicate preflight is zero,
   migration 0004 applies additively, and `/api/reading/health` reads back every
   required table/index;
5. authenticated first-read and study-guide mutations, exact idempotent replay,
   User Center projection readback and Queue/outbox status all match without
   creating synthetic student progress;
6. a checksum-fixed preview deployment passes desktop/mobile/API/dependency and
   custom-domain immutable-object readback;
7. a clean formal Web carrier commit, production Pages UUID, created time,
   artifact manifest, immediate rollback and D1 no-loss rollback are recorded;
8. the native content receipt has an explicit App disposition. App import,
   signing and device acceptance remain a later task and do not begin from a
   preview or blocked receipt.

If User Center authority remains blocked or live learning health remains 503,
stop after the reviewed candidate. Do not deploy YW, apply D1 or hand a false
compatibility receipt to the App task.

### Latest local result (2026-08-09)

`PATH=/Users/ylsuen/.nvm/versions/node/v22.21.1/bin:$PATH npm run
prepare:preview-artifact` passed in full. Key executable results:

```text
classical first-read:       30 lessons / 102 paragraphs
study-guide catalog:        241 total / 193 active / 48 inactive
learning manifest:          9 / 9
study-guide builder:        3 / 3
study-guide assessment:     6 / 6
study-guide frontend:       3 / 3
evidence contract:          12 / 12
formative projection:       4 / 4
formative star UI:          2 / 2
reading identity:           4 / 4
local progress truth:       6 / 6
shared state:               13 / 13 + real-browser contract
Reading API + local D1:     65 / 65
native candidate:           21 / 21
release-site staging:       4 / 4
preview files:              614
preview aggregate SHA-256:  9da4db40dacb2b6a5026b14b4db416c98308d0b461600316f9f2b0941a859dcf
preview marker SHA-256:     de0f4ce971751ecf7d5a5390e1242005ea848abd6cf641b9feb9a172e883f69c
```

The staged Gitleaks pass reported only 213 `generic-api-key` pattern matches;
all 213 are the public schema field `itemKey` in the study-guide catalog and
formative manifest, with zero other match prefix. Native raw/decoded privacy
tests also passed. This classification must be repeated after any catalog
schema change.

The current native semantic candidate is `yw-9fad79d2acd5ab37986712da` /
`sha256:9fad79d2acd5ab37986712dab20277c2a8685066b4a637bc5adce709936d131a`.
It is correctly `blocked`: the tracked audit receipt still approves the prior
stable graph, `check:native-content:deploy-sync` rejects this candidate, and
`latest-stable.json` remains SHA-256
`a5ccd441deb7b0111517c9c1ec597b98e16a6dac789bd32bff3daa96960285a7`.
No production Pages deployment, D1 migration, User Center deployment or App
mutation is part of this local result.

### Pages preview binding isolation receipt (2026-08-09)

- clean pushed source: `918e66e2473ee298ce3af5f23598de9d3e659095`;
- primary isolated preview: `577ad2a8-b2eb-458f-8145-4791ec7cd5f5`, created
  `2026-08-09T05:22:52.419368Z`, URL
  `https://577ad2a8.yuwen-course.pages.dev`;
- all eight surviving preview deployments use that exact carrier and bind only
  D1 `39ed36d9-b3f3-40fd-933a-9a68a4066302`; project preview configuration has
  no service or Queue producer;
- production remained deployment `20be2885-5494-4b98-a130-af022c1a389b`,
  carrier `e87c697119d7d75d01def58ff781524f73bb3ff9`, D1
  `99c541e7-e70b-4584-b939-7e88a6dd68c5`, the named User Center service and
  production evidence Queue;
- 12 historical production-bound preview deployments and one wrong-carrier
  metadata deployment were deleted after every historical branch received an
  isolated successor;
- final old-host readback: ten 404 and two 302 to exact-host Access quarantine
  `5d768360-2dd8-458d-a743-182c9ced3b22` /
  `eaa5cef6-e21f-4182-b9ce-15d000136fee`. Two rounds at least 60 seconds apart
  across both observed Anycast addresses returned no old Worker;
- preview smoke: Reading health 200 with schema v4, learning health 503 as
  expected without User Center; production smoke remained Reading 200 and the
  pre-existing learning-health 503.

Private pre-change Pages project/deployment JSON is mode 0600 under
`/Users/ylsuen/CF/backups/yuwen-course/2026-08-09-production-rollout`. The
sanitized preview-isolation receipt is 3,465 bytes with SHA-256
`709b7b5a5d17c7cb15b319d1a01e8fbdce2de945a0b0b157d3272017765104f6`.
The exact pre-change SHA-256 values are:

```text
project:  eb0dc6ae3c662e04fb46bdabcb0b795ac720e9709c77ba532d9b6cc100906110
page 1:  36c62697bee008095836479c4e2d0df1843bafd687978243d65707ae4fbf3752
page 2:  2a63157003487680aff56bc65c4c87f6a1079ad9e1fb00099ce4fc264f65fbff
page 3:  6702c67884c2045ab49bd1d48c7c73a1b6accdb13a5948ea79e815e68fd38fd1
page 4:  4bdc535450074724f385be9372de0ecda768c08284cc0e99b25010c25839c9b2
```

Deleted atomic preview URLs cannot be restored directly, but all branch
aliases can be redeployed from the clean carrier. The custom domain and
production deployment were never moved.

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

## 2026-07-30 production readback (historical)

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
3. 關鍵契約核查：HTML 必須加載 `https://my.bdfz.net/site-auth.js`，`siteKey` 為 `yw`；AI 僅由 Pages Worker按 `runbooks/gemini_gateway_policy.md` 調用 `https://apis.bdfz.net`，響應使用 `data.answer`。結構提問不得冒充課文作者，必須以篇名或正文可定位文字為錨點並追問該文類的具體視角、時序、場面、論證或語言效果；互動評閱至少要求兩處正文證據，不能只複述「抽掉／換序」模板。A+ 見效證據僅包括選必上中下教材目錄內真正有服務端核驗結果的題目：AI 互動成功返回或字詞選項提交後，才以 manifest 中的穩定 `resourceKey` 寫受信作答；篇目 `evaluation` 評價是 `self_report + none`，只記錄而不計分、不作 A+ 條件；匿名狀態不得載入清單、排隊或寫入；錯答仍是已記錄的嘗試，但只同步為 `ineligible`，不得視為計分完成，且 `score`／`correctness` 必須保留真值；正文通讀勾選、查詞、導航、頁面瀏覽和教師課堂進度不是 A+ 題目。`npm run test:evidence-contract` 必須用 YW 真實生產函數構造投影，經 Queue producer mock 後由當前 User Center consumer registry 接受，並證明舊 `self_report + a_plus_gate` 投影會 fail closed。`npm run verify:ui` 覆蓋 User Center 回灌、APIS 細讀判定、QX 作者鏈接、教材 PDF 預覽和本地進度記憶，並固定核查：必修上下 13 個合併項必須穩定生成 35 個獨立篇目且舊合併 ID 不在 manifest；三段標題必須是「起始／細讀／延伸」；篇名下不得再顯示文體籤；所有模式的「叩問作者／提出問題」必須同時位於見效與掌握度最後；篇目評價只顯示 `1–5` 且無對話框；手機端掌握度必須緊接見效、頂部工具必須收為單一完整標籤入口；目錄必須在側欄展開動畫完成後以真實滾動手勢到達末篇；能力遷移區標題只顯示「高考」且 390px 不得左側擠壓；106 位署名作者必須全部有 QX 深鏈與圖像資產，65 個無署名篇目必須有與單元／作品／時代直接相關的 QX 代表人物、明示 `role`／`reason`／`evidenceLessonIds` 且不得冒充作者；無可靠肖像者必須標明「姓名卡」，篇首禁止書封與教材頁；`lesson-1484` 的 15 個正文註詞必須全部進入詞級疏通；所有設有詞級疏通的篇目不得錯報無獨立註詞；全部文言篇目不得出現新詞創作；全 189 篇作者／代表人物肖像可見性及 390px 移動端橫向溢出必須逐篇巡檢。另保留選必上默認及上次篇目記憶、詞級逐詞查典和彩條、答對自動前進且錯答留在原題重試、通讀無 AI 對話、數字上標註釋無孤行且逐字展開、A+ 與專注閱讀彩條、`chat.bdfz.net` 課內嵌入、三圖內部同頁切換而其他鏈接新頁、文體／書目時代和關係資料、星圖 `0.56` 全貌尺度。閱讀星圖契約（2026-07-14 起）：頂欄必須含 `star.html` 入口；`/star.html` 渲染與交互直接復刻 `jc-atlas`；三詞提交必須冪等（同詞重排/繁簡變體不生新記錄）、換詞生成新版本並保留沿革；星點 id/seq 穩定，佈局只由冊別／教材篇序／詞形哈希推導；未登入 401＋克制空態，嚴禁偽造星點或推斷進度；有題庫課文的詞級疏通必須走逐題過關並記錄作答／重試／掌握（本地＋D1＋UC 事件 `vocab-quiz:<lessonId>`），無題庫課文回退註詞逐查。
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
