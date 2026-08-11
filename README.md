# yuwen-course

`yw.bdfz.net` is the student-centred learning matrix for the five senior-high Chinese textbooks. It combines lesson text and resources, author and literary-taxonomy links, vocabulary mastery, reading evidence, and a D1-backed reading constellation.

## 2026-08-11 Web reading release

The current Web-only release provides 189 student-visible lesson units. The
source manifest retains 191 records, including two hidden system records. It
does not change the User Center, native App, A+/A--F scoring, or D1 schema:

- the lesson title, `起始` orientation and portrait share one compact masthead;
  the redundant `先找方向` label is gone, owner-scoped local steps sit
  collapsed beside the portrait, and new readers start close reading at 126%
  while an existing saved preference remains authoritative;
- after the no-note first read, all 30 classical lessons keep that submitted
  reading visible, add source-bound learning tips, and then show the annotated
  canonical text. Inline notes begin hidden and vocabulary remains locked until
  an explicit non-scoring annotated-reading receipt succeeds;
- all 191 reader documents share one numeric-superscript renderer: all 2,933
  references bind to the preceding visible character or word, so neither
  classical nor modern annotations can leave an orphan marker on a new line;
- all 189 student lessons have a unique, text-anchored and mode-specific
  structure question. Author impersonation and the generic
  `我是／抽掉／換序／最關鍵的材料` templates fail closed;
- all nine WeChat article resources use reviewed `wx.bdfz.net` archives, all
  embeds can expand to the full-page preview and return to their card, and
  the reviewed fallback set covers 351 page resources: 334 use screenshots,
  11 have a direct presentation, and 6 stop embedding honestly because an
  external condition remains. The screenshots include 22 reviewed
  `ctext.org` pages and 27 reviewed `forum.rdfzer.com` pages;
- 99 Google Sites resources are screenshot-first, while 17 reviewed exact
  BDFZ roots load the real remote site in both the card and full-page view.
  `xue.bdfz.net` is absent from student resources, preview targets, redirects,
  allowed hosts and screenshot receipts;
- safe `qx.bdfz.net` figure fragments load the real remote profile, all 17
  `zh.wikisource.org` targets are screenshot-first, and five reviewed YouTube
  resources expose click-to-play privacy-bounded players. The empty exact
  Sichuan gazetteer resource ending in `content_30068` is deleted while the
  separate `content_22151` source remains;
- `此刻同讀` stays unloaded until the student selects `進入同讀`, preventing
  the remote frame from taking focus and scrolling the lesson to section 06.
  Mobile titles may use two lines, and the atlas no longer opens by default at
  the cramped 1024-pixel layout;
- every student-visible `bdfz.yuque.com` link is removed. Registered BDFZ
  subdomain roots and exact third-party lesson URLs remain exact-target and
  fail closed for arbitrary sibling paths. E01, 16 permanently unavailable
  resources and the confirmed-dead Bilibili item are deleted from the Web
  projection and registries.

The current preview registry is 538 targets / 118 redirects / 75 hosts, digest
`sha256:887931515ae55b93d579a6892b5146ef68466c1e2c3ae5ed0c8022e00f2e84b7`.
The screenshot manifest uses 328 unique WebP files / 12,795,016 logical bytes;
its SHA-256 is
`30193e813611eb5e9ec09e2da99f81e5bca50597ed8b16839097eb70458333af`.

Production deployment `8da16237-ac91-47e1-afe2-7843e2d4c8a4` serves clean
carrier `0ff5d5604ceefef92c99c07033f1e900d9edaaed`; immediate Pages rollback is
`a257af4c-78a1-483d-bc9e-57e34e1d2dbe`.

The production D1 already contains migration 0004. This task performs no D1
write and does not move `site/app-content/latest-stable.json`. App and User
Center follow-up are deliberately paused until the Web learning experience is
accepted; the current Web release does not claim App synchronization.

## 2026-08-09 self-study-loop candidate (historical)

The historical candidate branch rebuilt the Web lesson flow around a source-backed,
non-scoring formative loop. It is a **blocked implementation candidate**, not
the current production release or an App-approved content receipt:

