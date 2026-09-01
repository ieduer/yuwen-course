# 核查標準 / Verification Standard

## 2026-09-01 cross-browser jitter accepted gate

1. **Source of truth.** Accepted source is clean GitHub
   `main@33c2d3610552a4fa48aeb2effba10f027167ea21`; production is Pages
   `6ddd891e-cbb5-438f-8803-26ed4faf44b5`. Confirm live and source CSS/App
   pins plus the exact release marker before judging causality.
2. **Health.** Root, `/api/health` and `/api/learning/health` must remain 200 on
   custom and immutable hosts. This CSS repair has no API write path.
3. **Contract.** `test:release-site` must prove the portrait pseudo-element has
   no animation or `portrait-orbit` keyframes, and that unchanged title geometry
   is guarded before resetting font size. Mobile-atlas must prove the live title
   style and portrait geometry remain unchanged for two seconds.
4. **Browser acceptance.** After lesson data settles, test custom and immutable
   hosts at 1280x800, 390x844 and desktop reduced-motion. Require two
   consecutive byte-identical intervals, a further byte-identical frame one
   second later, unchanged geometry, zero running portrait animations, no page
   errors and no horizontal overflow.
5. **Dependencies.** User Center, APIS, nav, Pulse, D1, Queue and App/native
   content are `verified_no_change`; the App disposition is
   `compatible-no-client-release`.
6. **Release stop.** Missing study-guide source authority, failed App audit,
   failed exact-SHA tests, dirty/unpushed source, missing suen go/no-go or an
   executor mismatch blocks publication. Do not bypass a gate for a CSS fix.
7. **Rollback.** If the accepted release regresses layout, health or content,
   restore Pages deployment `bb605868-d563-49d8-81db-21113bb8442b`; preserve
   D1, Queue, User Center and App state.
8. **Capability fit.** `no-new-capability`; no runtime, binding, route, storage,
   identity, cost or observability model changes.

Accepted result: the restored LaunchServices path passed mobile-atlas 16/16;
all five study-guide PDF/extraction receipts passed; the independently audited
native semantic graph remained blocked from App activation; exact Node 24.18.0
precontent and hosted Node 24.18.0/22.21.1 runners passed. The formal artifact
is 1,221 files / 164,442,131 bytes at aggregate SHA-256
`06c8b3c3a9d45da64aff0792c966fc1a4ad7354c736581b42d92bc295188e790`.
The six-case live matrix passed with zero changed pixels and stable geometry,
and 40 root/health probes returned 40 HTTP 200 responses with zero 5xx. The
release journal is terminal `accepted`; the prior CSS-only candidate was
terminally rolled back after it exposed the independent title observer loop.

## 2026-08-24 bounded-evaluator release gate

This is the newest eight-point authority. It supersedes conflicting retained
2026-08-23 wording, including the old no-schema-change assumption, the old
rollback-first target, the classical-only acceptance and the requirement that
every 503 be absent.

1. **Source of truth.** Use only the retained worktree and branch containing
   `7256098` plus additive migration `0006_learning_evaluator_call_ledger.sql`.
   Open and merge an ordinary PR into `main`; rebuild everything from the exact
   final merged SHA. No second clone, raw `site/` upload, dirty checkout or
   pre-merge artifact is release authority.
2. **Health and live probes.** Before Pages mutation, prove the canonical live
   deployment is still `2471f1e4-884a-4e80-9801-589ebbace476` / `fa93ca8`, and
   preserve `619024c7-a261-405b-a13f-8581a90111ac` as the second-level anchor.
   After deployment, compare custom and atomic HTML/app pins, source SHA and
   `/api/learning/health`; the latter must report `reading-schema-v6` with the
   evaluator table and both indexes.
3. **Contract and test gates.** On the exact merged SHA, exact Node 24.18.0 and
   22.21.1 must each pass the complete `precontent:check` and study-guide-source
   verification. Node 24 builds/checks the formal artifact and its manifest;
   Node 22 independently checks the same artifact. Full Chromium mobile-atlas
   must be green. Tests must prove atomic 60/student/window and
   4/mutation/window admission, conservative accounting of every sent outcome,
   no APIS call when budget or D1/identity is unavailable, structured 503 plus
   `Retry-After`, preserved retry receipt, and no false interaction/evaluation/
   outbox or positive learner-capacity consumption.
4. **Deploy and forbidden actions.** Deploy only through a new one-use external
   executor bound to change id `20260824-yw-evaluator-budget-release-v1`, exact
   merged SHA, checksum-fixed artifact, project `yuwen-course`, a new journal
   directory and rollback deployment `2471f1e4`. The executor must not mutate
   APIS, UC, Queue, D1 schema/data, bindings, routes, Secrets Store, App or any
   other Pages project. Never reuse `.yw-pages-release-20260823`.
5. **Dependency regression.** Treat APIS typed admission, concurrency tuning,
   legacy UC orphan receipts, poetry prerequisites and `modern-prose` mapping as
   recorded backlog, not this release. Still verify the unchanged APIS response
   envelope, UC projection/drilldown, local-practice negative control, mobile
   navigation and Reading health through the authorized acceptance.
6. **Backup and restore.** The pre-migration D1 Time Travel bookmark and exact
   restore command are recorded in the redacted release receipt. A D1 restore
   is destructive and requires separate incident authority, write isolation and
   a new rescue bookmark. Pages rollback never restores D1. Migration 0006 is
   additive and remains compatible with the old Pages code.
7. **Rollback and stop conditions.** A failed live acceptance rolls Pages back
   to `2471f1e4` and leaves D1 history intact; `619024c7` remains the next anchor.
   Stop for operator input only on a Phase 0 P0, a non-green final-SHA Node or
   mobile gate, a deploy/accept executor-gate failure, or live
   `evaluator_retry_exhausted` 429 / inability to complete two dialogue turns.
   A 503 that recovers with the same answer after the 15-second cooldown and a
   pre-existing `modern-prose` feedback mismatch are recorded, not stop events.
8. **Single dual-mode acceptance.** Use the authorized env student exactly once
   after deployment. On lesson 1474, verify no-refresh first-read to annotated
   text, annotated completion to vocabulary, final vocabulary/study-guide
   completion to unlocked structure and author-question. On lessons 1474 and
   1569, run both `structure` and `authorQuestion` for at least two server-owned
   turns, refresh once and prove monotonically accumulated context is restored.
   For lesson 1569, record whether `modern-prose -> argument` produces a genre-
   misplaced evaluation but do not repair it here. Finally prove at least one
   `a_plus_gate` source event is projected to UC with competency facet and
   non-null normalized value and is drillable through
   `sourceUrl + sourcePayloadRef` to the YW-owned answer. Acceptance evidence
   must be redacted: no account, cookie, session, mutation id or answer text.

## 2026-08-23 evaluator timeout and failure-attribution release gate

This is the newest eight-point authority. It adds to, and where necessary
supersedes, the retained 2026-08-22 standard below.

1. **Source of truth.** Start from exact `fa93ca825e9b0d914b4608c971152dcf581ae9ac`
   in the one retained `ieduer/yuwen-course` clone. The repair commit and merged
   default-branch SHA must be ordinary descendants. Rebuild the formal artifact
   from the exact merged SHA; no second clone, raw `site/` upload or dirty
   compatibility checkout is authority.
2. **Health and current-live probe.** Before mutation, prove that custom and
   atomic production still serve deployment
   `2471f1e4-884a-4e80-9801-589ebbace476`, source `fa93ca8`, and the same
   content-hashed app, while rollback
   `619024c7-a261-405b-a13f-8581a90111ac` remains readable. Keep the current
   journal at `candidate_pending_acceptance`; do not accept or roll it back.
   After the repaired deployment, compare custom and new atomic HTML/assets,
   `/api/learning/health`, deployment UUID and exact merged source.
3. **Contract and latency checks.** Under exact Node 24.18.0 and 22.21.1 run
   `npm run precontent:check` and `npm run verify:study-guide-sources`. Build,
   check and manifest the formal artifact under Node 24.18.0, then check its
   manifest under Node 22.21.1. In addition, tests must prove:
   - feedback uses a 45-second Worker timeout and both browser evaluator paths
     use 55 seconds; all other APIS task types retain 20 seconds;
   - abort, upstream 5xx and invalid upstream JSON return structured
     `learning_evaluator_unavailable` 503, no interaction/evaluation/outbox/
     Queue evidence, and no consumed learner resource/global slot;
   - the exact same mutation receives at most a 15-second evaluator cooldown,
     can reserve a fresh positive slot after expiry, and never returns
     `evaluator_retry_exhausted`; genuine learner `window_capacity` remains a
     rate-limited 429;
   - reservation concurrency, abandoned `.001Z` lease reclaim, idempotent
     replay and monotonic formal completion remain unchanged.

   Before release, take 20 bounded `feedback`/`medium` samples using the real
   study-guide prompt contract and retain only aggregate timing/validity. Gate
   on successful-response p95 below 45 seconds and investigate every transport
   or invalid response. The current sample is 19/20 valid, one transport
   `TypeError`, p95 24.401 seconds and max 25.908 seconds. A five-sample `low`
   comparison had one invalid response, so keep `medium`.
4. **Deploy and forbidden actions.** The old one-use external executor remains
   frozen to `fa93ca8`. Do not edit, relabel or reuse it. Only a separate,
   independently reviewed, single-stage executor may deploy YW Pages, and it
   must be bound to the exact merged SHA, checksum-fixed formal artifact,
   project `yuwen-course` and rollback `619024c7`. It must have no UC, D1,
   Queue, APIS, App/native, binding, route or other Cloudflare mutation path.
   Re-run the >=25 GiB disk gate immediately before artifact build and deploy
   for this release; do not lower the threshold or force past it.
5. **Dependency regression.** Verify User Center identity, APIS response
   envelope, Reading health, Queue contract, local-practice negative controls,
   mobile trusted-touch navigation and Companion/native disposition as
   `verified_no_change`. No shared consumer source or configuration changes.
6. **Backup and restore.** This repair changes Pages code/static assets only.
   Ordinary authenticated learner UI records are retained and never rewritten
   for cleanup; there is no schema or administrative D1 restore. Preserve
   rollback `619024c7`, its source/hash readback and the checksum-fixed rebuilt
   artifact authority.
7. **Rollback.** Any failed custom/atomic hash, health, authenticated flow,
   unexpected 503 or `evaluator_retry_exhausted` 429 restores exact deployment
   `619024c7` through the reviewed executor. Then repeat custom/atomic hashes,
   health, mobile navigation and representative formal/local controls. Never
   delete D1, outbox or Queue history during code rollback.
8. **Single live acceptance.** After deployment, use only the configured env
   student through ordinary UI paths and run lesson 1474 once end-to-end. On
   the same page, first-read submit must expose annotated reading; annotated
   completion must expose vocabulary; the final vocabulary/study-guide item
   must unlock structure, evaluation and author-question. Structure and
   author-question must each retain at least two server-derived dialogue turns
   without reload. Across the run, `learning_evaluator_unavailable` 503 count
   must be zero and `evaluator_retry_exhausted` 429 count must be zero. Retain
   only aggregate outcomes, durations, status codes and asset hashes—never the
   student identity, cookie, session, mutation ID or answer text. Also prove a
   local-practice lesson makes no formal POST. Only after all gates pass may
   the new candidate be accepted; otherwise execute point 7.

Pre-release local gate last verified 2026-08-23 PDT: exact Node 24.18.0 and
22.21.1 each pass 245/245 TAP tests with zero skip/fail and every non-TAP gate;
five study-guide PDF/extraction receipts and 693 textbook-page files /
75,196,340 bytes match their tracked authorities. The formal artifact passes
both runtimes at 1,223 files / 164,458,961 bytes, projected aggregate
`520aabbb9a462c3b18d491aa1163b37cba0e05b50aceec2c18463b4f692cee55`,
artifact aggregate
`31f5a020549387589336ecd6be29bea5416c166084672b411024c9f00ae94101`
and marker SHA-256
`870ae05d50a41a98cc44355277416d70a0cd7c9987e768c8cf81d65527aee3ae`.
No repaired Pages deployment or authenticated production acceptance has been
performed; those remain blocked on a new explicit executor authorization.

