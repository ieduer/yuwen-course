# Restricted dialogue acceptance preparation

Current state: 2026-10-12T13:05Z. First isolated deployment was approved for earlier exact sources. The revised private APIS transport is locally implemented and tested; its exact source and new binding require revised review before deployment. Final production release remains separate.
Earlier statements that preparation permission is pending are superseded here.

The separate entrypoint serves only `https://yw-acceptance.bdfz.net`. Its proposed
Direct Upload project is `yuwen-course-dialogue-acceptance`; its new empty D1 is
`yw-dialogue-acceptance-20261012`, bound as `ACCEPTANCE_DB`. Never use the primary
Pages project, its shared preview DB, the historical foundation precheck project,
or a restored production export. The main `wrangler.toml` remains unchanged.

## Runtime boundary

- `dialogue-acceptance.js` wraps the real Worker through a separate artifact
  entrypoint. The ordinary Worker cannot activate this context from environment
  variables, request headers or browser-supplied identity.
- The existing My resolver verifies the session on every acceptance API request.
  Its numeric user ID must equal the one owner-designated non-student account
  before `reconcileReadingStudent` or any other D1 access. Non-student status is
  the owner's explicit attestation; the identity RPC does not expose that role.
- The exact HTTPS host, expiry and complete configuration are required. Web
  mutations, including ones carrying native credentials, require the exact
  acceptance Origin and JSON. Wrong owner, malformed config and expired grants
  fail closed. The grant is rechecked before starting an APIS call.
- Only `/api/dialogue/v1` and an explicit static dialogue asset list are exposed.
  Legacy evaluation/chat, scheduler, history, proxy and learning-write APIs are
  absent. The projected environment has no Queue, scheduler configuration or
  additional data capability. Shared learner history is unavailable. Normal
  source saves and reviews stay solely in the new synthetic D1.
- The server adds `Cloudflare-Workers-Version-Overrides` for the pinned APIS
  UUID; client headers are ignored. Ordinary YW requests retain normal routing.
  The candidate must actually be attached at 0% alongside the unchanged 100%
  baseline. An override header alone is not proof of version selection.
- The static page has a same-origin network/script policy. External dictionary
  modules are deliberately unavailable in this calibration surface; their live
  acceptance remains separate. Original text/images and same-origin dialogue
  behavior remain available. No central SDK or learning telemetry is injected.

## Existing APIS without credential copying

The acceptance artifact binds `APIS_ACCEPTANCE` to `apis#YwDialogueAcceptance20261012` on the same 0%-pinned candidate. Its projected gateway closure forwards only the current request's one bounded My session cookie and server-fixed version override; it never forwards a caller credential or unrelated cookies. APIS independently verifies the My session and fixed owner 553 before using its own provider resources and existing YW caller accounting. Ordinary YW continues using its existing caller secret. The private entrypoint expires on 2026-10-13T12:00:00Z; no new secret or caller registry entry is needed. Its candidate-only identity binding is read-only. Browser requests cannot choose the APIS destination, version, model identity or owner.

This preparation supersedes the old requirement to recover the production Pages secret. It changes the accepted source/artifact and adds a private authentication transport, so the earlier exact-source deployment receipt cannot be replayed. Local workerd proves named-entrypoint dispatch and original stream/accounting behavior using synthetic provider responses; cloud version override and zero-percent entrypoint registration remain unverified. Stop on platform rejection, never increase ordinary traffic to make the entrypoint available.

## Preparation and first-deployment review

`wrangler.dialogue-acceptance.example.toml` is deliberately unusable: zero IDs,
expired time and no monetary policy. After review, pin the
actual returned new database UUID, exact candidate version UUID, designated My
user ID, UTC expiry, private APIS service binding and previously approved budget. No caller secret is copied.
The configuration's database-ID label cannot introspect a D1 binding: provider
configuration and actual upload metadata must independently prove the same new
UUID, absence of production/preview DBs and absence of Queue before any request.

Build from the clean pushed reviewed source:

```sh
npm run build:release-site
npm run check:release-site
npm run build:dialogue-acceptance
npm run test:dialogue-acceptance-bundle
```

The builder verifies the formal artifact, makes a separate `.acceptance/site`,
installs the restricted wrapper, removes the formal production marker and writes
the complete file hashes to `.acceptance/artifact.json`. It refuses an existing
output. Never pass the resulting artifact to the primary site's publisher.

Before the first remote write, suen reviews the exact pushed YW/APIS sources,
artifact hashes, account, proposed host/project, new synthetic D1, expiry, live
baseline and rollback. Register the new target/channel through existing release
governance. Cloud-assigned IDs must be bound to their own create/upload receipts,
then read back before attachment/use. Unexpected existing resources or drift
stop the operation; never adopt another task's resources.

First live acceptance proves anonymous/foreign-owner/origin denial and a
same-owner save/reload with no provider call. Only then may the unchanged,
separately approved 24-case calibration run under its existing no-retry budget.
No new source inventory, backup export or restore is implied. Final production
release still needs teaching, mobile, usage, source/central and independent
suen go/no-go evidence. This preparation has not increased live learner capacity.

## Validation and cleanup

117 focused tests pass on each Node 22.21.1 and 24.18.0: real source handlers
with in-memory synthetic D1, identity/origin/expiry/config denial, save/reload,
revocation, header isolation, existing dialogue/identity/preview contracts and
actual Wrangler upload metadata. Existing Reading API: 74 passed. These are
local checks, not deployed My/Worker/provider acceptance.

Evidence, exact identity mapping and bounded-operation/cleanup receipts:
`/Users/ylsuen/CF/reports/operations/yw-dialogue-20261012/continuation-01a12fd6/`.
Credentials are not stored in the repository or evidence. Code rollback removes
the owned candidate host/allocation and preserves the APIS baseline and forward
accounting. Synthetic resource deletion follows exact ownership/evidence checks.
