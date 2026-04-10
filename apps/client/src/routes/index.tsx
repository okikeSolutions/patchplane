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
    <main className="pb-16">
      <section className="relative overflow-clip before:pointer-events-none before:absolute before:inset-0 before:content-[''] before:[background:linear-gradient(180deg,rgb(255_255_255/0.02),transparent_30%),linear-gradient(90deg,var(--hero-grid)_1px,transparent_1px),linear-gradient(180deg,var(--hero-grid)_1px,transparent_1px)] before:bg-size-[auto,5rem_5rem,5rem_5rem] before:mask-[linear-gradient(180deg,black,rgb(0_0_0/0.15))]">
        <div className="mx-auto grid min-h-[calc(100svh-var(--header-height))] w-[min(1120px,calc(100%-2rem))] grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)] items-end gap-[clamp(2rem,6vw,5rem)] pt-[clamp(3rem,8vw,6rem)] pb-[clamp(2rem,5vw,4rem)] max-[960px]:min-h-0 max-[960px]:grid-cols-1">
          <div className="max-w-160 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-[18px] motion-safe:duration-720 motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)]">
            <Badge
              variant="outline"
              className="h-auto border-[rgb(255_208_132/0.22)] bg-[rgb(255_206_120/0.08)] px-[0.8rem] py-[0.45rem] uppercase tracking-[0.12em] text-inherit"
            >
              {m.landing_badge()}
            </Badge>
            <p className="mt-[1.35rem] text-[clamp(1.25rem,2vw,1.5rem)] font-semibold uppercase tracking-[0.16em] text-[rgb(255_203_116)]">
              PatchPlane
            </p>
            <h1 className="mt-[0.65rem] text-balance text-[clamp(3rem,7vw,6.6rem)] leading-[0.94] tracking-[-0.07em]">
              {m.landing_title()}
            </h1>
            <p className="mt-[1.2rem] max-w-152 text-[clamp(1.02rem,1.6vw,1.14rem)] leading-[1.7] text-muted-foreground">
              {m.landing_lede()}
            </p>
            <div className="mt-8 flex flex-wrap gap-[0.9rem]">
              <Link
                to="/app"
                className={cn(
                  buttonVariants({ size: 'lg' }),
                  'rounded-full border-[rgb(255_210_128/0.16)] px-[1.15rem] shadow-[0_18px_48px_rgb(237_176_69/0.16)] hover:-translate-y-px',
                )}
              >
                {m.landing_open_shell()}
                <ArrowRight />
              </Link>
              <Link
                to="/about"
                className={cn(
                  buttonVariants({ variant: 'outline', size: 'lg' }),
                  'rounded-full border-white/10 bg-white/2 px-[1.15rem] hover:-translate-y-px',
                )}
              >
                {m.landing_read_architecture()}
              </Link>
            </div>
            <dl
              className="mt-10 grid grid-cols-3 gap-4 border-t border-white/8 pt-6 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-[18px] motion-safe:duration-720 motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)] max-[960px]:grid-cols-1"
              style={{ animationDelay: '120ms' }}
            >
              <div>
                <dt className="text-[0.78rem] uppercase tracking-[0.12em] text-[rgb(255_203_116)]">
                  {m.landing_facts_shared_surface_title()}
                </dt>
                <dd className="mt-[0.55rem] text-[0.95rem] leading-[1.6] text-muted-foreground">
                  {m.landing_facts_shared_surface_detail()}
                </dd>
              </div>
              <div>
                <dt className="text-[0.78rem] uppercase tracking-[0.12em] text-[rgb(255_203_116)]">
                  {m.landing_facts_single_thread_title()}
                </dt>
                <dd className="mt-[0.55rem] text-[0.95rem] leading-[1.6] text-muted-foreground">
                  {m.landing_facts_single_thread_detail()}
                </dd>
              </div>
              <div>
                <dt className="text-[0.78rem] uppercase tracking-[0.12em] text-[rgb(255_203_116)]">
                  {m.landing_facts_operator_readable_title()}
                </dt>
                <dd className="mt-[0.55rem] text-[0.95rem] leading-[1.6] text-muted-foreground">
                  {m.landing_facts_operator_readable_detail()}
                </dd>
              </div>
            </dl>
          </div>

          <div
            className="relative flex min-h-128 items-end motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-[18px] motion-safe:duration-720 motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)] max-[960px]:min-h-0"
            style={{ animationDelay: '180ms' }}
          >
            <div className="absolute inset-x-auto inset-y-auto top-8 left-12 h-72 w-72 rounded-full bg-[radial-gradient(circle,rgb(255_196_92/0.28),transparent_65%)] blur-md" />
            <div className="relative ml-auto w-full rounded-4xl border border-white/8 bg-[linear-gradient(180deg,rgb(255_255_255/0.05),rgb(255_255_255/0.02))] p-[1.2rem] shadow-[0_24px_80px_rgb(3_8_18/0.28)]">
              <div className="flex flex-col gap-4 rounded-3xl border border-white/8 bg-(--surface-panel) p-[1.1rem] backdrop-blur-[10px]">
                <div className="flex flex-col gap-[0.55rem] border-b border-white/8 pb-4">
                  <span className="text-[0.78rem] uppercase tracking-[0.12em] text-[rgb(255_203_116)]">
                    {m.landing_signal_intro_kicker()}
                  </span>
                  <p className="m-0 leading-[1.7] text-muted-foreground">
                    {m.landing_signal_intro_body()}
                  </p>
                </div>
                <div className="grid gap-[0.8rem]">
                  {heroSignals.map((signal, index) => (
                    <article
                      key={signal.title}
                      className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-4 border-b border-white/8 py-[0.9rem] motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-[18px] motion-safe:duration-720 motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)] last:border-b-0"
                      style={{ animationDelay: `${index * 100 + 240}ms` }}
                    >
                      <span className="text-[0.82rem] font-bold tracking-[0.16em] text-[rgb(255_203_116)]">
                        0{index + 1}
                      </span>
                      <div>
                        <h2 className="m-0 text-[1.05rem] tracking-[-0.03em]">
                          {signal.title}
                        </h2>
                        <p className="m-0 leading-[1.7] text-muted-foreground">
                          {signal.detail}
                        </p>
                      </div>
                    </article>
                  ))}
                </div>
                <div className="mt-[0.4rem] inline-flex w-fit items-center gap-[0.7rem] rounded-full bg-white/4 px-[0.9rem] py-[0.7rem] text-muted-foreground">
                  <Workflow />
                  <span>{m.landing_signal_footer()}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto w-[min(1120px,calc(100%-2rem))] pt-[clamp(3.5rem,9vw,6rem)]">
        <div>
          <Badge
            variant="outline"
            className="h-auto border-[rgb(255_208_132/0.22)] bg-[rgb(255_206_120/0.08)] px-[0.8rem] py-[0.45rem] uppercase tracking-[0.12em] text-inherit"
          >
            {m.landing_workflow_badge()}
          </Badge>
          <h2 className="mt-[0.85rem] text-balance text-[clamp(1.7rem,3vw,2.5rem)] leading-[1.05] tracking-[-0.04em]">
            {m.landing_workflow_title()}
          </h2>
          <p className="mt-[1.2rem] max-w-152 text-[clamp(1.02rem,1.6vw,1.14rem)] leading-[1.7] text-muted-foreground">
            {m.landing_workflow_intro()}
          </p>
        </div>
        <div className="mt-8 grid grid-cols-3 gap-4 max-[960px]:grid-cols-1">
          {workflowMoments.map((moment, index) => (
            <article
              key={moment.label}
              className="rounded-[1.6rem] border border-white/8 border-t-[rgb(255_203_116/0.4)] bg-[linear-gradient(180deg,rgb(255_203_116/0.08),transparent_8rem),var(--surface-panel)] p-[1.35rem] backdrop-blur-md motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-[18px] motion-safe:duration-720 motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)]"
              style={{ animationDelay: `${index * 100 + 120}ms` }}
            >
              <p className="text-[0.78rem] uppercase tracking-[0.12em] text-[rgb(255_203_116)]">
                {moment.label}
              </p>
              <h3 className="mt-[0.8rem] text-[1.05rem] tracking-[-0.03em]">
                {moment.title}
              </h3>
              <p className="m-0 leading-[1.7] text-muted-foreground">
                {moment.summary}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto grid w-[min(1120px,calc(100%-2rem))] grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] items-start gap-[clamp(1.75rem,4vw,3rem)] pt-[clamp(3.5rem,9vw,6rem)] max-[960px]:grid-cols-1">
        <div>
          <Badge
            variant="outline"
            className="h-auto border-[rgb(255_208_132/0.22)] bg-[rgb(255_206_120/0.08)] px-[0.8rem] py-[0.45rem] uppercase tracking-[0.12em] text-inherit"
          >
            {m.landing_proof_badge()}
          </Badge>
          <h2 className="mt-[0.85rem] text-balance text-[clamp(1.7rem,3vw,2.5rem)] leading-[1.05] tracking-[-0.04em]">
            {m.landing_proof_title()}
          </h2>
          <p className="mt-[1.2rem] max-w-152 text-[clamp(1.02rem,1.6vw,1.14rem)] leading-[1.7] text-muted-foreground">
            {m.landing_proof_intro()}
          </p>
        </div>
        <div className="grid gap-3">
          {proofItems.map((capability, index) => (
            <article
              key={capability.title}
              className="grid grid-cols-[auto_minmax(0,1fr)] gap-4 border-b border-white/8 py-[1.15rem] motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-[18px] motion-safe:duration-720 motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)] last:border-b-0"
              style={{ animationDelay: `${index * 90 + 120}ms` }}
            >
              <div className="text-[0.82rem] font-bold tracking-[0.16em] text-[rgb(255_203_116)]">
                0{index + 1}
              </div>
              <div>
                <h3 className="m-0 text-[1.05rem] tracking-[-0.03em]">
                  {capability.title}
                </h3>
                <p className="m-0 leading-[1.7] text-muted-foreground">
                  {capability.summary}
                </p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto w-[min(1120px,calc(100%-2rem))] pt-[clamp(3.5rem,9vw,6rem)]">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-6 rounded-4xl border border-white/8 bg-(--surface-panel) p-[clamp(1.4rem,4vw,2rem)] backdrop-blur-md motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-[18px] motion-safe:duration-720 motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)] max-[960px]:grid-cols-1">
          <div>
            <Badge
              variant="outline"
              className="h-auto border-[rgb(255_208_132/0.22)] bg-[rgb(255_206_120/0.08)] px-[0.8rem] py-[0.45rem] uppercase tracking-[0.12em] text-inherit"
            >
              {m.landing_platform_badge()}
            </Badge>
            <h2 className="mt-[0.85rem] text-balance text-[clamp(1.7rem,3vw,2.5rem)] leading-[1.05] tracking-[-0.04em]">
              {m.landing_platform_title()}
            </h2>
            <p className="mt-[1.2rem] max-w-152 text-[clamp(1.02rem,1.6vw,1.14rem)] leading-[1.7] text-muted-foreground">
              {m.landing_platform_intro()}
            </p>
          </div>
          <div className="grid content-center gap-[0.85rem]">
            <div className="inline-flex items-center gap-3 rounded-full bg-white/4 px-4 py-[0.8rem] text-muted-foreground">
              <Orbit />
              <span>{m.landing_story_signal_shared_surface()}</span>
            </div>
            <div className="inline-flex items-center gap-3 rounded-full bg-white/4 px-4 py-[0.8rem] text-muted-foreground">
              <ShieldCheck />
              <span>{m.landing_story_signal_runtime_boundaries()}</span>
            </div>
          </div>
        </div>
      </section>

      <section className="pt-[clamp(3.5rem,9vw,6rem)]">
        <div className="mx-auto grid w-[min(1120px,calc(100%-2rem))] grid-cols-[minmax(0,1fr)_auto] items-end gap-6 rounded-4xl border border-white/8 bg-(--surface-panel) p-[clamp(1.5rem,4vw,2.25rem)] backdrop-blur-md motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-[18px] motion-safe:duration-720 motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)] max-[960px]:grid-cols-1">
          <div>
            <Badge
              variant="outline"
              className="h-auto border-[rgb(255_208_132/0.22)] bg-[rgb(255_206_120/0.08)] px-[0.8rem] py-[0.45rem] uppercase tracking-[0.12em] text-inherit"
            >
              {m.landing_cta_badge()}
            </Badge>
            <h2 className="mt-[0.85rem] text-balance text-[clamp(1.7rem,3vw,2.5rem)] leading-[1.05] tracking-[-0.04em]">
              {m.landing_cta_title()}
            </h2>
            <p className="mt-[1.2rem] max-w-152 text-[clamp(1.02rem,1.6vw,1.14rem)] leading-[1.7] text-muted-foreground">
              {m.landing_cta_body()}
            </p>
          </div>
          <div className="mt-8 flex flex-wrap gap-[0.9rem]">
            <Link
              to="/app"
              className={cn(
                buttonVariants({ size: 'lg' }),
                'rounded-full border-[rgb(255_210_128/0.16)] px-[1.15rem] shadow-[0_18px_48px_rgb(237_176_69/0.16)] hover:-translate-y-px',
              )}
            >
              {m.landing_cta_primary()}
            </Link>
            <Link
              to="/about"
              className={cn(
                buttonVariants({ variant: 'outline', size: 'lg' }),
                'rounded-full border-white/10 bg-white/2 px-[1.15rem] hover:-translate-y-px',
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
