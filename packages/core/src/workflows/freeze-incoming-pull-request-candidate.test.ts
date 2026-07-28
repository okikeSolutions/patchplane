import { assert, describe, it } from '@effect/vitest'
import { Crypto, Effect, Layer, Option, Schema } from 'effect'
import {
  CandidatePatchSet,
  type CandidatePatchSet as CandidatePatchSetType,
} from '@patchplane/domain/decision-review'
import {
  makeCandidatePatchSetId,
  makeEvidenceArtifactId,
} from '@patchplane/domain/ids'
import { WorkflowStart } from '@patchplane/domain/workflow-start'
import { ArtifactsService } from '../services/artifacts-service'
import { SourceControlService } from '../services/source-control-service'
import { StorageService } from '../services/storage-service'
import { TelemetryService } from '../services/telemetry-service'
import {
  ClaimIncomingPullRequestDispatch,
  FreezeIncomingPullRequestCandidate,
} from './freeze-incoming-pull-request-candidate'

const baseSha = 'a'.repeat(40)
const headSha = 'b'.repeat(40)
const digestHex = 'ab'.repeat(32)
const comparisonBytes = Uint8Array.from(
  'diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-a\n+b\n',
  (character) => character.charCodeAt(0),
)
const workflowStart = Schema.decodeUnknownSync(WorkflowStart)({
  promptRequest: {
    id: 'prompt-1',
    workspaceId: 'system:workspace-1',
    actorId: 'github-app:123',
    traceId: 'trace-1',
    source: 'external',
    prompt: 'Verify PR 7',
    externalRef: {
      provider: 'github',
      deliveryId: 'delivery-1',
      eventKind: 'github.pull_request.synchronize',
      repositoryProvider: 'github',
      repositoryInstallationId: '123',
      repositoryExternalId: '456',
      repositoryOwner: 'patchplane',
      repositoryName: 'demo',
      repositoryFullName: 'patchplane/demo',
      issueExternalId: '789',
      pullRequestExternalId: '789',
      pullRequestNumber: 7,
      pullRequestUpdatedAt: 1_000,
      pullRequestBaseSha: baseSha,
      pullRequestHeadSha: headSha,
      pullRequestPreviousHeadSha: 'c'.repeat(40),
      pullRequestBaseRef: 'main',
      pullRequestHeadRef: 'feature',
    },
    status: 'created',
    createdAt: 1,
  },
  workflowRun: {
    id: 'run-1',
    promptRequestId: 'prompt-1',
    workspaceId: 'system:workspace-1',
    traceId: 'trace-1',
    status: 'queued',
    modelVersion: 'v1',
    rootWorkflowRunId: 'run-1',
    attemptNumber: 1,
    trigger: 'intake',
    candidateIdentityVersion: 'incoming-pr-v1',
    sourceBaseSha: baseSha,
    sourceCommitSha: headSha,
    createdAt: 1,
  },
})

function unusedStorageError(): never {
  throw new Error('unused storage operation')
}

