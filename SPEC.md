# SPEC.md – PatchPlane – AI Change Control Plane

**Version:** 2.2  
**Date:** June 25, 2026  
**Status:** Public OSS specification for the alpha trust-boundary loop

---

## 0. Purpose of this document

`SPEC.md` is the stable public reference for PatchPlane's product thesis, trust model, architecture boundaries, alpha scope, and success criteria.

Day-to-day execution tracking lives in [`ROADMAP.md`](./ROADMAP.md).

Update `SPEC.md` when product scope, architecture boundaries, package boundaries, or alpha success criteria change. Update `ROADMAP.md` when execution order, milestone status, or implementation evidence changes.

This document is intentionally public and OSS-safe. It describes what PatchPlane is building and how the system is structured. It does not contain pricing strategy, customer notes, sales pipeline, company strategy, or private operational credentials.

---

## 1. Executive summary

**PatchPlane** is an open-source AI change-control plane for coordinating humans and AI agents around software changes.

PatchPlane sits at the **pre-CI trust boundary**. Every AI-generated patch is treated as untrusted until it has been:

1. executed in an isolated sandbox,
2. captured as evidence and provenance,
3. validated by deterministic checks, review logic, or policy,
4. reviewed through a human decision path,
5. published back to the repository surface only after approval.

PatchPlane is not a Git replacement, a hosted LLM platform, an agent runtime, a sandbox provider, or a thin GitHub bot. It is a control plane that coordinates:

1. request intake,
2. workflow orchestration,
3. sandboxed runtime execution,
4. normalized event capture,
5. evidence artifact storage,
6. automated review and policy checks,
7. human approval or rejection,
8. provenance and publication.

PatchPlane uses an Effect-native plugin model:

```text
PatchPlane core defines capabilities.
Plugins provide capabilities.
Applications compose plugins.
```

The alpha goal is one credible, end-to-end trust loop:

```text
GitHub/manual intake
→ repository verification
→ Daytona sandbox
→ Pi runtime through configurable model access
→ candidate patch
→ logs/tests/browser evidence
→ R2-backed evidence artifacts
→ Convex-backed provenance timeline
→ human approve/reject
→ GitHub check/comment/draft PR publication
```

---

## 2. Product thesis

AI coding agents are becoming better at generating code. The bottleneck shifts from generation to **verification, policy, provenance, and controlled publication**.

PatchPlane focuses on the boundary between:

```text
untrusted agent output
→ sandboxed execution and evidence
→ trusted team workflow
```

The first product wedge is GitHub-compatible AI patch verification. GitHub remains the initial collaboration surface, but PatchPlane owns the trust loop before an agent-generated change is allowed to enter normal CI, review, or merge paths.

### 2.1 What PatchPlane is

PatchPlane is a collaborative execution, review, and merge-governance system for AI-generated software changes.

It gives teams:

- a durable record for every AI-generated patch attempt,
- sandbox execution before publication,
- normalized runtime events,
- evidence artifacts such as logs, diffs, screenshots, videos, and test reports,
- explicit human approve/reject paths,
- provenance for who requested what, what ran, what changed, what passed, and why a decision was made,
- replaceable runtime, sandbox, auth, storage, artifact, model gateway, and repository infrastructure.

### 2.2 What PatchPlane is not

PatchPlane is not:

- a Git replacement,
- a generic issue tracker,
- a project-management tool,
- a hosted LLM/model platform,
- a code editor,
- a sandbox provider,
- an agent runtime,
- an enterprise RBAC suite,
- a generic observability platform,
- a full semantic conflict-resolution engine.

PatchPlane integrates with coding agents, sandboxes, Git forges, and observability tools through plugins when useful. It should avoid rebuilding their core surfaces.

---

## 3. Product principles

1. **Human-governed, agent-accelerated**  
   Agents can propose and review changes. Humans define criteria and can interrupt, redirect, approve, or reject.

2. **Deterministic before autonomous**  
   Use explicit checks, workflow states, evidence artifacts, and merge gates before attempting broader autonomy.

