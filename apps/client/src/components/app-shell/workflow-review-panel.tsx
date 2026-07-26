import { useRef, useState } from 'react'
import { CheckCircle2Icon, CheckIcon, CircleAlertIcon, MessageSquareWarningIcon, XIcon } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
import { submitReviewDecisionServerFn } from '@/lib/review-decision'
import type { WorkflowDetail } from './types'
import { deriveWorkflowTrustState, workflowTrustStateLabel } from './workflow-trust-state'

function latestBy<A>(items: ReadonlyArray<A>, timestamp: (item: A) => number) {
  return items.reduce<A | undefined>(
    (latest, item) =>
      latest === undefined || timestamp(item) > timestamp(latest) ? item : latest,
    undefined,
  )
}

export function verificationCoverageForDecision(
  detail: WorkflowDetail,
  candidatePatchSetId: string | undefined,
  policyDecision: WorkflowDetail['policyDecisions'][number] | undefined,
) {
  const required = detail.verificationRequirements.filter((requirement) => requirement.required)
  const consideredResultIds = new Set(policyDecision?.verificationResultIds ?? [])
  const passedRequirementIds = new Set(
    detail.verificationResults
      .filter((result) =>
        result.candidatePatchSetId === candidatePatchSetId &&
        consideredResultIds.has(result.id) &&
        result.status === 'passed'
      )
      .map((result) => result.requirementId),
  )
  const passedCount = required.filter((requirement) => passedRequirementIds.has(requirement.id)).length
  const truncated = detail.verificationRequirementsTruncated || detail.verificationResultsTruncated
  const complete =
    !truncated &&
    required.length > 0 &&
    (policyDecision?.missingRequirementIds?.length ?? 0) === 0 &&
    passedCount === required.length

  return {
    canOverride: !truncated,
    complete,
    detail: truncated
      ? 'Verification records are truncated. Approval is blocked until the complete projection is available.'
      : required.length === 0
        ? 'No required verification is configured; approval requires an explicit override.'
        : `${passedCount} of ${required.length} required checks passed for this candidate${complete ? '.' : '; approval requires an explicit override.'}`,
    passedCount,
    requiredCount: required.length,
  }
}

