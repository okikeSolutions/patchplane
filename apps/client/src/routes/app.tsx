import { createFileRoute } from '@tanstack/react-router'
import { AppDashboardPage } from '@/components/app-shell/app-dashboard-page'

export const Route = createFileRoute('/app')({
  component: AppDashboardPage,
})
