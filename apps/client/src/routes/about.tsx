import { createFileRoute } from '@tanstack/react-router'
import { Badge } from '@/components/ui/badge'

const architecturePrinciples = [
  {
    title: 'Shared UI first',
    detail:
      'One TanStack Start app owns both the landing page and the browser product shell so the product language stays consistent while the loop is still forming.',
  },
  {
    title: 'Backend owns runtime boundaries',
    detail:
      '`packages/backend` keeps Convex, runtime contracts, and sandbox boundaries together until the first execution path is real enough to justify extraction.',
  },
  {
    title: 'Extract with evidence',
    detail:
      'Runtime adapters, policy packages, and desktop-specific bridges should split only after request coordination, runtime normalization, and review orchestration are exercised end to end.',
  },
] as const

const packageMap = [
  {
    name: 'apps/client',
    role: 'Landing page, browser product shell, and shared visual language.',
  },
  {
    name: 'packages/backend',
    role: 'Convex backend root plus runtime, sandbox, and policy boundaries.',
  },
  {
    name: 'packages/domain',
    role: 'Shared types, schemas, workflow statuses, and capability language.',
  },
] as const

const bootstrapSteps = [
  'bun install',
  'bun run dev:client',
  'bun run dev:backend',
] as const

export const Route = createFileRoute('/about')({
  component: AboutPage,
})

function AboutPage() {
  return (
    <main className="page-wrap info-page">
      <section className="info-hero reveal-up">
        <Badge variant="outline" className="section-badge">
          Architecture notes
        </Badge>
        <h1 className="display-title">
          Keep the workspace small until the execution loop is proven.
        </h1>
        <p className="info-hero__lede">
          PatchPlane should earn its package boundaries by proving one real
          flow: request intake, runtime activity, review output, and a visible
          decision trail.
        </p>
      </section>

      <section className="info-section">
        <div className="section-heading">
          <Badge variant="outline" className="section-badge">
            Principles
          </Badge>
          <h2>Architecture notes belong here, not on the landing page.</h2>
          <p>
            These principles explain why the current workspace stays compact and
            where future extraction pressure should come from.
          </p>
        </div>
        <div className="info-grid">
          {architecturePrinciples.map((principle, index) => (
            <article
              key={principle.title}
              className="info-item reveal-up"
              style={{ animationDelay: `${index * 100 + 100}ms` }}
            >
              <h3>{principle.title}</h3>
              <p>{principle.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="info-section info-section--split">
        <div className="section-heading">
          <Badge variant="outline" className="section-badge">
            Package map
          </Badge>
          <h2>Each package has one clear job today.</h2>
          <p>
            That keeps the codebase small enough to move quickly without hiding
            runtime decisions in too many layers.
          </p>
        </div>
        <div className="info-list">
          {packageMap.map((entry, index) => (
            <article
              key={entry.name}
              className="info-list__item reveal-up"
              style={{ animationDelay: `${index * 80 + 100}ms` }}
            >
              <p className="info-list__label">{entry.name}</p>
              <p>{entry.role}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="info-section info-section--aside">
        <div className="section-heading">
          <Badge variant="outline" className="section-badge">
            Bootstrap
          </Badge>
          <h2>
            Local commands and near-term implementation work stay operational.
          </h2>
          <p>
            This is the place for setup notes, current constraints, and the next
            slice of work that should turn the shell into a real control plane.
          </p>
        </div>
        <div className="aside-grid">
          <article className="command-block reveal-up">
            <h3>Workspace commands</h3>
            <ol>
              {bootstrapSteps.map((step) => (
                <li key={step}>
                  <code>{step}</code>
                </li>
              ))}
            </ol>
          </article>
          <article
            className="command-block reveal-up"
            style={{ animationDelay: '120ms' }}
          >
            <h3>Next build slice</h3>
            <p>
              Wire one request mutation, one fake run action, and one event feed
              from Convex before introducing more runtimes, shells, or packaging
              layers.
            </p>
          </article>
        </div>
      </section>
    </main>
  )
}
