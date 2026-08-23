# Project State

Last updated: 2026-08-23

## 2026-08-23 evaluator timeout and failure-attribution repair candidate

- The currently served Pages deployment is
  `2471f1e4-884a-4e80-9801-589ebbace476`, source
  `fa93ca825e9b0d914b4608c971152dcf581ae9ac`, with atomic URL
  `https://2471f1e4.yuwen-course.pages.dev`. Both the custom and atomic HTML
  currently pin `assets/app.js?v=3fb3009cc5200181`. This deployment is still
  `candidate_pending_acceptance`; do not accept it or describe it as the
  evaluator repair. The immediate rollback remains
  `619024c7-a261-405b-a13f-8581a90111ac` / source `16b8277`.
- Production timing reproduced the missing failure chain. The same open-answer
  feedback prompt took 40.0 seconds (operator timeout), 27.5, 28.3 and 19.8
  seconds, while the Worker aborted every APIS call at 20 seconds and the
  browser aborted at 25 seconds. The release path then attributed the upstream
  failure to the learner: a second failure returned
  `evaluator_retry_exhausted` with the remainder of the ten-minute learner
  window (observed 478 seconds). That server-owned failure stranded the study-
  guide stage and therefore kept downstream structure and author-question
  controls locked.
- This candidate gives `taskType=feedback` a separate 45-second Worker budget
  and a 55-second browser budget while retaining `thinkingLevel=medium`.
  Evaluator timeout, upstream 5xx and invalid upstream JSON now move the exact
  mutation into a 15-second evaluator-owned cooldown marker that is excluded
  from learner resource/global capacity. The same answer can retry after that
  short cooldown. The response remains structured
  `learning_evaluator_unavailable` 503 and cannot write false interaction,
  evaluation, outbox or Queue evidence. Only genuine learner window capacity
  returns `learning_submission_rate_limited`; the former
  `evaluator_retry_exhausted` contract is retired.
- Focused verification passes evidence 63/63, study-guide frontend 27/27,
  Worker/source syntax and `git diff --check`. Exact Node 24.18.0 and 22.21.1
  complete gates each pass 245/245 TAP tests with zero skip and zero fail, plus
  the non-TAP first-read, annotation, mobile-touch, source and staging checks.
  Both runtimes verify all five study-guide PDF/extraction receipts and the
  same 693-file / 75,196,340-byte textbook-page subset against the tracked
  inventory. A bounded 20-request
  feedback/medium probe produced 19 valid grounded responses and one transport
  `TypeError`; successful-response p95 was 24.401 seconds and the maximum was
  25.908 seconds, below the 45-second Worker budget. Five low-thinking samples
  included one invalid response, so `medium` remains the quality authority.
  The checksum-fixed formal artifact passes both runtimes: 1,223 files /
  164,458,961 bytes, projected aggregate
  `520aabbb9a462c3b18d491aa1163b37cba0e05b50aceec2c18463b4f692cee55`,
  artifact aggregate
  `31f5a020549387589336ecd6be29bea5416c166084672b411024c9f00ae94101`
  and marker SHA-256
  `870ae05d50a41a98cc44355277416d70a0cd7c9987e768c8cf81d65527aee3ae`.
  Authenticated production acceptance remains pending deployment authorization
  and is not a completed claim.
- The repair preserves the already-reviewed same-page first-read/checkpoint
  rerendering and server-derived multi-turn formal dialogue. It changes no
  route, binding, schema, migration, direct D1 data, Queue, APIS, User Center,
  App/native pointer or shared-hub configuration: this remains a leaf-only
  `no-new-capability` change with those dependencies `verified_no_change`.
- The existing external executor is frozen to source `fa93ca8` and must not be
  edited or reused for a different SHA. After merge and exact-main artifact
  verification, production may change only through a new, separately reviewed,
  one-use YW-Pages-only executor bound to the exact merged SHA and rollback
  `619024c7`; direct checkout upload remains forbidden.

## 2026-08-22 lesson 1474 staged-loop recovery source closeout

- PR #20 merged the reviewed runtime source as
  `ef6272778db1dd3cfed227b47ac4cf17163eba3f`; its exact-head Actions run
  `32623520208` passed Node 24.18.0 in 1m12s and Node 22.21.1 in 1m16s.
  PR #21 synchronized this source/production boundary in project documentation.
  Production is unchanged at
  Pages deployment `619024c7-a261-405b-a13f-8581a90111ac`, source
  `16b8277afdf32618043703de4eb9b4098858b888`; the merged repair has not been
  represented as live.
- Classical first-read had a post-commit UI ordering boundary: host storage or
  ancillary progress synchronization could throw before the annotated-text
  action rendered, so reload appeared to repair an already committed source.
  Critical rendering now precedes ancillary synchronization, storage failures
  are contained, ancillary renderer failures cannot replace an already visible
  annotated text, POST and authoritative state readback are bounded through
  response-body consumption, and an
  exact submitted lesson/text-version/digest readback unlocks in place without
  converting an uncommitted or mismatched attempt to success.
- Study-guide answers persisted the transient `submitting` flag. A killed tab,
  owner-scope transition or request that never returned could therefore restore
  a permanent `正在進行來源端評閱…` state. Stored snapshots now normalize an
  interrupted submit to a retryable `pendingSync` receipt while preserving its
  mutation ID, answer and reference-reveal time. The browser request is bounded,
  including a response body that never finishes; all exit paths clear the
  spinner, and an unavailable evaluator returns the
  existing structured 503 contract without writing false interaction,
  evaluation, outbox or Queue evidence.
- Completing the last active study-guide item already recomputes the vocabulary
  checkpoint. With the stale submit repaired, the same page now rerenders the
  structure, evaluation and author-question controls as soon as vocabulary,
  study-guide vocabulary/syntax and first-read corrections all converge; no
  reload is part of the contract.
- Formal structure and author-question stages were repeated one-shot checks,
  not conversations: only the current input reached APIS and the UI replaced
  the previous result. The Worker now derives a student/resource/interaction-
  scoped transcript from the existing evidence ledger, includes at most four
  prior turns in the next evaluator prompt and returns at most six turns to the
  browser. The UI presents those turns as a continuing dialogue; idempotent
  replay does not create another turn, and a later lower score cannot relock an
  already completed checkpoint. Author/coach labels, true attempt numbers,
  the six-turn display window and latest-turn accessibility focus now share
  the same authority. A formal request is not sent if its retry receipt cannot
  first be persisted. Lessons with no authoritative author use a text-reading
  coach instead of falsely impersonating an author. The 88
  unpublished local-practice lessons remain local and do not call APIS.
- Identity discovery is now an explicit mutation boundary. Before the exact
  owner is resolved, reading position, font preference, lesson-open evidence,
  first-read callbacks and every check-stage control remain inert or
  anonymous-local; no ownerless mutation can later be rebound to another
  student. Session lookup, owner discovery and every shared-state owner check
  and mutation have a 12-second full-promise bound and retry in place. Identity/
  lesson generations discard stale A→B→A callbacks and reload the visible
  lesson from the current authority; replacing the identity object for the
  same owner atomically carries its pending reading/font mutation into the new
  generation, while changing owner still discards it.
- A real authenticated production run using the configured student environment
  completed lesson 1474 from submitted first read through 12/12 vocabulary,
  3/3 corrections, 19/19 active study-guide items, evaluation, structure and
  author-question. The old production exposed one generic study-guide 500 and
  a structured evaluator 503, and its repeated formal turns contained no
  conversation transcript; those observations reproduce the repaired paths.
  The final study-guide completion removed every downstream lock on the same
  page. No test account identifier, cookie, answer text or raw learner record
  is retained in this repository.
