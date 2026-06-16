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

Build the **PatchPlane v2 authenticated foundation**:

```text
WorkOS AuthKit session
→ TanStack Start server workflow
→ WorkOSAuthPlugin live membership/permission check
→ StorageService
→ Convex trusted HTTP action
→ internal workflow start mutation
→ promptRequests + workflowRuns
→ authenticated Convex reads filtered by mirrored WorkOS membership/permissions
```

The foundation path has moved beyond the original local-development actor smoke. WorkOS + Convex are now composed at the app layer, WorkOS users and organization memberships are mirrored into Convex via `@convex-dev/workos-authkit`, direct public workflow-start writes are rejected, and workflow creation goes through a trusted Convex boundary. Daytona, Pi Agent Core, GitHub publication, reviewer fan-out, and graph UI remain deferred until the authenticated control-plane loop is productized in the UI.

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

- [x] Implement namespaced/branded ID schemas for foundation IDs.
- [x] Implement experimental `Actor` schema.
- [x] Implement experimental `Workspace` schema.
- [x] Implement `Membership` schema.
- [x] Implement `Permission` schema and initial permission slugs.
- [x] Implement experimental `PromptRequest` schema.
- [x] Implement experimental `WorkflowRun` schema.
- [x] Implement foundation typed errors:
  - [x] `AuthError`
  - [x] `StorageError`
  - [x] `WorkflowStateError`
  - [x] `ValidationError`
- [x] Add `AuthError` now that WorkOS/auth work has resumed.
- [x] Export foundation schemas and inferred types through explicit subpath exports; no barrel files.
- [x] Add `traceId` to foundation request/run schemas for correlation.

Acceptance criteria:

- All domain schemas decode unknown input.
- All external/plugin data entering core has a decode path.
- Typed errors are PatchPlane-owned and do not expose raw SDK error types.

---

### M3 — Core service contracts

**Status:** Authenticated foundation slice working

Tasks:

- [x] Define `AuthService` contract.
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
- Auth/permission failures are represented as typed `AuthError`s in the WorkOS-backed path.

---

### M4 — Convex function boundary

**Status:** Authenticated/trusted foundation slice working

Tasks:

- [x] Keep existing Convex deployment functions in `packages/backend/convex`.
- [x] Add minimal Convex mutations/queries needed by the foundation storage path.
- [x] Collapse foundation write into one internal Convex mutation, `workflowStarts:createTrusted`, so PromptRequest and WorkflowRun are inserted transactionally.
- [x] Keep Convex functions as the database API: validate args/returns and perform transactional writes.
- [x] Do not move Convex code into `apps/client` until there is a concrete deployment reason.
- [x] Store `traceId` on foundation records and log successful mutation execution.
- [x] Reject direct public `workflowStarts:create` writes; trusted writes go through `POST /workflow-starts/create` and then the internal mutation.
- [x] Gate `workflowStarts:listRecent` with WorkOS AuthKit identity and mirrored active membership permission `workspace:view`.

Acceptance criteria:

- Convex backend code still lives under `packages/backend/convex`.
- Foundation Convex functions can typecheck.
- Convex generated API exposes the public reads, trusted HTTP action, and internal mutation needed by `ConvexStoragePlugin`.

---

### M5 — Convex Storage Plugin

**Status:** Authenticated/trusted foundation slice working

Tasks:

- [x] Define experimental Convex schema for foundation entities:
  - [x] actors/workspace external refs as strings for now,
  - [x] promptRequests,
  - [x] workflowRuns.
- [x] Add `ConvexConfig` using Effect Config.
- [x] Implement experimental domain ↔ Convex document mapping.
- [x] Implement `createWorkflowFromPrompt` through trusted Convex HTTP action.
- [x] Decode Convex documents back through domain schemas.

Acceptance criteria:

- Foundation records persist through `StorageService`.
- Core does not import Convex APIs.
- Convex trusted write/read errors map into `StorageError`.
- Plugin HTTP calls use Effect `HttpClient` / `FetchHttpClient.layer` instead of raw `fetch`.

---

### M6 — App composition root and first vertical action

