import { assert, describe, it } from '@effect/vitest'
import { Crypto, Effect, Layer, Option, Schema } from 'effect'
import { CandidatePatchSet } from '@patchplane/domain/decision-review'
import {
  makePolicyDecisionId,
  makeReviewRunId,
  makeVerificationExecutionGroupId,
  makeVerificationPlanId,
  makeVerificationRequirementId,
  makeVerificationResultId,
} from '@patchplane/domain/ids'
import type {
  VerificationExecutionGroup,
  VerificationResult,
} from '@patchplane/domain/verification'
import { WorkflowStart } from '@patchplane/domain/workflow-start'
import { ArtifactsService } from '../services/artifacts-service'
import { PolicyService } from '../services/policy-service'
import { ReviewService } from '../services/review-service'
import { SandboxService } from '../services/sandbox-service'
import { SourceControlService } from '../services/source-control-service'
import { StorageService } from '../services/storage-service'
import { TelemetryService } from '../services/telemetry-service'
import { ClaimIncomingPullRequestDispatch } from './freeze-incoming-pull-request-candidate'
import { PersistConfiguredVerificationRequirements } from './persist-sandbox-verification-evidence'
import { RunIncomingVerificationPlan } from './run-incoming-verification-plan'

const baseSha = 'a'.repeat(40)
const headSha = 'b'.repeat(40)
const candidateDigest = `sha256:${'c'.repeat(64)}`
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
      eventKind: 'github.pull_request.opened',
      repositoryProvider: 'github',
      repositoryInstallationId: '123',
      repositoryExternalId: '456',
      repositoryOwner: 'patchplane',
      repositoryName: 'demo',
      repositoryFullName: 'patchplane/demo',
      pullRequestExternalId: '789',
      pullRequestNumber: 7,
      pullRequestBaseSha: baseSha,
      pullRequestHeadSha: headSha,
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
    status: 'running',
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
const candidate = Schema.decodeUnknownSync(CandidatePatchSet)({
  id: 'candidate-1',
  workflowRunId: 'run-1',
  subject: {
    kind: 'incoming-pull-request',
    repositoryProvider: 'github',
    repositoryExternalId: '456',
    repositoryOwner: 'patchplane',
    repositoryName: 'demo',
    repositoryFullName: 'patchplane/demo',
    pullRequestExternalId: '789',
    pullRequestNumber: 7,
    baseSha,
    headSha,
    sourceEventProvider: 'github',
    sourceEventDeliveryId: 'delivery-1',
    sourceEventKind: 'github.pull_request.opened',
  },
  status: 'captured',
  candidateDigest,
  baseSha,
  headSha,
  diffArtifactId: 'artifact-diff',
  createdAt: 1,
})

function dieUnused() {
  return Effect.die('unused')
}

