# M0-M10 acceptance-test traceability

This matrix is the source of truth for claims that an alpha milestone is tested.
See [`critical-path.md`](./critical-path.md) for the ordered product and release
path that these claims support.

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

| Milestone | Acceptance criterion                                                                                                                                   | Evidence                                                                  | Status     |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- | ---------- |
| M7        | GitHub installation-token flow stays in plugins                                                                                                        | GitHub plugin and architecture tests                                      | Automated  |
| M7        | Verified GitHub events become generic workflow intake                                                                                                  | GitHub plugin/core tests                                                  | Automated  |
| M7        | GitHub results publish without Octokit objects crossing into core                                                                                      | core publication and GitHub adapter tests                                 | Automated  |
| M7.5      | Foundational browser, client Worker, server-function, and initial webhook failures have a Sentry capture path                                          | telemetry, Sentry plugin, router, and Worker tests                        | Automated  |
| M7.5      | Every unexpected alpha critical-path failure is captured once or linked to an upstream issue                                                           | route/Worker failure-capture tests plus deployed deliberate-failure smoke | Missing    |
| M7.5      | Captured critical-path issues include bounded stage breadcrumbs and safe correlation IDs                                                               | telemetry contract/plugin tests plus deployed Sentry readback             | Missing    |
| M7.5      | Sentry events, logs, spans, breadcrumbs, and URLs exclude classified sensitive content                                                                 | sentinel-secret sanitization and transport-boundary tests                 | Automated  |
| M7.5      | Expected validation, authorization, idempotency, policy, and incomplete-evidence outcomes do not create noisy duplicate issues                         | telemetry classification and route tests                                  | Missing    |
| M7.5      | Browser, Effect, client Worker, and source-control Worker telemetry identifies the deployed environment/release                                        | configuration tests plus deployed Sentry readback                         | Missing    |
| M7.5      | Product provenance remains PatchPlane-owned                                                                                                            | backend provenance and architecture tests                                 | Automated  |
| M7.5      | Alpha requires no collector/ClickHouse backend                                                                                                         | architecture boundary suite                                               | Automated  |
| M8        | A workflow provisions, clones, executes, logs, and tears down Daytona                                                                                  | Daytona tests and RPC live smoke                                          | Live       |
| M8        | Sandboxes receive no long-lived control-plane credentials                                                                                              | architecture boundary suite                                               | Automated  |
| M8        | Requested sandbox lifecycle/network policy is stored                                                                                                   | Daytona and backend Convex tests                                          | Automated  |
| M8        | Effective isolation evidence covers boundary/class, limits, tier exceptions, forbidden sharing/ingress/persistence, egress, and delete-to-not-found    | Daytona decoder/tests plus credentialed isolation/persistence smoke       | Missing    |
| M8        | Every intentionally retained RPC sandbox has bounded ownership/expiry/reconciliation and eventual deletion evidence                                    | runtime-session tests plus interrupted and successful RPC smokes          | Missing    |
| M8        | Multi-environment execution enforces bounded concurrency/timeouts, no runtime resize or leftover background work, and typed provider capacity outcomes | scheduler/session tests plus rate-limit and capacity smoke                | Missing    |
| M8        | Raw evidence is durably R2-backed                                                                                                                      | R2 plugin tests and RPC live artifact write                               | Live       |
| M8        | A required Windows check uses exact-commit clone, validates clean/exact head, binds evidence/digests, and proves cleanup                               | Git/status decoder and Windows adapter tests plus credentialed smoke      | Missing    |
| M8        | A required browser/GUI check runs through Daytona Computer Use with candidate-bound visual evidence and cleanup                                        | Computer Use adapter tests plus credentialed Linux/Windows GUI smoke      | Missing    |
| M8        | macOS requirements remain blocked when no supported environment exists                                                                                 | platform-unavailable coverage, policy, Patch Report, and UI tests         | Automated  |
| M8        | Production-dependent requirements receive no production credentials and use a trusted secret-free equivalent or remain blocked                         | architecture/config tests plus credentialed sandbox-input smoke           | Missing    |
| M8.25     | Dev deployment creates R2 and AI Gateway                                                                                                               | opt-in Alchemy live test and 2026-07-10 dev deployment                    | Live       |
| M8.25     | Runtime code does not import Alchemy provisioning APIs                                                                                                 | architecture boundary suite                                               | Automated  |
| M8.25     | Core imports no Alchemy/Cloudflare SDK types                                                                                                           | architecture boundary suite                                               | Automated  |
| M8.5      | A GitHub/Daytona workflow is understandable in the UI                                                                                                  | workflow console component tests                                          | Automated  |
| M8.5      | UI explains untrusted, pending, approved, and rejected states                                                                                          | workflow trust-state/component tests                                      | Automated  |
| M8.6      | Hosted onboarding requires no CLI                                                                                                                      | install-flow helper tests and historical live smoke                       | Historical |
| M8.6      | Hosted user need not create a GitHub App manually                                                                                                      | deployed product configuration                                            | Historical |
| M8.6      | Hosted user need not copy a webhook URL                                                                                                                | deployed product configuration                                            | Historical |
| M8.6      | User can connect GitHub and select repositories                                                                                                        | `smoke:browser` GitHub connection journey                                 | Missing    |
| M8.6      | PatchPlane lists connected repositories                                                                                                                | backend and component tests                                               | Automated  |
| M8.6      | PatchPlane reacts to PR open/synchronize events                                                                                                        | GitHub normalization/webhook tests                                        | Automated  |
| M8.6      | PatchPlane posts a clear PR trust report                                                                                                               | publication tests and hosted trust-loop smoke                             | Live       |
| M8.6      | Dashboard shows connected repository and latest verification                                                                                           | backend/component tests plus `smoke:browser` readback                     | Missing    |

