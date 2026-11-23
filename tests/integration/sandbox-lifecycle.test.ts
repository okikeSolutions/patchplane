import { describe, expect, it } from '@effect/vitest'
import { Clock, Duration, Effect, Fiber, Layer, Option, Schema } from 'effect'
import * as Digest from 'effect/crypto/Digest'
import * as Redacted from 'effect/Redacted'
import { SqlClient } from 'effect/sql'
import { TestClock } from 'effect/testing'
import { makeControlPlaneSingleStoreLayer } from '../../apps/server/src/index'
import {
  buildAttemptSandboxLabels,
  confirmSandboxDeletion,
  DEFAULT_CLEANUP_TIMEOUT_MS,
  ModelCredentialIssuer,
  PATCHPLANE_ATTEMPT_ID_LABEL,
  PATCHPLANE_CHANGE_REQUEST_ID_LABEL,
  PATCHPLANE_MANAGED_LABEL,
  reconcileLeakedSandboxes,
  runIsolatedCheckInSandbox,
  SandboxLifecycleStore,
  SandboxVerificationWorkflow,
  SandboxVerificationWorkflowLayer,
  SANDBOX_ATTEMPT_ID_ENV,
  SANDBOX_MODEL_GATEWAY_URL_ENV,
  SANDBOX_MODEL_TOKEN_ENV,
} from '../../packages/core/src/index'
import {
  ArtifactKey,
  ArtifactRecord,
  ChangeRequestId,
  PersistenceError,
  SandboxId,
  Sha256Hex,
  VerificationAttemptId,
} from '../../packages/domain/src/index'
import {
  type DaytonaCreateSandboxPort,
  makeDaytonaSandboxProviderLayer,
  makeR2ArtifactStoreLayer,
  PostgresSandboxLifecycleStoreLayer,
  type R2ArtifactBucketPort,
} from '../../packages/plugins/src/index'
import {
  resetAndMigrateDatabase,
  TestDatabaseUrl,
  TestPostgresSqlLayer,
} from './test-db'

const makeTestLifecycleDbLayer = () =>
  PostgresSandboxLifecycleStoreLayer.pipe(
    Layer.provideMerge(TestPostgresSqlLayer),
  )

const resetAndMigrate = resetAndMigrateDatabase

interface FakeSandboxEntry {
  readonly id: string
  readonly state: string
  readonly labels: Record<string, string>
  readonly env: Record<string, string | undefined>
  readonly isPublic: boolean
}

function makeFakeDaytona(options?: {
  readonly failDelete?: boolean
  readonly hangReadbackAfterDelete?: boolean
  readonly execOutput?: string
}) {
  let seq = 0
  const sandboxes = new Map<string, FakeSandboxEntry>()
  const createdRequests: Array<{
    readonly labels: Record<string, string>
    readonly env: Record<string, string | undefined>
    readonly public: boolean | undefined
  }> = []
  const deleteCalls: Array<string> = []

  const port: DaytonaCreateSandboxPort<string, string, string, string, string> =
    {
      create: (input) =>
        Effect.sync(() => {
          seq += 1
          const id = `sbx-test-${seq}`
          const labels = { ...input?.labels }
          const env = { ...input?.env }
          createdRequests.push({
            labels,
            env,
            public: input?.public,
          })
          sandboxes.set(id, {
            id,
            state: 'started',
            labels,
            env,
            isPublic: input?.public ?? false,
          })
          return {
            sandboxId: id,
            state: 'started',
            labels,
            exec: (command) =>
              Effect.succeed({
                exitCode: 0,
                result: options?.execOutput ?? `ran:${command}`,
              }),
          }
        }),

      get: (idOrName) =>
        Effect.sync(() => {
          const found = sandboxes.get(idOrName)
          // Mirror @alchemy.run/daytona CreateSandboxHttp.ts:69 where
          // `state === "destroying" || state === "destroyed"` returns undefined.
          if (
            found === undefined ||
            found.state === 'destroyed' ||
            found.state === 'destroying'
          ) {
            return undefined
          }
          return {
            sandboxId: found.id,
            state: found.state,
            labels: found.labels,
            exec: (command) =>
              Effect.succeed({
                exitCode: 0,
                result: options?.execOutput ?? `ran:${command}`,
              }),
          }
        }),

      list: (input) =>
        Effect.sync(() => {
          const filter = input?.labels ?? {}
          return [...sandboxes.values()]
            .filter((entry) =>
              Object.entries(filter).every(
                ([key, value]) => entry.labels[key] === value,
              ),
            )
            .map((entry) => ({
              id: entry.id,
              state: entry.state,
              labels: entry.labels,
            }))
        }),

      delete: (idOrName) =>
        Effect.suspend(() => {
          deleteCalls.push(idOrName)
          if (options?.failDelete) {
            return Effect.fail('daytona delete API 500')
          }
          if (options?.hangReadbackAfterDelete) {
            const existing = sandboxes.get(idOrName)
            if (existing !== undefined) {
              sandboxes.set(idOrName, { ...existing, state: 'destroying' })
            }
          } else {
            sandboxes.delete(idOrName)
          }
          return Effect.void
        }),
    }

  return {
    port,
    sandboxes,
    createdRequests,
    deleteCalls,
  }
}

