import { Duration, Effect, Layer, Schema } from 'effect'
import * as Redacted from 'effect/Redacted'
import {
  assertSafeRedactedHttpsUrl,
  CloudAndroidDeviceAdapter,
  type CloudAndroidDiagnosticArtifact,
  type CloudAndroidDispatchResult,
  type CloudAndroidVerificationReport,
} from '@patchplane/core'
import {
  ApkIntegrityError,
  ArbeoJourneyObservation,
  CloudDeviceExecutionError,
  CloudDevicePolicyError,
  CloudDeviceProviderId,
  CloudDeviceRunId,
  SafeContentType,
  sanitizeErrorMessage,
} from '@patchplane/domain'

export const GITHUB_ACTIONS_KVM_PROVIDER_ID =
  CloudDeviceProviderId.make('github-actions-kvm')

export const GITHUB_ACTIONS_KVM_WORKFLOW_FILE = 'cloud-android-kvm-verify.yml'

const SAFE_WORKFLOW_FILENAME = /^[A-Za-z0-9._-]+\.ya?ml$/

/**
 * Exact `workflow_dispatch` inputs sent to GitHub Actions `ubuntu-latest` KVM.
 * Contains ONLY verified Stage 1 APK identity & scoped download URL — zero PR
 * source code, Gradle scripts, or control-plane/signing credentials.
 */
export interface GitHubActionsKvmDispatchPayload {
  readonly workflowFile: string
  readonly ref: string
  readonly inputs: {
    readonly attempt_id: string
    readonly change_request_id: string
    readonly source_sha: string
    readonly apk_artifact_key: string
    readonly apk_sha256: string
    readonly apk_download_url: string
    readonly package_name: string
    readonly synthetic_fixture_id: string
    readonly dev_account_handle: string
  }
}

export interface GitHubActionsKvmRawResult {
  readonly runId: unknown
  readonly observation: unknown
  readonly artifacts: unknown
}

export interface GitHubActionsKvmRunnerPort<
  EDispatch = unknown,
  EAwait = unknown,
> {
  readonly dispatchWorkflow: (
    payload: GitHubActionsKvmDispatchPayload,
  ) => Effect.Effect<{ readonly runId: unknown }, EDispatch>

  readonly awaitWorkflowResult: (input: {
    readonly runId: CloudDeviceRunId
    readonly timeoutMs: number
  }) => Effect.Effect<GitHubActionsKvmRawResult, EAwait>
}

const DecodedRawArtifacts = Schema.Array(
  Schema.Struct({
    relativePath: Schema.NonEmptyString,
    contentType: SafeContentType,
    bytes: Schema.instanceOf(Uint8Array),
  }),
)

const mapAdapterError = (operation: string, runId?: CloudDeviceRunId) =>
  Effect.mapError(
    (cause: unknown) =>
      new CloudDeviceExecutionError({
        operation,
        providerId: GITHUB_ACTIONS_KVM_PROVIDER_ID,
        message: sanitizeErrorMessage(cause),
        ...(runId !== undefined ? { runId } : {}),
      }),
  )

