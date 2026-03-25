import { createFileRoute } from '@tanstack/react-router'
import * as m from '@/paraglide/messages'
import { Badge } from '@/components/ui/badge'

const bootstrapSteps = [
  'bun install',
  'bun run dev:client',
  'bun run dev:backend',
] as const

export const Route = createFileRoute('/about')({
  component: AboutPage,
})

function AboutPage() {
  const architecturePrinciples = [
    {
      title: m.about_principle_1_title(),
      detail: m.about_principle_1_detail(),
    },
    {
      title: m.about_principle_2_title(),
      detail: m.about_principle_2_detail(),
    },
    {
      title: m.about_principle_3_title(),
      detail: m.about_principle_3_detail(),
    },
  ] as const

  const packageMap = [
    {
      name: m.about_package_1_name(),
      role: m.about_package_1_role(),
    },
    {
      name: m.about_package_2_name(),
      role: m.about_package_2_role(),
    },
    {
      name: m.about_package_3_name(),
      role: m.about_package_3_role(),
    },
  ] as const

  return (
    <main className="page-wrap info-page">
      <section className="info-hero reveal-up">
        <Badge variant="outline" className="section-badge">
          {m.about_hero_badge()}
        </Badge>
        <h1 className="display-title">{m.about_hero_title()}</h1>
        <p className="info-hero__lede">{m.about_hero_lede()}</p>
      </section>

      <section className="info-section">
        <div className="section-heading">
          <Badge variant="outline" className="section-badge">
            {m.about_principles_badge()}
          </Badge>
          <h2>{m.about_principles_title()}</h2>
          <p>{m.about_principles_intro()}</p>
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
            {m.about_package_map_badge()}
          </Badge>
          <h2>{m.about_package_map_title()}</h2>
          <p>{m.about_package_map_intro()}</p>
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
            {m.about_bootstrap_badge()}
          </Badge>
          <h2>{m.about_bootstrap_title()}</h2>
          <p>{m.about_bootstrap_intro()}</p>
        </div>
        <div className="aside-grid">
          <article className="command-block reveal-up">
            <h3>{m.about_bootstrap_commands_title()}</h3>
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
            <h3>{m.about_next_slice_title()}</h3>
            <p>{m.about_next_slice_body()}</p>
          </article>
        </div>
      </section>
    </main>
  )
}
