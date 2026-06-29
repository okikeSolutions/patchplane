import { AuthRequestContext } from '@patchplane/core/services/auth-request-context'
import { StartAuthenticatedWorkflowFromPrompt } from '@patchplane/core/workflows/start-authenticated-workflow-from-prompt'
import { publicErrorMessage } from '@patchplane/domain/errors'
import { StartWorkflowPromptInput } from '@patchplane/domain/start-workflow'
import type { WorkflowStart } from '@patchplane/domain/workflow-start'
import { Effect } from 'effect'
import { effectServerFn } from './effect-server-fn'
import { getWorkOSAuthRequest } from './workos-auth-request'

export const startWorkflowServerFn = effectServerFn({
  method: 'POST',
  input: StartWorkflowPromptInput,
  operation: 'startWorkflowServerFn',
  effect: (data, context) =>
    Effect.promise(() => getWorkOSAuthRequest()).pipe(
      Effect.flatMap((authRequest) =>
        StartAuthenticatedWorkflowFromPrompt({
          source: 'app',
          traceId: context.traceId,
          prompt: data.prompt,
        }).pipe(Effect.provideService(AuthRequestContext, authRequest))
      ),
    ),
  success: (workflowStart: WorkflowStart) => ({
    workflowStart: {
      promptRequest: {
        id: workflowStart.promptRequest.id,
        workspaceId: workflowStart.promptRequest.workspaceId,
        actorId: workflowStart.promptRequest.actorId,
        traceId: workflowStart.promptRequest.traceId,
        source: workflowStart.promptRequest.source,
        prompt: workflowStart.promptRequest.prompt,
        status: workflowStart.promptRequest.status,
        createdAt: workflowStart.promptRequest.createdAt,
      },
      workflowRun: {
        id: workflowStart.workflowRun.id,
        promptRequestId: workflowStart.workflowRun.promptRequestId,
        workspaceId: workflowStart.workflowRun.workspaceId,
        traceId: workflowStart.workflowRun.traceId,
        status: workflowStart.workflowRun.status,
        createdAt: workflowStart.workflowRun.createdAt,
      },
    },
  }),
  failure: (cause: unknown) => ({
    error: publicErrorMessage(cause, 'startWorkflowServerFn failed'),
  }),
})
