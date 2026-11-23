import { describe, expect, it } from '@effect/vitest'
import { Duration, Effect, Fiber, Layer, Option } from 'effect'
import * as Digest from 'effect/crypto/Digest'
import * as Redacted from 'effect/Redacted'
import * as TestClock from 'effect/testing/TestClock'
import {
  type AndroidApkBuildRecord,
  AndroidPackageName,
  ArtifactKey,
  type ArtifactRecord,
  ChangeRequestId,
  CloudDeviceProviderId,
  CloudDeviceRunId,
  type CloudDeviceRunRecord,
  GitCommitSha,
  SandboxId,
  type SandboxRecord,
  Sha256Hex,
  VerificationAttemptId,
} from '@patchplane/domain'
import {
  EXPECTED_ARBEO_IMPORT_DURATION,
  MAX_CLOUD_DEVICE_ARTIFACT_BYTES,
} from '../services/android-verification-policy'
import { AndroidVerificationStore } from '../services/android-verification-store'
import { ArtifactStore } from '../services/artifact-store'
import {
  CloudAndroidDeviceAdapter,
  type CloudAndroidVerificationReport,
} from '../services/cloud-device-adapter'
import type { ValidatedSandboxEnv } from '../services/sandbox-credential-policy'
import { SandboxLifecycleStore } from '../services/sandbox-lifecycle-store'
import { SandboxProvider } from '../services/sandbox-provider'
import {
  awaitAndRecordCloudDeviceResult,
  buildDebugApkInIsolatedSandbox,
  runVerifiedApkOnCloudDevice,
} from './cloud-android-verification-workflow'

const ATTEMPT_ID = VerificationAttemptId.make('attempt-unit-1')
const CHANGE_REQUEST_ID = ChangeRequestId.make('github:okikeSolutions/arbeo#99')
const SOURCE_SHA = GitCommitSha.make('1'.repeat(40))
const PACKAGE_NAME = AndroidPackageName.make('com.okikesolutions.arbeo.debug')
const EXPECTED_APK_SHA = Sha256Hex.make('a'.repeat(64))
const APK_KEY = ArtifactKey.make(`attempts/${ATTEMPT_ID}/android/app-debug.apk`)
const PROVIDER_ID = CloudDeviceProviderId.make('cloud-unit-device')
const RUN_ID = CloudDeviceRunId.make('unit-run-1')

function makeInMemoryStores() {
  const apkBuilds = new Map<string, AndroidApkBuildRecord>()
  const cloudRuns = new Map<string, CloudDeviceRunRecord>()
  const cloudRunHistory: Array<CloudDeviceRunRecord> = []
  const artifacts = new Map<
    string,
    { record: ArtifactRecord; bytes: Uint8Array }
  >()
  const recordedArtifacts: Array<ArtifactRecord> = []
  const deletedSandboxes: Array<string> = []

  const androidStoreLayer = Layer.succeed(
    AndroidVerificationStore,
    AndroidVerificationStore.of({
      recordApkBuild: (input) =>
        Effect.sync(() => {
          apkBuilds.set(input.attemptId, input)
          return input
        }),
      findApkBuildByAttempt: (attemptId) =>
        Effect.sync(() => Option.fromNullishOr(apkBuilds.get(attemptId))),
      recordCloudDeviceRun: (input) =>
        Effect.sync(() => {
          cloudRuns.set(input.runId, input)
          cloudRunHistory.push(input)
          return input
        }),
      findCloudDeviceRunById: (runId) =>
        Effect.sync(() => Option.fromNullishOr(cloudRuns.get(runId))),
    }),
  )

  const artifactStoreLayer = Layer.succeed(
    ArtifactStore,
    ArtifactStore.of({
      putVerifiedArtifact: (input) =>
        Effect.sync(() => {
          const record: ArtifactRecord = {
            attemptId: input.attemptId,
            artifactKey: input.artifactKey,
            sha256: input.expectedSha256,
            byteLength: input.body.byteLength,
            contentType: input.contentType,
          }
          artifacts.set(input.artifactKey, {
            record,
            bytes: new Uint8Array(input.body),
          })
          return record
        }),
      getVerifiedArtifact: ({ artifactKey }) =>
        Effect.sync(() => {
          const found = artifacts.get(artifactKey)
          return found?.bytes ?? new Uint8Array([0x50, 0x4b, 0x03, 0x04])
        }),
    }),
  )

  const lifecycleStoreLayer = Layer.succeed(
    SandboxLifecycleStore,
    SandboxLifecycleStore.of({
      recordSandboxCreated: (input) =>
        Effect.succeed({
          sandboxId: input.sandboxId,
          attemptId: input.attemptId,
          changeRequestId: input.changeRequestId,
          status: 'active',
          labels: { ...input.labels },
        } satisfies SandboxRecord),
      markSandboxDeleted: ({ sandboxId }) =>
        Effect.sync(() => {
          deletedSandboxes.push(sandboxId)
        }),
      quarantineSandboxEnvironment: (input) =>
        Effect.succeed({
          quarantine: {
            id: input.quarantineId,
            attemptId: input.attemptId,
            sandboxId: input.sandboxId,
            reason: input.reason,
            status: 'quarantined',
          },
          inboxItem: {
            id: input.inboxItemId,
            attemptId: input.attemptId,
            kind: 'cleanup_quarantine',
            status: 'open',
            summary: input.reason,
            sandboxId: input.sandboxId,
          },
        }),
      findSandboxById: () => Effect.succeedNone,
      listActiveSandboxes: Effect.succeed([]),
      listQuarantinedEnvironments: Effect.succeed([]),
      listOpenInboxItems: Effect.succeed([]),
      recordArtifactMetadata: (record) =>
        Effect.sync(() => {
          recordedArtifacts.push(record)
          return record
        }),
      listArtifactsByAttempt: () => Effect.succeed([...recordedArtifacts]),
    }),
  )

  return {
    apkBuilds,
    cloudRuns,
    cloudRunHistory,
    artifacts,
    recordedArtifacts,
    deletedSandboxes,
    layer: Layer.mergeAll(
      androidStoreLayer,
      artifactStoreLayer,
      lifecycleStoreLayer,
      Digest.layerWebCrypto,
    ),
  }
}

