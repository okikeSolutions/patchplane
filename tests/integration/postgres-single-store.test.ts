import { describe, expect, it } from '@effect/vitest'
import {
  Cause,
  Deferred,
  Duration,
  Effect,
  Exit,
  Fiber,
  Layer,
  Option,
  Ref,
  Schedule,
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
  ActorId,
  AttemptGeneration,
  AttemptTransitionKey,
  ChangeRequestId,
  DecisionId,
  DeliveryId,
  PrepareDigest,
  ProposalVersion,
  StepRunnerError,
  VerificationAttemptId,
} from '../../packages/domain/src/index'
import {
  applySqlMigrations,
  loadSqlMigrations,
} from '../../packages/plugins/src/index'
import {
  resetAndMigrateDatabase,
  resetDatabase,
  TestDatabaseUrl,
  TestMigrationDepsLayer,
  TestPostgresSqlLayer,
} from './test-db'

const makeTestControlPlaneLayer = (
  runnerLayer?: Layer.Layer<VerificationStepRunner>,
) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const url = yield* TestDatabaseUrl
      return makeControlPlaneSingleStoreLayer(
        {
          url,
          entityMailboxPollIntervalMs: 100,
        },
        runnerLayer,
      )
    }),
  ).pipe(Layer.provideMerge(TestMigrationDepsLayer))

function extractFailureTag<A, E extends { readonly _tag: string }>(
  exit: Exit.Exit<A, E>,
): string | undefined {
  if (!Exit.isFailure(exit)) return undefined
  const error = Cause.findErrorOption(exit.cause)
  return Option.isSome(error) ? error.value._tag : undefined
}

