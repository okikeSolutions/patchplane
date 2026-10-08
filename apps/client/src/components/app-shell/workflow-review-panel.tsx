import { useEffect, useRef, useState } from 'react'
import {
  CheckCircle2Icon,
  CheckIcon,
  CircleAlertIcon,
  XIcon,
} from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { ItemGroup } from '@/components/ui/item'
import { Textarea } from '@/components/ui/textarea'
import { submitReviewDecisionServerFn } from '@/lib/review-decision'
import * as m from '@/paraglide/messages'
import type { WorkflowDetail } from './types'
import type { WorkflowReportCoherence } from './workflow-report-coherence'
import {
  deriveWorkflowTrustSummary,
  verificationCoverageForDecision,
} from './workflow-trust-summary'
import { workflowTrustAlertVariant } from './workflow-status-badge'

import {
  type HumanDecisionStatus,
  EvidenceCheck,
  RuntimeSummary,
  decisionLabel,
  decisionConfirmationLabel,
  decisionPendingLabel,
} from './workflow-review-evidence'
function latestBy<A>(items: ReadonlyArray<A>, timestamp: (item: A) => number) {
  return items.reduce<A | undefined>(
    (latest, item) =>
      latest === undefined || timestamp(item) > timestamp(latest)
        ? item
        : latest,
    undefined,
  )
}