const sampleBuild: AndroidApkBuildRecord = {
  attemptId: ATTEMPT_ID,
  changeRequestId: CHANGE_REQUEST_ID,
  sourceSha: SOURCE_SHA,
  apkArtifactKey: APK_KEY,
  apkSha256: EXPECTED_APK_SHA,
  apkByteLength: 1024,
  buildSandboxId: SandboxId.make('sbx-unit-build'),
  packageName: PACKAGE_NAME,
}

describe('CloudAndroidVerificationWorkflow unit invariants', () => {
  it.effect(
    'Stage 1 passes zero model tokens, verifies HEAD sourceSha & ZIP magic bytes, and always deletes the sandbox on error or interruption',
    () =>
      Effect.gen(function* () {
        const stores = makeInMemoryStores()
        const capturedEnvs: Array<ValidatedSandboxEnv> = []
        const deletedIds: Array<string> = []
        let headOutput: string = SOURCE_SHA
        let fileBytes = new Uint8Array([0x00, 0x01, 0x02, 0x03]) // invalid non-ZIP
        let hangBuild = false

        const sandboxLayer = Layer.succeed(
          SandboxProvider,
          SandboxProvider.of({
            createSandbox: ({ env, labels }) =>
              Effect.sync(() => {
                capturedEnvs.push(env)
                return {
                  sandboxId: SandboxId.make(`sbx-${capturedEnvs.length}`),
                  state: 'started',
                  labels: { ...labels },
                }
              }),
            execCommand: ({ command }) =>
              command === 'git rev-parse HEAD'
                ? Effect.succeed({ exitCode: 0, output: `${headOutput}\n` })
                : hangBuild
                  ? Effect.never
                  : Effect.succeed({ exitCode: 0, output: 'BUILD SUCCESSFUL' }),
            readFileBytes: () => Effect.succeed(fileBytes),
            deleteSandbox: ({ sandboxId }) =>
              Effect.sync(() => {
                deletedIds.push(sandboxId)
              }),
            getSandbox: () => Effect.succeedNone,
            listSandboxesByLabels: () => Effect.succeed([]),
          }),
        )

        const fullLayer = Layer.mergeAll(stores.layer, sandboxLayer)

        // 1) HEAD sourceSha mismatch fails closed and still deletes sandbox
        headOutput = 'f'.repeat(40)
        const shaMismatch = yield* Effect.flip(
          buildDebugApkInIsolatedSandbox({
            attemptId: ATTEMPT_ID,
            changeRequestId: CHANGE_REQUEST_ID,
            sourceSha: SOURCE_SHA,
            packageName: PACKAGE_NAME,
            buildCommand: './gradlew :app:assembleDebug',
            apkOutputPath: 'app/build/outputs/apk/debug/app-debug.apk',
          }).pipe(Effect.provide(fullLayer)),
        )
        expect(shaMismatch._tag).toBe('SandboxExecutionError')
        expect(capturedEnvs[0]?.modelToken).toBeUndefined()
        expect(deletedIds).toEqual(['sbx-1'])

        // 2) Non-ZIP magic bytes fail closed and still deletes sandbox
        headOutput = SOURCE_SHA
        fileBytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef])
        const badZip = yield* Effect.flip(
          buildDebugApkInIsolatedSandbox({
            attemptId: ATTEMPT_ID,
            changeRequestId: CHANGE_REQUEST_ID,
            sourceSha: SOURCE_SHA,
            packageName: PACKAGE_NAME,
            buildCommand: './gradlew :app:assembleDebug',
            apkOutputPath: 'app/build/outputs/apk/debug/app-debug.apk',
          }).pipe(Effect.provide(fullLayer)),
        )
        expect(badZip._tag).toBe('SandboxExecutionError')
        expect(deletedIds).toEqual(['sbx-1', 'sbx-2'])

        // 3) Fiber interruption mid-build STILL runs uninterruptible confirmed deletion
        hangBuild = true
        const fiber = yield* Effect.forkChild(
          buildDebugApkInIsolatedSandbox({
            attemptId: ATTEMPT_ID,
            changeRequestId: CHANGE_REQUEST_ID,
            sourceSha: SOURCE_SHA,
            packageName: PACKAGE_NAME,
            buildCommand: './gradlew :app:assembleDebug',
            apkOutputPath: 'app/build/outputs/apk/debug/app-debug.apk',
          }).pipe(Effect.provide(fullLayer)),
        )
        yield* Effect.yieldNow
        yield* Fiber.interrupt(fiber)
        expect(deletedIds).toEqual(['sbx-1', 'sbx-2', 'sbx-3'])
      }),
  )

  it.effect(
    'Stage 2 enforces Effect-level TestClock timeout and marks cloud_device_runs failed instead of stranding dispatched',
    () =>
      Effect.gen(function* () {
        const stores = makeInMemoryStores()
        const hangingAdapter = Layer.succeed(
          CloudAndroidDeviceAdapter,
          CloudAndroidDeviceAdapter.of({
            providerId: PROVIDER_ID,
            executionEnvironment: 'cloud-isolated',
            dispatchApkVerification: () =>
              Effect.succeed({ runId: RUN_ID, providerId: PROVIDER_ID }),
            awaitVerificationResult: () => Effect.never,
          }),
        )

        const fiber = yield* Effect.forkChild(
          Effect.flip(
            runVerifiedApkOnCloudDevice({
              build: sampleBuild,
              apkDownloadUrl: Redacted.make(
                'https://artifacts.patchplane.dev/app-debug.apk?sig=ok',
              ),
              syntheticFixtureId: 'arbeo-synthetic-5h-v1',
              devAccountHandle: 'dev-qa-bot@arbeo.test',
              timeoutMs: 5_000,
            }).pipe(
              Effect.provide(Layer.mergeAll(stores.layer, hangingAdapter)),
            ),
          ),
        )

        yield* TestClock.adjust(Duration.millis(5_001))
        const error = yield* Fiber.join(fiber)
        expect(error._tag).toBe('CloudDeviceExecutionError')
        expect(stores.cloudRuns.get(RUN_ID)?.status).toBe('failed')
      }),
  )

  it.effect(
    'Stage 2 rejects duplicate paths, oversized payloads, and text/html MIME, never writes artifacts on rejection, and marks failed on interruption or failed journey',
    () =>
      Effect.gen(function* () {
        const runWithReport = (
          report: CloudAndroidVerificationReport,
          runId: CloudDeviceRunId,
        ) =>
          Effect.gen(function* () {
            const stores = makeInMemoryStores()
            const adapter = Layer.succeed(
              CloudAndroidDeviceAdapter,
              CloudAndroidDeviceAdapter.of({
                providerId: PROVIDER_ID,
                executionEnvironment: 'cloud-isolated',
                dispatchApkVerification: () =>
                  Effect.succeed({ runId, providerId: PROVIDER_ID }),
                awaitVerificationResult: () => Effect.succeed(report),
              }),
            )
            const exit = yield* Effect.exit(
              runVerifiedApkOnCloudDevice({
                build: sampleBuild,
                apkDownloadUrl: Redacted.make(
                  'https://artifacts.patchplane.dev/app-debug.apk?sig=ok',
                ),
                syntheticFixtureId: 'arbeo-synthetic-5h-v1',
                devAccountHandle: 'dev-qa-bot@arbeo.test',
              }).pipe(Effect.provide(Layer.mergeAll(stores.layer, adapter))),
            )
            return { exit, stores }
          })

        const validObs = {
          observedApkSha256: EXPECTED_APK_SHA,
          apkSha256Verified: true,
          cleanEmulatorBooted: true,
          importPreviewDuration: EXPECTED_ARBEO_IMPORT_DURATION,
          importConfirmedDuration: EXPECTED_ARBEO_IMPORT_DURATION,
          persistedAfterOfflineRestart: true,
          cleanupConfirmed: true,
        }

        // Duplicate relativePath
        const dupRun = CloudDeviceRunId.make('run-dup')
        const dupRes = yield* runWithReport(
          {
            runId: dupRun,
            providerId: PROVIDER_ID,
            observation: validObs,
            artifacts: [
              {
                relativePath: 'shot.png',
                contentType: 'image/png',
                bytes: new Uint8Array([1, 2, 3]),
              },
              {
                relativePath: 'shot.png',
                contentType: 'image/png',
                bytes: new Uint8Array([4, 5, 6]),
              },
            ],
          },
          dupRun,
        )
        expect(dupRes.exit._tag).toBe('Failure')
        expect(dupRes.stores.recordedArtifacts).toHaveLength(0)
        expect(dupRes.stores.cloudRuns.get(dupRun)?.status).toBe('failed')

        // Disallowed MIME (text/html)
        const htmlRun = CloudDeviceRunId.make('run-html')
        const htmlRes = yield* runWithReport(
          {
            runId: htmlRun,
            providerId: PROVIDER_ID,
            observation: validObs,
            artifacts: [
              {
                relativePath: 'xss.html',
                contentType: 'text/html',
                bytes: new TextEncoder().encode('<script>alert(1)</script>'),
              },
            ],
          },
          htmlRun,
        )
        expect(htmlRes.exit._tag).toBe('Failure')
        expect(htmlRes.stores.recordedArtifacts).toHaveLength(0)
        expect(htmlRes.stores.cloudRuns.get(htmlRun)?.status).toBe('failed')

        // Oversized artifact
        const bigRun = CloudDeviceRunId.make('run-big')
        const bigRes = yield* runWithReport(
          {
            runId: bigRun,
            providerId: PROVIDER_ID,
            observation: validObs,
            artifacts: [
              {
                relativePath: 'huge.png',
                contentType: 'image/png',
                bytes: new Uint8Array(MAX_CLOUD_DEVICE_ARTIFACT_BYTES + 1),
              },
            ],
          },
          bigRun,
        )
        expect(bigRes.exit._tag).toBe('Failure')
        expect(bigRes.stores.recordedArtifacts).toHaveLength(0)
        expect(bigRes.stores.cloudRuns.get(bigRun)?.status).toBe('failed')

        // Arbeo journey failure (`persistedAfterOfflineRestart: false`) persists
        // `status: 'failed'` AND preserves bounded diagnostic artifacts
        const failJourneyRun = CloudDeviceRunId.make('run-fail-journey')
        const failJourneyRes = yield* runWithReport(
          {
            runId: failJourneyRun,
            providerId: PROVIDER_ID,
            observation: {
              ...validObs,
              persistedAfterOfflineRestart: false,
            },
            artifacts: [
              {
                relativePath: 'logcat.txt',
                contentType: 'text/plain',
                bytes: new TextEncoder().encode('offline restart lost entry'),
              },
            ],
          },
          failJourneyRun,
        )
        expect(failJourneyRes.exit._tag).toBe('Success')
        if (failJourneyRes.exit._tag === 'Success') {
          expect(failJourneyRes.exit.value.passed).toBe(false)
          expect(failJourneyRes.exit.value.run.status).toBe('failed')
          expect(failJourneyRes.exit.value.run.artifactKeys).toEqual([
            `attempts/${ATTEMPT_ID}/android/device/${failJourneyRun}/logcat.txt`,
          ])
        }

        // Fiber interruption during Stage 2b still marks run failed
        const intStores = makeInMemoryStores()
        const intRunId = CloudDeviceRunId.make('run-interrupted')
        const intAdapter = Layer.succeed(
          CloudAndroidDeviceAdapter,
          CloudAndroidDeviceAdapter.of({
            providerId: PROVIDER_ID,
            executionEnvironment: 'cloud-isolated',
            dispatchApkVerification: () =>
              Effect.succeed({ runId: intRunId, providerId: PROVIDER_ID }),
            awaitVerificationResult: () => Effect.never,
          }),
        )
        const intFiber = yield* Effect.forkChild(
          awaitAndRecordCloudDeviceResult({
            build: sampleBuild,
            dispatch: { runId: intRunId, providerId: PROVIDER_ID },
          }).pipe(Effect.provide(Layer.mergeAll(intStores.layer, intAdapter))),
        )
        yield* Effect.yieldNow
        yield* Fiber.interrupt(intFiber)
        expect(intStores.cloudRuns.get(intRunId)?.status).toBe('failed')
      }),
  )
})
