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
    () => workflowQueueColumns({ selectedDetail, selectedWorkflowRunId }),
    [selectedDetail, selectedWorkflowRunId],
  )
  const table = useReactTable({
    data: [...rows],
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.workflowRun.id,
  })

  return (
    <section className="min-w-0 bg-background">
      <div className="flex h-12 items-center justify-between border-b border-border/60 px-4 lg:px-6">
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
        <ScrollArea className="h-[calc(100svh-7rem)]">
          <Table className="table-fixed">
            <colgroup>
              <col />
              <col className="w-28" />
              <col className="w-36" />
              <col className="w-44" />
              <col className="hidden w-40 2xl:table-column" />
              <col className="hidden w-28 2xl:table-column" />
            </colgroup>
            <TableHeader className="sticky top-0 z-10 bg-background/95 [&_tr]:border-border/60">
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
                    tabIndex={0}
                    className="cursor-pointer border-border/50 outline-none hover:bg-muted/35 focus-visible:bg-muted/40 data-[state=selected]:bg-muted/45"
                    onClick={() => onOpenWorkflow(row.original.workflowRun.id)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') {
                        return
                      }

                      event.preventDefault()
                      onOpenWorkflow(row.original.workflowRun.id)
                    }}
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
              <div className="truncate font-medium">{row.original.promptRequest.prompt}</div>
              <div className="mt-1 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                <code className="truncate font-mono">{row.original.workflowRun.id}</code>
                <span>·</span>
                <span>{row.original.promptRequest.source}</span>
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
    case 'trust':
      return 'overflow-hidden'
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