3. **Sandbox everything untrusted**  
   Generated code, tool execution, third-party CLIs, runtime output, and review artifacts are untrusted until evaluated.

4. **Evidence before trust**  
   Trust reports must be backed by durable evidence artifacts, not only transient logs or external observability traces.

5. **Plugins at the edge**  
   WorkOS, Convex, GitHub, Daytona, Pi, Cloudflare, Sentry, PostHog, and future providers are accessed through PatchPlane-owned service boundaries.

6. **Schemas at the boundary, Effect services in the core**  
   External inputs are decoded through Effect Schema. Core behavior is expressed through Effect services. Concrete infrastructure is provided by plugins.

7. **Policy is explicit and serializable**  
   Approval, sandbox, evaluation, and publication rules are auditable data, not hidden ad hoc logic.

8. **Complement existing tools**  
   PatchPlane should consume outputs from coding agents and sandboxes through stable contracts instead of trying to outbuild them.

9. **Alpha proves the trust loop**  
   The alpha is successful when one real AI-generated patch can be sandboxed, evidenced, reviewed, approved or rejected, and published back to GitHub.

---

## 4. Package architecture

PatchPlane uses a workspace structure that separates portable domain models, core workflows, infrastructure plugins, apps, backend deployment functions, and infrastructure provisioning.

```text
packages/
  cli/
    src/
      main.ts
      runtime.ts
      commands/
      services/

  domain/
    src/
      actor.ts
      workspace.ts
      membership.ts
      permission.ts
      prompt-request.ts
      workflow-intake.ts
      external-workflow-ref.ts
      repository-connection.ts
      workflow-run.ts
      runtime-session.ts
      runtime-event.ts
      candidate-patch-set.ts
      review-run.ts
      review-finding.ts
      policy-bundle.ts
      merge-decision.ts
      evidence-artifact.ts
      provenance-event.ts
      publication-event.ts
      errors.ts
      index.ts

  core/
    src/
      services/
        auth-service.ts
        storage-service.ts
        source-control-service.ts
        github-webhook-service.ts
        runtime-service.ts
        sandbox-service.ts
        artifacts-service.ts
        model-gateway-service.ts
        review-service.ts
        policy-service.ts
        telemetry-service.ts
        analytics-service.ts
      workflows/
        start-workflow-from-prompt.ts
        start-authenticated-workflow-from-prompt.ts
        start-workflow-from-intake.ts
        ingest-github-webhook.ts
        github-event-to-intake.ts
        ingest-runtime-event.ts
        capture-evidence-artifact.ts
        propose-merge-decision.ts
      index.ts

  plugins/
    src/
      workos/
      convex/
      github/
      daytona/
      pi/
      cloudflare/
      sentry/
      posthog/
      index.ts

  backend/
    convex/

apps/
  client/
    src/
      effect/
      routes/
      server/

  infra/
    alchemy.run.ts
```

### 4.1 Dependency direction

```text
domain → core → plugins → apps/client
                         ↘ packages/cli
apps/infra is deployment/provisioning code and is not imported by runtime packages.
```

Rules:

- `packages/domain` imports Effect Schema but no PatchPlane package.
- `packages/core` imports `domain` only.
- `packages/plugins` imports `core`, `domain`, and external SDKs.
- `apps/client` imports `core` and `plugins`, then composes runtime layers.
- `packages/cli` owns onboarding, diagnostics, env templates, and local setup helpers.
- `apps/infra` owns infrastructure provisioning and must not become runtime product code.

### 4.2 Core dependency restrictions

`packages/core` must not import:

- WorkOS SDK,
- Convex SDK,
- GitHub/Octokit SDK,
- Daytona SDK,
- Pi SDKs,
- Cloudflare SDKs,
- Sentry SDK,
- PostHog SDK,
- Alchemy,
- TanStack Start APIs,
- framework route/server-function modules.

Those dependencies belong in `packages/plugins`, `apps/client`, or `apps/infra`.

---

## 5. Effect implementation rules

PatchPlane uses Effect for service definitions, plugin layers, typed errors, configuration, resource lifecycles, retries, cancellation, timeouts, and workflow orchestration.

