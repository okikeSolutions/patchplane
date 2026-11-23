import { Effect, Schema } from 'effect'
import * as Digest from 'effect/crypto/Digest'
import type * as Redacted from 'effect/Redacted'
import { Activity, Workflow } from 'effect/workflow'
import {
  AndroidApkBuildRecord,
  AndroidPackageName,
  ApkIntegrityError,
  ArbeoJourneyObservation,
  ArtifactIntegrityError,
  ArtifactKey,
  ArtifactStorageError,
  ChangeRequestId,
  CloudDeviceExecutionError,
  CloudDevicePolicyError,
  CloudDeviceRunRecord,
  GitCommitSha,
  PersistenceError,
  SandboxCleanupError,
  SandboxCredentialPolicyError,
  SandboxExecutionError,
  sanitizeErrorMessage,
  Sha256Hex,
  VerificationAttemptId,
} from '@patchplane/domain'
import {
  assertCloudOnlyProvider,
  assertDedicatedDevAccountAndSyntheticFixture,
  assertSafeApkOutputPath,
  assertValidArbeoObservation,
  DEFAULT_CLOUD_DEVICE_TIMEOUT_MS,
  MAX_ANDROID_APK_BYTES,
  MAX_CLOUD_DEVICE_ARTIFACT_BYTES,
  MAX_CLOUD_DEVICE_ARTIFACT_COUNT,
  MAX_CLOUD_DEVICE_TIMEOUT_MS,
  MAX_CLOUD_DEVICE_TOTAL_ARTIFACT_BYTES,
} from '../services/android-verification-policy'
import { AndroidVerificationStore } from '../services/android-verification-store'
import { ApkDownloadUrlIssuer } from '../services/apk-download-url-issuer'
import { ArtifactStore } from '../services/artifact-store'
import { CloudAndroidDeviceAdapter } from '../services/cloud-device-adapter'
import { ModelCredentialIssuer } from '../services/model-credential-issuer'
import {
  buildAttemptSandboxLabels,
  buildValidatedSandboxEnv,
  type ShortLivedAttemptModelCredential,
} from '../services/sandbox-credential-policy'
import { SandboxLifecycleStore } from '../services/sandbox-lifecycle-store'
import { SandboxProvider } from '../services/sandbox-provider'
import {
  type CleanupPolicyOptions,
  confirmSandboxDeletion,
  DEFAULT_COMMAND_TIMEOUT_MS,
  MAX_CLEANUP_POLL_INTERVAL_MS,
  MAX_CLEANUP_TIMEOUT_MS,
  MAX_COMMAND_TIMEOUT_MS,
  MIN_CLEANUP_POLL_INTERVAL_MS,
} from './sandbox-verification-workflow'

