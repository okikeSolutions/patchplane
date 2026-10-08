import * as Sentry from '@sentry/effect/server'
import {
  TelemetryService,
  telemetryAttributes,
  type TelemetryAttributes,
  type TelemetryContextFields,
  type TelemetrySeverity,
} from '@patchplane/core/services/telemetry-service'
import {
  Context,
  Effect,
  Exit,
  Layer,
  Match,
  Option,
  Redacted,
  References,
  Tracer,
} from 'effect'
import {
  makeSentryDataCollection,
  sanitizeSentryAttributes,
  sanitizeSentryBreadcrumb,
  sanitizeSentryEvent,
  sanitizeSentryException,
  sanitizeSentryLog,
  sanitizeSentryMetric,
  sanitizeSentryStreamedSpan,
  sentryMaxBreadcrumbs,
  sentryTelemetryPolicyMarker,
} from './sanitize'
import { SentryConfig } from './SentryConfig'

type SentryLogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'

const pluginName = 'sentry'
type SafeSentryBreadcrumb = ReturnType<typeof sanitizeSentryBreadcrumb>

type BreadcrumbBufferValue =
  | { readonly items: Array<SafeSentryBreadcrumb> }
  | undefined

class BreadcrumbBuffer extends Context.Reference<BreadcrumbBufferValue>(
  'PatchPlaneSentryBreadcrumbBuffer',
  { defaultValue: () => undefined },
) {}

function makeSanitizingSpan(span: Tracer.Span): Tracer.Span {
  return new Proxy(span, {
    get: (target, property) => {
      if (property === 'annotations') return Context.empty()
      if (property === 'links') return []
      if (property === 'attribute') {
        return (key: string, value: unknown) => {
          const attributes = sanitizeSentryAttributes({ [key]: value })
          for (const [safeKey, safeValue] of Object.entries(attributes)) {
            target.attribute(safeKey, safeValue)
          }
        }
      }
      if (property === 'event') {
        return (
          _name: string,
          startTime: bigint,
          attributes?: Record<string, unknown>,
        ) =>
          target.event(
            'patchplane.event',
            startTime,
            sanitizeSentryAttributes(attributes),
          )
      }
      if (property === 'addLinks') return () => undefined
      if (property === 'end') {
        return (endTime: bigint, exit: Exit.Exit<unknown, unknown>) =>
          target.end(
            endTime,
            Exit.isFailure(exit)
              ? Exit.fail('patchplane.operation.failure')
              : exit,
          )
      }
      return Reflect.get(target, property, target)
    },
  })
}

const SanitizingSentryTracer = Tracer.make({
  span: (options) =>
    makeSanitizingSpan(
      Sentry.SentryEffectTracer.span({
        ...options,
        name: 'patchplane.operation',
        annotations: Context.empty(),
        links: [],
      }),
    ),
  context: Sentry.SentryEffectTracer.context,
})

function mergeAttributes(
  input: TelemetryContextFields & {
    readonly attributes?: TelemetryAttributes | undefined
  },
) {
  return telemetryAttributes(input, input.attributes)
}

function safeMergedAttributes(
  input: TelemetryContextFields & {
    readonly attributes?: TelemetryAttributes | undefined
  },
): ReturnType<typeof sanitizeSentryAttributes> {
  return Option.liftThrowable(() =>
    sanitizeSentryAttributes(mergeAttributes(input)),
  )().pipe(Option.getOrElse(() => ({})))
}

function toSentryLevel(
  severity: TelemetrySeverity | undefined,
): SentryLogLevel {
  return Match.value(severity).pipe(
    Match.when('trace', () => 'trace' as const),
    Match.when('debug', () => 'debug' as const),
    Match.when('info', () => 'info' as const),
    Match.when('error', () => 'error' as const),
    Match.when('fatal', () => 'fatal' as const),
    Match.when('warning', () => 'warn' as const),
    Match.when(undefined, () => 'info' as const),
    Match.exhaustive,
  )
}

