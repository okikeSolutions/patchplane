# `@patchplane/client`

PatchPlane's TanStack Start app and server composition root.

This app owns framework integration:

- TanStack Router/Start routes and server functions,
- WorkOS AuthKit UI/session integration,
- Convex client/AuthKit integration,
- lightweight GitHub install callback handoff to the dedicated source-control Worker,
- Effect `ManagedRuntime` composition,
- UI shell and workflow prompt/read-model surfaces.

Core workflow logic lives in `packages/core`; infrastructure SDKs are wrapped in `packages/plugins`.

## Commands

```bash
bun run dev
bun run build
bun run test
bun run typecheck
```

From the repository root, these are usually invoked as:

```bash
bun run dev:client
bun run build:client
bun run typecheck
```

## Runtime composition

Current runtime:

- `src/effect/runtime.ts` — the PatchPlane `ManagedRuntime` for app/server route execution.
- `src/effect/app-layer.ts` — app runtime layer for WorkOS, Convex, telemetry, and web crypto.
- `src/effect/patchplane-config.ts` — loads non-secret PatchPlane project config.

Server functions and API routes dynamically import the runtime only inside server handlers so server-only SDK code does not enter the browser bundle.

`patchplane.config.json` is CLI-managed, user-visible project config. The `.patchplane/` directory is reserved for generated local artifacts such as logs, cache, and state.

## Routes of interest

- `/` — landing page.
- `/app` — authenticated alpha workflow prompt/read-model shell.
- `/api/auth/sign-in` and `/api/auth/callback` — WorkOS AuthKit hosted sign-in flow.
- `/api/github/install/start` — hosted GitHub App installation start.
- `/api/github/install/callback` — hosted GitHub App installation callback.
- `/api/github/webhook` — compatibility stub; hosted GitHub webhook intake runs in `apps/source-control`.

## GitHub webhook intake

Required headers:

```text
x-github-delivery
x-github-event
x-hub-signature-256
```

Required server environment for creating workflows from webhooks:

```text
GITHUB_APP_ID
GITHUB_PRIVATE_KEY
GITHUB_WEBHOOK_SECRET
CONVEX_URL or VITE_CONVEX_URL
PATCHPLANE_SYSTEM_INGESTION_SECRET
PATCHPLANE_GITHUB_APP_SLUG or PATCHPLANE_GITHUB_APP_INSTALL_URL
PATCHPLANE_PUBLIC_APP_URL=https://<id>.ngrok-free.app
PATCHPLANE_GITHUB_ALLOWED_REPOSITORIES=owner/repo,another/repo # local/self-host fallback
PATCHPLANE_GITHUB_WORKSPACE_ID or PATCHPLANE_WORKOS_ORGANIZATION_ID
```

Hosted flow:

```text
/api/github/install/start
→ Convex pending GitHub connection intent
→ GitHub App installation screen
→ /api/github/install/callback
→ Octokit installation repository listing
→ Convex connected repositories
→ source-control Worker /api/github/webhook
→ GitHubWebhookService.verifyWebhook
→ Convex connected repository lookup by installation/repository id
→ StartWorkflowFromIntake
→ sandbox verification
→ GitHub PR trust report comment
```

Local/self-host fallback can still route through `PATCHPLANE_GITHUB_ALLOWED_REPOSITORIES` and `PATCHPLANE_GITHUB_WORKSPACE_ID` / `PATCHPLANE_WORKOS_ORGANIZATION_ID`.

Run the hosted smoke checklist with:

```bash
bun run --cwd apps/client smoke:github-hosted -- --base-url=https://<id>.ngrok-free.app
```

The success response is intentionally compact and returns IDs/provider metadata rather than echoing full webhook payloads.

## Styling and UI

The app uses Tailwind CSS and local UI components in `src/components/ui`. Do not fork a full dashboard starter; compose future dashboard/review screens from the existing shell and components.

## Client-bundle guard

After `bun run build`, server-only SDKs and secrets should not appear in client assets:

```bash
rg "WORKOS_API_KEY|PATCHPLANE_SYSTEM_INGESTION_SECRET|GITHUB_PRIVATE_KEY|GITHUB_WEBHOOK_SECRET|octokit|workos-node|api.workos.com" dist/client
```

No matches are expected.
