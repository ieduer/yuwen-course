# Project State

Last updated: 2026-08-13

## 2026-08-13 structured-error and recovery closeout candidate

- The generic `/api/learning/interactions` route now preserves the exact
  `classical_first_read_required` or
  `classical_annotated_reading_required` prerequisite, HTTP 422 disposition,
  non-retryable disposition and null timed-retry boundary. Timed submission conflicts keep
  their exact `retryAfterSeconds`; the browser evidence bridge returns these
  structured fields instead of collapsing them into `unavailable`.
- A route-level hostile test now forces the study-guide catalog cache to the
  prior digest while the formative cache observes the next digest. The Worker
  performs exactly one catalog reload, returns
  `study_guide_catalog_changed`/409, and makes zero APIS, learning-ledger,
  outbox or Queue writes.
- The exact canonical User Center SHA is supplied by the UC strong-workspace
  audit pin at review and release time. That audited source owns the hourly
  `scheduled()` source-health probe and calls the exact
  `https://yw.bdfz.net/api/learning/health` route. A request-context test now
  awaits that route's existing `ctx.waitUntil(drainEvidenceOutbox(...))` path
  through a monotonic `pending_mapping` to `accepted` receipt. YW remains a
  Pages project and adds no Cron Trigger or new runtime recovery mechanism.
- This candidate changes no scoring rule, catalog byte, formative authority,
  D1 row, Queue, Pages deployment, User Center source or App content. The App
  pointer remains byte SHA-256
  `a5ccd441deb7b0111517c9c1ec597b98e16a6dac789bd32bff3daa96960285a7`.
- Exact Node 24.18.0 and 22.21.1 each pass the complete
  `precontent:check` and the focused 41/41 structured-error, cache-skew and
  recovery set. The UC strong-workspace audit-pinned source-health suite passes
  6/6 on both Node authorities. This is a `no-new-capability` change: the
  existing Pages request context, D1, service binding and Queue contracts are
  unchanged.
- `.github/workflows/learning-contract-ci.yml` adds the repository's first
  read-only PR check: the exact Node 24.18.0/22.21.1 matrix runs the same 41
  focused source-contract tests with `contents: read` only. It has no deploy,
  Cloudflare credential, D1 or Queue step; the full local `precontent:check`
  remains the heavier release-source gate.

## 2026-08-13 scoring-correctness source candidate

- The current 241-item study-guide catalog remains structurally stable, but
  eight source prompts whose PDF review receipts omitted visible answer choices
  now reproduce those choices exactly. The content-addressed task authority is
  therefore `yw-study-guides-eae416d57be24516` (193 active / 48 tombstones),
  and the corresponding formative authority is
  `yw-formative-65a150df80285f4e` (1,021 items / 115 lessons / 48 tombstones).
  A future content update must mint new catalog and task-pool digests; it does
  not silently change the annual My scoring policy.
- Deterministic grading now reads only the answer lead, supports circled
  source choices, and handles quotation, colon, bracket, dash, ellipsis,
  punctuation and sentence-segmentation tasks without sending them to AI.
  Explanation prose can no longer smuggle another option letter. Open-response
  normalization preserves a genuine zero and rejects malformed or incomplete
  model output instead of inventing 60.
- Every `/api/interaction-check` evaluation now requires a User Center identity
  and reserves its durable per-user/resource slot before calling APIS. The same
  mutation cannot trigger a second evaluator; an evaluator failure still
  consumes the bounded slot, and the response reports the exact remaining
  window rather than prompting an immediate retry loop. The browser retains
  that mutation ID until a terminal durable receipt, so an explicit retry
  queries the same reservation rather than paying for another evaluator. APIS calls have a
  20-second abort boundary. The untracked legacy `/api/learning-check` scoring
  path is retired with HTTP 410.
- The Worker validates study-guide catalog digest plus semantic revision
  against the formative manifest before reservation/write, reloads both caches
  together once, and then fails closed on drift. Pages preview identity uses
  the exact `USER_CENTER_EVIDENCE` service binding and cannot reuse a cached
  production identity or fall back to public `/api/me`.
- No Pages deployment, D1/Queue write, UC mutation, Android pointer movement or
  production traffic change was performed by this source candidate. The
  foundation pointer remains byte SHA-256
  `a5ccd441deb7b0111517c9c1ec597b98e16a6dac789bd32bff3daa96960285a7`.
