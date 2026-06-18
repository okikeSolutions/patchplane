import { LogOutIcon } from 'lucide-react'
import * as m from '@/paraglide/messages'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import type { ViewerIdentity } from './types'

export function OperatorStatusCard({
  viewer,
  requestCount,
  onSignOut,
}: {
  readonly viewer: ViewerIdentity | undefined
  readonly requestCount: number
  readonly onSignOut: () => void
}) {
  return (
    <Card id="settings">
      <CardHeader>
        <CardTitle>{m.app_auth_state_title()}</CardTitle>
        <CardDescription>{m.app_auth_intro()}</CardDescription>
        <CardAction>
          <Badge variant={viewer ? 'secondary' : 'outline'}>
            {viewer ? 'Synced' : 'Loading'}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        {viewer ? (
          <div className="flex flex-col gap-3 text-sm">
            <p className="m-0 text-muted-foreground">
              {m.app_authenticated_welcome({ name: viewer.name })}
            </p>
            <div className="rounded-lg bg-muted/50 p-3">
              <div className="text-muted-foreground">{m.app_viewer_subject()}</div>
              <code className="font-mono">{viewer.subject}</code>
            </div>
            <div className="rounded-lg bg-muted/50 p-3">
              <div className="text-muted-foreground">{m.app_visible_requests()}</div>
              <code className="font-mono">{requestCount}</code>
            </div>
            <Button type="button" variant="outline" onClick={onSignOut}>
              <LogOutIcon data-icon="inline-start" />
              {m.app_sign_out()}
            </Button>
          </div>
        ) : (
          <p className="m-0 text-sm text-muted-foreground">
            {m.app_authenticated_loading()}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
