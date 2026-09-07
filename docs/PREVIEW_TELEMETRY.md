# Preview incident logging — accepted production contract

Task `20260907-restorability-p0`, owner `codex-restorability`, 2026-09-07.
This is a leaf logging and stream-lifecycle change. Production was accepted on2026-09-07 as Pages c66da540 / source a9d7f65
through external executor c4e5f480. See the current acceptance section in
MAINTENANCE_MANUAL.md and VERIFICATION.md for exact receipts.

The incident is eight user-facing `/api/preview` 502 responses in the measured
September7 window; early-Hints504s are a separate population. Existing Pages
console logs cannot provide retrospective cause analysis because
[Pages logs are not stored](https://developers.cloudflare.com/pages/functions/debugging-and-logging/#limits).

Source is `ieduer/yuwen-course`, the existing shared-object task worktree,
Node24.18.0 and locked Wrangler4.100.0. Prior candidate1e8b087 is reviewed in
this change. No duplicate dependency tree or clone is required. The existing
external five-PDF source set is independently byte/page-count checked.

## Capability fit and exposure

Use a minimal private `yw-preview-logs` Worker to retain only allowlisted events
in [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/).
Service bindings and Workers Logs are stable Cloudflare capabilities already
used elsewhere in this workspace. This applies them only to this leaf; it does
not create a shared gateway or migrate the Pages site. Compilation accepts the
same May12 compatibility date, no flags, with explicit observability configuration.
No storage migration, new secret, public domain/route, Cron or queue is added.
The Worker was absent at initial readback and was created once through the
reviewed executor; live version is36279914-26b8-4f80-8e74-fb1828ee281e.

The sole consumer is production YW via `PREVIEW_LOGS`. Preview has no log service
binding and remains isolated from production. Public `workers_dev` and preview
URLs are disabled. Invocation logs and automatic traces are disabled so neither
raw incoming URLs nor request headers become a second diagnostics payload.
Data class is `anonymous_aggregate` operational metadata with an opaque request
UUID, never identity, content, resource IDs or resource URLs. Public registration
surfaces and Companion are not applicable to this private operational resource.
APIS, User Center, nav, image keys, Pulse, D1, Queue and App data contracts are
unchanged; their current bindings and hashes must be read back at closeout.

## Resource and cost bounds

The receiver accepts only POST `/events`, reads at most4096bytes and independently
reconstructs the schema. The source emits at most20stage records and one terminal
record per preview. Each delivery has a1500ms abort, no retry, and runs through
`ctx.waitUntil`; log failure preserves the product result. Receiver CPU is capped
at10ms per call. Logging is best effort, not an exactly-once queue. A source
process terminated before delivery may still leave an incomplete sequence.

Workers Logs Paid includes20million events/month with7-day retention and
$0.60/million above the included pool; Free is200,000/day with3-day retention.
These are provider limits, not a promise that account capacity is unused.
Using the prior rolling24-hour adaptive estimate of597preview requests, the conservative21-event maximum is
12,537events/day or376,110events/30days; at the marginal rate that is about$0.226.
That traffic estimate is not a hard traffic limit. The executable hard bounds
are payload, event count, CPU and delivery deadline. For this receiver the
per-preview marginal ceiling under Standard pricing is21logs plus210CPUms,
or$0.0000168, excluding the pre-existing Pages work. Service binding calls
incur no additional request fee. This is a per-operation bound, not an
account-wide monthly spend cap. Oversized records are rejected, the event cap
drops extra stage sends, and CPU/deadline failures stop that delivery.

The signed-in Dashboard on2026-09-07 at13:05UTC confirms current Workers Paid
($5/month plus usage), Standard configuration, billing periodAug16–Sep16,
2.03Mrequests,11,261,003CPUms,2.35Mobservability events and$0.00billable usage.
The subscription API returned40310000; the authenticated UI is the authority.
No plan or budget was changed. Retention is therefore7days. The normal-load
forecast is well within the remaining included pool; recheck usage if the
release is materially delayed. Provider billing and limit changes require a
new review; do not silently expand payload/event/CPU/deadline bounds.

## Verification and release

Run preview target/network/binding/HTML/PDF/transfer/telemetry suites, all remaining
precontent checks, external source validation, formal artifact and Web-only App
receipt checks. Log receiver tests cover malicious extras, invalid/oversized JSON,
private service delivery, failure isolation and event cap. Exact emitted bytes
must contain none of the synthetic private fixture strings.

Publish the private logger and Pages only through a renewed, exact-source external
executor. Freeze baseline Pagese0ffb33c/source9842940, the original complete
configuration, the sole new binding and resulting config hash. Every other
configuration/data fact must match. Close any Pages tail before the decisive
readback: one authorized anonymous registered preview must yield saved stage and
terminal records queried from Workers Logs, with matching requestUUID, measured
bytes/status and no private fields. Verify HTML, PDF/Range and error behavior,
then prove the ordinary YW UI and related read-only health paths still work.
No new grading or learning submission is authorized by the one-use ZW approval.

## Rollback, retention and restore

Application rollback is exactly Pagese0ffb33c while retaining current D1/Queue,
APIS credential pair and App pointer. The new service binding may remain inert
while old code is live; remove it only through its reviewed exact config rollback.
The private logger can remain inert during provider evidence retention. Do not
roll back student data for a log/stream error.

Worker source, config and tests are Git-backed hot source in this repository.
Restore an exact reviewed commit into an absent, manifest-registered worktree,
verify SHA/clean state and rerun local tests before deploying. Logs expire under
the provider plan and are not business-data backup authority. Export only the
allowlisted aggregate records needed for a bounded incident receipt into the
workspace's private evidence directory; temporary builds/browser profiles belong
under the registered task root and must be removed at task closeout.