- Exact Node 24.18.0 and Node 22.21.1 each passed the complete
  `precontent:check`; the defect-focused matrix passed 61/61 on each runtime,
  Reading API passed 70/70, native-content passed 22/22 and release-site passed
  5/5. Formal Web-only artifact generation, commit/push and live readback remain
  separate release gates.
- Clean external checkouts no longer require the ignored, non-shipping
  `site/data/cache/` snapshot merely to prove removed lessons are absent. When
  that local developer cache exists it is still checked; formal staging keeps
  the entire prefix excluded and the release artifact remains content-addressed.

## 2026-08-13 external-executor release boundary

- Checkout production and rollback entrypoints are disabled. `package.json`
  deliberately exposes no `deploy` or `predeploy` script; local commands may
  build and verify immutable artifacts only.
- The first production wave is bounded to User Center plus YW. It may run only
  through the independently reviewed external executor after exact commits,
  fresh D1 backups, Queue topology, rollback anchors and live preflight pass.
  This does not claim fleet completion: the remaining source adapters stay
  withheld until their own versioned contracts and authenticated acceptance
  are verified.
- The foundation artifact deliberately preserves the live/Android pointer
  `yw-3e77f0f7ffa5d042a6d06763`, byte SHA-256
  `a5ccd441deb7b0111517c9c1ec597b98e16a6dac789bd32bff3daa96960285a7`.
  The stale `yw-82a4...` receipt is not a release authority; current native
  inputs must be regenerated and pass public readback plus physical-device
  acceptance in a later Web/App transaction before any pointer move.
- No Pages deployment, Queue/D1 write, traffic change or rollback was performed
  by this source update.
- The exact formal foundation artifact contains 1,223 files / 164,367,668
  bytes with aggregate SHA-256
  `947f3e297f5031a18fbefd0d63b2e955a7ffde5dbd76e93b6170332d6f66c278`;
  its tracked manifest byte SHA-256 is
  `5e50fd942dcf7b4095c8cdeef092c1a85142963de91380be835bec4271fd6025`.

## 2026-08-12 e310/v2 User Center source-contract candidate

- This isolated, source-only candidate makes the current Web manifest the
  explicit 2026–27 YW producer contract. It has 869 fully mapped resources:
  768 eligible `performance / a_plus_gate` units and 101 `evaluation`
  resources that remain visible but non-scoring. The annual requirement is
  fixed at 692 distinct `canonicalUnitId` credits and does not grow when the
  live task pool later adds a mapped release.
- Each formal event now uses `bdfz-learning-evidence-event-v2` with
  `schemaVersion: 2` and carries `contractVersion`, `sourceReleaseId`,
  `canonicalUnitId`, `resourceVersion`, `mappingVersion` and a source attempt
  identity. These preserve a real revised attempt while User Center dedupes
  Web, Android and resource revisions at the annual canonical-credit layer.
- The Web producer emits only e310/v2 for `2026-2027`. User Center retains a
  transition adapter for immutable b530/v1 evidence in `2025-2026`; it is
  historical-only and cannot enter the new-year numerator or denominator.
  Unknown future contract years withhold rather than falling through to F.
- Android remains a formal-resource client of this same Web source graph and
  shared User Center ledger. This candidate changes no Android inventory,
  package, release pointer or client-specific denominator.
- Evaluation and every other source fact remain unable to claim `weight`,
  `grade`, `points`, bands or source caps. Unknown releases/mappings must be
  durably held outside scoring until the central contract is activated.
- Additive D1 migration `0005_learning_evidence_central_receipts.sql` separates
  Queue transport (`pending`/`enqueued`) from the authoritative User Center
  disposition. The source outbox keeps unresolved v2 envelopes durably,
  re-emits stale rows after a transport failure, and stops re-emitting once a
  central `accepted`, `pending_mapping`, or `quarantined` receipt exists.
  `pending_mapping` continues to be polled and can advance to `accepted`
  or `quarantined` without another Queue send. Receipt updates compare and
  swap the exact previously read central disposition and count success only
  from D1 `changes=1`, so a stale pending poll cannot overwrite a concurrent
  terminal decision. Historical v1 rows are preserved and are never silently
  rewritten or sent into the v2 Queue.
