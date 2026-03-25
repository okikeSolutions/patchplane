import { Link, createFileRoute } from '@tanstack/react-router'
import { ArrowRight, Orbit, ShieldCheck, Workflow } from 'lucide-react'
import { coreCapabilities } from '@patchplane/domain'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const workflowMoments = [
  {
    label: 'Request intake',
    title: 'Capture the change once, with scope and policy intact.',
    summary:
      'Every run, review, and follow-up decision stays attached to the original request instead of leaking across chats, tabs, and CI logs.',
  },
  {
    label: 'Runtime feed',
    title: 'Project tool calls and runtime events into one operational thread.',
    summary:
      'Normalize agent events into a timeline operators can scan without caring which runtime or sandbox produced them.',
  },
  {
    label: 'Review gate',
    title: 'Hold review output in the same surface before merge moves forward.',
    summary:
      'Typed review signals stay visible next to the run itself, so merge and rollback decisions do not depend on memory.',
  },
] as const

const heroSignals = [
  {
    title: 'Request registered',
    detail: 'repo, prompt, policy, and ownership attached before execution',
  },
  {
    title: 'Runtime session started',
    detail: 'tool calls normalized into one event feed for every operator',
  },
  {
    title: 'Review returned',
    detail: 'pass/fail signals and decision lineage stay on the same thread',
  },
] as const

export const Route = createFileRoute('/')({ component: LandingPage })

function LandingPage() {
  return (
    <main className="landing-page">
      <section className="landing-hero">
        <div className="page-wrap landing-hero__inner">
          <div className="reveal-up landing-copy">
            <Badge variant="outline" className="section-badge">
              AI change control plane
            </Badge>
            <p className="hero-brand">PatchPlane</p>
            <h1 className="display-title">
              One control plane for every prompt request.
            </h1>
            <p className="hero-lede">
              PatchPlane gives teams one operational surface for coordinated AI
              change work, from intake through execution and review, across the
              browser today and a desktop shell later.
            </p>
            <div className="hero-actions">
              <Link
                to="/app"
                className={cn(
                  buttonVariants({ size: 'lg' }),
                  'landing-button landing-button--primary',
                )}
              >
                Open Product Shell
                <ArrowRight />
              </Link>
              <Link
                to="/about"
                className={cn(
                  buttonVariants({ variant: 'outline', size: 'lg' }),
                  'landing-button landing-button--secondary',
                )}
              >
                Read Architecture
              </Link>
            </div>
            <dl
              className="hero-facts reveal-up"
              style={{ animationDelay: '120ms' }}
            >
              <div>
                <dt>Shared surface</dt>
                <dd>Browser now, desktop wrapper later.</dd>
              </div>
              <div>
                <dt>Single thread</dt>
                <dd>Requests, runs, reviews, and decisions stay connected.</dd>
              </div>
              <div>
                <dt>Operator readable</dt>
                <dd>
                  Runtime events become one timeline instead of scattered logs.
                </dd>
              </div>
            </dl>
          </div>

          <div
            className="hero-visual reveal-up"
            style={{ animationDelay: '180ms' }}
          >
            <div className="hero-visual__halo" />
            <div className="hero-visual__frame">
              <div className="signal-stack">
                <div className="signal-stack__intro">
                  <span className="signal-stack__kicker">
                    Operational thread
                  </span>
                  <p>
                    One request record expands into runtime activity, review,
                    and merge readiness without losing lineage.
                  </p>
                </div>
                <div className="signal-list">
                  {heroSignals.map((signal, index) => (
                    <article
                      key={signal.title}
                      className="signal-row reveal-up"
                      style={{ animationDelay: `${index * 100 + 240}ms` }}
                    >
                      <span className="signal-row__index">0{index + 1}</span>
                      <div>
                        <h2>{signal.title}</h2>
                        <p>{signal.detail}</p>
                      </div>
                    </article>
                  ))}
                </div>
                <div className="signal-stack__footer">
                  <Workflow />
                  <span>
                    Requests, runs, reviews, and decisions share one view.
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="page-wrap landing-section">
        <div className="section-heading">
          <Badge variant="outline" className="section-badge">
            Workflow
          </Badge>
          <h2>One page should explain the operating model in seconds.</h2>
          <p>
            PatchPlane is strongest when the path from request to decision feels
            obvious. The landing page should show that path, not the scaffolding
            under it.
          </p>
        </div>
        <div className="workflow-grid">
          {workflowMoments.map((moment, index) => (
            <article
              key={moment.label}
              className="workflow-step reveal-up"
              style={{ animationDelay: `${index * 100 + 120}ms` }}
            >
              <p className="workflow-step__label">{moment.label}</p>
              <h3>{moment.title}</h3>
              <p>{moment.summary}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="page-wrap landing-section landing-section--split">
        <div className="section-heading">
          <Badge variant="outline" className="section-badge">
            Proof
          </Badge>
          <h2>
            Core capabilities should read like product mechanics, not filler.
          </h2>
          <p>
            These are the pieces worth proving early because they define whether
            PatchPlane becomes a usable control plane or just another thin
            shell.
          </p>
        </div>
        <div className="proof-list">
          {coreCapabilities.map((capability, index) => (
            <article
              key={capability.name}
              className="proof-item reveal-up"
              style={{ animationDelay: `${index * 90 + 120}ms` }}
            >
              <div className="proof-item__index">0{index + 1}</div>
              <div>
                <h3>{capability.name}</h3>
                <p>{capability.summary}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="page-wrap landing-section landing-section--story">
        <div className="story-panel reveal-up">
          <div className="story-panel__copy">
            <Badge variant="outline" className="section-badge">
              Platform shape
            </Badge>
            <h2>
              Build one shared control surface before the shells multiply.
            </h2>
            <p>
              The browser route at <code>/app</code> and the future desktop
              shell should share the same product language, event model, and
              review flow. The shell can change later. The operational surface
              should not.
            </p>
          </div>
          <div className="story-panel__signals">
            <div>
              <Orbit />
              <span>Shared browser and desktop surface</span>
            </div>
            <div>
              <ShieldCheck />
              <span>Explicit runtime and sandbox boundaries</span>
            </div>
          </div>
        </div>
      </section>

      <section className="landing-cta">
        <div className="page-wrap landing-cta__inner reveal-up">
          <div>
            <Badge variant="outline" className="section-badge">
              Start here
            </Badge>
            <h2>
              Open the product shell, then inspect the architecture notes.
            </h2>
            <p>
              The shell should feel operational. The notes should explain why
              the workspace stays small until the first real execution loop
              works.
            </p>
          </div>
          <div className="landing-cta__actions">
            <Link
              to="/app"
              className={cn(
                buttonVariants({ size: 'lg' }),
                'landing-button landing-button--primary',
              )}
            >
              Launch Product Shell
            </Link>
            <Link
              to="/about"
              className={cn(
                buttonVariants({ variant: 'outline', size: 'lg' }),
                'landing-button landing-button--secondary',
              )}
            >
              View Architecture Notes
            </Link>
          </div>
        </div>
      </section>
    </main>
  )
}
