import { assert, describe, expect, it } from '@effect/vitest'
import { Effect, Layer, Option } from 'effect'
import { makePullRequestNumber } from '@patchplane/domain/candidate-subject'
import {
  makeCandidatePatchSetId,
  makeGitHubAppActorId,
  makeHumanDecisionId,
  makePromptRequestId,
  makeProvenanceEventId,
  makePublicationResultId,
  makeSandboxExecutionId,
  makeSystemActorId,
  makeWorkOSWorkspaceId,
  makeWorkflowRunId,
} from '@patchplane/domain/ids'
import { SourceControlError, StorageError } from '@patchplane/domain/errors'
import { makeGitCommitSha } from '@patchplane/domain/refinements'
import { SourceControlService } from '../services/source-control-service'
import { StorageService } from '../services/storage-service'
import { TelemetryService } from '../services/telemetry-service'
import { PublishDecisionToSource } from './publish-decision-to-source'

const workflowRunId = makeWorkflowRunId('run-1')
const baseSha = makeGitCommitSha('a'.repeat(40))
const headSha = makeGitCommitSha('b'.repeat(40))
const workflowStart = {
  promptRequest: {
    id: makePromptRequestId('prompt-1'),
    workspaceId: makeWorkOSWorkspaceId('org_123'),
    actorId: makeGitHubAppActorId('123'),
    traceId: 'trace-1',
    source: 'external' as const,
    prompt: 'Fix auth callback',
    externalRef: {
      provider: 'github',
      deliveryId: 'delivery-1',
      eventKind: 'github.pull_request.synchronize',
      repositoryProvider: 'github',
      repositoryInstallationId: '123',
      repositoryOwner: 'patchplane',
      repositoryName: 'demo',
      repositoryFullName: 'patchplane/demo',
      issueNumber: 12,
      pullRequestNumber: makePullRequestNumber(12),
      pullRequestHeadSha: headSha,
    },
    status: 'created' as const,
    createdAt: 1,
  },
  workflowRun: {
    id: workflowRunId,
    promptRequestId: makePromptRequestId('prompt-1'),
    workspaceId: makeWorkOSWorkspaceId('org_123'),
    traceId: 'trace-1',
    status: 'reviewed' as const,
    createdAt: 1,
  },
}

const sandboxExecution = {
  id: makeSandboxExecutionId('sandbox-1'),
  workflowRunId,
  provider: 'daytona',
  sandboxId: 'sandbox-1',
  command: 'bun test',
  status: 'succeeded' as const,
  exitCode: 0,
  stdout: 'ok',
  startedAt: 2,
  completedAt: 3,
}

