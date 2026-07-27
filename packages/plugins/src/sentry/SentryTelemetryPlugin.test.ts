import { assert, describe, it } from '@effect/vitest'
import {
  makeCriticalPathBreadcrumbStatus,
  makeCriticalPathStage,
  TelemetryService,
  withTelemetrySpan,
} from '@patchplane/core/services/telemetry-service'
import {
  Cause,
  ConfigProvider,
  Data,
  Effect,
  Exit,
  Layer,
  Option,
  Tracer,
} from 'effect'
import { afterEach, vi } from 'vitest'
import { SentryTelemetryPlugin } from './SentryTelemetryPlugin'

class TestSpanError extends Data.TaggedError('TestSpanError')<{
  readonly message: string
}> {}

const sentryMocks = vi.hoisted(() => ({
  captureException: vi.fn(),
  loggerInfo: vi.fn(),
  effectLayerOptions: [] as Array<Record<string, unknown>>,
  httpIntegrationOptions: [] as Array<Record<string, unknown>>,
  spans: [] as Array<Tracer.NativeSpan>,
  scopeBreadcrumbBatches: [] as Array<Array<unknown>>,
}))

vi.mock('@sentry/effect/server', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@sentry/effect/server')>()
  const { Tracer } = await import('effect')
  return {
    ...original,
    captureException: sentryMocks.captureException,
    withScope: (callback: (scope: unknown) => unknown) => {
      const breadcrumbs: Array<unknown> = []
      sentryMocks.scopeBreadcrumbBatches.push(breadcrumbs)
      return callback({
        addBreadcrumb: (breadcrumb: unknown) => breadcrumbs.push(breadcrumb),
        setContext: () => undefined,
        setTag: () => undefined,
      })
    },
    logger: { ...original.logger, info: sentryMocks.loggerInfo },
    SentryEffectTracer: Tracer.make({
      span: (options) => {
        const span = new Tracer.NativeSpan(options)
        sentryMocks.spans.push(span)
        return span
      },
    }),
    effectLayer: (options: Record<string, unknown>) => {
      sentryMocks.effectLayerOptions.push(options)
      return original.effectLayer(options)
    },
    httpIntegration: (options: Record<string, unknown>) => {
      sentryMocks.httpIntegrationOptions.push(options)
      return original.httpIntegration(options)
    },
  }
})

const EmptyConfigLayer = ConfigProvider.layer(
  ConfigProvider.fromEnv({ env: {} }),
)

const TestLayer = SentryTelemetryPlugin.layer.pipe(
  Layer.provide(EmptyConfigLayer),
)

const ConfiguredSentryLayer = SentryTelemetryPlugin.layer.pipe(
  Layer.provide(
    ConfigProvider.layer(
      ConfigProvider.fromEnv({
        env: {
          SENTRY_DSN: 'https://username@domain/123',
          SENTRY_ENABLE_LOGS: 'false',
          SENTRY_ENABLE_METRICS: 'false',
        },
      }),
    ),
  ),
)