**Status:** Runtime, AuthKit composition, and authenticated workflow path working

Tasks:

- [x] Create `apps/client/src/effect/layers.ts`.
- [x] Create `apps/client/src/effect/runtime.ts`.
- [x] Compose Convex Storage Plugin.
- [x] Compose WorkOS Auth Plugin.
- [x] Create `ManagedRuntime` from composed layer.
- [x] Implement one server-side action that runs authenticated workflow start.
- [x] Wire WorkOS AuthKit provider and Convex AuthKit provider in the root route.
- [x] Pass WorkOS access tokens into Convex storage/trusted write path where needed.
- [ ] Productize the visible prompt/workflow UI beyond the current alpha shell.
- [x] Add Effect observability layer with pretty terminal logs and JSONL file logs.

Acceptance criteria:

- Authenticated WorkOS actor/workspace can create a `PromptRequest` and `WorkflowRun` in Convex via core workflow and trusted write boundary.
- App route/server function talks to core through `ManagedRuntime`.
- No SDK-specific object leaks into core output.

---

## 3. Current Verified Experiment

The current automated verification covers the authenticated/trusted foundation boundaries:

```text
TanStack Start server function
→ WorkOS session extraction
→ AuthRequestContext
→ WorkOSAuthPlugin.requirePermission("prompt:create")
→ StorageService
→ ConvexStoragePlugin
→ Effect HttpClient
→ POST /workflow-starts/create
→ internal.workflowStarts.createTrusted
→ promptRequests + workflowRuns
```

The authenticated read-back path is:

```text
Convex client with WorkOS AuthKit token
→ workflowStarts:listRecent / requests:list / viewer:current
→ ctx.auth.getUserIdentity()
→ mirrored WorkOS membership checks
→ decoded PatchPlane domain objects where applicable
```

Evidence:

- `bun run --cwd packages/backend test` passes, including Convex tests for:
  - trusted workflow-start HTTP boundary,
  - direct public workflow-start rejection,
  - WorkOS user sync,
  - WorkOS membership sync,
  - mirrored membership/permission read authorization.
- `bun run test:domain` passes.
- `bun run test:core` passes.
- `bun run test:plugins` passes.
- `bun run typecheck` passes.
- `bun run lint` passes.
- `bun run --cwd apps/client build` passes.
- Build warnings currently come from upstream `@workos/authkit-tanstack-react-start` usage of deprecated TanStack `inputValidator()`.

Current observability shape:

- terminal: `Logger.consolePretty({ colors: true })`
- file: `Logger.formatJson.pipe(Logger.toFile("../../.patchplane/logs/effect.jsonl"))`
- Convex: `console.log` in trusted workflow start mutation with `traceId`, `promptRequestId`, and `workflowRunId`

Repeatable authenticated smoke command:

```sh
CONVEX_URL=... \
PATCHPLANE_WORKOS_ACCESS_TOKEN=... \
PATCHPLANE_WORKOS_USER_ID=... \
PATCHPLANE_WORKOS_ORGANIZATION_ID=... \
PATCHPLANE_CONVEX_WRITE_SECRET=... \
  bun run smoke:foundation "Prompt"
```

Documentation:

- [docs/foundation-smoke.md](./docs/foundation-smoke.md)
- [docs/workos-alpha-completion.md](./docs/workos-alpha-completion.md)

Remaining manual smoke before external alpha:

- Hosted AuthKit sign-in and `/api/auth/callback` with real WorkOS credentials.
- Convex WorkOS webhook delivery to `/workos/webhook` for users and organization memberships.
- Browser workflow start from `/app` using a real WorkOS organization membership.

---

## 4. End-to-End MVP Backlog

M1–M6 are now the authenticated foundation. Continue with WorkOS hardening and then GitHub/Daytona/Pi.

### M6.5 — WorkOS / Convex auth hardening

Vendor facts respected:

- SDK package: `@workos-inc/node@10.2.0`.
- Server SDK requires Node 22.11+.
- `OrganizationMembership` has a primary `role` and optional `roles` array.
- `User`, `Organization`, and `OrganizationMembership` must be mapped into PatchPlane domain types.

