# `yw.bdfz.net` maintenance manual

Last reviewed: 2026-08-20 (America/Los_Angeles)

## 2026-08-20 lesson, reading-score and retired-write authority contract

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
  ignore browser title/block/excerpt/mode/genres before cache access or APIS.
  Unknown lessons return HTTP 400 with zero cache read/write and zero APIS
  request. Keep cache authority at
  `participation-matrix-v7-server-authority` or a later reviewed version so
  pre-hardening week-long entries cannot be reused.
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
- The 2026-08-20 Cloudflare readback still names production deployment
  `18213286-37d1-4b71-80b6-78e8b986ed3d` at source `a97eba7`. Do not infer that
  this Draft source correction is live. The live carrier/static-contract drift
  and unavailable `/api/learning/health` remain release blockers.
- Before any release, run the 2026-08-20 section of `docs/VERIFICATION.md` on
  exact Node 24.18.0 and 22.21.1. Formal release must stay blocked while
  `check:native-content:deploy-sync` reports that the canonical source graph
  lacks an approved audit receipt. Do not generate or approve that separately
  owned Web/App receipt as part of a server-authority patch.
- This is a `no-new-capability`, source-only correction with no schema,
  migration, Queue, binding, route or configuration change. Roll back source by
  reverting the exact candidate commit and rebuilding/checking
  `docs/baselines/site-artifact-manifest.json`; preserve D1 history. There is no
  production rollback action for this Draft because it performs no deployment.

## 2026-08-15 assessment tolerance and durable retry contract

- Keep objective grading source-owned in `site/study-guide-assessment.js`.
  Choice scanning occurs only in the answer lead after NFKC normalization and
  accepts adjacent/fullwidth A--D letters. For single choice, only an explicit
  prefix such as `我選 A` may disambiguate a later `B項…` explanation. An
  immediate list or alternative tail (`和 B`, `與 B`, `或 B`, `、B`) is still
  ambiguous and must be rejected; bare multi-letter input must not be reduced
  to the first letter. Circled-number
  references alone enable equivalent Arabic input. Punctuation/segmentation
  comparison uses the existing bounded traditional-to-simplified map and treats
  whitespace as a boundary. These grader changes do not mint or alter a task
  semantic revision.
- `studyGuideCompletedFor` must return false whenever the catalog status is not
  `available`. Catalog-load degradation may preserve textbook reading, but it
  must never unlock a study-guide checkpoint from an empty in-memory catalog.
- Guarded AI evaluation uses `learning_submission_slots.created_at` as a
  60-second lease without deleting a slot or changing schema. A new reservation
  is written with `.000Z`. If no matching `learning_interactions` row exists and
  the lease is stale, exactly one compare-and-swap may write `.001Z` and reuse
  the same `source_event_id`; `.001Z` is the durable once-only reclaim marker.
  Fresh duplicates return `learning_submission_in_progress`. A reclaimed slot
  may not be reclaimed again and remains counted until the original ten-minute
  window expires. Both `/api/reading/study-guide-attempt` and
  `/api/interaction-check` must call `assertLearningSubmissionAllowed` before
  APIS. The final ledger's unique keys resolve a late original/reclaim race to
  one interaction, evaluation, outbox row and Queue send.
- Student-facing in-progress text must state only that the previous submission
  is still being reviewed and that the same answer may be retried after the
  reported interval. Do not say that an answer is saved until a durable
  interaction exists.
- `central_receipted_at` has two deliberately distinct interpretations: while
  `central_disposition` is null or `pending_mapping`, it is the last durable
  receipt-readback poll lease; when a disposition is updated, it is the receipt
  update time. A timestamp by itself is never a receipt. Reconciliation selects
  only rows older than 15 minutes and exact-value CAS claims them in D1 before
  any User Center RPC. This is the cross-isolate cooldown authority; do not
  replace it with module-local state or reuse Queue `last_attempt_at`.
- Pull-request CI must retain `scripts/test_study_guide_assessment.mjs` beside
  the learning manifest, evidence and preview-isolation suites on exact Node
  24.18.0 and 22.21.1. The hostile evidence tests must keep the ten-way lease
  races, late-original race, second-expiry rejection and cross-isolate poll
  contention.
- This maintenance is a `no-new-capability` source-only change: existing Pages,
  D1, Queue and User Center service-binding contracts remain unchanged. Source
  rollback is to revert the exact candidate commit and regenerate/check the
  formal artifact manifest; there is no production rollback action because this
  task performs no deployment or data mutation.

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

This is the current operational disposition. Older paired Web/App and
2026-08-09 candidate sections remain as historical evidence, but their blocked
pre-migration and 503 statements no longer describe production.

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
