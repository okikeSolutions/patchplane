import { BunFileSystem, BunPath } from '@effect/platform-bun'
import { Effect, Layer, Schema } from 'effect'
import * as Config from 'effect/Config'
import * as Digest from 'effect/crypto/Digest'
import * as Redacted from 'effect/Redacted'
import { SqlClient } from 'effect/sql'
import {
  applySqlMigrations,
  loadSqlMigrations,
  makePostgresSqlLayer,
} from '../../packages/plugins/src/index'

const TestDatabaseUrlConfig = Config.Redacted(
  'PATCHPLANE_TEST_DATABASE_URL',
).pipe(
  Config.withDefault(
    Redacted.make(
      'postgresql://patchplane:patchplane@127.0.0.1:55432/patchplane_test',
    ),
  ),
)

class UnsafeTestDatabaseError extends Schema.TaggedError<
  UnsafeTestDatabaseError,
  { readonly brand: unique symbol }
>()('UnsafeTestDatabaseError', { reason: Schema.String }) {}

/**
 * Integration tests DROP SCHEMA public. Refuse any database whose name does not
 * end in `_test` so a mis-set PATCHPLANE_TEST_DATABASE_URL cannot wipe real data.
 */
const assertDisposableTestDatabase = (url: Redacted.Redacted) =>
  Effect.gen(function* () {
    const parsed = yield* Effect.try({
      try: () => new URL(Redacted.value(url)),
      catch: () =>
        new UnsafeTestDatabaseError({
          reason: 'PATCHPLANE_TEST_DATABASE_URL is not a valid URL',
        }),
    })
    const databaseName = parsed.pathname.replace(/^\//, '')
    if (!databaseName.endsWith('_test')) {
      return yield* new UnsafeTestDatabaseError({
        reason:
          'PATCHPLANE_TEST_DATABASE_URL must name a disposable database ending in "_test"',
      })
    }
    return url
  })

export const TestDatabaseUrl = Effect.gen(function* () {
  const url = yield* TestDatabaseUrlConfig
  return yield* assertDisposableTestDatabase(url)
})

export const TestMigrationDepsLayer = Layer.mergeAll(
  BunFileSystem.layer,
  BunPath.layer,
  Digest.layerWebCrypto,
)

export const TestPostgresSqlLayer = Layer.unwrap(
  Effect.gen(function* () {
    const url = yield* TestDatabaseUrl
    return makePostgresSqlLayer({ url })
  }),
).pipe(Layer.provideMerge(TestMigrationDepsLayer))

export const resetDatabase = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql.unsafe('DROP SCHEMA IF EXISTS public CASCADE')
  yield* sql.unsafe('CREATE SCHEMA public')
})

export const resetAndMigrateDatabase = Effect.gen(function* () {
  yield* resetDatabase
  const migrations = yield* loadSqlMigrations()
  yield* applySqlMigrations(migrations)
})
