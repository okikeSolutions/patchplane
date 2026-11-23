import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'
import { MigrationFailureError } from '@patchplane/domain'

export interface SqlMigrationFile {
  readonly name: string
  readonly sql: string
  readonly sha256: string
}

export const DEFAULT_POSTGRES_MIGRATIONS_DIR = resolve(
  import.meta.dirname,
  'migrations',
)

export const loadSqlMigrations = Effect.fn(
  'PostgresMigrator.loadSqlMigrations',
)(function* (directory: string = DEFAULT_POSTGRES_MIGRATIONS_DIR) {
  const filenames = yield* Effect.try({
    try: () =>
      readdirSync(directory)
        .filter((name) => name.endsWith('.sql'))
        .toSorted(),
    catch: (cause) =>
      new MigrationFailureError({
        migrationName: directory,
        reason: String(cause),
      }),
  })

  const migrations: Array<SqlMigrationFile> = []
  for (const name of filenames) {
    const sql = yield* Effect.try({
      try: () => readFileSync(join(directory, name), 'utf8'),
      catch: (cause) =>
        new MigrationFailureError({
          migrationName: name,
          reason: String(cause),
        }),
    })
    const sha256 = createHash('sha256').update(sql).digest('hex')
    migrations.push({ name, sql, sha256 })
  }
  return migrations
})

function splitSqlStatements(sql: string): ReadonlyArray<string> {
  return sql
    .split(';')
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0)
}

export const applySqlMigrations = Effect.fn(
  'PostgresMigrator.applySqlMigrations',
)(function* (migrations: ReadonlyArray<SqlMigrationFile>) {
  const sql = yield* SqlClient.SqlClient

  yield* sql`
    CREATE TABLE IF NOT EXISTS patchplane_migrations (
      name TEXT PRIMARY KEY,
      sha256 TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.pipe(
    Effect.mapError(
      (cause) =>
        new MigrationFailureError({
          migrationName: 'patchplane_migrations',
          reason: String(cause),
        }),
    ),
  )

  const appliedRows = yield* sql<{
    readonly name: string
    readonly sha256: string
  }>`SELECT name, sha256 FROM patchplane_migrations ORDER BY name ASC`.pipe(
    Effect.mapError(
      (cause) =>
        new MigrationFailureError({
          migrationName: 'patchplane_migrations',
          reason: String(cause),
        }),
    ),
  )

  const appliedByName = new Map(
    appliedRows.map((row) => [row.name, row.sha256] as const),
  )
  const appliedNames: Array<string> = []

  for (const migration of migrations) {
    const existingHash = appliedByName.get(migration.name)
    if (existingHash !== undefined) {
      if (existingHash !== migration.sha256) {
        return yield* new MigrationFailureError({
          migrationName: migration.name,
          reason: `Migration checksum mismatch: expected ${existingHash}, got ${migration.sha256}`,
        })
      }
      continue
    }

    const statements = splitSqlStatements(migration.sql)
    yield* sql
      .withTransaction(
        Effect.gen(function* () {
          for (const statement of statements) {
            yield* sql.unsafe(statement)
          }
          yield* sql`
            INSERT INTO patchplane_migrations (name, sha256)
            VALUES (${migration.name}, ${migration.sha256})
          `
        }),
      )
      .pipe(
        Effect.mapError(
          (cause) =>
            new MigrationFailureError({
              migrationName: migration.name,
              reason: String(cause),
            }),
        ),
      )

    appliedNames.push(migration.name)
  }

  return appliedNames
})