const normalizeBound = (
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number => {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

export const Stage1ApkBuildResult = Schema.Struct({
  build: AndroidApkBuildRecord,
  cleanupConfirmed: Schema.Literal(true),
})
export interface Stage1ApkBuildResult extends Schema.Schema.Type<
  typeof Stage1ApkBuildResult
> {}

export const Stage2CloudDeviceResult = Schema.Struct({
  run: CloudDeviceRunRecord,
  observation: ArbeoJourneyObservation,
  passed: Schema.Boolean,
  failures: Schema.Array(Schema.String),
})
export interface Stage2CloudDeviceResult extends Schema.Schema.Type<
  typeof Stage2CloudDeviceResult
> {}

export const CloudAndroidVerificationResult = Schema.Struct({
  stage1: Stage1ApkBuildResult,
  stage2: Stage2CloudDeviceResult,
})
export interface CloudAndroidVerificationResult extends Schema.Schema.Type<
  typeof CloudAndroidVerificationResult
> {}

/**
 * Stage 1: Compiles untrusted Arbeo PR code inside an isolated Linux sandbox
 * (never on any developer laptop), hashes the debug APK via SHA-256, stores and
 * readback-verifies the APK in R2, records `(sourceSha, apkSha256)` in Postgres,
 * and ALWAYS runs confirmed sandbox deletion via `Effect.uninterruptibleMask`.
 */
export const buildDebugApkInIsolatedSandbox = Effect.fn(
  'CloudAndroidVerification.stage1BuildApk',
)(function* (input: {
  readonly attemptId: VerificationAttemptId
  readonly changeRequestId: ChangeRequestId
  readonly sourceSha: GitCommitSha
  readonly packageName: AndroidPackageName
  readonly buildCommand: string
  readonly apkOutputPath: string
  readonly buildTimeoutMs?: number
  readonly modelCredential: ShortLivedAttemptModelCredential
  readonly extraEnv?: Readonly<Record<string, string | Redacted.Redacted>>
  readonly cleanup?: CleanupPolicyOptions
}) {
  const provider = yield* SandboxProvider
  const artifactStore = yield* ArtifactStore
  const lifecycleStore = yield* SandboxLifecycleStore
  const androidStore = yield* AndroidVerificationStore
  const digest = yield* Digest.Digest

  // 1. Validate credential isolation and output path BEFORE creating a sandbox
  const validatedEnv = yield* buildValidatedSandboxEnv({
    attemptId: input.attemptId,
    modelCredential: input.modelCredential,
    ...(input.extraEnv !== undefined ? { extraEnv: input.extraEnv } : {}),
  })
  const safeApkPath = yield* assertSafeApkOutputPath(input.apkOutputPath)

  const buildTimeoutMs = normalizeBound(
    input.buildTimeoutMs,
    DEFAULT_COMMAND_TIMEOUT_MS,
    1_000,
    MAX_COMMAND_TIMEOUT_MS,
  )
  const labels = buildAttemptSandboxLabels({
    attemptId: input.attemptId,
    changeRequestId: input.changeRequestId,
    purpose: 'android-apk-build',
  })
  const apkArtifactKey = ArtifactKey.make(
    `attempts/${input.attemptId}/android/app-debug.apk`,
  )

  // 2. Acquire sandbox uninterruptibly; any build, hash, R2, DB, or interrupt
  //    failure still runs confirmed deletion.
  return yield* Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      const created = yield* provider.createSandbox({
        attemptId: input.attemptId,
        changeRequestId: input.changeRequestId,
        labels,
        env: validatedEnv,
        autoDeleteIntervalMinutes: 30,
      })

      const workExit = yield* Effect.exit(
        restore(
          Effect.gen(function* () {
            yield* lifecycleStore.recordSandboxCreated({
              sandboxId: created.sandboxId,
              attemptId: input.attemptId,
              changeRequestId: input.changeRequestId,
              labels,
            })

            const execResult = yield* provider.execCommand({
              sandboxId: created.sandboxId,
              command: input.buildCommand,
              timeoutMs: buildTimeoutMs,
            })
            if (execResult.exitCode !== 0) {
              return yield* new SandboxExecutionError({
                operation: 'CloudAndroidVerification.stage1BuildApk',
                message: `Isolated debug APK build exited with code ${execResult.exitCode}`,
                sandboxId: created.sandboxId,
              })
            }

            const apkBytes = yield* provider.readFileBytes({
              sandboxId: created.sandboxId,
              path: safeApkPath,
              maxBytes: MAX_ANDROID_APK_BYTES,
            })
            if (apkBytes.byteLength === 0) {
              return yield* new SandboxExecutionError({
                operation: 'CloudAndroidVerification.stage1BuildApk',
                message: 'Built debug APK is empty (0 bytes)',
                sandboxId: created.sandboxId,
              })
            }

            const rawSha256 = yield* digest.digestHex(Digest.sha256, apkBytes)
            const apkSha256 = yield* Schema.decodeEffect(Sha256Hex)(
              rawSha256,
            ).pipe(
              Effect.mapError(
                (cause) =>
                  new SandboxExecutionError({
                    operation: 'CloudAndroidVerification.hashApk',
                    message: sanitizeErrorMessage(cause),
                    sandboxId: created.sandboxId,
                  }),
              ),
            )

            const storedArtifact = yield* artifactStore.putVerifiedArtifact({
              attemptId: input.attemptId,
              artifactKey: apkArtifactKey,
              body: apkBytes,
              contentType: 'application/vnd.android.package-archive',
              expectedSha256: apkSha256,
            })
            yield* lifecycleStore.recordArtifactMetadata(storedArtifact)

            const build = yield* androidStore.recordApkBuild({
              attemptId: input.attemptId,
              changeRequestId: input.changeRequestId,
              sourceSha: input.sourceSha,
              apkArtifactKey: storedArtifact.artifactKey,
              apkSha256: storedArtifact.sha256,
              apkByteLength: storedArtifact.byteLength,
              buildSandboxId: created.sandboxId,
              packageName: input.packageName,
            })

            return build
          }),
        ),
      )

      yield* confirmSandboxDeletion({
        sandboxId: created.sandboxId,
        attemptId: input.attemptId,
        changeRequestId: input.changeRequestId,
        labels,
        ...(input.cleanup !== undefined ? { options: input.cleanup } : {}),
      })

      const build = yield* workExit
      return {
        build,
        cleanupConfirmed: true,
      } satisfies Stage1ApkBuildResult
    }),
  )
})

