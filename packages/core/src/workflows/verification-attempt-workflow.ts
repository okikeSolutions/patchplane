import { Duration, Effect, Schema } from 'effect'
import { Activity, DurableClock, Workflow } from 'effect/workflow'
import {
  AttemptGeneration,
  ChangeRequestId,
  PersistenceError,
  StaleAttemptOwnershipError,
  VerificationAttempt,
  VerificationAttemptId,
} from '@patchplane/domain'
import {
  AcceptanceStore,
  VerificationStepRunner,
} from '../services/acceptance-store'

export const VerificationAttemptWorkflowPayload = Schema.Struct({
  attemptId: VerificationAttemptId,
  changeRequestId: ChangeRequestId,
  initialGeneration: AttemptGeneration,
  waitDurationMs: Schema.Number.check(
    Schema.isInt(),
    Schema.isGreaterThanOrEqualTo(0),
  ),
})
export type VerificationAttemptWorkflowPayload =
  typeof VerificationAttemptWorkflowPayload.Type

export const VerificationAttemptWorkflowResult = Schema.Struct({
  attempt: VerificationAttempt,
  prepareDigest: Schema.NonEmptyString,
})
export type VerificationAttemptWorkflowResult =
  typeof VerificationAttemptWorkflowResult.Type

export const VerificationAttemptWorkflowError = Schema.Union([
  StaleAttemptOwnershipError,
  PersistenceError,
])

export const VerificationAttemptWorkflow = Workflow.make(
  'VerificationAttemptWorkflow',
  {
    payload: VerificationAttemptWorkflowPayload,
    success: VerificationAttemptWorkflowResult,
    error: VerificationAttemptWorkflowError,
    idempotencyKey: ({ attemptId }) => attemptId,
  },
)

const PrepareAttemptResult = Schema.Struct({
  attempt: VerificationAttempt,
  prepareDigest: Schema.NonEmptyString,
})

export const VerificationAttemptWorkflowLayer =
  VerificationAttemptWorkflow.toLayer(
    Effect.fn('VerificationAttemptWorkflow.execute')(function* (payload) {
      const prepared = yield* Activity.make({
        name: 'prepare-attempt',
        success: PrepareAttemptResult,
        error: VerificationAttemptWorkflowError,
        execute: Effect.gen(function* () {
          const store = yield* AcceptanceStore
          const runner = yield* VerificationStepRunner
          const running = yield* store.advanceAttemptState({
            attemptId: payload.attemptId,
            expectedGeneration: payload.initialGeneration,
            nextStatus: 'running',
          })
          const prepareDigest = yield* runner.runPrepare({
            attemptId: payload.attemptId,
            changeRequestId: payload.changeRequestId,
          })
          return {
            attempt: running,
            prepareDigest,
          }
        }),
      })

      if (payload.waitDurationMs > 0) {
        yield* DurableClock.sleep({
          name: 'attempt-verification-wait',
          duration: Duration.millis(payload.waitDurationMs),
          inMemoryThreshold: Duration.zero,
        })
      }

      const finalized = yield* Activity.make({
        name: 'finalize-attempt',
        success: VerificationAttempt,
        error: VerificationAttemptWorkflowError,
        execute: Effect.gen(function* () {
          const store = yield* AcceptanceStore
          return yield* store.advanceAttemptState({
            attemptId: payload.attemptId,
            expectedGeneration: prepared.attempt.generation,
            nextStatus: 'passed',
          })
        }),
      })

      return {
        attempt: finalized,
        prepareDigest: prepared.prepareDigest,
      }
    }),
  )
