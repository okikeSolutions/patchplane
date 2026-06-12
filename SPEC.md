# SPEC.md – PatchPlane v2 – Effect-Native AI Change Control Plane

**Version:** 2.0  
**Date:** June 11, 2026  
**Status:** Architecture revision for Effect v4 / effect-smol plugin-based MVP

---

## 0. Execution Tracking

`SPEC.md` is the stable reference for product thesis, architecture, scope, and success criteria.

Day-to-day task tracking lives in [ROADMAP.md](./ROADMAP.md).

Update `ROADMAP.md` when execution order, status, or evidence changes. Update `SPEC.md` only when product scope, architecture, package boundaries, or MVP success criteria change.

---

## 1. Executive Summary

**PatchPlane** is an open-source AI change-control plane for coordinating humans and AI agents around software changes.

PatchPlane is not a Git replacement and not a thin GitHub bot. It is a control plane that coordinates:

1. prompt/request intake,
2. workflow orchestration,
3. sandboxed runtime execution,
4. normalized event capture,
5. automated review,
6. human approval or rejection,
7. provenance, rollback paths, and publication.

PatchPlane v2 keeps the original product thesis but revises the implementation architecture around an Effect-native plugin model:

```text
PatchPlane core defines capabilities.
Plugins provide capabilities.
The app composes plugins.
```

The first v2 foundation milestone is intentionally smaller than the full end-to-end product:

```text
Local development actor
→ default development workspace
→ create PromptRequest
→ create WorkflowRun
→ persist through Convex Storage Plugin

Auth and WorkOS are explicitly deferred until after the foundation storage/core path is proven.
```

The end-to-end hosted MVP expands that foundation with GitHub, Daytona, Pi Agent Core, runtime events, reviews, merge decisions, and publication.

---

## 2. Product Thesis

### 2.1 What PatchPlane is

PatchPlane is a collaborative execution, review, and merge-governance system for AI-generated software changes.

It gives teams:

- multiple agents proposing changes in parallel,
- durable workflow state for every request,
- live operational visibility,
- automated review before publication or merge,
- explicit human interrupt and override paths,
- provenance for who requested what, what the agent did, what passed, and why a decision was made,
- replaceable runtime, sandbox, auth, storage, and repository infrastructure.

PatchPlane's adoption wedge remains **GitHub compatibility without GitHub dependence**:

- GitHub remains the initial repository, issue, PR, and community surface.
- PatchPlane becomes the control plane for orchestration, execution, supervision, policy, review, and decision history.
- Over time, PatchPlane may internalize more patch-governance and rollback behavior without forcing teams to abandon GitHub on day one.

### 2.2 What PatchPlane is not

For v2, PatchPlane is not:

- a universal Git replacement,
- a generic issue tracker,
- a project-management replacement,
- a hosted LLM platform,
- a fully offline local-first code editor,
- an open multi-tenant SaaS platform,
- a full semantic conflict-resolution engine,
- an enterprise RBAC suite.

---

## 3. Product Principles

1. **Human-governed, agent-accelerated**  
   Agents can propose and review; humans define criteria and can interrupt, redirect, approve, or reject.

2. **Deterministic before autonomous**  
   Use explicit checks, workflow states, patch logs, and merge gates before attempting advanced semantic autonomy.

3. **Real-time by default**  
   Every request, run, review, event, and decision should be observable by connected clients.

4. **Sandbox everything untrusted**  
   Generated code, tool execution, reviewer actions, runtime processes, and third-party CLIs run outside the trusted control plane.

5. **Plugins at the edge**  
   Concrete systems such as WorkOS, Convex, GitHub, Daytona, Pi Agent Core, OpenCode, Codex, Postgres, or MySQL must be accessed through PatchPlane-owned plugin boundaries.

6. **Schemas at the boundary, Effect services in the core, plugins at the edge**  
   External inputs are decoded through Effect Schema; core capabilities are defined as Effect services; real infrastructure is provided by plugins and composed by the app.

7. **Graph for provenance, not magic**  
   The graph explains lineage and decision history. It does not replace rigorous merge semantics by itself.

8. **Policy is explicit and serializable**  
   Approval, sandbox, evaluation, and merge criteria are auditable artifacts, not hidden ad hoc business logic.

---

## 4. Package Architecture

PatchPlane v2 uses this workspace shape:

