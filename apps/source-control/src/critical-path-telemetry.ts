import { Effect } from 'effect'
import {
  captureTelemetryCause,
  type TelemetryAttributes,
  type TelemetryService,
  type TelemetryContextFields,
  withCriticalPathBreadcrumbScope,
} from '@patchplane/core/services/telemetry-service'

interface CapturedCriticalPathScopeInput extends TelemetryContextFields {
  readonly message: string
  readonly attributes?: TelemetryAttributes | undefined
}

/** Keeps transition breadcrumbs and their captured failure in one request-local scope. */
export function withCapturedCriticalPathScope<A, E, R>(
  input: CapturedCriticalPathScopeInput,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R | TelemetryService> {
  return effect.pipe(
    Effect.tapCause((cause) =>
      captureTelemetryCause({
        traceId: input.traceId,
        workflowRunId: input.workflowRunId,
        runtimeSessionId: input.runtimeSessionId,
        pluginName: input.pluginName,
        operation: input.operation,
        cause,
        message: input.message,
        attributes: input.attributes,
      }),
    ),
    withCriticalPathBreadcrumbScope,
  )
}
