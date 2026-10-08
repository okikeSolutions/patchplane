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

The shared server-function adapter loads the runtime through
`createServerOnlyFn`. Router tracing and error capture use `createClientOnlyFn`,
so browser Sentry instrumentation is removed from SSR.

## Build runtime boundaries

`vite.config.ts` enables production minification for the Worker output and
rejects imports that cross the browser/Worker boundary. Alchemy already supplies
Worker resolution conditions and Node compatibility; browser builds receive no
Node polyfills.

`build/runtime-boundaries.ts` checks emitted module identities after framework
transforms and tree shaking. Browser output must contain no Sentry server SDKs,
Node builtin imports, or Vite browser-external replacements. Worker output must
contain no Sentry React or Browser SDK. The build writes local module evidence
under the root `.patchplane/state/build/` directory.

`bun run build:client` produces the standalone Vite output. The root
`bun run bundle:check:client` rebuilds through Alchemy and checks the deployable
Cloudflare output against the existing budgets. `bun run verify` runs both paths.
The server-function manifest check parses JavaScript syntax, including
minified template literals, instead of depending on formatting.

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
GITHUB_CLIENT_ID
GITHUB_CLIENT_SECRET
PATCHPLANE_GITHUB_OAUTH_CALLBACK_URL
GITHUB_PRIVATE_KEY
GITHUB_WEBHOOK_SECRET
CONVEX_URL or VITE_CONVEX_URL
PATCHPLANE_SYSTEM_INGESTION_SECRET
PATCHPLANE_GITHUB_APP_SLUG or PATCHPLANE_GITHUB_APP_INSTALL_URL
PATCHPLANE_PUBLIC_APP_URL=https://<id>.ngrok-free.app
PATCHPLANE_GITHUB_ALLOWED_REPOSITORIES=owner/repo,another/repo # local/self-host fallback
PATCHPLANE_GITHUB_WORKSPACE_ID or PATCHPLANE_WORKOS_ORGANIZATION_ID
```

Configure the GitHub App **Setup URL** and **Callback URL** to `/api/github/install/callback`. Keep GitHub's **Request user authorization (OAuth) during installation** option disabled: PatchPlane first stages the setup callback's `installation_id`, then starts its own state-bound PKCE authorization. Enable **expiring user access tokens**; PatchPlane rejects non-expiring OAuth responses and revokes the temporary token after ownership verification. A network timeout after GitHub commits issuance but before returning the token is an unavoidable distributed ambiguity; the enforced eight-hour access-token and six-month refresh-token limits bound it, and operators should revoke the app authorization if provider logs show such a failed exchange.

Hosted flow:

```text
/api/github/install/start
→ Convex pending GitHub connection intent
→ GitHub App installation screen
→ /api/github/install/callback stages the installation and PKCE verifier
→ GitHub user authorization callback consumes one-time state
→ source-control Worker verifies GitHub installation account control
→ temporary user token revocation
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
