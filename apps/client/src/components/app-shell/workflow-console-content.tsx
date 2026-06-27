import { useEffect, useMemo } from 'react'
import { useAuth } from '@workos/authkit-tanstack-react-start/client'
import { api } from '@patchplane/backend/convex/_generated/api'
import { useMutation, useQuery } from 'convex/react'
import { GitHubRepositoryConnections } from './github-repository-connections'
import { NoOrganizationAlert } from './no-organization-alert'
import { WorkflowConsole } from './workflow-console'
import type { ViewerIdentity, WorkflowStartRow } from './types'

const EMPTY_WORKFLOWS: ReadonlyArray<WorkflowStartRow> = []

export function WorkflowConsoleContent() {
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

  const workspaceId = organizationId === undefined || organizationId === null
    ? undefined
    : `workos:${organizationId}`
  const visibleWorkflows = workspaceId === undefined ? EMPTY_WORKFLOWS : workflows

  const metrics = useMemo(() => {
    const rows = visibleWorkflows ?? []
    return {
      visibleRequests: rows.length,
      appRequests: rows.filter((row) => row.promptRequest.source === 'app').length,
      externalRequests: rows.filter((row) => row.promptRequest.source === 'external').length,
    }
  }, [visibleWorkflows])

  return (
    <div className="flex min-h-[calc(100svh-1rem)] flex-col">
      {user && !organizationId ? <NoOrganizationAlert /> : null}
      <div className="border-b border-border/60 p-4">
        <GitHubRepositoryConnections workspaceId={workspaceId} />
      </div>
      <WorkflowConsole
        metrics={metrics}
        viewer={viewer}
        workflows={visibleWorkflows}
      />
    </div>
  )
}
