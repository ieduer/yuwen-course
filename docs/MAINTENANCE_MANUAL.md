# `yw.bdfz.net` maintenance manual

Last reviewed: 2026-08-28 (America/Los_Angeles)

## 2026-08-28 `/insights` retirement and `/star` v2 design boundary

The personal page at `/insights` is retired because both of its data sources
are obsolete and its signed-in status text can claim cross-device records that
it did not load. The release source deletes the page and both dedicated assets,
removes its entry from the lesson and atlas navigation, and installs these
formal Pages redirects:

```text
/insights      /star   301
/insights.html /star   301
```

`scripts/test_release_site.mjs` is the executable copy contract for
`_redirects`. The generated formal artifact has 1,221 files and aggregate
SHA-256
`a6e79f71a9a6af0c8b05b68a9510ebec21b56b98ac05cf0c5f0b262d1c7a1853`;
its manifest includes `_redirects` and excludes `insights.html`,
`assets/insights.js` and `assets/insights.css`.

`docs/READING_CONSTELLATION_V2.md` is the sole review draft for changing
`/star` to durable-record origins. It maps every proposed lesson, word and
record node to a source D1 primary key, freezes existing layout inputs before
new origins, defines traceable brightness and retains the no-fabrication/A+
boundary. Do not implement its schema, backfill, node classes, three local
submission/status/health fixes or production canary until Suen explicitly
approves the design. Design approval would still not authorize a production
historical backfill.

This release adds no Cloudflare capability, migration, binding, Queue, native
pointer or student-data mutation. Release only the reviewed formal artifact
through the external UC+YW executor. Verify both redirect paths in signed-out
and signed-in real browser sessions, confirm `/star` renders, and read back the
exact Pages deployment. Static rollback restores the recorded predecessor;
D1 is preserved and never dropped or cleared.

## 2026-08-28 APIS caller-auth release authority

The source includes authenticated POST `/api/learning/ai-readiness` as the
caller-auth acceptance path. It is deliberately not a public model proxy: the
request must be same-origin JSON and carry a valid My session; the Worker asks
APIS one fixed readiness question and discards the model text. It does not
reserve an evaluator slot or write D1, Queue, learning evidence, discussions,
content, or App state. Anonymous and wrong-origin requests fail before the
binding call. Use this path only for bounded release acceptance and retain its
per-caller quota protection after APIS enforcement.

This is a Worker-only Web release. Its formal artifact contains 1,223 files
with aggregate SHA-256
`6f4c2fc1610a00f2b0360a11e71542029f0c1d8d47d129318799caaa3d3e6f0c`;
the stable native pointer remains byte-identical at
`a5ccd441deb7b0111517c9c1ec597b98e16a6dac789bd32bff3daa96960285a7`.
The deliberate App deploy-sync gate remains red because no new App audit
receipt exists, exactly as required by the current Web-only release rule.

The external study-guide source directory is currently empty and its mtime is
2026-08-24, before this transaction. Searches of the canonical local path,
the accepted Drive archive prefix, the full connected Drive by exact filename,
Trash, Spotlight, `/private/tmp`, Downloads, Desktop and Documents found no
original PDF/extraction bytes. Therefore `verify:study-guide-sources` is not a
pass and must not be represented as one. This Worker release changes no
study-guide, catalog, content, native object or stable-pointer byte; restoring
those original bytes is a separate resource-preservation incident.

The accepted live Pages deployment is
`12a0f7db-d4dc-49bd-b12b-84dc64befd3b`, source
`89819f6650955b1d2d0b3a139384402788c799c8`. YW now calls `apis`
only through the production `APIS` service binding and requires the dedicated
server secret `APIS_CALLER_TOKEN`; the caller id is `yw.bdfz.net`. No Origin or
public gateway fallback remains. Missing binding or identity fails before an
APIS request and is mapped through the existing retryable evaluator-unavailable
contract. D1, Queue, User Center, content, and native-App state were unchanged.

Node 24.18.0 evidence includes the focused learning-evidence suite 69/69, the
complete release gate, mobile-atlas 13/13 in the required browser environment,
formal `.release/site` build/check, and the 1,223-file artifact manifest
`03b17d3f15ba206d513ec3d8ab53d814f5809ba9dff60287e24c4d06bd4c227b`.
Custom and immutable-host `/api/learning/health` both returned typed 200.
Immediate Pages rollback is deployment
`52447a91-dd19-4980-a407-f19a752de19a`; the prechange anchor remains
`f190cd2c-3023-40ac-8a88-c9d92c450627`. Ordinary rollback preserves D1
history and the evaluator ledger. The enforce-era verified product-path 200 is
recorded by the shared APIS receipt after registry activation.

## 2026-08-25 accepted release authority

The accepted live authority is Pages deployment
`f190cd2c-3023-40ac-8a88-c9d92c450627` from exact source
`26761feec523847b9f60dcda5b5328843b413c0b`, with app asset pin
`85fa19b1ba2a427d`. Its journal is
`/Users/ylsuen/CF/.yw-pages-release-20260825-academic-year-policy-v1`; acceptance
is bound to the redacted composite receipt under
`/Users/ylsuen/CF/_meta/reports/uc_yw_academic_year_release_20260825/`.

The acceptance covers classical lesson 1474 and non-classical lesson 1569,
two-or-more server-owned turns in both structure and author-question rounds,
refresh restoration, zero `evaluator_retry_exhausted` 429 responses, and a
fresh `2026-2027` formative event accepted by User Center with competency,
normalized value, and an exact source-owned drill-down. Test identities prove
the engineering path but never increment the real-student R3 numerator.

Rollback Pages first to `2471f1e4-884a-4e80-9801-589ebbace476`, then to
`619024c7-a261-405b-a13f-8581a90111ac` if necessary. Preserve D1 history and
the evaluator-call ledger during an ordinary Pages rollback.

## 2026-08-24 evidence academic-year authority and feedback timeout boundary

Every evidence envelope must take `academicYear` from the already validated
`compatibilityContracts.aPlusGate.academicYearPolicy.academicYear`. Never
derive it from `occurredAt`, a calendar boundary or browser input. The same
validation requires the active policy version and exact academic year; absence
or mismatch fails closed before evidence persistence. Commit `7f401d7` applies
this source rule and has focused Node 24.18.0/22.21.1 evidence-contract results
of 69/69 each, but it is not merged or live.

YW's feedback deadline remains 45 seconds. Current APIS v6.7.0 uses 12 seconds
per feedback upstream attempt, two retries, and 250/500ms backoff. The proposed
shared-hub change `20260824-apis-feedback-timeout-30s-v1` may change only the
APIS per-attempt feedback constant after separate approval; it must not be
emulated by raising YW to 60/75 seconds. A 30-second attempt can reduce typical
duplicate calls when upstream succeeds in 12-30 seconds, but increases the
single-key all-timeout bound from about 36.75 to 90.75 seconds. Treat both
effects as canary measurements, not assumptions. No APIS source or runtime was
changed by this documentation update.

The 2026-08-24 exact-prompt paired read-only probe is diagnostic only:
feedback had 0/10 responses within 60 seconds; chat had 5/10 normalized 200s,
four 60-second deadlines and one fetch failure, with every successful chat
response still above 45 seconds. Chat and feedback use separate traffic gates
(concurrency 10 versus 6), so this supports a task-specific APIS cause but does
not isolate the timeout constant or prove that 30 seconds will pass YW. Retain
the 45-second YW gate and require an authorized APIS canary.

## 2026-08-24 evaluator-call budget and release override

This section is the current authority where it conflicts with retained dated
history below. The release change id is
`20260824-yw-evaluator-budget-release-v1`; it is YW-only and makes no APIS,
User Center, Queue, binding, route or native-App change.

Migration `0006_learning_evaluator_call_ledger.sql` adds the append-only
`learning_evaluator_calls` table and two count indexes. Before the remote
migration, an exact D1 Time Travel bookmark was captured and recorded in the
redacted release receipt. Readback after migration proves the new table/indexes
exist with zero rows and the aggregate counts of the five pre-existing learning
tables are unchanged. The bookmark is a D1-incident anchor only: ordinary Pages
rollback must not restore D1 history.

Before every APIS feedback call, YW performs one conditional ledger insert
which enforces both limits:

- 60 calls per authenticated student per ten-minute window;
- 4 calls per `source_event_id` (the server-owned mutation key) per window.

Accounting is deliberately conservative. Success, timeout, upstream 5xx,
invalid JSON, gateway 429 and outcome-unknown calls all remain counted. A call
that never obtains a ledger row is never sent to APIS. Do not add localized
error-string matching such as `"系統繁忙"`, and do not refund or delete a call
row from the request path.

If either limit is full, trusted identity is incomplete, or D1 budget access is
unavailable, fail closed before APIS. Convert the independent learner
reservation to the existing `.002Z` short-cooldown form, preserve the answer
and mutation receipt, return structured 503
`learning_evaluator_budget_exhausted` or
`learning_evaluator_budget_unavailable` with `Retry-After`, and write no
interaction, evaluation or outbox record. A budget failure must never consume
a positive learner slot. Health contract `reading-schema-v6` requires the new
table and both indexes.

The integrated Phase 0 review found no P0 and remains labeled
`non-independent, pending independent confirmation`. Final source `1f19094`
passed the scoped Node 24.18.0／22.21.1 and mobile gates and was deployed as
candidate `c99a3ec8-2673-44bf-a942-631a820599fc`, but live acceptance failed:
lesson 1474 reached vocabulary 12/12 and study-guide 15/19, then the same answer
received four 503s despite 15-second cooldowns. UC also quarantined all 28
canary envelopes as `academic_year_invalid`. The candidate was not accepted;
the executor restored `2471f1e4-884a-4e80-9801-589ebbace476`, while D1 history
and the additive ledger schema were retained. Any retry requires a new change
authority after both failures are resolved. `619024c7` remains the second-level
anchor.

## 2026-08-23 evaluator availability override

Current production serves Pages deployment
`2471f1e4-884a-4e80-9801-589ebbace476` / source
`fa93ca825e9b0d914b4608c971152dcf581ae9ac`, but that deployment remains
`candidate_pending_acceptance` because it does not contain this evaluator
repair. Its immediate rollback is
`619024c7-a261-405b-a13f-8581a90111ac` / source `16b8277`. Do not accept the
pending deployment and do not change either production alias while this source
candidate is under verification.

The active evaluator contract is:

- keep the shared APIS request at `taskType=feedback` and
  `thinkingLevel=medium`; feedback receives a 45-second Worker timeout while
  other APIS task types retain 20 seconds. Both formal-dialogue and study-guide
  browser calls use 55 seconds so the client remains longer than the Worker;
- classify Worker abort, upstream 5xx and invalid upstream JSON as an evaluator-
  owned failure. Release the positive learner slot into a `.002Z` cooldown
  marker with negative slot numbers. The marker lasts 15 seconds, is excluded
  from learner resource/global window capacity, and permits the same mutation
  to reserve a fresh positive slot after expiry;
- return structured `learning_evaluator_unavailable` 503 with
  `Retry-After <= 30`, preserve the browser's exact answer and mutation receipt,
  and write no false interaction, evaluation, outbox or Queue evidence;
- reserve `learning_submission_rate_limited` 429 for real learner
  `window_capacity` only. The historical `evaluator_retry_exhausted` reason,
  its two-evaluator ceiling and its ten-minute wait are superseded and must not
  be restored;
- keep the ordinary `.000Z` lease, `.001Z` abandoned-lease reclaim,
  idempotency, concurrency and server-owned scoring contracts unchanged. A D1
  or final-ledger write failure is not relabelled as an evaluator failure.

