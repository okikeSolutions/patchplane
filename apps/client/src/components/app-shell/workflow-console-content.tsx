import { useEffect, useMemo } from 'react'
import { useAuth } from '@workos/authkit-tanstack-react-start/client'
import { api } from '@patchplane/backend/convex/_generated/api'
import { useMutation, useQuery } from 'convex/react'
import { GitHubConnectionStatus } from './github-connection-status'
import { GitHubRepositoryConnections } from './github-repository-connections'
import { NoOrganizationAlert } from './no-organization-alert'
import { WorkflowConsole } from './workflow-console'
import type { ViewerIdentity, WorkflowStartRow } from './types'
import type { WorkflowFilter } from './workflow-console-model'
import * as m from '@/paraglide/messages'

const EMPTY_WORKFLOWS: ReadonlyArray<WorkflowStartRow> = []

export function WorkflowConsoleContent({
  initialSearch,
  onOpenWorkflow,
}: {
  readonly initialSearch: {
    readonly filter: WorkflowFilter
    readonly query: string
    readonly repository: string
  }
  readonly onOpenWorkflow?: (workflowRunId: string, returnTo: string) => void
}) {
  const { user, organizationId } = useAuth()
  const ensureCurrentUser = useMutation(api.auth.ensureCurrentUser)
  const viewer = useQuery(api.viewer.current, {}) as ViewerIdentity | undefined
  const workflows = useQuery(
    api.workflowStarts.listRecent,
    organizationId === undefined || organizationId === null
      ? 'skip'
      : { workspaceId: `workos:${organizationId}`, limit: 10 },
  ) as ReadonlyArray<WorkflowStartRow> | undefined

  useEffect(() => {
    void ensureCurrentUser({})
  }, [ensureCurrentUser])

  const workspaceId =
    organizationId === undefined || organizationId === null
      ? undefined
      : `workos:${organizationId}`
  const visibleWorkflows =
    workspaceId === undefined ? EMPTY_WORKFLOWS : workflows

  const metrics = useMemo(() => {
    const rows = visibleWorkflows ?? []
    return {
      visibleRequests: rows.length,
      appRequests: rows.filter((row) => row.promptRequest.source === 'app')
        .length,
      externalRequests: rows.filter(
        (row) => row.promptRequest.source === 'external',
      ).length,
    }
  }, [visibleWorkflows])

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-visible md:overflow-hidden">
      <h1 className="sr-only">{m.app_nav_workflows()}</h1>
      {user && !organizationId ? <NoOrganizationAlert /> : null}
      <GitHubConnectionStatus />
      <GitHubRepositoryConnections workspaceId={workspaceId} />
      <WorkflowConsole
        key={JSON.stringify(initialSearch)}
        initialSearch={initialSearch}
        metrics={metrics}
        viewer={viewer}
        workflows={visibleWorkflows}
        onOpenWorkflow={onOpenWorkflow}
      />
    </div>
  )
}
