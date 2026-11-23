import { Effect, Layer, Schema } from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'
import { AcceptanceStore } from '@patchplane/core'
import {
  AcceptanceDecision,
  ActiveAttemptConflictError,
  AttemptGeneration,
  AttemptNotFoundError,
  AttemptStatus,
  ChangeRequestId,
  ConflictingDecisionError,
  DecisionKind,
  PersistenceError,
  ProposalVersion,
  StaleAttemptOwnershipError,
  VerificationAttempt,
  VerificationAttemptId,
} from '@patchplane/domain'

const AttemptRow = Schema.Struct({
  id: VerificationAttemptId,
  change_request_id: ChangeRequestId,
  status: AttemptStatus,
  generation: AttemptGeneration,
})

const DecisionRow = Schema.Struct({
  id: Schema.NonEmptyString,
  attempt_id: VerificationAttemptId,
  proposal_version: ProposalVersion,
  kind: DecisionKind,
  actor_id: Schema.NonEmptyString,
})

function extractPgErrorCode(error: SqlError.SqlError): {
  readonly code: string | undefined
  readonly constraint: string | undefined
} {
  const inspect = (
    value: unknown,
  ): { readonly code?: string; readonly constraint?: string } | undefined => {
    if (typeof value !== 'object' || value === null) return undefined
    const code = Reflect.get(value, 'code')
    const constraint = Reflect.get(value, 'constraint')
    if (typeof code === 'string') {
      return {
        code,
        ...(typeof constraint === 'string' ? { constraint } : {}),
      }
    }
    const cause = Reflect.get(value, 'cause')
    if (cause !== undefined) return inspect(cause)
    const reason = Reflect.get(value, 'reason')
    if (reason !== undefined) return inspect(reason)
    return undefined
  }

  const found = inspect(error)
  return {
    code: found?.code,
    constraint: found?.constraint,
  }
}

const mapPersistenceError =
  (operation: string) =>
  (cause: unknown): PersistenceError =>
    new PersistenceError({
      operation,
      message: String(cause),
    })

const decodeAttemptRow = (row: unknown, operation: string) =>
  Schema.decodeUnknownEffect(AttemptRow)(row).pipe(
    Effect.map((decoded): VerificationAttempt => ({
      id: decoded.id,
      changeRequestId: decoded.change_request_id,
      status: decoded.status,
      generation: decoded.generation,
    })),
    Effect.mapError(mapPersistenceError(operation)),
  )

const decodeDecisionRow = (row: unknown, operation: string) =>
  Schema.decodeUnknownEffect(DecisionRow)(row).pipe(
    Effect.map((decoded): AcceptanceDecision => ({
      id: decoded.id,
      attemptId: decoded.attempt_id,
      proposalVersion: decoded.proposal_version,
      kind: decoded.kind,
      actorId: decoded.actor_id,
    })),
    Effect.mapError(mapPersistenceError(operation)),
  )

