# Project State

Last updated: 2026-08-09

Package: `0.2.1-evaluation-nonscoring`. Candidate branch:
`codex/yw-self-study-loop-v2`, based on
`037484f8c4231277165d17ccce5b25b4431c7e3e`. This file describes a local Web
candidate; production still serves the 2026-07-30 release below.

## Objective and implemented scope

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

## Verified candidate behavior

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

The paired clean User Center consumer candidate is
`f1874e5cc2ed39a907f50c2badfb4cfd7aba55f6` based on canonical main
`844cab6e30590e9853177e55d96944ae7829b88f`. It keeps formative health and
mastery outside growth-source activation and A+/A--F scoring. It is not deployed
and is not release-authorized by the current root guard.

## Active release blockers and deferred work

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
7. Preview isolation is being established with dedicated D1
   `yuwen-reading-db-preview` (`39ed36d9-b3f3-40fd-933a-9a68a4066302`). The
   source configuration gives preview no User Center service or Queue binding;
   production bindings are explicit under `env.production`. A public preview
   remains blocked until the isolated configuration is deployed and every old
   preview deployment carrying production bindings is retired.

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
5. **Official maturity.** Pages, D1, Service Bindings and Queues are existing
   stable capabilities classified `approved` by the workspace policy refreshed
   2026-08-08. This candidate adds no beta dependency or pricing plan. The new
   preview D1 is a small isolated non-production resource whose storage and
   operations remain within the existing D1 billing/limits; current account
   readback remains `usage_model=standard`.
6. **Toolchain.** Release checks use Node `22.21.1`, lockfile-resolved Wrangler
   `4.100.0`, fixed compatibility date `2026-05-12`, generated-schema checks and
   byte-current manifests. `always_use_latest_compatibility_date=false` in live
   preview and production configuration.
7. **Exposure.** The existing custom domain is `yw.bdfz.net`. Preview uses the
   dedicated D1 above and omits the production identity service and evidence
   Queue, so authenticated/student-data routes fail closed there. Old preview
   deployments must be retired before the isolated preview is accepted.
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
    exclusion pass. Release stops on shared preview bindings, live learning
    health 503, absent migration 0004, unauthorized User Center deployment or
    any authenticated mutation/readback mismatch.
12. **Exit.** Source rollback is
    `backup/yw-self-study-loop-pre-20260809` at `037484f8`; Pages rollback
    anchors are listed below. Preserve D1 during code rollback; use the fresh
    pre-migration export for disaster recovery and backward-compatible
    forward-fix for additive schema. App stable content remains untouched.

## Production and rollback authority

- Pages project / host: `yuwen-course` / `https://yw.bdfz.net/`
- Current production deployment:
  `20be2885-5494-4b98-a130-af022c1a389b`
- Current production carrier commit:
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

Next safe action: finish the clean deterministic Web candidate and independent
review, then obtain a separately authorized User Center release. Only after the
compound health receipt is live may the task back up/apply D1, deploy a Pages
preview/production artifact, perform authenticated mutation/replay/readback and
hand the exact Web receipt to the App follow-up task.
