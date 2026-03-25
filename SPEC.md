# SPEC.md – PatchPlane – AI Change Control Plane

**Version:** 1.8  
**Date:** March 25, 2026  
**Status:** Stable MVP proposal with execution tracking delegated to [ROADMAP.md](./ROADMAP.md)

---

## 0. Execution Tracking

`SPEC.md` is the stable reference for product thesis, architecture, scope, and success criteria.

Day-to-day execution tracking now lives in [ROADMAP.md](./ROADMAP.md).

- update [ROADMAP.md](./ROADMAP.md) when task status, evidence, or execution order changes,
- update `SPEC.md` only when product scope, architecture, or MVP success criteria change.

---

## 1. Executive Summary

**PatchPlane** is an open-source control plane for coordinating AI agents and humans around shared software changes.

The core thesis is not “replace Git everywhere,” and it is not “build a ticket workflow manager for coding agents.”

The product thesis is narrower and more credible:

1. provide a **live operational control plane** for agent-generated work,
2. support **concurrent proposal, review, and merge workflows** without forcing humans to manually manage branches and rebases for every agent action,
3. preserve **provenance, rollback, and human override** for every accepted change, and
4. separate **orchestration**, **runtime execution**, and **merge governance** into explicit architectural layers.

The first buildable MVP should focus on a narrow but credible loop:

**GitHub issue, PR comment, or app prompt → Prompt Request in PatchPlane → Workflow Run → Daytona sandbox → Pi Mono runtime → normalized events → automated review → PatchPlane operator decision → GitHub feedback or PR publication**

This revision reflects nine deliberate decisions:

- the product is positioned as an **agent-native change control plane built on top of append-only patch and provenance models**, not as a magical semantic replacement for source control,
- **TypeScript** is the default implementation language across the platform,
- **Effect** is the preferred programming model for the control-plane core, typed configuration, runtime boundaries, and error handling,
- **WorkOS + Convex** is the default human identity stack,
- **GitHub App** is the default repository authority and compatibility layer for existing developer workflows,
- **Daytona** is the default sandbox execution layer,
- **TanStack Start** is the default web framework for MVP delivery, with explicit acknowledgement that it still carries release-candidate framework risk,
- **Pi Mono** is the default agent runtime for MVP, and
- PatchPlane adopts an explicit **runtime adapter boundary**, typed configuration, and normalized runtime event model inspired by practical orchestration lessons from systems like Symphony, while remaining a different product category.

---

## 2. Product Thesis

### 2.1 What PatchPlane is

PatchPlane is a **collaborative execution, review, and merge system for AI-generated changes**.

Its adoption wedge is **GitHub compatibility without GitHub dependence**:

- GitHub remains the repository, community, and contribution surface teams already use,
- PatchPlane becomes the primary hub for agent orchestration, execution, supervision, and policy,
- over time, PatchPlane can internalize more patch-governance and rollback behavior without requiring teams to abandon GitHub on day one.

It is designed for teams that want:

- multiple agents proposing changes in parallel,
- automated evaluation before merge,
- a live shared view of what each agent is doing,
- an immediate human interrupt or override path,
- provenance for who proposed what, why it passed, and how to roll it back, and
- a clean separation between the system that **coordinates work** and the runtime that **executes agent turns**.

### 2.2 What PatchPlane is not

For the MVP, PatchPlane is **not**:

- a universal Git replacement,
- a thin GitHub bot or PR-comment wrapper,
- a full semantic conflict-resolution engine,
- a ticket workflow manager in the style of Linear-first agent systems,
- an open multi-tenant enterprise platform,
- a hosted LLM platform,
- a fully offline local-first code editor.

The MVP should instead be positioned as an **agent collaboration control plane with deterministic patch workflows, explicit runtime boundaries, and graph-based provenance**.

---

## 3. Why Now

The timing is credible, but the opportunity should be framed carefully.

- AI coding agents are rapidly increasing the volume of machine-generated code and candidate changes.
- The operational bottleneck is shifting from generation alone toward **review, trust, policy enforcement, merge safety, and rollback**.
- Interoperability is improving through tool protocols, runtime APIs, and pluggable model layers, increasing the value of orchestration, governance, and observability layers.
- Teams increasingly need a durable system that can coordinate agent work while keeping the execution runtime replaceable.

