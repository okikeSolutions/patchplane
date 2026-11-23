import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer, Option, Schema } from 'effect'
import * as Digest from 'effect/crypto/Digest'
import * as Redacted from 'effect/Redacted'
import { SqlClient } from 'effect/sql'
import { makeControlPlaneSingleStoreLayer } from '../../apps/server/src/index'
import {
  AndroidVerificationStore,
  ApkDownloadUrlIssuer,
  CloudAndroidDeviceAdapter,
  CloudAndroidVerificationWorkflow,
  CloudAndroidVerificationWorkflowLayer,
  EXPECTED_ARBEO_IMPORT_DURATION,
  SANDBOX_MODEL_TOKEN_ENV,
  SandboxLifecycleStore,
} from '../../packages/core/src/index'
import {
  AndroidPackageName,
  ChangeRequestId,
  CloudDeviceProviderId,
  CloudDeviceRunId,
  GitCommitSha,
  VerificationAttemptId,
} from '../../packages/domain/src/index'
import {
  type DaytonaCreateSandboxPort,
  GITHUB_ACTIONS_KVM_PROVIDER_ID,
  type GitHubActionsKvmDispatchPayload,
  makeDaytonaSandboxProviderLayer,
  makeGitHubActionsKvmDeviceAdapterLayer,
  makeR2ArtifactStoreLayer,
  PostgresAndroidVerificationStoreLayer,
  PostgresSandboxLifecycleStoreLayer,
  type R2ArtifactBucketPort,
} from '../../packages/plugins/src/index'
import {
  ArchitecturePlatformLayer,
  readRepoFile,
} from '../architecture/architecture-files'
import {
  resetAndMigrateDatabase,
  TestDatabaseUrl,
  TestPostgresSqlLayer,
} from './test-db'

interface FakeSandboxState {
  readonly id: string
  readonly labels: Record<string, string>
  readonly envVars: Record<string, string | undefined>
  readonly files: Map<string, Uint8Array>
}

function makeStage1FakeDaytona(
  apkBytes: Uint8Array,
  apkOutputPath: string,
  headShaByAttempt: () => string,
) {
  let seq = 0
  const sandboxes = new Map<string, FakeSandboxState>()
  const createdEnvs: Array<Record<string, string | undefined>> = []
  const executedCommands: Array<string> = []
  const deleteCalls: Array<string> = []

  const makeHandle = (state: FakeSandboxState) => ({
    sandboxId: state.id,
    state: 'started',
    labels: state.labels,
    exec: (command: string) =>
      Effect.sync(() => {
        executedCommands.push(command)
        if (command === 'git rev-parse HEAD') {
          return { exitCode: 0, result: `${headShaByAttempt()}\n` }
        }
        state.files.set(apkOutputPath, apkBytes)
        return { exitCode: 0, result: 'BUILD SUCCESSFUL' }
      }),
    statFile: (path: string) =>
      Effect.suspend(() => {
        const content = state.files.get(path)
        return content === undefined
          ? Effect.fail(`missing file ${path}`)
          : Effect.succeed({ size: content.byteLength, isDir: false })
      }),
    readFile: (path: string) =>
      Effect.suspend(() => {
        const content = state.files.get(path)
        return content === undefined
          ? Effect.fail(`missing file ${path}`)
          : Effect.succeed(content)
      }),
  })

  const port: DaytonaCreateSandboxPort<string, string, string, string, string> =
    {
      create: (input) =>
        Effect.sync(() => {
          seq += 1
          const id = `sbx-android-build-${seq}`
          const labels = { ...input?.labels }
          const envVars = { ...input?.env }
          createdEnvs.push(envVars)
          const state: FakeSandboxState = {
            id,
            labels,
            envVars,
            files: new Map<string, Uint8Array>(),
          }
          sandboxes.set(id, state)
          return makeHandle(state)
        }),

      get: (id) =>
        Effect.sync(() => {
          const found = sandboxes.get(id)
          return found === undefined ? undefined : makeHandle(found)
        }),

      list: (input) =>
        Effect.sync(() => {
          const filter = input?.labels ?? {}
          return [...sandboxes.values()]
            .filter((entry) =>
              Object.entries(filter).every(([k, v]) => entry.labels[k] === v),
            )
            .map((entry) => ({
              id: entry.id,
              state: 'started',
              labels: entry.labels,
            }))
        }),

      delete: (id) =>
        Effect.sync(() => {
          deleteCalls.push(id)
          sandboxes.delete(id)
        }),
    }

  return { port, sandboxes, createdEnvs, executedCommands, deleteCalls }
}

