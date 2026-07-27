import { useState } from 'react'
import { CheckCircle2Icon, CircleAlertIcon, XIcon } from 'lucide-react'
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import * as m from '@/paraglide/messages'

export function GitHubConnectionStatus() {
  const initial =
    typeof window === 'undefined'
      ? undefined
      : new URLSearchParams(window.location.search).get('github')
  const [status, setStatus] = useState(initial)
  if (status !== 'connected' && status !== 'failed') return null

  function dismiss() {
    setStatus(undefined)
    const url = new URL(window.location.href)
    url.searchParams.delete('github')
    url.searchParams.delete('reason')
    window.history.replaceState(null, '', url)
  }

  return (
    <Alert
      role={status === 'failed' ? 'alert' : undefined}
      aria-live={status === 'connected' ? 'polite' : undefined}
      variant={status === 'failed' ? 'destructive' : 'success'}
      className="m-3 w-auto shrink-0"
    >
      {status === 'failed' ? <CircleAlertIcon /> : <CheckCircle2Icon />}
      <AlertTitle>
        {status === 'failed'
          ? m.app_github_connection_failed()
          : m.app_github_connected_title()}
      </AlertTitle>
      <AlertDescription>
        {status === 'failed'
          ? m.app_github_connection_failed_detail()
          : m.app_github_connected_detail()}
      </AlertDescription>
      <AlertAction>
        <Button
          variant="ghost"
          size="icon-sm"
          className="min-h-11 min-w-11 sm:min-h-8 sm:min-w-8"
          aria-label={m.app_github_dismiss_status()}
          onClick={dismiss}
        >
          <XIcon />
        </Button>
      </AlertAction>
    </Alert>
  )
}
