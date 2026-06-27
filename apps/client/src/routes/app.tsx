import { createFileRoute } from '@tanstack/react-router'
import { AppWorkflowConsolePage } from '@/components/app-shell/app-workflow-console-page'

export const Route = createFileRoute('/app')({
  component: AppWorkflowConsolePage,
})
