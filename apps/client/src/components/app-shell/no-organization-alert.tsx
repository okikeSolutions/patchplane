import { PanelRightIcon } from 'lucide-react'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { buttonVariants } from '@/components/ui/button'

export function NoOrganizationAlert() {
  return (
    <Alert>
      <PanelRightIcon />
      <AlertTitle>No active WorkOS organization selected</AlertTitle>
      <AlertDescription>
        Select an organization in AuthKit so PatchPlane can scope repositories, workflows, and decisions safely.
      </AlertDescription>
      <AlertAction>
        <a className={buttonVariants({ variant: 'outline', size: 'sm' })} href="/api/auth/sign-in?returnPathname=/app">
          Choose organization
        </a>
      </AlertAction>
    </Alert>
  )
}
