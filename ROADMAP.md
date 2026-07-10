# ROADMAP.md – PatchPlane v2 Alpha Execution Plan

**Date:** June 25, 2026  
**Source of truth:** [SPEC.md](./SPEC.md)  
**Architecture:** Effect v4 / effect-smol core with plugin-based infrastructure boundaries  
**Status:** Public OSS roadmap for the alpha trust-boundary loop

---

## 0. Purpose of this roadmap

This roadmap tracks the public execution path for PatchPlane's first alpha: one end-to-end, human-gated trust-boundary workflow for AI-generated code changes.

`SPEC.md` defines the product thesis, trust model, architecture boundaries, and alpha success criteria. This roadmap defines the implementation order, milestone status, and public acceptance criteria.

This file is intentionally OSS-safe. It documents product and engineering direction only. It does not include pricing strategy, customer notes, sales pipeline, founder/company strategy, or private credentials.

---

## 1. Current objective

PatchPlane v2 has completed the authenticated foundation work and is now focused on one developer-first outcome: **trusting or rejecting an AI-generated patch before merge**.

The product primitive is the **Patch Report**: an evidence-backed report that tells a developer what changed, what ran, where it ran, what passed or failed, what evidence exists, and who approved or rejected it.

The first credible pre-CI trust-boundary demo is:

```text
GitHub/manual intake
→ authenticated or signed PatchPlane workflow
→ repository allowlist/access verification
→ Daytona sandbox provisioning
→ Pi runtime execution
→ candidate patch + logs/tests/browser evidence
→ Patch Report
→ PatchPlane policy/review decision
→ human approve/reject
→ GitHub comment/check/draft PR publication
→ persisted provenance timeline
```

The next slice is **not more platform**. It is the smallest workflow that shows an AI-generated patch remaining untrusted until sandbox execution, Patch Report evidence, review, and explicit decision complete.

For alpha, these remain deferred:

- complex provenance graph UI
- multiple sandbox providers beyond Daytona
- multiple Git forges beyond GitHub
- weighted scoring and broad policy editor work
- full enterprise RBAC beyond current organization-level auth
- plugin marketplace work
- billing or monetization work
- ClickHouse/OpenTelemetry collector infrastructure
- PostHog AI observability dashboards
- Origin-style forge behavior

---

## 2. Public alpha architecture boundary

PatchPlane's alpha is built around public, replaceable service boundaries:

```text
AuthService              -> WorkOS AuthKit
StorageService           -> Convex workflow state/read model
SourceControlService     -> GitHub App / Octokit
SandboxService           -> Daytona
RuntimeService           -> Pi coding-agent runtime (sandbox-backed for alpha)
ModelGatewayService      -> Cloudflare AI Gateway
ArtifactsService         -> Cloudflare R2
TelemetryService         -> Sentry + Effect logs/spans
AnalyticsService         -> PostHog product events
InfraProvisioning        -> Alchemy in apps/infra
```

Important boundaries:

- `packages/core` must not import WorkOS, Convex, GitHub, Daytona, Pi, Cloudflare, Alchemy, Sentry, PostHog, or TanStack Start.
- SDK-specific objects stay inside plugin packages or app composition code.
- Convex stores workflow/provenance metadata and realtime read-model state.
- Cloudflare R2 stores large raw evidence artifacts.
- Sentry is for operational debugging, not product truth.
- PostHog is for product analytics, not provenance truth.
- ClickHouse is deferred until high-volume trace analytics are needed.
- Alchemy provisions PatchPlane-owned infrastructure; it does not replace runtime product services.

---

## 3. Alpha data ownership model

PatchPlane-owned product truth should use PatchPlane-owned domain concepts:

```text
WorkflowRun
ExternalWorkflowRef
RuntimeEvent
SandboxPolicy
CandidatePatchSet
PatchReport
ReviewFinding
PolicyDecision
HumanDecision
PublicationResult
ProvenanceTimeline
EvidenceArtifact
BrowserVerificationResult
```

Vendor-specific data must be normalized before crossing into core or UI-facing product state:

```text
Pi events               -> RuntimeEvent
Daytona objects         -> Sandbox/session/provenance metadata
Octokit objects         -> SourceControlService results
WorkOS objects          -> Actor/Workspace/Membership/Permission
Convex documents        -> decoded domain values
Sentry traces           -> operational telemetry only
PostHog events          -> product analytics only
R2 objects              -> EvidenceArtifact references
```

---

## 4. Milestones

### M0 — Repo alignment and dependency baseline

**Status:** In progress

Public goals:

- [x] Keep `/vendor` sources as research-only references.
- [x] Use normal package dependencies in PatchPlane packages.
- [x] Pin Effect v4 / effect-smol consistently where used.
- [x] Use `@daytona/sdk` for Daytona integration.
- [x] Use Pi coding-agent behavior behind a runtime boundary. For alpha, Pi executes inside Daytona rather than being bundled into the web/control-plane Worker.
- [x] Use Octokit/GitHub App APIs behind a GitHub plugin boundary.
- [x] Keep `apps/client` as the TanStack Start composition root.
- [x] Keep Convex deployment functions under `packages/backend/convex` for now.
- [x] Target Node 22.19+ for server/plugin runtime work.

Acceptance criteria:

- [x] The repo structure supports `packages/domain`, `packages/core`, `packages/plugins`, `apps/client`, and `packages/backend/convex`.
- [x] `packages/core` imports only PatchPlane domain/core dependencies and Effect.
- [x] Vendor research does not leak into runtime imports.