## M9-M9.75: remote runtime, investigation UI, and evidence

| Milestone | Acceptance criterion                                                                                                                                                                                                                                                                | Evidence                                                                                                                | Status    |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------- |
| M9        | Pi starts inside a remote sandbox-backed workflow                                                                                                                                                                                                                                   | Daytona/Pi RPC live smoke                                                                                               | Live      |
| M9        | Hosted control plane excludes in-process Pi packages                                                                                                                                                                                                                                | architecture and bundle checks                                                                                          | Automated |
| M9        | Provider/model access is configurable                                                                                                                                                                                                                                               | command/config tests and RPC live smoke                                                                                 | Live      |
| M9        | Pi events normalize through an Effect Stream boundary                                                                                                                                                                                                                               | Pi ingestion tests and RPC live smoke                                                                                   | Live      |
| M9        | Raw Pi objects/JSONL do not cross into core/UI                                                                                                                                                                                                                                      | architecture and protocol tests                                                                                         | Automated |
| M9        | Daytona consumes the PatchPlane Pi runtime-session facade                                                                                                                                                                                                                           | architecture/source boundary test                                                                                       | Automated |
| M9.5      | Existing PatchPlane shell remains the dashboard foundation                                                                                                                                                                                                                          | component tests                                                                                                         | Automated |
| M9.5      | Real workflow details are understandable                                                                                                                                                                                                                                            | component tests; deployed browser run still required                                                                    | Automated |
| M9.5      | Review ergonomics support maintainer dogfooding                                                                                                                                                                                                                                     | `smoke:browser` typed workflow readback confirmation                                                                    | Missing   |
| M9.75     | Patch Report V1 answers request/attempt/candidate/execution/verification gaps/review/policy/decision/publication without collapsing states                                                                                                                                          | domain, assembler, backend, publication, and component tests                                                            | Automated |
| M9.75     | Legacy evidence cannot be silently represented as a V1 report                                                                                                                                                                                                                       | Patch Report assembler regression test                                                                                  | Automated |
| M9.75     | Required verification is declared before execution and bound to the frozen candidate digest                                                                                                                                                                                         | core workflow, policy, Daytona, and backend tests                                                                       | Automated |
| M9.75     | A versioned bounded plan persists canonical digest and trusted deployment/workspace/base-policy precedence before candidate freeze                                                                                                                                                  | domain/core/source-control/backend plan and replay tests                                                                | Automated |
| M9.75     | A bounded signed webhook is stored as an R2 outbox envelope with a digest-bound Convex receipt before enqueue; lease-expired ambiguous sends replay, each receipt binds to its exact new or reused workflow, and consumers acknowledge only durable terminal/DLQ-finalized outcomes | source-control Worker outbox, envelope-fencing, retry, and backend receipt/group-finalization tests                     | Automated |
| M9.75     | Every supported executable plan requirement runs in a fresh candidate-bound group; unsupported or commandless requirements persist blocked groups/results rather than using the agent sandbox                                                                                       | automated core/Convex/Daytona fresh-group tests plus hosted PR 150 group `s171pg1nfekjm4y7dnqneckd5n8bfmhs`             | Live      |
| M9.75     | Control-plane command envelopes bind plan/group/requirement/candidate, command digest and timeout, platform/architecture, timing/exit, mutation digests, bounded stdout/stderr artifacts, and cleanup outcome                                                                       | automated envelope/report tests plus hosted PR 150 result `rs7bhcpct7ce5var1j33yftvs18ben6q`                            | Live      |
| M9.75     | Trusted Linux groups read back effective image/target/OS/architecture/resources/network/lifecycle and public/link/volume posture, persist bounded async provider session/command identity before terminal/log polling, and require provider not-found cleanup readback              | automated environment/process/deletion tests plus hosted PR 150 sandbox execution `ps7e4qyreb7w2et356bz2532418bftwz`   | Live      |
| M9.75     | GitHub PR intake freezes the webhook-authenticated base/head candidate and exact diff before Daytona or Pi starts                                                                                                                                                                   | automated freeze-order evidence plus hosted PR 150 candidate `qh7b8r6q992rea3jjc757qkaq98bf8pm`                        | Live      |
| M9.75     | Pi review is read-only after candidate freeze and cannot satisfy or mutate deterministic verification                                                                                                                                                                               | core/runtime mutation tests plus credentialed PR dogfood                                                                | Missing   |
| M9.75     | One orchestration claim dispatches bounded, idempotent execution groups for every required supported environment                                                                                                                                                                    | automated dispatch-token/group-claim/replay/recovery tests pass; multi-environment smoke remains outstanding            | Missing   |
| M9.75     | Missing, blocked, errored, mutated, platform-unavailable, truncated, or mismatched required evidence is never reported as passed                                                                                                                                                    | verification coverage, policy, report, and UI tests                                                                     | Automated |
| M9.75     | A fresh real dogfood run displays truthful candidate-bound V1 evidence and explicit native-platform gaps                                                                                                                                                                            | `smoke:trust-loop` plus authenticated browser readback                                                                  | Missing   |
| M9.75     | Workflow stores raw artifacts in R2                                                                                                                                                                                                                                                 | R2 tests and live RPC artifact write                                                                                    | Live      |
| M9.75     | Convex stores artifact metadata/hashes/references                                                                                                                                                                                                                                   | backend Convex tests                                                                                                    | Automated |
| M9.75     | UI links reports/provenance to evidence                                                                                                                                                                                                                                             | workflow component tests                                                                                                | Automated |
| M9.75     | Raw artifacts are not analytics/telemetry truth                                                                                                                                                                                                                                     | architecture boundary suite                                                                                             | Automated |
| M9.75     | R2 reads back the exact non-empty uploaded evidence bytes and matching stored hash                                                                                                                                                                                                  | Daytona/Pi RPC live smoke                                                                                               | Live      |

