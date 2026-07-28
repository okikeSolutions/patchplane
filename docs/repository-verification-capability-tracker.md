# Repository verification capability tracker

This document tracks the product and implementation work required to verify
repository-defined changes without embedding logic for one pull request or one
repository.

It is based on:

- the PatchPlane product and trust model in [`SPEC.md`](../SPEC.md),
- the candidate identity rules in
  [`ADR 0001`](./adr/0001-attempt-candidate-evidence-identity.md),
- the alpha acceptance matrix in [`acceptance-tests.md`](./acceptance-tests.md),
- the critical path in [`critical-path.md`](./critical-path.md),
- [Daytona sandbox documentation](https://www.daytona.io/docs/en/sandboxes/),
  [isolation documentation](https://www.daytona.io/docs/en/isolation/),
  [persistence documentation](https://www.daytona.io/docs/en/persistence/),
  [scale documentation](https://www.daytona.io/docs/en/scale/),
  [process execution documentation](https://www.daytona.io/docs/en/process-code-execution/),
  [Git operations documentation](https://www.daytona.io/docs/en/git-operations/),
  and [Computer Use documentation](https://www.daytona.io/docs/en/computer-use/)
  for advertised isolation, Linux container/VM and Windows VM classes,
  ephemeral lifecycle controls, resources, command timeouts, sessions, logs,
  and Linux/Windows desktop automation,
- [in-toto layouts](https://in-toto.io/docs/getting-started/) for the separation
  of trusted requirements, execution steps, materials, products, and evidence,
- [SLSA build requirements](https://slsa.dev/spec/v1.2/build-requirements) for
  hosted isolation and control-plane-generated provenance,
- [GitHub pull-request workflow
  semantics](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request)
  for the distinction between PR heads and synthetic merge commits, and
- [GitHub rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)
  and the [Checks API](https://docs.github.com/en/rest/checks/runs) for
  commit-bound external checks and canonical publication.

This is a capability tracker, not authorization to implement every row. Update
status, evidence, owner, and dependencies as design decisions, tests, provider
configuration, and live acceptance work land.

## Fit with the governing alpha product

This tracker is an **alpha correctness and release-closure tracker**, not a
post-alpha expansion plan. [`SPEC.md`](../SPEC.md), [`ROADMAP.md`](../ROADMAP.md),
and [`ADR 0001`](./adr/0001-attempt-candidate-evidence-identity.md) remain
authoritative and must change with this tracker when an identity or acceptance
rule changes.

The alpha product subject is the immutable AI-authored change a maintainer is
being asked to trust. For GitHub pull-request intake, that is the exact
`baseSha...headSha` candidate received from GitHub. Asking Pi to modify the PR
head creates a different patch and cannot verify the incoming PR. The existing
sandbox-generated candidate path remains useful implementation foundation, but
it does not satisfy the GitHub PR verification claim.

This is a correction to the alpha's subject binding, not an additional product
mode:

- alpha verifies one incoming GitHub PR candidate; it does not offer a generic
  choice between “generate” and “audit” modes;
- the candidate is frozen before any agent, repository command, review, or
  policy execution;
- Pi may perform read-only analysis after freeze, but Pi exit status or output
  cannot satisfy deterministic verification;
- Daytona is the only alpha execution provider, with Linux, bounded Windows,
  and Computer Use capabilities described below; and
- arbitrary CI orchestration, automatic workflow inference, synthetic-merge
  verification, macOS execution, and additional providers remain deferred.

`ADR 0001` now governs the exact incoming PR candidate. The alpha still cannot
claim incoming-PR verification until exact comparison bytes are durably frozen
before untrusted execution and all results bind to that frozen candidate. Until
then, the product must report incoming PR verification as unavailable rather
than publish “verification passed.”

## Alpha product outcome

PatchPlane processes one exact incoming pull-request patch through this bounded
trust loop:

```text
authenticated PR intake
→ immutable attempt and base/head identity
→ trusted bounded verification plan
→ exact candidate freeze
→ isolated Daytona requirement execution
→ candidate-bound evidence
→ independent read-only review and policy
→ human decision
→ one canonical exact-head GitHub publication
```

“Verification passed” means every required item in the persisted trusted plan
passed against that exact candidate in a supported PatchPlane environment. It
does not mean PatchPlane guessed every check a repository could need. Missing
configuration, unsupported platforms, absent artifacts, provider errors,
candidate mutation, and unavailable environments remain explicit gaps.

## Alpha scope decisions

| Area                              | Alpha decision                                     | Boundary                                                                                                                           |
| --------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Candidate subject                 | Exact incoming PR `baseSha...headSha`              | Sandbox-generated changes are a different candidate and cannot verify the incoming PR                                              |
| Repository verification contract  | Include a versioned, bounded plan                  | Resolve from PatchPlane workspace policy or the pinned base revision                                                               |
| Candidate-authored policy changes | Do not apply to the candidate that proposes them   | Show as proposed changes; apply only after merge or authorized workspace adoption                                                  |
| Requirement discovery             | Defer automatic inference                          | Do not infer trust requirements from changed paths, package scripts, or CI YAML                                                    |
| Command orchestration             | Include a bounded list                             | No arbitrary DAG, generic CI workflow language, or shared build-cache platform                                                     |
| Linux execution                   | Include through Daytona                            | Preserve exact command, provider, platform, timing, result, and artifact evidence                                                  |
| Windows execution                 | Include through Daytona `windows-small`            | Installed Daytona SDK supports Windows snapshot selection; PatchPlane still needs PowerShell-compatible commands and live evidence |
| macOS execution                   | Exclude from alpha                                 | Daytona Computer Use lists macOS as private alpha; PatchPlane has no supported alpha executor, so requirements remain blocked      |
| Browser/GUI evidence              | Include through Daytona Computer Use when required | Linux/Windows support is provider capability only until PatchPlane's adapter and live smoke bind visual artifacts to the candidate |
| External GitHub checks            | Context only                                       | A hosted conclusion is not PatchPlane verification and cannot fill a missing Daytona result                                        |
| Synthetic merge verification      | Defer                                              | Never present merge-ref evidence as if it ran against the PR head                                                                  |
| Automated review                  | Include as a separate read-only stage              | Agent completion or review does not satisfy deterministic verification                                                             |
| Human override                    | Include for incomplete evidence                    | An override changes the decision, not the recorded verification result                                                             |
| Publication                       | Include one canonical report and exact-head check  | Publication must remain idempotent and pinned to the reviewed candidate projection                                                 |
| Signed attestations               | Defer                                              | Preserve enough identity and evidence to add attestations later without claiming them now                                          |

The Daytona-only alpha environment envelope is Linux, Windows, and browser/GUI
verification. macOS and production deployment execution remain out of scope.

## Status model

Status values are `Not started`, `Designing`, `In progress`, `Implemented`,
`Verified`, and `Blocked`.

- `Implemented`: the capability has landed, but its stated acceptance evidence
  is incomplete.
- `Verified`: all automated and live evidence named by the row exists for the
  current implementation.
- `Blocked`: progress depends on an explicit product decision, provider
  capability, permission, or external owner recorded in the row.

A domain type or mock test alone does not verify a hosted capability. Conversely,
a provider limitation must produce a truthful blocked result rather than block
PatchPlane from producing an incomplete Patch Report.

## Alpha verification environment envelope

| Repository requirement      | PatchPlane verification environment                | Current status       | Truthful outcome today                                                    |
| --------------------------- | -------------------------------------------------- | -------------------- | ------------------------------------------------------------------------- |
| Ubuntu x64 tests            | Ephemeral Daytona Linux sandbox                    | Verified foundation  | Run only declared candidate-bound requirements                            |
| Windows behavior            | Ephemeral Daytona `windows-small` sandbox          | Designing            | `blocked` until the PowerShell/evidence adapter and live smoke pass       |
| Browser/GUI behavior        | Daytona Computer Use on a Linux or Windows sandbox | Designing            | `blocked` until the adapter and credentialed candidate-bound smoke pass   |
| macOS ARM64 behavior        | No alpha provider                                  | Blocked              | `blocked`; approval requires an explicit durable override                 |
| Production deployment smoke | Secret-free local equivalent when one is declared  | Capability-dependent | Otherwise `blocked`; never inject production credentials into the sandbox |

Linux and Windows use the same Daytona provider boundary. Daytona fleet scaling
is not an alpha product feature: PatchPlane uses only the minimum bounded
execution groups required by the trusted plan. The alpha does not need or permit
normal GitHub CI as its primary verification executor.

## Daytona capability assessment

Reviewed on 2026-07-27. Daytona's current documentation advertises:

- runtime, network, and organization isolation boundaries;
- Linux containers with dedicated namespaces/resource limits, plus Linux and
  Windows VMs with their own kernels;
- per-sandbox reserved vCPU, memory, and disk hard limits;
- `windows-small`, `windows-medium`, and `windows-large` snapshots;
- persistent sandboxes by default: stop preserves filesystem, VM pause preserves
  memory, and deletion/ephemeral/auto-delete are separate lifecycle choices;
- ephemeral sandboxes that are deleted on stop, plus explicit auto-stop,
  auto-pause, auto-archive, and auto-delete controls;
- configurable CPU, memory, disk, and network policy, with tier-dependent
  default egress and essential-service exceptions;
- command working directory, environment, timeout, session status, exit code,
  and log-streaming APIs;
- provider Git operations that clone an exact commit in detached-HEAD state,
  report repository/file status, check out revisions, and expose commit history
  without requiring shell Git inside the sandbox;
- Computer Use on Linux and Windows, including desktop-process lifecycle,
  mouse, keyboard, screenshots, recordings, display inspection, and Linux
  accessibility operations;
- macOS Computer Use in private alpha rather than general availability; and
- authenticated preview/SSH ingress unless a preview is explicitly public;
- no sandbox-to-sandbox network unless linked sandboxes are explicitly used;
- organization-scoped resources, API-key permissions, managed keys, secret
  substitution, and volume subpaths; and
- snapshots and VM forks that preserve prior filesystem or memory state;
- vertical resize, concurrent sandbox fleets, and concurrent sessions/background
  processes within one shared sandbox; and
- organization/class/region compute pools plus per-sandbox and API rate limits.

PatchPlane configures ordinary executions as ephemeral, retries explicit
deletion, maps resource/network options, persists normalized sandbox policy,
executes exact-checkout commands with bounded timeouts, and has live Linux
lifecycle evidence. RPC sessions are an explicit exception: they are retained
after acquisition so the caller can interact with them, and must later be
terminated and deleted through the runtime-session lifecycle. These provider claims are useful inputs, not
PatchPlane provenance by themselves. A requested `block all` policy is not proof
of zero egress because Daytona documents tier behavior and essential-service
exceptions. Likewise, provider organization isolation does not replace
PatchPlane workspace authorization or prove that no credential reached
untrusted code. Daytona sessions have separate shell state but share their
sandbox filesystem and network; they are concurrency, not independent
verification environments. Capacity or rate-limit failures are provider
outcomes, not repository test failures.

The documentation changes two planning assumptions. First, Windows is a
plausible Daytona-backed provider path rather than requiring a second vendor.
Second, Daytona's Git API can clone a specific commit and inspect repository
status without relying on POSIX shell Git. PatchPlane already passes an optional
`commitId` to `sandbox.git.clone`, so exact detached-head clone is implementation
foundation that can be reused on Windows. Neither provider capability makes
Windows verification complete. PatchPlane still needs trusted snapshot
selection, decoded and persisted head/status evidence, Windows command and path
semantics, tool installation, candidate digest parity, artifact collection,
secret isolation, teardown, and control-plane result envelopes in a
credentialed smoke. Daytona documents macOS Computer Use as private alpha, but
PatchPlane has no generally available, supported macOS executor and does not
include private-alpha macOS in its verification plane. macOS requirements
therefore remain explicitly blocked in the PatchPlane alpha.

Persistence must not become implicit verification state. Stop, pause, archive,
snapshots, forks, and volumes can retain filesystem or memory; provider defaults
are therefore unsafe as cleanup assumptions. Any future state reuse requires a
trusted immutable environment identity and explicit disclosure;
candidate-created snapshots cannot establish the environment used to verify
themselves. Alpha completion requires explicit sandbox deletion and provider
readback that it no longer exists. A retained RPC sandbox needs a bounded owner,
reason, expiry/reconciliation path, and eventual deletion evidence.

### Daytona-to-PatchPlane mapping

| Daytona capability               | Provider documentation                                                                                                            | PatchPlane today                                                                                                                    | Tracker consequence                                                                                                                        |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Linux container                  | Default sandbox class                                                                                                             | Integrated and covered by live lifecycle/R2 smokes                                                                                  | Keep `EXEC-001` verified; record the resolved class in `EXEC-010`                                                                          |
| Linux VM                         | `daytona-vm-small`, `daytona-vm-medium`, and `daytona-vm-large` snapshots                                                         | Not selected or distinguished by the provider contract                                                                              | Treat as a separate executor capability; do not imply VM isolation from a generic `linux` label                                            |
| Windows VM                       | `windows-small`, `windows-medium`, and `windows-large` snapshots; TypeScript SDK creation is `daytona.create({ snapshot })`       | Installed SDK supports snapshot creation, but PatchPlane does not select a snapshot and planning blocks every non-Linux requirement | Add trusted snapshot selection and a Windows command/evidence implementation under `EXEC-008`                                              |
| Git clone/status/history         | Clone accepts an exact `commitId`; status reports branch/file state; Toolbox history exposes commit hashes                        | Adapter already passes `commitId` to clone; it does not decode/persist provider status/history as candidate evidence                | Use exact-commit clone and validated status/history on Linux/Windows, while retaining independent digest checks                            |
| Computer Use                     | Linux and Windows desktop automation with process lifecycle, input, display, screenshot, and recording APIs                       | Installed SDK exposes `sandbox.computerUse`; PatchPlane has no provider adapter or live candidate-bound smoke                       | Add `EXEC-012`; do not present generic browser artifact capture as verified Computer Use execution                                         |
| macOS Computer Use               | Private alpha, not generally available                                                                                            | Domain can represent `macos`; PatchPlane has no supported alpha executor                                                            | Keep `EXEC-009` blocked and report the unavailable platform truthfully                                                                     |
| Persistence and deletion         | Sandboxes persist by default; stop preserves files, VM pause preserves memory; ephemeral/delete/auto-delete remove state          | Ordinary runs are ephemeral and explicitly deleted; RPC mode deliberately retains a sandbox until session termination               | A stopped/paused/archived state is not cleanup; require delete-and-readback evidence and bounded retained-session reconciliation           |
| CPU, memory, and disk            | Image creation accepts resources; snapshots inherit them; resize can mutate an existing environment                               | Environment configuration maps requested values and persists normalized policy                                                      | Record resolved inherited limits and forbid verification-time resize so the environment cannot drift                                       |
| Network controls                 | Per-sandbox firewall; tier-dependent default egress; block/CIDR/domain modes; essential services remain reachable                 | Adapter maps configured block/allow options and stores normalized policy                                                            | Record resolved tier/effective exceptions and verify representative allowed/denied egress; configuration alone is not enforcement evidence |
| Inbound and linked networking    | Preview/SSH ingress is authenticated unless public; linked sandboxes deliberately share a network                                 | Alpha does not intentionally require public previews, SSH, or linked sandboxes                                                      | Reject public previews or linked sandboxes; record any required authenticated ingress explicitly                                           |
| Organization and secrets         | Organization boundary, scoped/managed API keys, proxy-substituted secrets, and volume subpaths                                    | PatchPlane uses its control-plane Daytona key and forbids long-lived control-plane credentials in sandbox inputs                    | Keep PatchPlane authorization independent; do not call proxy-substituted credentials a secret-free run                                     |
| Command execution                | Supports working directory, environment, timeout, result, and exit status                                                         | Linux command/session adapter uses bounded execution and captures normalized output                                                 | Reuse for `EXEC-003`/`EXEC-004`, while persisting bounded stdout/stderr as R2 artifacts                                                    |
| Sessions and log streaming       | Concurrent sessions have separate shell state but share filesystem/network; background processes outlive one request              | Pi RPC uses Daytona sessions and normalized runtime ingestion                                                                       | Disclose shared execution groups, bound/cancel background work, and keep runtime logs separate from verification evidence                  |
| Fleet capacity and rate limits   | Compute pools are organization/region/class scoped; lifecycle/API rates are tier-limited and may return retry timing              | No alpha execution-group scheduler or normalized capacity/rate-limit outcome                                                        | Bound per-attempt/global concurrency, honor bounded retry timing, and report provider capacity separately from repository test failure     |
| Stop/pause/archive/snapshot/fork | Stop/archive/cold snapshots preserve filesystem; VM pause/hot snapshots/forks preserve memory; snapshots/volumes outlive deletion | Not part of the alpha verification trust contract except bounded live RPC retention                                                 | Never treat stop/pause/archive as cleanup; forbid derived persistent state and prove retained RPC sessions are eventually deleted          |

The Daytona Windows spike no longer needs to prove that the TypeScript SDK has
a snapshot parameter or can clone a specific commit; both contracts exist and
the adapter already supplies `commitId`. It must first prove that the PatchPlane
account can create and delete `windows-small`, then decode provider Git
status/history through PatchPlane-owned schemas and establish PowerShell/shell
behavior, path handling, tool installation, artifact transfer, digest parity,
timeout/cancellation, and network policy. `sandbox.git.status()` is useful for
cleanliness and file-state evidence, but it does not hash candidate bytes and
the installed toolbox `GitStatus` type does not expose HEAD SHA. Status alone
cannot prove exact candidate identity or detect a command that moves HEAD while
leaving a clean worktree. PatchPlane must also verify the checked-out commit
(for example via validated provider history or a trusted platform-specific
probe) and independently compare the frozen candidate digest before/after.

The remaining adapter is POSIX-specific: candidate capture and evidence commands
use `uname`, `sha256sum`, `rm`, `mktemp`, `trap`, `/dev/null`, and shell quoting.
Selecting a Windows snapshot without replacing those commands would create a
sandbox but would not produce trustworthy verification. Only a live smoke may
move `EXEC-008` from `Implemented` to `Verified`.

## Alpha dogfood truth check: guerillaglass PR 128

Reviewed on 2026-07-27 against
[`okikeSolutions/guerillaglass#128`](https://github.com/okikeSolutions/guerillaglass/pull/128):

- GitHub identifies the incoming candidate as base
  `cddd7d7e5f27c69ad60fdb331fd2f76173dcfc74` and head
  `24107cffe0413e55b34c8ec49bceb22532cd841f`.
- Eight hosted checks currently pass and no review thread is unresolved. Those
  are useful context, not PatchPlane verification evidence.
- PatchPlane published three separate comments labeled “verification passed.”
  They identify Pi invocation and exit `0`, paste raw/truncated agent JSONL, and
  do not identify the exact incoming base/head candidate or durable results for
  the PR's declared TypeScript, Rust, Swift, protocol, parity, and macOS checks.
- One comment is a PatchPlane live-smoke candidate that asks Pi to create
  `.patchplane/live-e2e.txt`; it is unrelated to the PR 128 candidate.
- The required macOS Agent Mode smoke has no supported PatchPlane alpha
  executor. It must remain `blocked`; hosted macOS CI cannot silently satisfy
  the Daytona-only plan.

The truthful PatchPlane outcome for PR 128 is therefore **not verified /
incomplete**, not “verification passed.” The existing comments demonstrate
sandboxed agent activity and publication plumbing only. They should not be used
as promotional proof and should be replaced or visibly superseded by one
canonical correction.

PR 128 becomes valid **incomplete/override-path** alpha dogfood only after
PatchPlane freezes the exact incoming candidate, resolves a trusted bounded
plan, runs every supported requirement through PatchPlane-owned Daytona
execution, records unsupported macOS truthfully, obtains the human decision,
and publishes one exact-head report. Because its required Agent Mode smoke is
macOS-only, PR 128 cannot demonstrate a fully passed alpha verification. A
second PR whose requirements fit Linux, Windows, and/or Computer Use must prove
the fully passed path. These are alpha release bars, not future expansion.

### Promotion rule

Before `LIVE-001` and `LIVE-002` pass, promote PatchPlane only as an open-source
alpha **building** independent evidence-backed PR verification. Do not quote the
current PR 128 PatchPlane comments, say “verification passed,” or imply macOS
coverage.

After those gates pass, the defensible product sentence is:

> PatchPlane independently runs the declared checks for an exact AI-authored PR
> candidate in isolated Daytona environments, preserves candidate-bound
> evidence, shows unsupported requirements, and publishes one human-gated Patch
> Report back to the exact commit.

A public demo must show, in one uninterrupted candidate-bound flow:

1. repository/PR plus base and head SHA;
2. trusted required checks before execution;
3. Daytona environment identity and command envelopes;
4. pass/fail/blocked outcomes with durable artifact hashes;
5. the explicit macOS gap when applicable;
6. the authenticated human decision; and
7. one canonical exact-head GitHub report/check with replay and no duplicates.

The sellable wedge is not “another AI reviewer.” It is reliable execution and
evidence for the exact change a maintainer is already considering.

## Current progress snapshot

Updated on 2026-07-27 from the current implementation and
[`acceptance-tests.md`](./acceptance-tests.md).

| Workstream            | Available foundation                                                                                                      | Active or implemented, evidence pending                                                                                                              | Missing or blocked                                                                                              | Next gate                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Candidate identity    | Immutable attempts, webhook-authenticated base/head pinning, exact bounded comparison capture, R2/Convex candidate freeze | Incoming-PR capture and dispatch fencing are implemented with automated evidence                                                                     | Credentialed exact-diff dogfood and full downstream candidate-bound verification                                | Prove the frozen candidate in a live supported PR run                 |
| Verification plan     | Versioned SHA-256 plan, bounded requirements, deployment/workspace/base-policy precedence, pre-freeze persistence         | Incoming requirements execute through candidate/plan-bound groups and project per-check plan/group identity; agent-sandbox output remains uncredited | Aggregate plan digest/source/count projection and credentialed policy execution                                 | Complete aggregate `PLAN-008` report coverage                         |
| Execution             | Daytona lifecycle, exact checkout, Linux command execution, before/after candidate digests                                | Fresh sequential Linux groups have dispatch-token fencing, stable claims, replay/recovery, bounded command envelopes, and forced cleanup attempts    | Credentialed incoming execution, effective environment identity, delete-to-not-found, Windows, and Computer Use | Prove one supported Linux PR with lifecycle readback                  |
| Evidence and coverage | R2 artifacts, Convex metadata, hashes, requirement coverage, Patch Report V1                                              | Control-plane envelopes and bounded stdout/stderr R2 artifacts are candidate/plan/group-bound; repository artifacts remain untrusted                 | Effective environment/deletion evidence and trusted external-check adapter                                      | Add lifecycle readback and canonical publication                      |
| Review and decision   | Review/policy records, fail-closed coverage, authenticated decision APIs, durable override reason                         | Live authenticated V1 decision acceptance remains open                                                                                               | Read-only exact-candidate review and substantive reviewer contract                                              | Make alpha review read-only after candidate freeze                    |
| Publication           | Canonical decision publication, leases, fencing, replay tests, exact-head check contract                                  | Incoming runtime candidates now carry `headSha`; hosted V1 exact-head publication is not proven                                                      | GitHub App `checks: write` and removal of duplicate preliminary reports                                         | Publish one canonical incoming-PR report and replay it live           |
| Provider coverage     | Daytona Linux is live; the installed SDK supports Windows snapshot creation and Computer Use                              | `windows-small` and Computer Use are in scope but lack PatchPlane evidence adapters and live smokes; unsupported platforms remain blocked            | Provider capability contract, portable Windows command/evidence path, Computer Use adapter, and live smokes     | Implement and live-smoke Windows and Computer Use; keep macOS blocked |

## Detailed capability matrix

### Candidate acquisition and identity

| ID       | Priority | Capability                                     | Current state                                                                                                                                                                                                                                         | Capability acceptance criterion                                                                                                                                               | Status      | Evidence                                                                                                       | Owner / dependency              |
| -------- | -------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| CAND-001 | P0       | Immutable workflow attempts and child reruns   | Attempts are immutable; reruns create child attempts pinned to the same source revision                                                                                                                                                               | Automated tests prove parent preservation, idempotency, and one atomic orchestration claim                                                                                    | Verified    | M10 automated rows in [`acceptance-tests.md`](./acceptance-tests.md)                                           | —                               |
| CAND-002 | P0       | Exact source-head pinning                      | GitHub normalization records `pull_request.head.sha` and clone preparation uses the pinned revision                                                                                                                                                   | A synchronize event creates a new attempt pinned to the new exact head and never reuses stale evidence                                                                        | Verified    | GitHub normalization, repository preparation, and rerun tests                                                  | —                               |
| CAND-003 | P0       | Explicit alpha PR candidate subject            | PatchPlane-owned candidate-subject schemas distinguish incoming PR and sandbox-generated origins; the subject carries normalized repository, PR, base/head, and source-event fields, while the composed CandidatePatchSet binds the exact diff digest | PatchPlane-owned schema identifies an incoming PR candidate by repository, PR, base SHA, head SHA, exact diff digest, and source event without provider objects crossing core | Verified    | Domain composition plus core/provider/backend incoming-candidate persistence tests                             | —                               |
| CAND-004 | P0       | PR base and head identity                      | Signed webhook normalization, external refs, current `incoming-pr-v1` attempts, and their reruns persist both authenticated base and head SHAs                                                                                                        | Signed webhook intake persists both base and head SHA with repository and PR identity                                                                                         | Verified    | GitHub normalization/intake tests and Convex persistence/synchronize-attempt tests                             | —                               |
| CAND-005 | P0       | Exact incoming-PR candidate capture            | Authenticated immutable GitHub compare bytes are strictly bounded, decoded, hashed, stored in R2, and bound to a Convex incoming candidate before sandbox use                                                                                         | PatchPlane captures and hashes exact `baseSha...headSha` bytes before review or verification and stores `headSha` on the candidate                                            | Implemented | Core freeze-order tests; GitHub streaming/error tests; R2 idempotency tests; Convex lease/lineage tests        | Credentialed exact-diff dogfood |
| CAND-006 | P1       | Sandbox-generated candidate capture foundation | Daytona returns base SHA and generated diff; core records digest, artifact, producing execution, and statistics                                                                                                                                       | Existing generated-candidate tests remain valid as implementation foundation without being presented as proof of incoming-PR verification                                     | Verified    | M9.75 candidate/evidence automated coverage; not alpha PR dogfood evidence                                     | —                               |
| CAND-007 | P0       | Persisted candidate before verifier dispatch   | Candidate-bound freeze and dispatch leases require a durable incoming candidate; Daytona start/result writes are token-, lineage-, and sandbox-ID-fenced with timeout recovery                                                                        | The exact incoming candidate record and artifact exist before Daytona or Pi starts, and every result references that persisted candidate ID/digest                            | Implemented | Core freeze-token tests plus Convex freeze, dispatch, stale-worker, sandbox-mismatch, and crash-recovery tests | Credentialed dogfood            |

### Trusted verification plan

| ID       | Priority | Capability                                       | Current state                                                                                                                                                                                                                              | Capability acceptance criterion                                                                                                               | Status      | Evidence                                                                                                            | Owner / dependency           |
| -------- | -------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| PLAN-001 | P0       | Requirements declared before untrusted execution | Configured test/browser requirements are persisted before Daytona/Pi starts                                                                                                                                                                | Automated tests prove a provider result cannot invent or weaken a requirement                                                                 | Verified    | M9.75 automated acceptance row and core workflow tests                                                              | —                            |
| PLAN-002 | P0       | Versioned `VerificationPlanV1`                   | A branded plan records version, trusted sources/revisions, ordered requirements, canonical SHA-256 digest, workflow identity, and creation time                                                                                            | Domain schema records version, trusted source, source revision, ordered requirements, limits, and SHA-256 digest                              | Verified    | Domain/core resolver tests plus Convex digest recomputation, replay, and pre-freeze persistence tests               | —                            |
| PLAN-003 | P0       | Trusted plan source and precedence               | Non-negotiable deployment policy resolves before validated workspace policy and repository-scoped policy pinned to the authenticated base SHA                                                                                              | Effective plan resolves from non-negotiable system policy plus authorized workspace or pinned base-repository policy with explicit precedence | Implemented | Resolver precedence/bounds tests; source-control config decoding; Convex workspace/repository/base identity checks  | Credentialed policy run      |
| PLAN-004 | P0       | Candidate cannot weaken its own plan             | Candidate configuration changes have no formal treatment                                                                                                                                                                                   | Candidate-authored plan changes are displayed as proposed changes and do not alter requirements for that candidate                            | Not started | No base-versus-candidate plan comparison                                                                            | PLAN-002, PLAN-003, CAND-005 |
| PLAN-005 | P0       | Bounded multiple requirements                    | Plans decode and become freeze-eligible only after persisting at most 16 uniquely keyed requirements with per-command timeout and artifact budgets; incoming execution is credited only through complete trusted execution-group envelopes | A decoded plan can persist and validate a documented maximum number of independently identified requirements before candidate freeze          | Implemented | Resolver and Convex count/byte/duplicate/timeout/artifact bounds; freeze refuses incomplete requirement persistence | —                            |
| PLAN-006 | P0       | Explicit unsupported-platform outcome            | Configured non-Linux test requirements are persisted as blocked                                                                                                                                                                            | A required unsupported platform is visible as `blocked` and prevents a clean policy outcome                                                   | Verified    | Daytona, coverage, policy, Patch Report, and UI tests                                                               | —                            |
| PLAN-007 | P1       | Safe plan validation                             | Whole-plan count, UTF-8 byte, key, label, source, timeout, architecture, and artifact budgets are validated; interpolation policy remains open                                                                                             | Invalid IDs, duplicate IDs, unsupported kinds, excessive timeouts/counts/artifact budgets, and interpolation are rejected before execution    | In progress | Domain/core/Convex bounded validation tests                                                                         | Command interpolation policy |
| PLAN-008 | P1       | Plan coverage in Patch Report                    | Per-check plan ID, execution-group ID, command digest, log artifact IDs, and cleanup status project for the coherent incoming candidate; aggregate source/digest/count projection remains open                                             | Report shows plan source, source revision, digest, required count, and passed/failed/blocked/error/invalidated counts                         | In progress | Patch Report incoming-candidate and execution-envelope projection tests                                             | Aggregate plan projection    |

### Execution and provider capabilities

| ID       | Priority | Capability                                   | Current state                                                                                                                                                                                                                                      | Capability acceptance criterion                                                                                                                                                                                   | Status      | Evidence                                                                                                                               | Owner / dependency                       |
| -------- | -------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| EXEC-001 | P0       | Ephemeral Daytona Linux execution            | Provision, exact clone, execution, lifecycle metadata, and deletion are implemented                                                                                                                                                                | Live smoke proves exact checkout, execution, artifact handling, and final deletion without long-lived control-plane credentials                                                                                   | Verified    | `smoke:daytona-rpc`; M8 and M9 live rows                                                                                               | —                                        |
| EXEC-002 | P0       | Candidate mutation detection                 | Test capture records candidate digest before/after and coverage fails closed on mutation or mismatch                                                                                                                                               | A mutating requirement becomes `invalidated` or failed coverage and can never be projected as passed                                                                                                              | Verified    | M9.75 automated coverage                                                                                                               | —                                        |
| EXEC-003 | P0       | Per-requirement orchestration                | `RunIncomingVerificationPlan` executes each supported command once in a separate Daytona sandbox with a forced deletion attempt; unsupported/provider/error outcomes persist independently; interruptions and crashes are fenced/recovered         | Each plan requirement has a separately timed, cancellable, persisted execution result; shared execution groups are explicit                                                                                       | Implemented | Core blocked/finalization tests; Daytona trusted invocation test; Convex recovery tests                                                | Credentialed incoming run                |
| EXEC-004 | P0       | Control-plane result envelope                | Branded results bind plan/group/requirement/candidate, recomputed command digest and timeout, provider/platform/architecture, timing/exit, mutation digests, artifacts, log capture, and cleanup outcome; malformed provider envelopes fail closed | PatchPlane records requirement, candidate, plan, provider, command identity, platform/architecture, timing, exit, digests, artifacts, and cleanup independently of tenant output                                  | Implemented | Core envelope bounds plus Convex success/replay/fencing/invariant tests and Patch Report projection                                    | Effective environment/deletion readback  |
| EXEC-005 | P0       | First-class command stdout/stderr            | Every trusted command attempts deterministic bounded stdout and stderr R2 capture; IDs and captured/truncated/failed status are durable, and anything other than complete capture prevents `passed`                                                | Every command result references bounded stdout/stderr artifacts or an explicit capture failure                                                                                                                    | Implemented | Core log-bound tests, R2 artifact boundary, Convex producer/candidate binding                                                          | Credentialed R2 readback                 |
| EXEC-006 | P1       | Executor capability declaration              | Core assumes the current Daytona Linux behavior                                                                                                                                                                                                    | Provider plugins declare platforms, architectures, browser support, timeout, and artifact limits through PatchPlane-owned types                                                                                   | Not started | No capability contract                                                                                                                 | PLAN-006                                 |
| EXEC-007 | P0       | Bounded execution-group identity             | Stable plan/requirement/candidate keys, opaque group claims, durable dispatch-token fencing, provider+sandbox uniqueness, exact sandbox/result replay, terminal state reload, and explicit `sharedState: false` are implemented                    | The trusted plan defines bounded stable execution-group IDs; each group has an idempotent claim, environment identity, lifecycle, results, and explicit shared-state disclosure                                   | Implemented | Convex duplicate/takeover/start/replay/recovery/envelope tests and core durable-state finalization                                     | Multi-environment live smoke             |
| EXEC-008 | P0       | Daytona Windows execution                    | SDK supports `windows-small` and exact-commit Git clone; PatchPlane lacks trusted snapshot selection, validated Git status/head evidence, and PowerShell capture                                                                                   | Daytona clones/checks out the exact candidate in `windows-small`, proves clean/exact head, runs the requirement, captures equivalent evidence/digests, proves deletion, and passes a credentialed smoke           | Designing   | Daytona Windows/Git docs, installed `@daytona/sdk@0.200.1`, existing `commitId` clone adapter, and current POSIX-only capture commands | EXEC-004, EXEC-006; Daytona plugin owner |
| EXEC-009 | P1       | macOS unavailable-platform handling          | Daytona lists macOS Computer Use as private alpha; PatchPlane has no supported alpha macOS executor                                                                                                                                                | Every macOS requirement remains `blocked`, prevents a fully passed result, and is visible in the Patch Report and any human override                                                                              | Blocked     | Daytona Computer Use availability statement and existing unavailable-platform coverage tests                                           | PLAN-006                                 |
| EXEC-010 | P1       | Resolved execution-environment identity      | PatchPlane persists lifecycle, network, resources, provider, platform, and architecture, but not a general immutable image/snapshot/class identity                                                                                                 | Every result records the Daytona sandbox class, OS, architecture, trusted image/snapshot, resources, and network policy used for that execution                                                                   | Not started | Current `SandboxPolicy` and Daytona adapter cover part of the contract                                                                 | EXEC-004, EXEC-006                       |
| EXEC-011 | P0       | Verification without persistent/shared state | Trusted Linux requirements create distinct sandboxes, reject provider+sandbox reuse, declare `sharedState: false`, and force deletion attempts; retained RPC and effective no-sharing proof remain open                                            | Alpha uses fresh sandboxes with no prior/derived/shared state; retained RPC sessions have bounded ownership/expiry/reconciliation and are eventually delete-confirmed                                             | Designing   | Daytona isolation/persistence docs, ephemeral-profile tests, and explicit RPC termination smoke                                        | PLAN-007, EXEC-010, EXEC-013             |
| EXEC-012 | P0       | Daytona Computer Use browser/GUI execution   | Installed SDK exposes Computer Use lifecycle, input, screenshot, recording, display, and accessibility APIs, but PatchPlane has no trusted adapter                                                                                                 | A declared Linux/Windows browser or GUI requirement runs with bounded operations and stores hashed, candidate-bound visual artifacts; lifecycle and sandbox deletion are proven                                   | Designing   | Daytona Computer Use docs and installed `@daytona/sdk`; no PatchPlane adapter or credentialed smoke                                    | EXEC-003, EXEC-004, EXEC-006, EXEC-010   |
| EXEC-013 | P0       | Effective Daytona isolation evidence         | PatchPlane stores requested lifecycle/resource/network policy and forces per-group cleanup attempts, but does not prove effective tier exceptions, forbidden sharing/ingress, limits, or absence after delete                                      | Live smokes record resolved boundary/limits, reject public preview/link/volume/persistent-state reuse, verify representative egress, and poll deletion to not-found                                               | Not started | Daytona isolation/persistence docs; requested-policy tests and Linux lifecycle smoke only                                              | EXEC-006, EXEC-010, EXEC-011             |
| EXEC-014 | P0       | Bounded concurrency and capacity outcomes    | Plan fan-out is bounded to 16 and executes sequentially with per-command timeouts; global concurrency, retry budgets, and normalized rate/capacity outcomes remain open                                                                            | Enforce plan/global concurrency and timeout budgets, forbid runtime resize, disclose shared sessions, terminate background work, honor bounded retries, and classify exhausted capacity as provider error/blocked | Not started | Daytona scale docs; current single-path timeout/session tests only                                                                     | PLAN-005, PLAN-007, EXEC-003, EXEC-007   |

### Evidence, review, and policy

| ID       | Priority | Capability                                    | Current state                                                                                                                                           | Capability acceptance criterion                                                                                                    | Status      | Evidence                                                                                              | Owner / dependency                        |
| -------- | -------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| EVID-001 | P0       | Durable raw artifacts and normalized metadata | R2 stores raw evidence; Convex stores identity, hashes, size, retention, and references                                                                 | Live readback proves exact non-empty bytes and matching SHA-256 without using telemetry as provenance                              | Verified    | M8/M9.75 live and automated rows                                                                      | —                                         |
| EVID-002 | P0       | Candidate-bound verification coverage         | Coverage rejects missing, blocked, errored, mutated, truncated, stale, or mismatched required evidence                                                  | Automated tests cover every fail-closed state and policy consumes the same normalized result set                                   | Verified    | `evaluate-verification-coverage` and M9.75 acceptance rows                                            | —                                         |
| EVID-004 | P1       | Repository artifacts remain untrusted inputs  | Test report/screenshot bytes are validated while PatchPlane-owned command envelopes, logs, identity, exit, mutation, and cleanup facts control `passed` | Malformed, missing, stale, oversized, or identity-mismatched artifacts fail closed without controlling the command result envelope | Implemented | Daytona and control-plane envelope tests; credentialed effective-environment evidence remains missing | EXEC-010, EXEC-013, credentialed evidence |
| REV-001  | P0       | Separate review and verification facts        | Review, verification, policy, and decision are separate durable records                                                                                 | Agent exit or review completion cannot satisfy a verification requirement                                                          | Verified    | Domain, policy, report, and acceptance tests                                                          | —                                         |
| REV-002  | P0       | Read-only exact-candidate review              | Current Pi path is a mutating generator; alpha reviewer primarily checks evidence state                                                                 | Alpha review runs only after freeze, cannot alter the candidate, and emits structured candidate-bound findings                     | Not started | No read-only PR-candidate review workflow                                                             | CAND-005, CAND-007                        |
| REV-003  | P0       | Fail-closed policy over the effective plan    | Alpha policy evaluates required verification coverage and candidate identity                                                                            | Policy input includes plan digest and all requirements; incomplete coverage cannot become a clean automated outcome                | Implemented | Existing policy tests pass; plan binding is missing                                                   | PLAN-002, PLAN-008                        |
| REV-004  | P0       | Durable human decision and override           | APIs enforce candidate/review/policy coherence and require a reason for incomplete approval                                                             | Real authenticated browser decision persists and the report continues to show every overridden gap                                 | Implemented | Automated M10 rows; authenticated live row remains `Missing`                                          | Live acceptance                           |

### Publication and end-to-end acceptance

| ID       | Priority | Capability                               | Current state                                                                                                              | Capability acceptance criterion                                                                                                 | Status      | Evidence                                                 | Owner / dependency                             |
| -------- | -------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------- | ---------------------------------------------- |
| PUB-001  | P0       | One canonical marker-backed Patch Report | Decision publication is canonical and replay-safe; preliminary sandbox-result comments can create another report           | One root-scoped comment is updated through execution, review, and decision without exposing raw Pi activity as verification     | In progress | Decision publication lease/replay tests exist            | Remove or migrate preliminary publication path |
| PUB-002  | P0       | Exact-head check publication             | Core requires candidate `headSha`; frozen incoming candidates carry it, while the hosted publication path remains unproven | Incoming PR candidates publish/update a check only against their exact head SHA using a stable external ID                      | Implemented | Core/GitHub adapter and incoming-candidate runtime tests | LIVE-001                                       |
| PUB-003  | P0       | GitHub App check-write permission        | Current operational App permission does not authorize hosted check creation                                                | Dev installation grants `checks: write` and a live exact-head check can be created and replayed                                 | Blocked     | Operational preflight currently has read-only checks     | GitHub App owner and installation reapproval   |
| LIVE-001 | P0       | Real incoming-PR trust loop              | Existing live runs prove sandbox-generated V0/V1 foundations, not exact incoming PR verification                           | One real PR is captured as exact `base...head`, planned, frozen, verified, reviewed, decided in authenticated UI, and published | Not started | M9.75/M10 live rows remain missing                       | CAND-005 through PUB-003                       |
| LIVE-002 | P0       | Publication replay and readback          | Replay mechanism is tested and historical comment replay is live                                                           | The incoming-PR report/check are replayed without duplication and read back from GitHub and authenticated UI                    | Not started | Existing live proof is not incoming-candidate V1         | LIVE-001                                       |
| LIVE-003 | P1       | Truthful unsupported-platform run        | Automated tests cover blocked native requirements                                                                          | A live plan containing an unavailable native requirement produces an incomplete report and requires a durable human override    | Not started | No current live V1 dogfood readback                      | PLAN-006, REV-004, LIVE-001                    |

## Active implementation sequence

This checklist tracks the agreed execution order for alpha closure. A checked
item means that task's implementation and non-credentialed evidence are
complete; provider-backed rows retain their matrix status until the named live
evidence also exists.

- [x] 1. Finish the current M7.5 critical-path breadcrumb slice.
- [x] 2. Complete `CAND-003`/`CAND-004`: base/head subject at intake.
- [x] 3. Complete `CAND-005`/`CAND-007`: R2-backed candidate freeze before dispatch.
- [x] 4. Complete `PLAN-002`/`PLAN-003`/`PLAN-005`: bounded trusted plan.
- [x] 5. Complete `EXEC-003`/`EXEC-004`/`EXEC-005`/`EXEC-007`: execution groups and command envelopes.
- [ ] 6. Prove one fully supported Linux PR end to end.
- [ ] 7. Fix canonical publication and obtain `checks: write`.
- [ ] 8. Add Windows, Computer Use, and effective isolation/scale smokes.

## Dependency paths and sequencing

The alpha release path prioritizes truthful subject binding before another
promotional dogfood run:

```text
ADR 0001 exact incoming-PR identity decision (complete)
→ CAND-003/CAND-004/CAND-005/CAND-007 exact candidate freeze (complete)
→ PLAN-002/PLAN-003/PLAN-005 bounded trusted plan (complete)
→ EXEC-003/EXEC-004/EXEC-005/EXEC-007 PatchPlane-owned execution evidence (complete)
→ PLAN-008 aggregate report coverage
→ REV-002 read-only review
→ PUB-001/PUB-002 canonical exact-head publication
→ LIVE-001/LIVE-002 acceptance on PR 128 or an equivalent design-partner PR
```

M7.5 operational telemetry can continue independently, but telemetry completion
cannot make an invalid Patch Report trustworthy. Fresh M9.75, M10, and M11
release evidence must exercise this exact incoming-PR path rather than repeat
the sandbox-generated smoke.

Daytona Windows remains within the existing sandbox provider boundary and is
part of the alpha environment envelope, but it must not be reported as available
until `EXEC-008` has implementation and live evidence. macOS remains an explicit
unavailable-platform result. External GitHub checks are contextual signals and
must not substitute for Daytona candidate-bound verification.

## Tracker update protocol

When changing a row:

1. Link the owning domain/core/plugin/application change.
2. Add or update the lowest useful automated regression test.
3. Update [`acceptance-tests.md`](./acceptance-tests.md) when an alpha or live
   claim changes.
4. Record the exact candidate/plan/provider identity for live evidence without
   copying secrets or untrusted artifact contents into this document.
5. Use `Implemented` until every evidence item in the row exists.
6. Use `Blocked` only with an owner or explicit unassigned dependency.
7. Never mark a row complete from agent exit status, PR checkboxes, telemetry,
   or a provider success string alone.

## Execution ledger

This ledger records tracker-level checkpoints. Detailed release evidence remains
in [`acceptance-tests.md`](./acceptance-tests.md) and the
[M10 runbook](./m10-acceptance-runbook.md).

| Date       | Rows                                   | Change or review                                                                                                                                                                                                                                                                                                                                                                                                     | Automated evidence                                                                                                                | Live evidence                                                                                                      | Remaining gap                                                                                                                                                                             |
| ---------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-07-27 | Baseline                               | Audited current candidate, verification, evidence, review, decision, and publication capabilities; confirmed Daytona Windows snapshot creation in its docs and installed SDK while identifying PatchPlane's missing snapshot selection and POSIX-only evidence commands; fixed the alpha environment envelope to Daytona Linux, Daytona `windows-small`, and browser verification, with macOS explicitly unavailable | Existing domain/core/plugin/backend suites, installed `@daytona/sdk@0.200.1` declarations, and `acceptance-tests.md` traceability | Existing Daytona Linux/R2 smokes and historical hosted trust-loop evidence only; no Daytona Windows smoke          | Exact incoming-PR candidate, trusted plan, multi-requirement execution, portable control-plane command evidence, Windows live smoke, and current authenticated V1 publication remain open |
| 2026-07-27 | Sequence 1 / M7.5 breadcrumbs          | Added branded bounded transition stages, fail-open transition helpers, request-local breadcrumb scopes, and explicit breadcrumbs across intake, attempt claim, requirements, sandbox, candidate, verification, review, policy, decision, rerun, and publication transitions                                                                                                                                          | `bun run verify`                                                                                                                  | N/A; deployed Sentry readback remains an M7.5 acceptance gap                                                       | Continue with `CAND-003`/`CAND-004`; handled-failure coverage, environment/release metadata, and deployed Sentry readback remain open M7.5 work                                           |
| 2026-07-27 | CAND-003, CAND-004                     | Added normalized incoming-PR candidate subject types; webhook intake now requires and persists immutable base/head SHAs, current incoming-PR reruns preserve both, and a new synchronized candidate creates a separate attempt without inheriting prior candidate rows                                                                                                                                               | `bun run verify`                                                                                                                  | N/A; live exact-diff freeze remains `CAND-005`                                                                     | Capture and persist the exact R2-backed incoming candidate before any Daytona or Pi dispatch                                                                                              |
| 2026-07-27 | CAND-005, CAND-007                     | Added explicit immutable GitHub compare streaming, strict bounded text/binary validation, exact-byte SHA-256, deterministic conflict-safe R2 storage, Convex incoming-candidate persistence, latest-lineage freeze leases, durable candidate-bound dispatch, sandbox-ID result fencing, and scheduled crash recovery before any Daytona/Pi result can count                                                          | `bun run verify`; core, provider, backend, architecture, CLI, production build, and bundle-budget suites                          | Missing; credentialed exact-diff PR dogfood remains open                                                           | Implement a trusted bounded plan and execution envelopes, then prove the frozen candidate in a live supported PR run                                                                      |
| 2026-07-27 | PLAN-002, PLAN-003, PLAN-005           | Added branded versioned plans, canonical digest recomputation, bounded source/requirement schemas, non-negotiable system then workspace/base precedence, immutable plan/requirement persistence before freeze, and a deep-frozen runtime capability; incoming agent-sandbox results are rejected until fresh execution groups exist                                                                                  | `bun run verify`; domain, core, source-control, backend, plugin, architecture, CLI, production build, and bundle-budget suites    | Missing; no credentialed workspace/base-policy or fresh multi-requirement provider run                             | Build `EXEC-003`/`EXEC-004`/`EXEC-005`/`EXEC-007` fresh execution groups and command envelopes from the persisted plan                                                                    |
| 2026-07-27 | EXEC-003, EXEC-004, EXEC-005, EXEC-007 | Added dispatch-fenced stable per-requirement groups, fresh sequential Linux Daytona invocation, exact sandbox/result replay, crash recovery, provider+sandbox uniqueness, bounded provider envelopes, deterministic stdout/stderr R2 artifacts, independently recomputed command identity/timeout checks, coherent durable-state finalization, and per-check Patch Report projection                                 | `bun run verify`; core, Daytona, Convex, report, source-control, architecture, CLI, production build, and bundle-budget suites    | Missing; no credentialed incoming-PR group execution, effective environment readback, or delete-to-not-found proof | Prove one supported Linux PR end to end, including effective Daytona identity/isolation and cleanup readback; keep Windows/Computer Use and canonical publication open                    |

Use this template for subsequent entries:

```text
| YYYY-MM-DD | IDs | What landed or was reviewed | Tests/commands | Provider run or N/A | Exact remaining blocker |
```

## Completion rule

The alpha repository-verification capability is release-ready only when:

1. every P0 row is `Verified` or is an intentionally supported fail-closed
   provider limitation represented by a verified `blocked` result;
2. `bun run verify` passes for the release candidate;
3. the applicable `Missing` rows in [`acceptance-tests.md`](./acceptance-tests.md)
   have repeatable evidence;
4. a real existing PR completes the candidate-bound trust loop;
5. replay creates no duplicate GitHub output;
6. a new PR head invalidates the prior attempt's evidence and decision; and
7. raw evidence remains in R2, normalized workflow truth remains in Convex, and
   telemetry is not used as either store.
