import { useState } from 'react'
import { CopyIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { RuntimeEventRow, SandboxExecutionRow } from './types'

async function copyText(value: string) {
  if (typeof navigator === 'undefined' || navigator.clipboard === undefined) {
    throw new Error('Clipboard access is unavailable')
  }
  await navigator.clipboard.writeText(value)
}

function latestOutput(executions: ReadonlyArray<SandboxExecutionRow>) {
  return executions.at(-1)
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
  const latestExecution = latestOutput(sandboxExecutions)
  const stdout = latestExecution?.stdout ?? ''
  const stderr = latestExecution?.stderr ?? ''
  const eventLog = runtimeEvents
    .map((event) => JSON.stringify(event, null, 2))
    .join('\n\n')

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-medium">Logs</h2>
        <p className="m-0 mt-1 text-sm text-muted-foreground">
          Raw evidence stays one click away from the workflow summary.
        </p>
      </div>
      <Tabs defaultValue="runtime">
        <TabsList variant="line" aria-label="Log streams">
          <TabsTrigger value="runtime">Runtime events</TabsTrigger>
          <TabsTrigger value="stdout">Stdout</TabsTrigger>
          <TabsTrigger value="stderr">Stderr</TabsTrigger>
        </TabsList>
        <TabsContent value="runtime">
          {runtimeEventsTruncated ? (
            <p className="mb-2 text-xs text-muted-foreground">
              Showing the latest {runtimeEvents.length} normalized events. Full raw output remains in the evidence artifact.
            </p>
          ) : null}
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
  const [copyStatus, setCopyStatus] = useState<string>()

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
      <div className="flex items-center justify-end gap-2">
        <span className="text-xs text-muted-foreground" aria-live="polite">{copyStatus}</span>
        <Button
          variant="secondary"
          size="sm"
          className="min-h-11 md:min-h-8"
          onClick={() => {
            void copyText(value).then(
              () => setCopyStatus('Copied to clipboard'),
              () => setCopyStatus('Copy failed'),
            )
          }}
        >
          <CopyIcon data-icon="inline-start" />
          Copy
        </Button>
      </div>
      <ScrollArea className="h-72 rounded-lg bg-[var(--surface-nested)]">
        <pre className="break-words p-3 font-mono text-xs text-muted-foreground whitespace-pre-wrap [overflow-wrap:anywhere]">
          {value}
        </pre>
      </ScrollArea>
    </div>
  )
}