## 2026-08-22 lesson 1474 staged-loop recovery and dialogue

This eight-point standard is the release authority for the lesson 1474 repair.
It supersedes any older dated wording that appears to authorize a checkout or
operator to upload Pages directly.

1. **Source of truth.** Use a clean clone of `ieduer/yuwen-course`. The reviewed
   pull-request head must be an ordinary descendant of current remote `main`,
   and every release artifact must be rebuilt from the exact merged-main SHA.
   `/Users/ylsuen/CF/yuwen-course` is a dirty compatibility checkout and remains
   read-only; it is neither build nor deploy authority.
2. **Health probe.** Before release, read back the current production deployment
   UUID, branch, source SHA, custom-domain `/` and `/api/learning/health`.
   After any future authorized release, repeat those checks against both the
   custom domain and the atomic Pages URL and compare the content-hashed app,
   first-read controller, manifest and learning-health bytes/status. A command
   exit code, Git merge, browser screenshot or task-pane state is not release
   proof.
3. **Contract checks.** Under exact Node 24.18.0 and 22.21.1, run
   `npm run precontent:check` and `npm run verify:study-guide-sources`. Under
   Node 24.18.0 run `npm run build:release-site`,
   `npm run check:release-site`, `npm run build:artifact-manifest` and
   `npm run check:artifact-manifest`; check the resulting artifact manifest
   again under Node 22.21.1. The focused minimum is:

   ```zsh
   npm run test:classical-first-read
   npm run test:study-guide-frontend
   npm run test:evidence-contract
   npm run test:local-progress
   npm run test:reading-api
   npm run test:static-asset-cache
   ```

   The first-read controller must prove that critical next-stage rendering
   precedes storage/progress synchronization; storage failure cannot undo a
   committed source; an ancillary renderer failure cannot replace an already
   visible annotated text; POST and state readback are bounded through JSON
   body consumption, including a response body that never finishes; and only an exact
   authoritative lesson ID, text version and text digest with
   `submitted=true` unlocks after an ambiguous response. Uncommitted and all
   authority-mismatch branches remain retryable and locked.

   Study-guide tests must prove that a persisted `submitting=true` snapshot is
   restored as retryable `pendingSync`, retaining its mutation ID, answer and
   reference-reveal timestamp; storage failure and owner-scope change do not
   strand the spinner; the browser evaluator call is bounded through response
   body consumption; a request cannot start unless its stable retry receipt is
   durably stored; and evaluator
   failure returns structured 503 with no false interaction, evaluation,
   outbox or Queue write. Completing the last active lesson-1474 study-guide
   item must recompute the checkpoint and expose every eligible downstream
   control without reload.

   Identity tests must prove zero owner-scoped storage writes, evidence posts
   or shared-state mutations before exact owner discovery; ownerless reading
   position/font changes must never be rebound to the discovered student.
   First-read, shared-state and lesson callbacks are generation-bound across
   owner and lesson replacement. A hung shared-state module or study-guide
   catalog body must time out, clear its promise and retry on the same page with
   a fresh request while the core lesson remains usable. Session lookup, owner
   discovery and every client owner check/mutation must have the same bounded
   full-promise behavior. Replacing the identity object for the same owner must
   preserve and deliver that owner's pending reading/font state under the new
   generation; changing owner must discard it.

   Formal lesson-1474 structure and author-question integration tests must use
   the real Worker route with an isolated SQLite evidence ledger and two turns.
   The second prompt must contain the first evaluator answer and next question,
   history must be derived only from the authenticated student/resource/
   interaction ledger, replaying the same mutation must not call APIS again,
   completion must be monotonic, and a lesson with no author must use the
   text-reading-coach role. Author/coach labels must match across the prompt,
   visual dialogue, transcript and accessible name; use authoritative attempt
   numbers after truncation and announce/focus only the latest feedback. Return
   at most six transcript turns and include at most four prior turns in a new
   evaluator prompt. The Worker-to-APIS timeout must also cover a response body
   that never finishes. The 88 local-practice
   lessons must retain zero APIS/formal-evidence calls.
4. **Deploy and forbidden actions.** A checkout stops after producing and
   checking checksum-fixed `.release/site`; it must not call `wrangler pages
   deploy`, move a production alias or perform rollback. Pages production and
   rollback require the independently reviewed external UC+YW executor named
   by project policy, with a stable change ID, exact merged SHA, artifact
   checksum, callable preflight, rollback target and post-deploy readback. The
   currently inspected external workflow is explicitly source-only and exits
   before credentials, so it is not a production executor. Do not upload raw
   `site/`, deploy from a dirty checkout, use global Wrangler, change policy to
   bypass the gate, run a D1 migration/admin write, change Queue/APIS/User
   Center configuration, alter a route/binding/schema, change formal manifest
   membership or move the stable native pointer in this transaction.
5. **Dependency regression.** Retain Reading, first-read, study-guide,
   vocabulary, learning-evidence, shared-state, local-progress, native-content
   object and formal-artifact checks. `check:native-content:deploy-sync`
   remains a separate fail-closed App-promotion gate; do not relabel its known
   rejection as green or mutate the stable pointer for this Web-only repair.
   Verify User Center identity, APIS contract, Queue and Companion as
   `verified_no_change`, including one formal lesson and one local-practice
   lesson. No shared-hub source/config change is authorized here.
6. **Backup and restore.** Normal authenticated student UI checks create only
   ordinary learner-owned records and must not be deleted or rewritten for
   cleanup. There is no schema or administrative data mutation and therefore
   no D1 restore. Preserve the current production deployment UUID/source SHA
   and a checksum-verified rebuild authority for rollback.
7. **Rollback.** Before release, the external executor must demonstrate a
   callable rollback or verified production-alias restoration to deployment
   `619024c7-a261-405b-a13f-8581a90111ac` / source `16b8277`; otherwise release
   remains blocked. Wrangler 4.100.0 has no Pages deployment rollback command,
   and an old manual direct upload is forensic evidence rather than reusable
   authority. After rollback, repeat points 2, 3 and 5. Never delete or rewrite
   D1/outbox/Queue evidence during code rollback.
8. **Last verified.** On 2026-08-22 PDT, current production remained deployment
   `619024c7-a261-405b-a13f-8581a90111ac` and learning health was HTTP 200
   healthy. A real authenticated configured-student run completed lesson 1474:
   12/12 vocabulary, 3/3 corrections, 19/19 active study-guide items and all
   downstream checkpoints. It reproduced the old generic study-guide 500,
   verified retry, same-page final unlock, and proved old production returned
   only one-shot formal results with no transcript. On exact Node 24.18.0 and
   22.21.1 the candidate passes first-read 30 lessons/102 paragraphs,
   study-guide frontend 27/27, evidence 62/62, local progress 24/24, learning
   manifest 11/11 and the shared-state browser contract. Both complete
   `precontent:check` runs pass, including trusted-touch mobile 13/13, Reading
   74/74, native projection 22/22 and formal staging 5/5, and both verify five
   PDF/extraction byte receipts. The native gate used 693 exact tracked live
   public page files / 75,196,340 bytes; the canonical Drive token returned
   `invalid_grant`, so this is not a fresh archive readback. Two independent
   final reviews reported no remaining P0-P3. The checksum-fixed 1,223-file /
   164,456,389-byte artifact has projected aggregate
   `3eee253710281c30747e7ba6570f8da6cf0ef080836096b5aea8cbf6c336f0f1`
   and tracked manifest aggregate
   `4c46462b0798048ce69eac8b5c0ba2691d9979af41388d2299e7738a3b172f06`.
   PR #20 is merged as exact runtime source
   `ef6272778db1dd3cfed227b47ac4cf17163eba3f`; Actions run `32623520208`
   passed both exact Node jobs. PR #21 synchronized project state, and a clean
   detached default-main rebuild after that documentation merge
   reproduced the same formal marker and aggregates.
   Production remains unchanged while the external deploy/rollback executor is
   unavailable.

## 2026-08-22 mobile, first-read and formative-stage correction

This eight-point standard is the release authority for the 2026-08-22 repair.

1. **Source of truth.** Work only from a clean clone of
   `ieduer/yuwen-course`; the reviewed pull-request head must be an ordinary
   descendant of current remote `main`. The release artifact must be rebuilt
   from the exact merged-main SHA. The dirty compatibility checkout at
   `/Users/ylsuen/CF/yuwen-course` is read-only and is not a build or deploy
   authority.
2. **Health probe.** Before and after release, require HTTP 200 for `/`, the
   content-hashed `assets/app.js` and `assets/classical-first-read.js`, and
   `/api/learning/health`. Read back the Pages deployment UUID, environment,
   branch and source SHA; do not infer release from an upload command alone.
3. **Contract checks.** Under exact Node 24.18.0 and 22.21.1, run
   `npm run precontent:check` and `npm run verify:study-guide-sources`. Build
   the formal Web artifact once under Node 24.18.0 with
   `npm run build:release-site`, `npm run check:release-site` and
   `npm run build:artifact-manifest`; check that manifest under both runtimes
   with `npm run check:artifact-manifest`. The focused minimum is:

   ```zsh
   npm run test:mobile-atlas
   npm run test:classical-first-read
   npm run test:lesson-blueprints
   npm run test:evidence-contract
   npm run test:local-progress
   npm run test:static-asset-cache
   ```

   The mobile test must use trusted touch input at 390x844 and 1024x768, reach
   the final lesson, keep the drawer open across a height-only resize and still
   close it when crossing 1280 to 1024. The first-read test must prove both
   branches of an ambiguous non-2xx: authoritative `submitted=true` unlocks on
   the same page and schedules reconcile once; authoritative
   `submitted=false` does not unlock and remains retryable; a submitted state
   with a mismatched lesson ID, text version or text digest must also remain
   locked. The interaction tests must prove identity-pending clients cannot
   save local practice; once ownership resolves, lesson 1727
   structure/author-question are local practice, perform no fetch or formal
   write, remain ineligible for hidden `lessonCompleted` telemetry even after
   an eventful 100% progress refresh, and give stale authenticated clients a
   stable 422 after identity
   reconciliation but before APIS or any formal interaction, evaluation,
   reservation, outbox or Queue write. Lesson 1497 must remain a formal
   positive path that reaches APIS and the existing evidence ledger. The
   blueprint test must cover all 189 lessons and keep 1727 away from title,
   source-label and map-caption anchors.
4. **Deploy and forbidden actions.** After green PR checks and merge, rebuild
   `.release/site` in a second clean clone of the exact merged SHA, then upload
   only that formal artifact with lockfile Wrangler 4.100.0 to Pages project
   `yuwen-course`, branch `main`, recording the exact commit hash. Do not deploy
   `site/` directly, deploy from a dirty checkout, run a D1 migration, change a
   Queue state, alter a binding/route, regenerate learning-manifest membership,
   move the stable native pointer or publish an App build in this transaction.
5. **Dependency regression.** The Web gates must retain the existing Reading,
   learning-evidence, study-guide, vocabulary, shared-state, native-content
   object and formal-release checks. Run
   `npm run check:native-content:deploy-sync` separately: its known rejection
   remains release-blocking for any App or stable-pointer promotion, but is not
   rewritten as a Web failure for this already-reviewed leaf-only Web path.
   Prove instead that the shipped stable pointer and every referenced native
   object are byte-identical to the pre-release source. Post-release smoke must
   cover the custom domain and the atomic Pages URL, anonymous identity gating,
   one manifest-listed formal lesson, lesson 1727 local practice, and the
   189-lesson catalog. No hub consumer requires a source change; User Center,
   APIS, Queue and Companion remain `verified_no_change` unless live evidence
   says otherwise.
