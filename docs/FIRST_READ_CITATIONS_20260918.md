# 《论语》十二章初读出处分行

Status: deployed and accepted as Pages `ec81bef8-4c28-47c4-8093-378be3666b31`,
runtime source `d08bc39ffc4ce4a9c60ecd7096d3392be30cef00`. Prepared from main
`0a26dabca3456aeb49b35dc79e51a5e1335cde88` on 2026-09-18.

The first-read renderer previously removed punctuation and displayed chapter
citations as part of each sentence, for example `子曰朝闻道夕死可矣里仁`.
All twelve reviewed paragraphs now show the body separately, with a smaller,
right-aligned source line reading `出處：《里仁》`. The submitted first-read
review uses the same presentation.

The citation names are checked against the reviewed reader document and bound
to exact existing paragraph keys. A changed key or nonmatching suffix falls
back to the original rendering. The source text, text version, paragraph IDs,
UTF-16 offsets and backend are unchanged. Existing marks that cross the visual
boundary retain their full highlighted text. CSS supplies the citation label
and brackets without adding characters to the selectable paragraph string.

Validation:

- `node scripts/test_classical_first_read.mjs`: 30 lessons and 102 paragraphs;
  twelve source citations match the canonical reader, submitted review agrees,
  body/source/cross-boundary legacy marks keep their text, unreviewed text falls
  back, and the other 29 lessons retain their original text.
- `node scripts/build_classical_first_read.mjs --check`: all 30 assets match.
- `node scripts/build_release_site.mjs --check-source --preview`: source
  projection passes. The `--preview` build and `--check-staging --preview` also
  pass. The formal build and staging/manifest checks also pass after refreshing
  the tracked artifact manifest for this frontend change. This is build
  evidence, not deployment acceptance.
- Formal artifact: 1,224 files / 164,477,073 bytes; aggregate SHA-256
  `2e1768bc8ce924499953fb59e48a964cfbfde81d03da8359ad622d125ff4be57`.
  Only the three frontend files and generated release receipt changed within
  the artifact; native content and all lesson data remain byte-identical.
- `node --check site/assets/classical-first-read.js` and `git diff --check` pass.
- Local Brave/Playwright at widths 1440 and 390: twelve separate source lines,
  smaller source font, exact paragraph text, no horizontal overflow; inspected
  screenshots at both widths.
- Real browser selection capture on the example paragraph preserves ranges
  `[2,5)`, `[9,11)` and `[8,11)`, covering the body, citation and their boundary.
  External requests were blocked and local API reads returned 401. No student
  records, authenticated saves, model calls or production services were used.

Web/App disposition: `compatible-no-client-release` for this Web presentation
candidate. Canonical lesson data, immutable native content and App pointers are
unchanged. This does not claim a native-client presentation change.

The user explicitly authorized publication. Preview `67b4224e` and production
`ec81bef8` passed actual desktop/mobile display, exact JS/CSS hash and ordinary
reload checks. The v2 controller at `5ee7ec16f0c481bbc88a86536324d60dbb803225`
recorded `accepted`; immediate rollback is Pages
`43b6e706-bfc0-4f5c-a11b-d956e2955d0e`, preserving all data.
The unrelated existing canonical checkout changes were preserved.
Full receipts and exact rollback requirements:
`/Users/ylsuen/CF/reports/operations/yw-first-read-citations-20260918/release/RELEASE.md`.