describe('SentryTelemetryPlugin', () => {
  afterEach(() => {
    sentryMocks.captureException.mockReset()
    sentryMocks.loggerInfo.mockReset()
    sentryMocks.effectLayerOptions.length = 0
    sentryMocks.httpIntegrationOptions.length = 0
    sentryMocks.spans.length = 0
    sentryMocks.scopeBreadcrumbBatches.length = 0
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

      yield* telemetry.addBreadcrumb({
        stage: makeCriticalPathStage('request-authorization'),
        status: makeCriticalPathBreadcrumbStatus('started'),
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

      assert.strictEqual(result, 'ok')
    }).pipe(Effect.provide(TestLayer)),
  )

  it.effect(
    'configures deny-by-default data collection and bounded breadcrumbs',
    () =>
      Effect.gen(function* () {
        yield* TelemetryService

        const options = sentryMocks.effectLayerOptions.at(-1)
        assert.deepStrictEqual(options?.dataCollection, {
          userInfo: false,
          cookies: false,
          httpHeaders: { request: false, response: false },
          httpBodies: [],
          queryParams: false,
          genAI: { inputs: false, outputs: false },
          stackFrameVariables: false,
          frameContextLines: 0,
        })
        assert.strictEqual(options?.maxBreadcrumbs, 64)
        const resolveIntegrations = options?.integrations as
          | ((defaults: Array<{ readonly name: string }>) => Array<{
              readonly name: string
            }>)
          | undefined
        assert.ok(resolveIntegrations !== undefined)
        assert.deepStrictEqual(
          resolveIntegrations([{ name: 'Console' }, { name: 'Keep' }]).map(
            ({ name }) => name,
          ),
          ['Keep', 'Http'],
        )
        assert.deepStrictEqual(sentryMocks.httpIntegrationOptions.at(-1), {
          maxRequestBodySize: 'none',
        })
      }).pipe(Effect.provide(ConfiguredSentryLayer)),
  )

  it.effect('sanitizes logs and exceptions before calling the Sentry SDK', () =>
    Effect.gen(function* () {
      const telemetry = yield* TelemetryService
      const sentinel = 'PATCHPLANE_PLUGIN_SENTINEL_SECRET_6e2a'
      const error = new Error(`provider failure ${sentinel}`)
      error.stack = `Error: ${sentinel}\n    at private (/secret/${sentinel}.ts:9:3)`

      yield* telemetry.withBreadcrumbScope(
        Effect.gen(function* () {
          yield* telemetry.addBreadcrumb({
            stage: makeCriticalPathStage('candidate-frozen'),
            status: makeCriticalPathBreadcrumbStatus('succeeded'),
            operation: 'runtime.execute',
          })
          yield* telemetry.captureError({
            error,
            message: `runtime failed ${sentinel}`,
            operation: 'runtime.execute',
          })
        }),
      )
      yield* telemetry.recordEvent({
        name: `runtime event ${sentinel}`,
        operation: 'runtime.execute',
        attributes: { prompt: sentinel },
      })
      yield* telemetry.withSpan(
        {
          name: `runtime span ${sentinel}`,
          operation: 'runtime.execute',
          attributes: { prompt: sentinel },
        },
        Effect.void,
      )
      yield* withTelemetrySpan(
        {
          name: `direct span ${sentinel}`,
          operation: 'runtime.execute',
          attributes: { prompt: sentinel },
        },
        Effect.void,
      )

      const breadcrumbBatch = sentryMocks.scopeBreadcrumbBatches.find(
        (batch) => batch.length > 0,
      )
      assert.deepStrictEqual(breadcrumbBatch?.[0], {
        category: 'patchplane.critical-path',
        level: 'info',
        message: 'candidate-frozen.succeeded',
        data: {
          criticalPathStage: 'candidate-frozen',
          operation: 'patchplane.operation',
          status: 'succeeded',
        },
      })

      const logCall = sentryMocks.loggerInfo.mock.calls[0]
      assert.strictEqual(logCall?.[0], 'patchplane.operational-event')
      assert.deepStrictEqual(logCall?.[1], {
        telemetryPolicy: 'allowlisted-v1',
        operation: 'patchplane.operation',
      })

      const captured = sentryMocks.captureException.mock.calls[0]?.[0]
      assert.ok(captured instanceof Error)
      assert.notStrictEqual(captured, error)
      assert.strictEqual(
        captured.message,
        'Captured PatchPlane operation failure',
      )
      assert.ok(!String(captured.stack).includes(sentinel))

      const span = sentryMocks.spans.at(-1)
      assert.strictEqual(span?.name, 'patchplane.operation')
      assert.deepStrictEqual(Object.fromEntries(span?.attributes ?? []), {
        operation: 'patchplane.operation',
      })
      assert.ok(
        !JSON.stringify(Object.fromEntries(span?.attributes ?? [])).includes(
          sentinel,
        ),
      )

      yield* Effect.exit(
        withTelemetrySpan(
          { name: `failed span ${sentinel}` },
          Effect.fail(new TestSpanError({ message: sentinel })),
        ),
      )
      const failedSpan = sentryMocks.spans.at(-1)
      assert.ok(failedSpan?.status !== undefined && 'exit' in failedSpan.status)
      assert.ok(Exit.isFailure(failedSpan.status.exit))
      assert.strictEqual(
        Cause.squash(failedSpan.status.exit.cause),
        'patchplane.operation.failure',
      )

      yield* withTelemetrySpan(
        { name: `parent ${sentinel}` },
        Effect.void.pipe(Effect.withSpan(`child ${sentinel}`)),
      )
      const parent = sentryMocks.spans.at(-2)
      const child = sentryMocks.spans.at(-1)
      assert.ok(parent !== undefined)
      assert.ok(child !== undefined)
      assert.strictEqual(parent.traceId, child.traceId)
      assert.ok(Option.isSome(child.parent))
      assert.strictEqual(child.parent.value.spanId, parent.spanId)
    }).pipe(Effect.provide(ConfiguredSentryLayer)),
  )

  it.effect('drops breadcrumbs outside an explicit breadcrumb scope', () =>
    Effect.gen(function* () {
      const telemetry = yield* TelemetryService

      yield* telemetry.addBreadcrumb({
        stage: makeCriticalPathStage('attempt-claim'),
        status: makeCriticalPathBreadcrumbStatus('started'),
      })
      yield* telemetry.captureError({
        error: new TestSpanError({ message: 'safe test failure' }),
      })

      assert.ok(
        sentryMocks.scopeBreadcrumbBatches.every((batch) => batch.length === 0),
      )
    }).pipe(Effect.provide(ConfiguredSentryLayer)),
  )

  it.effect('isolates breadcrumb buffers across concurrent scopes', () =>
    Effect.gen(function* () {
      const telemetry = yield* TelemetryService
      const run = (stage: ReturnType<typeof makeCriticalPathStage>) =>
        telemetry.withBreadcrumbScope(
          Effect.gen(function* () {
            yield* telemetry.addBreadcrumb({
              stage,
              status: makeCriticalPathBreadcrumbStatus('started'),
            })
            yield* Effect.yieldNow
            yield* telemetry.captureError({
              error: new TestSpanError({ message: 'safe test failure' }),
            })
          }),
        )

      yield* Effect.all(
        [
          run(makeCriticalPathStage('source-pinning')),
          run(makeCriticalPathStage('publication')),
        ],
        { concurrency: 'unbounded', discard: true },
      )

      const batches = sentryMocks.scopeBreadcrumbBatches.filter(
        (batch) => batch.length > 0,
      ) as Array<
        Array<{ readonly data?: { readonly criticalPathStage?: string } }>
      >
      assert.strictEqual(batches.length, 2)
      assert.deepStrictEqual(
        batches.map((batch) => batch[0]?.data?.criticalPathStage).toSorted(),
        ['publication', 'source-pinning'],
      )
      assert.ok(batches.every((batch) => batch.length === 1))
    }).pipe(Effect.provide(ConfiguredSentryLayer)),
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

      assert.strictEqual(Exit.isSuccess(exit), true)
      assert.strictEqual(sentryMocks.captureException.mock.calls.length, 1)
    }).pipe(Effect.provide(ConfiguredSentryLayer)),
  )
})
