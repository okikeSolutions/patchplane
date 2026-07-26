import { createFileRoute } from '@tanstack/react-router'
import { AppWorkflowConsolePage } from '@/components/app-shell/app-workflow-console-page'
import type { WorkflowFilter } from '@/components/app-shell/workflow-console-model'

const workflowFilters: ReadonlyArray<WorkflowFilter> = [
  'all',
  'needs-review',
  'running',
  'queued',
  'sandbox-failed',
  'approved',
  'rejected',
  'changes-requested',
]

function isWorkflowFilter(value: unknown): value is WorkflowFilter {
  return typeof value === 'string' && workflowFilters.some((filter) => filter === value)
}

export const Route = createFileRoute('/app/')({
  validateSearch: (search: Record<string, unknown>) => ({
    filter: isWorkflowFilter(search.filter) ? search.filter : 'all' as const,
    query: typeof search.query === 'string' ? search.query : '',
    repository: typeof search.repository === 'string' ? search.repository : 'all',
  }),
  component: WorkflowIndexRoute,
})

function WorkflowIndexRoute() {
  const search = Route.useSearch()
  return <AppWorkflowConsolePage initialSearch={search} />
}
