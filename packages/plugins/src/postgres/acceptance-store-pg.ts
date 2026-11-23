import { Effect, Layer, Schema } from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'
import { AcceptanceStore } from '@patchplane/core'
import {
  AcceptanceDecision,
  ActiveAttemptConflictError,
  ActorId,
  AttemptGeneration,
  AttemptNotFoundError,
  AttemptStatus,
  AttemptTransitionKey,
  canTransitionAttempt,
  ChangeRequestId,
  ConflictingDecisionError,
  DecisionId,
  DecisionKind,
  DeliveryId,
  InvalidAttemptTransitionError,
  PersistenceError,
  ProposalVersion,
  StaleAttemptOwnershipError,
  VerificationAttempt,
  VerificationAttemptId,
} from '@patchplane/domain'

const ACTIVE_ATTEMPT_UNIQUE_INDEX =
  'idx_verification_attempts_one_active_per_cr'

const DeliveryReceiptRow = Schema.Struct({
  delivery_id: DeliveryId,
})

const AttemptRow = Schema.Struct({
  id: VerificationAttemptId,
  change_request_id: ChangeRequestId,
  status: AttemptStatus,
  generation: AttemptGeneration,
})

const LockedAttemptRow = Schema.Struct({
  ...AttemptRow.fields,
  last_transition_key: Schema.NullOr(AttemptTransitionKey),
})

const toAttempt = (decoded: typeof AttemptRow.Type): VerificationAttempt => ({
  id: decoded.id,
  changeRequestId: decoded.change_request_id,
  status: decoded.status,
  generation: decoded.generation,
})

const DecisionRow = Schema.Struct({
  id: DecisionId,
  attempt_id: VerificationAttemptId,
  proposal_version: ProposalVersion,
  kind: DecisionKind,
  actor_id: ActorId,
})

function extractPgErrorCode(error: SqlError.SqlError): {
  readonly code: string | undefined
  readonly constraint: string | undefined
} {
  const visited = new Set<unknown>()

  const inspect = (
    value: unknown,
  ): { readonly code?: string; readonly constraint?: string } | undefined => {
    if (typeof value !== 'object' || value === null || visited.has(value)) {
      return undefined
    }
    visited.add(value)
    const code = Reflect.get(value, 'code')
    const constraint = Reflect.get(value, 'constraint')
    if (typeof code === 'string') {
      return {
        code,
        ...(typeof constraint === 'string' ? { constraint } : {}),
      }
    }
    const cause = Reflect.get(value, 'cause')
    if (cause !== undefined) {
      const fromCause = inspect(cause)
      if (fromCause !== undefined) return fromCause
    }
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

const toPersistenceError =
  (operation: string) =>
  (cause: unknown): PersistenceError =>
    new PersistenceError({
      operation,
      message: String(cause),
      cause,
    })

const persistenceError = (operation: string) =>
  Effect.mapError(toPersistenceError(operation))

const decodeAttemptRow = (row: unknown, operation: string) =>
  Schema.decodeUnknownEffect(AttemptRow)(row).pipe(
    Effect.map((decoded): VerificationAttempt => ({
      id: decoded.id,
      changeRequestId: decoded.change_request_id,
      status: decoded.status,
      generation: decoded.generation,
    })),
    persistenceError(operation),
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
    persistenceError(operation),
  )

export const PostgresAcceptanceStoreLayer = Layer.effect(
  AcceptanceStore,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    return AcceptanceStore.of({
      recordDeliveryReceipt: Effect.fn(
        'PostgresAcceptanceStore.recordDeliveryReceipt',
      )(function* ({ deliveryId, changeRequestId }) {
        const rows = yield* sql`
          INSERT INTO delivery_receipts (delivery_id, change_request_id)
          VALUES (${deliveryId}, ${changeRequestId})
          ON CONFLICT (delivery_id) DO NOTHING
          RETURNING delivery_id
        `.pipe(persistenceError('AcceptanceStore.recordDeliveryReceipt'))

        const insertedRow = rows[0]
        if (insertedRow === undefined) {
          return {
            deliveryId,
            inserted: false,
          }
        }
        const decoded = yield* Schema.decodeUnknownEffect(DeliveryReceiptRow)(
          insertedRow,
        ).pipe(persistenceError('AcceptanceStore.recordDeliveryReceipt'))
        return {
          deliveryId: decoded.delivery_id,
          inserted: true,
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
                if (
                  pg.code === '23505' &&
                  pg.constraint === ACTIVE_ATTEMPT_UNIQUE_INDEX
                ) {
                  return new ActiveAttemptConflictError({ changeRequestId })
                }
                return toPersistenceError('AcceptanceStore.claimAttempt')(error)
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
      )(function* ({
        attemptId,
        expectedGeneration,
        nextStatus,
        transitionKey,
      }) {
        const operation = 'AcceptanceStore.advanceAttemptState'
        return yield* sql
          .withTransaction(
            Effect.gen(function* () {
              // Row lock serializes competing transitions so the fencing,
              // state-machine and idempotent-replay checks below see one truth.
              const lockedRows = yield* sql`
                SELECT id, change_request_id, status, generation, last_transition_key
                FROM verification_attempts
                WHERE id = ${attemptId}
                FOR UPDATE
              `.pipe(persistenceError(operation))

              const lockedRow = lockedRows[0]
              if (lockedRow === undefined) {
                return yield* new AttemptNotFoundError({ attemptId })
              }
              const locked = yield* Schema.decodeUnknownEffect(
                LockedAttemptRow,
              )(lockedRow).pipe(persistenceError(operation))
              const current = toAttempt(locked)

              const isReplayOfAppliedTransition =
                transitionKey !== undefined &&
                locked.last_transition_key === transitionKey &&
                current.status === nextStatus &&
                current.generation === expectedGeneration + 1
              if (isReplayOfAppliedTransition) {
                return current
              }

              if (current.generation !== expectedGeneration) {
                return yield* new StaleAttemptOwnershipError({
                  attemptId,
                  expectedGeneration,
                })
              }

              if (!canTransitionAttempt(current.status, nextStatus)) {
                return yield* new InvalidAttemptTransitionError({
                  attemptId,
                  from: current.status,
                  to: nextStatus,
                })
              }

              const rows = yield* sql`
                UPDATE verification_attempts
                SET status = ${nextStatus},
                    generation = generation + 1,
                    last_transition_key = ${transitionKey ?? null},
                    updated_at = now()
                WHERE id = ${attemptId}
                  AND generation = ${expectedGeneration}
                RETURNING id, change_request_id, status, generation
              `.pipe(persistenceError(operation))

              const first = rows[0]
              if (first === undefined) {
                return yield* new StaleAttemptOwnershipError({
                  attemptId,
                  expectedGeneration,
                })
              }
              return yield* decodeAttemptRow(first, operation)
            }),
          )
          .pipe(
            Effect.catchTag('SqlError', (sqlError) =>
              Effect.fail(toPersistenceError(operation)(sqlError)),
            ),
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
                `.pipe(persistenceError('AcceptanceStore.recordDecision'))

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
                `.pipe(persistenceError('AcceptanceStore.recordDecision'))

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
                  toPersistenceError('AcceptanceStore.recordDecision')(
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
          `.pipe(persistenceError('AcceptanceStore.findAttemptById'))
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
