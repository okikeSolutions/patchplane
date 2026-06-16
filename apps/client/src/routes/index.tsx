import { Link, createFileRoute } from '@tanstack/react-router'
import {
  ArrowRight,
  CheckCircle2,
  GitPullRequest,
  ShieldCheck,
  Terminal,
  Workflow,
} from 'lucide-react'
import * as m from '@/paraglide/messages'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/')({ component: LandingPage })

const badgeClass =
  'h-auto border-[rgb(255_208_132/0.22)] bg-[rgb(255_206_120/0.08)] px-[0.8rem] py-[0.45rem] uppercase tracking-[0.12em] text-inherit'

function LandingPage() {
  const proofStrip = [
    m.landing_facts_shared_surface_title(),
    m.landing_facts_single_thread_title(),
    m.landing_facts_operator_readable_title(),
  ] as const

  const problemCards = [
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

  const workflowSteps = [
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

  const benefits = [
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
      <section className="relative overflow-clip before:pointer-events-none before:absolute before:inset-0 before:content-[''] before:[background:radial-gradient(circle_at_82%_18%,rgb(255_196_92/0.18),transparent_28rem),linear-gradient(180deg,rgb(255_255_255/0.03),transparent_34%),linear-gradient(90deg,var(--hero-grid)_1px,transparent_1px),linear-gradient(180deg,var(--hero-grid)_1px,transparent_1px)] before:bg-size-[auto,auto,5rem_5rem,5rem_5rem] before:mask-[linear-gradient(180deg,black,rgb(0_0_0/0.16))]">
        <div className="mx-auto grid min-h-[calc(100svh-var(--header-height))] w-[min(1120px,calc(100%-2rem))] grid-cols-[minmax(0,1fr)_minmax(340px,0.94fr)] items-center gap-[clamp(2rem,6vw,5rem)] pt-[clamp(3rem,8vw,6rem)] pb-[clamp(2rem,5vw,4rem)] max-[960px]:min-h-0 max-[960px]:grid-cols-1">
          <div className="max-w-164 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-[18px] motion-safe:duration-720 motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)]">
            <Badge variant="outline" className={badgeClass}>
              {m.landing_badge()}
            </Badge>
            <h1 className="mt-[1.1rem] text-balance text-[clamp(3.2rem,7.5vw,7rem)] leading-[0.92] tracking-[-0.075em]">
              {m.landing_title()}
            </h1>
            <p className="mt-[1.35rem] max-w-150 text-[clamp(1.05rem,1.7vw,1.2rem)] leading-[1.7] text-muted-foreground">
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
            <div className="mt-8 flex flex-wrap gap-2 border-t border-white/8 pt-6">
              {proofStrip.map((proof) => (
                <span
                  key={proof}
                  className="inline-flex items-center gap-2 rounded-full border border-white/8 bg-white/4 px-3 py-2 text-[0.88rem] text-muted-foreground"
                >
                  <CheckCircle2 className="size-4 text-(--brand-readable)" />
                  {proof}
                </span>
              ))}
            </div>
          </div>

          <div
            className="relative motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-[18px] motion-safe:duration-720 motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)]"
            style={{ animationDelay: '160ms' }}
          >
            <div className="absolute -top-10 left-10 h-72 w-72 rounded-full bg-[radial-gradient(circle,rgb(255_196_92/0.26),transparent_65%)] blur-md" />
            <div className="relative rounded-4xl border border-white/8 bg-[linear-gradient(180deg,rgb(255_255_255/0.06),rgb(255_255_255/0.025))] p-[1rem] shadow-[0_24px_80px_rgb(3_8_18/0.3)]">
              <div className="rounded-3xl border border-white/8 bg-(--surface-panel) p-[1.05rem] backdrop-blur-[12px]">
                <div className="flex items-start justify-between gap-4 border-b border-white/8 pb-4">
                  <div>
                    <p className="m-0 text-[0.78rem] uppercase tracking-[0.14em] text-(--brand-readable)">
                      AI patch review
                    </p>
                    <h2 className="mt-2 text-[1.25rem] tracking-[-0.04em]">
                      Billing webhook retry logic
                    </h2>
                  </div>
                  <span className="rounded-full border border-[rgb(255_203_116/0.24)] bg-[rgb(255_203_116/0.1)] px-3 py-1 text-[0.78rem] text-(--brand-readable)">
                    Awaiting approval
                  </span>
                </div>

                <div className="mt-4 grid gap-3">
                  {[
                    [
                      'Request',
                      'Scoped change captured from the original prompt',
                    ],
                    ['Sandbox', 'Isolated run completed before trusted CI'],
                    [
                      'Evidence',
                      '42 tests passed · 3 files changed · 1 risk noted',
                    ],
                    [
                      'Decision',
                      'Ready for reviewer approval or requested changes',
                    ],
                  ].map(([label, detail], index) => (
                    <div
                      key={label}
                      className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-2xl border border-white/8 bg-white/3 p-3"
                    >
                      <span className="flex size-8 items-center justify-center rounded-full bg-[rgb(255_203_116/0.11)] text-[0.78rem] font-bold text-(--brand-readable)">
                        {index + 1}
                      </span>
                      <div>
                        <p className="m-0 text-[0.95rem] font-medium">
                          {label}
                        </p>
                        <p className="m-0 text-[0.9rem] leading-[1.55] text-muted-foreground">
                          {detail}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-4 grid grid-cols-3 gap-2 max-[520px]:grid-cols-1">
                  <div className="rounded-2xl bg-white/4 p-3">
                    <p className="m-0 text-[0.75rem] uppercase tracking-[0.12em] text-muted-foreground">
                      Tests
                    </p>
                    <p className="m-0 mt-1 text-[1.1rem] text-(--success-readable)">
                      Passing
                    </p>
                  </div>
                  <div className="rounded-2xl bg-white/4 p-3">
                    <p className="m-0 text-[0.75rem] uppercase tracking-[0.12em] text-muted-foreground">
                      Risk
                    </p>
                    <p className="m-0 mt-1 text-[1.1rem] text-(--brand-readable)">
                      Medium
                    </p>
                  </div>
                  <div className="rounded-2xl bg-white/4 p-3">
                    <p className="m-0 text-[0.75rem] uppercase tracking-[0.12em] text-muted-foreground">
                      Secrets
                    </p>
                    <p className="m-0 mt-1 text-[1.1rem] text-(--success-readable)">
                      None
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto w-[min(1120px,calc(100%-2rem))] pt-[clamp(3.5rem,9vw,6rem)]">
        <div className="max-w-172">
          <Badge variant="outline" className={badgeClass}>
            {m.landing_workflow_badge()}
          </Badge>
          <h2 className="mt-[0.85rem] text-balance text-[clamp(1.9rem,3.6vw,3rem)] leading-[1.02] tracking-[-0.05em]">
            {m.landing_workflow_title()}
          </h2>
          <p className="mt-[1.1rem] max-w-150 text-[clamp(1.02rem,1.6vw,1.14rem)] leading-[1.7] text-muted-foreground">
            {m.landing_workflow_intro()}
          </p>
        </div>
        <div className="mt-8 grid grid-cols-3 gap-4 max-[960px]:grid-cols-1">
          {problemCards.map((card, index) => (
            <article
              key={card.title}
              className="rounded-[1.6rem] border border-white/8 bg-(--surface-panel) p-[1.35rem] backdrop-blur-md motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-[18px] motion-safe:duration-720 motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)]"
              style={{ animationDelay: `${index * 90 + 120}ms` }}
            >
              <p className="text-[0.78rem] uppercase tracking-[0.12em] text-(--brand-readable)">
                {card.label}
              </p>
              <h3 className="mt-[0.8rem] text-[1.08rem] tracking-[-0.03em]">
                {card.title}
              </h3>
              <p className="m-0 leading-[1.7] text-muted-foreground">
                {card.summary}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto w-[min(1120px,calc(100%-2rem))] pt-[clamp(3.5rem,9vw,6rem)]">
        <div className="rounded-4xl border border-white/8 bg-[linear-gradient(180deg,rgb(255_203_116/0.07),transparent_12rem),var(--surface-panel)] p-[clamp(1.3rem,4vw,2rem)] backdrop-blur-md">
          <div className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-[clamp(1.5rem,4vw,3rem)] max-[960px]:grid-cols-1">
            <div>
              <Badge variant="outline" className={badgeClass}>
                {m.landing_signal_intro_kicker()}
              </Badge>
              <h2 className="mt-[0.85rem] text-balance text-[clamp(1.9rem,3.6vw,3rem)] leading-[1.02] tracking-[-0.05em]">
                {m.landing_signal_intro_body()}
              </h2>
            </div>
            <div className="grid gap-3">
              {workflowSteps.map((step, index) => (
                <article
                  key={step.title}
                  className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-4 rounded-3xl border border-white/8 bg-white/3 p-4"
                >
                  <div className="flex size-11 items-center justify-center rounded-2xl bg-[rgb(255_203_116/0.1)] text-[0.82rem] font-bold tracking-[0.16em] text-(--brand-readable)">
                    0{index + 1}
                  </div>
                  <div>
                    <h3 className="m-0 text-[1.08rem] tracking-[-0.03em]">
                      {step.title}
                    </h3>
                    <p className="m-0 leading-[1.7] text-muted-foreground">
                      {step.detail}
                    </p>
                  </div>
                </article>
              ))}
              <div className="inline-flex w-fit items-center gap-[0.7rem] rounded-full bg-white/5 px-[0.9rem] py-[0.7rem] text-muted-foreground">
                <Workflow />
                <span>{m.landing_signal_footer()}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto grid w-[min(1120px,calc(100%-2rem))] grid-cols-[minmax(0,0.78fr)_minmax(0,1.22fr)] items-start gap-[clamp(1.75rem,4vw,3rem)] pt-[clamp(3.5rem,9vw,6rem)] max-[960px]:grid-cols-1">
        <div>
          <Badge variant="outline" className={badgeClass}>
            {m.landing_proof_badge()}
          </Badge>
          <h2 className="mt-[0.85rem] text-balance text-[clamp(1.9rem,3.6vw,3rem)] leading-[1.02] tracking-[-0.05em]">
            {m.landing_proof_title()}
          </h2>
          <p className="mt-[1.1rem] max-w-150 text-[clamp(1.02rem,1.6vw,1.14rem)] leading-[1.7] text-muted-foreground">
            {m.landing_proof_intro()}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 max-[720px]:grid-cols-1">
          {benefits.map((benefit, index) => (
            <article
              key={benefit.title}
              className="rounded-[1.4rem] border border-white/8 bg-(--surface-panel) p-[1.2rem] motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-[18px] motion-safe:duration-720 motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)]"
              style={{ animationDelay: `${index * 80 + 120}ms` }}
            >
              <ShieldCheck className="size-5 text-(--brand-readable)" />
              <h3 className="mt-4 text-[1.05rem] tracking-[-0.03em]">
                {benefit.title}
              </h3>
              <p className="m-0 leading-[1.7] text-muted-foreground">
                {benefit.summary}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto w-[min(1120px,calc(100%-2rem))] pt-[clamp(3.5rem,9vw,6rem)]">
        <div className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-[clamp(1.5rem,4vw,3rem)] rounded-4xl border border-white/8 bg-(--surface-panel) p-[clamp(1.4rem,4vw,2rem)] backdrop-blur-md max-[960px]:grid-cols-1">
          <div>
            <Badge variant="outline" className={badgeClass}>
              {m.landing_platform_badge()}
            </Badge>
            <h2 className="mt-[0.85rem] text-balance text-[clamp(1.9rem,3.6vw,3rem)] leading-[1.02] tracking-[-0.05em]">
              {m.landing_platform_title()}
            </h2>
            <p className="mt-[1.1rem] max-w-150 text-[clamp(1.02rem,1.6vw,1.14rem)] leading-[1.7] text-muted-foreground">
              {m.landing_platform_intro()}
            </p>
            <div className="mt-6 grid gap-[0.85rem]">
              <div className="inline-flex items-center gap-3 rounded-full bg-white/4 px-4 py-[0.8rem] text-muted-foreground">
                <GitPullRequest />
                <span>{m.landing_story_signal_shared_surface()}</span>
              </div>
              <div className="inline-flex items-center gap-3 rounded-full bg-white/4 px-4 py-[0.8rem] text-muted-foreground">
                <Terminal />
                <span>{m.landing_story_signal_runtime_boundaries()}</span>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-white/8 bg-black/18 p-4 font-mono text-[0.86rem] leading-[1.7] text-muted-foreground">
            <div className="mb-4 flex items-center gap-2 border-b border-white/8 pb-3">
              <span className="size-3 rounded-full bg-[#ff5f57]" />
              <span className="size-3 rounded-full bg-[#ffbd2e]" />
              <span className="size-3 rounded-full bg-[#28c840]" />
              <span className="ml-2 text-foreground/70">
                patchplane/run-1842
              </span>
            </div>
            <p className="m-0 text-foreground">
              $ patchplane review billing-webhook
            </p>
            <p className="m-0">✓ request linked to owner and repo</p>
            <p className="m-0">✓ sandbox run completed without secrets</p>
            <p className="m-0">✓ test evidence attached to patch</p>
            <p className="m-0 text-(--brand-readable)">
              ! reviewer approval required before merge
            </p>
            <p className="m-0 mt-4 text-foreground/80">
              decision: awaiting human approval
            </p>
          </div>
        </div>
      </section>

      <section className="pt-[clamp(3.5rem,9vw,6rem)]">
        <div className="mx-auto grid w-[min(1120px,calc(100%-2rem))] grid-cols-[minmax(0,1fr)_auto] items-end gap-6 rounded-4xl border border-white/8 bg-[linear-gradient(135deg,rgb(255_203_116/0.12),transparent_42%),var(--surface-panel)] p-[clamp(1.5rem,4vw,2.25rem)] backdrop-blur-md motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-[18px] motion-safe:duration-720 motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)] max-[960px]:grid-cols-1">
          <div>
            <Badge variant="outline" className={badgeClass}>
              {m.landing_cta_badge()}
            </Badge>
            <h2 className="mt-[0.85rem] text-balance text-[clamp(1.9rem,3.6vw,3rem)] leading-[1.02] tracking-[-0.05em]">
              {m.landing_cta_title()}
            </h2>
            <p className="mt-[1.1rem] max-w-152 text-[clamp(1.02rem,1.6vw,1.14rem)] leading-[1.7] text-muted-foreground">
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
            <a
              href="https://github.com/okikeSolutions/patchplane"
              target="_blank"
              rel="noreferrer"
              className={cn(
                buttonVariants({ variant: 'outline', size: 'lg' }),
                'rounded-full border-white/10 bg-white/2 px-[1.15rem] hover:-translate-y-px',
              )}
            >
              {m.landing_cta_secondary()}
            </a>
          </div>
        </div>
      </section>
    </main>
  )
}
