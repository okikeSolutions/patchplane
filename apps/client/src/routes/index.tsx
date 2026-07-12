import { Link, createFileRoute } from '@tanstack/react-router'
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  CircleDotDashed,
  ClipboardCheck,
  FileDiff,
  GitPullRequest,
  LockKeyhole,
  MessageSquareText,
  Play,
  ShieldCheck,
  Terminal,
  UserCheck,
  Workflow,
  type LucideIcon,
} from 'lucide-react'
import type * as React from 'react'
import * as m from '@/paraglide/messages'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
} from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card'
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item'
import { Kbd } from '@/components/ui/kbd'
import {
  Progress,
  ProgressLabel,
  ProgressValue,
} from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { BrandLogo } from '@/components/brand-logo'

export const Route = createFileRoute('/')({ component: LandingPage })

const badgeClass =
  'h-auto border-[rgb(255_208_132/0.22)] bg-[rgb(255_206_120/0.08)] px-[0.8rem] py-[0.45rem] uppercase tracking-[0.12em] text-inherit'

const getProgressValueText = (
  _formattedValue: string | null,
  value: number | null,
) => (value == null ? 'indeterminate' : `${value}%`)

const stackLogos = [
  {
    title: 'GitHub',
    light: 'https://svgl.app/library/github_light.svg',
    dark: 'https://svgl.app/library/github_dark.svg',
  },
  {
    title: 'OpenAI',
    light: 'https://svgl.app/library/openai.svg',
    dark: 'https://svgl.app/library/openai_dark.svg',
  },
  {
    title: 'WorkOS',
    light: 'https://svgl.app/library/workos.svg',
    dark: 'https://svgl.app/library/workos-light.svg',
  },
  {
    title: 'Convex',
    light: 'https://svgl.app/library/convex.svg',
    dark: 'https://svgl.app/library/convex.svg',
  },
  {
    title: 'Vercel',
    light: 'https://svgl.app/library/vercel.svg',
    dark: 'https://svgl.app/library/vercel_dark.svg',
  },
  {
    title: 'VoidZero',
    light: 'https://svgl.app/library/voidzero.svg',
    dark: 'https://svgl.app/library/voidzero.svg',
  },
  {
    title: 'TypeScript',
    light: 'https://svgl.app/library/typescript.svg',
    dark: 'https://svgl.app/library/typescript.svg',
  },
  {
    title: 'Tailwind CSS',
    light: 'https://svgl.app/library/tailwindcss.svg',
    dark: 'https://svgl.app/library/tailwindcss.svg',
  },
] as const