Rules:

- Use Effect Schema for domain models and external decoding.
- Use Effect services for core capabilities.
- Use layers for plugin implementations.
- Use typed errors for expected failures.
- Use Effect Config for plugin configuration.
- Keep Effect-heavy code in `packages/domain`, `packages/core`, `packages/plugins`, and server/runtime boundaries.
- Keep presentational React components mostly plain TypeScript/React.
- Pin Effect versions in package manifests and keep migration notes when APIs change.
- Treat experimental/unstable APIs as localized implementation details.

---

## 6. Domain model

`packages/domain` owns PatchPlane's portable data model.

All external inputs must be decoded into PatchPlane domain schemas before entering core workflows.

Initial domain entities:

- `Actor`
- `Workspace`
- `Membership`
- `Permission`
- `PromptRequest`
- `WorkflowIntake`
- `ExternalWorkflowRef`
- `RepositoryConnection`
- `WorkflowRun`
- `RuntimeSession`
- `RuntimeEvent`
- `CandidatePatchSet`
- `ReviewRun`
- `ReviewFinding`
- `PolicyBundle`
- `MergeDecision`
- `EvidenceArtifact`
- `ProvenanceEvent`
- `PublicationEvent`

Provider-backed IDs should be namespaced opaque strings so provenance survives across plugin boundaries.

Examples:

```text
workos:...
github:...
github-app:...
agent:...
system:...
```

Important trust boundaries include:

- WorkOS session data,
- Convex documents,
- GitHub webhooks,
- GitHub API responses,
- runtime events,
- sandbox outputs,
- agent output,
- artifact metadata,
- evidence payloads,
- review findings,
- policy payloads,
- UI inputs,
- server-function inputs.

---

## 7. Core services

`packages/core` defines PatchPlane capabilities as Effect services and implements workflow behavior in terms of those capabilities.

### `AuthService`

- `getCurrentActor`
- `getCurrentWorkspace`
- `requirePermission`
- `listMemberships`

### `StorageService`

- `createWorkflowFromPrompt`
- `createWorkflowFromIntake`
- `listRecentWorkflowStarts`
- `appendRuntimeEvent`
- `appendProvenanceEvent`
- `recordEvidenceArtifact`
- `createCandidatePatchSet`
- `createReviewRun`
- `createMergeDecision`
- `createPublicationEvent`
- `readWorkflowTimeline`

Convex is the first implementation for alpha workflow state and realtime read-models. Core must not assume Convex.

### `SourceControlService`

Generic source-control operations used after provider-specific normalization:

- `verifyRepositoryAccess`
- `createIssueComment`
- `publishCheck`
- `createBranch`
- `createCommit`
- `createDraftPullRequest`

GitHub is the first implementation.

### `GitHubWebhookService`

Provider-specific GitHub webhook edge capability:

- verify webhook signatures against the raw payload,
- normalize GitHub event payloads,
- map verified events into generic `WorkflowIntake` / `ExternalWorkflowRef`.

### `RuntimeService`

- `startSession`
- `sendInstruction`
- `streamEvents`
- `stopSession`

Pi is the first runtime implementation.

### `SandboxService`

- `provision`
- `execute`
- `collectArtifacts`
- `destroy`

Daytona is the first sandbox implementation.

### `ArtifactsService`

- `putArtifact`
- `getArtifactMetadata`
- `createSignedReadUrl`
- `deleteArtifact`
- `applyRetentionPolicy`

Cloudflare R2 is the first artifact implementation.

### `ModelGatewayService`

- expose model provider configuration to runtime plugins,
- validate configured provider/model values,
- provide model gateway metadata for provenance.

Cloudflare AI Gateway is the first model-access layer for the Pi runtime.

### `ReviewService`

- `runReview`
- `emitFinding`
- `completeReview`

### `PolicyService`

- `evaluatePolicy`
- `proposeDecision`

### `TelemetryService`

Operational telemetry for debugging and reliability:

- structured logs,
- spans,
- errors,
- contextual annotations.

Sentry is the first implementation.

