import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import * as m from '@/paraglide/messages'
import type { WorkflowTrustState } from './workflow-trust-state'
import { workflowTrustStateLabel } from './workflow-trust-state'

export function WorkflowRunStatusBadge({
  status,
}: {
  readonly status: 'queued' | 'running' | 'reviewed' | 'failed'
}) {
  return <Badge variant="secondary">{workflowStatusLabel(status)}</Badge>
}

export function WorkflowTrustStateBadge({
  state,
}: {
  readonly state: WorkflowTrustState
}) {
  return (
    <Badge
      variant="secondary"
      className={cn(
        'border-transparent',
        state === 'sandbox-failed' || state === 'rejected'
          ? 'bg-destructive/15 text-[var(--destructive-readable)]'
          : state === 'needs-review' || state === 'changes-requested'
            ? 'bg-primary/15 text-[var(--brand-readable)]'
            : state === 'approved'
              ? 'bg-[color-mix(in_oklch,var(--success-readable),transparent_82%)] text-[var(--success-readable)]'
              : 'bg-muted text-muted-foreground',
      )}
    >
      {workflowTrustStateLabel(state)}
    </Badge>
  )
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