- YW remains a Pages project. Pages cannot own a Cron Trigger or Queue
  consumer, so recovery is driven by ordinary authenticated interactions and
  the learning-health request that User Center probes hourly. The UC Worker
  owns the v2 main/DLQ consumers, bounded scheduled replay, and append-only
  replay receipts. Learning health projects only privacy-safe aggregate counts.
- After migration 0005, reading health is `reading-schema-v5` and requires the
  v2 recovery index. Before that migration, the candidate health check
  deliberately returns unavailable rather than claiming a usable outbox.
- No Pages deployment, Queue write, D1 migration, User Center release or App
  publication was performed. The production facts recorded in
  the following sections remain unchanged until the paired guarded release is
  separately authorized and read back.

## 2026-08-12 A+—F / App synchronization candidate

- The 723 student-visible active vocabulary questions now have one explicit
  authority split derived from `site/data/learning-manifest.json`: 382 exact
  questions remain formal source-evidence items and 341 remain available as
  local practice. Local-practice answers use the same mastery interaction but
  never call the source endpoint or claim evidence sync. This preserves every
  student question and the existing formal A+ denominator.
- Candidate branch `codex/yw-a-f-evidence-20260812` adds an exact native
  bearer identity path and exposes the current YW A+ activation receipt beside
  the already-live formative health receipt. The source manifest and scoring
  policy are unchanged; eligibility is still computed on the server.
- Android content generation now emits exactly 189 student-visible lessons and
  validates the two hidden Web records without bundling them. Candidate semantic
  digest is `sha256:82a4f9f2b5da4d1df4814db301c40a079a2ddcff03c3ac939a8ce4f9801199b3`.
- Historical anonymous interaction feedback remains local and cannot advance a
  checkpoint. New AI interaction evaluation requires authenticated My identity
  and an accepted durable source-evidence receipt; anonymous evaluation is no
  longer generated.
- Production remains the 2026-08-11 deployment below until the User Center
  native flags, Worker version, Web deploy and native release all pass their
  own guarded gates. No D1 row or production traffic is changed by this source
  checkpoint.
- The authority-split follow-up is source-only on
  `codex/yw-vocab-authority-20260812`; it has not been deployed and changes no
  D1 row, Queue message, User Center contract or App release pointer.
- The same source branch now projects the exact 30 classical first-read assets
  (102 paragraphs) into the immutable native-content graph. Every projected
  lesson retains the Web `textVersionId`, `textDigest`, UTF-16 offset unit and
  paragraph keys, with a receipt-bound native index and per-lesson object.
  This is a blocked development candidate only: the tracked stable pointer and
  formal 382-question inventory are unchanged. `node --test
  scripts/test_native_content.mjs` passes 22/22 locally; a clean Web commit,
  Pages deployment receipt, current native-content review and stable promotion
  remain release gates.

Package: `0.2.1-evaluation-nonscoring`. The deployed Web carrier is commit
`a97eba7589ed6afa7df30ba4f37f2241a22d90d0`, contained by current GitHub `main`.
Production serves Pages deployment
`18213286-37d1-4b71-80b6-78e8b986ed3d` at `yw.bdfz.net`; it was deployed at
2026-08-11T16:25:28.112875Z. The current override below supersedes the retained
2026-08-09 candidate/release narrative.

## 2026-08-11 Web reading finalization

- Students can use 189 lesson units. The source manifest retains 191 records,
  including two hidden system records; all 189 student-visible pages use one
  masthead: the redundant `先找方向` label is gone while `起始` remains with
  the lesson title and portrait. The owner-scoped local step indicator is
  collapsed beside the portrait instead of occupying the reading column. New
  readers default to 126%; stored local or remote font preferences still win.
  The atlas label and progress denominator derive from the 189 student units,
  while the two hidden system records cannot be opened by direct hash. A valid
  explicit lesson URL takes precedence over anonymous remembered history.
- All 30 classical lessons now require two consecutive reading stages. After
  the immutable `起始 · 無注疏初讀`, the submitted no-note reading remains
  visible beside source-bound learning tips and the annotated canonical text.
  Inline notes begin hidden, use numeric superscripts, type once, collapse on
  repeat click or Escape, and restore focus. Across 191 reader documents all
  2,933 annotation references bind to the preceding visible character or word.
  Vocabulary and vocabulary/syntax study-guide work unlock only after the
  student explicitly acknowledges the annotated reading; the server enforces
  the same non-scoring receipt gate and supports exact mutation replay.
