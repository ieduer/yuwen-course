# YW identity status and captured-submission retry repair

The authenticated page set `#identity-status.hidden=true`, but opening the atlas
also set `body.atlas-open`. The broad `.atlas-open > span` icon selector then
matched the status span directly under body, imposed a 16px grid, and overrode
the browser's hidden display. Scope the icon rule to `.icon-button.atlas-open`
and explicitly hide the status when its hidden attribute is present. The
normal pending state remains visible and reading controls remain protected.

Captured evaluation submissions had a separate retry defect. The reservation
identifier included the ten-minute rate window, while the captured answer
retained its original event identifier. Resuming after a window boundary
allocated a new identifier and rejected the original answer as a mutation
conflict. The source now validates the captured owner/item/payload first,
keeps its event identifier and reacquires capacity in the current window after
the old cooldown or lease expires. Active leases, evaluator cooldowns, current
capacity limits, immutable evidence and deduplication remain enforced. No
answer, grade, history, schema or central scoring policy is rewritten.

The generic pending-resume endpoint also sent study-guide captures into the
ordinary interaction handler, which returned 400 for that interaction type.
It now dispatches the authenticated server capture to the study-guide handler
and shares its structured error responses. Client replacement fields are
ignored; ownership, source prerequisites, cooldown and idempotency remain enforced.
A SQLite-backed HTTP regression reproduces the original 400, then verifies
current-window recovery, original event identity, one source/outbox record,
foreign-owner rejection and no duplicate evaluation. The objective fixture
uses no model provider.

Verification: the actual production CSS failure and both retry paths failed
before repair. Desktop/mobile browser checks now cover atlas open/closed,
pending/reconnected identity and preserved reader/scroll state. Source tests
cover cross-window cooldown, active-lease exclusion, changed-payload rejection,
late original/retry deduplication and a full current window with preserved
captured input. All 74 evidence-contract tests and full Node24 precontent pass.

An exact seven-day source-to-My comparison ending 2026-09-20 02:40:36 UTC found
1,449 source events and the same 1,449 central event identifiers, with zero
missing or extra records. My's YW-origin operation log contains only HTTP200
in that interval. Forty-one older retryable evaluations remain captured in
YW; they are not completed grades and must resume through their original
authenticated submission flow. Historical quarantines and legacy envelopes
are retained without retroactive scoring changes.

The fixed-window host and persisted preview diagnostics retain separate
upstream failures and redirect-policy denials. HTTP aggregates are sampled
and cannot identify every historical cause. Full evidence, current deployment
acceptance and code-only rollback are recorded in
`/Users/ylsuen/CF/reports/operations/yw-session-evidence-20260920/REPORT.md`.
Production acceptance is recorded separately from this prepared source.

Final visual acceptance also exposed `.text-button { display: inline-grid }`
overriding the hidden authenticated login link. Explicitly hide `#auth-login`
when its hidden attribute is present, and assert actual link invisibility in
the same desktop/mobile atlas regression. This follow-up fixes presentation and
cache pins; the accepted retry handlers and source/My contract are unchanged.

The same real browser pass showed three HTTP412 preview failures, all from
Bilibili video pages. Those pages now use the existing external-only preview
mode immediately, preserving the complete original URL and playback query or
fragment. No failed proxy retry, fabricated preview, new embed origin or
security exception is introduced. Other preview policies are unchanged.
