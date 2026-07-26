import type { ComponentType } from 'react'
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'

export interface NavMainItem {
  readonly title: string
  readonly href: string
  readonly icon: ComponentType
  readonly isActive?: boolean
}

export function NavMain({ items }: { readonly items: ReadonlyArray<NavMainItem> }) {
  return (
    <nav aria-label="Control plane">
      <SidebarGroup>
      <SidebarGroupLabel>Control plane</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton
                isActive={item.isActive}
                className="min-h-11 md:min-h-8"
                tooltip={item.title}
                render={<a href={item.href} aria-label={item.title} />}
              >
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