- The final candidate passes, on exact Node 24.18.0 and 22.21.1, first-read
  30 lessons/102 paragraphs, study-guide frontend 27/27, evidence 62/62,
  local-progress 24/24, learning-manifest 11/11 and the shared-state browser
  contract. Both complete `precontent:check` runs passed, including trusted-
  touch mobile 13/13, Reading 74/74, native projection 22/22 and formal staging
  5/5. Both runtimes verified all five PDF/extraction source receipts. The
  native-page gate used a disposable 693-file / 75,196,340-byte subset fetched
  from the exact tracked live public URLs and checked file-by-file against the
  canonical inventory; the canonical Drive token returned `invalid_grant`, so
  this run does not claim a fresh archive readback. Independent final source
  and UI-state reviews reported no remaining P0-P3.
- A clean detached rebuild from default main after the documentation merge reproduced the
  checksum-fixed formal artifact: 1,223 files, projected
  aggregate `3eee253710281c30747e7ba6570f8da6cf0ef080836096b5aea8cbf6c336f0f1`
  and tracked artifact-manifest aggregate
  `4c46462b0798048ce69eac8b5c0ba2691d9979af41388d2299e7738a3b172f06`
  over 164,456,389 bytes. The release marker and tracked manifest file hashes
  are respectively `a53b53fda4908d2380a6c2eda104057b2cfa01c376edf735b3de16445fc40455`
  and `7333bb8bb23007b5291b5eed08491a2bdc392ed57db3364c96d1a7a7c4e4ef36`.
- This is a leaf-only `no-new-capability` change. It adds no migration, direct
  D1 administration, route, binding, Queue/APIS/User Center configuration,
  learning-manifest membership or native/App pointer change. User Center,
  APIS, Queue and Companion are `verified_no_change` consumers.
- Production release is currently fail-closed after merge and exact-main
  checksum-fixed artifact creation. Project policy permits Pages deploy and rollback only through an
  independently reviewed external UC+YW executor; the current external
  workflow is explicitly source-only and exits before credentials, and no
  callable reviewed rollback path has been demonstrated. Manual Pages upload,
  raw `site/` upload, policy bypass and relabelling the dormant executor are
  forbidden. A separately reviewed executor activation and rollback readback
  are required before this candidate can become production.

## 2026-08-22 mobile and learning-stage production closeout

- PR #18 merged as canonical source
  `16b8277afdf32618043703de4eb9b4098858b888`; GitHub Actions run
  `32607440011` passed the exact Node 22.21.1 and 24.18.0 jobs. A second clean,
  detached checkout of that merged SHA passed the complete Node 24.18.0
  `precontent:check`, verified all five study-guide PDF/extraction receipts and
  rebuilt the formal 1,223-file Web artifact. Its projected aggregate is
  `223f05a5aa6333ba3e4be61f04aafc00afafac98359d979a3d1c942678d2e724`
  and tracked artifact-manifest aggregate is
  `c744b7ac352c11b5cea45377ce297d69d4a3b142027a768bcb59dbf76bcd98b1`.
- Production is now Pages deployment
  `619024c7-a261-405b-a13f-8581a90111ac`, branch `main`, exact source
  `16b8277afdf32618043703de4eb9b4098858b888`, with atomic URL
  `https://619024c7.yuwen-course.pages.dev`. The immediate rollback is the
  previously verified deployment `6426b70e-d39b-4ba9-898b-0f5e7a1c3859` /
  source `26f126b`; `581a0180-2085-4960-8cd0-4aee17cb2abd` remains the next
  older anchor. No direct D1 command or migration, Queue/APIS/User Center
  configuration change, route, binding, schema or native/App pointer mutation
  occurred; the authenticated readback retained the existing identity-
  reconciliation boundary.
- Custom-domain and atomic readback both returned HTTP 200 and byte-identical
  `app.js`, `classical-first-read.js` and lesson manifest assets. The live
  learning-health receipt is healthy. Real trusted-touch checks passed 7/7 at
  390x844 and iPad 1024x768, including height-only viewport changes and the
  wide-to-compact close control.
- In an existing authenticated browser, live lesson 1727 read its submitted
  first-read source, displayed 3 marked difficulties and 13/13 vocabulary,
  and exposed both unlocked local-practice stages with zero console errors.
  No new learner submission was created for acceptance. The exact
  commit-then-error same-page transition is instead covered by the executable
  authoritative-readback controller, including submitted, uncommitted and all
  three authority-mismatch branches. In a fresh anonymous browser, both local
  question types on lesson 1693 saved their self-check result without any
  `/api/interaction-check` request or completion claim; formal lesson 1497
  remained login-gated. Live taxonomy and manifest readback preserve the
  symmetric 189 = 101 formal + 88 local split.
- The next action is normal monitoring only. If the custom host, first-read
  authority, 1727 local path or 1497 formal path regresses, roll back to
  `6426b70e-d39b-4ba9-898b-0f5e7a1c3859` and rerun the eight-point standard in
  `docs/VERIFICATION.md`.

## 2026-08-22 mobile and learning-stage repair candidate

- The task-owned candidate is branch
  `codex/yw-mobile-phase-formative-fix-20260822`, based on canonical main
  `d7efad85e435f2d1618538433dc0156beb7227af`. A fresh Cloudflare readback on
  2026-08-22 still names production deployment
  `6426b70e-d39b-4ba9-898b-0f5e7a1c3859` / source `26f126b`; the immediate
  rollback remains `581a0180-2085-4960-8cd0-4aee17cb2abd` / source `04ca518`.
- Mobile atlas scrolling was not blocked by the scroll container. The drawer
  had `overflow-y:auto`, `touch-action:pan-y` and accepted trusted touch input,
  but a global `resize` handler closed it whenever width was at most 1180px.
  Safari toolbar, keyboard and dynamic-viewport height changes therefore
  closed the drawer during an ordinary swipe. The candidate closes only on an
  actual media-query transition from wide to compact; height-only changes now
  preserve the open drawer.
- The classical first-read source session commits before its compensating
  learning-evidence write. A post-commit evidence error or ambiguous response
  therefore returned non-2xx after the source was already submitted. The UI
  treated every non-2xx as an uncommitted attempt and stayed on the first-read
  gate, while reload read the committed source state and unlocked correctly.
  The client now performs one authenticated authoritative readback on a failed
  submit and unlocks in place only when the authoritative lesson ID, text
  version and text digest all match and that exact source is confirmed
  submitted; an actually uncommitted or mismatched attempt stays retryable.
- All 189 student-visible lessons render the structure and author-question
  stages, but the frozen formal A+ manifest publishes those interactions for
  only 101 selected-volume lessons. The other 88 lessons, including
  `lesson-1727`, previously reached the formal evidence resolver and failed
  before APIS or D1 with a generic 502. The UI now classifies manifest-listed
  questions as formal and the other 88 as explicit local practice. Local
  practice is disabled until identity ownership is resolved, then makes no
  evaluator request and no D1, Queue or User Center write. Stale authenticated
  clients receive stable HTTP 422 `learning_resource_not_published` after the
  existing identity reconciliation but before APIS or any formal interaction,
  evaluation, reservation, outbox or Queue write. The existing 101-lesson A+
  denominator is unchanged. A lesson completion that depends on local practice
  is UI-only and cannot emit the hidden `lessonCompleted` evidence event.
  Lesson 1727's structure anchor also skips its title, source label and map
  caption before selecting正文.
