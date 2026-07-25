import { Authenticated, AuthLoading, Unauthenticated } from 'convex/react'
import { createFileRoute } from '@tanstack/react-router'
import type { Id } from '@patchplane/backend/convex/_generated/dataModel'
import { AppMobileHeader } from '@/components/app-shell/app-mobile-header'
import { AppSidebar } from '@/components/app-shell/app-sidebar'
import { LoadingWorkflowConsole } from '@/components/app-shell/loading-workflow-console'
import { SignedOutWorkflowConsole } from '@/components/app-shell/signed-out-workflow-console'
import { WorkflowDetailPage } from '@/components/app-shell/workflow-detail-page'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'

const detailTabs = ['summary', 'changes', 'evidence', 'activity'] as const

export const Route = createFileRoute('/app/workflows/$workflowRunId')({
  validateSearch: (search: Record<string, unknown>) => ({
    tab: typeof search.tab === 'string' && detailTabs.includes(search.tab as (typeof detailTabs)[number])
      ? search.tab as (typeof detailTabs)[number]
      : 'summary' as const,
    returnTo: typeof search.returnTo === 'string' && (search.returnTo === '/app' || search.returnTo.startsWith('/app?'))
      ? search.returnTo
      : '/app',
  }),
  component: WorkflowDetailRoute,
})

function WorkflowDetailRoute() {
  const { workflowRunId } = Route.useParams()
  const { tab, returnTo } = Route.useSearch()
  const navigate = Route.useNavigate()

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="h-svh min-h-0 overflow-hidden">
        <AppMobileHeader title="Patch report" />
        <main className="flex min-h-0 flex-1 flex-col overflow-auto">
          <Authenticated>
            <WorkflowDetailPage
              // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Route param is validated by Convex query authorization for workflowRuns.
              workflowRunId={workflowRunId as Id<'workflowRuns'>}
              tab={tab}
              returnTo={returnTo}
              onTabChange={(nextTab) => {
                void navigate({ search: { tab: nextTab, returnTo }, replace: true })
              }}
            />
          </Authenticated>
          <AuthLoading>
            <LoadingWorkflowConsole />
          </AuthLoading>
          <Unauthenticated>
            <div className="p-4 md:p-6">
              <SignedOutWorkflowConsole />
            </div>
          </Unauthenticated>
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
