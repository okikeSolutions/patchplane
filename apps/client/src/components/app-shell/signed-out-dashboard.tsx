import * as m from '@/paraglide/messages'
import { buttonVariants } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

export function SignedOutDashboard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{m.app_auth_title()}</CardTitle>
        <CardDescription>{m.app_unauthenticated()}</CardDescription>
      </CardHeader>
      <CardContent>
        <a href="/api/auth/sign-in?returnPathname=/app" className={buttonVariants()}>
          {m.app_sign_in()}
        </a>
      </CardContent>
    </Card>
  )
}
