import { useEffect, useMemo, useState } from 'react'
import { api } from '@patchplane/backend/convex/_generated/api'
import type { Id } from '@patchplane/backend/convex/_generated/dataModel'
import { useQuery } from 'convex/react'
import { Sheet } from '@/components/ui/sheet'
import type { ViewerIdentity, WorkflowDetail, WorkflowStartRow } from './types'
import {
  sourceLabel,
  trustStateForList,
  type WorkflowFilter,
} from './workflow-console-model'
import { WorkflowConsoleToolbar } from './workflow-console-toolbar'
import { WorkflowDetailSheet } from './workflow-detail-sheet'
import { WorkflowInspector } from './workflow-inspector'
import { WorkflowQueue } from './workflow-queue'

export function WorkflowConsole({
  detailOverrides,
  metrics,
  viewer,
  workflows,
}: {
  readonly detailOverrides?: Readonly<Record<string, WorkflowDetail>>
  readonly metrics: {
    readonly visibleRequests: number
    readonly appRequests: number
    readonly externalRequests: number
  }
  readonly viewer: ViewerIdentity | undefined
  readonly workflows: ReadonlyArray<WorkflowStartRow> | undefined
}) {
  const rows = useMemo(() => workflows ?? [], [workflows])
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<WorkflowFilter>('all')
  const [selectedWorkflowRunId, setSelectedWorkflowRunId] =
    useState<Id<'workflowRuns'> | undefined>(undefined)
  const [openWorkflowRunId, setOpenWorkflowRunId] =
    useState<Id<'workflowRuns'> | undefined>(undefined)

  useEffect(() => {
    if (selectedWorkflowRunId !== undefined) {
      return
    }

    setSelectedWorkflowRunId(rows[0]?.workflowRun.id)
  }, [rows, selectedWorkflowRunId])

  const visibleRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()

    return rows.filter((row) => {
      const state = trustStateForList(row)
      const source = sourceLabel(row).toLowerCase()
      const prompt = row.promptRequest.prompt.toLowerCase()
      const id = row.workflowRun.id.toLowerCase()
      const matchesQuery =
        normalizedQuery.length === 0 ||
        prompt.includes(normalizedQuery) ||
        source.includes(normalizedQuery) ||
        id.includes(normalizedQuery)

      if (!matchesQuery) {
        return false
      }

      if (filter === 'all') {
        return true
      }

      return state === filter
    })
  }, [filter, query, rows])

  const selectedRow = rows.find((row) => row.workflowRun.id === selectedWorkflowRunId)
  const queriedSelectedDetail = useQuery(
    api.workflowStarts.getDetail,
    selectedWorkflowRunId === undefined || detailOverrides?.[selectedWorkflowRunId] !== undefined
      ? 'skip'
      : { workflowRunId: selectedWorkflowRunId },
  ) as WorkflowDetail | undefined
  const selectedDetail = selectedWorkflowRunId === undefined
    ? undefined
    : detailOverrides?.[selectedWorkflowRunId] ?? queriedSelectedDetail
  const openDetail = openWorkflowRunId === undefined
    ? undefined
    : openWorkflowRunId === selectedWorkflowRunId
      ? selectedDetail
      : detailOverrides?.[openWorkflowRunId]

  function openWorkflow(id: Id<'workflowRuns'>) {
    setSelectedWorkflowRunId(id)
    setOpenWorkflowRunId(id)
  }

  return (
    <div className="grid h-svh min-h-0 grid-rows-[auto_1fr] overflow-hidden bg-background">
      <WorkflowConsoleToolbar
        filter={filter}
        metrics={metrics}
        query={query}
        viewer={viewer}
        onFilterChange={setFilter}
        onQueryChange={setQuery}
      />
      <div className="grid min-h-0 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <WorkflowQueue
          isLoading={workflows === undefined}
          rows={visibleRows}
          selectedDetail={selectedDetail}
          selectedWorkflowRunId={selectedWorkflowRunId}
          onOpenWorkflow={openWorkflow}
        />
        <WorkflowInspector
          detailOverride={selectedDetail}
          workflowRunId={selectedWorkflowRunId}
          row={selectedRow}
          onOpenWorkflow={openWorkflow}
        />
      </div>
      <Sheet
        open={openWorkflowRunId !== undefined}
        onOpenChange={(open) => {
          if (!open) {
            setOpenWorkflowRunId(undefined)
          }
        }}
      >
        {openWorkflowRunId === undefined ? null : (
          <WorkflowDetailSheet
            detailOverride={openDetail}
            workflowRunId={openWorkflowRunId}
          />
        )}
      </Sheet>
    </div>
  )
}
