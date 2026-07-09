# `patchplane`

Publishable PatchPlane CLI for interactive OSS onboarding, project config generation, plugin discovery, environment setup, and diagnostics.

Status: alpha/experimental. The CLI is safe to use for local setup and diagnostics, but command contracts may still evolve before a stable release.

The CLI is built with `effect/unstable/cli`, Effect `Terminal` prompts, `@effect/platform-node`, and PatchPlane-owned Effect services. It is interactive when both stdin and stdout are TTYs, and fully scriptable for CI, automation, and coding agents.

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

## Automation contract

Global flags:

```bash
patchplane --cwd /path/to/repo doctor
patchplane --cwd=/path/to/repo init --profile app --yes
patchplane --config /path/to/patchplane.config.json doctor
patchplane --dotenv /path/to/.env.local env check --surface app
```

Machine-readable JSON output is available for diagnostics and discovery:

```bash
patchplane init --profile app --dry-run --yes --json
patchplane doctor --json
patchplane env check --surface app --json
patchplane plugins list --json
patchplane plugins explain daytona --json
```

Stdout/stderr rules:

- human command output and JSON payloads go to stdout
- validation/failure summaries go to stderr in human mode
- JSON mode emits parseable JSON to stdout without progress prose
- JSON failure commands set a non-zero exit code without adding human prose to stderr

See [`CONTRACT.md`](./CONTRACT.md) for the CLI automation contract.

Mutation-safety rules:

- `--dry-run` writes no files
- `init` preserves existing non-empty `.env.local` values
- `--cwd` scopes repo reads/writes to the selected directory

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

- `app`: `convex`, `workos`, `observability`, `sentry`
- `githubWebhook`: `github`, `convex`, `daytona`, `observability`, `sentry`
- `full`: app + GitHub webhook plugins

`--with-pi` is only valid for `githubWebhook` and `full`; it sets `runtime.githubWebhookExecution` to `daytona-pi`. Pi runs inside the Daytona sandbox for the alpha path; the experimental in-process `pi` plugin is not added to generated web/runtime config.

`init` writes non-secret config to `patchplane.config.json`, appends missing required keys to `.env.local`, and creates `.patchplane/{logs,cache,state}`. Existing `.env.local` values are preserved.

## Environment commands

```bash
bun run patchplane env template --surface app
bun run patchplane env template --surface githubWebhook
bun run patchplane env template --plugins github,convex,daytona
bun run patchplane env template --surface githubWebhook --include-optional
bun run patchplane env check --surface githubWebhook
```

Known env files loaded by `env check`:

- `.env`
- `.env.local`
- `apps/client/.env.local`
- `packages/backend/.env.local`

Pass `--dotenv <file>` one or more times to load explicit dotenv files after the known project env files. `--env-file <file>` is accepted as an alias for automation. Non-empty process environment values still win over file values.

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
