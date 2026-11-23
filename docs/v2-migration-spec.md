# Patchplane V2 specification

Status: consolidated design draft, updated 2026-11-23 after architecture re-review. This replaces the earlier incremental-migration draft and refines the 2026-11-22 grill-with-docs decisions. Product decisions, single-store persistence, cloud-only verification, and pinned published toolchain baselines below are accepted; technical stack proofs remain explicitly identified. No V2 application implementation, live product acceptance, or deployment is claimed.

## Problem Statement

The maintainer uses coding agents across several projects and must reconstruct acceptance state from conversations, CI results, screenshots, native builds, and manual checks. Passing tests, successful agent execution, and demonstrated product behavior are different observations. Evidence can describe different revisions, builds, or environments, making handoff slow and uncertain.

Patchplane must independently verify proposed software changes and explain what was checked, what remains uncertain, and the next required action. Verification must adapt to each project while keeping requirements, authorization, resource limits, and evidence integrity outside an extension's control. Users need an actionable Web Decision Inbox and MCP interface that survive individual agent sessions and never execute untrusted verification on personal devices.

The existing repository is exploration, not a reference implementation to preserve. V2 starts clean in a separate worktree and branch of the same repository. Its first measure of value is end-to-end use on the maintainer's projects. Commercial adoption is not a prerequisite for that experiment.

## Solution

Build a customizable agent verification platform. Work starts only when a pull request or merge request exists. The first usable release both collects existing evidence and executes independently derived checks against approved repository and task requirements. Linux and a real cloud-hosted Arbeo Android verification journey are required.

Patchplane owns the standalone Web Decision Inbox, approval policy, acceptance state, and Patch Reports. The first release exposes those decisions through four interfaces: the standalone Web Decision Inbox, GitHub (built on provider-neutral forge contracts), the CLI, and MCP from day one. T3 embedding, a live GitLab adapter, and custom evidence renderers are out of V2 scope; custom renderers are deferred to V3+.

A separate verifier session inspects the candidate and creates checks in an isolated cloud workspace. It cannot change the submitted implementation or approved requirements. When it identifies a fix, it produces a proposal for handoff to an implementation agent. When a derived check itself is defective, a maintainer can challenge and regenerate the check without recording a Verification Waiver.

Extensions follow a two-tier model. Repositories and agents may author and version untrusted verification checks and agent configurations pinned by Git SHA. Workflow engines, execution providers, and event integrations remain trusted, platform-deployed plugins rather than arbitrary tenant-uploaded code.

Patchplane never executes untrusted verification on a user's personal device. That is a hard security-by-design rule. Arbeo Android builds untrusted PR code in an isolated Linux sandbox and runs the hashed APK on a cloud Android emulator or device adapter.

Reports remain advisory during initial dogfooding. Missing evidence stays incomplete. A policy decision or waiver never turns an absent observation into a passing result. Evaluating agents themselves across tasks and custom evidence renderers belong to V3+.

## User Stories

