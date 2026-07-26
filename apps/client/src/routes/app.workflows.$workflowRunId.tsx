import { useEffect } from 'react'
import { Authenticated, AuthLoading, Unauthenticated } from 'convex/react'
import { createFileRoute } from '@tanstack/react-router'
import { AppMobileHeader } from '@/components/app-shell/app-mobile-header'
import { AppSidebar } from '@/components/app-shell/app-sidebar'
import { LoadingWorkflowConsole } from '@/components/app-shell/loading-workflow-console'
import { SignedOutWorkflowConsole } from '@/components/app-shell/signed-out-workflow-console'
import { SkipLink } from '@/components/app-shell/skip-link'
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

  useEffect(() => {
    document.title = `Patch Report ${workflowRunId} · patchplane`
    const frame = requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('#main-content')?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [workflowRunId])

  return (
    <SidebarProvider>
      <SkipLink />
      <AppSidebar />
      <SidebarInset className="h-svh min-h-0 overflow-hidden">
        <AppMobileHeader title="Patch report" />
        <main id="main-content" tabIndex={-1} aria-label="Patch report" className="flex min-h-0 flex-1 flex-col overflow-auto outline-none">
          <Authenticated>
            <WorkflowDetailPage
              workflowRunId={workflowRunId}
              tab={tab}
              returnTo={returnTo}
              onRerunCreated={(childWorkflowRunId) => {
                void navigate({
                  to: '/app/workflows/$workflowRunId',
                  params: { workflowRunId: childWorkflowRunId },
                  search: { tab: 'summary', returnTo },
                })
              }}
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
