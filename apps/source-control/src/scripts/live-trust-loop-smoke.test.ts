import { describe, expect, test } from 'vitest'
import {
  type AcceptanceSnapshot,
  assertGitHubPublicationReadback,
  assertSnapshot,
  decodeDecisionPublicationReplayFixture,
  latestPublishedHumanDecision,
} from './live-trust-loop-smoke'

function acceptanceSnapshot(
  overrides: Partial<AcceptanceSnapshot> = {},
): AcceptanceSnapshot {
  return {
    workflowRunId: 'workflow-1',
    workflowStatus: 'reviewed',
    hasRuntimeEvents: true,
    hasRuntimeSessions: false,
    sandboxExecutionStatuses: ['succeeded'],
    latestSandboxExecution: {
      id: 'sandbox-1',
      status: 'succeeded',
      completedAt: 10,
    },
    evidenceArtifacts: [
      {
        id: 'artifact-1',
        kind: 'diff',
        storageKey: 'workflow-1/diff.patch',
        sizeBytes: 42,
        sha256:
          'e6ff7f597b8273fcf32be7311134f8ae97f0652a4fcac0d8049144a2b682e3d7',
        createdAt: 10,
      },
    ],
    candidatePatchStatuses: ['captured'],
    latestCandidatePatchSet: {
      id: 'candidate-1',
      status: 'captured',
      diffArtifactId: 'artifact-1',
      createdAt: 11,
    },
    reviewRunStatuses: ['completed'],
    latestReviewRun: {
      id: 'review-1',
      sandboxExecutionId: 'sandbox-1',
      candidatePatchSetId: 'candidate-1',
      status: 'completed',
      createdAt: 12,
    },
    policyDecisionStatuses: ['manual-review'],
    latestPolicyDecision: {
      status: 'manual-review',
      reviewRunId: 'review-1',
      createdAt: 13,
    },
    humanDecisions: [],
    publicationResults: [],
    hasProvenanceEvents: true,
    ...overrides,
  }
}

function fixture(status: 'published' | 'pending' = 'published') {
  return decodeDecisionPublicationReplayFixture({
    workflowStart: {
      promptRequest: {
        id: 'prompt-1',
        workspaceId: 'workos:workspace-1',
        actorId: 'github-app:1',
        traceId: 'trace-1',
        source: 'external',
        prompt: 'Inspect the patch',
        externalRef: {
          provider: 'github',
          deliveryId: 'delivery-1',
          eventKind: 'github.pull_request.synchronize',
          repositoryProvider: 'github',
          repositoryInstallationId: '1',
          repositoryOwner: 'patchplane',
          repositoryName: 'example',
          repositoryFullName: 'patchplane/example',
          issueNumber: 12,
          pullRequestHeadSha: 'abc123',
        },
        status: 'created',
        createdAt: 1,
      },
      workflowRun: {
        id: 'workflow-1',
        promptRequestId: 'prompt-1',
        workspaceId: 'workos:workspace-1',
        traceId: 'trace-1',
        status: 'reviewed',
        createdAt: 1,
      },
    },
    humanDecision: {
      id: 'decision-1',
      workflowRunId: 'workflow-1',
      actorId: 'workos:actor-1',
      status: 'approved',
      comment: 'Evidence reviewed.',
      decidedAt: 2,
      idempotencyKey: 'decision-attempt-1',
    },
    publicationResults: [
      {
        id: 'publication-comment',
        workflowRunId: 'workflow-1',
        provider: 'github',
        kind: 'issue-comment',
        status,
        externalId: '101',
        createdAt: 3,
        idempotencyKey: 'decision-1:issue-comment',
      },
      {
        id: 'publication-check',
        workflowRunId: 'workflow-1',
        provider: 'github',
        kind: 'check-run',
        status,
        externalId: '202',
        createdAt: 4,
        idempotencyKey: 'decision-1:check-run',
      },
    ],
  })
}

describe('trust-loop publication readback', () => {
  test('accepts the latest coherent review-ready record set', () => {
    expect(() => assertSnapshot(acceptanceSnapshot())).not.toThrow()
  })

  test('rejects stale successful records after a newer sandbox retry', () => {
    expect(() =>
      assertSnapshot(
        acceptanceSnapshot({
          sandboxExecutionStatuses: ['failed', 'succeeded'],
          latestSandboxExecution: {
            id: 'sandbox-new',
            status: 'failed',
            completedAt: 20,
          },
        }),
      ),
    ).toThrow('Candidate patch predates the latest sandbox execution')
  })

  test('rejects a review linked to an older candidate projection', () => {
    expect(() =>
      assertSnapshot(
        acceptanceSnapshot({
          latestReviewRun: {
            id: 'review-1',
            sandboxExecutionId: 'sandbox-1',
            candidatePatchSetId: 'candidate-old',
            status: 'completed',
            createdAt: 12,
          },
        }),
      ),
    ).toThrow('not linked to the latest sandbox and candidate patch')
  })

  test('rejects a policy decision linked to an older review', () => {
    expect(() =>
      assertSnapshot(
        acceptanceSnapshot({
          latestPolicyDecision: {
            status: 'manual-review',
            reviewRunId: 'review-old',
            createdAt: 13,
          },
        }),
      ),
    ).toThrow('not linked to the latest review')
  })

  test('accepts exactly one GitHub object matching each durable external ID', () => {
    expect(() =>
      assertGitHubPublicationReadback(fixture(), {
        issueComment: ['101'],
        checkRun: ['202'],
      }),
    ).not.toThrow()
  })

  test('rejects duplicate GitHub objects', () => {
    expect(() =>
      assertGitHubPublicationReadback(fixture(), {
        issueComment: ['101', '303'],
        checkRun: ['202'],
      }),
    ).toThrow('GitHub issue-comment readback')
  })

  test('does not let an older published decision mask the latest unpublished decision', () => {
    const snapshot = {
      workflowRunId: 'workflow-1',
      workflowStatus: 'reviewed' as const,
      hasRuntimeEvents: true,
      hasRuntimeSessions: false,
      sandboxExecutionStatuses: ['succeeded' as const],
      evidenceArtifacts: [],
      candidatePatchStatuses: ['captured' as const],
      reviewRunStatuses: ['completed' as const],
      policyDecisionStatuses: ['manual-review'],
      humanDecisions: [
        { id: 'decision-new', status: 'approved', decidedAt: 20 },
        { id: 'decision-old', status: 'approved', decidedAt: 10 },
      ],
      publicationResults: [
        {
          kind: 'issue-comment',
          status: 'published',
          externalId: '101',
          idempotencyKey: 'decision-old:issue-comment',
        },
      ],
      hasProvenanceEvents: true,
    }

    expect(latestPublishedHumanDecision(snapshot)).toBeUndefined()
  })

  test('refuses replay verification until every expected target is durable', () => {
    expect(() =>
      assertGitHubPublicationReadback(fixture('pending'), {
        issueComment: ['101'],
        checkRun: ['202'],
      }),
    ).toThrow('not durably published')
  })
})
