import type { ActorId, PromptRequestId, WorkflowRunId, WorkspaceId } from '@patchplane/domain/ids'
import { assemblePatchReportV0, type PatchReportStatus } from '@patchplane/domain/patch-report'
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
  const workflowRunId = detail.workflowRun.id as string as WorkflowRunId
  const patchReport = assemblePatchReportV0({
    workflowStart: {
      promptRequest: {
        ...detail.promptRequest,
        id: detail.promptRequest.id as PromptRequestId,
        workspaceId: detail.promptRequest.workspaceId as WorkspaceId,
        actorId: detail.promptRequest.actorId as ActorId,
      },
      workflowRun: {
        ...detail.workflowRun,
        id: workflowRunId,
        promptRequestId: detail.workflowRun.promptRequestId as PromptRequestId,
        workspaceId: detail.workflowRun.workspaceId as WorkspaceId,
      },
    },
    runtimeEvents: detail.runtimeEvents.map((event) => ({
      ...event,
      workflowRunId,
    })),
    runtimeSessions: detail.runtimeSessions.map((session) => ({
      ...session,
      workflowRunId,
    })),
    sandboxExecutions: detail.sandboxExecutions.map((execution) => ({
      ...execution,
      workflowRunId,
    })),
    evidenceArtifacts: detail.evidenceArtifacts.map((artifact) => ({
      ...artifact,
      workflowRunId,
    })),
    policyDecisions: detail.policyDecisions.map((decision) => ({
      ...decision,
      workflowRunId,
    })),
    humanDecisions: detail.humanDecisions.map((decision) => ({
      ...decision,
      workflowRunId,
      actorId: decision.actorId as ActorId,
    })),
  })
  const externalRef = detail.promptRequest.externalRef
  const sourceLabel = patchReport.repository ?? detail.promptRequest.source
  const decisionStatus = patchReport.decision?.status ?? 'pending human decision'

  return (
    <div className="flex flex-col gap-5">
      <Card className="ring-border/60">
        <CardHeader>
          <CardTitle>Patch report</CardTitle>
          <CardDescription>{workflowTrustStateDetail(trustState)}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <WorkflowRunStatusBadge status={detail.workflowRun.status} />
            <WorkflowTrustStateBadge state={trustState} />
            <Badge variant="secondary" className="bg-muted text-muted-foreground">{patchReportStatusLabel(patchReport.status)}</Badge>
            <Badge variant="secondary" className="bg-muted text-muted-foreground">{sourceLabel}</Badge>
          </div>
          <Separator className="bg-border/60" />
          <MetadataGrid
            items={[
              ['Patch report', patchReport.id],
              ['Workflow run', patchReport.workflowRunId],
              ['Trace', detail.workflowRun.traceId],
              ['Verification', patchReport.execution.status],
              ['Command', patchReport.execution.command ?? 'not run'],
              ['Exit code', patchReport.execution.exitCode === undefined ? 'unknown' : String(patchReport.execution.exitCode)],
              ['Checks', String(patchReport.checks.length)],
              ['Evidence', `${patchReport.evidence.length} evidence items`],
              ['Decision', decisionStatus],
            ]}
          />
        </CardContent>
      </Card>

      <Card className="ring-border/60">
        <CardHeader>
          <CardTitle>What was requested?</CardTitle>
          <CardDescription>The original AI patch request stays attached to the report.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="m-0 whitespace-pre-wrap text-sm leading-relaxed">
            {detail.promptRequest.prompt}
          </p>
        </CardContent>
      </Card>

      <Card className="ring-border/60">
        <CardHeader>
          <CardTitle>Where did it come from?</CardTitle>
          <CardDescription>
            Repository, pull request, issue, or product surface that created this report.
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

function patchReportStatusLabel(status: PatchReportStatus) {
  switch (status) {
    case 'pending':
      return 'Patch report pending'
    case 'verification-passed':
      return 'Verification passed'
    case 'verification-failed':
      return 'Verification failed'
    case 'approved':
      return 'Approved'
    case 'rejected':
      return 'Rejected'
    case 'changes-requested':
      return 'Changes requested'
    default:
      return status
  }
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
