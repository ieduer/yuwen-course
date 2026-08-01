# Project State

Last updated: 2026-07-31

Current version: package `0.2.1-evaluation-nonscoring`; repository HEAD
`77ed26395dbc02ca4bbeca4cf2b7003d34619628`

Current objective: release the owner-scoped YW Web/App reading-position and
text-scale linkage through User Center without mixing accounts, reviving a
durably deleted remote value, or weakening the source-owned evidence contract.

## Completed work

- Web content authority covers 5 books, 191 lessons, and 1,153 posts.
- Current compatible native content version is
  `yw-3e77f0f7ffa5d042a6d06763`.
- Web/App content receipt and stable pointer digests are recorded in
  `docs/MAINTENANCE_MANUAL.md`.
- Source-owned eligibility, anti-farming, idempotency, ineligible evidence,
  non-scoring evaluation, D1 ledger/outbox, and Queue projection contracts are
  implemented and verified.
- The latest Web content transaction is recorded as
  `compatible-and-synced`.
- The pending source release adds only owner-scoped reading position and
  `TEXT_SCALE` synchronization through `/api/yw/v1/state` and idempotent
  mutation receipts. Generic progress hydration has been removed; no answer,
  score, mastery, completion, or learning-evidence field enters this shared
  state path.
- Local release acceptance passes 13/13 shared-state unit tests, fresh real-
  browser owner-switch/offline/delete/process-race coverage, and the complete
  formal release gate. The checksum-fixed staging artifact contains 853 files
  with aggregate SHA-256
  `971e416cf0831f7e54ce907a22c9e97bc8582eb9e0f26dcad422a81bf1523f6a`.

## Pending work

- Keep future content releases fail-closed on clean source, deterministic
  generation, media receipts, public immutable-object readback, and one explicit
  App disposition.
- Refresh the synchronized production/rollback block and state after the next
  Pages or native-content release; preserve historical sections as dated
  evidence.
- Deploy and live-verify the pending shared-state artifact only after the
  matching User Center routes are production-ready, then replace the current
  deployment and rollback anchors below with the exact readback.

## Known problems

- The maintenance and verification manuals retain dated historical release
  evidence. Agents must use the current synchronized production block and
  canonical report, not an older historical anchor.
- Native authentication, central-data mutation, signed App release, and device
  acceptance are separate native-project gates and must not be inferred from
  the Web content receipt.

## Next recommended task

At the next Web content change, produce a bounded Web/App specification, run the
formal deterministic content and evidence gates, create a checksum-fixed Pages
preview, verify browser/API/dependency behavior, then record the App disposition
before any production or stable-pointer action.

## Deployment status

- Pages project: `yuwen-course`
- Production host: `https://yw.bdfz.net/`
- D1: `yuwen-reading-db`
- Canonical report production deployment:
  `20be2885-5494-4b98-a130-af022c1a389b`
- Canonical Web production source:
  `e87c697119d7d75d01def58ff781524f73bb3ff9`
- Compatible content version:
  `yw-3e77f0f7ffa5d042a6d06763`

Rollback anchor: Pages deployment
`ada922c5-62e7-46cc-bcd7-7e97dddcc522`; preserve D1 rows and immutable
native-content objects during a static rollback.

Refresh Pages deployment, D1 migration state, public content objects, Pulse,
User Center, and the native disposition before any release mutation.
