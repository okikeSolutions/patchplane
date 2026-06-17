# `@patchplane/client`

PatchPlane's TanStack Start app and server composition root.

This app owns framework integration:

- TanStack Router/Start routes and server functions,
- WorkOS AuthKit UI/session integration,
- Convex client/AuthKit integration,
- `/api/github/webhook`,
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

Current runtimes:

- `src/effect/runtime.ts` — normal app runtime composed from WorkOS auth, Convex storage, and observability layers.
- `src/effect/github-runtime.ts` — GitHub webhook runtime composed from GitHub provider, Convex storage, and observability layers. This keeps GitHub env requirements out of ordinary app startup.

Server functions use `src/lib/effect-server-fn.ts`, which dynamically imports the server runtime only inside the server handler so WorkOS server SDK code does not enter the browser bundle.

## Routes of interest

- `/` — landing page.
- `/app` — authenticated alpha workflow prompt/read-model shell.
- `/api/auth/sign-in` and `/api/auth/callback` — WorkOS AuthKit hosted sign-in flow.
- `/api/github/webhook` — GitHub App webhook intake.

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
PATCHPLANE_GITHUB_ALLOWED_REPOSITORIES=owner/repo,another/repo
PATCHPLANE_GITHUB_WORKSPACE_ID or PATCHPLANE_WORKOS_ORGANIZATION_ID
```

Flow:

```text
raw request body
→ GitHubWebhookService.verifyWebhook
→ IngestGitHubWebhookToWorkflowIntake
→ repository allowlist
→ StartWorkflowFromIntake
→ StorageService.createWorkflowFromIntake
```

The success response is intentionally compact and returns IDs/provider metadata rather than echoing full webhook payloads.

## Styling and UI

The app uses Tailwind CSS and local UI components in `src/components/ui`. Do not fork a full dashboard starter; compose future dashboard/review screens from the existing shell and components.

## Client-bundle guard

After `bun run build`, server-only SDKs and secrets should not appear in client assets:

```bash
rg "WORKOS_API_KEY|PATCHPLANE_SYSTEM_INGESTION_SECRET|GITHUB_PRIVATE_KEY|GITHUB_WEBHOOK_SECRET|octokit|github-runtime|workos-node|api.workos.com" dist/client
```

No matches are expected.
