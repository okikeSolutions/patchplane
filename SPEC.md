# SPEC.md – PatchPlane – AI Change Control Plane

**Version:** 1.5  
**Date:** March 13, 2026  
**Status:** Finalized proposal incorporating runtime-boundary decisions, orchestration lessons, and the TypeScript + Effect implementation strategy

---

## 1. Executive Summary

**PatchPlane** is an open-source control plane for coordinating AI agents and humans around shared software changes.

The core thesis is not “replace Git everywhere,” and it is not “build a ticket workflow manager for coding agents.”

The product thesis is narrower and more credible:

1. provide a **live operational control plane** for agent-generated work,
2. support **concurrent proposal, review, and merge workflows** without forcing humans to manually manage branches and rebases for every agent action,
3. preserve **provenance, rollback, and human override** for every accepted change, and
4. separate **orchestration**, **runtime execution**, and **merge governance** into explicit architectural layers.

The MVP should focus on a narrow but credible loop:

**prompt request → sandboxed runtime execution → automated review → criteria check → transactional merge → real-time visibility across web and desktop**

This revision reflects eight deliberate decisions:

- the product is positioned as an **agent-native change control plane built on top of append-only patch and provenance models**, not as a magical semantic replacement for source control,
- **TypeScript** is the default implementation language across the platform,
- **Effect** is the preferred programming model for the control-plane core, typed configuration, runtime boundaries, and error handling,
- **WorkOS + Convex** is the default authentication stack,
- **Daytona** is the default sandbox execution layer,
- **TanStack Start** is the default web framework for MVP delivery, with explicit acknowledgement that it still carries release-candidate framework risk,
- **Pi Mono** is the default agent runtime for MVP, and
- PatchPlane adopts an explicit **runtime adapter boundary**, typed configuration, and normalized runtime event model inspired by practical orchestration lessons from systems like Symphony, while remaining a different product category.

---

## 2. Product Thesis

### 2.1 What PatchPlane is

PatchPlane is a **collaborative execution, review, and merge system for AI-generated changes**.

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

- Prompt request creation and submission
- Agent execution triggered via durable workflow
- External sandbox run for code execution and checks
- A first runtime adapter for Pi Mono
- Reviewer fan-out (for example `oxlint`, test, security, quality reviewers)
- Weighted score aggregation and policy checks
- Transactional merge of accepted patch sets
- Normalized runtime event ingestion into PatchPlane domain events
- Real-time dashboard for requests, runs, and graph events
- Desktop command center for live monitoring and interrupt or override
- Rollback using stored patch lineage and materialized snapshots
- Typed configuration for projects, runtimes, sandboxes, and policies
- A TypeScript-first shared domain package with Effect-powered schemas and service boundaries

### Explicitly out of scope

- Fully automatic semantic conflict resolution
- Open multi-tenant SaaS hardening
- Fine-grained enterprise RBAC and audit export
- Background evolutionary remixing of prior successful changes
- Full offline-first editing for source code
- Built-in model serving
- Mobile clients
- A generic issue tracker or project-management replacement

---

## 7. Core System Model

### 7.1 Primary primitives

#### Prompt Request

A user- or agent-created request containing:

- intent or prompt,
- target scope (repo, project, file set, artifact set),
- expected outcome,
- evaluation policy,
- optional implementation hints,
- initiator identity.

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
- accepted, rejected, conflict, or manual-review state,
- responsible workflow execution ID,
- rollback reference,
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
- runtime sessions,
- candidate patch sets,
- review runs,
- merge decisions,
- rollback operations.

The graph is the **lineage model**, not the merge algorithm.

### 7.2 Merge model for MVP

The MVP should use a **hybrid patch-based merge model**:

- source-of-truth artifacts are stored as **materialized state plus append-only patch history**,
- candidate changes are represented as **scoped patch sets**,
- **non-overlapping patch sets** can merge automatically if policy checks pass,
- **overlapping or ambiguous patch sets** do **not** attempt full semantic auto-resolution in MVP and instead transition to:
  - reject,
  - retry with narrower scope,
  - or manual arbitration.

