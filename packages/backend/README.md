# `@patchplane/backend`

Convex deployment functions live in this package on purpose. The app and plugins call Convex through PatchPlane-owned service boundaries; Convex functions remain the deployment/database API and enforce Convex-side validation, authorization, and transactional writes.

## Commands

```bash
bun run dev
```

Starts `convex dev` from `packages/backend`.

```bash
bun run codegen
```

Generates `convex/_generated/*` once a Convex deployment has been configured.

```bash
bun run typecheck
```

Runs Convex TypeScript typechecking.

```bash
bun run lint
```

Runs `oxlint` over backend source plus the focused ESLint pass over `convex/` for Convex-specific rules.

```bash
bun run test
```

Runs Convex tests, including WorkOS auth mirroring, authenticated workflow-start authorization, signed external intake, and redelivery dedupe.

## Current Convex boundaries

User-facing workflow starts:

```text
workflowStarts:create
→ WorkOS JWT identity
→ active mirrored membership
→ prompt:create permission
→ actor/workspace/source anti-spoofing
→ promptRequests + workflowRuns
```

External/provider workflow starts:

```text
workflowStarts:createFromExternalIntake
→ PATCHPLANE_SYSTEM_INGESTION_SECRET
→ externalWorkflowRefs idempotency checks
→ promptRequests + workflowRuns + externalWorkflowRefs
```

Current read paths require WorkOS identity and mirrored membership permissions where appropriate.

## GitHub App setup for the current alpha

PatchPlane should keep the GitHub App scoped to the minimum currently implemented slice.

Required permissions for the current incoming-PR path:

- repository `Metadata: Read-only`;
- repository `Contents: Read-only` for immutable comparison and exact clone;
- repository `Pull requests: Read and write` for PR intake and decision comments;
- repository `Checks: Read and write` for exact-head check runs; and
- organization `Members: Read-only` to prove organization-installation ownership during connection.

Subscribe to **Pull request** events so `opened` and `synchronize` deliveries enter the hosted execution route. Do not subscribe to Issues or Issue comments for the current alpha path; those normalized event foundations are not routed into hosted execution.

Required app/client server environment for webhook-to-workflow creation:

```text
GITHUB_APP_ID
GITHUB_CLIENT_ID
GITHUB_CLIENT_SECRET
PATCHPLANE_GITHUB_OAUTH_CALLBACK_URL
GITHUB_PRIVATE_KEY
GITHUB_WEBHOOK_SECRET
CONVEX_URL or VITE_CONVEX_URL
PATCHPLANE_SYSTEM_INGESTION_SECRET
PATCHPLANE_GITHUB_ALLOWED_REPOSITORIES=owner/repo,another/repo
PATCHPLANE_GITHUB_WORKSPACE_ID or PATCHPLANE_WORKOS_ORGANIZATION_ID
```

Authenticated PR decision publication is wired end to end through the permissions above. PatchPlane mints repository-scoped temporary tokens with only `pull_requests: write` for the PR comment or `checks: write` for the check run and revokes them afterward. The generic issue-comment adapter can use `issues: write`, but that permission is not required by the current incoming-PR route. Do not enable broader permissions or extra webhook subscriptions.