**Implication:** the market pull is real, but a strong MVP must emphasize **governance, reliability, observability, runtime isolation, and merge safety**, not just autonomy.

---

## 4. Problem Statement

### 4.1 The operational problem

Existing coding-agent workflows increase generation speed, but they still leave teams with five hard problems:

1. **Concurrency:** multiple agents can propose overlapping changes at once.
2. **Evaluation:** teams need repeatable checks before accepting agent output.
3. **Coordination:** humans need live visibility and interrupt capability.
4. **Provenance:** teams need to know what changed, why it changed, what passed, and how to revert.
5. **Runtime coupling:** many systems blur the boundary between workflow orchestration and runtime execution, making later portability and governance harder.

### 4.2 What current tools already do

Current frameworks and platforms already cover parts of the stack:

- agent frameworks and orchestration systems can run multi-step workflows,
- coding assistants can generate and apply patches,
- repo-centric tools can review and merge changes,
- sandbox vendors can isolate code execution,
- agent runtimes can manage sessions, tool calls, and iterative turns.

### 4.3 The gap PatchPlane targets

The opportunity is not that “nothing exists.” The opportunity is that there is still room for a product that combines:

- **agent-native proposal workflows**,
- **durable automated review**,
- **live shared operational state**,
- **graph provenance**,
- **human-governed merge policy**, and
- **runtime-agnostic orchestration**

in a single developer-facing product.

---

## 5. Product Principles for MVP

1. **Human-governed, agent-accelerated**  
   Agents can propose and review; humans define criteria and can interrupt at any step.

2. **Deterministic before autonomous**  
   Use explicit checks, patch logs, and merge gates before attempting advanced semantic autonomy.

3. **Real-time by default**  
   Every request, run, review, and merge should update across connected clients immediately.

4. **Sandbox everything untrusted**  
   Generated code, tool execution, and reviewer actions run outside the main control plane.

5. **Runtime is replaceable**  
   The orchestrator must not depend on one specific agent runtime. Runtime integrations should sit behind a narrow adapter interface.

6. **Graph for provenance, not magic**  
   The graph explains lineage and decision history; it does not replace rigorous merge semantics by itself.

7. **Policy is explicit and serializable**  
   Approval, sandbox, evaluation, and merge criteria must be attached to runs as auditable artifacts, not hidden in ad hoc business logic.

8. **Types at the boundary, effects in the core**  
   Runtime inputs, config, events, and policy payloads should be decoded explicitly, while long-running orchestration, retries, cancellation, and resource handling should be modeled in a consistent effect system.

---

## 6. MVP Scope

### In scope

- WorkOS sign-in and organization-aware human identity
- GitHub App installation, repository authorization, and webhook ingestion
- Prompt request creation from the app UI or verified GitHub events
- Durable `PromptRequest -> WorkflowRun -> RuntimeSession` execution flow
- External sandbox run for code execution and checks
- A first runtime adapter for Pi Mono
- GitHub-aware repo checkout and scoped execution target selection
- Normalized runtime event ingestion into PatchPlane domain events
- GitHub feedback publication through comments, checks, and PR or draft PR creation
- Reviewer fan-out (for example `oxlint`, test, security, quality reviewers)
- Weighted score aggregation and policy checks
- Real-time dashboard for requests, runs, approvals, and decisions
- Human interrupt, approval, and redirect paths from the dashboard
- Typed configuration for projects, runtimes, sandboxes, and policies
- A TypeScript-first shared domain package with Effect-powered schemas and service boundaries

### Explicitly out of scope

- Fully automatic semantic conflict resolution
- Broad transactional auto-merge across overlapping patch sets in the first vertical slice
- Full rollback using stored materialized snapshots in the first vertical slice
- Open multi-tenant SaaS hardening
- Fine-grained enterprise RBAC and audit export
- Background evolutionary remixing of prior successful changes
- Full offline-first editing for source code
- Deep desktop-native feature work beyond a thin shell
- Built-in model serving
- Mobile clients
- A generic issue tracker or project-management replacement

