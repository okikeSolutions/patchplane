import { PanelRightIcon } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

export function NoOrganizationAlert() {
  return (
    <Alert>
      <PanelRightIcon />
      <AlertTitle>No active WorkOS organization selected</AlertTitle>
      <AlertDescription>
        Reconnect with WorkOS or select an organization from your WorkOS session
        before starting authenticated workflows.
      </AlertDescription>
    </Alert>
  )
}
