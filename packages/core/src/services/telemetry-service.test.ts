import { assert, describe, it } from '@effect/vitest'
import { Cause, Effect, Layer } from 'effect'
import {
  captureTelemetryCause,
  makeCriticalPathBreadcrumbStatus,
  makeCriticalPathStage,
  TelemetryService,
  telemetryAttributes,
  telemetryContextAttributes,
  withTelemetrySpan,
} from './telemetry-service'

describe('telemetry-service helpers', () => {
  it('keeps canonical telemetry context fields and filters undefined attributes', () => {
    assert.deepStrictEqual(
      telemetryContextAttributes({
        traceId: 'trace-1',
        workflowRunId: 'run-1',
        runtimeSessionId: 'session-1',
        pluginName: 'github',
        operation: 'github.verifyWebhook',
      }),
      {
        traceId: 'trace-1',
        workflowRunId: 'run-1',
        runtimeSessionId: 'session-1',
        pluginName: 'github',
        operation: 'github.verifyWebhook',
      },
    )

    assert.deepStrictEqual(
      telemetryAttributes(
        { traceId: 'trace-1', operation: 'test.operation' },
        {
          traceId: 'spoofed-trace',
          operation: 'spoofed.operation',
          kept: 'yes',
          skipped: undefined,
          count: 1,
          ok: true,
          none: null,
        },
      ),
      {
        traceId: 'trace-1',
        operation: 'test.operation',
        kept: 'yes',
        count: 1,
        ok: true,
        none: null,
      },
    )
  })

  it.effect('withTelemetrySpan preserves the wrapped effect result', () =>
    Effect.gen(function* () {
      const result = yield* withTelemetrySpan(
        {
          name: 'test.span',
          traceId: 'trace-1',
          workflowRunId: 'run-1',
          pluginName: 'test',
          operation: 'test.operation',
        },
        Effect.succeed('ok'),
      )

      assert.strictEqual(result, 'ok')
    }),
  )

  it.effect(
    'captureTelemetryCause calls TelemetryService.captureError with canonical context',
    () => {
      const captured: unknown[] = []
      const TestTelemetryLayer = Layer.succeed(
        TelemetryService,
        TelemetryService.of({
          recordEvent: () => Effect.void,
          addBreadcrumb: (input) => Effect.sync(() => captured.push(input)),
          withBreadcrumbScope: (effect) => effect,
          captureError: (input) => Effect.sync(() => captured.push(input)),
          withSpan: (_input, effect) => effect,
        }),
      )

      return Effect.gen(function* () {
        const telemetry = yield* TelemetryService
        yield* telemetry.addBreadcrumb({
          stage: makeCriticalPathStage('candidate-frozen'),
          status: makeCriticalPathBreadcrumbStatus('succeeded'),
          traceId: 'trace-1',
        })
        yield* captureTelemetryCause({
          traceId: 'trace-1',
          workflowRunId: 'run-1',
          runtimeSessionId: 'session-1',
          pluginName: 'test',
          operation: 'test.operation',
          cause: Cause.fail(new Error('boom')),
          message: 'test failed',
          attributes: { extra: 'value' },
        })

        assert.strictEqual(captured.length, 2)
        assert.deepStrictEqual(captured[0], {
          stage: 'candidate-frozen',
          status: 'succeeded',
          traceId: 'trace-1',
        })
        assert.deepStrictEqual(captured[1], {
          traceId: 'trace-1',
          workflowRunId: 'run-1',
          runtimeSessionId: 'session-1',
          pluginName: 'test',
          operation: 'test.operation',
          error: new Error('boom'),
          message: 'test failed',
          attributes: { extra: 'value' },
        })
      }).pipe(Effect.provide(TestTelemetryLayer))
    },
  )
})