export const PostgresAcceptanceStoreLayer = Layer.effect(
  AcceptanceStore,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    return AcceptanceStore.of({
      recordDeliveryReceipt: Effect.fn(
        'PostgresAcceptanceStore.recordDeliveryReceipt',
      )(function* ({ deliveryId, changeRequestId }) {
        const rows = yield* sql<{ readonly delivery_id: string }>`
          INSERT INTO delivery_receipts (delivery_id, change_request_id)
          VALUES (${deliveryId}, ${changeRequestId})
          ON CONFLICT (delivery_id) DO NOTHING
          RETURNING delivery_id
        `.pipe(
          Effect.mapError(
            mapPersistenceError('AcceptanceStore.recordDeliveryReceipt'),
          ),
        )
        return {
          deliveryId,
          inserted: rows.length === 1,
        }
      }),

      claimAttempt: Effect.fn('PostgresAcceptanceStore.claimAttempt')(
        function* ({ attemptId, changeRequestId }) {
          const rows = yield* sql`
            INSERT INTO verification_attempts (id, change_request_id, status, generation)
            VALUES (${attemptId}, ${changeRequestId}, 'pending', 1)
            RETURNING id, change_request_id, status, generation
          `.pipe(
            Effect.mapError(
              (error): ActiveAttemptConflictError | PersistenceError => {
                const pg = extractPgErrorCode(error)
                if (pg.code === '23505') {
                  return new ActiveAttemptConflictError({ changeRequestId })
                }
                return mapPersistenceError('AcceptanceStore.claimAttempt')(
                  error,
                )
              },
            ),
          )

          const first = rows[0]
          if (first === undefined) {
            return yield* new PersistenceError({
              operation: 'AcceptanceStore.claimAttempt',
              message: 'INSERT did not return created attempt row',
            })
          }
          return yield* decodeAttemptRow(first, 'AcceptanceStore.claimAttempt')
        },
      ),

      advanceAttemptState: Effect.fn(
        'PostgresAcceptanceStore.advanceAttemptState',
      )(function* ({ attemptId, expectedGeneration, nextStatus }) {
        const rows = yield* sql`
          UPDATE verification_attempts
          SET status = ${nextStatus},
              generation = generation + 1,
              updated_at = now()
          WHERE id = ${attemptId}
            AND generation = ${expectedGeneration}
          RETURNING id, change_request_id, status, generation
        `.pipe(
          Effect.mapError(
            mapPersistenceError('AcceptanceStore.advanceAttemptState'),
          ),
        )

        const first = rows[0]
        if (first === undefined) {
          return yield* new StaleAttemptOwnershipError({
            attemptId,
            expectedGeneration,
          })
        }
        return yield* decodeAttemptRow(
          first,
          'AcceptanceStore.advanceAttemptState',
        )
      }),

      recordDecision: Effect.fn('PostgresAcceptanceStore.recordDecision')(
        function* ({ decisionId, attemptId, proposalVersion, kind, actorId }) {
          return yield* sql
            .withTransaction(
              Effect.gen(function* () {
                const inserted = yield* sql`
                  INSERT INTO acceptance_decisions (id, attempt_id, proposal_version, kind, actor_id)
                  VALUES (${decisionId}, ${attemptId}, ${proposalVersion}, ${kind}, ${actorId})
                  ON CONFLICT (attempt_id, proposal_version) DO NOTHING
                  RETURNING id, attempt_id, proposal_version, kind, actor_id
                `.pipe(
                  Effect.mapError(
                    mapPersistenceError('AcceptanceStore.recordDecision'),
                  ),
                )

                const created = inserted[0]
                if (created !== undefined) {
                  return yield* decodeDecisionRow(
                    created,
                    'AcceptanceStore.recordDecision',
                  )
                }

                const existingRows = yield* sql`
                  SELECT id, attempt_id, proposal_version, kind, actor_id
                  FROM acceptance_decisions
                  WHERE attempt_id = ${attemptId}
                    AND proposal_version = ${proposalVersion}
                `.pipe(
                  Effect.mapError(
                    mapPersistenceError('AcceptanceStore.recordDecision'),
                  ),
                )

                const existingRow = existingRows[0]
                if (existingRow === undefined) {
                  return yield* new PersistenceError({
                    operation: 'AcceptanceStore.recordDecision',
                    message: 'Conflicting decision row disappeared',
                  })
                }
                const existing = yield* decodeDecisionRow(
                  existingRow,
                  'AcceptanceStore.recordDecision',
                )
                if (existing.kind !== kind) {
                  return yield* new ConflictingDecisionError({
                    attemptId,
                    proposalVersion,
                    existingKind: existing.kind,
                    requestedKind: kind,
                  })
                }
                return existing
              }),
            )
            .pipe(
              Effect.catchTag('SqlError', (sqlError) =>
                Effect.fail(
                  mapPersistenceError('AcceptanceStore.recordDecision')(
                    sqlError,
                  ),
                ),
              ),
            )
        },
      ),

      findAttemptById: Effect.fn('PostgresAcceptanceStore.findAttemptById')(
        function* (attemptId) {
          const rows = yield* sql`
            SELECT id, change_request_id, status, generation
            FROM verification_attempts
            WHERE id = ${attemptId}
          `.pipe(
            Effect.mapError(
              mapPersistenceError('AcceptanceStore.findAttemptById'),
            ),
          )
          const first = rows[0]
          if (first === undefined) {
            return yield* new AttemptNotFoundError({ attemptId })
          }
          return yield* decodeAttemptRow(
            first,
            'AcceptanceStore.findAttemptById',
          )
        },
      ),
    })
  }),
)
