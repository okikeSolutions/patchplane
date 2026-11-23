import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { Effect, FileSystem, Schema } from 'effect'
import { SqlClient } from 'effect/sql'
import { MigrationFailureError } from '@patchplane/domain'

export interface SqlMigrationFile {
  readonly name: string
  readonly sql: string
  readonly sha256: string
}

const AppliedMigrationRow = Schema.Struct({
  name: Schema.NonEmptyString,
  sha256: Schema.NonEmptyString,
})

const MIGRATIONS_ADVISORY_LOCK_KEY = 20_261_123

export const DEFAULT_POSTGRES_MIGRATIONS_DIR = resolve(
  import.meta.dirname,
  'migrations',
)

const migrationError = (migrationName: string) =>
  Effect.mapError(
    (cause: unknown) =>
      new MigrationFailureError({
        migrationName,
        reason: String(cause),
        cause,
      }),
  )

export const loadSqlMigrations = Effect.fn(
  'PostgresMigrator.loadSqlMigrations',
)(function* (directory: string = DEFAULT_POSTGRES_MIGRATIONS_DIR) {
  const fs = yield* FileSystem.FileSystem
  const entries = yield* fs
    .readDirectory(directory)
    .pipe(migrationError(directory))

  const filenames = entries.filter((name) => name.endsWith('.sql')).toSorted()

  const migrations: Array<SqlMigrationFile> = []
  for (const name of filenames) {
    const sql = yield* fs
      .readFileString(join(directory, name))
      .pipe(migrationError(name))
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

  return yield* sql
    .withTransaction(
      Effect.gen(function* () {
        yield* sql`SELECT pg_advisory_xact_lock(${MIGRATIONS_ADVISORY_LOCK_KEY})`.pipe(
          migrationError('patchplane_migrations'),
        )

        yield* sql`
          CREATE TABLE IF NOT EXISTS patchplane_migrations (
            name TEXT PRIMARY KEY,
            sha256 TEXT NOT NULL,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
          )
        `.pipe(migrationError('patchplane_migrations'))

        const rawRows =
          yield* sql`SELECT name, sha256 FROM patchplane_migrations ORDER BY name ASC`.pipe(
            migrationError('patchplane_migrations'),
          )

        const appliedRows = yield* Effect.forEach(rawRows, (row) =>
          Schema.decodeUnknownEffect(AppliedMigrationRow)(row).pipe(
            migrationError('patchplane_migrations'),
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
          for (const statement of statements) {
            yield* sql.unsafe(statement).pipe(migrationError(migration.name))
          }
          yield* sql`
            INSERT INTO patchplane_migrations (name, sha256)
            VALUES (${migration.name}, ${migration.sha256})
          `.pipe(migrationError(migration.name))

          appliedNames.push(migration.name)
        }

        return appliedNames
      }),
    )
    .pipe(
      Effect.catchTag('SqlError', (sqlError) =>
        Effect.fail(
          new MigrationFailureError({
            migrationName: 'patchplane_migrations',
            reason: String(sqlError),
            cause: sqlError,
          }),
        ),
      ),
    )
})
