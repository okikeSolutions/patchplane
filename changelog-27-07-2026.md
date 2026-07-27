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
