import { AlertTriangleIcon, CheckCircle2Icon, CircleDotIcon, FileCheckIcon, ShieldCheckIcon } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import type { WorkflowDetail } from './types'
import { WorkflowRunStatusBadge, WorkflowTrustStateBadge } from './workflow-status-badge'
import { currentWorkflowProjection, deriveWorkflowTrustState, workflowTrustStateDetail } from './workflow-trust-state'

export function WorkflowDetailOverview({ detail }: { readonly detail: WorkflowDetail }) {
  const trustState = deriveWorkflowTrustState(detail)
  const { execution, candidate, review, policy, decision, decisionIsCurrent } = currentWorkflowProjection(detail)
  const currentFindings = detail.reviewFindings.filter((finding) => finding.reviewRunId === review?.id)
  const errorFindings = currentFindings.filter((item) => item.severity === 'error' || item.severity === 'critical')
  const decisionPublications = decisionIsCurrent && decision !== undefined
    ? detail.publicationResults.filter((result) => result.idempotencyKey?.startsWith(`${decision.id}:`) === true)
    : []
  const publishedResults = decisionPublications.filter((result) => result.status === 'published')
  const failedPublications = decisionPublications.filter((result) => result.status === 'failed')

  return (
    <div className="flex flex-col gap-5">
      <Alert variant={trustState === 'approved' ? 'default' : trustState === 'rejected' || trustState === 'sandbox-failed' ? 'destructive' : 'default'}>
        {trustState === 'approved' ? <CheckCircle2Icon /> : <AlertTriangleIcon />}
        <AlertTitle>{trustState === 'approved' ? 'This patch was approved' : 'This patch is not trusted yet'}</AlertTitle>
        <AlertDescription>{workflowTrustStateDetail(trustState)}</AlertDescription>
      </Alert>

      <Card className="ring-border">
        <CardHeader><CardTitle as="h2">Patch Report</CardTitle><CardDescription>The evidence-backed answer to what changed, what ran, and what happens next.</CardDescription></CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2"><WorkflowRunStatusBadge status={detail.workflowRun.status} /><WorkflowTrustStateBadge state={trustState} />{policy === undefined ? null : <Badge variant="outline">Policy: {policy.status}</Badge>}</div>
          <Separator />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryMetric label="Changed files" value={candidate?.stats?.filesChanged ?? 'Unknown'} detail={candidate?.status ?? 'No candidate'} />
            <SummaryMetric label="Sandbox" value={execution === undefined ? 'Not run' : execution.status === 'failed' ? 'Failed' : 'Passed'} detail={execution === undefined ? 'No current execution' : `Exit ${execution.exitCode ?? 'unknown'}`} />
            <SummaryMetric label="Checks" value={review === undefined ? 'Not run' : review.status === 'running' || review.status === 'queued' ? 'Running' : review.status === 'failed' || errorFindings.length > 0 ? `${errorFindings.length || 1} blocking` : 'No blockers'} detail={`${currentFindings.length} findings on current review`} />
            <SummaryMetric label="Evidence" value={detail.evidenceArtifacts.length} detail="durable artifacts" />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="ring-border">
          <CardHeader><CardTitle as="h2" className="flex items-center gap-2"><FileCheckIcon />Requested change</CardTitle><CardDescription>Original request attached to this report.</CardDescription></CardHeader>
          <CardContent><p className="m-0 whitespace-pre-wrap text-sm leading-relaxed">{detail.promptRequest.prompt}</p></CardContent>
        </Card>
        <Card className="ring-border">
          <CardHeader><CardTitle as="h2" className="flex items-center gap-2"><ShieldCheckIcon />Automated verdict</CardTitle><CardDescription>Review and policy results before the human decision.</CardDescription></CardHeader>
          <CardContent className="flex flex-col gap-3">
            {policy === undefined ? <p className="m-0 text-sm text-muted-foreground">Policy has not produced a verdict.</p> : <><Badge className="w-fit" variant="outline">{policy.status}</Badge><p className="m-0 text-sm">{policy.summary}</p>{policy.reason === undefined ? null : <p className="m-0 text-xs text-muted-foreground">{policy.reason}</p>}</>}
            {currentFindings.toSorted((left, right) => findingRank(right.severity) - findingRank(left.severity)).slice(0, 4).map((finding) => <div key={finding.id} className="flex gap-2 rounded-md border border-border p-2 text-sm"><CircleDotIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" /><div><span className="font-medium">{finding.severity} · {finding.category}</span><p className="m-0 text-muted-foreground">{finding.message}</p>{finding.path === undefined ? null : <code className="mt-1 block text-xs">{finding.path}{finding.startLine === undefined ? '' : `:${finding.startLine}`}</code>}</div></div>)}
            {currentFindings.length > 4 ? <p className="m-0 text-xs text-muted-foreground">+{currentFindings.length - 4} additional findings are retained in the report diagnostics.</p> : null}
          </CardContent>
        </Card>
      </div>

      <Card className="ring-border">
        <CardHeader><CardTitle as="h2">Decision and publication</CardTitle><CardDescription>Who decided, why, and what PatchPlane published afterward.</CardDescription></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <Record label="Human decision" value={decisionIsCurrent ? decision?.status ?? 'Pending' : 'Pending'} detail={decision === undefined ? 'No human decision recorded.' : decisionIsCurrent ? `${decision.actorId} · ${new Date(decision.decidedAt).toLocaleString()}\n${decision.comment}${decision.verificationOverride ? `\n\nVerification override: ${decision.verificationOverrideReason ?? 'Reason unavailable'}` : ''}` : `A previous ${decision.status} decision was superseded by newer evidence.`} />
          <Record label="GitHub publication" value={failedPublications.length > 0 ? 'Partial failure' : publishedResults.length > 0 ? 'Published' : 'Pending'} detail={`${publishedResults.length} published · ${failedPublications.length} failed · ${decisionPublications.length} attempts for the current decision`} href={publishedResults.find((result) => result.url !== undefined)?.url} />
        </CardContent>
      </Card>
    </div>
  )
}

function findingRank(severity: WorkflowDetail['reviewFindings'][number]['severity']) {
  return severity === 'critical' ? 4 : severity === 'error' ? 3 : severity === 'warning' ? 2 : 1
}

function SummaryMetric({ label, value, detail }: { readonly label: string; readonly value: string | number; readonly detail: string }) {
  return <div className="rounded-lg bg-[var(--surface-nested)] p-3"><div className="text-xs text-muted-foreground">{label}</div><div className="mt-1 text-lg font-semibold">{value}</div><div className="mt-1 text-xs text-muted-foreground">{detail}</div></div>
}

function Record({ label, value, detail, href }: { readonly label: string; readonly value: string; readonly detail: string; readonly href?: string }) {
  return <div className="rounded-lg border border-border p-3"><div className="flex items-center justify-between gap-2"><span className="text-xs text-muted-foreground">{label}</span><Badge variant="outline">{value}</Badge></div><p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">{detail}</p>{href === undefined ? null : <a className="text-sm font-medium underline underline-offset-4" href={href} target="_blank" rel="noreferrer">Open publication</a>}</div>
}