- This is a `no-new-capability`, leaf-only Web correction. It changes no route,
  binding, migration, schema, D1 row, Queue setting, User Center contract,
  learning-manifest membership, stable native-content pointer or Companion App
  contract. Source rollback is an ordinary revert; production rollback is the
  recorded Pages deployment above. The native deploy-sync gate remains red for
  any new App-pointer promotion; the reviewed 2026-08-20 Web-only path permits
  a leaf Web release only while the existing stable native pointer and all
  referenced objects remain byte-identical. The exact Node 24.18.0 / 22.21.1
  `precontent:check` and five-file study-guide source verification now pass;
  Reading is 74/74, evidence 56/56, native object checks 22/22 and release-site
  checks 5/5 on each runtime. The formal author artifact contains 1,223 files.
  Independent exact-diff review found no remaining P0-P3 defect or code-level
  release blocker. The production closeout above supersedes this candidate
  status and records the green pull-request checks, clean merged-source build,
  deployment readback and live browser acceptance.

## 2026-08-20 production launch closeout

- PR #16 merged as canonical main
  `26f126bfb38c62b251bbe8815d6ef32c4594bce7`. GitHub Actions recovered for
  this repository during the PR: run `32447617539` passed the exact Node
  22.21.1 and 24.18.0 jobs, so PR #16 has no deferred CI replay debt. The
  complete detached clean-clone `precontent:check` also passed on both Node
  authorities with Reading 74/74, evidence 54/54, native-content 22/22 and
  release-site 5/5.
- Production is Pages deployment
  `6426b70e-d39b-4ba9-898b-0f5e7a1c3859` at that exact source. The immediate
  rollback is `581a0180-2085-4960-8cd0-4aee17cb2abd` / source
  `04ca518767b39b75832740007be11b5b902b0a8c`. The formal 1,223-file artifact
  kept the existing stable native pointer. No migration, route, binding,
  consumer setting or native/App pointer changed.
- Returning-browser and fresh-context live checks both show 189 student-visible
  lessons and open a real lesson without the former immutable-cache helper
  mismatch. The v2 Queue is deliberately open (`delivery_paused=false`,
  modified `2026-08-21T04:48:55.704168Z`); main and DLQ metrics are both zero.
- A normal authenticated UI lesson open created one exact
  `2025-2026 / lessonOpened / release_canary` source event. Source interactions
  advanced 284 to 285 and central YW evidence 277 to 278. UC took the
  `mapped_accepted` admission branch and stored one durable accepted,
  non-scoring, null-policy, all-null-numeric reading evidence row. Existing
  quarantine stayed five, credit stayed zero, and the authenticated weekly
  reading/A+ projection was unchanged. After the designed 15-minute source
  receipt lease, a normal health drain reconciled the source outbox to
  `central_disposition=accepted` with a receipt timestamp; no manual database
  update was used. This proves transport only; it does not claim that September
  scoring has a real sample.
- APIS direct readback with the exact YW headers returned HTTP 200 in 4,118 ms.
  The local evaluator outage path remains a friendly retryable 503 with no
  false ledger/outbox write. The next production action is the read-only
  2026-09-01 first-real-scoring-event check after the academic-year handoff;
  one-shot Codex heartbeat `yw-9` is active for 00:05 Asia/Shanghai and has no
  mutation authority.

## 2026-08-20 Web launch-readiness correction

- The current production alias is Pages deployment
  `581a0180-2085-4960-8cd0-4aee17cb2abd` at canonical source
  `04ca518767b39b75832740007be11b5b902b0a8c`; it is also the rollback anchor
  for this candidate. A real browser with previously cached immutable assets
  fails before loading the lesson catalog because `site/index.html` kept the
  July `vocab-progress.js` cache key after the file added the formal vocabulary
  authority API. The resulting mixed generation throws
  `formalVocabularyResourceKeys is not a function`. The candidate replaces all
  five mutable local entry-asset labels with the first 16 hex characters of
  their tracked source asset SHA-256 and adds an executable gate that fails
  whenever source bytes and HTML cache authority drift again.
- A normal `lessonOpened` UI request previously carried an empty
  `lessonPhase`, while the already-published pre-activation transport canary
  accepts only `release_canary`. The direct interaction handler now derives
  that phase from server time only during
  `[2026-08-11T16:00:00Z, 2026-08-31T16:00:00Z)` and clears it for lesson opens
  outside the window. Browser phase input cannot create or extend the canary.
  The event remains `trace / none / non_scoring` with null numeric results and
  cannot award credit, change a score snapshot, alter A+ progress or issue F.
- A direct APIS `feedback / medium` diagnostic with the exact YW Origin and
  project headers returned HTTP 200 in 13.392 seconds. The production 20-second
  evaluator boundary remains intentionally bounded, but an APIS timeout,
  invalid model JSON or invalid normalized assessment now releases the exact
  durable submission reservation and returns retryable HTTP 503 with a
  15-second `Retry-After` and a student-safe message. It creates no learning
  interaction, evaluation or outbox receipt. A reservation-release failure
  remains a hard error, and the existing second-attempt exhaustion stays 429.
- This is a `no-new-capability` Web correction: no schema, migration, D1 data,
  Queue state, route, binding, source manifest, scoring policy or native/App
  pointer changes. Source rollback is a normal revert. Production rollback is
  the recorded Pages deployment above. The task-owned author checkout passes
  the complete `precontent:check` under exact Node 22.21.1 and 24.18.0,
  including Reading 74/74, evidence 54/54, native-content 22/22 and release-site
  5/5 on each runtime. The five external study-guide PDF/extraction byte and
  page receipts also pass. The formal 1,223-file Web artifact is current at
  aggregate SHA-256
  `96080e7e8eff4e7899e268394b055aef453a39a1980041c506e7f72f6f01c2f9`;
  it preserves the exact existing stable native pointer and excludes every
  candidate/historical native tree. The exact candidate was subsequently
  verified, merged and deployed; the production closeout above supersedes this
  pre-release status without rewriting the historical candidate evidence.

## 2026-08-20 server-authority hardening Draft candidate

- This source-only candidate is branch
  `codex/yw-server-authority-hardening-20260820`. PR #12 was merged unchanged as
  canonical main `10177b360077ef1347db531c14ca287757ef2d8f`; this branch now
  contains an ordinary, non-force merge of that exact main. Conflict resolution
  preserves PR #12's deterministic zero-APIS blueprint, bounded evaluator retry
  and native `getNativeFormativeMastery` routing together with every PR #14
  authority, CSRF, catalog and retired-discussion correction. PR #14 remains a
  Draft until the combined tree rebuilds, passes both exact Node authorities and
  receives a fresh exact-head independent review.
- Hostile regression against the unmodified base proved that an authenticated
  browser could set `submissions.ai_score`, `ai_verdict` and `source` directly,
  and that a syntactically valid but catalog-absent lesson could create both a
  reading submission/star and a semantic learning interaction. Independent
  P0/P1 review then proved three further release blockers: a deduped legacy
  browser score could remain in `MAX(ai_score)` and be relabelled `live`;
  first-read helpers could mutate D1 before, or without, authoritative catalog
  resolution; and `/api/lesson-blueprint` could spend APIS capacity and seed a
  week-long public cache from browser-provided title/excerpt. The retired
  discussion POST was also an unauthenticated GitHub write proxy. Those paths
  violated the existing server, data and cost-authority contracts.
- A later independent review reopened this Draft with four additional P1
  classes. `/api/interaction-check` still trusted browser `mode` and `authors`
  in the scoring prompt; ten cookie-authenticated mutation routes accepted
  missing/foreign Origin and non-JSON requests; pull-request CI did not execute
  the changed blueprint or Reading API suites; and the verification manual
  presented a disposable page fixture as a durable command. Tests first proved
  all four failures against the prior Draft head.
