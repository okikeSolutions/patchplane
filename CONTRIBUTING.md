# Contributing to PatchPlane

Thanks for helping improve PatchPlane.

## Development setup

```bash
bun install
bun run patchplane init --profile app --yes
bun run dev:backend
bun run dev:client
```

Use `bun run patchplane env template --surface app` or `--surface githubWebhook` to see required local environment variables. Secrets belong in `.env.local` or deployment secret stores, never in `patchplane.config.json`.

## Before opening a PR

Run the checks that match your change:

```bash
bun run typecheck
bun run lint
bun run --cwd packages/cli test
bun run --cwd packages/plugins test
bun run --cwd packages/backend test
```

For client changes, also run:

```bash
bun run --cwd apps/client build
```

## Project boundaries

- Keep provider SDKs in `packages/plugins` or app/server entrypoints.
- Keep `packages/core` provider-agnostic.
- Keep user-visible non-secret config in `patchplane.config.json`.
- Keep generated local state under `.patchplane/`.
- Do not add new environment variables unless they are truly required secrets or deployment inputs.

## Pull requests

Please include:

- a short summary,
- test/validation output,
- screenshots for UI changes when useful,
- notes for any config or migration impact.
