import { AuthRequestContext } from '@patchplane/core/services/auth-request-context'
import { StartAuthenticatedWorkflowFromPrompt } from '@patchplane/core/workflows/start-authenticated-workflow-from-prompt'
import { StartWorkflowPromptInput } from '@patchplane/domain/start-workflow'
import { Effect } from 'effect'
import type { Effect as EffectData } from 'effect'
import { effectServerFn } from './effect-server-fn'
import { getWorkOSAuthRequest } from './workos-auth-request'

type WorkflowStart = EffectData.Success<
  ReturnType<typeof StartAuthenticatedWorkflowFromPrompt>
>

export const startWorkflowServerFn = effectServerFn({
  method: 'POST',
  input: StartWorkflowPromptInput,
  operation: 'startWorkflowServerFn',
  effect: (data, { traceId }) =>
    Effect.promise(() => getWorkOSAuthRequest()).pipe(
      Effect.flatMap((authRequest) =>
        StartAuthenticatedWorkflowFromPrompt({
          source: 'app',
          traceId,
          prompt: data.prompt,
        }).pipe(Effect.provideService(AuthRequestContext, authRequest)),
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
})
