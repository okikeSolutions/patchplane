import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import type { CandidatePatchSet } from '@patchplane/domain/decision-review'
import {
  makeCandidatePatchSetId,
  makeSandboxExecutionId,
  makeWorkflowRunId,
} from '@patchplane/domain/ids'
import { TelemetryService } from '../services/telemetry-service'
import {
  withAttemptClaimTransition,
  withCandidateFreezeTransition,
  withRequirementsPersistedTransition,
  withSandboxExecutionTransition,
  withVerificationTransition,
} from './sandbox-workflow-telemetry'

const workflowRunId = makeWorkflowRunId('workflow-1')
const sandboxExecutionId = makeSandboxExecutionId('sandbox-1')

function candidate(status: CandidatePatchSet['status']): CandidatePatchSet {
  return {
    id: makeCandidatePatchSetId(`candidate-${status}`),
    workflowRunId,
    sandboxExecutionId,
    status,
    createdAt: 1,
  }
}

describe('sandbox workflow critical-path transitions', () => {
  it.effect('records the shared successful workflow stage sequence', () => {
    const breadcrumbs: Array<{
      readonly stage: string
      readonly status: string
    }> = []
    const telemetryLayer = Layer.succeed(
      TelemetryService,
      TelemetryService.of({
        recordEvent: () => Effect.void,
        addBreadcrumb: (input) =>
          Effect.sync(() => {
            breadcrumbs.push({ stage: input.stage, status: input.status })
          }),
        withBreadcrumbScope: (effect) => effect,
        captureError: () => Effect.void,
        withSpan: (_input, effect) => effect,
      }),
    )
    const context = {
      traceId: 'trace-1',
      workflowRunId,
      operation: 'sandboxWorkflow.test',
    }

    return Effect.gen(function* () {
      yield* withAttemptClaimTransition(context, Effect.succeed(true))
      yield* withRequirementsPersistedTransition(context, Effect.void)
      yield* withSandboxExecutionTransition(context, Effect.void)
      yield* withCandidateFreezeTransition(
        context,
        Effect.succeed(candidate('captured')),
      )
      yield* withVerificationTransition(context, Effect.void)

      assert.deepStrictEqual(breadcrumbs, [
        { stage: 'attempt-claim', status: 'started' },
        { stage: 'attempt-claim', status: 'succeeded' },
        { stage: 'requirements-persisted', status: 'started' },
        { stage: 'requirements-persisted', status: 'succeeded' },
        { stage: 'sandbox-execution', status: 'started' },
        { stage: 'sandbox-execution', status: 'succeeded' },
        { stage: 'candidate-frozen', status: 'started' },
        { stage: 'candidate-frozen', status: 'succeeded' },
        { stage: 'verification', status: 'started' },
        { stage: 'verification', status: 'succeeded' },
      ])
    }).pipe(Effect.provide(telemetryLayer))
  })

  it.effect(
    'distinguishes duplicate, empty, failed, and effect-failure outcomes',
    () => {
      const breadcrumbs: Array<{
        readonly stage: string
        readonly status: string
      }> = []
      const telemetryLayer = Layer.succeed(
        TelemetryService,
        TelemetryService.of({
          recordEvent: () => Effect.void,
          addBreadcrumb: (input) =>
            Effect.sync(() => {
              breadcrumbs.push({ stage: input.stage, status: input.status })
            }),
          withBreadcrumbScope: (effect) => effect,
          captureError: () => Effect.void,
          withSpan: (_input, effect) => effect,
        }),
      )
      const context = {
        traceId: 'trace-1',
        workflowRunId,
        operation: 'sandboxWorkflow.test',
      }

      return Effect.gen(function* () {
        yield* withAttemptClaimTransition(context, Effect.succeed(false))
        yield* withCandidateFreezeTransition(
          context,
          Effect.succeed(candidate('empty')),
        )
        yield* withCandidateFreezeTransition(
          context,
          Effect.succeed(candidate('failed')),
        )
        yield* Effect.flip(
          withSandboxExecutionTransition(
            context,
            Effect.fail('provider error'),
          ),
        )

        assert.deepStrictEqual(breadcrumbs, [
          { stage: 'attempt-claim', status: 'started' },
          { stage: 'attempt-claim', status: 'blocked' },
          { stage: 'candidate-frozen', status: 'started' },
          { stage: 'candidate-frozen', status: 'blocked' },
          { stage: 'candidate-frozen', status: 'started' },
          { stage: 'candidate-frozen', status: 'failed' },
          { stage: 'sandbox-execution', status: 'started' },
          { stage: 'sandbox-execution', status: 'failed' },
        ])
      }).pipe(Effect.provide(telemetryLayer))
    },
  )
})
