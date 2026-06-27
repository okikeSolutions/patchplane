import { ExternalLinkIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import type { WorkflowDetail } from './types'
import { WorkflowRunStatusBadge, WorkflowTrustStateBadge } from './workflow-status-badge'
import { deriveWorkflowTrustState, workflowTrustStateDetail } from './workflow-trust-state'

export function WorkflowDetailOverview({ detail }: { readonly detail: WorkflowDetail }) {
  const trustState = deriveWorkflowTrustState(detail)
  const externalRef = detail.promptRequest.externalRef
  const sourceLabel = externalRef?.repositoryFullName ?? detail.promptRequest.source

  return (
    <div className="flex flex-col gap-5">
      <Card className="ring-border/60">
        <CardHeader>
          <CardTitle>Current state</CardTitle>
          <CardDescription>{workflowTrustStateDetail(trustState)}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <WorkflowRunStatusBadge status={detail.workflowRun.status} />
            <WorkflowTrustStateBadge state={trustState} />
            <Badge variant="secondary" className="bg-muted text-muted-foreground">{sourceLabel}</Badge>
          </div>
          <Separator className="bg-border/60" />
          <MetadataGrid
            items={[
              ['Workflow run', detail.workflowRun.id],
              ['Trace', detail.workflowRun.traceId],
              ['Prompt request', detail.promptRequest.id],
              ['Source', detail.promptRequest.source],
            ]}
          />
        </CardContent>
      </Card>

      <Card className="ring-border/60">
        <CardHeader>
          <CardTitle>Prompt</CardTitle>
          <CardDescription>Intake summary</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="m-0 whitespace-pre-wrap text-sm leading-relaxed">
            {detail.promptRequest.prompt}
          </p>
        </CardContent>
      </Card>

      <Card className="ring-border/60">
        <CardHeader>
          <CardTitle>Source</CardTitle>
          <CardDescription>
            Repository or product surface that created this workflow
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {externalRef === undefined ? (
            <MetadataGrid items={[['Origin', detail.promptRequest.source]]} />
          ) : (
            <>
              <MetadataGrid
                items={[
                  ['Provider', externalRef.provider],
                  ['Event', externalRef.eventKind],
                  ['Repository', externalRef.repositoryFullName ?? 'unknown'],
                  ['Issue / PR', externalRef.issueNumber === undefined ? 'unknown' : `#${externalRef.issueNumber}`],
                  ['Sender', externalRef.senderLogin ?? 'unknown'],
                  ['Installation', externalRef.repositoryInstallationId ?? 'unknown'],
                ]}
              />
              {externalRef.url === undefined ? null : (
                <div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => window.open(externalRef.url, '_blank', 'noreferrer')}
                  >
                    <ExternalLinkIcon data-icon="inline-start" />
                    Open source event
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function MetadataGrid({
  items,
}: {
  readonly items: ReadonlyArray<readonly [string, string]>
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {items.map(([label, value]) => (
        <div key={label} className="flex min-w-0 flex-col gap-1">
          <span className="text-xs text-muted-foreground">{label}</span>
          <span className="truncate font-mono text-xs">{value}</span>
        </div>
      ))}
    </div>
  )
}
