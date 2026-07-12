import { Link } from '@tanstack/react-router'
import * as m from '@/paraglide/messages'
import { BrandLogo } from './brand-logo'

export default function Footer() {
  const year = new Date().getFullYear()

  return (
    <footer className="px-0 pt-16 pb-8">
      <div className="mx-auto flex w-[min(1120px,calc(100%-2rem))] justify-between gap-6 border-t border-white/8 pt-6 max-[960px]:flex-col">
        <div className="grid gap-[0.8rem]">
          <BrandLogo className="h-7" />
          <p className="m-0 text-muted-foreground">{m.footer_description()}</p>
        </div>

        <div className="grid gap-[0.8rem]">
          <div className="flex flex-wrap gap-4 text-muted-foreground">
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
              className="transition-colors hover:text-foreground"
            >
              GitHub
            </a>
          </div>
          <p className="m-0 text-muted-foreground">&copy; {year} patchplane</p>
        </div>
      </div>
    </footer>
  )
}
