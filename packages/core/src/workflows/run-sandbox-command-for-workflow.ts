import { Effect } from 'effect'
import type { WorkflowStart } from '@patchplane/domain/workflow-start'
import { PrepareRepositoryClone } from '../repository/prepare-repository-clone'
import { SandboxService } from '../services/sandbox-service'
import { StorageService } from '../services/storage-service'

export const RunSandboxCommandForWorkflow = Effect.fn(
  '@patchplane/core/workflows/RunSandboxCommandForWorkflow',
)(function*(input: {
  readonly workflowStart: WorkflowStart
  readonly command: string
  readonly timeoutSeconds?: number | undefined
}) {
  const clone = yield* PrepareRepositoryClone(input.workflowStart)

  if (clone === undefined) {
    return undefined
  }

  yield* Effect.annotateCurrentSpan({
    traceId: input.workflowStart.workflowRun.traceId,
    workflowRunId: input.workflowStart.workflowRun.id,
    repositoryFullName: clone.repositoryFullName,
  })

  const sandbox = yield* SandboxService
  const storage = yield* StorageService
  const result = yield* sandbox.runRepositoryCommand({
    ...clone,
    command: input.command,
    timeoutSeconds: input.timeoutSeconds,
    traceId: input.workflowStart.workflowRun.traceId,
  })

  return yield* storage.recordSandboxExecution({
    workflowRunId: input.workflowStart.workflowRun.id,
    provider: result.provider,
    sandboxId: result.sandboxId,
    command: result.command,
    status: result.exitCode === 0 ? 'succeeded' : 'failed',
    ...(result.exitCode === undefined ? {} : { exitCode: result.exitCode }),
    stdout: result.stdout,
    ...(result.stderr === undefined ? {} : { stderr: result.stderr }),
    ...(result.policy === undefined ? {} : { policy: result.policy }),
    startedAt: result.startedAt,
    completedAt: result.completedAt,
  })
})
