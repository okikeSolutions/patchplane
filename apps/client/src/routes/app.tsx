import { useEffect, useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useAuth } from '@workos/authkit-tanstack-react-start/client'
import { api } from '@patchplane/backend/convex/_generated/api'
import { type WorkflowStatus } from '@patchplane/domain/workflow-run'
import {
  Authenticated,
  AuthLoading,
  Unauthenticated,
  useMutation,
  useQuery,
} from 'convex/react'
import * as m from '@/paraglide/messages'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { startWorkflowServerFn } from '@/lib/start-workflow'

const timelineStatuses = [
  'queued',
  'running',
  'reviewed',
] as const satisfies ReadonlyArray<WorkflowStatus>
type TimelineStatus = (typeof timelineStatuses)[number]

interface ViewerIdentity {
  subject: string
  name: string
  email?: string
}


export const Route = createFileRoute('/app')({
  component: AppShellPage,
})

const statusLabels = {
  queued: m.app_status_queued_label,
  running: m.app_status_running_label,
  reviewed: m.app_status_reviewed_label,
} satisfies Record<TimelineStatus, () => string>

const statusDetails = {
  queued: m.app_status_queued_detail,
  running: m.app_status_running_detail,
  reviewed: m.app_status_reviewed_detail,
} satisfies Record<TimelineStatus, () => string>

function getStatusLabel(status: TimelineStatus) {
  return statusLabels[status]()
}

function getStatusDetail(status: TimelineStatus) {
  return statusDetails[status]()
}

