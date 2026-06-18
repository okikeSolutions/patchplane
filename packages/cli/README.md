# `@patchplane/cli`

PatchPlane CLI for interactive OSS onboarding, project config generation, plugin discovery, environment setup, and diagnostics.

The CLI is built with `effect/unstable/cli`, Effect `Terminal` prompts, `@effect/platform-node`, and PatchPlane-owned Effect services. It is interactive when both stdin and stdout are TTYs, and fully scriptable for CI and automation.

## Commands

```bash
patchplane init
patchplane doctor
patchplane env template
patchplane env check
patchplane plugins list
patchplane plugins explain <id>
```

From the repository root, run commands through the workspace script:

```bash
bun run patchplane init
bun run patchplane doctor
```

## Init

Interactive setup:

```bash
bun run patchplane init
```

Non-interactive examples:

```bash
bun run patchplane init --profile app --yes
bun run patchplane init --profile githubWebhook --yes
bun run patchplane init --profile githubWebhook --with-pi --yes
bun run patchplane init --profile full --yes
bun run patchplane init --profile full --with-pi --yes
bun run patchplane init --profile app --dry-run --yes
bun run patchplane init --profile app --force --yes
bun run patchplane init --profile app --non-interactive --yes
```

Profiles:

- `app`: `convex`, `workos`
- `githubWebhook`: `github`, `convex`, `daytona`
- `full`: app + GitHub webhook plugins

`--with-pi` is only valid for `githubWebhook` and `full`; it adds `pi` and sets `runtime.githubWebhookExecution` to `daytona-pi`.

`init` writes non-secret config to `patchplane.config.json`, appends missing required keys to `.env.local`, and creates `.patchplane/{logs,cache,state}`. Existing `.env.local` values are preserved.

## Environment commands

```bash
bun run patchplane env template --surface app
bun run patchplane env template --surface githubWebhook
bun run patchplane env template --plugins github,convex,daytona,pi
bun run patchplane env template --surface githubWebhook --include-optional
bun run patchplane env check --surface githubWebhook
```

Known env files loaded by `env check`:

- `.env`
- `.env.local`
- `apps/client/.env.local`
- `packages/backend/.env.local`

Secrets should stay in local env files or deployment secret stores. Do not put secret values in plugin registry metadata or `patchplane.config.json`.

## Plugin commands

```bash
bun run patchplane plugins list
bun run patchplane plugins explain daytona
```

Plugin metadata lives in `@patchplane/plugins/registry`.

## Diagnostics

```bash
bun run patchplane doctor
bun run patchplane doctor --surface app
bun run patchplane doctor --surface githubWebhook
bun run patchplane doctor --plugins github,convex,daytona
```

`doctor` checks config presence/location, selected plugin ids, and required env vars. Failed checks exit nonzero.

## Files and directories

- `patchplane.config.json`: primary non-secret project config
- `.env.local`: local secrets/env values
- `.patchplane/logs/`: generated logs
- `.patchplane/cache/`: generated cache
- `.patchplane/state/`: generated local state

`.patchplane/` is reserved for generated local artifacts, not user-managed config.
