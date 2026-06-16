# PatchPlane

Open-source pre-CI sandbox and trust layer for AI-generated code changes.

PatchPlane treats every AI-generated patch as untrusted until it has been executed, validated, and reported from an isolated environment. It helps maintainers and teams keep normal GitHub and CI/CD workflows while adding a trust boundary before generated code reaches secrets, shared caches, trusted automation, or merge paths.

Core docs:

- [SPEC.md](./SPEC.md): stable product thesis, architecture, and MVP success criteria
- [ROADMAP.md](./ROADMAP.md): open, active, and completed delivery work
- [docs/foundation-smoke.md](./docs/foundation-smoke.md): repeatable foundation smoke validation

## Workspace

This repository is scaffolded as a Bun monorepo with a deliberately small initial footprint:

- `apps/client`: TanStack Start client app with a public landing page at `/` and the product shell at `/app`
- `packages/backend`: Convex-backed control-plane backend and deployment functions
- `packages/domain`: shared core types and Effect schemas
- `packages/core`: Effect service contracts and workflow logic
- `packages/plugins`: concrete infrastructure plugins, starting with Convex storage

## Getting Started

```bash
bun install
bun run dev:client
```

In a second terminal:

```bash
bun run dev:backend
```

## Foundation smoke validation

After configuring `CONVEX_URL`, run the current end-to-end foundation smoke check:

```bash
CONVEX_URL="https://<deployment>.convex.cloud" bun run smoke:foundation "Smoke prompt"
```

See [docs/foundation-smoke.md](./docs/foundation-smoke.md) for expected output and inspection commands.

## Effect

Effect is set up for the control-plane core:

- `packages/domain` uses `effect/Schema` for shared models
- `packages/core` defines Effect service contracts and workflows
- `packages/plugins` provides Effect layers for real infrastructure
- `apps/client` composes the runtime with `ManagedRuntime`
