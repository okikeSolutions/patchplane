import { describe, expect, it } from '@effect/vitest'
import * as Sentry from '@sentry/effect'
import { TelemetryService } from '@patchplane/core/services/telemetry-service'
import { ConfigProvider, Effect, Exit, Layer } from 'effect'
import { afterEach, vi } from 'vitest'
import { SentryTelemetryPlugin } from './SentryTelemetryPlugin'

const sentryMocks = vi.hoisted(() => ({
  captureException: vi.fn(),
}))

vi.mock('@sentry/effect', async (importOriginal) => {
  const original = await importOriginal<typeof import('@sentry/effect')>()
  return {
    ...original,
    captureException: sentryMocks.captureException,
  }
})

const EmptyConfigLayer = ConfigProvider.layer(
  ConfigProvider.fromEnv({ env: {} }),
)

const TestLayer = SentryTelemetryPlugin.layer.pipe(
  Layer.provide(EmptyConfigLayer),
)

const ConfiguredSentryLayer = SentryTelemetryPlugin.layer.pipe(
  Layer.provide(ConfigProvider.layer(
    ConfigProvider.fromEnv({
      env: {
        SENTRY_DSN: 'https://username@domain/123',
        SENTRY_ENABLE_LOGS: 'false',
        SENTRY_ENABLE_METRICS: 'false',
      },
    }),
  )),
)

describe('SentryTelemetryPlugin', () => {
  afterEach(() => {
    sentryMocks.captureException.mockReset()
  })

  it.effect('provides a no-op TelemetryService when SENTRY_DSN is absent', () =>
    Effect.gen(function* () {
      const telemetry = yield* TelemetryService

      yield* telemetry.recordEvent({
        name: 'test.event',
        traceId: 'trace-1',
        pluginName: 'test',
        operation: 'test.recordEvent',
      })

      yield* telemetry.captureError({
        error: new Error('test failure'),
        traceId: 'trace-1',
        pluginName: 'test',
        operation: 'test.captureError',
      })

      const result = yield* telemetry.withSpan(
        {
          name: 'test.span',
          traceId: 'trace-1',
          pluginName: 'test',
          operation: 'test.withSpan',
        },
        Effect.succeed('ok'),
      )

      expect(result).toBe('ok')
    }).pipe(Effect.provide(TestLayer)),
  )

  it.effect('captureError is best-effort when the Sentry SDK throws', () =>
    Effect.gen(function* () {
      sentryMocks.captureException.mockImplementation(() => {
        throw new Error('simulated sentry failure')
      })
      const telemetry = yield* TelemetryService

      const exit = yield* Effect.exit(
        telemetry.captureError({
          error: new Error('runtime failure'),
          traceId: 'trace-1',
          workflowRunId: 'run-1',
          runtimeSessionId: 'session-1',
          pluginName: 'test',
          operation: 'test.captureError',
        }),
      )

      expect(Exit.isSuccess(exit)).toBe(true)
      expect(Sentry.captureException).toHaveBeenCalledOnce()
    }).pipe(Effect.provide(ConfiguredSentryLayer)),
  )
})
