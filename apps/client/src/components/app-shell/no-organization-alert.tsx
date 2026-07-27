import { PanelRightIcon } from 'lucide-react'
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert'
import { buttonVariants } from '@/components/ui/button'
import * as m from '@/paraglide/messages'
import { localizeAppHref } from './app-language'

export function NoOrganizationAlert() {
  return (
    <Alert className="!pr-2.5 sm:!pr-44">
      <PanelRightIcon />
      <AlertTitle>{m.app_no_organization_title()}</AlertTitle>
      <AlertDescription>{m.app_no_organization_detail()}</AlertDescription>
      <AlertAction className="static col-span-full mt-2 sm:absolute sm:top-2 sm:right-2 sm:mt-0">
        <a
          className={buttonVariants({
            variant: 'outline',
            size: 'sm',
            className: 'min-h-11 w-full sm:w-auto md:min-h-8',
          })}
          href={`/api/auth/sign-in?returnPathname=${encodeURIComponent(localizeAppHref('/app'))}`}
        >
          {m.app_no_organization_action()}
        </a>
      </AlertAction>
    </Alert>
  )
}