export function WorkflowReviewPanel({ detail }: { readonly detail: WorkflowDetail }) {
  const [comment, setComment] = useState('')
  const [verificationOverrideReason, setVerificationOverrideReason] = useState('')
  const [submittingStatus, setSubmittingStatus] = useState<HumanDecisionStatus | undefined>()
  const [error, setError] = useState<string | undefined>()
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
  const trustState = deriveWorkflowTrustState(detail)
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
  const blockingFindings = detail.reviewFindings.filter(
    (finding) => finding.reviewRunId === reviewRun?.id && (finding.severity === 'error' || finding.severity === 'critical'),
  )
  const reviewPassed = reviewRun?.status === 'completed' && blockingFindings.length === 0
  const policyAllowsReview = policyDecision?.status === 'approved' || policyDecision?.status === 'manual-review'
  const verificationCoverage = verificationCoverageForDecision(detail, candidatePatchSet?.id, policyDecision)
  const hasCurrentProjection =
    detail.workflowRun.status === 'reviewed' &&
    sandboxExecution !== undefined &&
    candidatePatchSet !== undefined &&
    reviewRun?.sandboxExecutionId === sandboxExecution.id &&
    reviewRun.candidatePatchSetId === candidatePatchSet.id &&
    policyDecision?.reviewRunId === reviewRun.id

  const submitDecision = async (status: HumanDecisionStatus) => {
    const trimmedComment = comment.trim()
    const trimmedOverrideReason = verificationOverrideReason.trim()
    const requiresVerificationOverride = status === 'approved' && !verificationCoverage.complete
    if (
      trimmedComment.length === 0 ||
      (status === 'approved' && (!policyAllowsReview || (!verificationCoverage.complete && !verificationCoverage.canOverride))) ||
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
          ...(requiresVerificationOverride ? { verificationOverrideReason: trimmedOverrideReason } : {}),
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
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to record decision')
    } finally {
      setSubmittingStatus(undefined)
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-medium">Review decision</h3>
        <p className="m-0 mt-1 text-sm text-muted-foreground">
          Maintainer-controlled dogfooding requires an explicit comment before any decision.
        </p>
      </div>
      <Alert>
        <MessageSquareWarningIcon />
        <AlertTitle>Current verdict: {workflowTrustStateLabel(trustState)}</AlertTitle>
        <AlertDescription>
          Decisions are durable and become part of the Patch Report audit trail.
        </AlertDescription>
      </Alert>
      <div className="grid gap-2 rounded-lg border border-border bg-[var(--surface-nested)] p-3 text-sm">
        <EvidenceCheck label="Sandbox execution" ready={sandboxExecution?.status === 'succeeded'} detail={sandboxExecution === undefined ? 'Not recorded' : `${sandboxExecution.command} · exit ${sandboxExecution.exitCode ?? 'unknown'}`} />
        <EvidenceCheck label="Candidate patch" ready={candidatePatchSet?.status === 'captured'} detail={candidatePatchSet?.summary ?? candidatePatchSet?.id ?? 'Not captured'} />
        <EvidenceCheck label="Automated review" ready={reviewPassed} status={reviewRun === undefined ? 'missing' : reviewPassed ? 'passed' : reviewRun.status === 'completed' ? 'blocked' : reviewRun.status} detail={blockingFindings.length > 0 ? `${blockingFindings.length} blocking findings` : reviewRun?.summary ?? reviewRun?.reviewer ?? 'Not completed'} />
        <EvidenceCheck label="Policy verdict" ready={policyAllowsReview} status={policyDecision?.status ?? 'missing'} detail={policyDecision?.summary ?? 'Not evaluated'} />
        <EvidenceCheck label="Candidate-bound verification" ready={verificationCoverage.complete} status={verificationCoverage.complete ? 'passed' : verificationCoverage.requiredCount === 0 ? 'not configured' : 'incomplete'} detail={verificationCoverage.detail} />
      </div>
      {hasCurrentProjection ? null : (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>Decision unavailable</AlertTitle>
          <AlertDescription>
            The latest execution, candidate, review, and policy records do not form one coherent projection. Refresh after verification completes.
          </AlertDescription>
        </Alert>
      )}
      {error === undefined ? null : (
        <Alert variant="destructive">
          <MessageSquareWarningIcon />
          <AlertTitle>Decision failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <FieldGroup>
        <Field data-invalid={!hasComment && comment.length > 0 ? true : undefined}>
          <FieldLabel htmlFor="workflow-review-comment">Required comment</FieldLabel>
          <Textarea
            id="workflow-review-comment"
            value={comment}
            aria-invalid={!hasComment && comment.length > 0}
            placeholder="Explain why this workflow should be approved, rejected, or changed."
            onChange={(event) => setComment(event.currentTarget.value)}
          />
          <FieldDescription>
            Comments are required for approve, reject, and request-changes actions.
          </FieldDescription>
        </Field>
        {verificationCoverage.complete || !verificationCoverage.canOverride ? null : (
          <Field data-invalid={!hasOverrideReason && verificationOverrideReason.length > 0 ? true : undefined}>
            <FieldLabel htmlFor="workflow-verification-override-reason">Verification override reason</FieldLabel>
            <Textarea
              id="workflow-verification-override-reason"
              value={verificationOverrideReason}
              aria-invalid={!hasOverrideReason && verificationOverrideReason.length > 0}
              maxLength={1000}
              placeholder="Explain why approval is justified despite incomplete or unconfigured verification."
              onChange={(event) => setVerificationOverrideReason(event.currentTarget.value)}
            />
            <FieldDescription>
              Required only for approval. This explicit override is stored in the Patch Report audit trail.
            </FieldDescription>
          </Field>
        )}
      </FieldGroup>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={!hasComment || !policyAllowsReview || (!verificationCoverage.complete && (!verificationCoverage.canOverride || !hasOverrideReason)) || isSubmitting || !hasCurrentProjection || sandboxExecution.status !== 'succeeded' || candidatePatchSet.status !== 'captured' || reviewRun.status !== 'completed'}
          onClick={() => void submitDecision('approved')}
        >
          <CheckIcon data-icon="inline-start" />
          {submittingStatus === 'approved' ? 'Approving...' : 'Approve'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={!hasComment || isSubmitting || !hasCurrentProjection}
          onClick={() => void submitDecision('changes-requested')}
        >
          <MessageSquareWarningIcon data-icon="inline-start" />
          {submittingStatus === 'changes-requested' ? 'Requesting...' : 'Request changes'}
        </Button>
        <Button
          type="button"
          variant="destructive"
          disabled={!hasComment || isSubmitting || !hasCurrentProjection}
          onClick={() => void submitDecision('rejected')}
        >
          <XIcon data-icon="inline-start" />
          {submittingStatus === 'rejected' ? 'Rejecting...' : 'Reject'}
        </Button>
      </div>
    </section>
  )
}

function EvidenceCheck({ label, ready, status, detail }: { readonly label: string; readonly ready: boolean; readonly status?: string; readonly detail: string }) {
  return (
    <div className="flex min-w-0 items-start gap-2">
      {ready ? <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-[var(--success-readable)]" /> : <CircleAlertIcon className="mt-0.5 size-4 shrink-0 text-[var(--destructive-readable)]" />}
      <div className="min-w-0"><div className="font-medium">{label} · <span className="font-normal text-muted-foreground">{status ?? (ready ? 'ready' : 'missing')}</span></div><div className="truncate text-xs text-muted-foreground">{detail}</div></div>
    </div>
  )
}

type HumanDecisionStatus = 'approved' | 'rejected' | 'changes-requested'