6. **Backup and restore.** This transaction has no data mutation, so no D1
   restore is permitted or required. Retain the pre-release Pages deployment
   UUID and its source SHA as the complete static/Worker rollback anchor.
   Existing D1, outbox and Queue records must survive either code version.
7. **Rollback.** If the custom domain, authenticated first-read, formal 1497
   path or representative negative controls regress, immediately redeploy the
   verified pre-release production deployment
   `6426b70e-d39b-4ba9-898b-0f5e7a1c3859` (source `26f126b`), then repeat points
   2, 3 and 5. Do not delete or rewrite D1/Queue evidence during code rollback.
8. **Last verified.** Pre-release focused Node 24 checks on 2026-08-22 pass:
   mobile 7/7, blueprint 7/7 across 189 lessons, first-read ambiguous-submit
   recovery, evidence 56/56, local-progress 13/13 and static cache 1/1. The
   complete Node 24.18.0 and 22.21.1 Web gates also pass with Reading 74/74,
   native object checks 22/22 and release-site checks 5/5 on each runtime; both
   verify all five study-guide PDF/extraction receipts. The formal author
   artifact contains 1,223 files. `site/app-content` is byte-identical to
   remote main at tree `809cdb9cb19d9531b156a0e07d89f2e7590b75c4`.
   Independent exact-diff review found no remaining P0-P3 defect or code-level
   release blocker. PR #18 and GitHub Actions run `32607440011` passed; a clean
   detached rebuild of merged source
   `16b8277afdf32618043703de4eb9b4098858b888` reproduced the formal artifact.
   Production readback is deployment
   `619024c7-a261-405b-a13f-8581a90111ac`; the final live evidence is recorded
   below. The observed
   native deploy-sync
   rejection (`current canonical source graph lacks an approved audit receipt`)
   is an App promotion blocker and must be recorded, not overridden or
   relabelled green.

### Production acceptance receipt

- **Deployment identity:** Pages environment `production`, branch `main`,
  source `16b8277afdf32618043703de4eb9b4098858b888`, deployment
  `619024c7-a261-405b-a13f-8581a90111ac`, atomic URL
  `https://619024c7.yuwen-course.pages.dev`. Immediate rollback is
  `6426b70e-d39b-4ba9-898b-0f5e7a1c3859` / source `26f126b`.
- **Artifact identity:** both the custom host and atomic URL returned HTTP 200
  with `app.js` SHA-256
  `c7e8de9f04ab9c7666f294226d02834892407d2c6e6cacaaa445438d80af67f2`,
  `classical-first-read.js` SHA-256
  `241cd5b2d0dae47a8d22c1b6adb575b9023451b37c37199d338eebfd85451094`
  and lesson-manifest SHA-256
  `53f0ab67393128a3da1c2696b24d261e30b05eb1faf9fcff6f6280842d217a91`,
  exactly matching the clean formal staging. `/api/learning/health` returned
  HTTP 200 with `status=healthy`; anonymous `/api/interaction-check` remained
  rejected with HTTP 403.
- **Mobile:** the live custom host passed all 7 trusted-touch checks at 390x844
  and 1024x768. The drawer reached its final lesson, survived height-only
  changes and closed only on the 1280-to-1024 compact-boundary transition.
- **First read:** an existing authenticated browser loaded live lesson 1727
  with the submitted first-read source, 3 marked difficulties, completed
  13/13 vocabulary and both later local-practice stages unlocked; the page had
  zero console errors. Acceptance deliberately did not create a new learner
  row. The exact post-commit non-2xx same-page branch is proven by
  `test:classical-first-read`: a matching authoritative submitted state
  unlocks without reload and reconciles once, while uncommitted and
  lesson/version/digest mismatch controls remain locked.
- **Cross-lesson controls:** in a fresh anonymous browser, lesson 1693 saved
  both structure and author-question local self-checks, rendered local feedback
  and sent zero `/api/interaction-check` requests; anonymous completion stayed
  false. Live lesson 1727 exposed the same two local-practice notices. Formal
  lesson 1497 exposed only the login-gated formal controls. Live taxonomy and
  learning-manifest bytes classify all 189 student lessons symmetrically as
  101 formal and 88 local for each question kind.
- **Mutation boundary:** no direct D1 command/migration, Queue/APIS/User Center
  configuration change, route, binding, schema or native/App pointer mutation
  was made. The authenticated readback exercised the existing identity-
  reconciliation boundary but created no new learning submission. The only
  browser submission was anonymous local practice in the isolated acceptance
  profile.

## 2026-08-20 production acceptance evidence

The exact source deployed to production is
`26f126bfb38c62b251bbe8815d6ef32c4594bce7`; Pages readback is
`6426b70e-d39b-4ba9-898b-0f5e7a1c3859` and immediate rollback is
`581a0180-2085-4960-8cd0-4aee17cb2abd`. GitHub run `32447617539` passed both
Node jobs. Independent detached clean-clone full gates passed Node 22.21.1 and
24.18.0 with Reading 74/74, evidence 54/54, native-content 22/22 and
release-site 5/5.

A previously failing cached browser and a fresh authenticated browser both
loaded 189 student-visible lessons and opened a real lesson after deployment.
The exact normal lesson-open request produced one server-tagged canary: source
284 to 285, UC YW evidence 277 to 278, mapped-accepted admission, durable
accepted disposition, non-scoring, null scoring policy and null numeric values.
Quarantine remained five, credit remained zero, authenticated weekly reading
and A+ were unchanged, and main/DLQ backlog both read zero. The Queue terminal
state is `delivery_paused=false`. After the designed 15-minute source receipt
lease, an ordinary HTTP 200 learning-health drain reconciled the source outbox
to `central_disposition=accepted` with a receipt timestamp; no direct database
update was used.

The APIS direct probe with exact production headers returned HTTP 200 in
4,118 ms with a non-empty answer. The evaluator failure tests prove the live
artifact's friendly 503/15-second retry contract without injecting an outage
into production. This acceptance proves transport and correct scoring
isolation. The first real 2026-2027 scoring event remains a scheduled read-only
post-handoff verification, not a completed 8-month scoring sample.

## 2026-08-20 Web launch-readiness correction

In an exact clean checkout, install with `npm ci`, then run the complete
`precontent:check` under Node 24.18.0 and 22.21.1. The focused minimum is:

```zsh
npm run test:static-asset-cache
npm run test:evidence-contract
npm run test:vocab-progress
npm run test:release-site
```

The cache test must bind every local CSS/JS entry asset to its tracked source
byte hash. Evidence tests must prove the server-only canary phase boundary, a
friendly retryable evaluator 503, immediate same-answer retry, second-attempt
exhaustion, and zero interaction/outbox writes on evaluator failure.

After deployment, use a fresh browser context and a context that previously
cached the old July vocabulary helper. Both must load the 191-record catalog,
show 189 student-visible lessons and open one real lesson without
`formalVocabularyResourceKeys` or other console errors. Read back the canonical
Pages deployment ID and source SHA. Only then may the single authorized v2
Queue resume proceed and remain open.

The authenticated transport canary passes only when a normal UI lesson open
creates exactly one new source event/outbox attempt, UC accepts exactly one new
`mapped_accepted` evidence row with `non_scoring` and null scoring policy, the
source reconciles the terminal receipt, quarantine and DLQ do not increase, and
weekly reading/A+ plus credit/snapshot/F counts remain unchanged. Existing
quarantine samples are read-only audit evidence and must not be replayed or
deleted.

## 2026-08-20 post-PR-#12 server-authority reconciliation

Use only a task-owned clean checkout. The durable page-image authority is the
accepted path-preserving archive receipt at
`/Users/ylsuen/CF/reports/storage_archive_records/2026-08-15-textbook-ai-migration.json`,
checked against tracked inventory
`/Users/ylsuen/CF/jc-textbook-reader/manifests/page-images.sha256`. If the
canonical local source is absent, restore the whole archived path and verify it
before either complete source gate:

```zsh
test ! -e /Users/ylsuen/textbook_ai_migration
/Users/ylsuen/CF/scripts/restore_gdrive_archived_path.sh \
  Users/ylsuen/textbook_ai_migration
rclone check \
  gdrive:Backups/CF-Archive-v1/files/Users/ylsuen/textbook_ai_migration \
  /Users/ylsuen/textbook_ai_migration \
  --checksum --one-way
```

There is no accepted selective 693-file restore command. After the canonical
whole-path restore, run the complete source gate under both exact Node
authorities using its default page root:

```zsh
source /Users/ylsuen/.nvm/nvm.sh
nvm use 24.18.0
npm run precontent:check

nvm use 22.21.1
npm run precontent:check
```

The 2026-08-20 run used a disposable 693-file subset restored under the task's
temporary directory. All 693 files matched the tracked page inventory; that
temporary location is historical evidence only, not a reproducible command or
durable resource. The accepted archive was last read back on 2026-08-15 and was
not re-read from Drive during this hardening task.

The Reading API gate must prove all of the following with local synthetic
identity and temporary D1 only:

- browser `aiScore`, `aiVerdict` and `source` cannot set stored authority;
- an unassessed dedupe clears a legacy score/verdict, while constellation and
  history ignore every stored score that lacks matching source evidence, and a
  valid source assessment for a different, unsubmitted three-word set cannot
  brighten the lesson;
- an absent lesson cannot create a reading star/submission or learning event;
- an orphan first-read asset cannot mutate mark/session/evidence tables through
  mark, delete, submit or resolve;
- an unknown source event cannot authorize a reading score;
- brightness excludes browser-forged scores;
- the existing reading, first-read, study-guide, vocabulary, idempotency and
  rate-limit invariants remain green.

The evidence-contract gate must independently prove that a score lookup is
bound to source event, student, lesson, `contextWords`, `a_plus_gate`,
`source_ai_assessment` and the identical normalized three words, including a
hostile word-mismatch rejection.

It must also table-drive all ten cookie-authenticated mutation routes and prove
that missing/foreign Origin, `Origin: null`, missing content type and
`text/plain` fail before binding access, identity resolution, APIS, D1, outbox
or Queue. Exact same-origin Web JSON must remain functional. Exact native header
authentication remains Origin-independent only after JSON and the existing
native session projection pass; a rejected native session and native
`text/plain` must have zero side effects. The local identity seam cannot bypass
the request gate.

The blueprint and retired-discussion hostile gates must also prove:

- a known lesson ignores forged browser title/block/excerpt/mode/genres and
  returns the source-deterministic blueprint derived only from the hydrated
  authoritative lesson plus server taxonomy, with zero APIS or runtime-cache
  operation and `cache-control: no-store`;
- interaction scoring ignores forged mode/genres/authors/title/excerpt, derives
  mode/genres/author/speaker from the exact server taxonomy, stores only the
  allowlisted student response, and returns 503 with zero side effects when the
  taxonomy row is unavailable;
- an unknown lesson or known lesson without taxonomy performs zero APIS and
  cache read/write operations;
- `POST /api/discussions/:lessonId` returns 410/no-store with zero outbound,
  D1 or Queue operation even when the legacy credential binding name exists.

Build the deterministic formal Web artifact on Node 24, then check the same
bytes on Node 22:

```zsh
source /Users/ylsuen/.nvm/nvm.sh
nvm use 24.18.0
YW_STUDY_GUIDE_SOURCE_DIR=/Users/ylsuen/CF/output/pdf_study_guides_web \
  npm run verify:study-guide-sources
npm run build:release-site
npm run check:release-site
npm run build:artifact-manifest
npm run check:artifact-manifest

nvm use 22.21.1
YW_STUDY_GUIDE_SOURCE_DIR=/Users/ylsuen/CF/output/pdf_study_guides_web \
  npm run verify:study-guide-sources
npm run check:release-site
npm run check:artifact-manifest
git diff --check
```