This is less ambitious than “semantic conflict resolution,” but substantially more credible for MVP delivery.

### 7.3 Runtime boundary for MVP

The MVP must preserve three distinct layers:

1. **Orchestration layer**  
   Convex Workflow + Actions owns durable progression through request, review, and merge states.

2. **Execution layer**  
   Daytona owns sandbox lifecycle and execution isolation.

3. **Runtime layer**  
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
  Web Dashboard     Desktop Command Center
 (TanStack Start)      (Electrobun)
      |                 |
      +------ Convex Realtime Backend ------+
                     |
 [Requests / Runs / Policies / Graph / Auth]
                     |
          Convex Workflow + Actions
                     |
          PatchPlane Runtime Adapter API
                     |
           Sandbox Execution Adapter
                     |
                Daytona Sandboxes
                     |
                Pi Runtime Worker
                     |
   Reviewer Agents / Tests / Security / Analysis
```

### Lifecycle

1. Human or agent creates a prompt request.
2. Convex persists the request and starts a durable workflow.
3. Workflow selects runtime policy, sandbox policy, and evaluation policy.
4. Workflow dispatches one or more sandbox jobs through Daytona.
5. Inside the sandbox, PatchPlane invokes Pi Mono through a runtime adapter.
6. Runtime events are normalized into PatchPlane event types and streamed back into Convex.
7. Candidate patch sets and review outputs are materialized as structured artifacts.
8. Workflow aggregates weighted scores and evaluates policy.
9. If eligible and non-conflicting, the patch set is merged transactionally.
10. Merge event updates the graph and broadcasts instantly to all clients.
11. Human can interrupt, cancel, override, or force manual review at any stage.

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

## 9.3 Authentication

### **WorkOS + Convex**

Use WorkOS as the authentication and identity layer, integrated with Convex.

Why:

- Convex has first-class WorkOS AuthKit integration,
- WorkOS gives a clean path for passwords, social login, one-time codes, SSO, and organization-aware auth,
- the stack remains TypeScript-friendly end-to-end,
- it creates a better long-term path for B2B access control than shipping ad hoc auth first and reworking it later.

### MVP auth posture

For MVP, support:

- email and password or hosted auth,
- social sign-in if needed,
- organization-aware user model,
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

- `projects`
- `artifacts`
- `artifactSnapshots`
- `patchSets`
- `promptRequests`
- `workflowRuns`
- `runtimeAdapters`
- `runtimeSessions`
- `runtimeEvents`
- `reviewRuns`
- `mergePolicies`
- `policyBundles`
- `mergeDecisions`
- `configProfiles`
- `executionTargets`
- `graphNodes`
- `graphEdges`
- `interruptEvents`
- `rollbackEvents`
- `users`
- `organizations`
- `memberships`

### Notes

- `artifacts` store the current materialized state and metadata.
- `patchSets` store scoped candidate diffs plus generated artifacts.
- `artifactSnapshots` enable deterministic rollback and debugging.
- `runtimeSessions` store operational execution state but should not become the canonical source of merge truth.
- `runtimeEvents` are normalized event records for observability, replay, and debugging.
- `graphNodes` and `graphEdges` are derived lineage entities optimized for traceability and UI.
- auth-linked entities should map cleanly to WorkOS user and organization concepts.

---

## 13. Build-Ready Implementation Blueprint

### 13.1 Recommended repo structure

```text
/apps
  /web                 -> TanStack Start dashboard
  /desktop             -> Electrobun command center
/packages
  /backend
   /convex
      /schema.ts
      /auth.ts
      /queries
      /mutations
      /workflows
  /domain              -> Effect schemas, domain types, core contracts
  /config              -> typed config profiles and loaders
  /runtime-adapters
    /pi                -> Pi RuntimeAdapter implementation
  /execution
    /daytona           -> sandbox execution adapter
  /policy-engine       -> review aggregation and merge policy evaluation
  /graph               -> provenance graph builders and projections
  /ui                  -> shared UI components if needed
