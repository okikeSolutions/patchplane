import { Duration, Effect, Exit, Option, Schema } from 'effect'
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
  CloudDeviceProviderId,
  CloudDeviceRunId,
  CloudDeviceRunRecord,
  GitCommitSha,
  PersistenceError,
  SafeContentType,
  SandboxCleanupError,
  SandboxCredentialPolicyError,
  SandboxExecutionError,
  sanitizeErrorMessage,
  Sha256Hex,
  VerificationAttemptId,
} from '@patchplane/domain'
import {
  assertAllowedStage2ContentType,
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
import {
  buildAttemptSandboxLabels,
  buildBuildOnlySandboxEnv,
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
  normalizePositiveBound,
} from './sandbox-verification-workflow'

const SANDBOX_CREATE_TIMEOUT_MS = 5 * 60 * 1000
const APK_READ_TIMEOUT_MS = 2 * 60 * 1000
const SOURCE_SHA_CHECK_TIMEOUT_MS = 30 * 1000

const hasZipMagicHeader = (bytes: Uint8Array): boolean =>
  bytes.byteLength >= 4 &&
  bytes[0] === 0x50 &&
  bytes[1] === 0x4b &&
  bytes[2] === 0x03 &&
  bytes[3] === 0x04

export const Stage1ApkBuildResult = Schema.Struct({
  build: AndroidApkBuildRecord,
  cleanupConfirmed: Schema.Literal(true),
})
export interface Stage1ApkBuildResult extends Schema.Schema.Type<
  typeof Stage1ApkBuildResult
> {}

export const Stage2DispatchReceipt = Schema.Struct({
  runId: CloudDeviceRunId,
  providerId: CloudDeviceProviderId,
})
export interface Stage2DispatchReceipt extends Schema.Schema.Type<
  typeof Stage2DispatchReceipt
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
 * with ZERO model credentials or control-plane secrets (never on any developer
 * laptop), verifies `git rev-parse HEAD === sourceSha` and ZIP/APK magic bytes,
 * hashes the debug APK via SHA-256, stores and readback-verifies the APK in R2,
 * records `(sourceSha, apkSha256)` in Postgres, and ALWAYS runs confirmed
 * sandbox deletion via `Effect.uninterruptibleMask`.
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
  readonly extraEnv?: Readonly<Record<string, string | Redacted.Redacted>>
  readonly cleanup?: CleanupPolicyOptions
}) {
  yield* Effect.annotateCurrentSpan({
    attemptId: input.attemptId,
    changeRequestId: input.changeRequestId,
    sourceSha: input.sourceSha,
  })

  const provider = yield* SandboxProvider
  const artifactStore = yield* ArtifactStore
  const lifecycleStore = yield* SandboxLifecycleStore
  const androidStore = yield* AndroidVerificationStore
  const digest = yield* Digest.Digest

  // 1. Validate zero-credential build env and safe relative APK path BEFORE
  //    provisioning any sandbox.
  const validatedEnv = yield* buildBuildOnlySandboxEnv({
    attemptId: input.attemptId,
    ...(input.extraEnv !== undefined ? { extraEnv: input.extraEnv } : {}),
  })
  const safeApkPath = yield* assertSafeApkOutputPath(input.apkOutputPath)

  // Idempotent activity replay guard: if Stage 1 already committed an identical
  // build for this attempt and its R2 object still verifies, reuse it without
  // rebuilding or overwriting R2 with a non-deterministic Gradle APK.
  const existingBuild = yield* androidStore.findApkBuildByAttempt(
    input.attemptId,
  )
  if (Option.isSome(existingBuild)) {
    const prev = existingBuild.value
    if (
      prev.changeRequestId !== input.changeRequestId ||
      prev.sourceSha !== input.sourceSha ||
      prev.packageName !== input.packageName
    ) {
      return yield* new PersistenceError({
        operation: 'CloudAndroidVerification.stage1BuildApk',
        message: `Conflicting existing APK build for attempt "${input.attemptId}"`,
      })
    }
    yield* artifactStore.getVerifiedArtifact({
      artifactKey: prev.apkArtifactKey,
      expectedSha256: prev.apkSha256,
    })
    return {
      build: prev,
      cleanupConfirmed: true,
    } satisfies Stage1ApkBuildResult
  }

  const buildTimeoutMs = normalizePositiveBound(
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

  // 2. Acquire sandbox with bounded timeout; any build, hash, R2, DB, or
  //    interruption failure still runs confirmed deletion.
  return yield* Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      const created = yield* provider
        .createSandbox({
          attemptId: input.attemptId,
          changeRequestId: input.changeRequestId,
          labels,
          env: validatedEnv,
          autoDeleteIntervalMinutes: 30,
        })
        .pipe(
          Effect.timeoutOrElse({
            duration: Duration.millis(SANDBOX_CREATE_TIMEOUT_MS),
            orElse: () =>
              Effect.fail(
                new SandboxExecutionError({
                  operation: 'CloudAndroidVerification.createSandbox',
                  message: `Timed out creating Stage 1 build sandbox after ${SANDBOX_CREATE_TIMEOUT_MS}ms`,
                }),
              ),
          }),
        )

      const workExit = yield* Effect.exit(
        restore(
          Effect.gen(function* () {
            yield* lifecycleStore.recordSandboxCreated({
              sandboxId: created.sandboxId,
              attemptId: input.attemptId,
              changeRequestId: input.changeRequestId,
              labels,
            })

            const headCheck = yield* provider.execCommand({
              sandboxId: created.sandboxId,
              command: 'git rev-parse HEAD',
              timeoutMs: SOURCE_SHA_CHECK_TIMEOUT_MS,
            })
            const observedHead = headCheck.output.trim().toLowerCase()
            if (headCheck.exitCode !== 0 || observedHead !== input.sourceSha) {
              return yield* new SandboxExecutionError({
                operation: 'CloudAndroidVerification.verifySourceSha',
                message: `Sandbox HEAD (${observedHead || '<empty>'}) did not match expected sourceSha ${input.sourceSha}`,
                sandboxId: created.sandboxId,
              })
            }

            const execResult = yield* provider.execCommand({
              sandboxId: created.sandboxId,
              command: input.buildCommand,
              timeoutMs: buildTimeoutMs,
            })
            if (execResult.exitCode !== 0) {
              const excerpt = sanitizeErrorMessage(
                execResult.output.slice(-512),
              )
              yield* Effect.logWarning(
                'Stage 1 isolated APK build exited non-zero',
                {
                  attemptId: input.attemptId,
                  sandboxId: created.sandboxId,
                  exitCode: execResult.exitCode,
                  outputExcerpt: excerpt,
                },
              )
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
              timeoutMs: APK_READ_TIMEOUT_MS,
            })
            if (apkBytes.byteLength === 0) {
              return yield* new SandboxExecutionError({
                operation: 'CloudAndroidVerification.stage1BuildApk',
                message: 'Built debug APK is empty (0 bytes)',
                sandboxId: created.sandboxId,
              })
            }
            if (!hasZipMagicHeader(apkBytes)) {
              return yield* new SandboxExecutionError({
                operation: 'CloudAndroidVerification.validateApkFormat',
                message:
                  'File at apkOutputPath is not a valid ZIP/APK archive (missing PK\\x03\\x04 header)',
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

            return yield* androidStore.recordApkBuild({
              attemptId: input.attemptId,
              changeRequestId: input.changeRequestId,
              sourceSha: input.sourceSha,
              apkArtifactKey: storedArtifact.artifactKey,
              apkSha256: storedArtifact.sha256,
              apkByteLength: storedArtifact.byteLength,
              buildSandboxId: created.sandboxId,
              packageName: input.packageName,
            })
          }),
        ),
      )

      const cleanupExit = yield* Effect.exit(
        confirmSandboxDeletion({
          sandboxId: created.sandboxId,
          attemptId: input.attemptId,
          changeRequestId: input.changeRequestId,
          labels,
          ...(input.cleanup !== undefined ? { options: input.cleanup } : {}),
        }),
      )
      if (Exit.isFailure(cleanupExit)) {
        if (Exit.isFailure(workExit)) {
          yield* Effect.logError(
            'Stage 1 work failed before cleanup failure; preserving root cause in logs',
            {
              attemptId: input.attemptId,
              sandboxId: created.sandboxId,
              workFailure: sanitizeErrorMessage(workExit.cause),
            },
          )
        }
        return yield* Effect.failCause(cleanupExit.cause)
      }

      const build = yield* workExit
      return {
        build,
        cleanupConfirmed: true,
      } satisfies Stage1ApkBuildResult
    }),
  )
})