The feedback/medium latency gate is 20 bounded samples with p95 below 45
seconds. The current pre-release sample produced 19 valid grounded responses,
one transport `TypeError`, p95 24.401 seconds and max 25.908 seconds. A five-
sample low-thinking comparison produced one invalid response, so latency alone
does not authorize lowering quality. Focused source verification is evidence
63/63 and frontend 27/27. Exact Node 24.18.0 and 22.21.1 each pass 245/245 TAP
tests with zero skip/fail plus every non-TAP gate; both verify the five study-
guide receipts and the 693-file textbook-page subset. The checksum-fixed formal
artifact is 1,223 files / 164,458,961 bytes with projected aggregate
`520aabbb9a462c3b18d491aa1163b37cba0e05b50aceec2c18463b4f692cee55`,
artifact aggregate
`31f5a020549387589336ecd6be29bea5416c166084672b411024c9f00ae94101`
and marker SHA-256
`870ae05d50a41a98cc44355277416d70a0cd7c9987e768c8cf81d65527aee3ae`.
Only the one-pass live learner acceptance remains pending authorization under
`docs/VERIFICATION.md`.

This is a YW leaf-only `no-new-capability` repair. Do not mutate UC, D1 schema
or data directly, Queue, APIS, App/native content, bindings, routes or the
existing executor. The old one-use executor remains exact-bound to `fa93ca8`.
Any repaired deployment requires a separate reviewed one-use YW-Pages-only
executor bound to the merged SHA and exact rollback `619024c7`.

## 2026-08-22 lesson 1474 staged-loop recovery contract

Production remains deployment `619024c7-a261-405b-a13f-8581a90111ac`, source
`16b8277afdf32618043703de4eb9b4098858b888`. PR #20 merged the reviewed repair
as runtime source `ef6272778db1dd3cfed227b47ac4cf17163eba3f`; PR #21 synchronized
the source/production boundary in project documentation. The merged source is not live.
Its first-read, study-guide, same-page checkpoint and formal dialogue changes
are governed by the newest eight-point standard in `docs/VERIFICATION.md`.

Operational invariants:

- a committed classical first-read source is independent of ancillary progress
  synchronization. Render the authoritative next-stage UI first, contain
  storage failures, bound both mutation and readback, and unlock after an
  ambiguous response only on an exact submitted lesson/text-version/digest;
  the bound includes response-body consumption. A stalled body cannot leave
  the UI pending, and an ancillary renderer failure cannot replace annotated
  text that has already rendered successfully;
- `submitting` is memory-only UI state. Persist a retryable `pendingSync`
  receipt with stable mutation ID, answer and reference-reveal time, normalize
  interrupted legacy snapshots on hydrate, and clear the spinner on success,
  structured failure, header/body timeout, storage failure and owner-scope
  transition. Do not send a formal assessment unless the exact retry receipt
  was first persisted;
- an unavailable study-guide evaluator returns the shared structured 503
  learning-evaluator contract before formal evidence, outbox or Queue writes.
  Generic 500 is not an acceptable dependency response;
- vocabulary checkpoint completion requires vocabulary, every active
  study-guide vocabulary/syntax item and every first-read correction. The
  final successful item rerenders progress and the check-stage controls on the
  same page; a refresh is never required for unlock;
- formal structure and author-question interactions are bounded multi-turn
  learning dialogues. History is reconstructed server-side only from the
  authenticated student/resource/interaction evidence ledger: at most four
  prior turns enter the next prompt and at most six return to the browser.
  Client-supplied history is never authority. Mutation replay is idempotent,
  and later lower scores cannot relock an already completed checkpoint. Keep
  author/coach identity consistent in the evaluator prompt, visual dialogue,
  transcript and accessible name; preserve authoritative attempt numbers when
  displaying a six-turn window and announce/focus only the latest feedback;
- when lesson taxonomy has no authoritative author, label and prompt the role
  as a text-reading coach. Never invent or impersonate an author. The 88
  local-practice lessons remain local/self-check, make no APIS/formal-evidence
  call and are outside this formal dialogue contract.
- identity discovery is fail-closed. Do not persist or enqueue reading
  position, font preference, first-read, lesson-open or check-stage mutations
  until the exact owner scope is resolved. Bind every asynchronous callback to
  its identity/lesson generation, discard stale A→B→A work, and never rebind an
  ownerless mutation to the newly discovered account. Bound session lookup,
  owner discovery and every shared-state owner check/mutation to 12 seconds.
  If the identity object is replaced for the same owner, rebind that owner's
  pending reading/font state to the new generation; a different owner must
  still discard it;
- the study-guide catalog and shared-state module are non-blocking startup
  dependencies with bounded body/import timeouts and same-page backoff. A
  failure must expose retry state while leaving core lesson text usable; a
  successful retry rerenders the current lesson without focus/online/reload.

The authenticated production acceptance used only the configured student
environment and ordinary UI writes. It completed lesson 1474 from first read
through 12 vocabulary items, three corrections, 19 active study-guide items,
evaluation and both formal interactions. Retain only aggregate receipts; never
record the account identifier, cookie, session, answer text or raw learner
content.

Final candidate verification passed on exact Node 24.18.0 and 22.21.1:
first-read 30 lessons/102 paragraphs, study-guide frontend 27/27, evidence
62/62, local progress 24/24, learning manifest 11/11 and the shared-state
browser contract. Both complete gates passed mobile trusted-touch 13/13,
Reading 74/74, native projection 22/22 and formal staging 5/5; both runtimes
verified five PDF/extraction receipts. Native-page verification used a
disposable 693-file / 75,196,340-byte subset fetched from the exact tracked
live public URLs and checked against the canonical inventory. The canonical
Drive token returned `invalid_grant`; do not describe this run as a fresh
archive readback. The formal staging contains 1,223 files / 164,456,389 bytes
with projected aggregate
`3eee253710281c30747e7ba6570f8da6cf0ef080836096b5aea8cbf6c336f0f1`
and tracked manifest aggregate
`4c46462b0798048ce69eac8b5c0ba2691d9979af41388d2299e7738a3b172f06`.
Independent final reviews found no remaining P0-P3.

GitHub Actions run `32623520208` passed the exact PR head under Node 24.18.0
and 22.21.1. A clean detached default-main rebuild after the documentation merge reproduced the
same formal marker, projected aggregate and tracked manifest aggregate above.

This is a leaf-only `no-new-capability` correction. It changes no route,
binding, schema, migration, direct D1 state, Queue/APIS/User Center
configuration, learning-manifest membership or native/App pointer. Those
dependencies remain `verified_no_change`.

Release is fail-closed at `.release/site` after source merge. Project policy permits Pages deploy
and rollback only through an independently reviewed external UC+YW executor.
The currently inspected external workflow is explicitly source-only and exits
before credentials, so neither checkout/manual Wrangler upload nor its prior
forensic upload command is release authority. Before production, a separate
review must activate a callable executor and prove rollback to current
deployment `619024c7-a261-405b-a13f-8581a90111ac`. Do not edit project policy,
use raw `site/`, or create an ad-hoc deploy script to bypass this gate.

## 2026-08-22 mobile and staged-learning production authority

Current production is Pages deployment
`619024c7-a261-405b-a13f-8581a90111ac`, branch `main`, exact source
`16b8277afdf32618043703de4eb9b4098858b888`, with atomic URL
`https://619024c7.yuwen-course.pages.dev`. It was built only from the clean
formal `.release/site` staging: 1,223 files, projected aggregate
`223f05a5aa6333ba3e4be61f04aafc00afafac98359d979a3d1c942678d2e724`,
artifact-manifest aggregate
`c744b7ac352c11b5cea45377ce297d69d4a3b142027a768bcb59dbf76bcd98b1`.
PR #18 / GitHub run `32607440011` passed both exact Node authorities before
the detached merged-source rebuild.

Custom and atomic routes read back the exact content-hashed app,
first-read controller and manifest bytes; learning health is HTTP 200 healthy.
Live trusted-touch mobile checks passed 7/7. Authenticated lesson 1727 read an
already-submitted first-read source and exposed both downstream local-practice
stages without a console error; no new learner submission was created.
Anonymous lesson 1693 exercised both local-practice controls with no formal
evaluation request, while formal lesson 1497 remained login-gated. The live
authority remains 189 student lessons = 101 formal + 88 local for both
structure and author-question.

Immediate production rollback is
`6426b70e-d39b-4ba9-898b-0f5e7a1c3859` / source `26f126b`; the older
`581a0180-2085-4960-8cd0-4aee17cb2abd` anchor remains available. Rollback is a
Pages code/static action only: never delete or rewrite D1/outbox/Queue history.
After rollback, rerun the custom/atomic asset hashes, learning health, live
mobile touch suite, lesson 1727 negative and lesson 1497 positive controls.
This release ran no direct D1 command or migration and changed no Queue/APIS/
User Center configuration, route, binding, schema or stable native/App
pointer. Authenticated acceptance retained the existing identity-
reconciliation boundary and created no new learning submission.

## 2026-08-22 mobile and staged-learning repair contract

The current release candidate repairs three coupled UI/authority failures
without changing the published learning-manifest denominator:

- atlas ownership belongs to the width media-query boundary. A viewport-height
  resize may refit the title but must never close an already open compact
  drawer; only entering `(max-width: 1180px)` from a wide viewport may close it;
- a failed first-read submit is ambiguous because the source session can be
  committed before downstream evidence. Read back the authenticated source
  once and unlock only when its lesson ID, `textVersionId` and `textDigest` all
  match and that exact source is already submitted.
  Never convert a downstream evidence failure to success without this source
  readback or a separately designed durable compensation contract;
- `site/data/learning-manifest.json` is the formal interaction authority.
  Its 101 selected-volume lesson interactions retain the existing APIS,
  evidence and A+ behavior. The other 88 student-visible lessons are explicit
  local practice only after identity ownership resolves: no
  `/api/interaction-check` request, no formal score and no D1/Queue/User Center
  write. Any 100% UI completion that depends on local practice remains
  ineligible for the hidden `lessonCompleted` evidence event. A stale
  authenticated client receives HTTP 422
  `learning_resource_not_published` after the existing identity reconciliation
  but before APIS or any formal interaction, evaluation, reservation, outbox or
  Queue write. Expanding those 88 lessons into the formal denominator is a
  separate synchronized learning contract change and is forbidden in this
  repair.

`lesson-1727` is the canonical negative/formative regression: its structure and
author-question controls must remain usable as local practice, and its
deterministic structure prompt must anchor正文 rather than the lesson title,
`《左傳》` source label or the Spring-and-Autumn map caption. `lesson-1497` is
the canonical published positive control and must retain formal evaluation.

This is a `no-new-capability` decision. Existing Pages/Workers Static Assets,
D1, Queue, APIS service access, User Center identity and native-content pointer
are sufficient; the change adds no runtime capability, binding, schema, route,
data class, cost surface or App dependency. Current pre-release production was
re-read on 2026-08-22 as deployment
`6426b70e-d39b-4ba9-898b-0f5e7a1c3859` / source `26f126b`; immediate rollback
is `581a0180-2085-4960-8cd0-4aee17cb2abd` / source `04ca518`. Use the executable
release and live-acceptance gate in `docs/VERIFICATION.md`; chat or screenshots
are not release evidence. This paragraph is the pre-release snapshot; the
production authority and rollback that supersede it are recorded immediately
above. The App deploy-sync gate remains intentionally red
without a new approved App audit receipt. A Web-only release may proceed only
through the existing reviewed path while preserving the stable native pointer
and every referenced native object byte-for-byte; never fabricate an audit
receipt or relabel that App gate as green.

## 2026-08-20 production launch authority

Current production is Pages deployment
`6426b70e-d39b-4ba9-898b-0f5e7a1c3859`, exact source
`26f126bfb38c62b251bbe8815d6ef32c4594bce7`. Immediate static rollback is
`581a0180-2085-4960-8cd0-4aee17cb2abd`, source
`04ca518767b39b75832740007be11b5b902b0a8c`. Production uses the existing D1,
service binding and YW v2 producer unchanged. The v2 main Queue is intentionally
open; its 2026-08-21 readback is `delivery_paused=false`, main backlog zero and
v2 DLQ backlog zero. Emergency rollback pauses only
`bdfz-learning-evidence-yw-v2`; never pause v1 or either DLQ as a substitute.

