import type { WorkflowDetail } from './types'
import * as m from '@/paraglide/messages'
import {
  currentWorkflowProjection,
  deriveWorkflowTrustState,
  workflowTrustStateLabel,
} from './workflow-trust-state'

export type TrustDimensionTone = 'negative' | 'neutral' | 'positive' | 'warning'

export interface WorkflowTrustDimension {
  readonly key: 'decision' | 'execution' | 'policy' | 'review' | 'verification'
  readonly label: string
  readonly status: string
  readonly detail: string
  readonly tone: TrustDimensionTone
}

export function verificationCoverageForDecision(
  detail: WorkflowDetail,
  candidatePatchSetId: string | undefined,
  policyDecision: WorkflowDetail['policyDecisions'][number] | undefined,
) {
  const required = detail.verificationRequirements.filter(
    (requirement) => requirement.required,
  )
  const consideredResultIds = new Set(
    policyDecision?.verificationResultIds ?? [],
  )
  const passedRequirementIds = new Set(
    detail.verificationResults
      .filter(
        (result) =>
          result.candidatePatchSetId === candidatePatchSetId &&
          consideredResultIds.has(result.id) &&
          result.status === 'passed',
      )
      .map((result) => result.requirementId),
  )
  const passedCount = required.filter((requirement) =>
    passedRequirementIds.has(requirement.id),
  ).length
  const truncated =
    detail.verificationRequirementsTruncated ||
    detail.verificationResultsTruncated
  const complete =
    !truncated &&
    required.length > 0 &&
    (policyDecision?.missingRequirementIds?.length ?? 0) === 0 &&
    passedCount === required.length

  return {
    canOverride: !truncated,
    complete,
    detail: truncated
      ? m.app_trust_records_truncated()
      : required.length === 0
        ? m.app_trust_no_required()
        : `${passedCount} of ${required.length} ${m.app_trust_checks()} ${m.app_trust_for_candidate()}${complete ? '.' : `; ${m.app_trust_override_required()}`}`,
    passedCount,
    requiredCount: required.length,
    truncated,
  }
}

export function deriveWorkflowTrustSummary(detail: WorkflowDetail) {
  const state = deriveWorkflowTrustState(detail)
  const { execution, candidate, review, policy, decision, decisionIsCurrent } =
    currentWorkflowProjection(detail)
  const coverage = verificationCoverageForDecision(
    detail,
    candidate?.id,
    policy,
  )
  const currentFindings = detail.reviewFindings.filter(
    (finding) => finding.reviewRunId === review?.id,
  )
  const blockingFindings = currentFindings.filter(
    (finding) =>
      finding.severity === 'error' || finding.severity === 'critical',
  )
  const trustDataTruncated = [
    detail.sandboxExecutionsTruncated,
    detail.candidatePatchSetsTruncated,
    detail.reviewRunsTruncated,
    detail.reviewFindingsTruncated,
    detail.policyDecisionsTruncated,
    detail.humanDecisionsTruncated,
  ].some((value) => value === true)

  const dimensions: ReadonlyArray<WorkflowTrustDimension> = [
    execution === undefined
      ? {
          key: 'execution',
          label: m.app_review_execution(),
          status: m.app_trust_not_run(),
          detail: m.app_trust_no_sandbox(),
          tone: 'neutral',
        }
      : execution.status === 'succeeded'
        ? {
            key: 'execution',
            label: m.app_review_execution(),
            status: m.app_trust_passed(),
            detail: `${m.app_review_exit()} ${execution.exitCode ?? m.app_changes_unknown()}.`,
            tone: 'positive',
          }
        : {
            key: 'execution',
            label: m.app_review_execution(),
            status: m.app_trust_failed(),
            detail: `${m.app_review_exit()} ${execution.exitCode ?? m.app_changes_unknown()}.`,
            tone: 'negative',
          },
    verificationDimension(coverage),
    review === undefined
      ? {
          key: 'review',
          label: m.app_trust_automated_review(),
          status: m.app_trust_not_run(),
          detail: m.app_trust_no_review(),
          tone: 'neutral',
        }
      : review.status === 'completed' && blockingFindings.length === 0
        ? {
            key: 'review',
            label: m.app_trust_automated_review(),
            status: m.app_trust_completed(),
            detail: m.app_trust_zero_findings(),
            tone: 'neutral',
          }
        : review.status === 'completed'
          ? {
              key: 'review',
              label: m.app_trust_automated_review(),
              status: m.app_trust_blocking_findings(),
              detail: `${blockingFindings.length} ${m.app_trust_findings_remain()}`,
              tone: 'negative',
            }
          : {
              key: 'review',
              label: m.app_trust_automated_review(),
              status:
                review.status === 'failed'
                  ? m.app_trust_failed()
                  : m.app_status_running(),
              detail: review.summary ?? m.app_trust_review_incomplete(),
              tone: review.status === 'failed' ? 'negative' : 'neutral',
            },
    policyDimension(policy, coverage),
    decisionIsCurrent && decision !== undefined
      ? {
          key: 'decision',
          label: m.app_trust_human_decision(),
          status:
            decision.status === 'changes-requested'
              ? m.app_status_changes_requested()
              : decision.status === 'approved'
                ? m.app_status_approved()
                : m.app_status_rejected(),
          detail:
            decision.verificationOverride === true
              ? m.app_trust_recorded_override()
              : m.app_trust_recorded_current(),
          tone:
            decision.status === 'approved'
              ? 'positive'
              : decision.status === 'rejected'
                ? 'negative'
                : 'warning',
        }
      : {
          key: 'decision',
          label: m.app_trust_human_decision(),
          status: m.app_trust_pending(),
          detail:
            decision === undefined
              ? m.app_trust_no_decision()
              : m.app_trust_prior_superseded(),
          tone: 'warning',
        },
  ]

  return {
    state,
    label: workflowTrustStateLabel(state),
    reasons: trustReasons({
      blockingFindings: blockingFindings.length,
      candidate,
      coverage,
      decision,
      decisionIsCurrent,
      execution,
      policy,
      review,
      trustDataTruncated,
    }),
    dimensions,
  }
}