---

### M1 — Create v2 package skeleton

**Status:** Complete for foundation experiment

Target structure:

```text
packages/domain
packages/core
packages/plugins
packages/backend/convex
packages/cli
apps/client
```

Tasks:

- [x] Create `packages/domain`.
- [x] Create `packages/core`.
- [x] Create `packages/plugins`.
- [x] Keep existing `apps/client` as the app composition root.
- [x] Add explicit package subpath exports.
- [x] Add package-level typecheck/test scripts.
- [x] Include new packages in root typecheck/lint scripts.

Acceptance criteria:

- [x] `bun install` succeeds.
- [x] `bun run typecheck` reaches the new packages.
- [x] `packages/core` does not import app/plugin/vendor SDKs.

---

### M2 — Domain schemas and typed errors

**Status:** Foundation slice working

Tasks:

- [x] Implement branded/domain IDs for foundation entities.
- [x] Implement `Actor`, `Workspace`, `Membership`, and `Permission` schemas.
- [x] Implement `PromptRequest` and `WorkflowRun` schemas.
- [x] Implement typed errors for auth, storage, source control, GitHub, workflow state, and validation failures.
- [x] Add `traceId` to foundation request/run schemas.
- [x] Add generic `ExternalWorkflowRef` and `WorkflowIntake` schemas.

Acceptance criteria:

- [x] Domain schemas decode unknown input.
- [x] External/plugin data entering core has a decode path.
- [x] Typed errors are PatchPlane-owned and do not expose raw SDK error types.

---

### M3 — Core service contracts

**Status:** Complete for alpha core service contracts

Tasks:

- [x] Define `AuthService`.
- [x] Define experimental `StorageService` with prompt and external-intake creation paths.
- [x] Define generic `SourceControlService`.
- [x] Define GitHub-specific `GitHubWebhookService`.
- [x] Define minimal `TelemetryService` interface.
- [x] Define `ArtifactsService` interface for evidence storage.
- [x] Define `ModelGatewayService` interface for agent model access configuration.
- [x] Implement `StartWorkflowFromPrompt`.
- [x] Implement `StartWorkflowFromIntake` with repository verification before persistence.
- [x] Add structured context fields with `traceId`.

Acceptance criteria:

- [x] Core workflows depend only on services, not SDKs.
- [x] Storage/auth/source-control failures map to typed PatchPlane errors.
- [x] Full workflow timeline/event history remains deferred until `RuntimeEvent`, `ReviewRun`, and decision schemas exist.

---

### M4 — Convex realtime orchestration/read-model boundary

**Status:** Authenticated foundation slice working

Tasks:

- [x] Keep Convex deployment functions in `packages/backend/convex`.
- [x] Add minimal Convex mutations/queries needed by the foundation storage path.
- [x] Keep workflow-start creation transactional.
- [x] Store `traceId` on foundation records.
- [x] Gate public workflow-start writes with WorkOS JWT validation and mirrored membership authorization.
- [x] Gate reads with WorkOS identity and mirrored active membership checks.
- [x] Add `externalWorkflowRefs` for signed/external provider events.

Acceptance criteria:

- [x] Convex backend code remains isolated under `packages/backend/convex`.
- [x] Convex generated API exposes public reads and the signed external-ingestion mutation.
- [x] Convex remains the alpha realtime read-model/orchestration implementation, not a product-truth shortcut.

---

### M5 — Convex Storage Plugin

**Status:** Authenticated/trusted foundation slice working

Tasks:

- [x] Define initial Convex schema for foundation entities.
- [x] Add `ConvexConfig` through Effect Config.
- [x] Implement domain ↔ Convex document mapping.
- [x] Implement authenticated workflow creation through Convex mutation with WorkOS JWT.
- [x] Implement signed external-intake workflow creation.
- [x] Decode Convex documents back through domain schemas.

Acceptance criteria:

- [x] Foundation and external-intake records persist through `StorageService`.
- [x] Core does not import Convex APIs.
- [x] Convex access stays inside plugin/backend boundaries.

---

### M6 — App composition root and first vertical action

**Status:** Runtime, AuthKit composition, authenticated workflow path, and CLI onboarding foundation working

Tasks:

- [x] Compose WorkOS and Convex plugin layers in the app root.
- [x] Create a managed Effect runtime for app/server actions.
- [x] Wire WorkOS AuthKit and Convex AuthKit providers.
- [x] Productize the visible prompt/workflow UI for the current alpha shell.
- [x] Add initial Effect logs and local JSONL logs.
- [x] Add `packages/cli` as an Effect CLI onboarding surface.

Acceptance criteria:

- [x] Authenticated WorkOS users can create `PromptRequest` and `WorkflowRun` records through the core workflow.
- [x] App routes/server functions talk to core through the managed runtime.
- [x] CLI commands run through PatchPlane-owned service layers.

---

## 5. Current verified experiment

The current foundation verifies these paths:

```text
TanStack Start server function
→ WorkOS session extraction
→ AuthRequestContext
→ WorkOSAuthPlugin.requirePermission("prompt:create")
→ StorageService
→ ConvexStoragePlugin
→ Convex authenticated mutation
→ promptRequests + workflowRuns
```