The earlier predecessor receipts are not authority for the combined tree. PR
#12 was merged unchanged as `10177b360077ef1347db531c14ca287757ef2d8f`;
PR #14 then ordinary-merged that exact main. Exact Node 24.18.0 and 22.21.1
each passed the complete `precontent:check`, the 96/96 focused matrix, Reading
74/74, evidence 52/52, blueprint 6/6, native-content 22/22 and release-site
5/5; both also verified all five PDF/extraction receipts. After both complete
gates, Node 24 rebuilt the formal artifact and both runtimes checked the same
1,223 files / 164,387,142 bytes. Projected aggregate SHA-256 is
`ac6efa919a516c272209a94e0f078373bbfaabdf5c28766dd188cb0b077ec65e`,
artifact aggregate SHA-256 is
`3fcc42802b5f2478e0cc3ec3ffa720ce7feacff6fe9a14ae17c0dddf32085825`,
tracked manifest byte SHA-256 is
`9ff27ae8abd5b7dcafc503aa493809d2ff4b119cb176bdbf481f9298dda975a6`,
and formal marker byte SHA-256 is
`4d8fe8ad0b72955b0ff284c87d9c61c99d400b5744ffe0bc1cae225a4f910a60`.
PR #14 remains Draft pending exact-head GitHub CI and a fresh independent
P0/P1 review; it must not be marked ready or merged before both are green.

The release gate remains deliberately red. With the verified page fixture,
both exact Node authorities must be rechecked to stop at:

```text
current canonical source graph lacks an approved audit receipt
```

That is a release **NO-GO**, not a test waiver. This task does not generate the
separately owned native Web/App receipt, deploy Pages, migrate/write D1, send or
drain Queue data, or mutate User Center. Production remains deployment
`18213286-37d1-4b71-80b6-78e8b986ed3d` / source `a97eba7` until a separately
authorized paired release passes that gate and authenticated live acceptance.

## 2026-08-15 combined assessment, retry and native formative source gate

Run the focused identity/evidence contract and the complete source gate under
both exact Node authorities. `test:native-content` also requires the immutable
textbook page inputs. Use the exact whole-path restore and checksum procedure in
the preceding section. A private task may instead use a disposable exact-page
subset only when every byte matches the tracked SHA-256 inventory; such scratch
is not a durable restore authority. Then run:

```zsh
PATH=/Users/ylsuen/.nvm/versions/node/v24.18.0/bin:$PATH \
  node --test scripts/test_learning_manifest.mjs \
  scripts/test_learning_evidence_contract.mjs \
  scripts/test_preview_binding_isolation.mjs \
  scripts/test_reading_identity.mjs \
  scripts/test_study_guide_assessment.mjs \
  scripts/test_study_guide_frontend.mjs \
  scripts/test_lesson_blueprint_quality.mjs
PATH=/Users/ylsuen/.nvm/versions/node/v24.18.0/bin:$PATH npm run precontent:check

mkdir -p /private/tmp/yw-node22-exact-bin
test -L /private/tmp/yw-node22-exact-bin/node || \
  ln -s /usr/local/libexec/bdfz-release/node-v22.21.1 \
  /private/tmp/yw-node22-exact-bin/node
/usr/local/libexec/bdfz-release/node-v22.21.1 --test \
  scripts/test_learning_manifest.mjs \
  scripts/test_learning_evidence_contract.mjs \
  scripts/test_preview_binding_isolation.mjs \
  scripts/test_reading_identity.mjs \
  scripts/test_study_guide_assessment.mjs \
  scripts/test_study_guide_frontend.mjs \
  scripts/test_lesson_blueprint_quality.mjs
PATH=/private/tmp/yw-node22-exact-bin:/Users/ylsuen/.nvm/versions/node/v24.18.0/bin:$PATH \
  npm run precontent:check

git diff --check
```

The hostile contract must prove that absent or non-native authorization with a
valid bounded User Center cookie selects only Web
`resolveSession`/`getFormativeMastery`; a native-looking header beginning in
the `Bearer ywat_` namespace but failing the exact native shape returns 401
without either identity RPC even when a cookie is present. Exact native
authorization selects only `getNativeFormativeMastery`; a simultaneous cookie
must resolve to the same stable user and cannot replace native mastery
authority. A missing native method remains 503. The selected RPC's existing
exact `bdfz-yw-formative-mastery-rpc-v1` response validation, non-scoring flags
and manifest projection remain unchanged.

Local and CI success is source evidence only. Merge and deployment remain
blocked until the exact canonical User Center source selected for the
synchronized transaction exposes `getNativeFormativeMastery`; the separately
owned hub change must add its own native expiry, revocation, wrong-client,
cross-user, response-shape and log-redaction tests and then pass the shared-hub
synchronized change gate. No Cloudflare, D1, Queue, Pages or App mutation
belongs to this source check. Rollback is a normal revert of the exact candidate
commit.

Current live readback is deliberately different from this source gate:
`yw.bdfz.net` serves Pages deployment
`18213286-37d1-4b71-80b6-78e8b986ed3d` from source
`a97eba7589ed6afa7df30ba4f37f2241a22d90d0`. Deployment
`8da16237-ac91-47e1-afe2-7843e2d4c8a4` / source
`0ff5d5604ceefef92c99c07033f1e900d9edaaed` is the stable rollback, not current
production. The combined source checks must never be reported as live
native/v2 or A--F acceptance.

### Assessment, retry and anonymous-AI coverage

The combined source tree must regenerate the formal release site and tracked
artifact manifest once after both the native identity and assessment/retry
changes are present. Per-PR predecessor artifact hashes are not valid combined
authority.
Run the complete source gate and focused contract matrix under both exact Node
authorities:

```zsh
PATH=/Users/ylsuen/.nvm/versions/node/v24.18.0/bin:$PATH npm run precontent:check
PATH=/Users/ylsuen/.nvm/versions/node/v24.18.0/bin:$PATH \
  node --test scripts/test_learning_manifest.mjs \
  scripts/test_learning_evidence_contract.mjs \
  scripts/test_preview_binding_isolation.mjs \
  scripts/test_reading_identity.mjs \
  scripts/test_study_guide_assessment.mjs \
  scripts/test_study_guide_frontend.mjs \
  scripts/test_lesson_blueprint_quality.mjs

mkdir -p /private/tmp/yw-node22-exact-bin
test -L /private/tmp/yw-node22-exact-bin/node || \
  ln -s /usr/local/libexec/bdfz-release/node-v22.21.1 \
  /private/tmp/yw-node22-exact-bin/node
PATH=/private/tmp/yw-node22-exact-bin:/usr/local/libexec/bdfz-release/npm-v11.6.2/bin:$PATH \
  npm run precontent:check
/usr/local/libexec/bdfz-release/node-v22.21.1 --test \
  scripts/test_learning_manifest.mjs \
  scripts/test_learning_evidence_contract.mjs \
  scripts/test_preview_binding_isolation.mjs \
  scripts/test_reading_identity.mjs \
  scripts/test_study_guide_assessment.mjs \
  scripts/test_study_guide_frontend.mjs \
  scripts/test_lesson_blueprint_quality.mjs

PATH=/Users/ylsuen/.nvm/versions/node/v24.18.0/bin:$PATH npm run build:release-site
PATH=/Users/ylsuen/.nvm/versions/node/v24.18.0/bin:$PATH npm run check:release-site
PATH=/Users/ylsuen/.nvm/versions/node/v24.18.0/bin:$PATH npm run build:artifact-manifest
PATH=/Users/ylsuen/.nvm/versions/node/v24.18.0/bin:$PATH npm run check:artifact-manifest
git diff --check
```

The focused gate must prove all 46 source-owned response fixtures, including
the required simplified/traditional single-choice forms, explanation-letter
pollution, the known ambiguous tradeoff and circled-glyph display. It must prove
that the first evaluator-stage failure releases only the exact initial lease,
one of ten immediate contenders reuses the same slot/event, the second failure
keeps `.001Z` and blocks a third evaluator, and recording failures never release.
Both browser retry surfaces must preserve reason plus retry seconds. Retired
chat and learning-check routes must spend zero APIS calls; every one of 189
lesson blueprints must remain deterministic and text-anchored with zero APIS.
Existing receipt reconciliation, late-original immutability and Queue hostile
checks remain required.

Completed local source evidence on 2026-08-15: exact Node 24.18.0 and 22.21.1
each passed the complete `precontent:check`; the unified focused matrix passed 85/85,
Reading API 70/70, native content 22/22 and release-site 5/5 on each runtime.
The native test used 693 exact page files / 75,196,340 bytes restored from the
accepted path-preserving Drive archive; an isolated readback matched all 693
files against the canonical page SHA-256 inventory, and the native builder
independently checked every referenced SHA-256.

Formal build/check produced 1,223 files / 164,378,212 bytes, projected aggregate
`21485dbc7c0c167925a0f3d56835ee19b379ce413aff23aab4c102b244e1f922`,
artifact aggregate
`ae7c907010f3a148f7b68a3bfc5442220091759202acb85ce5a11e04f742f0a2`
and tracked manifest byte SHA-256
`48b94d286f50a33f9cb9095e05655f6eba2d4ae712c1adb99f033ac6162339e4`.
The formal marker byte SHA-256 is
`dd2c63801c44d266428efa495b6cf872665980a520ea40c21be0ac52045dc07a`.
Catalog, formative manifest, learning manifest and App pointer byte SHA-256
remain `4ac9e223be27316aa5324ab5c9b474e378f61ec703ac9140b590e1a42c3c89d0`,
`1307286d4dd9f1e687553a30c4f87d5403fe237cac56727400233abfac36d334`,
`2a6824db45cac416c4aee3a95ce83aba5be393b6a94034799d6d18cb56f9f998`
and `a5ccd441deb7b0111517c9c1ec597b98e16a6dac789bd32bff3daa96960285a7`.
No focused green result by itself authorizes a deployment, migration,
Queue/config mutation, User Center write or production claim.

For the local Node 22 full-suite command, `/private/tmp/yw-node22-exact-bin/node`
was a task-local symlink to
`/usr/local/libexec/bdfz-release/node-v22.21.1`; this PATH pin is required
because invoking the npm CLI with Node 22 alone does not pin the `node` binary
used by child scripts. CI obtains the same child-process guarantee from
`actions/setup-node`.

## 2026-08-14 dedicated precheck project correction

Run `npm run test:preview-bindings` and
`npm run check:precheck-binding-types` on exact Node 24.18.0 and 22.21.1. They
must prove that the primary project preview has only the preview D1 and no UC
service or Queue, while `wrangler.precheck.toml` names only
`yuwen-course-foundation-precheck` and declares the exact preview D1 plus
`bdfz-user-center#YuwenEvidenceIdentity`, with no Queue, production D1 or
production environment. Production keeps its exact D1, service and v2 Queue.
The external executor must additionally prove the dedicated project is Direct
Upload with zero history/no custom domain before its sole exact deployment,
and separately apply/read back preview D1 migration 0005 before Queue/RPC
precheck. Pull-request CI runs the resulting 44-test focused matrix on each
exact Node authority.

## 2026-08-13 B6/B10/B12 closeout additions

Run the current learning-manifest and evidence-contract tests on exact Node
24.18.0 and Node 22.21.1. The complete `precontent:check` remains the source
gate:

```zsh
npm run test:learning-manifest
npm run test:evidence-contract
npm run precontent:check
git diff --check
```

Every pull request also runs the read-only
`.github/workflows/learning-contract-ci.yml` matrix on exact Node 24.18.0 and
22.21.1. Both focused 41-test jobs and both deterministic formal Web artifact
manifest checks must pass. This CI does not replace the full dual-Node
`precontent:check` and contains no deployment or production-data authority.

