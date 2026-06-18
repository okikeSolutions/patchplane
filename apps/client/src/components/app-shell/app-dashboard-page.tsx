import {
  Authenticated,
  AuthLoading,
  Unauthenticated,
} from 'convex/react'
import { AppSidebar } from './app-sidebar'
import { DashboardContent } from './dashboard-content'
import { DashboardHero } from './dashboard-hero'
import { LoadingDashboard } from './loading-dashboard'
import { SignedOutDashboard } from './signed-out-dashboard'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'

export function AppDashboardPage() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <main className="flex flex-1 flex-col gap-4 p-4 md:gap-6 md:p-6">
          <DashboardHero />
          <Authenticated>
            <DashboardContent />
          </Authenticated>
          <AuthLoading>
            <LoadingDashboard />
          </AuthLoading>
          <Unauthenticated>
            <SignedOutDashboard />
          </Unauthenticated>
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
