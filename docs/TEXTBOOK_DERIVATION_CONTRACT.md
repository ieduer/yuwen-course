# YW textbook downstream derivation contract

Last verified: 2026-08-15 (America/Los_Angeles)

Status: `source_only_no_touch_pending_canonical_consumer_fixes`

## Purpose and authority

This document is the hard interface between the YW textbook source and four
downstream Chinese-learning corpora. It prevents a true-paper generator from
overwriting a textbook-derived corpus and prevents a dirty local checkout from
becoming release authority.

The selected textbook bytes are bound to
`ieduer/yuwen-course@7c7e1e06bad67b17dfa16a500a64ca2e02ad08c1` under
`site/data/lessons/<lesson-id>.json`. The local checkout
`/Users/ylsuen/CF/yuwen-course` is not authority: it is on historical branch
`codex/yw-self-study-loop-v2@756e51646d5fbf4306471de6ca4826f463b3d9df`
with a modified `AGENTS.md` and untracked `docs/OPERATIONS.md`. The latter does
not exist on remote `main` and must not be cited as an accepted operations
manual.

The workspace resource index also still identifies an older User Center v242
state while the live rollback is v251. That external operations-index drift is
not corrected or inherited here; it requires its own reviewed operations
transaction. This contract changes no User Center, Pages, D1, Queue, APIS,
native App, scoring or production resource.

## Exact consumer snapshot

Every release branch below is named `agent/beijing-2026-chinese-release`.
Release-branch pins are evidence snapshots, not permission to deploy or to
replace canonical `main`.

| Consumer | Canonical `main` | Reviewed safe release pin | YW lesson-selection SHA-256 | Textbook output | Baseline |
|---|---|---|---|---|---:|
| `ieduer/flx` | `cd5bc5d941eea534a934e7cb5ab3970252bd0c12` | `ebc6e594ca56af4fcd865ea325df8e7921401d59` | `973fad64a573fa8695635a244acfb331779d81ffda3199dd5170cb1bdbdc35a2` | `public/data/texts.json` | 18 texts |
| `ieduer/gaokao-wenyan` | `94b308edfbfa3dfcb99a74beb8d5905b61462e86` | `3a330dae9eb0b4df0aa868abc93e7bdcf536f191` | `2483e113cddf19e547d9c3aace6ef2859a55805f411b30fa669a506ef27e7a04` | `public/data/corpus.json` | 22 texts / 110 questions |
| `ieduer/gaokao-sanwen` | `b656d631529e658ddfad54403c2946ee6dd57130` | `7679db90236959500fcdb5bae85b58a5fab070db` | `4910cd190f5f2e55f959374c6d34b6c7750c8e03fe03ac70058077a202d130da` | `public/data/corpus.json` | 9 texts / 45 questions |
| `ieduer/shici` | `59e04a225568f9a2e19e03a892377abe3291692d` | `582b2edba934de572decfdcde2026b7bf76d9a80` | `843cf45ecb8f8a9c426f0009f193b9c9a072ca3df5c430b297022d21aaabf836` | `public/data/poems.json` | 37 poems |

The lesson-selection digest is computed by extracting the consumer generator's
unique lesson ids, reading each matching Git blob SHA-1 from the pinned YW
commit, sorting lines as `<lesson-id>\t<blob-sha1>\n`, and SHA-256 hashing the
resulting byte stream. Timestamps such as `generatedAt` are not semantic input.

## Generator and output ownership

### FLX

- Textbook generator: `scripts/build_texts.mjs`
- YW input: `site/data/lessons/<PICKS.id>.json`
- Textbook output: `public/data/texts.json`
- True-paper generator: `scripts/build_corpus.mjs`
- True-paper input: GKS `data/papers/*-chinese.json`
- True-paper output: `public/data/corpus.json`

### Gaokao Wenyan

- Textbook extract: `scripts/build_textbook.mjs` -> `output/texts.json`
- Textbook assembly: `scripts/gen_questions.mjs` reads `output/texts.json` and
  `scripts/cache/<slug>.json`, then writes `public/data/corpus.json` and updates
  counts in `public/data/knowledge.json`.