```text
/api/github/webhook
→ raw GitHub payload + signature headers
→ GitHubWebhookService.verifyWebhook
→ GitHub-specific normalization
→ WorkflowIntake + ExternalWorkflowRef
→ repository allowlist/access verification
→ StorageService.createWorkflowFromIntake
→ Convex signed external-ingestion mutation
```

Automated checks currently cover the foundation, backend Convex behavior, CLI integration, domain/core/plugin tests, typechecking, linting, and app build.

Remaining manual smoke before external alpha:

- Hosted WorkOS AuthKit sign-in and callback with real credentials.
- Convex WorkOS webhook delivery for users and organization memberships.
- Browser workflow start from `/app` with a real organization membership.
- Real GitHub App webhook delivery to `/api/github/webhook` with required alpha configuration.

---

## 6. End-to-end alpha backlog

M1–M6 are the authenticated foundation. Continue with the trust loop: WorkOS hardening → GitHub completion → Daytona → Cloudflare infra → Pi → evidence capture → review/decision/publication.

---

### M6.5 — WorkOS / Convex auth hardening

**Status:** In progress / mostly complete

Tasks:

- [x] Add WorkOS plugin configuration with Effect Config.
- [x] Implement WorkOS `User`, `Organization`, and `OrganizationMembership` mappings.
- [x] Implement WorkOS role(s) → PatchPlane permission mapping.
- [x] Wire WorkOS AuthKit to real session data.
- [x] Forward AuthKit access tokens through authenticated workflow paths.
- [x] Add Convex-side mirrored users and memberships.
- [x] Add mirrored membership checks in Convex reads/writes.
- [ ] Add documented backfill/update strategy for dynamic role/permission changes.
- [ ] Add resource-level WorkOS Authorization API checks when repository/project-scoped permissions are introduced.

Acceptance criteria:

- [x] User-facing workflow starts are authorized by WorkOS/Convex identity and mirrored permissions.
- [x] WorkOS SDK objects do not cross into core.

---

### M7 — GitHub Provider Plugin

**Status:** Initial verified external intake complete; publication path pending

Tasks:

- [x] Add `GitHubConfig`.
- [x] Implement installation-token broker with Octokit GitHub App APIs.
- [x] Implement repository access verification.
- [x] Implement issue-comment publication.
- [x] Verify signed webhooks before normalization or persistence.
- [x] Normalize initial GitHub events into generic workflow intake values.
- [x] Persist external event references for idempotency.
- [x] Require an alpha repository allowlist for webhook-to-workspace routing.
- [ ] Implement check/draft PR publication.
- [ ] Add one user-visible GitHub publication path for the alpha demo.

Acceptance criteria:

- [x] GitHub App installation-token flow is isolated inside `packages/plugins`.
- [x] Verified GitHub events become generic `WorkflowIntake` values.
- [ ] PatchPlane can publish an alpha result back to GitHub without leaking Octokit objects into core.

---

### M7.5 — Minimal TelemetryService and operational visibility

**Status:** Complete for alpha operational telemetry

Scope:

- Add a minimal `TelemetryService` interface.
- Keep Effect structured logs and span-like context.
- Add Sentry integration for operational errors and debugging.
- Keep OpenTelemetry-compatible naming where practical.
- Do not add an OpenTelemetry collector/backend for alpha.

Tasks:

- [x] Define `TelemetryService` in core contracts.
- [x] Add Sentry plugin/layer for captured exceptions and failed operations.
- [x] Add `traceId`, `workflowRunId`, `pluginName`, `operation`, and `runtimeSessionId` fields consistently across future plugins.
- [x] Ensure Sentry traces/logs are operational visibility only, not provenance truth.
- [x] Capture server-function and webhook runtime failures through `TelemetryService.captureError`.
- [x] Centralize Effect-native telemetry annotations and failure capture helpers.
- [x] Add unit coverage for telemetry context helpers, Sentry no-DSN no-op behavior, and best-effort Sentry failure handling.
- [x] Manually validate a `TelemetryService.captureError` test event reaches Sentry.

Acceptance criteria:

- [x] Runtime failures can be diagnosed without reading only local logs.
- [x] Product provenance remains in PatchPlane-owned storage/timeline records.
- [x] No OpenTelemetry collector, ClickHouse, or observability platform is required for alpha.

---

### M8 — Daytona Sandbox Plugin

**Status:** Complete for Daytona lifecycle/policy scope; durable R2 raw artifact capture remains in the artifact slice. The old Daytona-SDK-only live smoke has been removed in favor of the PatchPlane Daytona/Pi RPC smoke.

Tasks:

- [x] Add `DaytonaConfig` with redacted API key handling.
- [x] Implement alpha-safe scoped sandbox execution via `SandboxService.runRepositoryCommand` / `runRepositoryAgent`.
- [x] Prefer ephemeral or auto-deleting sandbox profiles for alpha.
- [x] Add explicit sandbox policy fields for lifecycle, resources, timeout, and network posture.
- [x] Implement checkout/clone support.
- [x] Implement command execution.
- [x] Collect basic command logs in workflow storage; R2-backed artifact capture remains in the artifact slice.
- [x] Stop/destroy sandboxes on cancellation/failure where possible after acquisition succeeds.
- [x] Add live Daytona smoke script with redacted API-key handling, public repository clone, command execution, and cleanup polling.
- [x] Persist normalized sandbox policy as typed Convex metadata rather than JSON glue.
- [x] Add safe fake Daytona lifecycle tests for clone failure, command failure, non-zero exit, interruption, retain mode, and delete retry.

Implementation note:

- M8 currently includes the pragmatic `daytona-pi` command adapter: Daytona provisions the sandbox and invokes the Pi CLI inside it. This is the alpha bridge, not the final RuntimeService split. The web/control-plane runtime must not load the in-process Pi SDK plugin for this path.

Acceptance criteria:

- [x] A workflow can provision a sandbox, check out a GitHub repository ref, run at least one command, collect command logs, and tear down the sandbox.
- [x] Sandboxes never receive long-lived WorkOS, Convex, or GitHub App credentials.
- [x] Sandbox lifecycle and network policy are visible in stored workflow metadata.
- [ ] Durable raw artifact capture is backed by R2 rather than Convex stdout/stderr columns.

---

### M8.25 — Minimal Cloudflare infra provisioning

**Status:** Complete for minimal alpha R2 + AI Gateway provisioning; runtime artifact plugin remains in the later artifact slice

Purpose:

Add the smallest Cloudflare-first infrastructure slice needed for evidence storage and model access without turning PatchPlane into an infrastructure platform.

Scope:

- Add `apps/infra` as a runnable Alchemy deployment app.
- Provision PatchPlane-owned Cloudflare R2 buckets for dev/prod stages.
- Provision PatchPlane-owned Cloudflare AI Gateway for agent model access.
- Add lifecycle rules for short-lived alpha artifacts where useful.
- Expose required environment/config values for runtime plugins.

Explicit non-goals:

- Do not move runtime execution to Cloudflare Workers for alpha.
- Do not replace Octokit/GitHub App runtime integration.
- Do not manage customer repositories as Alchemy resources.
- Do not add Cloudflare D1, Queues, Workflows, Vectorize, AutoRAG, or broader Cloudflare platform scope for alpha.

Tasks:

- [x] Add `apps/infra/alchemy.run.ts`.
- [x] Add dev/prod stage naming for PatchPlane-owned infrastructure.
- [x] Provision R2 bucket(s) for evidence artifacts.
- [x] Provision AI Gateway for Pi model access.
- [x] Document required env vars and generated config values.
- [x] Add deployment scripts for local/CI usage.

Acceptance criteria:

- [x] Running the infra deployment for a dev stage creates the R2 bucket and AI Gateway.
  - Verified with `CI=1 bun run infra:deploy -- --env-file ../../.env.local --stage dev --yes`.
  - Created `patchplane-dev-evidence-artifacts` and `patchplane-dev-model-gateway`.
- [x] PatchPlane runtime code does not import Alchemy.
- [x] `packages/core` imports no Alchemy or Cloudflare SDK types.

---

### M8.5 — Alpha Workflow Visibility Slice

**Status:** Implemented for the current Convex workflow read model; durable R2 artifact capture remains deferred to the artifact slice

Scope:

- Make the trust loop visible early, before a polished dashboard.
- Use simple tables, cards, and vertical timelines.
- Show workflow status, source, repository, sandbox state, runtime state, artifact references when present, and decision state.

Tasks:

- [x] Add workflow detail view or side panel.
- [x] Show prompt/intake summary.
- [x] Show repository and sandbox status.
- [x] Show command/log placeholders backed by real records where available.
- [x] Show provenance timeline events.
- [x] Keep complex graph UI deferred.
- [x] Use TanStack Table with the shared table primitive for the workflow queue.
- [x] Use TanStack Form with Effect Standard Schema validation for workflow-start input.
- [x] Add direct M8.5 hardening coverage for workflow queue filtering/selection and workflow-start form validation.

Acceptance criteria:

- [x] A real GitHub/Daytona-backed workflow is understandable from the UI without reading server logs.
- [x] The UI communicates why a patch is still untrusted, pending review, approved, or rejected.

Evidence:

- Authenticated `/app` now renders a workflow review console instead of dashboard cards.
- Auth loading uses the same workflow-console skeleton instead of the old metric-card dashboard.
- The console shows workflow status, source/repository, trust state, selected workflow inspector, sandbox/log/decision evidence, detail tabs, timeline, and artifact-reference state.
- The selected queue row and inspector share the same detail-backed trust state, so sandbox failure is not hidden behind a generic reviewed/needs-review row.
- Workflow rows open an object-specific detail sheet directly while keeping the selected inspector state in sync.
- Convex `workflowStarts.getDetail` returns prompt, workflow run, runtime events, and sandbox executions for the detail surface.
- `apps/client/src/components/app-shell/workflow-console.test.tsx` covers queue rendering, search/trust-state filtering, inspector evidence, row-open behavior, detail tabs, and artifact-reference display.
- `apps/client/src/components/app-shell/start-workflow-panel.test.tsx` covers TanStack Form submission behavior, authenticated-workspace gating, and Effect Standard Schema validation blocking invalid prompts.
- `apps/client/src/components/app-shell/loading-workflow-console.test.tsx` guards against the old metric-card loading dashboard returning.

---

### M8.6 — Hosted GitHub Repo Connection Slice

**Status:** Implemented and live-smoke verified for the hosted GitHub App connection path

Goal:
Make the hosted PatchPlane alpha usable without CLI setup and without asking users to manually install/configure their own GitHub App.

User-facing flow:
1. User signs in to PatchPlane.
2. User clicks "Connect GitHub".
3. GitHub shows the standard account/org and repository access screen.
4. User selects one or more repositories.
5. PatchPlane stores the GitHub installation/account/repository mapping.
6. Dashboard shows connected repositories and connection status.
7. Developer opens or updates a PR.
8. PatchPlane receives the PR event.
9. PatchPlane runs verification.
10. PatchPlane posts a trust report as a PR comment.
11. Dashboard shows the run result, logs, and decision state.

