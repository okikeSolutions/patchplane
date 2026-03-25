import { Link, createFileRoute } from '@tanstack/react-router'
import { useAuth } from '@workos-inc/authkit-react'
import { api } from '@patchplane/backend/convex/_generated/api'
import { statusLabels, type WorkflowStatus } from '@patchplane/domain'
import {
  Authenticated,
  AuthLoading,
  Unauthenticated,
  useQuery,
} from 'convex/react'
import { makeFunctionReference } from 'convex/server'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const timelineStatuses: WorkflowStatus[] = ['queued', 'running', 'reviewed']

const workspacePanels = [
  {
    title: 'Request coordination',
    detail:
      'Prompt intake, repo scope, and policy context should all resolve into one request record before execution begins.',
  },
  {
    title: 'Runtime feed',
    detail:
      'Normalized events should make tool calls, artifacts, and failures readable without opening runtime-specific consoles.',
  },
  {
    title: 'Review decision',
    detail:
      'Review output should sit beside the run so the operator can make merge or rollback calls from the same surface.',
  },
] as const

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

function AppShellPage() {
  const { user, signIn, signOut } = useAuth()

  return (
    <main className="page-wrap product-page">
      <section className="product-header reveal-up">
        <div>
          <Badge variant="outline" className="section-badge">
            Product shell
          </Badge>
          <h1>PatchPlane command center</h1>
          <p>
            This route is the working surface for coordinated change requests.
            Keep it operational, thin, and ready to survive both browser and
            desktop shells.
          </p>
        </div>
        <Link
          to="/about"
          className={cn(
            buttonVariants({ variant: 'outline', size: 'lg' }),
            'landing-button landing-button--secondary',
          )}
        >
          Architecture notes
        </Link>
      </section>

      <section className="product-grid">
        <div className="product-panel reveal-up">
          <div className="product-panel__header">
            <Badge variant="outline" className="section-badge">
              Authentication
            </Badge>
            <h2>WorkOS AuthKit + Convex</h2>
          </div>
          <p className="product-note">
            Convex auth state now gates the operational surface, and the browser
            can use authenticated queries once the backend validates the WorkOS
            token.
          </p>
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
              {user ? 'Sign out' : 'Sign in'}
            </Button>
            <span className="text-sm text-muted-foreground">
              {user
                ? `Signed in as ${user.firstName ?? user.email ?? 'operator'}`
                : 'Sign in to access authenticated Convex data.'}
            </span>
          </div>
        </div>

        <div
          className="product-panel reveal-up"
          style={{ animationDelay: '120ms' }}
        >
          <div className="product-panel__header">
            <Badge variant="outline" className="section-badge">
              Auth state
            </Badge>
            <h2>Protected data surface</h2>
          </div>
          <AuthLoading>
            <p className="product-note">
              Checking Convex authentication and exchanging the WorkOS token.
            </p>
          </AuthLoading>
          <Authenticated>
            <AuthenticatedContent />
          </Authenticated>
          <Unauthenticated>
            <p className="product-note">
              The command center stays readable while signed out, but protected
              data stays behind Convex auth.
            </p>
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
            <span className="status-chip__label">{statusLabels[status]}</span>
            <p>
              {status === 'queued' &&
                'Request is recorded, scoped, and waiting for execution.'}
              {status === 'running' &&
                'Tool calls and artifacts are arriving in the shared event feed.'}
              {status === 'reviewed' &&
                'Review output is attached and ready to inform the decision.'}
            </p>
          </article>
        ))}
      </section>

      <section className="product-grid">
        <div className="product-panel reveal-up">
          <div className="product-panel__header">
            <Badge variant="outline" className="section-badge">
              Workflow surface
            </Badge>
            <h2>Selected workflow statuses</h2>
          </div>
          <ol className="timeline-list">
            {timelineStatuses.map((status) => (
              <li key={status}>
                <span>{statusLabels[status]}</span>
                <p>
                  Each status belongs in the shared domain package and should
                  receive Convex-backed transitions before new product chrome is
                  added.
                </p>
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
              Implementation focus
            </Badge>
            <h2>Next build slice</h2>
          </div>
          <p className="product-note">
            Wire one request mutation, one fake run action, and one event feed
            before introducing heavier integrations. Product credibility comes
            from a readable loop, not from more shells.
          </p>
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
    return <p className="product-note">Loading authenticated data.</p>
  }

  return (
    <div className="space-y-3">
      <p className="product-note">
        Welcome {viewer.name}. Convex validated your WorkOS token before loading
        this data.
      </p>
      <p className="text-sm text-muted-foreground">
        Viewer subject: <code>{viewer.subject}</code>
      </p>
      <p className="text-sm text-muted-foreground">
        Visible prompt requests: <code>{requests.length}</code>
      </p>
    </div>
  )
}
