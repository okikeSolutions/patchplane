import { createServerFn } from '@tanstack/react-start'
import { AuthRequestContext } from '@patchplane/core/services/auth-request-context'
import { StartAuthenticatedWorkflowFromPrompt } from '@patchplane/core/workflows/start-authenticated-workflow-from-prompt'
import { publicErrorMessage, ValidationError } from '@patchplane/domain/errors'
import { StartWorkflowPromptInput } from '@patchplane/domain/start-workflow'
import { Cause, Effect, Exit, Schema } from 'effect'
import { getWorkOSAuthRequest } from './workos-auth-request'

const standardInput = Schema.toStandardSchemaV1(StartWorkflowPromptInput)

export const startWorkflowServerFn = createServerFn({ method: 'POST', strict: false })
  .validator(async (input: unknown) => {
    const result = await standardInput['~standard'].validate(input)
    if ('issues' in result) {
      throw new ValidationError({
        message: 'Invalid server function input',
        cause: result.issues,
      })
    }
    return result.value
  })
  .handler(async ({ data }: { readonly data: typeof StartWorkflowPromptInput.Type }) => {
    if (!import.meta.env.SSR) {
      return {
        ok: false as const,
        traceId: globalThis.crypto?.randomUUID?.() ?? 'client',
        error: 'Server functions must run on the server',
      }
    }

    const { patchPlaneRuntime, randomTraceId } = await import('@/effect/runtime')
    const traceId = await randomTraceId()
    const authRequest = await getWorkOSAuthRequest()
    const exit = await patchPlaneRuntime.runPromiseExit(
      StartAuthenticatedWorkflowFromPrompt({
        source: 'app',
        traceId,
        prompt: data.prompt,
      }).pipe(Effect.provideService(AuthRequestContext, authRequest)),
    )

    if (Exit.isFailure(exit)) {
      const errorCause = Cause.squash(exit.cause)
      return {
        ok: false as const,
        traceId,
        error: publicErrorMessage(errorCause, 'startWorkflowServerFn failed'),
      }
    }

    const workflowStart = exit.value
    return {
      ok: true as const,
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
    }
  })
