# Dialogue candidate changelog

## 2026-10-12T04:16:33+00:00 — disabled three-lesson candidate, not released

- Added a generated per-resource requirement map with source versions, compound first-read/guide gates and poetry word creation; retained all legacy source files and grade behavior.
- Added original-text/conversation views, annotation/quote navigation, on-demand references/shared textbook images/dictionary, and private evidence summaries/exports.
- Added source-owned evidence validation, stable question instances, bounded calls, idempotent persistence, owner isolation, deferred budget drafts and immutable session curriculum snapshots.
- Added additive migration and synthetic regression/browser harness. No remote migration, model call or production deployment.
- Documented explicit release blockers and source/restore/performance evidence. Existing Pulse and public Status remain unchanged because there is no accepted public release.

- Fixed the existing Reading API fixture to copy both newly imported Worker modules. Its isolated local D1 run passes all 74 assertions; the first CI failure was a missing fixture module, not a student-data migration.
- Regenerated the existing formal artifact baseline with the standard local build/check scripts after adding the pilot files. This is build evidence, not release authority.
