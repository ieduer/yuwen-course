# Project State

Last updated: 2026-08-11

Package: `0.2.1-evaluation-nonscoring`. Current Web candidate branch:
`codex/yw-web-content-finalize-20260811`, based on clean source
`a85cf94cc7f5193417b059b504e03693e3046be1`. Before this candidate is
published, production serves Pages deployment
`d017e7db-08f9-47fe-b348-4f40c29db474` from that same source. The current
override below supersedes the retained 2026-08-09 candidate/release narrative.

## 2026-08-11 Web reading finalization

- Students can use 189 lesson units. The source manifest retains 191 records,
  including two hidden system records; all 189 student-visible pages use one
  masthead, with the former `01 / 先找方向 / 起始` content merged with the
  lesson title and portrait. The owner-scoped local step indicator is collapsed
  beside the portrait instead of occupying the reading column.
- All 30 classical lessons now require two consecutive reading stages. After
  the immutable `起始 · 無注疏初讀`, the annotated canonical text appears with
  inline notes hidden by default. Notes type once, collapse on repeat click or
  Escape, and restore focus. Vocabulary and vocabulary/syntax study-guide work
  unlock only after the student explicitly acknowledges the annotated reading;
  the server enforces the same non-scoring receipt gate and supports exact
  mutation replay.
- Student-visible `bdfz.yuque.com` links are removed. Nine WeChat article URLs
  project through exact `wx.bdfz.net` archive mappings. Every supported
  document, image, audio, video or iframe preview can expand to the full-page
  dialog and shrink back with focus restored. After deleting E01, the 16
  permanently unavailable resources and the separately confirmed-dead
  Bilibili item, the fallback audit covers 353 page resources: 335 have
  reviewed screenshots, 11 use an already verified direct presentation, and
  7 stop embedding while keeping the original link because an external
  condition remains. The screenshot set includes 49 reviewed authenticated
  captures (22 `ctext.org`, 27 `forum.rdfzer.com`). There are 329 unique WebP
  files and 12,816,592 logical screenshot bytes; manifest SHA-256 is
  `95b8929c4b0bce0ddde45f4eb7941275e9660708704518ad23d5de825c58e17d`.
  Deleted resources are absent from the Web projection, preview registry and
  screenshot manifest; no permanent/remove blocker remains.
- Preview registration remains exact-target and fail-closed: 540 targets, 119
  redirect targets and 76 hosts with digest
  `sha256:08b55ba18ccbea706b4755a7e4c1a5de276d5588a5c748bc1ed82dcc00e6968a`.
  The 18 approved BDFZ subdomain roots, exact Google Sites and exact
  `pkuschool.yuque.com` lesson URLs are registered; arbitrary sibling paths and
  every `bdfz.yuque.com` URL remain forbidden.
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
  unchanged pointer; immediate Pages rollback is the pre-release deployment
  `d017e7db-08f9-47fe-b348-4f40c29db474`, preserving every D1 row.
- Formal Web staging is current at 1,222 files / 1,221 projected files. Its
  marker is `formal-stable`, projected aggregate
  `6b156f53be4876769cad7e523645c25e510dca4f7c96b9445936842056fffe29`,
  marker SHA-256
  `579d588eab5718551da61b6009789631e9a710cc2fc9f1b6cc46588f64f74bb6`
  and artifact-manifest aggregate
  `bde95d8ba08d7a883dcb1fdbefd9d36f54d791b1e20efb234126bd9003a112fb`
  over 163,807,598 bytes. The unchanged stable App release remains exactly 278
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
  semantic-query-preserving deduplication, the `xue.bdfz.net` cross-book link,
  0--100 interest slider, owner-scoped local progress and a four-axis formative
  star projection are implemented.
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
