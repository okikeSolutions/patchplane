import { Link } from '@tanstack/react-router'
import * as m from '@/paraglide/messages'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function DashboardHero() {
  return (
    <section id="overview" className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
      <div className="flex flex-col gap-3">
        <Badge variant="outline" className="w-fit uppercase tracking-[0.12em]">
          {m.app_hero_badge()}
        </Badge>
        <div className="flex flex-col gap-2">
          <h1 className="text-balance text-3xl leading-tight tracking-[-0.04em] md:text-5xl">
            {m.app_hero_title()}
          </h1>
          <p className="max-w-3xl text-muted-foreground md:text-lg">
            {m.app_hero_intro()}
          </p>
        </div>
      </div>
      <Link
        to="/about"
        className={cn(buttonVariants({ variant: 'outline' }), 'w-fit')}
      >
        {m.app_hero_architecture_link()}
      </Link>
    </section>
  )
}