- The browser now gives `/api/reading/submission` only its three words and the
  durable `contextWords` source-event reference. The Worker derives score and
  verdict only from the same student's, same lesson's, same three words'
  `source_ai_assessment`; a missing, cross-user, cross-lesson, wrong-interaction
  or word-mismatched event fails HTTP 422. Browser `aiScore`, `aiVerdict` and
  `source` fields are ignored, and `source` is derived only from the local test
  seam versus production runtime. An unassessed dedupe clears any legacy stored
  score/verdict, and constellation/detail/history views derive score authority
  only from same-student `contextWords` + `a_plus_gate` +
  `source_ai_assessment` ledger rows whose normalized three-word set intersects
  an actual submission. Legacy `submissions.ai_score` is no longer a read or
  brightness authority, and lesson history projects `source` from the current
  trusted runtime instead of returning the old browser-writable column.
- Lesson fallback remains available in `getLessonMeta` / `getLessonData` for
  read compatibility. Every current lesson-bearing mutation route instead
  resolves the exact lesson from `site/data/manifest.json`; all four first-read
  mutation handlers do so before their helper can touch D1. Lesson blueprint
  title/block/excerpt now come from the hydrated authoritative lesson, while
  mode/genres come from `site/data/literary-taxonomy.json`. The endpoint returns
  the source-deterministic blueprint with `Cache-Control: no-store`; it makes no
  APIS call and does not read or write the runtime cache. An absent lesson fails
  HTTP 400 and missing authoritative taxonomy/content fails HTTP 503, both with
  zero APIS/cache side effects. The removed UI's
  legacy discussion POST is fail-closed HTTP 410/no-store and makes no GitHub,
  D1 or Queue call; discussion GET remains read-only. There is no schema,
  migration, scoring-policy, manifest or semantic-revision change.
- `/api/interaction-check` now ignores browser lesson metadata and derives
  normalized mode, genres, author names and response speaker from the exact
  `site/data/literary-taxonomy.json` row. A missing taxonomy row returns HTTP
  503 before identity resolution, APIS, D1 or Queue. The APIS prompt continues
  to use only the hydrated authoritative title/block/excerpt, and the evidence
  ledger retains only allowlisted student answer fields rather than forged
  title/excerpt/mode/genre/author metadata.
- All ten cookie-authenticated POST mutation routes require exact
  `Origin: https://yw.bdfz.net` and `application/json` before reading a binding
  or resolving identity. An exact-format native authorization header may omit
  Origin but must still use JSON and must subsequently pass the existing exact
  `resolveNativeSession` projection before reconciliation or business work; a
  rejected native session produces no D1, APIS or Queue side effect. The local
  `READING_TEST_SLUG` seam cannot bypass this request gate.
- Exact Node 24.18.0 and 22.21.1 each pass the complete
  `precontent:check`. On both runtimes the combined focused matrix passes 96/96,
  Reading API passes 74/74, evidence contract passes 52/52, blueprint quality
  passes 6/6, native-content passes 22/22 and release-site passes 5/5. Five
  study-guide PDF/extraction receipts verify on both runtimes. After both full
  gates, Node 24 rebuilt the deterministic formal staging and both runtimes
  checked the same bytes: 1,223 files / 164,387,142 bytes, projected SHA-256
  `ac6efa919a516c272209a94e0f078373bbfaabdf5c28766dd188cb0b077ec65e`
  and artifact aggregate SHA-256
  `3fcc42802b5f2478e0cc3ec3ffa720ce7feacff6fe9a14ae17c0dddf32085825`;
  the tracked manifest byte SHA-256 is
  `9ff27ae8abd5b7dcafc503aa493809d2ff4b119cb176bdbf481f9298dda975a6`.
  Pull-request CI executes the exact evidence, blueprint and local-D1 Reading
  suites under both Node authorities before the artifact checks; its combined
  exact-head result remains pending until the branch is pushed.
- The predecessor exact-head `P0/P1=0` review does not cover the merged tree. A
  fresh independent exact-head review is required after rebuild, tests and CI;
  until then the source candidate remains a Draft, not a merge authority.
- Production remains unchanged at Pages deployment
  `18213286-37d1-4b71-80b6-78e8b986ed3d` / source `a97eba7` (full source
  `a97eba7589ed6afa7df30ba4f37f2241a22d90d0`). Its deployed Worker and current
  static interaction assets remain a mixed generation, and live
  `/api/learning/health` remains unavailable. This candidate has not been
  deployed.
- Formal release remains **NO-GO**: on both exact Node authorities
  `check:native-content:deploy-sync` fails closed with `current canonical source
  graph lacks an approved audit receipt`. A separately owned Web/App receipt,
  paired User Center/YW review and authenticated live acceptance are still
  required. This task made no deployment, D1/Queue/User Center/GitHub-discussion
  write, binding/configuration change or student-data mutation.
- This is `no-new-capability`. Source rollback is to revert the exact candidate
  commit and rebuild/check the formal artifact manifest. No production or data
  rollback applies unless a later, separately authorized release occurs.

## 2026-08-15 combined assessment, retry and native formative source draft

- This source-only draft starts from canonical main
  `7c7e1e06bad67b17dfa16a500a64ca2e02ad08c1`. The accepted
  `bdfz-native-auth/1` projection, exact native authorization format and
  stable-user dual-credential gate already supersede the older isolated
  reading-bridge implementation.
- One behavior was not superseded: an exact native request that reaches
  `/api/reading/formative-mastery` must use a native-session-bound RPC rather
  than passing an empty Web cookie to `getFormativeMastery`. The source now
  classifies authorization as absent, non-native, exact-native or malformed
  native-looking. Absent/non-native authorization may use Web
  `resolveSession`/`getFormativeMastery` only with a valid bounded
  `bdfz_uc_session` cookie. A header in the native `Bearer ywat_` namespace
  that fails the exact token shape remains 401 even when that cookie is also
  present. Exact native authorization selects only
  `getNativeFormativeMastery`; a missing selected method remains 503.
- An exact native request with a Web cookie resolves both identities before
  reading reconciliation. Different stable User Center ids remain 401; a
  same-user cookie is only a conflict check and never becomes a mastery-RPC
  fallback. The paired User Center entrypoint must independently expose and
  verify the exact `getNativeFormativeMastery` RPC before any release. This YW
  source candidate therefore remains Draft and undeployed until that separately
  owned User Center contract, hostile tests and shared-hub review complete one
  synchronized transaction; this source handoff does not claim live hub
  readiness.
- This is a `no-new-capability`, no-schema-change and no-data-write source
  handoff. It changes no learning rule, formative denominator, scoring role,
  manifest, App pointer, D1 row, Queue message, Pages deployment or production
  traffic. Source rollback is a normal revert of the exact candidate commit.
- Exact Node 24.18.0 and 22.21.1 each pass the unified focused 85/85 contract
  matrix and the complete `precontent:check`, including Reading API 70/70,
  native-content 22/22 and release-site 5/5. The archived textbook page input
  was supplied through a checksum-verified isolated 693-file / 75,196,340-byte
  subset of accepted archive `2026-08-15-textbook-ai-migration`; all 693 files
  match the canonical page SHA-256 inventory, and no archived or canonical
  source byte was modified.
