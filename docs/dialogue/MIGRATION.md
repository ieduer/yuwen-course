## Current candidate update — 2026-10-12T06:21:48+00:00

The additive set is now 0010, 0011 (durable stream chunks and usage/timing) and 0012 (money reservations and policy snapshot). Apply all three only after the existing backup/restore, row-level reconciliation and exact release gates. The synthetic preservation test compares every pre-0010 table schema, every seeded row/relationship and SQLite sequence after the whole migration set. No live migration has occurred.

Owner-only all-My access and permanent transcript retention are user-approved. No teacher cross-account access is enabled. The feature and APIS streaming flags remain off; the cost policy is not loaded in production. Recovery disables new calls while retaining every forward row and permanent transcript. Unknown provider outcomes retain their monetary reservation; stale work is reconciled without automatic replay. Export includes questions, events, drafts, partial chunks and policy/usage/timing receipts.

Historical notes below describe the first candidate; their unimplemented-stream/recovery and retention-pending statements are superseded by this update and PILOT.md. Remaining current acceptance gates are in GO-NO-GO.md.

# Migration and rollback — preparation only

As of 2026-10-12T04:16:33+00:00. Migration `0010_dialogue_pilot.sql` has **not been applied to a remote database**. It creates seven new tables plus indexes. It does not alter, update, backfill, delete or regrade existing learning tables. Do not run it from this document alone.

## Preflight required before a real pilot

1. Resolve the current release transaction and owner in `/Users/ylsuen/CF/platform/release-authority.json`; use `runbooks/release_authority_governance.md`. Bind the exact accepted repository/branch/commit, built artifact hash, actual account/domain, live Pages/config baseline and rollback. The baseline Git commit of this candidate is not release authority. Another task's staged publication must be reconciled first.
2. Verify actual D1 identity and schema with the intended authorized account. The local Wrangler configuration names production `yuwen-reading-db` and a distinct preview database. Never use preview rows as production history proof. The Cloudflare connector rejected this task's account read; its subsequent D1 query did not execute. No credential substitution or repeated production attempt was made.
3. Use the project's currently accepted encrypted backup/archive controller and restore authority. Create a fresh full backup and verify a separate isolated restore before migration. A Time Travel bookmark, export-success message or backup job exit code alone is insufficient. Do not introduce an ad hoc export into a public repository or a second scheduler.
4. Record source DB/schema versions, backup hash/object/version and restore location privately. Enumerate all old tables, indexes, triggers, columns, primary keys, sequence values and relationships. Compute deterministic per-row hashes keyed by primary key, including raw answers, feedback, timestamps, scoring-rule versions where present and unfinished sessions. Do not invent absent metadata. Compare all rows and parent/child links on the isolated restore, including old shared progress held outside this D1. Public reports contain counts/hashes only.
5. Apply 0010 to the isolated restored copy, then repeat the same row/schema/sequence/relationship comparison. Require exact old-row identity and content equality, zero missing relationships and successful integrity checks. Test a new synthetic dialogue, deferred draft and rollback to the previous Worker against this expanded schema. Fix every discrepancy before remote migration.
6. Obtain the existing one-page suen review. Only after grading equivalence, privacy, budgets, streaming/dependencies and relevant content acceptance are resolved may an approved migration and feature-off deployment proceed. Register/verify the normal Web/App transaction disposition; original content is unchanged but new Web behavior still needs its documented disposition.
7. Enable only explicitly accepted non-sensitive acceptance accounts first. Verify real authentication, save/readback, interrupted responses, dictionary sources, provider ledger, historical completed and unfinished records, real phones and teacher access. Expansion requires those actual results, not this test count.

## Current record-level result

The local migration test loads 0001–0009 into in-memory SQLite, seeds synthetic historical scores, exact raw submissions/feedback, submission-word relationships, star sequence, mastered vocabulary, unfinished first-read session/mark, source evaluation/rule version and accepted outbox. It snapshots every old table's schema and complete rows plus SQLite sequences, applies 0010, and compares the same objects for exact equality. Foreign-key and integrity checks pass; the old 83/100 score and unfinished submitted_at=NULL remain unchanged. Existing migration seed rows are also compared.

This proves the additive migration on that controlled fixture. It does **not** prove the remote schema matches the fixture, that all live historical metadata is available, or that a real backup is restorable. Production comparison count: not obtained, not zero. No production records were sampled or printed.

## Rollback

Disable the feature through the exact accepted release transaction, then restore the verified preceding Worker/Pages artifact and configuration while preserving all forward data. Keep 0010 tables, session curriculum snapshots, new turns, question instances, evidence, events, call ledger and deferred drafts. Do not down-migrate, drop the tables, rewrite old grades or restore an older database over newer work.

After rollback, verify the old authenticated course/history path and preserved unfinished work; prove new pilot records remain exportable under an authorized recovery path before closeout. Any isolated backup restoration is a separate governed operation. Re-enabling resumes existing immutable session curricula, not a fresh session to reset attempts/costs.

Hard interruption recovery remains unimplemented: an old reserved call must be reconciled without re-calling an uncertain provider, and its slot released with an auditable disposition. Do not repair it with a blanket UPDATE or automatic retry. This blocks real enablement.
