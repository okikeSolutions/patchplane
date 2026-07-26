import * as Sentry from '@sentry/effect/server'
import {
  TelemetryService,
  telemetryAttributes,
  withTelemetrySpan,
  type TelemetryAttributes,
  type TelemetryContextFields,
  type TelemetrySeverity,
} from '@patchplane/core/services/telemetry-service'
import {
  Effect,
  Layer,
  Logger,
  Option,
  Redacted,
  References,
  Tracer,
} from 'effect'
import {
  sanitizeSentryBreadcrumb,
  sanitizeSentryEvent,
  sanitizeSentryLog,
  sanitizeSentryMetric,
  sanitizeSentrySpan,
  sanitizeSentryTransaction,
  sentryTelemetryPolicyMarker,
} from './sanitize'
import { SentryConfig } from './SentryConfig'

type SentryLogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'

const pluginName = 'sentry'

function mergeAttributes(
  input: TelemetryContextFields & {
    readonly attributes?: TelemetryAttributes | undefined
  },
) {
  return telemetryAttributes(input, input.attributes)
}

function toSentryLevel(
  severity: TelemetrySeverity | undefined,
): SentryLogLevel {
  switch (severity) {
    case 'trace':
    case 'debug':
    case 'info':
    case 'error':
    case 'fatal':
      return severity
    case 'warning':
      return 'warn'
    case undefined:
      return 'info'
    default:
      severity satisfies never
      return 'info'
  }
}

function annotateScope(
  input: TelemetryContextFields & {
    readonly attributes?: TelemetryAttributes | undefined
  },
) {
  return (scope: Sentry.Scope) => {
    if (input.traceId !== undefined) scope.setTag('traceId', input.traceId)
    if (input.workflowRunId !== undefined)
      scope.setTag('workflowRunId', input.workflowRunId)
    if (input.runtimeSessionId !== undefined)
      scope.setTag('runtimeSessionId', input.runtimeSessionId)
    if (input.pluginName !== undefined)
      scope.setTag('pluginName', input.pluginName)
    if (input.operation !== undefined)
      scope.setTag('operation', input.operation)
    scope.setContext('patchplane', mergeAttributes(input))
  }
}

const NoopTelemetryLayer = Layer.succeed(
  TelemetryService,
  TelemetryService.of({
    recordEvent: () => Effect.void,
    captureError: () => Effect.void,
    withSpan: (_input, effect) => effect,
  }),
)

function makeTelemetryService() {
  return TelemetryService.of({
    recordEvent: (input) =>
      Effect.sync(() => {
        const level = toSentryLevel(input.severity)
        const message = input.name
        const attributes = {
          ...mergeAttributes(input),
          telemetryPolicy: sentryTelemetryPolicyMarker,
        }
        Sentry.withScope((scope) => {
          annotateScope(input)(scope)
          Sentry.logger[level](message, attributes, { scope })
        })
      }).pipe(
        Effect.catchDefect((cause: unknown) =>
          Effect.logDebug('Sentry telemetry event capture failed', {
            pluginName,
            operation: 'sentry.recordEvent',
            cause,
          }),
        ),
      ),
    captureError: (input) =>
      Effect.sync(() => {
        Sentry.withScope((scope) => {
          annotateScope(input)(scope)
          if (input.message !== undefined) {
            scope.setContext('patchplane.error', { message: input.message })
          }
          Sentry.captureException(input.error)
        })
      }).pipe(
        Effect.catchDefect((cause: unknown) =>
          Effect.logDebug('Sentry telemetry error capture failed', {
            pluginName,
            operation: 'sentry.captureError',
            cause,
          }),
        ),
      ),
    withSpan: (input, effect) => withTelemetrySpan(input, effect),
  })
}

const SentryTelemetryServiceLayer = Layer.succeed(
  TelemetryService,
  makeTelemetryService(),
)

export const SentryTelemetryPlugin = {
  layer: Layer.unwrap(
    Effect.gen(function* () {
      const config = yield* SentryConfig
      const observabilityControlsLayer = Layer.mergeAll(
        Layer.succeed(References.MinimumLogLevel, config.logLevel),
        Layer.succeed(References.TracerEnabled, config.enableTracing),
      )

      if (!config.enabled || Option.isNone(config.dsn)) {
        return Layer.mergeAll(observabilityControlsLayer, NoopTelemetryLayer)
      }

      const sentryBaseLayer = Layer.mergeAll(
        Sentry.effectLayer({
          dsn: Redacted.value(config.dsn.value),
          environment: config.environment,
          tracesSampleRate: config.enableTracing ? config.tracesSampleRate : 0,
          enableLogs: config.enableLogs,
          enableMetrics: config.enableMetrics,
          sendDefaultPii: false,
          beforeSend: sanitizeSentryEvent,
          beforeSendTransaction: sanitizeSentryTransaction,
          beforeBreadcrumb: sanitizeSentryBreadcrumb,
          beforeSendLog: sanitizeSentryLog,
          beforeSendMetric: sanitizeSentryMetric,
          beforeSendSpan: sanitizeSentrySpan,
        }),
        observabilityControlsLayer,
        config.enableTracing
          ? Layer.succeed(Tracer.Tracer, Sentry.SentryEffectTracer)
          : Layer.empty,
        config.enableMetrics ? Sentry.SentryEffectMetricsLayer : Layer.empty,
        SentryTelemetryServiceLayer,
      )

      return config.enableLogs
        ? Layer.merge(
            sentryBaseLayer,
            Logger.layer([Sentry.SentryEffectLogger], {
              mergeWithExisting: true,
            }),
          )
        : sentryBaseLayer
    }),
  ),
} as const