- The one formal build from the combined tree contains 1,223 files / 164,378,212
  bytes. Its projected aggregate is
  `21485dbc7c0c167925a0f3d56835ee19b379ce413aff23aab4c102b244e1f922`,
  artifact aggregate is
  `ae7c907010f3a148f7b68a3bfc5442220091759202acb85ce5a11e04f742f0a2`,
  tracked manifest byte SHA-256 is
  `48b94d286f50a33f9cb9095e05655f6eba2d4ae712c1adb99f033ac6162339e4`,
  and formal marker byte SHA-256 is
  `dd2c63801c44d266428efa495b6cf872665980a520ea40c21be0ac52045dc07a`.
  The stable App pointer remains
  `a5ccd441deb7b0111517c9c1ec597b98e16a6dac789bd32bff3daa96960285a7`
  with the same 278 receipted native paths. Neither predecessor PR's artifact
  count or digest is accepted as authority for this combined draft.

## 2026-08-20 current production and rollback authority (read-only)

- The canonical `yw.bdfz.net` alias currently serves Pages deployment
  `18213286-37d1-4b71-80b6-78e8b986ed3d`, whose deployment metadata records
  source commit `a97eba7589ed6afa7df30ba4f37f2241a22d90d0`. The previously
  described deployment `8da16237-ac91-47e1-afe2-7843e2d4c8a4` / source
  `0ff5d5604ceefef92c99c07033f1e900d9edaaed` is the verified rollback
  authority, not current production. Neither deployment is canonical source
  main or this combined candidate.
- Production D1 retains migrations 0001--0005 and all historical rows. Live
  reading health remains `reading-schema-v4` with
  `bdfz-learning-evidence-v1`. Learning health advertises the current formal
  e310 source family but still projects formative authority
  `yw-formative-20a7145bd573bbb7` / 1,019 items and explicitly reports
  transport/formative-only activation, no runtime scoring, no A+ effect and no
  persistence claim.
- The v1 Queue remains the rollback producer path. The v2 main and DLQ remain
  paused with no producer or consumer. User Center production remains its v251
  rollback; the existing Web binding is usable for the legacy cookie path, but
  native identity/v2 mastery is not live. No source-only result below changes
  those facts or authorizes a deployment, migration, Queue change, User Center
  change, App publication or student-data write.
- Later sections that call the 2026-08-11 carrier "current production" are
  retained historical receipts. This section is the current live disposition,
  and production remains NO-GO until a separately authorized synchronized
  transaction proves the exact combined source, hub contract, backup/restore,
  v2 delivery and real-account A--F readback.

## 2026-08-15 assessment, bounded evaluator retry and anonymous-AI retirement candidate

> **Superseded on 2026-08-23:** the historical two-evaluator limit below is
> incident evidence only. The current `.002Z` evaluator-owned cooldown at the
> top of this file consumes no learner slot and returns no
> `evaluator_retry_exhausted` result.

- This source-only candidate starts from canonical main
  `7c7e1e06bad67b17dfa16a500a64ca2e02ad08c1`. Single-choice grading now applies
  one fail-closed precedence to the full normalized response: an explicit
  single-choice phrase, exactly one answer-lead letter, or exactly one deduped
  A--D letter in the full response. Multiple distinct letters remain ambiguous.
  The source-owned 46-case fixture corpus locks simplified/traditional wording,
  explanation-letter pollution, punctuation, circled choices and the known
  ambiguous `A项错误，B项正确` tradeoff. Student feedback displays source circled
  glyphs such as `①②④` while comparison stays numeric.
- A first evaluator-stage APIS, parse or normalization failure expires only its
  exact `.000Z` reservation by D1 compare-and-swap. One immediate same-mutation
  retry may reclaim the same source event as `.001Z`; ten concurrent contenders
  still admit one evaluator and the slot count remains one. A second evaluator
  failure expires `.001Z` only for truthful timing and returns
  `evaluator_retry_exhausted`; it never permits a third evaluation. Recording or
  D1 failures do not release a reservation. The exact guarantee is one durable
  YW slot and at most two APIS invocations, not preservation of upstream APIS
  quota.
- Capacity exhaustion and evaluator-retry exhaustion retain the compatible
  `learning_submission_rate_limited` code but expose distinct `limitReason`
  values and the exact `retryAfterSeconds`. Both interaction and study-guide UI
  paths give reason-specific retry guidance without suggesting an immediate
  retry after exhaustion.
- `/api/learning-check` authenticates through the normal My identity path before
  returning its existing retired 410 response. Unused `/api/chat` is retired
  with 410, and the active `/api/lesson-blueprint` now returns the existing
  source-deterministic blueprint without any anonymous APIS call. No IP limiter,
  new binding or mutable request-global state was introduced.
- Pull-request CI runs the learning manifest, evidence, preview-isolation,
  reading-identity, 46-case assessment, both UI retry paths and all 189
  deterministic lesson blueprints on exact Node 24.18.0 and 22.21.1 before the
  formal artifact gate.
  The complete local source gate passes on both exact Node authorities; the
  unified focused matrix is 85/85 per runtime, Reading API is 70/70, native
  content is 22/22 and release-site is 5/5. The rebuilt formal artifact is
  1,223 files /
  164,378,212 bytes with aggregate SHA-256
  `ae7c907010f3a148f7b68a3bfc5442220091759202acb85ce5a11e04f742f0a2`;
  its projected aggregate is
  `21485dbc7c0c167925a0f3d56835ee19b379ce413aff23aab4c102b244e1f922`
  and tracked manifest byte SHA-256 is
  `48b94d286f50a33f9cb9095e05655f6eba2d4ae712c1adb99f033ac6162339e4`.
- No catalog, formative authority, learning manifest, semantic revision,
  schema, binding, route topology, Queue, User Center or App pointer changed.
  This is a `no-new-capability` source correction. It performs no deployment,
  D1/Queue/User Center write, traffic change or rollback; any release still
  requires independent exact-commit review and the external production gate.
- A separately received JSON described as “2026 北京卷语文” remains an
  unverified YW input. Current GKS canonical `master` is
  `c741e66add56d458df37bcf678ba8fec61779645` and its current rolling-five
  catalog is 2022--2026 with 119 items. GKS draft PR #1 remains an open Draft at
  `6f46f96416dd896b2c60e70711fd63ba243fc899`; it is a historical conflicting
  branch, not current source authority. Neither that branch nor a separately
  supplied JSON is a reusable YW derivation or publication authority.
- YW must not import, publish or derive content from the supplied JSON or copy
  question/answer text from the waived live release. A future, separately
  reviewed YW PR may add only a source-pinned, link-only transfer overlay after
  GKS source and live authority are reconciled and the YW gate independently
  has a continuous original paper, two independent sources, per-page and
  per-question visual evidence with crop SHA-256, independent Codex answers,
  dual sign-off and publication-hash binding. GKS remains the evidence owner;
  no YW scoring event, D1/Queue write, User Center or App change is authorized.

## 2026-08-14 dedicated precheck project correction

- The primary `yuwen-course` Pages project again gives every preview only
  `yuwen-reading-db-preview`: it has no User Center service binding and no
  Queue producer. Pages applies `[env.preview]` to all preview deployments, so
  adding the production-capable `YuwenEvidenceIdentity` entrypoint there would
  expose it to historical preview code rather than only one reviewed branch.
- `wrangler.precheck.toml` defines a separate Direct Upload project named
  `yuwen-course-foundation-precheck`. Only that new project may bind the
  preview D1 and `bdfz-user-center#YuwenEvidenceIdentity`; it has no Queue,
  production D1, custom domain or production traffic authority. The external
  executor must prove the project had no prior deployments, deploy exactly one
  reviewed write-disabled artifact and read back the exact bindings before the
  controlled Queue/RPC precheck.
- The preview D1 is currently through migration 0004. Its additive 0005 apply
  and ledger/schema/integrity/watermark readback must be a separate journaled
  phase from production YW 0005 before the precheck project may be used.