export function WorkflowReviewPanel({
  coherence,
  detail,
}: {
  readonly coherence?: WorkflowReportCoherence
  readonly detail: WorkflowDetail
}) {
  const [comment, setComment] = useState('')
  const [verificationOverrideReason, setVerificationOverrideReason] =
    useState('')
  const [decisionIntent, setDecisionIntent] = useState<
    HumanDecisionStatus | undefined
  >()
  const [submittingStatus, setSubmittingStatus] = useState<
    HumanDecisionStatus | undefined
  >()
  const [error, setError] = useState<string | undefined>()
  const [success, setSuccess] = useState<string | undefined>()
  const commentRef = useRef<HTMLTextAreaElement>(null)
  const decisionButtons = useRef<
    Partial<Record<HumanDecisionStatus, HTMLButtonElement>>
  >({})
  const submissionAttempt = useRef<
    | {
        readonly fingerprint: string
        readonly idempotencyKey: string
        readonly sandboxExecutionId: string
        readonly candidatePatchSetId: string
        readonly reviewRunId: string
        readonly policyDecisionId: string
      }
    | undefined
  >(undefined)
  const hasComment = comment.trim().length > 0
  const hasOverrideReason = verificationOverrideReason.trim().length > 0
  const trustSummary = deriveWorkflowTrustSummary(detail)
  const isSubmitting = submittingStatus !== undefined
  const sandboxExecution = latestBy(
    detail.sandboxExecutions,
    (execution) => execution.completedAt,
  )
  const candidatePatchSet = latestBy(
    detail.candidatePatchSets,
    (candidate) => candidate.createdAt,
  )
  const reviewRun = latestBy(detail.reviewRuns, (review) => review.createdAt)
  const policyDecision = latestBy(
    detail.policyDecisions,
    (decision) => decision.createdAt,
  )
  const currentHumanDecision = latestBy(
    detail.humanDecisions,
    (decision) => decision.decidedAt,
  )
  const currentDecisionPublications = detail.publicationResults.filter(
    (publication) => publication.humanDecisionId === currentHumanDecision?.id,
  )
  const decisionCandidate = detail.candidatePatchSets.find(
    (candidate) => candidate.id === currentHumanDecision?.candidatePatchSetId,
  )
  const repositoryRef = detail.promptRequest.externalRef
  const hasPublicationRepository =
    repositoryRef?.repositoryProvider !== undefined &&
    repositoryRef.repositoryOwner !== undefined &&
    repositoryRef.repositoryName !== undefined
  const expectedPublicationKinds = hasPublicationRepository
    ? [
        ...(repositoryRef.issueNumber === undefined
          ? []
          : (['issue-comment'] as const)),
        ...(decisionCandidate?.headSha === undefined
          ? []
          : (['check-run'] as const)),
      ]
    : []
  const publicationNeedsRetry =
    currentHumanDecision?.idempotencyKey !== undefined &&
    expectedPublicationKinds.some(
      (kind) =>
        !currentDecisionPublications.some(
          (publication) =>
            publication.kind === kind &&
            publication.status === 'published' &&
            publication.idempotencyKey === `${currentHumanDecision.id}:${kind}`,
        ),
    )
  const policyAllowsReview =
    policyDecision?.status === 'approved' ||
    policyDecision?.status === 'manual-review'
  const verificationCoverage = verificationCoverageForDecision(
    detail,
    candidatePatchSet?.id,
    policyDecision,
  )
  const hasCurrentProjection =
    coherence?.status !== 'blocked' &&
    detail.workflowRun.status === 'reviewed' &&
    sandboxExecution !== undefined &&
    candidatePatchSet !== undefined &&
    reviewRun?.sandboxExecutionId === sandboxExecution.id &&
    reviewRun.candidatePatchSetId === candidatePatchSet.id &&
    policyDecision?.reviewRunId === reviewRun.id

  useEffect(() => {
    if (decisionIntent !== undefined) {
      commentRef.current?.focus()
    }
  }, [decisionIntent])

  const chooseDecision = (status: HumanDecisionStatus) => {
    setDecisionIntent(status)
    setError(undefined)
    setSuccess(undefined)
  }

  const cancelDecision = () => {
    const trigger = decisionIntent
      ? decisionButtons.current[decisionIntent]
      : undefined
    setDecisionIntent(undefined)
    setComment('')
    setVerificationOverrideReason('')
    setError(undefined)
    trigger?.focus()
  }

  const retryDecisionPublication = async () => {
    if (
      currentHumanDecision === undefined ||
      currentHumanDecision.sandboxExecutionId === undefined ||
      currentHumanDecision.candidatePatchSetId === undefined ||
      currentHumanDecision.reviewRunId === undefined ||
      currentHumanDecision.policyDecisionId === undefined ||
      currentHumanDecision.idempotencyKey === undefined ||
      isSubmitting
    ) {
      return
    }

    setSubmittingStatus(currentHumanDecision.status)
    setError(undefined)
    setSuccess(undefined)
    try {
      const response = await submitReviewDecisionServerFn({
        data: {
          workflowRunId: detail.workflowRun.id,
          sandboxExecutionId: currentHumanDecision.sandboxExecutionId,
          candidatePatchSetId: currentHumanDecision.candidatePatchSetId,
          reviewRunId: currentHumanDecision.reviewRunId,
          policyDecisionId: currentHumanDecision.policyDecisionId,
          status: currentHumanDecision.status,
          comment: currentHumanDecision.comment,
          ...(currentHumanDecision.verificationOverrideReason === undefined
            ? {}
            : {
                verificationOverrideReason:
                  currentHumanDecision.verificationOverrideReason,
              }),
          idempotencyKey: currentHumanDecision.idempotencyKey,
        },
      })
      if (!response.ok) {
        setError(response.error)
        return
      }
      setSuccess(m.app_review_publication_retry_succeeded())
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : m.app_review_record_failed(),
      )
    } finally {
      setSubmittingStatus(undefined)
    }
  }

  const submitDecision = async (status: HumanDecisionStatus) => {
    const trimmedComment = comment.trim()
    const trimmedOverrideReason = verificationOverrideReason.trim()
    const requiresVerificationOverride =
      status === 'approved' && !verificationCoverage.complete
    if (
      trimmedComment.length === 0 ||
      (status === 'approved' &&
        (!policyAllowsReview ||
          (!verificationCoverage.complete &&
            !verificationCoverage.canOverride))) ||
      (requiresVerificationOverride && trimmedOverrideReason.length === 0) ||
      isSubmitting ||
      !hasCurrentProjection ||
      sandboxExecution === undefined ||
      candidatePatchSet === undefined ||
      reviewRun === undefined ||
      policyDecision === undefined
    ) {
      return
    }

    setSubmittingStatus(status)
    setError(undefined)
    setSuccess(undefined)
    try {
      const fingerprint = `${detail.workflowRun.id}:${sandboxExecution.id}:${candidatePatchSet.id}:${reviewRun.id}:${policyDecision.id}:${status}:${trimmedComment}:${requiresVerificationOverride ? trimmedOverrideReason : ''}`
      if (submissionAttempt.current?.fingerprint !== fingerprint) {
        submissionAttempt.current = {
          fingerprint,
          idempotencyKey: `${detail.workflowRun.id}:${status}:${globalThis.crypto.randomUUID()}`,
          sandboxExecutionId: sandboxExecution.id,
          candidatePatchSetId: candidatePatchSet.id,
          reviewRunId: reviewRun.id,
          policyDecisionId: policyDecision.id,
        }
      }
      const response = await submitReviewDecisionServerFn({
        data: {
          workflowRunId: detail.workflowRun.id,
          sandboxExecutionId: submissionAttempt.current.sandboxExecutionId,
          candidatePatchSetId: submissionAttempt.current.candidatePatchSetId,
          reviewRunId: submissionAttempt.current.reviewRunId,
          policyDecisionId: submissionAttempt.current.policyDecisionId,
          status,
          comment: trimmedComment,
          ...(requiresVerificationOverride
            ? { verificationOverrideReason: trimmedOverrideReason }
            : {}),
          idempotencyKey: submissionAttempt.current.idempotencyKey,
        },
      })
      if (!response.ok) {
        setError(response.error)
        return
      }
      submissionAttempt.current = undefined
      setComment('')
      setVerificationOverrideReason('')
      setDecisionIntent(undefined)
      setSuccess(
        status === 'approved'
          ? m.app_review_success_approved()
          : status === 'rejected'
            ? m.app_review_success_rejected()
            : m.app_review_success_changes(),
      )
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : m.app_review_record_failed(),
      )
    } finally {
      setSubmittingStatus(undefined)
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-medium">{m.app_review_title()}</h2>
        <p className="m-0 mt-1 text-sm text-muted-foreground">
          {m.app_review_intro()}
        </p>
      </div>
      <Alert variant={workflowTrustAlertVariant(trustSummary.state)}>
        <CircleAlertIcon />
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
      <ItemGroup className="gap-1 rounded-lg border border-border bg-[var(--surface-nested)] p-1">
        {trustSummary.dimensions.map((dimension) =>
          dimension.key === 'execution' ? (
            <RuntimeSummary
              key={dimension.key}
              dimension={dimension}
              execution={sandboxExecution}
              candidate={candidatePatchSet}
            />
          ) : (
            <EvidenceCheck
              key={dimension.key}
              label={dimension.label}
              status={dimension.status}
              detail={dimension.detail}
              tone={dimension.tone}
            />
          ),
        )}
      </ItemGroup>
      {hasCurrentProjection ? null : (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>{m.app_review_unavailable()}</AlertTitle>
          <AlertDescription>
            {m.app_review_unavailable_detail()}
          </AlertDescription>
        </Alert>
      )}
      {error === undefined ? null : (
        <Alert role="alert" variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>{m.app_review_failed()}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div aria-live="polite">
        {success === undefined ? null : (
          <Alert variant="success">
            <CheckCircle2Icon />
            <AlertTitle>{m.app_review_recorded()}</AlertTitle>
            <AlertDescription>{success}</AlertDescription>
          </Alert>
        )}
      </div>
      {currentHumanDecision === undefined ? (
        <>
          <div
            aria-label={m.app_review_choose()}
            className="grid grid-cols-1 gap-2"
          >
            <Button
              ref={(node) => {
                decisionButtons.current.approved = node ?? undefined
              }}
              type="button"
              className="min-h-11 w-full"
              aria-pressed={decisionIntent === 'approved'}
              disabled={
                !policyAllowsReview ||
                !verificationCoverage.canOverride ||
                !hasCurrentProjection ||
                sandboxExecution.status !== 'succeeded' ||
                candidatePatchSet.status !== 'captured' ||
                reviewRun.status !== 'completed'
              }
              onClick={() => chooseDecision('approved')}
            >
              <CheckIcon data-icon="inline-start" />
              {m.app_review_approve()}
            </Button>
            <Button
              ref={(node) => {
                decisionButtons.current['changes-requested'] = node ?? undefined
              }}
              type="button"
              variant="secondary"
              className="min-h-11 w-full"
              aria-pressed={decisionIntent === 'changes-requested'}
              disabled={!hasCurrentProjection}
              onClick={() => chooseDecision('changes-requested')}
            >
              <CircleAlertIcon data-icon="inline-start" />
              {m.app_review_request_changes()}
            </Button>
            <Button
              ref={(node) => {
                decisionButtons.current.rejected = node ?? undefined
              }}
              type="button"
              variant="destructive"
              className="min-h-11 w-full"
              aria-pressed={decisionIntent === 'rejected'}
              disabled={!hasCurrentProjection}
              onClick={() => chooseDecision('rejected')}
            >
              <XIcon data-icon="inline-start" />
              {m.app_review_reject()}
            </Button>
          </div>
          <Collapsible open={decisionIntent !== undefined}>
            <CollapsibleContent>
              {decisionIntent === undefined ? null : (
                <div
                  aria-label={`${decisionLabel(decisionIntent)} form`}
                  className="mt-1 flex flex-col gap-4 border-t border-border pt-4"
                >
                  <div>
                    <h3 className="text-sm font-medium">
                      {decisionLabel(decisionIntent)}
                    </h3>
                    <p className="m-0 mt-1 text-xs text-muted-foreground">
                      {m.app_review_rationale()}
                    </p>
                  </div>
                  <FieldGroup>
                    <Field
                      data-invalid={
                        !hasComment && comment.length > 0 ? true : undefined
                      }
                    >
                      <FieldLabel htmlFor="workflow-review-comment">
                        {m.app_review_comment()}
                      </FieldLabel>
                      <Textarea
                        ref={commentRef}
                        id="workflow-review-comment"
                        value={comment}
                        required
                        aria-describedby="workflow-review-comment-description"
                        aria-invalid={!hasComment && comment.length > 0}
                        placeholder={m.app_review_comment_placeholder()}
                        onChange={(event) =>
                          setComment(event.currentTarget.value)
                        }
                      />
                      <FieldDescription id="workflow-review-comment-description">
                        {m.app_review_comment_detail()}
                      </FieldDescription>
                    </Field>
                    {decisionIntent !== 'approved' ||
                    verificationCoverage.complete ||
                    !verificationCoverage.canOverride ? null : (
                      <Field
                        data-invalid={
                          !hasOverrideReason &&
                          verificationOverrideReason.length > 0
                            ? true
                            : undefined
                        }
                      >
                        <FieldLabel htmlFor="workflow-verification-override-reason">
                          {m.app_review_override()}
                        </FieldLabel>
                        <Textarea
                          id="workflow-verification-override-reason"
                          value={verificationOverrideReason}
                          aria-describedby="workflow-verification-override-description"
                          aria-invalid={
                            !hasOverrideReason &&
                            verificationOverrideReason.length > 0
                          }
                          maxLength={1000}
                          placeholder={m.app_review_override_placeholder()}
                          onChange={(event) =>
                            setVerificationOverrideReason(
                              event.currentTarget.value,
                            )
                          }
                        />
                        <FieldDescription id="workflow-verification-override-description">
                          {m.app_review_override_detail()}
                        </FieldDescription>
                      </Field>
                    )}
                  </FieldGroup>
                  <div className="grid grid-cols-1 gap-2">
                    <Button
                      type="button"
                      variant={
                        decisionIntent === 'rejected'
                          ? 'destructive'
                          : 'default'
                      }
                      className="min-h-11 w-full"
                      aria-busy={submittingStatus === decisionIntent}
                      disabled={
                        !hasComment ||
                        (decisionIntent === 'approved' &&
                          (!policyAllowsReview ||
                            (!verificationCoverage.complete &&
                              (!verificationCoverage.canOverride ||
                                !hasOverrideReason)))) ||
                        isSubmitting ||
                        !hasCurrentProjection
                      }
                      onClick={() => void submitDecision(decisionIntent)}
                    >
                      {submittingStatus === decisionIntent
                        ? decisionPendingLabel(decisionIntent)
                        : decisionConfirmationLabel(decisionIntent)}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="min-h-11 w-full"
                      disabled={isSubmitting}
                      onClick={cancelDecision}
                    >
                      {m.app_cancel()}
                    </Button>
                  </div>
                </div>
              )}
            </CollapsibleContent>
          </Collapsible>
        </>
      ) : publicationNeedsRetry ? (
        <Button
          type="button"
          className="min-h-11 w-full"
          aria-busy={isSubmitting}
          disabled={isSubmitting}
          onClick={() => void retryDecisionPublication()}
        >
          {isSubmitting
            ? m.app_review_publication_retry_pending()
            : m.app_review_publication_retry()}
        </Button>
      ) : null}
    </section>
  )
}
