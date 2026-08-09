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
`5377ff2b5a652fac2da3ff245c353a1b46de6a8974b7d642594e3ee377166c7d`;
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
