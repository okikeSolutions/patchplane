import { Effect } from 'effect'
import type { StartWorkflowInput } from '@patchplane/domain/start-workflow'
import { StorageService } from '../services/storage-service'

export const StartWorkflowFromPrompt = Effect.fn(
  '@patchplane/core/workflows/StartWorkflowFromPrompt',
)(function*(input: StartWorkflowInput) {
  yield* Effect.annotateCurrentSpan({
    traceId: input.traceId,
    actorId: input.actor.id,
    workspaceId: input.workspace.id,
    source: input.source,
  })

  yield* Effect.logInfo('Starting workflow from prompt')

  const storage = yield* StorageService

  const result = yield* storage.createWorkflowFromPrompt({
    actor: input.actor,
    workspaceId: input.workspace.id,
    source: input.source,
    traceId: input.traceId,
    prompt: input.prompt,
  })

  yield* Effect.logInfo('Started workflow from prompt', {
    promptRequestId: result.promptRequest.id,
    workflowRunId: result.workflowRun.id,
  })

  return result
})
