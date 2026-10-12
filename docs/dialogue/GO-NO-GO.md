# YW conversation pilot — one-page review

As of 2026-10-12T06:21:48+00:00. **Recommendation: NO-GO for migration, production enablement or replacing the old workflow.** Proceed with review of the disabled candidate; no approval is being requested for an unfinished release.

| Review item | Actual evidence / disposition |
| --- | --- |
| Source preservation | Isolated candidate from 175f8ae; unrelated dirty canonical checkout preserved; original curriculum, app and migrations unchanged |
| Inventory | 189 lessons, 869 formal resources, 1,021 formative items, 193 active guide items; exact per-item map, gaps and compound gates |
| Local implementation | Three text/conversation pilots, gated Worker, private owner storage, verifiable proposals, question instances, versioned resume and budget-deferred drafts |
| Local checks | 42 focused dialogue checks; APIS 271 regression plus final 10 stream checks; 74 existing Reading API assertions in local D1; strengthened migration fixture passes; synthetic mobile save, quote return and account switch checked |
| Performance | Local n=3 first text: desktop median 25.6 ms; mobile weak-network median 786.6 ms; old medians 270.2 ms / 18,556.0 ms. Not a production speedup claim |
| Historical production evidence | No writes made; no live row comparison, new recoverable backup or restore acceptance obtained |
| Teaching/scoring bridge | Original vocab mastery, submitted/unfinished first reading and exact-version formal credit are projected read-only; shared/browser progress and guide/formal answer assembly remain incomplete. Current state is only evidence_ready_for_review, never an official grade |
| AI quality / 尚友 | Structural validation tested; real model calibration, whole-conversation evidence summary and adversarial persona review still pending |
| Classical mastery | Source vocabulary and stable variants implemented; whole-lesson randomized order, grammar coverage/difficulty and approved consequential thresholds unresolved |
| Streaming / cost | APIS/YW real SSE and hard-crash fencing implemented locally. User-approved US$50/day Gemini policy reserved atomically. Live stream/cost acceptance and shared fan-out release remain pending |
| Privacy / teacher use | All authenticated My accounts, own records only; permanent retention approved. Owner export/review request implemented; teacher grants/dashboard and append-only correction remain pending |
| Sources / mobile | Dictionary fails visibly to 待核查; original-image success unverified. Actual past-paper examples and physical keyboard/accessibility audit pending |
| Infrastructure access | Canonical same-account credential readback confirms Pages/D1 metadata and APIS accepted runtime; connector still has no account. No D1 row query or live backup yet |
| Publication | No merge, migration, feature activation, release receipt, public Status update or monitoring change. Existing Pulse remains in place |

## Decisions to resolve before consequential implementation/rollout

- **Equivalence:** proposed approach keeps each original task's exact rubric, resource/version and scoring role; dialogue may collect its required answer parts across turns, but the existing source evaluator alone produces credit. A verified old completion stays complete; uncertain mappings go to review. Approve the mapping/answer assembly rules before implementing a consequential bridge. No new weights or replacement historical thresholds are proposed.
- **Shared streaming:** already authorized by suen; code is implemented and tested locally. Finish the existing complete fan-out/release gate and actual stream acceptance. No direct provider path or Claude API is added.
- **Privacy and budgets:** user-approved own-record-only My access, permanent retention and US$50 daily Gemini cap are incorporated. No cross-student teacher grant exists; corrections must preserve originals. Do not infer a teacher role from general My membership.
- **Access/ownership:** same-account documented read access recovered. Reconcile the existing staged publisher and verified backup/restore before a governed release. The connector itself is not repaired.

Local remaining engineering (teacher interface, remaining bridge, full 尚友 summaries and missing source fixtures) is still required even if these decisions are accepted. Do not treat a sign-off on the design as permission to skip that work or acceptance checks. The project-local AGENTS instruction names suen (or a suen-designated reviewer) as the independent reviewer; this candidate does not self-certify that review.
