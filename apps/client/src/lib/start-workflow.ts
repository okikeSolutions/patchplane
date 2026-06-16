import { createServerFn } from '@tanstack/react-start'
import { AuthRequestContext } from '@patchplane/core/services/auth-request-context'
import { StartAuthenticatedWorkflowFromPrompt } from '@patchplane/core/workflows/start-authenticated-workflow-from-prompt'
import { Effect, Schema } from 'effect'
import { patchPlaneRuntime } from '@/effect/runtime'
import { getWorkOSAuthRequest } from './workos-auth-request'

const StartWorkflowInput = Schema.Struct({
  prompt: Schema.String.check(Schema.isNonEmpty()),
})
const decodeStartWorkflowInput = Schema.decodeUnknownSync(StartWorkflowInput)

function property(value: unknown, key: string) {
  if (typeof value !== 'object' || value === null) {
    return undefined
  }

  return Reflect.get(value, key)
}

function stringProperty(value: unknown, key: string) {
  const item = property(value, key)
  return typeof item === 'string' ? item : undefined
}

function causeProperty(value: unknown) {
  return property(value, 'cause')
}

function serverErrorMessage(cause: unknown, seen = new WeakSet()): string {
  if (typeof cause === 'object' && cause !== null) {
    if (seen.has(cause)) {
      return 'Workflow start failed'
    }
    seen.add(cause)
  }

  const message = cause instanceof Error ? cause.message : stringProperty(cause, 'message')
  const name = stringProperty(cause, 'name')
  const tag = stringProperty(cause, '_tag')
  const nestedCause = causeProperty(cause)
  const nestedMessage =
    nestedCause === undefined ? undefined : serverErrorMessage(nestedCause, seen)

  if (tag === 'ConfigError') {
    return 'PatchPlane server configuration is incomplete. Check CONVEX_URL or VITE_CONVEX_URL and WorkOS server environment variables.'
  }

  if (message && nestedMessage && nestedMessage !== 'Workflow start failed') {
    return `${message}: ${nestedMessage}`
  }

  if (message) {
    return message
  }

  if (name || tag) {
    return [name, tag].filter(Boolean).join(': ')
  }

  return 'Workflow start failed'
}

export const startWorkflowServerFn = createServerFn({ method: 'POST' })
  .validator(decodeStartWorkflowInput)
  .handler(async ({ data }) => {
    const traceId = crypto.randomUUID()

    try {
      const authRequest = await getWorkOSAuthRequest()
      const workflowStart = await patchPlaneRuntime.runPromise(
        StartAuthenticatedWorkflowFromPrompt({
          source: 'app',
          traceId,
          prompt: data.prompt,
        }).pipe(
          Effect.provideService(AuthRequestContext, authRequest),
          Effect.annotateLogs({ traceId, entrypoint: 'startWorkflowServerFn' }),
          Effect.annotateSpans({ traceId, entrypoint: 'startWorkflowServerFn' }),
          Effect.withLogSpan('startWorkflowServerFn'),
        ),
      )

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
    } catch (cause) {
      const error = serverErrorMessage(cause)
      console.error('startWorkflowServerFn failed', { traceId, error, cause })
      return {
        ok: false as const,
        error,
      }
    }
  })
