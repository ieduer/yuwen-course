# `yw.bdfz.net` maintenance manual

Last reviewed: 2026-08-11 (America/Los_Angeles)

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
`8da16237-ac91-47e1-afe2-7843e2d4c8a4`, clean carrier source
`0ff5d5604ceefef92c99c07033f1e900d9edaaed`, deployed at
2026-08-11T15:43:46.808208Z. The atomic deployment URL and `yw.bdfz.net` return the
same formal marker SHA-256
`ef1856ce0622f2a0ceeada513465ab48ef5947a3a9150e5b5115785062ed9ad2`.
Remote readback confirms D1 migrations 0001--0004, `reading-schema-v4`, and
compound learning health 200. This Web release did not export, migrate or write
D1; it changed no User Center, Queue, App or scoring contract.

Live atomic/custom-domain byte checks match the carrier for the marker, app,
styles, prompt rules, preview registry, screenshot manifest and classical-tip
dataset. Production serves 191 source records / 189 student lessons, registry
538/118/75 and screenshot disposition 351/334/11/6. A read-only 390-pixel
browser smoke confirms numeric note expansion, no horizontal overflow, all five
top links opening safely in new tabs and no `xue.bdfz.net` DOM reference.

User direction pauses App/User Center follow-up while the Web content is
settled. Therefore `check:native-content:deploy-sync` is expected to reject the
new Web graph and is not reported as passing. Do not create a replacement App
receipt/schema or move `site/app-content/latest-stable.json`. Build the
production `formal-stable` artifact, verify its marker/checksum and deploy only
from a committed clean tree. Roll back Pages to
`a257af4c-78a1-483d-bc9e-57e34e1d2dbe` if live checks fail; preserve D1 and the
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
  `bdfz-learning-evidence-yw-v1`.

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
       -> GitHub Issues: optional lesson discussion integration

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
`bdfz-learning-evidence-yw-v1`. Preview therefore cannot authenticate or emit
student evidence and must return 401/503 on those routes. On 2026-08-09 all 12
preview deployments created before this split were superseded and deleted.
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

For the current Web-only release, keep the App pointer unchanged. From a fully
committed tree with empty `git status --porcelain`, build and check the
`formal-stable` `.release/site` tree and its artifact manifest, then deploy that
exact staged directory. Do not deploy raw `site/` or a `preview-web-only`
marker.

The paired Web/App procedure below applies only when App follow-up resumes:
publish immutable content objects before moving the App pointer, then deploy
the exact checksum-fixed Web artifact.

```zsh
PATH=/Users/ylsuen/.nvm/versions/node/v24.18.0/bin:$PATH npm run build:release-site
PATH=/Users/ylsuen/.nvm/versions/node/v24.18.0/bin:$PATH npm run check:release-site
PATH=/Users/ylsuen/.nvm/versions/node/v24.18.0/bin:$PATH npm run build:artifact-manifest
PATH=/Users/ylsuen/.nvm/versions/node/v24.18.0/bin:$PATH npm run check:artifact-manifest
bash /Users/ylsuen/CF/scripts/git-deploy-gate.sh
PATH=/Users/ylsuen/.nvm/versions/node/v24.18.0/bin:$PATH \
  ./node_modules/.bin/wrangler pages deploy .release/site \
  --project-name yuwen-course --branch main
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