```text
packages/
  domain/
    src/
      ids.ts
      actor.ts
      workspace.ts
      prompt-request.ts
      workflow-run.ts
      runtime-session.ts
      runtime-event.ts
      candidate-patch-set.ts
      review-run.ts
      merge-decision.ts
      policy-bundle.ts
      errors.ts
      index.ts

  core/
    src/
      services/
        AuthService.ts
        StorageService.ts
        GitProviderService.ts
        RuntimeService.ts
        SandboxService.ts
        ReviewService.ts
        PolicyService.ts
        TelemetryService.ts
      workflows/
        StartWorkflowFromPrompt.ts
        IngestRuntimeEvent.ts
        ProposeMergeDecision.ts
      index.ts

  plugins/
    src/
      workos/
        WorkOSAuthPlugin.ts
        WorkOSConfig.ts
        mapping.ts
        errors.ts
        index.ts
      convex/
        ConvexStoragePlugin.ts
        ConvexConfig.ts
        schema.ts
        mapping.ts
        errors.ts
        index.ts
      github/
        GitHubProviderPlugin.ts
        GitHubConfig.ts
        mapping.ts
        errors.ts
        index.ts
      pi/
        PiAgentRuntimePlugin.ts
        PiAgentConfig.ts
        mapping.ts
        errors.ts
        index.ts
      daytona/
        DaytonaSandboxPlugin.ts
        DaytonaConfig.ts
        mapping.ts
        errors.ts
        index.ts

apps/
  client/
    src/
      effect/
        layers.ts
        runtime.ts
      routes/
      server/

packages/backend/
  convex/            -> Convex deployment functions stay here for now
```

### 4.1 Dependency direction

```text
domain → core → plugins → apps/client
```

More explicitly:

- `packages/domain` imports Effect Schema, but no PatchPlane package.
- `packages/core` imports `domain` only.
- `packages/plugins` imports `core`, `domain`, and external SDKs.
- `apps/client` imports `core` and `plugins`, then composes the runtime.

### 4.2 Dependency restrictions

`packages/core` must not import:

- WorkOS SDK,
- Convex SDK,
- GitHub SDK,
- Daytona SDK,
- Pi Agent Core SDK,
- OpenCode SDK,
- Codex SDK,
- TanStack Start APIs,
- framework route/server-function modules.

Those dependencies belong in `packages/plugins` or `apps/client`.

---

## 5. Effect v4 / effect-smol Implementation Rules

PatchPlane v2 targets **Effect v4 beta / effect-smol** intentionally. Because v4 is still beta, Effect-heavy implementation should be isolated in `packages/core` and `packages/plugins`, not scattered through UI components.

Rules:

- Pin exact Effect v4 beta package versions.
- Use `effect@4.0.0-beta.79` as the current researched baseline.
- Use the `Effect-TS/effect-smol` repository for v4 research and vendored source.
- Keep Effect ecosystem package versions aligned.
- Keep migration notes in the repo when v4 APIs change.
- Use `Context.Service` for core service definitions.
- Use `Layer.effect` for plugin implementations.
- Use `Layer.merge` for independent services.
- Use `Layer.provide` for explicit dependencies.
- Use `Layer.unwrap` later for config-driven plugin selection.
- Use `Effect.fn` for traceable service methods where useful.
- Use `ManagedRuntime` at the app boundary.
- Use Effect Config for plugin configuration.
- Use Effect Schema for domain models and external decoding.
- Use `Schema.TaggedErrorClass` for typed errors.
- Effect v4 `unstable` modules are allowed when they are the correct API surface for the job.
- Use `effect/unstable/httpapi` for PatchPlane-owned schema-first HTTP APIs when HTTP contracts are needed.
- Use `effect/unstable/http` for Effect HTTP routing/client/server primitives.
- Use `@effect/platform-node@4.0.0-beta.79` for Node-specific Effect runtime/platform services when server/plugin code needs them.

Plain TypeScript remains preferred for:

- presentational React components,
- simple UI view models,
- small pure utilities,
- app chrome and styling,
- client-only interaction code that does not benefit from Effect.

### 5.1 Researched vendor baselines

The current `/vendor` research baseline is research-only. Vendored submodules are not application dependencies and should not be imported by PatchPlane packages. Runtime dependencies must be declared in package manifests with pinned versions, including `effect@4.0.0-beta.79` wherever Effect v4 is used.