- 30 classical lessons start with an authenticated, no-punctuation and
  no-annotation first read. Students must retain at least three marked ranges,
  their first guesses, elapsed time and a short summary before the annotated
  reader unlocks. The canonical text comes from the reviewed textbook reader;
  the two special PDFs define the learning flow and supplementary material but
  do not override the textbook when their excerpts differ.
- Five study-guide PDFs feed one catalog covering 16 lessons and 241 curated
  items. 193 items are active for self-check and 48 are retained as inactive
  review/tombstone records. Where the source has no answer key, the UI says
  `Codex 參考答案`; open responses expose a non-unique reference framework and
  rubric rather than a fabricated unique answer.
- Classical lessons no longer duplicate `通讀正文` or `字句之改`; modern lessons
  retain the three-word first response and `字句之改`.
- Inline annotations followed the text, typed in from a legacy word marker, and collapsed
  on a second click or a blank-text click. Lesson material, slide and transfer
  resources render as expanded previews with explicit fallbacks; duplicate
  `此刻同讀` entries were removed. The former cross-book lookup was removed in
  the current Web release.
- `lessonId + competencyTag` is the public formative aggregation unit. The
  current active-set denominator is computed from stable semantic completion
  keys, so additions, retirements and reviewed aliases update mastery without
  using a question ID as the external evaluation unit. This projection is
  explicitly isolated from A--F and A+ scoring.

Candidate contract identifiers are recorded in `PROJECT_STATE.md`. Production
remains blocked until the paired User Center consumer is release-authorized,
the compound learning-health receipt is healthy, migration `0004` is backed up
and applied, and the Web artifact passes live readback. The Android App and the
existing `latest-stable` native-content pointer remain untouched until that Web
release is complete.

## 2026-07-28 completion-integrity release

YW remains fully connected to Student Growth while completion eligibility is
normalized by the source Worker. An authenticated attempt is always retained
in `learning_interactions` and `learning_evaluations`; only these source-owned
verdicts can enter the scoring outbox:

- AI performance: server result `score >= 60` and correctness `passed`;
- vocabulary: source-owned `mastered` verdict;
- lesson evaluation: `self_report + scoringRole=none`, record-only.

Failed or still-learning attempts are projected as `ineligible` audit evidence,
not hidden as “待接入” and not counted as completion. Per user/resource, eight
scoring submissions are allowed in ten minutes and the ninth receives `429`.
Exact client-mutation replay is idempotent; reusing one mutation id for another
resource receives `409`.

```text
Production deployment: 33725793-42fa-437e-ab6d-bc712549e633
Immediate rollback:    8c3cb13e-a954-4f79-a342-f072b0a950b4
Source contract:       8 / 8
Pages + D1 tests:      37 / 37
Artifact:              850 files
Aggregate SHA-256:     acb2daaadc5cfe358f6ccbc94798a68be5812ab31519f867c02f75be93fca491
```

## Runtime and source of truth

- Local source: `/Users/ylsuen/CF/yuwen-course`
- GitHub: `ieduer/yuwen-course`, branch `main`
- Cloudflare Pages: `yuwen-course`
- Production: `https://yw.bdfz.net/`
- Deploy artifact: `.release/site` (generated; never deploy raw `site/`)
- Pages Worker: `site/_worker.js`
- D1: `yuwen-reading-db`, binding `READING_DB`
- Stable User Center site key: `yw`
- Learning evidence: source-owned raw ledger + dedicated Queue
  `bdfz-learning-evidence-yw-v1`

The lesson `evaluation` interaction is a recorded `self_report` with
`scoringRole=none`: it is visible in the process dossier but never affects a
dimension score or A+ gate. Queue producer acceptance is reported as
`enqueued`, not as proof of consumer delivery.

Production is direct-upload Pages. A Cloudflare deployment's displayed commit hash is metadata, not proof that GitHub contains the uploaded files. Releases must record the Git commit, artifact checksum, Pages deployment ID, D1 backup/migration state, and verification result together.

