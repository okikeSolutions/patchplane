import { Link, createFileRoute } from '@tanstack/react-router'
import { statusLabels, type WorkflowStatus } from '@patchplane/domain'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
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

export const Route = createFileRoute('/app')({
  component: AppShellPage,
})

function AppShellPage() {
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

        <div className="product-panel reveal-up" style={{ animationDelay: '120ms' }}>
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