Authenticated launch acceptance used a normal UI lesson open, not a fabricated
envelope. It advanced source interactions 284 to 285 and central YW evidence
277 to 278. The new row is the exact preactivation canary shape, enters the
`mapped_accepted` branch, persists as durable `accepted`, has non-scoring
eligibility, null numeric values and null scoring policy, and creates no credit
or weekly/A+ change. Five prior `academic_year_invalid` samples remain intact
and are never replayed. This validates transport, not September scoring; the
first real 2026-2027 scoring event is checked read-only after the automatic
2026-09-01 00:00 Asia/Shanghai handoff.

The source receipt reconciler has a 15-minute CAS lease. After that lease
expired, a normal HTTP 200 learning-health request ran the existing drain and
the source outbox read back `central_disposition=accepted` with a receipt
timestamp. Never replace that path with a manual D1 update.

The one-shot read-only Codex heartbeat `yw-9` is active for 2026-09-01 00:05
Asia/Shanghai. It may verify the first genuine scoring event but must report
waiting when no real sample exists; it has no deploy, Queue or data-write
authority.

PR #16 GitHub run `32447617539` passed both exact Node jobs. Returning and fresh
browsers both load 189 lessons from the source-hash entry assets. A direct APIS
probe with the exact YW headers returned 200 in 4,118 ms. If APIS later misses
the 20-second boundary, the UI receives the reviewed retryable 503 instead of
an opaque 502 and no false evidence is written.

## 2026-08-20 Web launch, cache and pre-activation transport contract

- Treat the five local entry assets in `site/index.html` as immutable browser
  resources. Each `?v=` value is the first 16 hex characters of that tracked
  source asset's SHA-256. Run `npm run test:static-asset-cache` after changing
  any of those source bytes. A date, feature label or unchanged query value is
  not cache authority; it can strand returning students on mutually
  incompatible script generations.
- During the exact pre-activation window recorded by
  `YW_PRE_ACTIVATION_TRANSPORT_CANARY`, the server—not the browser—maps a normal
  `lessonOpened` request to `lessonPhase=release_canary`. At expiry it returns
  to an empty lesson-open phase automatically. Do not add a test-only public
  ingest, hand-construct an envelope, trust client occurrence time, or extend
  the window by accepting a browser phase. Acceptance requires a normal
  authenticated lesson open plus source ledger, Queue, UC evidence and source
  terminal-receipt readback; credit/snapshot/grade/F deltas must remain zero.
> **Superseded on 2026-08-23:** the following historical 20-second/two-attempt
> rule is retained only as incident evidence. The evaluator availability
> override at the top of this manual is authoritative.

- APIS evaluation remains bounded to 20 seconds. The first evaluator failure
  may release the existing durable reservation for one same-answer retry and
  must return `learning_evaluator_unavailable`, HTTP 503 and `Retry-After: 15`
  without writing an interaction or outbox row. A second failed evaluator
  attempt continues to return the existing 429 exhaustion result. Never
  fabricate a score or record an unassessed response as evidence to make the
  UI appear successful.
- The pre-change deployment for this transaction was
  `581a0180-2085-4960-8cd0-4aee17cb2abd`, source
  `04ca518767b39b75832740007be11b5b902b0a8c`; it is now the immediate rollback.
  The production authority is the exact live readback in the closeout section
  above; chat output is not an operations authority.

This is `no-new-capability`: it uses the existing Pages Functions, static
assets, D1, service binding and v2 Queue producer only. It changes no schema,
binding, route, Queue configuration, scoring rule or native content pointer.

## 2026-08-20 post-PR-#12 combined authority contract

PR #12 was merged unchanged as
`10177b360077ef1347db531c14ca287757ef2d8f`. PR #14 ordinary-merges that exact
main and must preserve both the PR-#12 assessment/native semantics and the
following server-authority boundaries in one deterministic artifact.

- `site/data/manifest.json` is the lesson identity authority for every mutation.
  Keep `getLessonMeta` / `getLessonData` fallback semantics only for read
  compatibility. Mutation handlers must call the authoritative variants and
  stop a catalog-absent lesson before APIS, D1, outbox or Queue work. A lesson
  ID that merely matches `lesson-*` is not authority. In particular,
  first-read mark, delete, submit and resolve must resolve the exact manifest
  lesson before calling a helper that can mutate D1.
- `/api/reading/submission` accepts the student's exact three words plus an
  optional `sourceEventId`. It must never read a browser-provided `aiScore`,
  `aiVerdict` or `source`. With no source event, the submission remains valid
  but has no score bonus. With a source event, the Worker joins
  `learning_interactions` to `learning_evaluations` and requires the same
  student, lesson, `contextWords` interaction, `a_plus_gate` role,
  `source_ai_assessment` method and normalized three-word set. Any mismatch is
  HTTP 422 and creates no submission.
- `source` is runtime-owned: `synthetic` exists only when the explicit local
  `READING_TEST_SLUG` seam is present; otherwise it is `live`. Never add a
  production binding for `READING_TEST_SLUG`. History responses must project
  this current trusted runtime value and never return the legacy stored column,
  which older browsers could set. Reordering or simplified/traditional
  normalization may dedupe the same three words, but it cannot borrow an
  assessment for a different word set.
- `submissions.ai_score` and `ai_verdict` are compatibility storage, not read
  authority. A dedupe without a matching source event must clear both fields.
  Constellation brightness and the lesson/history projections derive scores
  only from `learning_interactions` joined to `learning_evaluations` with the
  same server-owned role and method predicates, then intersect the normalized
  three-word evidence key with an actual submission key. A valid assessment
  for an unsubmitted word set does not brighten a lesson. Never restore a
  `MAX(submissions.ai_score)` brightness path: pre-hardening browser values
  cannot be distinguished in that column without a migration/data rewrite.
- `/api/lesson-blueprint` accepts only `lessonId` as lesson authority. It must
  load the exact manifest lesson and literary-taxonomy row, derive title, block,
  excerpt, allowlisted normalized mode and genres from those server assets, and
  ignore browser title/block/excerpt/mode/genres. It returns the reviewed
  source-deterministic blueprint with `cache-control: no-store` and performs no
  APIS or runtime-cache operation. Unknown lessons return HTTP 400 and a known
  lesson without its taxonomy authority returns HTTP 503, both with zero APIS
  and cache effect.
- `/api/interaction-check` accepts browser lesson metadata only as untrusted
  compatibility input. The scoring prompt must derive normalized mode, genres,
  author names and the response speaker from the exact
  `site/data/literary-taxonomy.json` row, and title/block/excerpt from the exact
  hydrated manifest lesson. A missing taxonomy row is HTTP 503 before identity,
  APIS, D1, outbox or Queue work. The learning ledger may retain only the
  registry-allowlisted student response and mutation/session fields; it must not
  retain browser title, excerpt, mode, genres or authors.
- The ten authenticated Web mutation routes are `/api/interaction-check`,
  `/api/learning/interactions`, and Reading submission, vocabulary,
  study-guide, first-read mark/delete/submit/resolve/reconcile. Before reading
  any binding or resolving identity, every Web Cookie request must carry exact
  `Origin: https://yw.bdfz.net` plus `application/json`. Native authorization
  remains Origin-independent only for the exact existing header format, still
  requires JSON, and must pass `resolveNativeSession` plus the exact native
  projection before identity reconciliation or any business side effect. A
  syntactically valid but rejected native token is not authorization. The local
  `READING_TEST_SLUG` seam never bypasses the gate.
- `POST /api/discussions/:lessonId` is a retired legacy write surface. It always
  returns HTTP 410 with `discussion_write_retired` and `cache-control:
  no-store`, without parsing the body, reading a credential, or calling GitHub,
  D1 or Queue. The removed UI must not be restored implicitly. GET remains the
  bounded read-only compatibility path; any future student discussion feature
  requires a separate authenticated, privacy-reviewed, rate-bounded design.
- Preserve the hostile gates in `scripts/test_reading_api.mjs` and
  `scripts/test_learning_evidence_contract.mjs`, plus blueprint coverage in
  `scripts/test_lesson_blueprint_quality.mjs`: browser-forged score/verdict/
  source stays null/empty/runtime-owned; legacy scores cannot brighten or appear
  without source evidence; a nonexistent lesson cannot enter submission,
  first-read or semantic ledgers; blueprint absence has zero APIS/cache effect;
  retired discussion POST has zero outbound/data effect; and valid source
  evidence is bound by exact user/lesson/interaction/method SQL predicates.
- Pull-request CI must run the evidence contract, lesson-blueprint quality and
  local-D1 Reading API suites on both exact Node 24.18.0 and 22.21.1. Those
  focused suites do not require the archived 693-page fixture and do not grant
  deployment, D1, Queue or User Center mutation authority.
- The post-PR-#12 combined local receipt is exact Node 24.18.0 and 22.21.1
  complete `precontent:check`, focused 96/96, Reading 74/74, evidence 52/52,
  blueprint 6/6, native-content 22/22 and release-site 5/5 on each runtime,
  plus five PDF/extraction receipts on each. The formal artifact was rebuilt
  after both complete gates and then checked by both runtimes: 1,223 files /
  164,387,142 bytes, projected SHA-256
  `ac6efa919a516c272209a94e0f078373bbfaabdf5c28766dd188cb0b077ec65e`,
  artifact aggregate
  `3fcc42802b5f2478e0cc3ec3ffa720ce7feacff6fe9a14ae17c0dddf32085825`
  and tracked manifest byte SHA-256
  `9ff27ae8abd5b7dcafc503aa493809d2ff4b119cb176bdbf481f9298dda975a6`.
- The 2026-08-20 Cloudflare readback still names production deployment
  `18213286-37d1-4b71-80b6-78e8b986ed3d` at source `a97eba7`. Do not infer that
  this Draft source correction is live. The live carrier/static-contract drift
  and unavailable `/api/learning/health` remain release blockers.
- Before any release, run the 2026-08-20 section of `docs/VERIFICATION.md` on
  exact Node 24.18.0 and 22.21.1. Formal release must stay blocked while
  `check:native-content:deploy-sync` reports that the canonical source graph
  lacks an approved audit receipt. Do not generate or approve that separately
  owned Web/App receipt as part of a server-authority patch.
- Keep PR #14 Draft while its ordinary merge of exact main `10177b3` completes
  GitHub CI and a fresh exact-head P0/P1 review. Neither predecessor green suite
  nor the combined local receipt authorizes ready or merge by itself.
- This is a `no-new-capability`, source-only correction with no schema,
  migration, Queue, binding, new route or configuration change. Roll back source by
  reverting the exact candidate commit and rebuilding/checking
  `docs/baselines/site-artifact-manifest.json`; preserve D1 history. There is no
  production rollback action for this Draft because it performs no deployment.

## 2026-08-15 combined assessment, retry and native formative source draft

- Native reading identity remains owned by the accepted
  `bdfz-native-auth/1` projection. Do not restore the historical
  `bdfz-yw-native-session-rpc-v1` shape or duplicate native identity parsing in
  `site/_worker.js`.
- After `getReadingStudent` has authenticated and reconciled the stable User
  Center user, formative mastery must still preserve the request's credential
  class. Absent or non-native authorization may call Web `resolveSession` and
  `getFormativeMastery` only with the bounded User Center cookie. Exact native
  authorization calls `getNativeFormativeMastery` with that native authority.
  A native request never falls back to the Web RPC, even if a same-user cookie
  is also present.
- `nativeAuthorizationDecision` is shared by `getReadingStudent` and
  `readingFormativeMasteryRpcDecision`. It treats an unrelated Bearer or other
  authorization scheme as non-native, so a valid Web cookie remains usable.
  Any header in the case-insensitive `Bearer ywat_` namespace that fails the
  exact native format is native-looking malformed input: it returns 401 before
  either identity RPC and cannot downgrade through the cookie. If exact native
  and Web credentials resolve to different stable User Center ids, the request
  also remains 401.
