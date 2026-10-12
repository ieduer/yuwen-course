# YW conversation pilot — one-page review

As of 2026-10-12T04:16:33+00:00. **Recommendation: NO-GO for migration, production enablement or replacing the old workflow.** Proceed with review of the disabled candidate; no approval is being requested for an unfinished release.

| Review item | Actual evidence / disposition |
| --- | --- |
| Source preservation | Isolated candidate from 175f8ae; unrelated dirty canonical checkout preserved; original curriculum, app and migrations unchanged |
| Inventory | 189 lessons, 869 formal resources, 1,021 formative items, 193 active guide items; exact per-item map, gaps and compound gates |
| Local implementation | Three text/conversation pilots, gated Worker, private owner storage, verifiable proposals, question instances, versioned resume and budget-deferred drafts |
| Local checks | 56 focused passing checks; separate strengthened migration fixture passes; synthetic mobile save, quote return and account switch checked |
| Performance | Local n=3 first text: desktop median 25.6 ms; mobile weak-network median 786.6 ms; old medians 270.2 ms / 18,556.0 ms. Not a production speedup claim |
| Historical production evidence | No writes made; no live row comparison, new recoverable backup or restore acceptance obtained |
| Teaching/scoring bridge | NOT IMPLEMENTED: old completion/shared progress/unfinished first-read and guide/formal evaluation equivalence. Current state is only evidence_ready_for_review, never an official grade |
| AI quality / 尚友 | Structural validation tested; real model calibration, whole-conversation evidence summary and adversarial persona review still pending |
| Classical mastery | Source vocabulary and stable variants implemented; whole-lesson randomized order, grammar coverage/difficulty and approved consequential thresholds unresolved |
| Streaming / cost | Existing APIS path is complete JSON; no token streaming. Actual monetary budget and gateway internal call behavior not verified. Hard-crash reconciliation pending |
| Privacy / teacher use | Owner export/review request implemented; authorized teacher dashboard, retention period and append-only corrections not implemented/approved |
| Sources / mobile | Dictionary fails visibly to 待核查; original-image success unverified. Actual past-paper examples and physical keyboard/accessibility audit pending |
| Infrastructure access | One intended-account Cloudflare read rejected; D1 query did not run. No different account or credential replay attempted |
| Publication | No merge, migration, feature activation, release receipt, public Status update or monitoring change. Existing Pulse remains in place |

## Decisions to resolve before consequential implementation/rollout

- **Equivalence:** proposed approach keeps each original task's exact rubric, resource/version and scoring role; dialogue may collect its required answer parts across turns, but the existing source evaluator alone produces credit. A verified old completion stays complete; uncertain mappings go to review. Approve the mapping/answer assembly rules before implementing a consequential bridge. No new weights or replacement historical thresholds are proposed.
- **Shared streaming:** authorize a separately bounded APIS contract change/fan-out review, or explicitly accept that streaming remains unmet. The leaf must not bypass APIS or call a new provider.
- **Privacy and budgets:** name the existing teacher-role authority, accepted retention/correction policy and monetary limits for the three-lesson pilot. The current non-scoring call limits are proposals, not a financial approval.
- **Access/ownership:** restore intended-account Cloudflare access and reconcile the existing staged publisher before live backup or release work. A live baseline must be re-read, not inferred from registry history.

Local remaining engineering (teacher interface, bridge, crash recovery, streaming integration, full 尚友 summaries and missing source fixtures) is still required even if these decisions are accepted. Do not treat a sign-off on the design as permission to skip that work or acceptance checks. The project-local AGENTS instruction names suen (or a suen-designated reviewer) as the independent reviewer; this candidate does not self-certify that review.
