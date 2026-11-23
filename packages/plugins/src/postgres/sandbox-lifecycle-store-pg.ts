import { Effect, Layer, Option, Schema } from 'effect'
import { SqlClient } from 'effect/sql'
import { SandboxLifecycleStore } from '@patchplane/core'
import {
  ArtifactKey,
  type ArtifactRecord,
  ChangeRequestId,
  type DecisionInboxItem,
  DecisionInboxItemKind,
  DecisionInboxItemStatus,
  type EnvironmentQuarantine,
  EnvironmentQuarantineId,
  EnvironmentQuarantineStatus,
  InboxItemId,
  PersistenceError,
  SandboxId,
  type SandboxRecord,
  SandboxStatus,
  sanitizeErrorMessage,
  Sha256Hex,
  VerificationAttemptId,
} from '@patchplane/domain'

const MAX_LIST_ROWS = 500

const LabelsRecord = Schema.Record(Schema.String, Schema.String)

const SandboxRow = Schema.Struct({
  sandbox_id: SandboxId,
  attempt_id: VerificationAttemptId,
  change_request_id: ChangeRequestId,
  status: SandboxStatus,
  labels: Schema.Union([LabelsRecord, Schema.fromJsonString(LabelsRecord)]),
})

const ArtifactRow = Schema.Struct({
  artifact_key: ArtifactKey,
  attempt_id: VerificationAttemptId,
  sha256: Sha256Hex,
  byte_length: Schema.Number.check(
    Schema.isInt(),
    Schema.isGreaterThanOrEqualTo(0),
  ),
  content_type: Schema.NonEmptyString,
})

const QuarantineRow = Schema.Struct({
  id: EnvironmentQuarantineId,
  attempt_id: VerificationAttemptId,
  sandbox_id: SandboxId,
  reason: Schema.NonEmptyString,
  status: EnvironmentQuarantineStatus,
})

const InboxItemRow = Schema.Struct({
  id: InboxItemId,
  attempt_id: VerificationAttemptId,
  kind: DecisionInboxItemKind,
  status: DecisionInboxItemStatus,
  summary: Schema.NonEmptyString,
  sandbox_id: Schema.NullOr(SandboxId),
})

const toPersistenceError =
  (operation: string) =>
  (cause: unknown): PersistenceError =>
    new PersistenceError({
      operation,
      message: sanitizeErrorMessage(cause),
      cause,
    })

const persistenceError = (operation: string) =>
  Effect.mapError(toPersistenceError(operation))

const decodeSandboxRow = (row: unknown, operation: string) =>
  Schema.decodeUnknownEffect(SandboxRow)(row).pipe(
    Effect.map((decoded): SandboxRecord => ({
      sandboxId: decoded.sandbox_id,
      attemptId: decoded.attempt_id,
      changeRequestId: decoded.change_request_id,
      status: decoded.status,
      labels: decoded.labels,
    })),
    persistenceError(operation),
  )

const decodeArtifactRow = (row: unknown, operation: string) =>
  Schema.decodeUnknownEffect(ArtifactRow)(row).pipe(
    Effect.map((decoded): ArtifactRecord => ({
      artifactKey: decoded.artifact_key,
      attemptId: decoded.attempt_id,
      sha256: decoded.sha256,
      byteLength: decoded.byte_length,
      contentType: decoded.content_type,
    })),
    persistenceError(operation),
  )

const decodeQuarantineRow = (row: unknown, operation: string) =>
  Schema.decodeUnknownEffect(QuarantineRow)(row).pipe(
    Effect.map((decoded): EnvironmentQuarantine => ({
      id: decoded.id,
      attemptId: decoded.attempt_id,
      sandboxId: decoded.sandbox_id,
      reason: decoded.reason,
      status: decoded.status,
    })),
    persistenceError(operation),
  )

const decodeInboxItemRow = (row: unknown, operation: string) =>
  Schema.decodeUnknownEffect(InboxItemRow)(row).pipe(
    Effect.map((decoded): DecisionInboxItem => ({
      id: decoded.id,
      attemptId: decoded.attempt_id,
      kind: decoded.kind,
      status: decoded.status,
      summary: decoded.summary,
      ...(decoded.sandbox_id !== null ? { sandboxId: decoded.sandbox_id } : {}),
    })),
    persistenceError(operation),
  )