- Student-visible `bdfz.yuque.com` links are removed. Nine WeChat article URLs
  project through exact `wx.bdfz.net` archive mappings. Every supported
  document, image, audio, video or iframe preview can expand to the full-page
  dialog and shrink back with focus restored. After deleting E01, the 16
  permanently unavailable resources and the separately confirmed-dead
  Bilibili item and the empty exact Sichuan gazetteer `content_30068` page, the
  fallback audit covers 351 page resources: 334 have
  reviewed screenshots, 11 use an already verified direct presentation, and
  6 stop embedding while keeping the original link because an external
  condition remains. The screenshot set includes 49 reviewed authenticated
  captures (22 `ctext.org`, 27 `forum.rdfzer.com`). There are 328 unique WebP
  files and 12,795,016 logical screenshot bytes; manifest SHA-256 is
  `30193e813611eb5e9ec09e2da99f81e5bca50597ed8b16839097eb70458333af`.
  Deleted resources are absent from the Web projection, preview registry and
  screenshot manifest; no permanent/remove blocker remains.
- Preview registration remains exact-target and fail-closed: 538 targets, 118
  redirect targets and 75 hosts with digest
  `sha256:887931515ae55b93d579a6892b5146ef68466c1e2c3ae5ed0c8022e00f2e84b7`.
  Seventeen approved BDFZ exact roots load the real remote sites in both card
  and full-page modes; safe QX figure fragments preserve their remote route.
  All 17 Wikisource and 99 exact Google Sites targets are screenshot-first;
  five reviewed YouTube resources are directly playable after an explicit
  student click. `content_22151` remains as a separate exact source.
  Arbitrary sibling paths and every `bdfz.yuque.com` URL remain forbidden, and
  `xue.bdfz.net` is absent from student resources and all preview authorities.
- Every one of the 189 student lessons now has a unique structure question
  tied to a reviewed focus or a literal text anchor and to the lesson's mode.
  The runtime rejects author impersonation and the generic
  `我是／抽掉／換序／最關鍵的材料` templates before caching.
- The study-guide catalog remains 241 items in 16 lessons, now 191 active and
  50 inactive/tombstoned (`yw-study-guides-9cb5500f46333aac`). The formative
  manifest is `yw-formative-20a7145bd573bbb7`, 1,019 items in 115 lessons with
  50 tombstones. Formal A+/A--F scoring remains unchanged.
- Production D1 already contains migrations 0001--0004 and Reading health is
  `reading-schema-v4`; compound learning health is 200. This Web task does not
  alter D1, User Center, the Queue contract, native App source, or the existing
  App `latest-stable` pointer.
- Runtime capabilities are unchanged: Pages + Assets, the existing D1, service
  binding and Queue. Reproducible release authority is Node `24.18.0`,
  lockfile-resolved Wrangler `4.100.0`, with no new Cloudflare capability.
- User direction pauses App and User Center follow-up until the Web learning
  experience is settled. Consequently the old App-content sync check remains
  truthfully blocked and no App receipt, schema or stable pointer is minted.
  The Web release uses the formal stable artifact already referenced by the
  unchanged pointer; the stable Pages rollback is deployment
  `8da16237-ac91-47e1-afe2-7843e2d4c8a4`, preserving every D1 row.
- The section-06 chat frame remains `about:blank` until `進入同讀` is selected;
  this prevents its remote input from taking focus and moving the parent page.
  Mobile lesson titles may use two lines, the 1024-pixel atlas starts closed,
  and vertical whitespace is tightened without removing reading content.
- Live readback of both the atomic deployment URL and `yw.bdfz.net` matches the
  formal release marker SHA-256
  `e384299f11f5695cfe118950bf4f486e1d803ba6fca4335816c49e03dac437c8`.
  Reading and learning health are 200, the online source/taxonomy counts are
  191/189, the deployed preview/screenshot authorities are 538/118/75 and
  351/334/11/6. Dedicated source-carrier browser acceptance is 32/32 for Web
  polish and 16/16 for embed playback; the live-domain browser closeout also
  verifies the no-autoload chat interval. The independent-load mobile sweep
  passed 189/189 lessons and 30/30 aggregate checks, including `lesson-1589`.
