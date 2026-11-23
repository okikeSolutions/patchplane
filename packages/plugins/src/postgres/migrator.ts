import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { Effect, FileSystem, Schema } from 'effect'
import { SqlClient } from 'effect/sql'
import { MigrationFailureError, sanitizeErrorMessage } from '@patchplane/domain'

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
const SAFE_MIGRATION_FILENAME = /^[A-Za-z0-9._-]+\.sql$/

export const DEFAULT_POSTGRES_MIGRATIONS_DIR = resolve(
  import.meta.dirname,
  'migrations',
)

const migrationError = (migrationName: string) =>
  Effect.mapError(
    (cause: unknown) =>
      new MigrationFailureError({
        migrationName,
        reason: sanitizeErrorMessage(cause),
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
    if (!SAFE_MIGRATION_FILENAME.test(name) || name.includes('..')) {
      return yield* new MigrationFailureError({
        migrationName: name,
        reason: `Unsafe migration filename rejected: ${name}`,
      })
    }
    const sql = yield* fs
      .readFileString(join(directory, name))
      .pipe(migrationError(name))
    const sha256 = createHash('sha256').update(sql).digest('hex')
    migrations.push({ name, sql, sha256 })
  }
  return migrations
})

/**
 * Lexer-aware PostgreSQL statement splitter that respects single-quoted strings
 * (with `''` escapes), double-quoted identifiers (with `""` escapes), `--` line
 * comments, nested `/* ... *\/` block comments, and `$tag$...$tag$` dollar-quoted
 * blocks so embedded semicolons never corrupt DDL/PLpgSQL migrations.
 */
export function splitSqlStatements(sql: string): ReadonlyArray<string> {
  const statements: Array<string> = []
  let start = 0
  let index = 0
  let hasCode = false

  while (index < sql.length) {
    const ch = sql[index]
    const next = sql[index + 1]

    // Line comment: -- ... \n
    if (ch === '-' && next === '-') {
      index += 2
      while (index < sql.length && sql[index] !== '\n') {
        index += 1
      }
      continue
    }

    // Nested block comment: /* ... */
    if (ch === '/' && next === '*') {
      index += 2
      let depth = 1
      while (index < sql.length && depth > 0) {
        if (sql[index] === '/' && sql[index + 1] === '*') {
          depth += 1
          index += 2
        } else if (sql[index] === '*' && sql[index + 1] === '/') {
          depth -= 1
          index += 2
        } else {
          index += 1
        }
      }
      continue
    }

    // Single-quoted string literal: '...' ('' escapes)
    if (ch === "'") {
      hasCode = true
      index += 1
      while (index < sql.length) {
        if (sql[index] === "'") {
          if (sql[index + 1] === "'") {
            index += 2
            continue
          }
          index += 1
          break
        }
        index += 1
      }
      continue
    }

    // Double-quoted identifier: "..." ("" escapes)
    if (ch === '"') {
      hasCode = true
      index += 1
      while (index < sql.length) {
        if (sql[index] === '"') {
          if (sql[index + 1] === '"') {
            index += 2
            continue
          }
          index += 1
          break
        }
        index += 1
      }
      continue
    }

    // Dollar-quoted string: $tag$...$tag$
    if (ch === '$') {
      const rest = sql.slice(index)
      const tagMatch = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(rest)
      if (tagMatch !== null) {
        hasCode = true
        const tag = tagMatch[0]
        index += tag.length
        const closingIndex = sql.indexOf(tag, index)
        if (closingIndex === -1) {
          index = sql.length
        } else {
          index = closingIndex + tag.length
        }
        continue
      }
    }

    if (ch === ';') {
      const chunk = sql.slice(start, index).trim()
      if (hasCode && chunk.length > 0) {
        statements.push(chunk)
      }
      start = index + 1
      hasCode = false
      index += 1
      continue
    }

    if (ch !== undefined && !/\s/.test(ch)) {
      hasCode = true
    }
    index += 1
  }

  const tail = sql.slice(start).trim()
  if (hasCode && tail.length > 0) {
    statements.push(tail)
  }
  return statements
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

          appliedByName.set(migration.name, migration.sha256)
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
            reason: sanitizeErrorMessage(sqlError),
            cause: sqlError,
          }),
        ),
      ),
    )
})
