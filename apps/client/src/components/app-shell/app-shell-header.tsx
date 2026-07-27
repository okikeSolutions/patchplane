import { BrandMark } from '@/components/brand-logo'
import * as m from '@/paraglide/messages'
import { Separator } from '@/components/ui/separator'
import { SidebarTrigger } from '@/components/ui/sidebar'

export function AppShellHeader({ title }: { readonly title: string }) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background/95 px-3 transition-[height] ease-linear md:h-12 md:px-4">
      <SidebarTrigger
        className="size-11 md:size-8"
        aria-label={m.app_nav_toggle()}
      />
      <Separator
        orientation="vertical"
        className="mr-2 data-vertical:h-4 data-vertical:self-auto"
      />
      <BrandMark className="size-6 shrink-0 md:hidden" />
      <span className="min-w-0 truncate text-sm font-semibold">{title}</span>
    </header>
  )
}
