import { createFileRoute } from '@tanstack/react-router'
import type * as React from 'react'
import {
  ArrowRight,
  CheckCircle2,
  CircleDotDashed,
  ClipboardCheck,
  FileDiff,
  GitPullRequest,
  LockKeyhole,
  MessageSquareText,
  ShieldCheck,
  UserCheck,
  type LucideIcon,
} from 'lucide-react'
import * as m from '@/paraglide/messages'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { BrandLogo } from '@/components/brand-logo'
import { LandingShaderBackground } from '@/components/landing-shader-background'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/')({ component: LandingPage })

const repositoryUrl = 'https://github.com/okikeSolutions/patchplane'
const readmeUrl = `${repositoryUrl}#readme`
const quickStartUrl = `${repositoryUrl}#quick-start`
const contributingUrl = `${repositoryUrl}/blob/main/CONTRIBUTING.md`
const roadmapUrl = `${repositoryUrl}/blob/main/ROADMAP.md`

const badgeClass =
  'h-auto border-[rgb(255_208_132/0.22)] bg-[rgb(255_206_120/0.08)] px-[0.8rem] py-[0.45rem] uppercase tracking-[0.12em] text-inherit'

function LandingPage() {
  const problems = [
    {
      title: m.landing_problem_1_title(),
      detail: m.landing_problem_1_detail(),
      icon: MessageSquareText,
    },
    {
      title: m.landing_problem_2_title(),
      detail: m.landing_problem_2_detail(),
      icon: CircleDotDashed,
    },
    {
      title: m.landing_problem_3_title(),
      detail: m.landing_problem_3_detail(),
      icon: ShieldCheck,
    },
  ] as const

  const steps = [
    {
      title: m.landing_step_1_title(),
      detail: m.landing_step_1_detail(),
      icon: GitPullRequest,
    },
    {
      title: m.landing_step_2_title(),
      detail: m.landing_step_2_detail(),
      icon: LockKeyhole,
    },
    {
      title: m.landing_step_3_title(),
      detail: m.landing_step_3_detail(),
      icon: ClipboardCheck,
    },
    {
      title: m.landing_step_4_title(),
      detail: m.landing_step_4_detail(),
      icon: UserCheck,
    },
    {
      title: m.landing_step_5_title(),
      detail: m.landing_step_5_detail(),
      icon: CheckCircle2,
    },
  ] as const

  const reportItems = [
    {
      title: m.landing_report_1_title(),
      detail: m.landing_report_1_detail(),
      icon: FileDiff,
    },
    {
      title: m.landing_report_2_title(),
      detail: m.landing_report_2_detail(),
      icon: ClipboardCheck,
    },
    {
      title: m.landing_report_3_title(),
      detail: m.landing_report_3_detail(),
      icon: CheckCircle2,
    },
    {
      title: m.landing_report_4_title(),
      detail: m.landing_report_4_detail(),
      icon: UserCheck,
    },
  ] as const

  return (
    <main id="main-content" tabIndex={-1} className="relative isolate">
      <LandingShaderBackground />
      <div className="relative z-1 pb-16">
        <section
          aria-labelledby="landing-title"
          className="relative overflow-clip before:pointer-events-none before:absolute before:inset-0 before:z-1 before:bg-size-[4.5rem_4.5rem] before:content-[''] before:[background:linear-gradient(90deg,var(--hero-grid)_1px,transparent_1px),linear-gradient(180deg,var(--hero-grid)_1px,transparent_1px)] before:mask-[linear-gradient(180deg,black,rgb(0_0_0/0.08))]"
        >
          <div className="relative z-2 mx-auto flex min-h-[calc(100svh-var(--header-height))] w-[min(1120px,calc(100%-2rem))] flex-col items-center justify-center py-[clamp(4rem,9vw,7rem)] text-center">
            <BrandLogo className="mb-5 h-[clamp(2rem,4vw,2.8rem)]" priority />
            <Badge variant="outline" className={badgeClass}>
              {m.landing_badge()}
            </Badge>
            <h1
              id="landing-title"
              className="mt-5 max-w-225 text-balance text-[clamp(3.1rem,8vw,7rem)] leading-[0.92] tracking-[-0.07em]"
            >
              {m.landing_title()}
            </h1>
            <p className="mt-6 max-w-175 text-[clamp(1.08rem,2vw,1.3rem)] leading-[1.7] text-muted-foreground">
              {m.landing_lede()}
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <a
                href={repositoryUrl}
                className={cn(
                  buttonVariants({ size: 'lg' }),
                  'rounded-full px-5 shadow-[0_18px_48px_rgb(237_176_69/0.16)] hover:-translate-y-px',
                )}
              >
                {m.landing_view_github()}
                <ArrowRight />
              </a>
              <a
                href={quickStartUrl}
                className={cn(
                  buttonVariants({ variant: 'outline', size: 'lg' }),
                  'rounded-full border-(--landing-border) bg-white/2 px-5 hover:-translate-y-px',
                )}
              >
                {m.landing_quick_start()}
              </a>
            </div>
          </div>
        </section>

        <SectionIntro
          badge={m.landing_problem_badge()}
          title={m.landing_problem_title()}
          detail={m.landing_problem_intro()}
          labelledBy="landing-problem-title"
        >
          <CardGrid items={problems} columns="three" />
        </SectionIntro>

        <SectionIntro
          badge={m.landing_how_badge()}
          title={m.landing_how_title()}
          detail={m.landing_how_intro()}
          labelledBy="landing-how-title"
        >
          <ol className="grid list-none grid-cols-5 gap-3 p-0 max-[1000px]:grid-cols-2 max-[560px]:grid-cols-1">
            {steps.map((step, index) => {
              const Icon = step.icon
              return (
                <li
                  key={step.title}
                  className="min-h-60 rounded-3xl border border-(--landing-border) bg-(--surface-panel) p-5"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-sm text-muted-foreground">
                      0{index + 1}
                    </span>
                    <Icon className="size-5 text-(--brand-readable)" />
                  </div>
                  <h3 className="mt-10 text-xl tracking-[-0.04em]">
                    {step.title}
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">
                    {step.detail}
                  </p>
                </li>
              )
            })}
          </ol>
        </SectionIntro>

        <SectionIntro
          badge={m.landing_report_badge()}
          title={m.landing_report_title()}
          detail={m.landing_report_intro()}
          labelledBy="landing-report-title"
        >
          <div className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-4 rounded-4xl border border-(--landing-border) bg-(--surface-panel) p-[clamp(1rem,3vw,1.75rem)] max-[800px]:grid-cols-1">
            <div className="rounded-3xl border border-(--landing-border) bg-black/15 p-5">
              <p className="m-0 text-xs uppercase tracking-[0.14em] text-(--brand-readable)">
                {m.landing_report_preview_label()}
              </p>
              <h3 className="mt-3 text-2xl tracking-[-0.045em]">
                {m.landing_report_preview_title()}
              </h3>
              <div className="mt-8 grid gap-3 text-sm">
                <StatusRow
                  label={m.landing_report_status_patch()}
                  status={m.landing_report_status_captured()}
                />
                <StatusRow
                  label={m.landing_report_status_run()}
                  status={m.landing_report_status_complete()}
                />
                <StatusRow
                  label={m.landing_report_status_evidence()}
                  status={m.landing_report_status_collected()}
                />
                <StatusRow
                  label={m.landing_report_status_decision()}
                  status={m.landing_report_status_required()}
                  highlight
                />
              </div>
            </div>
            <CardGrid items={reportItems} columns="two" />
          </div>
        </SectionIntro>

        <section
          aria-labelledby="landing-alpha-title"
          className="mx-auto grid w-[min(1120px,calc(100%-2rem))] grid-cols-[minmax(0,1fr)_minmax(280px,0.7fr)] gap-6 py-[clamp(3rem,7vw,5rem)] max-[800px]:grid-cols-1"
        >
          <div className="rounded-4xl border border-(--landing-border) bg-[linear-gradient(135deg,rgb(255_203_116/0.12),transparent_45%),var(--surface-panel)] p-[clamp(1.5rem,4vw,2.5rem)]">
            <Badge variant="outline" className={badgeClass}>
              {m.landing_alpha_badge()}
            </Badge>
            <h2
              id="landing-alpha-title"
              className="mt-4 text-balance text-[clamp(2rem,4vw,3.4rem)] leading-none tracking-[-0.055em]"
            >
              {m.landing_alpha_title()}
            </h2>
            <p className="mt-5 max-w-160 text-lg leading-8 text-muted-foreground">
              {m.landing_alpha_body()}
            </p>
          </div>
          <nav
            aria-label={m.landing_resources_label()}
            className="grid content-center gap-3 rounded-4xl border border-(--landing-border) bg-(--surface-panel) p-5"
          >
            <ResourceLink href={readmeUrl} label={m.landing_capabilities()} />
            <ResourceLink
              href={quickStartUrl}
              label={m.landing_quick_start()}
            />
            <ResourceLink
              href={contributingUrl}
              label={m.landing_contributing()}
            />
            <ResourceLink href={roadmapUrl} label={m.landing_roadmap()} />
          </nav>
        </section>
      </div>
    </main>
  )
}

