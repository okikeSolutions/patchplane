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

PatchPlane v2 has completed the authenticated foundation work and is now focused on the first credible pre-CI trust-boundary demo:

```text
GitHub/manual intake
→ authenticated or signed PatchPlane workflow
→ repository allowlist/access verification
→ Daytona sandbox provisioning
→ Pi runtime execution
→ candidate patch + logs/tests/browser evidence
→ PatchPlane policy/review decision
→ human approve/reject
→ GitHub comment/check/draft PR publication
→ persisted provenance timeline
```

The next slice is **not more platform**. It is the smallest workflow that shows an AI-generated patch remaining untrusted until sandbox execution, evidence capture, review, and explicit decision complete.

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
RuntimeService           -> Pi coding-agent runtime
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
- [x] Use Pi coding-agent packages behind a runtime plugin boundary.
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

**Status:** In progress; core Daytona execution path implemented, live smoke and policy metadata added

Tasks:

- [x] Add `DaytonaConfig` with redacted API key handling.
- [x] Implement alpha-safe scoped sandbox execution via `SandboxService.runRepositoryCommand` / `runRepositoryAgent`.
- [x] Prefer ephemeral or auto-deleting sandbox profiles for alpha.
- [x] Add explicit sandbox policy fields for lifecycle, resources, timeout, and network posture.
- [x] Implement checkout/clone support.
- [x] Implement command execution.
- [x] Collect basic command logs in workflow storage; R2-backed artifact capture remains in the artifact slice.
- [x] Stop/destroy sandboxes on cancellation/failure where possible after acquisition succeeds.
- [x] Add live Daytona smoke script with redacted API-key handling and cleanup polling.

Acceptance criteria:

- [x] A workflow can provision a sandbox, check out a GitHub repository ref, run at least one command, collect command logs, and tear down the sandbox.
- [x] Sandboxes never receive long-lived WorkOS, Convex, or GitHub App credentials.
- [x] Sandbox lifecycle and network policy are visible in stored workflow metadata.
- [ ] Durable raw artifact capture is backed by R2 rather than Convex stdout/stderr columns.

---

### M8.25 — Minimal Cloudflare infra provisioning

**Status:** Planned, alpha-supporting only

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

- [ ] Add `apps/infra/alchemy.run.ts`.
- [ ] Add dev/prod stage naming for PatchPlane-owned infrastructure.
- [ ] Provision R2 bucket(s) for evidence artifacts.
- [ ] Provision AI Gateway for Pi model access.
- [ ] Document required env vars and generated config values.
- [ ] Add deployment scripts for local/CI usage.

Acceptance criteria:

- Running the infra deployment for a dev stage creates the R2 bucket and AI Gateway.
- PatchPlane runtime code does not import Alchemy.
- `packages/core` imports no Alchemy or Cloudflare SDK types.

---

### M8.5 — Alpha Workflow Visibility Slice

**Status:** Planned after GitHub and initial sandbox data are present

Scope:

- Make the trust loop visible early, before a polished dashboard.
- Use simple tables, cards, and vertical timelines.
- Show workflow status, source, repository, sandbox state, runtime state, artifact references, and decision state.

Tasks:

- [ ] Add workflow detail view or side panel.
- [ ] Show prompt/intake summary.
- [ ] Show repository and sandbox status.
- [ ] Show command/log placeholders backed by real records where available.
- [ ] Show provenance timeline events.
- [ ] Keep complex graph UI deferred.

Acceptance criteria:

- A real GitHub/Daytona-backed workflow is understandable from the UI without reading server logs.
- The UI communicates why a patch is still untrusted, pending review, approved, or rejected.

---

### M8.75 — Minimal Landing Page Packaging Slice

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

### M9 — Pi Agent Runtime Plugin

**Status:** Next alpha runtime after minimal sandbox execution exists

Tasks:

- [x] Add initial `PiAgentConfig`.
- [x] Instantiate Pi coding-agent SDK session inside runtime boundary.
- [ ] Replace OpenAI-only runtime assumptions with configurable provider/model settings.
- [ ] Default alpha model access to Cloudflare AI Gateway where configured.
- [ ] Keep direct OpenAI or other direct providers as local/debug fallback options.
- [ ] Map Pi events to PatchPlane `RuntimeEvent` records.
- [ ] Map `agent.abort()` to `RuntimeService.stopSession`.
- [ ] Map steering/follow-up to human interrupt/redirect primitives.
- [ ] Preserve enough raw event metadata for debugging while storing normalized events as product truth.