/**
 * Stage 2: Dispatches ONLY the verified Stage 1 APK (never PR source or Gradle
 * scripts) through the provider-neutral `CloudAndroidDeviceAdapter`, verifies
 * pre-install APK SHA-256 and Arbeo offline journey invariants (`+05:00` at
 * preview and confirmation + offline restart persistence + `/dev/kvm` + cleanup),
 * and stores bounded Stage 2 diagnostic artifacts to R2 and Postgres.
 */
export const runVerifiedApkOnCloudDevice = Effect.fn(
  'CloudAndroidVerification.stage2RunOnCloudDevice',
)(function* (input: {
  readonly build: AndroidApkBuildRecord
  readonly apkDownloadUrl: Redacted.Redacted
  readonly syntheticFixtureId: string
  readonly devAccountHandle: string
  readonly timeoutMs?: number
}) {
  const adapter = yield* CloudAndroidDeviceAdapter
  const artifactStore = yield* ArtifactStore
  const lifecycleStore = yield* SandboxLifecycleStore
  const androidStore = yield* AndroidVerificationStore
  const digest = yield* Digest.Digest

  // 1. Enforce cloud-only policy, dedicated dev account, synthetic fixture,
  //    and non-SSRF HTTPS signed URL before any external dispatch.
  yield* assertCloudOnlyProvider({
    providerId: adapter.providerId,
    executionEnvironment: adapter.executionEnvironment,
  })
  const validatedAccount = yield* assertDedicatedDevAccountAndSyntheticFixture({
    devAccountHandle: input.devAccountHandle,
    syntheticFixtureId: input.syntheticFixtureId,
    apkDownloadUrl: input.apkDownloadUrl,
  })

  // Confirm Stage 1 APK is still intact in R2 before dispatching Stage 2.
  yield* artifactStore.getVerifiedArtifact({
    artifactKey: input.build.apkArtifactKey,
    expectedSha256: input.build.apkSha256,
  })

  const timeoutMs = normalizeBound(
    input.timeoutMs,
    DEFAULT_CLOUD_DEVICE_TIMEOUT_MS,
    1_000,
    MAX_CLOUD_DEVICE_TIMEOUT_MS,
  )

  // 2. Dispatch ONLY the verified APK & metadata to the cloud device adapter.
  const dispatched = yield* adapter.dispatchApkVerification({
    attemptId: input.build.attemptId,
    changeRequestId: input.build.changeRequestId,
    sourceSha: input.build.sourceSha,
    apkArtifactKey: input.build.apkArtifactKey,
    expectedApkSha256: input.build.apkSha256,
    apkDownloadUrl: input.apkDownloadUrl,
    packageName: input.build.packageName,
    syntheticFixtureId: validatedAccount.syntheticFixtureId,
    devAccountHandle: validatedAccount.devAccountHandle,
    timeoutMs,
  })

  yield* androidStore.recordCloudDeviceRun({
    runId: dispatched.runId,
    attemptId: input.build.attemptId,
    changeRequestId: input.build.changeRequestId,
    providerId: dispatched.providerId,
    sourceSha: input.build.sourceSha,
    apkArtifactKey: input.build.apkArtifactKey,
    apkSha256: input.build.apkSha256,
    status: 'dispatched',
    artifactKeys: [],
  })

  // 3. Await cloud device report, verify APK SHA-256 & Arbeo journey assertions,
  //    and persist bounded diagnostic artifacts to R2/Postgres.
  const report = yield* adapter
    .awaitVerificationResult({
      runId: dispatched.runId,
      expectedApkSha256: input.build.apkSha256,
      timeoutMs,
    })
    .pipe(
      Effect.tapError(() =>
        androidStore
          .recordCloudDeviceRun({
            runId: dispatched.runId,
            attemptId: input.build.attemptId,
            changeRequestId: input.build.changeRequestId,
            providerId: dispatched.providerId,
            sourceSha: input.build.sourceSha,
            apkArtifactKey: input.build.apkArtifactKey,
            apkSha256: input.build.apkSha256,
            status: 'failed',
            artifactKeys: [],
          })
          .pipe(Effect.catch(() => Effect.void)),
      ),
    )

  if (report.artifacts.length > MAX_CLOUD_DEVICE_ARTIFACT_COUNT) {
    return yield* new CloudDeviceExecutionError({
      operation: 'CloudAndroidVerification.boundArtifacts',
      providerId: dispatched.providerId,
      runId: dispatched.runId,
      message: `Cloud device returned ${report.artifacts.length} artifacts (max ${MAX_CLOUD_DEVICE_ARTIFACT_COUNT})`,
    })
  }

  let totalArtifactBytes = 0
  const persistedArtifactKeys: Array<ArtifactKey> = []

  for (const artifact of report.artifacts) {
    if (artifact.bytes.byteLength > MAX_CLOUD_DEVICE_ARTIFACT_BYTES) {
      return yield* new CloudDeviceExecutionError({
        operation: 'CloudAndroidVerification.boundArtifacts',
        providerId: dispatched.providerId,
        runId: dispatched.runId,
        message: `Stage 2 artifact "${artifact.relativePath}" (${artifact.bytes.byteLength} bytes) exceeds limit (${MAX_CLOUD_DEVICE_ARTIFACT_BYTES} bytes)`,
      })
    }
    totalArtifactBytes += artifact.bytes.byteLength
    if (totalArtifactBytes > MAX_CLOUD_DEVICE_TOTAL_ARTIFACT_BYTES) {
      return yield* new CloudDeviceExecutionError({
        operation: 'CloudAndroidVerification.boundArtifacts',
        providerId: dispatched.providerId,
        runId: dispatched.runId,
        message: `Total Stage 2 artifacts (${totalArtifactBytes} bytes) exceed limit (${MAX_CLOUD_DEVICE_TOTAL_ARTIFACT_BYTES} bytes)`,
      })
    }

    const artifactKey = yield* Schema.decodeEffect(ArtifactKey)(
      `attempts/${input.build.attemptId}/android/device/${artifact.relativePath}`,
    ).pipe(
      Effect.mapError(
        (cause) =>
          new CloudDeviceExecutionError({
            operation: 'CloudAndroidVerification.validateArtifactKey',
            providerId: dispatched.providerId,
            runId: dispatched.runId,
            message: sanitizeErrorMessage(cause),
          }),
      ),
    )

    const rawSha = yield* digest.digestHex(Digest.sha256, artifact.bytes)
    const sha256 = yield* Schema.decodeEffect(Sha256Hex)(rawSha).pipe(
      Effect.mapError(
        (cause) =>
          new CloudDeviceExecutionError({
            operation: 'CloudAndroidVerification.hashDeviceArtifact',
            providerId: dispatched.providerId,
            runId: dispatched.runId,
            message: sanitizeErrorMessage(cause),
          }),
      ),
    )

    const stored = yield* artifactStore.putVerifiedArtifact({
      attemptId: input.build.attemptId,
      artifactKey,
      body: artifact.bytes,
      contentType: artifact.contentType,
      expectedSha256: sha256,
    })
    yield* lifecycleStore.recordArtifactMetadata(stored)
    persistedArtifactKeys.push(stored.artifactKey)
  }

  const evaluation = yield* assertValidArbeoObservation({
    expectedApkSha256: input.build.apkSha256,
    observation: report.observation,
  }).pipe(
    Effect.tapError(() =>
      androidStore
        .recordCloudDeviceRun({
          runId: dispatched.runId,
          attemptId: input.build.attemptId,
          changeRequestId: input.build.changeRequestId,
          providerId: dispatched.providerId,
          sourceSha: input.build.sourceSha,
          apkArtifactKey: input.build.apkArtifactKey,
          apkSha256: input.build.apkSha256,
          status: 'failed',
          observation: report.observation,
          artifactKeys: persistedArtifactKeys,
        })
        .pipe(Effect.catch(() => Effect.void)),
    ),
  )

  const finalRun = yield* androidStore.recordCloudDeviceRun({
    runId: dispatched.runId,
    attemptId: input.build.attemptId,
    changeRequestId: input.build.changeRequestId,
    providerId: dispatched.providerId,
    sourceSha: input.build.sourceSha,
    apkArtifactKey: input.build.apkArtifactKey,
    apkSha256: input.build.apkSha256,
    status: evaluation.passed ? 'passed' : 'failed',
    observation: report.observation,
    artifactKeys: persistedArtifactKeys,
  })

  return {
    run: finalRun,
    observation: report.observation,
    passed: evaluation.passed,
    failures: evaluation.failures,
  } satisfies Stage2CloudDeviceResult
})