- Formal Web staging is current at 1,223 files / 1,222 projected files. Its
  marker is `formal-stable`, projected aggregate
  `0217dc7579cc58ed3c49364e850c0d0561437638383b8f8b621709ff4816050e`,
  marker SHA-256
  `e384299f11f5695cfe118950bf4f486e1d803ba6fca4335816c49e03dac437c8`
  and artifact-manifest aggregate
  `9513b0c02a02a1b7aa3e98201acf09fc2e9e9daf844ffeca02f528c92c87c785`
  over 163,876,528 bytes. The unchanged stable App release remains exactly 278
  included paths.

## Historical 2026-08-09 objective and implemented scope

The sections from here through the historical production/rollback authority
describe the 2026-08-09 candidate and are retained for provenance only. They
are not current deployment instructions; the 2026-08-11 override above is the
operational authority.

The candidate changes YW from a lesson-plan display into a student-owned
`資料 -> 過程 -> 評價` loop while preserving the existing start, close-reading,
selection lookup, modern three-word response and reading constellation.

- 30 classical first-read assets use reviewed textbook-reader text, remove
  punctuation and annotations, and declare UTF-16 offsets. An authenticated
  student records at least three immutable difficulty marks, guesses, elapsed
  time and a summary before the annotated reader unlocks. Keyboard-only marking
  and post-submit resolution are supported.
- Five source PDFs are verified by bytes, SHA-256, page count and extraction
  receipt. The derived study-guide catalog is
  `yw-study-guides-f4c48caf4acbabb4` /
  `sha256:f4c48caf4acbabb44e14b6d01011c91cb8b659845cf492cecd43348424aa575d`:
  241 items in 16 lessons, 193 active and 48 inactive. Missing source answer
  keys are visibly labelled `Codex 參考答案`; open answers are non-unique and
  assessed against a reference framework/rubric.
- The formative manifest is `yw-formative-52b574175221646f` /
  `sha256:52b574175221646f466a1f55c64730195a99e2756c59a6ea83717da8811832c9`:
  1,021 active items in 115 lessons and 48 retained tombstones. Its public unit
  is `lessonId + competencyTag`; completion is the intersection of valid ledger
  completion keys with the current active set. Item keys remain internal.
- The interaction registry is `yw-interactions-2026-08-09-v2`. The frozen
  formal manifest is separately `yw-e310d45b1d81e9ad` / 869 items. Formative
  mastery cannot alter A--F, A+ or scoring coverage.
- Reader media remains 165 unique objects / 28,066,373 bytes with inventory
  `2c7672e88dc8e1bb0ea1e4af84e59ccaf521ded73e774e35c03abd5547f69d03`.
  The refreshed reader semantic digest is
  `sha256:c53a5c9d86ef10b0e82f3f9951be49b0b0fc0207b934c72cf3218f4df4805f2d`.
- Inline typewriter annotations, expanded resource/slide/matrix previews,
  semantic-query-preserving deduplication, a historical cross-book link,
  0--100 interest slider, owner-scoped local progress and a four-axis formative
  star projection were implemented. The historical cross-book resource is not
  part of the current Web release.
- Migration `0004_classical_first_read_and_outbox_index.sql` adds first-read,
  idempotency/rate-slot and stable identity-link structures. It has not been
  applied to production.

## Historical 2026-08-09 verified candidate behavior

Targeted gates cover first-read submit/immutability/reconcile, vocabulary
wrong-to-right mastery, study-guide source assessment, evidence idempotency,
dynamic formative denominator, stable identity, preview HTML/MIME/network
policy, expanded resource previews, local-progress truthfulness, reader media,
Web projection and desktop/mobile UI. The full command and final receipts are
kept in `docs/VERIFICATION.md`; a passing local test is not production proof.

The latest complete local `prepare:preview-artifact` run passed under the
locked Node 22.21.1 toolchain. It produced a `preview-web-only` tree of 614
files with projected aggregate
`9da4db40dacb2b6a5026b14b4db416c98308d0b461600316f9f2b0941a859dcf`;
all 947 native-content source paths are excluded. The derived native semantic
candidate is `yw-9fad79d2acd5ab37986712da` /
`sha256:9fad79d2acd5ab37986712dab20277c2a8685066b4a637bc5adce709936d131a`
with `appDisposition=blocked`. Its old audit receipt is intentionally reported
as `review-required`, and the existing stable pointer remains byte-unchanged at
`a5ccd441deb7b0111517c9c1ec597b98e16a6dac789bd32bff3daa96960285a7`.