1. As a maintainer, I want verification to start from an existing PR/MR, so that every attempt has a concrete proposed change.
2. As a maintainer, I want repository defaults and task-specific requirements combined, so that verification checks the intended outcome.
3. As a maintainer, I want a versioned proposal attached to the PR/MR, so that approvals have an exact subject.
4. As a maintainer, I want agents to propose requirement changes without silently weakening them, so that acceptance remains under my authority.
5. As a maintainer, I want checks derived independently from approved requirements, so that existing passing tests do not imply unsupported coverage.
6. As a maintainer, I want meaningful before/after demonstrations for feasible bug fixes, so that the relevant regression is demonstrated.
7. As a maintainer, I want infeasible comparisons and their reasons recorded, so that alternative evidence or waivers remain explicit.
8. As a developer, I want a verifier to hand proposed fixes to an implementation agent, so that verification cannot quietly alter the candidate it evaluates.
9. As a maintainer, I want to challenge and regenerate a buggy derived check without waiving the underlying requirement, so that verifier test bugs do not distort provenance.
10. As a maintainer, I want both imported evidence and independently executed evidence, so that useful existing observations retain their actual assurance level.
11. As a reviewer, I want exact source, build, environment, and artifact identity, so that I can assess what each observation supports.
12. As a reviewer, I want missing, failed, blocked, stale, and expired evidence distinguished, so that a gap cannot look like success.
13. As a maintainer, I want one Patch Report to explain acceptance state at handoff, so that I do not reopen several agent conversations.
14. As a maintainer, I want a durable Web Decision Inbox, so that pending questions and approvals survive agent-session termination.
15. As a maintainer, I want the Web Decision Inbox, GitHub, CLI, and MCP to expose the same version-bound decisions, so that both humans and agents operate against one authoritative state.
16. As a maintainer, I want authenticated interfaces to enforce my actual repository authority, so that sign-in alone cannot grant approval rights.
17. As a maintainer, I want each action category to have configurable approval rules, so that I control which operations prompt me.
18. As a reviewer, I want automated decisions attributed to their policy rule and version, so that automation cannot impersonate a human click.
19. As a maintainer, I want to authorize an agent to change configuration through MCP from day one, so that delegation is useful without permitting self-authorization.
20. As a maintainer, I want configuration fixed for each recorded attempt, so that edits do not change the meaning of work already running.
21. As a maintainer, I want both the human and agent notified of configuration changes during execution, so that differences in subsequent results are explainable.
22. As a maintainer, I want implementation-only pushes to retain requirement approval but receive new verification, so that approval and evidence freshness remain distinct.
23. As a maintainer, I want superseded work cancelled, so that the platform does not keep spending on an obsolete candidate.
24. As a maintainer, I want an explicit Stop action, so that a frozen configuration does not prevent cancellation.
25. As an operator, I want time and model ceilings enforced, using dollar spend where metered and explicit turn/token/wall-clock caps where dollar metering is unavailable, so that automatic verification remains bounded.
26. As an operator, I want infrastructure retries to share the original budget, so that retry bookkeeping cannot reset limits.
27. As an operator, I want cleanup to continue under a separate bounded allowance, so that stopping verification does not abandon resources silently.
28. As an operator, I want failed cleanup to quarantine the environment and create an inbox item, so that uncertain state cannot be reused.
29. As a native developer, I want real cloud execution of the Arbeo Android journey, so that imported screenshots alone cannot satisfy native acceptance and untrusted PR code never touches my personal machine.
30. As a native developer, I want synthetic data, a dedicated development account, and a disposable cloud device or emulator, so that verification does not depend on personal devices, personal data, or production credentials.
31. As a maintainer, I want repo-versioned verification checks and agent configs pinned by Git SHA with enforced platform limits, so that project customization cannot bypass platform rules.
32. As a maintainer, I want provider-neutral forge contracts with explicit capability declarations and a real GitHub adapter first, so that V2 stays focused without locking core logic to GitHub.
33. As an operator, I want durable recovery from duplicate events, crashes, and ambiguous external responses in one authoritative database, so that retries do not duplicate decisions or resources.
34. As an operator, I want stale workers fenced out, so that expired ownership cannot publish current results.
35. As a contributor, I want native Effect v4 application logic and shared schema-backed contracts, so that errors, lifetimes, and types compose across boundaries.
36. As a contributor, I want published Effect tooling, tsrs, Oxlint, Oxfmt, and Foldkit integrated and tested without maintaining a custom compiler build pipeline, so that the new worktree stays reproducible.
37. As an operator, I want Alchemy to own durable infrastructure deployment and scoped runtime bindings, while Effect workflows own per-attempt sandbox lifecycles and leak recovery.
38. As a hosted user, I want up to seven days of evidence retention initially, so that the hosted offering has a clear storage limit.
39. As a future paid hosted user, I want retention of thirty days or longer, so that I can retain evidence beyond the initial hosted allowance.
40. As a self-hosted owner, I want configurable retention on my own Postgres and S3 storage, so that hosted commercial restrictions do not govern my installation.
41. As a reviewer, I want artifact expiry to remain visible, so that unavailable evidence cannot still be presented as inspectable proof.
42. As a maintainer, I want historical V1 evidence preserved without forcing code reuse, so that a clean rebuild does not erase provenance.
43. As a maintainer, I want five to ten real changes across two projects evaluated end to end, so that usefulness is demonstrated through actual handoffs.

