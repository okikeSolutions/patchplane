import { Effect } from 'effect'
import type { WorkflowStart } from '@patchplane/domain/workflow-start'
import { PrepareRepositoryClone } from '../repository/prepare-repository-clone'
import { SandboxService } from '../services/sandbox-service'
import { StorageService } from '../services/storage-service'

export const RunSandboxAgentForWorkflow = Effect.fn(
  '@patchplane/core/workflows/RunSandboxAgentForWorkflow',
)(function*(input: {
  readonly workflowStart: WorkflowStart
  readonly provider: string
  readonly model: string
  readonly apiKey?: string | undefined
  readonly timeoutSeconds?: number | undefined
}) {
  const clone = yield* PrepareRepositoryClone(input.workflowStart)

  if (clone === undefined) {
    return undefined
  }

  const sandbox = yield* SandboxService
  const storage = yield* StorageService
  const result = yield* sandbox.runRepositoryAgent({
    ...clone,
    prompt: input.workflowStart.promptRequest.prompt,
    provider: input.provider,
    model: input.model,
    apiKey: input.apiKey,
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
    startedAt: result.startedAt,
    completedAt: result.completedAt,
  })
})
