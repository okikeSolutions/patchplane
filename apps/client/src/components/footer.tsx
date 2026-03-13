import { Link } from '@tanstack/react-router'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'

export default function Footer() {
  const year = new Date().getFullYear()

  return (
    <footer className="site-footer mt-20 px-4 pb-14 pt-10">
      <div className="page-wrap flex flex-col gap-4">
        <Separator />
        <div className="flex flex-col items-center justify-between gap-4 text-center sm:flex-row sm:text-left">
          <p className="m-0 text-sm">&copy; {year} PatchPlane.</p>
          <Badge variant="outline" className="island-kicker">
            TanStack Start UI, Convex backend, Bun workspace
          </Badge>
        </div>
        <div className="flex justify-center gap-2 sm:justify-start">
          <Link
            to="/"
            className={buttonVariants({
              variant: 'ghost',
              size: 'sm',
            })}
          >
            Landing
          </Link>
          <Link
            to="/app"
            className={buttonVariants({
              variant: 'ghost',
              size: 'sm',
            })}
          >
            App Shell
          </Link>
          <a
            href="https://github.com/okikeSolutions/patchplane"
            target="_blank"
            rel="noreferrer"
            className={buttonVariants({
              variant: 'ghost',
              size: 'sm',
            })}
          >
            GitHub
          </a>
        </div>
      </div>
    </footer>
  )
}