### `AnalyticsService`

Product analytics for usage and activation:

- workflow started,
- trust report viewed,
- patch approved,
- patch rejected,
- artifact opened,
- first workflow completed.

PostHog is the first implementation. Analytics events must not contain raw code, raw diffs, secrets, or sensitive evidence payloads by default.

---

## 8. Plugin model

A PatchPlane plugin is a concrete implementation of a PatchPlane core service using an external system.

Initial plugins:

- WorkOS Auth Plugin,
- Convex Storage Plugin,
- GitHub Provider Plugin,
- Daytona Sandbox Plugin,
- Pi Runtime Plugin,
- Cloudflare R2 Artifacts Plugin,
- Cloudflare AI Gateway Model Gateway Plugin,
- Sentry Telemetry Plugin,
- PostHog Analytics Plugin.

Later plugins may include:

- Postgres Workflow Storage Plugin,
- MySQL Workflow Storage Plugin,
- SQLite Workflow Storage Plugin,
- D1 Workflow Storage Plugin,
- additional runtime plugins,
- additional sandbox plugins,
- GitLab Provider Plugin,
- ClickHouse trace analytics integration.

Rule:

```text
Real integrations are allowed from the start, but all external systems must be accessed through PatchPlane-owned service boundaries.
```

---

## 9. Infrastructure provisioning

PatchPlane uses `apps/infra` for infrastructure provisioning.

`apps/infra` is executable deployment code. It is not a runtime package and must not be imported by `packages/core`, `packages/domain`, or runtime application code.

Initial provisioning scope:

- Cloudflare R2 buckets for evidence artifacts,
- Cloudflare AI Gateway for model access,
- environment/stage-specific resource names,
- optional PatchPlane-owned demo repository setup,
- non-secret output needed by runtime configuration.

Alchemy is the first infrastructure-provisioning tool.

Rules:

- Alchemy provisions PatchPlane-owned infrastructure.
- Runtime product behavior remains in PatchPlane services and plugins.
- Alchemy does not replace Octokit/GitHub App runtime behavior.
- Alchemy does not manage customer repositories.
- `apps/infra` does not introduce a Cloudflare Worker runtime unless explicitly added later.
- Production secrets must remain in secret stores or environment-specific deployment settings, not in public repo files.

---

## 10. GitHub compatibility model

GitHub is the first repository provider and publication surface.

PatchPlane uses a GitHub App integration for:

- installation and repository authorization,
- webhook verification,
- issue/comment/PR intake,
- repository access checks,
- check run publication,
- PR comments,
- draft PR or branch publication.

GitHub-specific logic stays at the provider edge. After verification and normalization, GitHub events become generic `WorkflowIntake` values with provider metadata in `ExternalWorkflowRef`.

Alchemy may be used to provision PatchPlane-owned demo repositories or repo settings, but runtime GitHub behavior uses GitHub App APIs through the GitHub provider plugin.

Decision rule:

```text
Create/configure PatchPlane-owned resources → apps/infra.
React to GitHub events or operate on PRs/checks/comments → GitHub provider plugin.
```

---

## 11. Artifact and provenance model

PatchPlane-owned provenance is the product truth. External observability tools are supporting systems, not the audit trail.

### 11.1 Convex stores workflow truth and timeline metadata

Convex is the alpha workflow state and realtime UI backend.

It stores:

- workflow runs,
- runtime sessions,
- normalized runtime events,
- provenance events,
- evidence artifact metadata,
- candidate patch metadata,
- review results,
- policy decisions,
- publication events.

Convex should not store large raw artifacts directly.

### 11.2 R2 stores raw evidence artifacts

Cloudflare R2 stores large raw evidence payloads:

- raw runtime trace JSON,
- stdout/stderr logs,
- patch diffs,
- test reports,
- screenshots,
- browser videos,
- policy result JSON,
- trust report JSON.

Convex stores the metadata and R2 pointer.

Example:

```ts
type EvidenceArtifact = {
  id: string
  workflowRunId: string
  kind:
    | "raw-trace"
    | "stdout"
    | "stderr"
    | "diff"
    | "test-report"
    | "screenshot"
    | "video"
    | "policy-result"
    | "trust-report"
  storageProvider: "cloudflare-r2"
  storageKey: string
  contentType: string
  sizeBytes: number
  sha256: string
  createdAt: number
}
```

### 11.3 Provenance timeline

A `ProvenanceEvent` links workflow actions to evidence:

```ts
type ProvenanceEvent = {
  id: string
  workflowRunId: string
  traceId: string
  parentEventId?: string
  sequence: number
  type: string
  operation: string
  pluginName?: string
  status: "started" | "succeeded" | "failed" | "blocked"
  startedAt: number
  completedAt?: number
  summary?: string
  artifactRefs: string[]
  errorCategory?: string
}
```

The timeline explains:

- who requested the change,
- which repository was targeted,
- which sandbox ran,
- which runtime produced output,
- which evidence was captured,
- which review/policy checks ran,
- what the human decision was,
- what was published back to GitHub.

---

## 12. Model access and runtime model

Pi is the first coding-agent runtime.

PatchPlane should use `@earendil-works/pi-coding-agent` for coding-agent behavior instead of directly building a low-level LLM-only agent.

The Pi runtime plugin maps Pi lifecycle events into PatchPlane `RuntimeEvent` schemas.

Example event types:

- agent started,
- turn started,
- message started,
- message updated,
- tool execution started,
- tool execution updated,
- tool execution ended,
- turn ended,
- agent ended,
- error emitted.

### 12.1 Cloudflare AI Gateway

Cloudflare AI Gateway is the first model-access layer for the Pi runtime.

Alpha config should be provider/model-driven:

```env
PATCHPLANE_AGENT_PROVIDER=cloudflare-ai-gateway
PATCHPLANE_AGENT_MODEL=...
CLOUDFLARE_ACCOUNT_ID=...
CLOUDFLARE_GATEWAY_ID=...
CLOUDFLARE_API_KEY=...
```

A direct provider fallback may be supported for local development:

```env
PATCHPLANE_AGENT_PROVIDER=openai
PATCHPLANE_AGENT_MODEL=...
OPENAI_API_KEY=...
```

PatchPlane should not build a model marketplace in alpha. Provider/model values are configuration, not a product surface yet.

---

## 13. Observability and analytics

PatchPlane uses three separate concepts:

```text
Telemetry  = operational debugging and reliability
Analytics  = product usage and activation
Provenance = product truth and evidence
```

### 13.1 Telemetry

Telemetry is for operational debugging.

Initial implementation:

- Sentry,
- structured logs,
- Effect spans where useful,
- OpenTelemetry-compatible naming discipline.

Initial span/event names:

- `patchplane.workflow.start`
- `patchplane.auth.require_permission`
- `patchplane.git.verify_repo`
- `patchplane.github.verify_webhook`
- `patchplane.sandbox.provision`
- `patchplane.runtime.start_session`
- `patchplane.runtime.stream_event`
- `patchplane.artifact.put`
- `patchplane.review.run`
- `patchplane.policy.evaluate`
- `patchplane.decision.record`
- `patchplane.publication.github`

Sentry must not become the PatchPlane provenance store.

### 13.2 Analytics

Analytics is for product behavior.

Initial events:

- `workflow_started`
- `first_workflow_completed`
- `trust_report_viewed`
- `artifact_opened`
- `patch_approved`
- `patch_rejected`
- `publication_created`

PostHog is the first analytics implementation.

Analytics events should avoid raw code, raw prompts, raw diffs, secrets, and sensitive evidence payloads by default.

### 13.3 OpenTelemetry and ClickHouse

PatchPlane should use OpenTelemetry-compatible naming and trace/span semantics from the start.

The alpha does not require:

- OpenTelemetry collector,
- ClickHouse,
- HyperDX/ClickStack,
- custom analytics warehouse,
- PostHog AI observability.

ClickHouse or another trace analytics backend may be added later when PatchPlane needs high-volume trace analytics, aggregate workflow analysis, cost analytics, failure-pattern queries, or long-term event search.

