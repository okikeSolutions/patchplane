# ROADMAP.md – PatchPlane v2 Execution Plan

**Date:** June 12, 2026  
**Source of truth:** [SPEC.md](./SPEC.md)  
**Architecture:** Effect v4 / effect-smol core with real infrastructure plugins

---

## 0. Vendor Research Baseline

This roadmap is based on the current `/vendor` submodules and the revised v2 spec. Vendor submodules are for research only; PatchPlane packages must declare normal package dependencies and must not import code from `/vendor`.

| System | Vendor path | Current evidence | Roadmap impact |
| --- | --- | --- | --- |
| Effect v4 | `vendor/effect` | `Effect-TS/effect-smol`, checked out at `effect@4.0.0-beta.79`; includes `effect/unstable/httpapi` and `effect/unstable/http`. | Use `effect@4.0.0-beta.79`, isolate beta APIs in `packages/domain`, `packages/core`, and `packages/plugins`. `unstable` Effect modules are allowed when they are the right API surface. |
| Daytona | `vendor/daytona` | TypeScript SDK is `@daytona/sdk`; SDK exposes `Daytona`, sandbox create/delete, process execution, fs, git, snapshots, resources, network controls, `ephemeral`, `autoStopInterval`, `autoDeleteInterval`. | Use `@daytona/sdk`, not `@daytonaio/sdk`. Model sandbox policies around explicit lifecycle and network controls. |
| Octokit | `vendor/octokit.js` | `octokit` v5 line exposes `Octokit`, `App`, REST, GraphQL, GitHub App, and webhook verification APIs; package uses conditional exports. | GitHub plugin should wrap `App` and webhook verification. Use Node-compatible TS module settings in server/plugin packages that import Octokit. |
| Pi | `vendor/pi` | `@earendil-works/pi-agent-core@0.79.1` exposes `Agent`, `subscribe`, `prompt`, `continue`, `abort`, `waitForIdle`, steering/follow-up queues, and event stream types. | Runtime plugin should be `PiAgentRuntimePlugin`, not `PiMonoRuntimePlugin`; normalize Pi events into PatchPlane `RuntimeEvent`. |
| WorkOS | `vendor/workos-node` | `@workos-inc/node@10.2.0`; exports `WorkOS`, `userManagement`, `organizations`, membership models with `role` and optional `roles`; requires Node 22.11+. | Auth plugin maps WorkOS `User`, `Organization`, and `OrganizationMembership` into PatchPlane domain schemas. Server/plugin runtime should target Node 22.19+ because Pi requires it. |
| Effect Platform Node | `vendor/effect/packages/platform-node` | `@effect/platform-node@4.0.0-beta.79`; exports `NodeRuntime`, `NodeHttpServer`, `NodeHttpClient`, Node filesystem/path/crypto and other platform services. | Use when Node-specific Effect services are needed. Pin to `4.0.0-beta.79`. Do not replace TanStack Start unless a standalone Node service is intentionally introduced. |

Spec adjustments made from research:

- renamed Pi Mono references to Pi Agent Core / Pi Agent Runtime Plugin,
- clarified `effect-smol` / `effect@4.0.0-beta.79`,
- decided Effect `unstable` modules are allowed, including `effect/unstable/httpapi` and `effect/unstable/http`,
- clarified `@daytona/sdk` package name and sandbox lifecycle/network implications,
- added Node 22.19+ and Octokit conditional-export TypeScript constraints.

---

## 1. Current Objective

Build the **PatchPlane v2 Foundation MVP**:

```text
local development actor
→ default development workspace
→ create PromptRequest through core
→ create WorkflowRun through core
→ persist through Convex Storage Plugin
→ observe the result with Effect logs and Convex records
```

The first real vertical experiment is now working from an Effect runtime into Convex. Auth is not a focus for the foundation. WorkOS, Daytona, Pi Agent Core, GitHub publication, reviewer fan-out, and graph UI are deferred until the foundation path is wired through a UI/dev entrypoint.

