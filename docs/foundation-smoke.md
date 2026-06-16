# Foundation Smoke Validation

This is the repeatable validation path for the current PatchPlane v2 foundation experiment.

It verifies the authenticated non-UI control-plane loop:

```text
Effect ManagedRuntime
→ StorageService.createWorkflowFromPrompt
→ ConvexStoragePlugin with WorkOS access token
→ workflowStarts:create
→ promptRequests + workflowRuns

Effect ManagedRuntime
→ StorageService.listRecentWorkflowStarts
→ ConvexStoragePlugin with WorkOS access token
→ workflowStarts:listRecent
→ WorkflowStart[] decoded through domain schemas
```

## Prerequisites

1. Convex functions are deployed/checked:

```sh
cd packages/backend
bunx convex dev --once
```

2. `CONVEX_URL` points at the target Convex deployment:

```sh
export CONVEX_URL="https://<deployment>.convex.cloud"
```

For the current dev deployment, the value can be copied from `apps/client/.env.local` or `packages/backend/.env.local`.

3. Provide WorkOS AuthKit identity values for an active organization session:

```sh
export PATCHPLANE_WORKOS_ACCESS_TOKEN="<authkit-access-token>"
export PATCHPLANE_WORKOS_USER_ID="<workos-user-id>"
export PATCHPLANE_WORKOS_ORGANIZATION_ID="<active-workos-organization-id>"
export PATCHPLANE_WORKOS_ACTOR_NAME="Smoke user" # optional
```

The token must authenticate the same user and active organization. The TanStack server path checks WorkOS membership/permissions before calling Convex, and Convex repeats the storage-boundary authorization with mirrored active membership plus `prompt:create` before accepting `workflowStarts:create`.

## Run

From the repository root:

```sh
CONVEX_URL="https://<deployment>.convex.cloud" \
PATCHPLANE_WORKOS_ACCESS_TOKEN="<authkit-access-token>" \
PATCHPLANE_WORKOS_USER_ID="<workos-user-id>" \
PATCHPLANE_WORKOS_ORGANIZATION_ID="<active-workos-organization-id>" \
  bun run smoke:foundation "Smoke prompt"
```

Equivalent app-level command:

```sh
CONVEX_URL="https://<deployment>.convex.cloud" \
PATCHPLANE_WORKOS_ACCESS_TOKEN="<authkit-access-token>" \
PATCHPLANE_WORKOS_USER_ID="<workos-user-id>" \
PATCHPLANE_WORKOS_ORGANIZATION_ID="<active-workos-organization-id>" \
  bun run --cwd apps/client smoke "Smoke prompt"
```

## Expected result

The command should:

1. create a new `PromptRequest`,
2. create a linked `WorkflowRun`,
3. list recent workflow starts for the active WorkOS organization,
4. show the newly-created run in the read-back output,
5. write Effect logs to `.patchplane/logs/effect.jsonl`.

The output should include:

```text
Smoke workflow started successfully.
traceId: ...
promptRequestId: ...
workflowRunId: ...
workflowStatus: queued

Recent workflow starts for workspace workos:<organizationId>:
...
Smoke tests completed successfully.
```

## Inspect logs

Effect logs:

```sh
tail -f .patchplane/logs/effect.jsonl
```

Expected Effect log messages include:

```text
Calling Convex workflowStarts:create
Convex workflowStarts:create succeeded
Calling Convex workflowStarts:listRecent
Convex workflowStarts:listRecent succeeded
```

Convex logs:

```sh
cd packages/backend
bunx convex logs --history 20 --success
```

Convex records:

```sh
cd packages/backend
bunx convex data promptRequests --limit 5
bunx convex data workflowRuns --limit 5
```

## Success criteria

The foundation smoke validation succeeds when one run can be correlated across:

- smoke command output,
- Effect JSONL logs,
- Convex mutation logs,
- `promptRequests`,
- `workflowRuns`.

The shared correlation field is `traceId`.

WorkOS identities are namespaced:

```text
actorId: workos:<userId>
workspaceId: workos:<organizationId>
```
