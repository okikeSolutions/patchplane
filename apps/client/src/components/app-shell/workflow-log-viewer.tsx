import { CopyIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { RuntimeEventRow, SandboxExecutionRow } from './types'

function copyText(value: string) {
  if (typeof navigator === 'undefined') {
    return
  }
  void navigator.clipboard?.writeText(value)
}

function latestOutput(executions: ReadonlyArray<SandboxExecutionRow>) {
  return executions.at(-1)
}

export function WorkflowLogViewer({
  runtimeEvents,
  sandboxExecutions,
}: {
  readonly runtimeEvents: ReadonlyArray<RuntimeEventRow>
  readonly sandboxExecutions: ReadonlyArray<SandboxExecutionRow>
}) {
  const latestExecution = latestOutput(sandboxExecutions)
  const stdout = latestExecution?.stdout ?? ''
  const stderr = latestExecution?.stderr ?? ''
  const eventLog = runtimeEvents
    .map((event) => JSON.stringify(event, null, 2))
    .join('\n\n')

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-medium">Logs</h3>
        <p className="m-0 mt-1 text-sm text-muted-foreground">
          Raw evidence stays one click away from the workflow summary.
        </p>
      </div>
      <Tabs defaultValue="runtime">
        <TabsList variant="line">
          <TabsTrigger value="runtime">Runtime events</TabsTrigger>
          <TabsTrigger value="stdout">Stdout</TabsTrigger>
          <TabsTrigger value="stderr">Stderr</TabsTrigger>
        </TabsList>
        <TabsContent value="runtime">
          <LogBlock value={eventLog} emptyTitle="No runtime events" />
        </TabsContent>
        <TabsContent value="stdout">
          <LogBlock value={stdout} emptyTitle="No stdout captured" />
        </TabsContent>
        <TabsContent value="stderr">
          <LogBlock value={stderr} emptyTitle="No stderr captured" />
        </TabsContent>
      </Tabs>
    </section>
  )
}

function LogBlock({
  value,
  emptyTitle,
}: {
  readonly value: string
  readonly emptyTitle: string
}) {
  if (value.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon"><CopyIcon /></EmptyMedia>
          <EmptyTitle>{emptyTitle}</EmptyTitle>
          <EmptyDescription>
            patchplane will show captured evidence here when the runtime records it.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-end">
        <Button variant="secondary" size="sm" onClick={() => copyText(value)}>
          <CopyIcon data-icon="inline-start" />
          Copy
        </Button>
      </div>
      <ScrollArea className="h-72 rounded-lg bg-muted/30">
        <pre className="p-3 font-mono text-xs text-muted-foreground whitespace-pre-wrap">
          {value}
        </pre>
      </ScrollArea>
    </div>
  )
}
