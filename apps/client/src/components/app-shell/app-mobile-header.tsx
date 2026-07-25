import { BrandMark } from '@/components/brand-logo'
import { Separator } from '@/components/ui/separator'
import { SidebarTrigger } from '@/components/ui/sidebar'

export function AppMobileHeader({ title }: { readonly title: string }) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background/95 px-3 md:hidden">
      <SidebarTrigger aria-label="Open navigation" />
      <Separator orientation="vertical" className="h-5" />
      <BrandMark className="size-6 shrink-0" />
      <span className="min-w-0 truncate text-sm font-semibold">{title}</span>
    </header>
  )
}
