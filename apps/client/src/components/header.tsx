import { Link, useRouterState } from '@tanstack/react-router'
import * as m from '@/paraglide/messages'
import { buttonVariants } from '@/components/ui/button'
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
} from '@/components/ui/navigation-menu'
import LocaleSwitcher from './locale-switcher'
import { ModeToggle } from './mode-toggle'
import { BrandLogo } from './brand-logo'
import { GitHubIcon } from './github-icon'

export default function Header() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })

  return (
    <header className="sticky top-0 z-50 min-h-(--header-height) border-b border-(--landing-border) bg-(--surface-veil) backdrop-blur-[18px]">
      <a
        href="#main-content"
        className="fixed top-2 left-2 z-100 -translate-y-20 rounded-lg bg-background px-4 py-2 text-sm font-medium text-foreground shadow-lg ring-2 ring-ring transition-transform focus:translate-y-0"
      >
        Skip to main content
      </a>
      <nav className="mx-auto flex min-h-(--header-height) w-[min(1120px,calc(100%-2rem))] items-center justify-between gap-4 py-[0.85rem] max-[720px]:flex-col max-[720px]:items-start">
        <div className="flex min-w-0 flex-col gap-[0.2rem]">
          <Link
            to="/"
            className="inline-flex w-fit transition-opacity hover:opacity-80"
          >
            <BrandLogo className="h-7" priority />
          </Link>
          <p className="m-0 text-[0.8rem] text-muted-foreground max-[720px]:hidden">
            {m.header_tagline()}
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-[0.6rem] max-[720px]:w-full max-[720px]:justify-start">
          <NavigationMenu className="min-w-0 flex-none justify-start">
            <NavigationMenuList className="gap-1">
              <NavigationMenuItem>
                <NavigationMenuLink
                  render={<Link to="/" />}
                  active={pathname === '/'}
                  className="rounded-full px-3"
                >
                  {m.header_nav_landing()}
                </NavigationMenuLink>
              </NavigationMenuItem>
              <NavigationMenuItem>
                <NavigationMenuLink
                  render={<Link to="/app" />}
                  active={pathname.startsWith('/app')}
                  className="rounded-full px-3"
                >
                  {m.header_nav_product()}
                </NavigationMenuLink>
              </NavigationMenuItem>
              <NavigationMenuItem>
                <NavigationMenuLink
                  render={<Link to="/about" />}
                  active={pathname.startsWith('/about')}
                  className="rounded-full px-3"
                >
                  {m.header_nav_architecture()}
                </NavigationMenuLink>
              </NavigationMenuItem>
            </NavigationMenuList>
          </NavigationMenu>

          <a
            href="/api/auth/sign-in?returnPathname=/app"
            className={buttonVariants({ variant: 'default', size: 'sm' })}
          >
            {m.app_sign_in()}
          </a>

          <a
            href="https://github.com/okikeSolutions/patchplane"
            target="_blank"
            rel="noreferrer"
            className={buttonVariants({
              variant: 'ghost',
              size: 'icon-sm',
              className:
                'border border-(--landing-border) bg-white/3 text-muted-foreground',
            })}
          >
            <span className="sr-only">{m.header_repository()}</span>
            <GitHubIcon />
          </a>

          <LocaleSwitcher />
          <ModeToggle />
        </div>
      </nav>
    </header>
  )
}
