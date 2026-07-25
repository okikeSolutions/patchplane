import type { WorkflowDetail } from './types'

export type WorkflowTrustState =
  | 'queued'
  | 'running'
  | 'no-sandbox-run'
  | 'sandbox-failed'
  | 'needs-review'
  | 'approved'
  | 'rejected'
  | 'changes-requested'

export function currentWorkflowProjection(detail: WorkflowDetail) {
  const execution = detail.sandboxExecutions.reduce<(typeof detail.sandboxExecutions)[number] | undefined>(
    (latest, item) => latest === undefined || item.completedAt > latest.completedAt ? item : latest,
    undefined,
  )
  const candidate = detail.candidatePatchSets.reduce<(typeof detail.candidatePatchSets)[number] | undefined>(
    (latest, item) => latest === undefined || item.createdAt > latest.createdAt ? item : latest,
    undefined,
  )
  const review = detail.reviewRuns.reduce<(typeof detail.reviewRuns)[number] | undefined>(
    (latest, item) => latest === undefined || item.createdAt > latest.createdAt ? item : latest,
    undefined,
  )
  const latestPolicy = detail.policyDecisions.reduce<(typeof detail.policyDecisions)[number] | undefined>(
    (latest, item) => latest === undefined || item.createdAt > latest.createdAt ? item : latest,
    undefined,
  )
  const policy = review !== undefined && latestPolicy?.reviewRunId === review.id ? latestPolicy : undefined
  const decision = detail.humanDecisions.at(-1)
  const decisionIsCurrent =
    decision !== undefined &&
    execution !== undefined &&
    candidate !== undefined &&
    review !== undefined &&
    policy !== undefined &&
    decision.sandboxExecutionId === execution.id &&
    decision.candidatePatchSetId === candidate.id &&
    decision.reviewRunId === review.id &&
    decision.policyDecisionId === policy.id
  return { execution, candidate, review, policy, decision, decisionIsCurrent }
}

export function deriveWorkflowTrustState(
  detail: WorkflowDetail | undefined,
): WorkflowTrustState {
  if (detail === undefined) {
    return 'queued'
  }

  if (detail.workflowRun.status === 'queued') {
    return 'queued'
  }

  if (detail.workflowRun.status === 'running') {
    return 'running'
  }

  const { execution: latestExecution, decision: latestDecision, decisionIsCurrent } = currentWorkflowProjection(detail)

  if (decisionIsCurrent && latestDecision !== undefined) {
    return latestDecision.status
  }

  if (detail.sandboxExecutions.length === 0) {
    return 'no-sandbox-run'
  }

  if (latestExecution?.status === 'failed') {
    return 'sandbox-failed'
  }

  return 'needs-review'
}

export function workflowTrustStateLabel(state: WorkflowTrustState) {
  switch (state) {
    case 'queued':
      return 'Queued'
    case 'running':
      return 'Running'
    case 'no-sandbox-run':
      return 'No sandbox run'
    case 'sandbox-failed':
      return 'Sandbox failed'
    case 'needs-review':
      return 'Needs review'
    case 'approved':
      return 'Approved'
    case 'rejected':
      return 'Rejected'
    case 'changes-requested':
      return 'Changes requested'
    default:
      return state
  }
}

export function workflowTrustStateDetail(state: WorkflowTrustState) {
  switch (state) {
    case 'queued':
      return 'patchplane has accepted the workflow and is waiting for runtime evidence.'
    case 'running':
      return 'Runtime work is in progress. Evidence is still being collected.'
    case 'no-sandbox-run':
      return 'No sandbox execution has been recorded yet, so this change is not trusted.'
    case 'sandbox-failed':
      return 'The sandbox produced a failed command result. Inspect logs before taking action.'
    case 'needs-review':
      return 'Sandbox evidence exists. A human review decision is still required.'
    case 'approved':
      return 'A reviewer approved this workflow.'
    case 'rejected':
      return 'A reviewer rejected this workflow.'
    case 'changes-requested':
      return 'A reviewer requested changes before this workflow can be trusted.'
    default:
      return 'patchplane has no additional trust-state detail for this workflow yet.'
  }
}