- No learning rule, score, catalog, artifact byte, App pointer, D1 row, Queue,
  Pages deployment or User Center source changed. Production remains disabled
  until the external executor completes its separately journaled gates.
- Pull-request CI now includes the three preview-binding hostile checks alongside
  the existing 41 learning-manifest/evidence checks, for 44 current focused
  checks on each exact Node authority.

## 2026-08-13 structured-error and recovery closeout candidate

- The generic `/api/learning/interactions` route now preserves the exact
  `classical_first_read_required` or
  `classical_annotated_reading_required` prerequisite, HTTP 422 disposition,
  non-retryable disposition and null timed-retry boundary. Timed submission conflicts keep
  their exact `retryAfterSeconds`; the browser evidence bridge returns these
  structured fields instead of collapsing them into `unavailable`.
- A route-level hostile test now forces the study-guide catalog cache to the
  prior digest while the formative cache observes the next digest. The Worker
  performs exactly one catalog reload, returns
  `study_guide_catalog_changed`/409, and makes zero APIS, learning-ledger,
  outbox or Queue writes.
- The exact canonical User Center SHA is supplied by the UC strong-workspace
  audit pin at review and release time. That audited source owns the hourly
  `scheduled()` source-health probe and calls the exact
  `https://yw.bdfz.net/api/learning/health` route. A request-context test now
  awaits that route's existing `ctx.waitUntil(drainEvidenceOutbox(...))` path
  through a monotonic `pending_mapping` to `accepted` receipt. YW remains a
  Pages project and adds no Cron Trigger or new runtime recovery mechanism.
- This candidate changes no scoring rule, catalog byte, formative authority,
  D1 row, Queue, Pages deployment, User Center source or App content. The App
  pointer remains byte SHA-256
  `a5ccd441deb7b0111517c9c1ec597b98e16a6dac789bd32bff3daa96960285a7`.
- Exact Node 24.18.0 and 22.21.1 each pass the complete
  `precontent:check` and the focused 41/41 structured-error, cache-skew and
  recovery set. The UC strong-workspace audit-pinned source-health suite passes
  6/6 on both Node authorities. This is a `no-new-capability` change: the
  existing Pages request context, D1, service binding and Queue contracts are
  unchanged.
- `.github/workflows/learning-contract-ci.yml` adds the repository's first
  read-only PR check: the exact Node 24.18.0/22.21.1 matrix runs the same 41
  focused source-contract tests, then builds and checks the formal Web artifact
  against the tracked checksum manifest with `contents: read` only. It has no
  deploy, Cloudflare credential, D1 or Queue step; the full local
  `precontent:check` remains the heavier release-source gate.

## 2026-08-13 scoring-correctness source candidate

- The current 241-item study-guide catalog remains structurally stable, but
  eight source prompts whose PDF review receipts omitted visible answer choices
  now reproduce those choices exactly. The content-addressed task authority is
  therefore `yw-study-guides-eae416d57be24516` (193 active / 48 tombstones),
  and the corresponding formative authority is
  `yw-formative-65a150df80285f4e` (1,021 items / 115 lessons / 48 tombstones).
  A future content update must mint new catalog and task-pool digests; it does
  not silently change the annual My scoring policy.
- Deterministic grading now reads only the answer lead, supports circled
  source choices, and handles quotation, colon, bracket, dash, ellipsis,
  punctuation and sentence-segmentation tasks without sending them to AI.
  Explanation prose can no longer smuggle another option letter. Open-response
  normalization preserves a genuine zero and rejects malformed or incomplete
  model output instead of inventing 60.
- Every `/api/interaction-check` evaluation now requires a User Center identity
  and reserves its durable per-user/resource slot before calling APIS. The same
  mutation cannot trigger a second evaluator; an evaluator failure still
  consumes the bounded slot, and the response reports the exact remaining
  window rather than prompting an immediate retry loop. The browser retains
  that mutation ID until a terminal durable receipt, so an explicit retry
  queries the same reservation rather than paying for another evaluator. APIS calls have a
  20-second abort boundary. The untracked legacy `/api/learning-check` scoring
  path is retired with HTTP 410.
- The Worker validates study-guide catalog digest plus semantic revision
  against the formative manifest before reservation/write, reloads both caches
  together once, and then fails closed on drift. Pages preview identity uses
  the exact `USER_CENTER_EVIDENCE` service binding and cannot reuse a cached
  production identity or fall back to public `/api/me`.
- No Pages deployment, D1/Queue write, UC mutation, Android pointer movement or
  production traffic change was performed by this source candidate. The
  foundation pointer remains byte SHA-256
  `a5ccd441deb7b0111517c9c1ec597b98e16a6dac789bd32bff3daa96960285a7`.
- Exact Node 24.18.0 and Node 22.21.1 each passed the complete
  `precontent:check`; the defect-focused matrix passed 61/61 on each runtime,
  Reading API passed 70/70, native-content passed 22/22 and release-site passed
  5/5. Formal Web-only artifact generation, commit/push and live readback remain
  separate release gates.
- Clean external checkouts no longer require the ignored, non-shipping
  `site/data/cache/` snapshot merely to prove removed lessons are absent. When
  that local developer cache exists it is still checked; formal staging keeps
  the entire prefix excluded and the release artifact remains content-addressed.

## 2026-08-13 external-executor release boundary

- Checkout production and rollback entrypoints are disabled. `package.json`
  deliberately exposes no `deploy` or `predeploy` script; local commands may
  build and verify immutable artifacts only.
- The first production wave is bounded to User Center plus YW. It may run only
  through the independently reviewed external executor after exact commits,
  fresh D1 backups, Queue topology, rollback anchors and live preflight pass.
  This does not claim fleet completion: the remaining source adapters stay
  withheld until their own versioned contracts and authenticated acceptance
  are verified.
- The foundation artifact deliberately preserves the live/Android pointer
  `yw-3e77f0f7ffa5d042a6d06763`, byte SHA-256
  `a5ccd441deb7b0111517c9c1ec597b98e16a6dac789bd32bff3daa96960285a7`.
  The stale `yw-82a4...` receipt is not a release authority; current native
  inputs must be regenerated and pass public readback plus physical-device
  acceptance in a later Web/App transaction before any pointer move.
- No Pages deployment, Queue/D1 write, traffic change or rollback was performed
  by this source update.
- The exact formal foundation artifact contains 1,223 files / 164,368,564
  bytes with aggregate SHA-256
  `10144eec24d73e63fe51f271b6d200cf193e504a658f5738c4e258f42053e8be`;
  its tracked manifest byte SHA-256 is
  `e136b867d77c5fdcda6b6698a7e33e745350c2cbfd27fb05964ca82b6cab9a6f`.

## 2026-08-12 e310/v2 User Center source-contract candidate

- This isolated, source-only candidate makes the current Web manifest the
  explicit 2026–27 YW producer contract. It has 869 fully mapped resources:
  768 eligible `performance / a_plus_gate` units and 101 `evaluation`
  resources that remain visible but non-scoring. The annual requirement is
  fixed at 692 distinct `canonicalUnitId` credits and does not grow when the
  live task pool later adds a mapped release.
- Each formal event now uses `bdfz-learning-evidence-event-v2` with
  `schemaVersion: 2` and carries `contractVersion`, `sourceReleaseId`,
  `canonicalUnitId`, `resourceVersion`, `mappingVersion` and a source attempt
  identity. These preserve a real revised attempt while User Center dedupes
  Web, Android and resource revisions at the annual canonical-credit layer.
- The Web producer emits only e310/v2 for `2026-2027`. User Center retains a
  transition adapter for immutable b530/v1 evidence in `2025-2026`; it is
  historical-only and cannot enter the new-year numerator or denominator.
  Unknown future contract years withhold rather than falling through to F.