export const PostgresSandboxLifecycleStoreLayer = Layer.effect(
  SandboxLifecycleStore,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    const listActiveSandboxes = Effect.gen(function* () {
      const operation = 'SandboxLifecycleStore.listActiveSandboxes'
      const rows = yield* sql`
        SELECT sandbox_id, attempt_id, change_request_id, status, labels
        FROM verification_sandboxes
        WHERE status = 'active'
        ORDER BY created_at ASC
        LIMIT ${MAX_LIST_ROWS}
      `.pipe(persistenceError(operation))

      return yield* Effect.forEach(rows, (row) =>
        decodeSandboxRow(row, operation),
      )
    }).pipe(
      Effect.withSpan('PostgresSandboxLifecycleStore.listActiveSandboxes'),
    )

    const listQuarantinedEnvironments = Effect.gen(function* () {
      const operation = 'SandboxLifecycleStore.listQuarantinedEnvironments'
      const rows = yield* sql`
        SELECT id, attempt_id, sandbox_id, reason, status
        FROM environment_quarantines
        WHERE status = 'quarantined'
        ORDER BY created_at ASC
        LIMIT ${MAX_LIST_ROWS}
      `.pipe(persistenceError(operation))

      return yield* Effect.forEach(rows, (row) =>
        decodeQuarantineRow(row, operation),
      )
    }).pipe(
      Effect.withSpan(
        'PostgresSandboxLifecycleStore.listQuarantinedEnvironments',
      ),
    )

    const listOpenInboxItems = Effect.gen(function* () {
      const operation = 'SandboxLifecycleStore.listOpenInboxItems'
      const rows = yield* sql`
        SELECT id, attempt_id, kind, status, summary, sandbox_id
        FROM decision_inbox_items
        WHERE status = 'open'
        ORDER BY created_at ASC
        LIMIT ${MAX_LIST_ROWS}
      `.pipe(persistenceError(operation))

      return yield* Effect.forEach(rows, (row) =>
        decodeInboxItemRow(row, operation),
      )
    }).pipe(Effect.withSpan('PostgresSandboxLifecycleStore.listOpenInboxItems'))

    return SandboxLifecycleStore.of({
      recordSandboxCreated: Effect.fn(
        'PostgresSandboxLifecycleStore.recordSandboxCreated',
      )(function* ({ sandboxId, attemptId, changeRequestId, labels }) {
        const operation = 'SandboxLifecycleStore.recordSandboxCreated'
        const labelsJson = JSON.stringify(labels)
        // Guard state machine: never regress a 'deleted' or 'quarantined'
        // sandbox back to 'active'.
        const rows = yield* sql`
          INSERT INTO verification_sandboxes (sandbox_id, attempt_id, change_request_id, status, labels)
          VALUES (${sandboxId}, ${attemptId}, ${changeRequestId}, 'active', ${labelsJson}::jsonb)
          ON CONFLICT (sandbox_id) DO UPDATE
            SET labels = EXCLUDED.labels
            WHERE verification_sandboxes.status = 'active'
          RETURNING sandbox_id, attempt_id, change_request_id, status, labels
        `.pipe(persistenceError(operation))

        const first = rows[0]
        if (first === undefined) {
          return yield* new PersistenceError({
            operation,
            message: `Refusing to reactivate non-active sandbox "${sandboxId}"`,
          })
        }
        return yield* decodeSandboxRow(first, operation)
      }),

      markSandboxDeleted: Effect.fn(
        'PostgresSandboxLifecycleStore.markSandboxDeleted',
      )(function* ({ sandboxId, attemptId, changeRequestId, labels }) {
        const operation = 'SandboxLifecycleStore.markSandboxDeleted'
        const labelsJson = JSON.stringify(labels)
        // Insert a 'deleted' audit row for pre-DB-crash orphans, and refuse to
        // overwrite a 'quarantined' sandbox without an explicit quarantine release.
        const rows = yield* sql`
          INSERT INTO verification_sandboxes (sandbox_id, attempt_id, change_request_id, status, labels, deleted_at)
          VALUES (${sandboxId}, ${attemptId}, ${changeRequestId}, 'deleted', ${labelsJson}::jsonb, now())
          ON CONFLICT (sandbox_id) DO UPDATE
            SET status = 'deleted',
                deleted_at = COALESCE(verification_sandboxes.deleted_at, now())
            WHERE verification_sandboxes.status <> 'quarantined'
          RETURNING sandbox_id
        `.pipe(persistenceError(operation))

        if (rows[0] === undefined) {
          return yield* new PersistenceError({
            operation,
            message: `Cannot mark quarantined sandbox "${sandboxId}" deleted without releasing quarantine`,
          })
        }
        return yield* Effect.void
      }),

      recordArtifactMetadata: Effect.fn(
        'PostgresSandboxLifecycleStore.recordArtifactMetadata',
      )(function* (artifact) {
        const operation = 'SandboxLifecycleStore.recordArtifactMetadata'
        // Enforce artifact immutability across attempts and digests: replaying
        // the exact same (artifact_key, attempt_id, sha256) is idempotent, but
        // overwriting an existing key for another attempt or digest is rejected.
        const rows = yield* sql`
          INSERT INTO verification_artifacts (artifact_key, attempt_id, sha256, byte_length, content_type)
          VALUES (${artifact.artifactKey}, ${artifact.attemptId}, ${artifact.sha256}, ${artifact.byteLength}, ${artifact.contentType})
          ON CONFLICT (artifact_key) DO UPDATE
            SET byte_length = EXCLUDED.byte_length,
                content_type = EXCLUDED.content_type
            WHERE verification_artifacts.attempt_id = EXCLUDED.attempt_id
              AND verification_artifacts.sha256 = EXCLUDED.sha256
          RETURNING artifact_key, attempt_id, sha256, byte_length, content_type
        `.pipe(persistenceError(operation))

        const first = rows[0]
        if (first === undefined) {
          return yield* new PersistenceError({
            operation,
            message: `Refusing to overwrite immutable artifact "${artifact.artifactKey}" with conflicting attempt or digest`,
          })
        }
        return yield* decodeArtifactRow(first, operation)
      }),

      quarantineSandboxEnvironment: Effect.fn(
        'PostgresSandboxLifecycleStore.quarantineSandboxEnvironment',
      )(function* ({
        quarantineId,
        inboxItemId,
        attemptId,
        changeRequestId,
        sandboxId,
        labels,
        reason,
      }) {
        const operation = 'SandboxLifecycleStore.quarantineSandboxEnvironment'
        const labelsJson = JSON.stringify(labels)
        const normalizedReason =
          reason.trim().length > 0 ? reason.trim() : 'Sandbox cleanup failed'
        const summary = `Cleanup quarantined sandbox ${sandboxId} for attempt ${attemptId}: ${normalizedReason}`

        return yield* sql
          .withTransaction(
            Effect.gen(function* () {
              yield* sql`
                INSERT INTO verification_sandboxes (sandbox_id, attempt_id, change_request_id, status, labels)
                VALUES (${sandboxId}, ${attemptId}, ${changeRequestId}, 'quarantined', ${labelsJson}::jsonb)
                ON CONFLICT (sandbox_id) DO UPDATE
                  SET status = 'quarantined',
                      deleted_at = NULL
              `.pipe(persistenceError(operation))

              const quarantineRows = yield* sql`
                INSERT INTO environment_quarantines (id, attempt_id, sandbox_id, reason, status)
                VALUES (${quarantineId}, ${attemptId}, ${sandboxId}, ${normalizedReason}, 'quarantined')
                ON CONFLICT (id) DO UPDATE
                  SET reason = EXCLUDED.reason,
                      status = 'quarantined',
                      released_at = NULL
                RETURNING id, attempt_id, sandbox_id, reason, status
              `.pipe(persistenceError(operation))

              const inboxRows = yield* sql`
                INSERT INTO decision_inbox_items (id, attempt_id, kind, status, summary, sandbox_id)
                VALUES (${inboxItemId}, ${attemptId}, 'cleanup_quarantine', 'open', ${summary}, ${sandboxId})
                ON CONFLICT (id) DO UPDATE
                  SET summary = EXCLUDED.summary,
                      status = 'open',
                      resolved_at = NULL
                RETURNING id, attempt_id, kind, status, summary, sandbox_id
              `.pipe(persistenceError(operation))

              const quarantineRow = quarantineRows[0]
              const inboxRow = inboxRows[0]
              if (quarantineRow === undefined || inboxRow === undefined) {
                return yield* new PersistenceError({
                  operation,
                  message: 'Quarantine transaction did not return rows',
                })
              }

              const quarantine = yield* decodeQuarantineRow(
                quarantineRow,
                operation,
              )
              const inboxItem = yield* decodeInboxItemRow(inboxRow, operation)
              return { quarantine, inboxItem }
            }),
          )
          .pipe(
            Effect.catchTag('SqlError', (sqlError) =>
              Effect.fail(toPersistenceError(operation)(sqlError)),
            ),
          )
      }),

      findSandboxById: Effect.fn(
        'PostgresSandboxLifecycleStore.findSandboxById',
      )(function* (sandboxId) {
        const operation = 'SandboxLifecycleStore.findSandboxById'
        const rows = yield* sql`
          SELECT sandbox_id, attempt_id, change_request_id, status, labels
          FROM verification_sandboxes
          WHERE sandbox_id = ${sandboxId}
        `.pipe(persistenceError(operation))

        const first = rows[0]
        if (first === undefined) {
          return Option.none()
        }
        return Option.some(yield* decodeSandboxRow(first, operation))
      }),

      listActiveSandboxes,
      listQuarantinedEnvironments,
      listOpenInboxItems,

      listArtifactsByAttempt: Effect.fn(
        'PostgresSandboxLifecycleStore.listArtifactsByAttempt',
      )(function* (attemptId) {
        const operation = 'SandboxLifecycleStore.listArtifactsByAttempt'
        const rows = yield* sql`
          SELECT artifact_key, attempt_id, sha256, byte_length, content_type
          FROM verification_artifacts
          WHERE attempt_id = ${attemptId}
          ORDER BY created_at ASC
          LIMIT ${MAX_LIST_ROWS}
        `.pipe(persistenceError(operation))

        return yield* Effect.forEach(rows, (row) =>
          decodeArtifactRow(row, operation),
        )
      }),
    })
  }),
)