## Implementation Decisions

- Use a greenfield worktree and branch in the existing repository. Do not recreate the V1 package inventory by default. Preserve old code through Git history and preserve historical evidence separately; no deletion or live cutover is implied.
- All authored asynchronous application work is native Effect v4, including UI, services, adapters, CLI, MCP, tests, and Alchemy infrastructure. Use owned schemas, typed failures, explicit services and layers, configuration, schedules, and scoped lifetimes. Promise-based code requires an exact, documented, and justified exception under [V2 Effect boundaries](v2-effect-boundaries.md). No blanket framework or SDK exception applies; wrapping Promise workflows in Effect is insufficient.
- Build the standalone Web Decision Inbox with Foldkit (`0.171.0`, compatible with Effect `4.1.x`). Foldkit owns the application model, state transitions, and Effect commands/subscriptions. Limit React Islands strictly to irreplaceable third-party widgets such as a diff viewer; they receive typed view data and emit typed interactions only. Live UI updates arrive over SSE or WebSockets from the Effect control-plane server. Custom evidence renderers are deferred to V3+.
- End-to-end type safety includes inference across API, CLI, MCP, persistence, and UI, plus runtime decoding of untrusted inputs and persisted values. Types do not confer authority or prove runtime isolation.
- PostgreSQL is the single source of truth for V2 state (Neon for hosted, standard PostgreSQL for self-hosted). Run the Patchplane control plane as a long-lived Bun Effect server on Cloudflare Containers deployed through Alchemy (`@alchemy.run/cloudflare/Containers`), connected via `@effect/sql-pg` and `Neon.Connect`. That single Postgres database holds authoritative acceptance facts, Decision Inbox state, provenance, and the `effect/workflow` plus `ClusterWorkflowEngine` SQL journal. Do not split state across Neon and Cloudflare Workflows or Durable Objects. Object storage (R2 for hosted, S3-compatible for self-hosted) holds immutable raw artifact bytes only, indexed by SHA-256 digest from Postgres. See [ADR 0010](adr/0010-postgres-single-store-and-cloud-only-verification.md).
- Cloudflare Containers sleep after inactivity, can restart at any time, and lose their local disk. Every container is fronted by a Durable Object. Treat the container as stateless compute: the fronting Durable Object holds no Patchplane state, and every workflow resumes from the Postgres journal after a restart. Durable timers (attempt deadlines, cleanup allowance, leak reconciliation) must not depend on a sleeping container staying awake; a stateless scheduled Worker wakes the server on a fixed interval so due workflows resume. Prove restart-and-resume behavior during stack proof.
- Separate deployment infrastructure from per-attempt runtime sandboxes cleanly. Alchemy is the sole owner of Patchplane-managed durable infrastructure and deployment, including the control-plane server, Neon/Postgres resources, R2/S3 buckets, `Daytona.Snapshot` and optional `Daytona.WarmPool` definitions, and the scoped `Daytona.CreateSandbox` runtime binding. Effect workflows own per-attempt sandbox creation, deterministic attempt labeling, cancellation, confirmed deletion, and periodic leak reconciliation through that binding. Never ignore deletion failures.
- Pin the latest published compatible toolchain rather than maintaining a custom compiler source build: Effect `4.1.5`, `@effect/sql-pg` `4.1.5`, `@effect/tsgo` `0.73.2`, `tsrs` `7.1.0-beta.tsrs3`, Oxlint `1.94.0`, Oxfmt `0.79.0`, Alchemy `2.0.0-beta.87`, and Foldkit `0.171.0`. Upgrade to `tsrs4` once a published `@effect/tsgo` release supports it. Re-verify exact versions when initializing the greenfield worktree.
- Keep source-control contracts provider-neutral with explicit capability declarations, repository-instance identity, fork identity, and candidate identity. Ship a real GitHub adapter for V2. Do not build or live-test a GitLab adapter in V2.
- Record a candidate-bound attempt with its requirement, policy, and activated-extension versions. Configuration changes apply at the next recorded attempt. Recovering the same attempt retains its snapshot. Notify the agent and human when configuration changes while an attempt is active.
- Requirement approval survives implementation-only pushes. Verify the new candidate and cancel superseded work. Requirement, activated-extension, and authority changes require a fresh decision for the affected version under the applicable approval policy; previous results stay historical.
- Each action category has configurable approval rules. Requirement approval, extension activation, and waivers default to manual approval during dogfooding. Automatic decisions record their exact rule, version, and affected proposal, and are distinguishable from direct human actions.
- Expose MCP from day one for agent interaction and human-delegated configuration changes. Use WorkOS with GitHub OAuth for B2B sign-in and organization membership. WorkOS identifies the user; it does not prove repository authority. A GitHub App supplies webhooks, installation tokens and the repository permission checks that decide who may approve. Both checks must pass. Enforce authorization outside agent-controlled code following [security by design](v2-security-design-reference-2026-11-22.md): limited capabilities, resource-scoped access, server-side validation, and auditable delegation. Agents cannot grant themselves authority. Delegated MCP configuration grants are session-scoped by default (automatically revoked when the MCP session ends or is revoked by the user).
- The verifier session may inspect the candidate and create checks in an isolated cloud verification workspace, powered by Codex, Antigravity, or Effect AI behind a verifier-runtime adapter. The sandbox receives only a short-lived, attempt-scoped model credential, ideally issued through a metering gateway. WorkOS, GitHub App, database and control-plane credentials never enter the sandbox. It cannot modify the submitted implementation or approved requirements. Proposed fixes are separate handoffs to implementation agents. Session separation alone does not prove independence or security isolation.
- Support a first-class Derived Check Challenge flow in the Decision Inbox: a maintainer may inspect a verifier-authored check, flag it as defective to trigger check regeneration without waiving the underlying Acceptance Requirement, or optionally promote a useful derived check into the repository's permanent suite.
- Enforce a two-tier extension model. Untrusted project extensions are limited in V2 to versioned checks and agent configurations pinned by Git SHA and executed inside isolated sandboxes. Workflow engines, execution providers, and event listeners remain trusted, platform-deployed plugins. The platform enforces authorization, approved versions, resource ceilings, and evidence integrity regardless of extension behavior.
- Initial limits are one active attempt per PR/MR, thirty minutes of active execution excluding approval and device-queue waits, and at most one infrastructure retry within the same total budget. Failed acceptance checks do not automatically retry. A newly recorded retry captures current configuration but cannot reset that shared budget. Enforce the US$5 model-spend ceiling when every verifier call routes through a metering gateway; where dollar metering is unavailable, require explicit turn, token, and wall-clock caps rather than counting unknown spend as zero.
- Reaching a verification budget stops productive verification and leaves remaining requirements incomplete. Stop is an explicit cancellation command, separate from configuration editing. Cleanup has a five-minute initial allowance. Failed or timed-out cleanup quarantines the environment and creates a Decision Inbox item; confirmed cleanup is required before reuse. External resource leaks and ambiguous deletion remain visible until reconciled.
- Patchplane never executes untrusted verification on a user's personal device. Drop any local personal-machine SimLock dependency from V2. The first native path is cloud-hosted Arbeo Android with approved synthetic work-time rules and entries: demonstrate +05:00 at import preview and confirmation, persistence after an offline restart, and verified cleanup on a disposable cloud device or emulator using a dedicated development account, with no personal data, production credentials, or signing credentials. Split execution into two stages: compile untrusted PR code inside an isolated Linux sandbox to produce a SHA-256-hashed debug APK, then run only that compiled APK through a cloud Android device adapter, starting with Expo Simulators as the initial provider (keeping the adapter provider-neutral so a cloud KVM or SimLock worker pool can plug in later; avoid Firebase Test Lab due to its 2027 shutdown).
- For infeasible before/after demonstrations, record the attempted comparison and reason. Alternative evidence or a waiver follows the configured decision policy, defaulting to a maintainer action. Preserve the limitation and never label a waiver as a successful demonstration.
- Patchplane owns the standalone Web Decision Inbox and its authoritative decision state. GitHub, CLI, and MCP present the same version-bound decisions under platform authorization. Raw session history is inspectable evidence where relevant, not the primary acceptance interface. T3 embedding is out of V2 scope.
- Hosted evidence retention is initially up to seven days for both artifact bytes and report metadata (with matching backup expiry); thirty days and longer belong to a paid hosted offering. Self-hosted owners configure their own retention. Do not infer that paid-plan billing must ship before dogfooding, and never store raw artifact content indefinitely in metadata.
- Keep expired, missing, and digest-mismatched artifacts visible as unavailable. Imported observations retain producer attribution and their original assurance class; they do not become independent verification merely because submission was authenticated.
- Preserve V1 provenance and historical meaning. A data import, archive, or cutover plan must be explicit before altering live storage. A greenfield implementation does not require migrating all historical data into V2 to begin dogfooding.