- Android remains a formal-resource client of this same Web source graph and
  shared User Center ledger. This candidate changes no Android inventory,
  package, release pointer or client-specific denominator.
- Evaluation and every other source fact remain unable to claim `weight`,
  `grade`, `points`, bands or source caps. Unknown releases/mappings must be
  durably held outside scoring until the central contract is activated.
- Additive D1 migration `0005_learning_evidence_central_receipts.sql` separates
  Queue transport (`pending`/`enqueued`) from the authoritative User Center
  disposition. The source outbox keeps unresolved v2 envelopes durably,
  re-emits stale rows after a transport failure, and stops re-emitting once a
  central `accepted`, `pending_mapping`, or `quarantined` receipt exists.
  `pending_mapping` continues to be polled and can advance to `accepted`
  or `quarantined` without another Queue send. Receipt updates compare and
  swap the exact previously read central disposition and count success only
  from D1 `changes=1`, so a stale pending poll cannot overwrite a concurrent
  terminal decision. Historical v1 rows are preserved and are never silently
  rewritten or sent into the v2 Queue.
- YW remains a Pages project. Pages cannot own a Cron Trigger or Queue
  consumer, so recovery is driven by ordinary authenticated interactions and
  the learning-health request that User Center probes hourly. The UC Worker
  owns the v2 main/DLQ consumers, bounded scheduled replay, and append-only
  replay receipts. Learning health projects only privacy-safe aggregate counts.
- After migration 0005, reading health is `reading-schema-v5` and requires the
  v2 recovery index. Before that migration, the candidate health check
  deliberately returns unavailable rather than claiming a usable outbox.
- No Pages deployment, Queue write, D1 migration, User Center release or App
  publication was performed. The production facts recorded in
  the following sections remain unchanged until the paired guarded release is
  separately authorized and read back.

## 2026-08-12 A+—F / App synchronization candidate

- The 723 student-visible active vocabulary questions now have one explicit
  authority split derived from `site/data/learning-manifest.json`: 382 exact
  questions remain formal source-evidence items and 341 remain available as
  local practice. Local-practice answers use the same mastery interaction but
  never call the source endpoint or claim evidence sync. This preserves every
  student question and the existing formal A+ denominator.
- Candidate branch `codex/yw-a-f-evidence-20260812` adds an exact native
  bearer identity path and exposes the current YW A+ activation receipt beside
  the already-live formative health receipt. The source manifest and scoring
  policy are unchanged; eligibility is still computed on the server.
- Android content generation now emits exactly 189 student-visible lessons and
  validates the two hidden Web records without bundling them. Candidate semantic
  digest is `sha256:82a4f9f2b5da4d1df4814db301c40a079a2ddcff03c3ac939a8ce4f9801199b3`.
- Historical anonymous interaction feedback remains local and cannot advance a
  checkpoint. New AI interaction evaluation requires authenticated My identity
  and an accepted durable source-evidence receipt; anonymous evaluation is no
  longer generated.
- Production remains the 2026-08-11 deployment below until the User Center
  native flags, Worker version, Web deploy and native release all pass their
  own guarded gates. No D1 row or production traffic is changed by this source
  checkpoint.
- The authority-split follow-up is source-only on
  `codex/yw-vocab-authority-20260812`; it has not been deployed and changes no
  D1 row, Queue message, User Center contract or App release pointer.
- The same source branch now projects the exact 30 classical first-read assets
  (102 paragraphs) into the immutable native-content graph. Every projected
  lesson retains the Web `textVersionId`, `textDigest`, UTF-16 offset unit and
  paragraph keys, with a receipt-bound native index and per-lesson object.
  This is a blocked development candidate only: the tracked stable pointer and
  formal 382-question inventory are unchanged. `node --test
  scripts/test_native_content.mjs` passes 22/22 locally; a clean Web commit,
  Pages deployment receipt, current native-content review and stable promotion
  remain release gates.

Package: `0.2.1-evaluation-nonscoring`. The deployed Web carrier is commit
`a97eba7589ed6afa7df30ba4f37f2241a22d90d0`, contained by current GitHub `main`.
Production serves Pages deployment
`18213286-37d1-4b71-80b6-78e8b986ed3d` at `yw.bdfz.net`; it was deployed at
2026-08-11T16:25:28.112875Z. The current override below supersedes the retained
2026-08-09 candidate/release narrative.

## 2026-08-11 Web reading finalization

This section is retained as the 2026-08-11 release receipt. Its former
"current production" wording is superseded by the 2026-08-15 rollback
authority above.

- Students can use 189 lesson units. The source manifest retains 191 records,
  including two hidden system records; all 189 student-visible pages use one
  masthead: the redundant `先找方向` label is gone while `起始` remains with
  the lesson title and portrait. The owner-scoped local step indicator is
  collapsed beside the portrait instead of occupying the reading column. New
  readers default to 126%; stored local or remote font preferences still win.
  The atlas label and progress denominator derive from the 189 student units,
  while the two hidden system records cannot be opened by direct hash. A valid
  explicit lesson URL takes precedence over anonymous remembered history.
- All 30 classical lessons now require two consecutive reading stages. After
  the immutable `起始 · 無注疏初讀`, the submitted no-note reading remains
  visible beside source-bound learning tips and the annotated canonical text.
  Inline notes begin hidden, use numeric superscripts, type once, collapse on
  repeat click or Escape, and restore focus. Across 191 reader documents all
  2,933 annotation references bind to the preceding visible character or word.
  Vocabulary and vocabulary/syntax study-guide work unlock only after the
  student explicitly acknowledges the annotated reading; the server enforces
  the same non-scoring receipt gate and supports exact mutation replay.
- Student-visible `bdfz.yuque.com` links are removed. Nine WeChat article URLs
  project through exact `wx.bdfz.net` archive mappings. Every supported
  document, image, audio, video or iframe preview can expand to the full-page
  dialog and shrink back with focus restored. After deleting E01, the 16
  permanently unavailable resources and the separately confirmed-dead
  Bilibili item and the empty exact Sichuan gazetteer `content_30068` page, the
  fallback audit covers 351 page resources: 334 have
  reviewed screenshots, 11 use an already verified direct presentation, and
  6 stop embedding while keeping the original link because an external
  condition remains. The screenshot set includes 49 reviewed authenticated
  captures (22 `ctext.org`, 27 `forum.rdfzer.com`). There are 328 unique WebP
  files and 12,795,016 logical screenshot bytes; manifest SHA-256 is
  `30193e813611eb5e9ec09e2da99f81e5bca50597ed8b16839097eb70458333af`.
  Deleted resources are absent from the Web projection, preview registry and
  screenshot manifest; no permanent/remove blocker remains.
- Preview registration remains exact-target and fail-closed: 538 targets, 118
  redirect targets and 75 hosts with digest
  `sha256:887931515ae55b93d579a6892b5146ef68466c1e2c3ae5ed0c8022e00f2e84b7`.
  Seventeen approved BDFZ exact roots load the real remote sites in both card
  and full-page modes; safe QX figure fragments preserve their remote route.
  All 17 Wikisource and 99 exact Google Sites targets are screenshot-first;
  five reviewed YouTube resources are directly playable after an explicit
  student click. `content_22151` remains as a separate exact source.
  Arbitrary sibling paths and every `bdfz.yuque.com` URL remain forbidden, and
  `xue.bdfz.net` is absent from student resources and all preview authorities.
- Every one of the 189 student lessons now has a unique structure question
  tied to a reviewed focus or a literal text anchor and to the lesson's mode.
  The runtime rejects author impersonation and the generic
  `我是／抽掉／換序／最關鍵的材料` templates before caching.
