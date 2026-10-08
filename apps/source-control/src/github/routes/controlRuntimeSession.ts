import { Effect, Exit, Schema } from 'effect'
import { ControlRuntimeSession } from '@patchplane/core/workflows/control-runtime-session'
import { withTelemetrySpan } from '@patchplane/core/services/telemetry-service'
import {
  runtimeControlRequestSchema,
  jsonResponse,
  randomTraceIdEffect,
  readBoundedJson,
} from './support'

export const controlRuntimeSession = Effect.fnUntraced(function* (
  request: Request,
) {
  const traceId = yield* randomTraceIdEffect()

  const inputExit = yield* readBoundedJson(request).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(runtimeControlRequestSchema)),
    Effect.exit,
  )

  if (Exit.isFailure(inputExit)) {
    return jsonResponse(
      { ok: false, traceId, error: 'Invalid runtime control request' },
      { status: 400 },
    )
  }

  const input = inputExit.value
  const controlExit = yield* ControlRuntimeSession({
    workflowRunId: input.workflowRunId,
    operation: input.operation,
    ...(input.message === undefined ? {} : { message: input.message }),
    traceId,
  }).pipe(
    (effect) =>
      withTelemetrySpan(
        {
          traceId,
          workflowRunId: input.workflowRunId,
          operation: 'runtime.control',
          name: 'runtime.control',
        },
        effect,
      ),
    Effect.exit,
  )

  if (Exit.isFailure(controlExit)) {
    yield* Effect.logError('Runtime control failed', {
      traceId,
      workflowRunId: input.workflowRunId,
      operation: input.operation,
    })
    return jsonResponse(
      { ok: false, traceId, error: 'Runtime control failed' },
      { status: 500 },
    )
  }

  return jsonResponse({ ok: true, traceId, status: controlExit.value.status })
})
