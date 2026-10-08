# PatchPlane

Open-source Patch Reports for AI-generated code changes.

PatchPlane gives developers evidence before they trust an AI patch. It turns each AI-generated change into an inspectable trust report before the patch continues toward merge.

For every patch, PatchPlane should make it obvious:

- what changed,
- what ran,
- where it ran,
- what passed or failed,
- what evidence exists,
- who approved or rejected it.

PatchPlane treats every AI-generated patch as untrusted until it has been executed, evidenced, reviewed, and explicitly approved. It keeps normal GitHub and CI/CD workflows while adding a trust boundary before generated code reaches secrets, shared caches, trusted automation, or merge paths.

Core docs:

- [SPEC.md](./SPEC.md): product thesis, architecture, and MVP success criteria
- [ROADMAP.md](./ROADMAP.md): active and completed delivery work
- [packages/cli/README.md](./packages/cli/README.md): CLI onboarding, env templates, and diagnostics
- [packages/plugins/README.md](./packages/plugins/README.md): infrastructure plugin and sandbox-backed Pi runtime architecture
- [CONTRIBUTING.md](./CONTRIBUTING.md): development and contribution guide
- [docs/philosophy.md](./docs/philosophy.md): product and developer-experience decision principles
- [docs/critical-path.md](./docs/critical-path.md): product path from intake through evidence, decision, publication, and release proof
- [docs/ui-ux-review-tracker.md](./docs/ui-ux-review-tracker.md): authenticated UI/UX audit findings, diff viewer gates, and minimal changed-file navigation tracker
- [docs/repository-verification-capability-tracker.md](./docs/repository-verification-capability-tracker.md): alpha PR-verification correctness gaps, dependencies, and completion evidence
- [docs/telemetry-data-policy.md](./docs/telemetry-data-policy.md): Sentry allowlist, prohibited content, and sanitization requirements
- [docs/effect-boundaries.md](./docs/effect-boundaries.md): normative Effect-native architecture, verified runtime bridges, exceptions, and enforcement
- [docs/m10-acceptance-runbook.md](./docs/m10-acceptance-runbook.md): repeatable human-gated trust-loop acceptance
- [AGENTS.md](./AGENTS.md): repository map, trust boundaries, and automation protocol
- [REVIEW.md](./REVIEW.md): risk-based review checklist for Patchplane changes
- [SECURITY.md](./SECURITY.md): security reporting and secret-handling policy

## Quick start

PatchPlane's OSS onboarding path is the CLI. It creates root `patchplane.config.json`, appends missing required keys to `.env.local`, and creates generated local state directories under `.patchplane/{logs,cache,state}`.

```bash
bun install
bun run patchplane init
bun run patchplane doctor
```

For scriptable or CI-safe setup, pass explicit flags instead of relying on prompts:

```bash
bun run patchplane init --profile app --yes
bun run patchplane init --profile githubWebhook --yes
bun run patchplane init --profile full --yes
```

Then run the app and Convex backend in separate terminals:

```bash
bun run dev:backend
bun run dev:client
```

Secrets belong in `.env.local` or deployment secret stores, not in `patchplane.config.json` or plugin metadata.

## Environment templates

Use the CLI instead of copying a large env file by hand:

```bash
bun run patchplane env template --surface app
bun run patchplane env template --surface githubWebhook
bun run patchplane env check --surface app
bun run patchplane env check --surface githubWebhook
```

Minimal app profile:

```env
VITE_CONVEX_URL=
WORKOS_CLIENT_ID=
WORKOS_API_KEY=
WORKOS_REDIRECT_URI=http://localhost:3000/api/auth/callback
WORKOS_COOKIE_PASSWORD=
```

Minimal GitHub webhook profile:

```env
VITE_CONVEX_URL=
PATCHPLANE_SYSTEM_INGESTION_SECRET=
GITHUB_APP_ID=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
PATCHPLANE_GITHUB_OAUTH_CALLBACK_URL=http://localhost:3000/api/github/install/callback
GITHUB_PRIVATE_KEY=
GITHUB_WEBHOOK_SECRET=
PATCHPLANE_GITHUB_ALLOWED_REPOSITORIES=owner/repo
PATCHPLANE_GITHUB_WORKSPACE_ID=
DAYTONA_API_KEY=
```

