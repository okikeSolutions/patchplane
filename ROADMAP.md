# ROADMAP.md – PatchPlane Delivery Tracker

**Last Updated:** March 25, 2026  
**Current Phase:** Phase 0 — Technical validation

---

## 1. How To Use This File

`ROADMAP.md` is the mutable tracker for open, active, and completed delivery work.

Use [SPEC.md](./SPEC.md) for stable product direction.

### Status vocabulary

| Status      | Meaning                                                              |
| ----------- | -------------------------------------------------------------------- |
| `Completed` | Implemented in the repo and solid enough to use as a dependency.     |
| `Active`    | Started, with partial repo evidence, but not yet at the stated exit. |
| `Open`      | Accepted into the MVP plan but not started yet.                      |
| `Deferred`  | Intentionally outside the active MVP slice.                          |

### Update rules

- use stable task IDs in the form `FND-###` for completed foundations and `MVP-###` for MVP execution work,
- update `Evidence today` and `Done when` whenever a task changes status,
- only move a task to `Completed` when the repo contains the capability, not when the design is merely agreed,
- keep tasks in execution order unless there is a deliberate re-prioritization.

---

## 2. Completed Foundations

| ID        | Completed foundation                                                            | Evidence                                                                                                 |
| --------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `FND-001` | Bun monorepo scaffold with client, backend, and shared packages                 | `README.md`, `package.json`                                                                              |
| `FND-002` | Shared Effect-backed domain package for core status and event data              | `packages/domain/src/index.ts`, `packages/domain/src/workflow.ts`, `packages/domain/src/runtime.ts`      |
| `FND-003` | Initial Convex persistence for prompt requests, runtime events, and review runs | `packages/backend/convex/schema.ts`, `packages/backend/convex/requests.ts`                               |
| `FND-004` | WorkOS auth wiring and a protected Convex viewer query                          | `packages/backend/convex/auth.ts`, `packages/backend/convex/viewer.ts`, `apps/client/src/routes/app.tsx` |
| `FND-005` | Typed backend config plus review evaluation helper                              | `packages/backend/src/config/schema.ts`, `packages/backend/src/policy/evaluate.ts`                       |
| `FND-006` | Initial app shell for authenticated dashboard work                              | `apps/client/src/routes/app.tsx`                                                                         |

---

## 3. MVP Tasks