- `readingFormativeMasteryRpcDecision` is the single source-side RPC selector.
  Malformed native authorization returns no method and no credential. If the
  selected named-entrypoint method is unavailable, the Worker returns 503 and
  performs no alternative RPC; it must not reinterpret an infrastructure or
  contract gap as an anonymous student result.
- This YW route does not prove that the paired User Center deployment exposes
  `getNativeFormativeMastery`. The Draft remains undeployed until the separately
  owned User Center source defines the exact request/response contract, keeps
  the existing non-scoring projection byte-compatible, and passes native
  expiry, revocation, wrong-client, cross-user, malformed-result and sensitive
  logging tests plus the shared-hub release gate.
- The change adds no Cloudflare capability, binding, migration or data path.
  It does not authorize User Center, D1, Queue, Pages, App or production work.
  Roll back source with a normal revert of the exact YW commit.
- Pull-request CI must retain `scripts/test_reading_identity.mjs` in the exact
  Node 24.18.0/22.21.1 focused matrix alongside the manifest, evidence,
  preview-binding and assessment suites. Route-level tests must retain the
  non-native-Web, malformed-native-401, cross-identity-401 and missing native
  method 503 cases.
- The combined source candidate is verified only by the unified 85/85 focused
  matrix plus both exact-Node complete source gates. Its sole formal artifact
  authority is 1,223 files / 164,378,212 bytes, projected aggregate
  `21485dbc7c0c167925a0f3d56835ee19b379ce413aff23aab4c102b244e1f922`,
  artifact aggregate
  `ae7c907010f3a148f7b68a3bfc5442220091759202acb85ce5a11e04f742f0a2`
  and tracked manifest byte SHA-256
  `48b94d286f50a33f9cb9095e05655f6eba2d4ae712c1adb99f033ac6162339e4`.
  Do not reuse either predecessor PR's artifact receipt.

### Current production boundary

- `yw.bdfz.net` currently resolves to Pages deployment
  `18213286-37d1-4b71-80b6-78e8b986ed3d`, source
  `a97eba7589ed6afa7df30ba4f37f2241a22d90d0`. Deployment
  `8da16237-ac91-47e1-afe2-7843e2d4c8a4` / source
  `0ff5d5604ceefef92c99c07033f1e900d9edaaed` is the stable rollback, not the
  current production carrier.
- Keep production D1 migrations 0001--0005 and all existing rows intact. Live
  reading remains schema v4/evidence v1; the current producer is the v1 Queue,
  while v2 main/DLQ remain paused with no producer or consumer. Learning health
  remains transport/formative-only and cannot be cited as scoring or A+ proof.
- User Center production remains the v251 rollback. The existing Web cookie
  binding is not native/v2 authority, and neither production nor current UC
  source implements the native mastery method required by this YW candidate.
  Treat every later 2026-08-11 "current production" paragraph as historical.
  Do not deploy from this source draft.

## 2026-08-15 assessment and bounded evaluator-retry contract

> **Superseded on 2026-08-23:** the following historical `.001Z` evaluator-
> exhaustion contract is retained only as incident evidence. Evaluator-owned
> failures now use the top-of-file `.002Z` short-cooldown contract and consume
> no learner slot.

- Keep objective grading source-owned in `site/study-guide-assessment.js` and
  the realistic corpus in `scripts/study-guide-answer-fixtures.json`. A
  single-choice response is accepted only by this precedence: one explicit
  choice on the full response; exactly one answer-lead A--D letter; or exactly
  one deduped A--D letter in the full response. Multiple distinct letters are
  ambiguous. Do not reintroduce `而` as a lead splitter: ordinary phrases such
  as `从文意而言，应选A` and `而A项的解释有误` must remain intact. Preserve the
  explicit known rejection of `A项错误，B项正确`. Circled-source feedback renders
  the source glyphs (`①②④`) even though grading compares numeric identities.
- `learning_submission_slots.created_at` remains the schema-free durable lease.
  A first evaluator-stage failure may exact-CAS the current `.000Z` lease into
  an expired time, allowing one immediate contender to reuse the same event and
  write the once-only `.001Z` reclaim marker. Concurrent release/reclaim races
  must admit one change/evaluator, never a new slot. If the reclaimed evaluator
  fails, expire its timing without removing `.001Z` and return
  `evaluator_retry_exhausted`; every later attempt remains rate-limited. Never
  release for D1, final-ledger, outbox or Queue-recording failures. The bounded
  promise is one YW slot and at most two APIS calls, not zero upstream cost.
- Keep `learning_submission_rate_limited` backward compatible while preserving
  `limitReason=window_capacity|evaluator_retry_exhausted` and the exact positive
  `retryAfterSeconds`. Both browser surfaces must distinguish capacity from
  exhausted evaluator retries; neither may tell a student to loop immediately.
- `/api/learning-check` remains retired, but its request must pass the normal My
  authentication boundary before 410. `/api/chat` is unused and retired with
  410. `/api/lesson-blueprint` must stay source-deterministic and spend zero APIS
  calls for anonymous or authenticated requests. Do not replace this with an IP
  limiter or a per-request mutable global; any future runtime-AI restoration is
  a separate authenticated capability transaction.
- Pull-request CI must retain the manifest, evidence, preview isolation,
  assessment fixture, browser retry and deterministic lesson-blueprint suites
  under exact Node 24.18.0 and 22.21.1. Hostile coverage must include evaluator
  call/parse/normalize failure, immediate retry, ten-way release and reclaim,
  `.001Z` preservation, third-evaluation rejection, and zero-APIS retired routes.
- This is a `no-new-capability` source-only change. Existing Pages, D1, Queue,
  User Center, App and scoring contracts remain unchanged. Rollback is to revert
  the exact candidate commit and regenerate/check the formal artifact manifest;
  there is no production rollback because this task deploys and writes nothing.

### Future GKS Beijing-paper relationship (separately blocked)

The claimed “2026 北京卷语文” JSON remains an unverified YW input and must not
be treated as a YW question bank, answer authority or release input. GKS owns
the upstream evidence. Current canonical GKS `master` is
`c741e66add56d458df37bcf678ba8fec61779645`; its current rolling-five release
is 2022--2026 with 119 items. Draft PR #1 remains an open conflicting historical
branch whose relevant content is already present on canonical master; it is not
the current source or publication authority.

Canonical convergence does not make the GKS release reusable YW authority. A
future YW transaction must independently re-read the then-current GKS source
and live hashes and require a continuous original paper, two independent
sources, per-page/per-question visual evidence and crop SHA-256, independent
Codex answers, dual sign-off and the public release hashes.

After that gate, use a separate PR from the then-current YW `main`. The only
intended first-stage surface is a hash-pinned, link-only overlay rendered in
`site/assets/app.js#renderMatrix()` inside the existing
`site/index.html#transfer-matrix`. A deterministic new mapping may contain only
GKS source pins, `resourceKey`, `resourceVersion`, `questionType`, order, crop
SHA-256, exact GKS deep link, and a manually reviewed YW lesson/competency
association. It must copy neither question text nor answers, use
`credentials: "omit"`, keep `evidenceOwner=gks` and `scoringRole=none`, and
hide on coverage/manifest/version drift. The existing forum-blockquote “本課真題
錨點” is presentation content, not GKS publication proof.

Until that independent transaction is authorized, do not touch
`site/data/manifest.json`, `site/data/lessons/**`,
`site/data/learning-manifest.json`, `site/data/lesson-competency-manifest.json`,
`site/data/study-guide-catalog.json`, vocab/reader-document data,
`site/app-content/**`, `site/app-content/latest-stable.json`, `site/_worker.js`,
preview registries, `wrangler*.toml`, migrations, Pages projects, D1, Queue,
User Center, APIS, nav, Pulse, Companion or either native content repository.
Do not run `build:data` or route exact GKS links through the YW preview proxy.
Those are explicit production/shared-hub NO-GO boundaries, not deferred work
inside this assessment/retry candidate.

## 2026-08-14 dedicated precheck project contract

- The primary `yuwen-course` project must keep all previews on
  `yuwen-reading-db-preview` with no `USER_CENTER_EVIDENCE` service and no
  `LEARNING_EVIDENCE_QUEUE`. Pages preview bindings apply project-wide, not to
  one branch, and the project retains historical preview deployments.
- Only the new Direct Upload project `yuwen-course-foundation-precheck` may use
  `wrangler.precheck.toml`. It binds `USER_CENTER_EVIDENCE` exactly to
  `bdfz-user-center#YuwenEvidenceIdentity` and the preview D1, but contains no
  Queue, production D1, custom domain or production traffic binding.
- Before any deployment, the external executor must read back that the named
  project is newly created with zero deployment history. It may then deploy
  one exact write-disabled artifact, require a single exact deployment and
  verify the source SHA and binding topology. Reusing the primary project or a
  project with prior deployments fails closed.
- Apply preview D1 migration 0005 in its own journaled phase, independently of
  production YW 0005. Require the exact migration hash, sole-new ledger row,
  schema, `quick_check`, foreign-key and aggregate watermark readbacks before
  the precheck may authenticate a test account or reconcile central receipts.
- `npm run test:preview-bindings` and
  `npm run check:precheck-binding-types` are the executable source gates. CI
  runs three binding tests with the existing 41 focused learning-contract
  checks, for 44 tests per exact Node job.
- This source correction creates no Pages project, deployment, migration or
  student-data write by itself. Scoring policy, artifact bytes and App pointer
  remain unchanged.

## 2026-08-13 structured error and idle-recovery closeout

- All generic learning-interaction failures that represent a classical reading
  prerequisite retain a machine-readable `classical_*` code, HTTP 422 status,
  `retryable=false` and `retryAfterSeconds=null`. A timed submission conflict
  retains its exact positive retry interval. `site/assets/learning-evidence.js`
  must pass these fields to the caller; it must not throw away the response as
  a generic network failure.
- Catalog/formative cache skew is a route boundary, not only a helper
  invariant. On the first digest mismatch, invalidate both authorities and
  reload the catalog once. If the submitted digest or item semantic revision
  changed, return `study_guide_catalog_changed`/409 before APIS, reservation,
  learning-ledger, outbox or Queue work. The hostile route test must observe
  the old then new catalog digest and zero prohibited writes.
- Idle recovery uses the existing supported request chain. The exact canonical
  User Center SHA comes from the UC strong-workspace audit pin at review and
  release time; that source runs hourly `scheduled()` growth-source
  maintenance, and its exact YW probe requests
  `https://yw.bdfz.net/api/learning/health`; the YW Pages request context
  attaches `drainEvidenceOutbox(env, 50)` with `ctx.waitUntil`. The drain
  reconciles before retrying and preserves the pending-mapping monotonic CAS.
  Do not add a Pages Cron Trigger.
- These changes do not alter the learning/scoring contract or Web/App content.
  Keep `site/app-content/latest-stable.json` byte SHA-256
  `a5ccd441deb7b0111517c9c1ec597b98e16a6dac789bd32bff3daa96960285a7`.
- Pull requests run `.github/workflows/learning-contract-ci.yml` on exact Node
  24.18.0 and 22.21.1. The workflow has read-only repository permission and
  runs the focused learning-manifest/evidence tests plus a deterministic formal
  Web artifact build/check against the tracked checksum manifest; it must never
  gain a deploy, Cloudflare credential, D1 or Queue step. Run
  `precontent:check` separately on both Node authorities before a release-source
  handoff.

## 2026-08-13 evaluation correctness and retry boundary

- `site/study-guide-assessment.js` is the source-owned objective grader. Choice
  extraction is limited to the answer lead and accepts exact letter or circled
  choices; explanation prose is never searched for extra option letters.
  Punctuation and sentence segmentation use deterministic source comparison.
  Open answers may use APIS only when no deterministic rule applies; their
  normalized result must contain a finite 0--100 score plus all required
  feedback fields. A real zero stays zero and malformed output fails closed.
