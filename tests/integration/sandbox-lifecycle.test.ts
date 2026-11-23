import { BunFileSystem } from '@effect/platform-bun'
import { describe, expect, it } from '@effect/vitest'
import { Clock, Duration, Effect, Fiber, Layer, Option, Schema } from 'effect'
import * as Config from 'effect/Config'
import * as Digest from 'effect/crypto/Digest'
import * as Redacted from 'effect/Redacted'
import { SqlClient } from 'effect/sql'
import { TestClock } from 'effect/testing'
import {
  buildAttemptSandboxLabels,
  confirmSandboxDeletion,
  DEFAULT_CLEANUP_TIMEOUT_MS,
  MAX_MODEL_CREDENTIAL_TTL_MS,
  PATCHPLANE_ATTEMPT_ID_LABEL,
  PATCHPLANE_CHANGE_REQUEST_ID_LABEL,
  PATCHPLANE_MANAGED_LABEL,
  reconcileLeakedSandboxes,
  runIsolatedCheckInSandbox,
  SandboxLifecycleStore,
  SANDBOX_ATTEMPT_ID_ENV,
  SANDBOX_MODEL_GATEWAY_URL_ENV,
  SANDBOX_MODEL_TOKEN_ENV,
} from '../../packages/core/src/index'
import {
  ChangeRequestId,
  SandboxId,
  VerificationAttemptId,
} from '../../packages/domain/src/index'
import {
  applySqlMigrations,
  type DaytonaCreateSandboxPort,
  loadSqlMigrations,
  makeDaytonaSandboxProviderLayer,
  makePostgresSqlLayer,
  makeR2ArtifactStoreLayer,
  PostgresSandboxLifecycleStoreLayer,
  type R2ArtifactBucketPort,
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

const assertDisposableTestDatabase = (url: Redacted.Redacted) =>
  Effect.gen(function* () {
    const parsed = yield* Effect.try({
      try: () => new URL(Redacted.value(url)),
      catch: () =>
        new UnsafeTestDatabaseError({
          reason: 'PATCHPLANE_TEST_DATABASE_URL is not a valid URL',
        }),
    })
    if (!parsed.pathname.replace(/^\//, '').endsWith('_test')) {
      return yield* new UnsafeTestDatabaseError({
        reason:
          'PATCHPLANE_TEST_DATABASE_URL must name a disposable database ending in "_test"',
      })
    }
    return url
  })

const makeTestLifecycleDbLayer = () =>
  Layer.unwrap(
    Effect.gen(function* () {
      const url = yield* assertDisposableTestDatabase(
        yield* TestDatabaseUrlConfig,
      )
      const sqlLayer = makePostgresSqlLayer({ url })
      return PostgresSandboxLifecycleStoreLayer.pipe(
        Layer.provideMerge(Digest.layerWebCrypto),
        Layer.provideMerge(sqlLayer),
      )
    }),
  )

const resetAndMigrate = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql.unsafe('DROP SCHEMA IF EXISTS public CASCADE')
  yield* sql.unsafe('CREATE SCHEMA public')
  const migrations = yield* loadSqlMigrations().pipe(
    Effect.provide(BunFileSystem.layer),
  )
  yield* applySqlMigrations(migrations)
})

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
  const getCalls: Array<string> = []

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
          getCalls.push(idOrName)
          const found = sandboxes.get(idOrName)
          if (found === undefined) return undefined
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
          if (!options?.hangReadbackAfterDelete) {
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
    getCalls,
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
        expect(daytona.getCalls).toContain(result.sandboxId)

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

  it.live(
    'discovers crashed/orphaned attempt sandboxes via labels and cleans them up while leaving active attempts untouched',
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

        // Simulate crash immediately after Daytona sandbox creation (not even persisted in DB yet)
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

        expect(report.discoveredCount).toBe(1)
        expect(report.cleanedSandboxIds).toEqual(['sbx-leaked-1'])
        expect(report.quarantinedSandboxIds).toEqual([])
        expect(daytona.sandboxes.has('sbx-leaked-1')).toBe(false)
        expect(daytona.sandboxes.has('sbx-active-1')).toBe(true)
      }).pipe(Effect.provide(makeTestLifecycleDbLayer())),
    20_000,
  )

  it.live(
    'quarantines the environment and creates an open Decision Inbox item when deletion fails',
    () =>
      Effect.gen(function* () {
        yield* resetAndMigrate

        const daytona = makeFakeDaytona({ failDelete: true })
        const r2 = makeFakeR2()
        const attemptId = yield* Schema.decodeEffect(VerificationAttemptId)(
          'attempt-delete-failure',
        )
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
      }).pipe(Effect.provide(makeTestLifecycleDbLayer())),
    20_000,
  )

  it.effect(
    'enforces the 5-minute cleanup timeout with TestClock, quarantines the environment, and opens a Decision Inbox item',
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

        const quarantinedReasons: Array<string> = []
        const inboxSummaries: Array<string> = []

        const stubStoreLayer = Layer.succeed(
          SandboxLifecycleStore,
          SandboxLifecycleStore.of({
            recordSandboxCreated: (input) =>
              Effect.succeed({ ...input, status: 'active' as const }),
            markSandboxDeleted: () => Effect.void,
            recordArtifactMetadata: (artifact) => Effect.succeed(artifact),
            quarantineSandboxEnvironment: (input) =>
              Effect.sync(() => {
                quarantinedReasons.push(input.reason)
                const summary = `Cleanup quarantined ${input.sandboxId}: ${input.reason}`
                inboxSummaries.push(summary)
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
                    summary,
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

        yield* TestClock.adjust(Duration.millis(DEFAULT_CLEANUP_TIMEOUT_MS))
        const error = yield* Fiber.join(fiber)

        expect(error._tag).toBe('SandboxCleanupError')
        if (error._tag === 'SandboxCleanupError') {
          expect(error.timedOut).toBe(true)
        }
        expect(quarantinedReasons).toHaveLength(1)
        expect(inboxSummaries).toHaveLength(1)
      }),
  )

  it.live(
    'rejects WorkOS, GitHub App, Postgres, Neon, Cloudflare, Daytona, control-plane, and expired/over-TTL credentials before creating any sandbox',
    () =>
      Effect.gen(function* () {
        yield* resetAndMigrate

        const daytona = makeFakeDaytona()
        const r2 = makeFakeR2()
        const attemptId = yield* Schema.decodeEffect(VerificationAttemptId)(
          'attempt-cred-policy',
        )
        const otherAttemptId = yield* Schema.decodeEffect(
          VerificationAttemptId,
        )('attempt-other')
        const changeRequestId = yield* Schema.decodeEffect(ChangeRequestId)(
          'github:okikeSolutions/patchplane#406',
        )
        const now = yield* Clock.currentTimeMillis
        const validCredential = {
          token: Redacted.make('pp_attempt_model_short_lived_tok'),
          attemptId,
          expiresAtMs: now + 10 * 60 * 1000,
        }

        const forbiddenKeys = [
          'WORKOS_API_KEY',
          'WORKOS_COOKIE_PASSWORD',
          'GITHUB_PRIVATE_KEY',
          'GITHUB_WEBHOOK_SECRET',
          'DATABASE_URL',
          'PGPASSWORD',
          'NEON_API_KEY',
          'CLOUDFLARE_API_TOKEN',
          'DAYTONA_API_KEY',
          'PATCHPLANE_SYSTEM_INGESTION_SECRET',
          'OPENAI_API_KEY',
          'CUSTOM_UNALLOWLISTED_VAR',
        ]

        for (const key of forbiddenKeys) {
          const failure = yield* Effect.flip(
            runIsolatedCheckInSandbox({
              attemptId,
              changeRequestId,
              command: 'bun test',
              modelCredential: validCredential,
              extraEnv: { [key]: Redacted.make('should-never-enter-sandbox') },
            }).pipe(
              Effect.provide(
                Layer.merge(
                  makeDaytonaSandboxProviderLayer(daytona.port),
                  makeR2ArtifactStoreLayer(r2.port),
                ),
              ),
            ),
          )
          expect(failure._tag).toBe('SandboxCredentialPolicyError')
        }

        // Expired model token rejected
        const expired = yield* Effect.flip(
          runIsolatedCheckInSandbox({
            attemptId,
            changeRequestId,
            command: 'bun test',
            modelCredential: {
              token: Redacted.make('expired_tok'),
              attemptId,
              expiresAtMs: now - 1_000,
            },
          }).pipe(
            Effect.provide(
              Layer.merge(
                makeDaytonaSandboxProviderLayer(daytona.port),
                makeR2ArtifactStoreLayer(r2.port),
              ),
            ),
          ),
        )
        expect(expired._tag).toBe('SandboxCredentialPolicyError')

        // Over-TTL (> 45 min) model token rejected
        const overTtl = yield* Effect.flip(
          runIsolatedCheckInSandbox({
            attemptId,
            changeRequestId,
            command: 'bun test',
            modelCredential: {
              token: Redacted.make('too_long_lived_tok'),
              attemptId,
              expiresAtMs: now + MAX_MODEL_CREDENTIAL_TTL_MS + 60_000,
            },
          }).pipe(
            Effect.provide(
              Layer.merge(
                makeDaytonaSandboxProviderLayer(daytona.port),
                makeR2ArtifactStoreLayer(r2.port),
              ),
            ),
          ),
        )
        expect(overTtl._tag).toBe('SandboxCredentialPolicyError')

        // Wrong attempt scope rejected
        const wrongScope = yield* Effect.flip(
          runIsolatedCheckInSandbox({
            attemptId,
            changeRequestId,
            command: 'bun test',
            modelCredential: {
              token: Redacted.make('wrong_attempt_tok'),
              attemptId: otherAttemptId,
              expiresAtMs: now + 5 * 60 * 1000,
            },
          }).pipe(
            Effect.provide(
              Layer.merge(
                makeDaytonaSandboxProviderLayer(daytona.port),
                makeR2ArtifactStoreLayer(r2.port),
              ),
            ),
          ),
        )
        expect(wrongScope._tag).toBe('SandboxCredentialPolicyError')

        // Verify Daytona createSandbox was NEVER called on any rejected input
        expect(daytona.createdRequests).toHaveLength(0)
      }).pipe(Effect.provide(makeTestLifecycleDbLayer())),
    20_000,
  )
})
