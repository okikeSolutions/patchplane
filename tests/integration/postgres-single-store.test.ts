import { describe, expect, it } from '@effect/vitest'
import {
  Duration,
  Effect,
  Exit,
  Layer,
  Option,
  Redacted,
  Ref,
  Schema,
} from 'effect'
import { SqlClient } from 'effect/sql'
import {
  claimAndStartAttempt,
  makeControlPlaneSingleStoreLayer,
  wakeControlPlane,
} from '../../apps/server/src/index'
import {
  AcceptanceStore,
  VerificationAttemptWorkflow,
  VerificationStepRunner,
} from '../../packages/core/src/index'
import {
  AttemptGeneration,
  ChangeRequestId,
  DeliveryId,
  ProposalVersion,
  VerificationAttemptId,
} from '../../packages/domain/src/index'
import {
  applySqlMigrations,
  loadSqlMigrations,
  makePostgresSqlLayer,
} from '../../packages/plugins/src/index'

const TEST_DATABASE_URL =
  process.env.PATCHPLANE_TEST_DATABASE_URL ??
  'postgresql://patchplane:patchplane@127.0.0.1:55432/patchplane_test'

const redactedUrl = Redacted.make(TEST_DATABASE_URL)

const resetDatabase = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql.unsafe('DROP SCHEMA IF EXISTS public CASCADE')
  yield* sql.unsafe('CREATE SCHEMA public')
})

