import { PgClient } from '@effect/sql-pg'
import { Duration, Layer, type Redacted } from 'effect'
import { ClusterWorkflowEngine, SingleRunner } from 'effect/cluster'
import * as Digest from 'effect/crypto/Digest'
import { PostgresAcceptanceStoreLayer } from './acceptance-store-pg'

export interface PostgresSingleStoreConfig {
  readonly url: Redacted.Redacted
  readonly maxConnections?: number
  readonly entityMailboxPollIntervalMs?: number
}

export const makePostgresSqlLayer = (config: PostgresSingleStoreConfig) =>
  PgClient.layer({
    url: config.url,
    maxConnections: config.maxConnections ?? 10,
  })

export const makePostgresSingleStoreClusterLayer = (
  config: PostgresSingleStoreConfig,
) => {
  const sqlLayer = makePostgresSqlLayer(config)
  const runnerLayer = SingleRunner.layer({
    runnerStorage: 'sql',
    shardingConfig: {
      entityMessagePollInterval: Duration.millis(
        config.entityMailboxPollIntervalMs ?? 200,
      ),
      entityReplyPollInterval: Duration.millis(
        config.entityMailboxPollIntervalMs ?? 200,
      ),
    },
  }).pipe(Layer.provide(Layer.merge(sqlLayer, Digest.layerWebCrypto)))

  const workflowEngineLayer = ClusterWorkflowEngine.layer.pipe(
    Layer.provide(runnerLayer),
  )
  const acceptanceStoreLayer = PostgresAcceptanceStoreLayer.pipe(
    Layer.provide(sqlLayer),
  )

  return Layer.mergeAll(
    sqlLayer,
    runnerLayer,
    workflowEngineLayer,
    acceptanceStoreLayer,
  )
}
