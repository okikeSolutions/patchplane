import { useRef, useState } from 'react'
import { RotateCcwIcon } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
import { rerunWorkflowServerFn } from '@/lib/rerun-workflow'
import * as m from '@/paraglide/messages'
import { localizeAppHref } from './app-language'

export function WorkflowRerunPanel({
  onCreated,
  parentWorkflowRunId,
  unavailableReason,
}: {
  readonly onCreated?: (workflowRunId: string) => void
  readonly parentWorkflowRunId: string
  readonly unavailableReason?: string
}) {
  const [reason, setReason] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [childWorkflowRunId, setChildWorkflowRunId] = useState<
    string | undefined
  >()
  const submissionAttempt = useRef<
    | { readonly fingerprint: string; readonly idempotencyKey: string }
    | undefined
  >(undefined)
  const trimmedReason = reason.trim()

  async function submit() {
    if (
      trimmedReason.length === 0 ||
      isSubmitting ||
      unavailableReason !== undefined
    )
      return

    const fingerprint = `${parentWorkflowRunId}:${trimmedReason}`
    if (submissionAttempt.current?.fingerprint !== fingerprint) {
      submissionAttempt.current = {
        fingerprint,
        idempotencyKey: `${parentWorkflowRunId}:rerun:${globalThis.crypto.randomUUID()}`,
      }
    }

    setIsSubmitting(true)
    setError(undefined)
    try {
      const response = await rerunWorkflowServerFn({
        data: {
          parentWorkflowRunId,
          reason: trimmedReason,
          idempotencyKey: submissionAttempt.current.idempotencyKey,
        },
      })
      if (!response.ok) {
        setError(response.error)
        return
      }

      submissionAttempt.current = undefined
      setChildWorkflowRunId(response.workflowRunId)
      if (response.dispatchError !== undefined) {
        setError(response.dispatchError)
      } else {
        onCreated?.(response.workflowRunId)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : m.app_rerun_failed())
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!isOpen && childWorkflowRunId === undefined) {
    return (
      <div className="flex flex-col gap-2">
        <Button
          type="button"
          variant="outline"
          className="min-h-11 w-full"
          disabled={unavailableReason !== undefined}
          onClick={() => setIsOpen(true)}
        >
          <RotateCcwIcon data-icon="inline-start" />
          {m.app_rerun_action()}
        </Button>
        {unavailableReason === undefined ? null : (
          <p className="m-0 text-xs text-muted-foreground">
            {unavailableReason}
          </p>
        )}
      </div>
    )
  }

  return (
    <section className="flex flex-col gap-3 border-t border-border pt-4">
      <span className="sr-only" aria-live="polite">
        {childWorkflowRunId === undefined
          ? ''
          : error === undefined
            ? m.app_rerun_created()
            : m.app_rerun_dispatch_attention()}
      </span>
      <div>
        <h2 className="text-sm font-medium">{m.app_rerun_title()}</h2>
        <p className="m-0 mt-1 text-sm text-muted-foreground">
          {m.app_rerun_intro()}
        </p>
      </div>
      {childWorkflowRunId === undefined ? (
        <>
          {error === undefined ? null : (
            <Alert role="alert" variant="destructive">
              <AlertTitle>{m.app_rerun_error_title()}</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Field
            data-invalid={
              reason.length > 0 && trimmedReason.length === 0 ? true : undefined
            }
          >
            <FieldLabel htmlFor="workflow-rerun-reason">
              {m.app_rerun_reason()}
            </FieldLabel>
            <Textarea
              id="workflow-rerun-reason"
              value={reason}
              required
              aria-describedby="workflow-rerun-reason-description"
              aria-invalid={reason.length > 0 && trimmedReason.length === 0}
              maxLength={1000}
              placeholder={m.app_rerun_reason_placeholder()}
              onChange={(event) => setReason(event.currentTarget.value)}
            />
            <FieldDescription id="workflow-rerun-reason-description">
              {m.app_rerun_reason_detail()}
            </FieldDescription>
          </Field>
          <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
            <Button
              type="button"
              className="min-h-11 w-full sm:w-auto"
              aria-busy={isSubmitting}
              disabled={trimmedReason.length === 0 || isSubmitting}
              onClick={() => void submit()}
            >
              <RotateCcwIcon data-icon="inline-start" />
              {isSubmitting ? m.app_rerun_starting() : m.app_rerun_run_again()}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="min-h-11 w-full sm:w-auto"
              disabled={isSubmitting}
              onClick={() => {
                setIsOpen(false)
                setError(undefined)
              }}
            >
              {m.app_cancel()}
            </Button>
          </div>
        </>
      ) : (
        <Alert role={error === undefined ? undefined : 'alert'}>
          <AlertTitle>
            {error === undefined
              ? m.app_rerun_created()
              : m.app_rerun_dispatch_attention()}
          </AlertTitle>
          <AlertDescription>
            {error === undefined
              ? `${m.app_rerun_child_ready()} `
              : `${error} `}
            <a
              className="font-medium underline underline-offset-4"
              href={localizeAppHref(`/app/workflows/${childWorkflowRunId}`)}
            >
              {m.app_rerun_open_child()}
            </a>
          </AlertDescription>
        </Alert>
      )}
    </section>
  )
}