---

## 7. Core System Model

### 7.1 Primary primitives

#### Prompt Request

A user- or agent-created request containing:

- intent or prompt,
- source channel (app, issue, PR, issue comment, PR comment, automation),
- target scope (repo, project, file set, artifact set),
- expected outcome,
- evaluation policy,
- optional implementation hints,
- initiator identity.

#### GitHub Repository Connection

The durable repository authority record containing:

- GitHub App installation identity,
- repository identity and permissions,
- webhook routing metadata,
- checkout or execution defaults,
- bindings to issues, PRs, and prompt-request sources.

This boundary determines what PatchPlane is allowed to observe and mutate in GitHub.

#### Workflow Run

The durable orchestration record for one execution attempt containing:

- prompt-request reference,
- repository connection reference,
- selected execution target,
- selected runtime and sandbox profile,
- current lifecycle state,
- GitHub callback targets,
- policy bundle reference.

Workflow runs are **control-plane truth** for execution attempts.

#### Runtime Session

The operational container for one agent execution context:

- runtime adapter identifier,
- sandbox identifier,
- workspace root,
- approval policy,
- sandbox policy,
- timeout budget,
- current status,
- resumability metadata.

Runtime sessions are **execution state**, not product truth.

#### Candidate Patch Set

The concrete output proposed by an agent run:

- changed files or structured artifacts,
- generated code or content,
- metadata about tools used,
- tests run,
- dependency changes,
- machine-readable diff summary,
- runtime session reference.

#### Review Run

A sandboxed evaluation result produced by a reviewer or tool:

- pass or fail,
- numeric score,
- comments,
- structured findings,
- execution logs,
- artifact references.

#### Merge Decision

A durable system decision containing:

- final weighted score,
- criteria evaluation result,
- draft-pr, ready-for-review, accepted, rejected, conflict, or manual-review state,
- responsible workflow execution ID,
- related GitHub issue or PR reference,
- policy bundle reference.

#### Runtime Event

A normalized operational event derived from a runtime adapter, for example:

- session started,
- turn started,
- tool call requested,
- approval required,
- artifact emitted,
- turn completed,
- turn failed,
- session terminated.

Runtime events are stored for observability and debugging, but are not the same thing as business-level merge decisions.

#### Symbiosis Graph

An append-only provenance graph that links:

- prompt requests,
- workflow runs,
- GitHub repository connections,
- runtime sessions,
- candidate patch sets,
- review runs,
- merge decisions,
- rollback operations.

The graph is the **lineage model**, not the merge algorithm.

### 7.2 GitHub compatibility model for MVP

The first end-to-end MVP slice should use a **PatchPlane-primary, GitHub-compatible model**:

- PatchPlane is the system of record for prompt requests, workflow runs, runtime sessions, approvals, reviews, and decisions,
- candidate changes are materialized as git commits and branches inside the sandboxed repo workspace,
- GitHub remains the initial repository and contribution surface for issues, PRs, comments, checks, and open-source collaboration,
- accepted outputs are published back to GitHub as comments, checks, and PR or draft PR updates,
- human review remains the default merge authority for the first vertical slice,
- direct transactional auto-merge and PatchPlane-owned rollback are follow-on steps after the GitHub-compatible loop is proven,
- overlapping or ambiguous changes should fall back to PR-based human arbitration, not semantic auto-resolution.

The long-term product may internalize more patch lineage, rollback, and merge governance, but it should reach that state by **gradual migration from existing GitHub workflows**, not by demanding a workflow reset up front.

### 7.3 Runtime boundary for MVP

The MVP must preserve five distinct layers:

1. **Base collaboration layer**  
   GitHub remains the initial repository and community workflow surface.

2. **Identity and repository authority layer**  
   WorkOS + Convex owns human identity, while the GitHub App owns repo installation scope, webhook ingress, and outbound repository mutations.

3. **Orchestration layer**  
   PatchPlane owns durable progression through request, review, approval, and decision states.

4. **Execution layer**  
   PatchPlane dispatches and supervises sandbox lifecycle through Daytona.

