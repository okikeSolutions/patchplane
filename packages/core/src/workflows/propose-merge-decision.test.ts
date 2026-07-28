import { assert, describe, expect, it } from '@effect/vitest'
import { Crypto, Effect, Layer, Option } from 'effect'
import { StorageError } from '@patchplane/domain/errors'
import {
  makeCandidatePatchSetId,
  makeEvidenceArtifactId,
  makePolicyDecisionId,
  makeProvenanceEventId,
  makePublicationResultId,
  makeReviewFindingId,
  makeReviewRunId,
  makeSandboxExecutionId,
  makeVerificationRequirementId,
  makeVerificationResultId,
  makeWorkflowRunId,
} from '@patchplane/domain/ids'
import type { EvidenceArtifact } from '@patchplane/domain/evidence-artifact'
import type { SandboxExecution } from '@patchplane/domain/sandbox-execution'
import {
  AlphaPolicyServiceLayer,
  AlphaReviewServiceLayer,
} from '../services/alpha-review-policy'
import { ReviewService } from '../services/review-service'
import { StorageService } from '../services/storage-service'
import { TelemetryService } from '../services/telemetry-service'
import { ProposeMergeDecision } from './propose-merge-decision'

const workflowRunId = makeWorkflowRunId('workflow-1')

const sandboxExecution: SandboxExecution = {
  id: makeSandboxExecutionId('execution-1'),
  workflowRunId,
  provider: 'daytona',
  sandboxId: 'sandbox-1',
  command: 'bun test',
  status: 'failed',
  exitCode: 1,
  stdout: 'failed',
  stderr: 'expected true to be false',
  startedAt: 10,
  completedAt: 20,
}

const diffArtifact: EvidenceArtifact = {
  id: makeEvidenceArtifactId('artifact-1'),
  workflowRunId,
  kind: 'diff',
  label: 'Candidate patch diff',
  storageProvider: 'cloudflare-r2',
  storageKey: 'workflow-1/diff.patch',
  contentType: 'text/x-diff',
  sizeBytes: 42,
  sha256: 'sha',
  createdAt: 21,
}

let breadcrumbs: Array<{ readonly stage: string; readonly status: string }> = []
const telemetryLayer = Layer.succeed(
  TelemetryService,
  TelemetryService.of({
    recordEvent: () => Effect.void,
    addBreadcrumb: (input) =>
      Effect.sync(() => {
        breadcrumbs.push({ stage: input.stage, status: input.status })
      }),
    withBreadcrumbScope: (effect) => effect,
    captureError: () => Effect.void,
    withSpan: (_input, effect) => effect,
  }),
)

const cryptoLayer = Layer.succeed(
  Crypto.Crypto,
  Crypto.make({
    randomBytes: (size) => new Uint8Array(size),
    digest: () => Effect.succeed(new Uint8Array(32)),
  }),
)