- `site/data/study-guide-catalog.json` and
  `site/data/lesson-competency-manifest.json` are one release boundary. Before
  a write, the Worker verifies catalog digest and item semantic revision against
  the formative manifest. It may invalidate and reload both caches once; any
  remaining mismatch returns `study_guide_catalog_changed` and does not reserve,
  grade, or write evidence. The current content-addressed snapshot is 241 total
  / 193 active / 48 tombstones, catalog
  `yw-study-guides-eae416d57be24516`, formative
  `yw-formative-65a150df80285f4e`. These counts describe this release only;
  updated questions require a new task-pool digest and complete mapping/readback.
- AI interaction evaluation is not an anonymous practice API. It requires a
  My-authenticated identity, a non-empty client mutation ID, and a durable
  submission reservation created before APIS. The reservation is bound to
  user, resource, payload, window and source event; only the in-process trusted
  object can finalize it. Duplicate evaluation returns an exact remaining
  retry window, not a generic immediate retry instruction. Failed evaluators
  remain bounded by the same eight-per-resource/ten-minute policy. The browser
  retains the mutation ID across failures/in-progress responses and deletes it
  only after an accepted durable receipt; do not generate a new retry ID.
- APIS requests abort after 20 seconds. The legacy `/api/learning-check` route
  is deliberately HTTP 410 because it had no source-ledger/My evidence write;
  do not restore a parallel evaluation endpoint. Existing local anonymous
  records remain preserved but cannot be accepted as new evidence or completion.
- Preview and production use the same exact service-binding identity contract.
  With a session cookie but no working `USER_CENTER_EVIDENCE.resolveSession`,
  evaluation fails 503. No cached identity, public HTTP `/api/me`, browser body
  identity, or native/Web mismatch may authorize a student write.

## 2026-08-12 e310/v2 learning-source contract override

This source-only override supersedes the older frozen-denominator statements
below for a future 2026–27 release; it does not change current production.
User Center remains the identity, immutable-evidence and A+—F scoring core.
YW reports server-verified facts through the existing dedicated Queue and must
never report a grade, weight, points, band or source cap.

- `site/data/learning-manifest.json` and
  `site/data/interaction-definitions.json` jointly define contract
  `yw-aplus-e310-v2`: release `yw-release-f78c3cae78ac3ac3`, 869 mapped
  resources, 768 eligible performance units, 101 non-scoring evaluations and
  the fixed 2026–27 requirement of 692 distinct canonical units.
- The annual policy and task pool are independent. A fully mapped later
  release can create another valid route to a canonical unit, but cannot
  change 692, the A+—F bands, dimension weights, targets or source caps without
  an explicit new academic-year policy version.
- Formal envelopes use the distinct new event schema
  `bdfz-learning-evidence-event-v2` and carry the delivery lineage required by
  the central source contract. Legacy `bdfz-learning-evidence-v1` is emitted
  no longer and remains only in the User Center historical adapter. Delivery identity
  includes source contract/release, canonical unit, resource version and
  source attempt. Annual scoring credit uses user, academic year, policy
  version and canonical unit, so Web/Android retries and revisions do not
  double-count.
- During the paired User Center cutover, the isolated `yw-v2` consumer accepts
  only e310/v2 events for `2026-2027`; the existing `yw-v1` consumer remains
  attached only for legal historical backlog replay. Neither queue may accept
  the other contract or academic year. Old evidence and snapshots are
  immutable; no synthetic migration or completion backfill is permitted.
- Apply `migrations/0005_learning_evidence_central_receipts.sql` before the
  Pages carrier. It adds only central receipt state and one recovery index;
  it does not update or delete an old outbox row. Reading health then reports
  `reading-schema-v5`. A missing migration makes health fail closed.
- The source outbox is the durable recovery authority. Queue `enqueued` is
  transport state only. User Center returns exact per-attempt dispositions;
  `accepted` and `quarantined` settle an attempt, while `pending_mapping`
  stops duplicate Queue delivery but remains polled until it advances to a
  terminal result. The receipt write is an exact compare-and-swap against the
  disposition that was read, and only D1 `changes=1` counts as reconciled;
  stale polling therefore cannot move a terminal row backward. Stale
  unresolved `pending` or `enqueued` v2 attempts are re-emitted with the
  original identity and payload.
- YW is Cloudflare Pages: it can produce Queue messages but cannot own Cron
  Triggers or Queue consumers. Recovery is invoked by normal interactions and
  `/api/learning/health`; User Center's hourly Worker probe supplies the idle
  recovery heartbeat. The UC Worker owns main/DLQ consumption and bounded
  scheduled replay. Do not add a Pages `[triggers]` block.
- `deliveryRecovery` in compound health is aggregate-only and contains no
  student or attempt identity. Unknown releases are durably observed as
  `pending_mapping`; no unimplemented alert is claimed.
- Historical v1 delivery is not recoverable through the v2 source outbox.
  Production cutover therefore remains blocked until the v1 main queue and
  DLQ are empty and every v1 YW outbox identity is reconciled against User
  Center, or an explicit original-key v1 replay path is implemented and
  verified. Queue emptiness alone is insufficient.
- Unknown release/version/mapping is a pending-mapping operational condition,
  never a student zero or F. It may be replayed only through the central
  idempotent helper after the mapping becomes active; it is observed and
  surfaced, not described as alerted unless an alert delivery receipt exists.
- Android consumes the same formal resource inventory and User Center ledger;
  no Android-specific denominator or scoring route exists. This change does
  not alter the App repository or release pointer.

Source verification before any paired release:

```bash
npm run check:learning-manifest
npm run test:learning-manifest
npm run test:evidence-contract
npm run test:formative-mastery
git diff --check
```

The central architecture authority is User Center
`docs/LEARNING_EVIDENCE_AND_SCORING_ARCHITECTURE.md` together with workspace
`runbooks/bdfz_learning_evidence_integration_standard.md` v2. This candidate
uses stable Cloudflare Queues plus D1 and Worker scheduled maintenance.
Workflows, Dynamic Workflows, Pipelines and D1 read replication are not part
of the grade-authoritative hot path.

## 2026-08-12 User Center and native evidence boundary

- Do not equate the 723 active vocabulary questions with formal evidence.
  `site/data/learning-manifest.json` is the item-level authority: the current
  graph contains 382 formal vocabulary resource keys and 341 additional
  student-visible local-practice questions. The browser must keep all 723
  visible, submit only an exact manifest match, fail closed if a formal key is
  absent from the active vocabulary index, and label local practice as not
  part of formal A+ evidence. Changing the 382-item formal subset is a source
  policy change, not an App/UI synchronization fix.
- Keep `recordLearningInteraction` as the only authority for YW correctness,
  attempt number, eligibility, scoring role and resource key. Native clients
  send raw answers only and reuse the same `/api/reading/*` handlers.
- A native request is authorized only by the existing User Center
  `bdfz-native-auth/1` projection for client `yuwen-native-android` with data
  capability. A malformed bearer never falls back to a Web cookie, and two
  simultaneous credentials must identify the same User Center user.
- Compound learning health contains deliberately separate formative and A+
  receipts. The current 2026–27 A+ authority is e310/v2 (869 published, 768
  eligible, fixed requirement 692); the older 1,156-item b530/v1 descriptor is
  historical 2025–26 authority only. Never substitute formative transport or
  a historical descriptor for the resolved annual A+ contract.
- Queue delivery is at-least-once; stable mutation IDs and source event IDs are
  the idempotency authority. `enqueued` is not consumer-delivery proof.
- Historical anonymous interaction responses may still be displayed from local
  state but cannot advance completion or A—F evidence. New evaluation requests
  require authenticated My identity; unknown evidence statuses fail closed.

### Classical Web-to-App content projection

- Native content must consume, never reconstruct, the reviewed Web artifacts
  in `site/data/classical-first-read/`. The source index currently contains 30
  lessons / 102 paragraphs and fixes `offsetUnit=utf16_code_unit`, stable
  paragraph keys, exact text versions and text digests.
- `scripts/build_native_content.mjs` validates that every first-read lesson is
  an active student lesson, that index and asset counts/versions/digests agree,
  and that the combined text equals the ordered paragraphs. It emits one
  `classical-first-read-index` object plus 30 receipt-bound
  `classical-first-read` objects and catalog paths.
- This projection does not alter the learning manifest, formal vocabulary
  denominator, score, eligibility or A+ contract. A dirty or blocked build may
  only write a candidate pointer; moving `latest-stable` still requires clean
  source, a real Pages deployment receipt, a current independent content audit
  and the paired Android import/verification transaction.

## 2026-08-11 Web reading finalization override

This is retained as the 2026-08-11 operational receipt. The 2026-08-15 current
production boundary at the top supersedes its former current-production claim.
Older paired Web/App and 2026-08-09 candidate sections remain historical.

### Current student flow

- Students can use 189 lesson units. The source manifest retains 191 records,
  including two hidden system records. All 189 student-visible pages use one
  masthead for title, `起始` orientation, portrait and a collapsed owner-scoped
  local-step disclosure. The main reading column no longer reserves a separate
  right rail. The redundant `先找方向` label is absent. New readers default to
  126%, while a stored local or remote reading-size preference remains intact.
  The atlas and progress denominator use the 189 student units; two system
  records remain hidden, and a valid explicit lesson URL wins over anonymous
  remembered history.
- The 30 classical lessons first collect the immutable no-punctuation,
  no-annotation reading. After submission, that reading remains visible,
  followed by source-bound learning tips and the canonical annotated text.
  Inline notes are numeric superscript buttons with `role=note` content, hidden
  initially, typed only once, and collapsed on repeat click or Escape with
  focus restoration. The shared renderer binds all 2,933 references to the
  preceding visible character or word in both classical and modern texts.
- Vocabulary and vocabulary/syntax study-guide interactions require the
  existing non-scoring `readAcknowledged` receipt for `annotated_reading`.
  Client mutation IDs are stable per lesson/text version; the Worker enforces
  the receipt and preserves idempotent replay. Existing vocabulary evidence is
  grandfathered so previously active students are not stranded.
- `site/data/classical-learning-tips.json` deterministically projects 18
  source groups to all 30 classical lessons. `site/lesson-blueprint-rules.js`
  gives all 189 student lessons a unique text-anchored, mode-specific structure
  question and rejects author impersonation or generic rearrangement prompts.

### Resource and preview policy

- `site/data/wechat-archive-map.json` is the reviewed source-to-archive map for
  all nine student-visible WeChat articles. Rendering and preview generation
  must contain `wx.bdfz.net`, never direct `mp.weixin.qq.com` targets.
- `bdfz.yuque.com` is forbidden in student-visible links and preview targets.
  Exact `pkuschool.yuque.com` lesson pages may be proxied; exact Google Sites
  lesson pages are screenshot-first and 17 reviewed BDFZ exact roots load the
  real remote sites directly in card and full-page modes. `xue.bdfz.net` is
  absent from student resources and every preview authority.
- Preview registration is exact-target: arbitrary sibling paths, redirects to
  an unregistered target, active MIME and IP literals fail closed. Current
  registry: 538 targets / 118 redirects / 75 hosts, digest
  `sha256:887931515ae55b93d579a6892b5146ef68466c1e2c3ae5ed0c8022e00f2e84b7`.
- Every rendered iframe/document/image/audio/video preview exposes a full-page
  expand control. Close, Escape and shrink clear the mounted media and restore
  focus. After exact deletion of E01, 16 permanently unavailable resources and
  the confirmed-dead Bilibili item and the empty exact Sichuan gazetteer
  `content_30068` page, the audited set is 351 page resources: 334
  have screenshots, 11 have a verified direct presentation, and 6 are not
  embedded because an external condition remains. The 49 authenticated
  recoveries are 22 `ctext.org` pages and 27 `forum.rdfzer.com` pages; their
  browser credentials, cookies and session state are not stored. The 334
  entries deduplicate to 328 WebP files / 12,795,016 logical bytes;
  `site/data/preview-screenshots.json` SHA-256 is
  `30193e813611eb5e9ec09e2da99f81e5bca50597ed8b16839097eb70458333af`.
  Deleted resources are removed from the Web projection and registries rather
  than retained as blockers; no permanent/remove blocker remains.

