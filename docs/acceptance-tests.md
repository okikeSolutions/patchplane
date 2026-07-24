# M0-M10 acceptance-test traceability

This matrix is the source of truth for claims that an alpha milestone is tested.

Status meanings:

- `Automated`: runs in the non-credentialed PR CI or `bun run verify`.
- `Live`: repeatable script using real provider credentials.
- `Historical`: manually verified previously, but not continuously repeatable in the default suite.
- `Missing`: implementation or repeatable verification is still required.

## Verification commands

| Scope                           | Command                                                                                                   |
| ------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Complete non-live gate          | `bun run verify`                                                                                          |
| Daytona/Pi RPC runtime          | `bun run smoke:daytona-rpc`                                                                               |
| Authenticated Convex foundation | `bun --env-file=.env.local run smoke:foundation`                                                          |
| Full product trust loop         | `bun --env-file=.env.local run smoke:trust-loop` (required)                                               |
| Post-decision verification      | `PATCHPLANE_SMOKE_WORKFLOW_RUN_ID=<id> bun run smoke:trust-loop`                                          |
| Publication replay              | `PATCHPLANE_SMOKE_WORKFLOW_RUN_ID=<id> PATCHPLANE_SMOKE_REPLAY_PUBLICATION=true bun run smoke:trust-loop` |
| Deployed Convex sandbox path    | `bun run smoke:convex-sandbox`                                                                            |
| AuthKit/GitHub browser helper   | `PATCHPLANE_LIVE_BROWSER_TEST=true bun run smoke:browser`                                                 |
| Roadmap/acceptance consistency  | `bun run check:roadmap-acceptance`                                                                        |
| Live Cloudflare provisioning    | `PATCHPLANE_LIVE_INFRA_TEST=true bun run test:infra` (required)                                           |

Follow the [M10 acceptance runbook](./m10-acceptance-runbook.md) for the exact
review-ready run, authenticated human-decision pause, publication replay,
diagnosis, and cleanup procedure.

## M0-M3: architecture and core contracts

| Milestone | Acceptance criterion                                                  | Evidence                                             | Status    |
| --------- | --------------------------------------------------------------------- | ---------------------------------------------------- | --------- |
| M0        | Required domain/core/plugin/client/backend structure exists           | `tests/architecture/architecture-boundaries.test.ts` | Automated |
| M0        | Core imports only PatchPlane domain/core dependencies and Effect      | architecture boundary suite                          | Automated |
| M0        | Vendor research does not leak into runtime imports                    | architecture boundary suite                          | Automated |
| M1        | `bun install` succeeds                                                | frozen lockfile install in PR CI                     | Automated |
| M1        | Root typecheck reaches all packages                                   | `bun run typecheck`                                  | Automated |
| M1        | Core does not import app/plugin/vendor SDKs                           | architecture boundary suite                          | Automated |
| M2        | Domain schemas decode unknown input                                   | domain schema tests                                  | Automated |
| M2        | External/plugin input has a decode path                               | domain, GitHub, WorkOS, and Convex adapter tests     | Automated |
| M2        | Typed errors remain PatchPlane-owned                                  | core/plugin error tests plus architecture boundaries | Automated |
| M3        | Core workflows depend on services rather than SDKs                    | core workflow and architecture tests                 | Automated |
| M3        | Boundary failures map to typed PatchPlane errors                      | core and plugin tests                                | Automated |
| M3        | Timeline/event persistence is represented by PatchPlane-owned schemas | decision/review and backend tests                    | Automated |

## M4-M6.5: Convex, application composition, and authorization

| Milestone | Acceptance criterion                                                    | Evidence                                                  | Status     |
| --------- | ----------------------------------------------------------------------- | --------------------------------------------------------- | ---------- |
| M4        | Convex backend remains isolated                                         | architecture boundary suite                               | Automated  |
| M4        | Public reads and external-ingestion mutation exist                      | backend Convex tests                                      | Automated  |
| M4        | Convex is the realtime read model and orchestration boundary            | architecture and backend tests                            | Automated  |
| M5        | Foundation and external-intake records persist through `StorageService` | adapter unit coverage plus `smoke:foundation`             | Historical |
| M5        | Core does not import Convex                                             | architecture boundary suite                               | Automated  |
| M5        | Convex access remains in backend/plugin/app read-model boundaries       | architecture boundary suite                               | Automated  |
| M6        | Authenticated WorkOS users can create workflow records                  | mocked WorkOS integration and backend authorization tests | Automated  |
| M6        | Server functions enter core through the managed runtime                 | architecture boundary suite and client tests              | Automated  |
| M6        | CLI commands use PatchPlane service layers                              | CLI integration and CLI eval suites                       | Automated  |
| M6.5      | Workflow starts require WorkOS/Convex identity and permission           | WorkOS integration and backend Convex tests               | Automated  |
| M6.5      | WorkOS SDK objects do not cross into core                               | architecture boundary suite                               | Automated  |
| M6.5      | Real browser AuthKit callback and Convex persistence work together      | `smoke:browser` AuthKit and persisted-workflow journey    | Missing    |