export const CloudAndroidVerificationWorkflowPayload = Schema.Struct({
  attemptId: VerificationAttemptId,
  changeRequestId: ChangeRequestId,
  sourceSha: GitCommitSha,
  packageName: AndroidPackageName,
  buildCommand: Schema.NonEmptyString,
  apkOutputPath: Schema.NonEmptyString,
  syntheticFixtureId: Schema.NonEmptyString,
  devAccountHandle: Schema.NonEmptyString,
  buildTimeoutMs: Schema.optionalKey(
    Schema.Number.check(
      Schema.isInt(),
      Schema.isGreaterThanOrEqualTo(1_000),
      Schema.isLessThanOrEqualTo(MAX_COMMAND_TIMEOUT_MS),
    ),
  ),
  deviceTimeoutMs: Schema.optionalKey(
    Schema.Number.check(
      Schema.isInt(),
      Schema.isGreaterThanOrEqualTo(1_000),
      Schema.isLessThanOrEqualTo(MAX_CLOUD_DEVICE_TIMEOUT_MS),
    ),
  ),
  cleanupTimeoutMs: Schema.optionalKey(
    Schema.Number.check(
      Schema.isInt(),
      Schema.isGreaterThanOrEqualTo(100),
      Schema.isLessThanOrEqualTo(MAX_CLEANUP_TIMEOUT_MS),
    ),
  ),
  cleanupPollIntervalMs: Schema.optionalKey(
    Schema.Number.check(
      Schema.isInt(),
      Schema.isGreaterThanOrEqualTo(MIN_CLEANUP_POLL_INTERVAL_MS),
      Schema.isLessThanOrEqualTo(MAX_CLEANUP_POLL_INTERVAL_MS),
    ),
  ),
})
export interface CloudAndroidVerificationWorkflowPayload extends Schema.Schema.Type<
  typeof CloudAndroidVerificationWorkflowPayload