5. **Runtime layer**  
   Pi Mono owns agent-session execution inside the sandbox through a PatchPlane runtime adapter.

PatchPlane’s domain model must sit **above** the runtime, not be defined by it.

### 7.4 Optional local-first enhancement

For non-code structured documents or metadata-heavy collaborative surfaces, PatchPlane may later adopt CRDT-based collaboration.

For code artifacts in MVP, stick to **transactional patch application**, not CRDT-based source merging.

---

## 8. High-Level Architecture

```text
[Human User / Steering / Override]
               |
      +--------+--------+
      |                 |
  Web Dashboard      Thin Desktop Shell
 (TanStack Start)      (Electrobun)
      |                 |
      +------ Convex Realtime Backend ------+
                     |
 [Requests / Runs / Policies / Decisions / Auth]
                     |
       PatchPlane Orchestration Layer
                     |
      GitHub App <-> Compatibility / Webhook Layer
                     |
           PatchPlane Runtime Adapter API
                     |
                Daytona Sandboxes
                     |
                Pi Mono Runtime
                     |
   Reviewer Agents / Tests / Security / Analysis
                     |
   GitHub repos / issues / PRs / comments / checks
```

### Lifecycle

1. A human signs in through WorkOS and connects a repository through a GitHub App installation.
2. A GitHub issue, PR comment, issue comment, or app prompt becomes a Prompt Request inside PatchPlane.
3. PatchPlane persists the request and starts a durable workflow run.
4. The workflow resolves repository authority, runtime policy, sandbox policy, and evaluation policy.
5. PatchPlane dispatches one or more sandbox jobs through Daytona.
6. Inside the sandbox, PatchPlane checks out the authorized repo and invokes Pi Mono through a runtime adapter.
7. Runtime events are normalized into PatchPlane event types and streamed back into PatchPlane state.
8. Reviewer outputs, approvals, and decision signals are attached to the workflow run.
9. Operators supervise, interrupt, redirect, or approve from PatchPlane.
10. PatchPlane publishes comments, checks, and PR or draft PR updates back to GitHub as needed.
11. Later phases may internalize more patch-governance and rollback behavior while preserving GitHub interoperability where useful.

---

## 9. Final Technology Choices

## 9.1 Language and programming model

### **TypeScript** as the default implementation language

Use TypeScript across the web app, desktop shell, Convex functions, shared domain packages, Daytona integration, and runtime adapters.

Why:

- it aligns with Convex, TanStack Start, Electrobun, and Daytona,
- it enables end-to-end type sharing across control plane and clients,
- it reduces integration friction across the chosen MVP stack,
- it keeps the open-source contributor experience accessible.

### **Effect** as the preferred control-plane programming model

Use Effect deliberately where PatchPlane’s correctness burden is highest.

Use Effect for:

- shared domain schemas and boundary decoding,
- runtime adapter contracts and external service wrappers,
- orchestration helpers around retries, cancellation, timeout budgets, and resource lifecycles,
- policy evaluation pipelines,
- normalized runtime event ingestion,
- typed error channels for execution, review, and merge decisions.

Do **not** require Effect everywhere in v0.1.

Use plain TypeScript for:

- presentational React components,
- simple UI view models,
- straightforward Convex query and mutation surfaces,
- small utility modules that do not benefit from Effect’s runtime model.

### Implementation rule

PatchPlane should be built as a **TypeScript platform with an Effect-powered control-plane core**, rather than as an “Effect everywhere” codebase.

## 9.2 Backend and sync

### **Convex**

Use Convex as the shared backend for:

- realtime subscriptions,
- durable state,
- actions,
- workflows,
- file references,
- graph lineage storage,
- configuration profiles,
- runtime event ingestion,
- optional vector or RAG capabilities later.

### Recommendation

Keep Convex as the backbone for MVP.

## 9.3 Identity and repository authority

### **WorkOS + Convex** for human identity

Use WorkOS as the human authentication and identity layer, integrated with Convex.

Why:

