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

## Task 3 — CAND-005/CAND-007 exact incoming candidate freeze

Status: Complete

- Fetches the GitHub comparison explicitly by the webhook-authenticated base and head SHAs, never from a mutable current-PR diff or the truncated changed-files JSON list.
- Streams at most 10 MiB with a deadline and fails closed on unavailable or unacceptable responses, unexpected content types, truncation, invalid UTF-8, binary patches, missing commits, and ambiguous comparison output.
- Hashes the exact accepted bytes with SHA-256, writes them to a deterministic conflict-safe R2 key, and persists matching producer/subject/artifact/candidate identity in Convex before any Daytona or Pi dispatch.
- Uses latest-lineage, owner-token freeze leases to fence stale capture workers; permanent rejections durably fail with provenance while transient failures remain resumable.
- Requires a durable incoming candidate before issuing an opaque candidate-bound dispatch token. Daytona start, failure, and result persistence are fenced by token, latest attempt, and the durably recorded sandbox ID.
- Adds scheduled token-and-sandbox-fenced recovery for crashes before or after sandbox-result persistence, without treating telemetry or provider success as provenance.
- Preserves historical V1 and sandbox-generated candidate behavior without representing either as incoming-PR verification.
- Retains immutable R2 objects after ambiguous metadata-write failures for reconciliation instead of destructively deleting potentially committed evidence.
- Marked sequence item 3 complete, `CAND-003` Verified, and `CAND-005`/`CAND-007` Implemented. Credentialed exact-diff dogfood and downstream trusted-plan/execution work remain open.

Validation:

- `bun run verify` — passed (types, lint, all automated tests, CLI eval, roadmap acceptance, production build, and bundle budgets).
- Herdr Effect/branded-types audit — no actionable findings after remediation.
- Herdr documentation/tracker audit — no actionable findings after remediation.
- Herdr code/security review — no actionable findings after remediation.

## Task 4 — PLAN-002/PLAN-003/PLAN-005 trusted bounded plan

Status: Complete

- Added branded `VerificationPlanV1` identity with version, workflow, trusted source revisions, ordered requirements, canonical SHA-256 digest, and creation time.
- Resolves non-negotiable deployment policy before optional authorized workspace policy and optional repository-scoped policy bound to the webhook-authenticated base SHA.
- Bounds policy JSON and canonical plans by UTF-8 bytes, source count/order/identity, 16 unique requirements, command/key/label/architecture sizes, per-command timeout, and artifact budget.
- Convex independently recomputes the canonical digest, validates the PatchPlane-owned contract, provides exact replay after freeze, and rejects conflicting or incomplete plan/requirement persistence.
- Candidate freeze now requires the complete persisted plan requirement set; retries reuse original plan and requirement timestamps.
- Passes a deep-frozen, WeakSet-issued plan capability across the freeze/dispatch boundary and validates exact requirement semantics at runtime.
- Preserves historical planless execution while rejecting all incoming-PR verifier output from the untrusted agent sandbox. Fresh candidate-bound execution groups remain Task 5, so missing incoming results stay explicitly incomplete.
- Added resolver precedence/bounds, source-control config, Convex ordering/replay, and plan-before-freeze coverage.

Validation:

- `bun run verify` — passed (types, lint, all automated tests, CLI eval, roadmap acceptance, production build, and bundle budgets).
- Herdr Effect/branded-types audit — no actionable findings after remediation.
- Herdr documentation/tracker audit — no actionable findings after remediation.
- Herdr code/security review — no actionable findings after remediation.

## Task 5 — EXEC-003/EXEC-004/EXEC-005/EXEC-007 execution envelopes

Status: Complete

- Added branded stable per-requirement execution groups bound to the persisted plan, exact incoming candidate, and durable incoming-dispatch token.
- Claims, provider+sandbox identities, sandbox execution writes, and result writes are fenced, idempotent, replayable after ambiguous commits, and protected by scheduled group/plan recovery.
- Supported Linux requirements execute once in separate fresh Daytona sandboxes; non-Linux or commandless requirements persist explicit blocked envelopes without receiving agent-sandbox credit.
- Added PatchPlane-owned command envelopes with independently recomputed command digest, bounded planned/effective timeout, platform/architecture, timing/exit, candidate mutation digests, artifact identity, log capture state, and cleanup outcome.
- Attempts deterministic bounded stdout and stderr R2 capture for every trusted invocation, persists artifacts when capture succeeds, and records explicit failure/truncation that prevents `passed`.
- Bounds and validates provider result cardinality, output bytes, artifact count/bytes, identifiers, and timestamps before persistence.
- Reloads complete durable group/result state before policy evaluation so crash replay, blocked-only plans, provider failures, and zero-requirement plans cannot finalize from a partial invocation snapshot.
- Projects the coherent frozen incoming candidate plus per-check plan/group/command/log/cleanup identity in Patch Report V1.
- Effective Daytona image/isolation readback, cleanup polling to not-found, credentialed incoming-PR execution, Windows/Computer Use, and canonical publication remain later acceptance tasks.

Validation:

- `bun run verify` — passed (types, lint, all automated tests, CLI eval, roadmap acceptance, production build, and bundle budgets).
- Herdr Effect/branded-types audit — no actionable findings after remediation.
- Herdr documentation/tracker audit — no actionable findings after remediation.
- Herdr code/security review — no actionable findings after remediation.
