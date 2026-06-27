import { GitBranchIcon, PlayIcon, TerminalIcon, WorkflowIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import type { RuntimeEventRow, SandboxExecutionRow, WorkflowDetail } from './types'

type TimelineItem = {
  readonly key: string
  readonly occurredAt: number
  readonly title: string
  readonly detail: string
  readonly kind: 'workflow' | 'source' | 'runtime' | 'sandbox'
}

function formatTimestamp(value: number) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function runtimeItem(event: RuntimeEventRow): TimelineItem {
  return {
    key: `runtime:${event.id}`,
    occurredAt: event.occurredAt,
    title: event.summary ?? event.type,
    detail: `${event.provider} · ${event.type}`,
    kind: 'runtime',
  }
}

function sandboxItems(execution: SandboxExecutionRow): ReadonlyArray<TimelineItem> {
  return [
    {
      key: `sandbox:${execution.id}:started`,
      occurredAt: execution.startedAt,
      title: 'Sandbox command started',
      detail: execution.command,
      kind: 'sandbox',
    },
    {
      key: `sandbox:${execution.id}:completed`,
      occurredAt: execution.completedAt,
      title: execution.status === 'failed' ? 'Sandbox command failed' : 'Sandbox command succeeded',
      detail: `Exit code ${execution.exitCode ?? 'unknown'}`,
      kind: 'sandbox',
    },
  ]
}

function timelineItems(detail: WorkflowDetail): ReadonlyArray<TimelineItem> {
  const sourceDetail = detail.promptRequest.externalRef?.repositoryFullName ?? detail.promptRequest.source
  const baseItems: ReadonlyArray<TimelineItem> = [
    {
      key: 'prompt-created',
      occurredAt: detail.promptRequest.createdAt,
      title: 'Prompt received',
      detail: sourceDetail,
      kind: 'source',
    },
    {
      key: 'workflow-created',
      occurredAt: detail.workflowRun.createdAt,
      title: 'Workflow queued',
      detail: detail.workflowRun.id,
      kind: 'workflow',
    },
  ]

  const items = [
    ...baseItems,
    ...detail.runtimeEvents.map(runtimeItem),
    ...detail.sandboxExecutions.flatMap(sandboxItems),
  ]
  // oxlint-disable-next-line unicorn/no-array-sort -- TS target does not include toSorted.
  items.sort((left, right) => left.occurredAt - right.occurredAt)
  return items
}

export function WorkflowTimeline({ detail }: { readonly detail: WorkflowDetail }) {
  const items = timelineItems(detail)

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-medium">Timeline</h3>
        <p className="m-0 mt-1 text-sm text-muted-foreground">
          Breadcrumb-style evidence trail from intake through sandbox execution.
        </p>
      </div>
      <div className="flex flex-col gap-0">
        {items.map((item, index) => (
          <div key={item.key} className="flex gap-3">
            <div className="flex flex-col items-center">
              <div className="flex size-8 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <TimelineIcon kind={item.kind} />
              </div>
              {index === items.length - 1 ? null : (
                <Separator orientation="vertical" className="min-h-8 bg-border/20" />
              )}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1 pb-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{item.title}</span>
                <Badge variant="secondary" className="bg-muted text-muted-foreground">
                  {item.kind}
                </Badge>
              </div>
              <span className="truncate text-sm text-muted-foreground">{item.detail}</span>
              <span className="text-xs text-muted-foreground">{formatTimestamp(item.occurredAt)}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function TimelineIcon({ kind }: { readonly kind: TimelineItem['kind'] }) {
  switch (kind) {
    case 'source':
      return <GitBranchIcon />
    case 'workflow':
      return <WorkflowIcon />
    case 'runtime':
      return <PlayIcon />
    case 'sandbox':
      return <TerminalIcon />
    default:
      return null
  }
}
