import { Context, type Effect } from 'effect'
import type * as Redacted from 'effect/Redacted'
import type {
  ArtifactKey,
  ArtifactStorageError,
  Sha256Hex,
  VerificationAttemptId,
} from '@patchplane/domain'

export interface ApkDownloadUrlIssuerService {
  /**
   * Mints a short-lived, read-only signed download URL for a single verified
   * Stage 1 APK object right before Stage 2 cloud device dispatch, keeping
   * signed URLs out of persisted workflow payloads.
   */
  readonly issueSignedApkUrl: (input: {
    readonly attemptId: VerificationAttemptId
    readonly artifactKey: ArtifactKey
    readonly expectedSha256: Sha256Hex
  }) => Effect.Effect<Redacted.Redacted, ArtifactStorageError>
}

export class ApkDownloadUrlIssuer extends Context.Service<
  ApkDownloadUrlIssuer,
  ApkDownloadUrlIssuerService
>()('@patchplane/core/ApkDownloadUrlIssuer') {}
