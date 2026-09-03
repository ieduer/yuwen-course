# `yuwen-course` Agent Instructions

## Required reading

1. `/Users/ylsuen/CF/AGENTS.md`
2. `/Users/ylsuen/CF/runbooks/ai_native_development_engineering_standard.md`
3. `/Users/ylsuen/CF/runbooks/bdfz_project_matrix_and_interdependencies.md`
4. `/Users/ylsuen/CF/runbooks/bdfz_unified_architecture_and_maintenance_standard.md`
5. `/Users/ylsuen/CF/runbooks/bdfz_learning_evidence_integration_standard.md`
6. `/Users/ylsuen/CF/yuwen-course/README.md`
7. `/Users/ylsuen/CF/yuwen-course/docs/MAINTENANCE_MANUAL.md`
8. `/Users/ylsuen/CF/yuwen-course/docs/VERIFICATION.md`
9. `/Users/ylsuen/CF/yuwen-course/PROJECT_STATE.md`
10. `/Users/ylsuen/CF/runbooks/yw_native_app_operations.md` when Web/App
    content, contract, or release disposition is in scope

## Project purpose

`https://yw.bdfz.net/` is the student-centred learning matrix for five
senior-high Chinese textbooks. It owns lesson/content presentation, vocabulary
and reading interactions, source-side learning-evidence normalization, and the
D1-backed reading constellation.

This Web repository is also the content authority for the independent native
Android client in `/Users/ylsuen/CF/yuwen-native-android`. It must never be
embedded into that repository or replaced by a hand-edited App content copy.

## Current architecture

- Frontend: static Pages artifact generated from `site/` and staged under
  `.release/site`.
- Backend: Pages Worker `site/_worker.js`.
- Database: D1 `yuwen-reading-db`, binding `READING_DB`.
- User identity: User Center `siteKey=yw`, named evidence identity binding, and
  shared session/widget contract.
- Learning evidence: source-owned interaction/evaluation ledger, durable
  outbox, historical Queue `bdfz-learning-evidence-yw-v1`, current Queue
  `bdfz-learning-evidence-yw-v2`, and central delivery-receipt reconciliation.
- AI: shared `https://apis.bdfz.net`; no leaf model key.
- Monitoring: Pulse host coverage and source-specific operational probes.
- Native content: versioned, content-addressed graph, stable IDs, semantic
  digest, immutable objects, reviewed receipt, and `latest-stable` pointer.
- Deployment: direct-upload Cloudflare Pages project `yuwen-course`.
- Data class: `student_owned`.

YW is a leaf project. It consumes shared hubs but does not own their contracts.

## Important files

| Path | Responsibility | Constraint |
|---|---|---|
| `site/_worker.js` | API/auth/evidence normalization | Server owns score, correctness, eligibility, rate limits, and idempotency |
| `site/data/` | Generated lesson/taxonomy/vocabulary/manifests | Regenerate only from reviewed sources |
| `migrations/` | Additive D1 schema | Backup and apply through the documented gate; no destructive rollback |
| `scripts/build_native_content.mjs` | Web-to-App content projection | Preserve stable IDs, schema, semantic digest, and receipt |
| `scripts/build_release_site.mjs` | Formal/preview artifact staging | Never deploy `preview-web-only` to production |
| `scripts/test_learning_evidence_contract.mjs` | Source/consumer contract | Must use real source envelope and current consumer registry |
| `scripts/build_artifact_manifest.mjs` | Exact release checksum manifest | Required for production artifact |
| `docs/MAINTENANCE_MANUAL.md` | Architecture/release/data operations | Current overrides at the top supersede retained historical evidence |
| `docs/VERIFICATION.md` | Executable eight-point verification | Run after material changes |
| `PROJECT_STATE.md` | Concise continuation state | Update after content/release/data contract changes |

## Engineering, learning-data, and privacy constraints

- The server—not the browser—owns score, correctness, attempt number, resource
  version, scoring role, and eligibility.
- AI completion requires the current server-normalized passing contract;
  vocabulary completion requires the source-owned mastered verdict.
- Failed/learning attempts remain visible as ineligible evidence and must not
  be hidden or counted as completion.
