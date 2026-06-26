# PatchPlane Convex functions

This directory contains the Convex deployment functions for PatchPlane's alpha control-plane backend.

Convex currently provides:

- WorkOS/AuthKit backend integration and webhook handling,
- mirrored WorkOS users and organization memberships,
- authenticated workflow-start mutations,
- authenticated/restricted read models for the app UI,
- signed external-ingestion workflow starts,
- generic external workflow reference persistence and idempotency,
- sandbox execution rows with normalized PatchPlane sandbox policy metadata.

## Important files

- `schema.ts` — app tables for users, memberships, prompt requests, workflow runs, `externalWorkflowRefs`, runtime events, and sandbox executions.
- `workflowStarts.ts` — transactional workflow-start creation for user and external intake paths.
- `auth.ts` / `http.ts` / `auth.config.ts` — WorkOS AuthKit and Convex auth plumbing.
- `viewer.ts`, `requests.ts` — authenticated read-model functions used by the app.
- `*.test.ts` — Convex tests for auth mirroring, authorization, workflow creation, and external-intake dedupe.

## Workflow-start boundaries

User flow:

```text
workflowStarts:create
→ ctx.auth.getUserIdentity()
→ workspace matches WorkOS organization
→ actor matches WorkOS subject
→ source must be "app"
→ active mirrored membership includes prompt:create
→ promptRequests + workflowRuns
```

External/provider flow:

```text
workflowStarts:createFromExternalIntake
→ PATCHPLANE_SYSTEM_INGESTION_SECRET
→ source must be "external"
→ dedupe by provider/comment, provider/repository/issue/event, then provider/delivery
→ promptRequests + workflowRuns + externalWorkflowRefs
```

`externalWorkflowRefs` is intentionally generic. Do not add provider-specific tables such as `githubWorkflowRefs` unless the product intentionally accepts provider coupling.

## Development

Run from `packages/backend`:

```bash
bun run dev
bun run typecheck
bun run lint
bun run test
```

Use Convex validators for all args/returns, keep authorization checks inside public functions, and keep provider-specific SDK usage out of Convex functions unless there is a concrete deployment reason.
