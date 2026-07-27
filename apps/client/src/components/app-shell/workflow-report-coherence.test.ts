import { describe, expect, test } from 'vitest'
import type { WorkflowDetail } from './types'
import { assessWorkflowReportCoherence } from './workflow-report-coherence'

const digest = `sha256:${'a'.repeat(64)}`

function coherentDetail(): WorkflowDetail {
  return {
    promptRequest: {
      id: 'prompt-1',
      workspaceId: 'workspace-1',
      actorId: 'actor-1',
      traceId: 'trace-1',
      source: 'app',
      prompt: 'Fix the test',
      status: 'created',
      createdAt: 1,
    },
    workflowRun: {
      id: 'attempt-1',
      promptRequestId: 'prompt-1',
      workspaceId: 'workspace-1',
      traceId: 'trace-1',
      status: 'reviewed',
      modelVersion: 'v1',
      rootWorkflowRunId: 'attempt-1',
      attemptNumber: 1,
      sourceCommitSha: '0123456789012345678901234567890123456789',
      createdAt: 1,
    },
    runtimeEvents: [],
    runtimeEventsTruncated: false,
    runtimeSessions: [],
    runtimeSessionsTruncated: false,
    sandboxExecutions: [
      {
        id: 'execution-1',
        workflowRunId: 'attempt-1',
        provider: 'daytona',
        sandboxId: 'sandbox-1',
        command: 'bun test',
        status: 'succeeded',
        stdout: 'ok',
        startedAt: 2,
        completedAt: 3,
      },
    ],
    sandboxExecutionsTruncated: false,
    evidenceArtifacts: [
      {
        id: 'diff-1',
        workflowRunId: 'attempt-1',
        subjectDigest: digest,
        kind: 'diff',
        storageProvider: 'cloudflare-r2',
        storageKey: 'attempt-1/diff.patch',
        contentType: 'text/x-diff',
        sizeBytes: 10,
        sha256: 'a'.repeat(64),
        createdAt: 3,
      },
    ],
    evidenceArtifactsTruncated: false,
    candidatePatchSets: [
      {
        id: 'candidate-1',
        workflowRunId: 'attempt-1',
        sandboxExecutionId: 'execution-1',
        status: 'captured',
        candidateDigest: digest,
        baseSha: '0123456789012345678901234567890123456789',
        diffArtifactId: 'diff-1',
        createdAt: 4,
      },
    ],
    candidatePatchSetsTruncated: false,
    verificationRequirements: [],
    verificationRequirementsTruncated: false,
    verificationResults: [
      {
        id: 'verification-1',
        workflowRunId: 'attempt-1',
        requirementId: 'requirement-1',
        candidatePatchSetId: 'candidate-1',
        provider: 'daytona',
        platform: 'linux',
        architecture: 'x86_64',
        status: 'passed',
        artifactIds: [],
        producedArtifactKinds: [],
        candidateDigestBefore: digest,
        candidateDigestAfter: digest,
        startedAt: 4,
        completedAt: 5,
        idempotencyKey: 'verification-1',
      },
    ],
    verificationResultsTruncated: false,
    reviewRuns: [
      {
        id: 'review-1',
        workflowRunId: 'attempt-1',
        sandboxExecutionId: 'execution-1',
        candidatePatchSetId: 'candidate-1',
        kind: 'test',
        reviewer: 'patchplane',
        status: 'completed',
        startedAt: 5,
        completedAt: 6,
        createdAt: 5,
      },
    ],
    reviewFindings: [],
    policyDecisions: [
      {
        id: 'policy-1',
        workflowRunId: 'attempt-1',
        reviewRunId: 'review-1',
        candidatePatchSetId: 'candidate-1',
        status: 'approved',
        summary: 'Ready',
        verificationResultIds: ['verification-1'],
        createdAt: 6,
      },
    ],
    humanDecisions: [],
    publicationResults: [],
    provenanceEvents: [],
  }
}

describe('assessWorkflowReportCoherence', () => {
  test('accepts a single attempt-bound candidate projection', () => {
    expect(assessWorkflowReportCoherence(coherentDetail())).toEqual({
      status: 'coherent',
      issues: [],
    })
  })

  test('fails closed when the candidate base is stale', () => {
    const detail = coherentDetail()
    detail.candidatePatchSets[0]!.baseSha = 'f'.repeat(40)

    expect(assessWorkflowReportCoherence(detail)).toMatchObject({
      status: 'blocked',
      issues: ['candidate-stale'],
    })
  })

  test('fails closed when verification observes candidate mutation', () => {
    const detail = coherentDetail()
    detail.verificationResults[0]!.candidateDigestAfter =
      `sha256:${'b'.repeat(64)}`

    expect(assessWorkflowReportCoherence(detail)).toMatchObject({
      status: 'blocked',
      issues: ['candidate-mutated'],
    })
  })

  test('fails closed when diff evidence belongs to another candidate', () => {
    const detail = coherentDetail()
    detail.evidenceArtifacts[0]!.subjectDigest = `sha256:${'c'.repeat(64)}`

    expect(assessWorkflowReportCoherence(detail)).toMatchObject({
      status: 'blocked',
      issues: ['candidate-mismatch'],
    })
  })

  test('keeps the selected attempt pinned and exposes its newer successor', () => {
    const detail = coherentDetail()
    detail.newerAttempt = {
      workflowRunId: 'attempt-2',
      attemptNumber: 2,
      status: 'running',
      createdAt: 10,
    }

    expect(assessWorkflowReportCoherence(detail)).toMatchObject({
      status: 'blocked',
      issues: ['superseded-attempt'],
    })
    expect(detail.workflowRun.id).toBe('attempt-1')
    expect(detail.candidatePatchSets[0]?.id).toBe('candidate-1')
  })
})
