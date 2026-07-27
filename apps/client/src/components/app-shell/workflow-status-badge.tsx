import { Badge } from '@/components/ui/badge'
import * as m from '@/paraglide/messages'
import type { WorkflowTrustState } from './workflow-trust-state'
import { workflowTrustStateLabel } from './workflow-trust-state'

export function WorkflowRunStatusBadge({
  status,
}: {
  readonly status: 'queued' | 'running' | 'reviewed' | 'failed'
}) {
  return (
    <Badge variant={workflowRunStatusVariant(status)}>
      {workflowStatusLabel(status)}
    </Badge>
  )
}

export function WorkflowTrustStateBadge({
  state,
}: {
  readonly state: WorkflowTrustState
}) {
  return (
    <Badge variant={workflowTrustStateVariant(state)}>
      {workflowTrustStateLabel(state)}
    </Badge>
  )
}

export function workflowRunStatusVariant(
  status: 'queued' | 'running' | 'reviewed' | 'failed',
) {
  switch (status) {
    case 'reviewed':
      return 'success' as const
    case 'failed':
      return 'destructive' as const
    case 'running':
      return 'outline' as const
    case 'queued':
      return 'secondary' as const
  }
}

export function workflowTrustStateVariant(state: WorkflowTrustState) {
  switch (state) {
    case 'approved':
      return 'success' as const
    case 'needs-review':
    case 'changes-requested':
      return 'warning' as const
    case 'sandbox-failed':
    case 'rejected':
      return 'destructive' as const
    case 'queued':
    case 'running':
    case 'no-sandbox-run':
      return 'secondary' as const
  }
}

export function workflowTrustAlertVariant(state: WorkflowTrustState) {
  switch (state) {
    case 'approved':
      return 'success' as const
    case 'needs-review':
    case 'changes-requested':
      return 'warning' as const
    case 'sandbox-failed':
    case 'rejected':
      return 'destructive' as const
    case 'queued':
    case 'running':
    case 'no-sandbox-run':
      return 'default' as const
  }
}

export function workflowStatusLabel(
  status: 'queued' | 'running' | 'reviewed' | 'failed',
) {
  switch (status) {
    case 'queued':
      return m.app_status_queued()
    case 'running':
      return m.app_status_running()
    case 'reviewed':
      return m.app_status_run_complete()
    case 'failed':
      return m.app_status_execution_failed()
    default:
      return status
  }
}
