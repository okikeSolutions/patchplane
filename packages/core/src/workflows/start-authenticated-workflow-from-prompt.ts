import { Effect } from 'effect'
import type { PromptRequestSource } from '@patchplane/domain/prompt-request'
import { AuthRequestContext } from '../services/auth-request-context'
import { AuthService } from '../services/auth-service'
import { StorageService } from '../services/storage-service'

export interface StartAuthenticatedWorkflowFromPromptInput {
  readonly traceId: string
  readonly prompt: string
  readonly source?: PromptRequestSource
}

export const StartAuthenticatedWorkflowFromPrompt = Effect.fn(
  '@patchplane/core/workflows/StartAuthenticatedWorkflowFromPrompt',
)(function*(input: StartAuthenticatedWorkflowFromPromptInput) {
  yield* Effect.annotateCurrentSpan({
    traceId: input.traceId,
    source: input.source ?? 'app',
  })

  yield* Effect.logInfo('Starting authenticated workflow from prompt')

  const auth = yield* AuthService

  const request = yield* AuthRequestContext
  const actor = yield* auth.getCurrentActor
  const workspace = yield* auth.getCurrentWorkspace
  yield* auth.requirePermission('prompt:create')

  const storage = yield* StorageService
  const result = yield* storage.createWorkflowFromPrompt({
    actor,
    workspaceId: workspace.id,
    source: input.source ?? 'app',
    traceId: input.traceId,
    prompt: input.prompt,
    ...(request.accessToken === undefined
      ? {}
      : { authToken: request.accessToken }),
  })

  yield* Effect.logInfo('Started authenticated workflow from prompt', {
    actorId: actor.id,
    workspaceId: workspace.id,
    promptRequestId: result.promptRequest.id,
    workflowRunId: result.workflowRun.id,
  })

  return result
})