Current baseline:

| System | Vendor path | Baseline | Spec implication |
| --- | --- | --- | --- |
| Effect | `vendor/effect` | `effect-smol`, `effect@4.0.0-beta.79` | Use Effect v4 APIs from the consolidated `effect` package. `effect/unstable/httpapi` and `effect/unstable/http` are allowed for PatchPlane-owned HTTP contracts and HTTP runtime boundaries. Treat v4 as beta and isolate it in domain/core/plugins/app server code. |
| Daytona | `vendor/daytona` | TypeScript SDK `@daytona/sdk` | Use `Daytona` from `@daytona/sdk`; config keys are `DAYTONA_API_KEY`, `DAYTONA_API_URL`, and `DAYTONA_TARGET`. Sandbox creation supports `ephemeral`, `autoStopInterval`, `autoDeleteInterval`, `networkBlockAll`, `networkAllowList`, resources, snapshots, process execution, filesystem, and git operations. |
| GitHub | `vendor/octokit.js` | `octokit` v5 line | Use `Octokit` and `App` from `octokit`; GitHub App webhook handling should verify signed payloads through Octokit webhook APIs before ingestion. |
| Pi | `vendor/pi` | `@earendil-works/pi-agent-core@0.79.1` | Runtime plugin should wrap `Agent`, event subscription, steering/follow-up queues, abort, and `waitForIdle`; normalize Pi events into PatchPlane `RuntimeEvent`. |
| WorkOS | `vendor/workos-node` | `@workos-inc/node@10.2.0` | Auth plugin should wrap `WorkOS`, `userManagement`, `organizations`, and organization membership data; WorkOS requires Node 22.11+, while Pi requires Node 22.19+, so PatchPlane server runtime should target Node 22.19+ where Node compatibility matters. |
| Effect Platform Node | `vendor/effect/packages/platform-node` | `@effect/platform-node@4.0.0-beta.79` | Use for Node-specific Effect services such as `NodeRuntime`, `NodeHttpServer`, `NodeHttpClient`, filesystem/path/crypto, and long-running worker/plugin processes. Do not use it to replace TanStack Start in `apps/client` unless a standalone Node service is intentionally introduced. |

---

## 6. Domain Package

`packages/domain` owns PatchPlane's portable data model.

Use Effect Schema from day one for runtime validation, serialization, JSON Schema generation, and TypeScript type inference.

Rule:

```text
All external inputs must be decoded into PatchPlane domain schemas before entering core workflows.
```

Initial schemas:

- `Actor`
- `Workspace`
- `Membership`
- `Permission`
- `PromptRequest`
- `WorkflowRun`
- `RuntimeSession`
- `RuntimeEvent`
- `CandidatePatchSet`
- `ReviewRun`
- `ReviewFinding`
- `MergeDecision`
- `PolicyBundle`
- `RepositoryConnection`

Important trust boundaries include:

- WorkOS session data,
- Convex documents,
- GitHub webhooks,
- GitHub API responses,
- runtime events,
- sandbox outputs,
- review findings,
- policy payloads,
- UI inputs,
- server-function inputs.

---

## 7. Typed Errors

PatchPlane must model expected failures as typed errors, not raw SDK exceptions.

Initial error families:

- `AuthError`
- `StorageError`
- `GitProviderError`
- `RuntimeError`
- `SandboxError`
- `ReviewError`
- `PolicyError`
- `DecisionError`
- `WorkflowStateError`
- `ValidationError`

Expected failure modes include:

- auth session missing,
- workspace not selected,
- permission denied,
- GitHub installation missing,
- repository not authorized,
- sandbox provisioning failed,
- runtime emitted invalid event,
- review timed out,
- policy blocked decision,
- publication failed.

Plugin-specific failures must be mapped into PatchPlane-owned typed errors before crossing into core workflows.

---

## 8. Core Package

`packages/core` defines PatchPlane capabilities as Effect services and implements workflow behavior in terms of those capabilities.

Core services:

### `AuthService`

- `getCurrentActor`
- `getCurrentWorkspace`
- `requirePermission`
- `listMemberships`

### `StorageService`