The focused checks must prove that the generic interaction route and browser
bridge preserve classical prerequisite code, HTTP status and timed-retry
metadata; a real catalog/formative cache-skew route performs one reload and
returns 409 with no APIS/ledger/outbox/Queue write; and a learning-health
request supplies one `waitUntil` drain that monotonically advances a pending
central receipt. Separately resolve canonical User Center from the UC
strong-workspace audit pin, run its `tests/growth-source-health.test.mjs`, and
inspect its `scheduled()` handler to prove the hourly probe calls the exact YW
learning-health URL. Do not substitute a stale or guessed SHA. No Pages Cron is
permitted.

## 2026-08-13 scoring-correctness candidate

Run the full source and release-artifact prerequisites with exact Node 24.18.0
and repeat them with Node 22.21.1 compatibility authority:

```zsh
npm run precontent:check
node --test scripts/test_study_guide_assessment.mjs \
  scripts/test_study_guide_catalog.mjs \
  scripts/test_study_guide_frontend.mjs \
  scripts/test_learning_evidence_contract.mjs \
  scripts/test_local_progress_truthfulness.mjs \
  scripts/test_preview_binding_isolation.mjs \
  scripts/test_formative_mastery_projection.mjs
git diff --check
```

The gate must prove:

- every active deterministic choice prompt contains its source-visible A and D
  option boundaries; the eight restored PDF prompts retain exact reviewed
  options and source answer order;
- answer explanations containing A--D letters cannot change the selected
  answer; circled answers, quote/colon/bracket punctuation, dash/ellipsis and
  sentence segmentation are deterministic;
- a real score zero remains zero; missing/non-numeric score or incomplete AI
  feedback throws and cannot become 60 or a pass;
- catalog digest, formative digest and semantic revision are checked before
  reservation/write, with one coherent cache reload and fail-closed drift;
- `assertLearningSubmissionAllowed` precedes APIS, creates a durable slot and
  exact mutation-bound reservation, and a duplicate/failed evaluator cannot
  create a second charge or evidence row; the browser reuses the same mutation
  ID until a terminal durable receipt;
- `/api/interaction-check` rejects anonymous identity; `/api/learning-check`
  returns 410; APIS has a 20-second abort signal; frontend error handling keeps
  failed/unavailable evaluation out of completion;
- preview lacks production data bindings and never falls back to a cached or
  public-HTTP production identity.

Completed evidence on 2026-08-13: focused matrix 61/61 on Node 24.18.0 and
61/61 on Node 22.21.1; complete `precontent:check` passed on both runtimes;
Reading API 70/70; native-content 22/22; release-site 5/5. The run used the
current read-only course exports and generated ignored page cache. It made no
remote write. Production acceptance still requires a clean exact commit,
formal Web-only artifact with stable App pointer, external-executor backup and
rollback authority, UC/YW migration and Queue readback, then an authenticated
environment-account evidence-to-My A--F check.

## 2026-08-12 e310/v2 delivery-recovery candidate

Run the current source contract on exact Node 24.18.0 and Node 22.21.1:

```zsh
/Users/ylsuen/.nvm/versions/node/v24.18.0/bin/node --test scripts/test_learning_evidence_contract.mjs
/usr/local/libexec/bdfz-release/node-v22.21.1 --test scripts/test_learning_evidence_contract.mjs
node scripts/test_reading_api.mjs
git diff --check
```

The gate must prove all of the following:

- current formal events use e310/v2 and historical b530/v1 rows are neither
  rewritten nor sent to the v2 Queue;
- migration 0005 is additive, reading health requires nine key indexes and
  reports `reading-schema-v5` only after the recovery index exists;
- SQLite time comparison makes a 15-minute-old ISO attempt retryable while a
  fresh attempt, a centrally settled attempt, and every v1 row stay excluded;
- Queue transport `enqueued` is not delivery proof. An exact User Center
  receipt settles accepted/quarantined attempts, pending mapping suppresses
  transport resend while continuing central polling, and a later accepted
  or quarantined receipt advances the same source attempt without another
  delivery; the D1 update compares the previously read disposition and a stale
  poll is accepted only when `changes=1`, so it cannot overwrite a terminal
  concurrent result;
- health and the normal interaction route invoke bounded recovery without a
  Pages Cron Trigger, and health exposes only aggregate recovery counts;
- malformed, wrong-site, wrong-contract, duplicate or unsolicited central
  receipts cannot settle an outbox row;
- an unavailable Queue or User Center does not delete the source envelope,
  award credit, create a snapshot, or synthesize F.

Before any paired deployment, read the YW D1 migration ledger and v1 Queue/DLQ
backlog. Apply 0005 before the Pages version. Production remains blocked if
v1 has a non-empty or unreconciled source outbox without an executable legacy
replay path, or if the User Center v2 main/DLQ consumers and central receipt
RPC are not live.

## 2026-08-12 A+—F / Android candidate additions

`npm run test:vocab-progress` must additionally derive, without a client-side
book allowlist, 723 active questions = 382 formal manifest matches + 341 local
practice questions. It must prove that local practice follows the same
two-correct-after-error mastery interaction while retaining `synced=false` and
`formalEvidence=false`, and that a formal resource absent from the active index
fails closed.

Run with Node 24.18.0 before the existing release gate:

```zsh
npm run test:evidence-contract
npm run test:reading-identity
npm run test:native-content
```

The run must prove that the resolved annual A+ contract is b530/v1 only for
2025–26 and e310/v2 for 2026–27; formative v2 envelopes stay non-scoring;
learning health returns an
exact active A+ receipt; malformed/wrong-client/disabled native authority fails
closed; dual credentials cannot cross users; native output contains 189
student lessons while all 191 source reader documents remain byte-validated;
and no browser or App field can claim score, correctness or eligibility.
`npm run test:local-progress` must additionally prove that a historical
anonymous result remains incomplete and a new anonymous evidence status is
rejected; only a recognized authenticated evidence status can advance a
checkpoint.

For the classical native projection, `npm run test:native-content` must also
prove that the Web index's 30 lessons / 102 paragraphs are projected exactly,
that every catalog path resolves to one receipt-bound asset, and that
`textVersionId`, `textDigest`, UTF-16 offsets, paragraph keys and text bytes do
not drift. The immutable object count must include one native first-read index
plus all 30 lesson assets. This test is development evidence only; a stable
promotion still requires clean exact source, a Pages deployment UUID,
publication time, current content audit and compatible App disposition.

## 2026-08-11 Web reading release gate

This is the retained 2026-08-11 Web-only release receipt. The 2026-08-15 live
rollback paragraph above supersedes its former current-production claim. It
does not authorize App or User Center work.

### Required commands

```zsh
cd /Users/ylsuen/CF/yuwen-course
PATH=/Users/ylsuen/.nvm/versions/node/v24.18.0/bin:$PATH npm ci
YW_STUDY_GUIDE_SOURCE_DIR=/Users/ylsuen/CF/output/pdf_study_guides_web \
  PATH=/Users/ylsuen/.nvm/versions/node/v24.18.0/bin:/opt/homebrew/bin:$PATH \
  npm run verify:study-guide-sources
PATH=/Users/ylsuen/.nvm/versions/node/v24.18.0/bin:$PATH npm run precontent:check
PATH=/Users/ylsuen/.nvm/versions/node/v24.18.0/bin:$PATH npm run qa:web-polish
PATH=/Users/ylsuen/.nvm/versions/node/v24.18.0/bin:$PATH npm run qa:chat-no-autoload
PATH=/Users/ylsuen/.nvm/versions/node/v24.18.0/bin:$PATH npm run qa:embed-playback
PATH=/Users/ylsuen/.nvm/versions/node/v24.18.0/bin:$PATH npm run build:release-site
PATH=/Users/ylsuen/.nvm/versions/node/v24.18.0/bin:$PATH npm run check:release-site
PATH=/Users/ylsuen/.nvm/versions/node/v24.18.0/bin:$PATH npm run build:artifact-manifest
PATH=/Users/ylsuen/.nvm/versions/node/v24.18.0/bin:$PATH npm run check:artifact-manifest
git diff --check
```

The current run must prove:

- 189 student-visible lesson units render the merged masthead/orientation/
  portrait layout at 1440, 1024 and 390 CSS pixels without horizontal overflow;
  the source manifest retains 191 records including two hidden system records,
  and the local-step disclosure begins collapsed beside the portrait;
- 30 classical lessons / 102 first-read paragraphs remain source-bound; after
  first-read submission, the submitted no-note text, source-bound learning tip
  and annotated canonical text remain visible together. The 30 tips derive
  deterministically from 18 exact source groups. Inline annotations begin
  hidden and type once; the server and browser both block vocabulary until the
  stable `annotated_reading` acknowledgment succeeds;
- all 2,933 annotation references across 191 reader documents bind to the
  preceding visible character or Latin word and render as numeric superscript
  buttons. Classical and modern text must have zero orphan marker, zero
  visible `注／註` word button and zero horizontal overflow at 1440/1024/390;
- all 189 student lessons have a unique, text-anchored, mode-specific structure
  prompt; author impersonation and `我是／抽掉／換序／最關鍵的材料` templates
  must be rejected. The Dickens prompt must name the adult retrospective,
  child-labour experience and first-person narrative perspective;
- all nine WeChat sources project to exact `wx.bdfz.net` archives; direct
  `mp.weixin.qq.com` and `bdfz.yuque.com` student targets are zero;
- every supported embed can expand and shrink, with Escape/focus restoration;
  after the exact deletion set, the audited 351 page resources resolve to 334
  screenshots + 11 direct presentations + 6 stopped embeds, all six due to
  an external condition. The screenshots include 49 reviewed authenticated
  pages and deduplicate to 328 WebP assets / 12,795,016 logical bytes;
- preview targets are exactly 538 / 118 redirects / 75 hosts with digest
  `sha256:887931515ae55b93d579a6892b5146ef68466c1e2c3ae5ed0c8022e00f2e84b7`;
  arbitrary same-host paths and unregistered redirects remain 403;
- screenshot manifest SHA-256 is
  `30193e813611eb5e9ec09e2da99f81e5bca50597ed8b16839097eb70458333af`;
  confirmed-dead Bilibili `BV1Zg4y1H7fK` is absent from the Web projection,
  preview registry and screenshot manifest. E01 and all 16 permanent/remove
  resources and exact empty Sichuan gazetteer `content_30068` page are likewise
  absent and are not counted among the six; `content_22151` remains;
- all 99 exact Google Sites targets use reviewed screenshot-first rendering;
  17 BDFZ exact roots load the same real remote URL in their card and full-page
  view. `xue.bdfz.net` has zero student resource, target, redirect, host,
  screenshot, resolved or blocked record, and its preview requests return 403;
- safe QX figure fragments load the exact remote profile; all 17 Wikisource
  targets are screenshot-first; all five registered YouTube resources expose
  click-to-play `youtube-nocookie.com` players and fullscreen playback;
- `先找方向` is absent while `起始` remains. With no saved preference the
  reader scale is 126%; saved local/remote values win. Chat remains
  `about:blank`, hidden and request-free for at least 12 seconds before an
  explicit `進入同讀` click, without scroll or focus movement;
- 文體、書目、星圖、己身 and 登入 all open a new tab with
  `noopener noreferrer`; the original lesson URL remains unchanged;
- the study-guide catalog is 241 / 191 active / 50 inactive and the formative
  manifest is 1,019 / 115 lessons / 50 tombstones; A+/A--F bytes and behavior
  do not change;
