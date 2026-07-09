import { describe, expect, it } from '@effect/vitest'
import { Effect, Exit, Layer } from 'effect'
import { ArtifactsError, StorageError } from '@patchplane/domain/errors'
import { ArtifactsService } from '../services/artifacts-service'
import { StorageService } from '../services/storage-service'
import { CaptureEvidenceArtifact } from './capture-evidence-artifact'

function artifactsLayer(deleted: Array<string> = []) {
  return Layer.succeed(ArtifactsService, ArtifactsService.of({
    putArtifact: () => Effect.succeed({
      storageProvider: 'cloudflare-r2',
      storageKey: 'workflows/run_123/stdout/log.txt',
      contentType: 'text/plain',
      sizeBytes: 12,
      sha256: 'abc123',
      createdAt: 123,
    }),
    getArtifactMetadata: () => Effect.fail(new ArtifactsError({ operation: 'unused', message: 'unused', cause: undefined })),
    createSignedReadUrl: () => Effect.fail(new ArtifactsError({ operation: 'unused', message: 'unused', cause: undefined })),
    deleteArtifact: (input) => Effect.sync(() => {
      deleted.push(input.storageKey)
    }).pipe(Effect.asVoid),
    applyRetentionPolicy: () => Effect.fail(new ArtifactsError({ operation: 'unused', message: 'unused', cause: undefined })),
  }))
}

function storageLayer(options: { readonly failRecord?: boolean } = {}) {
  return Layer.succeed(StorageService, StorageService.of({
    createWorkflowFromIntake: () => Effect.fail(new StorageError({ operation: 'unused', message: 'unused', cause: undefined })),
    createWorkflowFromPrompt: () => Effect.fail(new StorageError({ operation: 'unused', message: 'unused', cause: undefined })),
    listRecentWorkflowStarts: () => Effect.succeed([]),
    recordSandboxExecution: () => Effect.fail(new StorageError({ operation: 'unused', message: 'unused', cause: undefined })),
    recordRuntimeEvents: () => Effect.succeed([]),
    recordRuntimeSessionStarted: () => Effect.fail(new StorageError({ operation: 'unused', message: 'unused', cause: undefined })),
    markRuntimeSessionStatus: () => Effect.fail(new StorageError({ operation: 'unused', message: 'unused', cause: undefined })),
    getActiveRuntimeSession: () => Effect.succeed(undefined),
    recordEvidenceArtifact: (input) => options.failRecord
      ? Effect.fail(new StorageError({ operation: 'recordEvidenceArtifact', message: 'boom', cause: undefined }))
      : Effect.succeed({ id: 'artifact_1', ...input, createdAt: input.createdAt ?? 123 } as never),
    getEvidenceArtifact: () => Effect.succeed(undefined),
  }))
}

describe('CaptureEvidenceArtifact', () => {
  it.effect('uploads raw bytes then records Convex-owned metadata', () =>
    Effect.gen(function* () {
      const artifact = yield* CaptureEvidenceArtifact({
        workflowRunId: 'run_123',
        traceId: 'trace_123',
        kind: 'stdout',
        label: 'Sandbox stdout',
        contentType: 'text/plain',
        body: 'hello',
      })
      expect(artifact).toMatchObject({
        id: 'artifact_1',
        workflowRunId: 'run_123',
        traceId: 'trace_123',
        kind: 'stdout',
        label: 'Sandbox stdout',
        storageKey: 'workflows/run_123/stdout/log.txt',
        sha256: 'abc123',
      })
    }).pipe(Effect.provide(Layer.merge(artifactsLayer(), storageLayer()))))

  it.effect('deletes the R2 object when Convex metadata recording fails', () => {
    const deleted: Array<string> = []
    return Effect.gen(function* () {
      const exit = yield* Effect.exit(CaptureEvidenceArtifact({
        workflowRunId: 'run_123',
        kind: 'stdout',
        contentType: 'text/plain',
        body: 'hello',
      }))
      expect(Exit.isFailure(exit)).toBe(true)
      expect(deleted).toEqual(['workflows/run_123/stdout/log.txt'])
    }).pipe(Effect.provide(Layer.merge(artifactsLayer(deleted), storageLayer({ failRecord: true }))))
  })
})
