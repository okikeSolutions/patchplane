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
    <main className="mx-auto w-[min(1120px,calc(100%-2rem))] pt-[clamp(2rem,5vw,3rem)] pb-16">
      <section className="grid gap-4 pt-4 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-[18px] motion-safe:duration-720 motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)]">
        <Badge
          variant="outline"
          className="h-auto border-[rgb(255_208_132/0.22)] bg-[rgb(255_206_120/0.08)] px-[0.8rem] py-[0.45rem] uppercase tracking-[0.12em] text-inherit"
        >
          {m.about_hero_badge()}
        </Badge>
        <h1 className="mt-[0.65rem] text-balance text-[clamp(2.6rem,6vw,5rem)] leading-[0.97] tracking-[-0.06em]">
          {m.about_hero_title()}
        </h1>
        <p className="mt-[1.2rem] max-w-152 text-[clamp(1.02rem,1.6vw,1.14rem)] leading-[1.7] text-muted-foreground">
          {m.about_hero_lede()}
        </p>
      </section>

      <section className="pt-[clamp(3.5rem,9vw,6rem)]">
        <div>
          <Badge
            variant="outline"
            className="h-auto border-[rgb(255_208_132/0.22)] bg-[rgb(255_206_120/0.08)] px-[0.8rem] py-[0.45rem] uppercase tracking-[0.12em] text-inherit"
          >
            {m.about_principles_badge()}
          </Badge>
          <h2 className="mt-[0.85rem] text-balance text-[clamp(1.7rem,3vw,2.5rem)] leading-[1.05] tracking-[-0.04em]">
            {m.about_principles_title()}
          </h2>
          <p className="mt-[1.2rem] max-w-152 text-[clamp(1.02rem,1.6vw,1.14rem)] leading-[1.7] text-muted-foreground">
            {m.about_principles_intro()}
          </p>
        </div>
        <div className="mt-8 grid grid-cols-3 gap-4 max-[960px]:grid-cols-1">
          {architecturePrinciples.map((principle, index) => (
            <article
              key={principle.title}
              className="rounded-[1.6rem] border border-white/8 bg-(--surface-panel) p-[1.35rem] backdrop-blur-md motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-[18px] motion-safe:duration-720 motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)]"
              style={{ animationDelay: `${index * 100 + 100}ms` }}
            >
              <h3 className="m-0 text-[1.05rem] tracking-[-0.03em]">
                {principle.title}
              </h3>
              <p className="m-0 leading-[1.7] text-muted-foreground">
                {principle.detail}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="grid grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] items-start gap-[clamp(1.75rem,4vw,3rem)] pt-[clamp(3.5rem,9vw,6rem)] max-[960px]:grid-cols-1">
        <div>
          <Badge
            variant="outline"
            className="h-auto border-[rgb(255_208_132/0.22)] bg-[rgb(255_206_120/0.08)] px-[0.8rem] py-[0.45rem] uppercase tracking-[0.12em] text-inherit"
          >
            {m.about_package_map_badge()}
          </Badge>
          <h2 className="mt-[0.85rem] text-balance text-[clamp(1.7rem,3vw,2.5rem)] leading-[1.05] tracking-[-0.04em]">
            {m.about_package_map_title()}
          </h2>
          <p className="mt-[1.2rem] max-w-152 text-[clamp(1.02rem,1.6vw,1.14rem)] leading-[1.7] text-muted-foreground">
            {m.about_package_map_intro()}
          </p>
        </div>
        <div className="grid gap-[0.85rem]">
          {packageMap.map((entry, index) => (
            <article
              key={entry.name}
              className="rounded-[1.6rem] border border-white/8 bg-(--surface-panel) p-[1.35rem] backdrop-blur-md motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-[18px] motion-safe:duration-720 motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)]"
              style={{ animationDelay: `${index * 80 + 100}ms` }}
            >
              <p className="text-[0.78rem] uppercase tracking-[0.12em] text-[rgb(255_203_116)]">
                {entry.name}
              </p>
              <p className="m-0 leading-[1.7] text-muted-foreground">
                {entry.role}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="pt-[clamp(3.5rem,9vw,6rem)]">
        <div>
          <Badge
            variant="outline"
            className="h-auto border-[rgb(255_208_132/0.22)] bg-[rgb(255_206_120/0.08)] px-[0.8rem] py-[0.45rem] uppercase tracking-[0.12em] text-inherit"
          >
            {m.about_bootstrap_badge()}
          </Badge>
          <h2 className="mt-[0.85rem] text-balance text-[clamp(1.7rem,3vw,2.5rem)] leading-[1.05] tracking-[-0.04em]">
            {m.about_bootstrap_title()}
          </h2>
          <p className="mt-[1.2rem] max-w-152 text-[clamp(1.02rem,1.6vw,1.14rem)] leading-[1.7] text-muted-foreground">
            {m.about_bootstrap_intro()}
          </p>
        </div>
        <div className="mt-8 grid grid-cols-3 gap-4 max-[960px]:grid-cols-1">
          <article className="rounded-[1.6rem] border border-white/8 bg-(--surface-panel) p-[1.35rem] backdrop-blur-md motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-[18px] motion-safe:duration-720 motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)]">
            <h3 className="m-0 text-[1.05rem] tracking-[-0.03em]">
              {m.about_bootstrap_commands_title()}
            </h3>
            <ol className="mt-4 pl-[1.2rem]">
              {bootstrapSteps.map((step) => (
                <li key={step} className="mt-[0.65rem]">
                  <code className="font-mono text-[0.95rem]">{step}</code>
                </li>
              ))}
            </ol>
          </article>
          <article
            className="rounded-[1.6rem] border border-white/8 bg-(--surface-panel) p-[1.35rem] backdrop-blur-md motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-[18px] motion-safe:duration-720 motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)]"
            style={{ animationDelay: '120ms' }}
          >
            <h3 className="m-0 text-[1.05rem] tracking-[-0.03em]">
              {m.about_next_slice_title()}
            </h3>
            <p className="m-0 leading-[1.7] text-muted-foreground">
              {m.about_next_slice_body()}
            </p>
          </article>
        </div>
      </section>
    </main>
  )
}