function AppShellPage() {
  const { user, organizationId, signOut } = useAuth()
  const workspacePanels = [
    {
      title: m.app_panel_1_title(),
      detail: m.app_panel_1_detail(),
    },
    {
      title: m.app_panel_2_title(),
      detail: m.app_panel_2_detail(),
    },
    {
      title: m.app_panel_3_title(),
      detail: m.app_panel_3_detail(),
    },
  ] as const

  return (
    <main className="mx-auto w-[min(1120px,calc(100%-2rem))] pt-[clamp(2rem,5vw,3rem)] pb-16">
      <section className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-4 pt-4 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-[18px] motion-safe:duration-720 motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)] max-[960px]:grid-cols-1">
        <div>
          <Badge
            variant="outline"
            className="h-auto border-[rgb(255_208_132/0.22)] bg-[rgb(255_206_120/0.08)] px-[0.8rem] py-[0.45rem] uppercase tracking-[0.12em] text-inherit"
          >
            {m.app_hero_badge()}
          </Badge>
          <h1 className="mt-[0.65rem] text-balance text-[clamp(2.6rem,6vw,5rem)] leading-[0.97] tracking-[-0.06em]">
            {m.app_hero_title()}
          </h1>
          <p className="mt-[1.2rem] max-w-152 text-[clamp(1.02rem,1.6vw,1.14rem)] leading-[1.7] text-muted-foreground">
            {m.app_hero_intro()}
          </p>
        </div>
        <Link
          to="/about"
          className={cn(
            buttonVariants({ variant: 'outline', size: 'lg' }),
            'rounded-full border-white/10 bg-white/2 px-[1.15rem] hover:-translate-y-px',
          )}
        >
          {m.app_hero_architecture_link()}
        </Link>
      </section>

      <section className="mt-4 grid grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] gap-4 max-[960px]:grid-cols-1">
        <div className="rounded-[1.8rem] border border-white/8 bg-(--surface-panel) p-[1.35rem] backdrop-blur-md motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-[18px] motion-safe:duration-720 motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)]">
          <div className="grid gap-[0.7rem]">
            <Badge
              variant="outline"
              className="h-auto border-[rgb(255_208_132/0.22)] bg-[rgb(255_206_120/0.08)] px-[0.8rem] py-[0.45rem] uppercase tracking-[0.12em] text-inherit"
            >
              {m.app_auth_badge()}
            </Badge>
            <h2 className="mt-[0.85rem] text-balance text-[clamp(1.7rem,3vw,2.5rem)] leading-[1.05] tracking-[-0.04em]">
              {m.app_auth_title()}
            </h2>
          </div>
          <p className="m-0 leading-[1.7] text-muted-foreground">
            {m.app_auth_intro()}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {user ? (
              <Button
                type="button"
                onClick={() => {
                  void signOut()
                }}
              >
                {m.app_sign_out()}
              </Button>
            ) : (
              <a
                href="/api/auth/sign-in?returnPathname=/app"
                className={buttonVariants()}
              >
                {m.app_sign_in()}
              </a>
            )}
            <span className="text-sm text-muted-foreground">
              {user
                ? m.app_signed_in_as({
                    name:
                      user.firstName ?? user.email ?? m.app_operator_fallback(),
                  })
                : m.app_sign_in_prompt()}
            </span>
            {user && !organizationId ? (
              <div className="basis-full rounded-2xl border border-amber-400/20 bg-amber-400/8 p-4 text-sm text-muted-foreground">
                <p className="m-0">
                  No active WorkOS organization is selected. Reconnect with
                  WorkOS or select an organization from your WorkOS session
                  before starting authenticated workflows.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <a
                    href="/api/auth/sign-in?returnPathname=/app"
                    className={buttonVariants({ variant: 'secondary' })}
                  >
                    Reconnect with WorkOS
                  </a>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div
          className="rounded-[1.8rem] border border-white/8 bg-(--surface-panel) p-[1.35rem] backdrop-blur-md motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-[18px] motion-safe:duration-720 motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)]"
          style={{ animationDelay: '120ms' }}
        >
          <div className="grid gap-[0.7rem]">
            <Badge
              variant="outline"
              className="h-auto border-[rgb(255_208_132/0.22)] bg-[rgb(255_206_120/0.08)] px-[0.8rem] py-[0.45rem] uppercase tracking-[0.12em] text-inherit"
            >
              {m.app_auth_state_badge()}
            </Badge>
            <h2 className="mt-[0.85rem] text-balance text-[clamp(1.7rem,3vw,2.5rem)] leading-[1.05] tracking-[-0.04em]">
              {m.app_auth_state_title()}
            </h2>
          </div>
          <AuthLoading>
            <p className="m-0 leading-[1.7] text-muted-foreground">
              {m.app_auth_loading()}
            </p>
          </AuthLoading>
          <Authenticated>
            <AuthenticatedContent />
          </Authenticated>
          <Unauthenticated>
            <p className="m-0 leading-[1.7] text-muted-foreground">
              {m.app_unauthenticated()}
            </p>
          </Unauthenticated>
        </div>
      </section>

      <section className="mt-8 grid grid-cols-3 gap-[0.85rem] max-[960px]:grid-cols-1">
        {timelineStatuses.map((status, index) => (
          <article
            key={status}
            className="rounded-[1.6rem] border border-white/8 bg-(--surface-panel) p-[1.35rem] backdrop-blur-md motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-[18px] motion-safe:duration-720 motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)]"
            style={{ animationDelay: `${index * 80 + 100}ms` }}
          >
            <span className="text-[0.78rem] uppercase tracking-[0.12em] text-(--brand-readable)">
              {getStatusLabel(status)}
            </span>
            <p className="m-0 leading-[1.7] text-muted-foreground">
              {getStatusDetail(status)}
            </p>
          </article>
        ))}
      </section>

      <section className="mt-4 grid grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] gap-4 max-[960px]:grid-cols-1">
        <div className="rounded-[1.8rem] border border-white/8 bg-(--surface-panel) p-[1.35rem] backdrop-blur-md motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-[18px] motion-safe:duration-720 motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)]">
          <div className="grid gap-[0.7rem]">
            <Badge
              variant="outline"
              className="h-auto border-[rgb(255_208_132/0.22)] bg-[rgb(255_206_120/0.08)] px-[0.8rem] py-[0.45rem] uppercase tracking-[0.12em] text-inherit"
            >
              {m.app_workflow_badge()}
            </Badge>
            <h2 className="mt-[0.85rem] text-balance text-[clamp(1.7rem,3vw,2.5rem)] leading-[1.05] tracking-[-0.04em]">
              {m.app_workflow_title()}
            </h2>
          </div>
          <StartWorkflowForm />
          <ol className="mt-6 grid gap-4 pl-[1.2rem]">
            {timelineStatuses.map((status) => (
              <li key={status} className="pl-[0.2rem]">
                <span className="m-0 text-[1.05rem] tracking-[-0.03em]">
                  {getStatusLabel(status)}
                </span>
                <p className="m-0 leading-[1.7] text-muted-foreground">
                  {m.app_workflow_status_detail()}
                </p>
              </li>
            ))}
          </ol>
        </div>

        <div
          className="rounded-[1.8rem] border border-white/8 bg-(--surface-panel) p-[1.35rem] backdrop-blur-md motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-[18px] motion-safe:duration-720 motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)]"
          style={{ animationDelay: '120ms' }}
        >
          <div className="grid gap-[0.7rem]">
            <Badge
              variant="outline"
              className="h-auto border-[rgb(255_208_132/0.22)] bg-[rgb(255_206_120/0.08)] px-[0.8rem] py-[0.45rem] uppercase tracking-[0.12em] text-inherit"
            >
              {m.app_focus_badge()}
            </Badge>
            <h2 className="mt-[0.85rem] text-balance text-[clamp(1.7rem,3vw,2.5rem)] leading-[1.05] tracking-[-0.04em]">
              {m.app_focus_title()}
            </h2>
          </div>
          <p className="m-0 leading-[1.7] text-muted-foreground">
            {m.app_focus_intro()}
          </p>
        </div>
      </section>

      <section className="mt-8 grid grid-cols-3 gap-4 max-[960px]:grid-cols-1">
        {workspacePanels.map((panel, index) => (
          <article
            key={panel.title}
            className="rounded-[1.6rem] border border-white/8 bg-(--surface-panel) p-[1.35rem] backdrop-blur-md motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-[18px] motion-safe:duration-720 motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)]"
            style={{ animationDelay: `${index * 90 + 160}ms` }}
          >
            <h3 className="m-0 text-[1.05rem] tracking-[-0.03em]">
              {panel.title}
            </h3>
            <p className="m-0 leading-[1.7] text-muted-foreground">
              {panel.detail}
            </p>
          </article>
        ))}
      </section>
    </main>
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
      className="mt-6 grid gap-3 rounded-[1.25rem] border border-white/8 bg-white/3 p-4"
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
      <label className="grid gap-2 text-sm font-medium" htmlFor="workflow-prompt">
        {m.app_workflow_prompt_label()}
        <textarea
          id="workflow-prompt"
          value={prompt}
          onChange={(event) => setPrompt(event.currentTarget.value)}
          disabled={isSubmitting}
          rows={4}
          className="min-h-28 w-full resize-y rounded-xl border border-input bg-transparent px-3 py-2 text-sm leading-6 outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30"
          placeholder={m.app_workflow_prompt_placeholder()}
          aria-label={m.app_workflow_prompt_label()}
        />
      </label>
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
      {result ? (
        <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/8 p-3 text-sm text-muted-foreground">
          <p className="m-0">{m.app_workflow_start_success()}</p>
          <p className="m-0 mt-2">
            {m.app_workflow_prompt_request_id()}{' '}
            <code className="font-mono">{result.promptRequestId}</code>
          </p>
          <p className="m-0">
            {m.app_workflow_run_id()}{' '}
            <code className="font-mono">{result.workflowRunId}</code>
          </p>
          <p className="m-0">
            {m.app_workflow_run_status()}{' '}
            <code className="font-mono">{result.workflowStatus}</code>
          </p>
        </div>
      ) : null}
      {error ? (
        <div className="rounded-xl border border-destructive/20 bg-destructive/8 p-3 text-sm text-muted-foreground">
          {error}
        </div>
      ) : null}
    </form>
  )
}

function AuthenticatedContent() {
  const ensureCurrentUser = useMutation(api.auth.ensureCurrentUser)
  const viewer = useQuery(api.viewer.current, {}) as ViewerIdentity | undefined
  const requests = useQuery(api.requests.list, {})

  useEffect(() => {
    void ensureCurrentUser({})
  }, [ensureCurrentUser])

  if (!viewer || !requests) {
    return (
      <p className="m-0 leading-[1.7] text-muted-foreground">
        {m.app_authenticated_loading()}
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <p className="m-0 leading-[1.7] text-muted-foreground">
        {m.app_authenticated_welcome({ name: viewer.name })}
      </p>
      <p className="text-sm text-muted-foreground">
        {m.app_viewer_subject()}{' '}
        <code className="font-mono">{viewer.subject}</code>
      </p>
      <p className="text-sm text-muted-foreground">
        {m.app_visible_requests()}{' '}
        <code className="font-mono">{requests.length}</code>
      </p>
    </div>
  )
}