- live pre-deploy readback requires Reading 200 (`reading-schema-v4`). Reading
  health checks four tables/eight key indexes; a separate
  read-only `sqlite_schema` query confirms all four tables/ten named indexes
  from migration 0004. D1 migrations 0001--0004 are present exactly once and
  must not be replayed during this Web deployment. Learning-health is recorded
  as compatibility evidence but, while User Center follow-up is deliberately
  paused, it does not gate these Web-only presentation changes and must not be
  used to claim an outage in three-word submission, vocabulary progress or the
  durable evidence queue.

The completed local precontent run reports: preview targets 6/6, resource and
screenshot policy 13/13, authenticated importer 5/5,
learning manifest 9/9, study-guide catalog 3/3, assessment 9/9, frontend 5/5,
evidence 28/28, formative projection 4/4, shared state 13/13 plus real browser,
Reading API 70/70, native candidate 22/22 and release-site 5/5. Layout
acceptance passed 25/25, the dedicated Web-polish browser matrix passed 32/32,
the embed-playback matrix passed 16/16, and the live independent-load sweep
passed 189/189 lessons plus 30/30 aggregate checks. The `lesson-1534` browser flow rendered 98 initially hidden notes,
retained type-once/collapse behavior, blocked vocabulary before the receipt and
unlocked it only after the exact stable mutation succeeded.

The formal staging/check and artifact-manifest check pass at 1,223 files. The
release marker is `formal-stable`, 1,222 projected files, projected aggregate
`d59d20fdb8a466e4d4589a710184b7bb7d66388ccdbe8aa00438a497bbe06117`,
marker SHA-256
`0359d7faba41852c07e5658461eb70ef42aa44482b97b1a9aac3188a3e4966d0`
and artifact-manifest aggregate
`10144eec24d73e63fe51f271b6d200cf193e504a658f5738c4e258f42053e8be`
(164,368,564 bytes).
It includes the unchanged stable App release only (278 exact paths) and no new
App candidate or pointer.

Production deployment
`18213286-37d1-4b71-80b6-78e8b986ed3d` was published from clean GitHub `main`
carrier commit `a97eba7589ed6afa7df30ba4f37f2241a22d90d0` at
2026-08-11T16:25:28.112875Z. The atomic deployment URL and `yw.bdfz.net` return the
same marker SHA-256 above. Live Reading and compound learning health are 200;
the online source/taxonomy counts are 191/189, preview registry is 538/118/75,
and the screenshot manifest is 351/334/11/6. All seven fetched production
authorities match the carrier byte-for-byte. The production 390-pixel,
read-only browser smoke confirms an expanding numeric note with content, no
horizontal overflow, five safe new-tab links and zero `xue.bdfz.net` DOM
references; the complete exact-carrier Web-polish matrix passed 32/32.
The live atlas/progress denominator is 189; both hidden direct hashes fall back
without requesting their data, and valid explicit lesson hashes remain stable.
Stable Pages rollback is `8da16237-ac91-47e1-afe2-7843e2d4c8a4`; D1 and the
App pointer remain in place.

### Deliberate App pause

`npm run check:native-content:deploy-sync` remains fail-closed because this Web
graph has no new App audit receipt. That result is expected and must not be
rewritten as a pass. Per the current user direction, keep the existing App
stable pointer byte-identical, mint no App receipt/schema, and publish only the
checksum-verified `formal-stable` Web artifact from a committed clean tree.
Rollback is the stable Pages deployment
`8da16237-ac91-47e1-afe2-7843e2d4c8a4`; D1 is preserved.

## 2026-08-09 self-study-loop candidate gate (historical)

This was the executable acceptance standard for the 2026-08-09 candidate. It
is retained for provenance and does not supersede the current Web-only release
standard above.

### Source/content checks

```zsh
cd /Users/ylsuen/CF/yuwen-course
npm ci
npm run verify:study-guide-sources
npm run precontent:check
git diff --check
```

Required readback:

- five PDF and five extraction receipts match actual bytes and page counts;
- 30 classical assets declare `yw-classical-first-read-v1`, numeric version 1,
  UTF-16 offsets, no punctuation or annotation, and exact reader-text binding;
- catalog `yw-study-guides-f4c48caf4acbabb4` has 241 items / 193 active / 48
  inactive; every missing source answer is labelled `Codex 參考答案`, every
  open reference is non-unique, and review-required items cannot self-complete;
- formative `yw-formative-52b574175221646f` has 1,021 active items / 115 lessons
  / 48 tombstones and validates its exact active-set hashes, semantic history,
  authority and formal-manifest binding;
- reader projection remains 191 documents and the media ledger remains 165
  objects / 28,066,373 bytes with zero unreviewed anomaly;
- preview network policy rejects unregistered redirects, IP literals and active
  MIME, strips upstream CORS/cookies/frame controls, and the workerd
  HTMLRewriter test passes;
- isolated blocked native-content candidate builds are byte-identical, report
  the stale audit receipt as `review-required`, and carry the exact
  `canonical_graph_review_required` blocker. The test must not create or move
  `latest-stable.json`. A later App import additionally requires a new
  independent three-build audit receipt bound to the clean Web carrier; this
  Web-only candidate deliberately does not mint that receipt early.

### Browser acceptance

At desktop width and 390x844, verify at least one modern lesson and
`lesson-1534` / `lesson-1535`:

1. a logged-out classical first read does not retain guesses on a shared
   browser or unlock later stages;
2. an authenticated student can add three non-overlapping marks by pointer and
   keyboard, submit a summary, reload the immutable submitted state, then mark
   each difficulty resolved during close reading;
3. `注` stays inline, types once, opens with a unique occurrence ID, closes on
   a second click or blank-text click and respects reduced motion;
4. wrong -> correct -> correct vocabulary follows the server status and does
   not unlock early;
5. study-guide objective answers are graded by source logic; an open answer
   shows the explicit `Codex 參考答案` rubric and only the server result can mark
   completion;
6. classical pages have no duplicate `通讀正文`/`字句之改`; a modern page still
   has the three-word response and `字句之改`;
7. materials/slides/migration previews are expanded, unsupported items show an
   explicit fallback, there is no duplicate `此刻同讀`, and cross-book lookup
   targets exactly `https://xue.bdfz.net/`;
8. the interest slider distinguishes `已同步` from `本機已存／尚未同步`; local
   step progress is owner-scoped and never labelled as authoritative mastery;
9. `star.html` retains the three-word constellation and, when authenticated
   formative data is available, shows lesson/competency dynamic percentages;
   401/503 is unavailable rather than zero.

Close every task-owned browser/server and run the workspace orphan-browser
dry-run before closeout.

### Paired production gate

Production is prohibited until all items below are evidenced together:

1. independently reviewed and release-authorized User Center consumer deployed;
2. `GET /api/learning/health` returns the exact compound formal + registry +
   formative receipt and explicitly says it cannot affect scoring/A+;
3. authenticated formative read returns 200, unauthenticated returns 401, and
   manifest/ledger unavailability returns 503 without displaying 0%;
4. a fresh D1 export/bookmark exists, remote duplicate preflight is zero,
   migration 0004 applies additively, and `/api/reading/health` reads back every
   required table/index;
5. authenticated first-read and study-guide mutations, exact idempotent replay,
   User Center projection readback and Queue/outbox status all match without
   creating synthetic student progress;
6. a checksum-fixed preview deployment passes desktop/mobile/API/dependency and
   custom-domain immutable-object readback;
7. a clean formal Web carrier commit, production Pages UUID, created time,
   artifact manifest, immediate rollback and D1 no-loss rollback are recorded;
8. the native content receipt has an explicit App disposition. App import,
   signing and device acceptance remain a later task and do not begin from a
   preview or blocked receipt.

If User Center authority remains blocked or live learning health remains 503,
stop after the reviewed candidate. Do not deploy YW, apply D1 or hand a false
compatibility receipt to the App task.

### Latest local result (2026-08-09)

`PATH=/Users/ylsuen/.nvm/versions/node/v22.21.1/bin:$PATH npm run
prepare:preview-artifact` passed in full. Key executable results:

```text
classical first-read:       30 lessons / 102 paragraphs
study-guide catalog:        241 total / 193 active / 48 inactive
learning manifest:          9 / 9
study-guide builder:        3 / 3
study-guide assessment:     6 / 6
study-guide frontend:       3 / 3
evidence contract:          12 / 12
formative projection:       4 / 4
formative star UI:          2 / 2
reading identity:           4 / 4
local progress truth:       6 / 6
shared state:               13 / 13 + real-browser contract
Reading API + local D1:     65 / 65
native candidate:           21 / 21
release-site staging:       4 / 4
preview files:              614
preview aggregate SHA-256:  9da4db40dacb2b6a5026b14b4db416c98308d0b461600316f9f2b0941a859dcf
preview marker SHA-256:     de0f4ce971751ecf7d5a5390e1242005ea848abd6cf641b9feb9a172e883f69c
```

The staged Gitleaks pass reported only 213 `generic-api-key` pattern matches;
all 213 are the public schema field `itemKey` in the study-guide catalog and
formative manifest, with zero other match prefix. Native raw/decoded privacy
tests also passed. This classification must be repeated after any catalog
schema change.

The current native semantic candidate is `yw-9fad79d2acd5ab37986712da` /
`sha256:9fad79d2acd5ab37986712dab20277c2a8685066b4a637bc5adce709936d131a`.
It is correctly `blocked`: the tracked audit receipt still approves the prior
stable graph, `check:native-content:deploy-sync` rejects this candidate, and
`latest-stable.json` remains SHA-256
`a5ccd441deb7b0111517c9c1ec597b98e16a6dac789bd32bff3daa96960285a7`.
No production Pages deployment, D1 migration, User Center deployment or App
mutation is part of this local result.

### Pages preview binding isolation receipt (2026-08-09)

- clean pushed source: `918e66e2473ee298ce3af5f23598de9d3e659095`;
- primary isolated preview: `577ad2a8-b2eb-458f-8145-4791ec7cd5f5`, created
  `2026-08-09T05:22:52.419368Z`, URL
  `https://577ad2a8.yuwen-course.pages.dev`;
- all eight surviving preview deployments use that exact carrier and bind only
  D1 `39ed36d9-b3f3-40fd-933a-9a68a4066302`; project preview configuration has
  no service or Queue producer;
- production remained deployment `20be2885-5494-4b98-a130-af022c1a389b`,
  carrier `e87c697119d7d75d01def58ff781524f73bb3ff9`, D1
  `99c541e7-e70b-4584-b939-7e88a6dd68c5`, the named User Center service and
  production evidence Queue;
- 12 historical production-bound preview deployments and one wrong-carrier
  metadata deployment were deleted after every historical branch received an
  isolated successor;
- final old-host readback: ten 404 and two 302 to exact-host Access quarantine
  `5d768360-2dd8-458d-a743-182c9ced3b22` /
  `eaa5cef6-e21f-4182-b9ce-15d000136fee`. Two rounds at least 60 seconds apart
  across both observed Anycast addresses returned no old Worker;
- preview smoke: Reading health 200 with schema v4, learning health 503 as
  expected without User Center; production smoke remained Reading 200 and the
  pre-existing learning-health 503.

Private pre-change Pages project/deployment JSON is mode 0600 under
`/Users/ylsuen/CF/backups/yuwen-course/2026-08-09-production-rollout`. The
sanitized preview-isolation receipt is 3,465 bytes with SHA-256
`709b7b5a5d17c7cb15b319d1a01e8fbdce2de945a0b0b157d3272017765104f6`.
The exact pre-change SHA-256 values are:

```text
project:  eb0dc6ae3c662e04fb46bdabcb0b795ac720e9709c77ba532d9b6cc100906110
page 1:  36c62697bee008095836479c4e2d0df1843bafd687978243d65707ae4fbf3752
page 2:  2a63157003487680aff56bc65c4c87f6a1079ad9e1fb00099ce4fc264f65fbff
page 3:  6702c67884c2045ab49bd1d48c7c73a1b6accdb13a5948ea79e815e68fd38fd1
page 4:  4bdc535450074724f385be9372de0ecda768c08284cc0e99b25010c25839c9b2
```

