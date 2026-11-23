import { PgClient } from '@effect/sql-pg'
import { Duration, Layer } from 'effect'
import { ClusterWorkflowEngine, SingleRunner } from 'effect/cluster'
import * as Digest from 'effect/crypto/Digest'
import type * as Redacted from 'effect/Redacted'
import { PostgresAcceptanceStoreLayer } from './acceptance-store-pg'
import { PostgresSandboxLifecycleStoreLayer } from './sandbox-lifecycle-store-pg'

export interface PostgresSingleStoreConfig {
  readonly url: Redacted.Redacted
  readonly maxConnections?: number
  readonly entityMailboxPollIntervalMs?: number
  readonly prepare?: boolean
}

export const makePostgresSqlLayer = (config: PostgresSingleStoreConfig) =>
  PgClient.layer({
    url: config.url,
    maxConnections: config.maxConnections ?? 10,
    ...(config.prepare !== undefined ? { prepare: config.prepare } : {}),
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
  }).pipe(Layer.provide(Digest.layerWebCrypto))

  return ClusterWorkflowEngine.layer.pipe(
    Layer.provideMerge(runnerLayer),
    Layer.provideMerge(PostgresAcceptanceStoreLayer),
    Layer.provideMerge(PostgresSandboxLifecycleStoreLayer),
    Layer.provideMerge(Digest.layerWebCrypto),
    Layer.provideMerge(sqlLayer),
  )
}