/**
 * Stage 2a: Validates cloud-only policy, verifies the Stage 1 APK in R2,
 * dispatches ONLY the verified APK digest + short-lived signed URL to the
 * provider-neutral `CloudAndroidDeviceAdapter`, and records `'dispatched'`.
 */
export const dispatchVerifiedApkToCloudDevice = Effect.fn(
  'CloudAndroidVerification.stage2aDispatch',
)(function* (input: {
  readonly build: AndroidApkBuildRecord
  readonly apkDownloadUrl: Redacted.Redacted
  readonly syntheticFixtureId: string
  readonly devAccountHandle: string
  readonly timeoutMs?: number
}) {
  yield* Effect.annotateCurrentSpan({
    attemptId: input.build.attemptId,
    changeRequestId: input.build.changeRequestId,
    sourceSha: input.build.sourceSha,
  })

  const adapter = yield* CloudAndroidDeviceAdapter
  const artifactStore = yield* ArtifactStore
  const androidStore = yield* AndroidVerificationStore

  yield* assertCloudOnlyProvider({
    providerId: adapter.providerId,
    executionEnvironment: adapter.executionEnvironment,
  })
  const validatedAccount = yield* assertDedicatedDevAccountAndSyntheticFixture({
    devAccountHandle: input.devAccountHandle,
    syntheticFixtureId: input.syntheticFixtureId,
    apkDownloadUrl: input.apkDownloadUrl,
  })

  // Confirm Stage 1 APK is intact in R2 before dispatching Stage 2.
  yield* artifactStore.getVerifiedArtifact({
    artifactKey: input.build.apkArtifactKey,
    expectedSha256: input.build.apkSha256,
  })

  const timeoutMs = normalizePositiveBound(
    input.timeoutMs,
    DEFAULT_CLOUD_DEVICE_TIMEOUT_MS,
    1_000,
    MAX_CLOUD_DEVICE_TIMEOUT_MS,
  )

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

  if (dispatched.providerId !== adapter.providerId) {
    return yield* new CloudDeviceExecutionError({
      operation: 'CloudAndroidVerification.verifyProviderId',
      providerId: adapter.providerId,
      runId: dispatched.runId,
      message: `Dispatched providerId "${dispatched.providerId}" did not match adapter "${adapter.providerId}"`,
    })
  }

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

  return {
    runId: dispatched.runId,
    providerId: dispatched.providerId,
  } satisfies Stage2DispatchReceipt
})