---

## 14. Configuration

PatchPlane has three configuration locations:

- `patchplane.config.json`: root, user-visible, non-secret project config managed by the CLI.
- `.patchplane/{logs,cache,state}`: generated local runtime artifacts only.
- environment variables or deployment secret stores: secrets and environment-specific values.

Each plugin owns its config:

- `WorkOSConfig`
- `ConvexConfig`
- `GitHubConfig`
- `DaytonaConfig`
- `PiAgentConfig`
- `CloudflareConfig`
- `SentryConfig`
- `PostHogConfig`

Rules:

- `patchplane.config.json` must not contain secrets.
- `.patchplane/` must not contain user-managed project config.
- Plugins must load configuration through Effect Config.
- Secrets should use redacted config values where supported.
- Configuration should fail at startup, not halfway through a workflow.
- Public docs may mention environment variable names but must never include real values.

Important secret-bearing config includes:

- WorkOS API keys,
- WorkOS client IDs and cookie/session secrets,
- Convex URLs and deployment credentials,
- GitHub App IDs and private keys,
- Daytona tokens,
- Pi/model provider credentials,
- Cloudflare API keys/account details,
- Sentry DSN/auth tokens,
- PostHog project keys where applicable.

---

## 15. Security model

### 15.1 Trusted control plane

Trusted control-plane components:

- core workflows,
- plugin layers running in trusted server contexts,
- WorkOS session validation,
- Convex persistence and authorization checks,
- policy definitions,
- human decisions,
- GitHub App private-key handling,
- verified webhook state,
- configuration profiles,
- artifact metadata and signed-access paths.

### 15.2 Semi-trusted clients

Semi-trusted clients:

- web dashboard,
- future desktop shell,
- CLI surfaces used by trusted operators.

### 15.3 Untrusted execution plane

Untrusted execution plane:

- generated code,
- agent tool calls,
- third-party CLI invocations,
- sandbox output,
- runtime output,
- browser/test evidence,
- raw artifact payloads.

### 15.4 Rules

- Run generated code outside the control plane.
- Do not expose long-lived production credentials to sandbox runs.
- Verify GitHub webhook signatures against the raw request body before parsing or persistence.
- Deduplicate webhook deliveries and external references.
- Keep GitHub App private keys and installation-token minting in trusted server contexts.
- Store raw logs and artifacts separately from privileged secrets.
- Keep WorkOS SDK usage server-only.
- Treat WorkOS/AuthKit access tokens as request-scoped credentials.
- Do not allow public Convex mutations to bypass authorization for privileged user writes.
- Keep external/system Convex ingestion behind a server-only authentication mechanism.
- Make manual override and kill-switch behavior available.
- Treat dependency changes as high-risk.
- Validate workspaces, paths, permissions, and execution targets before runtime start.
- Make approval policy explicit per runtime session.
- Use short-lived signed URLs for private artifact access.
- Avoid sending raw code, secrets, full diffs, or sensitive evidence to analytics tools by default.

The alpha is intended for controlled, single-team or design-partner usage first. It is not an open multi-tenant SaaS without additional tenancy, sandbox, audit, and isolation hardening.

---

## 16. Alpha scope

The alpha is scoped around one end-to-end trusted patch workflow.

### 16.1 In scope

- Effect-native domain/core/plugin architecture,
- WorkOS auth plugin,
- Convex storage/realtime plugin,
- GitHub provider plugin,
- Daytona sandbox plugin,
- Pi runtime plugin,
- Cloudflare R2 artifacts plugin,
- Cloudflare AI Gateway model gateway plugin,
- Sentry telemetry plugin,
- optional PostHog analytics plugin,
- `apps/infra` with Alchemy for Cloudflare R2 and AI Gateway provisioning,
- normalized runtime events,
- evidence artifact capture,
- provenance timeline,
- candidate patch output,
- deterministic policy/review result,
- human approve/reject path,
- GitHub check/comment/draft PR publication.

### 16.2 Out of scope for alpha

