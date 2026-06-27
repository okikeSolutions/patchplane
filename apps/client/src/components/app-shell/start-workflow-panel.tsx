import { useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { useAuth } from '@workos/authkit-tanstack-react-start/client'
import { CheckCircle2Icon } from 'lucide-react'
import { Schema } from 'effect'
import { StartWorkflowPromptInput } from '@patchplane/domain/start-workflow'
import * as m from '@/paraglide/messages'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
import { startWorkflowServerFn } from '@/lib/start-workflow'

const startWorkflowPromptStandardSchema = Schema.toStandardSchemaV1(
  StartWorkflowPromptInput,
)

export function StartWorkflowPanel() {
  return (
    <section id="workflows" className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{m.app_workflow_title()}</h2>
          <p className="m-0 mt-1 text-sm text-muted-foreground">
            {m.app_workflow_status_detail()}
          </p>
        </div>
        <div className="shrink-0">
          <Badge variant="secondary">Authenticated</Badge>
        </div>
      </div>
      <StartWorkflowForm />
    </section>
  )
}

function StartWorkflowForm() {
  const { user, organizationId } = useAuth()
  const [result, setResult] = useState<{
    promptRequestId: string
    workflowRunId: string
    workflowStatus: string
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const hasAuthenticatedWorkspace = Boolean(user) && Boolean(organizationId)
  const form = useForm({
    defaultValues: {
      prompt: 'Review the recent authentication foundation and suggest one safe next patch.',
    },
    validators: {
      onSubmit: startWorkflowPromptStandardSchema,
    },
    onSubmit: async ({ value }) => {
      if (!hasAuthenticatedWorkspace) {
        return
      }

      setError(null)
      setResult(null)
      try {
        const response = await startWorkflowServerFn({ data: value })
        if (!response.ok) {
          setError(response.error)
          return
        }

        setResult({
          promptRequestId: response.workflowStart.promptRequest.id,
          workflowRunId: response.workflowStart.workflowRun.id,
          workflowStatus: response.workflowStart.workflowRun.status,
        })
      } catch (cause: unknown) {
        setError(
          cause instanceof Error
            ? cause.message
            : m.app_workflow_start_error(),
        )
      }
    },
  })

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        event.stopPropagation()
        void form.handleSubmit()
      }}
    >
      <FieldGroup>
        <form.Field name="prompt">
          {(field) => {
            const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid
            return (
              <Field data-invalid={isInvalid}>
                <FieldLabel htmlFor={field.name}>
                  {m.app_workflow_prompt_label()}
                </FieldLabel>
                <Textarea
                  id={field.name}
                  name={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.currentTarget.value)}
                  disabled={field.form.state.isSubmitting}
                  rows={5}
                  placeholder={m.app_workflow_prompt_placeholder()}
                  aria-label={m.app_workflow_prompt_label()}
                  aria-invalid={isInvalid}
                />
                <FieldDescription>
                  Starts the WorkOS-authorized PatchPlane foundation workflow.
                </FieldDescription>
                {isInvalid ? <FieldError errors={toFieldErrors(field.state.meta.errors)} /> : null}
              </Field>
            )
          }}
        </form.Field>
      </FieldGroup>
      <div className="flex flex-wrap items-center gap-3">
        <form.Subscribe
          selector={(state) => ({
            canSubmit: state.canSubmit,
            isSubmitting: state.isSubmitting,
          })}
        >
          {({ canSubmit, isSubmitting }) => (
            <Button
              type="submit"
              disabled={!hasAuthenticatedWorkspace || !canSubmit || isSubmitting}
            >
              {isSubmitting
                ? m.app_workflow_start_submitting()
                : m.app_workflow_start_button()}
            </Button>
          )}
        </form.Subscribe>
        {!user ? (
          <span className="text-sm text-muted-foreground">
            {m.app_workflow_start_signed_out()}
          </span>
        ) : null}
        {user && !organizationId ? (
          <span className="text-sm text-muted-foreground">
            {m.app_workflow_start_no_org()}
          </span>
        ) : null}
      </div>
      {result ? <WorkflowStartResult result={result} /> : null}
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Workflow start failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </form>
  )
}

function toFieldErrors(errors: ReadonlyArray<unknown>) {
  return errors.map((error) => {
    if (
      typeof error === 'object' &&
      error !== null &&
      'message' in error &&
      typeof error.message === 'string'
    ) {
      return { message: error.message }
    }

    return { message: String(error) }
  })
}

function WorkflowStartResult({
  result,
}: {
  readonly result: {
    readonly promptRequestId: string
    readonly workflowRunId: string
    readonly workflowStatus: string
  }
}) {
  return (
    <Alert>
      <CheckCircle2Icon />
      <AlertTitle>{m.app_workflow_start_success()}</AlertTitle>
      <AlertDescription>
        <span className="block">
          {m.app_workflow_prompt_request_id()}{' '}
          <code className="font-mono">{result.promptRequestId}</code>
        </span>
        <span className="block">
          {m.app_workflow_run_id()}{' '}
          <code className="font-mono">{result.workflowRunId}</code>
        </span>
        <span className="block">
          {m.app_workflow_run_status()}{' '}
          <code className="font-mono">{result.workflowStatus}</code>
        </span>
      </AlertDescription>
    </Alert>
  )
}
