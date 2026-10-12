# YW conversation pilot — one-page review

As of 2026-10-12T08:47:07Z. **Recommendation: NO-GO for migration, production enablement or replacing the old workflow.** Proceed with review of the disabled candidate; no approval is being requested for an unfinished release.

| Review item | Actual evidence / disposition |
| --- | --- |
| Source preservation | Isolated candidate from 175f8ae; unrelated dirty canonical checkout preserved; original curriculum, app and migrations unchanged |
| Inventory | 189 lessons, 869 formal resources, 1,021 formative items, 193 active guide items; exact per-item map, gaps and compound gates |
| Local implementation | Three text/conversation pilots, gated Worker, private owner storage, verifiable proposals, question instances, versioned resume and budget-deferred drafts |
| Local checks | 69 dialogue +121 original source/recovery/replay checks on both pinned Nodes;74 local Reading API;1251-file formal artifact. Earlier browser/APIS evidence remains scoped to prior reports |
| Performance | Local n=3 first text: desktop median 25.6 ms; mobile weak-network median 786.6 ms; old medians 270.2 ms / 18,556.0 ms. Not a production speedup claim |
| Long conversation | 200 synthetic turns; mobile CSS390x844, no horizontal overflow. Weak network150ms/200KB/s, n=3: text median983.1ms, record median1672.1ms. First-excerpt link restored all200 turns and reached the original. Physical keyboard/provider latency unverified |
| Historical production evidence | No writes made; no live row comparison, new recoverable backup or restore acceptance obtained |
| Teaching/scoring bridge | Original vocab mastery, submitted/unfinished first reading and exact-version formal credit are projected read-only; owner history and original first-read/corrections are integrated. Five AI formal tasks now use the original evaluator; conversational answer assembly and original non-AI tasks remain incomplete. New dialogue mastery remains separate from original formal grades |
| AI quality / 尚友 | Structural validation tested; full-history evidence index and original-turn links implemented; real model conclusion calibration and adversarial persona review still pending |
| Classical mastery | Source vocabulary, stable variants and session-stable randomized whole-lesson order implemented; grammar coverage/difficulty, real calibration and approved consequential thresholds unresolved |
| Streaming / cost | APIS/YW real SSE and hard-crash fencing implemented locally. User-approved US$50/day Gemini policy reserved atomically. Live stream/cost acceptance and shared fan-out release remain pending |
| Privacy / teacher use | All authenticated My accounts, own records only; permanent retention approved. Owner export/review request implemented; append-only correction implemented; no cross-student grants/dashboard authorized |
| Sources / mobile | Two original dictionary pages visually verified; Beijing newspaper question references text-verified. Original papers/official marking, grammar calibration and physical keyboard/accessibility remain pending |
| Infrastructure access | Earlier canonical same-account credential readback confirmed Pages/D1 metadata and APIS runtime; refresh only at the relevant boundary; connector still has no account. No D1 row query or live backup yet |
| Publication | No merge, migration, feature activation, release receipt, public Status update or monitoring change. Existing Pulse remains in place |

## Remaining work and existing review gate

- **Equivalence:** proposed approach keeps each original task's exact rubric, resource/version and scoring role; dialogue may collect its required answer parts across turns, but the existing source evaluator alone produces credit. A verified old completion stays complete; uncertain mappings go to review. The authorized bridge preserves these rules; any new scoring policy would still require approval. No new weights or replacement historical thresholds are proposed.
- **Shared streaming:** already authorized by suen; code is implemented and tested locally. Finish the existing complete fan-out/release gate and actual stream acceptance. No direct provider path or Claude API is added.
- **Privacy and budgets:** user-approved own-record-only My access, permanent retention and US$50 daily Gemini cap are incorporated. No cross-student teacher grant exists; corrections must preserve originals. Do not infer a teacher role from general My membership.
- **Access/ownership:** same-account documented read access recovered. Reconcile the existing staged publisher and verified backup/restore before a governed release. The connector itself is not repaired.

Local remaining engineering (owner evidence report, remaining bridge, real grounded 尚友 conclusions and missing source fixtures) is still required even if these decisions are accepted. Do not treat a sign-off on the design as permission to skip that work or acceptance checks. The project-local AGENTS instruction names suen (or a suen-designated reviewer) as the independent reviewer; this candidate does not self-certify that review.
