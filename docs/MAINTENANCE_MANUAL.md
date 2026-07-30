# `yw.bdfz.net` maintenance manual

Last reviewed: 2026-07-30 (America/Los_Angeles)

## 2026-07-30 Web/native shared-content candidate (not yet published)

The website repository remains the content authority. The independent native
client repository is `/Users/ylsuen/CF/yuwen-native-android`; it must never keep
a hand-edited copy of website content. Both clients consume the same generated,
versioned and content-addressed graph.

Current reviewed source candidate:

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
Blocked content version:       yw-3e77f0f7ffa5d042a6d06763
Blocked release receipt:       sha256-041b6cedaee5c6041cb337d49ee3a71ef7c1fb84342ae54e6270bbd6d691d11c
```

The native digest above is approved by the tracked independent audit receipt
after three byte-identical isolated rebuilds. That approval covers the
canonical graph only. The candidate remains blocked because it records
`sourceClean=false`, `appDisposition=blocked`, no Pages deployment ID and no
publication time; no App pointer, Pages production deployment or APK release
may claim it.

The same independent review also found two historical immutable App-content
receipts under the old `yw-9897f39b3236f2e351415ebc` release that preserve a
malformed AI Studio state payload. The approved digest above does not approve
those historical bytes or the current release tree. A new deployment must
parse JSON string values for privacy review, include only the one release
referenced by the reviewed stable pointer, and exclude every historical
release object. Until that gate passes, `.release/site` is not a clean Web
artifact and must not be deployed.

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

# Formal artifact; intentionally fails while the current stable bytes are unsafe
npm run build:release-site
npm run check:release-site
```

Never deploy a `preview-web-only` marker to the production branch. Formal
`release:check` still requires native deploy synchronization and
`formal-stable`; the preview mode does not relax or move `latest-stable`.

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
the pointer move. The current audit receipt is approved, but it does not waive
the separate clean-source, deployment, publication and App-disposition gates.
A Web content release may be compatible without a new APK, but it may never
omit the App disposition.

## 2026-07-28 completion eligibility and anti-farming (current)

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
npm run check:taxonomy
npm run verify:authors
npm run verify:vocab:release
npm run test:vocab-progress
npm run check:reader-documents
npm run verify:reader-media
npm run test:reader-media
npm run check:learning-manifest
npm run test:learning-manifest
npm run test:evidence-contract
npm run test:reading
npm run check:content-projection
npm run check:web-url-projection
npm run test:native-content
npm run release:check
git diff --check
```

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

Deploy the exact checksum-fixed `site/` artifact to a non-production branch. The preview branch must differ from `main`, and post-deploy readback must prove the production canonical deployment ID did not move.

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

Only after preview and all gates pass, publish immutable content objects before
moving the App pointer. Then deploy the exact checksum-fixed Web artifact:

```zsh
npm run deploy
```

Record Git commit/tag, staged-file set, artifact checksum manifest, Pages deployment ID/URL, D1 migration/export state, previous verified deployment, and exact live verification result. The displayed Pages commit hash is not accepted as source proof for a direct upload.

Native APK release is a separate gate. The same byte-identical signed artifact
must pass upgrade and persistence acceptance on registered Phone A
`c5467d2b`, registered Phone B `6393cccf`, and the separate physical tablet as
specified in `/Users/ylsuen/CF/runbooks/yw_native_app_operations.md`.
Emulators and device clouds may add coverage but cannot replace any of those
three physical-device receipts.

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
