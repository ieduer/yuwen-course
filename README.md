# yuwen-course

`yw.bdfz.net` is the student-centred learning matrix for the five senior-high Chinese textbooks. It combines lesson text and resources, author and literary-taxonomy links, vocabulary mastery, reading evidence, and a D1-backed reading constellation.

## Runtime and source of truth

- Local source: `/Users/ylsuen/CF/yuwen-course`
- GitHub: `ieduer/yuwen-course`, branch `main`
- Cloudflare Pages: `yuwen-course`
- Production: `https://yw.bdfz.net/`
- Deploy artifact: `site/`
- Pages Worker: `site/_worker.js`
- D1: `yuwen-reading-db`, binding `READING_DB`
- Stable User Center site key: `yw`

Production is direct-upload Pages. A Cloudflare deployment's displayed commit hash is metadata, not proof that GitHub contains the uploaded files. Releases must record the Git commit, artifact checksum, Pages deployment ID, D1 backup/migration state, and verification result together.

## Required reading

- [`docs/MAINTENANCE_MANUAL.md`](docs/MAINTENANCE_MANUAL.md) — architecture, dependencies, configuration, release, monitoring, rollback, and troubleshooting
- [`docs/VERIFICATION.md`](docs/VERIFICATION.md) — executable eight-point verification standard
- [`docs/READING_CONSTELLATION.md`](docs/READING_CONSTELLATION.md) — reading-constellation data and API contract
- [`docs/VOCAB_STANDARD.md`](docs/VOCAB_STANDARD.md) — vocabulary bank and release rules

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
