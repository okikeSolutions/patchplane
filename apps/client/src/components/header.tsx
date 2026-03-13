import { Link, useRouterState } from '@tanstack/react-router'
import { Github } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
} from '@/components/ui/navigation-menu'
import { Separator } from '@/components/ui/separator'
import { ModeToggle } from './mode-toggle'

export default function Header() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background px-4 backdrop-blur-xl">
      <nav className="page-wrap flex flex-wrap items-center gap-x-4 gap-y-2 py-3 sm:py-4">
        <h2 className="m-0 shrink-0 text-base font-semibold tracking-tight">
          <Link
            to="/"
            className={buttonVariants({
              variant: 'outline',
              size: 'sm',
              className:
                'rounded-full border-border bg-muted px-3 shadow-sm sm:px-4',
            })}
          >
            <span className="size-2.5 rounded-full bg-[linear-gradient(90deg,#ff7a18,#ffb347)]" />
            PatchPlane
          </Link>
        </h2>

        <div className="ml-auto hidden items-center gap-3 sm:flex">
          <Separator orientation="vertical" className="mx-1 h-5" />
          <a
            href="https://github.com/okikeSolutions/patchplane"
            target="_blank"
            rel="noreferrer"
            className={buttonVariants({
              variant: 'ghost',
              size: 'icon-sm',
              className: 'text-muted-foreground',
            })}
          >
            <span className="sr-only">Open the repository</span>
            <Github />
          </a>
        </div>

        <div className="order-3 flex w-full flex-wrap items-center gap-2 pb-1 text-sm font-semibold text-muted-foreground sm:order-2 sm:w-auto sm:flex-nowrap sm:pb-0">
          <NavigationMenu className="min-w-0 flex-none justify-start">
            <NavigationMenuList className="gap-1">
              <NavigationMenuItem>
                <NavigationMenuLink
                  render={<Link to="/" />}
                  active={pathname === '/'}
                  className="rounded-full px-3"
                >
                  Landing
                </NavigationMenuLink>
              </NavigationMenuItem>
              <NavigationMenuItem>
                <NavigationMenuLink
                  render={<Link to="/app" />}
                  active={pathname.startsWith('/app')}
                  className="rounded-full px-3"
                >
                  Product
                </NavigationMenuLink>
              </NavigationMenuItem>
              <NavigationMenuItem>
                <NavigationMenuLink
                  render={<Link to="/about" />}
                  active={pathname.startsWith('/about')}
                  className="rounded-full px-3"
                >
                  Architecture
                </NavigationMenuLink>
              </NavigationMenuItem>
            </NavigationMenuList>
          </NavigationMenu>
          <ModeToggle />
        </div>
      </nav>
    </header>
  )
}
