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

function isWorkflowFilter(value: string | null): value is WorkflowFilter {
  return value !== null && ['all', 'needs-review', 'running', 'queued', 'sandbox-failed', 'approved', 'rejected', 'changes-requested'].includes(value)
}

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
  const [repository, setRepository] = useState('all')
  const [selectedWorkflowRunId, setSelectedWorkflowRunId] =
    useState<Id<'workflowRuns'> | undefined>(undefined)
  const [openWorkflowRunId, setOpenWorkflowRunId] =
    useState<Id<'workflowRuns'> | undefined>(undefined)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const storedFilter = params.get('filter')
    if (isWorkflowFilter(storedFilter)) setFilter(storedFilter)
    setQuery(params.get('query') ?? '')
    setRepository(params.get('repository') ?? 'all')
  }, [])

  useEffect(() => {
    const url = new URL(window.location.href)
    if (query.length > 0) url.searchParams.set('query', query)
    else url.searchParams.delete('query')
    if (filter !== 'all') url.searchParams.set('filter', filter)
    else url.searchParams.delete('filter')
    if (repository !== 'all') url.searchParams.set('repository', repository)
    else url.searchParams.delete('repository')
    window.history.replaceState(null, '', url)
  }, [filter, query, repository])

  useEffect(() => {
    if (selectedWorkflowRunId !== undefined) {
      return
    }

    setSelectedWorkflowRunId(rows[0]?.workflowRun.id)
  }, [rows, selectedWorkflowRunId])

  const repositories = useMemo(() => {
    const values = [...new Set(rows.map((row) => sourceLabel(row)).filter((source) => source.includes('/')))]
    // oxlint-disable-next-line unicorn/no-array-sort -- values is a new local array.
    return values.sort()
  }, [rows])
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

      if (!matchesQuery || (repository !== 'all' && sourceLabel(row) !== repository)) {
        return false
      }

      if (filter === 'all') {
        return true
      }

      return state === filter
    })
  }, [filter, query, repository, rows])

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

  const returnTo = `/app${new URLSearchParams({
    ...(query.length > 0 ? { query } : {}),
    ...(filter !== 'all' ? { filter } : {}),
    ...(repository !== 'all' ? { repository } : {}),
  }).toString().length > 0 ? `?${new URLSearchParams({
    ...(query.length > 0 ? { query } : {}),
    ...(filter !== 'all' ? { filter } : {}),
    ...(repository !== 'all' ? { repository } : {}),
  }).toString()}` : ''}`

  function openWorkflow(id: Id<'workflowRuns'>) {
    setSelectedWorkflowRunId(id)
    setOpenWorkflowRunId(id)
  }

  return (
    <div className="grid min-h-0 flex-1 grid-rows-[auto_1fr] overflow-hidden bg-background">
      <WorkflowConsoleToolbar
        filter={filter}
        metrics={metrics}
        query={query}
        repositories={repositories}
        repository={repository}
        viewer={viewer}
        onFilterChange={setFilter}
        onQueryChange={setQuery}
        onRepositoryChange={setRepository}
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
          returnTo={returnTo}
          workflowRunId={selectedWorkflowRunId}
          row={selectedRow}
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
            returnTo={returnTo}
            workflowRunId={openWorkflowRunId}
          />
        )}
      </Sheet>
    </div>
  )
}
