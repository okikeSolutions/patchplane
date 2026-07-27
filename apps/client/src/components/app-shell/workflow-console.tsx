import { useMemo, useState } from 'react'
import type { ViewerIdentity, WorkflowStartRow } from './types'
import {
  sourceLabel,
  trustStateForList,
  type WorkflowFilter,
} from './workflow-console-model'
import { WorkflowConsoleToolbar } from './workflow-console-toolbar'
import { WorkflowQueue } from './workflow-queue'
import * as m from '@/paraglide/messages'

function replaceSearch(next: {
  readonly filter: WorkflowFilter
  readonly query: string
  readonly repository: string
}) {
  const url = new URL(window.location.href)
  if (next.query.length > 0) url.searchParams.set('query', next.query)
  else url.searchParams.delete('query')
  if (next.filter !== 'all') url.searchParams.set('filter', next.filter)
  else url.searchParams.delete('filter')
  if (next.repository !== 'all')
    url.searchParams.set('repository', next.repository)
  else url.searchParams.delete('repository')
  window.history.replaceState(null, '', url)
}

export function WorkflowConsole({
  initialSearch = { filter: 'all', query: '', repository: 'all' },
  metrics,
  viewer,
  workflows,
  onOpenWorkflow,
}: {
  readonly initialSearch?: {
    readonly filter: WorkflowFilter
    readonly query: string
    readonly repository: string
  }
  readonly metrics: {
    readonly visibleRequests: number
    readonly appRequests: number
    readonly externalRequests: number
  }
  readonly viewer: ViewerIdentity | undefined
  readonly workflows: ReadonlyArray<WorkflowStartRow> | undefined
  readonly onOpenWorkflow?: (workflowRunId: string, returnTo: string) => void
}) {
  const rows = useMemo(() => workflows ?? [], [workflows])
  const [query, setQuery] = useState(initialSearch.query)
  const [filter, setFilter] = useState<WorkflowFilter>(initialSearch.filter)
  const [repository, setRepository] = useState(initialSearch.repository)

  function changeFilter(nextFilter: WorkflowFilter) {
    setFilter(nextFilter)
    replaceSearch({ filter: nextFilter, query, repository })
  }

  function changeQuery(nextQuery: string) {
    setQuery(nextQuery)
    replaceSearch({ filter, query: nextQuery, repository })
  }

  function changeRepository(nextRepository: string) {
    setRepository(nextRepository)
    replaceSearch({ filter, query, repository: nextRepository })
  }

  const repositories = useMemo(() => {
    const values = [
      ...new Set(
        rows
          .map((row) => sourceLabel(row))
          .filter((source) => source.includes('/')),
      ),
    ]
    return values.toSorted()
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

      if (
        !matchesQuery ||
        (repository !== 'all' && sourceLabel(row) !== repository)
      ) {
        return false
      }

      return filter === 'all' || state === filter
    })
  }, [filter, query, repository, rows])

  const search = new URLSearchParams({
    ...(query.length > 0 ? { query } : {}),
    ...(filter !== 'all' ? { filter } : {}),
    ...(repository !== 'all' ? { repository } : {}),
  })
  const returnTo = `/app${search.size > 0 ? `?${search.toString()}` : ''}`

  return (
    <div className="grid min-h-[36rem] min-w-0 flex-none grid-rows-[auto_1fr] overflow-hidden bg-background md:min-h-0 md:flex-1">
      <WorkflowConsoleToolbar
        filter={filter}
        metrics={metrics}
        query={query}
        repositories={repositories}
        repository={repository}
        viewer={viewer}
        onFilterChange={changeFilter}
        onQueryChange={changeQuery}
        onRepositoryChange={changeRepository}
      />
      <div className="min-h-0 min-w-0 overflow-hidden">
        <p className="sr-only" aria-live="polite">
          {visibleRows.length} {m.app_queue_matches_suffix()}
        </p>
        <WorkflowQueue
          isLoading={workflows === undefined}
          rows={visibleRows}
          returnTo={returnTo}
          onOpenWorkflow={onOpenWorkflow}
        />
      </div>
    </div>
  )
}
