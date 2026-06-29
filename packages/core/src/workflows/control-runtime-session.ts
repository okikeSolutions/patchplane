import { Effect } from 'effect'
import { SandboxService } from '../services/sandbox-service'
import { StorageService } from '../services/storage-service'

type RuntimeControlOperation = 'abort' | 'steer' | 'followUp' | 'terminate'

export const ControlRuntimeSession = Effect.fn(
  '@patchplane/core/workflows/ControlRuntimeSession',
)(function*(input: {
  readonly workflowRunId: string
  readonly operation: RuntimeControlOperation
  readonly message?: string | undefined
  readonly traceId: string
}) {
  const storage = yield* StorageService
  const sandbox = yield* SandboxService
  const session = yield* storage.getActiveRuntimeSession({
    workflowRunId: input.workflowRunId,
    traceId: input.traceId,
  })

  if (session === undefined) {
    return { status: 'no_active_session' as const }
  }

  if (input.operation === 'abort') {
    const result = yield* sandbox.abortRuntimeSession({ ...session, traceId: input.traceId })
    yield* storage.markRuntimeSessionStatus({
      runtimeSessionId: session.id,
      status: 'cancelled',
      completedAt: Date.now(),
      traceId: input.traceId,
    })
    return { status: 'sent' as const, result }
  }

  if (input.operation === 'terminate') {
    const result = yield* sandbox.terminateRuntimeSession({ ...session, traceId: input.traceId })
    yield* storage.markRuntimeSessionStatus({
      runtimeSessionId: session.id,
      status: 'cancelled',
      completedAt: Date.now(),
      traceId: input.traceId,
    })
    return { status: 'terminated' as const, result }
  }

  if (input.message === undefined || input.message.trim().length === 0) {
    return { status: 'missing_message' as const }
  }

  const result = input.operation === 'steer'
    ? yield* sandbox.steerRuntimeSession({ ...session, message: input.message, traceId: input.traceId })
    : yield* sandbox.followUpRuntimeSession({ ...session, message: input.message, traceId: input.traceId })

  return { status: 'sent' as const, result }
})

export const AbortRuntimeSession = (input: { readonly workflowRunId: string; readonly traceId: string }) =>
  ControlRuntimeSession({ ...input, operation: 'abort' })

export const TerminateRuntimeSession = (input: { readonly workflowRunId: string; readonly traceId: string }) =>
  ControlRuntimeSession({ ...input, operation: 'terminate' })

export const SteerRuntimeSession = (input: { readonly workflowRunId: string; readonly message: string; readonly traceId: string }) =>
  ControlRuntimeSession({ ...input, operation: 'steer' })

export const FollowUpRuntimeSession = (input: { readonly workflowRunId: string; readonly message: string; readonly traceId: string }) =>
  ControlRuntimeSession({ ...input, operation: 'followUp' })