## M9.9: public alpha landing page

| Milestone | Acceptance criterion                                                            | Evidence                          | Status    |
| --------- | ------------------------------------------------------------------------------- | --------------------------------- | --------- |
| M9.9      | Hero communicates the developer pain and product outcome quickly                | landing copy test and copy review | Automated |
| M9.9      | Trust flow and illustrative report avoid unsupported commands/claims            | landing copy test                 | Automated |
| M9.9      | GitHub, current capabilities, quick start, contribution, and roadmap are linked | landing copy test                 | Automated |
| M9.9      | English and German landing message keys remain aligned                          | landing copy test                 | Automated |
| M9.9      | Production client bundle builds and stays within the client bundle budget       | `bun run verify` in PR CI         | Automated |

## M10: evidence-backed decision and publication

| Milestone | Acceptance criterion                                                                                                   | Evidence                                                         | Status    |
| --------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | --------- |
| M10       | Patch stays untrusted until declared candidate-bound evidence, policy, and review complete                             | policy, Patch Report, backend precondition tests                 | Automated |
| M10       | Human can approve/reject/request changes; incomplete verification approval requires a durable explicit override reason | backend and client decision tests                                | Automated |
| M10       | Rerun creates an immutable child attempt with reason, pinned revision, idempotency, and one atomic execution claim     | backend/core/source-control/client tests                         | Automated |
| M10       | A real authenticated rerun executes the child attempt and preserves the parent report                                  | `smoke:trust-loop` plus browser readback                         | Missing   |
| M10       | Decision rationale is backed by persisted evidence/provenance                                                          | backend/core/component tests                                     | Automated |
| M10       | Review-ready acceptance uses the latest coherent execution, candidate, review, and policy records                      | backend and trust-loop smoke regression tests                    | Automated |
| M10       | Decision publication remains pinned to the candidate projection reviewed by the human                                  | backend and client decision-publication tests                    | Automated |
| M10       | Candidate check publication requires exact candidate `headSha`; no PR-head fallback                                    | core publication and GitHub adapter tests                        | Automated |
| M10       | Concurrent publication dispatch has one leased owner and canonical replay identity                                     | backend/core/GitHub adapter tests                                | Automated |
| M10       | Real authenticated decision updates one canonical exact-head GitHub report/check and reads back in UI                  | `smoke:trust-loop` replay plus `smoke:browser` readback          | Missing   |
| M11       | A supported-platform incoming PR fully passes without agent rewriting, duplicate reports, or unrelated smoke evidence  | design-partner acceptance run                                    | Missing   |
| M11       | PR 128 produces a truthful incomplete report for required macOS evidence and an explicit decision/override path        | exact-candidate acceptance run and authenticated GitHub readback | Missing   |
| M10       | Publication retry creates no duplicate GitHub output                                                                   | core/GitHub adapter tests and `smoke:trust-loop` provider replay | Live      |
| M10       | Durable normalized records deterministically assemble a Patch Report linked to complete provenance                     | domain, backend, and component tests                             | Automated |
| M10       | GitHub publication emits an evidence-backed result                                                                     | check-run/comment publication tests and live trust-loop replay   | Automated |

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
- The hosted trust loop passed the then-current webhook, repository access, Daytona/Pi, R2, candidate, review, policy, and provenance path for workflow `ms75nyt9d572v6p7ab98vrq7158a8kgx`. This is historical V0 evidence and does **not** satisfy the reopened V1 candidate-bound or rerun rows above.
- GitHub readback confirmed the historical workflow's Patch Report comment on test PR 96. It does not prove canonical V1 publication, candidate-`headSha` checks, or immutable rerun behavior. JSON-mode Pi runs do not create an RPC runtime session; durable RPC-session behavior remains independently covered by `smoke:daytona-rpc`.
- On 2026-07-28, temporary same-repository PR 129 directly passed exact-head Daytona checkout, effective Linux environment readback, the bounded trusted command, and structured delete-to-not-found. The deployed hosted path separately persisted the frozen candidate, trusted plan, execution-group claim, and sandbox ID, but did **not** persist a terminal sandbox/result envelope. An experimental queue did not close that gap and was removed. This is partial provider evidence only: PR 129 and its branch were removed, and the supported-Linux end-to-end row remains `Missing`.
- Later on 2026-07-28, hosted PR 131 proved the hardened Cloudflare queue, exact receipt-to-reused-workflow binding, and a terminal `completed` delivery receipt. That immutable workflow had persisted an empty plan before the Linux command deployment, so it had no execution group, result, environment, artifact, or cleanup evidence and granted no supported-Linux credit.
- On 2026-07-29, no-PR experiments showed that Cloudflare Workflows do not reset the Free-plan 50-external-subrequest budget between steps, while separate service-bound Worker invocations do receive separate budgets. PatchPlane instead reduced the current single-requirement path below 50 by using one bounded non-PTY `executeCommand` request for each read-only/setup evidence probe; the trusted requirement itself remains a durable asynchronous Daytona session/command.
- Hosted PR 150 then completed the supported-Linux path in workflow `ms7exrs2kbe5ng7gsrtk3m7c698bf449` for exact candidate head `b520e8435f36b1cc7498d898d8ace927b51e11a1`. Candidate `qh7b8r6q992rea3jjc757qkaq98bf8pm`, plan `s577pa9bm0ekkpnhneyrck1n0h8bfre7`, group `s171pg1nfekjm4y7dnqneckd5n8bfmhs`, sandbox execution `ps7e4qyreb7w2et356bz2532418bftwz`, and result `rs7bhcpct7ce5var1j33yftvs18ben6q` formed one coherent lineage. The required Linux result passed with effective `daytonaio/sandbox:0.8.0`/`eu`/Linux/x86_64/resource/network/lifecycle/public/link/volume readback, persisted provider session/command IDs, captured test-report/diff/stdout/stderr artifacts, unchanged candidate digests, and confirmed `deleted` cleanup. Delivery `5b7118c0-8b27-11f1-87de-7a284358103f` became terminal/completed and the workflow reached `reviewed`; the temporary PR and branch were removed. This closes sequence Task 6 only—read-only Pi review, aggregate report projection, canonical publication, Windows, and Computer Use remain open.
- The authenticated WorkOS human decision and resulting durable GitHub publication replay remain required. Convex CLI authentication does not create a browser AuthKit session.