Review rejected the earlier User Center candidate
`f1874e5cc2ed39a907f50c2badfb4cfd7aba55f6` based on canonical main
`844cab6e30590e9853177e55d96944ae7829b88f`: although its formative projection
was non-scoring, it also changed the frozen YW A+ source denominator. A smaller
consumer-only replacement that preserves the canonical A+/A--F snapshot is
under isolated review. No User Center candidate is deployed or authorized by
the current root guard.

## Historical 2026-08-09 release blockers and deferred work

1. Production `GET /api/learning/health` returns 503 under the old
   Web-to-User-Center handshake. The new compound receipt requires a separately
   authorized User Center deployment before the YW producer may ship.
2. The current User Center candidate records
   `deploymentAuthorized=false` and `installedRootGuardCompatible=false`.
   This repository must not bypass, reseal or replace that authority.
3. Production D1 does not yet contain migration 0004. The remote duplicate
   preflight passed read-only; a fresh export/bookmark, additive migration and
   schema readback are still required during an authorized paired release.
4. Teacher/class aggregate difficulty portraits are deferred. Current session
   and Seiue class data do not provide a session-stable, complete and
   event-time-authoritative manageable-class scope; only student owner-scoped
   records are safe in this release.
5. Android import, signing, APK publication and device acceptance start only
   after a production Web compatibility receipt. The native App repository and
   existing `latest-stable.json` are intentionally untouched.
6. The blocked native semantic candidate still needs an independent clean
   three-build App-content audit after a production Web carrier exists. A stale
   audit receipt is a deliberate release blocker, not an approval shortcut.
7. Pages preview isolation completed on 2026-08-09. Dedicated D1
   `yuwen-reading-db-preview` (`39ed36d9-b3f3-40fd-933a-9a68a4066302`) contains
   migrations 0001--0004; preview has no User Center service or Queue binding,
   while production bindings remain explicit under `env.production`. Eight
   branch-latest previews carry exact clean source `918e66e2473ee298ce3af5f23598de9d3e659095`.
   All 12 historical production-bound preview deployments were deleted; ten
   hash hosts return 404 and the two Cloudflare edge routes that outlived their
   control-plane deletion are quarantined by exact-host Access app
   `5d768360-2dd8-458d-a743-182c9ced3b22` and deny policy
   `eaa5cef6-e21f-4182-b9ce-15d000136fee`.

## CAPABILITY_FIT — self-study loop candidate (`blocked`)

1. **Problem.** Replace teacher-facing lesson-plan display with a measurable
   student-owned first-read, correction, assessment and transfer loop. Success
   requires source-bound content, immutable process evidence, a current dynamic
   denominator, authenticated read/write replay and live User Center/App
   compatibility—not merely a rendered page.
2. **Source authority.** Canonical source is this repository on
   `codex/yw-self-study-loop-v2`, targeting Cloudflare Pages project
   `yuwen-course`; production branch remains `main`. The paired User Center work
   exists only in the isolated clean candidate documented above. App, root
   release guard, routes and User Center migrations 0038/0039 are excluded.
3. **Runtime fit.** Retain the established Pages Functions + Assets runtime.
   Existing approved D1, Service Binding and Queue capabilities match durable
   student state, same-account identity RPC and asynchronous evidence delivery.
   This rollout adds one dedicated preview D1 resource using the already
   approved D1 capability; preview intentionally receives no User Center or
   Queue binding. The stable Pages site is not migrated to Workers + Static
   Assets without measured benefit.
4. **Data fit.** D1 is the authoritative YW process ledger; mutation IDs,
   transactions, rate slots and outbox rows provide idempotency and retry.
   Student free-text responses are bounded and retained only in YW D1; the
   queue/User Center envelope is privacy-minimized. Migration 0004 is additive,
   requires a fresh remote export/bookmark and schema readback, and is never
   rolled back with destructive table drops.
5. **Official maturity.** Pages, D1, Service Bindings, Queues and Access are existing
   stable capabilities classified `approved` by the workspace policy refreshed
   2026-08-08. This candidate adds no beta dependency or pricing plan. The new
   preview D1 is a small isolated non-production resource whose storage and
   operations remain within the existing D1 billing/limits; current account
   readback remains `usage_model=standard`. Access is used only as a reversible
   exact-two-host quarantine for deleted preview routes that had not yet
   converged at the edge; it does not cover the custom domain or new previews.
