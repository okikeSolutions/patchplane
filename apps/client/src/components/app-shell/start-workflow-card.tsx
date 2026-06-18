import { useState } from 'react'
import { useAuth } from '@workos/authkit-tanstack-react-start/client'
import { CheckCircle2Icon } from 'lucide-react'
import * as m from '@/paraglide/messages'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
import { startWorkflowServerFn } from '@/lib/start-workflow'

export function StartWorkflowCard() {
  return (
    <Card id="workflows">
      <CardHeader>
        <CardTitle>{m.app_workflow_title()}</CardTitle>
        <CardDescription>{m.app_workflow_status_detail()}</CardDescription>
        <CardAction>
          <Badge variant="secondary">Authenticated</Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        <StartWorkflowForm />
      </CardContent>
    </Card>
  )
}

function StartWorkflowForm() {
  const { user, organizationId } = useAuth()
  const [prompt, setPrompt] = useState(
    'Review the recent authentication foundation and suggest one safe next patch.',
  )
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [result, setResult] = useState<{
    promptRequestId: string
    workflowRunId: string
    workflowStatus: string
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const canSubmit =
    Boolean(user) && Boolean(organizationId) && prompt.trim().length > 0

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (!canSubmit || isSubmitting) {
          return
        }

        setIsSubmitting(true)
        setError(null)
        setResult(null)
        void startWorkflowServerFn({ data: { prompt: prompt.trim() } })
          .then((response) => {
            if (!response.ok) {
              setError(response.error)
              return
            }

            setResult({
              promptRequestId: response.workflowStart.promptRequest.id,
              workflowRunId: response.workflowStart.workflowRun.id,
              workflowStatus: response.workflowStart.workflowRun.status,
            })
          })
          .catch((cause: unknown) => {
            setError(
              cause instanceof Error
                ? cause.message
                : m.app_workflow_start_error(),
            )
          })
          .finally(() => {
            setIsSubmitting(false)
          })
      }}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="workflow-prompt">
            {m.app_workflow_prompt_label()}
          </FieldLabel>
          <Textarea
            id="workflow-prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.currentTarget.value)}
            disabled={isSubmitting}
            rows={5}
            placeholder={m.app_workflow_prompt_placeholder()}
            aria-label={m.app_workflow_prompt_label()}
          />
          <FieldDescription>
            Starts the WorkOS-authorized PatchPlane foundation workflow.
          </FieldDescription>
        </Field>
      </FieldGroup>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={!canSubmit || isSubmitting}>
          {isSubmitting
            ? m.app_workflow_start_submitting()
            : m.app_workflow_start_button()}
        </Button>
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
