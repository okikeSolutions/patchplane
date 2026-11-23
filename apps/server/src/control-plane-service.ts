import { Clock, Effect, Layer, Schema } from 'effect'
import { SqlClient } from 'effect/sql'
import {
  AcceptanceStore,
  VerificationAttemptWorkflow,
  VerificationAttemptWorkflowLayer,
  VerificationStepRunner,
} from '@patchplane/core'
import {
  type ChangeRequestId,
  PersistenceError,
  PrepareDigest,
  sanitizeErrorMessage,
  StepRunnerError,
  type VerificationAttemptId,
} from '@patchplane/domain'
import {
  makePostgresSingleStoreClusterLayer,
  type PostgresSingleStoreConfig,
} from '@patchplane/plugins'

const HealthCheckRow = Schema.Struct({
  ok: Schema.Literal(1),
})

export const DefaultVerificationStepRunnerLayer = Layer.succeed(
  VerificationStepRunner,
  VerificationStepRunner.of({
    runPrepare: Effect.fn('DefaultVerificationStepRunner.runPrepare')(
      function* ({ attemptId, changeRequestId }) {
        return yield* Schema.decodeEffect(PrepareDigest)(
          `prepared:${changeRequestId}:${attemptId}`,
        ).pipe(
          Effect.mapError(
            (cause) =>
              new StepRunnerError({
                operation: 'VerificationStepRunner.runPrepare',
                message: sanitizeErrorMessage(cause),
                cause,
              }),
          ),
        )
      },
    ),
  }),
)

export const makeControlPlaneSingleStoreLayer = (
  config: PostgresSingleStoreConfig,
  runnerLayer: Layer.Layer<VerificationStepRunner> = DefaultVerificationStepRunnerLayer,
) => {
  const clusterLayer = makePostgresSingleStoreClusterLayer(config)
  return VerificationAttemptWorkflowLayer.pipe(
    Layer.provideMerge(clusterLayer),
    Layer.provideMerge(runnerLayer),
  )
}

export const wakeControlPlane = Effect.fn('Server.wakeControlPlane')(
  function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql`SELECT 1 AS ok`.pipe(
      Effect.mapError(
        (cause) =>
          new PersistenceError({
            operation: 'Server.wakeControlPlane',
            message: sanitizeErrorMessage(cause),
            cause,
          }),
      ),
    )
    const decoded = yield* Schema.decodeUnknownEffect(HealthCheckRow)(
      rows[0],
    ).pipe(
      Effect.mapError(
        (cause) =>
          new PersistenceError({
            operation: 'Server.wakeControlPlane',
            message: sanitizeErrorMessage(cause),
            cause,
          }),
      ),
    )
    const wokenAt = yield* Clock.currentTimeMillis
    return {
      ok: decoded.ok === 1,
      wokenAt,
    }
  },
)

export const claimAndStartAttempt = Effect.fn('Server.claimAndStartAttempt')(
  function* (input: {
    readonly attemptId: VerificationAttemptId
    readonly changeRequestId: ChangeRequestId
    readonly waitDurationMs: number
  }) {
    const store = yield* AcceptanceStore
    const claimed = yield* store.claimAttempt({
      attemptId: input.attemptId,
      changeRequestId: input.changeRequestId,
    })
    const executionId = yield* VerificationAttemptWorkflow.execute(
      {
        attemptId: claimed.id,
        changeRequestId: claimed.changeRequestId,
        initialGeneration: claimed.generation,
        waitDurationMs: input.waitDurationMs,
      },
      { discard: true },
    )
    return {
      attempt: claimed,
      executionId,
    }
  },
)
