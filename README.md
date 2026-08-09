# yuwen-course

`yw.bdfz.net` is the student-centred learning matrix for the five senior-high Chinese textbooks. It combines lesson text and resources, author and literary-taxonomy links, vocabulary mastery, reading evidence, and a D1-backed reading constellation.

## 2026-08-09 self-study-loop candidate

The current branch rebuilds the Web lesson flow around a source-backed,
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
- Inline annotations follow the text, type in when `注` is opened, and collapse
  on a second click or a blank-text click. Lesson material, slide and transfer
  resources render as expanded previews with explicit fallbacks; duplicate
  `此刻同讀` entries are removed and cross-book lookup uses
  `https://xue.bdfz.net/`.
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
- Deploy artifact: `site/`
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
npm ci
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

```zsh
cd /Users/ylsuen/CF/yuwen-course
npm run release:check
npm run deploy
```

`release:check` is the minimum local gate. The maintenance manual additionally requires a checksum-fixed Pages preview, live dependency probes, desktop/mobile browser QA, production deployment readback, and rollback recording.

## Configuration names

Never store values in Git or documentation.

- `READING_DB`: D1 binding, required in production
- `GITHUB_TOKEN`: optional GitHub Issues integration secret
- `CTEXT_USER` / `CTEXT_USERNAME`, `CTEXT_PASS` / `CTEXT_PASSWORD`: controlled China Text Project preview credentials
- `APIS_ENDPOINT`, `APIS_THINKING_LEVEL`: optional non-secret gateway routing overrides; default gateway is `https://apis.bdfz.net`
- `READING_TEST_SLUG`: local test seam only; forbidden in production

The project must not receive a leaf Gemini/OpenAI key pool. AI calls go through the shared APIS gateway.
