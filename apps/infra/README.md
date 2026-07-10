# PatchPlane Infra

PatchPlane infrastructure is defined by the canonical root stack:

```text
/alchemy.run.ts
```

This package contains support code for that stack:

- `config.ts` — deploy-time environment binding definitions.
- `utils.ts` — Cloudflare-safe physical-name helpers.
- `*.test.ts` — infra utility and optional live stack tests.

Do not add a second `apps/infra/alchemy.run.ts`; keep the root stack as the single source of truth, matching Alchemy's monorepo single-stack pattern.

## Resources

The root stack provisions, per stage:

- Cloudflare R2 bucket for evidence artifacts.
- Cloudflare AI Gateway for model-provider routing.
- Dedicated source-control Worker for webhooks, GitHub installation sync, Daytona/Pi orchestration, and repository publication.
- Public GitHub webhook Worker bound to the source-control Worker.
- TanStack Start client Worker deployed with a service binding to the source-control Worker.

Default physical names use the Alchemy stage:

```text
patchplane-<stage>-evidence-artifacts
patchplane-<stage>-model-gateway
```

Stages are normalized to lowercase kebab-case for Cloudflare resource names.

## Required deployment environment

For CI/non-interactive deploys, provide Cloudflare credentials accepted by Alchemy/Cloudflare:

```sh
CLOUDFLARE_ACCOUNT_ID=...
CLOUDFLARE_API_TOKEN=...
```

Local root commands load `.env.local` via `--env-file .env.local`.

## Commands

From the repo root:

```sh
bun run infra:dev
bun run infra:plan
bun run infra:deploy
bun run infra:destroy
```

The package-local commands delegate to those root scripts, so these also work:

```sh
bun run --cwd apps/infra dev
bun run --cwd apps/infra plan
bun run --cwd apps/infra deploy
bun run --cwd apps/infra destroy
bun run --cwd apps/infra test
```

## Local development

`alchemy dev` provisions/uses real Cloudflare resources and runs local Workers through Alchemy's Cloudflare dev provider. The client Worker receives a `SOURCE_CONTROL_WORKER` service binding so app callback code can call the dedicated source-control Worker without a public internal URL.

If local Website.Vite dev fails with a module-runner WebSocket error, ensure patched dependencies have been applied:

```sh
bun install
```

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

The stack output includes values intended for runtime plugins:

```text
PATCHPLANE_EVIDENCE_R2_BUCKET
PATCHPLANE_AI_GATEWAY_ID
CLOUDFLARE_ACCOUNT_ID
```

Signed artifact URL generation also requires R2 S3 API credentials at deploy
time. Set either:

```text
PATCHPLANE_EVIDENCE_R2_ACCESS_KEY_ID
PATCHPLANE_EVIDENCE_R2_SECRET_ACCESS_KEY
```

or the generic fallback names:

```text
CLOUDFLARE_ACCESS_KEY_ID
CLOUDFLARE_SECRET_ACCESS_KEY
```

These are deployed to the client Worker as secret bindings for
`/api/artifacts/url`. Source-control artifact capture uses the native R2 bucket
binding and does not require these signing credentials.

Optional source-control evidence producer commands can create richer artifacts
inside the Daytona sandbox before capture:

```text
PATCHPLANE_EVIDENCE_TEST_REPORT_COMMAND
PATCHPLANE_EVIDENCE_BROWSER_SCREENSHOT_COMMAND
```

The Daytona plugin uploads `git diff --binary` when the agent changes the
worktree. It also probes conventional files such as
`.patchplane/test-report.json`, `.patchplane/test-report.xml`, and
`.patchplane/browser-screenshot.png` and stores them as R2-backed evidence
artifacts when present.

Do not use Alchemy provisioning APIs from runtime packages for object uploads, signed URLs, or model calls. Runtime access belongs behind PatchPlane plugin/service boundaries; the `alchemy/Cloudflare/Bridge` import is only for service-binding transport adaptation.
