import type { WorkflowDetail } from './types'

export type WorkflowTrustState =
  | 'queued'
  | 'running'
  | 'no-sandbox-run'
  | 'sandbox-failed'
  | 'needs-review'
  | 'approved'
  | 'rejected'

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

  if (detail.sandboxExecutions.length === 0) {
    return 'no-sandbox-run'
  }

  if (detail.sandboxExecutions.some((execution) => execution.status === 'failed')) {
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
    default:
      return 'patchplane has no additional trust-state detail for this workflow yet.'
  }
}
