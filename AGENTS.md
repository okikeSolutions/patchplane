# Patchplane contribution guide

Patchplane turns AI-generated changes into evidence-backed Patch Reports. Treat
every code change as untrusted until the relevant automated evidence and human
review are complete.

## Start here

- Read `README.md` for the current product slice and workspace map.
- Read `SPEC.md` for the product and security model; do not infer trust-boundary
  rules from provider SDK conventions.
- Read `docs/acceptance-tests.md` before changing an alpha claim, a live smoke,
  or release readiness.
- Read a more-specific `AGENTS.md` when one exists. In particular, Convex work
  must begin with `packages/backend/convex/_generated/ai/guidelines.md`.

## Architecture rules

- `packages/domain` contains Patchplane-owned schemas and types only.
- `packages/core` is provider-agnostic. It must not import application,
  provider, infrastructure, or vendor SDK code.
- Provider implementations belong in `packages/plugins`; applications and
  Workers compose those implementations at the boundary.
- The hosted control plane is trusted. Browser input, webhook payloads, sandbox
  output, and Pi JSONL are untrusted until decoded into Patchplane-owned types.
- Pi runs in the Daytona sandbox for the hosted path. Do not bundle Pi runtime
  packages into the client or control-plane Worker.
- Convex holds normalized workflow truth and provenance metadata; R2 holds raw
  evidence artifacts. Telemetry and analytics are never a provenance store.
- Keep long-lived WorkOS, Convex, GitHub App, and control-plane credentials out
  of sandbox inputs and generated client bundles.

The architecture suite is the executable form of these rules. Extend it when a
new boundary is introduced; do not paper over a failure by moving an import.

## Commands

```sh
bun install --frozen-lockfile
bun run verify:fast  # types, lint, unit/integration tests, CLI eval
bun run verify       # fast gate plus production build and Cloudflare bundle budgets
```

Run the narrow package tests while iterating, then run `bun run verify` before
handoff. The full gate is required for all changes that can affect the client,
runtime composition, dependencies, build tooling, or shared packages.

Credentialed checks are opt-in and never belong in ordinary PR CI:

```sh
bun run smoke:foundation
bun run smoke:daytona-rpc
bun run smoke:trust-loop
PATCHPLANE_LIVE_INFRA_TEST=true bun run test:infra
```

Never print, commit, or paste secret values from `.env.local`. Use `patchplane
env template` and `patchplane env check` rather than inventing environment
variables. Put non-secret user config in `patchplane.config.json` and generated
local state in `.patchplane/`.

## Change protocol

1. Find the owning boundary before editing. Keep cross-package changes narrow.
2. Add or update a regression test at the lowest useful layer. Use black-box
   CLI evals for user-facing CLI contracts and live smoke tests only for real
   provider behavior.
3. Update the acceptance matrix, README, config help, and/or plugin registry
   when a user-visible capability, environment input, or evidence claim changes.
4. Do not edit generated files by hand. If a generator changes a committed file,
   include the generated output in the same change and verify it is stable.
5. Record validation in the PR using `REVIEW.md` as the risk checklist.

## Automation rule

If a review finding is mechanically decidable, encode it as a type, lint rule,
architecture check, test, or CI gate. If it is a repeatable workflow, make it a
script. Keep human judgment in `REVIEW.md`, and keep this file short enough to
be read before every task.
