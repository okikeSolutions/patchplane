import { TerminalIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Separator } from '@/components/ui/separator'
import type { SandboxExecutionRow } from './types'

function formatDuration(startedAt: number, completedAt: number) {
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
          <h3 className="text-sm font-medium">Sandbox</h3>
          <p className="m-0 mt-1 text-sm text-muted-foreground">
            Daytona execution evidence for this workflow.
          </p>
        </div>
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><TerminalIcon /></EmptyMedia>
            <EmptyTitle>No sandbox run</EmptyTitle>
            <EmptyDescription>
              This workflow has no sandbox execution yet, so it is not trusted.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </section>
    )
  }

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-medium">Sandbox</h3>
        <p className="m-0 mt-1 text-sm text-muted-foreground">
          Daytona execution evidence for this workflow.
        </p>
      </div>
      <div className="flex flex-col divide-y divide-border/10">
        {executions.map((execution) => (
          <div key={execution.id} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0">
            <div>
              <h4 className="flex items-center gap-2 text-sm font-medium">
                Sandbox command
                <Badge variant={execution.status === 'failed' ? 'destructive' : 'secondary'}>
                  {execution.status === 'failed' ? 'Failed' : 'Succeeded'}
                </Badge>
              </h4>
              <p className="m-0 mt-1 text-sm text-muted-foreground">
                {execution.provider} · {execution.sandboxId}
              </p>
            </div>
            <div className="rounded-md bg-muted/25 p-3 font-mono text-xs">
              {execution.command}
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Metadata label="Exit code" value={String(execution.exitCode ?? 'unknown')} />
              <Metadata label="Duration" value={formatDuration(execution.startedAt, execution.completedAt)} />
              <Metadata label="Policy" value={execution.policy?.lifecycle.retainAfterRun ? 'Retained' : 'Ephemeral'} />
            </div>
            {execution.policy === undefined ? null : (
              <>
                <Separator className="bg-border/20" />
                <div className="grid gap-3 text-sm sm:grid-cols-3">
                  <Metadata label="Network" value={execution.policy.network.blockAll ? 'Blocked' : execution.policy.network.allowList ?? 'Default'} />
                  <Metadata label="CPU" value={execution.policy.resources.cpu === undefined ? 'Default' : String(execution.policy.resources.cpu)} />
                  <Metadata label="Memory" value={execution.policy.resources.memoryGb === undefined ? 'Default' : `${execution.policy.resources.memoryGb} GB`} />
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

function Metadata({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  )
}
