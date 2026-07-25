import { useState } from 'react'
import { CheckCircle2Icon, CircleAlertIcon, XIcon } from 'lucide-react'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

export function GitHubConnectionStatus() {
  const initial = typeof window === 'undefined' ? undefined : new URLSearchParams(window.location.search).get('github')
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
    <Alert variant={status === 'failed' ? 'destructive' : 'default'} className="m-3 w-auto shrink-0">
      {status === 'failed' ? <CircleAlertIcon /> : <CheckCircle2Icon />}
      <AlertTitle>{status === 'failed' ? 'GitHub connection failed' : 'GitHub connected'}</AlertTitle>
      <AlertDescription>{status === 'failed' ? 'Repository access could not be synchronized. Retry the connection or check the selected installation.' : 'Selected repositories are now available to this workspace.'}</AlertDescription>
      <AlertAction><Button variant="ghost" size="icon-sm" aria-label="Dismiss GitHub connection status" onClick={dismiss}><XIcon /></Button></AlertAction>
    </Alert>
  )
}
