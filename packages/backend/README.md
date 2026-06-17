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

Required repository permissions for inbound intake and repository access verification:

- `Metadata: Read-only`
- `Issues: Read-only`

Required webhook subscriptions:

- `Issues` for `issues.opened`
- `Issue comments` for `issue_comment.created`; PR issue comments are normalized as `github.pull_request_comment.created`

Required app/client server environment for webhook-to-workflow creation:

```text
GITHUB_APP_ID
GITHUB_PRIVATE_KEY
GITHUB_WEBHOOK_SECRET
CONVEX_URL or VITE_CONVEX_URL
PATCHPLANE_SYSTEM_INGESTION_SECRET
PATCHPLANE_GITHUB_ALLOWED_REPOSITORIES=owner/repo,another/repo
PATCHPLANE_GITHUB_WORKSPACE_ID or PATCHPLANE_WORKOS_ORGANIZATION_ID
```

Outbound issue-comment publication is implemented in the GitHub provider plugin as a generic source-control `createIssueComment` capability. When publication is wired end to end, the GitHub App will additionally need:

- `Issues: Read and write`

Future check/draft PR publication will require:

- `Checks: Read and write`
- `Pull requests: Read and write`

Do not enable broader repository permissions or extra webhook subscriptions until the matching runtime paths are live.