Acceptance criteria:

- PatchPlane can start one Pi coding-agent session inside a sandbox-backed workflow.
- Pi uses configured provider/model access rather than a hardcoded single provider.
- Pi events are normalized into PatchPlane-owned `RuntimeEvent` records.
- Pi-specific objects do not cross into core/UI.

---

### M9.5 — Dashboard and workflow visibility pass

**Status:** Planned after Pi produces real runtime events

Timing:

- Before GitHub/Daytona/Pi: keep the UI functional, not polished.
- After GitHub and Daytona: add real repository, sandbox, command/log, and provenance placeholders.
- After Pi events: add the first serious dashboard/review UX pass.

Rules:

- Do not fork full dashboard starters or replace the current app shell.
- Build from local UI components in `apps/client/src/components/ui`.
- Keep complex provenance graph UI deferred.
- Make raw patch/diff, logs, artifacts, and provenance easy to inspect.

First dashboard scope:

- [ ] Recent workflows table.
- [ ] Workflow detail page or side panel.
- [ ] Timeline with runtime/sandbox/provenance events.
- [ ] Review split view once candidate patches exist.
- [ ] Approve/reject/request-changes controls with required comment.

Acceptance criteria:

- The dashboard uses the existing PatchPlane shell.
- A real Pi/Daytona/GitHub-backed workflow is understandable from the UI.
- Review ergonomics are good enough for maintainer-controlled dogfooding.

---

### M9.75 — Evidence Capture and Browser Verification Slice

**Status:** Planned before final alpha decision/publication loop

Purpose:

Capture enough evidence to make the trust report useful and inspectable.

Scope:

- Add `EvidenceArtifact` domain model and Convex metadata persistence.
- Add `ArtifactsService` with Cloudflare R2 implementation.
- Store large/raw artifacts in R2, not Convex, Sentry, or PostHog.
- Add one minimal browser verification path with screenshot or video evidence where useful.

Tasks:

- [ ] Define `EvidenceArtifact` schema.
- [ ] Define `ArtifactsService` interface.
- [ ] Implement R2-backed `ArtifactsService` plugin.
- [ ] Store artifact metadata and hashes in Convex.
- [ ] Add signed or authenticated artifact access path.
- [ ] Capture stdout/stderr logs as artifacts where size warrants it.
- [ ] Capture patch/diff/test-report artifacts.
- [ ] Add first browser verification result and screenshot/video artifact path.

Acceptance criteria:

- A workflow stores raw evidence artifacts in R2.
- Convex stores artifact metadata, hashes, and references.
- The UI can link from a workflow/provenance event to its evidence artifacts.
- Raw artifacts are not sent to PostHog and are not treated as Sentry product truth.

---

### M10 — Review, decision, and publication loop

**Status:** Alpha demo finish line

Tasks:

- [ ] Implement `CandidatePatchSet` schema and persistence.
- [ ] Implement `ReviewRun` and `ReviewFinding` schemas and persistence.
- [ ] Implement one reviewer path, initially test/lint-oriented.
- [ ] Implement `PolicyService.evaluatePolicy`.
- [ ] Implement `ProposeMergeDecision`.
- [ ] Add operator approval/rejection path.
- [ ] Publish GitHub comment/check/draft PR through GitHub plugin.
- [ ] Record provenance linking prompt, actor/workspace, repository, sandbox, runtime session, commands/tests, candidate patch, review result, decision, and publication result.

Acceptance criteria:

- A generated patch remains untrusted until sandbox execution and review complete.
- A human can approve or reject the candidate before publication/merge handoff.
- The alpha demo can show why the decision was made using persisted provenance and evidence, not only transient logs.

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
- [ ] Add Daytona sandbox plugin tests with safe mocks/fakes.
- [ ] Add R2 artifact plugin tests.
- [ ] Add Pi runtime event normalization tests.
- [ ] Add true external browser/AuthKit/Convex E2E once stable test credentials exist.

### Security

- [x] GitHub webhook signatures are verified before ingestion.
- [x] User-facing workflow starts require WorkOS JWT validation and mirrored permission checks.
- [x] Convex reads require WorkOS identity and mirrored membership permissions.
- [ ] No long-lived credentials in sandboxes.
- [ ] Treat every runtime-produced patch and artifact as untrusted until sandbox review and approval complete.
- [ ] Sandbox profiles have explicit network and lifecycle policy.
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

