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
GITHUB_PRIVATE_KEY=
GITHUB_WEBHOOK_SECRET=
PATCHPLANE_GITHUB_ALLOWED_REPOSITORIES=owner/repo
PATCHPLANE_GITHUB_WORKSPACE_ID=
DAYTONA_API_KEY=
```

Optional provider keys, such as `OPENAI_API_KEY`, are only needed for Pi modes.

## Current implementation

The current alpha is being narrowed around one developer-first loop:

```text
AI patch → sandbox verification → Patch Report → human decision → GitHub result
```

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

GitHub, WorkOS, Convex, and Daytona SDK usage is server/plugin-side only. For the alpha `daytona-pi` path, Pi runs inside the Daytona sandbox rather than being bundled into the web/control-plane runtime. Core workflows depend on PatchPlane-owned Effect services and domain schemas.

The Pi runtime adapter is Effect-native at the PatchPlane boundary: `packages/plugins/src/sandbox-runtime/pi/contract.ts` defines the Effect RPC command contract, `runtime-session.ts` exposes a session facade, `transport.ts` translates typed commands to Pi JSONL, and `jsonl.ts`/`ingestion.ts` decode Daytona stdout streams into normalized runtime events. Raw Pi JSONL does not cross into core or UI state.

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
GITHUB_PRIVATE_KEY
GITHUB_WEBHOOK_SECRET
CONVEX_URL or VITE_CONVEX_URL
PATCHPLANE_SYSTEM_INGESTION_SECRET
PATCHPLANE_GITHUB_ALLOWED_REPOSITORIES=owner/repo,another/repo
PATCHPLANE_GITHUB_WORKSPACE_ID or PATCHPLANE_WORKOS_ORGANIZATION_ID
DAYTONA_API_KEY
```

The route verifies GitHub signatures against the raw request body, maps supported events into generic `WorkflowIntake`, verifies repository access through the GitHub App installation, and persists generic external refs in Convex.

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
- `packages/cli` uses `effect/unstable/cli`, Effect `Terminal` prompts, `@effect/platform-node`, and a `ManagedRuntime` for CLI services
