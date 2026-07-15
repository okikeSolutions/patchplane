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
            <a
              href="https://github.com/okikeSolutions/patchplane"
              className="inline-flex items-center gap-2 transition-colors hover:text-foreground"
            >
              <GitHubIcon className="size-4" />
              GitHub
            </a>
            <a
              href="https://github.com/okikeSolutions/patchplane#readme"
              className="transition-colors hover:text-foreground"
            >
              {m.landing_capabilities()}
            </a>
            <a
              href="https://github.com/okikeSolutions/patchplane#quick-start"
              className="transition-colors hover:text-foreground"
            >
              {m.landing_quick_start()}
            </a>
            <a
              href="https://github.com/okikeSolutions/patchplane/blob/main/CONTRIBUTING.md"
              className="transition-colors hover:text-foreground"
            >
              {m.landing_contributing()}
            </a>
            <a
              href="https://github.com/okikeSolutions/patchplane/blob/main/ROADMAP.md"
              className="transition-colors hover:text-foreground"
            >
              {m.landing_roadmap()}
            </a>
          </nav>
          <p className="m-0 text-muted-foreground">&copy; {year} patchplane</p>
        </div>
      </div>
    </footer>
  )
}
