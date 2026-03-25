# PatchPlane

AI change control plane for coordinating agents and humans around shared software changes.

Core docs:

- [SPEC.md](./SPEC.md): stable product thesis, architecture, and MVP success criteria
- [ROADMAP.md](./ROADMAP.md): open, active, and completed delivery work

## Workspace

This repository is scaffolded as a Bun monorepo with a deliberately small initial footprint:

- `apps/client`: TanStack Start client app with a public landing page at `/` and the product shell at `/app`
- `packages/backend`: Convex-backed control-plane backend, internal runtime and sandbox boundaries, and orchestration services
- `packages/domain`: shared core types and Effect schemas

## Getting Started

```bash
bun install
bun run dev:client
```

In a second terminal:

```bash
bun run dev:backend
```

## Effect

Effect is set up for the control-plane core:

- `packages/domain` uses `effect/Schema` for shared models
- `packages/backend` uses `Effect` for backend programs and orchestration entry points