| ID        | Task                                                                                                                                                                     | Status   | Evidence today                                                                                                                                                           | Done when                                                                                                                                                                      |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `MVP-001` | Promote `packages/domain` into a real shared contracts package and move backend-local runtime and sandbox contracts into it                                              | `Active` | `packages/domain/src/index.ts`, `packages/domain/src/services.ts`, `packages/domain/src/runtime.ts`, `packages/domain/test/*.test.ts`, `packages/backend/src/github/webhookIngestor.ts` | Clients, Convex, adapters, and workers all depend on one shared contracts package, and backend-only contract duplication is removed                                            |
| `MVP-002` | Expand the shared `Effect` contract model to cover `WorkflowRun`, `RuntimeSession`, `MergeDecision`, `GitHubInstallation`, `RepositoryConnection`, and `WebhookDelivery` | `Active` | `packages/domain/src/workflow.ts`, `packages/domain/src/runtime.ts`, `packages/domain/src/github.ts`, `packages/domain/src/request-intake.ts`, `packages/domain/test/*.test.ts` | The shared package contains the full product model needed for orchestration, publication, and provenance                                                                       |
| `MVP-003` | Define shared `Effect` service boundaries for GitHub, runtime, sandbox, policy, artifacts, and interrupts                                                                | `Active` | `packages/domain/src/services.ts`, `packages/backend/src/github/layers.ts`, `packages/backend/src/github/octokit.ts`, `packages/backend/src/github/webhookIngestor.ts`, `packages/backend/src/policy/evaluate.ts` | `GitHubInstallationBroker`, `GitHubPublisher`, `RuntimeAdapter`, `SandboxAdapter`, `PolicyEvaluator`, `ArtifactStore`, and `InterruptController` exist behind shared contracts |
| `MVP-004` | Align Convex schema and function boundaries to shared contracts instead of duplicating shapes locally                                                                    | `Active` | `packages/backend/convex/contracts.ts`, `packages/backend/convex/schema.ts`, `packages/backend/convex/requests.ts`, `packages/backend/convex/github.ts`, `packages/backend/convex/githubWorker.ts` | Convex ingress and egress decode shared contracts at the boundary, and local shape duplication is removed                                                                      |
| `MVP-005` | Complete repository authority with GitHub App installation and verified webhook wiring                                                                                   | `Active` | `packages/backend/convex/http.ts`, `packages/backend/convex/githubHttp.ts`, `packages/backend/convex/github.ts`, `packages/backend/convex/githubWorker.ts`, `packages/backend/convex/crons.ts`, `packages/backend/src/github/octokit.ts`, `packages/backend/src/github/appRequirements.ts` | One repo can be connected through a GitHub App, webhook signatures are verified, and inbound GitHub events can create prompt requests                                          |
| `MVP-006` | Add durable Convex state for repositories, webhook deliveries, workflow runs, runtime sessions, publication records, approvals, and pending input                        | `Active` | `packages/backend/convex/schema.ts`, `packages/backend/convex/contracts.ts`, `packages/backend/convex/github.ts`, `packages/backend/convex/githubWorker.ts`               | The control plane has durable storage for the full request-to-publication lifecycle                                                                                            |
| `MVP-007` | Implement the Daytona execution adapter against the shared execution contract                                                                                            | `Open`   | Typed config already names `daytona` in `packages/backend/src/config/schema.ts`                                                                                          | PatchPlane can create and supervise one sandbox execution through the shared adapter boundary                                                                                  |
| `MVP-008` | Implement `PiRuntimeAdapter` against the shared runtime contract                                                                                                         | `Open`   | Typed config already names `pi-mono` in `packages/backend/src/config/schema.ts`                                                                                          | Pi Mono can run inside the sandbox and emit normalized runtime events through the adapter boundary                                                                             |
| `MVP-009` | Implement normalized runtime event ingestion plus one projector or snapshot path for dashboard state                                                                     | `Open`   | `packages/backend/convex/schema.ts` stores runtime events, but there is no ingestion pipeline or dashboard projector yet                                                 | Runtime events are normalized, persisted, and projected into a readable operator timeline                                                                                      |
| `MVP-010` | Implement GitHub feedback publication for comments, checks, and PR or draft PR updates                                                                                   | `Active` | `packages/domain/src/github.ts`, `packages/backend/src/github/octokit.ts`                                                                                                | PatchPlane can publish one end-to-end execution result back to GitHub                                                                                                          |
| `MVP-011` | Implement one reviewer pipeline and connect it to policy gating                                                                                                          | `Active` | Review storage exists in `packages/backend/convex/schema.ts`, and score evaluation exists in `packages/backend/src/policy/evaluate.ts`                                   | One reviewer job runs in the workflow, persists a structured result, and contributes to merge gating                                                                           |
| `MVP-012` | Expose dashboard visibility for live runs, approvals, and decisions                                                                                                      | `Active` | `apps/client/src/routes/app.tsx` provides an authenticated shell, but not live run supervision yet                                                                       | Operators can inspect runs, approvals, and merge decisions from the app without dropping to logs or code                                                                       |

---

## 4. Phase Gates

| Phase                             | Goal                                                                                                   | Tasks required for phase exit                                                                                                                                                                                                                      |
| --------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 0 — Technical validation    | Prove the shared contract model, repo authority model, and sandbox-plus-runtime path against one repo  | `MVP-001`, `MVP-002`, `MVP-003`, `MVP-004`, `MVP-005`, `MVP-006`, `MVP-007`, `MVP-008`                                                                                                                                                             |
| Phase 1 — MVP loop                | Close the operator loop from request intake to review to GitHub publication                            | `MVP-009`, `MVP-010`, `MVP-011`, `MVP-012`                                                                                                                                                                                                         |
| Phase 2 — Product differentiation | Start only after section 14 success criteria in [SPEC.md](./SPEC.md) are met and Phase 1 is complete   | policy templates, richer graph analytics, reviewer marketplaces or pluggable adapters, direct merge promotion and rollback after the PR-first loop is proven, git export or repo bridges, second runtime adapter, experimental conflict assistance |
| Phase 3 — Advanced autonomy       | Explicitly post-MVP work; keep it out of the active execution tracker until earlier phases are shipped | patch-lineage internalization beyond GitHub-only workflows, background improvement loops, contribution memory and replay, evolutionary prompt tuning, broader agent-to-agent interoperability, adaptive runtime routing                            |

### Phase-management rule

- do not add Phase 2 or Phase 3 items to the active tracker until the Phase 1 tasks are either `Completed` or explicitly re-scoped,
- if a future-phase item becomes immediate, add it here with a new task ID and explicit status before starting work.