function LandingPage() {
  const problems = [
    {
      label: m.landing_workflow_1_label(),
      title: m.landing_workflow_1_title(),
      summary: m.landing_workflow_1_summary(),
      icon: MessageSquareText,
    },
    {
      label: m.landing_workflow_2_label(),
      title: m.landing_workflow_2_title(),
      summary: m.landing_workflow_2_summary(),
      icon: Terminal,
    },
    {
      label: m.landing_workflow_3_label(),
      title: m.landing_workflow_3_title(),
      summary: m.landing_workflow_3_summary(),
      icon: ClipboardCheck,
    },
  ] as const

  const workflowSteps = [
    {
      title: m.landing_signal_1_title(),
      detail: m.landing_signal_1_detail(),
      icon: MessageSquareText,
    },
    {
      title: m.landing_signal_2_title(),
      detail: m.landing_signal_2_detail(),
      icon: LockKeyhole,
    },
    {
      title: m.landing_signal_3_title(),
      detail: m.landing_signal_3_detail(),
      icon: ClipboardCheck,
    },
    {
      title: m.landing_signal_4_title(),
      detail: m.landing_signal_4_detail(),
      icon: UserCheck,
    },
  ] as const

  const benefits = [
    {
      title: m.landing_proof_1_title(),
      summary: m.landing_proof_1_summary(),
      icon: GitPullRequest,
    },
    {
      title: m.landing_proof_2_title(),
      summary: m.landing_proof_2_summary(),
      icon: ShieldCheck,
    },
    {
      title: m.landing_proof_3_title(),
      summary: m.landing_proof_3_summary(),
      icon: FileDiff,
    },
    {
      title: m.landing_proof_4_title(),
      summary: m.landing_proof_4_summary(),
      icon: CircleDotDashed,
    },
  ] as const

  const evidenceItems = [
    {
      title: m.landing_evidence_1_title(),
      detail: m.landing_evidence_1_detail(),
      icon: MessageSquareText,
    },
    {
      title: m.landing_evidence_2_title(),
      detail: m.landing_evidence_2_detail(),
      icon: Terminal,
    },
    {
      title: m.landing_evidence_3_title(),
      detail: m.landing_evidence_3_detail(),
      icon: FileDiff,
    },
    {
      title: m.landing_evidence_4_title(),
      detail: m.landing_evidence_4_detail(),
      icon: UserCheck,
    },
  ] as const

  const faqs = [
    {
      question: m.landing_faq_1_question(),
      answer: m.landing_faq_1_answer(),
    },
    {
      question: m.landing_faq_2_question(),
      answer: m.landing_faq_2_answer(),
    },
    {
      question: m.landing_faq_3_question(),
      answer: m.landing_faq_3_answer(),
    },
  ] as const

  return (
    <TooltipProvider>
      <main className="pb-16">
        <section className="relative overflow-clip border-b border-white/8 before:pointer-events-none before:absolute before:inset-0 before:content-[''] before:[background:linear-gradient(90deg,var(--hero-grid)_1px,transparent_1px),linear-gradient(180deg,var(--hero-grid)_1px,transparent_1px)] before:bg-size-[4.5rem_4.5rem] before:mask-[linear-gradient(180deg,black,rgb(0_0_0/0.08))]">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-[34rem] bg-[radial-gradient(circle_at_50%_8%,rgb(255_196_92/0.2),transparent_32rem)]" />
          <div className="relative mx-auto flex min-h-[calc(100svh-var(--header-height))] w-[min(1180px,calc(100%-2rem))] flex-col items-center justify-center pt-[clamp(3rem,7vw,5.5rem)] pb-[clamp(2rem,5vw,4rem)]">
            <div className="max-w-220 text-center motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-[18px] motion-safe:duration-720 motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)]">
              <div className="mb-4 flex justify-center">
                <BrandLogo
                  className="h-[clamp(2rem,4vw,2.8rem)]"
                  priority
                />
              </div>
              <Badge variant="outline" className={badgeClass}>
                {m.landing_badge()}
              </Badge>
              <h1 className="mx-auto mt-[1rem] max-w-206 text-balance text-[clamp(3.3rem,8vw,7.4rem)] leading-[0.9] tracking-[-0.075em]">
                {m.landing_title()}
              </h1>
              <p className="mx-auto mt-[1.2rem] max-w-172 text-[clamp(1.05rem,1.8vw,1.22rem)] leading-[1.7] text-muted-foreground">
                {m.landing_lede()}
              </p>
              <div className="mt-8 flex flex-wrap justify-center gap-[0.9rem]">
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

            <div
              className="mt-[clamp(2rem,5vw,3.5rem)] w-full motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-[18px] motion-safe:duration-720 motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)]"
              style={{ animationDelay: '140ms' }}
            >
              <ReviewSurface />
            </div>
          </div>
        </section>

        <section className="mx-auto w-[min(1180px,calc(100%-2rem))] py-[clamp(2.8rem,7vw,5rem)]">
          <div className="mb-8 max-w-190">
            <Badge variant="outline" className={badgeClass}>
              {m.landing_stack_badge()}
            </Badge>
            <h2 className="mt-[0.85rem] text-balance text-[clamp(2rem,4vw,3.3rem)] leading-[1] tracking-[-0.055em]">
              {m.landing_stack_title()}
            </h2>
            <p className="mt-[1.1rem] max-w-155 text-[clamp(1.02rem,1.6vw,1.14rem)] leading-[1.7] text-muted-foreground">
              {m.landing_stack_intro()}
            </p>
          </div>
          <IntegrationBento />
        </section>

        <section className="mx-auto grid w-[min(1180px,calc(100%-2rem))] grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)] items-start gap-[clamp(2rem,5vw,4rem)] py-[clamp(2.8rem,7vw,5rem)] max-[960px]:grid-cols-1">
          <div className="sticky top-[calc(var(--header-height)+2rem)] max-[960px]:static">
            <Badge variant="outline" className={badgeClass}>
              {m.landing_workflow_badge()}
            </Badge>
            <h2 className="mt-[0.85rem] text-balance text-[clamp(2rem,4vw,3.3rem)] leading-[1] tracking-[-0.055em]">
              {m.landing_workflow_title()}
            </h2>
            <p className="mt-[1.1rem] max-w-150 text-[clamp(1.02rem,1.6vw,1.14rem)] leading-[1.7] text-muted-foreground">
              {m.landing_workflow_intro()}
            </p>
            <div className="mt-7">
              <Progress value={72} getAriaValueText={getProgressValueText}>
                <ProgressLabel>{m.landing_progress_label()}</ProgressLabel>
                <ProgressValue>{() => '72%'}</ProgressValue>
              </Progress>
            </div>
          </div>

          <div className="grid gap-4">
            {problems.map((problem, index) => {
              const Icon = problem.icon
              return (
                <Item
                  key={problem.title}
                  variant="outline"
                  className="border-white/8 bg-(--surface-panel) p-4 transition-transform hover:-translate-y-0.5 hover:bg-white/5"
                >
                  <ItemMedia
                    variant="icon"
                    className="size-11 rounded-2xl bg-[rgb(255_203_116/0.1)] text-(--brand-readable)"
                  >
                    <Icon />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle className="text-[0.78rem] uppercase tracking-[0.12em] text-(--brand-readable)">
                      {problem.label}
                    </ItemTitle>
                    <ItemTitle className="text-[1.15rem] tracking-[-0.035em]">
                      {problem.title}
                    </ItemTitle>
                    <ItemDescription className="line-clamp-none text-[0.96rem] leading-7">
                      {problem.summary}
                    </ItemDescription>
                  </ItemContent>
                  <span className="ml-auto self-start rounded-full border border-white/8 px-2 py-1 font-mono text-xs text-muted-foreground">
                    0{index + 1}
                  </span>
                </Item>
              )
            })}
          </div>
        </section>

        <section className="mx-auto w-[min(1180px,calc(100%-2rem))] py-[clamp(2.8rem,7vw,5rem)]">
          <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
            <div>
              <Badge variant="outline" className={badgeClass}>
                {m.landing_signal_intro_kicker()}
              </Badge>
              <h2 className="mt-[0.85rem] max-w-190 text-balance text-[clamp(2rem,4vw,3.3rem)] leading-[1] tracking-[-0.055em]">
                {m.landing_signal_intro_body()}
              </h2>
            </div>
            <div className="inline-flex items-center gap-[0.7rem] rounded-full border border-white/8 bg-white/4 px-[0.9rem] py-[0.7rem] text-sm text-muted-foreground">
              <Workflow />
              <span>{m.landing_signal_footer()}</span>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-3 max-[960px]:grid-cols-2 max-[560px]:grid-cols-1">
            {workflowSteps.map((step, index) => {
              const Icon = step.icon
              return (
                <div
                  key={step.title}
                  className="group relative min-h-58 overflow-hidden rounded-3xl border border-white/8 bg-(--surface-panel) p-5 transition-transform hover:-translate-y-1"
                >
                  <div className="absolute inset-x-0 top-0 h-1 bg-[linear-gradient(90deg,rgb(255_203_116/0.72),transparent)] opacity-0 transition-opacity group-hover:opacity-100" />
                  <div className="flex items-center justify-between gap-3">
                    <span className="rounded-full font-mono text-sm text-muted-foreground">
                      0{index + 1}
                    </span>
                    <span className="flex size-10 items-center justify-center rounded-2xl bg-[rgb(255_203_116/0.1)] text-(--brand-readable)">
                      <Icon />
                    </span>
                  </div>
                  <h3 className="mt-10 text-[1.2rem] tracking-[-0.04em]">
                    {step.title}
                  </h3>
                  <p className="m-0 mt-3 text-sm leading-6 text-muted-foreground">
                    {step.detail}
                  </p>
                </div>
              )
            })}
          </div>
        </section>

        <section className="mx-auto grid w-[min(1180px,calc(100%-2rem))] grid-cols-[minmax(0,0.78fr)_minmax(0,1.22fr)] items-start gap-[clamp(1.75rem,4vw,3rem)] py-[clamp(2.8rem,7vw,5rem)] max-[960px]:grid-cols-1">
          <div>
            <Badge variant="outline" className={badgeClass}>
              {m.landing_proof_badge()}
            </Badge>
            <h2 className="mt-[0.85rem] text-balance text-[clamp(2rem,4vw,3.2rem)] leading-[1] tracking-[-0.055em]">
              {m.landing_proof_title()}
            </h2>
            <p className="mt-[1.1rem] max-w-150 text-[clamp(1.02rem,1.6vw,1.14rem)] leading-[1.7] text-muted-foreground">
              {m.landing_proof_intro()}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 max-[720px]:grid-cols-1">
            {benefits.map((benefit) => {
              const Icon = benefit.icon
              return (
                <HoverCard key={benefit.title}>
                  <HoverCardTrigger
                    className="rounded-2xl border border-white/8 bg-(--surface-panel) p-[1.2rem] text-left transition-transform hover:-translate-y-0.5 hover:bg-white/5"
                    render={<button type="button" aria-label={benefit.title} />}
                  >
                    <Icon className="size-5 text-(--brand-readable)" />
                    <h3 className="mt-4 text-[1.05rem] tracking-[-0.03em]">
                      {benefit.title}
                    </h3>
                    <p className="m-0 leading-[1.7] text-muted-foreground">
                      {benefit.summary}
                    </p>
                  </HoverCardTrigger>
                  <HoverCardContent className="w-76 border border-white/8 bg-(--surface-panel-strong) p-4">
                    <p className="m-0 text-sm leading-6 text-muted-foreground">
                      {m.landing_hover_detail()}
                    </p>
                  </HoverCardContent>
                </HoverCard>
              )
            })}
          </div>
        </section>

        <section className="mx-auto w-[min(1180px,calc(100%-2rem))] py-[clamp(2.8rem,7vw,5rem)]">
          <div className="mb-7 max-w-180">
            <Badge variant="outline" className={badgeClass}>
              {m.landing_platform_badge()}
            </Badge>
            <h2 className="mt-[0.85rem] text-balance text-[clamp(2rem,4vw,3.25rem)] leading-[1] tracking-[-0.055em]">
              {m.landing_platform_title()}
            </h2>
            <p className="mt-[1.1rem] text-[clamp(1.02rem,1.6vw,1.14rem)] leading-[1.7] text-muted-foreground">
              {m.landing_platform_intro()}
            </p>
          </div>

          <Tabs defaultValue="request" className="gap-5">
            <TabsList
              variant="line"
              className="w-full justify-start overflow-x-auto"
            >
              <TabsTrigger value="request">
                <MessageSquareText />
                {m.landing_tab_request()}
              </TabsTrigger>
              <TabsTrigger value="run">
                <Play />
                {m.landing_tab_run()}
              </TabsTrigger>
              <TabsTrigger value="evidence">
                <FileDiff />
                {m.landing_tab_evidence()}
              </TabsTrigger>
              <TabsTrigger value="decision">
                <UserCheck />
                {m.landing_tab_decision()}
              </TabsTrigger>
            </TabsList>
            <div className="rounded-4xl border border-white/8 bg-(--surface-panel) p-[clamp(1rem,3vw,1.5rem)]">
              <TabsContent value="request">
                <ProductTabShell
                  eyebrow="prompt/request"
                  title={m.landing_tab_request_title()}
                  command="/patchplane review billing-webhook"
                >
                  <ItemGroup className="gap-3">
                    <EvidenceList items={evidenceItems.slice(0, 2)} />
                  </ItemGroup>
                </ProductTabShell>
              </TabsContent>
              <TabsContent value="run">
                <ProductTabShell
                  eyebrow="sandbox/run"
                  title={m.landing_tab_run_title()}
                  command="patchplane run --pre-ci"
                >
                  <div className="grid gap-4">
                    <Progress value={100}>
                      <ProgressLabel>isolated execution</ProgressLabel>
                      <ProgressValue>{() => 'complete'}</ProgressValue>
                    </Progress>
                    <TerminalBlock />
                  </div>
                </ProductTabShell>
              </TabsContent>
              <TabsContent value="evidence">
                <ProductTabShell
                  eyebrow="review/evidence"
                  title={m.landing_tab_evidence_title()}
                  command="patchplane evidence attach"
                >
                  <ItemGroup className="gap-3">
                    <EvidenceList items={evidenceItems.slice(1)} />
                  </ItemGroup>
                </ProductTabShell>
              </TabsContent>
              <TabsContent value="decision">
                <ProductTabShell
                  eyebrow="human/decision"
                  title={m.landing_tab_decision_title()}
                  command="approval required"
                >
                  <div className="flex flex-wrap items-center gap-4 rounded-3xl border border-white/8 bg-white/3 p-4">
                    <AvatarGroup>
                      <Avatar>
                        <AvatarFallback>AI</AvatarFallback>
                      </Avatar>
                      <Avatar>
                        <AvatarFallback>UG</AvatarFallback>
                      </Avatar>
                      <Avatar>
                        <AvatarFallback>PR</AvatarFallback>
                      </Avatar>
                      <AvatarGroupCount>+2</AvatarGroupCount>
                    </AvatarGroup>
                    <div className="min-w-0 flex-1">
                      <p className="m-0 font-medium">
                        {m.landing_decision_reviewers()}
                      </p>
                      <p className="m-0 text-sm leading-6 text-muted-foreground">
                        {m.landing_decision_reviewers_detail()}
                      </p>
                    </div>
                    <Badge variant="outline" className={badgeClass}>
                      awaiting approval
                    </Badge>
                  </div>
                </ProductTabShell>
              </TabsContent>
            </div>
          </Tabs>
        </section>

        <section className="mx-auto grid w-[min(1180px,calc(100%-2rem))] grid-cols-[minmax(0,1fr)_minmax(300px,0.7fr)] gap-[clamp(2rem,5vw,4rem)] py-[clamp(2.8rem,7vw,5rem)] max-[960px]:grid-cols-1">
          <div className="rounded-4xl border border-white/8 bg-[linear-gradient(135deg,rgb(255_203_116/0.12),transparent_42%),var(--surface-panel)] p-[clamp(1.5rem,4vw,2.25rem)]">
            <Badge variant="outline" className={badgeClass}>
              {m.landing_cta_badge()}
            </Badge>
            <h2 className="mt-[0.85rem] text-balance text-[clamp(2rem,4vw,3.25rem)] leading-[1] tracking-[-0.055em]">
              {m.landing_cta_title()}
            </h2>
            <p className="mt-[1.1rem] max-w-152 text-[clamp(1.02rem,1.6vw,1.14rem)] leading-[1.7] text-muted-foreground">
              {m.landing_cta_body()}
            </p>
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
                {m.landing_read_architecture()}
              </Link>
            </div>
          </div>
          <Accordion className="rounded-4xl border border-white/8 bg-(--surface-panel) p-5">
            {faqs.map((faq, index) => (
              <AccordionItem key={faq.question}>
                <AccordionTrigger>
                  <span className="mr-4 font-mono text-xs text-muted-foreground">
                    0{index + 1}
                  </span>
                  {faq.question}
                </AccordionTrigger>
                <AccordionContent className="pl-9 text-muted-foreground">
                  {faq.answer}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </section>
      </main>
    </TooltipProvider>
  )
}

function ReviewSurface() {
  return (
    <div className="overflow-hidden rounded-[2rem] border border-white/8 bg-[linear-gradient(180deg,rgb(255_255_255/0.08),rgb(255_255_255/0.03))] shadow-[0_24px_90px_rgb(3_8_18/0.28)]">
      <div className="grid grid-cols-[0.72fr_1.28fr] max-[900px]:grid-cols-1">
        <div className="border-r border-white/8 bg-black/5 p-5 max-[900px]:border-r-0 max-[900px]:border-b">
          <div className="mb-5 flex items-center gap-2">
            <Bot className="size-4 text-(--brand-readable)" />
            <span className="text-sm font-medium">AI patch review</span>
            <Badge variant="outline" className="ml-auto rounded-full">
              pre-CI
            </Badge>
          </div>
          <ItemGroup className="gap-2">
            {[
              ['Request', 'billing webhook retry logic'],
              ['Repository', 'acme/payments-api'],
              ['Scope', '3 files changed'],
            ].map(([label, value]) => (
              <Item key={label} variant="muted" size="sm">
                <ItemContent>
                  <ItemDescription className="text-xs uppercase tracking-[0.12em]">
                    {label}
                  </ItemDescription>
                  <ItemTitle>{value}</ItemTitle>
                </ItemContent>
              </Item>
            ))}
          </ItemGroup>
          <Separator className="my-5 bg-white/8" />
          <Progress value={72} getAriaValueText={getProgressValueText}>
            <ProgressLabel>review confidence</ProgressLabel>
            <ProgressValue>{() => '72%'}</ProgressValue>
          </Progress>
        </div>

        <div className="p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="m-0 text-[0.78rem] uppercase tracking-[0.14em] text-(--brand-readable)">
                Awaiting approval
              </p>
              <h2 className="mt-2 text-[1.45rem] tracking-[-0.045em]">
                Evidence before merge
              </h2>
            </div>
            <div className="flex items-center gap-2">
              <Tooltip>
                <TooltipTrigger className="rounded-full border border-white/8 px-3 py-1.5 text-sm text-muted-foreground">
                  <Kbd>/patchplane</Kbd>
                </TooltipTrigger>
                <TooltipContent>GitHub-native command intake</TooltipContent>
              </Tooltip>
              <Badge variant="outline" className="rounded-full">
                medium risk
              </Badge>
            </div>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(220px,0.7fr)] gap-4 max-[720px]:grid-cols-1">
            <div className="rounded-3xl border border-white/8 bg-black/18 p-4 font-mono text-[0.86rem] leading-[1.7] text-muted-foreground">
              <p className="m-0 text-foreground">
                $ patchplane review billing-webhook
              </p>
              <p className="m-0">✓ request linked to owner and repo</p>
              <p className="m-0">✓ sandbox run completed without secrets</p>
              <p className="m-0">✓ 42 tests passed</p>
              <p className="m-0 text-(--brand-readable)">
                ! approval required before merge
              </p>
            </div>
            <ItemGroup className="gap-2">
              <Item variant="outline" size="sm" className="border-white/8">
                <ItemMedia variant="icon" className="text-(--success-readable)">
                  <CheckCircle2 />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>Tests passing</ItemTitle>
                  <ItemDescription>42 checks recorded</ItemDescription>
                </ItemContent>
              </Item>
              <Item variant="outline" size="sm" className="border-white/8">
                <ItemMedia variant="icon" className="text-(--brand-readable)">
                  <FileDiff />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>Diff summarized</ItemTitle>
                  <ItemDescription>3 files changed</ItemDescription>
                </ItemContent>
              </Item>
              <Item variant="outline" size="sm" className="border-white/8">
                <ItemMedia variant="icon" className="text-(--success-readable)">
                  <ShieldCheck />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>No secrets</ItemTitle>
                  <ItemDescription>trusted CI protected</ItemDescription>
                </ItemContent>
              </Item>
            </ItemGroup>
          </div>
        </div>
      </div>
    </div>
  )
}

function IntegrationBento() {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-6 lg:grid-rows-[minmax(18rem,auto)_minmax(18rem,auto)]">
      <div className="group flex md:col-span-6 lg:col-span-4">
        <div className="relative w-full overflow-hidden rounded-3xl border border-white/8 bg-(--surface-panel) p-[clamp(1.2rem,3vw,1.6rem)] transition-transform hover:-translate-y-1 lg:rounded-tl-[2rem]">
          <div className="absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgb(255_203_116/0.65),transparent)] opacity-70" />
          <div className="grid gap-5 xl:min-h-76 xl:grid-cols-[minmax(0,1fr)_minmax(240px,0.85fr)]">
            <div className="flex flex-col justify-between gap-5 md:gap-8">
              <div>
                <p className="m-0 text-[0.78rem] uppercase tracking-[0.14em] text-(--brand-readable)">
                  {m.landing_bento_review_label()}
                </p>
                <h3 className="mt-3 max-w-130 text-[clamp(1.55rem,3vw,2.35rem)] leading-[1.02] tracking-[-0.055em]">
                  {m.landing_bento_review_title()}
                </h3>
                <p className="mt-4 max-w-130 text-sm leading-6 text-muted-foreground">
                  {m.landing_bento_review_body()}
                </p>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {[
                  ['01', m.landing_bento_review_step_1()],
                  ['02', m.landing_bento_review_step_2()],
                  ['03', m.landing_bento_review_step_3()],
                ].map(([number, label]) => (
                  <div
                    key={number}
                    className="rounded-2xl border border-white/8 bg-black/12 p-2.5 sm:p-3"
                  >
                    <span className="font-mono text-xs text-(--brand-readable)">
                      {number}
                    </span>
                    <p className="m-0 mt-1.5 text-xs leading-5 text-muted-foreground sm:mt-2 sm:text-sm">
                      {label}
                    </p>
                  </div>
                ))}
              </div>
            </div>
            <div className="relative min-h-48 overflow-hidden rounded-3xl border border-white/8 bg-black/18 p-3 md:min-h-60 md:p-4">
              <div className="absolute inset-0 bg-[linear-gradient(135deg,rgb(255_203_116/0.12),transparent_48%)]" />
              <div className="relative flex h-full flex-col justify-between gap-5">
                <div className="grid grid-cols-4 gap-2 min-[520px]:grid-cols-2 min-[520px]:gap-3">
                  {stackLogos.slice(0, 4).map((logo) => (
                    <SvglLogo key={logo.title} logo={logo} />
                  ))}
                </div>
                <div className="rounded-2xl border border-white/8 bg-(--surface-panel-strong) p-3 font-mono text-xs leading-5 text-muted-foreground sm:text-sm sm:leading-6">
                  <p className="m-0 text-foreground">patchplane collect</p>
                  <p className="m-0">github issue linked</p>
                  <p className="m-0">agent run attached</p>
                  <p className="m-0 text-(--brand-readable)">
                    reviewer gate ready
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="group flex md:col-span-3 lg:col-span-2">
        <div className="w-full overflow-hidden rounded-3xl border border-white/8 bg-(--surface-panel) p-[clamp(1.2rem,3vw,1.6rem)] transition-transform hover:-translate-y-1 lg:rounded-tr-[2rem]">
          <p className="m-0 text-[0.78rem] uppercase tracking-[0.14em] text-(--brand-readable)">
            {m.landing_bento_tools_label()}
          </p>
          <h3 className="mt-3 text-[clamp(1.45rem,2.6vw,2rem)] leading-[1.05] tracking-[-0.05em]">
            {m.landing_bento_tools_title()}
          </h3>
          <p className="mt-4 text-sm leading-6 text-muted-foreground">
            {m.landing_bento_tools_body()}
          </p>
          <div className="mt-6 grid grid-cols-4 gap-2 sm:mt-8 sm:grid-cols-2 sm:gap-3">
            {stackLogos.slice(4).map((logo) => (
              <SvglLogo key={logo.title} logo={logo} compact />
            ))}
          </div>
        </div>
      </div>

      <div className="group flex md:col-span-3 lg:col-span-2">
        <div className="w-full overflow-hidden rounded-3xl border border-white/8 bg-(--surface-panel) p-[clamp(1.2rem,3vw,1.6rem)] transition-transform hover:-translate-y-1 lg:rounded-bl-[2rem]">
          <p className="m-0 text-[0.78rem] uppercase tracking-[0.14em] text-(--brand-readable)">
            {m.landing_bento_boundary_label()}
          </p>
          <h3 className="mt-3 text-[clamp(1.45rem,2.6vw,2rem)] leading-[1.05] tracking-[-0.05em]">
            {m.landing_bento_boundary_title()}
          </h3>
          <p className="mt-4 text-sm leading-6 text-muted-foreground">
            {m.landing_bento_boundary_body()}
          </p>
          <div className="mt-8 grid gap-3">
            {[
              m.landing_bento_boundary_1(),
              m.landing_bento_boundary_2(),
              m.landing_bento_boundary_3(),
            ].map((item) => (
              <div
                key={item}
                className="flex items-center gap-3 rounded-2xl border border-white/8 bg-black/12 p-3"
              >
                <ShieldCheck className="size-4 text-(--brand-readable)" />
                <span className="text-sm text-muted-foreground">{item}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="group flex md:col-span-6 lg:col-span-4">
        <div className="w-full overflow-hidden rounded-3xl border border-white/8 bg-(--surface-panel) p-[clamp(1.2rem,3vw,1.6rem)] transition-transform hover:-translate-y-1 lg:rounded-br-[2rem]">
          <div className="grid gap-5 md:grid-cols-[minmax(0,0.8fr)_minmax(240px,1fr)] xl:min-h-76">
            <div>
              <p className="m-0 text-[0.78rem] uppercase tracking-[0.14em] text-(--brand-readable)">
                {m.landing_bento_decision_label()}
              </p>
              <h3 className="mt-3 text-[clamp(1.55rem,3vw,2.35rem)] leading-[1.02] tracking-[-0.055em]">
                {m.landing_bento_decision_title()}
              </h3>
              <p className="mt-4 text-sm leading-6 text-muted-foreground">
                {m.landing_bento_decision_body()}
              </p>
            </div>
            <div className="grid content-center gap-3 rounded-3xl border border-white/8 bg-black/18 p-4">
              {[
                [m.landing_bento_decision_1(), 'passed'],
                [m.landing_bento_decision_2(), 'attached'],
                [m.landing_bento_decision_3(), 'required'],
              ].map(([label, status]) => (
                <div
                  key={label}
                  className="flex items-center justify-between gap-4 rounded-2xl bg-(--surface-panel-strong) p-3"
                >
                  <span className="text-sm">{label}</span>
                  <Badge variant="outline" className="rounded-full">
                    {status}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function SvglLogo({
  logo,
  compact = false,
}: {
  logo: (typeof stackLogos)[number]
  compact?: boolean
}) {
  return (
    <div
      className={cn(
        'group/logo flex min-h-12 items-center gap-3 rounded-2xl border border-white/8 bg-(--surface-panel-strong) p-2.5 transition-colors hover:bg-white/6 sm:p-3',
        compact && 'justify-center',
      )}
    >
      <picture>
        <source srcSet={logo.dark} media="(prefers-color-scheme: dark)" />
        <img
          src={logo.light}
          alt=""
          loading="lazy"
          className="size-6 shrink-0 object-contain transition-transform group-hover/logo:scale-110 sm:size-7"
        />
      </picture>
      {!compact && (
        <span className="hidden text-sm font-medium min-[520px]:inline">
          {logo.title}
        </span>
      )}
    </div>
  )
}

function ProductTabShell({
  eyebrow,
  title,
  command,
  children,
}: {
  eyebrow: string
  title: string
  command: string
  children: React.ReactNode
}) {
  return (
    <div className="grid grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] gap-5 max-[860px]:grid-cols-1">
      <div className="grid content-between gap-8 rounded-3xl border border-white/8 bg-black/10 p-5">
        <div>
          <p className="m-0 text-[0.78rem] uppercase tracking-[0.14em] text-(--brand-readable)">
            {eyebrow}
          </p>
          <h3 className="mt-3 text-[clamp(1.55rem,3vw,2.25rem)] leading-[1.05] tracking-[-0.05em]">
            {title}
          </h3>
        </div>
        <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-black/18 p-3 font-mono text-sm text-muted-foreground">
          <Terminal className="size-4" />
          <span>{command}</span>
        </div>
      </div>
      <div>{children}</div>
    </div>
  )
}

function EvidenceList({
  items,
}: {
  items: ReadonlyArray<{
    title: string
    detail: string
    icon: LucideIcon
  }>
}) {
  return (
    <>
      {items.map((item) => {
        const Icon = item.icon
        return (
          <Item key={item.title} variant="outline" className="border-white/8">
            <ItemMedia
              variant="icon"
              className="size-10 rounded-2xl bg-[rgb(255_203_116/0.1)] text-(--brand-readable)"
            >
              <Icon />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{item.title}</ItemTitle>
              <ItemDescription className="line-clamp-none">
                {item.detail}
              </ItemDescription>
            </ItemContent>
          </Item>
        )
      })}
    </>
  )
}

function TerminalBlock() {
  return (
    <div className="rounded-3xl border border-white/8 bg-black/18 p-4 font-mono text-[0.86rem] leading-[1.7] text-muted-foreground">
      <p className="m-0 text-foreground">$ patchplane run --pre-ci</p>
      <p className="m-0">pulling isolated runtime</p>
      <p className="m-0">applying generated patch</p>
      <p className="m-0 text-(--success-readable)">42 tests passed</p>
      <p className="m-0 text-(--brand-readable)">risk note attached</p>
    </div>
  )
}
