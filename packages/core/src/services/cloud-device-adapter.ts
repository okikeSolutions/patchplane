import { Context, type Effect } from 'effect'
import type * as Redacted from 'effect/Redacted'
import type {
  AndroidPackageName,
  ApkIntegrityError,
  ArbeoJourneyObservation,
  ArtifactKey,
  ChangeRequestId,
  CloudDeviceExecutionError,
  CloudDevicePolicyError,
  CloudDeviceProviderId,
  CloudDeviceRunId,
  GitCommitSha,
  Sha256Hex,
  VerificationAttemptId,
} from '@patchplane/domain'

export interface CloudAndroidDispatchRequest {
  readonly attemptId: VerificationAttemptId
  readonly changeRequestId: ChangeRequestId
  readonly sourceSha: GitCommitSha
  readonly apkArtifactKey: ArtifactKey
  readonly expectedApkSha256: Sha256Hex
  /** Short-lived, read-only scoped URL for downloading ONLY the verified APK. */
  readonly apkDownloadUrl: Redacted.Redacted
  readonly packageName: AndroidPackageName
  readonly syntheticFixtureId: string
  readonly devAccountHandle: string
  readonly timeoutMs: number
}

export interface CloudAndroidDispatchResult {
  readonly runId: CloudDeviceRunId
  readonly providerId: CloudDeviceProviderId
}

export interface CloudAndroidDiagnosticArtifact {
  /** Relative filename under `attempts/<attemptId>/android/device/` */
  readonly relativePath: string
  readonly contentType: string
  readonly bytes: Uint8Array
}

export interface CloudAndroidVerificationReport {
  readonly runId: CloudDeviceRunId
  readonly providerId: CloudDeviceProviderId
  readonly observation: ArbeoJourneyObservation
  readonly artifacts: ReadonlyArray<CloudAndroidDiagnosticArtifact>
}

/**
 * Provider-neutral Stage 2 cloud Android device adapter.
 *
 * Implementations (GitHub Actions `/dev/kvm`, Expo Simulators, dedicated cloud
 * KVM/SimLock worker pools) receive ONLY a Stage 1 verified APK digest and
 * scoped download URL — never candidate source code, Gradle scripts, signing
 * keys, or personal/production credentials.
 */
export interface CloudAndroidDeviceAdapterService {
  readonly providerId: CloudDeviceProviderId
  readonly executionEnvironment: 'cloud-isolated'

  readonly dispatchApkVerification: (
    request: CloudAndroidDispatchRequest,
  ) => Effect.Effect<
    CloudAndroidDispatchResult,
    CloudDeviceExecutionError | CloudDevicePolicyError
  >

  readonly awaitVerificationResult: (input: {
    readonly runId: CloudDeviceRunId
    readonly expectedApkSha256: Sha256Hex
    readonly timeoutMs: number
  }) => Effect.Effect<
    CloudAndroidVerificationReport,
    CloudDeviceExecutionError | ApkIntegrityError
  >
}

export class CloudAndroidDeviceAdapter extends Context.Service<
  CloudAndroidDeviceAdapter,
  CloudAndroidDeviceAdapterService
>()('@patchplane/core/CloudAndroidDeviceAdapter') {}
