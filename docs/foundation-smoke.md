# Foundation Smoke Validation

This is the repeatable validation path for the current PatchPlane v2 foundation experiment.

It verifies the non-UI control-plane loop:

```text
Effect ManagedRuntime
→ StartWorkflowFromPrompt
→ StorageService.createWorkflowFromPrompt
→ ConvexStoragePlugin
→ workflowStarts:create
→ promptRequests + workflowRuns

Effect ManagedRuntime
→ ListRecentWorkflowStarts
→ StorageService.listRecentWorkflowStarts
→ ConvexStoragePlugin
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

## Run

From the repository root:

```sh
CONVEX_URL="https://<deployment>.convex.cloud" \
  bun run smoke:foundation "Smoke prompt"
```

Equivalent app-level command:

```sh
CONVEX_URL="https://<deployment>.convex.cloud" \
  bun run --cwd apps/client smoke "Smoke prompt"
```

## Expected result

The command should:

1. create a new `PromptRequest`,
2. create a linked `WorkflowRun`,
3. list recent workflow starts,
4. show the newly-created run in the read-back output,
5. write Effect logs to `.patchplane/logs/effect.jsonl`.

The output should include:

```text
Smoke workflow started successfully.
traceId: ...
promptRequestId: ...
workflowRunId: ...
workflowStatus: queued

Recent workflow starts for workspace dev-workspace:
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
Starting workflow from prompt
Calling Convex workflowStarts:create
Convex workflowStarts:create succeeded
Started workflow from prompt
Listing recent workflow starts
Calling Convex workflowStarts:listRecent
Convex workflowStarts:listRecent succeeded
Listed recent workflow starts
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