- True-paper generator: `scripts/build_data.mjs` reads `gaokao/data/all.json`
  entries where `key === "guwen"`.
- Safe true-paper output: `public/data/zhenti.json`; knowledge counts may be
  updated in `public/data/knowledge.json`.
- Separation fix: `1cd1d3228b24101b033e20e2ecc3443ad609c435`.

### Gaokao Sanwen

- Textbook extract: `scripts/build_textbook.mjs` -> `output/texts.json`
- Textbook assembly: `scripts/gen_questions.mjs` reads `output/texts.json` and
  `scripts/cache/<slug>.json`, then writes `public/data/corpus.json` and updates
  counts in `public/data/knowledge.json`.
- True-paper generator: `scripts/build_data.mjs` reads `gaokao/data/all.json`
  entries where `key === "sanwen"`.
- Safe true-paper output: `public/data/zhenti.json`; knowledge counts may be
  updated in `public/data/knowledge.json`.
- Separation fix: `283942ebc2d697e54600b825702f87ec2b2f5592`.

### Shici

- Textbook generator: `scripts/build_corpus.mjs`
- YW input: `site/data/lessons/<POEMS.lesson>.json`
- Textbook output: `public/data/poems.json`
- True-paper generator: `scripts/build_zhenti.mjs`
- True-paper inputs: `dist/data.js` plus the reviewed GKS structured Shici
  source selected by that exact consumer release
- True-paper output: `public/data/zhenti.json`

## Mandatory invariants

1. A textbook output has exactly one textbook writer. A true-paper generator
   must never write `texts.json`, `corpus.json`, or `poems.json` when that file
   is the consumer's textbook corpus.
2. Gaokao Wenyan and Gaokao Sanwen `scripts/build_data.mjs` must contain the
   `zhenti.json` output and must not write `public/data/corpus.json`. Their
   canonical `main` branches do not yet satisfy this rule; the safe fix exists
   only in the exact release pins above. Therefore ordinary builds from either
   current `main` are forbidden for this transaction.
3. Reprojection may run only in clean, isolated, exact-pinned checkouts. Never
   use the canonical dirty YW checkout or a consumer worktree owned by another
   task.
4. Every selected YW lesson must exist at the pinned source commit, and the
   recalculated lesson-selection digest must equal the table above.
5. Consumer registry, cache and output ids must be the same set. Counts remain
   18 / 22 / 9 / 37, with 110 and 45 questions for the two question corpora;
   empty text and duplicate ids are forbidden.
6. Verification must be offline. Missing cache data fails closed and must not
   trigger APIS. Gaokao Wenyan and Gaokao Sanwen still need a reviewed
   assemble-only check before this can become a routine executable gate.
7. Before textbook generation, record the true-paper output SHA-256; after the
   run it must be unchanged. Before true-paper generation, record the textbook
   output SHA-256; after the run it must be unchanged.
8. Normalize non-semantic timestamps before semantic comparison. A timestamp
   change cannot justify corpus replacement.
9. Preserve existing corpora and histories. Do not delete, overwrite, deploy or
   publish as a side effect of validation.
10. Source-only success is not User Center delivery, mapping, scoring, A--F,
    production or shared-hub authority.

## Current disposition and release gate

- FLX and Shici already separate their textbook and true-paper outputs, but
  they remain part of the same frozen multi-repo transaction.
- Gaokao Wenyan and Gaokao Sanwen fixes are remotely durable and are ancestors
  of the safe release pins above. They are not on canonical `main`; current
  `main` still allows the true-paper generator to overwrite `corpus.json`.
- Canonical YW-to-consumer reprojection is therefore `NO-TOUCH` until both
  consumer mains contain the separation invariant, or a separately approved
  synchronized transaction explicitly pins and independently verifies the
  safe commits.
- The executable cross-repo gate belongs in canonical `cf-ops-scripts`; YW CI
  must not assume sibling repositories exist locally.

Closeout for any future transaction must use one `change_id` and record all
exact base/head refs, the YW selection digests, generator and output hashes,
proof that the opposite corpus was unchanged, all four consumer dispositions,
dirty-tree state, no-APIS evidence, deployment disposition and rollback. Until
then, run no downstream generator from YW.
