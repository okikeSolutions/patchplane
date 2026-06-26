import { Cause, Context, Effect } from 'effect'

export type TelemetrySeverity = 'trace' | 'debug' | 'info' | 'warning' | 'error' | 'fatal'

export interface TelemetryContextFields {
  /** End-to-end correlation id for an incoming request or workflow trigger. */
  readonly traceId?: string | undefined
  /** PatchPlane workflow run id when telemetry is associated with a workflow run. */
  readonly workflowRunId?: string | undefined
  /** Runtime/session id for long-lived agent, sandbox, or model runtime sessions. */
  readonly runtimeSessionId?: string | undefined
  /** Stable plugin id/name that emitted the telemetry, for example `github`, `daytona`, or `sentry`. */
  readonly pluginName?: string | undefined
  /** Stable operation name within a service or plugin, for example `github.verifyWebhook`. */
  readonly operation?: string | undefined
}

export const telemetryContextFieldNames = [
  'traceId',
  'workflowRunId',
  'runtimeSessionId',
  'pluginName',
  'operation',
] as const satisfies readonly (keyof TelemetryContextFields)[]

export type TelemetryContextFieldName = typeof telemetryContextFieldNames[number]

export type TelemetryAttributes = Readonly<Record<string, string | number | boolean | null | undefined>>

export function telemetryContextAttributes(
  input: TelemetryContextFields,
): Partial<Record<TelemetryContextFieldName, string>> {
  const attributes: Partial<Record<TelemetryContextFieldName, string>> = {}
  for (const field of telemetryContextFieldNames) {
    const value = input[field]
    if (value !== undefined) {
      attributes[field] = value
    }
  }
  return attributes
}

export function telemetryAttributes(
  context: TelemetryContextFields,
  attributes?: TelemetryAttributes,
): Record<string, string | number | boolean | null> {
  const output: Record<string, string | number | boolean | null> = {
    ...telemetryContextAttributes(context),
  }

  if (attributes !== undefined) {
    for (const [key, value] of Object.entries(attributes)) {
      if (value !== undefined) {
        output[key] = value
      }
    }
  }

  return output
}

export function withTelemetryContext<A, E, R>(
  context: TelemetryContextFields & { readonly attributes?: TelemetryAttributes | undefined },
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> {
  const attributes = telemetryAttributes(context, context.attributes)
  return effect.pipe(
    Effect.annotateLogs(attributes),
    Effect.annotateSpans(attributes),
  )
}

export interface RecordTelemetryEventInput extends TelemetryContextFields {
  readonly name: string
  readonly severity?: TelemetrySeverity | undefined
  readonly message?: string | undefined
  readonly attributes?: TelemetryAttributes | undefined
}

export interface CaptureTelemetryErrorInput extends TelemetryContextFields {
  readonly error: unknown
  readonly message?: string | undefined
  readonly attributes?: TelemetryAttributes | undefined
}

export interface TelemetrySpanInput extends TelemetryContextFields {
  readonly name: string
  readonly attributes?: TelemetryAttributes | undefined
}

export function withTelemetrySpan<A, E, R>(
  input: TelemetrySpanInput,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> {
  const attributes = telemetryAttributes(input, input.attributes)
  return withTelemetryContext(input, effect).pipe(
    Effect.withSpan(input.name, { attributes }),
  )
}

export interface CaptureTelemetryCauseInput extends TelemetryContextFields {
  readonly cause: Cause.Cause<unknown>
  readonly message: string
  readonly attributes?: TelemetryAttributes | undefined
}

export function captureTelemetryCause(
  input: CaptureTelemetryCauseInput,
): Effect.Effect<void, never, TelemetryService> {
  return TelemetryService.pipe(
    Effect.flatMap((telemetry) =>
      telemetry.captureError({
        traceId: input.traceId,
        workflowRunId: input.workflowRunId,
        runtimeSessionId: input.runtimeSessionId,
        pluginName: input.pluginName,
        operation: input.operation,
        error: Cause.squash(input.cause),
        message: input.message,
        attributes: input.attributes,
      })
    ),
  )
}

/** Operational telemetry boundary. Implementations must not become product truth/provenance storage. */
export class TelemetryService extends Context.Service<TelemetryService, {
  readonly recordEvent: (
    input: RecordTelemetryEventInput,
  ) => Effect.Effect<void>
  readonly captureError: (
    input: CaptureTelemetryErrorInput,
  ) => Effect.Effect<void>
  readonly withSpan: <A, E, R>(
    input: TelemetrySpanInput,
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>
}>()('@patchplane/core/services/TelemetryService') {}