## M7-M8.6: GitHub, telemetry, Daytona, infrastructure, and visibility

| Milestone | Acceptance criterion                                                  | Evidence                                               | Status     |
| --------- | --------------------------------------------------------------------- | ------------------------------------------------------ | ---------- |
| M7        | GitHub installation-token flow stays in plugins                       | GitHub plugin and architecture tests                   | Automated  |
| M7        | Verified GitHub events become generic workflow intake                 | GitHub plugin/core tests                               | Automated  |
| M7        | GitHub results publish without Octokit objects crossing into core     | core publication and GitHub adapter tests              | Automated  |
| M7.5      | Runtime failures are diagnosable through telemetry                    | telemetry and Sentry plugin tests                      | Automated  |
| M7.5      | Product provenance remains PatchPlane-owned                           | backend provenance and architecture tests              | Automated  |
| M7.5      | Alpha requires no collector/ClickHouse backend                        | architecture boundary suite                            | Automated  |
| M8        | A workflow provisions, clones, executes, logs, and tears down Daytona | Daytona tests and RPC live smoke                       | Live       |
| M8        | Sandboxes receive no long-lived control-plane credentials             | architecture boundary suite                            | Automated  |
| M8        | Sandbox lifecycle/network policy is stored                            | Daytona and backend Convex tests                       | Automated  |
| M8        | Raw evidence is durably R2-backed                                     | R2 plugin tests and RPC live artifact write            | Live       |
| M8.25     | Dev deployment creates R2 and AI Gateway                              | opt-in Alchemy live test and 2026-07-10 dev deployment | Live       |
| M8.25     | Runtime code does not import Alchemy provisioning APIs                | architecture boundary suite                            | Automated  |
| M8.25     | Core imports no Alchemy/Cloudflare SDK types                          | architecture boundary suite                            | Automated  |
| M8.5      | A GitHub/Daytona workflow is understandable in the UI                 | workflow console component tests                       | Automated  |
| M8.5      | UI explains untrusted, pending, approved, and rejected states         | workflow trust-state/component tests                   | Automated  |
| M8.6      | Hosted onboarding requires no CLI                                     | install-flow helper tests and historical live smoke    | Historical |
| M8.6      | Hosted user need not create a GitHub App manually                     | deployed product configuration                         | Historical |
| M8.6      | Hosted user need not copy a webhook URL                               | deployed product configuration                         | Historical |
| M8.6      | User can connect GitHub and select repositories                       | `smoke:browser` GitHub connection journey              | Missing    |
| M8.6      | PatchPlane lists connected repositories                               | backend and component tests                            | Automated  |
| M8.6      | PatchPlane reacts to PR open/synchronize events                       | GitHub normalization/webhook tests                     | Automated  |
| M8.6      | PatchPlane posts a clear PR trust report                              | publication tests and hosted trust-loop smoke          | Live       |
| M8.6      | Dashboard shows connected repository and latest verification          | backend/component tests plus `smoke:browser` readback  | Missing    |

## M9-M9.75: remote runtime, investigation UI, and evidence

| Milestone | Acceptance criterion                                                               | Evidence                                             | Status    |
| --------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------- | --------- |
| M9        | Pi starts inside a remote sandbox-backed workflow                                  | Daytona/Pi RPC live smoke                            | Live      |
| M9        | Hosted control plane excludes in-process Pi packages                               | architecture and bundle checks                       | Automated |
| M9        | Provider/model access is configurable                                              | command/config tests and RPC live smoke              | Live      |
| M9        | Pi events normalize through an Effect Stream boundary                              | Pi ingestion tests and RPC live smoke                | Live      |
| M9        | Raw Pi objects/JSONL do not cross into core/UI                                     | architecture and protocol tests                      | Automated |
| M9        | Daytona consumes the PatchPlane Pi runtime-session facade                          | architecture/source boundary test                    | Automated |
| M9.5      | Existing PatchPlane shell remains the dashboard foundation                         | component tests                                      | Automated |
| M9.5      | Real workflow details are understandable                                           | component tests; deployed browser run still required | Automated |
| M9.5      | Review ergonomics support maintainer dogfooding                                    | `smoke:browser` typed workflow readback confirmation | Missing   |
| M9.75     | Patch Report answers what changed/ran/passed and current decision                  | Patch Report domain and workflow component tests     | Automated |
| M9.75     | Workflow stores raw artifacts in R2                                                | R2 tests and live RPC artifact write                 | Live      |
| M9.75     | Convex stores artifact metadata/hashes/references                                  | backend Convex tests                                 | Automated |
| M9.75     | UI links reports/provenance to evidence                                            | workflow component tests                             | Automated |
| M9.75     | Raw artifacts are not analytics/telemetry truth                                    | architecture boundary suite                          | Automated |
| M9.75     | R2 reads back the exact non-empty uploaded evidence bytes and matching stored hash | Daytona/Pi RPC live smoke                            | Live      |

