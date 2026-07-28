import { assert, describe, expect, it } from '@effect/vitest'
import { Effect, Layer, Option } from 'effect'
import {
  makePullRequestExternalId,
  makePullRequestNumber,
  makeRepositoryExternalId,
} from '@patchplane/domain/candidate-subject'
import { makeGitCommitSha } from '@patchplane/domain/refinements'
import {
  makeGitHubAppActorId,
  makePromptRequestId,
  makeSystemWorkspaceId,
  makeWorkflowRunId,
} from '@patchplane/domain/ids'
import { StorageService } from '../services/storage-service'
import { SourceControlService } from '../services/source-control-service'
import { TelemetryService } from '../services/telemetry-service'
import { StartWorkflowFromIntake } from './start-workflow-from-intake'

let verifiedRepository: unknown
let breadcrumbs: Array<{ readonly stage: string; readonly status: string }> = []

const TestStorageLayer = Layer.succeed(
  StorageService,
  StorageService.of({
    listRecentWorkflowStarts: () => Effect.succeed([]),
    claimWorkflowExecution: () => Effect.succeed(true),
    markWorkflowExecutionFailed: () => Effect.succeed(true),
    recordSandboxExecution: () => Effect.die('unused'),
    recordRuntimeEvents: () => Effect.die('unused'),
    recordRuntimeSessionStarted: () => Effect.die('unused'),
    markRuntimeSessionStatus: () => Effect.die('unused'),
    getActiveRuntimeSession: () => Effect.die('unused'),
    recordEvidenceArtifact: () => Effect.die('unused'),
    getEvidenceArtifact: () => Effect.die('unused'),
    getCandidatePatchSetForWorkflow: () => Effect.succeed(Option.none()),
    claimCandidateFreeze: () => Effect.succeed(false),
    releaseCandidateFreeze: () => Effect.succeed(false),
    failCandidateFreeze: () => Effect.succeed(true),
    claimIncomingDispatch: () => Effect.succeed(false),
    startIncomingDispatch: () => Effect.succeed(true),
    validateIncomingDispatch: () => Effect.succeed(false),
    recordCandidatePatchSet: () => Effect.die('unused'),
    recordVerificationPlan: () => Effect.die('unused verification plan'),
    recordVerificationRequirement: () => Effect.die('unused'),
    startIncomingVerificationPlan: () => Effect.die('unused'),
    claimVerificationExecutionGroup: () => Effect.die('unused'),
    startVerificationExecutionGroup: () => Effect.die('unused'),
    failVerificationExecutionGroup: () => Effect.die('unused'),
    getVerificationExecutionState: () => Effect.die('unused'),
    recordVerificationResult: () => Effect.die('unused'),
    recordReviewRun: () => Effect.die('unused'),
    recordReviewFinding: () => Effect.die('unused'),
    recordPolicyDecision: () => Effect.die('unused'),
    recordPublicationResult: () => Effect.die('unused'),
    recordProvenanceEvent: () => Effect.die('unused'),
    createWorkflowFromPrompt: () => Effect.die('unused'),
    createWorkflowFromIntake: (input) =>
      Effect.succeed({
        promptRequest: {
          id: makePromptRequestId('prompt-1'),
          workspaceId: input.workspaceId,
          actorId: input.actor.id,
          traceId: input.traceId,
          source: input.source,
          prompt: input.prompt,
          ...(input.externalRef === undefined
            ? {}
            : { externalRef: input.externalRef }),
          status: 'created',
          createdAt: 1,
        },
        workflowRun: {
          id: makeWorkflowRunId('workflow-1'),
          promptRequestId: makePromptRequestId('prompt-1'),
          workspaceId: input.workspaceId,
          traceId: input.traceId,
          status: 'queued',
          createdAt: 1,
        },
      }),
  }),
)

const TestTelemetryLayer = Layer.succeed(
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

const TestSourceControlLayer = Layer.succeed(
  SourceControlService,
  SourceControlService.of({
    verifyRepositoryAccess: (input) =>
      Effect.sync(() => {
        verifiedRepository = input
        return {
          provider: input.provider,
          ...(input.installationId === undefined
            ? {}
            : { installationId: input.installationId }),
          owner: input.owner,
          name: input.name,
          fullName: `${input.owner}/${input.name}`,
        }
      }),
    getInstallationAccount: () => Effect.die('unused'),
    listInstallationRepositories: () => Effect.die('unused'),
    createIssueComment: () => Effect.die('unused'),
    createCheckRun: () => Effect.die('unused'),
    createDraftPullRequest: () => Effect.die('unused'),
    fetchImmutableComparison: () => Effect.die('unused'),
    createRepositoryCloneCredentials: () => Effect.die('unused'),
  }),
)

describe('StartWorkflowFromIntake', () => {
  it.effect(
    'verifies repository access before storing external workflow intake',
    () =>
      Effect.gen(function* () {
        verifiedRepository = undefined
        breadcrumbs = []

        const result = yield* StartWorkflowFromIntake({
          actor: {
            id: makeGitHubAppActorId('123'),
            displayName: 'GitHub App installation 123',
          },
          workspaceId: makeSystemWorkspaceId('workspace-1'),
          source: 'external',
          traceId: 'trace-1',
          prompt: 'Fix the bug',
          externalRef: {
            provider: 'github',
            deliveryId: 'delivery-1',
            eventKind: 'github.pull_request.opened',
            repositoryProvider: 'github',
            repositoryInstallationId: '123',
            repositoryExternalId: makeRepositoryExternalId('456'),
            repositoryOwner: 'patchplane',
            repositoryName: 'demo',
            repositoryFullName: 'patchplane/demo',
            issueExternalId: '789',
            issueNumber: 7,
            pullRequestExternalId: makePullRequestExternalId('789'),
            pullRequestNumber: makePullRequestNumber(7),
            pullRequestUpdatedAt: 1_000,
            pullRequestBaseSha: makeGitCommitSha(
              'abcdefabcdefabcdefabcdefabcdefabcdefabcd',
            ),
            pullRequestHeadSha: makeGitCommitSha(
              '0123456789012345678901234567890123456789',
            ),
          },
        })

        expect(verifiedRepository).toEqual({
          provider: 'github',
          installationId: '123',
          owner: 'patchplane',
          name: 'demo',
        })
        expect(result.promptRequest.externalRef?.provider).toBe('github')
        expect(result.workflowRun.status).toBe('queued')
        assert.deepStrictEqual(breadcrumbs, [
          { stage: 'intake-accepted', status: 'succeeded' },
          { stage: 'attempt-created', status: 'started' },
          { stage: 'attempt-created', status: 'succeeded' },
        ])
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            TestStorageLayer,
            TestSourceControlLayer,
            TestTelemetryLayer,
          ),
        ),
      ),
  )

  it.effect(
    'rejects external intake without an authoritative source revision',
    () =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(
          StartWorkflowFromIntake({
            actor: {
              id: makeGitHubAppActorId('123'),
              displayName: 'GitHub App installation 123',
            },
            workspaceId: makeSystemWorkspaceId('workspace-1'),
            source: 'external',
            traceId: 'trace-unpinned',
            prompt: 'Fix the bug',
            externalRef: {
              provider: 'github',
              deliveryId: 'delivery-unpinned',
              eventKind: 'github.issue.opened',
            },
          }),
        )

        expect(error.message).toBe(
          'External workflow intake requires complete GitHub pull request identity with pinned base and head SHAs',
        )
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            TestStorageLayer,
            TestSourceControlLayer,
            TestTelemetryLayer,
          ),
        ),
      ),
  )
})