Deleted atomic preview URLs cannot be restored directly, but all branch
aliases can be redeployed from the clean carrier. The custom domain and
production deployment were never moved.

## 2026-07-30 Web/native synchronized production release

This synchronized source graph supersedes older content-count markers below.
The complete release transaction is published in production as Pages deployment
`20be2885-5494-4b98-a130-af022c1a389b` from source
`e87c697119d7d75d01def58ff781524f73bb3ff9`; its immediate Pages rollback is
`ada922c5-62e7-46cc-bcd7-7e97dddcc522`.

- five books, 191 lessons and 1,153 posts;
- reader projection: 2,932 unique annotations / 2,933 references;
- every annotation reference is canonically renumbered by first occurrence;
  BBCode color tokens and raw reuse labels such as `[3:1]` are forbidden by
  `npm run check:content-projection`;
- media receipts: 165 unique HTTPS objects / 167 visible references, zero
  anomalies; ledger SHA-256
  `5487243dd8d14d65dfadc20ed544a999aaa318fc20c291462ea62c69e1eff320`;
- reader semantic digest:
  `sha256:d63a2d1ff847318cda6ec87791afe01c5051a102bf73d7e373901c4d6497f9e0`;
- vocabulary: 723 active questions across 77 classical/poetry lessons,
  344 exact eligibility tombstones across 56 nonclassical lessons, 35 retained
  quality tombstones and zero reviewed exceptions;
- learning manifest: `yw-7abfb37143d876fd` / 901 items;
- current derived native semantic digest:
  `sha256:3e77f0f7ffa5d042a6d06763789858ea89f5194eb4e157e80ddb95f2ac8b5543`;
- compatible `contentVersion=yw-3e77f0f7ffa5d042a6d06763`,
  `releaseReceiptId=sha256-ab04efc472f2346bccf4f7e7eb77f35ac75456a7a3af98d426b385a74524bb06`;
- exact release gate: source
  `fd7a482ac88e6baa0da79d69b2fea88c7b00d195`, preview deployment
  `54232d7c-7e6c-4a14-a6b8-d6543efc1134`, publication time
  `2026-07-30T06:18:00.123175Z`, `sourceClean=true` and
  `appDisposition=compatible-and-synced`;
- three isolated compatible builds were byte-identical at 278 files /
  33,143,783 bytes and canonical aggregate
  `7816d7b31aedafd379b13668d58e05099a3c2c458523a3c50c72dd699a9031a8`;
- stable pointer / manifest / core receipts are respectively
  `a5ccd441deb7b0111517c9c1ec597b98e16a6dac789bd32bff3daa96960285a7`,
  `a866d2a2b89877a8d511622a3f736481401cb48b0da88fc39c1c50cead7fe1c3`
  and
  `6cc5e1205de54012141a779a848939f54bd4be1370f2d81f1c7397ec90cfb823`.

Two historical old-stable App-content receipts still contain a malformed AI
Studio state payload and remain forbidden. Formal staging now parses JSON
string values, includes only the exact release referenced by `latest-stable`,
and excludes every historical release. The previously documented
`sha256-041b…` value has no reproducible pointer or release tree and must never
be used.

Release-tree acceptance is executable and mode-bound:

- `npm run test:release-site` must prove that escaped JSON payloads are caught
  only after parsing, unsafe immutable bytes fail closed, receipt drift fails,
  and historical releases/candidates cannot enter formal staging;
- `npm run prepare:preview-artifact` must produce a
  `releaseKind=preview-web-only` marker with zero native allowlist entries and
  no `app-content/` directory;
- `npm run build:release-site && npm run check:release-site` must produce and
  verify `releaseKind=formal-stable`, one exact stable prefix, a byte/SHA/path
  allowlist, and no historical or candidate path;
- a preview marker is never acceptable to the production deploy command, and a
  formal marker cannot be built from unsafe old stable bytes.

`npm run check:native-content:deploy-sync`, `npm run test:release-site` and the
formal build/check passed on 2026-07-30. The formal artifact has 852 files, 278
exact App-content paths and aggregate
`c79cad29e7ca32f2fc11391f7c3e8029f7d1c279eef5857efbfdbef90f9740f1`;
candidate and historical release paths are absent. The complete
`release:check`, artifact-manifest update, Pages deployment and public
hash/content-type readback passed for this exact release. Future releases must
repeat every gate; this record does not authorize reusing an earlier receipt.

Web publication must record exactly one App disposition and must publish/read
back immutable App content objects before moving `latest-stable`. The binary
release is separate: select registered Phone A `c5467d2b` or Phone B
`6393cccf`, then make one byte-identical signed APK pass prior-version
same-package upgrade plus user/session/outbox/content persistence on that
phone. The same phone must also pass a reversible expanded-layout check with
App-observed `AdaptiveWidth.Expanded`, `maxWidth >= 840dp`, effective smallest
width, explicit 200% font, portrait and landscape, followed by itemized
restoration of its exact size, density, rotation, font, proxy and keep-awake
baseline. The second phone is supplemental, no separate physical tablet is a
current blocker, and emulator/device-cloud evidence cannot replace the
selected phone.

The older `yw-b530d57cb873ed49` / 1,156-item clause in item 2 below is retained
only as historical production evidence and is not the current source-candidate
contract.

> 2026-07-26 evidence-loop addendum: the current source contract is governed by
> `/Users/ylsuen/CF/runbooks/bdfz_learning_evidence_integration_standard.md`.
> The source of truth now also includes migration
> `0003_learning_evidence_loop_v1.sql`, registry
> `site/data/interaction-definitions.json`, raw ledger
> `learning_interactions`, evaluation table `learning_evaluations`, and
> `evidence_outbox`. Production bindings are the named service
> `USER_CENTER_EVIDENCE` and dedicated Queue `LEARNING_EVIDENCE_QUEUE`.
> `npm run test:reading` has 30 assertions, including server-side answer-key
> correctness, rejection of browser correctness, rejection of raw/unknown
> telemetry and idempotent semantic events. `npm run test:evidence-contract`
> additionally builds an `evaluation` envelope from the YW source and validates
> it against the current User Center consumer registry.

## 2026-07-30 production readback (historical)

- production Pages deployment:
  `20be2885-5494-4b98-a130-af022c1a389b`
  (`https://20be2885.yuwen-course.pages.dev`);
- deployed source:
  `e87c697119d7d75d01def58ff781524f73bb3ff9`;
- immediate rollback:
  `ada922c5-62e7-46cc-bcd7-7e97dddcc522`;
- `node scripts/verify_deployed_native_content.mjs https://yw.bdfz.net/`
  passed again on 2026-07-30 for
  `contentVersion=yw-3e77f0f7ffa5d042a6d06763`,
  semantic digest
  `sha256:3e77f0f7ffa5d042a6d06763789858ea89f5194eb4e157e80ddb95f2ac8b5543`
  and release receipt
  `sha256-ab04efc472f2346bccf4f7e7eb77f35ac75456a7a3af98d426b385a74524bb06`;
- public readback verified all 276 immutable objects, five approved slide
  PDFs, 70 explicit missing-deck entries, five representative textbook images
  and healthy Reading API state;
- no D1 migration or data mutation was part of this documentation correction,
  and no additional Cloudflare paid product was enabled;
- this is a Web/App content compatibility release. It does not claim a new
  signed Android binary, installation, in-place upgrade or native authenticated
  data-loop acceptance.

## 2026-07-28 release override (historical)

The following values and eligibility rules supersede every older “current”
marker retained below as historical release evidence:

- production Pages deployment:
  `33725793-42fa-437e-ab6d-bc712549e633`
  (`https://33725793.yuwen-course.pages.dev`);
- immediate rollback:
  `8c3cb13e-a954-4f79-a342-f072b0a950b4`;
- D1 migration state is unchanged; never drop or rewrite the evidence tables as
  a Pages rollback;
- artifact manifest: 850 files, aggregate
  `acb2daaadc5cfe358f6ccbc94798a68be5812ab31519f867c02f75be93fca491`;
- release gates: learning manifest `8 / 8`, source contract `8 / 8`, local
  Pages + D1 integration `37 / 37`, and complete `release:check` passed;
- AI completion requires the server-normalized `score >= 60` and correctness
  `passed`; vocabulary completion requires the source-owned `mastered` verdict;
- failed or learning attempts remain in source ledgers and synchronize as
  `ineligible` evidence. They are connected records, not scoring completion;
- eight scoring submissions per authenticated user/resource are accepted in
  ten minutes and the ninth is `429`; exact mutation replay is idempotent and
  cross-resource mutation-id reuse is `409`;
- production D1 aggregate readback remained two interactions for one resource,
  two non-scoring evaluations and two delivered historical outbox rows. No
  student row, schema, attempt or completion was created or modified by this
  release verification.

## 2026-07-27 release override (historical)

The following values supersede older “current” markers retained later in this
file as historical release evidence:

- production Pages deployment:
  `46e3c87f-69a4-4fe4-99bd-9602ed8ffbba`
  (`https://46e3c87f.yuwen-course.pages.dev`);
- reviewed preview:
  `40994e9e-4631-46b6-926e-975c09440769`
  (`https://codex-yw-evaluation-nonscori.yuwen-course.pages.dev`);
- immediate rollback:
  `54117eae-2d7a-495a-b3b2-234855225cee`;
- pre-evidence-loop rollback:
  `18aa0c62-5f37-4a0f-9bdf-a145fc7e2279`;
- post-loop, pre-label-clarification rollback:
  `6686fe9e-2d14-4f40-9e3c-cb21c0d928de`;
- D1 migration `0003_learning_evidence_loop_v1.sql` is applied; it
  is additive and must not be destructively rolled back;
- artifact manifest: 850 files, aggregate
  `4f5e79d1589b05f003ab5cc4545b096282211e54de631636b53677cc0287bc85`;
- release gate: learning-manifest 8/8, source-to-consumer contract 2/2,
  reading API 30/30, and five approved self-hosted Slide Deck PDFs return
  `200 application/pdf`;
- production operations canary `7da148e9-8120-4a31-adf7-8e6e17053532`
  executed the real source module for `lessonOpened`: one source interaction,
  one evaluation and one outbox row historically labelled `delivered`; User
  Center consumed one matching `non_scoring` evidence row with three facets
  and zero queue backlog. Under the corrected producer semantics, Queue
  acceptance is labelled `enqueued`.
  The isolated canary Worker was deleted immediately after readback;
- authenticated browser canary
  `e3627e1f-c27b-476b-902f-a370d3ff7a02` used the locally stored Year-2028
  student credential exactly once: Passport login and User Center session
  succeeded, the same browser opened `lesson-1458`, YW stored and enqueued the
  event, and User Center consumed and displayed the matching lesson-title trace at 390x844
  and 1280x900. It remained `non_scoring` and created no pending outbox row;
- the browser writes only semantic interactions to the source endpoint.
  Source-side D1 records raw interactions and server results, then enqueues a
  privacy-minimized envelope through `bdfz-learning-evidence-yw-v2`.
  The old browser-to-User-Center progress/event wording in item 3 below is
  superseded and must not be reintroduced.
- `evaluation` is an explicitly non-scoring `self_report`; it remains visible
  in the process dossier but cannot affect a dimension or A+. Queue producer
  success is recorded as `enqueued`, not `delivered`, because the current
  one-way Queue has no per-message consumer receipt.