- Convex has first-class WorkOS AuthKit integration,
- WorkOS gives a clean path for passwords, social login, one-time codes, SSO, and organization-aware auth,
- the stack remains TypeScript-friendly end-to-end,
- it creates a better long-term path for B2B access control than shipping ad hoc auth first and reworking it later.

### **GitHub App** for repository authority and GitHub compatibility

Use a GitHub App as the default repository authority primitive and compatibility layer.

Why:

- GitHub App installations are the correct unit for repo-scoped authorization,
- GitHub Apps support webhook delivery, installation-level permissions, and outbound mutations,
- they provide a cleaner path for issue, PR, check, and comment workflows than plain GitHub OAuth alone,
- they separate human identity from repository authority, which matches PatchPlane’s control-plane design.

GitHub OAuth may still be used as a convenience for linking a user’s GitHub identity, but it should not be the sole repo-access primitive for MVP.

GitHub is the **initial base layer for interoperability**, not the long-term system of record for agent orchestration.

### MVP auth posture

For MVP, support:

- hosted human auth through WorkOS,
- organization-aware user model,
- GitHub App installation on selected repositories,
- verified webhook delivery handling,
- basic role distinction between admin, reviewer, and viewer.

Do **not** try to fully solve enterprise RBAC in v0.1.

## 9.4 Configuration model

### **Typed configuration as a first-class product surface**

PatchPlane should not rely on scattered environment variables as its primary configuration model.

Use typed configuration objects for:

- runtime adapters,
- sandbox backends,
- workspace rules,
- policy bundles,
- merge rules,
- observability settings,
- execution targets,
- project-level defaults.

### Why

- it makes orchestration behavior explicit and auditable,
- it reduces hidden coupling between runtime and product logic,
- it improves portability across future runtimes,
- it supports safer internal and team-level rollout.

## 9.5 Workflow and orchestration

### **Convex Workflow + Actions** as the default orchestrator

Use Convex Workflow for the durable execution layer and standard actions for external calls.

Why:

- durable retries and resumability,
- simpler operational model than introducing a second orchestration runtime into the critical path,
- strong fit for request → review → merge workflows,
- keeps product orchestration independent from the runtime implementation.

## 9.6 Sandbox execution

### **Daytona** as preferred execution layer

Use Daytona as the default sandbox execution provider.

Why:

- purpose-built for running AI-generated code,
- programmatic sandbox lifecycle through SDKs and API,
- TypeScript support,
- interactive capabilities beyond raw code execution, including file access, process execution, terminal sessions, and runtime control,
- lower MVP complexity than self-hosting a custom sandbox stack from day one.

### MVP usage model

- one sandbox per generation or review task,
- short-lived runtime by default,
- explicit timeout and resource limits,
- network restrictions where supported and required,
- logs and artifacts streamed back into Convex.

### Cost posture

Daytona is suitable for MVP delivery, but it should be treated as **low-cost**, not “free forever.”

## 9.7 Agent runtime

### **Pi Mono** as the default runtime for MVP

Use Pi Mono as the first agent runtime executed inside Daytona sandboxes.

Why:

- it provides a practical coding-agent runtime with tool usage and iterative execution,
- it can be embedded behind a narrow runtime boundary,
- it fits the goal of keeping PatchPlane runtime-agnostic at the orchestration layer,
- it is a better fit for an open-source-first MVP than tightly coupling the control plane to a proprietary runtime contract.

### Architectural note

Pi Mono is the **runtime**, not the **orchestrator**.

PatchPlane should define a runtime adapter contract with operations such as:

- start session,
- run turn,
- stream events,
- request approval,
- collect artifacts,
- terminate session.

Future runtimes should be swappable without redefining the PatchPlane product model.

## 9.8 Web dashboard

### **TanStack Start** as the default web framework for MVP

Use TanStack Start as the default web framework for the dashboard.

Why:

- React-first developer experience aligned with the rest of the stack,
- strong fit with TanStack Router, Query, and modern type-safe data patterns,
- good match for a highly interactive dashboard with SSR, streaming, and server functions,
- consistent with a TypeScript-heavy codebase and team preference.

### Risk note

TanStack Start should still be acknowledged as a **Release Candidate-stage framework** rather than fully mature 1.0. For this MVP, that risk is accepted intentionally in exchange for stack alignment and delivery preference.

