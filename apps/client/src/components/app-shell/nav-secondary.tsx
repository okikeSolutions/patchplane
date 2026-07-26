import type { ComponentProps, ComponentType } from 'react'
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'

export interface NavSecondaryItem {
  readonly title: string
  readonly href: string
  readonly icon: ComponentType
}

export function NavSecondary({
  items,
  label = 'Support',
  ...props
}: {
  readonly items: ReadonlyArray<NavSecondaryItem>
  readonly label?: string
} & ComponentProps<typeof SidebarGroup>) {
  return (
    <nav aria-label={label}>
      <SidebarGroup {...props}>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton className="min-h-11 md:min-h-8" render={<a href={item.href} target="_blank" rel="noreferrer" aria-label={`${item.title} (opens in a new tab)`} />}>
                <item.icon />
                <span>{item.title}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
      </SidebarGroup>
    </nav>
  )
}