```

### 13.2 Core interface boundaries

Define these interfaces early and treat them as product boundaries:

- `RuntimeAdapter`
- `ExecutionAdapter`
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

### 13.5 First implementation order

Build in this order:

1. shared domain schemas and config validation,
2. Convex schema plus auth wiring,
3. Daytona execution adapter,
4. `PiRuntimeAdapter`,
5. normalized runtime event ingestion,
6. one reviewer pipeline,
7. weighted merge policy,
8. rollback and provenance projection,
9. dashboard and desktop visibility.

## 14. Success Criteria for MVP

The MVP is successful when all of the following are true:

1. A user can authenticate through WorkOS and access the dashboard.
2. A user can submit a prompt request from web or desktop.
3. The system can durably fan out work to Daytona sandboxes.
4. Pi Mono can run behind a PatchPlane runtime adapter with structured event capture.
5. Shared domain schemas and config profiles are validated through the TypeScript + Effect core without ad hoc runtime parsing.
6. At least three automated review types can return structured results.
7. Weighted merge policy can accept or reject a patch set automatically.
8. Accepted patch sets merge transactionally and update all connected clients in real time.
9. A human can interrupt, cancel, or force manual review during execution.
10. Every accepted change has end-to-end provenance and rollback reference.

---

## 15. Risks and Mitigations

| Risk                                                                                   | Likelihood | Impact | Mitigation                                                                                  |
| -------------------------------------------------------------------------------------- | ---------: | -----: | ------------------------------------------------------------------------------------------- |
| Merge semantics prove harder than expected                                             |       High |   High | Limit MVP to scoped patch sets and explicit conflict fallback                               |
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

### Phase 0 — Technical validation

- shared TypeScript domain package and Effect schemas
- Convex schema and realtime event model
- WorkOS authentication integration
- Daytona sandbox execution proof of concept
- PatchPlane runtime adapter contract
- Pi Mono proof of execution inside a Daytona sandbox
- one workflow that executes one sandbox job and returns one review result
- minimal graph lineage visualization
- typed config schema for runtime, sandbox, and policy defaults

### Phase 1 — MVP loop

- prompt request UI
- workflow fan-out to generation plus reviewers
- runtime event normalization and timeline view
- weighted policy evaluation
- transactional merge and rollback
- desktop monitoring shell

### Phase 2 — Product differentiation

- richer graph analytics
- policy templates
- reviewer marketplaces or pluggable adapters
- git export or repo bridges
- second runtime adapter to validate portability
- experimental conflict assistance and narrower semantic resolution

### Phase 3 — Advanced autonomy

- background improvement loops
- contribution memory and replay
- evolutionary prompt tuning
- broader agent-to-agent interoperability
- adaptive runtime routing across execution profiles

---

## 17. Recommendation

Proceed with **PatchPlane** as a focused internal MVP under the following constraints:

1. position it as an **AI change control plane**, not a universal Git replacement,
2. define merge behavior around **scoped patch sets plus explicit conflict fallback**,
3. use **Convex Workflow + Actions** as the default orchestrator,
4. use **WorkOS + Convex** for auth,
5. use **Daytona** as the default execution boundary,
6. use **Pi Mono** as the first runtime behind a replaceable adapter contract,
7. use **TypeScript** as the platform language and **Effect** as the preferred model for the control-plane core,
8. use **TanStack Start** for the dashboard while explicitly accepting RC-stage framework risk,
9. treat cost as **low-cost, not zero-cost**, and
10. validate with one team, one codebase, and one runtime before broadening the claim surface.

Under those assumptions, the concept remains credible and differentiated enough to justify MVP exploration, and the implementation strategy is now concrete enough to begin building without another major architecture pass.
