import { PanelRightIcon } from 'lucide-react'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { buttonVariants } from '@/components/ui/button'

export function NoOrganizationAlert() {
  return (
    <Alert className="!pr-2.5 sm:!pr-44">
      <PanelRightIcon />
      <AlertTitle>No active WorkOS organization selected</AlertTitle>
      <AlertDescription>
        Select an organization in AuthKit so PatchPlane can scope repositories, workflows, and decisions safely.
      </AlertDescription>
      <AlertAction className="static col-span-full mt-2 sm:absolute sm:top-2 sm:right-2 sm:mt-0">
        <a className={buttonVariants({ variant: 'outline', size: 'sm', className: 'min-h-11 w-full sm:w-auto md:min-h-8' })} href="/api/auth/sign-in?returnPathname=/app">
          Choose organization
        </a>
      </AlertAction>
    </Alert>
  )
}
