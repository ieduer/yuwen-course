# Dialogue data preservation — accepted snapshot, not a release

Accepted2026-10-12T11:04:47.258Z. Source candidate244f02ca2c2d1bfae397f4f3271d3ea0f4209c31;0010–0013 migrations remain unapplied remotely. Student data writes0, historical regrading0.

The user explicitly approved the exact encrypted YW backup destination and a separately bounded second restore-only attempt after the first upload timeout. The first attempt stopped, deleted its exact temporary D1 and verified GET404; it was never silently replayed.

| Check | Evidence |
| --- | --- |
| Source snapshot | yuwen-reading-db99c541e7-e70b-4584-b939-7e88a6dd68c5;54,504,651byte SQL; SHA-256e29c2be6ed48f20054c6969b4d64d307e1526b0ba3e3c9c59f54f5ea640f82d7 |
| Recoverable backup | Existing owner age recipient; private R2 exact unique ciphertext10,637,148bytes; full remote download, ciphertext hash, decryption, decompression and SQL hash matched |
| Native D1 restore | All28application tables/39,540typed rows,62schema objects and sqlite_sequence equal after import into a new isolated D1 and complete SQL re-export |
| Additive migration dry run | Local0010–0013 applied to a copy of this snapshot; every old schema object, row value/type and sequence preserved; foreign-key violations0before/after;8new dialogue tables empty |
| Cleanup | Both temporary D1s deleted and same-idGET404;18private local SQL/SQLite/gzip/cipher derivatives,746,645,518bytes removed after no-open-handle verification |
| Limits | Backup attempt16/120calls, terminal upload timeout; separately approved restore13/80calls,20minute overall bound,54.5MB upload373,071ms within600seconds |

Exact source/library/publisher hashes, receipts, approved immutable object key, recipient fingerprint and recovery procedure: [central backup/restore authority](/Users/ylsuen/CF/reports/operations/yw-dialogue-20261012/continuation-01a12f95/BACKUP-RESTORE.md). That guide links the original failure, both explicit authorizations, whole-row comparison and cleanup evidence. The encrypted recovery anchor is retained under those authorizations, review2026-10-26; no automatic deletion is authorized.

This proves recovery of the named snapshot. Before a production migration, reconcile the current live baseline and records/relationships, preserve all forward writes, and confirm backup coverage is suitable for the exact transaction. Do not restore a stale full database to undo a dialogue feature. Normal rollback disables the feature or restores the accepted application while preserving new and historical data. APIS fanout, real teaching/stream/identity/cost acceptance and independent suen review remain open.
