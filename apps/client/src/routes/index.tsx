import { Link, createFileRoute } from '@tanstack/react-router'
import { ArrowRight, Orbit, ShieldCheck, Workflow } from 'lucide-react'
import * as m from '@/paraglide/messages'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/')({ component: LandingPage })

function LandingPage() {
  const heroSignals = [
    {
      title: m.landing_signal_1_title(),
      detail: m.landing_signal_1_detail(),
    },
    {
      title: m.landing_signal_2_title(),
      detail: m.landing_signal_2_detail(),
    },
    {
      title: m.landing_signal_3_title(),
      detail: m.landing_signal_3_detail(),
    },
  ] as const

  const workflowMoments = [
    {
      label: m.landing_workflow_1_label(),
      title: m.landing_workflow_1_title(),
      summary: m.landing_workflow_1_summary(),
    },
    {
      label: m.landing_workflow_2_label(),
      title: m.landing_workflow_2_title(),
      summary: m.landing_workflow_2_summary(),
    },
    {
      label: m.landing_workflow_3_label(),
      title: m.landing_workflow_3_title(),
      summary: m.landing_workflow_3_summary(),
    },
  ] as const

  const proofItems = [
    {
      title: m.landing_proof_1_title(),
      summary: m.landing_proof_1_summary(),
    },
    {
      title: m.landing_proof_2_title(),
      summary: m.landing_proof_2_summary(),
    },
    {
      title: m.landing_proof_3_title(),
      summary: m.landing_proof_3_summary(),
    },
    {
      title: m.landing_proof_4_title(),
      summary: m.landing_proof_4_summary(),
    },
  ] as const

  return (
    <main className="landing-page">
      <section className="landing-hero">
        <div className="page-wrap landing-hero__inner">
          <div className="reveal-up landing-copy">
            <Badge variant="outline" className="section-badge">
              {m.landing_badge()}
            </Badge>
            <p className="hero-brand">PatchPlane</p>
            <h1 className="display-title">{m.landing_title()}</h1>
            <p className="hero-lede">{m.landing_lede()}</p>
            <div className="hero-actions">
              <Link
                to="/app"
                className={cn(
                  buttonVariants({ size: 'lg' }),
                  'landing-button landing-button--primary',
                )}
              >
                {m.landing_open_shell()}
                <ArrowRight />
              </Link>
              <Link
                to="/about"
                className={cn(
                  buttonVariants({ variant: 'outline', size: 'lg' }),
                  'landing-button landing-button--secondary',
                )}
              >
                {m.landing_read_architecture()}
              </Link>
            </div>
            <dl
              className="hero-facts reveal-up"
              style={{ animationDelay: '120ms' }}
            >
              <div>
                <dt>{m.landing_facts_shared_surface_title()}</dt>
                <dd>{m.landing_facts_shared_surface_detail()}</dd>
              </div>
              <div>
                <dt>{m.landing_facts_single_thread_title()}</dt>
                <dd>{m.landing_facts_single_thread_detail()}</dd>
              </div>
              <div>
                <dt>{m.landing_facts_operator_readable_title()}</dt>
                <dd>{m.landing_facts_operator_readable_detail()}</dd>
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
                    {m.landing_signal_intro_kicker()}
                  </span>
                  <p>{m.landing_signal_intro_body()}</p>
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
                  <span>{m.landing_signal_footer()}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="page-wrap landing-section">
        <div className="section-heading">
          <Badge variant="outline" className="section-badge">
            {m.landing_workflow_badge()}
          </Badge>
          <h2>{m.landing_workflow_title()}</h2>
          <p>{m.landing_workflow_intro()}</p>
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
            {m.landing_proof_badge()}
          </Badge>
          <h2>{m.landing_proof_title()}</h2>
          <p>{m.landing_proof_intro()}</p>
        </div>
        <div className="proof-list">
          {proofItems.map((capability, index) => (
            <article
              key={capability.title}
              className="proof-item reveal-up"
              style={{ animationDelay: `${index * 90 + 120}ms` }}
            >
              <div className="proof-item__index">0{index + 1}</div>
              <div>
                <h3>{capability.title}</h3>
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
              {m.landing_platform_badge()}
            </Badge>
            <h2>{m.landing_platform_title()}</h2>
            <p>{m.landing_platform_intro()}</p>
          </div>
          <div className="story-panel__signals">
            <div>
              <Orbit />
              <span>{m.landing_story_signal_shared_surface()}</span>
            </div>
            <div>
              <ShieldCheck />
              <span>{m.landing_story_signal_runtime_boundaries()}</span>
            </div>
          </div>
        </div>
      </section>

      <section className="landing-cta">
        <div className="page-wrap landing-cta__inner reveal-up">
          <div>
            <Badge variant="outline" className="section-badge">
              {m.landing_cta_badge()}
            </Badge>
            <h2>{m.landing_cta_title()}</h2>
            <p>{m.landing_cta_body()}</p>
          </div>
          <div className="landing-cta__actions">
            <Link
              to="/app"
              className={cn(
                buttonVariants({ size: 'lg' }),
                'landing-button landing-button--primary',
              )}
            >
              {m.landing_cta_primary()}
            </Link>
            <Link
              to="/about"
              className={cn(
                buttonVariants({ variant: 'outline', size: 'lg' }),
                'landing-button landing-button--secondary',
              )}
            >
              {m.landing_cta_secondary()}
            </Link>
          </div>
        </div>
      </section>
    </main>
  )
}