The GitHub App registration must grant `Metadata: read`, the repository permissions used by enabled workflows, and `Organization members: read` so PatchPlane can require an active organization administrator before connecting an organization installation. Optional provider keys, such as `OPENAI_API_KEY`, are only needed for Pi modes.

## Current implementation

The alpha is being narrowed around one developer-first loop:

```text
incoming GitHub PR → exact base/head candidate freeze → trusted requirements → Daytona verification → optional read-only review → policy → human decision → one canonical exact-head Patch Report
```

The deployed path now freezes the webhook-authenticated incoming base/head candidate before read-only review or verification, runs each supported trusted command in a separately claimed protected Linux Daytona group, persists effective environment/artifact/deletion evidence, and publishes only after one terminal authenticated decision. Temporary PR 162 supplied live exact-candidate decision, comment/check readback, and duplicate-free replay evidence. Aggregate multi-environment report projection, a live authenticated child rerun, Windows/Computer Use, representative egress, and crash cleanup reconciliation remain open; those gaps prevent a broader alpha-complete claim.

The current foundation includes two workflow-start paths:

```text
WorkOS AuthKit session
→ TanStack Start server function
→ WorkOSAuthPlugin permission check
→ StorageService.createWorkflowFromPrompt
→ Convex workflowStarts:create with WorkOS JWT
→ promptRequests + workflowRuns
```

```text
GitHub webhook
→ GitHubWebhookService signature verification
→ GitHub-specific normalization
→ generic WorkflowIntake + ExternalWorkflowRef
→ repository allowlist + repository access verification
→ StorageService.createWorkflowFromIntake
→ Convex workflowStarts:createFromExternalIntake
→ promptRequests + workflowRuns + externalWorkflowRefs
```

The authenticated dashboard lists connected GitHub repositories and their latest workspace-scoped trust status, with a direct link to the durable workflow investigation view.

Each V1 run is an immutable attempt. A rerun creates a child attempt pinned to the same candidate revisions; it does not overwrite the parent. For the alpha GitHub path, evidence applies only to the incoming PR candidate identified by repository/PR identity, webhook-authenticated base/head SHAs, exact diff artifact, and `sha256:` digest. A sandbox-generated diff is a different candidate and cannot verify the PR. Candidate freeze, agent exit `0`, external review, independent verification, policy, human decision, and publication are separate states. Missing, blocked, stale, truncated, or candidate-mismatched required evidence cannot produce a trusted result. A human may still approve incomplete verification only with an explicit recorded override reason; the Patch Report continues to show the gap.

The canonical Patch Report V1 is assembled from durable Convex records and R2 artifact metadata for the exact attempt/candidate. GitHub issue comments and commit-bound check runs use stable canonical identities and update on replay; immutable attempts, publication rows, and provenance remain in PatchPlane.

GitHub, WorkOS, Convex, and Daytona SDK usage is server/plugin-side only. For the alpha `daytona-pi` path, Pi runs inside the Daytona sandbox rather than being bundled into the web/control-plane runtime. Core workflows depend on PatchPlane-owned Effect services and domain schemas.

The Pi runtime adapter is Effect-native at the PatchPlane boundary: `packages/plugins/src/sandbox-runtime/pi/contract.ts` defines the Effect RPC command contract, `runtime-session.ts` exposes a session facade, `transport.ts` translates typed commands to Pi JSONL, and `jsonl.ts`/`ingestion.ts` decode Daytona stdout streams into normalized runtime events. A bounded PatchPlane-owned Pi transcript is retained as R2 evidence; raw prompts, tool output, provider payloads, and transient deltas are removed before persistence, and client projections bound event counts and payload previews.

## Workspace

This repository is a Bun monorepo:

