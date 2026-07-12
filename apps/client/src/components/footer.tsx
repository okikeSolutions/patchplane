import { Link } from '@tanstack/react-router'
import * as m from '@/paraglide/messages'
import { BrandLogo } from './brand-logo'
import { GitHubIcon } from './github-icon'

export default function Footer() {
  const year = new Date().getFullYear()

  return (
    <footer className="relative z-10 border-t border-(--landing-border) bg-(--surface-veil) px-0 py-8 backdrop-blur-[18px]">
      <div className="mx-auto flex w-[min(1120px,calc(100%-2rem))] justify-between gap-8 max-[960px]:flex-col">
        <div className="grid gap-[0.8rem]">
          <BrandLogo className="h-7" />
          <p className="m-0 text-muted-foreground">{m.footer_description()}</p>
        </div>

        <div className="grid gap-[0.8rem] max-[960px]:pt-2">
          <nav
            aria-label="Footer navigation"
            className="flex flex-wrap gap-4 text-muted-foreground"
          >
            <Link to="/" className="transition-colors hover:text-foreground">
              {m.header_nav_landing()}
            </Link>
            <Link to="/app" className="transition-colors hover:text-foreground">
              {m.header_nav_product()}
            </Link>
            <Link
              to="/about"
              className="transition-colors hover:text-foreground"
            >
              {m.header_nav_architecture()}
            </Link>
            <a
              href="https://github.com/okikeSolutions/patchplane"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 transition-colors hover:text-foreground"
            >
              <GitHubIcon className="size-4" />
              GitHub
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          </nav>
          <p className="m-0 text-muted-foreground">&copy; {year} patchplane</p>
        </div>
      </div>
    </footer>
  )
}