## Testing Decisions

Test observable behavior and stable contracts, not implementation structure or call counts.

- Enforce Effect and Foldkit/React boundaries with lint and architecture checks, exact Promise-exception allowances, and rejection of stale allowances. Test UI transitions, SSE/WebSocket updates, stale results, typed failures, and resource interruption/cleanup at registered boundaries.
- Drive complete workflows through the public typed API and its actual CLI and MCP clients, from authenticated PR intake through approved requirements, execution, evidence, decisions, and publication.
- Use focused real-Postgres concurrency tests covering both acceptance state and `effect/workflow` / `ClusterWorkflowEngine` journals in the same database: competing claims, duplicate deliveries, stale ownership, conflicting decisions, and interrupted transactions. In-memory substitutes cannot establish database guarantees.
- Exercise interface decision flows, including wrong actor, stale proposal, policy-authorized action attribution, delegated MCP configuration changes, rejection of self-authorization, and Derived Check Challenge regeneration without requirement waivers.
- Test configuration snapshots across recovery and newly recorded attempts, including a retry with a changed policy and the original shared budget. Both human and agent must receive change notices.
- Test restart, durable waits, duplicate signals, supersession, Stop, budget exhaustion (dollar-metered and turn/token/time capped), cleanup failure, `Daytona.CreateSandbox` leak reconciliation, and quarantined-resource reuse rejection.
- Run live GitHub acceptance with actual test repositories, plus forge contract tests verifying provider-neutral abstractions without requiring a live GitLab adapter in V2.
- Run live cloud Linux plus two-stage cloud Arbeo Android paths (isolated Linux APK build with SHA-256 verification followed by cloud emulator execution). Imported historical evidence is not a substitute for these executions. Test source/build identity, clean emulator reset, and the exact offline calculation assertions without extending those results into claims about store binaries, production accounts, or cloud sync.
- Validate extension boundaries: unauthorized capability requests fail, pinned Git SHA mismatch rejects execution, and candidate code cannot rewrite requirements.
- Verify hosted and self-hosted retention behavior separately, including expiry, authorized artifact access, unavailable-evidence reporting, and the eventual hosted entitlement boundary.
- Prove the pinned published toolchain (`@effect/tsgo@0.73.2`, `tsrs@7.1.0-beta.tsrs3`, Oxlint `1.94.0`, Oxfmt `0.79.0`, Foldkit `0.171.0`) using whole-project tsrs checking, an intentional Effect diagnostic, an intentional type-aware Oxlint failure, formatting, and the normal runtime/build gates. Explicitly verify that the invoked compiler is `tsrs@7.1.0-beta.tsrs3` with no silent wrapper fallback. Verify editor integration separately.
- Prove the Alchemy lifecycle for the control-plane server, Neon/Postgres database and migrations, R2/S3 artifacts, and `Daytona.Snapshot` plus `Daytona.CreateSandbox` bindings. Test stable repeat deployment, migration failure, ambiguous sandbox creation recovery, cancellation, and confirmed cleanup without claiming exactly-once external effects.
- Use existing candidate-identity, publication-replay, CLI, and hostile-execution scenarios as behavioral reference material. Reassess each test against V2; do not port framework-specific wiring or assume V1 establishes correctness.
- Dogfood five to ten real PRs across two projects, including Arbeo, end to end. At each handoff the report must identify checks, uncertainty, and the next action without reopening agent conversations. Record actual gaps and maintenance effort; do not infer time savings from commit counts.
- Run resource-heavy tests and builds sequentially. Documentation research is not evidence that these checks have passed.