Tasks:

- [x] Add `packages/plugins/src/workos/WorkOSConfig.ts` using Effect Config.
- [x] Add initial WorkOS client/plugin layer skeleton.
- [x] Implement WorkOS `User` → `Actor` mapping.
- [x] Implement WorkOS `Organization` → `Workspace` mapping.
- [x] Implement WorkOS `OrganizationMembership` → `Membership` mapping.
- [x] Implement WorkOS role(s) → PatchPlane permission slug mapping.
- [x] Implement initial `WorkOSAuthPlugin` as `AuthService` layer.
- [x] Wire `WorkOSAuthPlugin` to real AuthKit session data in TanStack Start.
- [x] Split browser-safe WorkOS session mapping from server-only WorkOS SDK plugin code.
- [x] Add WorkOS AuthKit provider and Convex AuthKit provider in the root route.
- [x] Forward AuthKit access token through the authenticated workflow path.
- [x] Add app-level `users` table synced from WorkOS user events.
- [x] Add app-level `memberships` table synced from WorkOS organization membership events.
- [x] Add mirrored membership checks in Convex reads.
- [x] Move workflow-start writes behind trusted HTTP action + internal mutation.
- [x] Ensure raw WorkOS objects do not cross into core.
- [ ] Add WorkOS `organization_role.updated` / `permission.updated` handling or documented backfill strategy if role definitions become dynamic in production.
- [ ] Add WorkOS Authorization API resource-level checks once PatchPlane introduces repository/project-scoped permissions.
- [ ] Replace trusted write shared-secret header with stronger HMAC signing if this boundary is exposed beyond the app server.

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

- [x] Convex and WorkOS plugin config loads through Effect Config.
- [x] WorkOS and trusted Convex write secrets are redacted where supported.
- [ ] Add explicit startup/config smoke for all required alpha environment variables.

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
- [x] Backend Convex tests cover user sync, membership sync, trusted workflow start boundary, and authz failures.
- [x] WorkOS plugin tests cover mapping, membership resolution, permission checks, and mocked WorkOS API failure handling.
- [x] Automate/document the authenticated Convex integration smoke test as `bun run smoke:foundation`.
- [ ] Add true external browser/AuthKit/Convex E2E once stable WorkOS and Convex test credentials exist.
- [ ] Later: test layers for pure core workflow transitions.

### Security

- [ ] No long-lived credentials in sandboxes.
- [ ] GitHub webhook signatures verified before ingestion.
- [x] Convex SDK / trusted HTTP errors map into typed PatchPlane `StorageError` for foundation.
- [x] WorkOS SDK errors map into typed PatchPlane `AuthError` for authenticated foundation.
- [x] Direct public `workflowStarts:create` writes are rejected.
- [x] Trusted workflow-start writes use an internal Convex mutation behind an HTTP action guarded by `PATCHPLANE_CONVEX_WRITE_SECRET`.
- [x] Convex reads require WorkOS AuthKit identity and mirrored active membership permissions.
- [ ] Upgrade trusted write shared-secret header to HMAC signing before production exposure.
- [ ] Add WorkOS Authorization API checks for resource-scoped permissions when repository/project resources are introduced.
- [ ] Sandbox profiles have explicit network and lifecycle policy.

---

## 6. Non-Goals For The Authenticated Foundation

Do not implement before the WorkOS/Convex alpha smoke is complete:

- Daytona provisioning,
- Pi Agent runtime sessions,
- GitHub PR publication,
- reviewer fan-out,
- weighted scoring,
- provenance graph UI,
- desktop shell,
- full enterprise RBAC beyond current WorkOS organization roles/permissions,
- production-grade resource authorization beyond the current org-level WorkOS membership mirror.

---

## 7. Working Rule

When implementation and spec disagree:

1. check `/vendor` source first,
2. update `SPEC.md` if the architecture or product boundary changes,
3. update this `ROADMAP.md` if task order, acceptance criteria, or evidence changes,
4. keep SDK-specific knowledge inside plugins and app composition code, never in core.
