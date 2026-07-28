import { describe, expect, it } from '@effect/vitest'
import { Effect, Exit, Layer, Option } from 'effect'
import { ArtifactsError, StorageError } from '@patchplane/domain/errors'
import {
  makeEvidenceArtifactId,
  makeWorkflowRunId,
} from '@patchplane/domain/ids'
import { ArtifactsService } from '../services/artifacts-service'
import { StorageService } from '../services/storage-service'
import { CaptureEvidenceArtifact } from './capture-evidence-artifact'

function artifactsLayer(deleted: Array<string> = []) {
  return Layer.succeed(
    ArtifactsService,
    ArtifactsService.of({
      putArtifact: () =>
        Effect.succeed({
          storageProvider: 'cloudflare-r2',
          storageKey: 'workflows/run_123/stdout/log.txt',
          contentType: 'text/plain',
          sizeBytes: 12,
          sha256: 'abc123',
          createdAt: 123,
        }),
      getArtifactMetadata: () =>
        Effect.fail(
          new ArtifactsError({
            operation: 'unused',
            message: 'unused',
            cause: undefined,
          }),
        ),
      createSignedReadUrl: () =>
        Effect.fail(
          new ArtifactsError({
            operation: 'unused',
            message: 'unused',
            cause: undefined,
          }),
        ),
      deleteArtifact: (input) =>
        Effect.sync(() => {
          deleted.push(input.storageKey)
        }).pipe(Effect.asVoid),
      applyRetentionPolicy: () =>
        Effect.fail(
          new ArtifactsError({
            operation: 'unused',
            message: 'unused',
            cause: undefined,
          }),
        ),
    }),
  )
}

function storageLayer(options: { readonly failRecord?: boolean } = {}) {
  return Layer.succeed(
    StorageService,
    StorageService.of({
      createWorkflowFromIntake: () =>
        Effect.fail(
          new StorageError({
            operation: 'unused',
            message: 'unused',
            cause: undefined,
          }),
        ),
      createWorkflowFromPrompt: () =>
        Effect.fail(
          new StorageError({
            operation: 'unused',
            message: 'unused',
            cause: undefined,
          }),
        ),
      listRecentWorkflowStarts: () => Effect.succeed([]),
      claimWorkflowExecution: () => Effect.succeed(true),
      markWorkflowExecutionFailed: () => Effect.succeed(true),
      recordSandboxExecution: () =>
        Effect.fail(
          new StorageError({
            operation: 'unused',
            message: 'unused',
            cause: undefined,
          }),
        ),
      recordRuntimeEvents: () => Effect.succeed([]),
      recordRuntimeSessionStarted: () =>
        Effect.fail(
          new StorageError({
            operation: 'unused',
            message: 'unused',
            cause: undefined,
          }),
        ),
      markRuntimeSessionStatus: () =>
        Effect.fail(
          new StorageError({
            operation: 'unused',
            message: 'unused',
            cause: undefined,
          }),
        ),
      getActiveRuntimeSession: () => Effect.succeed(Option.none()),
      recordEvidenceArtifact: (input) =>
        options.failRecord
          ? Effect.fail(
              new StorageError({
                operation: 'recordEvidenceArtifact',
                message: 'boom',
                cause: undefined,
              }),
            )
          : Effect.succeed({
              id: makeEvidenceArtifactId('artifact_1'),
              ...input,
              createdAt: input.createdAt ?? 123,
            }),
      getEvidenceArtifact: () => Effect.succeed(Option.none()),
      getCandidatePatchSetForWorkflow: () => Effect.succeed(Option.none()),
      claimCandidateFreeze: () => Effect.succeed(false),
      releaseCandidateFreeze: () => Effect.succeed(false),
      failCandidateFreeze: () => Effect.succeed(true),
      claimIncomingDispatch: () => Effect.succeed(false),
      startIncomingDispatch: () => Effect.succeed(true),
      validateIncomingDispatch: () => Effect.succeed(false),
      recordCandidatePatchSet: () =>
        Effect.fail(
          new StorageError({
            operation: 'unused',
            message: 'unused',
            cause: undefined,
          }),
        ),
      recordVerificationPlan: () => Effect.die('unused verification plan'),
      recordVerificationRequirement: () =>
        Effect.fail(
          new StorageError({
            operation: 'unused',
            message: 'unused',
            cause: undefined,
          }),
        ),
      recordVerificationResult: () =>
        Effect.fail(
          new StorageError({
            operation: 'unused',
            message: 'unused',
            cause: undefined,
          }),
        ),
      recordReviewRun: () =>
        Effect.fail(
          new StorageError({
            operation: 'unused',
            message: 'unused',
            cause: undefined,
          }),
        ),
      recordReviewFinding: () =>
        Effect.fail(
          new StorageError({
            operation: 'unused',
            message: 'unused',
            cause: undefined,
          }),
        ),
      recordPolicyDecision: () =>
        Effect.fail(
          new StorageError({
            operation: 'unused',
            message: 'unused',
            cause: undefined,
          }),
        ),
      recordPublicationResult: () =>
        Effect.fail(
          new StorageError({
            operation: 'unused',
            message: 'unused',
            cause: undefined,
          }),
        ),
      recordProvenanceEvent: () =>
        Effect.fail(
          new StorageError({
            operation: 'unused',
            message: 'unused',
            cause: undefined,
          }),
        ),
    }),
  )
}

describe('CaptureEvidenceArtifact', () => {
  it.effect('uploads raw bytes then records Convex-owned metadata', () =>
    Effect.gen(function* () {
      const artifact = yield* CaptureEvidenceArtifact({
        workflowRunId: makeWorkflowRunId('run_123'),
        traceId: 'trace_123',
        kind: 'stdout',
        label: 'Sandbox stdout',
        contentType: 'text/plain',
        body: 'hello',
      })
      expect(artifact).toMatchObject({
        id: 'artifact_1',
        workflowRunId: makeWorkflowRunId('run_123'),
        traceId: 'trace_123',
        kind: 'stdout',
        label: 'Sandbox stdout',
        storageKey: 'workflows/run_123/stdout/log.txt',
        sha256: 'abc123',
      })
    }).pipe(Effect.provide(Layer.merge(artifactsLayer(), storageLayer()))),
  )

  it.effect(
    'retains the R2 object for reconciliation when metadata recording is ambiguous',
    () => {
      const deleted: Array<string> = []
      return Effect.gen(function* () {
        const exit = yield* Effect.exit(
          CaptureEvidenceArtifact({
            workflowRunId: makeWorkflowRunId('run_123'),
            kind: 'stdout',
            contentType: 'text/plain',
            body: 'hello',
          }),
        )
        expect(Exit.isFailure(exit)).toBe(true)
        expect(deleted).toEqual([])
      }).pipe(
        Effect.provide(
          Layer.merge(
            artifactsLayer(deleted),
            storageLayer({ failRecord: true }),
          ),
        ),
      )
    },
  )
})