describe('ProposeMergeDecision', () => {
  it.effect(
    'does not treat agent completion as independent test evidence',
    () =>
      Effect.gen(function* () {
        const reviewer = yield* ReviewService
        const review = yield* reviewer.runReview({
          workflowRunId,
          sandboxExecution: {
            ...sandboxExecution,
            status: 'succeeded',
            exitCode: 0,
          },
          evidenceArtifacts: [diffArtifact],
          verificationResults: [],
        })

        expect(review.findings).toEqual([
          expect.objectContaining({
            severity: 'warning',
            category: 'test',
            message:
              'No independent verification command was configured; agent completion is not test evidence.',
          }),
        ])
      }).pipe(Effect.provide(AlphaReviewServiceLayer)),
  )

  it.effect('records review findings and a conservative policy decision', () =>
    Effect.gen(function* () {
      breadcrumbs = []
      const recorded: Array<{
        readonly type: string
        readonly value: unknown
      }> = []
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
          getActiveRuntimeSession: () => Effect.die('unused'),
          recordEvidenceArtifact: () =>
            Effect.fail(
              new StorageError({
                operation: 'unused',
                message: 'unused',
                cause: undefined,
              }),
            ),
          getEvidenceArtifact: () => Effect.die('unused'),
          getCandidatePatchSetForWorkflow: () => Effect.succeed(Option.none()),
          claimCandidateFreeze: () => Effect.succeed(false),
          releaseCandidateFreeze: () => Effect.succeed(false),
          failCandidateFreeze: () => Effect.succeed(true),
          claimIncomingDispatch: () => Effect.succeed(false),
          startIncomingDispatch: () => Effect.succeed(true),
          validateIncomingDispatch: () => Effect.succeed(false),
          recordCandidatePatchSet: (input) =>
            Effect.succeed({
              id: makeCandidatePatchSetId('patch-set-1'),
              ...input,
              createdAt: input.createdAt ?? 1,
            }),
          recordVerificationRequirement: () => Effect.die('unused'),
          recordVerificationResult: () => Effect.die('unused'),
          recordReviewRun: (input) =>
            Effect.suspend(() => {
              recorded.push({ type: 'reviewRun', value: input })
              return Effect.succeed({
                id: makeReviewRunId('review-run-1'),
                ...input,
                createdAt: input.createdAt ?? 1,
              })
            }),
          recordReviewFinding: (input) =>
            Effect.suspend(() => {
              recorded.push({ type: 'finding', value: input })
              return Effect.succeed({
                id: makeReviewFindingId(`finding-${recorded.length}`),
                ...input,
                createdAt: input.createdAt ?? 1,
              })
            }),
          recordPolicyDecision: (input) =>
            Effect.suspend(() => {
              recorded.push({ type: 'policy', value: input })
              return Effect.succeed({
                id: makePolicyDecisionId('policy-1'),
                ...input,
                createdAt: input.createdAt ?? 1,
              })
            }),
          recordPublicationResult: (input) =>
            Effect.succeed({
              id: makePublicationResultId('publication-1'),
              ...input,
              createdAt: input.createdAt ?? 1,
            }),
          recordProvenanceEvent: (input) =>
            Effect.succeed({
              id: makeProvenanceEventId('provenance-1'),
              ...input,
              sequence: 1,
              artifactRefs: input.artifactRefs ?? [],
            }),
        }),
      )

      const result = yield* ProposeMergeDecision({
        workflowRunId,
        sandboxExecution,
        evidenceArtifacts: [diffArtifact],
        verificationResults: [
          {
            id: makeVerificationResultId('verification-result-1'),
            workflowRunId,
            requirementId: makeVerificationRequirementId(
              'verification-requirement-1',
            ),
            candidatePatchSetId: makeCandidatePatchSetId('candidate-1'),
            sandboxExecutionId: makeSandboxExecutionId('execution-1'),
            provider: 'daytona',
            command: 'bun test',
            platform: 'linux',
            architecture: 'x64',
            status: 'failed',
            exitCode: 2,
            summary: 'Test verification command failed with exit 2.',
            artifactIds: [],
            producedArtifactKinds: [],
            candidateDigestBefore: 'sha256:candidate',
            startedAt: 2,
            completedAt: 3,
          },
        ],
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            storageLayer,
            AlphaReviewServiceLayer,
            AlphaPolicyServiceLayer,
            cryptoLayer,
            telemetryLayer,
          ),
        ),
      )

      expect(result.reviewRun.reviewer).toBe('patchplane:alpha-reviewer')
      expect(result.findings).toHaveLength(2)
      expect(result.findings.map((finding) => finding.message)).toEqual([
        'Test verification command failed with exit 2.',
        'Sandbox command failed with exit 1.',
      ])
      expect(result.policyDecision).toMatchObject({
        status: 'changes-requested',
        reason: 'review:error',
      })
      expect(recorded.map((entry) => entry.type)).toEqual([
        'reviewRun',
        'finding',
        'finding',
        'policy',
      ])
      assert.deepStrictEqual(breadcrumbs, [
        { stage: 'review', status: 'started' },
        { stage: 'review', status: 'succeeded' },
        { stage: 'policy', status: 'started' },
        { stage: 'policy', status: 'succeeded' },
      ])
    }),
  )
})