describe('FreezeIncomingPullRequestCandidate', () => {
  it.effect(
    'persists exact comparison bytes and candidate before dispatch',
    () => {
      const order: Array<string> = []
      let persistedCandidate: CandidatePatchSetType | undefined
      const layer = Layer.mergeAll(
        Layer.succeed(
          Crypto.Crypto,
          Crypto.make({
            randomBytes: (size) => new Uint8Array(size),
            digest: () => Effect.succeed(new Uint8Array(32).fill(0xab)),
          }),
        ),
        Layer.succeed(
          SourceControlService,
          SourceControlService.of({
            verifyRepositoryAccess: () => Effect.die('unused'),
            getInstallationAccount: () => Effect.die('unused'),
            listInstallationRepositories: () => Effect.die('unused'),
            createIssueComment: () => Effect.die('unused'),
            createCheckRun: () => Effect.die('unused'),
            createDraftPullRequest: () => Effect.die('unused'),
            createRepositoryCloneCredentials: () => Effect.die('unused'),
            fetchImmutableComparison: (input) =>
              Effect.sync(() => {
                order.push('comparison')
                assert.strictEqual(input.baseSha, baseSha)
                assert.strictEqual(input.headSha, headSha)
                return {
                  provider: 'github',
                  baseSha: input.baseSha,
                  headSha: input.headSha,
                  contentType: 'application/vnd.github.v3.diff',
                  bytes: comparisonBytes,
                }
              }),
          }),
        ),
        Layer.succeed(
          ArtifactsService,
          ArtifactsService.of({
            putArtifact: (input) =>
              Effect.sync(() => {
                order.push('r2')
                assert.deepStrictEqual(input.body, comparisonBytes)
                return {
                  storageProvider: 'cloudflare-r2',
                  storageKey: 'workflows/run-1/diff/incoming.diff',
                  contentType: input.contentType,
                  sizeBytes: comparisonBytes.byteLength,
                  sha256: digestHex,
                  createdAt: 2,
                }
              }),
            getArtifactMetadata: () => Effect.die('unused'),
            createSignedReadUrl: () => Effect.die('unused'),
            deleteArtifact: () => Effect.void,
            applyRetentionPolicy: () => Effect.die('unused'),
          }),
        ),
        Layer.succeed(
          StorageService,
          StorageService.of({
            createWorkflowFromIntake: () => Effect.die('unused'),
            createWorkflowFromPrompt: () => Effect.die('unused'),
            listRecentWorkflowStarts: () => Effect.succeed([]),
            claimWorkflowExecution: () => Effect.succeed(false),
            markWorkflowExecutionFailed: () => Effect.succeed(true),
            recordSandboxExecution: unusedStorageError,
            recordRuntimeEvents: () => Effect.succeed([]),
            recordRuntimeSessionStarted: unusedStorageError,
            markRuntimeSessionStatus: unusedStorageError,
            getActiveRuntimeSession: () => Effect.succeed(Option.none()),
            recordEvidenceArtifact: (input) =>
              Effect.sync(() => {
                order.push('artifact-metadata')
                return {
                  id: makeEvidenceArtifactId('artifact-1'),
                  ...input,
                  createdAt: input.createdAt ?? 2,
                }
              }),
            getEvidenceArtifact: () => Effect.succeed(Option.none()),
            getCandidatePatchSetForWorkflow: () =>
              Effect.sync(() => {
                order.push('candidate-read')
                return persistedCandidate === undefined
                  ? Option.none()
                  : Option.some(persistedCandidate)
              }),
            claimCandidateFreeze: () =>
              Effect.sync(() => {
                order.push('freeze-claim')
                return true
              }),
            releaseCandidateFreeze: () => Effect.succeed(true),
            failCandidateFreeze: () => Effect.succeed(true),
            claimIncomingDispatch: () =>
              Effect.sync(() => {
                order.push('execution-claim')
                return true
              }),
            startIncomingDispatch: () => Effect.succeed(true),
            validateIncomingDispatch: () => Effect.succeed(true),
            recordCandidatePatchSet: (input) =>
              Effect.sync(() => {
                order.push('candidate')
                persistedCandidate = {
                  id: makeCandidatePatchSetId('candidate-1'),
                  ...input,
                }
                return persistedCandidate
              }),
            recordVerificationPlan: () =>
              Effect.die('unused verification plan'),
            recordVerificationRequirement: unusedStorageError,
            startIncomingVerificationPlan: () => Effect.die('unused'),
            claimVerificationExecutionGroup: () => Effect.die('unused'),
            startVerificationExecutionGroup: () => Effect.die('unused'),
            failVerificationExecutionGroup: () => Effect.die('unused'),
            getVerificationExecutionState: () => Effect.die('unused'),
            recordVerificationResult: unusedStorageError,
            recordReviewRun: unusedStorageError,
            recordReviewFinding: unusedStorageError,
            recordPolicyDecision: unusedStorageError,
            recordPublicationResult: unusedStorageError,
            recordProvenanceEvent: unusedStorageError,
          }),
        ),
        Layer.succeed(
          TelemetryService,
          TelemetryService.of({
            recordEvent: () => Effect.void,
            addBreadcrumb: () => Effect.void,
            withBreadcrumbScope: (effect) => effect,
            captureError: () => Effect.void,
            withSpan: (_input, effect) => effect,
          }),
        ),
      )

      return Effect.gen(function* () {
        const candidate = yield* FreezeIncomingPullRequestCandidate({
          workflowStart,
        })
        const resumedCandidate = yield* FreezeIncomingPullRequestCandidate({
          workflowStart,
        })
        assert.strictEqual(resumedCandidate?.id, candidate?.id)
        if (
          candidate === undefined ||
          candidate.subject?.kind !== 'incoming-pull-request'
        ) {
          return assert.fail('Expected frozen incoming candidate')
        }
        const dispatch = yield* ClaimIncomingPullRequestDispatch({
          workflowStart,
          candidatePatchSet: candidate,
        })
        assert.isDefined(dispatch)
        const staleHead = 'c'.repeat(40)
        const staleCandidate = yield* Schema.decodeUnknownEffect(
          CandidatePatchSet,
        )({
          ...candidate,
          headSha: staleHead,
          subject: { ...candidate.subject, headSha: staleHead },
        })
        const staleError = yield* ClaimIncomingPullRequestDispatch({
          workflowStart,
          candidatePatchSet: staleCandidate,
        }).pipe(Effect.flip)
        assert.strictEqual(
          staleError.message,
          'Incoming PR dispatch requires the exact frozen workflow candidate',
        )
        const fabricatedError = yield* ClaimIncomingPullRequestDispatch({
          workflowStart,
          candidatePatchSet: {
            ...candidate,
            id: makeCandidatePatchSetId('fabricated-candidate'),
          },
        }).pipe(Effect.flip)
        assert.strictEqual(
          fabricatedError.message,
          'Incoming PR dispatch candidate is not durably persisted',
        )
        assert.deepStrictEqual(order, [
          'candidate-read',
          'freeze-claim',
          'comparison',
          'r2',
          'artifact-metadata',
          'candidate',
          'candidate-read',
          'candidate-read',
          'execution-claim',
          'candidate-read',
        ])
        assert.strictEqual(candidate?.candidateDigest, `sha256:${digestHex}`)
        assert.strictEqual(candidate?.subject?.kind, 'incoming-pull-request')
        assert.strictEqual(candidate?.baseSha, baseSha)
        assert.strictEqual(candidate?.headSha, headSha)
        assert.isUndefined(candidate?.sandboxExecutionId)
      }).pipe(Effect.provide(layer))
    },
  )
})
