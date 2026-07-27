import { describe, expect, test } from 'vitest'
import type { WorkflowDetail } from './types'
import { deriveWorkflowTrustSummary } from './workflow-trust-summary'

function reviewedDetail(): WorkflowDetail {
  return {
    workflowRun: {
      id: 'workflow-1',
      promptRequestId: 'prompt-1',
      workspaceId: 'workspace-1',
      traceId: 'trace-1',
      status: 'reviewed',
      createdAt: 1,
    },
    promptRequest: {
      id: 'prompt-1',
      workspaceId: 'workspace-1',
      actorId: 'actor-1',
      traceId: 'trace-1',
      source: 'external',
      prompt: 'Update the dependency',
      status: 'created',
      createdAt: 1,
    },
    runtimeEvents: [],
    runtimeEventsTruncated: false,
    runtimeSessions: [],
    sandboxExecutions: [
      {
        id: 'execution-1',
        workflowRunId: 'workflow-1',
        provider: 'daytona',
        sandboxId: 'sandbox-1',
        command: 'bun test',
        status: 'succeeded',
        exitCode: 0,
        stdout: 'Tests passed.',
        startedAt: 2,
        completedAt: 3,
      },
    ],
    evidenceArtifacts: [],
    candidatePatchSets: [
      {
        id: 'candidate-1',
        workflowRunId: 'workflow-1',
        status: 'captured',
        createdAt: 3,
      },
    ],
    verificationRequirements: [],
    verificationRequirementsTruncated: false,
    verificationResults: [],
    verificationResultsTruncated: false,
    reviewRuns: [
      {
        id: 'review-1',
        workflowRunId: 'workflow-1',
        sandboxExecutionId: 'execution-1',
        candidatePatchSetId: 'candidate-1',
        kind: 'test',
        reviewer: 'patchplane:test-reviewer',
        status: 'completed',
        startedAt: 3,
        completedAt: 4,
        createdAt: 3,
      },
    ],
    reviewFindings: [],
    policyDecisions: [
      {
        id: 'policy-1',
        workflowRunId: 'workflow-1',
        reviewRunId: 'review-1',
        status: 'manual-review',
        summary: 'A maintainer must decide.',
        createdAt: 4,
      },
    ],
    humanDecisions: [],
    publicationResults: [],
    provenanceEvents: [],
  }
}

describe('deriveWorkflowTrustSummary', () => {
  test('explains an alpha manual-review verdict in a stable scan order', () => {
    const summary = deriveWorkflowTrustSummary(reviewedDetail())

    expect(summary.label).toBe('Needs review')
    expect(summary.reasons).toEqual([
      'Required verification is not configured.',
      'Policy requires human review.',
      'Human decision is pending.',
    ])
    expect(
      summary.dimensions.map(({ label, status }) => ({ label, status })),
    ).toEqual([
      { label: 'Execution', status: 'Passed' },
      { label: 'Required verification', status: 'Not configured' },
      { label: 'Automated review', status: 'Completed' },
      { label: 'Policy', status: 'Manual review' },
      { label: 'Human decision', status: 'Pending' },
    ])
    expect(summary.dimensions[2]?.detail).toBe('0 blocking review findings.')
    expect(summary.dimensions[2]?.tone).toBe('neutral')
    expect(summary.dimensions[3]?.detail).toBe(
      'Required verification is not configured; policy requires human review.',
    )
  })

  test('reduces a fully verified projection to the outstanding human decision', () => {
    const detail = reviewedDetail()
    detail.verificationRequirements = [
      {
        id: 'requirement-1',
        workflowRunId: 'workflow-1',
        key: 'tests',
        label: 'Tests',
        kind: 'test',
        required: true,
        requiredArtifactKinds: ['test-report'],
        source: 'repository-config',
        createdAt: 3,
      },
    ]
    detail.verificationResults = [
      {
        id: 'result-1',
        workflowRunId: 'workflow-1',
        requirementId: 'requirement-1',
        candidatePatchSetId: 'candidate-1',
        provider: 'daytona',
        platform: 'linux',
        architecture: 'x86_64',
        status: 'passed',
        artifactIds: [],
        producedArtifactKinds: ['test-report'],
        candidateDigestBefore: 'sha256:candidate',
        startedAt: 3,
        completedAt: 4,
        idempotencyKey: 'result-1',
      },
    ]
    detail.policyDecisions = [
      {
        ...detail.policyDecisions[0]!,
        status: 'approved',
        verificationResultIds: ['result-1'],
        missingRequirementIds: [],
      },
    ]

    const summary = deriveWorkflowTrustSummary(detail)

    expect(summary.reasons).toEqual(['Human decision is pending.'])
    expect(summary.dimensions[1]?.status).toBe('Passed')
    expect(summary.dimensions[3]?.status).toBe('Approved')
  })

  test('fails closed and names incomplete trust data first', () => {
    const detail = reviewedDetail()
    detail.reviewFindingsTruncated = true
    detail.verificationResultsTruncated = true

    const summary = deriveWorkflowTrustSummary(detail)

    expect(summary.reasons).toEqual([
      'Trust records are incomplete; decisions fail closed.',
      'Required verification records are incomplete.',
      'Policy requires human review.',
    ])
    expect(summary.dimensions[1]?.status).toBe('Incomplete records')
  })

  test('shows a current approval without inventing an outstanding requirement', () => {
    const detail = reviewedDetail()
    detail.humanDecisions = [
      {
        id: 'decision-1',
        workflowRunId: 'workflow-1',
        sandboxExecutionId: 'execution-1',
        candidatePatchSetId: 'candidate-1',
        reviewRunId: 'review-1',
        policyDecisionId: 'policy-1',
        status: 'approved',
        comment: 'Reviewed.',
        actorId: 'maintainer-1',
        decidedAt: 5,
      },
    ]

    const summary = deriveWorkflowTrustSummary(detail)

    expect(summary.label).toBe('Approved')
    expect(summary.dimensions.at(-1)?.status).toBe('Approved')
    expect(summary.reasons).toEqual([
      'Required verification is not configured.',
      'Policy requires human review.',
    ])
  })
})
