import { CpuIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import type { RuntimeSessionRow } from './types'

function formatTimestamp(value: number) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

export function WorkflowRuntimeSessions({
  sessions,
}: {
  readonly sessions: ReadonlyArray<RuntimeSessionRow>
}) {
  if (sessions.length === 0) {
    return (
      <section className="flex flex-col gap-4">
        <div>
          <h3 className="text-sm font-medium">Runtime sessions</h3>
          <p className="m-0 mt-1 text-sm text-muted-foreground">
            Pi/Daytona runtime session lifecycle for this workflow.
          </p>
        </div>
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><CpuIcon /></EmptyMedia>
            <EmptyTitle>No runtime session</EmptyTitle>
            <EmptyDescription>
              JSON-mode runs may only have runtime events. RPC-capable runs record active sessions here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </section>
    )
  }

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-medium">Runtime sessions</h3>
        <p className="m-0 mt-1 text-sm text-muted-foreground">
          Remote runtime process state captured from Daytona sessions.
        </p>
      </div>
      <div className="flex flex-col divide-y divide-border/10">
        {sessions.map((session) => (
          <div key={session.id} className="grid gap-3 py-4 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_auto]">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h4 className="truncate text-sm font-medium">{session.provider}</h4>
                <Badge variant={session.status === 'running' ? 'secondary' : 'outline'}>
                  {session.status}
                </Badge>
              </div>
              <p className="m-0 mt-1 truncate font-mono text-xs text-muted-foreground">
                session {session.sessionId} · command {session.commandId}
              </p>
            </div>
            <div className="grid gap-2 text-xs text-muted-foreground sm:text-right">
              <span>Started {formatTimestamp(session.startedAt)}</span>
              <span>{session.completedAt === undefined ? 'Still active or awaiting reconciliation' : `Completed ${formatTimestamp(session.completedAt)}`}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