## 9.9 Desktop app

### **Electrobun**

Keep Electrobun for the local command center.

This remains a strong fit for a TypeScript-first desktop shell with native bindings, native webview rendering, and cross-platform support.

## 9.10 Editor

### **Monaco Editor**

Use Monaco for embedded editing and diff inspection.

Monaco provides the editor core that powers VS Code, which is sufficient for MVP editing, inspection, and patch review.

## 9.11 Graph visualization

Use either:

- **React Flow** for workflow and interaction-oriented views, or
- **Cytoscape.js** for denser graph exploration.

Prefer React Flow for MVP unless graph scale quickly exceeds UI comfort limits.

---

## 10. Deployment and Cost Reality

The earlier “$0 ongoing” claim should remain removed.

### What is realistic

- **Local prototype:** close to zero marginal infra cost if using existing hardware and free tiers.
- **Shared internal MVP:** low cost, but not guaranteed zero.
- **Commercial or public prototype:** definitely non-zero.

### Why the original claim was too strong

- shared or commercial deployment introduces real hosting constraints,
- Convex free usage has explicit limits,
- Daytona usage is metered even if free credits make early iteration inexpensive,
- domains and production-like environments are not free,
- runtime execution costs and evaluation fan-out can compound faster than expected.

### Revised statement

**Target cost posture for MVP:** low-cost prototype using free tiers and credits where appropriate, but with the expectation of paid hosting for any shared or production-like deployment.

---

## 11. Security Model

### 11.1 Trust boundaries

#### Trusted control plane

- Convex backend
- workflow state
- policy definitions
- merge decisions
- user identity and permissions via WorkOS
- GitHub App private key material and installation-token broker
- verified webhook delivery state
- configuration profiles

#### Semi-trusted clients

- web dashboard
- desktop command center

#### Untrusted execution plane

- generated code
- agent tool calls
- reviewer agents
- third-party CLI invocations
- runtime output
- sandbox runtime output

### 11.2 Security rules for MVP

- Run all generated code outside the control plane.
- Default sandbox jobs to restricted network access where possible.
- Do not expose long-lived production credentials to sandbox runs.
- Verify GitHub webhook signatures and deduplicate webhook deliveries.
- Do not expose GitHub App private keys or long-lived installation credentials to sandbox runs.
- Mint the narrowest possible repo-scoped credentials for sandbox checkout and outbound publication.
- Store logs and artifacts separately from privileged secrets.
- Make manual override and kill-switch available from UI.
- Treat agent-generated dependency changes as high-risk and separately reviewable.
- Validate workspaces, paths, and execution targets before runtime start.
- Make approval policy explicit per runtime session.

### 11.3 Non-interactive execution posture

The MVP should assume that not every run has a human actively watching.

For each execution profile, define explicit behavior for:

- auto-approve under bounded policy,
- escalate to human review,
- fail closed,
- defer and resume,
- terminate the session.

### 11.4 Security posture statement

The MVP is suitable for **single-team internal usage first**. It is **not yet suitable for open multi-tenant SaaS** without additional hardening, tenancy controls, formal sandbox governance, and stronger runtime isolation guarantees.

---

## 12. Data Model (MVP)

### Core tables or entities

- `users`
- `organizations`
- `memberships`
- `githubAccounts`
- `githubInstallations`
- `repositories`
- `webhookDeliveries`
- `promptRequests`
- `workflowRuns`
- `runtimeSessions`
- `runtimeEvents`
- `reviewRuns`
- `mergeDecisions`
- `issueBindings`
- `pullRequestBindings`
- `policyBundles`
- `configProfiles`
- `executionTargets`
- `pendingApprovals`
- `pendingInputs`

### Notes

