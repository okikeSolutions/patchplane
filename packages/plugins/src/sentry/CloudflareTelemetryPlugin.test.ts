import { assert, describe, it } from '@effect/vitest'
import { TelemetryService } from '@patchplane/core/services/telemetry-service'
import { Effect } from 'effect'
import { vi } from 'vitest'
import { CloudflareTelemetryPlugin } from './CloudflareTelemetryPlugin'

const sentryMocks = vi.hoisted(() => ({
  captureException: vi.fn(),
  contexts: [] as Array<unknown>,
  init: vi.fn(),
  startInactiveSpan: vi.fn(() => ({
    end: vi.fn(),
    setStatus: vi.fn(),
  })),
}))

vi.mock('@sentry/cloudflare', async (importOriginal) => {
  const original = await importOriginal<typeof import('@sentry/cloudflare')>()
  return {
    ...original,
    captureException: sentryMocks.captureException,
    init: sentryMocks.init,
    startInactiveSpan: sentryMocks.startInactiveSpan,
    withScope: (callback: (scope: unknown) => unknown) =>
      callback({
        addBreadcrumb: () => undefined,
        setContext: (_name: string, context: unknown) =>
          sentryMocks.contexts.push(context),
        setTag: () => undefined,
      }),
  }
})

describe('CloudflareTelemetryPlugin', () => {
  it.effect(
    'captures through the existing Cloudflare client without SDK initialization',
    () =>
      Effect.gen(function* () {
        const telemetry = yield* TelemetryService
        yield* telemetry.captureError({
          error: new Error('provider sensitive message'),
          operation: 'worker.fetch',
        })

        assert.strictEqual(sentryMocks.init.mock.calls.length, 0)
        assert.strictEqual(sentryMocks.captureException.mock.calls.length, 1)
        const captured = sentryMocks.captureException.mock.calls[0]?.[0]
        assert.ok(captured instanceof Error)
        assert.strictEqual(
          captured.message,
          'Captured PatchPlane operation failure',
        )
      }).pipe(Effect.provide(CloudflareTelemetryPlugin.layer)),
  )

  it.effect(
    'preserves the business effect when span instrumentation throws',
    () =>
      Effect.gen(function* () {
        sentryMocks.startInactiveSpan.mockImplementationOnce(() => {
          throw new Error('sdk failure')
        })
        const telemetry = yield* TelemetryService
        const result = yield* telemetry.withSpan(
          { name: 'patchplane.test', operation: 'worker.fetch' },
          Effect.succeed(42),
        )

        assert.strictEqual(result, 42)
      }).pipe(Effect.provide(CloudflareTelemetryPlugin.layer)),
  )

  it.effect('preserves success when span end throws', () =>
    Effect.gen(function* () {
      sentryMocks.startInactiveSpan.mockReturnValueOnce({
        end: vi.fn(() => {
          throw new Error('sdk end failure')
        }),
        setStatus: vi.fn(),
      })
      const telemetry = yield* TelemetryService
      const result = yield* telemetry.withSpan(
        { name: 'patchplane.test', operation: 'worker.fetch' },
        Effect.succeed(42),
      )

      assert.strictEqual(result, 42)
    }).pipe(Effect.provide(CloudflareTelemetryPlugin.layer)),
  )

  it.effect(
    'preserves failure and ends the span when status update throws',
    () => {
      const end = vi.fn()
      return Effect.gen(function* () {
        sentryMocks.startInactiveSpan.mockReturnValueOnce({
          end,
          setStatus: vi.fn(() => {
            throw new Error('sdk status failure')
          }),
        })
        const telemetry = yield* TelemetryService
        const failure = yield* telemetry
          .withSpan(
            { name: 'patchplane.test', operation: 'worker.fetch' },
            Effect.fail('business failure'),
          )
          .pipe(Effect.flip)

        assert.strictEqual(failure, 'business failure')
        assert.strictEqual(end.mock.calls.length, 1)
      }).pipe(Effect.provide(CloudflareTelemetryPlugin.layer))
    },
  )
})
