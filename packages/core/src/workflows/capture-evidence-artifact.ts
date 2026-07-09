import { Effect } from 'effect'
import { ArtifactsService, type PutArtifactInput } from '../services/artifacts-service'
import { StorageService } from '../services/storage-service'

export interface CaptureEvidenceArtifactInput extends PutArtifactInput {
  readonly label?: string | undefined
}

export const CaptureEvidenceArtifact = Effect.fn(
  '@patchplane/core/workflows/CaptureEvidenceArtifact',
)(function*(input: CaptureEvidenceArtifactInput) {
  const artifacts = yield* ArtifactsService
  const storage = yield* StorageService
  const storedObject = yield* artifacts.putArtifact(input)

  return yield* storage.recordEvidenceArtifact({
    workflowRunId: input.workflowRunId,
    ...(input.traceId === undefined ? {} : { traceId: input.traceId }),
    kind: input.kind,
    ...(input.label === undefined ? {} : { label: input.label }),
    storageProvider: storedObject.storageProvider,
    storageKey: storedObject.storageKey,
    contentType: storedObject.contentType,
    sizeBytes: storedObject.sizeBytes,
    sha256: storedObject.sha256,
    ...(input.retentionPolicy === undefined ? {} : { retentionPolicy: input.retentionPolicy }),
    createdAt: storedObject.createdAt,
  }).pipe(
    Effect.catchCause((cause) =>
      artifacts.deleteArtifact({
        storageKey: storedObject.storageKey,
        workflowRunId: input.workflowRunId,
        traceId: input.traceId,
        pluginName: 'artifacts',
        operation: 'captureEvidenceArtifact.compensateDelete',
      }).pipe(
        Effect.catchCause((deleteCause) =>
          Effect.logWarning('Failed to delete R2 artifact after metadata write failure', {
            storageKey: storedObject.storageKey,
            workflowRunId: input.workflowRunId,
            cause: deleteCause,
          }),
        ),
        Effect.andThen(() => Effect.failCause(cause)),
      )
    ),
  )
})
