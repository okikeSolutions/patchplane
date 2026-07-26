import { useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table'
import { ListFilterIcon, WorkflowIcon } from 'lucide-react'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import type { WorkflowStartRow } from './types'
import {
  formatRelative,
  lastEventLabel,
  sourceLabel,
  trustStateForList,
} from './workflow-console-model'
import { workflowStatusLabel, WorkflowRunStatusBadge, WorkflowTrustStateBadge } from './workflow-status-badge'
import type { WorkflowTrustState } from './workflow-trust-state'
import { workflowTrustStateLabel } from './workflow-trust-state'

export function WorkflowQueue({
  isLoading,
  rows,
  returnTo,
  onOpenWorkflow,
}: {
  readonly isLoading: boolean
  readonly rows: ReadonlyArray<WorkflowStartRow>
  readonly returnTo: string
  readonly onOpenWorkflow?: (workflowRunId: string, returnTo: string) => void
}) {
  const columns = useMemo(
    () => workflowQueueColumns(returnTo, onOpenWorkflow),
    [onOpenWorkflow, returnTo],
  )
  // TanStack Table treats data identity as a change signal. An inline copy here
  // causes an unbounded rerender loop whenever selection state changes.
  const tableRows = useMemo(() => [...rows], [rows])
  const table = useReactTable({
    data: tableRows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.workflowRun.id,
  })

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background" aria-busy={isLoading} aria-labelledby="workflow-queue-heading">
      <div className="flex h-12 items-center justify-between border-b border-border px-4 lg:px-6">
        <div className="flex items-center gap-2">
          <ListFilterIcon className="size-4 text-muted-foreground" />
          <h2 id="workflow-queue-heading" className="text-sm font-medium">Workflow queue</h2>
        </div>
        <span className="hidden text-xs text-muted-foreground sm:inline">
          Source · trust · evidence
        </span>
      </div>
      {isLoading ? (
        <WorkflowQueueSkeleton />
      ) : rows.length === 0 ? (
        <div className="p-6" aria-live="polite">
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon"><WorkflowIcon /></EmptyMedia>
              <EmptyTitle>No workflows match this view</EmptyTitle>
              <EmptyDescription>
                Start a workflow or clear the current search and status filter.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </div>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <Table className="table-fixed">
            <TableCaption className="sr-only">Workflow runs with execution status, trust state, source, latest event, and update time.</TableCaption>
            <colgroup>
              <col />
              <col className="hidden w-36 md:table-column" />
              <col className="hidden w-44 sm:table-column" />
              <col className="hidden w-44 lg:table-column" />
              <col className="hidden w-40 2xl:table-column" />
              <col className="hidden w-28 2xl:table-column" />
            </colgroup>
            <TableHeader className="sticky top-0 z-10 bg-background/95 [&_tr]:border-border">
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id} className="hover:bg-transparent [&_th]:text-muted-foreground">
                  {headerGroup.headers.map((header) => (
                    <TableHead key={header.id} className={cn(columnClassName(header.column.id), 'last:pr-4 lg:last:pr-6')}>
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.map((row) => {
                return (
                  <TableRow
                    key={row.id}
                    className="border-border"
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id} className={cn(columnClassName(cell.column.id, true), 'last:pr-4 lg:last:pr-6')}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </ScrollArea>
      )}
    </section>
  )
}

function workflowQueueColumns(
  returnTo: string,
  onOpenWorkflow: ((workflowRunId: string, returnTo: string) => void) | undefined,
): Array<ColumnDef<WorkflowStartRow>> {
  return [
    {
      id: 'workflow',
      header: 'Workflow',
      cell: ({ row }) => {
        const trustState = trustStateForList(row.original)
        return (
          <a
            aria-label={`${row.original.promptRequest.prompt}. Run ${row.original.workflowRun.id}. Source ${sourceLabel(row.original)}. Execution ${workflowStatusLabel(row.original.workflowRun.status)}. Trust ${workflowTrustStateLabel(trustState)}.`}
            className="flex min-h-11 min-w-0 items-start gap-3 rounded-sm text-left underline-offset-4 hover:[&_.workflow-title]:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href={`/app/workflows/${row.original.workflowRun.id}?returnTo=${encodeURIComponent(returnTo)}`}
            onClick={onOpenWorkflow === undefined ? undefined : (event) => {
              event.preventDefault()
              onOpenWorkflow(row.original.workflowRun.id, returnTo)
            }}
          >
            <TrustMarker state={trustState} />
            <div className="min-w-0">
              <span className="workflow-title block max-w-full break-words whitespace-normal font-medium [overflow-wrap:anywhere]">
                {row.original.promptRequest.prompt}
              </span>
              <span className="mt-1 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                <code className="break-all whitespace-normal font-mono">{row.original.workflowRun.id}</code>
                <span>·</span>
                <span className="break-words whitespace-normal [overflow-wrap:anywhere]">{sourceLabel(row.original)}</span>
              </span>
              <span className="mt-2 flex flex-wrap gap-1 sm:hidden" aria-hidden="true">
                <WorkflowRunStatusBadge status={row.original.workflowRun.status} />
                <WorkflowTrustStateBadge state={trustState} />
              </span>
            </div>
          </a>
        )
      },
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => <WorkflowRunStatusBadge status={row.original.workflowRun.status} />,
    },
    {
      id: 'trust',
      header: 'Trust',
      cell: ({ row }) => (
        <WorkflowTrustStateBadge state={trustStateForList(row.original)} />
      ),
    },
    {
      id: 'source',
      header: 'Source',
      cell: ({ row }) => <span className="block break-words whitespace-normal text-sm [overflow-wrap:anywhere]">{sourceLabel(row.original)}</span>,
    },
    {
      id: 'lastEvent',
      header: 'Last event',
      cell: ({ row }) => lastEventLabel(row.original),
    },
    {
      id: 'updated',
      header: () => <div className="text-right">Updated</div>,
      cell: ({ row }) => (
        <div className="text-right">{formatRelative(row.original.workflowRun.createdAt)}</div>
      ),
    },
  ]
}

function columnClassName(columnId: string, isCell = false) {
  switch (columnId) {
    case 'workflow':
      return isCell ? 'py-3 pl-4 lg:pl-6' : 'pl-4 lg:pl-6'
    case 'status':
      return 'hidden overflow-hidden md:table-cell'
    case 'trust':
      return 'hidden overflow-hidden sm:table-cell'
    case 'source':
      return 'hidden overflow-hidden lg:table-cell'
    case 'lastEvent':
      return 'hidden text-sm text-muted-foreground 2xl:table-cell'
    case 'updated':
      return 'hidden text-right text-sm text-muted-foreground 2xl:table-cell'
    default:
      return undefined
  }
}

function WorkflowQueueSkeleton() {
  return (
    <div className="flex flex-col gap-3 p-6" aria-live="polite">
      <span className="sr-only">Loading workflow runs.</span>
      {Array.from({ length: 5 }).map((_, index) => (
        <Skeleton key={index} className="h-14 w-full" />
      ))}
    </div>
  )
}

function TrustMarker({ state }: { readonly state: WorkflowTrustState }) {
  return (
    <span
      className={cn(
        'mt-1 block size-2.5 shrink-0 rounded-full',
        state === 'sandbox-failed' || state === 'rejected'
          ? 'bg-destructive'
          : state === 'needs-review'
            ? 'bg-primary'
            : state === 'running'
              ? 'bg-chart-2'
              : 'bg-muted-foreground',
      )}
      aria-hidden="true"
      title={workflowTrustStateLabel(state)}
    />
  )
}