- Lesson evaluation is `self_report` with `scoringRole=none`; it never changes
  a dimension or A+ gate.
- Queue producer acceptance is `enqueued`, not proof of consumer delivery.
  Only a User Center receipt may settle an outbox attempt as `accepted`,
  `pending_mapping`, or `quarantined`; pending mapping stops transport resend
  but remains eligible for central receipt polling.
- Raw answers stay in YW D1; User Center receives only the privacy-minimized
  projection.
- Never fabricate student progress, completion, evidence, or unavailable source
  content.
- Never write a local account/password system or trust a browser-supplied user
  ID or role.
- Never expose `READING_TEST_SLUG` in production.
- Preserve D1 student history across Pages code rollback.

## Web/App content transaction

Every Web content change is one reviewed Web/App transaction:

1. generate both clients from the same clean source graph;
2. verify schema, stable IDs, semantic digest, fixtures, media receipts, and
   deterministic outputs;
3. deploy/verify the reviewed Web artifact without moving an unrelated App
   release pointer;
4. publish and publicly read back immutable App content objects first;
5. record exactly one disposition:
   `compatible-and-synced`, `compatible-no-client-release`, or `blocked`;
6. move `latest-stable` last only after all gates pass.

Unknown schema, mismatched hashes, dirty generated output, missing media,
historical unreviewed receipts, or missing disposition fails closed.
`latest.json` is Android App release metadata and is not the Web content pointer.

## Testing and verification

Minimum local release gate:

```bash
cd /Users/ylsuen/CF/yuwen-course
npm ci
npm run release:check
git diff --check
```

Use `npm run prepare:preview-artifact` only for a non-production Web preview.
Run the source, content, reader-media, learning-manifest, evidence-contract,
reading, release-site, artifact, browser, API/auth, D1, dependency, Pulse, and
Web/App receipt checks in `docs/VERIFICATION.md`.

For the bounded Phase 2 Web-only release while the App pointer is intentionally
unchanged, build the formal artifact first and then run
`npm run check:native-content:web-only -- --receipt <ABSOLUTE_PHASE2_RECEIPT>`.
That mode must bind the clean pushed `origin/main` SHA, formal artifact digest,
exact `compatible-no-client-release` disposition, and unchanged App pointer and
immutable tree hashes. The ordinary `check:native-content:deploy-sync` command
remains the default fail-closed App-release gate and accepts no receipt or
override.

Production mutation is disabled in this checkout. `package.json` intentionally
contains no `deploy` or `predeploy` script. Keep `release:check` and the artifact
builders as source-verification inputs, but Pages deployment, D1 migration,
Queue mutation, traffic change and rollback may run only through the separately
reviewed external UC+YW executor. Documentation-only changes do not authorize
that executor, an App pointer move, or a native release.

## Dependencies and ownership boundaries

Do not modify or deploy these as an implicit part of a YW change:

- `bdfz-user-center`;
- `apis`;
- `bdfz-nav`;
- `img`;
- `pulse`;
- `bdfz-companion`;
- `yuwen-native-android`;
- `qunxian`, `jc-textbook-reader`, or `chat`.

Contract changes require separate ownership and matrix fan-out regression.
Leaf-only content/UI changes still require safe probes of the dependencies
listed in the maintenance manual.

## Known issues and priorities

- The maintenance and verification manuals retain historical release sections;
  current override sections and the canonical report take precedence. Refresh
  stale anchors rather than deleting historical evidence.
- Native authentication, central-data mutation, physical-device acceptance, and
  Android release lifecycle belong to the independent native repository and
  its runbook.
- Formal Web/App releases must keep current content receipts, public readback,
  and the recorded App disposition synchronized.

## Forbidden changes

- Never run `build:data` unless the source export or textbook catalog
  intentionally changed.
- Never deploy `.cache/`, an old mirror, or a `preview-web-only` artifact to
  production.
- Never add `GEMINI_API_KEY`, `GOOGLE_API_KEY`, or another leaf model-key pool.
- Never drop D1 evidence tables as a code rollback.
- Never hand-edit a native content copy or move `latest-stable` without the
  complete receipt transaction.
- Never modify shared hubs or the native App to make a Web-only test pass.