- The study-guide catalog remains 241 items in 16 lessons, now 191 active and
  50 inactive/tombstoned (`yw-study-guides-9cb5500f46333aac`). The formative
  manifest is `yw-formative-20a7145bd573bbb7`, 1,019 items in 115 lessons with
  50 tombstones. Formal A+/A--F scoring remains unchanged.
- Production D1 already contains migrations 0001--0004 and Reading health is
  `reading-schema-v4`; compound learning health is 200. This Web task does not
  alter D1, User Center, the Queue contract, native App source, or the existing
  App `latest-stable` pointer.
- Runtime capabilities are unchanged: Pages + Assets, the existing D1, service
  binding and Queue. Reproducible release authority is Node `24.18.0`,
  lockfile-resolved Wrangler `4.100.0`, with no new Cloudflare capability.
- User direction pauses App and User Center follow-up until the Web learning
  experience is settled. Consequently the old App-content sync check remains
  truthfully blocked and no App receipt, schema or stable pointer is minted.
  The Web release uses the formal stable artifact already referenced by the
  unchanged pointer; the stable Pages rollback is deployment
  `8da16237-ac91-47e1-afe2-7843e2d4c8a4`, preserving every D1 row.
- The section-06 chat frame remains `about:blank` until `進入同讀` is selected;
  this prevents its remote input from taking focus and moving the parent page.
  Mobile lesson titles may use two lines, the 1024-pixel atlas starts closed,
  and vertical whitespace is tightened without removing reading content.
- Live readback of both the atomic deployment URL and `yw.bdfz.net` matches the
  formal release marker SHA-256
  `e384299f11f5695cfe118950bf4f486e1d803ba6fca4335816c49e03dac437c8`.
  Reading and learning health are 200, the online source/taxonomy counts are
  191/189, the deployed preview/screenshot authorities are 538/118/75 and
  351/334/11/6. Dedicated source-carrier browser acceptance is 32/32 for Web
  polish and 16/16 for embed playback; the live-domain browser closeout also
  verifies the no-autoload chat interval. The independent-load mobile sweep
  passed 189/189 lessons and 30/30 aggregate checks, including `lesson-1589`.
- Formal Web staging is current at 1,223 files / 1,222 projected files. Its
  marker is `formal-stable`, projected aggregate
  `0217dc7579cc58ed3c49364e850c0d0561437638383b8f8b621709ff4816050e`,
  marker SHA-256
  `e384299f11f5695cfe118950bf4f486e1d803ba6fca4335816c49e03dac437c8`
  and artifact-manifest aggregate
  `9513b0c02a02a1b7aa3e98201acf09fc2e9e9daf844ffeca02f528c92c87c785`
  over 163,876,528 bytes. The unchanged stable App release remains exactly 278
  included paths.

## Historical 2026-08-09 objective and implemented scope

The sections from here through the historical production/rollback authority
describe the 2026-08-09 candidate and are retained for provenance only. They
are not current deployment instructions; the 2026-08-11 override above is the
operational authority.

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
  semantic-query-preserving deduplication, a historical cross-book link,
  0--100 interest slider, owner-scoped local progress and a four-axis formative
  star projection were implemented. The historical cross-book resource is not
  part of the current Web release.
- Migration `0004_classical_first_read_and_outbox_index.sql` adds first-read,
  idempotency/rate-slot and stable identity-link structures. It has not been
  applied to production.

## Historical 2026-08-09 verified candidate behavior

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

Review rejected the earlier User Center candidate
`f1874e5cc2ed39a907f50c2badfb4cfd7aba55f6` based on canonical main
`844cab6e30590e9853177e55d96944ae7829b88f`: although its formative projection
was non-scoring, it also changed the frozen YW A+ source denominator. A smaller
consumer-only replacement that preserves the canonical A+/A--F snapshot is
under isolated review. No User Center candidate is deployed or authorized by
the current root guard.

## Historical 2026-08-09 release blockers and deferred work

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
7. Pages preview isolation completed on 2026-08-09. Dedicated D1
   `yuwen-reading-db-preview` (`39ed36d9-b3f3-40fd-933a-9a68a4066302`) contains
   migrations 0001--0004; preview has no User Center service or Queue binding,
   while production bindings remain explicit under `env.production`. Eight
   branch-latest previews carry exact clean source `918e66e2473ee298ce3af5f23598de9d3e659095`.
   All 12 historical production-bound preview deployments were deleted; ten
   hash hosts return 404 and the two Cloudflare edge routes that outlived their
   control-plane deletion are quarantined by exact-host Access app
   `5d768360-2dd8-458d-a743-182c9ced3b22` and deny policy
   `eaa5cef6-e21f-4182-b9ce-15d000136fee`.

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
5. **Official maturity.** Pages, D1, Service Bindings, Queues and Access are existing
   stable capabilities classified `approved` by the workspace policy refreshed
   2026-08-08. This candidate adds no beta dependency or pricing plan. The new
   preview D1 is a small isolated non-production resource whose storage and
   operations remain within the existing D1 billing/limits; current account
   readback remains `usage_model=standard`. Access is used only as a reversible
   exact-two-host quarantine for deleted preview routes that had not yet
   converged at the edge; it does not cover the custom domain or new previews.
6. **Toolchain.** Release checks use Node `22.21.1`, lockfile-resolved Wrangler
   `4.100.0`, fixed compatibility date `2026-05-12`, generated-schema checks and
   byte-current manifests. `always_use_latest_compatibility_date=false` in live
   preview and production configuration.
7. **Exposure.** The existing custom domain is `yw.bdfz.net`. Preview uses the
   dedicated D1 above and omits the production identity service and evidence
   Queue, so authenticated/student-data routes fail closed there. Old
   production-bound deployments are retired; the two stale edge hostnames are
   deny-all quarantined until deletion has converged everywhere.
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
    exclusion pass. Preview binding isolation and historical deployment cleanup
    passed. Release still stops on live learning health 503, absent production
    migration 0004, unauthorized User Center deployment or any authenticated
    mutation/readback mismatch.
12. **Exit.** The immediate rollout source backup is
    `backup/yw-pre-production-rollout-20260809` at
    `cf9a8ec17c026526c98172970630df3261d76a68`; the older baseline backup remains
    `backup/yw-self-study-loop-pre-20260809` at `037484f8`. Pages rollback
    anchors are listed below. Preserve D1 during code rollback; use the fresh
    pre-migration export for disaster recovery and backward-compatible
    forward-fix for additive schema. App stable content remains untouched.

## Historical 2026-08-09 production and rollback authority

- Pages project / host: `yuwen-course` / `https://yw.bdfz.net/`
- Historical production deployment at that closeout:
  `20be2885-5494-4b98-a130-af022c1a389b`
- Historical production carrier commit at that closeout:
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

Historical next action (superseded by the 2026-08-11 override): finish the clean
deterministic Web candidate and independent review, then obtain a separately
authorized User Center release. Only after the
compound health receipt is live may the task back up/apply D1, deploy a Pages
preview/production artifact, perform authenticated mutation/replay/readback and
hand the exact Web receipt to the App follow-up task.
- Opening-before-school transport verification does not falsify the academic
  year. From Beijing time 2026-08-12 00:00 until (but excluding) 2026-09-01
  00:00, User Center may accept only the exact server-timed `lessonOpened`
  shape with `lessonPhase=release_canary`, `trace / none / non_scoring` and all
  numeric results null. It is audit-only and can create no credit, snapshot,
  grade or F; delayed replay after the boundary is quarantined. The normal YW
  route explicitly rejects client-supplied `occurredAt` or `academicYear`.
