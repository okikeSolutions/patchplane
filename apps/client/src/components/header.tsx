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

function GitHubIcon() {
  return (
    <svg viewBox="0 0 1024 1024" fill="none" aria-hidden="true">
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M512 0C229.12 0 0 229.12 0 512c0 226.56 146.56 417.92 350.08 485.76 25.6 4.48 35.2-10.88 35.2-24.32 0-12.16-.64-52.48-.64-95.36-128.64 23.68-161.92-31.36-172.16-60.16-5.76-14.72-30.72-60.16-52.48-72.32-17.92-9.6-43.52-33.28-.64-33.92 40.32-.64 69.12 37.12 78.72 52.48 46.08 77.44 119.68 55.68 149.12 42.24 4.48-33.28 17.92-55.68 32.64-68.48-113.92-12.8-232.96-56.96-232.96-252.8 0-55.68 19.84-101.76 52.48-137.6-5.12-12.8-23.04-65.28 5.12-135.68 0 0 42.88-13.44 140.8 52.48 40.96-11.52 84.48-17.28 128-17.28s87.04 5.76 128 17.28c97.92-66.56 140.8-52.48 140.8-52.48 28.16 70.4 10.24 122.88 5.12 135.68 32.64 35.84 52.48 81.28 52.48 137.6 0 196.48-119.68 240-233.6 252.8 18.56 16 34.56 46.72 34.56 94.72 0 68.48-.64 123.52-.64 140.8 0 13.44 9.6 29.44 35.2 24.32C877.44 929.92 1024 737.92 1024 512 1024 229.12 794.88 0 512 0"
        clipRule="evenodd"
      />
    </svg>
  )
}

export default function Header() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })

  return (
    <header className="sticky top-0 z-50 min-h-(--header-height) border-b border-white/8 bg-(--surface-veil) backdrop-blur-[18px]">
      <nav className="mx-auto flex min-h-(--header-height) w-[min(1120px,calc(100%-2rem))] items-center justify-between gap-4 py-[0.85rem] max-[720px]:flex-col max-[720px]:items-start">
        <div className="flex min-w-0 flex-col gap-[0.2rem]">
          <Link
            to="/"
            className="inline-flex w-fit items-center gap-[0.65rem] text-base font-bold tracking-[-0.03em] transition-colors hover:text-primary"
          >
            <span className="size-[0.7rem] rounded-full bg-[linear-gradient(135deg,rgb(255_144_52),rgb(255_209_122))] shadow-[0_0_24px_rgb(255_169_72/0.5)]" />
            <span>PatchPlane</span>
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
                'border border-white/8 bg-white/3 text-muted-foreground',
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