### Release, data and rollback

Safe QX hash routes use the exact remote app; all 17 Wikisource targets use
reviewed screenshot-first rendering; five YouTube resources use explicit
click-to-play `youtube-nocookie.com` frames. The lesson chat stays unloaded
until the student selects `進入同讀`, so its remote input cannot focus and
scroll the parent lesson before user action.

Current production is Pages deployment
`18213286-37d1-4b71-80b6-78e8b986ed3d`, clean carrier source
`a97eba7589ed6afa7df30ba4f37f2241a22d90d0`, deployed at
2026-08-11T16:25:28.112875Z. The atomic deployment URL and `yw.bdfz.net` return the
same formal marker SHA-256
`e384299f11f5695cfe118950bf4f486e1d803ba6fca4335816c49e03dac437c8`.
Remote readback confirms D1 migrations 0001--0004, `reading-schema-v4`, and
compound learning health 200. This Web release did not export, migrate or write
D1; it changed no User Center, Queue, App or scoring contract.

Live atomic/custom-domain byte checks match the carrier for the marker, app,
styles, prompt rules, preview registry, screenshot manifest and classical-tip
dataset. Production serves 191 source records / 189 student lessons, registry
538/118/75 and screenshot disposition 351/334/11/6. A read-only 390-pixel
browser smoke confirms numeric note expansion, no horizontal overflow, all five
top links opening safely in new tabs and no `xue.bdfz.net` DOM reference. The
live independent-load sweep passes all 189 lessons and 30/30 aggregate checks.

User direction pauses App/User Center follow-up while the Web content is
settled. Therefore `check:native-content:deploy-sync` is expected to reject the
new Web graph and is not reported as passing. Do not create a replacement App
receipt/schema or move `site/app-content/latest-stable.json`. Build the
production `formal-stable` artifact, verify its marker/checksum and deploy only
from a committed clean tree. Roll back Pages to the stable deployment
`8da16237-ac91-47e1-afe2-7843e2d4c8a4` if live checks fail; preserve D1 and the
unchanged App pointer.

No new Cloudflare capability is adopted. Release tooling is Node `24.18.0`
from `.nvmrc` and lockfile Wrangler `4.100.0`.

## 2026-08-09 self-study-loop candidate override (historical)

This section records the 2026-08-09 source and release disposition. It is
retained as historical production evidence and does not authorize the current
Web release.

### Learning flow and source authority

Classical lessons use three visible stages:

1. `起始 · 無注疏初讀`: an authenticated student marks at least three UTF-16
   ranges in a no-punctuation text, records first guesses and a summary, then
   submits an immutable first-read snapshot.
2. `細讀 · 詞級疏通與知能清算`: textbook punctuation/inline annotations and
   selection lookup unlock; server-owned vocabulary and study-guide assessment
   determine eligibility. A previously wrong vocabulary answer needs the
   source contract's subsequent correct evidence and the browser follows the
   server verdict.
3. `考辨 · 評價與遷移`: the 0--100 `本篇有意思` slider is non-scoring, while
   curated comprehension items use source answers or a visibly labelled,
   non-unique `Codex 參考答案` rubric.

Modern lessons keep the existing three-word initial response and
`字句之改`. Classical lessons do not render the old duplicate `通讀正文` or
`字句之改` stages.

The no-punctuation artifact is generated from the reviewed textbook reader,
not copied blindly from a special study guide. The Qu Yuan special PDF omits
three textbook passages and contains transcription differences; the Su Wu
special PDF includes a later supplement outside the selected textbook excerpt.
The PDFs remain authoritative for learning cards, prompts and supplementary
material, while the textbook reader remains authoritative for the displayed
canonical lesson text and stable offsets. The UI states this distinction.

### Formative identity and scoring isolation

The public aggregation unit is `lessonId + competencyTag`, with four tags:
`first_read_process`, `vocabulary`, `syntax` and `comprehension`. The current
active completion-key set is the denominator; valid completed keys intersect
that set for the numerator. A semantic change to prompt/answer/rubric/tag gets a
new completion key, while an unchanged rename or explicit reviewed alias may
preserve completion. Retired and review-required items remain in history but
leave both numerator and denominator. A zero denominator is `unavailable`, not
0%.

The exact candidate contracts are:

```text
Interaction registry:      yw-interactions-2026-08-09-v2
Formal manifest:           yw-e310d45b1d81e9ad / 869
Formal digest:             sha256:e310d45b1d81e9adf6182bd50ea02842daf69a8981aa29ff03b2da30b0846aca
Formative manifest:        yw-formative-52b574175221646f / 1,021 / 115 lessons
Formative digest:          sha256:52b574175221646f466a1f55c64730195a99e2756c59a6ea83717da8811832c9
Study-guide catalog:       yw-study-guides-f4c48caf4acbabb4 / 241 / 193 active
Study-guide digest:        sha256:f4c48caf4acbabb44e14b6d01011c91cb8b659845cf492cecd43348424aa575d
```

`studyGuideItemCompleted` is `performance + formative +
source_mixed_assessment`; only a server-normalized eligible result at or above
60/100 enters the formative numerator. This projection is non-scoring and must
never activate or change A--F, A+ or a formal coverage receipt.

### Resource location and restore

The five original PDFs and extraction JSON are required external source
material under:

```text
/Users/ylsuen/CF/output/pdf_study_guides_web/
```

Their exact paths, SHA-256 values, byte counts, page counts, extraction paths
and extraction receipts are recorded in:

```text
scripts/study-guide-curation/special-guides.json
scripts/study-guide-curation/selected-compulsory-upper.json
scripts/study-guide-curation/selected-compulsory-middle.json
scripts/study-guide-curation/selected-compulsory-lower.json
```

`npm run verify:study-guide-sources` must read the actual PDF/extraction bytes
and page metadata before a release. The JSON catalog under `site/data/` is
derived and regenerable; the PDFs are not committed. No accepted remote archive
or restore authority is currently recorded, so these five PDFs and extraction
files **must remain local and must not be deleted or replaced**. Until a
path-preserving archive receipt is added, there is intentionally no claimed
restore command.

Reader media is separately bound by
`site/data/reader-media-receipts.v1.json`: ledger `2026-08-09.1`, 165 objects,
28,066,373 bytes, inventory
`2c7672e88dc8e1bb0ea1e4af84e59ccaf521ded73e774e35c03abd5547f69d03`.

Textbook page images used by native-content and full precontent verification
have a separate durable, path-preserving restore authority. The canonical local
root is:

```text
/Users/ylsuen/textbook_ai_migration/platform/frontend/assets/pages
```

These are non-personal copyrighted build inputs whose archived bytes are the
source authority for verification; the canonical local root is normally absent
and is restored only as a disposable whole-path working copy. The archive and
tracked inventory are retained for rebuild and source rollback; no page-image
fixture belongs in this repository.

The accepted archive receipt is
`/Users/ylsuen/CF/reports/storage_archive_records/2026-08-15-textbook-ai-migration.json`;
the byte authority is the tracked
`/Users/ylsuen/CF/jc-textbook-reader/manifests/page-images.sha256`. The receipt
records 107,108 archived files / 8,571,954,882 bytes, 107,108 checksum matches,
zero differences, the exact 608-directory set and long-term retention. The
verified durable restore is whole-path only; do not invent or document a
selective 693-file restore authority. With the canonical destination absent,
restore and verify it as follows:

```zsh
test ! -e /Users/ylsuen/textbook_ai_migration
/Users/ylsuen/CF/scripts/restore_gdrive_archived_path.sh \
  Users/ylsuen/textbook_ai_migration
rclone check \
  gdrive:Backups/CF-Archive-v1/files/Users/ylsuen/textbook_ai_migration \
  /Users/ylsuen/textbook_ai_migration \
  --checksum --one-way
```

`scripts/build_native_content.mjs` then checks each referenced page against the
tracked SHA-256 inventory before using it. This restore authority was accepted
and read back on 2026-08-15. The 2026-08-20 hardening run used a disposable
693-file subset that matched that inventory; it did not re-read Drive and the
subset is not a retained project resource or release authority.

### Release disposition

This candidate is fail-closed:

- current live `/api/learning/health` is 503 under the old single-manifest
  handshake;
- the clean User Center consumer candidate
  `f1874e5cc2ed39a907f50c2badfb4cfd7aba55f6` is not deployed and is not
  authorized by the installed root release guard;
- production D1 migration 0004 is absent; no production D1 write has occurred;
- teacher/class aggregation is deferred until a versioned, complete and
  session-stable class-authorization source exists;
- the native App repository and `latest-stable` pointer remain unchanged.

Do not deploy the new YW producer, apply migration 0004, claim User Center
sync, or start App import until the User Center consumer has independent review
and release authority. A Web-only preview must carry
`releaseKind=preview-web-only` and exclude `app-content/`.

## 2026-07-30 Web/native shared-content release transaction

The website repository remains the content authority. The independent native
client repository is `/Users/ylsuen/CF/yuwen-native-android`; it must never keep
a hand-edited copy of website content. Both clients consume the same generated,
versioned and content-addressed graph.

Current synchronized source graph:

```text
Books / lessons / posts:       5 / 191 / 1,153
Reader annotations:            2,932 unique / 2,933 references
Reader media:                  165 unique URLs / 167 visible references
Reader media ledger SHA-256:   5487243dd8d14d65dfadc20ed544a999aaa318fc20c291462ea62c69e1eff320
Reader inventory SHA-256:      2c7672e88dc8e1bb0ea1e4af84e59ccaf521ded73e774e35c03abd5547f69d03
Active vocabulary questions:   723 / 77 classical-or-poetry lessons
Eligibility tombstones:        344 / 56 nonclassical lessons
Quality tombstones:            35
Reviewed vocab exceptions:     0
Learning manifest:             yw-7abfb37143d876fd / 901 items
Native semantic digest:        sha256:3e77f0f7ffa5d042a6d06763789858ea89f5194eb4e157e80ddb95f2ac8b5543
Compatible content version:    yw-3e77f0f7ffa5d042a6d06763
Compatible release receipt:    sha256-ab04efc472f2346bccf4f7e7eb77f35ac75456a7a3af98d426b385a74524bb06
Stable pointer SHA-256:        a5ccd441deb7b0111517c9c1ec597b98e16a6dac789bd32bff3daa96960285a7
Manifest SHA-256 / bytes:      a866d2a2b89877a8d511622a3f736481401cb48b0da88fc39c1c50cead7fe1c3 / 110,119
Core SHA-256 / bytes:          6cc5e1205de54012141a779a848939f54bd4be1370f2d81f1c7397ec90cfb823 / 16,517,004
```

The native digest above is approved by the tracked independent audit receipt
after three byte-identical isolated rebuilds. A second three-build audit bound
the exact clean source `fd7a482ac88e6baa0da79d69b2fea88c7b00d195`,
preview deployment `54232d7c-7e6c-4a14-a6b8-d6543efc1134`, publication
time `2026-07-30T06:18:00.123175Z` and disposition
`compatible-and-synced` to the compatible receipt above. The three candidate
trees contained 278 files / 33,143,783 bytes and had the same canonical
inventory aggregate
`7816d7b31aedafd379b13668d58e05099a3c2c458523a3c50c72dd699a9031a8`.
The stable pointer references this exact release. Production publication and
public readback completed as Pages deployment
`20be2885-5494-4b98-a130-af022c1a389b` from source
`e87c697119d7d75d01def58ff781524f73bb3ff9`, with immediate rollback
`ada922c5-62e7-46cc-bcd7-7e97dddcc522`.

