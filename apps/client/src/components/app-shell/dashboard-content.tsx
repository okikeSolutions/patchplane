import { useEffect, useMemo } from 'react'
import { useAuth } from '@workos/authkit-tanstack-react-start/client'
import { api } from '@patchplane/backend/convex/_generated/api'
import { GitBranchIcon, PlayIcon, WorkflowIcon } from 'lucide-react'
import { useMutation, useQuery } from 'convex/react'
import { IntegrationStatusCard } from './integration-status-card'
import { MetricCard } from './metric-card'
import { NoOrganizationAlert } from './no-organization-alert'
import { OperatorStatusCard } from './operator-status-card'
import { RecentWorkflowsCard } from './recent-workflows-card'
import { StartWorkflowCard } from './start-workflow-card'
import type { PromptRequestRow, ViewerIdentity } from './types'

export function DashboardContent() {
  const { user, organizationId, signOut } = useAuth()
  const ensureCurrentUser = useMutation(api.auth.ensureCurrentUser)
  const viewer = useQuery(api.viewer.current, {}) as ViewerIdentity | undefined
  const requests = useQuery(api.requests.list, {}) as
    | ReadonlyArray<PromptRequestRow>
    | undefined

  useEffect(() => {
    void ensureCurrentUser({})
  }, [ensureCurrentUser])

  const metrics = useMemo(() => {
    const rows = requests ?? []
    return {
      visibleRequests: rows.length,
      appRequests: rows.filter((request) => request.source === 'app').length,
      externalRequests: rows.filter((request) => request.source === 'external').length,
    }
  }, [requests])

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      {user && !organizationId ? <NoOrganizationAlert /> : null}
      <section className="grid gap-4 md:grid-cols-3">
        <MetricCard
          title="Open workflows"
          value={String(metrics.visibleRequests)}
          detail="Visible to your current WorkOS identity."
          icon={WorkflowIcon}
        />
        <MetricCard
          title="App prompts"
          value={String(metrics.appRequests)}
          detail="Started from the authenticated dashboard."
          icon={PlayIcon}
        />
        <MetricCard
          title="External intake"
          value={String(metrics.externalRequests)}
          detail="GitHub/provider-originated workflow starts."
          icon={GitBranchIcon}
        />
      </section>
      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(360px,0.75fr)]">
        <StartWorkflowCard />
        <OperatorStatusCard
          viewer={viewer}
          requestCount={metrics.visibleRequests}
          onSignOut={() => {
            void signOut()
          }}
        />
      </section>
      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(360px,0.6fr)]">
        <RecentWorkflowsCard requests={requests} />
        <IntegrationStatusCard />
      </section>
    </div>
  )
}
