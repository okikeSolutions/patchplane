import * as Sentry from '@sentry/cloudflare'
import {
  TelemetryService,
  telemetryAttributes,
  type TelemetryAttributes,
  type TelemetryContextFields,
  type TelemetrySeverity,
} from '@patchplane/core/services/telemetry-service'
import { Context, Effect, Exit, Layer, Option } from 'effect'
import {
  sanitizeSentryAttributes,
  sanitizeSentryBreadcrumb,
  sanitizeSentryException,
  sanitizeSentryLog,
  sentryMaxBreadcrumbs,
  sentryTelemetryPolicyMarker,
} from './sanitize'

type SentryLogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'
type SafeSentryBreadcrumb = ReturnType<typeof sanitizeSentryBreadcrumb>
type BreadcrumbBufferValue =
  | { readonly items: Array<SafeSentryBreadcrumb> }
  | undefined

class BreadcrumbBuffer extends Context.Reference<BreadcrumbBufferValue>(
  'PatchPlaneCloudflareSentryBreadcrumbBuffer',
  { defaultValue: () => undefined },
) {}

function safeAttributes(
  input: TelemetryContextFields & {
    readonly attributes?: TelemetryAttributes | undefined
  },
): ReturnType<typeof sanitizeSentryAttributes> {
  return Option.liftThrowable(() =>
    sanitizeSentryAttributes(telemetryAttributes(input, input.attributes)),
  )().pipe(Option.getOrElse(() => ({})))
}

function safeSpanAttributes(
  attributes: ReturnType<typeof sanitizeSentryAttributes>,
): Record<string, string | number | boolean> {
  const output: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(attributes)) {
    if (value !== null) output[key] = value
  }
  return output
}

function toLevel(severity: TelemetrySeverity | undefined): SentryLogLevel {
  return severity === 'warning' ? 'warn' : (severity ?? 'info')
}

function annotateScope(
  scope: Sentry.Scope,
  input: TelemetryContextFields & {
    readonly attributes?: TelemetryAttributes | undefined
  },
) {
  const attributes = safeAttributes(input)
  for (const field of [
    'traceId',
    'workflowRunId',
    'runtimeSessionId',
    'pluginName',
    'operation',
  ] as const) {
    const value = attributes[field]
    if (typeof value === 'string') scope.setTag(field, value)
  }
  scope.setContext('patchplane', attributes)
}

const service = TelemetryService.of({
  recordEvent: (input) =>
    Effect.sync(() => {
      const level = toLevel(input.severity)
      const log = sanitizeSentryLog({
        level,
        message: 'patchplane.operational-event',
        attributes: {
          ...safeAttributes(input),
          telemetryPolicy: sentryTelemetryPolicyMarker,
        },
      })
      if (log === null) return
      Sentry.withScope((scope) => {
        annotateScope(scope, input)
        Sentry.logger[level](log.message, log.attributes, { scope })
      })
    }).pipe(Effect.catchDefect(() => Effect.void)),
  addBreadcrumb: (input) =>
    BreadcrumbBuffer.pipe(
      Effect.flatMap((buffer) =>
        buffer === undefined
          ? Effect.void
          : Effect.sync(() => {
              buffer.items.push(
                sanitizeSentryBreadcrumb({
                  category: 'patchplane.critical-path',
                  level: input.status === 'failed' ? 'error' : 'info',
                  data: {
                    ...safeAttributes(input),
                    criticalPathStage: input.stage,
                    status: input.status,
                  },
                }),
              )
              if (buffer.items.length > sentryMaxBreadcrumbs) {
                buffer.items.splice(
                  0,
                  buffer.items.length - sentryMaxBreadcrumbs,
                )
              }
            }),
      ),
      Effect.catchDefect(() => Effect.void),
    ),
  withBreadcrumbScope: (effect) =>
    effect.pipe(Effect.provideService(BreadcrumbBuffer, { items: [] })),
  captureError: (input) =>
    BreadcrumbBuffer.pipe(
      Effect.flatMap((buffer) =>
        Effect.sync(() => {
          Sentry.withScope((scope) => {
            for (const breadcrumb of buffer?.items ?? []) {
              scope.addBreadcrumb(breadcrumb)
            }
            annotateScope(scope, input)
            scope.setContext('patchplane.error', {
              message: 'Captured PatchPlane operation failure',
            })
            Sentry.captureException(sanitizeSentryException(input.error))
          })
        }),
      ),
      Effect.catchDefect(() => Effect.void),
    ),
  withSpan: (input, effect) => {
    const attributes = safeAttributes(input)
    const instrumentedEffect = (sentrySpan: Sentry.Span) =>
      effect.pipe(
        Effect.annotateLogs(attributes),
        Effect.annotateSpans(attributes),
        Effect.withSpan('patchplane.operation', { attributes }),
        Effect.onExit((exit) =>
          Effect.sync(() => {
            try {
              if (Exit.isFailure(exit)) {
                sentrySpan.setStatus({ code: 2, message: 'internal_error' })
              }
            } finally {
              sentrySpan.end()
            }
          }).pipe(Effect.ignoreCause),
        ),
      )

    return Effect.sync(() =>
      Sentry.startInactiveSpan({
        name: 'patchplane.operation',
        op: 'patchplane.operation',
        attributes: safeSpanAttributes(attributes),
        forceTransaction: true,
      }),
    ).pipe(
      Effect.map(Option.some),
      Effect.catchCause(() => Effect.succeed(Option.none())),
      Effect.flatMap(
        Option.match({
          onNone: () => effect,
          onSome: instrumentedEffect,
        }),
      ),
    )
  },
})

/** Reuses the request-owned @sentry/cloudflare client without initializing another SDK client. */
export const CloudflareTelemetryPlugin = {
  layer: Layer.succeed(TelemetryService, service),
} as const