The 2026-07-30 custom-domain readback reran
`node scripts/verify_deployed_native_content.mjs https://yw.bdfz.net/` and
verified the exact content version, semantic digest and release receipt above,
all 276 immutable objects, five approved slide PDFs, 70 explicit missing-deck
entries, five representative textbook images and healthy Reading API state.
The synchronized Web release did not apply a D1 migration, mutate D1 data,
enable another Cloudflare paid product, or release a new signed Android binary.

The earlier independent review found two historical immutable App-content
receipts under the old `yw-9897f39b3236f2e351415ebc` release that preserve a
malformed AI Studio state payload. The approved digest above does not approve
those historical bytes. The formal release tree now parses JSON string values
for privacy review, includes only the one release referenced by the reviewed
stable pointer, and excludes every historical release object.

`build_release_site.mjs` now has two explicit, non-interchangeable artifact
kinds:

- formal `formal-stable`: requires `latest-stable.json`, reproduces its release
  receipt, verifies the pointer, manifest and every object by exact path, bytes
  and SHA-256, then includes only that pointer and that one immutable release;
- non-production `preview-web-only`: excludes the entire `app-content/` tree so
  the reviewed Web source can obtain a Pages preview deployment UUID before a
  new stable native release exists.

Every JSON file is parsed and every decoded string is checked with the shared
URL sanitizer and privacy patterns. If an immutable native JSON string would
need sanitization, formal staging fails instead of changing its bytes. The
`yw-release-site-v2` marker records the artifact kind, exact native allowlist
and receipt, and excluded historical prefixes; staging verification recomputes
the artifact aggregate and rejects any candidate or historical native path.

```zsh
# Web-only, non-production preview artifact
npm run prepare:preview-artifact

# Formal production artifact
npm run build:release-site
npm run check:release-site
```

Never deploy a `preview-web-only` marker to the production branch. Formal
`release:check` still requires native deploy synchronization and
`formal-stable`; the preview mode does not relax or move `latest-stable`.
The current formal artifact passed with 852 files, 278 exact App-content paths,
zero candidate paths, zero historical release paths and aggregate
`c79cad29e7ca32f2fc11391f7c3e8029f7d1c279eef5857efbfdbef90f9740f1`.

The previously documented `sha256-041b…` blocked receipt was a provenance
error: no corresponding pointer or release tree exists. It is forbidden as a
release, import or rollback anchor.

Vocabulary eligibility is sourced only from
`site/data/vocab-eligibility.json`. Nonclassical lessons do not fetch or show a
vocabulary stage. Existing D1/User Center attempts and evaluation history are
append-only and remain untouched even when a source item becomes tombstoned.

Reader annotation labels are canonicalized by first occurrence. Web and App
must never render source reuse labels such as `[3:1]` or BBCode color tokens.
The main text projection contains only the primary text and its annotations;
supplementary posts, resource links and images render only in the separate
materials section. Anonymous Web users get the existing User Center login
route with `returnTo`; this project must not add a local account flow.

The release transaction is fail-closed:

1. commit and deploy the reviewed Web source while the old App
   `latest-stable` pointer remains unchanged;
2. generate the App payload from that exact clean Git revision and record the
   Web deployment ID, schema, stable IDs and semantic digest;
3. publish and publicly read back immutable content objects first;
4. record exactly one App disposition:
   `compatible-and-synced`, `compatible-no-client-release`, or `blocked`;
5. move `latest-stable` last only when all Web/App tests and receipts pass.

Unknown schema, mismatched hashes, dirty generated output, missing media
receipts, an unreviewed audit receipt, or an incomplete App disposition blocks
the pointer move. The clean-source, deployment, publication, public-readback
and `compatible-and-synced` gates were satisfied for the exact production
release recorded above. Every future change must satisfy them again; a prior
receipt never waives a current gate. A Web content release may be compatible
without a new APK, but it may never omit the App disposition.

## 2026-07-28 completion eligibility and anti-farming (historical release)

Production deployment `33725793-42fa-437e-ab6d-bc712549e633` keeps every
authenticated YW attempt in the source-owned ledger and makes the Worker the
only authority for scoring eligibility. AI performance is eligible only when
the server result has `score >= 60` and correctness `passed`; vocabulary is
eligible only when the source-owned verdict is `mastered`. Evaluation remains
`self_report + scoringRole=none`.

Failed and learning attempts are still synchronized to User Center as
`ineligible` process evidence. They therefore remain visible for audit without
entering the Student Growth denominator. The browser cannot submit score,
correctness, attempt count, resource version, scoring role or eligibility.

The Worker accepts at most eight scoring submissions per authenticated
user/resource in a ten-minute window; the ninth returns `429`. An exact
client-mutation replay returns the stored evaluation without another APIS or
vocabulary write. Reusing that mutation id with another resource returns `409`.
These checks are source-side and require no D1 schema change.

Release acceptance:

```text
Production:             33725793-42fa-437e-ab6d-bc712549e633
Immediate rollback:     8c3cb13e-a954-4f79-a342-f072b0a950b4
Source contract:        8 / 8
Local Pages + D1 path:  37 / 37
Learning manifest:      8 / 8
Artifact files:         850
Artifact aggregate:     acb2daaadc5cfe358f6ccbc94798a68be5812ab31519f867c02f75be93fca491
```

No migration, student-row rewrite, synthetic attempt or completion backfill
was performed. Roll back the Pages artifact only; preserve the additive D1
tables and all later student history.

## 2026-07-26 learning-evidence source adapter (historical)

YW is the first source under the cross-site contract:

```text
/Users/ylsuen/CF/runbooks/bdfz_learning_evidence_integration_standard.md
/Users/ylsuen/CF/runbooks/student_growth_system_v3_2_0.md
```

Source-owned components:

- migration `0003_learning_evidence_loop_v1.sql`;
- raw ledger `learning_interactions`;
- evaluation table `learning_evaluations`;
- reliable outbox `evidence_outbox`;
- event registry `site/data/interaction-definitions.json`;
- named identity binding `USER_CENTER_EVIDENCE` →
  `bdfz-user-center#YuwenEvidenceIdentity`;
- dedicated producer `LEARNING_EVIDENCE_QUEUE` →
  `bdfz-learning-evidence-yw-v2`.

The browser may submit a lesson/resource key, interaction key, selected option
or raw input and client mutation id. It may not submit User Center ID, trusted
score, correctness, attempt number, manifest/registry version, scoring role or
A+ eligibility. Raw answers stay in YW D1; User Center receives only the
privacy-minimized projection. Future YW events must be registered on both sides
and unknown events fail closed.

The `evaluation` interaction is a `self_report` with `scoringRole=none`.
It remains visible in the process dossier but cannot add a dimension score or
satisfy an A+ gate. `npm run test:evidence-contract` constructs the real YW
envelope, sends it through a Queue-producer mock, and validates it with the
current User Center consumer registry from the sibling canonical source.

Cloudflare Queue producer success proves only that a message was enqueued. The
source outbox therefore records `enqueued`, not `delivered`; historical
`delivered` rows are preserved and are not rewritten. The current one-way Queue
has no consumer receipt channel. Consumer policy rejection remains visible in
User Center's sanitized `learning_evidence_rejected` log, so a future
per-message receipt requires a separately versioned receipt Queue or RPC
contract on both systems.

## 1. Scope and ownership

`yuwen-course` is a leaf project. It owns its Pages frontend, Pages Worker, generated lesson/taxonomy/vocabulary data, and D1 `yuwen-reading-db`. It consumes shared services but does not own their contracts.

Source and targets:

| Item | Canonical value |
|---|---|
| Local source | `/Users/ylsuen/CF/yuwen-course` |
| Git remote / branch | `https://github.com/ieduer/yuwen-course.git` / `main` |
| Pages project / host | `yuwen-course` / `https://yw.bdfz.net/` |
| Artifact | `site/` |
| Worker | `site/_worker.js` |
| D1 | `yuwen-reading-db` / `READING_DB` |
| Preview D1 | `yuwen-reading-db-preview` / `READING_DB` (`39ed36d9-b3f3-40fd-933a-9a68a4066302`) |
| User Center key | `yw` |
| Data class | `student_owned` |
| Verification | `docs/VERIFICATION.md` |

Do not modify or deploy `bdfz-user-center`, `apis`, `bdfz-nav`, `img`, `qunxian`, `jc-textbook-reader`, `chat`, `pulse`, or `bdfz-companion` as an implicit part of a YW release. A shared dependency held by another agent remains read-only.

## 2. Architecture and data ownership

```text
Browser / Companion legacy WebView
  -> Pages static artifact (site/)
  -> Pages Worker (site/_worker.js)
       -> D1 yuwen-reading-db: reading submissions and vocab attempts
       -> my.bdfz.net named RPC: immutable user ID with source key fixed to yw
       -> source-specific Queue: privacy-minimized process-evidence projection
       -> apis.bdfz.net: AI dialogue and authoring gateway
       -> GitHub Issues: read-only legacy lesson discussion lookup (POST retired)

Static/UI dependencies
  -> qx.bdfz.net: author portraits and figure dossiers
  -> jc.bdfz.net and img.rdfzer.com: textbook pages and source verification
  -> chat.bdfz.net: embedded public class chat
  -> nav.bdfz.net and img.bdfz.net: shared navigation and favicon/assets

Operational consumers
  <- my.bdfz.net: legacy progress readback + trusted process dossier/A+ gate
  <- pulse.bdfz.net: host coverage and availability reporting
  <- bdfz-companion: trusted WebView entry

Native YW App (independent repository)
  -> immutable content objects generated from this repository
  -> latest-stable pointer moved only after Web/App contract verification
  -> native offline store + idempotent User Center outbox
```

Non-regenerable data: D1 reading submissions, version history, vocabulary attempts, and student-linked evidence. Generated lesson JSON, taxonomy, vocabulary banks, and static assets are reproducible only when their source inputs and scripts are preserved.

Pages preview is deliberately data-isolated. Top-level `wrangler.toml` binds
only `yuwen-reading-db-preview`; `env.production` alone binds the production
D1, `bdfz-user-center#YuwenEvidenceIdentity`, and
`bdfz-learning-evidence-yw-v2`. Primary-project preview therefore cannot
authenticate or emit student evidence and must return 401/503 on those routes.
The separately governed `wrangler.precheck.toml` is valid only for the fresh
`yuwen-course-foundation-precheck` Direct Upload project described above.
On 2026-08-09 all 12 preview deployments created before this split were
superseded and deleted.
Ten deleted hash hosts return 404. Two deleted hosts whose Cloudflare edge
routes continued serving the old Worker are isolated by exact-host Access app
`5d768360-2dd8-458d-a743-182c9ced3b22` and deny policy
`eaa5cef6-e21f-4182-b9ce-15d000136fee`; the application does not cover new
previews or `yw.bdfz.net`. Remove that quarantine only after two privacy-bounded
probe rounds at least 60 seconds apart show no old Worker on every resolved
edge address.

## 3. Dependency map and contract probes

| Dependency | Contract used by YW | Safe probe | Release impact |
|---|---|---|---|
| `my.bdfz.net` | `site-auth.js`, `bdfz_uc_session`, `/api/me`, central progress/events | `GET /site-auth.js`; anonymous session/API boundary; authenticated canary only when task-authorized | Session/evidence changes require fleet and Companion regression |
| `apis.bdfz.net` | HTTPS gateway; `data.answer`; project/task/thinking headers | Existing YW AI contract test with allowed Origin | Gateway contract change is hub-level; YW must not patch it locally |
| `nav.bdfz.net` | shared navigation | `GET /sites.json` and widget asset | Widget schema changes fan out fleet-wide |
| `img.bdfz.net` | favicon/shared assets | `HEAD /20250503004.webp` | Never overwrite shared keys |
| `qx.bdfz.net` | `/img/figures/<id>.webp`, figure deep links | image HTTP/MIME/dimensions and representative deep link | Portrait ID/crop changes must be audited on every affected lesson |
| `jc.bdfz.net` / `img.rdfzer.com` | textbook viewer and source pages | referenced page/image sample | Source pages are verification aids, not author portraits |
| `chat.bdfz.net` | embedded public lobby | root/iframe reachability | Do not create a separate auth policy from YW |
| `pulse.bdfz.net` | host operational coverage | `/api/meta`, `/api/range` host record | YW deploy is incomplete if coverage silently disappears |
| `bdfz-companion` | trusted WebView entry | source allowlist check; real device only for session/API contract changes | Leaf-only content/UI changes normally need URL smoke, not an App rebuild |