---

## 2. Milestones

### M0 — Repo alignment and dependency baseline

**Status:** In progress

Tasks:

- [x] Add vendor submodules under `/vendor`.
- [x] Verify Effect submodule is `Effect-TS/effect-smol` at `effect@4.0.0-beta.79`.
- [x] Verify Daytona SDK package is `@daytona/sdk`.
- [x] Verify Pi runtime package is `@earendil-works/pi-agent-core@0.79.1`.
- [x] Verify WorkOS Node SDK runtime requirement.
- [x] Decide migration path: keep `apps/client`; do not create `apps/app`.
- [x] Decide Convex location: keep `packages/backend/convex` in place for now; do not move it into `apps/client`.
- [x] Decide package timing: create `packages/domain`, `packages/core`, and `packages/plugins` immediately.
- [x] Decide runtime/tooling split: Bun remains the package runner; server/plugin code executes under Node.
- [x] Decide vendor usage: `/vendor` is research-only.
- [x] Decide Effect policy: pin `effect@4.0.0-beta.79` everywhere Effect v4 is used.
- [ ] Add Node engine note or tooling guard for Node 22.19+ where server/plugin code runs.
- [ ] Update TS config strategy for server/plugin packages that import Octokit conditional exports.

Acceptance criteria:

- `.gitmodules` contains all vendor sources.
- `SPEC.md` reflects vendor research constraints.
- The repo has a documented migration approach from current structure to v2 package architecture: keep `apps/client`, keep `packages/backend/convex` in place for now, and create v2 packages immediately.

---

### M1 — Create v2 package skeleton

**Status:** Complete for foundation experiment

Target structure:

```text
packages/domain
packages/core
packages/plugins
apps/client                -> existing TanStack Start app and composition root
packages/backend/convex    -> existing Convex deployment functions, kept in place for now
```

Tasks:

- [x] Create `packages/domain` package.
- [x] Create `packages/core` package.
- [x] Create `packages/plugins` package.
- [x] Keep existing `apps/client` as the TanStack Start composition root.
- [x] Add explicit package subpath exports for each package; avoid root barrel files.
- [x] Add package-level `typecheck` and `test` scripts.
- [x] Update root typecheck scripts to include the new packages.
- [x] Pin `effect@4.0.0-beta.79` everywhere Effect v4 is used.
- [x] Root lint covers new packages through `oxlint apps packages`.

Acceptance criteria:

- `bun install` succeeds.
- New package typechecks pass.
- `bun run typecheck` reaches the new packages.
- `packages/core` does not import WorkOS, Convex, GitHub, Daytona, Pi, or TanStack Start.

---

### M2 — Domain schemas and typed errors

**Status:** Foundation slice working

Tasks:

- [ ] Implement ID schemas and branded IDs.
- [x] Implement experimental `Actor` schema.
- [x] Implement experimental `Workspace` schema.
- [ ] Implement `Membership` schema.
- [ ] Implement `Permission` schema and initial permission slugs.
- [x] Implement experimental `PromptRequest` schema.
- [x] Implement experimental `WorkflowRun` schema.
- [ ] Implement foundation typed errors:
  - [x] `StorageError`
  - [x] `WorkflowStateError`
  - [x] `ValidationError`
- [ ] Defer `AuthError` until WorkOS/auth work resumes.
- [x] Export foundation schemas and inferred types through explicit subpath exports; no barrel files.
- [x] Add `traceId` to foundation request/run schemas for correlation.

Acceptance criteria:

- All domain schemas decode unknown input.
- All external/plugin data entering core has a decode path.
- Typed errors are PatchPlane-owned and do not expose raw SDK error types.

---

### M3 — Core service contracts

**Status:** Foundation slice working

Tasks:

- [ ] Defer `AuthService` implementation until WorkOS/auth work resumes.
- [x] Represent a local development actor and default development workspace as domain values for the foundation path.
- [x] Define experimental `StorageService` with:
  - [x] `createWorkflowFromPrompt` as one atomic storage operation
  - [x] `listRecentWorkflowStarts` minimal read-back contract
  - [ ] Defer full workflow timeline/event history until `RuntimeEvent`, `ReviewRun`, and `MergeDecision` exist
- [ ] Define `TelemetryService` minimal interface.
- [x] Implement experimental `StartWorkflowFromPrompt` workflow.
- [x] Add structured log/span context for the foundation path with `traceId`, `actorId`, `workspaceId`, and resulting Convex IDs.

Acceptance criteria:

- Core compiles with only `domain` and `effect` imports.
- `StartWorkflowFromPrompt` depends only on services, not SDKs.
- Storage failures are typed.
- Auth/permission failures are deferred until auth work resumes.

---

### M4 — Convex function boundary

**Status:** Foundation slice working

Tasks:

- [x] Keep existing Convex deployment functions in `packages/backend/convex`.
- [x] Add minimal Convex mutations/queries needed by the foundation storage path.
- [x] Collapse foundation write into one Convex mutation, `workflowStarts:create`, so PromptRequest and WorkflowRun are inserted transactionally.
- [x] Keep Convex functions as the database API: validate args/returns and perform transactional writes.
- [x] Do not move Convex code into `apps/client` until there is a concrete deployment reason.
- [x] Store `traceId` on foundation records and log successful mutation execution.

Acceptance criteria:

- Convex backend code still lives under `packages/backend/convex`.
- Foundation Convex functions can typecheck.
- Convex generated API exposes the functions needed by `ConvexStoragePlugin`.

---

### M5 — Convex Storage Plugin

**Status:** Foundation slice working

Tasks:

- [x] Define experimental Convex schema for foundation entities:
  - [x] actors/workspace external refs as strings for now,
  - [x] promptRequests,
  - [x] workflowRuns.
- [x] Add `ConvexConfig` using Effect Config.
- [x] Implement experimental domain ↔ Convex document mapping.
- [x] Implement `createWorkflowFromPrompt`.
- [x] Decode Convex documents back through domain schemas.

Acceptance criteria:

- Foundation records persist through `StorageService`.
- Core does not import Convex APIs.
- Convex errors map into `StorageError`.

---

### M6 — App composition root and first vertical action

**Status:** Runtime and smoke paths working; UI entrypoint deferred

Tasks:

- [x] Create `apps/client/src/effect/layers.ts`.
- [x] Create `apps/client/src/effect/runtime.ts`.
- [x] Compose Convex Storage Plugin.
- [x] Use local development actor/workspace context for foundation.
- [x] Create `ManagedRuntime` from composed layer.
- [x] Implement one server-side action that runs `StartWorkflowFromPrompt`.
- [ ] Defer minimum UI/server entrypoint until dashboard/dev-harness direction is clearer.
- [x] Add Effect observability layer with pretty terminal logs and JSONL file logs.

Acceptance criteria:

- Local development actor/workspace can create a `PromptRequest` and `WorkflowRun` in Convex via core workflow.
- App route/server function talks to core through `ManagedRuntime`.
- No SDK-specific object leaks into core output.

---

## 3. Current Verified Experiment

The following write path has been tested successfully against the real Convex dev deployment:

```text
Effect ManagedRuntime
→ StartWorkflowFromPrompt
→ StorageService
→ ConvexStoragePlugin
→ ConvexHttpClient
→ workflowStarts:create
→ promptRequests + workflowRuns
```

The following read-back path has also been tested successfully:

```text
Effect ManagedRuntime
→ ListRecentWorkflowStarts
→ StorageService
→ ConvexStoragePlugin
→ ConvexHttpClient
→ workflowStarts:listRecent
→ WorkflowStart[] decoded through domain schemas
```

Latest verified write run:

```text
traceId: 303388cb-3d6d-4446-ba5d-51bbbba6d5eb
promptRequestId: j57ea65xr8sc6p4vd24vyknwds88ggt5
workflowRunId: ms75a6emkzagvdttx6f73tec4188gvdc
```

