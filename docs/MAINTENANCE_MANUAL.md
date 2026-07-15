# `yw.bdfz.net` maintenance manual

Last reviewed: 2026-07-14 (America/Los_Angeles)

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
Browser / Companion WebView
  -> Pages static artifact (site/)
  -> Pages Worker (site/_worker.js)
       -> D1 yuwen-reading-db: reading submissions and vocab attempts
       -> my.bdfz.net: server-side session verification and central events
       -> apis.bdfz.net: AI dialogue and authoring gateway
       -> GitHub Issues: optional lesson discussion integration

Static/UI dependencies
  -> qx.bdfz.net: author portraits and figure dossiers
  -> jc.bdfz.net and img.rdfzer.com: textbook pages and source verification
  -> chat.bdfz.net: embedded public class chat
  -> nav.bdfz.net and img.bdfz.net: shared navigation and favicon/assets

Operational consumers
  <- my.bdfz.net: progress, data records, mastery, activity timeline
  <- pulse.bdfz.net: host coverage and availability reporting
  <- bdfz-companion: trusted WebView entry
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
npm run release:check
git diff --check
```

Run a staged secret scan before commit or push. Generated cache, `output/`, `.claude/`, Playwright profiles, local D1 state, backups, and secrets are not source artifacts.

### 5.4 Preview

Deploy the exact checksum-fixed `site/` artifact to a non-production branch. The preview branch must differ from `main`, and post-deploy readback must prove the production canonical deployment ID did not move.

Verify on the preview URL:

- manifest/taxonomy/vocabulary counts and removed-record absence;
- reading health plus anonymous `401` boundaries;
- APIS, QX portrait, textbook-page, User Center SDK, and Pulse contracts;
- desktop and 390 px mobile layout, accessibility, navigation, loading/error states, dark mode, animation, and console/network cleanliness;
- vocabulary correct/wrong/retry/completion flow and persistence;
- D1 write/read canary only when explicitly authorized and isolated.

### 5.5 Production

Only after preview and all gates pass:

```zsh
npm run deploy
```

Record Git commit/tag, staged-file set, artifact checksum manifest, Pages deployment ID/URL, D1 migration/export state, previous verified deployment, and exact live verification result. The displayed Pages commit hash is not accepted as source proof for a direct upload.

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