function verificationDimension(
  coverage: ReturnType<typeof verificationCoverageForDecision>,
): WorkflowTrustDimension {
  if (coverage.truncated) {
    return {
      key: 'verification',
      label: m.app_trust_required_verification(),
      status: m.app_trust_incomplete_records(),
      detail: coverage.detail,
      tone: 'negative',
    }
  }
  if (coverage.requiredCount === 0) {
    return {
      key: 'verification',
      label: m.app_trust_required_verification(),
      status: m.app_trust_not_configured(),
      detail: coverage.detail,
      tone: 'warning',
    }
  }
  return {
    key: 'verification',
    label: m.app_trust_required_verification(),
    status: coverage.complete ? m.app_trust_passed() : m.app_trust_incomplete(),
    detail: coverage.detail,
    tone: coverage.complete ? 'positive' : 'negative',
  }
}

function policyDimension(
  policy: WorkflowDetail['policyDecisions'][number] | undefined,
  coverage: ReturnType<typeof verificationCoverageForDecision>,
): WorkflowTrustDimension {
  if (policy === undefined) {
    return {
      key: 'policy',
      label: m.app_trust_policy(),
      status: m.app_trust_not_evaluated(),
      detail: m.app_trust_no_policy(),
      tone: 'neutral',
    }
  }
  const status =
    policy.status === 'manual-review'
      ? m.app_status_manual_review()
      : policy.status === 'changes-requested'
        ? m.app_status_changes_requested()
        : policy.status === 'approved'
          ? m.app_status_approved()
          : m.app_status_rejected()
  return {
    key: 'policy',
    label: m.app_trust_policy(),
    status,
    detail:
      policy.status === 'manual-review'
        ? coverage.truncated
          ? m.app_trust_policy_incomplete()
          : coverage.requiredCount === 0
            ? m.app_trust_policy_unconfigured()
            : coverage.complete
              ? m.app_trust_policy_passed()
              : `${coverage.passedCount} of ${coverage.requiredCount} ${m.app_trust_policy_checks()}`
        : (policy.summary ?? m.app_trust_policy_completed()),
    tone:
      policy.status === 'approved'
        ? 'positive'
        : policy.status === 'manual-review'
          ? 'warning'
          : 'negative',
  }
}

function trustReasons(input: {
  readonly blockingFindings: number
  readonly candidate: WorkflowDetail['candidatePatchSets'][number] | undefined
  readonly coverage: ReturnType<typeof verificationCoverageForDecision>
  readonly decision: WorkflowDetail['humanDecisions'][number] | undefined
  readonly decisionIsCurrent: boolean
  readonly execution: WorkflowDetail['sandboxExecutions'][number] | undefined
  readonly policy: WorkflowDetail['policyDecisions'][number] | undefined
  readonly review: WorkflowDetail['reviewRuns'][number] | undefined
  readonly trustDataTruncated: boolean
}) {
  const reasons: Array<string> = []
  if (input.trustDataTruncated) {
    reasons.push(m.app_trust_records_incomplete())
  }
  if (input.execution === undefined) {
    reasons.push(m.app_trust_execution_pending())
  } else if (input.execution.status === 'failed') {
    reasons.push(m.app_trust_execution_failed())
  }
  if (input.candidate?.status !== 'captured') {
    reasons.push(m.app_trust_candidate_missing())
  }
  if (input.coverage.truncated) {
    reasons.push(m.app_trust_verification_incomplete())
  } else if (input.coverage.requiredCount === 0) {
    reasons.push(m.app_trust_verification_missing())
  } else if (!input.coverage.complete) {
    reasons.push(
      `${input.coverage.passedCount} of ${input.coverage.requiredCount} ${m.app_trust_checks()}.`,
    )
  }
  if (input.review === undefined) {
    reasons.push(m.app_trust_review_not_started())
  } else if (input.review.status !== 'completed') {
    reasons.push(m.app_trust_review_incomplete())
  } else if (input.blockingFindings > 0) {
    reasons.push(
      `${input.blockingFindings} ${input.blockingFindings === 1 ? m.app_trust_finding_remains() : m.app_trust_findings_remain()}`,
    )
  }
  if (input.policy === undefined) {
    reasons.push(m.app_trust_policy_not_evaluated())
  } else if (input.policy.status === 'manual-review') {
    reasons.push(m.app_trust_policy_human())
  } else if (input.policy.status !== 'approved') {
    reasons.push(`${m.app_trust_policy_status()} ${input.policy.status}.`)
  }
  if (!input.decisionIsCurrent) {
    reasons.push(
      input.decision === undefined
        ? m.app_trust_decision_pending()
        : m.app_trust_decision_superseded(),
    )
  } else if (input.decision?.verificationOverride === true) {
    reasons.push(m.app_trust_verification_overridden())
  }
  return reasons.slice(0, 3)
}
