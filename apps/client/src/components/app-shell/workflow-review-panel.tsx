import { useState } from 'react'
import { CheckIcon, MessageSquareWarningIcon, XIcon } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
import type { WorkflowDetail } from './types'
import { deriveWorkflowTrustState, workflowTrustStateLabel } from './workflow-trust-state'

export function WorkflowReviewPanel({ detail }: { readonly detail: WorkflowDetail }) {
  const [comment, setComment] = useState('')
  const hasComment = comment.trim().length > 0
  const trustState = deriveWorkflowTrustState(detail)

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
          M9.5 collects the review intent in the workflow UI. Durable review-run publication remains part of the M10 review loop.
        </AlertDescription>
      </Alert>
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
        <Button type="button" disabled={!hasComment}>
          <CheckIcon data-icon="inline-start" />
          Approve
        </Button>
        <Button type="button" variant="secondary" disabled={!hasComment}>
          <MessageSquareWarningIcon data-icon="inline-start" />
          Request changes
        </Button>
        <Button type="button" variant="destructive" disabled={!hasComment}>
          <XIcon data-icon="inline-start" />
          Reject
        </Button>
      </div>
    </section>
  )
}
