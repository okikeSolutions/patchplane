import { useAuth } from '@workos/authkit-tanstack-react-start/client'
import { BookOpenIcon, GitBranchIcon, WorkflowIcon } from 'lucide-react'
import * as m from '@/paraglide/messages'
import { NavMain } from './nav-main'
import { NavSecondary } from './nav-secondary'
import { NavUser } from './nav-user'
import { BrandMark } from '@/components/brand-logo'
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar'

const navMain = [
  {
    title: 'Workflows',
    href: '/app',
    icon: WorkflowIcon,
    isActive: true,
  },
]

const navSecondary = [
  {
    title: 'Documentation',
    href: 'https://github.com/okikeSolutions/patchplane#readme',
    icon: BookOpenIcon,
  },
  {
    title: 'GitHub',
    href: 'https://github.com/okikeSolutions/patchplane',
    icon: GitBranchIcon,
  },
]

export function AppSidebar() {
  const { user, signOut } = useAuth()
  const displayName =
    user?.firstName ?? user?.email ?? m.app_operator_fallback()

  return (
    <Sidebar className="border-sidebar-border/60" collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              render={<a href="/app" aria-label="patchplane workflows" />}
            >
              <BrandMark className="size-8 shrink-0" />
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">patchplane</span>
                <span className="truncate text-xs">Patch reports</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={navMain} />
        <NavSecondary items={navSecondary} className="mt-auto" />
      </SidebarContent>
      <NavUser
        displayName={displayName}
        isSignedIn={Boolean(user)}
        onSignOut={() => {
          void signOut()
        }}
      />
      <SidebarRail />
    </Sidebar>
  )
}
