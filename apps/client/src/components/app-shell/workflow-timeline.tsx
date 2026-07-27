import {
  CheckCircle2Icon,
  ChevronDownIcon,
  CircleDashedIcon,
  GitBranchIcon,
  ShieldCheckIcon,
  TerminalIcon,
  UserCheckIcon,
  XCircleIcon,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import * as m from '@/paraglide/messages'
import { getAppLocale } from './app-language'
import type { WorkflowDetail } from './types'

type TimelineStatus = 'started' | 'succeeded' | 'failed' | 'blocked'
type TimelineItem = {
  readonly key: string
  readonly occurredAt: number
  readonly title: string
  readonly detail: string
  readonly category: string
  readonly status: TimelineStatus
}

function formatTimestamp(value: number) {
  return new Intl.DateTimeFormat(getAppLocale(), {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function timelineItems(detail: WorkflowDetail): ReadonlyArray<TimelineItem> {
  const items: Array<TimelineItem> = [
    {
      key: 'prompt',
      occurredAt: detail.promptRequest.createdAt,
      title: m.app_activity_request_received(),
      detail:
        detail.promptRequest.externalRef?.repositoryFullName ??
        detail.promptRequest.source,
      category: 'source',
      status: 'succeeded',
    },
    ...detail.provenanceEvents.map((event) => ({
      key: `provenance:${event.id}`,
      occurredAt: event.startedAt,
      title: event.operation,
      detail:
        event.summary ??
        [event.pluginName, event.type, event.errorCategory]
          .filter(Boolean)
          .join(' · '),
      category: event.type,
      status: event.status,
    })),
    ...detail.sandboxExecutions.flatMap((execution) => [
      {
        key: `sandbox:${execution.id}:start`,
        occurredAt: execution.startedAt,
        title: m.app_activity_sandbox_started(),
        detail: execution.command,
        category: 'sandbox',
        status: 'started' as const,
      },
      {
        key: `sandbox:${execution.id}:end`,
        occurredAt: execution.completedAt,
        title:
          execution.status === 'failed'
            ? m.app_activity_sandbox_failed()
            : m.app_activity_sandbox_passed(),
        detail: `${m.app_activity_exit()} ${execution.exitCode ?? m.app_activity_unknown()}`,
        category: 'sandbox',
        status:
          execution.status === 'failed'
            ? ('failed' as const)
            : ('succeeded' as const),
      },
    ]),
    ...detail.candidatePatchSets.map((candidate) => ({
      key: `candidate:${candidate.id}`,
      occurredAt: candidate.createdAt,
      title:
        candidate.status === 'captured'
          ? m.app_activity_candidate_captured()
          : m.app_activity_candidate_unavailable(),
      detail: candidate.summary ?? candidate.id,
      category: 'change',
      status:
        candidate.status === 'captured'
          ? ('succeeded' as const)
          : ('failed' as const),
    })),
    ...detail.reviewRuns.map((review) => ({
      key: `review:${review.id}`,
      occurredAt: review.completedAt ?? review.startedAt,
      title: `${m.app_activity_automated_review()} · ${review.kind} · ${timelineStatusLabel(review.status === 'completed' ? 'succeeded' : review.status === 'failed' ? 'failed' : 'started')}`,
      detail: review.summary ?? review.reviewer,
      category: 'review',
      status:
        review.status === 'failed'
          ? ('failed' as const)
          : review.status === 'completed'
            ? ('succeeded' as const)
            : ('started' as const),
    })),
    ...detail.policyDecisions.map((policy) => ({
      key: `policy:${policy.id}`,
      occurredAt: policy.createdAt,
      title: `${m.app_activity_policy()}: ${policy.status}`,
      detail: policy.summary,
      category: 'policy',
      status:
        policy.status === 'approved'
          ? ('succeeded' as const)
          : ('blocked' as const),
    })),
    ...detail.humanDecisions.map((decision) => ({
      key: `decision:${decision.id}`,
      occurredAt: decision.decidedAt,
      title: `${m.app_activity_human_decision()}: ${decision.status}${decision.verificationOverride ? ` (${m.app_activity_verification_override()})` : ''}`,
      detail: `${decision.actorId} · ${decision.comment}${decision.verificationOverride ? ` · ${m.app_activity_override()}: ${decision.verificationOverrideReason ?? m.app_activity_reason_unavailable()}` : ''}`,
      category: 'decision',
      status:
        decision.status === 'approved'
          ? ('succeeded' as const)
          : ('blocked' as const),
    })),
    ...detail.publicationResults.map((result) => ({
      key: `publication:${result.id}`,
      occurredAt: result.createdAt,
      title: `GitHub ${result.kind}: ${result.status}`,
      detail:
        result.summary ??
        result.error ??
        result.externalId ??
        m.app_activity_publication_recorded(),
      category: 'publication',
      status:
        result.status === 'failed'
          ? ('failed' as const)
          : result.status === 'published'
            ? ('succeeded' as const)
            : ('started' as const),
    })),
  ]
  const canonicalItems =
    detail.provenanceEvents.length > 0
      ? items.filter(
          (item) => item.key === 'prompt' || item.key.startsWith('provenance:'),
        )
      : items
  return canonicalItems.toSorted(
    (left, right) => left.occurredAt - right.occurredAt,
  )
}

export function WorkflowTimeline({
  detail,
}: {
  readonly detail: WorkflowDetail
}) {
  const items = timelineItems(detail)
  return (
    <section className="flex min-w-0 max-w-full flex-col gap-4 overflow-hidden">
      <div>
        <h2 className="text-sm font-medium">{m.app_activity_title()}</h2>
        <p className="m-0 mt-1 text-sm text-muted-foreground">
          {m.app_activity_intro()}
          {detail.sandboxExecutionsTruncated
            ? ` ${m.app_activity_truncated()}`
            : ''}
        </p>
      </div>
      <div className="min-w-0 max-w-full overflow-hidden rounded-lg border border-border [&_[data-slot=table-container]]:overflow-x-hidden">
        <Table className="table-fixed">
          <TableCaption className="sr-only">
            {m.app_activity_caption()}
          </TableCaption>
          <colgroup>
            <col />
            <col className="w-0 lg:w-1/4" />
            <col className="w-0 sm:w-28 lg:w-32" />
            <col className="w-0 2xl:w-44" />
            <col className="w-12" />
          </colgroup>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>{m.app_activity_event()}</TableHead>
              <TableHead className="invisible w-0 overflow-hidden p-0 lg:visible lg:w-auto lg:p-2">
                {m.app_activity_stage()}
              </TableHead>
              <TableHead className="invisible w-0 overflow-hidden p-0 sm:visible sm:w-auto sm:p-2">
                {m.app_activity_status()}
              </TableHead>
              <TableHead className="invisible w-0 overflow-hidden p-0 text-right 2xl:visible 2xl:w-auto 2xl:p-2">
                {m.app_table_occurred()}
              </TableHead>
              <TableHead className="w-12 text-right">
                <span className="sr-only">{m.app_table_details()}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          {items.map((item, index) => (
            <ActivityTableRows
              isLast={index === items.length - 1}
              item={item}
              key={item.key}
            />
          ))}
        </Table>
      </div>
    </section>
  )
}

function ActivityTableRows({
  isLast,
  item,
}: {
  readonly isLast: boolean
  readonly item: TimelineItem
}) {
  return (
    <Collapsible
      render={
        <TableBody
          className={isLast ? undefined : '[&_tr:last-child]:border-b'}
        />
      }
    >
      <TableRow>
        <TableCell className="min-w-0 overflow-hidden whitespace-normal">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground [&_svg]:size-4">
              <TimelineIcon category={item.category} status={item.status} />
            </span>
            <span className="min-w-0 truncate font-medium" title={item.title}>
              {item.title}
            </span>
          </div>
          <span className="mt-1 block truncate pl-9 text-xs text-muted-foreground sm:hidden">
            {timelineStatusLabel(item.status)} · {item.category}
          </span>
        </TableCell>
        <TableCell className="invisible w-0 overflow-hidden p-0 lg:visible lg:w-auto lg:p-2">
          <span
            className="block truncate font-mono text-xs text-muted-foreground"
            title={item.category}
          >
            {item.category}
          </span>
        </TableCell>
        <TableCell className="invisible w-0 overflow-hidden p-0 sm:visible sm:w-auto sm:p-2">
          <Badge
            className="max-w-full"
            variant={item.status === 'failed' ? 'destructive' : 'secondary'}
          >
            <span className="truncate">{timelineStatusLabel(item.status)}</span>
          </Badge>
        </TableCell>
        <TableCell className="invisible w-0 overflow-hidden p-0 text-right 2xl:visible 2xl:w-auto 2xl:p-2">
          <time
            className="text-xs text-muted-foreground"
            dateTime={new Date(item.occurredAt).toISOString()}
          >
            {formatTimestamp(item.occurredAt)}
          </time>
        </TableCell>
        <TableCell className="p-1 text-right">
          <CollapsibleTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="[&[aria-expanded=true]_svg]:rotate-180"
                aria-label={`${m.app_table_show_details()} ${item.title}`}
              />
            }
          >
            <ChevronDownIcon className="transition-transform" />
          </CollapsibleTrigger>
        </TableCell>
      </TableRow>
      <CollapsibleContent
        render={<TableRow className="bg-muted/20 hover:bg-muted/20" />}
      >
        <TableCell className="p-0 whitespace-normal" colSpan={5}>
          <div className="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto]">
            <div className="min-w-0">
              <p className="m-0 text-xs font-medium text-muted-foreground">
                {m.app_table_details()}
              </p>
              <p className="m-0 mt-1 break-words text-sm [overflow-wrap:anywhere]">
                {item.detail || m.app_activity_no_detail()}
              </p>
            </div>
            <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
              <dt className="text-muted-foreground">
                {m.app_activity_stage()}
              </dt>
              <dd className="m-0 break-all font-mono">{item.category}</dd>
              <dt className="text-muted-foreground">
                {m.app_table_occurred()}
              </dt>
              <dd className="m-0">
                <time dateTime={new Date(item.occurredAt).toISOString()}>
                  {formatTimestamp(item.occurredAt)}
                </time>
              </dd>
            </dl>
          </div>
        </TableCell>
      </CollapsibleContent>
    </Collapsible>
  )
}

function timelineStatusLabel(status: TimelineStatus) {
  switch (status) {
    case 'started':
      return m.app_activity_started()
    case 'succeeded':
      return m.app_activity_succeeded()
    case 'failed':
      return m.app_activity_failed()
    case 'blocked':
      return m.app_activity_blocked()
  }
}

function TimelineIcon({
  category,
  status,
}: {
  readonly category: string
  readonly status: TimelineStatus
}) {
  if (status === 'failed') return <XCircleIcon />
  if (category.includes('decision')) return <UserCheckIcon />
  if (category.includes('policy') || category.includes('review'))
    return <ShieldCheckIcon />
  if (category.includes('sandbox') || category.includes('runtime'))
    return <TerminalIcon />
  if (category.includes('source') || category.includes('publication'))
    return <GitBranchIcon />
  return status === 'started' ? <CircleDashedIcon /> : <CheckCircle2Icon />
}