- `createPromptRequest`
- `createWorkflowRun`
- `appendRuntimeEvent`
- `createReviewRun`
- `createMergeDecision`
- `listRecentWorkflowStarts` for the foundation read-back path
- `readWorkflowTimeline` later, once runtime/review/decision events exist

### `GitProviderService`

- `verifyRepositoryAccess`
- `createBranch`
- `createCommit`
- `createDraftPullRequest`
- `publishComment`
- `publishCheck`

### `RuntimeService`

- `startSession`
- `sendInstruction`
- `streamEvents`
- `stopSession`

### `SandboxService`

- `provision`
- `execute`
- `collectArtifacts`
- `destroy`

### `ReviewService`

- `runReview`
- `emitFinding`
- `completeReview`

### `PolicyService`

- `evaluatePolicy`
- `proposeDecision`

### `TelemetryService`

- structured logging,
- spans,
- metrics,
- contextual annotations.

Initial core workflows:

- `StartWorkflowFromPrompt`
- `IngestRuntimeEvent`
- `ProposeMergeDecision`

---

## 9. Plugins Package

A PatchPlane plugin is a concrete implementation of a PatchPlane core service using an external system.

Examples:

- WorkOS Auth Plugin,
- Convex Storage Plugin,
- GitHub Provider Plugin,
- Pi Agent Runtime Plugin,
- Daytona Sandbox Plugin,
- OpenCode Runtime Plugin,
- Codex Runtime Plugin,
- Postgres Storage Plugin,
- MySQL Storage Plugin,
- SQLite Storage Plugin,
- GitLab Provider Plugin,
- Kubernetes Sandbox Plugin.

Rule:

```text
PatchPlane v2 uses real plugins from the start, but all real integrations must be accessed through PatchPlane-owned Effect services and layers.
```

### 9.1 Initial plugins

Foundation MVP:

- Convex Storage Plugin.

Deferred until after foundation:

- WorkOS Auth Plugin.

End-to-end MVP:

- GitHub Provider Plugin,
- Daytona Sandbox Plugin,
- Pi Agent Runtime Plugin.

### 9.2 Later plugins

- Postgres Storage Plugin,
- MySQL Storage Plugin,
- SQLite Storage Plugin,
- OpenCode Runtime Plugin,
- Codex Runtime Plugin,
- GitLab Provider Plugin,
- Kubernetes Sandbox Plugin.

---

## 10. WorkOS Auth Model

WorkOS is the first-class `AuthService` implementation, not merely a Convex detail.

Conceptually:

- WorkOS owns identity, organization membership, and source role/permission data.
- PatchPlane owns workflow authorization decisions.
- Convex may validate WorkOS JWTs and store PatchPlane records, but Convex is not the source identity model.

Mapping:

```text
WorkOS User             → Actor
WorkOS Organization     → Workspace
WorkOS Membership       → Membership
WorkOS Role/Permissions → WorkspaceRole / Permission[]
```

Core must only know:

- `Actor`,
- `Workspace`,
- `Membership`,
- `Permission`.

Core must not know:

- `WorkOSUser`,
- `WorkOSOrganization`,
- `WorkOSOrganizationMembership`.

### 10.1 Initial roles

Keep the first role model simple:

- `owner`
- `admin`
- `maintainer`
- `reviewer`
- `operator`
- `viewer`

Suggested first permission slugs:

- `workspace:view`
- `repo:connect`
- `prompt:create`
- `run:start`
- `run:interrupt`
- `review:create`
- `decision:approve`
- `decision:reject`
- `publication:create`

Do not overbuild enterprise RBAC in v2.

---

## 11. App Composition Root

`apps/client` owns framework integration and deployment composition.

It is responsible for:

- TanStack Start routes,
- Convex client wiring,
- WorkOS route/session helpers later when auth work resumes,
- server functions,
- HTTP route handlers,
- UI rendering,
- composing plugin layers,
- constructing the PatchPlane `ManagedRuntime`.

`packages/core` must not depend on TanStack Start, Convex server functions, or WorkOS route helpers.

### 11.1 ManagedRuntime bridge

`apps/client` creates the PatchPlane runtime from composed plugin layers:

```text
apps/client/src/effect/layers.ts
- foundation: compose ConvexStoragePlugin.layer
- later: compose WorkOSAuthPlugin.layer
- later: compose GitHubProviderPlugin.layer
- later: compose PiAgentRuntimePlugin.layer
- later: compose DaytonaSandboxPlugin.layer

apps/client/src/effect/runtime.ts
- create ManagedRuntime from PatchPlaneLayer
- export helpers for server routes/functions
```