function makeFakeR2() {
  const objects = new Map<string, Uint8Array>()
  const port: R2ArtifactBucketPort<string, string, string> = {
    put: (key, value) =>
      Effect.sync(() => {
        objects.set(key, new Uint8Array(value))
      }),
    get: (key) =>
      Effect.sync(() => {
        const stored = objects.get(key)
        if (stored === undefined) return null
        return {
          size: stored.byteLength,
          bytes: () => Effect.succeed(new Uint8Array(stored)),
        }
      }),
  }
  return { port, objects }
}

describe('V2 Stack Proof 4: Two-stage cloud Arbeo Android (Linux sandbox + GitHub Actions KVM)', () => {
  it.live(
    'builds debug APK in isolated Linux sandbox with zero model tokens, verifies SHA-256 through GitHub Actions KVM adapter, confirms Arbeo +05:00 & offline persistence, and persists zero secrets to cluster tables',
    () =>
      Effect.gen(function* () {
        yield* resetAndMigrateDatabase

        const apkBytes = new TextEncoder().encode(
          'PK\u0003\u0004arbeo-debug-apk-binary-payload-v1',
        )
        const apkOutputPath = 'app/build/outputs/apk/debug/app-debug.apk'
        const sourceSha = yield* Schema.decodeEffect(GitCommitSha)(
          '1234567890abcdef1234567890abcdef12345678',
        )
        const secretSignedUrl =
          'https://r2.patchplane.dev/attempts/attempt-arbeo-1/android/app-debug.apk?X-Amz-Signature=supersecreturlsig'

        const daytona = makeStage1FakeDaytona(
          apkBytes,
          apkOutputPath,
          () => sourceSha,
        )
        const r2 = makeFakeR2()
        const dispatchedPayloads: Array<GitHubActionsKvmDispatchPayload> = []

        const ghAdapterLayer = makeGitHubActionsKvmDeviceAdapterLayer({
          dispatchWorkflow: (payload) =>
            Effect.sync(() => {
              dispatchedPayloads.push(payload)
              return { runId: 'gha-kvm-run-501' }
            }),
          awaitWorkflowResult: ({ runId }) =>
            Effect.sync(() => {
              const sent = dispatchedPayloads[0]
              return {
                runId,
                observation: {
                  observedApkSha256: sent?.inputs.apk_sha256 ?? '',
                  apkSha256Verified: true,
                  cleanEmulatorBooted: true,
                  kvmAccelerated: true,
                  importPreviewDuration: EXPECTED_ARBEO_IMPORT_DURATION,
                  importConfirmedDuration: EXPECTED_ARBEO_IMPORT_DURATION,
                  persistedAfterOfflineRestart: true,
                  cleanupConfirmed: true,
                },
                artifacts: [
                  {
                    relativePath: 'import-preview.png',
                    contentType: 'image/png',
                    bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
                  },
                  {
                    relativePath: 'logcat-bounded.txt',
                    contentType: 'text/plain; charset=utf-8',
                    bytes: new TextEncoder().encode(
                      'ArbeoImport: preview=+05:00 confirmed=+05:00 offlineRestart=persisted',
                    ),
                  },
                ],
              }
            }),
        })

        const url = yield* TestDatabaseUrl
        const baseClusterLayer = makeControlPlaneSingleStoreLayer({
          url,
          entityMailboxPollIntervalMs: 100,
        })
        const workflowLayer = CloudAndroidVerificationWorkflowLayer.pipe(
          Layer.provideMerge(
            Layer.mergeAll(
              makeDaytonaSandboxProviderLayer(daytona.port),
              makeR2ArtifactStoreLayer(r2.port).pipe(
                Layer.provide(Digest.layerWebCrypto),
              ),
              ghAdapterLayer,
              Layer.succeed(
                ApkDownloadUrlIssuer,
                ApkDownloadUrlIssuer.of({
                  issueSignedApkUrl: () =>
                    Effect.succeed(Redacted.make(secretSignedUrl)),
                }),
              ),
              Digest.layerWebCrypto,
            ),
          ),
          Layer.provideMerge(baseClusterLayer),
        )

        const attemptId = yield* Schema.decodeEffect(VerificationAttemptId)(
          'attempt-arbeo-1',
        )
        const changeRequestId = yield* Schema.decodeEffect(ChangeRequestId)(
          'github:okikeSolutions/arbeo#88',
        )
        const packageName = yield* Schema.decodeEffect(AndroidPackageName)(
          'com.okikesolutions.arbeo.debug',
        )

        const result = yield* CloudAndroidVerificationWorkflow.execute({
          attemptId,
          changeRequestId,
          sourceSha,
          packageName,
          buildCommand: './gradlew :app:assembleDebug',
          apkOutputPath,
          syntheticFixtureId: 'arbeo-synthetic-5h-v1',
          devAccountHandle: 'dev-qa-bot@arbeo.test',
          cleanupTimeoutMs: 5_000,
          cleanupPollIntervalMs: 10,
        }).pipe(Effect.provide(workflowLayer))

        // Stage 1: isolated Linux build with ZERO model tokens, SHA-256 R2 APK,
        // and confirmed sandbox deletion
        expect(result.stage1.cleanupConfirmed).toBe(true)
        expect(result.stage1.build.sourceSha).toBe(sourceSha)
        expect(daytona.sandboxes.size).toBe(0)
        expect(daytona.deleteCalls).toHaveLength(1)
        expect(daytona.createdEnvs).toHaveLength(1)
        expect(daytona.createdEnvs[0]).not.toHaveProperty(
          SANDBOX_MODEL_TOKEN_ENV,
        )
        expect(r2.objects.has(result.stage1.build.apkArtifactKey)).toBe(true)

        // Stage 2: dispatched ONLY verified APK digest & scoped URL (no Gradle/source)
        expect(dispatchedPayloads).toHaveLength(1)
        const dispatched = dispatchedPayloads[0]
        expect(dispatched?.inputs.apk_sha256).toBe(
          result.stage1.build.apkSha256,
        )
        expect(dispatched?.inputs.source_sha).toBe(sourceSha)
        expect(Object.keys(dispatched?.inputs ?? {}).toSorted()).toEqual([
          'apk_artifact_key',
          'apk_download_url',
          'apk_sha256',
          'attempt_id',
          'change_request_id',
          'dev_account_handle',
          'package_name',
          'source_sha',
          'synthetic_fixture_id',
        ])

        expect(result.stage2.passed).toBe(true)
        expect(result.stage2.run.providerId).toBe(
          GITHUB_ACTIONS_KVM_PROVIDER_ID,
        )
        expect(result.stage2.run.status).toBe('passed')
        expect(result.stage2.run.artifactKeys).toEqual([
          `attempts/${attemptId}/android/device/gha-kvm-run-501/import-preview.png`,
          `attempts/${attemptId}/android/device/gha-kvm-run-501/logcat-bounded.txt`,
        ])

        // Verify Postgres provenance records & zero secret leakage into BOTH
        // cluster_messages AND cluster_replies
        const sql = yield* SqlClient.SqlClient
        const leakedMessages = yield* sql<{ readonly count: string }>`
          SELECT count(*)::text AS count
          FROM cluster_messages
          WHERE payload::text LIKE ${'%supersecreturlsig%'}
        `
        expect(Number(leakedMessages[0]?.count ?? '0')).toBe(0)

        const leakedReplies = yield* sql<{ readonly count: string }>`
          SELECT count(*)::text AS count
          FROM cluster_replies
          WHERE payload::text LIKE ${'%supersecreturlsig%'}
        `
        expect(Number(leakedReplies[0]?.count ?? '0')).toBe(0)

        // Read back directly via Postgres stores (no redundant cluster rebuild)
        const storedBuild = yield* Effect.gen(function* () {
          const store = yield* AndroidVerificationStore
          // Identical terminal replay of cloud_device_runs is idempotent
          const replayed = yield* store.recordCloudDeviceRun({
            runId: result.stage2.run.runId,
            attemptId: result.stage2.run.attemptId,
            changeRequestId: result.stage2.run.changeRequestId,
            providerId: result.stage2.run.providerId,
            sourceSha: result.stage2.run.sourceSha,
            apkArtifactKey: result.stage2.run.apkArtifactKey,
            apkSha256: result.stage2.run.apkSha256,
            status: result.stage2.run.status,
            ...(result.stage2.run.observation !== undefined
              ? { observation: result.stage2.run.observation }
              : {}),
            artifactKeys: result.stage2.run.artifactKeys,
          })
          expect(replayed.status).toBe('passed')
          expect(replayed.artifactKeys).toEqual(result.stage2.run.artifactKeys)

          // Conflicting terminal mutation fails closed
          const conflictErr = yield* Effect.flip(
            store.recordCloudDeviceRun({
              runId: result.stage2.run.runId,
              attemptId: result.stage2.run.attemptId,
              changeRequestId: result.stage2.run.changeRequestId,
              providerId: result.stage2.run.providerId,
              sourceSha: result.stage2.run.sourceSha,
              apkArtifactKey: result.stage2.run.apkArtifactKey,
              apkSha256: result.stage2.run.apkSha256,
              status: 'failed',
              artifactKeys: [],
            }),
          )
          expect(conflictErr._tag).toBe('PersistenceError')

          return yield* store.findApkBuildByAttempt(attemptId)
        }).pipe(Effect.provide(PostgresAndroidVerificationStoreLayer))
        expect(Option.isSome(storedBuild)).toBe(true)
        if (Option.isSome(storedBuild)) {
          expect(storedBuild.value.apkSha256).toBe(
            result.stage1.build.apkSha256,
          )
        }

        const artifacts = yield* Effect.gen(function* () {
          const store = yield* SandboxLifecycleStore
          return yield* store.listArtifactsByAttempt(attemptId)
        }).pipe(Effect.provide(PostgresSandboxLifecycleStoreLayer))
        // 1 Stage 1 APK + 2 Stage 2 bounded diagnostic artifacts
        expect(artifacts).toHaveLength(3)
      }).pipe(Effect.provide(TestPostgresSqlLayer)),
    30_000,
  )

  it.live(
    'fails closed on tampered APK SHA-256 in Stage 2 and allows swapping to Expo Simulators without Linux KVM coupling',
    () =>
      Effect.gen(function* () {
        yield* resetAndMigrateDatabase

        const apkBytes = new TextEncoder().encode('PK\u0003\u0004apk-v2')
        const apkOutputPath = 'app/build/outputs/apk/debug/app-debug.apk'
        const url = yield* TestDatabaseUrl
        const baseClusterLayer = makeControlPlaneSingleStoreLayer({
          url,
          entityMailboxPollIntervalMs: 100,
        })

        let activeSourceSha = 'a'.repeat(40)
        const daytona1 = makeStage1FakeDaytona(
          apkBytes,
          apkOutputPath,
          () => activeSourceSha,
        )
        const r2A = makeFakeR2()
        const tamperedGhaLayer = makeGitHubActionsKvmDeviceAdapterLayer({
          dispatchWorkflow: () => Effect.succeed({ runId: 'gha-tampered-1' }),
          awaitWorkflowResult: ({ runId }) =>
            Effect.succeed({
              runId,
              observation: {
                observedApkSha256: 'f'.repeat(64),
                apkSha256Verified: true,
                cleanEmulatorBooted: true,
                kvmAccelerated: true,
                importPreviewDuration: EXPECTED_ARBEO_IMPORT_DURATION,
                importConfirmedDuration: EXPECTED_ARBEO_IMPORT_DURATION,
                persistedAfterOfflineRestart: true,
                cleanupConfirmed: true,
              },
              artifacts: [
                {
                  relativePath: 'should-not-persist.png',
                  contentType: 'image/png',
                  bytes: new Uint8Array([1, 2, 3]),
                },
              ],
            }),
        })

        const sharedIssuers = Layer.mergeAll(
          Layer.succeed(
            ApkDownloadUrlIssuer,
            ApkDownloadUrlIssuer.of({
              issueSignedApkUrl: () =>
                Effect.succeed(
                  Redacted.make(
                    'https://r2.patchplane.dev/app-debug.apk?sig=ok',
                  ),
                ),
            }),
          ),
          Digest.layerWebCrypto,
        )

        // 1) Tampered Stage 2 APK SHA-256 MUST fail closed with ApkIntegrityError
        //    and MUST NOT persist untrusted Stage 2 artifacts to R2
        const tamperedFailure = yield* Effect.flip(
          CloudAndroidVerificationWorkflow.execute({
            attemptId: VerificationAttemptId.make('attempt-tampered-apk'),
            changeRequestId: ChangeRequestId.make(
              'github:okikeSolutions/arbeo#89',
            ),
            sourceSha: GitCommitSha.make(activeSourceSha),
            packageName: AndroidPackageName.make(
              'com.okikesolutions.arbeo.debug',
            ),
            buildCommand: './gradlew :app:assembleDebug',
            apkOutputPath,
            syntheticFixtureId: 'arbeo-synthetic-5h-v1',
            devAccountHandle: 'dev-qa-bot@arbeo.test',
            cleanupTimeoutMs: 5_000,
            cleanupPollIntervalMs: 10,
          }).pipe(
            Effect.provide(
              CloudAndroidVerificationWorkflowLayer.pipe(
                Layer.provideMerge(
                  Layer.mergeAll(
                    makeDaytonaSandboxProviderLayer(daytona1.port),
                    makeR2ArtifactStoreLayer(r2A.port).pipe(
                      Layer.provide(Digest.layerWebCrypto),
                    ),
                    tamperedGhaLayer,
                    sharedIssuers,
                  ),
                ),
                Layer.provideMerge(baseClusterLayer),
              ),
            ),
          ),
        )
        expect(tamperedFailure._tag).toBe('ApkIntegrityError')
        // Only the Stage 1 APK was stored in R2; tampered Stage 2 artifact was rejected before upload
        expect(r2A.objects.size).toBe(1)

        const failedRun = yield* Effect.gen(function* () {
          const store = yield* AndroidVerificationStore
          return yield* store.findCloudDeviceRunById(
            CloudDeviceRunId.make('gha-tampered-1'),
          )
        }).pipe(Effect.provide(PostgresAndroidVerificationStoreLayer))
        expect(Option.isSome(failedRun)).toBe(true)
        if (Option.isSome(failedRun)) {
          expect(failedRun.value.status).toBe('failed')
        }

        // 2) Provider-neutral swap: execute the EXACT same workflow against
        //    `expo-simulators` WITHOUT Linux-only `kvmAccelerated` field.
        activeSourceSha = 'b'.repeat(40)
        const r2B = makeFakeR2()
        const expoProviderId = CloudDeviceProviderId.make('expo-simulators')
        const expoAdapterLayer = Layer.succeed(
          CloudAndroidDeviceAdapter,
          CloudAndroidDeviceAdapter.of({
            providerId: expoProviderId,
            executionEnvironment: 'cloud-isolated',
            dispatchApkVerification: () =>
              Effect.succeed({
                runId: CloudDeviceRunId.make('expo-run-701'),
                providerId: expoProviderId,
              }),
            awaitVerificationResult: ({ runId, expectedApkSha256 }) =>
              Effect.succeed({
                runId,
                providerId: expoProviderId,
                observation: {
                  observedApkSha256: expectedApkSha256,
                  apkSha256Verified: true,
                  cleanEmulatorBooted: true,
                  importPreviewDuration: EXPECTED_ARBEO_IMPORT_DURATION,
                  importConfirmedDuration: EXPECTED_ARBEO_IMPORT_DURATION,
                  persistedAfterOfflineRestart: true,
                  cleanupConfirmed: true,
                },
                artifacts: [],
              }),
          }),
        )

        const swappedResult = yield* CloudAndroidVerificationWorkflow.execute({
          attemptId: VerificationAttemptId.make('attempt-expo-swap'),
          changeRequestId: ChangeRequestId.make(
            'github:okikeSolutions/arbeo#90',
          ),
          sourceSha: GitCommitSha.make(activeSourceSha),
          packageName: AndroidPackageName.make(
            'com.okikesolutions.arbeo.debug',
          ),
          buildCommand: './gradlew :app:assembleDebug',
          apkOutputPath,
          syntheticFixtureId: 'arbeo-synthetic-5h-v1',
          devAccountHandle: 'dev-qa-bot@arbeo.test',
          cleanupTimeoutMs: 5_000,
          cleanupPollIntervalMs: 10,
        }).pipe(
          Effect.provide(
            CloudAndroidVerificationWorkflowLayer.pipe(
              Layer.provideMerge(
                Layer.mergeAll(
                  makeDaytonaSandboxProviderLayer(daytona1.port),
                  makeR2ArtifactStoreLayer(r2B.port).pipe(
                    Layer.provide(Digest.layerWebCrypto),
                  ),
                  expoAdapterLayer,
                  sharedIssuers,
                ),
              ),
              Layer.provideMerge(baseClusterLayer),
            ),
          ),
        )

        expect(swappedResult.stage2.passed).toBe(true)
        expect(swappedResult.stage2.run.providerId).toBe(expoProviderId)
      }).pipe(Effect.provide(TestPostgresSqlLayer)),
    30_000,
  )

  it.effect(
    'Stage 2 GitHub Actions workflow masks signed URLs, enforces /dev/kvm, verifies SHA-256, emits observation.json with EXIT cleanup trap, and runs zero Gradle/PR-source checkout',
    () =>
      Effect.gen(function* () {
        const workflow = yield* readRepoFile(
          '.github/workflows/cloud-android-kvm-verify.yml',
        )
        expect(workflow).toContain('workflow_dispatch:')
        expect(workflow).toContain('runs-on: ubuntu-latest')
        expect(workflow).toContain('::add-mask::')
        expect(workflow).toContain('/dev/kvm')
        expect(workflow).toContain('sha256sum')
        expect(workflow).toContain('-wipe-data')
        expect(workflow).toContain('adb uninstall')
        expect(workflow).toContain('observation.json')
        expect(workflow).toContain('trap cleanup_and_report EXIT')
        expect(workflow).toContain('if-no-files-found: error')
        expect(workflow).not.toContain('svc wifi disable || true')
        expect(workflow).not.toContain('svc data disable || true')
        // Stage 2 MUST NOT checkout PR source or execute Gradle
        expect(workflow).not.toMatch(/actions\/checkout/i)
        expect(workflow).not.toMatch(/gradlew?/i)
      }).pipe(Effect.provide(ArchitecturePlatformLayer)),
  )
})
