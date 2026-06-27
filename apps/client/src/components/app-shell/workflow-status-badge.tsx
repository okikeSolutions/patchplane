import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { WorkflowTrustState } from './workflow-trust-state'
import { workflowTrustStateLabel } from './workflow-trust-state'

export function WorkflowRunStatusBadge({
  status,
}: {
  readonly status: 'queued' | 'running' | 'reviewed'
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
          ? 'bg-destructive/15 text-destructive'
          : state === 'needs-review'
            ? 'bg-primary/15 text-primary'
            : state === 'approved'
              ? 'bg-[color-mix(in_oklch,var(--success-readable),transparent_82%)] text-[var(--success-readable)]'
              : 'bg-muted text-muted-foreground',
      )}
    >
      {workflowTrustStateLabel(state)}
    </Badge>
  )
}

export function workflowStatusLabel(status: 'queued' | 'running' | 'reviewed') {
  switch (status) {
    case 'queued':
      return 'Queued'
    case 'running':
      return 'Running'
    case 'reviewed':
      return 'Review ready'
    default:
      return status
  }
}
