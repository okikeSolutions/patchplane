import { CheckCircle2Icon, CircleAlertIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item'
import * as m from '@/paraglide/messages'
import type { WorkflowDetail } from './types'
import { formatDuration } from './workflow-sandbox-evidence'
import {
  type WorkflowTrustDimension,
  type TrustDimensionTone,
} from './workflow-trust-summary'

export function EvidenceCheck({
  label,
  status,
  detail,
  tone,
}: {
  readonly label: string
  readonly status: string
  readonly detail: string
  readonly tone: TrustDimensionTone
}) {
  return (
    <Item size="xs">
      <ItemMedia variant="icon">
        {tone === 'positive' ? (
          <CheckCircle2Icon className="text-success-foreground" />
        ) : (
          <CircleAlertIcon
            className={
              tone === 'negative'
                ? 'text-[var(--destructive-readable)]'
                : tone === 'warning'
                  ? 'text-warning-foreground'
                  : 'text-muted-foreground'
            }
          />
        )}
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle className="line-clamp-none">
          {label} ·{' '}
          <span className="font-normal text-muted-foreground">{status}</span>
        </ItemTitle>
        <ItemDescription className="line-clamp-none break-words text-xs [overflow-wrap:anywhere]">
          {detail}
        </ItemDescription>
      </ItemContent>
    </Item>
  )
}

export function RuntimeSummary({
  candidate,
  dimension,
  execution,
}: {
  readonly candidate: WorkflowDetail['candidatePatchSets'][number] | undefined
  readonly dimension: WorkflowTrustDimension
  readonly execution: WorkflowDetail['sandboxExecutions'][number] | undefined
}) {
  if (execution === undefined) {
    return (
      <EvidenceCheck
        label={dimension.label}
        status={dimension.status}
        detail={dimension.detail}
        tone={dimension.tone}
      />
    )
  }

  return (
    <Item size="xs">
      <ItemMedia variant="icon">
        {dimension.tone === 'positive' ? (
          <CheckCircle2Icon className="text-success-foreground" />
        ) : (
          <CircleAlertIcon
            className={
              dimension.tone === 'negative'
                ? 'text-[var(--destructive-readable)]'
                : 'text-warning-foreground'
            }
          />
        )}
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle className="line-clamp-none">
          {m.app_review_execution()} ·{' '}
          <span className="font-normal text-muted-foreground">
            {dimension.status}
          </span>
        </ItemTitle>
        <ItemDescription className="line-clamp-none text-xs">
          {m.app_review_provider()} {execution.provider} ·{' '}
          {m.app_review_model()}{' '}
          {execution.runtimeModel ?? m.app_review_not_reported()} ·{' '}
          {m.app_review_duration()}{' '}
          {formatDuration(execution.startedAt, execution.completedAt)} ·{' '}
          {m.app_review_exit()} {execution.exitCode ?? m.app_changes_unknown()}
        </ItemDescription>
        <ItemDescription className="line-clamp-none break-all text-xs">
          {m.app_changes_candidate()}{' '}
          {candidate?.id ?? m.app_review_not_captured()}
        </ItemDescription>
        <Collapsible>
          <CollapsibleTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="-ml-2 min-h-8 px-2 text-xs"
              />
            }
          >
            {m.app_review_technical()}
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre className="max-h-32 overflow-auto rounded-md bg-background p-2 font-mono text-xs whitespace-pre-wrap [overflow-wrap:anywhere]">
              {execution.command}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      </ItemContent>
    </Item>
  )
}

export type HumanDecisionStatus = 'approved' | 'rejected' | 'changes-requested'

export function decisionLabel(status: HumanDecisionStatus) {
  return status === 'approved'
    ? m.app_review_approve_change()
    : status === 'rejected'
      ? m.app_review_reject_change()
      : m.app_review_request_changes()
}

export function decisionConfirmationLabel(status: HumanDecisionStatus) {
  return status === 'approved'
    ? m.app_review_confirm_approval()
    : status === 'rejected'
      ? m.app_review_confirm_rejection()
      : m.app_review_confirm_request()
}

export function decisionPendingLabel(status: HumanDecisionStatus) {
  return status === 'approved'
    ? m.app_review_approving()
    : status === 'rejected'
      ? m.app_review_rejecting()
      : m.app_review_requesting()
}