- `githubInstallations` and `repositories` define what PatchPlane is authorized to observe and mutate while GitHub remains the base collaboration layer.
- `webhookDeliveries` provide idempotency, replay diagnostics, and signature-verification auditability.
- `issueBindings` and `pullRequestBindings` connect product-level prompt requests to GitHub-native workflow surfaces.
- `workflowRuns` are the durable orchestration unit for one execution attempt.
- `runtimeSessions` store operational execution state but should not become the canonical source of merge truth.
- `runtimeEvents` are normalized event records for observability, replay, and debugging.
- `pendingApprovals` and `pendingInputs` capture blocking runtime state in a durable form.
- richer artifact stores, rollback snapshots, and graph lineage tables can follow after the first GitHub-connected slice proves out.
- auth-linked entities should map cleanly to WorkOS user and organization concepts.

---

## 13. Build-Ready Implementation Blueprint

### 13.1 Current repo structure

```text
/apps
  /client              -> single TanStack Start app for landing, product shell, and architecture pages
    /src
      /components      -> app chrome, theme controls, and local UI primitives
      /lib             -> client-side helpers
      /platform        -> browser-first desktop bridge boundary
      /routes          -> file-based routes for `/`, `/app`, and `/about`
    /public            -> static assets
/packages
  /backend
    /convex
      /schema.ts       -> current Convex tables for prompt requests, runtime events, and review runs
      /requests.ts     -> prompt request create/list surfaces
    /src
      /config          -> typed backend configuration schema and live layer
      /graph           -> lineage projection helpers
      /policy          -> review evaluation logic
      /runtime         -> runtime adapter contract
      /sandbox         -> sandbox adapter contract
      /errors.ts       -> typed execution and review failures
  /domain              -> shared Effect schemas, status labels, event types, review models, and product capability copy
  /typescript-config   -> shared TypeScript baseline package
/README.md             -> workspace overview and local commands
/SPEC.md               -> product and implementation spec
/package.json          -> Bun workspace scripts
```

### 13.1.1 Structure notes

- The repo currently has one app, `apps/client`; there is no separate `/web` and `/desktop` split yet.
- The future desktop shell is only represented by a thin `DesktopBridge` interface in `apps/client/src/platform/bridge.ts`.
- Runtime, sandbox, policy, and graph concerns already exist, but they are internal modules under `packages/backend/src` rather than separate workspace packages.
- Shared UI is local to `apps/client` today; there is no top-level `/ui` package yet.
- GitHub App integration, workflow orchestration, and concrete Daytona or Pi Mono implementations are not present in the repo structure yet.

### 13.2 Core interface boundaries

Define these interfaces early and treat them as product boundaries:

- `RuntimeAdapter`
- `ExecutionAdapter`
- `GitHubInstallationBroker`
- `WebhookIngestor`
- `PolicyEvaluator`
- `ArtifactStore`
- `GraphProjector`
- `InterruptController`

### 13.3 TypeScript baseline

Use a strict TypeScript posture from day one:

- `strict: true`
- `noUncheckedIndexedAccess: true`
- `exactOptionalPropertyTypes: true`
- `noImplicitOverride: true`
- `useUnknownInCatchVariables: true`

For JavaScript and TypeScript code-quality tooling, PatchPlane should standardize on `oxlint` for linting and `oxfmt` for formatting instead of ESLint and Prettier.

### 13.4 Effect usage guidance

Use `effect/Schema` or equivalent typed Effect modules for:

- prompt request decoding,
- verified GitHub webhook payload decoding,
- runtime event normalization,
- config profile validation,
- review-run payload validation,
- merge-decision serialization.

Use Effect services for:

- Daytona client access,
- Pi runtime process/session control,
- policy evaluation side effects,
- structured logging and telemetry,
- cancellation and timeout coordination.

### 13.5 Implementation summary

The canonical execution tracker lives in [ROADMAP.md](./ROADMAP.md).

The stable build sequence remains:

1. promote shared contracts and remove backend-only contract duplication,
2. finish repository authority and durable lifecycle state,
3. prove the Daytona plus Pi runtime path,
4. close the loop on runtime ingestion, review, and GitHub publication, and
5. expose live operator visibility in the dashboard.

## 14. Success Criteria for MVP

The MVP is successful when all of the following are true:

1. A user can authenticate through WorkOS and access the dashboard.
2. A user can connect a GitHub repository through a GitHub App installation.
3. A verified GitHub webhook or app prompt can create a durable Prompt Request.
4. The system can durably fan out work to Daytona sandboxes.
5. Pi Mono can run behind a PatchPlane runtime adapter with structured event capture.
6. Shared domain schemas and config profiles are validated through the TypeScript + Effect core without ad hoc runtime parsing.
7. At least one reviewer pipeline can return structured results.
8. PatchPlane can publish comments, checks, and PR or draft PR updates back to GitHub.
9. A human can interrupt, cancel, or force manual review during execution.
10. One team can run the full loop against one repository end to end.

---

## 15. Risks and Mitigations

| Risk                                                                                   | Likelihood | Impact | Mitigation                                                                                  |
| -------------------------------------------------------------------------------------- | ---------: | -----: | ------------------------------------------------------------------------------------------- |
| GitHub App installation, webhook, and repo-authority flows prove more complex than expected |     Medium |   High | Start with one repo, one installation, one event source, and one outbound publication path  |
| Daytona integration becomes the main engineering sink                                  |     Medium |   High | Start with a narrow runtime profile and one language target                                 |
| Pi runtime integration leaks too much runtime-specific behavior into the product model |     Medium |   High | Enforce a strict runtime adapter contract and normalize events early                        |
| TanStack Start RC issues affect delivery                                               |     Medium | Medium | Keep architecture modular and maintain an escape hatch to a more mature React SSR stack     |
| Realtime graph UI becomes noisy or unreadable                                          |     Medium | Medium | Separate operational timeline view from graph lineage view                                  |
| Convex limits are hit under fan-out workflows                                          |     Medium | Medium | Keep heavy compute in sandboxes and keep Convex as the control plane                        |
| Desktop shell adds maintenance overhead                                                |     Medium | Medium | Keep desktop features minimal in v0.1                                                       |
| Teams reject “Git-free” positioning                                                    |     Medium | Medium | Reframe as “agent-native collaboration layer” and provide export or snapshot bridges        |
| Configuration model becomes too complex too early                                      |     Medium | Medium | Start with typed minimal profiles and add hierarchy only when needed                        |
| Effect adoption slows delivery or fragments style                                      |     Medium | Medium | Constrain Effect to the control-plane core and document where plain TypeScript is preferred |
| Security assumptions are misunderstood                                                 |     Medium |   High | Publish explicit trust-boundary and secret-handling rules                                   |

---

## 16. Roadmap Recommendation

Detailed task tracking lives in [ROADMAP.md](./ROADMAP.md).

The stable phase model is:

| Phase | Goal |
| ----- | ---- |
| Phase 0 — Technical validation | Prove the shared contract model, repo authority model, and sandbox-plus-runtime path against one repository. |
| Phase 1 — MVP loop | Close the operator loop from request intake to review to GitHub publication. |
| Phase 2 — Product differentiation | Add product leverage only after the MVP loop and section 14 success criteria are complete. |
| Phase 3 — Advanced autonomy | Treat autonomy-heavy work as explicitly post-MVP. |

---

## 17. Recommendation

Proceed with **PatchPlane** as a focused internal MVP under the following constraints:

1. position it as an **AI change control plane**, not a universal Git replacement,
2. define the first delivery slice around **PatchPlane-primary orchestration and execution with GitHub-compatible intake and publication**,
3. use **Convex Workflow + Actions** as the default orchestrator,
4. use **WorkOS + Convex** for human identity,
5. use a **GitHub App** for repository authority and compatibility with existing workflows,
6. use **Daytona** as the default execution boundary,
7. use **Pi Mono** as the first runtime behind a replaceable adapter contract,
8. use **TypeScript** as the platform language and **Effect** as the preferred model for the control-plane core,
9. use **TanStack Start** for the dashboard while explicitly accepting RC-stage framework risk,
10. treat cost as **low-cost, not zero-cost**, and
11. validate with one team, one codebase, one GitHub installation, and one runtime before broadening the claim surface, and
12. treat GitHub as the initial base layer rather than the long-term center of gravity for the product.

Under those assumptions, the concept remains credible and differentiated enough to justify MVP exploration, and the implementation strategy is now concrete enough to begin building without another major architecture pass.
