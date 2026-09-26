# Authenticated detailed-learning recorder bridge

Candidate integrated 2026-09-26 with accepted binding correction PR65/source `41c8ceee28616308888a21af782475b57140ba1d`.
This is a Web-only transport for the immutable `learning_evaluation_events`
already introduced by migration0009. It does not re-evaluate an answer, replay
grading, or change the existing v2 score outbox. No new schema, secret, service
binding, Worker deployment or App pointer change is required.

`GET /api/learning/recorder-events?after=<cursor>` uses the existing verified
reading identity, queries only that student's events and returns private,
non-cacheable pages. It forwards only the supplied browser's existing UC session
cookie to the fixed UC recorder-context GET endpoint, with redirects disabled.
The real UC response supplies scope; this leaf never calculates scope or creates
a machine logging credential. No credential or identity column is added to the event
envelope; the full original content remains private to its owner. Native bearer credentials alone do not enable this Web
bridge.

Both source and client verify full UTF-8 bytes and SHA-256; the source also checks
canonical JSON and event identity. Page boundaries preserve whole events. There
is no total 200-event or word limit. Source rowid is an append-only delivery
cursor scoped by the authenticated owner; do not renumber or rewrite event rows.
The client reads at most four 32-event pages per pass and schedules another pass
only while the source reports more. Empty history does not start a poller.

The shared accepted UC recorder owns IndexedDB durability, large private content
artifacts, receipt identity/digest verification and `record_only` delivery. The
source cursor advances only after that recorder's durable write, not after an
unconfirmed HTTP response. A crash before cursor advancement replays the exact
same operation, original time, content and parent. A crash afterward resumes the
shared outbox. Its network retry budget is preserved; rejected or exhausted rows
remain visible as requiring attention, and are not silently reset on reload.

The application starts the bridge only after its existing identity hydration
has completed. It resumes after source submissions and pending recovery, and
through the existing focus, online, visible and restored-page hydration path.
Identity changes and page suspension invalidate a running pass. A source scope
different from the freshly obtained recorder scope stops delivery. Background
evaluation and alerts remain enabled at their current production values; their
false bootstrap defaults are not deployment authority.

Coverage and limits:

- Full immutable original submission, pending, request, failure, retry, reply,
  result and receipt facts that actually exist in `learning_evaluation_events`
  are transported. Missing historical facts are not invented or backfilled.
- Source facts created while no browser is present remain in private YW D1;
  central observation delivery resumes on a later authenticated Web visit.
  This is not an unattended server-to-server delivery guarantee.
- These detailed private observations are separate from the privacy-minimized
  grading projection. They confer no grade or completion eligibility.
- No changes to content, App immutable objects, source evaluation jobs, signed
  machine execution, background scheduler, D1 migrations or shared hubs.

Validation commands are `npm run test:learning-recorder`, the existing evidence,
frontend, reading-API and shared-state/browser tests, and the current static-asset
hash check. The recorder tests cover multi-owner isolation, 205 events, large
untruncated content, source corruption, account changes, interrupted cursor saves
and recovery. A real browser with the accepted UC recorder and synthetic network
fixtures verifies native IndexedDB, a 594011-byte private artifact, one lost
reply and ordinary reload recovery with one central row per operation.
Those fixtures do not establish production authentication or natural activity.

Recorder release remains pending. Corrected baseline Pages `51837754-3070-4868-87d2-155ada4687fb` is accepted after explicitly authorized dedicated synthetic pending/background and lesson frontend/reload acceptance. Same serial owner continues this recorder release.
Use the registered external YW executor and a fresh exact-source transaction
after the required acceptance; never reuse its consumed/expired journal. Planned
App disposition is `compatible-no-client-release` with the unchanged pointer and
276-object tree, and must be bound to the final release receipt. Rolling back
this bridge's code must preserve all forward source events, UC observations,
private artifacts and browser outboxes. Never drop0009 tables or disable the
current background/alerts switches merely to revert this Web bridge.

Workspace evidence: `reports/operations/learning-records-validity-20260925/`.
