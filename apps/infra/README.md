# PatchPlane Infra

Minimal alpha infrastructure provisioning for PatchPlane. This app uses Alchemy for deploy-time provisioning. Runtime code may use the narrow `alchemy/Cloudflare/Bridge` adapter for Cloudflare service bindings, but resource provisioning stays isolated here.

## Resources

The stack provisions, per stage:

- Cloudflare R2 bucket for evidence artifacts.
- Cloudflare AI Gateway for model-provider routing.
- Dedicated source-control Worker for webhooks, GitHub installation sync, Daytona/Pi orchestration, and repository publication.
- TanStack Start client Worker deployed with a service binding to the source-control Worker.

Default physical names use the Alchemy stage:

```text
patchplane-<stage>-evidence-artifacts
patchplane-<stage>
```

Stages are normalized to lowercase kebab-case for Cloudflare resource names.

## Required deployment environment

For CI/non-interactive deploys, provide Cloudflare credentials accepted by Alchemy/Cloudflare:

```sh
CLOUDFLARE_ACCOUNT_ID=...
CLOUDFLARE_API_TOKEN=...
```

Local commands automatically load the repository root `.env.local` via Alchemy's `--env-file ../../.env.local` when that file exists, even though the scripts run with `--cwd apps/infra`. CI can either provide environment variables directly or create/populate `.env.local` before invoking the scripts.

Local deploys may also use an Alchemy Cloudflare profile/login flow.

## Provisioning constants

The alpha defaults are constants in `alchemy.run.ts`:

```ts
artifactRetentionDays = 14
aiGatewayCollectLogs = false
aiGatewayRateLimitPerMinute = 120
```

AI Gateway request logs are disabled by default. Change the constant only when logs are needed for operational debugging.

## Commands

From this directory:

```sh
bun run dev -- --stage dev
bun run plan -- --stage dev
bun run deploy -- --stage dev
bun run destroy -- --stage dev
bun run test
```

The `dev`, `plan`, `deploy`, and `destroy` scripts forward extra CLI arguments and load `../../.env.local` when present.

From the repo root:

```sh
bun run infra:dev -- --stage dev
bun run infra:plan -- --stage dev
bun run infra:deploy -- --stage dev
bun run infra:destroy -- --stage dev
```

## Local development

`alchemy dev` still provisions real Cloudflare resources. The client Worker receives a `SOURCE_CONTROL_WORKER` service binding so app callback code can call the dedicated source-control Worker without a public internal URL.

## Live integration test

The Vitest suite uses `alchemy/Test/Vitest`. It is skipped by default to avoid provisioning resources unexpectedly.

To run it, temporarily set these constants in `alchemy.run.test.ts`:

```ts
liveInfraTest = true
destroyAfterLiveTest = true
liveStage = 'test'
```

Keep `destroyAfterLiveTest = false` when you want Alchemy state to reuse the stage across runs.

## Runtime outputs

The stack output includes values intended for later runtime plugins:

```text
PATCHPLANE_EVIDENCE_R2_BUCKET
PATCHPLANE_AI_GATEWAY_ID
CLOUDFLARE_ACCOUNT_ID
```

Do not use Alchemy provisioning APIs from runtime packages for object uploads, signed URLs, or model calls. Runtime access belongs behind PatchPlane plugin/service boundaries; the `alchemy/Cloudflare/Bridge` import is only for service-binding transport adaptation.
