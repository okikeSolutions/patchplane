import { useEffect } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Authenticated, AuthLoading, Unauthenticated } from 'convex/react'
import * as m from '@/paraglide/messages'
import { AppShellHeader } from './app-shell-header'
import { AppSidebar } from './app-sidebar'
import { LoadingWorkflowConsole } from './loading-workflow-console'
import { SignedOutWorkflowConsole } from './signed-out-workflow-console'
import { SkipLink } from './skip-link'
import { WorkflowConsoleContent } from './workflow-console-content'
import type { WorkflowFilter } from './workflow-console-model'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'

export function AppWorkflowConsolePage({
  initialSearch = { filter: 'all', query: '', repository: 'all' },
}: {
  readonly initialSearch?: {
    readonly filter: WorkflowFilter
    readonly query: string
    readonly repository: string
  }
}) {
  const navigate = useNavigate()

  useEffect(() => {
    document.title = `${m.app_nav_workflows()} · patchplane`
  }, [])

  return (
    <SidebarProvider>
      <SkipLink />
      <AppSidebar />
      <SidebarInset className="h-svh min-h-0 overflow-hidden">
        <AppShellHeader title={m.app_nav_workflows()} />
        <main
          id="main-content"
          tabIndex={-1}
          className="flex min-h-0 flex-1 flex-col overflow-y-auto outline-none md:overflow-hidden"
        >
          <Authenticated>
            <WorkflowConsoleContent
              initialSearch={initialSearch}
              onOpenWorkflow={(workflowRunId, returnTo) => {
                void navigate({
                  to: '/app/workflows/$workflowRunId',
                  params: { workflowRunId },
                  search: { tab: 'summary', returnTo },
                })
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