Route handlers and server functions call core workflows through this runtime.

---

## 12. Configuration

Plugin configuration must use Effect Config.

Each plugin owns its config:

- `WorkOSConfig`
- `ConvexConfig`
- `GitHubConfig`
- `PiAgentConfig`
- `DaytonaConfig`

Rules:

- Plugins must not read raw environment variables from random files.
- Plugin configuration is loaded through Effect Config and provided through plugin layers.
- Secrets should use redacted config values where supported.
- Configuration should fail at startup, not halfway through a workflow.

Important secret-bearing config includes:

- WorkOS API keys,
- WorkOS client IDs and cookie/session secrets,
- Convex URLs and deployment credentials,
- GitHub App IDs and private keys,
- Daytona tokens,
- runtime credentials.

---

## 13. Observability

PatchPlane is an operational control plane, so observability is part of the core/plugin contract.

Every workflow and plugin operation should emit structured context where available:

- `workspaceId`
- `actorId`
- `promptRequestId`
- `workflowRunId`
- `runtimeSessionId`
- `reviewRunId`
- `mergeDecisionId`
- `pluginName`
- `externalSystem`

Initial spans:

- `patchplane.prompt.create`
- `patchplane.workflow.start`
- `patchplane.auth.resolve_actor`
- `patchplane.storage.create_workflow_run`
- `patchplane.git.verify_repo`
- `patchplane.runtime.start_session`
- `patchplane.sandbox.provision`
- `patchplane.review.run`
- `patchplane.decision.propose`

---

## 14. Core System Model

### 14.1 PromptRequest

A user- or agent-created request containing:

- intent or prompt,
- source channel,
- target scope,
- expected outcome,
- evaluation policy,
- optional implementation hints,
- initiator identity,
- workspace identity.

### 14.2 WorkflowRun

The durable orchestration record for one execution attempt containing:

- prompt-request reference,
- workspace reference,
- repository connection reference when applicable,
- selected execution target,
- selected runtime and sandbox profile,
- lifecycle state,
- callback targets,
- policy bundle reference.

Workflow runs are control-plane truth for execution attempts.

### 14.3 RuntimeSession

The operational container for one agent execution context containing:

- runtime plugin identifier,
- sandbox identifier,
- workspace root,
- approval policy,
- sandbox policy,
- timeout budget,
- current status,
- resumability metadata.

Runtime sessions are execution state, not product truth.

### 14.4 RuntimeEvent

A normalized event emitted by a runtime plugin, for example:

- session started,
- turn started,
- tool call requested,
- approval required,
- artifact emitted,
- turn completed,
- turn failed,
- session terminated.

Runtime events are stored for observability and debugging, but they are not merge decisions.

### 14.5 CandidatePatchSet

The concrete output proposed by an agent run:

- changed files or structured artifacts,
- generated code or content,
- metadata about tools used,
- tests run,
- dependency changes,
- machine-readable diff summary,
- runtime session reference.

### 14.6 ReviewRun

A sandboxed evaluation result produced by a reviewer or tool:

- pass/fail,
- numeric score,
- comments,
- structured findings,
- execution logs,
- artifact references.

### 14.7 MergeDecision

A durable decision containing:

- final weighted score,
- criteria evaluation result,
- proposed state,
- responsible workflow run,
- related GitHub issue or PR reference,
- policy bundle reference,
- deciding actor or automated policy source.

### 14.8 RepositoryConnection

The durable repository authority record containing:

- provider,
- installation identity,
- repository identity and permissions,
- webhook routing metadata,
- checkout or execution defaults,
- bindings to issues, PRs, and prompt-request sources.

### 14.9 Symbiosis Graph

An append-only provenance graph that links:

- prompt requests,
- workflow runs,
- repository connections,
- runtime sessions,
- candidate patch sets,
- review runs,
- merge decisions,
- publication events,
- rollback operations.

The graph is the lineage model, not the merge algorithm.

---

## 15. GitHub Compatibility Model

The end-to-end MVP uses a PatchPlane-primary, GitHub-compatible model:

- PatchPlane is the system of record for prompt requests, workflow runs, runtime sessions, approvals, reviews, and decisions.
- Candidate changes are materialized as git commits and branches inside a sandboxed repo workspace.
- GitHub remains the initial repository and contribution surface for issues, PRs, comments, checks, and open-source collaboration.
- Accepted outputs are published back to GitHub as comments, checks, and PR or draft PR updates.
- Human review remains the default merge authority for the first vertical slice.
- Direct transactional auto-merge and PatchPlane-owned rollback are follow-on steps.
- Overlapping or ambiguous changes fall back to PR-based human arbitration, not semantic auto-resolution.

---

## 16. MVP Scope

### 16.1 v2 Foundation MVP

In scope:

- `packages/domain` with Effect Schema,
- `packages/core` with Effect services and workflows,
- `packages/plugins` created immediately,
- `apps/client` composition root with TanStack Start and `ManagedRuntime`,
- Convex Storage Plugin,
- development actor/workspace context for the first local path,
- WorkOS Auth Plugin deferred until after foundation storage/core is proven,
- PromptRequest creation through core,
- WorkflowRun creation through core,
- basic typed errors,
- basic structured logs.

Out of scope for the first foundation slice:

- Daytona,
- Pi Agent Core,
- GitHub PR publication,
- reviewer fan-out,
- weighted score aggregation,
- React Flow provenance graph,
- desktop shell,
- enterprise RBAC.

### 16.2 End-to-End Hosted MVP

In scope after the foundation is stable:

- GitHub Provider Plugin,
- Daytona Sandbox Plugin,
- Pi Agent Runtime Plugin,
- normalized RuntimeEvent ingestion,
- CandidatePatchSet creation,
- ReviewRun creation,
- MergeDecision proposal,
- GitHub comment/check/draft PR publication,
- operator dashboard,
- human approval/rejection path.

### 16.3 Explicitly out of scope for v2 MVP

- Fully automatic semantic conflict resolution,
- broad transactional auto-merge across overlapping patch sets,
- open multi-tenant SaaS hardening,
- fine-grained enterprise RBAC and audit export,
- background evolutionary remixing of prior successful changes,
- full offline-first source-code editing,
- deep desktop-native feature work,
- built-in model serving,
- mobile clients,
- generic issue tracking or project management.

---

## 17. Technology Choices

### 17.1 Language

Use TypeScript across the platform.

Runtime and TypeScript constraints from vendored SDK research:

- use Node 22.19+ for server/plugin contexts that execute WorkOS Node SDK and Pi Agent Core code,
- Bun remains the workspace package runner,
- server/plugin code executes under Node, not Bun, unless explicitly validated otherwise,
- Octokit v5 uses conditional exports, so plugin package TypeScript configs must use a Node-compatible module mode where necessary (`moduleResolution: "node16"`/`"nodenext"` and matching module setting) instead of blindly relying on bundler resolution for server-only packages.

### 17.2 Programming model

Use Effect v4 / effect-smol for:

- schemas and boundary decoding,
- core service definitions,
- plugin layers,
- typed errors,
- configuration,
- retries,
- cancellation,
- timeouts,
- resource lifecycles,
- workflow orchestration logic,
- observability.

### 17.3 Web framework

Use the existing `apps/client` TanStack Start app as the composition root, while isolating framework risk in the app layer. Do not create a separate `apps/app` package for v2.

### 17.4 Auth

WorkOS AuthKit remains the planned first auth plugin and source of human identity, organizations, memberships, roles, and permissions, but auth is deferred until after the foundation storage/core path works.

### 17.5 Storage and realtime

Use Convex as the first storage plugin and realtime backend.

### 17.6 Repository provider

Use GitHub App integration as the first repository provider plugin.

### 17.7 Sandbox

Use Daytona as the first sandbox plugin. The Daytona plugin should use `@daytona/sdk`, not the older `@daytonaio/sdk` package name. Initial implementation should prefer ephemeral or auto-deleting sandboxes, explicit `autoStopInterval`, and network controls (`networkBlockAll` / `networkAllowList`) when supported by the selected profile.

### 17.8 Runtime

Use `@earendil-works/pi-agent-core` as the first runtime plugin. The runtime plugin should map Pi agent events such as `agent_start`, `turn_start`, `message_start`, `message_update`, `tool_execution_start`, `tool_execution_update`, `tool_execution_end`, `turn_end`, and `agent_end` into PatchPlane `RuntimeEvent` schemas.