6. **Toolchain.** Release checks use Node `22.21.1`, lockfile-resolved Wrangler
   `4.100.0`, fixed compatibility date `2026-05-12`, generated-schema checks and
   byte-current manifests. `always_use_latest_compatibility_date=false` in live
   preview and production configuration.
7. **Exposure.** The existing custom domain is `yw.bdfz.net`. Preview uses the
   dedicated D1 above and omits the production identity service and evidence
   Queue, so authenticated/student-data routes fail closed there. Old
   production-bound deployments are retired; the two stale edge hostnames are
   deny-all quarantined until deletion has converged everywhere.
   `robots`/Content-Signal policy, custom routes and public registration are
   unchanged by this candidate.
8. **Hub fan-out.** Contracts touch User Center identity/evidence, the shared
   APIS gateway, the evidence Queue and the downstream native App. Nav, image
   and Pulse surfaces are not mutated. User Center must deploy consumer-first;
   App import/signing/device work remains sequenced after the exact Web receipt.
9. **Privacy/security.** Data class is `student_owned`. Only the verified stable
   User Center user ID owns records; only the named session cookie crosses the
   RPC boundary. Raw answers stay in YW D1 and are excluded from the outbox;
   logs/receipts contain no cookie or student payload. Teacher aggregation is
   blocked until fresh, complete class authorization exists.
10. **Resource guard.** Responses and raw payloads are bounded; scoring and
    non-scoring submissions have per-resource/global windows; mutation replay
    is immutable; malformed AI output fails closed; queue failure remains in a
    retryable outbox. No new cost surface is introduced. Existing platform/APIS
    limits remain the outer ceiling, and a 503 health receipt is a stop signal.
11. **Verification.** Locked-toolchain local tests, workerd preview sanitization,
    local D1 concurrency/replay, full projection, privacy scan and native-tree
    exclusion pass. Preview binding isolation and historical deployment cleanup
    passed. Release still stops on live learning health 503, absent production
    migration 0004, unauthorized User Center deployment or any authenticated
    mutation/readback mismatch.
12. **Exit.** The immediate rollout source backup is
    `backup/yw-pre-production-rollout-20260809` at
    `cf9a8ec17c026526c98172970630df3261d76a68`; the older baseline backup remains
    `backup/yw-self-study-loop-pre-20260809` at `037484f8`. Pages rollback
    anchors are listed below. Preserve D1 during code rollback; use the fresh
    pre-migration export for disaster recovery and backward-compatible
    forward-fix for additive schema. App stable content remains untouched.

## Historical 2026-08-09 production and rollback authority

- Pages project / host: `yuwen-course` / `https://yw.bdfz.net/`
- Historical production deployment at that closeout:
  `20be2885-5494-4b98-a130-af022c1a389b`
- Historical production carrier commit at that closeout:
  `e87c697119d7d75d01def58ff781524f73bb3ff9`
- Immediate rollback deployment:
  `ada922c5-62e7-46cc-bcd7-7e97dddcc522`
- Receipt-validated historical anchor:
  `609fdc2b-0410-4f14-b553-b0df3916b6df`
- D1: `yuwen-reading-db`; preserve every row and all additive tables during a
  Pages rollback.
- Current App-compatible content remains
  `yw-3e77f0f7ffa5d042a6d06763`; do not move its stable pointer for this blocked
  Web candidate.

Historical next action (superseded by the 2026-08-11 override): finish the clean
deterministic Web candidate and independent review, then obtain a separately
authorized User Center release. Only after the
compound health receipt is live may the task back up/apply D1, deploy a Pages
preview/production artifact, perform authenticated mutation/replay/readback and
hand the exact Web receipt to the App follow-up task.
- Opening-before-school transport verification does not falsify the academic
  year. From Beijing time 2026-08-12 00:00 until (but excluding) 2026-09-01
  00:00, User Center may accept only the exact server-timed `lessonOpened`
  shape with `lessonPhase=release_canary`, `trace / none / non_scoring` and all
  numeric results null. It is audit-only and can create no credit, snapshot,
  grade or F; delayed replay after the boundary is quarantined. The normal YW
  route explicitly rejects client-supplied `occurredAt` or `academicYear`.