- `apps/client`: TanStack Start app, WorkOS/AuthKit UI integration, Convex client integration, app routes, and app Effect runtime composition
- `apps/source-control`: Cloudflare Worker for source-control provider webhooks, GitHub installation sync, Daytona/Pi orchestration, and repository publication
- `packages/backend`: Convex-backed control-plane backend and deployment functions
- `packages/domain`: shared Effect schemas and PatchPlane-owned domain types
- `packages/core`: Effect service contracts and workflow logic; no provider SDK imports
- `packages/plugins`: infrastructure plugins for WorkOS, Convex, GitHub, Daytona, experimental Pi runtime adapters, and plugin metadata
- `packages/cli`: Effect-powered CLI for OSS onboarding, project config generation, plugin discovery, env templates/checks, and diagnostics

## GitHub webhook intake

The hosted alpha GitHub webhook route is served by the dedicated source-control Worker:

```text
POST /api/github/webhook
```

Required server environment for workflow creation from GitHub webhooks:

```text
GITHUB_APP_ID
GITHUB_CLIENT_ID
GITHUB_CLIENT_SECRET
PATCHPLANE_GITHUB_OAUTH_CALLBACK_URL
GITHUB_PRIVATE_KEY
GITHUB_WEBHOOK_SECRET
CONVEX_URL or VITE_CONVEX_URL
PATCHPLANE_SYSTEM_INGESTION_SECRET
PATCHPLANE_GITHUB_ALLOWED_REPOSITORIES=owner/repo,another/repo
PATCHPLANE_GITHUB_WORKSPACE_ID or PATCHPLANE_WORKOS_ORGANIZATION_ID
DAYTONA_API_KEY
```

The public webhook boundary verifies GitHub signatures over a bounded raw body, stores the untrusted signed queue envelope in R2, persists its digest-bound ingress receipt in Convex, and only then enqueues it. A generation-fenced, lease-expired scheduled outbox replay closes ambiguous enqueue failures; an atomic per-delivery processing claim suppresses duplicate consumers, and every authenticated receipt binds to the exact newly created or reused candidate workflow before the one-message consumer can acknowledge an explicit durable terminal outcome, while delayed dead-letter recovery terminalizes the receipt and every materialized plan requirement. The source-control service binding is abort-bounded independently of the trusted execution deadline.

The route maps supported events into generic `WorkflowIntake`, verifies repository access through the GitHub App installation, pins the intake SHA, and persists generic external refs in Convex. Pi exiting successfully means only that sandbox agent execution completed. Before incoming-candidate freeze, PatchPlane resolves and persists a versioned bounded verification plan with a canonical SHA-256 digest. Deployment policy is non-negotiable; optional validated workspace policy takes precedence over optional repository-scoped policy bound to the authenticated base SHA. The deployment-system test requirement requires an explicit `PATCHPLANE_EVIDENCE_TEST_REPORT_COMMAND`; without one, that layer declares no test requirement. Authorized workspace or base-repository policies may still declare bounded executable requirements, and an effective plan with no required checks remains not configured rather than clean or passed. Set `PATCHPLANE_EVIDENCE_TEST_PLATFORM` to `linux`, `macos`, or `windows` to declare the required platform. Non-Linux requirements remain explicit blocked evidence until a matching safe provider is configured. Incoming plan requirements are not credited from the agent sandbox: supported Linux commands run once in fresh candidate-bound groups with plan/group/command identity, exact pre/post HEAD observations, final-state mutation digests, bounded stdout/stderr R2 artifacts, and cleanup-attempt status. Trusted Linux setup now rejects candidate symlinks and hardlinks, makes source and `.git` root-owned and non-writable, and launches the command as UID/GID 65534 with `no_new_privs`, zero capability sets, private PID and network namespaces, blocked nested user-namespace creation, a clean environment, and a separate writable `.patchplane`/dependency area. The private network namespace prevents candidate access to Daytona's privileged toolbox listener; network-dependent verification remains unsupported until trusted dependency preparation is added. A result can pass only when post-command readback confirms protected source, protected Git metadata, effective identity/capabilities, namespace isolation, descendant termination, exact HEAD, matching digests, and sandbox deletion. Trusted Linux verification also reads back the running Daytona image, target, OS/architecture, resources, lifecycle, network settings, public/link/volume posture, and provider state before executing the requirement; a mismatch fails closed. The requirement runs as a Daytona asynchronous process session, and PatchPlane durably binds the bounded provider session and command IDs to its execution group before polling terminal status and retrieving bounded stdout/stderr snapshots. Cleanup is credited as deleted only after a bounded provider lookup returns the SDK's structured not-found result; a Worker crash instead leaves failed evidence for later reconciliation. Hosted PR 150 remains endpoint-observed historical lifecycle evidence. Temporary PR 153 first proved fail-closed carve-out handling: hostile head `10caee1d4c028b78fe47a1d2b8ec8c6997ae240a` tracked `.patchplane/tracked.txt` and was rejected before candidate execution in workflow `ms76mqmrgdp0z0thgyrcm613n98be4xw`. Final temporary PR 154 then passed the architecture-guarded Queue → Effect Worker → Core → Daytona → R2/Convex path for head `fbd606af3f60b754f5a657adf3293f7f842eea47`: source/Git, rename, symlink, `sudo`, direct nested-namespace and x32 syscall, credential, privileged-socket, local-toolbox, and detached-writer attacks were denied; the inherited seccomp policy, three execution artifacts, exact frozen diff, and confirmed deletion persisted under workflow `ms73zdyfd4p62gn8f0vhf4mm6x8bhh6k`. This closes `EXEC-002` and Task 6. Temporary PR 162 subsequently closed the hosted read-only Pi review and canonical authenticated decision/publication path for an exact incoming candidate, including one issue comment, one exact-head check run, and duplicate-free provider replay. Aggregate multi-environment plan execution, a live authenticated rerun, Windows, Computer Use, representative egress, and crash cleanup reconciliation remain open.

