import { Duration, Effect, Schema } from 'effect'
import { Activity, DurableClock, Workflow } from 'effect/workflow'
import {
  AttemptGeneration,
  ChangeRequestId,
  PersistenceError,
  PrepareDigest,
  StaleAttemptOwnershipError,
  StepRunnerError,
  VerificationAttempt,
  VerificationAttemptId,
} from '@patchplane/domain'
import { AcceptanceStore } from '../services/acceptance-store'
import { VerificationStepRunner } from '../services/verification-step-runner'

export const VerificationAttemptWorkflowPayload = Schema.Struct({
  attemptId: VerificationAttemptId,
  changeRequestId: ChangeRequestId,
  initialGeneration: AttemptGeneration,
  waitDurationMs: Schema.Number.check(
    Schema.isInt(),
    Schema.isGreaterThanOrEqualTo(0),
  ),
})
export interface VerificationAttemptWorkflowPayload extends Schema.Schema.Type<
  typeof VerificationAttemptWorkflowPayload
> {}

export const VerificationAttemptWorkflowResult = Schema.Struct({
  attempt: VerificationAttempt,
  prepareDigest: PrepareDigest,
})
export interface VerificationAttemptWorkflowResult extends Schema.Schema.Type<
  typeof VerificationAttemptWorkflowResult
> {}

export const VerificationAttemptWorkflowError = Schema.Union([
  StaleAttemptOwnershipError,
  PersistenceError,
  StepRunnerError,
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

export const VerificationAttemptWorkflowLayer =
  VerificationAttemptWorkflow.toLayer(
    Effect.fn('VerificationAttemptWorkflow.execute')(function* (payload) {
      const running = yield* Activity.make({
        name: 'mark-attempt-running',
        success: VerificationAttempt,
        error: VerificationAttemptWorkflowError,
        execute: Effect.gen(function* () {
          const store = yield* AcceptanceStore
          return yield* store.advanceAttemptState({
            attemptId: payload.attemptId,
            expectedGeneration: payload.initialGeneration,
            nextStatus: 'running',
          })
        }),
      })

      const prepareDigest = yield* Activity.make({
        name: 'prepare-attempt',
        success: PrepareDigest,
        error: VerificationAttemptWorkflowError,
        execute: Effect.gen(function* () {
          const runner = yield* VerificationStepRunner
          return yield* runner.runPrepare({
            attemptId: payload.attemptId,
            changeRequestId: payload.changeRequestId,
          })
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
            expectedGeneration: running.generation,
            nextStatus: 'passed',
          })
        }),
      })

      return {
        attempt: finalized,
        prepareDigest,
      }
    }),
  )