/**
 * Stage 2b: Awaits a previously dispatched cloud device run with a strict
 * Effect-level timeout, verifies APK SHA-256 integrity BEFORE storing artifacts,
 * pre-validates all bounded Stage 2 diagnostic artifacts (count, deduplication,
 * MIME allowlist, size limits), persists them to R2 + Postgres, and guarantees
 * the `cloud_device_runs` row transitions out of `'dispatched'` even on error
 * or fiber interruption.
 */
export const awaitAndRecordCloudDeviceResult = Effect.fn(
  'CloudAndroidVerification.stage2bAwaitAndRecord',
)(function* (input: {
  readonly build: AndroidApkBuildRecord
  readonly dispatch: Stage2DispatchReceipt
  readonly timeoutMs?: number
}) {
  yield* Effect.annotateCurrentSpan({
    attemptId: input.build.attemptId,
    changeRequestId: input.build.changeRequestId,
    runId: input.dispatch.runId,
  })

  const adapter = yield* CloudAndroidDeviceAdapter
  const artifactStore = yield* ArtifactStore
  const lifecycleStore = yield* SandboxLifecycleStore
  const androidStore = yield* AndroidVerificationStore
  const digest = yield* Digest.Digest

  const timeoutMs = normalizePositiveBound(
    input.timeoutMs,
    DEFAULT_CLOUD_DEVICE_TIMEOUT_MS,
    1_000,
    MAX_CLOUD_DEVICE_TIMEOUT_MS,
  )

  let terminalRecorded = false

  const markRunFailedOnAbnormalExit = (
    observation?: ArbeoJourneyObservation,
    artifactKeys: ReadonlyArray<ArtifactKey> = [],
  ) =>
    Effect.uninterruptible(
      androidStore
        .recordCloudDeviceRun({
          runId: input.dispatch.runId,
          attemptId: input.build.attemptId,
          changeRequestId: input.build.changeRequestId,
          providerId: input.dispatch.providerId,
          sourceSha: input.build.sourceSha,
          apkArtifactKey: input.build.apkArtifactKey,
          apkSha256: input.build.apkSha256,
          status: 'failed',
          ...(observation !== undefined ? { observation } : {}),
          artifactKeys,
        })
        .pipe(
          Effect.asVoid,
          Effect.catchTag('PersistenceError', (persistError) =>
            Effect.logError('Failed to mark cloud device run failed', {
              runId: input.dispatch.runId,
              attemptId: input.build.attemptId,
              message: persistError.message,
            }),
          ),
        ),
    )

  return yield* Effect.gen(function* () {
    const report = yield* adapter
      .awaitVerificationResult({
        runId: input.dispatch.runId,
        expectedApkSha256: input.build.apkSha256,
        timeoutMs,
      })
      .pipe(
        Effect.timeoutOrElse({
          duration: Duration.millis(timeoutMs),
          orElse: () =>
            Effect.fail(
              new CloudDeviceExecutionError({
                operation: 'CloudAndroidVerification.awaitVerificationResult',
                providerId: input.dispatch.providerId,
                runId: input.dispatch.runId,
                message: `Cloud device verification timed out after ${timeoutMs}ms`,
              }),
            ),
        }),
      )

    if (
      report.runId !== input.dispatch.runId ||
      report.providerId !== input.dispatch.providerId
    ) {
      return yield* new CloudDeviceExecutionError({
        operation: 'CloudAndroidVerification.verifyReportIdentity',
        providerId: input.dispatch.providerId,
        runId: input.dispatch.runId,
        message: `Report identity (${report.providerId}/${report.runId}) did not match dispatched run (${input.dispatch.providerId}/${input.dispatch.runId})`,
      })
    }

    // 1. Verify APK SHA-256 & Arbeo journey assertions BEFORE persisting
    //    Stage 2 artifacts so tampered runs never write to R2/Postgres.
    const evaluation = yield* assertValidArbeoObservation({
      expectedApkSha256: input.build.apkSha256,
      observation: report.observation,
    })

    // 2. Pre-validate ALL Stage 2 artifacts before any R2 or Postgres writes.
    if (report.artifacts.length > MAX_CLOUD_DEVICE_ARTIFACT_COUNT) {
      return yield* new CloudDeviceExecutionError({
        operation: 'CloudAndroidVerification.boundArtifacts',
        providerId: input.dispatch.providerId,
        runId: input.dispatch.runId,
        message: `Cloud device returned ${report.artifacts.length} artifacts (max ${MAX_CLOUD_DEVICE_ARTIFACT_COUNT})`,
      })
    }

    const seenPaths = new Set<string>()
    let totalArtifactBytes = 0
    const validatedArtifacts: Array<{
      readonly artifactKey: ArtifactKey
      readonly contentType: string
      readonly bytes: Uint8Array
      readonly sha256: Sha256Hex
    }> = []

    for (const artifact of report.artifacts) {
      if (seenPaths.has(artifact.relativePath)) {
        return yield* new CloudDeviceExecutionError({
          operation: 'CloudAndroidVerification.deduplicateArtifacts',
          providerId: input.dispatch.providerId,
          runId: input.dispatch.runId,
          message: `Duplicate Stage 2 artifact path "${artifact.relativePath}"`,
        })
      }
      seenPaths.add(artifact.relativePath)

      if (!(artifact.bytes instanceof Uint8Array)) {
        return yield* new CloudDeviceExecutionError({
          operation: 'CloudAndroidVerification.validateArtifactBytes',
          providerId: input.dispatch.providerId,
          runId: input.dispatch.runId,
          message: `Stage 2 artifact "${artifact.relativePath}" payload is not a Uint8Array`,
        })
      }

      if (artifact.bytes.byteLength > MAX_CLOUD_DEVICE_ARTIFACT_BYTES) {
        return yield* new CloudDeviceExecutionError({
          operation: 'CloudAndroidVerification.boundArtifacts',
          providerId: input.dispatch.providerId,
          runId: input.dispatch.runId,
          message: `Stage 2 artifact "${artifact.relativePath}" (${artifact.bytes.byteLength} bytes) exceeds limit (${MAX_CLOUD_DEVICE_ARTIFACT_BYTES} bytes)`,
        })
      }
      totalArtifactBytes += artifact.bytes.byteLength
      if (totalArtifactBytes > MAX_CLOUD_DEVICE_TOTAL_ARTIFACT_BYTES) {
        return yield* new CloudDeviceExecutionError({
          operation: 'CloudAndroidVerification.boundArtifacts',
          providerId: input.dispatch.providerId,
          runId: input.dispatch.runId,
          message: `Total Stage 2 artifacts (${totalArtifactBytes} bytes) exceed limit (${MAX_CLOUD_DEVICE_TOTAL_ARTIFACT_BYTES} bytes)`,
        })
      }

      const safeContentType = yield* Schema.decodeEffect(SafeContentType)(
        artifact.contentType,
      ).pipe(
        Effect.mapError(
          (cause) =>
            new CloudDevicePolicyError({
              field: 'contentType',
              reason: sanitizeErrorMessage(cause),
            }),
        ),
      )
      yield* assertAllowedStage2ContentType(safeContentType)

      // Scope Stage 2 artifact keys by runId so retries never collide in R2.
      const artifactKey = yield* Schema.decodeEffect(ArtifactKey)(
        `attempts/${input.build.attemptId}/android/device/${input.dispatch.runId}/${artifact.relativePath}`,
      ).pipe(
        Effect.mapError(
          (cause) =>
            new CloudDeviceExecutionError({
              operation: 'CloudAndroidVerification.validateArtifactKey',
              providerId: input.dispatch.providerId,
              runId: input.dispatch.runId,
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
              providerId: input.dispatch.providerId,
              runId: input.dispatch.runId,
              message: sanitizeErrorMessage(cause),
            }),
        ),
      )

      validatedArtifacts.push({
        artifactKey,
        contentType: safeContentType,
        bytes: artifact.bytes,
        sha256,
      })
    }

    // 3. Persist pre-validated artifacts to R2 & Postgres.
    const persistedArtifactKeys: Array<ArtifactKey> = []
    for (const artifact of validatedArtifacts) {
      const stored = yield* artifactStore.putVerifiedArtifact({
        attemptId: input.build.attemptId,
        artifactKey: artifact.artifactKey,
        body: artifact.bytes,
        contentType: artifact.contentType,
        expectedSha256: artifact.sha256,
      })
      yield* lifecycleStore.recordArtifactMetadata(stored)
      persistedArtifactKeys.push(stored.artifactKey)
    }

    const finalRun = yield* androidStore.recordCloudDeviceRun({
      runId: input.dispatch.runId,
      attemptId: input.build.attemptId,
      changeRequestId: input.build.changeRequestId,
      providerId: input.dispatch.providerId,
      sourceSha: input.build.sourceSha,
      apkArtifactKey: input.build.apkArtifactKey,
      apkSha256: input.build.apkSha256,
      status: evaluation.passed ? 'passed' : 'failed',
      observation: report.observation,
      artifactKeys: persistedArtifactKeys,
    })
    terminalRecorded = true

    return {
      run: finalRun,
      observation: report.observation,
      passed: evaluation.passed,
      failures: evaluation.failures,
    } satisfies Stage2CloudDeviceResult
  }).pipe(
    Effect.onExit((exit) =>
      Exit.isFailure(exit) && !terminalRecorded
        ? markRunFailedOnAbnormalExit()
        : Effect.void,
    ),
  )
})