function SectionIntro({
  badge,
  title,
  detail,
  labelledBy,
  children,
}: {
  badge: string
  title: string
  detail: string
  labelledBy: string
  children: React.ReactNode
}) {
  return (
    <section
      aria-labelledby={labelledBy}
      className="mx-auto w-[min(1120px,calc(100%-2rem))] py-[clamp(3rem,7vw,5rem)]"
    >
      <div className="mb-8 max-w-190">
        <Badge variant="outline" className={badgeClass}>
          {badge}
        </Badge>
        <h2
          id={labelledBy}
          className="mt-4 text-balance text-[clamp(2rem,4vw,3.4rem)] leading-none tracking-[-0.055em]"
        >
          {title}
        </h2>
        <p className="mt-5 max-w-165 text-[clamp(1rem,1.6vw,1.15rem)] leading-8 text-muted-foreground">
          {detail}
        </p>
      </div>
      {children}
    </section>
  )
}

function CardGrid({
  items,
  columns,
}: {
  items: ReadonlyArray<{
    title: string
    detail: string
    icon: LucideIcon
  }>
  columns: 'two' | 'three'
}) {
  return (
    <div
      className={cn(
        'grid gap-3',
        columns === 'three'
          ? 'grid-cols-3 max-[800px]:grid-cols-1'
          : 'grid-cols-2 max-[560px]:grid-cols-1',
      )}
    >
      {items.map((item) => {
        const Icon = item.icon
        return (
          <div
            key={item.title}
            className="rounded-3xl border border-(--landing-border) bg-(--surface-panel) p-5"
          >
            <Icon className="size-5 text-(--brand-readable)" />
            <h3 className="mt-5 text-xl tracking-[-0.04em]">{item.title}</h3>
            <p className="mt-3 leading-7 text-muted-foreground">
              {item.detail}
            </p>
          </div>
        )
      })}
    </div>
  )
}

function StatusRow({
  label,
  status,
  highlight = false,
}: {
  label: string
  status: string
  highlight?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border border-(--landing-border) bg-(--surface-panel-strong) p-3">
      <span>{label}</span>
      <span
        className={cn(
          'text-muted-foreground',
          highlight && 'text-(--brand-readable)',
        )}
      >
        {status}
      </span>
    </div>
  )
}

function ResourceLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      className="flex items-center justify-between rounded-2xl border border-(--landing-border) bg-white/2 px-4 py-3 transition-colors hover:bg-white/6"
    >
      <span>{label}</span>
      <ArrowRight className="size-4" />
    </a>
  )
}