Implementation notes:
- Hosted PatchPlane uses a PatchPlane-owned GitHub App.
- Use Octokit for GitHub App authentication, installation access tokens, webhook handling, repository listing, PR comments, and check/status updates.
- Users should not see GitHub App terminology unless GitHub itself displays it during authorization.
- Store installation ID, account/org ID, selected repositories, and permission state.
- Treat missing repo access as a reconnect/configuration issue, not a developer setup task.

Completed implementation:
- [x] Added provider-owned repository connection domain schemas in `packages/domain/src/repository-connection.ts`.
- [x] Added Convex `connectedRepositoryAccounts`, `connectedRepositories`, and `githubConnectionIntents` tables with indexes for workspace listing, pending install state, and GitHub webhook routing.
- [x] Added authenticated Convex repository connection mutations/queries plus system-secret webhook route lookup in `packages/backend/convex/connectedRepositories.ts`.
- [x] Extended `SourceControlService` with installation account and installation repository listing contracts.
- [x] Implemented GitHub App installation account/repository listing in `GitHubProviderPlugin` via Octokit installation auth, including API failure and malformed metadata coverage.
- [x] Added normalized `pull_request.opened` and `pull_request.synchronize` event support with PR provenance fields.
- [x] Added `/api/github/install/start` to create a pending connection intent and redirect to the GitHub App installation URL.
- [x] Added `/api/github/install/callback` to consume the install intent, list installation repositories, and store connected repositories in Convex.
- [x] Added connected GitHub repository UI in the authenticated app shell with a Connect GitHub button and connected repository status list.
- [x] Updated `/api/github/webhook` to route hosted webhooks through Convex connected repository lookup, while preserving the env allowlist fallback for OSS/local self-hosted routing.
- [x] PR opened/synchronize events now start the existing verification path and publish the sandbox trust report through the existing GitHub issue-comment publication path.
- [x] Added tests for Convex repository connection storage/routing/intents, PR webhook normalization/intake mapping, PR trust-report publication, Octokit installation listing/failures, install flow helpers, and webhook route workspace resolution.
- [x] Live-smoked hosted GitHub App install/callback against a real selected repository, storing the installation account and selected repository in Convex.
- [x] Live-smoked PR `synchronize` webhook routing through Convex connected repository lookup, Daytona/Pi sandbox execution, Convex `sandboxExecutions` persistence, and GitHub PR trust-report comment publication.
- [x] Added a PatchPlane bot-comment feedback-loop guard for generated trust-report comments.
- [x] Live-smoked the direct Convex-backed Daytona/Pi path from `StartWorkflowFromIntake` through `workflowStarts:createFromExternalIntake`, `RunSandboxAgentForWorkflow`, and `workflowStarts:recordSandboxExecution`.

Remaining hardening:
- [ ] Add a reusable `smoke:convex-sandbox` script for the live Convex + Daytona/Pi path instead of relying on an inline command.
- [ ] Add browser E2E for Connect GitHub once stable hosted credentials are available.
- [ ] Add richer dashboard aggregation for latest verification status per connected repository.

Acceptance criteria:
- [x] No CLI required for hosted onboarding.
- [x] No manual GitHub App creation required.
- [x] No webhook URL copy/paste required.
- [x] User can connect GitHub through PatchPlane.
- [x] User can select repositories on GitHub's screens.
- [x] PatchPlane can list connected repositories.
- [x] PatchPlane reacts to PR opened/synchronize events.
- [x] PatchPlane posts a clear PR trust report.
- [ ] Dashboard shows connected repo, latest verification run, and status.

Goal:
```
Hosted:
Sign in → Connect GitHub → Select repo on GitHub screen → Open PR → PatchPlane verifies → PR trust report + dashboard run

OSS:
CLI/self-host setup → configure GitHub/App manually if needed → run PatchPlane locally/self-hosted
```

---

### M9 — Remote Sandbox Agent Runtime Adapter

**Status:** Complete for the alpha runtime architecture — Pi JSON-mode and RPC-mode paths are sandbox-backed, Effect-native at the runtime boundary, unit-tested, and live-smoked against Daytona. Remaining future work is provider breadth and deeper long-running session reconciliation hardening, not a blocking architecture gap.

Intent:

PatchPlane does not run coding-agent runtimes in-process in the trusted control plane. Pi executes only inside remote sandbox environments. The control plane provisions the sandbox, launches the runtime process, captures untrusted output/events, normalizes them into PatchPlane schemas, and persists them through Convex/R2.

Tasks:

- [x] Add initial Pi provider/model defaults for the sandbox-backed CLI path.
- [x] Prove Pi can be invoked inside Daytona through the M8 `daytona-pi` command adapter.
- [x] Remove the unused in-process Pi SDK plugin from `packages/plugins` exports/registry/dependencies.
- [x] Remove the leftover `packages/plugins/src/pi` config shim and unused premature core `RuntimeService`/`ModelGatewayService` abstractions.
- [x] Move Pi command construction, provider env mapping, and output parsing out of the Daytona plugin into sandbox-backed runtime adapter modules.
- [x] Replace the legacy `runtime/pi/rpc.ts` helper facade with an Effect RPC contract (`contract.ts`), runtime-session facade (`runtime-session.ts`), transport adapter (`transport.ts`), stream JSONL decoder (`jsonl.ts`), protocol parser (`protocol.ts`), and normalized event stream (`ingestion.ts`).
- [x] Use `pi --mode json` or `pi --mode rpc` for structured runtime output where practical.
- [x] Replace OpenAI-only runtime assumptions with configurable provider/model settings.
- [x] Default alpha model access to Cloudflare AI Gateway where configured.
- [x] Keep direct OpenAI or other direct providers as local/debug fallback options.
- [x] Map Pi events to PatchPlane `RuntimeEvent` records.
- [x] Map cancellation to remote sandbox process/session control.
- [x] Map steering/follow-up to human interrupt/redirect primitives only when the remote sandbox runtime mode supports it.
- [x] Persist `RuntimeSession` lifecycle state in Convex for RPC-capable remote runtime sessions.
- [x] Persist RPC runtime sessions immediately after Daytona returns `sessionId`/`commandId`, before sending control input.
- [x] Add unit coverage for Pi RPC command encoding/parsing, Daytona async session handles, control workflows, hard-terminate idempotency, and Convex runtime session lifecycle.
- [x] Add a Pi-specific strict LF JSONL stream decoder that preserves standalone `\r`, `U+2028`, and `U+2029` instead of relying on generic line splitting.
- [x] Wrap Daytona streaming log callbacks as typed Effect `Stream`s and feed them through the Pi runtime-session event stream for incremental event persistence.
- [x] Preserve enough raw event metadata for debugging while storing normalized events as product truth.
- [x] Expose abort/steer/follow-up/terminate through authenticated hosted app/API surfaces with workflow-run authorization checks; client input is `workflowRunId` plus operation/message, never raw sandbox/session IDs.
- [x] Integrate Daytona log streaming/polling into incremental runtime-event persistence for active RPC sessions, including disconnect reconciliation via buffered logs and idempotent Convex dedupe.
- [x] Add a reusable Daytona/Pi RPC smoke script entrypoint with RPC event collection and steer/follow-up/abort/terminate assertions.
- [x] Run the live Daytona/Pi RPC smoke against real credentials and validate `get_state`, command responses, streamed runtime events, steer/follow-up acceptance, abort, terminate/delete-session behavior, and final Daytona sandbox deletion.
- [x] Add architecture coverage preventing Pi runtime packages from becoming trusted control-plane dependencies.

Acceptance criteria:

