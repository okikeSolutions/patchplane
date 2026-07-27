import { useState } from 'react'
import {
  CheckCircle2Icon,
  CircleAlertIcon,
  ShieldCheckIcon,
} from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Separator } from '@/components/ui/separator'
import type { WorkflowDetail } from './types'
import { currentWorkflowProjection } from './workflow-trust-state'
import {
  deriveWorkflowTrustSummary,
  type WorkflowTrustDimension,
} from './workflow-trust-summary'
import { workflowTrustAlertVariant } from './workflow-status-badge'
import { getAppLocale } from './app-language'
import {
  WorkflowRequestMarkdown,
  workflowRequestMarkdown,
} from './workflow-request-markdown'
import * as m from '@/paraglide/messages'

export function WorkflowDetailOverview({
  detail,
}: {
  readonly detail: WorkflowDetail
}) {
  const [requestOpen, setRequestOpen] = useState(false)
  const requestMarkdown = workflowRequestMarkdown(detail)
  const trustSummary = deriveWorkflowTrustSummary(detail)
  const { review, policy, decision, decisionIsCurrent } =
    currentWorkflowProjection(detail)
  const currentFindings = detail.reviewFindings.filter(
    (finding) => finding.reviewRunId === review?.id,
  )
  const policyDimension = trustSummary.dimensions.find(
    (dimension) => dimension.key === 'policy',
  )
  const reviewDimension = trustSummary.dimensions.find(
    (dimension) => dimension.key === 'review',
  )
  const verificationDimension = trustSummary.dimensions.find(
    (dimension) => dimension.key === 'verification',
  )
  const decisionPublications =
    decisionIsCurrent && decision !== undefined
      ? detail.publicationResults.filter(
          (result) =>
            result.idempotencyKey?.startsWith(`${decision.id}:`) === true,
        )
      : []
  const publishedResults = decisionPublications.filter(
    (result) => result.status === 'published',
  )
  const failedPublications = decisionPublications.filter(
    (result) => result.status === 'failed',
  )

  return (
    <div className="flex flex-col gap-5">
      <Alert variant={workflowTrustAlertVariant(trustSummary.state)}>
        {trustSummary.state === 'approved' ? (
          <CheckCircle2Icon />
        ) : (
          <CircleAlertIcon />
        )}
        <AlertTitle>{trustSummary.label}</AlertTitle>
        <AlertDescription>
          {trustSummary.reasons.length === 0 ? null : (
            <ol
              aria-label={m.app_review_reasons()}
              className="flex list-decimal flex-col gap-1 pl-4"
            >
              {trustSummary.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ol>
          )}
        </AlertDescription>
      </Alert>

      <section
        aria-labelledby="trust-dimensions-heading"
        className="flex flex-col gap-4"
      >
        <h2 id="trust-dimensions-heading" className="text-base font-medium">
          {m.app_overview_dimensions()}
        </h2>
        <ul className="m-0 grid list-none gap-x-5 gap-y-4 p-0 sm:grid-cols-2 xl:grid-cols-5">
          {trustSummary.dimensions.map((dimension) => (
            <TrustDimensionMetric key={dimension.key} dimension={dimension} />
          ))}
        </ul>
      </section>

      <Separator />
      <div className="grid gap-5 lg:grid-cols-2">
        <Collapsible open={requestOpen} onOpenChange={setRequestOpen}>
          <Card className="ring-border">
            <CardHeader>
              <div className="flex flex-col items-start gap-3 sm:flex-row sm:justify-between">
                <div>
                  <CardTitle as="h2" className="flex items-center gap-2">
                    <ShieldCheckIcon />
                    {m.app_overview_requested()}
                  </CardTitle>
                  <CardDescription>
                    {m.app_overview_requested_detail()}
                  </CardDescription>
                </div>
                <CollapsibleTrigger
                  render={
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="min-h-11 w-full shrink-0 sm:min-h-8 sm:w-auto"
                    />
                  }
                >
                  {requestOpen
                    ? m.app_overview_hide_request()
                    : m.app_overview_show_request()}
                </CollapsibleTrigger>
              </div>
            </CardHeader>
            <CollapsibleContent>
              <CardContent>
                {requestMarkdown.length === 0 ? (
                  <p className="m-0 text-sm text-muted-foreground">
                    {m.app_overview_request_empty()}
                  </p>
                ) : (
                  <WorkflowRequestMarkdown markdown={requestMarkdown} />
                )}
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
        <section
          aria-labelledby="automated-verdict-heading"
          className="flex flex-col gap-4"
        >
          <div className="flex flex-col gap-1">
            <h2
              id="automated-verdict-heading"
              className="flex items-center gap-2 text-base font-medium"
            >
              <ShieldCheckIcon />
              {m.app_overview_verdict()}
            </h2>
            <p className="m-0 text-sm text-muted-foreground">
              {m.app_overview_verdict_detail()}
            </p>
          </div>
          <div className="flex flex-col gap-3">
            {policy === undefined ? (
              <p className="m-0 text-sm text-muted-foreground">
                {m.app_overview_no_verdict()}
              </p>
            ) : (
              <>
                <Badge className="w-fit" variant="outline">
                  {policyDimension?.status ?? m.app_overview_evaluated()}
                </Badge>
                {reviewDimension === undefined ? null : (
                  <div>
                    <div className="text-sm font-medium">
                      {reviewDimension.label} · {reviewDimension.status}
                    </div>
                    <p className="m-0 mt-1 text-sm text-muted-foreground">
                      {reviewDimension.detail}
                    </p>
                  </div>
                )}
                {verificationDimension ===
                undefined ? null : verificationDimension.tone === 'positive' ? (
                  <TrustDimensionMetric dimension={verificationDimension} />
                ) : (
                  <Alert variant="warning">
                    <CircleAlertIcon />
                    <AlertTitle>
                      {verificationDimension.label} ·{' '}
                      {verificationDimension.status}
                    </AlertTitle>
                    <AlertDescription>
                      {verificationDimension.detail}
                    </AlertDescription>
                  </Alert>
                )}
                <p className="m-0 text-sm text-muted-foreground">
                  {policy.status === 'manual-review'
                    ? m.app_overview_human_required()
                    : policy.summary}
                </p>
              </>
            )}
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {currentFindings
                .toSorted(
                  (left, right) =>
                    findingRank(right.severity) - findingRank(left.severity),
                )
                .slice(0, 4)
                .map((finding) => (
                  <li key={finding.id} className="flex gap-2 text-sm">
                    <CircleAlertIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <div>
                      <span className="font-medium">
                        {finding.severity} · {finding.category}
                      </span>
                      <p className="m-0 text-muted-foreground">
                        {finding.message}
                      </p>
                      {finding.path === undefined ? null : (
                        <code className="mt-1 block text-xs">
                          {finding.path}
                          {finding.startLine === undefined
                            ? ''
                            : `:${finding.startLine}`}
                        </code>
                      )}
                    </div>
                  </li>
                ))}
            </ul>
            {currentFindings.length > 4 ? (
              <p className="m-0 text-xs text-muted-foreground">
                +{currentFindings.length - 4}{' '}
                {m.app_overview_additional_findings()}
              </p>
            ) : null}
          </div>
        </section>
      </div>

      <Separator />
      <section
        aria-labelledby="decision-publication-heading"
        className="flex flex-col gap-4"
      >
        <div className="flex flex-col gap-1">
          <h2
            id="decision-publication-heading"
            className="text-base font-medium"
          >
            {m.app_overview_decision_publication()}
          </h2>
          <p className="m-0 text-sm text-muted-foreground">
            {m.app_overview_decision_publication_detail()}
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
          <Record
            label={m.app_trust_human_decision()}
            value={
              decisionIsCurrent
                ? decision?.status === 'approved'
                  ? m.app_status_approved()
                  : decision?.status === 'rejected'
                    ? m.app_status_rejected()
                    : m.app_status_changes_requested()
                : m.app_trust_pending()
            }
            detail={
              decision === undefined
                ? m.app_trust_no_decision()
                : decisionIsCurrent
                  ? `${decision.actorId} · ${new Date(decision.decidedAt).toLocaleString(getAppLocale())}\n${decision.comment}${decision.verificationOverride ? `\n\n${m.app_overview_override()}: ${decision.verificationOverrideReason ?? m.app_overview_reason_unavailable()}` : ''}`
                  : m.app_overview_previous_decision()
            }
          />
          <Separator className="md:hidden" />
          <Separator orientation="vertical" className="hidden md:block" />
          <Record
            label={m.app_overview_github_publication()}
            value={
              failedPublications.length > 0
                ? m.app_overview_partial_failure()
                : publishedResults.length > 0
                  ? m.app_overview_published()
                  : m.app_trust_pending()
            }
            detail={`${publishedResults.length} ${m.app_overview_published_count()} · ${failedPublications.length} ${m.app_overview_failed_count()} · ${decisionPublications.length} ${m.app_overview_attempts()}`}
            href={
              publishedResults.find((result) => result.url !== undefined)?.url
            }
          />
        </div>
      </section>
    </div>
  )
}

function findingRank(
  severity: WorkflowDetail['reviewFindings'][number]['severity'],
) {
  return severity === 'critical'
    ? 4
    : severity === 'error'
      ? 3
      : severity === 'warning'
        ? 2
        : 1
}

function TrustDimensionMetric({
  dimension,
}: {
  readonly dimension: WorkflowTrustDimension
}) {
  return (
    <li className="min-w-0">
      <div className="text-xs text-muted-foreground">{dimension.label}</div>
      <div className="mt-1 text-sm font-semibold">{dimension.status}</div>
      <div className="mt-1 text-xs text-muted-foreground">
        {dimension.detail}
      </div>
    </li>
  )
}

function Record({
  label,
  value,
  detail,
  href,
}: {
  readonly label: string
  readonly value: string
  readonly detail: string
  readonly href?: string
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{label}</span>
        <Badge variant="outline">{value}</Badge>
      </div>
      <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">
        {detail}
      </p>
      {href === undefined ? null : (
        <a
          className="text-sm font-medium underline underline-offset-4"
          href={href}
          target="_blank"
          rel="noreferrer"
        >
          {m.app_overview_open_publication()}
        </a>
      )}
    </div>
  )
}