- multi-sandbox provider UI,
- model marketplace,
- plugin marketplace,
- broad enterprise RBAC,
- open multi-tenant SaaS hardening,
- full OpenTelemetry collector/backend,
- ClickHouse trace analytics,
- PostHog AI observability,
- automatic semantic conflict resolution,
- direct auto-merge without human approval,
- mobile clients,
- deep desktop-native feature work,
- generic project management,
- replacing GitHub as a forge,
- replacing Pi as an agent runtime,
- replacing Daytona as a sandbox provider.

---

## 17. Technology choices

### 17.1 Language and runtime

Use TypeScript across the platform.

Server/plugin contexts should use a Node runtime compatible with the selected SDKs. Bun may remain the workspace/package runner if validated for the relevant commands, but server/plugin runtime behavior should not assume Bun compatibility unless explicitly tested.

### 17.2 Web framework

Use the existing TanStack Start app in `apps/client` as the composition root. Framework-specific code stays in the app layer.

### 17.3 Auth

WorkOS AuthKit is the first auth provider and source of human identity, organizations, memberships, roles, and permissions.

Core domain values are:

- `Actor`
- `Workspace`
- `Membership`
- `Permission`

Core must not know WorkOS-specific SDK types.

### 17.4 Storage and realtime

Convex is the first storage/realtime backend.

Convex may own:

- realtime UI reads,
- auth-mirrored membership checks,
- workflow state for alpha,
- provenance timeline metadata,
- artifact metadata,
- public/read model queries.

The portability boundary remains `StorageService`.

### 17.5 Repository provider

GitHub App integration is the first repository provider.

Runtime operations use the GitHub provider plugin, backed by GitHub APIs/Octokit where appropriate.

### 17.6 Sandbox

Daytona is the first sandbox provider.

Initial implementation should prefer ephemeral or auto-deleting sandboxes, explicit lifecycle policy, and network controls where supported by the selected profile.

### 17.7 Runtime

Pi is the first runtime provider.

Runtime events are normalized into PatchPlane `RuntimeEvent` records and linked to workflow/provenance state.

### 17.8 Artifact storage

Cloudflare R2 is the first evidence artifact store.

R2 is accessed through `ArtifactsService` / Cloudflare plugin runtime code, not directly from core.

### 17.9 Model gateway

Cloudflare AI Gateway is the first model-access layer for Pi.

Model provider and model name are configuration values for alpha.

### 17.10 Infrastructure provisioning

Alchemy is the first infra-provisioning tool and lives under `apps/infra`.

It provisions PatchPlane-owned Cloudflare resources and optional demo infrastructure. It is not a runtime SDK replacement.

### 17.11 Telemetry and analytics

Sentry is the first telemetry implementation.

PostHog is the first product analytics implementation.

ClickHouse is deferred until PatchPlane needs high-volume trace analytics or custom analytical queries.

---

## 18. CLI and plugin metadata

`packages/cli` is the OSS onboarding surface.

CLI commands may include:

```text
patchplane init
patchplane doctor
patchplane env template
patchplane env check
patchplane plugins list
patchplane plugins explain
```

Plugins should expose static metadata for:

- plugin id/name,
- provided services,
- required environment variables,
- optional environment variables,
- runtime surfaces,
- dependencies/conflicts.

CLI flows must remain scriptable through flags and non-interactive modes.

---

## 19. Testing strategy

PatchPlane should validate real plugin paths early while keeping service boundaries testable.

Initial integration tests:

- WorkOS session → PatchPlane Actor,
- WorkOS organization → PatchPlane Workspace,
- WorkOS membership → PatchPlane Membership,
- Convex authenticated workflow write through `StorageService`,
- public workflow writes reject missing auth and missing permissions,
- signed external workflow intake creates PromptRequest + WorkflowRun,
- GitHub webhook verification maps to generic `WorkflowIntake`,
- repository access is checked before workflow execution,
- Daytona sandbox can provision and execute a command,
- Pi runtime can emit normalized runtime events,
- R2 artifact upload stores metadata in Convex,
- trust timeline can read back provenance events and artifact references,
- GitHub publication can create a check/comment/draft PR output.

