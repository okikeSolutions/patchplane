import { assert, describe, it } from '@effect/vitest'
import { Context, Effect, Layer } from 'effect'
import {
  criticalPathStages,
  type CriticalPathStage,
  TelemetryService,
  withCriticalPathTransition,
} from '@patchplane/core/services/telemetry-service'
import { withCapturedCriticalPathScope } from './critical-path-telemetry'

interface TestBreadcrumb {
  readonly traceId?: string | undefined
  readonly stage: string
  readonly status: string
}

type TestBuffer = { readonly items: Array<TestBreadcrumb> } | undefined
class BreadcrumbBuffer extends Context.Reference<TestBuffer>(
  'SourceControlCriticalPathTelemetryTestBuffer',
  { defaultValue: () => undefined },
) {}

function runScopedFailure(traceId: string, stage: CriticalPathStage) {
  return withCapturedCriticalPathScope(
    {
      traceId,
      operation: 'sourceControl.test',
      message: 'Source-control operation failed',
    },
    withCriticalPathTransition(
      { traceId, operation: 'sourceControl.test', stage },
      Effect.fail('expected failure'),
    ),
  ).pipe(Effect.exit)
}

describe('withCapturedCriticalPathScope', () => {
  it.effect(
    'captures only request-local breadcrumbs for concurrent failures',
    () => {
      const captures: Array<{
        readonly traceId?: string | undefined
        readonly breadcrumbs: ReadonlyArray<TestBreadcrumb>
      }> = []
      const telemetryLayer = Layer.succeed(
        TelemetryService,
        TelemetryService.of({
          recordEvent: () => Effect.void,
          addBreadcrumb: (input) =>
            BreadcrumbBuffer.pipe(
              Effect.flatMap((buffer) =>
                Effect.sync(() => {
                  buffer?.items.push({
                    traceId: input.traceId,
                    stage: input.stage,
                    status: input.status,
                  })
                }),
              ),
            ),
          withBreadcrumbScope: (effect) =>
            effect.pipe(Effect.provideService(BreadcrumbBuffer, { items: [] })),
          captureError: (input) =>
            BreadcrumbBuffer.pipe(
              Effect.flatMap((buffer) =>
                Effect.sync(() => {
                  captures.push({
                    traceId: input.traceId,
                    breadcrumbs: [...(buffer?.items ?? [])],
                  })
                }),
              ),
            ),
          withSpan: (_input, effect) => effect,
        }),
      )

      return Effect.gen(function* () {
        yield* Effect.all(
          [
            runScopedFailure('trace-rerun', criticalPathStages.verification),
            runScopedFailure(
              'trace-publication',
              criticalPathStages.publicationResult,
            ),
          ],
          { concurrency: 'unbounded' },
        )

        const capturesByTraceId = new Map(
          captures.map((capture) => [capture.traceId, capture]),
        )
        assert.deepStrictEqual(
          [
            capturesByTraceId.get('trace-publication'),
            capturesByTraceId.get('trace-rerun'),
          ],
          [
            {
              traceId: 'trace-publication',
              breadcrumbs: [
                {
                  traceId: 'trace-publication',
                  stage: 'publication-result',
                  status: 'started',
                },
                {
                  traceId: 'trace-publication',
                  stage: 'publication-result',
                  status: 'failed',
                },
              ],
            },
            {
              traceId: 'trace-rerun',
              breadcrumbs: [
                {
                  traceId: 'trace-rerun',
                  stage: 'verification',
                  status: 'started',
                },
                {
                  traceId: 'trace-rerun',
                  stage: 'verification',
                  status: 'failed',
                },
              ],
            },
          ],
        )
      }).pipe(Effect.provide(telemetryLayer))
    },
  )
})
