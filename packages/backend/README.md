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
