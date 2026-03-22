import { Link, useRouterState } from '@tanstack/react-router'
import { Github } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
} from '@/components/ui/navigation-menu'
import { ModeToggle } from './mode-toggle'

export default function Header() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })

  return (
    <header className="site-header">
      <nav className="page-wrap site-nav">
        <div className="brand-lockup">
          <Link to="/" className="brand-link">
            <span className="brand-link__pip" />
            <span className="brand-link__wordmark">PatchPlane</span>
          </Link>
          <p className="brand-lockup__tag">AI change control plane</p>
        </div>

        <div className="site-nav__controls">
          <NavigationMenu className="min-w-0 flex-none justify-start">
            <NavigationMenuList className="site-nav__menu">
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

          <a
            href="https://github.com/okikeSolutions/patchplane"
            target="_blank"
            rel="noreferrer"
            className={buttonVariants({
              variant: 'ghost',
              size: 'icon-sm',
              className: 'site-nav__icon text-muted-foreground',
            })}
          >
            <span className="sr-only">Open the repository</span>
            <Github />
          </a>

          <ModeToggle />
        </div>
      </nav>
    </header>
  )
}
