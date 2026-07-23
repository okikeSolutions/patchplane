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

Use the repository gates rather than assembling an ad-hoc command list:

```bash
bun install --frozen-lockfile
bun run verify:fast
bun run verify
```

`verify:fast` covers typechecking, linting, tests, and the CLI eval. `verify`
is the complete non-credentialed gate and additionally validates the production
client and Cloudflare bundle budgets. GitHub runs `verify` on every pull
request; a passing local run keeps feedback fast.

Use [AGENTS.md](./AGENTS.md) for the contribution protocol and
[REVIEW.md](./REVIEW.md) for Patchplane-specific trust-boundary checks.

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
