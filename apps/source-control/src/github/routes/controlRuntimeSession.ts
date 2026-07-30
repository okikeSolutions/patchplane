import { Cause, Effect, Exit, Schema } from 'effect'
import { ControlRuntimeSession } from '@patchplane/core/workflows/control-runtime-session'
import { withTelemetrySpan } from '@patchplane/core/services/telemetry-service'
import { publicErrorMessage } from '@patchplane/domain/errors'
import {
  type SourceControlRuntime,
  SourceControlWorkerRequestError,
  runtimeControlRequestSchema,
  jsonResponse,
  randomTraceId,
} from './support'

export async function controlRuntimeSession(
  request: Request,
  runtime: SourceControlRuntime,
) {
  const traceId = await randomTraceId(runtime)

  const inputExit = await runtime.runPromiseExit(
    Effect.tryPromise({
      try: () => request.json(),
      catch: (cause) =>
        new SourceControlWorkerRequestError({
          message: `Invalid JSON body: ${String(cause)}`,
        }),
    }).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(runtimeControlRequestSchema)),
    ),
  )

  if (Exit.isFailure(inputExit)) {
    return jsonResponse(
      { ok: false, traceId, error: 'Invalid runtime control request' },
      { status: 400 },
    )
  }

  const input = inputExit.value
  const controlExit = await runtime.runPromiseExit(
    ControlRuntimeSession({
      workflowRunId: input.workflowRunId,
      operation: input.operation,
      ...(input.message === undefined ? {} : { message: input.message }),
      traceId,
    }).pipe((effect) =>
      withTelemetrySpan(
        {
          traceId,
          workflowRunId: input.workflowRunId,
          operation: 'runtime.control',
          name: 'runtime.control',
        },
        effect,
      ),
    ),
  )

  if (Exit.isFailure(controlExit)) {
    const error = publicErrorMessage(
      Cause.squash(controlExit.cause),
      'Runtime control failed',
    )
    await runtime.runPromise(
      Effect.logError('Runtime control failed', {
        traceId,
        workflowRunId: input.workflowRunId,
        operation: input.operation,
        cause: Cause.pretty(controlExit.cause),
        error,
      }),
    )
    return jsonResponse({ ok: false, traceId, error }, { status: 500 })
  }

  return jsonResponse({ ok: true, traceId, status: controlExit.value.status })
}
