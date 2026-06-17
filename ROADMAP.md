# ROADMAP.md – PatchPlane v2 Execution Plan

**Date:** June 17, 2026
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

### 0.1 Ecosystem research refresh — June 17, 2026

Current external research reinforces the PatchPlane wedge: agent vendors are converging on background coding sessions and PR creation, while sandbox vendors are converging on isolated execution, lifecycle policy, network controls, and resource governance. PatchPlane should not compete with those layers. It should provide the neutral pre-CI trust boundary that decides when untrusted agent output is allowed to enter trusted GitHub/CI/merge workflows.

Research findings:

- GitHub Copilot cloud agent runs autonomously in a GitHub Actions-powered environment and can start from issues or other entry points before creating reviewable branches/PRs.
- OpenAI Codex is positioned as a cloud coding agent that can operate in isolated environments and propose pull requests for review.
- Cursor Background Agents normalize parallel remote coding tasks that clone repositories, push changes, and open PRs, reinforcing the need for independent governance outside any one editor.
- Pi and Flue validate the runtime/harness layer: sessions, tools, event streams, durable execution, extensions, and subagents.
- Daytona and other sandbox providers validate sandboxing as its own infrastructure layer with lifecycle, snapshot, resource, and network policy surfaces.

Implications for alpha:

- Keep PatchPlane runtime-neutral: Pi first is an integration choice, not the product boundary.
- Keep PatchPlane sandbox-neutral: Daytona first is an integration choice, not the product boundary.
- Keep PatchPlane forge-compatible: GitHub first is the adoption wedge, not a permanent dependency.
- Prioritize a demo that shows an AI-generated patch blocked from trusted workflows until sandbox execution, validation, provenance capture, and explicit approval complete.

Sources:

- [GitHub Copilot cloud agent docs](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent)
- [GitHub Copilot coding agent announcement](https://github.blog/news-insights/product-news/github-copilot-meet-the-new-coding-agent/)
- [OpenAI Codex announcement](https://openai.com/index/introducing-codex/)
- [Daytona sandboxes docs](https://www.daytona.io/docs/en/sandboxes/)
- [Daytona TypeScript SDK sandbox reference](https://www.daytona.io/docs/en/typescript-sdk/sandbox/)
- [Pi repository](https://github.com/earendil-works/pi)
- [Flue repository](https://github.com/withastro/flue)
- [Modal sandbox comparison](https://modal.com/resources/best-code-execution-sandboxes-ai-agents)

---

## 1. Current Objective

Complete the **PatchPlane v2 authenticated foundation**, then ship the first pre-CI trust-boundary demo:

```text
WorkOS AuthKit session
→ TanStack Start server workflow
→ WorkOSAuthPlugin live membership/permission check
→ StorageService
→ Convex public workflow mutation with WorkOS JWT
→ Convex mirrored membership + `prompt:create` authorization
→ promptRequests + workflowRuns
→ authenticated Convex reads filtered by mirrored WorkOS membership/permissions
```

The foundation path has moved beyond the original local-development actor smoke. WorkOS + Convex are now composed at the app layer, WorkOS users and organization memberships are mirrored into Convex via `@convex-dev/workos-authkit`, user-facing workflow creation goes through Convex JWT validation plus mirrored membership authorization, and the authenticated control-plane loop is productized in the UI.

For the current alpha, Convex is intentionally the realtime orchestration/read-model backend: it owns live reads, WorkOS-derived auth mirroring, and Convex-side authorization around public mutations/queries. PatchPlane core workflows still run against `StorageService`, so another storage provider can later implement durable workflow-state persistence without changing core workflow code. SQL storage plugins are not a full Convex replacement; they are durable workflow storage alternatives while Convex can remain the realtime projection/UI orchestration layer.

The next slice is not "more platform." It is the smallest credible trust-boundary loop:

```text
GitHub issue/comment or prompt
→ authenticated PatchPlane workflow
→ repository access verification
→ Daytona sandbox provisioning
→ Pi/agent execution in sandbox
→ candidate patch + logs + test/review result
→ human approve/reject
→ GitHub comment/check/draft PR publication
```

For alpha, graph UI, multi-sandbox backends, weighted scoring, full enterprise RBAC, and Origin-style forge behavior remain explicitly deferred.

UI strategy: do not fork or adopt a full dashboard starter. PatchPlane already has TanStack Start, WorkOS, Convex, Paraglide, Effect runtime, theme, and shadcn/base-nova wiring in place. Use the existing app shell and compose screens from `apps/client/src/components/ui` components. Copy small layout ideas or shadcn blocks only when useful, but preserve PatchPlane's current integration surface.

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
- [x] Verify current package TS config can typecheck `octokit` conditional exports in `packages/plugins`; revisit Node16 module settings if runtime packaging changes.

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

### M4 — Convex realtime orchestration/read-model boundary

**Status:** Authenticated foundation slice working

Tasks:

- [x] Keep existing Convex deployment functions in `packages/backend/convex`.
- [x] Add minimal Convex mutations/queries needed by the foundation storage path.
- [x] Keep workflow-start creation transactional in `workflowStarts:create`, so PromptRequest and WorkflowRun are inserted together after Convex-side authz.
- [x] Keep Convex functions as the database API: validate args/returns and perform transactional writes.
- [x] Do not move Convex code into `apps/client` until there is a concrete deployment reason.
- [x] Store `traceId` on foundation records and log successful mutation execution.
- [x] Gate public `workflowStarts:create` writes with WorkOS JWT validation, active mirrored membership, actor/workspace anti-spoofing, and `prompt:create`.
- [x] Gate `workflowStarts:listRecent` with WorkOS AuthKit identity and mirrored active membership permission `workspace:view`.

Acceptance criteria:

- Convex backend code still lives under `packages/backend/convex`.
- Foundation Convex functions can typecheck.
- Convex generated API exposes the public reads and authenticated workflow-start mutation needed by `ConvexStoragePlugin`.

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
- [x] Implement `createWorkflowFromPrompt` through authenticated Convex mutation with WorkOS JWT.
- [x] Decode Convex documents back through domain schemas.

Acceptance criteria:

- Foundation records persist through `StorageService`.
- Convex is the alpha durable storage implementation, but `StorageService` remains the boundary for future SQL workflow persistence plugins.
- Core does not import Convex APIs.
- Convex authenticated write/read errors map into `StorageError`.
- Plugin Convex access uses vendor SDK boundaries instead of raw `fetch`.

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
- [x] Pass WorkOS access tokens into Convex storage write/read paths where needed.
- [x] Productize the visible prompt/workflow UI for the current alpha shell.
- [x] Add Effect observability layer with pretty terminal logs and JSONL file logs.

Acceptance criteria:

- Authenticated WorkOS actor/workspace can create a `PromptRequest` and `WorkflowRun` in Convex via core workflow and Convex-side WorkOS authorization.
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
→ ConvexHttpClient with WorkOS access token
→ workflowStarts:create
→ Convex mirrored membership + `prompt:create` authorization
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
  - authenticated public workflow-start boundary,
  - actor/workspace/source anti-spoofing,
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
- [x] Move user-facing workflow-start writes behind Convex WorkOS JWT validation and mirrored `prompt:create` authorization.
- [x] Ensure raw WorkOS objects do not cross into core.
- [ ] Add WorkOS `organization_role.updated` / `permission.updated` handling or documented backfill strategy if role definitions become dynamic in production.
- [ ] Add WorkOS Authorization API resource-level checks once PatchPlane introduces repository/project-scoped permissions.
- [ ] Add a dedicated signed system-ingestion boundary if future non-user integrations need to create workflow starts outside a WorkOS user session.

---

### M7 — GitHub Provider Plugin

**Status:** In progress

Vendor facts:

- Use `octokit` v5 line.
- Use `App` for GitHub App auth/installation flows.
- Verify signed webhooks before ingestion.
- Account for conditional exports with Node-compatible TS settings.

Tasks:

- [x] Add `GitHubConfig` with app ID, private key, webhook secret, base URL.
- [x] Implement installation-token broker via Octokit `App.getInstallationOctokit`.
- [x] Implement `verifyRepositoryAccess`.
- [x] Implement pure webhook signature verification with Octokit `app.webhooks.verify(...)` and minimal event normalization from the raw JSON payload.
- [x] Implement issue comment publication.
- [x] Add nock-backed GitHub provider tests for repository access, issue comments, and webhook signatures.
- [ ] Implement check/draft PR publication.
- [ ] Wire GitHub webhook ingestion into the app/backend request path.
- [ ] Add one user-visible GitHub publication path for the alpha demo: issue comment first, then check or draft PR.
- [ ] Persist normalized GitHub event references on workflow records once webhook ingestion is live.

Acceptance criteria:

- GitHub App installation token flow is isolated inside `packages/plugins`.
- Signed GitHub webhooks are verified before normalization or persistence.
- PatchPlane can publish an alpha workflow result back to GitHub without leaking Octokit objects into core.

---

### M8 — Daytona Sandbox Plugin

**Status:** Next alpha blocker after GitHub publication path

Vendor facts:

- Use `@daytona/sdk`.
- Config keys: `DAYTONA_API_KEY`, `DAYTONA_API_URL`, `DAYTONA_TARGET`.
- Sandbox create supports lifecycle, resources, snapshots, network controls, fs, git, process execution.

Tasks:

- [ ] Add `DaytonaConfig` with redacted API key.
- [ ] Implement `SandboxService.provision`.
- [ ] Prefer ephemeral or auto-deleting sandbox profiles for MVP.
- [ ] Add explicit sandbox policy fields for lifecycle, resources, timeout, and network posture.
- [ ] Implement checkout/clone support through Daytona git APIs.
- [ ] Implement command execution and artifact collection.
- [ ] Always destroy or stop sandboxes on workflow cancellation/failure where possible.

Acceptance criteria:

- A workflow can provision a sandbox, check out a GitHub repository ref, run at least one command, collect logs/artifacts, and tear down the sandbox.
- Sandboxes never receive long-lived WorkOS, Convex, or GitHub App credentials.
- Sandbox lifecycle and network policy are visible in stored workflow provenance.

---

### M9 — Pi Agent Runtime Plugin

**Status:** Next alpha runtime after sandbox execution exists

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
- [ ] Preserve enough raw event metadata for debugging while storing normalized PatchPlane events as product truth.

Acceptance criteria:

- PatchPlane can start one Pi Agent Core session inside a sandbox-backed workflow.
- Pi events are normalized into PatchPlane `RuntimeEvent` records.
- Operator abort/interrupt maps to runtime stop or continuation without exposing Pi-specific objects to core/UI.

---

### M9.5 — Dashboard and workflow visibility pass

**Status:** Planned after Pi produces real runtime events; keep only light shell work before then

Timing:

- Before GitHub/Daytona/Pi: keep UI functional, not polished. Maintain prompt intake, auth/workspace state, recent workflow visibility, status badges, and loading/error states.
- After GitHub and Daytona: add real repository, sandbox, command/log, and provenance placeholders backed by actual data.
- After Pi runtime events: shift into the first serious dashboard/review UX pass because the control-plane value is then visible from real workflow data.

Rules:

- [ ] Do not fork full dashboard starters or replace the current app shell.
- [ ] Build from local shadcn components in `apps/client/src/components/ui`.
- [ ] Prefer selective composition of existing `Sidebar`, `Card`, `Table`, `Badge`, `Tabs`, `Sheet`, `Dialog`, `Command`, `Skeleton`, `Empty`, `Progress`, `Textarea`, `Field`, and `Tooltip` components.
- [ ] Keep complex provenance graph UI deferred; use tables and simple vertical timelines first.
- [ ] Keep AI summaries secondary/collapsible; make raw patch/diff, logs, and provenance easy to inspect.

First dashboard scope:

- [ ] Left navigation for Dashboard, Workflows, Reviews, Sandboxes, Settings/Plugins, and Activity.
- [ ] Dashboard cards for open workflows, pending reviews, sandbox failures, and recently published patches.
- [ ] Recent workflows table with status, source, runtime, sandbox, last update, and workspace.
- [ ] Workflow detail page or side panel with prompt, timeline, runtime events, sandbox logs, and publication state.
- [ ] Review split view once candidate patches exist: diff/logs first, AI summary/provenance second, approve/reject/request-changes controls with required comment.
- [ ] Keyboard-friendly command/search palette after the main table/detail paths are useful.

Acceptance criteria:

- Dashboard uses the existing PatchPlane shell and local UI components instead of a starter fork.
- A real Pi/Daytona/GitHub-backed workflow is understandable from the UI without reading server logs.
- Review ergonomics are good enough to dogfood on GuerillaGlass.

---

### M10 — Review, decision, and publication loop

**Status:** Alpha demo finish line

Tasks:

- [ ] Implement `CandidatePatchSet` schema and persistence.
- [ ] Implement `ReviewRun` and `ReviewFinding` schemas and persistence.
- [ ] Implement one reviewer path, initially test/lint-oriented.
- [ ] Implement `PolicyService.evaluatePolicy`.
- [ ] Implement `ProposeMergeDecision`.
- [ ] Publish GitHub comment/check/draft PR through GitHub plugin.
- [ ] Add operator approval/rejection path.
- [ ] Record provenance linking prompt, actor, workspace, repository, sandbox, runtime session, commands/tests, candidate patch, review result, and final decision.

Acceptance criteria:

- A generated patch remains untrusted until sandbox execution and review complete.
- A human can approve or reject the candidate before publication/merge path handoff.
- The alpha demo can show why the decision was made using persisted provenance, not only transient logs.

---

### M10.5 — Optional SQL durable workflow storage plugins

**Status:** Deferred until after the pre-CI trust-boundary demo has real workflow/event shapes

Scope:

SQL plugins are for durable workflow persistence only. They are not intended to replace Convex's realtime UI/read-model role, WorkOS auth mirroring, or Convex-side public query/mutation authorization in the alpha. Convex may continue to project and serve live dashboard state while `StorageService` writes durable workflow records to another backend.

Provider assessment from Effect SQL research:

- Postgres: first production SQL target. Use `@effect/sql-pg` with matching Effect v4 beta version. Supports pools, transactions, JSON helpers, streaming, LISTEN/NOTIFY, migrations, and strong error mapping.
- SQLite Node: first local/self-hosted target. Use `@effect/sql-sqlite-node` backed by `better-sqlite3`. Good fit for simple OSS/dev deployments and tests.
- MySQL: feasible after Postgres/SQLite. Use `@effect/sql-mysql2`; account for dialect differences around IDs, timestamps, JSON, and returning values.
- D1: possible later for Cloudflare deployments. Use `@effect/sql-d1`, but note the vendored driver does not support transactions or streaming queries and requires a Workers `D1Database` binding.

Tasks:

- [ ] Extract shared SQL workflow-storage implementation around generic `effect/unstable/sql` `SqlClient` where dialect differences allow.
- [ ] Add SQL migrations for `prompt_requests`, `workflow_runs`, and later runtime/review/decision tables.
- [ ] Implement `PostgresWorkflowStoragePlugin` via `@effect/sql-pg`.
- [ ] Implement `SQLiteNodeWorkflowStoragePlugin` via `@effect/sql-sqlite-node`.
- [ ] Implement `MySQLWorkflowStoragePlugin` via `@effect/sql-mysql2` only after SQL schema portability is proven.
- [ ] Consider `D1WorkflowStoragePlugin` only when PatchPlane has a Cloudflare deployment target or edge-specific reason.
- [ ] Keep all SQL driver types, schemas, migrations, and dialect handling inside plugin packages; core/domain continue to see only PatchPlane domain schemas and `StorageService`.
- [ ] If Convex remains the realtime projection layer, define an explicit projection/update path from durable SQL workflow writes into Convex-visible state.

Acceptance criteria:

- A SQL plugin can implement `StorageService.createWorkflowFromPrompt` and `StorageService.listRecentWorkflowStarts` without changing `packages/core`.
- PromptRequest + WorkflowRun creation remains atomic for providers with transactions.
- SQL plugin failures map to PatchPlane `StorageError`; raw SQL/driver errors do not cross into core.
- Convex can remain enabled for realtime UI even when durable workflow persistence is SQL-backed.

---

### M11 — Dogfood on GuerillaGlass

**Status:** Planned after M10 minimum loop

Tasks:

- [ ] Connect the GuerillaGlass repository through the GitHub plugin.
- [ ] Run at least three real issue/prompt workflows through PatchPlane.
- [ ] Capture friction in setup, sandbox lifecycle, event readability, review usefulness, and approval ergonomics.
- [ ] Convert dogfood findings into M10/M12 follow-up issues before broader launch.

Acceptance criteria:

- At least one real GuerillaGlass patch is generated, sandboxed, reviewed, approved, and published through the PatchPlane loop.
- The demo path is reproducible without manually editing database state.

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
- [ ] Treat every runtime-produced patch and artifact as untrusted until sandbox review and approval complete.
- [x] Convex SDK errors map into typed PatchPlane `StorageError` for foundation.
- [x] WorkOS SDK errors map into typed PatchPlane `AuthError` for authenticated foundation.
- [x] Public `workflowStarts:create` writes require WorkOS JWT validation, active mirrored membership, actor/workspace anti-spoofing, and `prompt:create`.
- [x] User-facing workflow starts are authorized by Convex with the caller's WorkOS JWT and mirrored permissions.
- [x] Convex reads require WorkOS AuthKit identity and mirrored active membership permissions.
- [ ] Use HMAC or equivalent request signing for any future non-user system ingestion boundary before production exposure.
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

Do not implement before the first pre-CI trust-boundary demo is complete:

- multiple sandbox providers beyond Daytona,
- multiple Git forges beyond GitHub,
- Origin-style internal forge behavior,
- semantic merge/conflict resolution,
- monetization or billing,
- broad plugin marketplace work,
- generalized enterprise policy editor.

---

## 7. Working Rule

When implementation and spec disagree:

1. check `/vendor` source first,
2. update `SPEC.md` if the architecture or product boundary changes,
3. update this `ROADMAP.md` if task order, acceptance criteria, or evidence changes,
4. keep SDK-specific knowledge inside plugins and app composition code, never in core.