function makeFakeR2(options?: { readonly corruptReadback?: boolean }) {
  const objects = new Map<
    string,
    {
      readonly body: Uint8Array
      readonly contentType: string | undefined
      readonly metadata: Record<string, string> | undefined
    }
  >()

  const port: R2ArtifactBucketPort<string, string, string> = {
    put: (key, value, opts) =>
      Effect.sync(() => {
        objects.set(key, {
          body: new Uint8Array(value),
          contentType: opts?.httpMetadata?.contentType,
          metadata: opts?.customMetadata,
        })
      }),
    get: (key) =>
      Effect.sync(() => {
        const stored = objects.get(key)
        if (stored === undefined) return null
        const returnedBytes = options?.corruptReadback
          ? new TextEncoder().encode('corrupted-r2-bytes')
          : new Uint8Array(stored.body)
        return {
          bytes: () => Effect.succeed(returnedBytes),
        }
      }),
  }

  return { port, objects }
}

describe('V2 Stack Proof 3: Daytona.CreateSandbox lifecycle, SHA-256 R2 artifacts, and leak recovery', () => {
  it.live(
    'creates attempt-labeled sandbox with scoped model credential only, writes SHA-256-verified R2 artifact, and confirms deletion by readback',
    () =>
      Effect.gen(function* () {
        yield* resetAndMigrate

        const daytona = makeFakeDaytona({
          execOutput: 'verification-check-passed: 12/12\n',
        })
        const r2 = makeFakeR2()
        const attemptId = yield* Schema.decodeEffect(VerificationAttemptId)(
          'attempt-sandbox-happy',
        )
        const changeRequestId = yield* Schema.decodeEffect(ChangeRequestId)(
          'github:okikeSolutions/patchplane#401',
        )
        const now = yield* Clock.currentTimeMillis

        const result = yield* runIsolatedCheckInSandbox({
          attemptId,
          changeRequestId,
          command: 'bun test',
          modelCredential: {
            token: Redacted.make('pp_attempt_model_short_lived_tok'),
            attemptId,
            expiresAtMs: now + 15 * 60 * 1000,
            gatewayUrl: 'https://gateway.patchplane.dev/v1',
          },
          cleanup: {
            cleanupTimeoutMs: 5_000,
            cleanupPollIntervalMs: 10,
          },
        }).pipe(
          Effect.provide(
            Layer.merge(
              makeDaytonaSandboxProviderLayer(daytona.port),
              makeR2ArtifactStoreLayer(r2.port),
            ),
          ),
        )

        expect(result.exitCode).toBe(0)
        expect(result.cleanupConfirmed).toBe(true)
        expect(daytona.sandboxes.size).toBe(0)
        expect(daytona.deleteCalls).toEqual([result.sandboxId])

        // Verify exact labels and strict credential isolation on Daytona create input
        const createdReq = daytona.createdRequests[0]
        expect(createdReq).toBeDefined()
        if (createdReq !== undefined) {
          expect(createdReq.public).toBe(false)
          expect(createdReq.labels[PATCHPLANE_MANAGED_LABEL]).toBe('true')
          expect(createdReq.labels[PATCHPLANE_ATTEMPT_ID_LABEL]).toBe(attemptId)
          expect(createdReq.labels[PATCHPLANE_CHANGE_REQUEST_ID_LABEL]).toBe(
            changeRequestId,
          )
          expect(Object.keys(createdReq.env).toSorted()).toEqual(
            [
              SANDBOX_ATTEMPT_ID_ENV,
              SANDBOX_MODEL_GATEWAY_URL_ENV,
              SANDBOX_MODEL_TOKEN_ENV,
            ].toSorted(),
          )
        }

        // Verify SHA-256 artifact persisted in both R2 and Postgres
        expect(r2.objects.has(result.artifact.artifactKey)).toBe(true)
        const store = yield* SandboxLifecycleStore
        const artifacts = yield* store.listArtifactsByAttempt(attemptId)
        expect(artifacts).toHaveLength(1)
        expect(artifacts[0]?.sha256).toBe(result.artifact.sha256)

        const persistedSandbox = yield* store.findSandboxById(result.sandboxId)
        expect(Option.isSome(persistedSandbox)).toBe(true)
        if (Option.isSome(persistedSandbox)) {
          expect(persistedSandbox.value.status).toBe('deleted')
        }
        expect(yield* store.listQuarantinedEnvironments).toEqual([])
        expect(yield* store.listOpenInboxItems).toEqual([])
      }).pipe(Effect.provide(makeTestLifecycleDbLayer())),
    20_000,
  )

  it.live(
    'fails closed on corrupted R2 artifact readback and still confirms sandbox deletion',
    () =>
      Effect.gen(function* () {
        yield* resetAndMigrate

        const daytona = makeFakeDaytona({ execOutput: 'expected-output' })
        const r2 = makeFakeR2({ corruptReadback: true })
        const attemptId = yield* Schema.decodeEffect(VerificationAttemptId)(
          'attempt-corrupt-r2',
        )
        const changeRequestId = yield* Schema.decodeEffect(ChangeRequestId)(
          'github:okikeSolutions/patchplane#402',
        )
        const now = yield* Clock.currentTimeMillis

        const failure = yield* Effect.flip(
          runIsolatedCheckInSandbox({
            attemptId,
            changeRequestId,
            command: 'bun test',
            modelCredential: {
              token: Redacted.make('pp_attempt_model_short_lived_tok'),
              attemptId,
              expiresAtMs: now + 10 * 60 * 1000,
            },
            cleanup: { cleanupTimeoutMs: 5_000, cleanupPollIntervalMs: 10 },
          }).pipe(
            Effect.provide(
              Layer.merge(
                makeDaytonaSandboxProviderLayer(daytona.port),
                makeR2ArtifactStoreLayer(r2.port),
              ),
            ),
          ),
        )

        expect(failure._tag).toBe('ArtifactIntegrityError')
        // Sandbox MUST still be deleted and confirmed absent even when artifact write fails
        expect(daytona.sandboxes.size).toBe(0)
        expect(daytona.deleteCalls).toHaveLength(1)
        const store = yield* SandboxLifecycleStore
        expect(yield* store.listArtifactsByAttempt(attemptId)).toEqual([])
      }).pipe(Effect.provide(makeTestLifecycleDbLayer())),
    20_000,
  )

  it.effect(
    'confirms sandbox deletion even when recordSandboxCreated fails in Postgres (zero Daytona leak)',
    () =>
      Effect.gen(function* () {
        const daytona = makeFakeDaytona()
        const r2 = makeFakeR2()
        const attemptId = yield* Schema.decodeEffect(VerificationAttemptId)(
          'attempt-db-fail-after-create',
        )
        const changeRequestId = yield* Schema.decodeEffect(ChangeRequestId)(
          'github:okikeSolutions/patchplane#402b',
        )
        const now = yield* Clock.currentTimeMillis
        const markedDeleted: Array<string> = []

        const failingRecordStoreLayer = Layer.succeed(
          SandboxLifecycleStore,
          SandboxLifecycleStore.of({
            recordSandboxCreated: () =>
              Effect.fail(
                new PersistenceError({
                  operation: 'SandboxLifecycleStore.recordSandboxCreated',
                  message: 'simulated transient postgres outage',
                }),
              ),
            markSandboxDeleted: (input) =>
              Effect.sync(() => {
                markedDeleted.push(input.sandboxId)
              }),
            recordArtifactMetadata: (artifact) => Effect.succeed(artifact),
            quarantineSandboxEnvironment: () =>
              Effect.fail(
                new PersistenceError({
                  operation: 'SandboxLifecycleStore.quarantine',
                  message: 'unexpected quarantine',
                }),
              ),
            findSandboxById: () => Effect.succeedNone,
            listActiveSandboxes: Effect.succeed([]),
            listQuarantinedEnvironments: Effect.succeed([]),
            listOpenInboxItems: Effect.succeed([]),
            listArtifactsByAttempt: () => Effect.succeed([]),
          }),
        )

        const failure = yield* Effect.flip(
          runIsolatedCheckInSandbox({
            attemptId,
            changeRequestId,
            command: 'bun test',
            modelCredential: {
              token: Redacted.make('pp_attempt_model_short_lived_tok'),
              attemptId,
              expiresAtMs: now + 10 * 60 * 1000,
            },
            cleanup: { cleanupTimeoutMs: 5_000, cleanupPollIntervalMs: 10 },
          }).pipe(
            Effect.provide(
              Layer.mergeAll(
                makeDaytonaSandboxProviderLayer(daytona.port),
                makeR2ArtifactStoreLayer(r2.port).pipe(
                  Layer.provide(Digest.layerWebCrypto),
                ),
                failingRecordStoreLayer,
                Digest.layerWebCrypto,
              ),
            ),
          ),
        )

        expect(failure._tag).toBe('PersistenceError')
        expect(daytona.sandboxes.size).toBe(0)
        expect(daytona.deleteCalls).toHaveLength(1)
        expect(markedDeleted).toHaveLength(1)
      }),
  )

  it.live(
    'discovers crashed, unlabeled, and malformed managed sandboxes via labels, persists deleted audit rows, and leaves active attempts untouched',
    () =>
      Effect.gen(function* () {
        yield* resetAndMigrate

        const daytona = makeFakeDaytona()
        const crashedAttemptId = yield* Schema.decodeEffect(
          VerificationAttemptId,
        )('attempt-crashed-after-create')
        const activeAttemptId = yield* Schema.decodeEffect(
          VerificationAttemptId,
        )('attempt-still-running')
        const crId = yield* Schema.decodeEffect(ChangeRequestId)(
          'github:okikeSolutions/patchplane#403',
        )

        // Simulate crash immediately after Daytona sandbox creation (not persisted in DB yet)
        daytona.sandboxes.set('sbx-leaked-1', {
          id: 'sbx-leaked-1',
          state: 'started',
          labels: {
            ...buildAttemptSandboxLabels({
              attemptId: crashedAttemptId,
              changeRequestId: crId,
            }),
          },
          env: {},
          isPublic: false,
        })
        // Simulate a managed sandbox with malformed attempt_id label (must NOT abort sweep)
        daytona.sandboxes.set('sbx-malformed-label-1', {
          id: 'sbx-malformed-label-1',
          state: 'started',
          labels: {
            [PATCHPLANE_MANAGED_LABEL]: 'true',
            [PATCHPLANE_ATTEMPT_ID_LABEL]: '../bad-attempt',
          },
          env: {},
          isPublic: false,
        })
        daytona.sandboxes.set('sbx-active-1', {
          id: 'sbx-active-1',
          state: 'started',
          labels: {
            ...buildAttemptSandboxLabels({
              attemptId: activeAttemptId,
              changeRequestId: crId,
            }),
          },
          env: {},
          isPublic: false,
        })

        const report = yield* reconcileLeakedSandboxes({
          activeAttemptIds: new Set([activeAttemptId]),
          cleanup: { cleanupTimeoutMs: 5_000, cleanupPollIntervalMs: 10 },
        }).pipe(Effect.provide(makeDaytonaSandboxProviderLayer(daytona.port)))

        expect(report.discoveredCount).toBe(2)
        expect(report.cleanedSandboxIds).toEqual([
          'sbx-leaked-1',
          'sbx-malformed-label-1',
        ])
        expect(report.quarantinedSandboxIds).toEqual([])
        expect(daytona.sandboxes.has('sbx-leaked-1')).toBe(false)
        expect(daytona.sandboxes.has('sbx-malformed-label-1')).toBe(false)
        expect(daytona.sandboxes.has('sbx-active-1')).toBe(true)

        // Pre-DB orphan cleanup MUST leave a durable 'deleted' audit row in Postgres
        const store = yield* SandboxLifecycleStore
        const leakedRow = yield* store.findSandboxById(
          SandboxId.make('sbx-leaked-1'),
        )
        expect(Option.isSome(leakedRow)).toBe(true)
        if (Option.isSome(leakedRow)) {
          expect(leakedRow.value.status).toBe('deleted')
        }
      }).pipe(Effect.provide(makeTestLifecycleDbLayer())),
    20_000,
  )

  it.effect(
    'propagates PersistenceError in reconcileLeakedSandboxes instead of falsely reporting quarantine',
    () =>
      Effect.gen(function* () {
        const daytona = makeFakeDaytona({ failDelete: true })
        const attemptId = yield* Schema.decodeEffect(VerificationAttemptId)(
          'attempt-reconcile-db-down',
        )
        const crId = yield* Schema.decodeEffect(ChangeRequestId)(
          'github:okikeSolutions/patchplane#403b',
        )
        daytona.sandboxes.set('sbx-unquarantinable', {
          id: 'sbx-unquarantinable',
          state: 'started',
          labels: {
            ...buildAttemptSandboxLabels({ attemptId, changeRequestId: crId }),
          },
          env: {},
          isPublic: false,
        })

        const failingQuarantineStoreLayer = Layer.succeed(
          SandboxLifecycleStore,
          SandboxLifecycleStore.of({
            recordSandboxCreated: (input) =>
              Effect.succeed({ ...input, status: 'active' as const }),
            markSandboxDeleted: () => Effect.void,
            recordArtifactMetadata: (artifact) => Effect.succeed(artifact),
            quarantineSandboxEnvironment: () =>
              Effect.fail(
                new PersistenceError({
                  operation:
                    'SandboxLifecycleStore.quarantineSandboxEnvironment',
                  message: 'postgres unavailable during quarantine write',
                }),
              ),
            findSandboxById: () => Effect.succeedNone,
            listActiveSandboxes: Effect.succeed([]),
            listQuarantinedEnvironments: Effect.succeed([]),
            listOpenInboxItems: Effect.succeed([]),
            listArtifactsByAttempt: () => Effect.succeed([]),
          }),
        )

        const failure = yield* Effect.flip(
          reconcileLeakedSandboxes({
            activeAttemptIds: new Set(),
            cleanup: { cleanupTimeoutMs: 5_000, cleanupPollIntervalMs: 10 },
          }).pipe(
            Effect.provide(
              Layer.merge(
                makeDaytonaSandboxProviderLayer(daytona.port),
                failingQuarantineStoreLayer,
              ),
            ),
          ),
        )

        expect(failure._tag).toBe('PersistenceError')
      }),
  )

  it.live(
    'quarantines the environment and creates an open Decision Inbox item when deletion fails, and enforces sandbox/artifact immutability guards',
    () =>
      Effect.gen(function* () {
        yield* resetAndMigrate

        const daytona = makeFakeDaytona({ failDelete: true })
        const r2 = makeFakeR2()
        const attemptId = yield* Schema.decodeEffect(VerificationAttemptId)(
          'attempt-delete-failure',
        )
        const otherAttemptId = yield* Schema.decodeEffect(
          VerificationAttemptId,
        )('attempt-other-overwrite')
        const changeRequestId = yield* Schema.decodeEffect(ChangeRequestId)(
          'github:okikeSolutions/patchplane#404',
        )
        const now = yield* Clock.currentTimeMillis

        const failure = yield* Effect.flip(
          runIsolatedCheckInSandbox({
            attemptId,
            changeRequestId,
            command: 'bun test',
            modelCredential: {
              token: Redacted.make('pp_attempt_model_short_lived_tok'),
              attemptId,
              expiresAtMs: now + 10 * 60 * 1000,
            },
            cleanup: { cleanupTimeoutMs: 5_000, cleanupPollIntervalMs: 10 },
          }).pipe(
            Effect.provide(
              Layer.merge(
                makeDaytonaSandboxProviderLayer(daytona.port),
                makeR2ArtifactStoreLayer(r2.port),
              ),
            ),
          ),
        )

        expect(failure._tag).toBe('SandboxCleanupError')
        if (failure._tag === 'SandboxCleanupError') {
          expect(failure.timedOut).toBe(false)
        }

        const store = yield* SandboxLifecycleStore
        const quarantines = yield* store.listQuarantinedEnvironments
        const inboxItems = yield* store.listOpenInboxItems
        expect(quarantines).toHaveLength(1)
        expect(quarantines[0]?.attemptId).toBe(attemptId)
        expect(quarantines[0]?.status).toBe('quarantined')
        expect(inboxItems).toHaveLength(1)
        expect(inboxItems[0]?.attemptId).toBe(attemptId)
        expect(inboxItems[0]?.kind).toBe('cleanup_quarantine')
        expect(inboxItems[0]?.status).toBe('open')

        // State-machine guards: a quarantined sandbox cannot be reactivated or silently marked deleted
        const quarantinedSandboxId = quarantines[0]?.sandboxId
        expect(quarantinedSandboxId).toBeDefined()
        if (quarantinedSandboxId !== undefined) {
          const labels = buildAttemptSandboxLabels({
            attemptId,
            changeRequestId,
          })
          const reactivateFailure = yield* Effect.flip(
            store.recordSandboxCreated({
              sandboxId: quarantinedSandboxId,
              attemptId,
              changeRequestId,
              labels,
            }),
          )
          expect(reactivateFailure._tag).toBe('PersistenceError')

          const overwriteQuarantineFailure = yield* Effect.flip(
            store.markSandboxDeleted({
              sandboxId: quarantinedSandboxId,
              attemptId,
              changeRequestId,
              labels,
            }),
          )
          expect(overwriteQuarantineFailure._tag).toBe('PersistenceError')
        }

        // Cross-attempt artifact overwrite guard
        const existingArtifacts = yield* store.listArtifactsByAttempt(attemptId)
        expect(existingArtifacts).toHaveLength(1)
        const existing = existingArtifacts[0]
        if (existing !== undefined) {
          const crossAttemptOverwrite = yield* Effect.flip(
            store.recordArtifactMetadata(
              ArtifactRecord.make({
                attemptId: otherAttemptId,
                artifactKey: ArtifactKey.make(existing.artifactKey),
                sha256: Sha256Hex.make(existing.sha256),
                byteLength: existing.byteLength,
                contentType: existing.contentType,
              }),
            ),
          )
          expect(crossAttemptOverwrite._tag).toBe('PersistenceError')
        }
      }).pipe(Effect.provide(makeTestLifecycleDbLayer())),
    20_000,
  )

  it.effect(
    'enforces the 5-minute cleanup timeout with TestClock even when Daytona get() hides a stuck "destroying" sandbox',
    () =>
      Effect.gen(function* () {
        const daytona = makeFakeDaytona({ hangReadbackAfterDelete: true })
        const attemptId = yield* Schema.decodeEffect(VerificationAttemptId)(
          'attempt-timeout-5m',
        )
        const changeRequestId = yield* Schema.decodeEffect(ChangeRequestId)(
          'github:okikeSolutions/patchplane#405',
        )
        const sandboxId = yield* Schema.decodeEffect(SandboxId)(
          'sbx-stuck-destroying',
        )
        const labels = buildAttemptSandboxLabels({ attemptId, changeRequestId })
        daytona.sandboxes.set(sandboxId, {
          id: sandboxId,
          state: 'destroying',
          labels: { ...labels },
          env: {},
          isPublic: false,
        })

        const quarantineCalls: Array<{
          readonly sandboxId: string
          readonly attemptId: string
          readonly changeRequestId: string
          readonly reason: string
        }> = []

        const stubStoreLayer = Layer.succeed(
          SandboxLifecycleStore,
          SandboxLifecycleStore.of({
            recordSandboxCreated: (input) =>
              Effect.succeed({ ...input, status: 'active' as const }),
            markSandboxDeleted: () => Effect.void,
            recordArtifactMetadata: (artifact) => Effect.succeed(artifact),
            quarantineSandboxEnvironment: (input) =>
              Effect.sync(() => {
                quarantineCalls.push({
                  sandboxId: input.sandboxId,
                  attemptId: input.attemptId,
                  changeRequestId: input.changeRequestId,
                  reason: input.reason,
                })
                return {
                  quarantine: {
                    id: input.quarantineId,
                    attemptId: input.attemptId,
                    sandboxId: input.sandboxId,
                    reason: input.reason,
                    status: 'quarantined' as const,
                  },
                  inboxItem: {
                    id: input.inboxItemId,
                    attemptId: input.attemptId,
                    kind: 'cleanup_quarantine' as const,
                    status: 'open' as const,
                    summary: input.reason,
                    sandboxId: input.sandboxId,
                  },
                }
              }),
            findSandboxById: () => Effect.succeedNone,
            listActiveSandboxes: Effect.succeed([]),
            listQuarantinedEnvironments: Effect.succeed([]),
            listOpenInboxItems: Effect.succeed([]),
            listArtifactsByAttempt: () => Effect.succeed([]),
          }),
        )

        const fiber = yield* confirmSandboxDeletion({
          sandboxId,
          attemptId,
          changeRequestId,
          labels,
          // Default 5-minute cleanup timeout (300_000ms)
        }).pipe(
          Effect.provide(
            Layer.merge(
              makeDaytonaSandboxProviderLayer(daytona.port),
              stubStoreLayer,
            ),
          ),
          Effect.flip,
          Effect.forkScoped,
        )

        // Must NOT treat a stuck "destroying" sandbox as deleted before the 5m deadline
        yield* TestClock.adjust(
          Duration.millis(DEFAULT_CLEANUP_TIMEOUT_MS - 1_000),
        )
        expect(quarantineCalls).toHaveLength(0)

        yield* TestClock.adjust(Duration.millis(1_000))
        const error = yield* Fiber.join(fiber)

        expect(error._tag).toBe('SandboxCleanupError')
        if (error._tag === 'SandboxCleanupError') {
          expect(error.timedOut).toBe(true)
        }
        expect(quarantineCalls).toHaveLength(1)
        expect(quarantineCalls[0]).toMatchObject({
          sandboxId,
          attemptId,
          changeRequestId,
        })
        expect(quarantineCalls[0]?.reason.length).toBeGreaterThan(0)
      }),
  )

  it.live(
    'executes SandboxVerificationWorkflow durably via ClusterWorkflowEngine without persisting model credentials in Postgres',
    () =>
      Effect.gen(function* () {
        yield* resetAndMigrate

        const secretToken = 'pp_ephemeral_secret_must_never_hit_postgres'
        const daytona = makeFakeDaytona({
          execOutput: 'durable-workflow-check-ok\n',
        })
        const r2 = makeFakeR2()
        const attemptId = yield* Schema.decodeEffect(VerificationAttemptId)(
          'attempt-durable-wf',
        )
        const changeRequestId = yield* Schema.decodeEffect(ChangeRequestId)(
          'github:okikeSolutions/patchplane#407',
        )

        const url = yield* TestDatabaseUrl
        const baseClusterLayer = makeControlPlaneSingleStoreLayer({
          url,
          entityMailboxPollIntervalMs: 100,
        })
        const issuerLayer = Layer.succeed(
          ModelCredentialIssuer,
          ModelCredentialIssuer.of({
            issueAttemptCredential: Effect.fn(
              'TestModelCredentialIssuer.issue',
            )(function* (forAttemptId) {
              const now = yield* Clock.currentTimeMillis
              return {
                token: Redacted.make(secretToken),
                attemptId: forAttemptId,
                expiresAtMs: now + 10 * 60 * 1000,
                gatewayUrl: 'https://gateway.patchplane.dev/v1',
              }
            }),
          }),
        )
        const runtimeDeps = Layer.mergeAll(
          makeDaytonaSandboxProviderLayer(daytona.port),
          makeR2ArtifactStoreLayer(r2.port).pipe(
            Layer.provide(Digest.layerWebCrypto),
          ),
          issuerLayer,
          Digest.layerWebCrypto,
        )
        const workflowLayer = SandboxVerificationWorkflowLayer.pipe(
          Layer.provideMerge(runtimeDeps),
          Layer.provideMerge(baseClusterLayer),
        )

        const result = yield* SandboxVerificationWorkflow.execute({
          attemptId,
          changeRequestId,
          command: 'bun test',
          cleanupTimeoutMs: 5_000,
          cleanupPollIntervalMs: 10,
        }).pipe(Effect.provide(workflowLayer))

        expect(result.exitCode).toBe(0)
        expect(result.cleanupConfirmed).toBe(true)
        expect(daytona.sandboxes.size).toBe(0)

        // Confirm zero model credential tokens were persisted into cluster_messages
        const sql = yield* SqlClient.SqlClient
        const leakedRows = yield* sql<{ readonly count: string }>`
          SELECT count(*)::text AS count
          FROM cluster_messages
          WHERE payload::text LIKE ${`%${secretToken}%`}
        `
        expect(Number(leakedRows[0]?.count ?? '0')).toBe(0)
      }).pipe(Effect.provide(makeTestLifecycleDbLayer())),
    30_000,
  )
})
