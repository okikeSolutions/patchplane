import {
  Authenticated,
  AuthLoading,
  Unauthenticated,
} from 'convex/react'
import { AppMobileHeader } from './app-mobile-header'
import { AppSidebar } from './app-sidebar'
import { LoadingWorkflowConsole } from './loading-workflow-console'
import { SignedOutWorkflowConsole } from './signed-out-workflow-console'
import { WorkflowConsoleContent } from './workflow-console-content'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'

export function AppWorkflowConsolePage() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="h-svh min-h-0 overflow-hidden">
        <AppMobileHeader title="Workflows" />
        <main className="flex min-h-0 flex-1 flex-col">
          <Authenticated>
            <WorkflowConsoleContent />
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
