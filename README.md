# PatchPlane

Open-source pre-CI sandbox and trust layer for AI-generated code changes.

PatchPlane treats every AI-generated patch as untrusted until it has been executed, validated, and reported from an isolated environment. It helps maintainers and teams keep normal GitHub and CI/CD workflows while adding a trust boundary before generated code reaches secrets, shared caches, trusted automation, or merge paths.

Core docs:

- [SPEC.md](./SPEC.md): stable product thesis, architecture, and MVP success criteria
- [ROADMAP.md](./ROADMAP.md): open, active, and completed delivery work
- [docs/foundation-smoke.md](./docs/foundation-smoke.md): repeatable foundation smoke validation
- [docs/workos-alpha-completion.md](./docs/workos-alpha-completion.md): WorkOS + Convex alpha notes

## Current implementation

The current alpha foundation includes two workflow-start paths:

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

GitHub, WorkOS, and Convex SDK usage is server/plugin-side only. Core workflows depend on PatchPlane-owned Effect services and domain schemas.

## Workspace

This repository is a Bun monorepo:

- `apps/client`: TanStack Start app, WorkOS/AuthKit UI integration, Convex client integration, API routes, and Effect runtime composition
- `packages/backend`: Convex-backed control-plane backend and deployment functions
- `packages/domain`: shared Effect schemas and PatchPlane-owned domain types, including `WorkflowIntake` and `ExternalWorkflowRef`
- `packages/core`: Effect service contracts and workflow logic; no WorkOS, Convex, Octokit, TanStack Start, Daytona, or Pi imports
- `packages/plugins`: infrastructure plugins for WorkOS auth, Convex storage, and GitHub provider/webhook/source-control capabilities

## Getting Started

```bash
bun install
bun run dev:client
```

In a second terminal:

```bash
bun run dev:backend
```

## Foundation smoke validation

After configuring Convex and WorkOS smoke values, run:

```bash
CONVEX_URL="https://<deployment>.convex.cloud" \
PATCHPLANE_WORKOS_ACCESS_TOKEN="<token>" \
PATCHPLANE_WORKOS_USER_ID="<user_id>" \
PATCHPLANE_WORKOS_ORGANIZATION_ID="<org_id>" \
  bun run smoke:foundation "Smoke prompt"
```

See [docs/foundation-smoke.md](./docs/foundation-smoke.md) for expected output and inspection commands.

## GitHub webhook intake

The alpha GitHub webhook route is:

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
```

The route verifies GitHub signatures against the raw request body, maps supported events into generic `WorkflowIntake`, verifies repository access through the GitHub App installation, and persists generic external refs in Convex.

## Validation

Useful checks before committing:

```bash
bun run typecheck
bun run lint
bun run --cwd packages/core test
bun run --cwd packages/plugins test
bun run --cwd packages/backend test
bun run --cwd apps/client build
```

A post-build client bundle guard should not find server-only secrets or SDKs:

```bash
rg "WORKOS_API_KEY|PATCHPLANE_SYSTEM_INGESTION_SECRET|GITHUB_PRIVATE_KEY|GITHUB_WEBHOOK_SECRET|octokit|github-runtime|workos-node|api.workos.com" apps/client/dist/client
```

## Effect

Effect is used for the control-plane core:

- `packages/domain` uses `effect/Schema` for shared models
- `packages/core` defines Effect service contracts and workflows
- `packages/plugins` provides Effect layers for real infrastructure
- `apps/client` composes app and GitHub runtimes with `ManagedRuntime`
