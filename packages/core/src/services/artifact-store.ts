import { Context, type Effect } from 'effect'
import type {
  ArtifactIntegrityError,
  ArtifactKey,
  ArtifactRecord,
  ArtifactStorageError,
  Sha256Hex,
  VerificationAttemptId,
} from '@patchplane/domain'

export interface ArtifactStoreService {
  readonly putVerifiedArtifact: (input: {
    readonly attemptId: VerificationAttemptId
    readonly artifactKey: ArtifactKey
    readonly body: Uint8Array
    readonly contentType: string
    readonly expectedSha256: Sha256Hex
  }) => Effect.Effect<
    ArtifactRecord,
    ArtifactStorageError | ArtifactIntegrityError
  >

  readonly getVerifiedArtifact: (input: {
    readonly artifactKey: ArtifactKey
    readonly expectedSha256: Sha256Hex
  }) => Effect.Effect<Uint8Array, ArtifactStorageError | ArtifactIntegrityError>
}

export class ArtifactStore extends Context.Service<
  ArtifactStore,
  ArtifactStoreService
>()('@patchplane/core/ArtifactStore') {}