## Required reading

- [`docs/MAINTENANCE_MANUAL.md`](docs/MAINTENANCE_MANUAL.md) — architecture, dependencies, configuration, release, monitoring, rollback, and troubleshooting
- [`docs/VERIFICATION.md`](docs/VERIFICATION.md) — executable eight-point verification standard
- [`docs/READING_CONSTELLATION.md`](docs/READING_CONSTELLATION.md) — reading-constellation data and API contract
- [`docs/VOCAB_STANDARD.md`](docs/VOCAB_STANDARD.md) — vocabulary bank and release rules
- [`/Users/ylsuen/CF/runbooks/bdfz_learning_evidence_integration_standard.md`](/Users/ylsuen/CF/runbooks/bdfz_learning_evidence_integration_standard.md) — reusable multi-site evidence contract

## Local development

Use the repository-pinned dependencies and the user's fixed Python environment:

```zsh
cd /Users/ylsuen/CF/yuwen-course
PATH=/Users/ylsuen/.nvm/versions/node/v24.18.0/bin:$PATH npm ci
npm run serve
```

For the D1-backed reading API test seam, follow `docs/READING_CONSTELLATION.md`. `READING_TEST_SLUG` is local-only and forbidden in production.

## Data pipeline

The forum export is read-only. Do not run `build:data` unless the source export or textbook catalog intentionally changed; it rewrites the generated lesson tree.

```zsh
ssh -i ~/.ssh/ravnix_ed25519 root@172.93.160.202 \
  'docker exec -i --user discourse -w /var/www/discourse app bash -lc "RAILS_ENV=production bundle exec rails runner -"' \
  < scripts/export_discourse_course.rb \
  > .cache/discourse-course-export.json

npm run build:data
```

## Verification and release

The default paired Web/App command remains `npm run release:check`. For the
current user-directed Web-only release, the App sync subcheck is expected to
remain fail-closed: run the source/precontent gates and the formal release-site
plus artifact-manifest checks individually as listed in
`docs/VERIFICATION.md`. Commit every source change and require
`git status --porcelain` to be empty before deploying `.release/site`.

The maintenance manual additionally requires live dependency probes,
desktop/mobile browser QA, production deployment readback and rollback
recording. Do not move the App pointer in this Web-only phase.

After the Web source is committed, pushed, and `git status --porcelain` is
empty, rebuild the formal tree from that exact commit and deploy only that
tree:

```zsh
PATH=/Users/ylsuen/.nvm/versions/node/v24.18.0/bin:$PATH npm run build:release-site
PATH=/Users/ylsuen/.nvm/versions/node/v24.18.0/bin:$PATH npm run check:release-site
PATH=/Users/ylsuen/.nvm/versions/node/v24.18.0/bin:$PATH npm run build:artifact-manifest
PATH=/Users/ylsuen/.nvm/versions/node/v24.18.0/bin:$PATH npm run check:artifact-manifest
bash /Users/ylsuen/CF/scripts/git-deploy-gate.sh
PATH=/Users/ylsuen/.nvm/versions/node/v24.18.0/bin:$PATH \
  ./node_modules/.bin/wrangler pages deploy .release/site --project-name yuwen-course --branch main
```

Do not use `npm run deploy` during this Web-only phase: it intentionally runs
the paired App sync gate, which remains blocked until App work resumes.

## Configuration names

Never store values in Git or documentation.

- `READING_DB`: D1 binding, required in production
- `GITHUB_TOKEN`: optional GitHub Issues integration secret
- `CTEXT_USER` / `CTEXT_USERNAME`, `CTEXT_PASS` / `CTEXT_PASSWORD`: controlled China Text Project preview credentials
- `APIS_ENDPOINT`, `APIS_THINKING_LEVEL`: optional non-secret gateway routing overrides; default gateway is `https://apis.bdfz.net`
- `READING_TEST_SLUG`: local test seam only; forbidden in production

The project must not receive a leaf Gemini/OpenAI key pool. AI calls go through the shared APIS gateway.