function annotateScope(
  input: TelemetryContextFields & {
    readonly attributes?: TelemetryAttributes | undefined
  },
) {
  return (scope: Sentry.Scope) => {
    const attributes = safeMergedAttributes(input)
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
}

const NoopTelemetryLayer = Layer.succeed(
  TelemetryService,
  TelemetryService.of({
    recordEvent: () => Effect.void,
    addBreadcrumb: () => Effect.void,
    withBreadcrumbScope: (effect) => effect,
    captureError: () => Effect.void,
    withSpan: (_input, effect) => effect,
  }),
)

function makeTelemetryService(enableLogs: boolean) {
  return TelemetryService.of({
    recordEvent: enableLogs
      ? Effect.fn('SentryTelemetryPlugin.recordEvent')((input) =>
          Effect.sync(() => {
            const level = toSentryLevel(input.severity)
            const log = sanitizeSentryLog({
              level,
              message: 'patchplane.operational-event',
              attributes: {
                ...safeMergedAttributes(input),
                telemetryPolicy: sentryTelemetryPolicyMarker,
              },
            })
            if (log === null) return
            Sentry.withScope((scope) => {
              annotateScope(input)(scope)
              Sentry.logger[level](log.message, log.attributes, { scope })
            })
          }).pipe(
            Effect.catchDefect(() =>
              Effect.logDebug('Sentry telemetry event capture failed', {
                pluginName,
                operation: 'sentry.recordEvent',
                errorCategory: 'telemetry_capture_failed',
              }),
            ),
          ),
        )
      : Effect.fn('SentryTelemetryPlugin.recordEvent')(() => Effect.void),
    addBreadcrumb: Effect.fn('SentryTelemetryPlugin.addBreadcrumb')((input) =>
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
                      ...safeMergedAttributes(input),
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
        Effect.catchDefect(() =>
          Effect.logDebug('Sentry telemetry breadcrumb capture failed', {
            pluginName,
            operation: 'sentry.addBreadcrumb',
            errorCategory: 'telemetry_capture_failed',
          }),
        ),
      ),
    ),
    withBreadcrumbScope: Effect.fn('SentryTelemetryPlugin.withBreadcrumbScope')(
      (effect) =>
        effect.pipe(Effect.provideService(BreadcrumbBuffer, { items: [] })),
    ),
    captureError: Effect.fn('SentryTelemetryPlugin.captureError')((input) =>
      BreadcrumbBuffer.pipe(
        Effect.flatMap((buffer) =>
          Effect.sync(() => {
            Sentry.withScope((scope) => {
              for (const breadcrumb of buffer?.items ?? []) {
                scope.addBreadcrumb(breadcrumb)
              }
              annotateScope(input)(scope)
              if (input.message !== undefined) {
                scope.setContext('patchplane.error', {
                  message: 'Captured PatchPlane operation failure',
                })
              }
              Sentry.captureException(sanitizeSentryException(input.error))
            })
          }),
        ),
        Effect.catchDefect(() =>
          Effect.logDebug('Sentry telemetry error capture failed', {
            pluginName,
            operation: 'sentry.captureError',
            errorCategory: 'telemetry_capture_failed',
          }),
        ),
      ),
    ),
    withSpan: Effect.fn('SentryTelemetryPlugin.withSpan')((input, effect) => {
      const attributes = safeMergedAttributes(input)
      return effect.pipe(
        Effect.annotateLogs(attributes),
        Effect.annotateSpans(attributes),
        Effect.withSpan('patchplane.operation', { attributes }),
      )
    }),
  })
}

const sentryTelemetryServiceLayer = (enableLogs: boolean) =>
  Layer.succeed(TelemetryService, makeTelemetryService(enableLogs))

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
          dataCollection: makeSentryDataCollection(),
          maxBreadcrumbs: sentryMaxBreadcrumbs,
          integrations: (defaultIntegrations) => [
            ...defaultIntegrations.filter(
              (integration) => integration.name !== 'Console',
            ),
            Sentry.httpIntegration({ maxRequestBodySize: 'none' }),
          ],
          beforeSend: sanitizeSentryEvent,
          beforeBreadcrumb: sanitizeSentryBreadcrumb,
          beforeSendLog: sanitizeSentryLog,
          beforeSendMetric: sanitizeSentryMetric,
          beforeSendSpan: sanitizeSentryStreamedSpan,
        }),
        observabilityControlsLayer,
        config.enableTracing
          ? Layer.succeed(Tracer.Tracer, SanitizingSentryTracer)
          : Layer.empty,
        sentryTelemetryServiceLayer(config.enableLogs),
      )

      return sentryBaseLayer
    }),
  ),
} as const
