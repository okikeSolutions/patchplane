import { Clock, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'
import {
  AcceptanceStore,
  VerificationAttemptWorkflow,
  VerificationAttemptWorkflowLayer,
  VerificationStepRunner,
} from '@patchplane/core'
import {
  type ChangeRequestId,
  type VerificationAttemptId,
} from '@patchplane/domain'
import {
  makePostgresSingleStoreClusterLayer,
  type PostgresSingleStoreConfig,
} from '@patchplane/plugins'

export const DefaultVerificationStepRunnerLayer = Layer.succeed(
  VerificationStepRunner,
  VerificationStepRunner.of({
    runPrepare: Effect.fn('DefaultVerificationStepRunner.runPrepare')(
      function* ({ attemptId, changeRequestId }) {
        return yield* Effect.succeed(`prepared:${changeRequestId}:${attemptId}`)
      },
    ),
  }),
)

export const makeControlPlaneSingleStoreLayer = (
  config: PostgresSingleStoreConfig,
  runnerLayer: Layer.Layer<VerificationStepRunner> = DefaultVerificationStepRunnerLayer,
) => {
  const clusterLayer = makePostgresSingleStoreClusterLayer(config)
  const workflowLayer = VerificationAttemptWorkflowLayer.pipe(
    Layer.provide(Layer.merge(clusterLayer, runnerLayer)),
  )
  return Layer.mergeAll(clusterLayer, runnerLayer, workflowLayer)
}

export const wakeControlPlane = Effect.fn('Server.wakeControlPlane')(
  function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{ readonly ok: number }>`SELECT 1 AS ok`
    const wokenAt = yield* Clock.currentTimeMillis
    return {
      ok: rows[0]?.ok === 1,
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