/**
 * Convenience composition of Stage 2a + Stage 2b for direct callers.
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
  const dispatch = yield* dispatchVerifiedApkToCloudDevice(input)
  return yield* awaitAndRecordCloudDeviceResult({
    build: input.build,
    dispatch,
    ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
  })
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
    Schema.Int.check(
      Schema.isGreaterThanOrEqualTo(1_000),
      Schema.isLessThanOrEqualTo(MAX_COMMAND_TIMEOUT_MS),
    ),
  ),
  deviceTimeoutMs: Schema.optionalKey(
    Schema.Int.check(
      Schema.isGreaterThanOrEqualTo(1_000),
      Schema.isLessThanOrEqualTo(MAX_CLOUD_DEVICE_TIMEOUT_MS),
    ),
  ),
  cleanupTimeoutMs: Schema.optionalKey(
    Schema.Int.check(
      Schema.isGreaterThanOrEqualTo(100),
      Schema.isLessThanOrEqualTo(MAX_CLEANUP_TIMEOUT_MS),
    ),
  ),
  cleanupPollIntervalMs: Schema.optionalKey(
    Schema.Int.check(
      Schema.isGreaterThanOrEqualTo(MIN_CLEANUP_POLL_INTERVAL_MS),
      Schema.isLessThanOrEqualTo(MAX_CLEANUP_POLL_INTERVAL_MS),
    ),
  ),
})
export interface CloudAndroidVerificationWorkflowPayload extends Schema.Schema.Type<
  typeof CloudAndroidVerificationWorkflowPayload
> {}

export const Stage1ApkBuildError = Schema.Union([
  SandboxCredentialPolicyError,
  SandboxExecutionError,
  SandboxCleanupError,
  ArtifactStorageError,
  ArtifactIntegrityError,
  CloudDevicePolicyError,
  PersistenceError,
])

export const Stage2CloudDeviceError = Schema.Union([
  ArtifactStorageError,
  ArtifactIntegrityError,
  CloudDevicePolicyError,
  CloudDeviceExecutionError,
  ApkIntegrityError,
  PersistenceError,
])

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
      // Fail fast on Stage 2 cloud-only & synthetic-fixture policy BEFORE
      // provisioning any Stage 1 build sandbox.
      const adapter = yield* CloudAndroidDeviceAdapter
      yield* assertCloudOnlyProvider({
        providerId: adapter.providerId,
        executionEnvironment: adapter.executionEnvironment,
      })
      yield* assertDedicatedDevAccountAndSyntheticFixture({
        devAccountHandle: payload.devAccountHandle,
        syntheticFixtureId: payload.syntheticFixtureId,
      })

      const stage1 = yield* Activity.make({
        name: 'stage-1-build-debug-apk',
        success: Stage1ApkBuildResult,
        error: Stage1ApkBuildError,
        execute: buildDebugApkInIsolatedSandbox({
          attemptId: payload.attemptId,
          changeRequestId: payload.changeRequestId,
          sourceSha: payload.sourceSha,
          packageName: payload.packageName,
          buildCommand: payload.buildCommand,
          apkOutputPath: payload.apkOutputPath,
          ...(payload.buildTimeoutMs !== undefined
            ? { buildTimeoutMs: payload.buildTimeoutMs }
            : {}),
          cleanup: {
            ...(payload.cleanupTimeoutMs !== undefined
              ? { cleanupTimeoutMs: payload.cleanupTimeoutMs }
              : {}),
            ...(payload.cleanupPollIntervalMs !== undefined
              ? { cleanupPollIntervalMs: payload.cleanupPollIntervalMs }
              : {}),
          },
        }),
      })

      // Split Stage 2 into two durable activities so a container restart during
      // the 15-minute cloud emulator run never dispatches a duplicate CI run.
      const dispatch = yield* Activity.make({
        name: 'stage-2a-dispatch-cloud-device',
        success: Stage2DispatchReceipt,
        error: Stage2CloudDeviceError,
        execute: Effect.gen(function* () {
          const urlIssuer = yield* ApkDownloadUrlIssuer
          const apkDownloadUrl = yield* urlIssuer.issueSignedApkUrl({
            attemptId: stage1.build.attemptId,
            artifactKey: stage1.build.apkArtifactKey,
            expectedSha256: stage1.build.apkSha256,
          })
          return yield* dispatchVerifiedApkToCloudDevice({
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

      const stage2 = yield* Activity.make({
        name: 'stage-2b-await-cloud-device',
        success: Stage2CloudDeviceResult,
        error: Stage2CloudDeviceError,
        execute: awaitAndRecordCloudDeviceResult({
          build: stage1.build,
          dispatch,
          ...(payload.deviceTimeoutMs !== undefined
            ? { timeoutMs: payload.deviceTimeoutMs }
            : {}),
        }),
      })

      return {
        stage1,
        stage2,
      } satisfies CloudAndroidVerificationResult
    }),
  )
