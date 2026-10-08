import { Match } from 'effect'
import type { WorkflowDetail } from './types'
import * as m from '@/paraglide/messages'

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
  const execution = detail.sandboxExecutions.reduce<
    (typeof detail.sandboxExecutions)[number] | undefined
  >(
    (latest, item) =>
      latest === undefined || item.completedAt > latest.completedAt
        ? item
        : latest,
    undefined,
  )
  const candidate = detail.candidatePatchSets.reduce<
    (typeof detail.candidatePatchSets)[number] | undefined
  >(
    (latest, item) =>
      latest === undefined || item.createdAt > latest.createdAt ? item : latest,
    undefined,
  )
  const review = detail.reviewRuns.reduce<
    (typeof detail.reviewRuns)[number] | undefined
  >(
    (latest, item) =>
      latest === undefined || item.createdAt > latest.createdAt ? item : latest,
    undefined,
  )
  const latestPolicy = detail.policyDecisions.reduce<
    (typeof detail.policyDecisions)[number] | undefined
  >(
    (latest, item) =>
      latest === undefined || item.createdAt > latest.createdAt ? item : latest,
    undefined,
  )
  const policy =
    review !== undefined && latestPolicy?.reviewRunId === review.id
      ? latestPolicy
      : undefined
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

  const {
    execution: latestExecution,
    decision: latestDecision,
    decisionIsCurrent,
  } = currentWorkflowProjection(detail)

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
  return Match.value(state).pipe(
    Match.when('queued', () => m.app_status_queued()),
    Match.when('running', () => m.app_status_running()),
    Match.when('no-sandbox-run', () => m.app_status_no_sandbox()),
    Match.when('sandbox-failed', () => m.app_status_sandbox_failed()),
    Match.when('needs-review', () => m.app_status_needs_review()),
    Match.when('approved', () => m.app_status_approved()),
    Match.when('rejected', () => m.app_status_rejected()),
    Match.when('changes-requested', () => m.app_status_changes_requested()),
    Match.exhaustive,
  )
}
