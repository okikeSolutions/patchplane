import { Match } from 'effect'
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

function workflowRunStatusVariant(
  status: 'queued' | 'running' | 'reviewed' | 'failed',
) {
  return Match.value(status).pipe(
    Match.when('reviewed', () => 'success' as const),
    Match.when('failed', () => 'destructive' as const),
    Match.when('running', () => 'outline' as const),
    Match.when('queued', () => 'secondary' as const),
    Match.exhaustive,
  )
}

function workflowTrustStateVariant(state: WorkflowTrustState) {
  return Match.value(state).pipe(
    Match.when('approved', () => 'success' as const),
    Match.when('needs-review', () => 'warning' as const),
    Match.when('changes-requested', () => 'warning' as const),
    Match.when('sandbox-failed', () => 'destructive' as const),
    Match.when('rejected', () => 'destructive' as const),
    Match.when('queued', () => 'secondary' as const),
    Match.when('running', () => 'secondary' as const),
    Match.when('no-sandbox-run', () => 'secondary' as const),
    Match.exhaustive,
  )
}

export function workflowTrustAlertVariant(state: WorkflowTrustState) {
  return Match.value(state).pipe(
    Match.when('approved', () => 'success' as const),
    Match.when('needs-review', () => 'warning' as const),
    Match.when('changes-requested', () => 'warning' as const),
    Match.when('sandbox-failed', () => 'destructive' as const),
    Match.when('rejected', () => 'destructive' as const),
    Match.when('queued', () => 'default' as const),
    Match.when('running', () => 'default' as const),
    Match.when('no-sandbox-run', () => 'default' as const),
    Match.exhaustive,
  )
}

export function workflowStatusLabel(
  status: 'queued' | 'running' | 'reviewed' | 'failed',
) {
  return Match.value(status).pipe(
    Match.when('queued', () => m.app_status_queued()),
    Match.when('running', () => m.app_status_running()),
    Match.when('reviewed', () => m.app_status_run_complete()),
    Match.when('failed', () => m.app_status_execution_failed()),
    Match.exhaustive,
  )
}