describe('V2 Stack Proof 2: single-store PostgreSQL + ClusterWorkflowEngine', () => {
  it.live(
    'applies committed SQL migrations idempotently and fails closed on invalid or rewritten migrations',
    () =>
      Effect.gen(function* () {
        yield* resetDatabase
        const committed = yield* loadSqlMigrations()
        expect(committed.length).toBeGreaterThanOrEqual(1)

        const firstRun = yield* applySqlMigrations(committed)
        expect(firstRun).toEqual(committed.map((entry) => entry.name))

        const secondRun = yield* applySqlMigrations(committed)
        expect(secondRun).toEqual([])

        const invalidFailure = yield* Effect.flip(
          applySqlMigrations([
            ...committed,
            {
              name: '9999_invalid_sql.sql',
              sql: 'CREATE TABLE broken_table (id TEXT PRIMARY KEY); INVALID SQL HERE;',
              sha256: 'deadbeef',
            },
          ]),
        )
        expect(invalidFailure._tag).toBe('MigrationFailureError')
        expect(invalidFailure.migrationName).toBe('9999_invalid_sql.sql')

        const sql = yield* SqlClient.SqlClient
        const brokenTables = yield* sql<{ readonly exists: string | null }>`
          SELECT to_regclass('public.broken_table')::text AS exists
        `
        expect(brokenTables[0]?.exists).toBeNull()

        const rewrittenFailure = yield* Effect.flip(
          applySqlMigrations([
            {
              ...committed[0]!,
              sha256: 'tampered-checksum',
            },
          ]),
        )
        expect(rewrittenFailure._tag).toBe('MigrationFailureError')
        expect(rewrittenFailure.reason).toContain('checksum mismatch')
      }).pipe(Effect.provide(makePostgresSqlLayer({ url: redactedUrl }))),
    20_000,
  )

  it.live(
    'enforces competing claims, duplicate deliveries, stale ownership fencing, and conflicting decisions on real Postgres',
    () =>
      Effect.gen(function* () {
        yield* resetDatabase
        const committed = yield* loadSqlMigrations()
        yield* applySqlMigrations(committed)

        const store = yield* AcceptanceStore
        const changeRequestId = yield* Schema.decodeEffect(ChangeRequestId)(
          'github:okikeSolutions/patchplane#101',
        )

        // 1. Duplicate deliveries (5 concurrent deliveries with the same ID)
        const deliveryId = yield* Schema.decodeEffect(DeliveryId)('delivery-42')
        const deliveryResults = yield* Effect.all(
          Array.from({ length: 5 }, () =>
            store.recordDeliveryReceipt({ deliveryId, changeRequestId }),
          ),
          { concurrency: 'unbounded' },
        )
        expect(
          deliveryResults.filter((result) => result.inserted),
        ).toHaveLength(1)
        expect(
          deliveryResults.filter((result) => !result.inserted),
        ).toHaveLength(4)

        // 2. Competing active attempt claims (8 concurrent claims for same PR)
        const claimIds = yield* Effect.forEach(
          Array.from({ length: 8 }, (_, index) => `attempt-race-${index}`),
          (raw) => Schema.decodeEffect(VerificationAttemptId)(raw),
        )
        const claimExits = yield* Effect.forEach(
          claimIds,
          (attemptId) =>
            Effect.exit(store.claimAttempt({ attemptId, changeRequestId })),
          { concurrency: 'unbounded' },
        )
        const winners = claimExits.filter(Exit.isSuccess)
        const conflicts = claimExits.filter(Exit.isFailure)
        expect(winners).toHaveLength(1)
        expect(conflicts).toHaveLength(7)

        const winner = winners[0]!.value

        // 3. Stale ownership fencing (5 concurrent transitions at generation 1)
        const gen1 = yield* Schema.decodeEffect(AttemptGeneration)(1)
        const advanceExits = yield* Effect.all(
          Array.from({ length: 5 }, () =>
            Effect.exit(
              store.advanceAttemptState({
                attemptId: winner.id,
                expectedGeneration: gen1,
                nextStatus: 'running',
              }),
            ),
          ),
          { concurrency: 'unbounded' },
        )
        const advancedWinners = advanceExits.filter(Exit.isSuccess)
        const staleRejections = advanceExits.filter(Exit.isFailure)
        expect(advancedWinners).toHaveLength(1)
        expect(advancedWinners[0]!.value.generation).toBe(2)
        expect(staleRejections).toHaveLength(4)

        // 4. Conflicting decisions on same (attemptId, proposalVersion)
        const proposalV1 = yield* Schema.decodeEffect(ProposalVersion)(1)
        const decisionExits = yield* Effect.all(
          [
            Effect.exit(
              store.recordDecision({
                decisionId: 'decision-approve',
                attemptId: winner.id,
                proposalVersion: proposalV1,
                kind: 'approve',
                actorId: 'workos:user-1',
              }),
            ),
            Effect.exit(
              store.recordDecision({
                decisionId: 'decision-reject',
                attemptId: winner.id,
                proposalVersion: proposalV1,
                kind: 'reject',
                actorId: 'workos:user-2',
              }),
            ),
          ],
          { concurrency: 'unbounded' },
        )
        const decisionWins = decisionExits.filter(Exit.isSuccess)
        const decisionConflicts = decisionExits.filter(Exit.isFailure)
        expect(decisionWins).toHaveLength(1)
        expect(decisionConflicts).toHaveLength(1)

        // Replaying the winning decision is idempotent
        const winningDecision = decisionWins[0]!.value
        const replayed = yield* store.recordDecision({
          decisionId: 'decision-replay',
          attemptId: winner.id,
          proposalVersion: proposalV1,
          kind: winningDecision.kind,
          actorId: winningDecision.actorId,
        })
        expect(replayed.id).toBe(winningDecision.id)
      }).pipe(
        Effect.provide(
          makeControlPlaneSingleStoreLayer({
            url: redactedUrl,
            entityMailboxPollIntervalMs: 100,
          }),
        ),
      ),
    20_000,
  )

  it.live(
    'persists domain state and ClusterWorkflowEngine journal in one Postgres DB and resumes after container sleep/restart without duplicating side effects',
    () =>
      Effect.gen(function* () {
        yield* resetDatabase.pipe(
          Effect.provide(makePostgresSqlLayer({ url: redactedUrl })),
        )
        const committed = yield* loadSqlMigrations()
        yield* applySqlMigrations(committed).pipe(
          Effect.provide(makePostgresSqlLayer({ url: redactedUrl })),
        )

        const prepareCallsRef = yield* Ref.make(0)
        const countingRunnerLayer = Layer.succeed(
          VerificationStepRunner,
          VerificationStepRunner.of({
            runPrepare: Effect.fn('TestRunner.runPrepare')(function* ({
              attemptId,
            }) {
              const count = yield* Ref.updateAndGet(
                prepareCallsRef,
                (current) => current + 1,
              )
              return `prepare-run-${count}-${attemptId}`
            }),
          }),
        )

        const changeRequestId = yield* Schema.decodeEffect(ChangeRequestId)(
          'github:okikeSolutions/patchplane#202',
        )
        const attemptId = yield* Schema.decodeEffect(VerificationAttemptId)(
          'attempt-restart-proof',
        )

        const makeContainerLayer = () =>
          makeControlPlaneSingleStoreLayer(
            {
              url: redactedUrl,
              entityMailboxPollIntervalMs: 100,
            },
            countingRunnerLayer,
          )

        // Container Boot #1 (scoped): claim attempt, execute workflow with durable sleep,
        // verify prepare-attempt + SQL journal rows, then close scope to simulate container sleep/restart
        const executionId = yield* Effect.scoped(
          Effect.gen(function* () {
            const started = yield* claimAndStartAttempt({
              attemptId,
              changeRequestId,
              waitDurationMs: 1_200,
            })

            const store = yield* AcceptanceStore
            for (let tick = 0; tick < 50; tick += 1) {
              const current = yield* store.findAttemptById(attemptId)
              if (current.status === 'running') break
              yield* Effect.sleep(Duration.millis(100))
            }

            expect(yield* Ref.get(prepareCallsRef)).toBe(1)

            const sql = yield* SqlClient.SqlClient
            const messages = yield* sql<{ readonly count: string }>`
              SELECT COUNT(*)::text AS count FROM cluster_messages
            `
            const replies = yield* sql<{ readonly count: string }>`
              SELECT COUNT(*)::text AS count FROM cluster_replies
            `
            expect(Number(messages[0]?.count ?? '0')).toBeGreaterThan(0)
            expect(Number(replies[0]?.count ?? '0')).toBeGreaterThan(0)

            return started.executionId
          }).pipe(Effect.provide(makeContainerLayer())),
        )

        // Wait past the durable clock deadline while NO container is running
        yield* Effect.sleep(Duration.millis(1_500))

        // Container Boot #2 (simulated stateless Cron Wakeup booting fresh container against same Postgres DB)
        yield* Effect.scoped(
          Effect.gen(function* () {
            const woke = yield* wakeControlPlane()
            expect(woke.ok).toBe(true)

            let finalStatus: string = 'running'
            for (let tick = 0; tick < 60; tick += 1) {
              const polled =
                yield* VerificationAttemptWorkflow.poll(executionId)
              if (
                Option.isSome(polled) &&
                polled.value._tag === 'Complete' &&
                polled.value.exit._tag === 'Success'
              ) {
                finalStatus = polled.value.exit.value.attempt.status
                break
              }
              yield* Effect.sleep(Duration.millis(150))
            }

            expect(finalStatus).toBe('passed')

            const store = yield* AcceptanceStore
            const finalAttempt = yield* store.findAttemptById(attemptId)
            expect(finalAttempt.status).toBe('passed')
            expect(finalAttempt.generation).toBe(3)
            expect(yield* Ref.get(prepareCallsRef)).toBe(1)
          }).pipe(Effect.provide(makeContainerLayer())),
        )
      }),
    30_000,
  )
})