## Out of Scope

- A new repository, a clone of V1's component inventory, or implementation reuse justified solely by its existence.
- Pre-PR task execution, prompt-to-patch authoring, or autonomous implementation inside the verifier workspace.
- Evaluation of agents themselves across tasks and custom project-specific evidence renderers, both deferred to V3+.
- Treating ingestion alone as the first usable release, or claiming native acceptance from imported observations alone.
- Merge enforcement during initial dogfooding, a replacement forge, a general agent operating system, or an arbitrary business-workflow platform.
- A live GitLab implementation in V2 (keep core contracts provider-neutral so GitLab can plug in later).
- T3 embedded host integration or any dependency on an external agent host to own or display the Decision Inbox.
- Running untrusted verification or builds on a user's personal device, including SimLock on a developer laptop.
- Splitting authoritative state across PostgreSQL and Cloudflare Workflows or Durable Objects, or retaining Convex/D1.
- Maintaining a custom source-built compiler pipeline for `tsrs4` while `@effect/tsgo@0.73.2` + `tsrs3` is published.
- Arbitrary tenant-uploaded workflow engines, execution providers, or event listeners.
- Silent fallback to an older compiler, non-Effect application orchestration, or durable infrastructure deployment outside Alchemy.
- Paid billing, customer acquisition, or commercial validation as prerequisites for the first dogfood experiment.
- Applying hosted retention restrictions to self-hosted storage.
- Production deployment, destructive legacy cleanup, or historical-data deletion as part of writing this spec.

## Further Notes

The current branch is `feat/v2-migration`. No greenfield worktree, dependency upgrade, live acceptance run, or deployment has been performed during this design phase.

Accepted decisions are recorded in ADRs 0002 through 0010 and [GLOSSARY.md](../GLOSSARY.md). The current V1 [SPEC.md](../SPEC.md) and ADR 0001 continue to describe V1 until explicitly replaced; V2 does not reinterpret historical reports.

The remaining technical stack proof before full implementation covers: Effect `4.1.5` + `effect/workflow` + `ClusterWorkflowEngine` on Neon PostgreSQL via `@effect/sql-pg`, Alchemy deployment of the Bun Effect server on Cloudflare Containers and the `Daytona.CreateSandbox` binding, Foldkit `0.171.0` Web Inbox + SSE/WebSocket updates, WorkOS + GitHub OAuth with session-scoped MCP delegation, verifier runtime setup (Codex, Antigravity, or Effect AI), and live Arbeo Android execution on Expo Simulators.