Same-source clone family: none. YW shares concepts and assets with `jc-atlas`, QX, and reader sites, but is not a copy-templated member whose source should be bulk synchronized.

## 4. Configuration and secrets

Production bindings and variable names are listed in the README. Values stay in Cloudflare or `/Users/ylsuen/.secrets.env`; never print them into reports or artifacts.

Forbidden configuration:

- any leaf `GEMINI_API_KEY`, `GOOGLE_API_KEY`, `OPENAI_API_KEY`, or new project key pool;
- production `READING_TEST_SLUG`;
- browser-visible session, GitHub, CText, or API credentials;
- D1 schema changes without a migration and pre-change export.

## 5. Unified release workflow

### 5.1 Ownership and preflight

```zsh
cd /Users/ylsuen/CF/yuwen-course
pwd
git status --short --branch
git remote -v
git rev-parse HEAD
git ls-remote --heads origin main

set -a
source /Users/ylsuen/.secrets.env
set +a
./node_modules/.bin/wrangler whoami
./node_modules/.bin/wrangler pages deployment list \
  --project-name yuwen-course --environment production --json
```

Record the active Pages deployment and confirm no overlapping agent owns the repo, Pages project, D1, or a touched shared dependency.

### 5.2 Backup

- Copy every task-owned dirty file to `output/backups/<TASK_ID>/` and record SHA-256.
- For a substantial Worker, migration, or student-data change, export D1 with restrictive permissions:

```zsh
umask 077
./node_modules/.bin/wrangler d1 export yuwen-reading-db --remote \
  --output "backups/yuwen-reading-$(date -u +%Y%m%dT%H%M%SZ).sql"
```

Do not inspect or commit raw student rows. Static-only releases may record `no D1 write` instead of exporting when the verified artifact cannot mutate schema/data.

### 5.3 Local gates

```zsh
npm ci
PATH=/Users/ylsuen/.nvm/versions/node/v24.18.0/bin:$PATH npm run precontent:check
YW_STUDY_GUIDE_SOURCE_DIR=/Users/ylsuen/CF/output/pdf_study_guides_web \
  PATH=/Users/ylsuen/.nvm/versions/node/v24.18.0/bin:/opt/homebrew/bin:$PATH \
  npm run verify:study-guide-sources
PATH=/Users/ylsuen/.nvm/versions/node/v24.18.0/bin:$PATH npm run qa:web-polish
git diff --check
```

The current Web-only release deliberately does not run `release:check`: that
paired command includes the paused App synchronization gate. It must remain
fail-closed until App follow-up resumes; do not rewrite it as a Web pass.

Run a staged secret scan before commit or push. Generated cache, `output/`, `.claude/`, Playwright profiles, local D1 state, backups, and secrets are not source artifacts.
`site/data/cache/` is also excluded from formal release staging. Clean external
checkouts therefore verify every shipped index without hydrating that ignored
developer-only cache; a local cache, when present, receives the additional
removed-lesson regression check.

Reader media maintenance is deliberately explicit and never hidden inside an
ordinary build:

```zsh
node scripts/build_reader_documents.mjs \
  --stage-media-inventory <EMPTY_STAGING_DIRECTORY>
node scripts/collect_reader_media_receipts.mjs \
  --reader-documents-dir <EMPTY_STAGING_DIRECTORY>
npm run build:reader-documents
npm run verify:reader-media
npm run test:reader-media
```

The first command only creates a non-canonical inventory stage and records
`networkUsed:false`. The collector is the sole networked step. Review the
receipt/anomaly diff before rebuilding canonical documents. Ordinary
`build:reader-documents`, `precontent:check`, and release builds must not fetch
the network.

### 5.4 Preview

Deploy the exact checksum-fixed preview-kind `.release/site` artifact to a
non-production branch. Never deploy the raw `site/` source tree. The preview
branch must differ from `main`, and post-deploy readback must prove the
production canonical deployment ID did not move.

Verify on the preview URL:

- manifest/taxonomy/vocabulary counts and removed-record absence;
- all 191 reader documents, annotation projection and resource-link policy;
- all visible images joined to the reviewed media receipt ledger by exact URL,
  bytes, SHA-256, MIME and dimensions;
- 723 active vocabulary questions only in 77 classical/poetry lessons, 344
  eligibility tombstones, 35 retained quality tombstones, zero exceptions and
  absence of every tombstoned ID from the active set;
- Web/App schema, stable-ID, semantic-digest and fixture equality;
- reading health plus anonymous `401` boundaries;
- APIS, QX portrait, textbook-page, User Center SDK, and Pulse contracts;
- desktop and 390 px mobile layout, accessibility, navigation, loading/error states, dark mode, animation, and console/network cleanliness;
- vocabulary wrong/retry, same-lesson automatic next, final-question stop,
  lesson-switch race cancellation and persistence;
- canonical continuous annotations with no BBCode/raw reuse labels; main text,
  supplementary materials and resource/image actions remain separate;
- anonymous login CTA routes through `my.bdfz.net/?returnTo=...`;
- D1 write/read canary only when explicitly authorized and isolated.

### 5.5 Production

For the current foundation release, keep the App pointer disposition explicit.
From a fully committed tree with empty `git status --porcelain`, build and check
the `formal-stable` `.release/site` tree and its artifact manifest. This
checkout must stop there: `package.json` has no production deploy or rollback
entrypoint. The separately reviewed external UC+YW executor is the only path
that may consume that exact staged artifact and mutate Pages, D1, Queues or
traffic. Do not deploy raw `site/` or a `preview-web-only` marker.

The foundation artifact must preserve the current production and Android
pointer byte-for-byte: SHA-256
`a5ccd441deb7b0111517c9c1ec597b98e16a6dac789bd32bff3daa96960285a7`,
content version `yw-3e77f0f7ffa5d042a6d06763`. The executor reads it before
and after the Pages transaction. The prior `yw-82a4...` candidate receipt is
stale relative to current native inputs and is not a release authority. Do not
move the pointer until a later clean native-content build, public immutable
object readback, App staged/active checks and physical-device acceptance pass.

The paired Web/App procedure below applies only when App follow-up resumes:
publish immutable content objects before moving the App pointer, then hand the
exact checksum-fixed Web artifact to the external executor for deployment.

```zsh
PATH=/Users/ylsuen/.nvm/versions/node/v24.18.0/bin:$PATH npm run build:release-site
PATH=/Users/ylsuen/.nvm/versions/node/v24.18.0/bin:$PATH npm run check:release-site
PATH=/Users/ylsuen/.nvm/versions/node/v24.18.0/bin:$PATH npm run build:artifact-manifest
PATH=/Users/ylsuen/.nvm/versions/node/v24.18.0/bin:$PATH npm run check:artifact-manifest
```

Record Git commit/tag, staged-file set, artifact checksum manifest, Pages deployment ID/URL, D1 migration/export state, previous verified deployment, and exact live verification result. The displayed Pages commit hash is not accepted as source proof for a direct upload.

Native APK release is a separate gate. The same byte-identical signed artifact
must pass upgrade and persistence acceptance on one selected registered phone:
Phone A `c5467d2b` or Phone B `6393cccf`, as specified in
`/Users/ylsuen/CF/runbooks/yw_native_app_operations.md`. On that same phone,
run the reversible expanded-layout gate and record App-observed
`AdaptiveWidth.Expanded`, `maxWidth >= 840dp`, effective smallest width,
explicit 200% font, portrait and landscape, then restore and read back the
exact size, density, rotation, font, proxy and keep-awake baseline item by
item. The second phone is supplemental, a separate physical tablet is not a
current blocker, and emulators or device clouds cannot replace the selected
phone.

## 6. Monitoring and post-deploy validation

Immediately verify root, immutable assets, manifest, taxonomy, vocabulary index, reading health, anonymous boundaries, all upstream probes, and the critical browser flow. Confirm YW remains present in Pulse `/api/meta` and `/api/range` with its reviewed monitoring source.

Review error/status evidence after 10 minutes, then at 1 hour and 24 hours. Do not equate request count with unique users. Never include raw cookies, student submissions, answers, or session identifiers in evidence.

## 7. Rollback and recovery

Pages rollback is one of:

1. promote the recorded previous verified deployment in Cloudflare Dashboard and confirm the custom-domain alias moved;
2. redeploy the checksum-verified previous artifact;
3. revert the release commit and rebuild/redeploy through the same gates.

Never delete the failed deployment as rollback evidence. Never use `git reset --hard`, broad checkout, `git clean`, or DROP TABLE. Static rollback does not roll back D1; preserve newer D1 rows unless an independently approved, row-scoped recovery plan exists.

After rollback, rerun `docs/VERIFICATION.md` health, contract, dependency, browser, and data-integrity gates.

## 8. Troubleshooting

| Symptom | First checks | Likely boundary |
|---|---|---|
| Live differs from GitHub | compare live asset SHA-256 with `site/`; inspect Pages deployment and direct-upload ownership | unreproducible artifact/source drift |
| `9109` from Wrangler | reload canonical secrets without printing; run `wrangler whoami` and read-only list | local Cloudflare authentication |
| Root works but lesson is missing | manifest block + flat list, lesson JSON, taxonomy, search/recommendation indexes, cache index | generated-data consistency |
| Web and App show different lesson content | compare clean source revision, App disposition, reader/native semantic digests and `latest-stable` object | pointer moved before joint verification or stale generated copy |
| Reader image is missing in App | exact URL lookup in `reader-media-receipts.v1.json`, receipt anomaly ledger, bytes/SHA/MIME/dimensions | media receipt absent or URL changed without recollection |
| Removed vocabulary question reappears | disposition source-item SHA, tombstone ID, active index and generated lesson file | generator bypassed reviewed dispositions or reused a tombstoned ID |
| Reading APIs return `503` | binding readback, D1 health/schema/migrations; verify production lacks test seam | Pages/D1 config |
| Anonymous data leak | stop release; verify server-side User Center session check and `401` tests | auth boundary |
| AI errors | YW request headers/Origin, `data.answer`, allowed APIS health test | shared APIS contract; do not add a leaf key |
| Portrait wrong/cropped | taxonomy author/representative ID, QX provenance, image dimensions, `object-position`, 390 px screenshot | content/asset mapping |
| Pulse missing YW | registry source and live `/api/meta`/`/api/range` | monitoring coverage, not product registration |

## 9. Documentation closeout

Every material release updates:

- `docs/VERIFICATION.md` counts, last verifier/date, current deployment, rollback anchor;
- this manual when architecture, config, dependencies, deploy or recovery changes;
- `/Users/ylsuen/CF/reports/cloudflare_business_audit_2026-05-23.md` and its association index when ownership/resource relationships change;
- `/Users/ylsuen/CF/reports/agent_action_log.jsonl` with change, verify, and closeout rows.
- A bounded pre-activation transport canary is the only exception to the
  scoring-year admission rule. It uses the normal authenticated interactions
  route and real server time, accepts only `lessonOpened` with
  `lessonPhase=release_canary`, `trace / none / non_scoring` and null numeric
  results, and is valid only from `2026-08-11T16:00:00.000Z` through
  `2026-08-31T15:59:59.999Z`. It must produce zero credit, score-snapshot and F
  deltas. Never accept client-provided occurrence time or academic year, and
  never extend or replay this window after Beijing 2026-09-01 00:00.
