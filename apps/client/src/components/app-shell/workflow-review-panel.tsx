import { useRef, useState } from 'react'
import { CheckIcon, MessageSquareWarningIcon, XIcon } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
import { submitReviewDecisionServerFn } from '@/lib/review-decision'
import type { WorkflowDetail } from './types'
import { deriveWorkflowTrustState, workflowTrustStateLabel } from './workflow-trust-state'

export function WorkflowReviewPanel({ detail }: { readonly detail: WorkflowDetail }) {
  const [comment, setComment] = useState('')
  const [submittingStatus, setSubmittingStatus] = useState<HumanDecisionStatus | undefined>()
  const [error, setError] = useState<string | undefined>()
  const submissionAttempt = useRef<{ readonly fingerprint: string; readonly idempotencyKey: string } | undefined>(undefined)
  const hasComment = comment.trim().length > 0
  const trustState = deriveWorkflowTrustState(detail)
  const isSubmitting = submittingStatus !== undefined

  const submitDecision = async (status: HumanDecisionStatus) => {
    const trimmedComment = comment.trim()
    if (trimmedComment.length === 0 || isSubmitting) {
      return
    }

    setSubmittingStatus(status)
    setError(undefined)
    try {
      const fingerprint = `${detail.workflowRun.id}:${status}:${trimmedComment}`
      if (submissionAttempt.current?.fingerprint !== fingerprint) {
        submissionAttempt.current = {
          fingerprint,
          idempotencyKey: `${detail.workflowRun.id}:${status}:${globalThis.crypto.randomUUID()}`,
        }
      }
      const response = await submitReviewDecisionServerFn({
        data: {
          workflowRunId: detail.workflowRun.id,
          status,
          comment: trimmedComment,
          idempotencyKey: submissionAttempt.current.idempotencyKey,
        },
      })
      if (!response.ok) {
        setError(response.error)
        return
      }
      submissionAttempt.current = undefined
      setComment('')
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
      </FieldGroup>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={!hasComment || isSubmitting}
          onClick={() => void submitDecision('approved')}
        >
          <CheckIcon data-icon="inline-start" />
          {submittingStatus === 'approved' ? 'Approving...' : 'Approve'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={!hasComment || isSubmitting}
          onClick={() => void submitDecision('changes-requested')}
        >
          <MessageSquareWarningIcon data-icon="inline-start" />
          {submittingStatus === 'changes-requested' ? 'Requesting...' : 'Request changes'}
        </Button>
        <Button
          type="button"
          variant="destructive"
          disabled={!hasComment || isSubmitting}
          onClick={() => void submitDecision('rejected')}
        >
          <XIcon data-icon="inline-start" />
          {submittingStatus === 'rejected' ? 'Rejecting...' : 'Reject'}
        </Button>
      </div>
    </section>
  )
}

type HumanDecisionStatus = 'approved' | 'rejected' | 'changes-requested'