### 17.9 Desktop

A desktop shell remains post-foundation. Do not let desktop requirements shape the foundation MVP.

---

## 18. Testing Strategy

PatchPlane v2 validates real plugins first, but keeps service boundaries testable.

Initial integration tests:

- WorkOS session → PatchPlane Actor,
- WorkOS organization → PatchPlane Workspace,
- WorkOS roles/permissions → PatchPlane permissions,
- Convex write through `StorageService`,
- create PromptRequest through core workflow,
- create WorkflowRun through core workflow.

Core tests after the first real path is proven:

- workflow state transitions,
- error handling,
- permission checks,
- retry behavior,
- timeout behavior,
- concurrent operations,
- runtime-event validation.

Test layers are allowed and expected later. The spec does not require fake plugins before the real Convex storage/core foundation is proven.

---

## 19. Security Model

### 19.1 Trust boundaries

Trusted control plane:

- core workflows,
- plugin layers running in trusted server contexts,
- WorkOS session validation,
- Convex persistence,
- policy definitions,
- merge decisions,
- GitHub App private key handling,
- verified webhook delivery state,
- configuration profiles.

Semi-trusted clients:

- web dashboard,
- future desktop shell.

Untrusted execution plane:

- generated code,
- agent tool calls,
- reviewer agents,
- third-party CLI invocations,
- sandbox output,
- runtime output.

### 19.2 Rules

- Run generated code outside the control plane.
- Do not expose long-lived production credentials to sandbox runs.
- Verify GitHub webhook signatures.
- Deduplicate webhook deliveries.
- Keep GitHub App private keys and installation-token minting in trusted server contexts.
- Store logs and artifacts separately from privileged secrets.
- Make manual override and kill-switch behavior available from the UI.
- Treat dependency changes as high-risk.
- Validate workspaces, paths, permissions, and execution targets before runtime start.
- Make approval policy explicit per runtime session.

The v2 MVP is suitable for single-team internal usage first. It is not suitable for open multi-tenant SaaS without additional tenancy, sandbox, audit, and isolation hardening.

---

## 20. Data Model

Initial foundation entities:

- `actors`
- `workspaces`
- `memberships`
- `permissions`
- `promptRequests`
- `workflowRuns`

End-to-end MVP entities:

- `repositoryConnections`
- `githubInstallations`
- `repositories`
- `webhookDeliveries`
- `runtimeSessions`
- `runtimeEvents`
- `candidatePatchSets`
- `reviewRuns`
- `reviewFindings`
- `mergeDecisions`
- `policyBundles`
- `configProfiles`
- `executionTargets`
- `pendingApprovals`
- `pendingInputs`
- `publicationEvents`

Notes:

- WorkOS IDs may be stored as external IDs, but domain types remain PatchPlane-owned.
- Convex document shapes must be mapped into domain schemas before entering core workflows.
- Runtime events are normalized records for observability and replay.
- Workflow runs are the durable orchestration unit.
- Runtime sessions are execution state and must not become canonical merge truth.

---

## 21. Immediate Work Plan

### Step 1 — Create package structure

```text
packages/domain
packages/core
packages/plugins
apps/client
```

### Step 2 — Add Effect v4 beta intentionally

Pin `effect@4.0.0-beta.79` everywhere Effect v4 is used and keep Effect ecosystem package versions aligned. If `@effect/platform-node` is added, pin it to `4.0.0-beta.79` as well.

### Step 3 — Build `packages/domain`

Start with:

- `Actor`
- `Workspace`
- `Membership`
- `Permission`
- `PromptRequest`
- `WorkflowRun`
- typed errors

### Step 4 — Build `packages/core`

Create:

- `StorageService`
- `StartWorkflowFromPrompt`
- optional `AuthService` interface only if needed for later WorkOS integration

No WorkOS imports. No Convex imports.

### Step 5 — Build `packages/plugins/convex`

Implement:

- Convex Storage Plugin,
- `ConvexConfig`,
- `createPromptRequest`,
- `createWorkflowRun`.

Keep current Convex backend code in `packages/backend/convex` for now. Convex function location is separate from the Storage Plugin boundary; do not move Convex files until there is a concrete deployment reason.

