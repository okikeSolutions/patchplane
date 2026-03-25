# `@patchplane/backend`

Convex lives in this package on purpose.

## Commands

```bash
bun run dev
```

This starts `convex dev` from `packages/backend`.

```bash
bun run codegen
```

This generates `convex/_generated/*` once a Convex deployment has been configured.

```bash
bun run typecheck
```

This checks the backend core in `src/`.

```bash
bun run typecheck:convex
```

This checks Convex functions after `_generated/server` exists.

```bash
bun run lint
```

This runs `oxlint` first, then a focused ESLint pass over `convex/` for the
Convex-specific rules that Oxlint does not fully cover yet.

## GitHub App Setup

PatchPlane should keep the GitHub App scoped to the minimum currently implemented slice.

Current required repository permissions:

- `Metadata: Read-only`
- `Issues: Read-only`

Current required webhook subscriptions:

- `issue_comment`

This matches the current inbound path:

- install callback plus authoritative repository sync
- verified `issue_comment.created` intake for `/patchplane ...`
- fast `202` webhook acknowledgement with queued background processing
- periodic failed-delivery reconciliation via [crons.ts](/Users/ugouwakwe/Documents/Github/patchplane/packages/backend/convex/crons.ts)

Do not enable broader repository permissions or extra webhook subscriptions until the matching runtime paths are live.

When outbound publication is enabled end to end, PatchPlane will additionally need:

- `Issues: Read and write`
- `Checks: Read and write`
- `Pull requests: Read and write`

The repo-local source of truth for this is [appRequirements.ts](/Users/ugouwakwe/Documents/Github/patchplane/packages/backend/src/github/appRequirements.ts).
