import { Link, useRouterState } from '@tanstack/react-router'
import { Github } from 'lucide-react'
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

          <LocaleSwitcher />

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
            <Github />
          </a>

          <ModeToggle />
        </div>
      </nav>
    </header>
  )
}
