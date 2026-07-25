import { useMemo } from 'react'
import type { Id } from '@patchplane/backend/convex/_generated/dataModel'
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
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import type { WorkflowDetail, WorkflowStartRow } from './types'
import {
  formatRelative,
  lastEventLabel,
  sourceLabel,
  trustStateForList,
} from './workflow-console-model'
import { WorkflowRunStatusBadge, WorkflowTrustStateBadge } from './workflow-status-badge'
import type { WorkflowTrustState } from './workflow-trust-state'
import { deriveWorkflowTrustState, workflowTrustStateLabel } from './workflow-trust-state'

export function WorkflowQueue({
  isLoading,
  rows,
  selectedDetail,
  selectedWorkflowRunId,
  onOpenWorkflow,
}: {
  readonly isLoading: boolean
  readonly rows: ReadonlyArray<WorkflowStartRow>
  readonly selectedDetail?: WorkflowDetail
  readonly selectedWorkflowRunId: Id<'workflowRuns'> | undefined
  readonly onOpenWorkflow: (id: Id<'workflowRuns'>) => void
}) {
  const columns = useMemo(
    () => workflowQueueColumns({ selectedDetail, selectedWorkflowRunId, onOpenWorkflow }),
    [selectedDetail, selectedWorkflowRunId, onOpenWorkflow],
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
    <section className="flex min-h-0 min-w-0 flex-col bg-background">
      <div className="flex h-12 items-center justify-between border-b border-border px-4 lg:px-6">
        <div className="flex items-center gap-2">
          <ListFilterIcon className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-medium">Workflow queue</h2>
        </div>
        <span className="text-xs text-muted-foreground">
          Source · trust · evidence
        </span>
      </div>
      {isLoading ? (
        <WorkflowQueueSkeleton />
      ) : rows.length === 0 ? (
        <div className="p-6">
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
            <colgroup>
              <col />
              <col className="hidden w-28 md:table-column" />
              <col className="w-32" />
              <col className="hidden w-44 lg:table-column" />
              <col className="hidden w-40 2xl:table-column" />
              <col className="hidden w-28 2xl:table-column" />
            </colgroup>
            <TableHeader className="sticky top-0 z-10 bg-background/95 [&_tr]:border-border">
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id} className="hover:bg-transparent [&_th]:text-muted-foreground">
                  {headerGroup.headers.map((header) => (
                    <TableHead key={header.id} className={columnClassName(header.column.id)}>
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
                const selected = row.original.workflowRun.id === selectedWorkflowRunId
                return (
                  <TableRow
                    key={row.id}
                    aria-selected={selected}
                    data-state={selected ? 'selected' : undefined}
                    className="border-border data-[state=selected]:bg-muted/80"
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id} className={columnClassName(cell.column.id, true)}>
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

function workflowQueueColumns(input: {
  readonly selectedDetail?: WorkflowDetail
  readonly selectedWorkflowRunId: Id<'workflowRuns'> | undefined
  readonly onOpenWorkflow: (id: Id<'workflowRuns'>) => void
}): Array<ColumnDef<WorkflowStartRow>> {
  return [
    {
      id: 'workflow',
      header: 'Workflow',
      cell: ({ row }) => {
        const trustState = trustStateForRow(row.original, input)
        return (
          <div className="flex min-w-0 items-start gap-3">
            <TrustMarker state={trustState} />
            <div className="min-w-0">
              <button
                type="button"
                className="block max-w-full truncate text-left font-medium underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => input.onOpenWorkflow(row.original.workflowRun.id)}
              >
                {row.original.promptRequest.prompt}
              </button>
              <div className="mt-1 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                <code className="truncate font-mono">{row.original.workflowRun.id}</code>
                <span>·</span>
                <span className="truncate">{sourceLabel(row.original)}</span>
              </div>
            </div>
          </div>
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
        <WorkflowTrustStateBadge state={trustStateForRow(row.original, input)} />
      ),
    },
    {
      id: 'source',
      header: 'Source',
      cell: ({ row }) => <span className="block truncate text-sm">{sourceLabel(row.original)}</span>,
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

function trustStateForRow(
  row: WorkflowStartRow,
  input: {
    readonly selectedDetail?: WorkflowDetail
    readonly selectedWorkflowRunId: Id<'workflowRuns'> | undefined
  },
) {
  if (row.workflowRun.id === input.selectedWorkflowRunId && input.selectedDetail !== undefined) {
    return deriveWorkflowTrustState(input.selectedDetail)
  }

  return trustStateForList(row)
}

function columnClassName(columnId: string, isCell = false) {
  switch (columnId) {
    case 'workflow':
      return isCell ? 'py-3 pl-4 lg:pl-6' : 'pl-4 lg:pl-6'
    case 'status':
      return 'hidden overflow-hidden md:table-cell'
    case 'trust':
      return 'overflow-hidden'
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
    <div className="flex flex-col gap-3 p-6">
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
      title={workflowTrustStateLabel(state)}
    />
  )
}
