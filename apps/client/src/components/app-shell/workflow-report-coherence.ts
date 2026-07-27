import type { WorkflowDetail } from './types'
import { currentWorkflowProjection } from './workflow-trust-state'

export type WorkflowReportCoherenceIssue =
  | 'candidate-mismatch'
  | 'candidate-mutated'
  | 'candidate-stale'
  | 'superseded-attempt'

export type WorkflowReportCoherence =
  | { readonly status: 'coherent'; readonly issues: readonly [] }
  | {
      readonly status: 'blocked'
      readonly issues: ReadonlyArray<WorkflowReportCoherenceIssue>
    }

/**
 * Checks that every current trust record still describes the selected attempt
 * and candidate. Missing evidence remains a separate completeness concern;
 * contradictory identity is a blocking coherence failure.
 */
export function assessWorkflowReportCoherence(
  detail: WorkflowDetail,
): WorkflowReportCoherence {
  if (detail.workflowRun.modelVersion !== 'v1') {
    return { status: 'coherent', issues: [] }
  }

  const issues = new Set<WorkflowReportCoherenceIssue>()
  const { execution, candidate, review, policy, decision } =
    currentWorkflowProjection(detail)
  const latestPolicy = detail.policyDecisions.reduce<
    (typeof detail.policyDecisions)[number] | undefined
  >(
    (latest, item) =>
      latest === undefined || item.createdAt > latest.createdAt ? item : latest,
    undefined,
  )
  const workflowRunId = detail.workflowRun.id

  if (detail.newerAttempt !== undefined) {
    issues.add('superseded-attempt')
  }

  if (
    candidate?.baseSha !== undefined &&
    detail.workflowRun.sourceCommitSha !== undefined &&
    candidate.baseSha !== detail.workflowRun.sourceCommitSha
  ) {
    issues.add('candidate-stale')
  }

  const diffArtifact =
    candidate?.diffArtifactId === undefined
      ? undefined
      : detail.evidenceArtifacts.find(
          (artifact) => artifact.id === candidate.diffArtifactId,
        )
  const executionMismatch =
    execution !== undefined && execution.workflowRunId !== workflowRunId
  const candidateMismatch =
    candidate !== undefined &&
    (candidate.workflowRunId !== workflowRunId ||
      (candidate.sandboxExecutionId !== undefined &&
        candidate.sandboxExecutionId !== execution?.id))
  const diffMismatch =
    candidate !== undefined &&
    diffArtifact !== undefined &&
    (diffArtifact.workflowRunId !== workflowRunId ||
      diffArtifact.kind !== 'diff' ||
      (candidate.candidateDigest !== undefined &&
        diffArtifact.subjectDigest !== undefined &&
        diffArtifact.subjectDigest !== candidate.candidateDigest))
  const reviewMismatch =
    candidate !== undefined &&
    review !== undefined &&
    (review.workflowRunId !== workflowRunId ||
      (review.candidatePatchSetId !== undefined &&
        review.candidatePatchSetId !== candidate.id) ||
      (review.sandboxExecutionId !== undefined &&
        review.sandboxExecutionId !== execution?.id))
  const policyMismatch =
    candidate !== undefined &&
    latestPolicy !== undefined &&
    (latestPolicy.workflowRunId !== workflowRunId ||
      (latestPolicy.candidatePatchSetId !== undefined &&
        latestPolicy.candidatePatchSetId !== candidate.id) ||
      (latestPolicy.reviewRunId !== undefined &&
        latestPolicy.reviewRunId !== review?.id))
  const decisionMismatch =
    candidate !== undefined &&
    decision !== undefined &&
    (decision.workflowRunId !== workflowRunId ||
      (decision.candidatePatchSetId !== undefined &&
        decision.candidatePatchSetId !== candidate.id) ||
      (decision.sandboxExecutionId !== undefined &&
        decision.sandboxExecutionId !== execution?.id) ||
      (decision.reviewRunId !== undefined &&
        decision.reviewRunId !== review?.id) ||
      (decision.policyDecisionId !== undefined &&
        decision.policyDecisionId !== policy?.id))
  const publicationMismatch =
    candidate !== undefined &&
    decision !== undefined &&
    detail.publicationResults
      .filter(
        (publication) =>
          publication.humanDecisionId === undefined ||
          publication.humanDecisionId === decision.id,
      )
      .some(
        (publication) =>
          publication.workflowRunId !== workflowRunId ||
          (publication.candidatePatchSetId !== undefined &&
            publication.candidatePatchSetId !== candidate.id),
      )
  const relationshipMismatch =
    executionMismatch ||
    candidateMismatch ||
    diffMismatch ||
    reviewMismatch ||
    policyMismatch ||
    decisionMismatch ||
    publicationMismatch

  if (relationshipMismatch) {
    issues.add('candidate-mismatch')
  }

  if (candidate?.candidateDigest !== undefined) {
    const consideredVerificationIds = new Set(
      latestPolicy?.verificationResultIds ?? [],
    )
    const currentVerificationResults = detail.verificationResults.filter(
      (result) =>
        result.candidatePatchSetId === candidate.id &&
        (consideredVerificationIds.size === 0 ||
          consideredVerificationIds.has(result.id)),
    )
    if (
      currentVerificationResults.some(
        (result) =>
          result.workflowRunId !== workflowRunId ||
          result.candidateDigestBefore !== candidate.candidateDigest ||
          (result.candidateDigestAfter !== undefined &&
            result.candidateDigestAfter !== result.candidateDigestBefore),
      )
    ) {
      issues.add('candidate-mutated')
    }
  }

  const result = [...issues]
  return result.length === 0
    ? { status: 'coherent', issues: [] }
    : { status: 'blocked', issues: result }
}
