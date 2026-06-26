import { describe, expect, it } from '@effect/vitest'
import { Cause, Effect, Layer } from 'effect'
import {
  captureTelemetryCause,
  TelemetryService,
  telemetryAttributes,
  telemetryContextAttributes,
  withTelemetrySpan,
} from './telemetry-service'

describe('telemetry-service helpers', () => {
  it('keeps canonical telemetry context fields and filters undefined attributes', () => {
    expect(
      telemetryContextAttributes({
        traceId: 'trace-1',
        workflowRunId: 'run-1',
        runtimeSessionId: 'session-1',
        pluginName: 'github',
        operation: 'github.verifyWebhook',
      }),
    ).toEqual({
      traceId: 'trace-1',
      workflowRunId: 'run-1',
      runtimeSessionId: 'session-1',
      pluginName: 'github',
      operation: 'github.verifyWebhook',
    })

    expect(
      telemetryAttributes(
        { traceId: 'trace-1', operation: 'test.operation' },
        { kept: 'yes', skipped: undefined, count: 1, ok: true, none: null },
      ),
    ).toEqual({
      traceId: 'trace-1',
      operation: 'test.operation',
      kept: 'yes',
      count: 1,
      ok: true,
      none: null,
    })
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

      expect(result).toBe('ok')
    }),
  )

  it.effect('captureTelemetryCause calls TelemetryService.captureError with canonical context', () => {
    const captured: unknown[] = []
    const TestTelemetryLayer = Layer.succeed(TelemetryService, TelemetryService.of({
      recordEvent: () => Effect.void,
      captureError: (input) => Effect.sync(() => captured.push(input)),
      withSpan: (_input, effect) => effect,
    }))

    return Effect.gen(function* () {
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

      expect(captured).toHaveLength(1)
      expect(captured[0]).toMatchObject({
        traceId: 'trace-1',
        workflowRunId: 'run-1',
        runtimeSessionId: 'session-1',
        pluginName: 'test',
        operation: 'test.operation',
        message: 'test failed',
        attributes: { extra: 'value' },
      })
    }).pipe(Effect.provide(TestTelemetryLayer))
  })
})
