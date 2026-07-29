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

## Task 6 — supported Linux provider proof

Status: Reopened after post-review transient-mutation analysis; provider lifecycle evidence remains valid

- Added PatchPlane-owned effective sandbox environment identity covering the PatchPlane-declared class source, provider image/snapshot identity, target, OS, architecture, provider state, public/link/volume posture, resources, network settings, lifecycle settings, and observation time.
- Trusted Linux execution refreshes provider state and runs an independent OS/architecture probe before the repository requirement; requested/effective lifecycle, network, and resource mismatches fail closed.
- Incoming verification cannot pass without a complete matching effective Linux environment, exact candidate state, bounded artifacts/logs, and cleanup confirmation.
- Daytona deletion is now credited only after bounded provider polling observes a structured SDK not-found result; deletion API success without readback confirmation remains failed cleanup. Worker-crash cleanup reconciliation remains open and cannot receive deletion credit.
- Durable verification results bind the resolved environment image to candidate/plan/group/command/log/cleanup identity.
- Switched trusted requirements from one blocking provider call to Daytona asynchronous process sessions: bounded provider session/command IDs are persisted on the fenced execution group before terminal polling, bounded log snapshots, process-session deletion, and sandbox cleanup.
- Kept PTY and live log streaming outside deterministic verification credit; PTY is interactive state, while provider log snapshots remain untrusted until bounded and persisted as PatchPlane evidence.
- Added domain, Daytona, Convex, source-control smoke, and provider regression coverage.
- Credentialed PR 129 directly proved exact-head Daytona checkout, effective environment readback, trusted command execution, and structured delete-to-not-found. At that point, the hosted path had proved candidate freeze, plan/group claim, and sandbox start but had not persisted a terminal result; its experimental queue was removed rather than retained as unverified architecture. The temporary PR/branch and queued messages were cleaned up before the later PR 150 acceptance run.

Validation:

- `bun run verify` — passed after the hosted acceptance, native provider-deadline remediation, documentation updates, and 37-test Daytona boundary suite.
- Credentialed direct Daytona PR 129 lifecycle/readback probe — passed; sandbox deletion confirmed.
- Credentialed hosted PR 129 smoke — incomplete; no terminal Convex result, no acceptance claim, experimental queue removed, and temporary PR/branch removed.
- Reintroduced the hosted queue only after adding a digest-bound Convex ingress receipt, raw-envelope R2 outbox, scheduled replay for ambiguous sends, one-message terminal acknowledgements, delayed DLQ recovery, whole-service abort bounds, and per-requirement terminal synthesis. Each authenticated receipt now binds atomically to the exact new or reused candidate workflow so redeliveries cannot lose terminal identity.
- Hosted PR 131 proved queue delivery, workflow reuse, receipt/workflow binding, and a terminal `completed` receipt. Its immutable workflow had already persisted an empty plan before the Linux command was deployed, so it produced no execution group and granted no Task 6 acceptance.
- No-PR experiments isolated the remaining hosted failure to Cloudflare Free's 50-external-subrequest limit. Cloudflare Workflows share that 50-request budget across the whole free-plan workflow instance and therefore did not solve it; a two-Worker service-binding experiment proved separate invocation budgets, while replacing evidence-probe sessions with bounded stateless Daytona commands reduced each probe from three provider requests to one without weakening the durable asynchronous identity of the trusted requirement.
- Hosted PR 150 completed in about 20 seconds on the free plan: workflow `ms7exrs2kbe5ng7gsrtk3m7c698bf449`, exact head `b520e8435f36b1cc7498d898d8ace927b51e11a1`, candidate `qh7b8r6q992rea3jjc757qkaq98bf8pm`, plan `s577pa9bm0ekkpnhneyrck1n0h8bfre7`, group `s171pg1nfekjm4y7dnqneckd5n8bfmhs`, sandbox execution `ps7e4qyreb7w2et356bz2532418bftwz`, and result `rs7bhcpct7ce5var1j33yftvs18ben6q`. The result passed with candidate-bound test-report/diff/stdout/stderr artifacts, effective Linux environment readback, durable provider process identity, and delete-to-not-found cleanup; queue delivery `5b7118c0-8b27-11f1-87de-7a284358103f` became terminal/completed and the workflow reached `reviewed`. The temporary PR and branch were removed.
- Herdr Effect/branded-types audit — no actionable findings after native sandbox-creation and absolute cleanup-deadline remediation.
- Herdr documentation/tracker audit — no actionable findings after PR 150 capability/evidence reconciliation.
- Herdr code/security review — no actionable findings.

### Post-review Task 1–6 hardening

- Rejected uppercase and mixed-case Git SHA-1/SHA-256 identifiers at domain, GitHub, Convex, and Daytona boundaries instead of silently canonicalizing them.
- Required exact repository HEAD observations before and after trusted Linux execution in addition to frozen final-state digests. Endpoint snapshots reject persistent mutation and HEAD drift; transient edit/restore is now explicitly uncredited until provider-attested protected source execution exists.
- Bounded every queue-to-source-control service-binding response by one owned whole-response deadline, strict JSON content type, fatal UTF-8 decoding, and a 16 KiB byte cap, including delayed DLQ recovery.
- Failed malformed provider-envelope cleanup provenance closed to `failed` rather than copying an untrusted cleanup status.
- Required R2 provider-validated SHA-256 checksums for upload, idempotent reconciliation, metadata reads, and retention readback; custom metadata alone is no longer checksum authority.
- Revalidated the Convex candidate evidence row and matching provider-checksummed R2 object immediately before issuing an incoming dispatch claim.
