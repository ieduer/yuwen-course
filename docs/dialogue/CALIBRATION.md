# Real dialogue calibration — prepared, not executed

Current: 2026-10-12T11:42Z. Owner codex-01a12fd6. Paid attempts across this goal remain **0**. This document fixes a finite test operation; it is not a release approval, source-image acceptance or substitute scoring policy.

Operation `yw-dialogue-real-calibration-20261012-v1` uses the existing Gemini APIS single-stream route, model `gemini-3.6-flash`, through authenticated isolated YW acceptance and its normal shared reservations. Maximum **24 total attempts**, one per case, no retry/fallback/hedge, 20 minutes from the first attempt, 20-second request bound. Maximum conservative reservation **2,016,000 micro-USD (US$2.016)** within the already-approved US$50/UTC-day and request limits. Persist the operation/attempt ledger before each call; account switches, new chats, reloads or a revised packet do not reset it. Unknown calls retain reservations and use same-attempt readback. The existing budget price expiry remains 2027-01-01.

Stop the operation at the first admission/transport/usage/source/model mismatch, uncertain call, false mastery, unsafe persona, or budget exhaustion. Preserve the received visible response and receipt; do not automatically replace cases or replay a failed/unknown call. A semantic failure requires correcting the candidate and an explicit disposition for any remaining budget, not an automatic fresh batch.

## Fixed corpus and reproducible preparation

`scripts/dialogue-calibration-cases.json` contains 24 synthetic cases across all three pilots: every new language objective has an independent explanation, with misconceptions, partial terminology, literal copying, praise, quotation-only answers, defensible dissent, original transfer, grounded 尚友 and empty-praise 尚友. Review author/narrator separation, unsupported biography, one focused question, source fidelity, explanation quality and false positive/negative verdicts individually.

Prepare without networking or writes to curriculum:

```sh
node scripts/dialogue_calibration.mjs prepare /exact/task/runtime/new-packet.json
```

The final packet prepared at this checkpoint has digest `95b8f943e519191aba697a0c01984621ee8ea12549e164379363f5ef54a04f09`. It pins curriculum and prompt hashes, policy v5/evidence v3, questions, expected judgments and review criteria. The runner's offline readback evaluator validates references and expected outcomes, but explicitly leaves semantic review required. A copied excerpt with a valid reference is not proof of understanding.

Preparation deliberately uses **hypothetical accepted source/calibration states in synthetic fixture copies** to test positive as well as negative decisions. Ready-only conclusion fixtures similarly use explicit synthetic prior evidence. These overrides never mutate shipped curriculum, real learners, original grades, sources or release authority. Do not execute this packet against a real learner's account/history or interpret fixture readiness as real acceptance.

## Remaining execution dependencies

APIS PR181 and YW remain unpublished; the streaming flag and YW feature remain OFF, and remote 0010–0013 are unapplied. The command above sends **zero** provider calls. Actual execution needs the governed isolated authenticated acceptance path, the accepted dated data baseline with release-time coverage reconciliation, the completed APIS source-reference inventory plus the still-pending isolated authentication boundary and existing suen release review. Never route calibration directly to a provider, enable an unaccepted flag, reuse another caller credential, or bypass YW accounting to obtain results.

`而` retains its two previously verified examples. Six existing XC page images now verify the cited senses for `于／何／但`: PDF773/774/776,207/211,96 (printed761/762/764,195/199,84). Image hashes and narrowly stated verification scopes are pinned in the source fixture. No new image copy, rendering or upload was created. Public dictionary URL/component accessibility remains a separate acceptance check after the observed403; local source review does not prove service recovery. All nine language items remain pending real semantic calibration; numeric difficulty stays null. Textual/rhetorical interpretation is distinguished from dictionary meaning.

Release readiness requires each real response, original source page where required, expected-versus-actual verdict, reasoned semantic review, real provider/stream/usage receipt and final disposition. Passing offline checks or generating this packet cannot change calibration status to accepted.
