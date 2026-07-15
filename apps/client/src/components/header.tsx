import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import { ArrowUpRight, Menu, SlidersHorizontal } from 'lucide-react'
import * as m from '@/paraglide/messages'
import {
  deLocalizeHref,
  getLocale,
  locales,
  localizeHref,
  setLocale as setRuntimeLocale,
} from '@/paraglide/runtime'
import { BrandLogo } from '@/components/brand-logo'
import { GitHubIcon } from '@/components/github-icon'
import { useTheme } from '@/components/theme-provider'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

const repositoryUrl = 'https://github.com/okikeSolutions/patchplane'
const signInUrl = '/api/auth/sign-in?returnPathname=/app'

const navigationItems = [
  { href: '#how-it-works', label: m.header_nav_how },
  { href: '#trust-report', label: m.header_nav_report },
  { href: '#open-source', label: m.header_nav_open_source },
] as const

export default function Header() {
  return (
    <header className="relative z-50 border-b border-(--landing-border) bg-background">
      <a
        href="#main-content"
        className="fixed top-2 left-2 z-100 -translate-y-20 rounded-lg bg-background px-4 py-2 text-sm font-medium text-foreground shadow-lg ring-2 ring-ring transition-transform focus:translate-y-0"
      >
        Skip to main content
      </a>

      <nav className="mx-auto flex h-16 w-[min(1180px,calc(100%-2rem))] items-center justify-between gap-6">
        <Link
          to="/"
          aria-label="patchplane"
          className="inline-flex shrink-0 transition-opacity hover:opacity-75"
        >
          <BrandLogo className="h-6" priority />
        </Link>

        <div className="flex items-center gap-1 max-[860px]:hidden">
          {navigationItems.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {item.label()}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-1.5 max-[860px]:hidden">
          <a
            href={signInUrl}
            className={buttonVariants({ variant: 'ghost', size: 'sm' })}
          >
            {m.app_sign_in()}
          </a>
          <a
            href={repositoryUrl}
            className={cn(buttonVariants({ size: 'sm' }), 'rounded-full px-4')}
          >
            <GitHubIcon data-icon="inline-start" />
            GitHub
          </a>
          <HeaderPreferencesMenu />
        </div>

        <div className="hidden items-center gap-1.5 max-[860px]:flex">
          <a
            href={repositoryUrl}
            className={cn(
              buttonVariants({ size: 'sm' }),
              'rounded-full px-3.5',
            )}
          >
            <GitHubIcon data-icon="inline-start" />
            GitHub
          </a>
          <MobileNavigation />
        </div>
      </nav>
    </header>
  )
}

function MobileNavigation() {
  return (
    <Sheet>
      <SheetTrigger render={<Button variant="ghost" size="icon-sm" />}>
        <Menu />
        <span className="sr-only">{m.header_menu()}</span>
      </SheetTrigger>
      <SheetContent className="w-[min(24rem,calc(100%-1rem))]">
        <SheetHeader className="border-b border-border px-5 py-5 pr-12">
          <SheetTitle>{m.header_navigation()}</SheetTitle>
          <SheetDescription>
            {m.header_navigation_description()}
          </SheetDescription>
        </SheetHeader>

        <nav
          aria-label={m.header_navigation()}
          className="flex flex-col px-3 py-4"
        >
          {navigationItems.map((item) => (
            <SheetClose
              key={item.href}
              render={
                <a
                  href={item.href}
                  className="group flex items-center justify-between rounded-lg px-3 py-4 text-xl tracking-[-0.035em] transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                />
              }
            >
              {item.label()}
              <ArrowUpRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </SheetClose>
          ))}
        </nav>

        <SheetFooter className="border-t border-border p-4">
          <a
            href={repositoryUrl}
            className={cn(buttonVariants(), 'w-full rounded-full')}
          >
            <GitHubIcon data-icon="inline-start" />
            {m.landing_view_github()}
          </a>
          <a
            href={signInUrl}
            className={cn(
              buttonVariants({ variant: 'outline' }),
              'w-full rounded-full',
            )}
          >
            {m.app_sign_in()}
          </a>
          <HeaderPreferencesMenu showLabel />
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

function HeaderPreferencesMenu({
  showLabel = false,
}: {
  readonly showLabel?: boolean
}) {
  const navigate = useNavigate()
  const { hash, pathname, searchStr } = useRouterState({
    select: (state) => ({
      hash: state.location.hash,
      pathname: state.location.pathname,
      searchStr: state.location.searchStr,
    }),
  })
  const { setTheme, theme } = useTheme()
  const currentLocale = getLocale()
  const currentHref = `${pathname}${searchStr}${hash}`

  async function changeLocale(locale: string) {
    if (locale === currentLocale || !isLocale(locale)) {
      return
    }

    const baseHref = deLocalizeHref(currentHref || '/')
    const href = localizeHref(baseHref, { locale })

    await setRuntimeLocale(locale, { reload: false })
    await navigate({ href, reloadDocument: true })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant={showLabel ? 'outline' : 'ghost'}
            size={showLabel ? 'default' : 'icon-sm'}
            className={
              showLabel ? 'w-full justify-between rounded-full' : undefined
            }
          />
        }
      >
        <SlidersHorizontal data-icon={showLabel ? 'inline-start' : undefined} />
        {showLabel ? m.header_preferences() : null}
        {showLabel ? null : (
          <span className="sr-only">{m.header_preferences()}</span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{m.header_locale_switcher()}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={currentLocale}
            onValueChange={changeLocale}
          >
            {locales.map((locale) => (
              <DropdownMenuRadioItem key={locale} value={locale}>
                {getLocaleLabel(locale)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        <DropdownMenuGroup>
          <DropdownMenuLabel>{m.header_theme()}</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
            <DropdownMenuRadioItem value="light">
              {m.header_theme_light()}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="dark">
              {m.header_theme_dark()}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="system">
              {m.header_theme_system()}
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function getLocaleLabel(locale: string) {
  if (locale === 'en') {
    return m.header_locale_en()
  }

  if (locale === 'de') {
    return m.header_locale_de()
  }

  return locale
}

function isLocale(locale: string): locale is (typeof locales)[number] {
  return locales.some((item) => item === locale)
}
