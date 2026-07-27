import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import * as m from '@/paraglide/messages'
import type { RuntimeEventRow, SandboxExecutionRow } from './types'
import {
  WorkflowEvidenceTable,
  type WorkflowEvidenceTableRow,
} from './workflow-evidence-table'

function runtimeEventRows(
  runtimeEvents: ReadonlyArray<RuntimeEventRow>,
): ReadonlyArray<WorkflowEvidenceTableRow> {
  return runtimeEvents.map((event) => ({
    key: event.id,
    title: event.summary ?? event.type,
    source: event.provider,
    label: event.type,
    occurredAt: event.occurredAt,
    detail: JSON.stringify(event, null, 2),
  }))
}

function executionOutputRows(
  executions: ReadonlyArray<SandboxExecutionRow>,
  stream: 'stderr' | 'stdout',
): ReadonlyArray<WorkflowEvidenceTableRow> {
  return executions.flatMap((execution) => {
    const output = execution[stream]
    if (output === undefined || output.length === 0) return []
    return [
      {
        key: `${execution.id}:${stream}`,
        title: execution.command,
        source: `${execution.provider} · ${execution.sandboxId}`,
        label: execution.status,
        occurredAt: execution.completedAt,
        detail: output,
      },
    ]
  })
}

export function WorkflowLogViewer({
  runtimeEvents,
  runtimeEventsTruncated,
  sandboxExecutions,
}: {
  readonly runtimeEvents: ReadonlyArray<RuntimeEventRow>
  readonly runtimeEventsTruncated: boolean
  readonly sandboxExecutions: ReadonlyArray<SandboxExecutionRow>
}) {
  const events = runtimeEventRows(runtimeEvents)
  const stdout = executionOutputRows(sandboxExecutions, 'stdout')
  const stderr = executionOutputRows(sandboxExecutions, 'stderr')

  return (
    <section className="flex min-w-0 max-w-full flex-col gap-4 overflow-hidden">
      <div>
        <h2 className="text-sm font-medium">{m.app_detail_logs()}</h2>
        <p className="m-0 mt-1 text-sm text-muted-foreground">
          {m.app_logs_intro()}
        </p>
      </div>
      <Tabs defaultValue="runtime" className="min-w-0 max-w-full gap-4">
        <TabsList
          variant="line"
          aria-label={m.app_logs_streams()}
          className="h-auto max-w-full flex-wrap justify-start overflow-visible group-data-horizontal/tabs:h-auto"
        >
          <TabsTrigger value="runtime" className="min-h-10 flex-none px-3">
            {m.app_logs_runtime()} ({events.length})
          </TabsTrigger>
          <TabsTrigger value="stdout" className="min-h-10 flex-none px-3">
            {m.app_logs_stdout()} ({stdout.length})
          </TabsTrigger>
          <TabsTrigger value="stderr" className="min-h-10 flex-none px-3">
            {m.app_logs_stderr()} ({stderr.length})
          </TabsTrigger>
        </TabsList>
        <TabsContent value="runtime" className="min-w-0 max-w-full">
          {runtimeEventsTruncated ? (
            <p className="mb-2 text-xs text-muted-foreground">
              {m.app_logs_showing_latest()} {runtimeEvents.length}{' '}
              {m.app_logs_truncated_detail()}
            </p>
          ) : null}
          <WorkflowEvidenceTable
            caption={m.app_logs_runtime_caption()}
            emptyTitle={m.app_logs_runtime_empty()}
            rows={events}
          />
        </TabsContent>
        <TabsContent value="stdout" className="min-w-0 max-w-full">
          <WorkflowEvidenceTable
            caption={m.app_logs_stdout_caption()}
            emptyTitle={m.app_logs_stdout_empty()}
            rows={stdout}
          />
        </TabsContent>
        <TabsContent value="stderr" className="min-w-0 max-w-full">
          <WorkflowEvidenceTable
            caption={m.app_logs_stderr_caption()}
            emptyTitle={m.app_logs_stderr_empty()}
            rows={stderr}
          />
        </TabsContent>
      </Tabs>
    </section>
  )
}