Core tests after the first real path is proven:

- workflow state transitions,
- error handling,
- permission checks,
- retry behavior,
- timeout behavior,
- concurrent operations,
- runtime-event validation,
- artifact metadata validation,
- policy decision validation.

---

## 20. Success criteria

### 20.1 Foundation success

The foundation is successful when:

1. `packages/domain`, `packages/core`, and `packages/plugins` exist and typecheck.
2. Core contains no WorkOS, Convex, GitHub, Daytona, Pi, Cloudflare, Sentry, PostHog, Alchemy, or TanStack imports.
3. WorkOS AuthKit can authenticate a user and selected organization.
4. WorkOS user and organization membership data can be mapped into PatchPlane domain values.
5. A server-side app action calls a core workflow through a composed runtime.
6. The server-side workflow verifies permissions before writing.
7. The core workflow creates a PromptRequest and WorkflowRun through `StorageService`.
8. Convex persists workflow records through the Convex plugin.
9. Authenticated reads require appropriate workspace membership/permissions.
10. GitHub webhook intake can be verified, normalized, repository-checked, and persisted as generic workflow intake.

### 20.2 Alpha trust-loop success

The alpha is successful when:

1. A user can connect or allowlist a GitHub repository.
2. A verified GitHub webhook or app prompt can create a durable PromptRequest.
3. PatchPlane can start a WorkflowRun for that request.
4. Daytona can provision a sandbox.
5. Pi can run through the configured model provider.
6. Runtime events are normalized and persisted.
7. At least one candidate patch can be produced.
8. Logs, diff, test output, and optional browser evidence can be stored as R2-backed EvidenceArtifacts.
9. Convex can read back a provenance timeline with artifact references.
10. A deterministic policy/review result can be recorded.
11. A human can approve or reject the patch.
12. PatchPlane can publish a check/comment/draft PR result back to GitHub.
13. One real repository can run the loop end to end.
14. No generated patch is treated as trusted before sandbox evidence and a recorded decision exist.

---

## 21. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Architecture expands beyond alpha | Keep alpha scoped to one trusted patch workflow. |
| Core couples to vendor SDKs | Enforce dependency restrictions and plugin boundaries. |
| Effect APIs change | Pin versions, localize Effect usage, keep migration notes. |
| GitHub App flow is complex | Keep GitHub logic at provider edge and normalize to generic intake. |
| Sandbox integration becomes a sink | Keep `SandboxService` narrow and Daytona-first. |
| Runtime details leak into product truth | Normalize events; keep runtime sessions as execution state. |
| Convex becomes overloaded with large artifacts | Store raw artifacts in R2 and only metadata in Convex. |
| Observability tools become audit trail | Keep provenance in PatchPlane-owned data structures. |
| Analytics leaks sensitive data | Do not send raw code/diffs/secrets/evidence to analytics by default. |
| Multi-tenant security is misunderstood | State alpha posture clearly and avoid open SaaS assumptions. |
| Infra provisioning leaks into runtime | Keep Alchemy isolated in `apps/infra`. |
| GitHub resource provisioning is confused with runtime integration | Use Alchemy for owned infra only; use GitHub provider plugin for PR/check/comment behavior. |

---

## 22. Final recommendation

Proceed with PatchPlane as an Effect-native AI change-control plane with real infrastructure plugins and strict product boundaries.

The alpha should validate:

```text
real intake
→ real sandbox
→ real agent runtime
→ real evidence
→ real human decision
→ real GitHub publication
```

The implementation direction is:

```text
Effect Schema in domain.
Effect services in core.
Plugins at the edge.
Convex for alpha workflow state and realtime UI.
Cloudflare R2 for raw evidence artifacts.
Cloudflare AI Gateway for Pi model access.
Alchemy for PatchPlane-owned infra provisioning.
Sentry for operational telemetry.
PostHog for product analytics.
ClickHouse later, only when analytical trace volume requires it.
```

The architecture is intentionally durable enough to avoid obvious rewrites, but narrow enough to keep alpha execution focused on shipping the first trusted patch loop.
