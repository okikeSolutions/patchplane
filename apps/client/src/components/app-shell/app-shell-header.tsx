import { BrandMark } from '@/components/brand-logo'
import * as m from '@/paraglide/messages'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Separator } from '@/components/ui/separator'
import { SidebarTrigger } from '@/components/ui/sidebar'

export function AppShellHeader({
  parent,
  title,
}: {
  readonly parent?: {
    readonly href: string
    readonly label: string
  }
  readonly title: string
}) {
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
      <Breadcrumb className="min-w-0">
        <BreadcrumbList className="flex-nowrap">
          {parent === undefined ? null : (
            <>
              <BreadcrumbItem className="min-w-0">
                <BreadcrumbLink className="truncate" href={parent.href}>
                  {parent.label}
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
            </>
          )}
          <BreadcrumbItem className="min-w-0">
            <BreadcrumbPage className="truncate font-semibold">
              {title}
            </BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    </header>
  )
}