## M9.9: public alpha landing page

| Milestone | Acceptance criterion                                                            | Evidence                          | Status    |
| --------- | ------------------------------------------------------------------------------- | --------------------------------- | --------- |
| M9.9      | Hero communicates the developer pain and product outcome quickly                | landing copy test and copy review | Automated |
| M9.9      | Trust flow and illustrative report avoid unsupported commands/claims            | landing copy test                 | Automated |
| M9.9      | GitHub, current capabilities, quick start, contribution, and roadmap are linked | landing copy test                 | Automated |
| M9.9      | English and German landing message keys remain aligned                          | landing copy test                 | Automated |
| M9.9      | Production client bundle builds and stays within the client bundle budget       | `bun run verify` in PR CI         | Automated |

## M10: evidence-backed decision and publication

| Milestone | Acceptance criterion                                                                               | Evidence                                                         | Status    |
| --------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | --------- |
| M10       | Patch stays untrusted until execution, evidence, and review complete                               | policy, Patch Report, backend precondition tests                 | Automated |
| M10       | Human can approve/reject/request changes before publication                                        | backend and client decision tests                                | Automated |
| M10       | Decision rationale is backed by persisted evidence/provenance                                      | backend/core/component tests                                     | Automated |
| M10       | Review-ready acceptance uses the latest coherent execution, candidate, review, and policy records  | backend and trust-loop smoke regression tests                    | Automated |
| M10       | Decision publication remains pinned to the candidate projection reviewed by the human              | backend and client decision-publication tests                    | Automated |
| M10       | Real authenticated decision updates GitHub and reads back in UI                                    | `smoke:trust-loop` replay plus `smoke:browser` readback          | Missing   |
| M10       | Publication retry creates no duplicate GitHub output                                               | core/GitHub adapter tests and `smoke:trust-loop` provider replay | Live      |
| M10       | Durable normalized records deterministically assemble a Patch Report linked to complete provenance | domain, backend, and component tests                             | Automated |
| M10       | GitHub publication emits an evidence-backed result                                                 | check-run/comment publication tests and live trust-loop replay   | Automated |

## Completion rule

M0-M10 may be marked fully complete only when:

1. `bun run verify` passes.
2. No M0-M10 row remains `Missing`.
3. Credentialed `Live` rows have a successful run recorded for the release candidate.
4. The full trust-loop smoke passes twice against one test PR, with the second publication attempt proving idempotency.
5. Live resources are cleaned up or retained under an explicit short-lived evidence policy.

## Current live audit

On 2026-07-10:

- `bun run verify` passed, including typecheck, lint, all local suites, CLI eval, production build, and bundle budgets.
- `bun run smoke:daytona-rpc` passed against Daytona/Pi and read back a non-empty R2 artifact byte-for-byte with matching SHA-256 metadata before deleting the object and sandbox.
- The Cloudflare `dev` stack deployed R2, AI Gateway, client, source-control, and public webhook Workers. A fresh two-Worker create required one retry because the webhook service binding raced the target Worker precreate in the vendored Alchemy/Cloudflare provider.
- Convex CLI authentication was verified for the `okikesolutions` team and the current backend functions were deployed to `veracious-rooster-773` with `npx convex dev --once`.
- The hosted trust loop passed webhook HMAC verification, GitHub App repository access, Daytona/Pi JSON execution, normalized runtime-event persistence, R2 evidence capture with hashes, candidate-patch capture, automated review, policy evaluation, and provenance persistence for workflow `ms75nyt9d572v6p7ab98vrq7158a8kgx`.
- GitHub readback confirmed the workflow's Patch Report comment on test PR 96. JSON-mode Pi runs do not create an RPC runtime session; durable RPC-session behavior remains independently covered by `smoke:daytona-rpc`.
- The authenticated WorkOS human decision and resulting durable GitHub publication replay remain required. Convex CLI authentication does not create a browser AuthKit session.