1. Source of truth：本機源码为 `/Users/ylsuen/CF/yuwen-course`；GitHub `ieduer/yuwen-course` branch `main`；當前發布記錄 commit `ab6c9eec08a4de9b9a28cb96cc9ebc0bcf92b42a`（內容基線 `185f781f39b302e34f052e3250755fe597c51987`，後續只補不可變資產 cache-bust）；Cloudflare Pages 项目 `yuwen-course`；发布目录 `site/`；生产域名 `https://yw.bdfz.net/`；Pages Worker 为 `site/_worker.js`。自 2026-07-14 起本站持有 D1 `yuwen-reading-db`（id `99c541e7-e70b-4584-b939-7e88a6dd68c5`，綁定 `READING_DB`，遷移在 `migrations/`）——**學生三詞提交與字詞作答是不可再生數據**。閱讀星圖規則文檔 `docs/READING_CONSTELLATION.md`、字詞題庫標準 `docs/VOCAB_STANDARD.md` 為對應子系統的單一事實源。
2. 健康探针：`curl -fsSI https://yw.bdfz.net/` 期望 `200`；`curl -fsS https://yw.bdfz.net/data/manifest.json | jq -e '(.blocks | length == 5) and (.totals.lessons == 191) and ([.lessons[] | select(.derivedFrom)] | length == 35)'`；`curl -fsS https://yw.bdfz.net/data/literary-taxonomy.json | jq -e '(.stats.lessons == 189) and (.stats.sourceBooks == 84) and (.stats.authors == 106) and ([.genres[] | select(.era and .year and .detail)] | length == 52) and ([.lessons[] | select((.authors | length) == 0 and .representativeFigure.id and .representativeFigure.role and (.visual == null))] | length == 65) and ((.lessons[] | select(.id == "lesson-1692-p4") | .authors[0].url) == "https://qx.bdfz.net/#shelley")'`；`curl -fsS https://yw.bdfz.net/api/reading/health | jq -e '.ok == true and .rulesVersion == "constellation-rules-v1"'`；匿名 `curl -s -o /dev/null -w '%{http_code}' https://yw.bdfz.net/api/reading/constellation` 期望 `401`（未登入不得出數據）；選必上中下「見效題目」清單以 `npm run check:learning-manifest && npm run test:learning-manifest` 為闸門，當前精確契約為 `yw-7abfb37143d876fd`／901 題／101 個教材條目／90% 門檻；關鍵互動以 `BASE_URL=https://yw.bdfz.net npm run verify:ui` 為生產闸門；星圖/字詞後端以 `npm run test:reading` 為合成數據闸門（25 斷言）；字詞題庫以 `npm run verify:vocab:release` 為發布內容闸門；完整靜態包以 `npm run check:artifact-manifest` 驗證逐檔 SHA-256。
3. 關鍵契約核查：HTML 必須加載 `https://my.bdfz.net/site-auth.js`，`siteKey` 為 `yw`；AI 僅由 Pages Worker按 `runbooks/gemini_gateway_policy.md` 調用 `https://apis.bdfz.net`，響應使用 `data.answer`。結構提問不得冒充課文作者，必須以篇名或正文可定位文字為錨點並追問該文類的具體視角、時序、場面、論證或語言效果；互動評閱至少要求兩處正文證據，不能只複述「抽掉／換序」模板。A+ 見效證據僅包括選必上中下教材目錄內真正有服務端核驗結果的題目：AI 互動成功返回或字詞選項提交後，才以 manifest 中的穩定 `resourceKey` 寫受信作答；篇目 `evaluation` 評價是 `self_report + none`，只記錄而不計分、不作 A+ 條件；匿名狀態不得載入清單、排隊或寫入；錯答仍是已記錄的嘗試，但只同步為 `ineligible`，不得視為計分完成，且 `score`／`correctness` 必須保留真值；正文通讀勾選、查詞、導航、頁面瀏覽和教師課堂進度不是 A+ 題目。`npm run test:evidence-contract` 必須用 YW 真實生產函數構造投影，經 Queue producer mock 後由當前 User Center consumer registry 接受，並證明舊 `self_report + a_plus_gate` 投影會 fail closed。`npm run verify:ui` 覆蓋 User Center 回灌、APIS 細讀判定、QX 作者鏈接、教材 PDF 預覽和本地進度記憶，並固定核查：必修上下 13 個合併項必須穩定生成 35 個獨立篇目且舊合併 ID 不在 manifest；三段標題必須是「起始／細讀／延伸」；篇名下不得再顯示文體籤；所有模式的「叩問作者／提出問題」必須同時位於見效與掌握度最後；篇目評價只顯示 `1–5` 且無對話框；手機端掌握度必須緊接見效、頂部工具必須收為單一完整標籤入口；目錄必須在側欄展開動畫完成後以真實滾動手勢到達末篇；能力遷移區標題只顯示「高考」且 390px 不得左側擠壓；106 位署名作者必須全部有 QX 深鏈與圖像資產，65 個無署名篇目必須有與單元／作品／時代直接相關的 QX 代表人物、明示 `role`／`reason`／`evidenceLessonIds` 且不得冒充作者；無可靠肖像者必須標明「姓名卡」，篇首禁止書封與教材頁；`lesson-1484` 的 15 個正文註詞必須全部進入詞級疏通；所有設有詞級疏通的篇目不得錯報無獨立註詞；全部文言篇目不得出現新詞創作；全 189 篇作者／代表人物肖像可見性及 390px 移動端橫向溢出必須逐篇巡檢。另保留選必上默認及上次篇目記憶、詞級逐詞查典和彩條、答對自動前進且錯答留在原題重試、通讀無 AI 對話、數字上標註釋無孤行且逐字展開、A+ 與專注閱讀彩條、`chat.bdfz.net` 課內嵌入、三圖內部同頁切換而其他鏈接新頁、文體／書目時代和關係資料、星圖 `0.56` 全貌尺度。閱讀星圖契約（2026-07-14 起）：頂欄必須含 `star.html` 入口；`/star.html` 渲染與交互直接復刻 `jc-atlas`；三詞提交必須冪等（同詞重排/繁簡變體不生新記錄）、換詞生成新版本並保留沿革；星點 id/seq 穩定，佈局只由冊別／教材篇序／詞形哈希推導；未登入 401＋克制空態，嚴禁偽造星點或推斷進度；有題庫課文的詞級疏通必須走逐題過關並記錄作答／重試／掌握（本地＋D1＋UC 事件 `vocab-quiz:<lessonId>`），無題庫課文回退註詞逐查。
4. 部署命令 + 禁止事项：先应用未落库迁移 `source ~/.secrets.env && ./node_modules/.bin/wrangler d1 migrations apply yuwen-reading-db --remote`，再从项目根目录运行 `npm run deploy`。不得从 `.cache/`、临时目录或旧镜像发布；不得为本站新增 Gemini 密钥；数据源未变时不得运行 `build:data`；修改不可变前端资产后必须提升 `index.html` / `star.html` 的查询版本。**严禁在生产 Pages 项目配置 `READING_TEST_SLUG`**（本地测试缝，见 READING_CONSTELLATION.md §2）；**严禁以 DROP TABLE 作为回滚手段**；重大变更前先 `wrangler d1 export yuwen-reading-db --remote` 备份。
5. 依賴回歸：本站依賴 `my.bdfz.net`、`apis.bdfz.net`、`nav.bdfz.net`、`img.bdfz.net`、`qx.bdfz.net`、`jc.bdfz.net`、`chat.bdfz.net`；改動若不觸碰樞紐契約，至少驗證這些入口仍可達並運行本站生產 UI 闸門。若修改會話或 APIS 契約，須按項目矩陣重掃扇出，並回歸 `bdfz-companion` App。
6. 备份 / 恢复：课文 JSON、taxonomy、字词题库 `site/data/vocab/`、前端与 Worker 均由 Git 工作树及 Pages 历史保存；本輪 pre-commit 完整 source archive 為 `/Users/ylsuen/CF/backups/yuwen-production-baseline-precommit-20260714/yuwen-course-source.tar.gz`，SHA-256 `a03b3b76f5e54db98a37a0103daa135afb183e7da96225a5a0a354f8b6faf7b7`。D1 `yuwen-reading-db` 为不可再生学生数据：重大变更前 `wrangler d1 export yuwen-reading-db --remote --output backups/yuwen-reading-<date>.sql` 备份，恢复用 `wrangler d1 execute yuwen-reading-db --remote --file <backup>`；恢复数据文件时从 Git/本机备份恢复后重新生成 taxonomy，并先在 `pages.dev` 预览验证。2026-07-26 已在私有限制权限目录保存远端导出；迁移 0003 为纯增量，代码回滚时保留新增表，不执行 DROP TABLE。
7. 回滾：先運行 `./node_modules/.bin/wrangler pages deployment list --project-name yuwen-course` 確認目標；在 Cloudflare Pages deployment history 將上一個已驗證 production deployment 重新部署。當前 production 為 `46e3c87f-69a4-4fe4-99bd-9602ed8ffbba`（`https://46e3c87f.yuwen-course.pages.dev`）；立即回滾錨點為 `54117eae-2d7a-495a-b3b2-234855225cee`，回滾會恢復舊 `evaluation=self_report+a_plus_gate` 來源宣告和舊的 `delivered` 佇列標籤，因此只在整站故障時使用。更早的完整回滾仍有 `6686fe9e-2d14-4f40-9e3c-cb21c0d928de` 和 pre-loop `18aa0c62-5f37-4a0f-9bdf-a145fc7e2279`；任何程式碼回滾都保留 additive D1 表與歷史行。回滾後重跑第 2、3、5 條。
8. 最後驗證人 / 日期：Codex / 2026-07-27 PDT。`release:check` 全通：作者 189/106/65/0 unsupported、字詞 134/134 課 1102 題、learning manifest 8/8、source-to-consumer contract 2/2、reading API 30/30、850-file artifact aggregate `4f5e79d1589b05f003ab5cc4545b096282211e54de631636b53677cc0287bc85`。Preview `40994e9e-4631-46b6-926e-975c09440769` 和 production `46e3c87f-69a4-4fe4-99bd-9602ed8ffbba` 的兩個任務資產雜湊與本地完全一致；custom domain registry 明示 `evaluation=self_report+none`，Worker 只把 Queue producer 成功標成 `enqueued`，health 通過，匿名 evaluation POST 為 401。Production D1 聚合讀回沒有既有 `evaluation` 行；沒有製造學生互動、改 D1、改 User Center、改共享 SDK 或改身份契約。

YW A+ manifest 与 User Center evaluator 现已固定为同一来源版本；2026–27
新 YW 事件只接受 `bdfz-learning-evidence-event-v2`、当前注册表、精确发布
lineage 和资源键；`bdfz-learning-evidence-v1` 仅由 User Center 的 2025–26
历史兼容适配器读取。匿名负向验证为 401。2026-07-27 先以明确标记的毕业测试映射验证后端源账本、Queue、中心消费者和幂等读回；随后用本机密钥文件中的 28 届学生账号一次通过希悦 Passport 与 User Center session，在同一浏览器打开 `lesson-1458`，完成 YW interaction / evaluation / outbox、Queue、User Center evidence / facets 与过程档案页面的全链路读回。该历史事件为 `lessonOpened`／`scoring_role=none`／`eligibility_status=non_scoring`，不会改变 A—F 分数；正文、账号、密码、Cookie 和 token 均未进入运维记录。

本地完整核查：

```zsh
cd /Users/ylsuen/CF/yuwen-course
npm run build:lessons
npm run build:taxonomy
npm run verify:authors
npx wrangler pages dev site --port 8799
# 另一个终端：
BASE_URL=http://127.0.0.1:8799 npm run verify:ui
```
Opening-before-school Queue acceptance must use the exact bounded transport
canary in the current User Center authority. The Web request remains the normal
authenticated `/api/learning/interactions` route; top-level `occurredAt` and
`academicYear` are rejected with 422. The accepted event must be the real
2025–26 `lessonOpened` audit shape, while D1 readback proves one accepted
delivery/evidence, an idempotent duplicate, and zero credit/snapshot/F delta.
At Beijing 2026-09-01 00:00 the exception expires, including delayed replay.