## Live Daytona/Pi RPC smoke

To run the live Daytona/Pi RPC smoke locally, load `.env.local` and pass a public repository. The smoke starts Pi in a Daytona RPC session, validates `get_state`, `prompt`, `steer`, `follow_up`, `abort`, runtime events, session termination, and final Daytona sandbox deletion.

```bash
set -a
source .env.local
set +a

PATCHPLANE_SMOKE_REPOSITORY_URL=https://github.com/octocat/Hello-World \
PATCHPLANE_SMOKE_REPOSITORY_FULL_NAME=octocat/Hello-World \
PATCHPLANE_PI_PROVIDER=openai \
PATCHPLANE_PI_MODEL=gpt-4o-mini \
PATCHPLANE_SMOKE_TIMEOUT_SECONDS=180 \
bun run --cwd packages/plugins smoke:daytona-rpc
```

Expected final summary fields include:

```json
{
  "getStateResponse": true,
  "promptResponse": true,
  "steerResponse": true,
  "followUpResponse": true,
  "abortResponse": true,
  "terminated": true,
  "sandboxDeleted": true
}
```

Use `tee` if you want a raw smoke transcript:

```bash
bun run --cwd packages/plugins smoke:daytona-rpc | tee .patchplane/logs/daytona-rpc-smoke.jsonl
```

## Validation

Useful checks before committing:

```bash
bun run verify:fast
bun run verify
```

`verify` is the complete non-credentialed repository gate and runs on every
pull request. Credentialed smoke checks remain opt-in; see
[`docs/acceptance-tests.md`](./docs/acceptance-tests.md) for their scope.

A post-build client bundle guard should not find server-only secrets or SDKs:

```bash
rg "WORKOS_API_KEY|PATCHPLANE_SYSTEM_INGESTION_SECRET|GITHUB_PRIVATE_KEY|GITHUB_WEBHOOK_SECRET|octokit|workos-node|api.workos.com" apps/client/dist/client
```

## Effect

Effect is used for the control-plane core:

- `packages/domain` uses `effect/Schema` for shared models
- `packages/core` defines Effect service contracts and workflows
- `packages/plugins` provides Effect layers for real infrastructure
- `apps/client` composes the app runtime; hosted source-control webhook/control-plane execution runs in `apps/source-control`
- `packages/cli` uses `effect/cli`, Effect `Terminal` prompts, `@effect/platform-node`, and a `ManagedRuntime` for CLI services
