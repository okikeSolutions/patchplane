import { CpuIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import * as m from '@/paraglide/messages'
import { getAppLocale } from './app-language'
import type { RuntimeSessionRow } from './types'

function formatTimestamp(value: number) {
  return new Intl.DateTimeFormat(getAppLocale(), {
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
          <h2 className="text-sm font-medium">{m.app_runtime_title()}</h2>
          <p className="m-0 mt-1 text-sm text-muted-foreground">
            {m.app_runtime_intro()}
          </p>
        </div>
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CpuIcon />
            </EmptyMedia>
            <EmptyTitle>{m.app_runtime_empty()}</EmptyTitle>
            <EmptyDescription>{m.app_runtime_empty_detail()}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </section>
    )
  }

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-medium">{m.app_runtime_title()}</h2>
        <p className="m-0 mt-1 text-sm text-muted-foreground">
          {m.app_runtime_remote_intro()}
        </p>
      </div>
      <div className="flex flex-col divide-y divide-border">
        {sessions.map((session) => (
          <div
            key={session.id}
            className="grid gap-3 py-4 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_auto]"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="break-words text-sm font-medium [overflow-wrap:anywhere]">
                  {session.provider}
                </h3>
                <Badge
                  variant={
                    session.status === 'running' ? 'secondary' : 'outline'
                  }
                >
                  {session.status}
                </Badge>
              </div>
              <p className="m-0 mt-1 break-all font-mono text-xs text-muted-foreground">
                session {session.sessionId} · command {session.commandId}
              </p>
            </div>
            <div className="grid gap-2 text-xs text-muted-foreground sm:text-right">
              <span>
                {m.app_runtime_started()} {formatTimestamp(session.startedAt)}
              </span>
              <span>
                {session.completedAt === undefined
                  ? m.app_runtime_active()
                  : `${m.app_runtime_completed()} ${formatTimestamp(session.completedAt)}`}
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
