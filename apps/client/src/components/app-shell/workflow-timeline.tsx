import { CheckCircle2Icon, CircleDashedIcon, GitBranchIcon, ShieldCheckIcon, TerminalIcon, UserCheckIcon, XCircleIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import type { WorkflowDetail } from './types'

type TimelineStatus = 'started' | 'succeeded' | 'failed' | 'blocked'
type TimelineItem = { readonly key: string; readonly occurredAt: number; readonly title: string; readonly detail: string; readonly category: string; readonly status: TimelineStatus }

function formatTimestamp(value: number) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function timelineItems(detail: WorkflowDetail): ReadonlyArray<TimelineItem> {
  const items: Array<TimelineItem> = [
    { key: 'prompt', occurredAt: detail.promptRequest.createdAt, title: 'Request received', detail: detail.promptRequest.externalRef?.repositoryFullName ?? detail.promptRequest.source, category: 'source', status: 'succeeded' },
    ...detail.provenanceEvents.map((event) => ({ key: `provenance:${event.id}`, occurredAt: event.startedAt, title: event.summary ?? event.operation, detail: [event.pluginName, event.operation, event.errorCategory].filter(Boolean).join(' · '), category: event.type, status: event.status })),
    ...detail.sandboxExecutions.flatMap((execution) => [
      { key: `sandbox:${execution.id}:start`, occurredAt: execution.startedAt, title: 'Sandbox execution started', detail: execution.command, category: 'sandbox', status: 'started' as const },
      { key: `sandbox:${execution.id}:end`, occurredAt: execution.completedAt, title: execution.status === 'failed' ? 'Sandbox execution failed' : 'Sandbox execution passed', detail: `Exit ${execution.exitCode ?? 'unknown'}`, category: 'sandbox', status: execution.status === 'failed' ? 'failed' as const : 'succeeded' as const },
    ]),
    ...detail.candidatePatchSets.map((candidate) => ({ key: `candidate:${candidate.id}`, occurredAt: candidate.createdAt, title: candidate.status === 'captured' ? 'Candidate patch captured' : 'Candidate patch unavailable', detail: candidate.summary ?? candidate.id, category: 'change', status: candidate.status === 'captured' ? 'succeeded' as const : 'failed' as const })),
    ...detail.reviewRuns.map((review) => ({ key: `review:${review.id}`, occurredAt: review.completedAt ?? review.startedAt, title: `Automated ${review.kind} review ${review.status}`, detail: review.summary ?? review.reviewer, category: 'review', status: review.status === 'failed' ? 'failed' as const : review.status === 'completed' ? 'succeeded' as const : 'started' as const })),
    ...detail.policyDecisions.map((policy) => ({ key: `policy:${policy.id}`, occurredAt: policy.createdAt, title: `Policy: ${policy.status}`, detail: policy.summary, category: 'policy', status: policy.status === 'approved' ? 'succeeded' as const : 'blocked' as const })),
    ...detail.humanDecisions.map((decision) => ({ key: `decision:${decision.id}`, occurredAt: decision.decidedAt, title: `Human decision: ${decision.status}${decision.verificationOverride ? ' (verification override)' : ''}`, detail: `${decision.actorId} · ${decision.comment}${decision.verificationOverride ? ` · Override: ${decision.verificationOverrideReason ?? 'reason unavailable'}` : ''}`, category: 'decision', status: decision.status === 'approved' ? 'succeeded' as const : 'blocked' as const })),
    ...detail.publicationResults.map((result) => ({ key: `publication:${result.id}`, occurredAt: result.createdAt, title: `GitHub ${result.kind}: ${result.status}`, detail: result.summary ?? result.error ?? result.externalId ?? 'Publication recorded', category: 'publication', status: result.status === 'failed' ? 'failed' as const : result.status === 'published' ? 'succeeded' as const : 'started' as const })),
  ]
  const canonicalItems = detail.provenanceEvents.length > 0
    ? items.filter((item) => item.key === 'prompt' || item.key.startsWith('provenance:'))
    : items
  return canonicalItems.toSorted(
    (left, right) => left.occurredAt - right.occurredAt,
  )
}

export function WorkflowTimeline({ detail }: { readonly detail: WorkflowDetail }) {
  const items = timelineItems(detail)
  return (
    <section className="flex flex-col gap-4">
      <div><h2 className="text-sm font-medium">Provenance timeline</h2><p className="m-0 mt-1 text-sm text-muted-foreground">Durable intake, execution, review, decision, and publication history.{detail.sandboxExecutionsTruncated ? ' Older sandbox execution previews are omitted; durable evidence remains available in artifacts.' : ''}</p></div>
      <ol className="flex flex-col">
        {items.map((item, index) => (
          <li key={item.key} className="flex gap-3">
            <div className="flex flex-col items-center"><div className="flex size-8 items-center justify-center rounded-full bg-muted text-muted-foreground"><TimelineIcon category={item.category} status={item.status} /></div>{index === items.length - 1 ? null : <Separator aria-hidden="true" orientation="vertical" className="min-h-8 bg-border" />}</div>
            <div className="min-w-0 flex-1 pb-4"><div className="flex flex-wrap items-center gap-2"><span className="font-medium">{item.title}</span><Badge variant={item.status === 'failed' ? 'destructive' : 'secondary'}>{item.status}</Badge></div><p className="m-0 mt-1 break-words text-sm text-muted-foreground [overflow-wrap:anywhere]">{item.detail}</p><time className="text-xs text-muted-foreground" dateTime={new Date(item.occurredAt).toISOString()}>{formatTimestamp(item.occurredAt)}</time></div>
          </li>
        ))}
      </ol>
    </section>
  )
}

function TimelineIcon({ category, status }: { readonly category: string; readonly status: TimelineStatus }) {
  if (status === 'failed') return <XCircleIcon />
  if (category.includes('decision')) return <UserCheckIcon />
  if (category.includes('policy') || category.includes('review')) return <ShieldCheckIcon />
  if (category.includes('sandbox') || category.includes('runtime')) return <TerminalIcon />
  if (category.includes('source') || category.includes('publication')) return <GitBranchIcon />
  return status === 'started' ? <CircleDashedIcon /> : <CheckCircle2Icon />
}
