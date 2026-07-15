import { createFileRoute } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import {
  ArrowRight,
  Check,
  CheckCircle2,
  CircleDotDashed,
  ClipboardCheck,
  FileArchive,
  FileDiff,
  GitBranch,
  GitPullRequest,
  LockKeyhole,
  MessageSquareText,
  ShieldCheck,
  Terminal,
  UserCheck,
  XCircle,
  type LucideIcon,
} from 'lucide-react'
import * as m from '@/paraglide/messages'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { LandingShaderBackground } from '@/components/landing-shader-background'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/')({ component: LandingPage })

const repositoryUrl = 'https://github.com/okikeSolutions/patchplane'
const readmeUrl = `${repositoryUrl}#readme`
const quickStartUrl = `${repositoryUrl}#quick-start`
const roadmapUrl = `${repositoryUrl}/blob/main/ROADMAP.md`

const timelineSteps = [
  {
    title: m.landing_step_1_title,
    detail: m.landing_step_1_detail,
    icon: GitPullRequest,
  },
  {
    title: m.landing_step_2_title,
    detail: m.landing_step_2_detail,
    icon: LockKeyhole,
  },
  {
    title: m.landing_step_3_title,
    detail: m.landing_step_3_detail,
    icon: ClipboardCheck,
  },
  {
    title: m.landing_step_4_title,
    detail: m.landing_step_4_detail,
    icon: UserCheck,
  },
  {
    title: m.landing_step_5_title,
    detail: m.landing_step_5_detail,
    icon: CheckCircle2,
  },
] as const

function LandingPage() {
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="relative isolate overflow-clip"
    >
      <LandingShaderBackground />
      <div className="relative z-1">
        <Hero />
        <ProblemStatement />
        <WorkflowTimeline />
        <OpenSourceSection />
      </div>
    </main>
  )
}

function Hero() {
  return (
    <section
      aria-labelledby="landing-title"
      className="relative overflow-clip border-b border-(--landing-border) before:pointer-events-none before:absolute before:inset-0 before:z-1 before:bg-size-[4.5rem_4.5rem] before:content-[''] before:[background:linear-gradient(90deg,var(--hero-grid)_1px,transparent_1px),linear-gradient(180deg,var(--hero-grid)_1px,transparent_1px)] before:mask-[linear-gradient(180deg,black,rgb(0_0_0/0.08))]"
    >
      <div className="relative z-2 mx-auto w-[min(1180px,calc(100%-2rem))] pt-[clamp(2.75rem,5vw,4.5rem)]">
        <div className="mx-auto flex max-w-230 flex-col items-center text-center">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-(--brand-readable)">
            {m.landing_badge()}
          </p>
          <h1
            id="landing-title"
            className="mt-4 text-balance text-[clamp(3.1rem,6.5vw,6rem)] leading-[0.94] tracking-[-0.07em]"
          >
            {m.landing_title()}
          </h1>
          <p className="mt-5 max-w-170 text-balance text-[clamp(1rem,1.6vw,1.2rem)] leading-7 text-muted-foreground">
            {m.landing_lede()}
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <a
              href={repositoryUrl}
              className={cn(
                buttonVariants({ size: 'lg' }),
                'rounded-full px-6 shadow-[0_18px_48px_rgb(237_176_69/0.16)] transition-transform hover:-translate-y-px',
              )}
            >
              {m.landing_view_github()}
              <ArrowRight data-icon="inline-end" />
            </a>
            <a
              href={quickStartUrl}
              className={cn(
                buttonVariants({ variant: 'ghost', size: 'lg' }),
                'rounded-full px-6 text-muted-foreground hover:text-foreground',
              )}
            >
              {m.landing_quick_start()}
            </a>
          </div>
        </div>

        <div className="mt-[clamp(2.5rem,4vw,3.5rem)] translate-y-px animate-in fade-in slide-in-from-bottom-6 duration-700">
          <TrustReportDemo />
        </div>
      </div>
    </section>
  )
}

