import { Authenticated, AuthLoading, Unauthenticated } from 'convex/react'
import { createFileRoute } from '@tanstack/react-router'
import type { Id } from '@patchplane/backend/convex/_generated/dataModel'
import { AppSidebar } from '@/components/app-shell/app-sidebar'
import { LoadingWorkflowConsole } from '@/components/app-shell/loading-workflow-console'
import { SignedOutWorkflowConsole } from '@/components/app-shell/signed-out-workflow-console'
import { WorkflowDetailPage } from '@/components/app-shell/workflow-detail-page'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'

export const Route = createFileRoute('/app/workflows/$workflowRunId')({
  component: WorkflowDetailRoute,
})

function WorkflowDetailRoute() {
  const { workflowRunId } = Route.useParams()

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <main className="flex flex-1 flex-col">
          <Authenticated>
            <WorkflowDetailPage
              // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Route param is validated by Convex query authorization for workflowRuns.
              workflowRunId={workflowRunId as Id<'workflowRuns'>}
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