- PatchPlane can start one Pi coding-agent session inside a remote sandbox-backed workflow.
- The hosted web/control-plane Worker does not bundle `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, or provider SDKs solely for agent runtime execution.
- Pi uses configured provider/model access rather than a hardcoded single provider.
- Pi events are normalized into PatchPlane-owned `RuntimeEvent` records through an Effect `Stream` boundary.
- Pi-specific runtime objects and raw JSONL commands do not cross into core/UI.
- Daytona plugin code consumes `makePiRuntimeSession` rather than raw push/end parser state or legacy command helper functions.

---

### M9.5 — Dashboard and workflow visibility pass

**Status:** In progress — M8.5 sheet detail is being split into queue/inspector triage plus a full workflow investigation route

Timing:

- Before GitHub/Daytona/Pi: keep the UI functional, not polished.
- After GitHub and Daytona: add real repository, sandbox, command/log, and provenance placeholders.
- After Pi events: add the first serious dashboard/review UX pass.

Rules:

- Do not fork full dashboard starters or replace the current app shell.
- Build from local UI components in `apps/client/src/components/ui`.
- Keep complex provenance graph UI deferred.
- Make raw patch/diff, logs, artifacts, and provenance easy to inspect.
- Use the sheet only as quick preview/triage; serious investigation belongs on the full workflow page.

First dashboard scope:

- [x] Recent workflows table exists from M8.5 and remains the queue surface.
- [x] Right inspector exists from M8.5 and remains the fast triage surface.
- [x] Add full workflow detail route for investigation (`/app/workflows/$workflowRunId`).
- [x] Keep sheet as compact preview with an “Open full workflow” handoff.
- [x] Timeline with runtime/sandbox/provenance events.
- [x] Runtime session section backed by Convex `runtimeSessions` read-model data.
- [x] Full-page logs, sandbox evidence, artifacts, review, and raw evidence tabs.
- [ ] Review split view once candidate patches exist.
- [x] Approve/reject/request-changes controls with required comment UI.
- [ ] Persist minimal review decisions, or defer durable review-run persistence explicitly to M10.

Acceptance criteria:

- The dashboard uses the existing PatchPlane shell.
- A real Pi/Daytona/GitHub-backed workflow is understandable from the UI.
- Review ergonomics are good enough for maintainer-controlled dogfooding.

---

### M9.75 — Patch Report and evidence capture slice

**Status:** Complete for the alpha evidence pipeline; remaining work moves into the M10 decision/publication loop

Purpose:

Make the Patch Report the center of the alpha. Capture enough evidence to help a developer trust or reject the AI patch.

Scope:

- Add `PatchReport` domain/read-model schema.
- Assemble Patch Report v0 from workflow, sandbox, runtime, and source-control data.
- Publish Patch Report summary to GitHub.
- Add `EvidenceArtifact` domain model and Convex metadata persistence.
- Add `ArtifactsService` with Cloudflare R2 implementation.
- Store large/raw artifacts in R2, not Convex, Sentry, or PostHog.
- Add one minimal browser verification path with screenshot or video evidence where useful.

Tasks:

- [x] Define initial `PatchReport` schema.
- [x] Assemble Patch Report v0 read model from existing Convex workflow detail data.
- [x] Reframe GitHub sandbox publication as a Patch Report summary.
- [x] Define `EvidenceArtifact` schema.
- [x] Define `ArtifactsService` interface.
- [x] Implement R2-backed `ArtifactsService` plugin.
- [x] Store artifact metadata and hashes in Convex.
- [x] Add signed or authenticated artifact access path.
- [x] Capture stdout/stderr logs as artifacts where size warrants it.
- [x] Capture patch/diff/test-report artifacts.
- [x] Add first browser verification result and screenshot/video artifact path.

Implementation evidence:

- Daytona captures `git diff --binary` as a `diff` artifact when a sandbox run changes the worktree.
- Daytona probes conventional test report files such as `.patchplane/test-report.json` and `.patchplane/test-report.xml` after the main run and optional producer command.
- Daytona probes conventional browser screenshot files such as `.patchplane/browser-screenshot.png` after the main run and optional producer command.
- Core uploads sandbox-provided evidence through `CaptureEvidenceArtifact`, which stores raw bytes in R2 and metadata in Convex.
- The client Evidence tab opens persisted evidence artifacts through authenticated signed URLs.

Acceptance criteria:

- A developer can open one Patch Report and answer: what changed, what ran, where it ran, what passed or failed, what evidence exists, and what decision is pending or recorded.
- A workflow stores raw evidence artifacts in R2.
- Convex stores artifact metadata, hashes, and references.
- The UI can link from a Patch Report/provenance event to its evidence artifacts.
- Raw artifacts are not sent to PostHog and are not treated as Sentry product truth.

### M9.9 — Minimal Landing Page Packaging Slice

**Status:** Planned, public alpha packaging only

Purpose:

Make the public product message understandable before broader alpha demos.

Scope:

- Keep language product-focused and developer-facing.
- Avoid heavy architecture-first copy.
- Explain the trust loop clearly.
- Link to the OSS repo/docs.
- Avoid pricing/commercial details in OSS docs.

Suggested minimal sections:

- Hero: what PatchPlane does in one sentence.
- Trust loop: agent patch → sandbox → evidence → human decision → publication.
- Why it exists: AI coding output needs verification and provenance before entering trusted workflows.
- Alpha status: focused on one GitHub/Daytona/Pi loop.
- OSS/developer section: inspect, run, contribute, or follow development.

Acceptance criteria:

- A developer can understand the alpha promise quickly.
- The landing page does not overpromise broad platform capabilities before alpha proof.

---

---

### M10 — Evidence-backed decision and publication loop

**Status:** Alpha demo finish line

Purpose:

A human can approve, reject, or request changes from the Patch Report, and PatchPlane can publish the resulting GitHub outcome without treating the AI patch as trusted before the recorded decision.

Tasks:

- [x] Implement `CandidatePatchSet` schema and persistence.
- [x] Implement `ReviewRun` and `ReviewFinding` schemas and persistence.
- [x] Implement one reviewer path, initially test/lint-oriented.
- [x] Implement `PolicyService.evaluatePolicy`.
- [x] Implement `ProposeMergeDecision`.
- [x] Persist minimal human decision linked to the Patch Report.
- [x] Require a comment for approve/reject/request-changes decisions.
- [ ] Update Patch Report status from the durable decision.
- [ ] Add operator approval/rejection/request-changes path.
- [ ] Publish updated GitHub comment/check/draft PR result after decision.
- [ ] Record provenance linking prompt, actor/workspace, repository, sandbox, runtime session, commands/tests, candidate patch, Patch Report, review result, decision, and publication result.

Implementation evidence:

- Domain schemas now cover `CandidatePatchSet`, `ReviewRun`, `ReviewFinding`, `PolicyDecision`, `HumanDecision`, and `PublicationResult`.
- Convex persists those records with workflow-run indexes and returns them from workflow detail.
- System-ingestion mutations record candidate patches, automated review/policy output, and publication results.
- Authenticated human decisions require a non-empty comment and `decision:approve` or `decision:reject` permission.
- Core now has `ReviewService`, `PolicyService`, alpha deterministic review/policy layers, and `ProposeMergeDecision`.
- The first reviewer records failed sandbox execution and missing diff evidence as review findings, then policy keeps the patch in `changes-requested` or `manual-review` until human approval.

Acceptance criteria:

- A generated patch remains untrusted until sandbox execution, Patch Report evidence, and review complete.
- A human can approve, reject, or request changes from the Patch Report before publication/merge handoff.
- The alpha demo can show why the decision was made using persisted Patch Report provenance and evidence, not only transient logs.

---

### M10.5 — Optional SQL durable workflow storage plugins

**Status:** Deferred until after the pre-CI trust-boundary demo has real workflow/event shapes

Scope:

SQL plugins are for durable workflow persistence only. They are not intended to replace Convex's realtime UI/read-model role, WorkOS auth mirroring, or Convex-side public query/mutation authorization in the alpha.

Potential future targets:

- Postgres via Effect SQL
- SQLite Node for local/self-hosted deployments
- MySQL after schema portability is proven
- D1 only if a Cloudflare deployment target creates a clear need

Tasks:

- [ ] Extract shared SQL workflow-storage implementation when real workflow event shapes stabilize.
- [ ] Add migrations for workflow and event tables.
- [ ] Keep all SQL driver details inside plugin packages.

Acceptance criteria:

- A SQL plugin can implement the `StorageService` workflow-start methods without changing `packages/core`.
- SQL plugin failures map to PatchPlane `StorageError`.
- Convex can remain enabled for realtime UI projection even when durable persistence is SQL-backed.

---

### M11 — Dogfood on a maintainer-controlled repository

**Status:** Planned after M10 minimum loop

Tasks:

- [ ] Connect a PatchPlane-owned or maintainer-controlled repository through the GitHub plugin.
- [ ] Run at least three real issue/prompt workflows through PatchPlane.
- [ ] Capture friction in setup, sandbox lifecycle, event readability, artifact usefulness, review usefulness, and approval ergonomics.
- [ ] Convert dogfood findings into follow-up issues before broader launch.

Acceptance criteria:

- At least one real patch is generated, sandboxed, reviewed, approved, and published through the PatchPlane loop.
- The demo path is reproducible without manually editing database state.
- The workflow is good enough to demonstrate publicly.

---

## 7. Cross-cutting work

### Config

- [x] Convex, WorkOS, and GitHub plugin config load through Effect Config.
- [x] Secrets are redacted where supported.
- [x] Add static plugin metadata registry with env requirements/defaults.
- [x] Add local CLI support for plugin listing, env template/check, doctor, and init.
- [x] Use root `patchplane.config.json` as CLI-managed non-secret project config.
- [ ] Add Cloudflare R2 config to plugin metadata.
- [ ] Add Cloudflare AI Gateway config to plugin metadata.
- [ ] Add app startup/config smoke for all required alpha environment variables.
- [ ] Add a bundle-boundary regression check that the hosted web app does not include the in-process Pi SDK runtime.
- [ ] Add a Daytona Pi smoke/eval that runs `pi --mode json` or `pi --mode rpc` in a sandbox and validates parseable normalized runtime output.

### Observability

- [x] Add structured context fields for the foundation path.
- [x] Add initial Effect log spans for the foundation path.
- [ ] Add consistent `runtimeSessionId`, `pluginName`, and `operation` fields across runtime/sandbox/artifact plugins.
- [ ] Add Sentry-backed `TelemetryService` plugin.
- [ ] Add OTLP export only when a real collector/backend is introduced.
- [ ] Keep ClickHouse deferred until high-volume trace analytics become necessary.

### Analytics

- [ ] Add minimal `AnalyticsService` interface.
- [ ] Add PostHog product events for alpha usage only.
- [ ] Track basic activation/usage events such as workflow started, trust report viewed, patch approved, patch rejected, and artifact opened.
- [ ] Do not send raw code, raw diffs, prompts, secrets, or raw evidence artifacts to analytics by default.

### Artifacts

- [ ] Define `EvidenceArtifact` domain schema.
- [ ] Store raw artifacts in Cloudflare R2.
- [ ] Store artifact metadata, hashes, and references in Convex.
- [ ] Add authenticated/signed access to artifact downloads.
- [ ] Add retention/lifecycle policy for alpha artifacts where useful.

### Testing

- [x] Foundation core/domain/plugin tests pass.
- [x] Backend Convex tests cover authenticated and external-ingestion paths.
- [x] GitHub plugin tests cover repository access, comments, and webhook signatures.
- [x] CLI integration tests cover command parsing, init, env, plugin validation, and doctor failures.
- [x] Add Daytona sandbox plugin tests with safe mocks/fakes.
- [ ] Add R2 artifact plugin tests.
- [ ] Add Pi runtime event normalization tests.
- [ ] Add true external browser/AuthKit/Convex E2E once stable test credentials exist.

### Security

- [x] GitHub webhook signatures are verified before ingestion.
- [x] User-facing workflow starts require WorkOS JWT validation and mirrored permission checks.
- [x] Convex reads require WorkOS identity and mirrored membership permissions.
- [x] No long-lived credentials in sandboxes.
- [ ] Treat every runtime-produced patch and artifact as untrusted until sandbox review and approval complete.
- [x] Sandbox profiles have explicit network and lifecycle policy.
- [ ] Artifact access is authenticated or signed.
- [ ] Replace shared-secret ingestion with HMAC or equivalent request signing before production exposure if needed.
- [ ] Add resource-scoped authorization when repository/project resources are introduced.

---

## 8. Public non-goals for alpha

Do not implement before the first trust-boundary demo is complete:

- multiple sandbox providers beyond Daytona
- multiple Git forges beyond GitHub
- Git replacement or hosted forge behavior
- semantic merge/conflict resolution
- generalized enterprise policy editor
- broad plugin marketplace
- billing or monetization surfaces
- full ClickHouse trace analytics
- OpenTelemetry collector/backend
- PostHog AI observability product dashboards
- complex provenance graph UI
- autonomous merge without explicit policy/human control

---

## 9. Working rule

When implementation and spec disagree:

1. Check current package/vendor documentation and implementation behavior.
2. Update `SPEC.md` if the product boundary, trust model, or architecture boundary changes.
3. Update this `ROADMAP.md` if milestone order, task status, acceptance criteria, or implementation evidence changes.
4. Keep SDK-specific knowledge inside plugins and app composition code, never in core.
5. Keep public docs focused on product and engineering direction; keep commercial strategy, customer notes, and private operations outside the OSS repo.
