import { useRouterState } from '@tanstack/react-router'
import { ArrowRight } from 'lucide-react'
import type { ReactNode } from 'react'
import * as m from '@/paraglide/messages'
import { buttonVariants } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { BrandLogo } from './brand-logo'
import { GitHubIcon } from './github-icon'

const repositoryUrl = 'https://github.com/okikeSolutions/patchplane'
const readmeUrl = `${repositoryUrl}#readme`
const quickStartUrl = `${repositoryUrl}#quick-start`
const contributingUrl = `${repositoryUrl}/blob/main/CONTRIBUTING.md`
const roadmapUrl = `${repositoryUrl}/blob/main/ROADMAP.md`

export default function Footer() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const year = new Date().getFullYear()
  const isLandingPage = ['/', '/en', '/de', '/en/', '/de/'].includes(pathname)

  return isLandingPage ? (
    <LandingFooter year={year} />
  ) : (
    <CompactFooter year={year} />
  )
}

function LandingFooter({ year }: { readonly year: number }) {
  return (
    <footer className="relative z-10 overflow-hidden border-t border-(--landing-border) bg-background">
      <div className="mx-auto w-[min(1120px,calc(100%-2rem))]">
        <div className="flex flex-col items-center py-[clamp(4.5rem,8vw,7rem)] text-center">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-(--brand-readable)">
            {m.landing_final_badge()}
          </p>
          <h2 className="mt-5 max-w-210 text-balance text-[clamp(2.75rem,5.5vw,5rem)] leading-[0.95] tracking-[-0.065em]">
            {m.landing_final_title()}
          </h2>
          <p className="mt-5 max-w-140 text-balance text-base leading-7 text-muted-foreground">
            {m.landing_final_intro()}
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <a
              href={contributingUrl}
              className={cn(
                buttonVariants({ size: 'lg' }),
                'rounded-full px-6 shadow-[0_18px_48px_rgb(237_176_69/0.14)] transition-transform hover:-translate-y-px',
              )}
            >
              {m.landing_contributing()}
              <ArrowRight data-icon="inline-end" />
            </a>
            <a
              href={quickStartUrl}
              className={cn(
                buttonVariants({ variant: 'ghost', size: 'lg' }),
                'rounded-full px-6',
              )}
            >
              {m.landing_start_local()}
            </a>
          </div>
        </div>

        <Separator className="bg-(--landing-border)" />

        <div className="relative z-1 grid grid-cols-[minmax(0,1.6fr)_repeat(2,minmax(9rem,0.55fr))] gap-x-14 gap-y-10 py-10 max-[760px]:grid-cols-2 max-[540px]:grid-cols-1">
          <div className="max-w-sm max-[760px]:col-span-2 max-[540px]:col-span-1">
            <BrandLogo className="h-7" />
            <p className="mt-4 text-sm leading-6 text-muted-foreground">
              {m.footer_description()}
            </p>
          </div>

          <FooterLinkGroup label={m.footer_product_label()}>
            <FooterLink href={readmeUrl}>{m.landing_capabilities()}</FooterLink>
            <FooterLink href={quickStartUrl}>
              {m.landing_quick_start()}
            </FooterLink>
            <FooterLink href={roadmapUrl}>{m.landing_roadmap()}</FooterLink>
          </FooterLinkGroup>

          <FooterLinkGroup label={m.footer_project_label()}>
            <FooterLink
              href={repositoryUrl}
              icon={<GitHubIcon className="size-4" />}
            >
              GitHub
            </FooterLink>
            <FooterLink href={contributingUrl}>
              {m.landing_contributing()}
            </FooterLink>
          </FooterLinkGroup>
        </div>

        <Separator className="bg-(--landing-border)" />

        <div className="relative z-1 flex items-center justify-between gap-6 py-5 text-xs text-muted-foreground max-[540px]:items-start">
          <p>&copy; {year} patchplane</p>
          <p className="text-right">{m.footer_closing_line()}</p>
        </div>

        <div
          aria-hidden="true"
          className="pointer-events-none -mb-[0.18em] whitespace-nowrap select-none text-center text-[clamp(3.5rem,15vw,10rem)] font-semibold leading-[0.72] tracking-[-0.09em] text-foreground/[0.035]"
        >
          patchplane
        </div>
      </div>
    </footer>
  )
}

function CompactFooter({ year }: { readonly year: number }) {
  return (
    <footer className="relative z-10 border-t border-(--landing-border) bg-background py-10">
      <div className="mx-auto flex w-[min(1120px,calc(100%-2rem))] items-end justify-between gap-10 max-[760px]:flex-col max-[760px]:items-start">
        <div className="max-w-sm">
          <BrandLogo className="h-7" />
          <p className="mt-4 text-sm leading-6 text-muted-foreground">
            {m.footer_description()}
          </p>
        </div>

        <div className="flex flex-col items-end gap-5 max-[760px]:items-start">
          <nav
            aria-label="Footer navigation"
            className="flex flex-wrap gap-x-5 gap-y-3 text-sm text-muted-foreground"
          >
            <FooterLink
              href={repositoryUrl}
              icon={<GitHubIcon className="size-4" />}
            >
              GitHub
            </FooterLink>
            <FooterLink href={readmeUrl}>{m.landing_capabilities()}</FooterLink>
            <FooterLink href={quickStartUrl}>
              {m.landing_quick_start()}
            </FooterLink>
            <FooterLink href={contributingUrl}>
              {m.landing_contributing()}
            </FooterLink>
            <FooterLink href={roadmapUrl}>{m.landing_roadmap()}</FooterLink>
          </nav>
          <p className="text-xs text-muted-foreground">
            &copy; {year} patchplane
          </p>
        </div>
      </div>
    </footer>
  )
}

function FooterLinkGroup({
  label,
  children,
}: {
  readonly label: string
  readonly children: ReactNode
}) {
  return (
    <nav aria-label={label}>
      <p className="font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-foreground">
        {label}
      </p>
      <div className="mt-4 flex flex-col items-start gap-3 text-sm text-muted-foreground">
        {children}
      </div>
    </nav>
  )
}

function FooterLink({
  href,
  icon,
  children,
}: {
  readonly href: string
  readonly icon?: ReactNode
  readonly children: ReactNode
}) {
  return (
    <a
      href={href}
      className="inline-flex items-center gap-2 transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none"
    >
      {icon}
      {children}
    </a>
  )
}
