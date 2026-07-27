import { useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table'
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
import * as m from '@/paraglide/messages'
import type { WorkflowStartRow } from './types'
import {
  formatRelative,
  trustStateForList,
  workflowContextLabel,
  workflowDisplayTitle,
  workflowUpdatedAt,
} from './workflow-console-model'
import {
  workflowStatusLabel,
  WorkflowRunStatusBadge,
  WorkflowTrustStateBadge,
} from './workflow-status-badge'
import { workflowTrustStateLabel } from './workflow-trust-state'
import { localizeAppHref } from './app-language'

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
    <section
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background"
      aria-busy={isLoading}
      aria-labelledby="workflow-queue-heading"
    >
      <div className="flex h-12 items-center justify-between border-b border-border px-4 lg:px-6">
        <div className="flex items-center gap-2">
          <ListFilterIcon className="size-4 text-muted-foreground" />
          <h2 id="workflow-queue-heading" className="text-sm font-medium">
            {m.app_queue_heading()}
          </h2>
        </div>
        <span className="hidden text-xs text-muted-foreground sm:inline">
          {m.app_queue_context()}
        </span>
      </div>
      {isLoading ? (
        <WorkflowQueueSkeleton />
      ) : rows.length === 0 ? (
        <div className="p-6" aria-live="polite">
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <WorkflowIcon />
              </EmptyMedia>
              <EmptyTitle>{m.app_queue_empty_title()}</EmptyTitle>
              <EmptyDescription>{m.app_queue_empty_detail()}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </div>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <Table className="table-fixed">
            <TableCaption className="sr-only">
              {m.app_queue_caption()}
            </TableCaption>
            <colgroup>
              <col />
              <col className="hidden w-44 sm:table-column" />
              <col className="hidden w-44 md:table-column" />
              <col className="hidden w-32 lg:table-column" />
            </colgroup>
            <TableHeader className="sticky top-0 z-10 bg-background/95 [&_tr]:border-border">
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow
                  key={headerGroup.id}
                  className="hover:bg-transparent [&_th]:text-muted-foreground"
                >
                  {headerGroup.headers.map((header) => (
                    <TableHead
                      key={header.id}
                      className={cn(
                        columnClassName(header.column.id),
                        'last:pr-4 lg:last:pr-6',
                      )}
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.map((row) => {
                return (
                  <TableRow key={row.id} className="border-border">
                    {row.getVisibleCells().map((cell) => (
                      <TableCell
                        key={cell.id}
                        className={cn(
                          columnClassName(cell.column.id, true),
                          'last:pr-4 lg:last:pr-6',
                        )}
                      >
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        )}
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
  onOpenWorkflow:
    | ((workflowRunId: string, returnTo: string) => void)
    | undefined,
): Array<ColumnDef<WorkflowStartRow>> {
  return [
    {
      id: 'workflow',
      header: m.app_queue_column_workflow(),
      cell: ({ row }) => {
        const trustState = trustStateForList(row.original)
        const title = workflowDisplayTitle(row.original)
        const context = workflowContextLabel(row.original)
        const updatedAt = workflowUpdatedAt(row.original)
        return (
          <a
            aria-label={`${title}. ${context}. Execution ${workflowStatusLabel(row.original.workflowRun.status)}. Trust ${workflowTrustStateLabel(trustState)}. Updated ${formatRelative(updatedAt)}.`}
            className="block min-h-11 min-w-0 rounded-sm text-left underline-offset-4 hover:[&_.workflow-title]:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href={localizeAppHref(
              `/app/workflows/${row.original.workflowRun.id}?returnTo=${encodeURIComponent(returnTo)}`,
            )}
            onClick={
              onOpenWorkflow === undefined
                ? undefined
                : (event) => {
                    event.preventDefault()
                    onOpenWorkflow(row.original.workflowRun.id, returnTo)
                  }
            }
          >
            <div className="min-w-0">
              <span
                className="workflow-title block max-w-full truncate font-medium"
                title={title}
              >
                {title}
              </span>
              <span className="mt-1 block truncate text-xs text-muted-foreground">
                {context}
              </span>
              <span
                className="mt-2 flex min-w-0 items-center gap-1 sm:hidden"
                aria-hidden="true"
              >
                <WorkflowRunStatusBadge
                  status={row.original.workflowRun.status}
                />
                <WorkflowTrustStateBadge state={trustState} />
                <time
                  dateTime={new Date(updatedAt).toISOString()}
                  className="ml-auto shrink-0 text-xs text-muted-foreground"
                >
                  {formatRelative(updatedAt)}
                </time>
              </span>
            </div>
          </a>
        )
      },
    },
    {
      id: 'status',
      header: m.app_queue_column_execution(),
      cell: ({ row }) => (
        <WorkflowRunStatusBadge status={row.original.workflowRun.status} />
      ),
    },
    {
      id: 'trust',
      header: m.app_queue_column_trust(),
      cell: ({ row }) => (
        <WorkflowTrustStateBadge state={trustStateForList(row.original)} />
      ),
    },
    {
      id: 'updated',
      header: () => (
        <div className="text-right">{m.app_queue_column_updated()}</div>
      ),
      cell: ({ row }) => (
        <time
          dateTime={new Date(workflowUpdatedAt(row.original)).toISOString()}
          className="block text-right"
        >
          {formatRelative(workflowUpdatedAt(row.original))}
        </time>
      ),
    },
  ]
}

function columnClassName(columnId: string, isCell = false) {
  switch (columnId) {
    case 'workflow':
      return isCell ? 'py-3 pl-4 lg:pl-6' : 'pl-4 lg:pl-6'
    case 'status':
      return 'hidden overflow-hidden sm:table-cell'
    case 'trust':
      return 'hidden overflow-hidden md:table-cell'
    case 'updated':
      return 'hidden text-right text-sm text-muted-foreground lg:table-cell'
    default:
      return undefined
  }
}

function WorkflowQueueSkeleton() {
  return (
    <div className="flex flex-col gap-3 p-6" aria-live="polite">
      <span className="sr-only">{m.app_queue_loading()}</span>
      {Array.from({ length: 5 }).map((_, index) => (
        <Skeleton key={index} className="h-14 w-full" />
      ))}
    </div>
  )
}
