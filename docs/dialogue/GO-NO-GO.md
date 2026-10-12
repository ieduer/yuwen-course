# YW conversation pilot — one-page review

As of 2026-10-12T11:42Z. **Recommendation: NO-GO for migration, production enablement or replacing the old workflow.** Proceed with review of the disabled candidate; no approval is being requested for an unfinished release.

| Review item | Actual evidence / disposition |
| --- | --- |
| Source preservation | Isolated candidate from 175f8ae; unrelated dirty canonical checkout preserved; original curriculum, app and migrations unchanged |
| Inventory | 189 lessons, 869 formal resources, 1,021 formative items, 193 active guide items; exact per-item map, gaps and compound gates |
| Local implementation | Three text/conversation pilots, gated Worker, private owner storage, verifiable proposals, question instances, versioned resume and budget-deferred drafts |
| Local checks | 89 dialogue +3 calibration +7 blueprint checks on both pinned Nodes; Reading API74;1252-file current formal artifact. Priorfb9be46 exact-head CI passed; current CI in central report; local synthesis save/reload screenshot retained |
| Performance | Local n=3 first text: desktop median 25.6 ms; mobile weak-network median 786.6 ms; old medians 270.2 ms / 18,556.0 ms. Not a production speedup claim |
| Long conversation | 200 synthetic turns; mobile CSS390x844, no horizontal overflow. Weak network150ms/200KB/s, n=3: text median983.1ms, record median1672.1ms. First-excerpt link restored all200 turns and reached the original. Physical keyboard/provider latency unverified |
| Historical production evidence | No production data writes. Explicitly approved encrypted snapshot and real isolated D1 restore accepted:28tables/39,540typed rows,62schema objects,sqlite_sequence match; local0010–0013dry run preserves every legacy row/schema/sequence and relationship; see DATA-PRESERVATION.md |
| Teaching/scoring bridge | Original vocab mastery, submitted/unfinished first reading and exact-version formal credit are projected read-only; owner history and original first-read/corrections are integrated. Five AI formal tasks now use the original evaluator; student-quote confirmation invokes them; six original choices and the non-scoring self-report now commit with the visible conversation. New dialogue mastery remains separate from original formal grades |
| AI quality / 尚友 | Ready-only five-domain model synthesis, chronological student quotes, text references and atomic reload/export implemented and structurally tested. Real semantic calibration and adversarial persona review remain pending |
| Classical mastery | Source vocabulary, stable variants and session-stable randomized whole-lesson order implemented; nine additional language instances and non-scoring evidence implemented; dictionary images verified for 而/于/何/但; empirical difficulty and real calibration remain unresolved |
| Streaming / cost | APIS/YW real SSE and hard-crash fencing implemented locally. User-approved US$50/day Gemini policy reserved atomically. Complete108-alias source-reference inventory is reconciled; live stream/cost acceptance and shared-hub release remain pending |
| Privacy / teacher use | All authenticated My accounts, own records only; permanent retention approved. Owner export/review request implemented; append-only correction implemented; no cross-student grants/dashboard authorized |
| Sources / mobile | Eight original dictionary pages visually verified; Beijing newspaper question references text-verified. Original papers/official marking, grammar calibration and physical keyboard/accessibility remain pending |
| Infrastructure access | Earlier canonical same-account credential readback confirmed Pages/D1 metadata and APIS runtime; refresh only at the relevant boundary; connector still has no account. Verified source backup and complete isolated restore accepted; no production data mutation |
| Publication | No merge, migration, feature activation, release receipt, public Status update or monitoring change. Existing Pulse remains in place |

## Remaining work and existing review gate

- **Equivalence:** proposed approach keeps each original task's exact rubric, resource/version and scoring role; dialogue may collect its required answer parts across turns, but the existing source evaluator alone produces credit. A verified old completion stays complete; uncertain mappings go to review. The authorized bridge preserves these rules; any new scoring policy would still require approval. No new weights or replacement historical thresholds are proposed.
- **Shared streaming:** already authorized by suen; code is implemented and tested locally. The complete source-reference inventory is reconciled; finish isolated authentication, the existing release gate and actual stream acceptance. No direct provider path or Claude API is added.
- **Privacy and budgets:** user-approved own-record-only My access, permanent retention and US$50 daily Gemini cap are incorporated. No cross-student teacher grant exists; corrections must preserve originals. Do not infer a teacher role from general My membership.
- **Access/ownership:** same-account documented read access recovered. Reconcile the staged publisher and recheck release-time live/backup coverage before a governed release; this dated snapshot has verified backup/restore. The connector itself is not repaired.

Remaining source/teaching acceptance (real semantic calibration, empirical difficulty and live dictionary accessibility) is still required even if these decisions are accepted. Do not treat a sign-off on the design as permission to skip that work or acceptance checks. The project-local AGENTS instruction names suen (or a suen-designated reviewer) as the independent reviewer; this candidate does not self-certify that review.