export const makeGitHubActionsKvmDeviceAdapterLayer = <EDispatch, EAwait>(
  port: GitHubActionsKvmRunnerPort<EDispatch, EAwait>,
  options?: {
    readonly workflowFile?: string
    readonly workflowRef?: string
  },
) =>
  Layer.succeed(
    CloudAndroidDeviceAdapter,
    CloudAndroidDeviceAdapter.of({
      providerId: GITHUB_ACTIONS_KVM_PROVIDER_ID,
      executionEnvironment: 'cloud-isolated',

      dispatchApkVerification: Effect.fn(
        'GitHubActionsKvmDeviceAdapter.dispatchApkVerification',
      )(function* (request) {
        const operation =
          'GitHubActionsKvmDeviceAdapter.dispatchApkVerification'
        const workflowFile =
          options?.workflowFile ?? GITHUB_ACTIONS_KVM_WORKFLOW_FILE
        if (
          !SAFE_WORKFLOW_FILENAME.test(workflowFile) ||
          workflowFile.includes('..')
        ) {
          return yield* new CloudDevicePolicyError({
            field: 'workflowFile',
            reason: `Unsafe workflow filename "${workflowFile}"`,
          })
        }

        // Enforce HTTPS + non-SSRF URL validation at the adapter boundary as well.
        yield* assertSafeRedactedHttpsUrl({
          field: 'apkDownloadUrl',
          url: request.apkDownloadUrl,
          allowQueryString: true,
        })

        const dispatched = yield* port
          .dispatchWorkflow({
            workflowFile,
            ref: options?.workflowRef ?? 'main',
            inputs: {
              attempt_id: request.attemptId,
              change_request_id: request.changeRequestId,
              source_sha: request.sourceSha,
              apk_artifact_key: request.apkArtifactKey,
              apk_sha256: request.expectedApkSha256,
              // Unwrap the short-lived read-only APK URL only at dispatch boundary.
              apk_download_url: Redacted.value(request.apkDownloadUrl),
              package_name: request.packageName,
              synthetic_fixture_id: request.syntheticFixtureId,
              dev_account_handle: request.devAccountHandle,
            },
          })
          .pipe(mapAdapterError(operation))

        const runId = yield* Schema.decodeUnknownEffect(CloudDeviceRunId)(
          dispatched.runId,
        ).pipe(mapAdapterError(operation))

        return {
          runId,
          providerId: GITHUB_ACTIONS_KVM_PROVIDER_ID,
        } satisfies CloudAndroidDispatchResult
      }),

      awaitVerificationResult: Effect.fn(
        'GitHubActionsKvmDeviceAdapter.awaitVerificationResult',
      )(function* ({ runId, expectedApkSha256, timeoutMs }) {
        const operation =
          'GitHubActionsKvmDeviceAdapter.awaitVerificationResult'
        const raw = yield* port.awaitWorkflowResult({ runId, timeoutMs }).pipe(
          Effect.timeoutOrElse({
            duration: Duration.millis(timeoutMs),
            orElse: () =>
              Effect.fail(
                new CloudDeviceExecutionError({
                  operation,
                  providerId: GITHUB_ACTIONS_KVM_PROVIDER_ID,
                  runId,
                  message: `GitHub Actions KVM run "${runId}" timed out after ${timeoutMs}ms`,
                }),
              ),
          }),
          mapAdapterError(operation, runId),
        )

        const decodedRunId = yield* Schema.decodeUnknownEffect(
          CloudDeviceRunId,
        )(raw.runId).pipe(mapAdapterError(operation, runId))
        if (decodedRunId !== runId) {
          return yield* new CloudDeviceExecutionError({
            operation,
            providerId: GITHUB_ACTIONS_KVM_PROVIDER_ID,
            runId,
            message: `Workflow result runId "${decodedRunId}" did not match dispatched run "${runId}"`,
          })
        }

        const observation = yield* Schema.decodeUnknownEffect(
          ArbeoJourneyObservation,
        )(raw.observation).pipe(mapAdapterError(operation, runId))

        if (
          !observation.apkSha256Verified ||
          observation.observedApkSha256 !== expectedApkSha256
        ) {
          return yield* new ApkIntegrityError({
            expectedSha256: expectedApkSha256,
            actualSha256: observation.observedApkSha256,
            reason:
              'GitHub Actions KVM runner reported unverified or mismatched APK SHA-256',
          })
        }

        // GitHub Actions KVM adapter strictly enforces /dev/kvm acceleration
        // (while core remains provider-neutral for Expo Simulators, etc.).
        if (observation.kvmAccelerated !== true) {
          return yield* new CloudDeviceExecutionError({
            operation,
            providerId: GITHUB_ACTIONS_KVM_PROVIDER_ID,
            runId,
            message:
              'GitHub Actions KVM runner did not confirm /dev/kvm hardware acceleration',
          })
        }

        const decodedArtifacts = yield* Schema.decodeUnknownEffect(
          DecodedRawArtifacts,
        )(raw.artifacts).pipe(mapAdapterError(operation, runId))

        const artifacts: ReadonlyArray<CloudAndroidDiagnosticArtifact> =
          decodedArtifacts.map((entry) => ({
            relativePath: entry.relativePath,
            contentType: entry.contentType,
            bytes: entry.bytes,
          }))

        return {
          runId,
          providerId: GITHUB_ACTIONS_KVM_PROVIDER_ID,
          observation,
          artifacts,
        } satisfies CloudAndroidVerificationReport
      }),
    }),
  )
