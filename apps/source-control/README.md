# `@patchplane/source-control-worker`

Dedicated Cloudflare Worker for hosted alpha source-control control-plane work.

Current provider implementation lives under `src/github/` and exposes:

- `POST /api/github/webhook` — GitHub App webhook verification, workflow intake, Daytona/Pi sandbox execution, and GitHub publication.
- `POST /internal/github/install/sync` — service-binding-only GitHub install sync endpoint called by `apps/client` after the WorkOS-authenticated callback consumes a Convex connection intent.

`src/worker.ts` is intentionally a small router so future providers can be added beside `src/github/` without turning the Worker entrypoint into a provider-specific module.

`apps/client` communicates with this Worker through a Cloudflare `SOURCE_CONTROL_WORKER` service binding and Alchemy's `Cloudflare.toHttpClient(Cloudflare.fromCloudflareFetcher(...))` bridge, not through a public URL.

Required runtime secrets/env mirror the GitHub webhook surface: GitHub App credentials, Convex URL/system ingestion secret, Daytona API key, and optional model provider keys for `daytona-pi`.