describe('V2 Stack Proof 2: single-store PostgreSQL + ClusterWorkflowEngine', () => {
  it.live(
    'applies committed and complex-syntax SQL migrations idempotently and fails closed on invalid or rewritten migrations',
    () =>
      Effect.gen(function* () {
        yield* resetDatabase
        const committed = yield* loadSqlMigrations()
        const firstMigration = committed[0]
        expect(firstMigration).toBeDefined()
        if (firstMigration === undefined) return

        const firstRun = yield* applySqlMigrations(committed)
        expect(firstRun).toEqual(committed.map((entry) => entry.name))

        const secondRun = yield* applySqlMigrations(committed)
        expect(secondRun).toEqual([])

        // Complex SQL with comments, escaped quotes, and dollar-quoted blocks
        // must execute cleanly as real PostgreSQL statements.
        const complexApplied = yield* applySqlMigrations([
          ...committed,
          {
            name: '9000_complex_syntax_proof.sql',
            sql: `
              -- leading comment; with semicolon
              CREATE TABLE complex_mig_proof (
                id TEXT PRIMARY KEY,
                label TEXT NOT NULL DEFAULT 'semi;colon''quoted'
              );
              /* nested /* block; comment */ still comment; */
              DO $mig$
              BEGIN
                INSERT INTO complex_mig_proof (id) VALUES ('ok');
              END
              $mig$;
            `,
            sha256: 'complex-syntax-sha256',
          },
        ])
        expect(complexApplied).toEqual(['9000_complex_syntax_proof.sql'])

        const sql = yield* SqlClient.SqlClient
        const complexRows = yield* sql<{
          readonly id: string
          readonly label: string
        }>`SELECT id, label FROM complex_mig_proof`
        expect(complexRows).toEqual([{ id: 'ok', label: "semi;colon'quoted" }])

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

        const brokenTables = yield* sql<{ readonly exists: string | null }>`
          SELECT to_regclass('public.broken_table')::text AS exists
        `
        expect(brokenTables[0]?.exists).toBeNull()

        const rewrittenFailure = yield* Effect.flip(
          applySqlMigrations([
            {
              ...firstMigration,
              sha256: 'tampered-checksum',
            },
          ]),
        )
        expect(rewrittenFailure._tag).toBe('MigrationFailureError')
        expect(rewrittenFailure.migrationName).toBe(firstMigration.name)
        const storedChecksums = yield* sql<{ readonly sha256: string }>`
          SELECT sha256 FROM patchplane_migrations WHERE name = ${firstMigration.name}
        `
        expect(storedChecksums[0]?.sha256).toBe(firstMigration.sha256)
      }).pipe(Effect.provide(TestPostgresSqlLayer)),
    20_000,
  )

  it.live(
    'enforces competing claims, duplicate deliveries, stale ownership fencing, conflicting decisions, and interrupted transactions on real Postgres',
    () =>
      Effect.gen(function* () {
        yield* resetAndMigrateDatabase

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
        for (const conflict of conflicts) {
          expect(extractFailureTag(conflict)).toBe('ActiveAttemptConflictError')
        }

        const firstWinner = winners[0]
        if (firstWinner === undefined) return
        const winner = firstWinner.value

        // Duplicate primary key on a DIFFERENT CR must fail with PersistenceError, not ActiveAttemptConflictError
        const otherCrId = yield* Schema.decodeEffect(ChangeRequestId)(
          'github:okikeSolutions/patchplane#999',
        )
        const duplicatePkFailure = yield* Effect.flip(
          store.claimAttempt({
            attemptId: winner.id,
            changeRequestId: otherCrId,
          }),
        )
        expect(duplicatePkFailure._tag).toBe('PersistenceError')

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
        expect(advancedWinners[0]?.value.generation).toBe(2)
        expect(staleRejections).toHaveLength(4)
        for (const stale of staleRejections) {
          expect(extractFailureTag(stale)).toBe('StaleAttemptOwnershipError')
        }

        // 4. Conflicting decisions on same (attemptId, proposalVersion)
        const proposalV1 = yield* Schema.decodeEffect(ProposalVersion)(1)
        const approveId =
          yield* Schema.decodeEffect(DecisionId)('decision-approve')
        const rejectId =
          yield* Schema.decodeEffect(DecisionId)('decision-reject')
        const replayId =
          yield* Schema.decodeEffect(DecisionId)('decision-replay')
        const actor1 = yield* Schema.decodeEffect(ActorId)('workos:user-1')
        const actor2 = yield* Schema.decodeEffect(ActorId)('workos:user-2')

        const decisionExits = yield* Effect.all(
          [
            Effect.exit(
              store.recordDecision({
                decisionId: approveId,
                attemptId: winner.id,
                proposalVersion: proposalV1,
                kind: 'approve',
                actorId: actor1,
              }),
            ),
            Effect.exit(
              store.recordDecision({
                decisionId: rejectId,
                attemptId: winner.id,
                proposalVersion: proposalV1,
                kind: 'reject',
                actorId: actor2,
              }),
            ),
          ],
          { concurrency: 'unbounded' },
        )
        const decisionWins = decisionExits.filter(Exit.isSuccess)
        const decisionConflicts = decisionExits.filter(Exit.isFailure)
        expect(decisionWins).toHaveLength(1)
        expect(decisionConflicts).toHaveLength(1)
        const firstConflict = decisionConflicts[0]
        expect(firstConflict).toBeDefined()
        if (firstConflict !== undefined) {
          expect(extractFailureTag(firstConflict)).toBe(
            'ConflictingDecisionError',
          )
        }

        const winningDecisionExit = decisionWins[0]
        if (winningDecisionExit === undefined) return
        const winningDecision = winningDecisionExit.value

        // Replaying the winning decision by the same actor is idempotent
        const replayed = yield* store.recordDecision({
          decisionId: replayId,
          attemptId: winner.id,
          proposalVersion: proposalV1,
          kind: winningDecision.kind,
          actorId: winningDecision.actorId,
        })
        expect(replayed.id).toBe(winningDecision.id)

        // A different actor submitting even the same kind must fail as a conflict
        const otherActor = winningDecision.actorId === actor1 ? actor2 : actor1
        const replayByOtherActorId = yield* Schema.decodeEffect(DecisionId)(
          'decision-replay-other-actor',
        )
        const actorConflict = yield* Effect.flip(
          store.recordDecision({
            decisionId: replayByOtherActorId,
            attemptId: winner.id,
            proposalVersion: proposalV1,
            kind: winningDecision.kind,
            actorId: otherActor,
          }),
        )
        expect(actorConflict._tag).toBe('ConflictingDecisionError')
        if (actorConflict._tag === 'ConflictingDecisionError') {
          expect(actorConflict.existingActorId).toBe(winningDecision.actorId)
          expect(actorConflict.requestedActorId).toBe(otherActor)
        }

        // 5. State machine + idempotent transition replay (separate CR so the
        //    active-attempt index above does not interfere)
        const transitionCr = yield* Schema.decodeEffect(ChangeRequestId)(
          'github:okikeSolutions/patchplane#303',
        )
        const transitionAttemptId = yield* Schema.decodeEffect(
          VerificationAttemptId,
        )('attempt-transitions')
        const runningKey = yield* Schema.decodeEffect(AttemptTransitionKey)(
          'attempt-transitions/mark-attempt-running',
        )
        const otherKey = yield* Schema.decodeEffect(AttemptTransitionKey)(
          'attempt-transitions/someone-else',
        )
        const passedKey = yield* Schema.decodeEffect(AttemptTransitionKey)(
          'attempt-transitions/finalize-attempt',
        )
        const gen2 = yield* Schema.decodeEffect(AttemptGeneration)(2)
        const gen3 = yield* Schema.decodeEffect(AttemptGeneration)(3)

        yield* store.claimAttempt({
          attemptId: transitionAttemptId,
          changeRequestId: transitionCr,
        })

        // pending -> passed skips running: rejected by the state machine
        const skipped = yield* Effect.flip(
          store.advanceAttemptState({
            attemptId: transitionAttemptId,
            expectedGeneration: gen1,
            nextStatus: 'passed',
          }),
        )
        expect(skipped._tag).toBe('InvalidAttemptTransitionError')

        const applied = yield* store.advanceAttemptState({
          attemptId: transitionAttemptId,
          expectedGeneration: gen1,
          nextStatus: 'running',
          transitionKey: runningKey,
        })
        expect(applied.generation).toBe(2)

        // Crash-after-commit replay with the same key is idempotent...
        const replayedTransition = yield* store.advanceAttemptState({
          attemptId: transitionAttemptId,
          expectedGeneration: gen1,
          nextStatus: 'running',
          transitionKey: runningKey,
        })
        expect(replayedTransition).toEqual(applied)

        // ...but a different key (or none) is still fenced out
        const foreignReplay = yield* Effect.flip(
          store.advanceAttemptState({
            attemptId: transitionAttemptId,
            expectedGeneration: gen1,
            nextStatus: 'running',
            transitionKey: otherKey,
          }),
        )
        expect(foreignReplay._tag).toBe('StaleAttemptOwnershipError')

        yield* store.advanceAttemptState({
          attemptId: transitionAttemptId,
          expectedGeneration: gen2,
          nextStatus: 'passed',
          transitionKey: passedKey,
        })

        // Terminal attempts never re-open
        const reopened = yield* Effect.flip(
          store.advanceAttemptState({
            attemptId: transitionAttemptId,
            expectedGeneration: gen3,
            nextStatus: 'running',
          }),
        )
        expect(reopened._tag).toBe('InvalidAttemptTransitionError')

        const missingAttemptId = yield* Schema.decodeEffect(
          VerificationAttemptId,
        )('attempt-does-not-exist')
        const missing = yield* Effect.flip(
          store.advanceAttemptState({
            attemptId: missingAttemptId,
            expectedGeneration: gen1,
            nextStatus: 'running',
          }),
        )
        expect(missing._tag).toBe('AttemptNotFoundError')

        // 6. Interrupted transaction rolls back completely without partial writes
        const sql = yield* SqlClient.SqlClient
        const insertedInTx = yield* Deferred.make<void>()
        const interruptedDelivery = yield* Schema.decodeEffect(DeliveryId)(
          'delivery-interrupted-tx',
        )
        const txFiber = yield* sql
          .withTransaction(
            Effect.gen(function* () {
              yield* store.recordDeliveryReceipt({
                deliveryId: interruptedDelivery,
                changeRequestId,
              })
              yield* Deferred.succeed(insertedInTx, undefined)
              return yield* Effect.never
            }),
          )
          .pipe(Effect.forkScoped)

        yield* Deferred.await(insertedInTx)
        yield* Fiber.interrupt(txFiber)

        const afterInterrupt = yield* store.recordDeliveryReceipt({
          deliveryId: interruptedDelivery,
          changeRequestId,
        })
        expect(afterInterrupt.inserted).toBe(true)
      }).pipe(Effect.provide(makeTestControlPlaneLayer())),
    20_000,
  )

  it.live(
    'persists domain state and ClusterWorkflowEngine journal in one Postgres DB and resumes after container sleep/restart without duplicating side effects',
    () =>
      Effect.gen(function* () {
        yield* resetAndMigrateDatabase.pipe(
          Effect.provide(TestPostgresSqlLayer),
        )

        const prepareCallsRef = yield* Ref.make(0)
        const prepareCompleted = yield* Deferred.make<void>()
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
              const digest = yield* Schema.decodeEffect(PrepareDigest)(
                `prepare-run-${count}-${attemptId}`,
              ).pipe(
                Effect.mapError(
                  (cause) =>
                    new StepRunnerError({
                      operation: 'TestRunner.runPrepare',
                      message: String(cause),
                      cause,
                    }),
                ),
              )
              yield* Deferred.succeed(prepareCompleted, undefined)
              return digest
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
          makeTestControlPlaneLayer(countingRunnerLayer)

        // Container Boot #1 (scoped): claim attempt, execute workflow with durable sleep,
        // await deterministic prepare signal + SQL journal rows, then close scope to simulate container sleep/restart
        const executionId = yield* Effect.scoped(
          Effect.gen(function* () {
            const started = yield* claimAndStartAttempt({
              attemptId,
              changeRequestId,
              waitDurationMs: 350,
            })

            yield* Deferred.await(prepareCompleted).pipe(
              Effect.timeout(Duration.seconds(10)),
            )

            // Wait for prepare-attempt activity reply to flush into cluster_replies
            const sql = yield* SqlClient.SqlClient
            yield* Effect.gen(function* () {
              const messages = yield* sql<{ readonly count: string }>`
                SELECT COUNT(*)::text AS count FROM cluster_messages
              `
              const replies = yield* sql<{ readonly count: string }>`
                SELECT COUNT(*)::text AS count FROM cluster_replies
              `
              return (
                Number(messages[0]?.count ?? '0') > 0 &&
                Number(replies[0]?.count ?? '0') > 0
              )
            }).pipe(
              Effect.repeat({
                schedule: Schedule.spaced(Duration.millis(50)),
                until: (ready) => ready,
              }),
              Effect.timeout(Duration.seconds(5)),
            )

            expect(yield* Ref.get(prepareCallsRef)).toBe(1)

            const store = yield* AcceptanceStore
            const runningAttempt = yield* store.findAttemptById(attemptId)
            expect(runningAttempt.status).toBe('running')
            expect(runningAttempt.generation).toBe(2)

            return started.executionId
          }).pipe(Effect.provide(makeContainerLayer())),
        )

        // Wait past the durable clock deadline while NO container is running
        yield* Effect.sleep(Duration.millis(450))

        // Container Boot #2 (simulated stateless Cron Wakeup booting fresh container against same Postgres DB)
        yield* Effect.scoped(
          Effect.gen(function* () {
            const woke = yield* wakeControlPlane()
            expect(woke.ok).toBe(true)

            const completed = yield* VerificationAttemptWorkflow.poll(
              executionId,
            ).pipe(
              Effect.repeat({
                schedule: Schedule.spaced(Duration.millis(150)),
                until: (polled) =>
                  Option.isSome(polled) && polled.value._tag === 'Complete',
              }),
              Effect.timeout(Duration.seconds(10)),
            )

            expect(Option.isSome(completed)).toBe(true)
            if (
              Option.isSome(completed) &&
              completed.value._tag === 'Complete'
            ) {
              expect(completed.value.exit._tag).toBe('Success')
              if (completed.value.exit._tag === 'Success') {
                expect(completed.value.exit.value.attempt.status).toBe('passed')
              }
            }

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
