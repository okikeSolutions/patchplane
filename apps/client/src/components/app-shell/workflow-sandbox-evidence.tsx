import { TerminalIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Separator } from '@/components/ui/separator'
import * as m from '@/paraglide/messages'
import type { SandboxExecutionRow } from './types'

export function formatDuration(startedAt: number, completedAt: number) {
  const seconds = Math.max(0, Math.round((completedAt - startedAt) / 1000))
  return `${seconds}s`
}

export function WorkflowSandboxEvidence({
  executions,
}: {
  readonly executions: ReadonlyArray<SandboxExecutionRow>
}) {
  if (executions.length === 0) {
    return (
      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-sm font-medium">{m.app_detail_sandbox()}</h2>
          <p className="m-0 mt-1 text-sm text-muted-foreground">
            {m.app_sandbox_intro()}
          </p>
        </div>
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <TerminalIcon />
            </EmptyMedia>
            <EmptyTitle>{m.app_sandbox_empty()}</EmptyTitle>
            <EmptyDescription>{m.app_sandbox_empty_detail()}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </section>
    )
  }

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-medium">{m.app_detail_sandbox()}</h2>
        <p className="m-0 mt-1 text-sm text-muted-foreground">
          {m.app_sandbox_intro()}
        </p>
      </div>
      <div className="flex flex-col divide-y divide-border">
        {executions.map((execution) => (
          <div
            key={execution.id}
            className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0"
          >
            <div>
              <h3 className="flex flex-wrap items-center gap-2 text-sm font-medium">
                {m.app_sandbox_command()}
                <Badge
                  variant={
                    execution.status === 'failed' ? 'destructive' : 'secondary'
                  }
                >
                  {execution.status === 'failed'
                    ? m.app_sandbox_failed()
                    : m.app_sandbox_succeeded()}
                </Badge>
              </h3>
              <p className="m-0 mt-1 break-words text-sm text-muted-foreground [overflow-wrap:anywhere]">
                {execution.provider} · {execution.sandboxId}
              </p>
            </div>
            <div className="break-words rounded-md bg-[var(--surface-nested)] p-3 font-mono text-xs [overflow-wrap:anywhere]">
              {execution.command}
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Metadata
                label={m.app_sandbox_exit_code()}
                value={String(execution.exitCode ?? 'unknown')}
              />
              <Metadata
                label={m.app_sandbox_duration()}
                value={formatDuration(
                  execution.startedAt,
                  execution.completedAt,
                )}
              />
              <Metadata
                label={m.app_sandbox_policy()}
                value={
                  execution.policy?.lifecycle.retainAfterRun
                    ? m.app_sandbox_retained()
                    : m.app_sandbox_ephemeral()
                }
              />
            </div>
            {execution.policy === undefined ? null : (
              <>
                <Separator className="bg-border" />
                <div className="grid gap-3 text-sm sm:grid-cols-3">
                  <Metadata
                    label={m.app_sandbox_network()}
                    value={
                      execution.policy.network.blockAll
                        ? m.app_sandbox_blocked()
                        : (execution.policy.network.allowList ??
                          m.app_sandbox_default())
                    }
                  />
                  <Metadata
                    label="CPU"
                    value={
                      execution.policy.resources.cpu === undefined
                        ? m.app_sandbox_default()
                        : String(execution.policy.resources.cpu)
                    }
                  />
                  <Metadata
                    label={m.app_sandbox_memory()}
                    value={
                      execution.policy.resources.memoryGb === undefined
                        ? m.app_sandbox_default()
                        : `${execution.policy.resources.memoryGb} GB`
                    }
                  />
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

function Metadata({
  label,
  value,
}: {
  readonly label: string
  readonly value: string
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  )
}