### Step 6 — Defer `packages/plugins/workos`

WorkOS Auth Plugin is not part of the foundation path. Auth is deferred until after the core/storage foundation works.

Later implement:

- WorkOS Auth Plugin,
- `WorkOSConfig`,
- WorkOS User → Actor mapping,
- WorkOS Organization → Workspace mapping,
- WorkOS roles/permissions → PatchPlane permissions mapping.

### Step 7 — Compose in `apps/client`

Create:

```text
apps/client/src/effect/layers.ts
apps/client/src/effect/runtime.ts
```

Run one server-side action through the composed `ManagedRuntime`:

```text
Local development actor
→ default development workspace
→ create PromptRequest
→ create WorkflowRun
→ persist in Convex through StorageService
```

---

## 22. Success Criteria

### 22.1 Foundation MVP success

The foundation MVP is successful when:

1. `packages/domain`, `packages/core`, and `packages/plugins` exist and typecheck.
2. Existing Convex backend code remains in `packages/backend/convex` unless a concrete deployment reason requires moving it.
3. A local development actor and default development workspace can be represented as PatchPlane domain values.
4. WorkOS/auth is not required for the foundation success path.
5. A server-side app action calls a core workflow through `ManagedRuntime`.
6. The core workflow creates a PromptRequest through `StorageService`.
7. The core workflow creates a WorkflowRun through `StorageService`.
8. Convex persists those records through the Convex Storage Plugin.
9. Core contains no WorkOS, Convex, TanStack Start, GitHub, Daytona, or Pi Agent Core imports.
10. Basic typed errors and structured logs exist for the path.

### 22.2 End-to-end MVP success

The hosted MVP is successful when:

1. A user can connect a GitHub repository through a GitHub App installation.
2. A verified GitHub webhook or app prompt can create a durable PromptRequest.
3. PatchPlane can start a WorkflowRun for that request.
4. Daytona can provision a sandbox through `SandboxService`.
5. Pi Agent Core can run behind `RuntimeService`.
6. Runtime events are normalized and persisted.
7. A CandidatePatchSet can be produced.
8. At least one ReviewRun can return structured results.
9. A MergeDecision can be proposed.
10. PatchPlane can publish comments, checks, or draft PRs back to GitHub.
11. A human can approve, reject, interrupt, or force manual review.
12. One team can run the loop against one repository end to end.

---

## 23. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
| --- | ---: | ---: | --- |
| Effect v4 beta APIs change | Medium | Medium | Pin exact versions, isolate Effect usage in core/plugins, keep migration notes |
| TanStack Start framework churn affects delivery | Medium | Medium | Keep TanStack code in `apps/client`; protect core from framework imports |
| WorkOS auth assumptions leak into domain | Medium | High | Map WorkOS types into Actor/Workspace/Membership/Permission only |
| Convex storage shapes leak into core | Medium | High | Decode Convex documents through domain schemas and StorageService mappings |
| Plugin boundaries slow early implementation | Medium | Medium | Start with StorageService and StartWorkflowFromPrompt; defer AuthService implementation |
| GitHub App flow is more complex than expected | Medium | High | Defer GitHub to end-to-end MVP after Convex storage/core foundation works |
| Daytona integration becomes an engineering sink | Medium | High | Defer to end-to-end MVP and keep sandbox API narrow |
| Runtime integration leaks behavior into product model | Medium | High | Normalize RuntimeEvent and keep RuntimeSession as execution state only |
| Enterprise RBAC scope expands too early | Medium | Medium | Use simple roles and permission slugs for v2 |
| Multi-tenant security assumptions are misunderstood | Medium | High | State single-team internal posture until hardening is complete |

---

## 24. Final Recommendation

Proceed with PatchPlane v2 as an Effect-native control-plane core with real infrastructure plugins.

The revised direction is:

```text
Real plugins first where they matter for the current slice.
Stable core service boundaries always.
Effect Schema in domain from day one.
Convex as first Storage Plugin.
WorkOS Auth Plugin deferred until after foundation.
apps/client as composition root.
```

PatchPlane v2 should validate real Convex-backed storage and core workflow boundaries first, then add WorkOS auth after the foundation works, while protecting the product core from hard coupling to WorkOS, Convex, GitHub, Pi Agent Core, Daytona, or any future agent harness.
