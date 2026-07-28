import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer, Option } from 'effect'
import { ArtifactsError, StorageError } from '@patchplane/domain/errors'
import {
  makeEvidenceArtifactId,
  makeWorkflowRunId,
} from '@patchplane/domain/ids'
import {
  ArtifactsService,
  type PutArtifactInput,
} from '../services/artifacts-service'
import { StorageService } from '../services/storage-service'
import type { SandboxCommandResult } from '../services/sandbox-service'
import { CaptureSandboxResultArtifacts } from './capture-sandbox-result-artifacts'

function bodySize(body: PutArtifactInput['body']) {
  if (typeof body === 'string') return body.length
  if (body instanceof Uint8Array) return body.byteLength
  return 0
}

describe('CaptureSandboxResultArtifacts', () => {
  it.effect(
    'uploads sandbox-provided evidence artifacts through the durable artifact path',
    () => {
      const uploaded: Array<PutArtifactInput> = []
      const recorded: Array<{
        readonly kind: string
        readonly storageKey: string
      }> = []
      const artifactsLayer = Layer.succeed(
        ArtifactsService,
        ArtifactsService.of({
          putArtifact: (input) =>
            Effect.sync(() => {
              uploaded.push(input)
              return {
                storageProvider: 'cloudflare-r2' as const,
                storageKey: `workflows/run_123/${input.kind}/artifact`,
                contentType: input.contentType,
                sizeBytes: bodySize(input.body),
                sha256: `${input.kind}-sha`,
                createdAt: 123,
              }
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
          deleteArtifact: () => Effect.void,
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
      const storageLayer = Layer.succeed(
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
            Effect.sync(() => {
              recorded.push({ kind: input.kind, storageKey: input.storageKey })
            }).pipe(
              Effect.as({
                id: makeEvidenceArtifactId(`artifact:${input.kind}`),
                ...input,
                createdAt: input.createdAt ?? 123,
              }),
            ),
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
          startIncomingVerificationPlan: () => Effect.die('unused'),
          claimVerificationExecutionGroup: () => Effect.die('unused'),
          startVerificationExecutionGroup: () => Effect.die('unused'),
          failVerificationExecutionGroup: () => Effect.die('unused'),
          getVerificationExecutionState: () => Effect.die('unused'),
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
      const result: SandboxCommandResult = {
        provider: 'daytona',
        sandboxId: 'sandbox-1',
        command: 'pi',
        exitCode: 0,
        stdout: '',
        startedAt: 1,
        completedAt: 2,
        evidenceArtifacts: [
          {
            kind: 'diff',
            label: 'Candidate patch diff',
            contentType: 'text/x-diff',
            body: 'diff --git a/file b/file',
            retentionPolicy: 'alpha-14d',
          },
          {
            kind: 'screenshot',
            label: 'Browser verification screenshot',
            contentType: 'image/png',
            body: Uint8Array.from([1, 2, 3]),
          },
        ],
      }

      return Effect.gen(function* () {
        yield* CaptureSandboxResultArtifacts({
          workflowRunId: makeWorkflowRunId('run_123'),
          traceId: 'trace_123',
          result,
        })

        expect(uploaded.map((item) => item.kind)).toEqual([
          'diff',
          'screenshot',
        ])
        expect(recorded).toEqual([
          { kind: 'diff', storageKey: 'workflows/run_123/diff/artifact' },
          {
            kind: 'screenshot',
            storageKey: 'workflows/run_123/screenshot/artifact',
          },
        ])
      }).pipe(Effect.provide(Layer.merge(artifactsLayer, storageLayer)))
    },
  )
})
