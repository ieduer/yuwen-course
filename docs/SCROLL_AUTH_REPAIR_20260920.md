# Reader scrolling and identity refresh repair

A production focus event on lesson-1474 moved the authenticated reader from
scrollY 1440 to 0. Each recovery event cleared the established owner and
first-read cache, rendered a locked/offline lesson, then reloaded it with an
unconditional scroll-to-top. Background shared-state application could also
replace the active lesson with a remote resume point. A failed session request
incorrectly displayed the login link as if logout had been confirmed.

The reader now pauses learning writes while checking identity, retaining the
same owner's DOM, drafts and first-read cache. Only confirmed owner changes or
failed owner re-verification discard private state. A failed session request
keeps the reader visible and inert, with a non-shifting connection status;
confirmed logout still clears private state and shows login. Cloud resume is
applied when entering an account, while subsequent synchronization updates the
saved resume point without changing the open lesson. Reloading the same lesson
no longer explicitly scrolls to the top. Navigating during a pending identity
check restores authoritative controls on the newly selected lesson.

Validation: Node 24.18.0 full precontent checks passed. Real Chromium fixtures
at 1280 and 390 pixels cover exact scroll preservation, unchanged reader DOM,
zero redundant first-read fetches, overlapping focus/visibility/online events,
remote resume changes, session failure/recovery, navigation during identity
checks, account switching and logout. Existing owner-scoped outbox, pending
write isolation and stale callback regressions also pass. Fixtures use only
synthetic local data. Live reproduction used the existing authorized account
and retained only the aggregate scroll/authentication result.

This is a Web leaf change. Backend, identity API contracts, student data,
native pointer and immutable App content are unchanged. App disposition:
compatible-no-client-release. Release uses the existing external v2 Pages
executor, with a fresh exact source/artifact receipt and the captured previous
production deployment as rollback; preserve all forward data.

Release and live acceptance evidence:
/Users/ylsuen/CF/reports/operations/yw-scroll-auth-20260920/REPORT.md
