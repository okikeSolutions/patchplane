import { assert, describe, it } from '@effect/vitest'
import { Cause, Effect, Exit, Layer } from 'effect'
import {
  captureTelemetryCause,
  criticalPathBreadcrumbStatuses,
  criticalPathStages,
  makeCriticalPathBreadcrumbStatus,
  makeCriticalPathStage,
  TelemetryService,
  telemetryAttributes,
  telemetryContextAttributes,
  withCriticalPathBreadcrumbScope,
  withCriticalPathTransition,
  withCriticalPathTransitionOutcome,
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

  it.effect('records successful and failed critical-path transitions', () => {
    const captured: unknown[] = []
    const TestTelemetryLayer = Layer.succeed(
      TelemetryService,
      TelemetryService.of({
        recordEvent: () => Effect.void,
        addBreadcrumb: (input) => Effect.sync(() => captured.push(input)),
        withBreadcrumbScope: (effect) => effect,
        captureError: () => Effect.void,
        withSpan: (_input, effect) => effect,
      }),
    )

    return Effect.gen(function* () {
      const success = yield* withCriticalPathTransition(
        {
          traceId: 'trace-1',
          workflowRunId: 'run-1',
          operation: 'test.transition',
          stage: criticalPathStages.verification,
        },
        Effect.succeed('ok'),
      )
      yield* Effect.flip(
        withCriticalPathTransition(
          {
            traceId: 'trace-1',
            workflowRunId: 'run-1',
            operation: 'test.transition',
            stage: criticalPathStages.policy,
          },
          Effect.fail('expected failure'),
        ),
      )
      yield* withCriticalPathTransitionOutcome(
        {
          traceId: 'trace-1',
          workflowRunId: 'run-1',
          operation: 'test.transition',
          stage: criticalPathStages.attemptClaim,
        },
        Effect.succeed(false),
        (claimed) =>
          claimed
            ? criticalPathBreadcrumbStatuses.succeeded
            : criticalPathBreadcrumbStatuses.blocked,
      )

      assert.strictEqual(success, 'ok')
      assert.deepStrictEqual(
        captured.map((input) => ({
          stage: (input as { stage: string }).stage,
          status: (input as { status: string }).status,
        })),
        [
          { stage: 'verification', status: 'started' },
          { stage: 'verification', status: 'succeeded' },
          { stage: 'policy', status: 'started' },
          { stage: 'policy', status: 'failed' },
          { stage: 'attempt-claim', status: 'started' },
          { stage: 'attempt-claim', status: 'blocked' },
        ],
      )
    }).pipe(Effect.provide(TestTelemetryLayer))
  })

  it.effect(
    'keeps breadcrumb recording fail-open and scopes the wrapped effect',
    () => {
      let scopeEntered = false
      const TestTelemetryLayer = Layer.succeed(
        TelemetryService,
        TelemetryService.of({
          recordEvent: () => Effect.void,
          addBreadcrumb: () => Effect.die('telemetry unavailable'),
          withBreadcrumbScope: (effect) =>
            Effect.sync(() => {
              scopeEntered = true
            }).pipe(Effect.andThen(effect)),
          captureError: () => Effect.void,
          withSpan: (_input, effect) => effect,
        }),
      )

      return Effect.gen(function* () {
        const result = yield* withCriticalPathBreadcrumbScope(
          withCriticalPathTransition(
            {
              operation: 'test.failOpen',
              stage: criticalPathStages.sandboxExecution,
            },
            Effect.succeed('ok'),
          ),
        )

        assert.strictEqual(result, 'ok')
        assert.strictEqual(scopeEntered, true)
      }).pipe(Effect.provide(TestTelemetryLayer))
    },
  )

  it.effect('does not swallow interruption while recording breadcrumbs', () => {
    let businessEffectRan = false
    const TestTelemetryLayer = Layer.succeed(
      TelemetryService,
      TelemetryService.of({
        recordEvent: () => Effect.void,
        addBreadcrumb: () => Effect.interrupt,
        withBreadcrumbScope: (effect) => effect,
        captureError: () => Effect.void,
        withSpan: (_input, effect) => effect,
      }),
    )

    return Effect.gen(function* () {
      const exit = yield* withCriticalPathTransition(
        {
          operation: 'test.interruption',
          stage: criticalPathStages.verification,
        },
        Effect.sync(() => {
          businessEffectRan = true
        }),
      ).pipe(Effect.exit)

      assert.strictEqual(Exit.isFailure(exit), true)
      assert.strictEqual(businessEffectRan, false)
    }).pipe(Effect.provide(TestTelemetryLayer))
  })

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
