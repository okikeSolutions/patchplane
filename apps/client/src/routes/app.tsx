import { Link, createFileRoute } from '@tanstack/react-router'
import { useAuth } from '@workos-inc/authkit-react'
import { api } from '@patchplane/backend/convex/_generated/api'
import { type WorkflowStatus } from '@patchplane/domain'
import {
  Authenticated,
  AuthLoading,
  Unauthenticated,
  useQuery,
} from 'convex/react'
import { makeFunctionReference } from 'convex/server'
import * as m from '@/paraglide/messages'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

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

const viewerQuery = makeFunctionReference<
  'query',
  Record<string, never>,
  ViewerIdentity
>('viewer:current')

export const Route = createFileRoute('/app')({
  component: AppShellPage,
})

function getStatusLabel(status: TimelineStatus) {
  switch (status) {
    case 'queued':
      return m.app_status_queued_label()
    case 'running':
      return m.app_status_running_label()
    case 'reviewed':
      return m.app_status_reviewed_label()
  }
}

function getStatusDetail(status: TimelineStatus) {
  switch (status) {
    case 'queued':
      return m.app_status_queued_detail()
    case 'running':
      return m.app_status_running_detail()
    case 'reviewed':
      return m.app_status_reviewed_detail()
  }
}

function AppShellPage() {
  const { user, signIn, signOut } = useAuth()
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
    <main className="page-wrap product-page">
      <section className="product-header reveal-up">
        <div>
          <Badge variant="outline" className="section-badge">
            {m.app_hero_badge()}
          </Badge>
          <h1>{m.app_hero_title()}</h1>
          <p>{m.app_hero_intro()}</p>
        </div>
        <Link
          to="/about"
          className={cn(
            buttonVariants({ variant: 'outline', size: 'lg' }),
            'landing-button landing-button--secondary',
          )}
        >
          {m.app_hero_architecture_link()}
        </Link>
      </section>

      <section className="product-grid">
        <div className="product-panel reveal-up">
          <div className="product-panel__header">
            <Badge variant="outline" className="section-badge">
              {m.app_auth_badge()}
            </Badge>
            <h2>{m.app_auth_title()}</h2>
          </div>
          <p className="product-note">{m.app_auth_intro()}</p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button
              type="button"
              onClick={() => {
                if (user) {
                  void signOut()
                  return
                }

                void signIn()
              }}
            >
              {user ? m.app_sign_out() : m.app_sign_in()}
            </Button>
            <span className="text-sm text-muted-foreground">
              {user
                ? m.app_signed_in_as({
                    name:
                      user.firstName ?? user.email ?? m.app_operator_fallback(),
                  })
                : m.app_sign_in_prompt()}
            </span>
          </div>
        </div>

        <div
          className="product-panel reveal-up"
          style={{ animationDelay: '120ms' }}
        >
          <div className="product-panel__header">
            <Badge variant="outline" className="section-badge">
              {m.app_auth_state_badge()}
            </Badge>
            <h2>{m.app_auth_state_title()}</h2>
          </div>
          <AuthLoading>
            <p className="product-note">{m.app_auth_loading()}</p>
          </AuthLoading>
          <Authenticated>
            <AuthenticatedContent />
          </Authenticated>
          <Unauthenticated>
            <p className="product-note">{m.app_unauthenticated()}</p>
          </Unauthenticated>
        </div>
      </section>

      <section className="status-strip">
        {timelineStatuses.map((status, index) => (
          <article
            key={status}
            className="status-chip reveal-up"
            style={{ animationDelay: `${index * 80 + 100}ms` }}
          >
            <span className="status-chip__label">{getStatusLabel(status)}</span>
            <p>{getStatusDetail(status)}</p>
          </article>
        ))}
      </section>

      <section className="product-grid">
        <div className="product-panel reveal-up">
          <div className="product-panel__header">
            <Badge variant="outline" className="section-badge">
              {m.app_workflow_badge()}
            </Badge>
            <h2>{m.app_workflow_title()}</h2>
          </div>
          <ol className="timeline-list">
            {timelineStatuses.map((status) => (
              <li key={status}>
                <span>{getStatusLabel(status)}</span>
                <p>{m.app_workflow_status_detail()}</p>
              </li>
            ))}
          </ol>
        </div>

        <div
          className="product-panel reveal-up"
          style={{ animationDelay: '120ms' }}
        >
          <div className="product-panel__header">
            <Badge variant="outline" className="section-badge">
              {m.app_focus_badge()}
            </Badge>
            <h2>{m.app_focus_title()}</h2>
          </div>
          <p className="product-note">{m.app_focus_intro()}</p>
        </div>
      </section>

      <section className="product-notes">
        {workspacePanels.map((panel, index) => (
          <article
            key={panel.title}
            className="product-note-card reveal-up"
            style={{ animationDelay: `${index * 90 + 160}ms` }}
          >
            <h3>{panel.title}</h3>
            <p>{panel.detail}</p>
          </article>
        ))}
      </section>
    </main>
  )
}

function AuthenticatedContent() {
  const viewer = useQuery(viewerQuery, {})
  const requests = useQuery(api.requests.list)

  if (!viewer || !requests) {
    return <p className="product-note">{m.app_authenticated_loading()}</p>
  }

  return (
    <div className="space-y-3">
      <p className="product-note">
        {m.app_authenticated_welcome({ name: viewer.name })}
      </p>
      <p className="text-sm text-muted-foreground">
        {m.app_viewer_subject()} <code>{viewer.subject}</code>
      </p>
      <p className="text-sm text-muted-foreground">
        {m.app_visible_requests()} <code>{requests.length}</code>
      </p>
    </div>
  )
}