const candidatePatchSet = {
  id: makeCandidatePatchSetId('candidate-1'),
  workflowRunId,
  sandboxExecutionId: sandboxExecution.id,
  status: 'captured' as const,
  candidateDigest: 'sha256:candidate',
  baseSha,
  headSha,
  createdAt: 4,
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

const humanDecision = {
  id: makeHumanDecisionId('decision-1'),
  workflowRunId,
  actorId: makeSystemActorId('reviewer-1'),
  status: 'approved' as const,
  comment: 'Ship it.',
  decidedAt: 10,
}

describe('PublishDecisionToSource', () => {
  it.effect(
    'publishes a decision comment and check run, then records publication provenance',
    () =>
      Effect.gen(function* () {
        breadcrumbs = []
        const sourceCalls: Array<{
          readonly type: string
          readonly input: unknown
        }> = []
        const storageRecords: Array<{
          readonly type: string
          readonly input: unknown
        }> = []
        const publicationOrder: Array<string> = []

        const sourceControlLayer = Layer.succeed(
          SourceControlService,
          SourceControlService.of({
            verifyRepositoryAccess: () => Effect.die('unused'),
            getInstallationAccount: () => Effect.die('unused'),
            listInstallationRepositories: () => Effect.die('unused'),
            createRepositoryCloneCredentials: () => Effect.die('unused'),
            fetchImmutableComparison: () => Effect.die('unused'),
            createDraftPullRequest: () => Effect.die('unused'),
            createIssueComment: (input) =>
              Effect.sync(() => {
                sourceCalls.push({ type: 'issue-comment', input })
                publicationOrder.push('source:issue-comment')
                return {
                  externalId: 'comment-1',
                  url: 'https://github.test/comment/1',
                }
              }),
            createCheckRun: (input) =>
              Effect.sync(() => {
                sourceCalls.push({ type: 'check-run', input })
                publicationOrder.push('source:check-run')
                return {
                  externalId: 'check-1',
                  url: 'https://github.test/check/1',
                }
              }),
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
            recordCandidatePatchSet: () =>
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
            claimWorkflowExecution: () => Effect.succeed(true),
            markWorkflowExecutionFailed: () => Effect.succeed(true),
            recordVerificationPlan: () =>
              Effect.die('unused verification plan'),
            recordVerificationRequirement: () => Effect.die('unused'),
            startIncomingVerificationPlan: () => Effect.die('unused'),
            claimVerificationExecutionGroup: () => Effect.die('unused'),
            startVerificationExecutionGroup: () => Effect.die('unused'),
            failVerificationExecutionGroup: () => Effect.die('unused'),
            getVerificationExecutionState: () => Effect.die('unused'),
            recordVerificationResult: () => Effect.die('unused'),
            getCandidatePatchSetForWorkflow: () =>
              Effect.succeed(Option.none()),
            claimCandidateFreeze: () => Effect.succeed(false),
            releaseCandidateFreeze: () => Effect.succeed(false),
            failCandidateFreeze: () => Effect.succeed(true),
            claimIncomingDispatch: () => Effect.succeed(false),
            startIncomingDispatch: () => Effect.succeed(true),
            validateIncomingDispatch: () => Effect.succeed(false),
            recordPublicationResult: (input) =>
              Effect.suspend(() => {
                storageRecords.push({ type: 'publication', input })
                publicationOrder.push(`storage:${input.kind}:${input.status}`)
                return Effect.succeed({
                  id: makePublicationResultId(
                    `publication-${storageRecords.length}`,
                  ),
                  ...input,
                  createdAt: input.createdAt ?? 1,
                })
              }),
            recordProvenanceEvent: (input) =>
              Effect.suspend(() => {
                storageRecords.push({ type: 'provenance', input })
                return Effect.succeed({
                  id: makeProvenanceEventId('provenance-1'),
                  ...input,
                  sequence: 1,
                  artifactRefs: input.artifactRefs ?? [],
                })
              }),
          }),
        )

        const result = yield* PublishDecisionToSource({
          traceId: 'trace-1',
          workflowStart,
          humanDecision,
          sandboxExecution,
          candidatePatchSet,
        }).pipe(
          Effect.provide(
            Layer.mergeAll(sourceControlLayer, storageLayer, telemetryLayer),
          ),
        )

        expect(sourceCalls.map((call) => call.type)).toEqual([
          'issue-comment',
          'check-run',
        ])
        expect(
          storageRecords.filter((record) => record.type === 'publication'),
        ).toHaveLength(4)
        expect(
          storageRecords.filter((record) => record.type === 'provenance'),
        ).toHaveLength(1)
        expect(
          storageRecords
            .filter((record) => record.type === 'publication')
            .map(
              (record) =>
                (record.input as { readonly idempotencyKey?: string })
                  .idempotencyKey,
            ),
        ).toEqual([
          'decision-1:issue-comment',
          'decision-1:issue-comment',
          'decision-1:check-run',
          'decision-1:check-run',
        ])
        expect(publicationOrder).toEqual([
          'storage:issue-comment:pending',
          'source:issue-comment',
          'storage:issue-comment:published',
          'storage:check-run:pending',
          'source:check-run',
          'storage:check-run:published',
        ])
        assert.deepStrictEqual(breadcrumbs, [
          { stage: 'publication-claim', status: 'started' },
          { stage: 'publication-claim', status: 'succeeded' },
          { stage: 'publication-result', status: 'started' },
          { stage: 'publication-result', status: 'succeeded' },
          { stage: 'publication-claim', status: 'started' },
          { stage: 'publication-claim', status: 'succeeded' },
          { stage: 'publication-result', status: 'started' },
          { stage: 'publication-result', status: 'succeeded' },
        ])
        expect(result.publications).toHaveLength(2)
        expect(
          result.publications.map((publication) => publication.status),
        ).toEqual(['published', 'published'])
      }),
  )

  it.effect('repairs failed targets and aggregate provenance on retry', () =>
    Effect.gen(function* () {
      breadcrumbs = []
      const sourceCalls: Array<string> = []
      const recordedPublications: Array<{
        readonly id: ReturnType<typeof makePublicationResultId>
        readonly idempotencyKey?: string
        readonly kind:
          | 'issue-comment'
          | 'check-run'
          | 'draft-pull-request'
          | 'branch'
        readonly status: 'pending' | 'published' | 'failed'
      }> = []
      const provenanceRecords: Array<{
        readonly status: string
        readonly summary?: string | undefined
        readonly artifactRefs?: ReadonlyArray<string> | undefined
      }> = []
      let checkAttempts = 0
      let returnExistingPublicationClaim = false
      const sourceControlLayer = Layer.succeed(
        SourceControlService,
        SourceControlService.of({
          verifyRepositoryAccess: () => Effect.die('unused'),
          getInstallationAccount: () => Effect.die('unused'),
          listInstallationRepositories: () => Effect.die('unused'),
          createRepositoryCloneCredentials: () => Effect.die('unused'),
          fetchImmutableComparison: () => Effect.die('unused'),
          createDraftPullRequest: () => Effect.die('unused'),
          createIssueComment: () =>
            Effect.sync(() => {
              sourceCalls.push('issue-comment')
              return {
                externalId: 'comment-1',
                url: 'https://github.test/comment/1',
              }
            }),
          createCheckRun: () =>
            Effect.suspend(() => {
              sourceCalls.push('check-run')
              checkAttempts += 1
              if (checkAttempts === 1) {
                return Effect.fail(
                  new SourceControlError({
                    operation: 'createCheckRun.test',
                    message: 'temporary failure',
                    cause: undefined,
                  }),
                )
              }
              return Effect.succeed({
                externalId: 'check-1',
                url: 'https://github.test/check/1',
              })
            }),
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
          recordCandidatePatchSet: () =>
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
          claimWorkflowExecution: () => Effect.succeed(true),
          markWorkflowExecutionFailed: () => Effect.succeed(true),
          recordVerificationPlan: () => Effect.die('unused verification plan'),
          recordVerificationRequirement: () => Effect.die('unused'),
          startIncomingVerificationPlan: () => Effect.die('unused'),
          claimVerificationExecutionGroup: () => Effect.die('unused'),
          startVerificationExecutionGroup: () => Effect.die('unused'),
          failVerificationExecutionGroup: () => Effect.die('unused'),
          getVerificationExecutionState: () => Effect.die('unused'),
          recordVerificationResult: () => Effect.die('unused'),
          getCandidatePatchSetForWorkflow: () => Effect.succeed(Option.none()),
          claimCandidateFreeze: () => Effect.succeed(false),
          releaseCandidateFreeze: () => Effect.succeed(false),
          failCandidateFreeze: () => Effect.succeed(true),
          claimIncomingDispatch: () => Effect.succeed(false),
          startIncomingDispatch: () => Effect.succeed(true),
          validateIncomingDispatch: () => Effect.succeed(false),
          recordPublicationResult: (input) =>
            Effect.suspend(() => {
              const id = makePublicationResultId(
                `publication-${recordedPublications.length + 1}`,
              )
              if (
                returnExistingPublicationClaim &&
                input.status === 'pending'
              ) {
                return Effect.succeed({
                  id,
                  ...input,
                  status: 'published' as const,
                  dispatchToken: 'another-dispatch',
                  externalId: `existing-${input.kind}`,
                  createdAt: input.createdAt ?? 1,
                })
              }
              recordedPublications.push({
                id,
                kind: input.kind,
                status: input.status,
                ...(input.idempotencyKey === undefined
                  ? {}
                  : { idempotencyKey: input.idempotencyKey }),
              })
              return Effect.succeed({
                id: makePublicationResultId(id),
                ...input,
                createdAt: input.createdAt ?? 1,
              })
            }),
          recordProvenanceEvent: (input) => {
            provenanceRecords.push(input)
            return Effect.succeed({
              id: makeProvenanceEventId('provenance-1'),
              ...input,
              sequence: 1,
              artifactRefs: input.artifactRefs ?? [],
            })
          },
        }),
      )

      yield* PublishDecisionToSource({
        traceId: 'trace-1',
        workflowStart,
        humanDecision,
        sandboxExecution,
        candidatePatchSet,
      }).pipe(
        Effect.provide(
          Layer.mergeAll(sourceControlLayer, storageLayer, telemetryLayer),
        ),
      )

      expect(provenanceRecords.at(-1)).toMatchObject({
        status: 'failed',
        summary: 'Published 1/2 decision publication targets.',
      })
      assert.deepStrictEqual(breadcrumbs, [
        { stage: 'publication-claim', status: 'started' },
        { stage: 'publication-claim', status: 'succeeded' },
        { stage: 'publication-result', status: 'started' },
        { stage: 'publication-result', status: 'succeeded' },
        { stage: 'publication-claim', status: 'started' },
        { stage: 'publication-claim', status: 'succeeded' },
        { stage: 'publication-result', status: 'started' },
        { stage: 'publication-result', status: 'failed' },
      ])

      sourceCalls.length = 0
      breadcrumbs = []
      const retry = yield* PublishDecisionToSource({
        traceId: 'trace-2',
        workflowStart,
        humanDecision: { ...humanDecision, decidedAt: 11 },
        sandboxExecution,
        candidatePatchSet,
        publicationResults: recordedPublications
          .filter((publication) => publication.status !== 'pending')
          .map((publication) => ({
            id: publication.id,
            workflowRunId,
            provider: 'github',
            kind: publication.kind,
            status: publication.status,
            createdAt: 10,
            idempotencyKey: publication.idempotencyKey,
          })),
      }).pipe(
        Effect.provide(
          Layer.mergeAll(sourceControlLayer, storageLayer, telemetryLayer),
        ),
      )

      expect(sourceCalls).toEqual(['check-run'])
      expect(retry.publications).toEqual([
        expect.objectContaining({ kind: 'check-run', status: 'published' }),
      ])
      assert.deepStrictEqual(breadcrumbs, [
        { stage: 'publication-claim', status: 'started' },
        { stage: 'publication-claim', status: 'succeeded' },
        { stage: 'publication-result', status: 'started' },
        { stage: 'publication-result', status: 'succeeded' },
      ])
      expect(provenanceRecords.at(-1)).toMatchObject({
        status: 'succeeded',
        summary: 'Published 2/2 decision publication targets.',
        artifactRefs: expect.arrayContaining(['decision-1', 'publication-2']),
      })

      sourceCalls.length = 0
      breadcrumbs = []
      returnExistingPublicationClaim = true
      yield* PublishDecisionToSource({
        traceId: 'trace-racing-replay',
        workflowStart,
        humanDecision: {
          ...humanDecision,
          id: makeHumanDecisionId('decision-racing-replay'),
          decidedAt: 12,
        },
        sandboxExecution,
        candidatePatchSet,
      }).pipe(
        Effect.provide(
          Layer.mergeAll(sourceControlLayer, storageLayer, telemetryLayer),
        ),
      )

      assert.deepStrictEqual(sourceCalls, [])
      assert.deepStrictEqual(breadcrumbs, [
        { stage: 'publication-claim', status: 'started' },
        { stage: 'publication-claim', status: 'blocked' },
        { stage: 'publication-claim', status: 'started' },
        { stage: 'publication-claim', status: 'blocked' },
      ])
    }),
  )

  it.effect(
    'publishes a later decision even when actor, status, and comment match',
    () =>
      Effect.gen(function* () {
        const sourceCalls: Array<string> = []
        const sourceControlLayer = Layer.succeed(
          SourceControlService,
          SourceControlService.of({
            verifyRepositoryAccess: () => Effect.die('unused'),
            getInstallationAccount: () => Effect.die('unused'),
            listInstallationRepositories: () => Effect.die('unused'),
            createRepositoryCloneCredentials: () => Effect.die('unused'),
            fetchImmutableComparison: () => Effect.die('unused'),
            createDraftPullRequest: () => Effect.die('unused'),
            createIssueComment: () =>
              Effect.sync(() => {
                sourceCalls.push('issue-comment')
                return {
                  externalId: 'comment-2',
                  url: 'https://github.test/comment/2',
                }
              }),
            createCheckRun: () =>
              Effect.sync(() => {
                sourceCalls.push('check-run')
                return {
                  externalId: 'check-2',
                  url: 'https://github.test/check/2',
                }
              }),
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
            recordCandidatePatchSet: () =>
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
            claimWorkflowExecution: () => Effect.succeed(true),
            markWorkflowExecutionFailed: () => Effect.succeed(true),
            recordVerificationPlan: () =>
              Effect.die('unused verification plan'),
            recordVerificationRequirement: () => Effect.die('unused'),
            startIncomingVerificationPlan: () => Effect.die('unused'),
            claimVerificationExecutionGroup: () => Effect.die('unused'),
            startVerificationExecutionGroup: () => Effect.die('unused'),
            failVerificationExecutionGroup: () => Effect.die('unused'),
            getVerificationExecutionState: () => Effect.die('unused'),
            recordVerificationResult: () => Effect.die('unused'),
            getCandidatePatchSetForWorkflow: () =>
              Effect.succeed(Option.none()),
            claimCandidateFreeze: () => Effect.succeed(false),
            releaseCandidateFreeze: () => Effect.succeed(false),
            failCandidateFreeze: () => Effect.succeed(true),
            claimIncomingDispatch: () => Effect.succeed(false),
            startIncomingDispatch: () => Effect.succeed(true),
            validateIncomingDispatch: () => Effect.succeed(false),
            recordPublicationResult: (input) =>
              Effect.succeed({
                id: makePublicationResultId(`publication-${input.kind}`),
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

        const result = yield* PublishDecisionToSource({
          traceId: 'trace-2',
          workflowStart,
          humanDecision: {
            ...humanDecision,
            id: makeHumanDecisionId('decision-2'),
            decidedAt: 11,
          },
          sandboxExecution,
          candidatePatchSet,
          publicationResults: [
            {
              id: makePublicationResultId('publication-1'),
              workflowRunId,
              provider: 'github',
              kind: 'issue-comment',
              status: 'published',
              createdAt: 10,
              idempotencyKey: 'decision-1:issue-comment',
            },
            {
              id: makePublicationResultId('publication-2'),
              workflowRunId,
              provider: 'github',
              kind: 'check-run',
              status: 'published',
              createdAt: 10,
              idempotencyKey: 'decision-1:check-run',
            },
          ],
        }).pipe(
          Effect.provide(
            Layer.mergeAll(sourceControlLayer, storageLayer, telemetryLayer),
          ),
        )

        expect(sourceCalls).toEqual(['issue-comment', 'check-run'])
        expect(
          result.publications.map((publication) => publication.idempotencyKey),
        ).toEqual(['decision-2:issue-comment', 'decision-2:check-run'])
      }),
  )
})