> {}

export const CloudAndroidVerificationWorkflowError = Schema.Union([
  SandboxCredentialPolicyError,
  SandboxExecutionError,
  SandboxCleanupError,
  ArtifactStorageError,
  ArtifactIntegrityError,
  CloudDevicePolicyError,
  CloudDeviceExecutionError,
  ApkIntegrityError,
  PersistenceError,
])

export const CloudAndroidVerificationWorkflow = Workflow.make(
  'CloudAndroidVerificationWorkflow',
  {
    payload: CloudAndroidVerificationWorkflowPayload,
    success: CloudAndroidVerificationResult,
    error: CloudAndroidVerificationWorkflowError,
    idempotencyKey: ({ attemptId }) => `cloud-android:${attemptId}`,
  },
)

export const CloudAndroidVerificationWorkflowLayer =
  CloudAndroidVerificationWorkflow.toLayer(
    Effect.fn('CloudAndroidVerificationWorkflow.execute')(function* (payload) {
      const stage1 = yield* Activity.make({
        name: 'stage-1-build-debug-apk',
        success: Stage1ApkBuildResult,
        error: CloudAndroidVerificationWorkflowError,
        execute: Effect.gen(function* () {
          const issuer = yield* ModelCredentialIssuer
          const modelCredential = yield* issuer.issueAttemptCredential(
            payload.attemptId,
          )
          return yield* buildDebugApkInIsolatedSandbox({
            attemptId: payload.attemptId,
            changeRequestId: payload.changeRequestId,
            sourceSha: payload.sourceSha,
            packageName: payload.packageName,
            buildCommand: payload.buildCommand,
            apkOutputPath: payload.apkOutputPath,
            ...(payload.buildTimeoutMs !== undefined
              ? { buildTimeoutMs: payload.buildTimeoutMs }
              : {}),
            modelCredential,
            cleanup: {
              ...(payload.cleanupTimeoutMs !== undefined
                ? { cleanupTimeoutMs: payload.cleanupTimeoutMs }
                : {}),
              ...(payload.cleanupPollIntervalMs !== undefined
                ? { cleanupPollIntervalMs: payload.cleanupPollIntervalMs }
                : {}),
            },
          })
        }),
      })

      const stage2 = yield* Activity.make({
        name: 'stage-2-cloud-device-verify',
        success: Stage2CloudDeviceResult,
        error: CloudAndroidVerificationWorkflowError,
        execute: Effect.gen(function* () {
          const urlIssuer = yield* ApkDownloadUrlIssuer
          const apkDownloadUrl = yield* urlIssuer.issueSignedApkUrl({
            attemptId: stage1.build.attemptId,
            artifactKey: stage1.build.apkArtifactKey,
            expectedSha256: stage1.build.apkSha256,
          })
          return yield* runVerifiedApkOnCloudDevice({
            build: stage1.build,
            apkDownloadUrl,
            syntheticFixtureId: payload.syntheticFixtureId,
            devAccountHandle: payload.devAccountHandle,
            ...(payload.deviceTimeoutMs !== undefined
              ? { timeoutMs: payload.deviceTimeoutMs }
              : {}),
          })
        }),
      })

      return {
        stage1,
        stage2,
      } satisfies CloudAndroidVerificationResult
    }),
  )