function TrustReportDemo() {
  return (
    <div
      id="trust-report"
      className="relative scroll-mt-6 overflow-hidden rounded-t-[2rem] border border-b-0 border-(--landing-border) bg-(--surface-panel-strong) shadow-[0_-24px_100px_rgb(0_0_0/0.16)] backdrop-blur-xl before:absolute before:inset-x-0 before:top-0 before:z-2 before:h-px before:bg-[linear-gradient(90deg,transparent,var(--primary),transparent)] before:content-['']"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-(--landing-border) px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex gap-1.5" aria-hidden="true">
            <span className="size-2 rounded-full bg-foreground/20" />
            <span className="size-2 rounded-full bg-foreground/20" />
            <span className="size-2 rounded-full bg-primary" />
          </div>
          <Separator
            orientation="vertical"
            className="h-5 bg-(--landing-border)"
          />
          <span className="truncate font-mono text-xs text-muted-foreground">
            {m.landing_demo_window_title()}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{m.landing_demo_illustrative()}</Badge>
          <Badge
            variant="outline"
            className="border-primary/40 text-(--brand-readable)"
          >
            {m.landing_demo_decision_required()}
          </Badge>
        </div>
      </div>

      <Tabs defaultValue="summary" className="gap-0">
        <div className="border-b border-(--landing-border) px-5">
          <TabsList variant="line" className="h-11">
            <TabsTrigger value="summary">
              {m.landing_demo_tab_summary()}
            </TabsTrigger>
            <TabsTrigger value="evidence">
              {m.landing_demo_tab_evidence()}
            </TabsTrigger>
            <TabsTrigger value="logs">{m.landing_demo_tab_logs()}</TabsTrigger>
            <TabsTrigger value="decision">
              {m.landing_demo_tab_decision()}
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="summary">
          <div className="grid min-h-105 grid-cols-[minmax(0,1.45fr)_minmax(280px,0.75fr)] max-[820px]:grid-cols-1">
            <div className="min-w-0 border-r border-(--landing-border) p-[clamp(1.25rem,3vw,2rem)] max-[820px]:border-r-0 max-[820px]:border-b">
              <ReportHeading
                eyebrow={m.landing_demo_report_eyebrow()}
                title={m.landing_demo_summary_title()}
                detail={m.landing_demo_summary_detail()}
              />
              <div className="mt-7 overflow-hidden rounded-xl border border-(--landing-border)">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>{m.landing_demo_changed_file()}</TableHead>
                      <TableHead className="text-right">
                        {m.landing_demo_patch()}
                      </TableHead>
                      <TableHead>{m.landing_demo_status()}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <FileRow
                      file="src/runtime/review.ts"
                      patch="+42 −8"
                      status={m.landing_demo_verified()}
                    />
                    <FileRow
                      file="src/domain/decision.ts"
                      patch="+18 −3"
                      status={m.landing_demo_verified()}
                    />
                    <FileRow
                      file="test/review-flow.test.ts"
                      patch="+61"
                      status={m.landing_demo_passed()}
                    />
                  </TableBody>
                </Table>
              </div>
              <div className="mt-7 grid grid-cols-3 divide-x divide-(--landing-border) max-[560px]:grid-cols-1 max-[560px]:divide-x-0 max-[560px]:divide-y">
                <ReportMetric
                  label={m.landing_demo_verification()}
                  value={m.landing_demo_passed()}
                />
                <ReportMetric
                  label={m.landing_demo_evidence()}
                  value={m.landing_demo_artifacts()}
                />
                <ReportMetric
                  label={m.landing_demo_sandbox()}
                  value={m.landing_demo_ephemeral()}
                />
              </div>
            </div>

            <aside className="flex flex-col p-[clamp(1.25rem,3vw,2rem)]">
              <ReportHeading
                eyebrow={m.landing_demo_review_state()}
                title={m.landing_demo_ready_title()}
                detail={m.landing_demo_ready_detail()}
              />
              <div className="mt-7 flex flex-col gap-0">
                <EvidenceRow
                  icon={GitBranch}
                  label={m.landing_demo_patch_captured()}
                  detail={m.landing_demo_files_changed()}
                  complete
                />
                <EvidenceRow
                  icon={Terminal}
                  label={m.landing_demo_isolated_run()}
                  detail={m.landing_demo_test_exit()}
                  complete
                />
                <EvidenceRow
                  icon={FileArchive}
                  label={m.landing_demo_evidence_collected()}
                  detail={m.landing_demo_evidence_attached()}
                  complete
                />
                <EvidenceRow
                  icon={UserCheck}
                  label={m.landing_demo_human_decision()}
                  detail={m.landing_demo_approval_required()}
                />
              </div>
              <Alert className="mt-auto border-primary/30 bg-primary/7">
                <ShieldCheck />
                <AlertTitle>{m.landing_demo_alert_title()}</AlertTitle>
                <AlertDescription>
                  {m.landing_demo_alert_detail()}
                </AlertDescription>
              </Alert>
            </aside>
          </div>
        </TabsContent>

        <TabsContent value="evidence">
          <DemoPanel
            title={m.landing_demo_captured_title()}
            detail={m.landing_demo_captured_detail()}
          >
            <div className="divide-y divide-(--landing-border)">
              <EvidenceListRow
                label={m.landing_demo_test_report()}
                value={m.landing_demo_checks_passed()}
                icon={CheckCircle2}
              />
              <EvidenceListRow
                label={m.landing_demo_patch_artifact()}
                value={m.landing_demo_unified_diff()}
                icon={FileDiff}
              />
              <EvidenceListRow
                label={m.landing_demo_runtime_trace()}
                value={m.landing_demo_recorded_events()}
                icon={CircleDotDashed}
              />
            </div>
          </DemoPanel>
        </TabsContent>

        <TabsContent value="logs">
          <DemoPanel
            title={m.landing_demo_isolated_run()}
            detail={m.landing_demo_logs_detail()}
          >
            <ScrollArea className="h-60 rounded-xl bg-black/20">
              <pre className="p-5 font-mono text-xs leading-6 text-muted-foreground">{`$ bun test
✓ domain/decision.test.ts (12)
✓ runtime/review-flow.test.ts (21)
✓ source-control/webhook.test.ts (14)

Test Files  3 passed (3)
Tests       47 passed (47)
Exit code   0`}</pre>
            </ScrollArea>
          </DemoPanel>
        </TabsContent>

        <TabsContent value="decision">
          <DemoPanel
            title={m.landing_demo_human_decision()}
            detail={m.landing_demo_decision_detail()}
          >
            <div className="grid gap-4 sm:grid-cols-3">
              <DecisionOption icon={Check} title={m.landing_demo_approve()} />
              <DecisionOption
                icon={MessageSquareText}
                title={m.landing_demo_request_changes()}
              />
              <DecisionOption icon={XCircle} title={m.landing_demo_reject()} />
            </div>
          </DemoPanel>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function ProblemStatement() {
  const problems = [
    {
      title: m.landing_problem_1_title(),
      detail: m.landing_problem_1_detail(),
    },
    {
      title: m.landing_problem_2_title(),
      detail: m.landing_problem_2_detail(),
    },
    {
      title: m.landing_problem_3_title(),
      detail: m.landing_problem_3_detail(),
    },
  ]

  return (
    <section
      aria-labelledby="landing-problem-title"
      className="border-b border-(--landing-border) bg-(--chapter-problem) backdrop-blur-md"
    >
      <div className="mx-auto grid w-[min(1120px,calc(100%-2rem))] grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] gap-[clamp(3rem,9vw,8rem)] py-[clamp(6rem,10vw,9rem)] max-[760px]:grid-cols-1">
        <div>
          <SectionLabel>{m.landing_problem_badge()}</SectionLabel>
          <h2
            id="landing-problem-title"
            className="mt-5 text-balance text-[clamp(2.6rem,5vw,4.8rem)] leading-[0.98] tracking-[-0.06em]"
          >
            {m.landing_problem_title()}
          </h2>
          <p className="mt-6 max-w-145 text-lg leading-8 text-muted-foreground">
            {m.landing_problem_intro()}
          </p>
        </div>
        <div className="divide-y divide-(--landing-border) border-y border-(--landing-border)">
          {problems.map((problem, index) => (
            <div
              key={problem.title}
              className="grid grid-cols-[3rem_1fr] gap-4 py-7"
            >
              <span className="font-mono text-xs text-(--brand-readable)">
                0{index + 1}
              </span>
              <div>
                <h3 className="text-xl tracking-[-0.035em]">{problem.title}</h3>
                <p className="mt-2 max-w-130 leading-7 text-muted-foreground">
                  {problem.detail}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function WorkflowTimeline() {
  return (
    <section
      id="how-it-works"
      aria-labelledby="landing-how-title"
      className="scroll-mt-6 border-b border-(--landing-border) bg-(--chapter-workflow) py-[clamp(6rem,10vw,8rem)] backdrop-blur-lg"
    >
      <div className="mx-auto w-[min(1180px,calc(100%-2rem))]">
        <div className="max-w-195">
          <SectionLabel>{m.landing_how_badge()}</SectionLabel>
          <h2
            id="landing-how-title"
            className="mt-5 text-balance text-[clamp(2.6rem,5vw,4.8rem)] leading-[0.98] tracking-[-0.06em]"
          >
            {m.landing_how_title()}
          </h2>
          <p className="mt-6 max-w-165 text-lg leading-8 text-muted-foreground">
            {m.landing_how_intro()}
          </p>
        </div>

        <ol className="relative mt-[clamp(4rem,8vw,7rem)] grid list-none grid-cols-5 p-0 max-[820px]:grid-cols-1">
          <div
            aria-hidden="true"
            className="absolute top-5 right-[calc(20%_-_2.5rem)] left-5 h-px bg-(--landing-border) max-[820px]:top-5 max-[820px]:right-auto max-[820px]:bottom-5 max-[820px]:left-5 max-[820px]:h-auto max-[820px]:w-px"
          />
          {timelineSteps.map((step, index) => (
            <TimelineStep key={step.title()} step={step} index={index} />
          ))}
        </ol>
      </div>
    </section>
  )
}

function TimelineStep({
  step,
  index,
}: {
  step: (typeof timelineSteps)[number]
  index: number
}) {
  const Icon = step.icon

  return (
    <li className="group relative px-4 first:pl-0 last:pr-0 max-[820px]:grid max-[820px]:grid-cols-[2.5rem_1fr] max-[820px]:gap-5 max-[820px]:px-0 max-[820px]:pb-10">
      <div className="relative z-1 flex size-10 items-center justify-center rounded-full border border-(--landing-border) bg-background text-(--brand-readable) transition-colors group-hover:border-primary group-hover:bg-primary group-hover:text-primary-foreground">
        <Icon className="size-4" />
      </div>
      <div className="mt-8 max-[820px]:mt-0">
        <span className="font-mono text-xs text-muted-foreground">
          0{index + 1}
        </span>
        <h3 className="mt-3 text-lg tracking-[-0.035em]">{step.title()}</h3>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {step.detail()}
        </p>
      </div>
    </li>
  )
}

function OpenSourceSection() {
  const resources = [
    { href: readmeUrl, label: m.landing_capabilities(), index: '01' },
    { href: roadmapUrl, label: m.landing_roadmap(), index: '02' },
  ]

  return (
    <section
      id="open-source"
      aria-labelledby="landing-alpha-title"
      className="scroll-mt-6 border-b border-(--landing-border) bg-(--chapter-open) backdrop-blur-sm"
    >
      <div className="mx-auto grid w-[min(1120px,calc(100%-2rem))] grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)] gap-[clamp(4rem,10vw,9rem)] py-[clamp(6rem,10vw,9rem)] max-[800px]:grid-cols-1">
        <div>
          <SectionLabel>{m.landing_alpha_badge()}</SectionLabel>
          <h2
            id="landing-alpha-title"
            className="mt-5 max-w-175 text-balance text-[clamp(3rem,6vw,6rem)] leading-[0.92] tracking-[-0.07em]"
          >
            {m.landing_alpha_title()}
          </h2>
        </div>
        <div className="flex flex-col justify-end">
          <p className="max-w-145 text-lg leading-8 text-muted-foreground">
            {m.landing_alpha_body()}
          </p>
          <nav
            aria-label={m.landing_resources_label()}
            className="mt-10 border-y border-(--landing-border)"
          >
            {resources.map((resource) => (
              <a
                key={resource.href}
                href={resource.href}
                className="group flex items-center gap-4 border-b border-(--landing-border) py-4 transition-colors last:border-b-0 hover:text-(--brand-readable)"
              >
                <span className="font-mono text-xs text-muted-foreground">
                  {resource.index}
                </span>
                <span className="flex-1">{resource.label}</span>
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
              </a>
            ))}
          </nav>
        </div>
      </div>
    </section>
  )
}

function SectionLabel({ children }: { children: string }) {
  return (
    <p className="font-mono text-xs uppercase tracking-[0.18em] text-(--brand-readable)">
      {children}
    </p>
  )
}

function ReportHeading({
  eyebrow,
  title,
  detail,
}: {
  eyebrow: string
  title: string
  detail: string
}) {
  return (
    <div>
      <p className="font-mono text-xs uppercase tracking-[0.14em] text-(--brand-readable)">
        {eyebrow}
      </p>
      <h3 className="mt-2 text-2xl tracking-[-0.045em]">{title}</h3>
      <p className="mt-2 max-w-135 text-sm leading-6 text-muted-foreground">
        {detail}
      </p>
    </div>
  )
}

function FileRow({
  file,
  patch,
  status,
}: {
  file: string
  patch: string
  status: string
}) {
  return (
    <TableRow>
      <TableCell className="max-w-65 truncate font-mono text-xs">
        {file}
      </TableCell>
      <TableCell className="text-right font-mono text-xs text-muted-foreground">
        {patch}
      </TableCell>
      <TableCell>
        <Badge variant="secondary">{status}</Badge>
      </TableCell>
    </TableRow>
  )
}

function ReportMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-5 first:pl-0 last:pr-0 max-[560px]:px-0 max-[560px]:py-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium">{value}</p>
    </div>
  )
}

function EvidenceRow({
  icon: Icon,
  label,
  detail,
  complete = false,
}: {
  icon: LucideIcon
  label: string
  detail: string
  complete?: boolean
}) {
  return (
    <div className="grid grid-cols-[2rem_1fr] gap-3 pb-5 last:pb-7">
      <div className="relative flex flex-col items-center">
        <div
          className={cn(
            'relative z-1 flex size-8 items-center justify-center rounded-full border bg-background',
            complete
              ? 'border-primary text-(--brand-readable)'
              : 'border-(--landing-border) text-muted-foreground',
          )}
        >
          <Icon className="size-3.5" />
        </div>
        <div className="absolute top-8 bottom-0 w-px bg-(--landing-border) last:hidden" />
      </div>
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>
      </div>
    </div>
  )
}

function DemoPanel({
  title,
  detail,
  children,
}: {
  title: string
  detail: string
  children: ReactNode
}) {
  return (
    <div className="min-h-105 p-[clamp(1.25rem,3vw,2rem)]">
      <ReportHeading
        eyebrow={m.landing_demo_report_eyebrow()}
        title={title}
        detail={detail}
      />
      <div className="mt-7">{children}</div>
    </div>
  )
}

function EvidenceListRow({
  label,
  value,
  icon: Icon,
}: {
  label: string
  value: string
  icon: LucideIcon
}) {
  return (
    <div className="flex items-center gap-4 py-5 first:pt-0">
      <Icon className="size-4 text-(--brand-readable)" />
      <span className="flex-1 font-medium">{label}</span>
      <span className="text-sm text-muted-foreground">{value}</span>
    </div>
  )
}

function DecisionOption({
  title,
  icon: Icon,
}: {
  title: string
  icon: LucideIcon
}) {
  return (
    <div className="flex items-center gap-3 border-y border-(--landing-border) py-5">
      <Icon className="size-4 text-(--brand-readable)" />
      <span className="font-medium">{title}</span>
    </div>
  )
}
