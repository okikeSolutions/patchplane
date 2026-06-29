import type { Id } from '@patchplane/backend/convex/_generated/dataModel'
import {
  BoxesIcon,
  ChevronRightIcon,
  GitBranchIcon,
  ShieldCheckIcon,
  TerminalIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import type { WorkflowDetail, WorkflowStartRow } from './types'
import {
  decisionSummary,
  formatRelative,
  artifactSummary,
  logSummary,
  sandboxSummary,
  sourceLabel,
  trustStateForList,
} from './workflow-console-model'
import { WorkflowRunStatusBadge, WorkflowTrustStateBadge } from './workflow-status-badge'
import { deriveWorkflowTrustState, workflowTrustStateDetail } from './workflow-trust-state'

export function WorkflowInspector({
  detailOverride,
  workflowRunId,
  row,
}: {
  readonly detailOverride?: WorkflowDetail
  readonly workflowRunId: Id<'workflowRuns'> | undefined
  readonly row: WorkflowStartRow | undefined
}) {
  const detail = detailOverride

  if (workflowRunId === undefined || row === undefined) {
    return (
      <aside className="hidden min-w-0 border-l border-border/60 bg-card xl:block">
        <div className="p-6">
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon"><ShieldCheckIcon /></EmptyMedia>
              <EmptyTitle>Select a workflow</EmptyTitle>
              <EmptyDescription>
                Review trust state, provenance, sandbox status, and logs.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </div>
      </aside>
    )
  }

  const trustState = detail === undefined
    ? trustStateForList(row)
    : deriveWorkflowTrustState(detail)
  const externalRef = row.promptRequest.externalRef

  return (
    <aside className="hidden min-w-0 border-l border-border/60 bg-card xl:block">
      <ScrollArea className="h-[calc(100svh-4rem)]">
        <div className="flex flex-col gap-5 p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="m-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Inspector
              </p>
              <h2 className="mt-1 line-clamp-3 text-base font-semibold leading-snug">
                {row.promptRequest.prompt}
              </h2>
            </div>
            <Button
              variant="secondary"
              size="sm"
              nativeButton={false}
              render={<a aria-label="Open workflow" href={`/app/workflows/${workflowRunId}`} />}
            >
              Open
              <ChevronRightIcon data-icon="inline-end" />
            </Button>
          </div>

          <Card size="sm" className="bg-background ring-border/60">
            <CardContent>
              <div className="flex items-center justify-between gap-2">
                <WorkflowTrustStateBadge state={trustState} />
                <WorkflowRunStatusBadge status={row.workflowRun.status} />
              </div>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                {workflowTrustStateDetail(trustState)}
              </p>
            </CardContent>
          </Card>

          <InspectorSection title="Source">
            <InspectorRow
              icon={<GitBranchIcon />}
              label="Repository"
              value={externalRef?.repositoryFullName ?? row.promptRequest.source}
            />
            <InspectorRow
              label="Event"
              value={externalRef?.eventKind ?? 'app prompt'}
            />
            <InspectorRow
              label="Actor"
              value={externalRef?.senderLogin ?? row.promptRequest.actorId}
            />
          </InspectorSection>

          <InspectorSection title="Evidence">
            {detail === undefined ? (
              <InspectorSkeleton />
            ) : (
              <>
                <InspectorRow
                  icon={<BoxesIcon />}
                  label="Sandbox"
                  value={sandboxSummary(detail)}
                />
                <InspectorRow
                  icon={<TerminalIcon />}
                  label="Command logs"
                  value={logSummary(detail)}
                />
                <InspectorRow
                  label="Artifacts"
                  value={artifactSummary(detail)}
                />
                <InspectorRow
                  icon={<ShieldCheckIcon />}
                  label="Decision"
                  value={decisionSummary(trustState)}
                />
              </>
            )}
          </InspectorSection>

          <InspectorSection title="Recent timeline">
            {detail === undefined ? (
              <InspectorSkeleton />
            ) : (
              <CompactTimeline detail={detail} />
            )}
          </InspectorSection>
        </div>
      </ScrollArea>
    </aside>
  )
}

function CompactTimeline({ detail }: { readonly detail: WorkflowDetail }) {
  const items = [
    {
      label: 'Prompt received',
      detail: sourceLabel(detail),
      time: detail.promptRequest.createdAt,
    },
    {
      label: 'Workflow queued',
      detail: detail.workflowRun.id,
      time: detail.workflowRun.createdAt,
    },
    ...detail.runtimeEvents.slice(-2).map((event) => ({
      label: event.summary ?? event.type,
      detail: `${event.provider} · ${event.type}`,
      time: event.occurredAt,
    })),
    ...detail.sandboxExecutions.slice(-1).map((execution) => ({
      label: execution.status === 'failed' ? 'Sandbox failed' : 'Sandbox succeeded',
      detail: execution.command,
      time: execution.completedAt,
    })),
  ]
  // oxlint-disable-next-line unicorn/no-array-sort -- TS target does not include toSorted.
  items.sort((left, right) => right.time - left.time)
  const visibleItems = items.slice(0, 4)

  return (
    <div className="flex flex-col">
      {visibleItems.map((item, index) => (
        <div key={`${item.label}:${item.time}`} className="flex gap-3">
          <div className="flex flex-col items-center">
            <span className="mt-1 size-2 rounded-full bg-foreground/70" />
            {index === visibleItems.length - 1 ? null : (
              <span className="my-1 w-px flex-1 bg-border/60" />
            )}
          </div>
          <div className="min-w-0 pb-3">
            <div className="truncate text-sm font-medium">{item.label}</div>
            <div className="truncate text-xs text-muted-foreground">{item.detail}</div>
            <div className="text-xs text-muted-foreground">{formatRelative(item.time)}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

function InspectorSection({
  children,
  title,
}: {
  readonly children: ReactNode
  readonly title: string
}) {
  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {title}
        </h3>
        <Separator className="flex-1 bg-border/60" />
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  )
}

function InspectorRow({
  icon,
  label,
  value,
}: {
  readonly icon?: ReactNode
  readonly label: string
  readonly value: string
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-md border border-transparent px-1 py-1.5 text-sm hover:border-border/40 hover:bg-background">
      <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground [&_svg]:size-4">
        {icon}
      </span>
      <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate font-medium">{value}</span>
    </div>
  )
}

function InspectorSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton className="h-7 w-full" />
      <Skeleton className="h-7 w-4/5" />
      <Skeleton className="h-7 w-3/5" />
    </div>
  )
}