describe('RunIncomingVerificationPlan', () => {
  it.effect(
    'creates one stable non-shared group and blocked result per unsupported requirement',
    () => {
      const claims: Array<{
        readonly stableKey: string
        readonly provider: string
      }> = []
      const groups: Array<VerificationExecutionGroup> = []
      const results: Array<VerificationResult> = []
      let planSequence = 0
      let requirementSequence = 0
      const storage = StorageService.of({
        createWorkflowFromIntake: dieUnused,
        createWorkflowFromPrompt: dieUnused,
        listRecentWorkflowStarts: () => Effect.succeed([]),
        claimWorkflowExecution: () => Effect.succeed(false),
        markWorkflowExecutionFailed: () => Effect.succeed(false),
        recordSandboxExecution: dieUnused,
        recordRuntimeEvents: () => Effect.succeed([]),
        recordRuntimeSessionStarted: dieUnused,
        markRuntimeSessionStatus: dieUnused,
        getActiveRuntimeSession: () => Effect.succeed(Option.none()),
        recordEvidenceArtifact: dieUnused,
        getEvidenceArtifact: () => Effect.succeed(Option.none()),
        getCandidatePatchSetForWorkflow: () =>
          Effect.succeed(Option.some(candidate)),
        claimCandidateFreeze: () => Effect.succeed(false),
        releaseCandidateFreeze: () => Effect.succeed(false),
        failCandidateFreeze: () => Effect.succeed(false),
        claimIncomingDispatch: () => Effect.succeed(true),
        validateIncomingDispatch: () => Effect.succeed(true),
        startIncomingDispatch: () => Effect.succeed(false),
        recordCandidatePatchSet: dieUnused,
        recordVerificationPlan: (input) =>
          Effect.sync(() => ({
            id: makeVerificationPlanId(`plan-${++planSequence}`),
            workflowRunId: input.workflowRunId,
            version: input.version,
            sources: input.sources,
            requirements: input.requirements,
            digest: input.digest,
            createdAt: input.createdAt,
          })),
        recordVerificationRequirement: (input) =>
          Effect.sync(() => ({
            id: makeVerificationRequirementId(
              `requirement-${++requirementSequence}`,
            ),
            workflowRunId: input.workflowRunId,
            ...(input.verificationPlanId === undefined
              ? {}
              : { verificationPlanId: input.verificationPlanId }),
            key: input.key,
            label: input.label,
            kind: input.kind,
            required: input.required,
            ...(input.command === undefined ? {} : { command: input.command }),
            ...(input.platform === undefined
              ? {}
              : { platform: input.platform }),
            ...(input.architecture === undefined
              ? {}
              : { architecture: input.architecture }),
            ...(input.timeoutSeconds === undefined
              ? {}
              : { timeoutSeconds: input.timeoutSeconds }),
            requiredArtifactKinds: input.requiredArtifactKinds,
            source: input.source,
            createdAt: input.createdAt,
          })),
        startIncomingVerificationPlan: () => Effect.succeed(true),
        claimVerificationExecutionGroup: (input) =>
          Effect.sync(() => {
            claims.push({
              stableKey: input.stableKey,
              provider: input.provider,
            })
            const group: VerificationExecutionGroup = {
              id: makeVerificationExecutionGroupId(`group-${claims.length}`),
              workflowRunId: input.workflowRunId,
              verificationPlanId: input.verificationPlanId,
              requirementId: input.requirementId,
              candidatePatchSetId: input.candidatePatchSetId,
              stableKey: input.stableKey,
              provider: input.provider,
              platform: input.platform,
              architecture: input.architecture,
              ...(input.commandDigest === undefined
                ? {}
                : { commandDigest: input.commandDigest }),
              ...(input.timeoutSeconds === undefined
                ? {}
                : { timeoutSeconds: input.timeoutSeconds }),
              sharedState: false,
              status: 'claimed',
              claimedAt: input.claimedAt,
            }
            groups.push(group)
            return group
          }),
        startVerificationExecutionGroup: () => Effect.succeed(false),
        recordVerificationExecutionCommand: () => Effect.succeed(true),
        failVerificationExecutionGroup: () => Effect.succeed(false),
        recordVerificationResult: (input) =>
          Effect.sync(() => {
            const result: VerificationResult = {
              id: makeVerificationResultId(`result-${results.length}`),
              workflowRunId: input.workflowRunId,
              ...(input.verificationPlanId === undefined
                ? {}
                : { verificationPlanId: input.verificationPlanId }),
              ...(input.executionGroupId === undefined
                ? {}
                : { executionGroupId: input.executionGroupId }),
              requirementId: input.requirementId,
              candidatePatchSetId: input.candidatePatchSetId,
              provider: input.provider,
              ...(input.command === undefined
                ? {}
                : { command: input.command }),
              platform: input.platform,
              architecture: input.architecture,
              status: input.status,
              artifactIds: input.artifactIds,
              producedArtifactKinds: input.producedArtifactKinds,
              ...(input.cleanupStatus === undefined
                ? {}
                : { cleanupStatus: input.cleanupStatus }),
              candidateDigestBefore: input.candidateDigestBefore,
              candidateDigestAfter: input.candidateDigestAfter,
              startedAt: input.startedAt,
              completedAt: input.completedAt,
              idempotencyKey: input.idempotencyKey,
            }
            results.push(result)
            const group = groups.find(
              (candidateGroup) => candidateGroup.id === input.executionGroupId,
            )
            if (group !== undefined) {
              groups[groups.indexOf(group)] = {
                ...group,
                status: input.status === 'blocked' ? 'blocked' : 'failed',
                completedAt: input.completedAt ?? input.startedAt,
              }
            }
            return result
          }),
        getVerificationExecutionState: () =>
          Effect.succeed({ groups, results, sandboxExecutions: [] }),
        recordReviewRun: (input) =>
          Effect.succeed({
            id: makeReviewRunId('review-1'),
            workflowRunId: input.workflowRunId,
            ...(input.sandboxExecutionId === undefined
              ? {}
              : { sandboxExecutionId: input.sandboxExecutionId }),
            ...(input.candidatePatchSetId === undefined
              ? {}
              : { candidatePatchSetId: input.candidatePatchSetId }),
            kind: input.kind,
            reviewer: input.reviewer,
            status: input.status,
            ...(input.summary === undefined ? {} : { summary: input.summary }),
            startedAt: input.startedAt,
            ...(input.completedAt === undefined
              ? {}
              : { completedAt: input.completedAt }),
            idempotencyKey: input.idempotencyKey,
            createdAt: input.createdAt ?? input.startedAt,
          }),
        recordReviewFinding: dieUnused,
        recordPolicyDecision: (input) =>
          Effect.succeed({
            id: makePolicyDecisionId('policy-1'),
            workflowRunId: input.workflowRunId,
            ...(input.reviewRunId === undefined
              ? {}
              : { reviewRunId: input.reviewRunId }),
            ...(input.candidatePatchSetId === undefined
              ? {}
              : { candidatePatchSetId: input.candidatePatchSetId }),
            status: input.status,
            summary: input.summary,
            ...(input.reason === undefined ? {} : { reason: input.reason }),
            ...(input.policyVersion === undefined
              ? {}
              : { policyVersion: input.policyVersion }),
            ...(input.inputDigest === undefined
              ? {}
              : { inputDigest: input.inputDigest }),
            verificationResultIds: input.verificationResultIds ?? [],
            reviewFindingIds: input.reviewFindingIds ?? [],
            missingRequirementIds: input.missingRequirementIds ?? [],
            idempotencyKey: input.idempotencyKey,
            createdAt: input.createdAt ?? 1,
          }),
        recordPublicationResult: dieUnused,
        recordProvenanceEvent: dieUnused,
      })
      const layer = Layer.mergeAll(
        Layer.succeed(StorageService, storage),
        Layer.succeed(
          Crypto.Crypto,
          Crypto.make({
            randomBytes: (size) => new Uint8Array(size).fill(7),
            digest: () => Effect.succeed(new Uint8Array(32).fill(8)),
          }),
        ),
        Layer.succeed(
          SourceControlService,
          SourceControlService.of({
            verifyRepositoryAccess: dieUnused,
            getInstallationAccount: dieUnused,
            listInstallationRepositories: dieUnused,
            createIssueComment: dieUnused,
            createCheckRun: dieUnused,
            createDraftPullRequest: dieUnused,
            createRepositoryCloneCredentials: () =>
              Effect.succeed({ username: 'x-access-token', password: 'token' }),
            fetchImmutableComparison: dieUnused,
          }),
        ),
        Layer.succeed(
          SandboxService,
          SandboxService.of({
            runRepositoryAgent: dieUnused,
            runRepositoryCommand: dieUnused,
            abortRuntimeSession: dieUnused,
            steerRuntimeSession: dieUnused,
            followUpRuntimeSession: dieUnused,
            terminateRuntimeSession: dieUnused,
          }),
        ),
        Layer.succeed(
          PolicyService,
          PolicyService.of({
            evaluatePolicy: () =>
              Effect.succeed({
                status: 'manual-review',
                summary: 'Blocked requirements require manual review.',
              }),
          }),
        ),
        Layer.succeed(
          ReviewService,
          ReviewService.of({
            runReview: () =>
              Effect.succeed({
                kind: 'manual',
                reviewer: 'patchplane:test',
                summary: 'No automated review findings.',
                findings: [],
              }),
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
        Layer.succeed(
          ArtifactsService,
          ArtifactsService.of({
            putArtifact: dieUnused,
            getArtifactMetadata: dieUnused,
            createSignedReadUrl: dieUnused,
            deleteArtifact: dieUnused,
            applyRetentionPolicy: dieUnused,
          }),
        ),
      )

      return Effect.gen(function* () {
        const persisted = yield* PersistConfiguredVerificationRequirements({
          workflowRunId: workflowStart.workflowRun.id,
          workspacePolicy: {
            source: {
              kind: 'workspace-policy',
              workspaceId: workflowStart.workflowRun.workspaceId,
              revision: 'workspace-policy-1',
            },
            requirements: [
              {
                key: 'windows:test',
                label: 'Windows test',
                kind: 'test',
                required: true,
                command: 'bun test',
                platform: 'windows',
                architecture: 'x86_64',
                timeoutSeconds: 60,
                requiredArtifactKinds: [],
              },
              {
                key: 'macos:build',
                label: 'macOS build',
                kind: 'build',
                required: true,
                command: 'bun run build',
                platform: 'macos',
                architecture: 'arm64',
                timeoutSeconds: 60,
                requiredArtifactKinds: [],
              },
            ],
          },
          createdAt: 1,
          traceId: workflowStart.workflowRun.traceId,
          operation: 'test.persistPlan',
        })
        const dispatch = yield* ClaimIncomingPullRequestDispatch({
          workflowStart,
          candidatePatchSet: candidate,
        })
        assert.isDefined(dispatch)
        const execution = yield* RunIncomingVerificationPlan({
          workflowStart,
          incomingDispatch: dispatch,
          verificationPlan: persisted,
        })

        assert.deepStrictEqual(execution.sandboxExecutions, [])
        assert.strictEqual(claims.length, 2)
        assert.strictEqual(
          new Set(claims.map((claim) => claim.stableKey)).size,
          2,
        )
        assert.ok(claims.every((claim) => claim.provider === 'daytona'))
        assert.deepStrictEqual(
          results.map((result) => result.status),
          ['blocked', 'blocked'],
        )
        assert.ok(
          results.every(
            (result) =>
              result.cleanupStatus === 'not-started' &&
              result.candidateDigestBefore === candidateDigest &&
              result.candidateDigestAfter === candidateDigest,
          ),
        )
      }).pipe(Effect.provide(layer))
    },
  )
})