Latest verified read-back run:

```text
entrypoint: smoke-workflow:list
returnedCount: 3
latestPromptRequestId: j57ea65xr8sc6p4vd24vyknwds88ggt5
latestWorkflowRunId: ms75a6emkzagvdttx6f73tec4188gvdc
```

Evidence:

- `bun run test:domain` passes.
- `bun run test:core` passes.
- `bun run typecheck` passes.
- `bun run lint` passes.
- `bunx convex dev --once` successfully deploys/checks Convex functions.
- Convex contains correlated `promptRequests` and `workflowRuns` rows with the same `traceId`.
- `.patchplane/logs/effect.jsonl` records the same trace through:
  - `Starting workflow from prompt`
  - `Calling Convex workflowStarts:create`
  - `Convex workflowStarts:create succeeded`
  - `Started workflow from prompt`
  - `Listing recent workflow starts`
  - `Calling Convex workflowStarts:listRecent`
  - `Convex workflowStarts:listRecent succeeded`
  - `Listed recent workflow starts`

Current observability shape:

- terminal: `Logger.consolePretty({ colors: true })`
- file: `Logger.formatJson.pipe(Logger.toFile("../../.patchplane/logs/effect.jsonl"))`
- Convex: `console.log` in `workflowStarts:create` with `traceId`, `promptRequestId`, and `workflowRunId`

Repeatable smoke command:

```sh
CONVEX_URL=... bun run smoke:foundation "Prompt"
```

Documentation: [docs/foundation-smoke.md](./docs/foundation-smoke.md)

Deferred browser boundary:

- Wire a visible dev UI/form/button to call `startWorkflowServerFn` only after dashboard/dev-harness direction is clearer. Current foundation validation uses the repeatable smoke command.

---

## 4. End-to-End MVP Backlog

Start these only after M1–M6 are complete. WorkOS/auth is also deferred to this later backlog.

### Deferred — WorkOS Auth Plugin

Vendor facts to respect later:

- SDK package: `@workos-inc/node@10.2.0`.
- Server SDK requires Node 22.11+.
- `OrganizationMembership` has a primary `role` and optional `roles` array.
- `User`, `Organization`, and `OrganizationMembership` must be mapped into PatchPlane domain types.

Deferred tasks:

- [ ] Add `packages/plugins/src/workos/WorkOSConfig.ts` using Effect Config.
- [ ] Add WorkOS client layer.
- [ ] Implement WorkOS `User` → `Actor` mapping.
- [ ] Implement WorkOS `Organization` → `Workspace` mapping.
- [ ] Implement WorkOS `OrganizationMembership` → `Membership` mapping.
- [ ] Implement WorkOS role(s) → PatchPlane permission slug mapping.
- [ ] Implement `WorkOSAuthPlugin` as `AuthService` layer.
- [ ] Ensure raw WorkOS objects do not cross into core.

---

### M7 — GitHub Provider Plugin

Vendor facts:

- Use `octokit` v5 line.
- Use `App` for GitHub App auth/installation flows.
- Verify signed webhooks before ingestion.
- Account for conditional exports with Node-compatible TS settings.

Tasks:

- [ ] Add `GitHubConfig` with app ID, private key, webhook secret, base URL.
- [ ] Implement installation-token broker.
- [ ] Implement `verifyRepositoryAccess`.
- [ ] Implement webhook verification and event normalization.
- [ ] Implement comment/check/draft PR publication.

---

### M8 — Daytona Sandbox Plugin

Vendor facts:

- Use `@daytona/sdk`.
- Config keys: `DAYTONA_API_KEY`, `DAYTONA_API_URL`, `DAYTONA_TARGET`.
- Sandbox create supports lifecycle, resources, snapshots, network controls, fs, git, process execution.

Tasks:

- [ ] Add `DaytonaConfig` with redacted API key.
- [ ] Implement `SandboxService.provision`.
- [ ] Prefer ephemeral or auto-deleting sandbox profiles for MVP.
- [ ] Implement checkout/clone support through Daytona git APIs.
- [ ] Implement command execution and artifact collection.
- [ ] Always destroy or stop sandboxes on workflow cancellation/failure where possible.

---

### M9 — Pi Agent Runtime Plugin

Vendor facts:

- Use `@earendil-works/pi-agent-core@0.79.1`.
- `Agent` supports event subscription, prompting, continuation, abort, idle waiting, steering, follow-up queues, tool hooks, and configurable tool execution.

Tasks:

- [ ] Add `PiAgentConfig`.
- [ ] Instantiate `Agent` inside sandbox/runtime boundary.
- [ ] Map Pi events to PatchPlane `RuntimeEvent`:
  - [ ] `agent_start`
  - [ ] `turn_start`
  - [ ] `message_start`
  - [ ] `message_update`
  - [ ] `message_end`
  - [ ] `tool_execution_start`
  - [ ] `tool_execution_update`
  - [ ] `tool_execution_end`
  - [ ] `turn_end`
  - [ ] `agent_end`
- [ ] Map `agent.abort()` to `RuntimeService.stopSession`.
- [ ] Map steering/follow-up to human interrupt/redirect primitives.

---

### M10 — Review, decision, and publication loop

Tasks:

- [ ] Implement `CandidatePatchSet` schema and persistence.
- [ ] Implement `ReviewRun` and `ReviewFinding` schemas and persistence.
- [ ] Implement one reviewer path, initially test/lint-oriented.
- [ ] Implement `PolicyService.evaluatePolicy`.
- [ ] Implement `ProposeMergeDecision`.
- [ ] Publish GitHub comment/check/draft PR through GitHub plugin.
- [ ] Add operator approval/rejection path.

---

## 5. Cross-Cutting Work

### Config

- [ ] All plugin config loads through Effect Config.
- [ ] Secrets are redacted where supported.
- [ ] Config fails at startup, not mid-workflow.

### Observability

- [x] Add structured context fields for the foundation path:
  - [x] `traceId`
  - [x] `workspaceId`
  - [x] `actorId`
  - [x] `promptRequestId`
  - [x] `workflowRunId`
  - [ ] `runtimeSessionId`
  - [ ] `pluginName`
  - [ ] `externalSystem`
- [x] Add initial Effect log spans for the foundation path.
- [ ] Add OTLP export only when we introduce a real collector/backend.

### Testing

- [x] Unit/effect test: local development-shaped actor/workspace → core workflow input.
- [x] Smoke/integration verified manually: Convex write through `StorageService`.
- [x] Smoke/integration verified manually: create PromptRequest + WorkflowRun through core.
- [x] Automate/document the Convex integration smoke test as `bun run smoke:foundation`.
- [ ] Later: test layers for pure core workflow transitions.

### Security

- [ ] No long-lived credentials in sandboxes.
- [ ] GitHub webhook signatures verified before ingestion.
- [ ] Convex SDK errors mapped to typed PatchPlane errors for foundation.
- [ ] WorkOS/GitHub/Daytona/Pi SDK errors mapped later when those plugins are implemented.
- [ ] Sandbox profiles have explicit network and lifecycle policy.

---

## 6. Non-Goals Until Foundation Is Done

Do not implement before M6:

- Daytona provisioning,
- Pi Agent runtime sessions,
- GitHub PR publication,
- reviewer fan-out,
- weighted scoring,
- provenance graph UI,
- desktop shell,
- enterprise RBAC,
- multi-tenant SaaS hardening.

---

## 7. Working Rule

When implementation and spec disagree:

1. check `/vendor` source first,
2. update `SPEC.md` if the architecture or product boundary changes,
3. update this `ROADMAP.md` if task order, acceptance criteria, or evidence changes,
4. keep SDK-specific knowledge inside plugins and app composition code, never in core.
