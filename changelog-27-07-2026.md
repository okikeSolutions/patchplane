# Implementation changelog — 27-07-2026

## Task 1 — M7.5 critical-path breadcrumbs

Status: Complete

- Added branded, bounded constants for critical-path stages and breadcrumb statuses.
- Added fail-open Effect helpers for recording one-off breadcrumbs, wrapping started/succeeded/failed transitions, and creating request-local breadcrumb scopes.
- Instrumented intake acceptance, attempt creation and claim, requirement persistence, sandbox execution, candidate freeze, verification, review, policy, human decision, rerun creation, and publication claim/result transitions.
- Records duplicate attempt claims, empty candidate captures, and lost/replayed publication claims as `blocked`; failed publication outcomes are not reported as successful merely because their durable failure record was stored.
- Scoped server-function, GitHub webhook, rerun-execution, and decision-publication breadcrumbs to the request that captures the associated failure so concurrent requests cannot share breadcrumb history.
- Preserves Effect interruption semantics while keeping ordinary telemetry defects fail-open.
- Added domain/helper/workflow regression coverage for bounded values, transition ordering, failure and blocked recording, interruption and fail-open behavior, intake/attempt breadcrumbs, review/policy transitions, and successful/failed/replayed publication transitions.
- Marked the breadcrumb task complete in `ROADMAP.md` and sequence item 1 complete in `docs/repository-verification-capability-tracker.md`. The broader M7.5 deployed-readback and handled-failure acceptance gaps remain open.

Validation:

- `bun run verify` — passed (types, lint, unit/integration tests, CLI eval, roadmap/acceptance consistency, production build, and bundle budgets).
- Herdr Effect/branded-types audit — no actionable findings after remediation.
- Herdr documentation/tracker audit — no actionable findings after remediation.
- Herdr code review — no actionable findings after remediation.

## Task 2 — CAND-003/CAND-004 incoming PR identity

Status: Complete

- Added PatchPlane-owned discriminated candidate-subject schemas that keep incoming pull-request and sandbox-generated origins distinct without provider SDK objects.
- Incoming PR subjects carry normalized repository/PR identity, authenticated base/head SHAs, and source-event identity; captured candidate records continue to carry the exact diff digest.
- GitHub pull-request webhook decoding now requires both `base.sha` and `head.sha` and preserves both through normalized events and generic external workflow refs.
- Current `incoming-pr-v1` workflow attempts persist `sourceBaseSha` and the existing head `sourceCommitSha`; current reruns copy both revisions while historical V1 rows remain compatible.
- Fixed PR-event idempotency so redelivery of the same base/head pair reuses its attempt across opened/synchronize actions while either revision changing creates a new linked attempt that cannot inherit candidate rows from the prior attempt.
- Bound PR attempt ordering to GitHub's signed `updated_at` plus synchronize `before`/`after` head transition, rejecting delayed unseen events, stale reruns, stale execution claims, and cross-workspace delivery reuse.
- Added domain, GitHub normalization/intake, Convex persistence, rerun-lineage, and synchronize-attempt regression coverage.
- Marked sequence item 2 complete and updated `CAND-003` to `Implemented` and `CAND-004` to `Verified`; exact R2-backed candidate capture remains task 3.

Validation:

- `bun run verify` — passed.
- Herdr Effect/branded-types audit — no actionable findings after remediation.
- Herdr documentation/tracker audit — no actionable findings after remediation.
- Herdr code/security review — no actionable findings after remediation.
